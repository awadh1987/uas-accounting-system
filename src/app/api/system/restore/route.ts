import crypto from "node:crypto";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { withTenantRoute } from "@/lib/prisma";
import {
  extractFullSchemaFromSqliteBuffer,
  hasValidPgDumpHeader,
  normalizeBackupTenantSlug,
  resolveTenantBackupFilePath,
  restoreDatabaseFromBuffer,
  restoreFullSchemaJsonBackup,
  restorePostgresFromPgDumpBuffer,
  type FullSchemaBackupData,
  type UasbakEnvelope,
  type UasbakPgDumpEnvelopeV3,
  type UasbakPortableEnvelopeV2,
} from "@/lib/backupService";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";

export const dynamic = "force-dynamic";

interface ParsedRestorePayload {
  sqliteBuffer: Buffer | null;
  pgDumpBuffer: Buffer | null;
  jsonBackup: FullSchemaBackupData | null;
  expectedTenantSlug: string | null;
  expectedSha256: string | null;
}

function assertTenantSlugMatch(
  incomingSlug: string | null | undefined,
  activeTenantId: string
): void {
  if (!incomingSlug) return;
  const activeSlug = normalizeBackupTenantSlug(activeTenantId);
  const candidateSlug = normalizeBackupTenantSlug(incomingSlug);
  if (candidateSlug !== activeSlug) {
    throw new Error(
      `⛔ رفض أمني: النسخة الاحتياطية تخص المنشأة (${candidateSlug}) ولا تطابق المنشأة النشطة (${activeSlug}) / Tenant slug mismatch`
    );
  }
}

function parseEnvelopeJsonPayload(
  parsed: Record<string, unknown>,
  activeTenantId: string
): ParsedRestorePayload {
  const manifest =
    parsed.manifest && typeof parsed.manifest === "object"
      ? (parsed.manifest as Record<string, unknown>)
      : null;

  const incomingSlug =
    (manifest?.tenantSlug as string | undefined) ||
    (parsed.tenantSlug as string | undefined) ||
    (parsed.tenantId as string | undefined) ||
    null;

  assertTenantSlugMatch(incomingSlug, activeTenantId);

  if (parsed.format === "UAS-BACKUP-PG-V3" && typeof parsed.pgDumpBase64 === "string") {
    const envV3 = parsed as unknown as UasbakPgDumpEnvelopeV3;
    const expectedSha = String(manifest?.sha256 || envV3.sha256 || "").trim();
    if (!expectedSha) {
      throw new Error("ملف الاستعادة يفتقد بصمة التحقق SHA-256 في البيان (Manifest).");
    }
    const pgDumpBuffer = Buffer.from(envV3.pgDumpBase64, "base64");
    const actualSha = crypto.createHash("sha256").update(pgDumpBuffer).digest("hex");
    if (actualSha !== expectedSha) {
      throw new Error("فشل التحقق من صحة بصمة التشفير (SHA-256 Checksum Mismatch).");
    }
    return {
      sqliteBuffer: null,
      pgDumpBuffer,
      jsonBackup: null,
      expectedTenantSlug: incomingSlug,
      expectedSha256: expectedSha,
    };
  }

  if (parsed.format === "UAS-BACKUP-V2" && parsed.schemaBackup) {
    const envV2 = parsed as unknown as UasbakPortableEnvelopeV2;
    const expectedSha = String(manifest?.sha256 || envV2.sha256 || "").trim();
    const serialized = JSON.stringify(envV2.schemaBackup);
    const calculatedSha256 = crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
    if (expectedSha && calculatedSha256 !== expectedSha) {
      throw new Error("فشل التحقق من صحة بصمة التشفير (SHA-256 Checksum Mismatch).");
    }
    return {
      sqliteBuffer: null,
      pgDumpBuffer: null,
      jsonBackup: envV2.schemaBackup,
      expectedTenantSlug: incomingSlug,
      expectedSha256: expectedSha || null,
    };
  }

  if (parsed.format === "UAS-FULL-SCHEMA-JSON-V1" || parsed.tables) {
    return {
      sqliteBuffer: null,
      pgDumpBuffer: null,
      jsonBackup: parsed as unknown as FullSchemaBackupData,
      expectedTenantSlug: incomingSlug,
      expectedSha256: null,
    };
  }

  if (typeof parsed.dbBase64 === "string") {
    const envV1 = parsed as unknown as UasbakEnvelope;
    const expectedSha = String(manifest?.sha256 || envV1.sha256 || "").trim();
    const sqliteBuffer = Buffer.from(envV1.dbBase64, "base64");
    const calculatedSha256 = crypto.createHash("sha256").update(sqliteBuffer).digest("hex");
    if (expectedSha && calculatedSha256 !== expectedSha) {
      throw new Error(
        "فشل التحقق من صحة بصمة التشفير (SHA-256 Checksum Mismatch). قد يكون الملف تالفاً أو تم التلاعب به"
      );
    }
    return {
      sqliteBuffer,
      pgDumpBuffer: null,
      jsonBackup: null,
      expectedTenantSlug: incomingSlug,
      expectedSha256: expectedSha || null,
    };
  }

  throw new Error(
    "حزمة النسخة الاحتياطية غير صالحة (حقل pgDumpBase64 أو dbBase64 أو جداول البيانات مفقود)"
  );
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }

    const activeTenant = getActiveTenantId();
    const contentType = req.headers.get("content-type") || "";
    const isFormData = contentType.includes("multipart/form-data");

    let actorInput: Record<string, unknown> = {};
    let parsedPayload: ParsedRestorePayload = {
      sqliteBuffer: null,
      pgDumpBuffer: null,
      jsonBackup: null,
      expectedTenantSlug: null,
      expectedSha256: null,
    };
    let sourceDesc = "manual_restore";

    if (isFormData) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return jsonError("يرجى اختيار ملف النسخة الاحتياطية (.uasbak أو .dump أو .db أو .json)", 400);
      }

      const rawBuf = Buffer.from(await file.arrayBuffer());
      sourceDesc = `uploaded_file: ${file.name}`;

      if (hasValidPgDumpHeader(rawBuf)) {
        parsedPayload.pgDumpBuffer = rawBuf;
      } else {
        const fileText = rawBuf.toString("utf8");
        if (
          file.name.endsWith(".uasbak") ||
          file.name.endsWith(".json") ||
          fileText.trimStart().startsWith("{")
        ) {
          try {
            const parsed = JSON.parse(fileText) as Record<string, unknown>;
            parsedPayload = parseEnvelopeJsonPayload(parsed, activeTenant);
          } catch (e) {
            return jsonError(`تعذر قراءة أو التحقق من حزمة النسخة الاحتياطية: ${(e as Error).message}`, 400);
          }
        } else {
          parsedPayload.sqliteBuffer = rawBuf;
        }
      }
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      actorInput = body;

      if (body.localSnapshotName) {
        const snapshotName = String(body.localSnapshotName).trim();
        const fullPath = resolveTenantBackupFilePath(snapshotName, activeTenant);
        if (!fullPath) {
          return jsonError(`النسخة الاحتياطية المحلية غير موجودة أو غير مصرح بها: ${snapshotName}`, 404);
        }
        const rawBuf = fs.readFileSync(fullPath);
        sourceDesc = `local_snapshot: ${snapshotName}`;
        if (hasValidPgDumpHeader(rawBuf)) {
          parsedPayload.pgDumpBuffer = rawBuf;
        } else {
          const textHead = rawBuf.subarray(0, Math.min(rawBuf.length, 64)).toString("utf8").trimStart();
          if (snapshotName.endsWith(".uasbak") || snapshotName.endsWith(".json") || textHead.startsWith("{")) {
            try {
              const parsed = JSON.parse(rawBuf.toString("utf8")) as Record<string, unknown>;
              parsedPayload = parseEnvelopeJsonPayload(parsed, activeTenant);
            } catch (e) {
              return jsonError(`تعذر التحقق من النسخة الاحتياطية: ${(e as Error).message}`, 400);
            }
          } else {
            parsedPayload.sqliteBuffer = rawBuf;
          }
        }
      } else if (
        body.pgDumpBase64 ||
        body.schemaBackup ||
        body.tables ||
        body.dbBase64 ||
        body.envelope
      ) {
        try {
          const targetObj =
            body.envelope && typeof body.envelope === "object"
              ? (body.envelope as Record<string, unknown>)
              : body;
          parsedPayload = parseEnvelopeJsonPayload(targetObj, activeTenant);
          sourceDesc = `envelope_restore: ${String(targetObj.companyName || activeTenant)}`;
        } catch (e) {
          return jsonError((e as Error).message, 400);
        }
      } else {
        return jsonError("يرجى إرسال ملف النسخة الاحتياطية أو تحديد اسم النسخة المحلية", 400);
      }
    }

    const auth = await authorizeApiAction(actorInput, req, {
      moduleId: "system",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    if (actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError("⛔ استعادة النسخ الاحتياطية محصورة بمدير النظام العام (SUPER_ADMIN)");
    }

    if (parsedPayload.pgDumpBuffer) {
      const pgRes = await restorePostgresFromPgDumpBuffer(
        parsedPayload.pgDumpBuffer,
        actor,
        sourceDesc,
        {
          tenantId: activeTenant,
          expectedSha256: parsedPayload.expectedSha256 || undefined,
          expectedTenantSlug: parsedPayload.expectedTenantSlug,
        }
      );
      return NextResponse.json({
        ok: true,
        message: "تمت استعادة قاعدة بيانات PostgreSQL ذرياً بنجاح",
        preRestoreSnapshot: pgRes.preRestoreSnapshot,
        tenantSlug: pgRes.tenantSlug,
        database: pgRes.database,
      });
    }

    if (parsedPayload.jsonBackup) {
      const result = await restoreFullSchemaJsonBackup(
        parsedPayload.jsonBackup,
        actor,
        sourceDesc,
        activeTenant
      );
      return NextResponse.json({
        ok: true,
        message: "تمت استعادة قاعدة البيانات بنجاح (JSON Full Schema)",
        preRestoreSnapshot: result.preRestoreSnapshot,
        companyName: result.companyName,
        restoredTables: result.restoredTables,
      });
    }

    const buffer = parsedPayload.sqliteBuffer;
    if (!buffer || buffer.length === 0) {
      return jsonError("ملف النسخة الاحتياطية فارغ", 400);
    }

    if (!isSqliteRuntime()) {
      const extracted = extractFullSchemaFromSqliteBuffer(buffer);
      const result = await restoreFullSchemaJsonBackup(
        extracted,
        actor,
        `${sourceDesc} (cross-engine)`,
        activeTenant
      );
      return NextResponse.json({
        ok: true,
        message: "تمت استعادة قاعدة البيانات السحابية من نسخة SQLite المحمولة بنجاح",
        preRestoreSnapshot: result.preRestoreSnapshot,
        companyName: result.companyName,
        restoredTables: result.restoredTables,
      });
    }

    const result = await restoreDatabaseFromBuffer(buffer, actor, sourceDesc, activeTenant);

    return NextResponse.json({
      ok: true,
      message: "تمت استعادة قاعدة البيانات بنجاح",
      preRestoreSnapshot: result.preRestoreSnapshot,
      companyName: result.companyName,
    });
  } catch (error) {
    console.error("POST /api/system/restore error:", error);
    return jsonError((error as Error).message, 400);
  }
});

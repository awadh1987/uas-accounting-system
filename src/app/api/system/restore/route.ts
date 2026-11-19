import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  getBackupsDirectory,
  restoreDatabaseFromBuffer,
  restoreFullSchemaJsonBackup,
  type FullSchemaBackupData,
  type UasbakEnvelope,
} from "@/lib/backupService";
import { extractActor, jsonError, forbiddenError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();

    const contentType = req.headers.get("content-type") || "";
    const isFormData = contentType.includes("multipart/form-data");

    let actorInput: Record<string, unknown> = {};
    let buffer: Buffer | null = null;
    let jsonBackup: FullSchemaBackupData | null = null;
    let sourceDesc = "manual_restore";

    if (isFormData) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return jsonError("يرجى اختيار ملف النسخة الاحتياطية (.uasbak أو .db أو .json)", 400);
      }

      const fileText = await file.text();
      sourceDesc = `uploaded_file: ${file.name}`;

      // Check if uploaded file is JSON (.uasbak envelope or full schema JSON)
      if (file.name.endsWith(".uasbak") || file.name.endsWith(".json") || fileText.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(fileText);
          if (parsed.format === "UAS-FULL-SCHEMA-JSON-V1" || parsed.tables) {
            jsonBackup = parsed as FullSchemaBackupData;
          } else if (parsed.dbBase64) {
            const envelope = parsed as UasbakEnvelope;
            buffer = Buffer.from(envelope.dbBase64, "base64");
            const calculatedSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
            if (envelope.sha256 && calculatedSha256 !== envelope.sha256) {
              return jsonError("فشل التحقق من صحة بصمة التشفير (SHA-256 Checksum Mismatch). قد يكون الملف تالفاً أو تم التلاعب به", 400);
            }
          } else {
            return jsonError("حزمة النسخة الاحتياطية غير صالحة (حقل dbBase64 أو جداول البيانات مفقودة)", 400);
          }
        } catch (e) {
          return jsonError(`تعذر قراءة حزمة النسخة الاحتياطية: ${(e as Error).message}`, 400);
        }
      } else {
        // Raw SQLite binary
        const arrayBuf = await file.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      }
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      actorInput = body;

      if (body.format === "UAS-FULL-SCHEMA-JSON-V1" || body.tables) {
        jsonBackup = body as unknown as FullSchemaBackupData;
        sourceDesc = `json_payload: ${jsonBackup.companyName || "UAS"}`;
      } else if (body.localSnapshotName) {
        const safeName = path.basename(String(body.localSnapshotName).trim());
        const backupsDir = getBackupsDirectory();
        const fullPath = path.join(backupsDir, safeName);
        if (!fs.existsSync(fullPath)) {
          return jsonError(`النسخة الاحتياطية المحلية غير موجودة: ${safeName}`, 404);
        }
        buffer = fs.readFileSync(fullPath);
        sourceDesc = `local_snapshot: ${safeName}`;
      } else if (body.envelope || body.dbBase64) {
        const env = (body.envelope || body) as Partial<UasbakEnvelope>;
        if (!env.dbBase64) {
          return jsonError("حزمة النسخة الاحتياطية غير صالحة (dbBase64 مفقود)", 400);
        }
        buffer = Buffer.from(env.dbBase64, "base64");
        const calculatedSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        if (env.sha256 && calculatedSha256 !== env.sha256) {
          return jsonError("فشل التحقق من صحة بصمة التشفير (SHA-256 Checksum Mismatch)", 400);
        }
        sourceDesc = `envelope_restore: ${env.companyName || "UAS"}`;
      } else {
        return jsonError("يرجى إرسال ملف النسخة الاحتياطية أو تحديد اسم النسخة المحلية", 400);
      }
    }

    const actor = extractActor(actorInput, req);
    if (actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError("⛔ استعادة النسخ الاحتياطية محصورة بمدير النظام العام (SUPER_ADMIN)");
    }

    if (jsonBackup) {
      const result = await restoreFullSchemaJsonBackup(jsonBackup, actor, sourceDesc);
      return NextResponse.json({
        ok: true,
        message: "تمت استعادة قاعدة البيانات بنجاح (JSON Full Schema)",
        preRestoreSnapshot: result.preRestoreSnapshot,
        companyName: result.companyName,
        restoredTables: result.restoredTables,
      });
    }

    if (!buffer || buffer.length === 0) {
      return jsonError("ملف النسخة الاحتياطية فارغ", 400);
    }

    const result = await restoreDatabaseFromBuffer(buffer, actor, sourceDesc);

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
}

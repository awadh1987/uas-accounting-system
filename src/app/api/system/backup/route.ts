import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { prisma, withTenantRoute } from "@/lib/prisma";
import {
  buildContentDispositionHeader,
  createPortableUasbakEnvelope,
  createTempBackupSnapshot,
  exportFullSchemaJsonBackup,
  normalizeBackupTenantSlug,
  pruneTenantBackups,
  saveBackupEnvelopeToTenantDir,
} from "@/lib/backupService";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { emitNotification } from "@/lib/notifications/notificationService";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";

export const dynamic = "force-dynamic";

async function executeBackupRequest(
  req: NextRequest,
  body: Record<string, unknown>,
  options: { persistSnapshot: boolean; actionMode: "read" | "create" }
) {
  if (isSqliteRuntime()) {
    await ensureSqliteDatabaseReady();
  }

  const auth = await authorizeApiAction(
    body,
    req,
    options.actionMode === "create"
      ? { moduleId: "system", action: "create" }
      : { moduleId: "system" }
  );
  if (!auth.ok) return auth.response;
  const actor = auth.actor;
  if (actor.userRole !== "SUPER_ADMIN") {
    return forbiddenError(
      "⛔ إجراء تصدير النسخ الاحتياطية محصور بمدير النظام العام (SUPER_ADMIN)"
    );
  }

  const { searchParams } = new URL(req.url);
  const format = String(body.format || searchParams.get("format") || "uasbak").toLowerCase();
  const activeTenant = getActiveTenantId();
  const tenantSlug = normalizeBackupTenantSlug(activeTenant);

  if (format === "json") {
    const { backup, filename } = await exportFullSchemaJsonBackup();
    await emitNotification({
      eventType: "BACKUP_COMPLETED",
      channel: "general",
      severity: "SUCCESS",
      titleAr: "تم تصدير نسخة احتياطية كاملة (JSON)",
      titleEn: "Full Schema Backup Exported (JSON)",
      messageAr: `تم إنشاء الملف ${filename}`,
      messageEn: `Generated backup file ${filename}`,
      targetTab: "system",
      actorUserId: actor.userId,
    });
    return NextResponse.json(backup, {
      status: 200,
      headers: {
        "Content-Disposition": buildContentDispositionHeader(filename),
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  if (format === "raw" && isSqliteRuntime()) {
    const { buffer } = await createTempBackupSnapshot();
    const todayStr = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="uas-enterprise-${tenantSlug}-${todayStr}.db"`,
      },
    });
  }

  const { envelope, filename } = await createPortableUasbakEnvelope({
    forcePortableV2: format === "portable",
  });

  if (options.persistSnapshot && body.persist !== false) {
    await saveBackupEnvelopeToTenantDir(filename, envelope, activeTenant);
    pruneTenantBackups({ tenantSlug });
  }

  await prisma.$transaction(async (tx) => {
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "BACKUP_EXPORTED_BY_ADMIN",
      entityReference: `Backup:${filename}`,
      details: `تم إنشاء وتصدير نسخة احتياطية (${envelope.format}) للمنشأة (${tenantSlug})`,
    });
    await emitNotification(
      {
        eventType: "BACKUP_COMPLETED",
        channel: "general",
        severity: "SUCCESS",
        titleAr: "تم إنشاء النسخة الاحتياطية (.uasbak)",
        titleEn: "Backup Created (.uasbak)",
        messageAr: `تم إنشاء النسخة الاحتياطية للمنشأة (${tenantSlug}) بنجاح (${filename})`,
        messageEn: `Created tenant backup (${filename}) for ${tenantSlug}`,
        targetTab: "system",
        actorUserId: actor.userId,
        metadata: { filename, tenantSlug, format: envelope.format, sha256: envelope.sha256 },
      },
      tx
    );
  });

  return NextResponse.json(
    {
      ok: true,
      filename,
      ...envelope,
    },
    {
      status: 200,
      headers: {
        "Content-Disposition": buildContentDispositionHeader(filename),
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const persistSnapshot = searchParams.get("persist") === "1";
    return await executeBackupRequest(req, {}, { persistSnapshot, actionMode: "read" });
  } catch (error) {
    console.error("GET /api/system/backup error:", error);
    return jsonError(`تعذر إنشاء النسخة الاحتياطية: ${(error as Error).message}`, 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return await executeBackupRequest(req, body, { persistSnapshot: true, actionMode: "create" });
  } catch (error) {
    console.error("POST /api/system/backup error:", error);
    return jsonError(`تعذر إنشاء النسخة الاحتياطية: ${(error as Error).message}`, 500);
  }
});

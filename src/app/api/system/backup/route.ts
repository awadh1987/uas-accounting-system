import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { withTenantRoute } from "@/lib/prisma";
import {
  createPortableUasbakEnvelope,
  createTempBackupSnapshot,
  exportFullSchemaJsonBackup,
} from "@/lib/backupService";
import { emitNotification } from "@/lib/notifications/notificationService";
import { extractActor, jsonError, forbiddenError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();

    const actor = extractActor({}, req);
    if (actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError("⛔ إجراء تصدير النسخ الاحتياطية محصور بمدير النظام العام (SUPER_ADMIN)");
    }

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "uasbak").toLowerCase();

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
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    if (format === "raw") {
      const { buffer } = await createTempBackupSnapshot();
      const todayStr = new Date().toISOString().slice(0, 10);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/x-sqlite3",
          "Content-Disposition": `attachment; filename="uas-enterprise-${todayStr}.db"`,
        },
      });
    }

    const { envelope, filename } = await createPortableUasbakEnvelope({
      forcePortableV2: format === "portable",
    });

    await emitNotification({
      eventType: "BACKUP_COMPLETED",
      channel: "general",
      severity: "SUCCESS",
      titleAr: "تم إنشاء النسخة الاحتياطية (.uasbak)",
      titleEn: "Backup Created (.uasbak)",
      messageAr: `تم إنشاء النسخة الاحتياطية للمنشأة بنجاح (${filename})`,
      messageEn: `Created tenant backup (${filename})`,
      targetTab: "system",
      actorUserId: actor.userId,
    });

    return NextResponse.json(envelope, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("GET /api/system/backup error:", error);
    return jsonError(`تعذر إنشاء النسخة الاحتياطية: ${(error as Error).message}`, 500);
  }
});

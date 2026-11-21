import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { withTenantRoute } from "@/lib/prisma";
import {
  createUasbakEnvelope,
  createTempBackupSnapshot,
  exportFullSchemaJsonBackup,
} from "@/lib/backupService";
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

    const { envelope, filename } = await createUasbakEnvelope();

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

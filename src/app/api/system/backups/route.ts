import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { withTenantRoute } from "@/lib/prisma";
import { listLocalBackups } from "@/lib/backupService";
import { authorizeApiAction, jsonError, forbiddenError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();

    const auth = await authorizeApiAction({}, req, { moduleId: "system" });
    if (!auth.ok) return auth.response;
    if (auth.actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError("⛔ استعراض النسخ الاحتياطية محصور بمدير النظام العام (SUPER_ADMIN)");
    }

    const backups = listLocalBackups();

    return NextResponse.json({
      ok: true,
      backups,
    });
  } catch (error) {
    console.error("GET /api/system/backups error:", error);
    return jsonError(`تعذر استعراض النسخ الاحتياطية: ${(error as Error).message}`, 500);
  }
});

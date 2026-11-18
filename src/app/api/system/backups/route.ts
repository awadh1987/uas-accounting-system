import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { listLocalBackups } from "@/lib/backupService";
import { extractActor, jsonError, forbiddenError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();

    const actor = extractActor({}, req);
    if (actor.userRole !== "SUPER_ADMIN") {
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
}

import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { withTenantRoute } from "@/lib/prisma";
import {
  buildContentDispositionHeader,
  listLocalBackups,
  normalizeBackupTenantSlug,
  resolveTenantBackupFilePath,
} from "@/lib/backupService";
import { getTenantBackupHealthSummary } from "@/lib/backupMonitoringService";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }

    const auth = await authorizeApiAction({}, req, { moduleId: "system" });
    if (!auth.ok) return auth.response;
    if (auth.actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError(
        "⛔ استعراض النسخ الاحتياطية محصور بمدير النظام العام (SUPER_ADMIN)"
      );
    }

    const activeTenant = getActiveTenantId();
    const tenantSlug = normalizeBackupTenantSlug(activeTenant);
    const { searchParams } = new URL(req.url);
    const downloadName = (searchParams.get("download") || "").trim();

    if (downloadName) {
      const targetPath = resolveTenantBackupFilePath(downloadName, activeTenant);
      if (!targetPath) {
        return jsonError("النسخة الاحتياطية غير موجودة أو غير مصرح بالوصول إليها", 404);
      }
      const safeName = path.basename(targetPath);
      const buffer = fs.readFileSync(targetPath);
      const contentType = safeName.endsWith(".db")
        ? "application/x-sqlite3"
        : safeName.endsWith(".dump")
          ? "application/octet-stream"
          : "application/json; charset=utf-8";
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": buildContentDispositionHeader(safeName),
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    const [backups, health] = await Promise.all([
      Promise.resolve(listLocalBackups(activeTenant)),
      getTenantBackupHealthSummary(activeTenant),
    ]);

    return NextResponse.json({
      ok: true,
      tenantSlug,
      engine: isSqliteRuntime() ? "sqlite" : "postgresql",
      backups,
      health,
    });
  } catch (error) {
    console.error("GET /api/system/backups error:", error);
    return jsonError(`تعذر استعراض النسخ الاحتياطية: ${(error as Error).message}`, 500);
  }
});

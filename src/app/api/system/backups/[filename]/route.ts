import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import {
  buildContentDispositionHeader,
  deleteTenantBackupSnapshot,
  resolveTenantBackupFilePath,
} from "@/lib/backupService";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(
  req: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const auth = await authorizeApiAction({}, req, { moduleId: "system" });
    if (!auth.ok) return auth.response;
    if (auth.actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError(
        "⛔ تحميل النسخ الاحتياطية محصور بمدير النظام العام (SUPER_ADMIN)"
      );
    }

    const { filename } = await context.params;
    const cleanName = decodeURIComponent(filename).trim();
    const targetPath = resolveTenantBackupFilePath(cleanName, getActiveTenantId());
    if (!targetPath) {
      return jsonError("النسخة الاحتياطية غير موجودة", 404);
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
  } catch (error) {
    console.error("GET /api/system/backups/[filename] error:", error);
    return jsonError("تعذر تحميل النسخة الاحتياطية", 500);
  }
});

export const DELETE = withTenantRoute(async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const auth = await authorizeApiAction(body, req, { moduleId: "system", action: "delete" });
    if (!auth.ok) return auth.response;
    if (auth.actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError(
        "⛔ حذف النسخ الاحتياطية محصور بمدير النظام العام (SUPER_ADMIN)"
      );
    }

    const { filename } = await context.params;
    const cleanName = decodeURIComponent(filename).trim();
    const result = await deleteTenantBackupSnapshot(cleanName, auth.actor, getActiveTenantId());

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to delete snapshot";
    if (msg === "BACKUP_NOT_FOUND") {
      return jsonError("النسخة الاحتياطية غير موجودة أو غير مصرح بحذفها", 404);
    }
    if (msg === "INVALID_BACKUP_FILENAME") {
      return jsonError("اسم ملف النسخة غير صالح أو غير قابل للحذف", 400);
    }
    console.error("DELETE /api/system/backups/[filename] error:", error);
    return jsonError(`تعذر حذف النسخة الاحتياطية: ${msg}`, 500);
  }
});

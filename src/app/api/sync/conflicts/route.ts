import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { listSyncConflicts, resolveSyncConflict } from "@/lib/sync/syncEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "CONFLICT_PENDING";
    const conflicts = await listSyncConflicts(status);
    return NextResponse.json({
      success: true,
      conflicts,
      pendingCount: conflicts.filter((c) => c.status === "CONFLICT_PENDING").length,
    });
  } catch (err) {
    console.error("GET /api/sync/conflicts error:", err);
    return jsonError("تعذر تحميل تعارضات المزامنة / Failed to load sync conflicts", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { action: "approve" });
    if (!auth.ok) return auth.response;

    const conflictId = String(body.conflictId || "").trim();
    const resolutionRaw = String(body.resolution || "").trim().toUpperCase();
    if (!conflictId || !["KEEP_SERVER", "APPLY_CLIENT", "DISMISS"].includes(resolutionRaw)) {
      return jsonError(
        "conflictId و resolution (KEEP_SERVER | APPLY_CLIENT | DISMISS) مطلوبان",
        400
      );
    }

    const resolved = await resolveSyncConflict({
      conflictId,
      resolution: resolutionRaw as "KEEP_SERVER" | "APPLY_CLIENT" | "DISMISS",
      resolutionNotes: typeof body.resolutionNotes === "string" ? body.resolutionNotes : undefined,
      actor: auth.actor,
    });

    return NextResponse.json({
      success: true,
      conflict: resolved,
    });
  } catch (err) {
    console.error("POST /api/sync/conflicts error:", err);
    const msg = err instanceof Error ? err.message : "Failed to resolve conflict";
    const status = msg.includes("NOT_FOUND") ? 404 : msg.includes("ALREADY_RESOLVED") ? 409 : 500;
    return jsonError(msg, status);
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { pushClientMutations, type ClientSyncMutationInput } from "@/lib/sync/syncEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { action: "create" });
    if (!auth.ok) return auth.response;

    const deviceId =
      (typeof body.deviceId === "string" ? body.deviceId : "") ||
      req.headers.get("x-uas-device-id") ||
      undefined;
    const clientCursor = Number(body.clientCursor || 0);
    const rawMutations = Array.isArray(body.mutations) ? body.mutations : [];
    const mutations = rawMutations as ClientSyncMutationInput[];

    const result = await pushClientMutations({
      deviceId,
      clientCursor,
      mutations,
      actor: auth.actor,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          code: result.code,
          error: result.error,
          clearCredentials: result.code === "DEVICE_REVOKED",
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("POST /api/sync/push error:", err);
    return jsonError(
      err instanceof Error ? err.message : "تعذر دفع عمليات المزامنة / Failed to push sync mutations",
      500
    );
  }
});

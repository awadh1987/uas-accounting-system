import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { pullChangesSince } from "@/lib/sync/syncEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const sinceCursor = Number(searchParams.get("sinceCursor") || 0);
    const limit = Number(searchParams.get("limit") || 100);
    const deviceId =
      req.headers.get("x-uas-device-id") ||
      searchParams.get("deviceId") ||
      undefined;

    const result = await pullChangesSince({ sinceCursor, limit, deviceId });
    if (result.blocked) {
      return NextResponse.json(
        {
          success: false,
          code: result.code,
          clearCredentials: result.code === "DEVICE_REVOKED",
          error: result.error,
          devicePolicy: result.devicePolicy,
        },
        { status: result.status || 403 }
      );
    }
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("GET /api/sync/pull error:", err);
    return jsonError("تعذر سحب تغييرات المزامنة / Failed to pull sync changes", 500);
  }
});

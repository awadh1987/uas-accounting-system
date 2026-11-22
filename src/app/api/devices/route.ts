import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { listTenantDevices, registerOrHeartbeatDevice } from "@/lib/devices/deviceService";
import { authorizeApiAction, forbiddenError, jsonError, resolveVerifiedActor } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const auth = await authorizeApiAction({}, req, { moduleId: "system" });
    if (!auth.ok) return auth.response;

    const data = await listTenantDevices();
    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (err) {
    console.error("GET /api/devices error:", err);
    return jsonError("تعذر تحميل سجل الأجهزة / Failed to load tenant devices", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = await resolveVerifiedActor(body, req);
    if (actor.spoofAttempt) {
      return jsonError("⛔ رفض أمني: عدم تطابق الصلاحية", 403);
    }
    if (actor.tenantMismatch) {
      return forbiddenError("⛔ رفض أمني: الرمز غير مصرح لهذه المنشأة / Cross-tenant session denied");
    }
    const deviceId =
      (typeof body.deviceId === "string" ? body.deviceId : "") ||
      req.headers.get("x-uas-device-id") ||
      "";

    if (!deviceId.trim()) {
      return jsonError("deviceId مطلوب لتسجيل الجهاز / deviceId is required", 400);
    }

    const ipAddress =
      (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "").split(",")[0]?.trim() ||
      null;

    const result = await registerOrHeartbeatDevice({
      deviceId,
      platform:
        (typeof body.platform === "string" ? body.platform : "") ||
        req.headers.get("x-uas-platform") ||
        "web",
      appVersion:
        (typeof body.appVersion === "string" ? body.appVersion : "") ||
        req.headers.get("x-uas-app-version") ||
        "1.0.0",
      osVersion:
        (typeof body.osVersion === "string" ? body.osVersion : "") ||
        req.headers.get("x-uas-os-version") ||
        "",
      deviceLabel:
        (typeof body.deviceLabel === "string" ? body.deviceLabel : "") ||
        req.headers.get("x-uas-device-name") ||
        "",
      userId: typeof body.userId === "string" ? body.userId : actor.userId,
      userEmail: typeof body.userEmail === "string" ? body.userEmail : undefined,
      userDisplay:
        (typeof body.userDisplay === "string" ? body.userDisplay : "") || actor.userDisplay,
      ipAddress,
      pendingQueueCount:
        body.pendingQueueCount !== undefined ? Number(body.pendingQueueCount) : undefined,
      lastCursor: body.lastCursor !== undefined ? Number(body.lastCursor) : undefined,
      lastSyncError:
        typeof body.lastSyncError === "string" || body.lastSyncError === null
          ? (body.lastSyncError as string | null)
          : undefined,
      syncMode:
        body.syncMode === "MANUAL" || body.syncMode === "AUTO" ? body.syncMode : undefined,
    });

    const status =
      result.device.status === "REVOKED" || result.device.status === "SUSPENDED" ? 403 : 200;
    return NextResponse.json(
      {
        success: status === 200,
        code:
          result.device.status === "REVOKED"
            ? "DEVICE_REVOKED"
            : result.device.status === "SUSPENDED"
              ? "DEVICE_LOCKED"
              : undefined,
        clearCredentials: result.device.status === "REVOKED",
        ...result,
      },
      { status }
    );
  } catch (err) {
    console.error("POST /api/devices error:", err);
    return jsonError("تعذر تسجيل أو تحديث الجهاز / Failed to register device", 500);
  }
});

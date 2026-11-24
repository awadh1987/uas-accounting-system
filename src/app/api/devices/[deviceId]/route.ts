import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import {
  removeTenantDevice,
  updateDeviceGovernance,
  type DeviceGovernanceAction,
} from "@/lib/devices/deviceService";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { canManageUsers } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS: DeviceGovernanceAction[] = [
  "APPROVE",
  "SUSPEND",
  "REVOKE",
  "TRIGGER_SYNC",
  "FORCE_RESYNC",
  "SET_SYNC_POLICY",
];

export const PATCH = withTenantRoute(async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ deviceId: string }> }
) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const { deviceId } = await context.params;
    const cleanId = decodeURIComponent(deviceId).trim();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { moduleId: "system", action: "edit" });
    if (!auth.ok) return auth.response;

    if (!canManageUsers(auth.actor.user || auth.actor.userRole)) {
      return forbiddenError("⛔ إدارة أجهزة المنشأة محصورة بمدير النظام / Device governance requires admin permission");
    }

    const actionRaw = String(body.action || "").trim().toUpperCase() as DeviceGovernanceAction;
    if (!ALLOWED_ACTIONS.includes(actionRaw)) {
      return jsonError(
        `Invalid action. Must be one of: ${ALLOWED_ACTIONS.join(", ")}`,
        400
      );
    }

    const updated = await updateDeviceGovernance({
      deviceId: cleanId,
      action: actionRaw,
      syncMode: body.syncMode === "MANUAL" || body.syncMode === "AUTO" ? body.syncMode : undefined,
      syncIntervalSec:
        body.syncIntervalSec !== undefined ? Number(body.syncIntervalSec) : undefined,
      deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      actor: auth.actor,
    });

    return NextResponse.json({
      success: true,
      device: updated,
    });
  } catch (err) {
    console.error("PATCH /api/devices/[deviceId] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update device";
    if (msg === "FORBIDDEN_CROSS_TENANT") {
      return forbiddenError(
        "⛔ رفض أمني: لا يمكن إدارة جهاز تابع لمنشأة أخرى / Cross-tenant device governance denied"
      );
    }
    return jsonError(msg, msg === "DEVICE_NOT_FOUND" ? 404 : 500);
  }
});

export const DELETE = withTenantRoute(async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ deviceId: string }> }
) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const { deviceId } = await context.params;
    const cleanId = decodeURIComponent(deviceId).trim();
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, { moduleId: "system", action: "edit" });
    if (!auth.ok) return auth.response;

    if (!canManageUsers(auth.actor.user || auth.actor.userRole)) {
      return forbiddenError("⛔ حذف سجل الأجهزة محصور بمدير النظام");
    }

    const deleted = await removeTenantDevice(cleanId, auth.actor);
    if (!deleted) {
      return jsonError("الجهاز غير موجود / Device not found", 404);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/devices/[deviceId] error:", err);
    if (err instanceof Error && err.message === "FORBIDDEN_CROSS_TENANT") {
      return forbiddenError(
        "⛔ رفض أمني: لا يمكن حذف جهاز تابع لمنشأة أخرى / Cross-tenant device deletion denied"
      );
    }
    return jsonError("تعذر حذف الجهاز / Failed to delete device", 500);
  }
});

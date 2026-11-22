import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { markNotificationRead } from "@/lib/notifications/notificationService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

async function handleMarkRead(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const cleanId = decodeURIComponent(id).trim();
    const updated = await markNotificationRead(cleanId);
    if (!updated) {
      return jsonError("الإشعار غير موجود / Notification not found", 404);
    }
    return NextResponse.json({ success: true, notification: updated });
  } catch (err) {
    console.error("POST /api/notifications/[id]/read error:", err);
    return jsonError("تعذر تحديث حالة الإشعار / Failed to mark notification read", 500);
  }
}

export const POST = withTenantRoute(handleMarkRead);
export const PATCH = withTenantRoute(handleMarkRead);

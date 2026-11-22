import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  emitNotification,
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/notifications/notificationService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import type { NotificationChannelId, NotificationEventType, NotificationSeverity } from "@/types/uas";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const channel = searchParams.get("channel") || undefined;
    const severity = searchParams.get("severity") || undefined;
    const recipientUserId = searchParams.get("userId") || undefined;
    const limit = Number(searchParams.get("limit") || 60);

    const result = await listNotifications({
      unreadOnly,
      channel,
      severity,
      recipientUserId,
      limit,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("GET /api/notifications error:", err);
    return jsonError("تعذر تحميل الإشعارات / Failed to load notifications", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {});
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    if (body.action === "mark_all_read") {
      const updatedCount = await markAllNotificationsRead(
        typeof body.userId === "string" ? body.userId : undefined
      );
      return NextResponse.json({ success: true, updatedCount });
    }

    const titleAr = String(body.titleAr || body.title || "تنبيه النظام").trim();
    const titleEn = String(body.titleEn || body.title || "System Alert").trim();
    const messageAr = String(body.messageAr || body.message || "").trim();
    const messageEn = String(body.messageEn || body.message || messageAr).trim();

    if (!messageAr) {
      return jsonError("نص الإشعار مطلوب / Notification message is required", 400);
    }

    const notification = await emitNotification({
      eventType: (String(body.eventType || "SYSTEM_ALERT").toUpperCase() as NotificationEventType),
      channel: body.channel ? (String(body.channel) as NotificationChannelId) : undefined,
      severity: body.severity ? (String(body.severity).toUpperCase() as NotificationSeverity) : undefined,
      titleAr,
      titleEn,
      messageAr,
      messageEn,
      targetTab: typeof body.targetTab === "string" ? body.targetTab : undefined,
      targetEntityType: typeof body.targetEntityType === "string" ? body.targetEntityType : undefined,
      targetEntityId: typeof body.targetEntityId === "string" ? body.targetEntityId : undefined,
      recipientUserId: typeof body.recipientUserId === "string" ? body.recipientUserId : undefined,
      actorUserId: actor.userId,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : undefined,
    });

    return NextResponse.json({ success: true, notification }, { status: 201 });
  } catch (err) {
    console.error("POST /api/notifications error:", err);
    return jsonError("تعذر إنشاء الإشعار / Failed to create notification", 500);
  }
});

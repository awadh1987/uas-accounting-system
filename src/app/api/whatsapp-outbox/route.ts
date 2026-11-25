import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { formatIsoToDmy, formatIsoToDmyTime, formatIsoToTimeHm } from "@/lib/uiFormatters";
import {
  approveAndSendWhatsAppDraft,
  createWhatsAppDraftTx,
  getTenantWhatsAppSettings,
  listWhatsAppOutboxDrafts,
  saveTenantWhatsAppSettings,
  skipWhatsAppDraft,
  type WhatsAppEventType,
} from "@/lib/whatsapp/outboxService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "sales" });
    if (!auth.ok) return auth.response;

    const scope = resolveRequestTenantScope(req);
    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();

    const [drafts, settings] = await Promise.all([
      listWhatsAppOutboxDrafts(status),
      getTenantWhatsAppSettings(scope.tenantSlug),
    ]);

    return NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      drafts: drafts.map((d) => ({
        ...d,
        createdAtDmy: formatIsoToDmy(d.createdAt),
        createdAtTime: formatIsoToTimeHm(d.createdAt),
        createdAtDisplay: formatIsoToDmyTime(d.createdAt),
        approvedAtDisplay: d.approvedAt ? formatIsoToDmyTime(d.approvedAt) : null,
        sentAtDisplay: d.sentAt ? formatIsoToDmyTime(d.sentAt) : null,
      })),
      settings,
    });
  } catch (err) {
    console.error("GET /api/whatsapp-outbox error:", err);
    return jsonError("تعذر تحميل قائمة رسائل واتساب", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "").trim().toUpperCase();
    const scope = resolveRequestTenantScope(req);

    if (action === "SAVE_SETTINGS") {
      const auth = await authorizeApiAction(body, req, {
        moduleId: "system",
        action: "edit",
      });
      if (!auth.ok) return auth.response;

      const providerRaw = String(body.provider || "").trim().toUpperCase();
      const provider =
        providerRaw === "CLOUD_API" || providerRaw === "CUSTOM_WEBHOOK"
          ? providerRaw
          : providerRaw === "WHATSAPP_WEB_LINK"
          ? "WHATSAPP_WEB_LINK"
          : undefined;

      const settings = await saveTenantWhatsAppSettings({
        tenantSlug: scope.tenantSlug,
        provider,
        gatewayUrl: body.gatewayUrl !== undefined ? String(body.gatewayUrl) : undefined,
        apiToken: body.apiToken !== undefined ? String(body.apiToken) : undefined,
        clearApiToken: Boolean(body.clearApiToken),
        senderPhone: body.senderPhone !== undefined ? String(body.senderPhone) : undefined,
        defaultCountryCode:
          body.defaultCountryCode !== undefined ? String(body.defaultCountryCode) : undefined,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
        autoDraftEvents:
          body.autoDraftEvents && typeof body.autoDraftEvents === "object"
            ? (body.autoDraftEvents as Partial<Record<WhatsAppEventType, boolean>>)
            : undefined,
        templates:
          body.templates && typeof body.templates === "object"
            ? (body.templates as Partial<Record<WhatsAppEventType, string>>)
            : undefined,
        updatedById: auth.actor.userId,
      });

      return NextResponse.json({
        success: true,
        settings,
        message: "✅ تم حفظ إعدادات واتساب الخاصة بالمنشأة بأمان",
      });
    }

    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: action === "APPROVE_SEND" ? "approve" : "edit",
    });
    if (!auth.ok) return auth.response;

    const actor = {
      userId: auth.actor.userId,
      userDisplay: auth.actor.userDisplay || "موظف المبيعات",
      userRole: auth.actor.userRole,
    };

    if (action === "APPROVE_SEND") {
      const id = String(body.id || "").trim();
      if (!id) return jsonError("معرف المسودة مطلوب", 400);

      const res = await approveAndSendWhatsAppDraft({
        id,
        editedMessageText:
          body.editedMessageText !== undefined ? String(body.editedMessageText) : undefined,
        recipientPhone: body.recipientPhone ? String(body.recipientPhone) : undefined,
        forceWebLink: Boolean(body.forceWebLink),
        tenantSlug: scope.tenantSlug,
        actor,
      });

      return NextResponse.json({
        success: true,
        messageRecord: res.message,
        whatsappUrl: res.whatsappUrl,
        message:
          res.message.status === "FAILED"
            ? "⚠️ تعذر الإرسال عبر بوابة API — يمكنك فتح رابط واتساب مباشرة"
            : "✅ تم اعتماد وتجهيز رسالة واتساب وتسجيلها في سجل التدقيق",
      });
    }

    if (action === "SKIP") {
      const id = String(body.id || "").trim();
      if (!id) return jsonError("معرف المسودة مطلوب", 400);
      const skipped = await skipWhatsAppDraft({
        id,
        reason: body.reason ? String(body.reason) : undefined,
        actor,
      });
      return NextResponse.json({
        success: true,
        messageRecord: skipped,
        message: "تم تجاهل مسودة الإرسال وتوثيق ذلك",
      });
    }

    if (action === "CREATE_DRAFT") {
      const recipientName = String(body.recipientName || "").trim();
      const recipientPhone = String(body.recipientPhone || "").trim();
      const eventType = String(body.eventType || "BALANCE_SUMMARY").trim().toUpperCase() as WhatsAppEventType;
      if (!recipientName || !recipientPhone) {
        return jsonError("اسم العميل ورقم الجوال مطلوبان", 400);
      }

      const draft = await createWhatsAppDraftTx(prisma, {
        eventType,
        clientAccountId: body.clientAccountId ? String(body.clientAccountId) : null,
        customerId: body.customerId ? String(body.customerId) : null,
        requestId: body.requestId ? String(body.requestId) : null,
        recipientName,
        recipientPhone,
        explicitMessageText: body.messageText ? String(body.messageText) : undefined,
        variables:
          body.variables && typeof body.variables === "object"
            ? (body.variables as Record<string, string | number | null | undefined>)
            : undefined,
      });

      return NextResponse.json({
        success: true,
        draft,
        message: "✅ تم إنشاء مسودة واتساب للمراجعة والاعتماد",
      });
    }

    return jsonError("إجراء غير معروف في قائمة واتساب", 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تنفيذ العملية على قائمة واتساب";
    return jsonError(msg, 400);
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import {
  clientRespondToAmendedRequest,
  lifecycleClientGoodsRequest,
  updatePendingClientRequest,
  type ClientOrStaffLifecycleAction,
} from "@/lib/clientPortal/portalService";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const PATCH = withTenantRoute(async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "CANCEL").trim().toUpperCase();

    if (action === "EDIT") {
      const rawLines = Array.isArray(body.lines)
        ? (body.lines as Array<Record<string, unknown>>)
        : [];
      const updated = await updatePendingClientRequest({
        requestId: id,
        clientAccountId: auth.account.id,
        tenantSlug: auth.scope.tenantSlug,
        portalUrl: `${resolveTenantCloudUrl(auth.scope.tenantSlug)}/portal`,
        pickupType: body.pickupType ? String(body.pickupType) : undefined,
        pickupLocation: String(body.pickupLocation || ""),
        customPickupLocation: body.customPickupLocation
          ? String(body.customPickupLocation)
          : undefined,
        pickupNotes: body.pickupNotes !== undefined ? String(body.pickupNotes || "") : undefined,
        lines: rawLines.map((l) => ({
          id: l.id ? String(l.id) : undefined,
          catalogBoardItemId: l.catalogBoardItemId ? String(l.catalogBoardItemId) : null,
          itemId: l.itemId ? String(l.itemId) : null,
          itemTitle: String(l.itemTitle || ""),
          requestedQty: Number(l.requestedQty || 0),
          unitCode: String(l.unitCode || "QAT_BUNCH"),
          unitLabel: String(l.unitLabel || "علاقية قات"),
          customUnitLabel: l.customUnitLabel ? String(l.customUnitLabel) : null,
          unitPrice: l.unitPrice !== undefined ? Number(l.unitPrice) : undefined,
          saleMode: l.saleMode ? String(l.saleMode) : undefined,
          notes: l.notes ? String(l.notes) : null,
        })),
      });

      return NextResponse.json({
        success: true,
        request: updated,
        message: "✅ تم تحديث الطلب وإدراجه بانتظار اعتماد الموظف",
      });
    }

    if (action === "APPROVE_AMENDMENTS" || action === "DECLINE_AMENDMENTS") {
      const updated = await clientRespondToAmendedRequest({
        requestId: id,
        clientAccountId: auth.account.id,
        decision: action,
        clientResponseNote:
          body.clientResponseNote !== undefined ? String(body.clientResponseNote) : undefined,
        cancelOrder: Boolean(body.cancelOrder),
        tenantSlug: auth.scope.tenantSlug,
      });

      return NextResponse.json({
        success: true,
        request: updated,
        message:
          action === "APPROVE_AMENDMENTS"
            ? "✅ تم اعتماد التعديلات وتأكيد الطلب بنجاح"
            : "↩️ تم إرسال ملاحظاتك وإعادة الطلب للمراجعة",
      });
    }

    const allowedLifecycleActions: ClientOrStaffLifecycleAction[] = [
      "CANCEL",
      "ARCHIVE",
      "UNARCHIVE",
      "HIDE",
      "UNHIDE",
      "DELETE",
    ];
    if (!allowedLifecycleActions.includes(action as ClientOrStaffLifecycleAction)) {
      return jsonError("إجراء غير معروف على الطلب", 400);
    }

    const res = await lifecycleClientGoodsRequest({
      requestId: id,
      actorScope: "CLIENT",
      clientAccountId: auth.account.id,
      action: action as ClientOrStaffLifecycleAction,
      actorName: auth.account.fullName,
      tenantSlug: auth.scope.tenantSlug,
    });

    const messages: Record<ClientOrStaffLifecycleAction, string> = {
      CANCEL: "تم إلغاء الطلب بنجاح قبل معالجة الإدارة",
      ARCHIVE: "تمت أرشفة الطلب بنجاح",
      UNARCHIVE: "تمت استعادة الطلب من الأرشيف",
      HIDE: "تم إخفاء الطلب من القائمة الظاهرة",
      UNHIDE: "تم إظهار الطلب في القائمة",
      DELETE: "تم حذف الطلب غير المرحّل بأمان",
    };

    return NextResponse.json({
      success: true,
      deleted: Boolean(res.deleted),
      deletedId: res.deletedId,
      request: res.request,
      message: messages[action as ClientOrStaffLifecycleAction],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تحديث حالة الطلب";
    if (msg.startsWith("NOT_FOUND:")) {
      return jsonError(msg.replace(/^NOT_FOUND:\s*/, ""), 404);
    }
    return jsonError(msg, 400);
  }
});

export const DELETE = withTenantRoute(async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    const { id } = await context.params;
    const res = await lifecycleClientGoodsRequest({
      requestId: id,
      actorScope: "CLIENT",
      clientAccountId: auth.account.id,
      action: "DELETE",
      actorName: auth.account.fullName,
      tenantSlug: auth.scope.tenantSlug,
    });

    return NextResponse.json({
      success: true,
      deleted: true,
      deletedId: res.deletedId,
      message: "تم حذف الطلب غير المرحّل بأمان",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر حذف الطلب";
    if (msg.startsWith("NOT_FOUND:")) {
      return jsonError(msg.replace(/^NOT_FOUND:\s*/, ""), 404);
    }
    return jsonError(msg, 400);
  }
});

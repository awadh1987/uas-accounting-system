import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import {
  clientRespondToAmendedRequest,
  serializeRequest,
  updatePendingClientRequest,
} from "@/lib/clientPortal/portalService";

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
        pickupType: body.pickupType ? String(body.pickupType) : undefined,
        pickupLocation: String(body.pickupLocation || ""),
        customPickupLocation: body.customPickupLocation
          ? String(body.customPickupLocation)
          : undefined,
        pickupNotes: body.pickupNotes !== undefined ? String(body.pickupNotes || "") : undefined,
        lines: rawLines.map((l) => ({
          itemId: l.itemId ? String(l.itemId) : null,
          itemTitle: String(l.itemTitle || ""),
          requestedQty: Number(l.requestedQty || 0),
          unitCode: String(l.unitCode || "QAT_BUNCH"),
          unitLabel: String(l.unitLabel || "علاقية قات"),
          customUnitLabel: l.customUnitLabel ? String(l.customUnitLabel) : null,
          unitPrice: l.unitPrice !== undefined ? Number(l.unitPrice) : undefined,
          notes: l.notes ? String(l.notes) : null,
        })),
      });

      return NextResponse.json({
        success: true,
        request: updated,
        message: "✅ تم تحديث الطلب بنجاح قبل المراجعة",
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

    const existing = await prisma.clientGoodsRequest.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineOrder: "asc" } } },
    });

    if (!existing || existing.clientAccountId !== auth.account.id) {
      return jsonError("الطلب غير موجود أو غير مصرح بالوصول إليه", 404);
    }

    if (
      existing.status !== "PENDING_REVIEW" ||
      existing.reserveStock ||
      existing.linkedSalesRecordId ||
      existing.linkedSaleId ||
      existing.linkedDraftId
    ) {
      return jsonError(
        "يمكن إلغاء الطلب فقط عندما يكون بحالة (قيد المراجعة) وقبل الاعتماد أو حجز المخزون",
        400
      );
    }

    const updated = await prisma.clientGoodsRequest.update({
      where: { id: existing.id },
      data: { status: "CANCELLED" },
      include: { lines: { orderBy: { lineOrder: "asc" } } },
    });

    return NextResponse.json({
      success: true,
      request: serializeRequest(updated),
      message: "تم إلغاء الطلب بنجاح",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تحديث حالة الطلب";
    if (msg.startsWith("NOT_FOUND:")) {
      return jsonError(msg.replace(/^NOT_FOUND:\s*/, ""), 404);
    }
    return jsonError(msg, 400);
  }
});

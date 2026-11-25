import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import {
  serializeRequest,
  staffProcessGoodsRequest,
} from "@/lib/clientPortal/portalService";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "sales" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();
    const pickup = (searchParams.get("pickup") || "").trim();

    const [rows, projects, treasuries] = await Promise.all([
      prisma.clientGoodsRequest.findMany({
        where: status && status !== "ALL" ? { status } : undefined,
        include: {
          clientAccount: {
            select: {
              id: true,
              fullName: true,
              tradeName: true,
              phone: true,
              email: true,
              clientType: true,
              customerId: true,
            },
          },
          lines: { orderBy: { lineOrder: "asc" } },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 250,
      }),
      prisma.project.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameAr: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.treasuryAccount.findMany({
        where: { isActive: true },
        select: { id: true, code: true, nameAr: true, currency: true },
        orderBy: { code: "asc" },
      }),
    ]);

    const filtered = rows
      .map(serializeRequest)
      .filter((r) => (!pickup ? true : r.pickupLocation.includes(pickup)));

    return NextResponse.json({
      success: true,
      requests: filtered,
      projects,
      treasuries,
    });
  } catch (err) {
    console.error("GET /api/portal-admin/requests error:", err);
    return jsonError("تعذر تحميل طلبات العملاء الواردة", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const actionRaw = String(body.action || "").trim().toUpperCase();
    const action =
      actionRaw === "CONFIRM" ||
      actionRaw === "MARK_READY" ||
      actionRaw === "HANDOVER" ||
      actionRaw === "AMEND" ||
      actionRaw === "RETURN_TO_CLIENT" ||
      actionRaw === "REJECT" ||
      actionRaw === "CANCEL"
        ? actionRaw
        : null;

    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: action === "HANDOVER" ? "create" : "edit",
    });
    if (!auth.ok) return auth.response;

    const requestId = String(body.requestId || "").trim();
    if (!requestId || !action) {
      return jsonError("requestId و action مطلوبان", 400);
    }

    const lines = Array.isArray(body.lines)
      ? (body.lines as Array<Record<string, unknown>>).map((l) => ({
          id: l.id ? String(l.id) : undefined,
          itemId: l.itemId !== undefined ? (l.itemId ? String(l.itemId) : null) : undefined,
          itemTitle: l.itemTitle !== undefined ? String(l.itemTitle) : undefined,
          confirmedQty: l.confirmedQty !== undefined ? Number(l.confirmedQty) : undefined,
          unitCode: l.unitCode !== undefined ? String(l.unitCode) : undefined,
          unitLabel: l.unitLabel !== undefined ? String(l.unitLabel) : undefined,
          customUnitLabel:
            l.customUnitLabel !== undefined
              ? l.customUnitLabel
                ? String(l.customUnitLabel)
                : null
              : undefined,
          unitPrice: l.unitPrice !== undefined ? Number(l.unitPrice) : undefined,
          notes: l.notes !== undefined ? (l.notes ? String(l.notes) : null) : undefined,
          remove: Boolean(l.remove),
        }))
      : undefined;

    const scope = resolveRequestTenantScope(req);
    const portalOrigin = resolveTenantCloudUrl(scope.tenantSlug);
    const result = await staffProcessGoodsRequest({
      requestId,
      action,
      tenantSlug: scope.tenantSlug,
      portalUrl: `${portalOrigin}/portal`,
      projectId: body.projectId ? String(body.projectId) : undefined,
      subProjectId: body.subProjectId ? String(body.subProjectId) : null,
      harvestName: body.harvestName ? String(body.harvestName) : undefined,
      treasuryId: body.treasuryId ? String(body.treasuryId) : null,
      immediatePaidAmount:
        body.immediatePaidAmount !== undefined ? Number(body.immediatePaidAmount) : undefined,
      reserveStock: body.reserveStock !== undefined ? Boolean(body.reserveStock) : undefined,
      overrideCreditLimit:
        Boolean(body.overrideCreditLimit) &&
        (auth.actor.userRole === "SUPER_ADMIN" || auth.actor.userRole === "CHIEF_ACCOUNTANT"),
      staffNotes: body.staffNotes !== undefined ? String(body.staffNotes) : undefined,
      reviewerRemarks:
        body.reviewerRemarks !== undefined ? String(body.reviewerRemarks) : undefined,
      pickupType: body.pickupType ? String(body.pickupType) : undefined,
      pickupLocation:
        body.pickupLocation !== undefined ? String(body.pickupLocation) : undefined,
      customPickupLocation:
        body.customPickupLocation !== undefined ? String(body.customPickupLocation) : undefined,
      pickupNotes:
        body.pickupNotes !== undefined ? (body.pickupNotes ? String(body.pickupNotes) : null) : undefined,
      lines,
      actor: {
        userId: auth.actor.userId,
        userDisplay: auth.actor.userDisplay || "موظف المبيعات",
        userRole: auth.actor.userRole,
      },
    });

    const replay = Boolean((result as { idempotentReplay?: boolean }).idempotentReplay);
    return NextResponse.json({
      success: true,
      idempotentReplay: replay,
      request: result,
      message:
        action === "HANDOVER"
          ? "✅ تم تسليم الطلب وترحيل الفاتورة والقيد المحاسبي وإعداد مسودة واتساب"
          : action === "RETURN_TO_CLIENT"
          ? "✅ تم حفظ التعديلات وإعادة الطلب للعميل للموافقة وإدراج مسودة واتساب"
          : action === "AMEND"
          ? "✅ تم حفظ تعديلات المراجع وتحديث الفروقات"
          : replay
          ? "ℹ️ هذا الطلب معتمد ومرتبط مسبقاً بسجل المبيعات (تم الحفاظ على عدم التكرار)"
          : "✅ تم اعتماد الطلب وفتح دورة البيع في المبيعات والعملاء بنجاح",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر معالجة طلب العميل";
    return jsonError(msg, 400);
  }
});

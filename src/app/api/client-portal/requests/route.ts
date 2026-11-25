import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { isSectorAllowed, portalErrorStatus, stripPolicyPrefix } from "@/lib/clientPortal/portalPolicy";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import {
  bulkHideClientGoodsRequests,
  createClientGoodsRequest,
  resolveClientSectorAccess,
  serializeRequest,
} from "@/lib/clientPortal/portalService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    if (auth.account.status !== "ACTIVE") {
      return jsonError("حسابك قيد المراجعة والاعتماد حالياً", 403);
    }

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();
    const sectorType = (searchParams.get("sectorType") || "ALL").trim().toUpperCase();
    const sectorAccess = await resolveClientSectorAccess(auth.account);
    if (sectorType !== "ALL" && !isSectorAllowed(sectorAccess.sectorMode, sectorType)) {
      return jsonError("⛔ هذا القطاع غير متاح لحسابك", 403);
    }
    const includeHidden = searchParams.get("includeHidden") === "1";
    const includeArchived = searchParams.get("includeArchived") !== "0";
    const fromDate = (searchParams.get("fromDate") || "").trim();
    const toDate = (searchParams.get("toDate") || "").trim();
    const q = (searchParams.get("q") || searchParams.get("search") || "").trim();
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("pageSize") || searchParams.get("limit") || "50", 10) || 50));

    const whereClause: Record<string, unknown> = {
      clientAccountId: auth.account.id,
      ...(status && status !== "ALL" ? { status } : {}),
      ...(!includeHidden ? { isHiddenByClient: false } : {}),
      ...(!includeArchived ? { isArchivedByClient: false } : {}),
      ...(sectorType && sectorType !== "ALL"
        ? { sectorType }
        : { sectorType: { in: sectorAccess.allowedSectors } }),
      ...(fromDate || toDate
        ? {
          createdAt: {
            ...(fromDate ? { gte: new Date(`${fromDate}T00:00:00.000Z`) } : {}),
            ...(toDate ? { lte: new Date(`${toDate}T23:59:59.999Z`) } : {}),
          },
        }
        : {}),
      ...(q
        ? {
          OR: [
            { requestNumber: { contains: q } },
            { pickupLocation: { contains: q } },
            { lines: { some: { itemTitle: { contains: q } } } },
          ],
        }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.clientGoodsRequest.count({ where: whereClause }),
      prisma.clientGoodsRequest.findMany({
        where: whereClause,
        include: { lines: { orderBy: { lineOrder: "asc" } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const filtered = rows.map(serializeRequest);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      tenantSlug: auth.scope.tenantSlug,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
      requests: filtered,
    });
  } catch (err) {
    console.error("GET /api/client-portal/requests error:", err);
    return jsonError("تعذر تحميل سجل الطلبات", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];

    const request = await createClientGoodsRequest({
      clientAccountId: auth.account.id,
      sectorType: body.sectorType ? String(body.sectorType) : undefined,
      submissionType: body.submissionType ? String(body.submissionType) : undefined,
      pickupType: body.pickupType ? String(body.pickupType) : undefined,
      pickupLocation: String(body.pickupLocation || ""),
      customPickupLocation: body.customPickupLocation ? String(body.customPickupLocation) : undefined,
      pickupNotes: body.pickupNotes ? String(body.pickupNotes) : undefined,
      customData:
        body.customData && typeof body.customData === "object"
          ? (body.customData as Record<string, unknown>)
          : undefined,
      lines: rawLines.map((l) => ({
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

    return NextResponse.json(
      {
        success: true,
        receiptTitle: "تم استلام طلبك",
        request,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر إرسال الطلب";
    return jsonError(stripPolicyPrefix(msg), portalErrorStatus(err));
  }
});

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "BULK_HIDE").trim().toUpperCase();
    if (action !== "BULK_HIDE" && action !== "HIDE_COMPLETED") {
      return jsonError("إجراء غير معروف", 400);
    }

    const requestIds = Array.isArray(body.requestIds)
      ? body.requestIds.map((id) => String(id)).filter(Boolean)
      : undefined;

    const result = await bulkHideClientGoodsRequests({
      actorScope: "CLIENT",
      clientAccountId: auth.account.id,
      requestIds,
      includeArchived: Boolean(body.includeArchived ?? true),
    });

    return NextResponse.json({
      success: true,
      updatedCount: result.updatedCount,
      ids: result.ids,
      message:
        result.updatedCount > 0
          ? `✅ تم إخفاء ${result.updatedCount} طلب من السجل الظاهر (دون حذف القيود المحاسبية)`
          : "لا توجد طلبات مكتملة أو ملغاة أو مؤرشفة لإخفائها",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تنفيذ الإخفاء الجماعي";
    return jsonError(msg, 400);
  }
});

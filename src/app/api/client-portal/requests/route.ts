import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import {
  createClientGoodsRequest,
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
    const fromDate = (searchParams.get("fromDate") || "").trim();
    const toDate = (searchParams.get("toDate") || "").trim();
    const q = (searchParams.get("q") || "").trim().toLowerCase();

    const rows = await prisma.clientGoodsRequest.findMany({
      where: {
        clientAccountId: auth.account.id,
        ...(status && status !== "ALL" ? { status } : {}),
      },
      include: { lines: { orderBy: { lineOrder: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 150,
    });

    const filtered = rows
      .map(serializeRequest)
      .filter((r) => {
        const d = r.createdAt.slice(0, 10);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        if (q) {
          const hit =
            r.requestNumber.toLowerCase().includes(q) ||
            r.pickupLocation.toLowerCase().includes(q) ||
            r.lines.some((l) => l.itemTitle.toLowerCase().includes(q));
          if (!hit) return false;
        }
        return true;
      });

    return NextResponse.json({
      success: true,
      tenantSlug: auth.scope.tenantSlug,
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
      pickupType: body.pickupType ? String(body.pickupType) : undefined,
      pickupLocation: String(body.pickupLocation || ""),
      customPickupLocation: body.customPickupLocation ? String(body.customPickupLocation) : undefined,
      pickupNotes: body.pickupNotes ? String(body.pickupNotes) : undefined,
      customData:
        body.customData && typeof body.customData === "object"
          ? (body.customData as Record<string, unknown>)
          : undefined,
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
    return jsonError(msg, 400);
  }
});

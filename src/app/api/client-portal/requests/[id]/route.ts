import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import { serializeRequest } from "@/lib/clientPortal/portalService";

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
    const existing = await prisma.clientGoodsRequest.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineOrder: "asc" } } },
    });

    if (!existing || existing.clientAccountId !== auth.account.id) {
      return jsonError("الطلب غير موجود أو غير مصرح بالوصول إليه", 404);
    }

    if (existing.status !== "PENDING_REVIEW") {
      return jsonError("يمكن إلغاء الطلب فقط عندما يكون بحالة (قيد المراجعة)", 400);
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
  } catch (err) {
    console.error("PATCH /api/client-portal/requests/[id] error:", err);
    return jsonError("تعذر تحديث حالة الطلب", 500);
  }
});

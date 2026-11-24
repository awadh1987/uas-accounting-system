import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import {
  getClientPortalFinancialSnapshot,
  sanitizeClientAccount,
  updateClientPortalProfile,
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

    let creditLimit = 0;
    if (auth.account.customerId) {
      const cust = await prisma.customer.findUnique({
        where: { id: auth.account.customerId },
        select: { creditLimit: true },
      });
      creditLimit = Number(cust?.creditLimit || 0);
    }

    const account = sanitizeClientAccount(auth.account, creditLimit);
    const snapshot =
      auth.account.status === "ACTIVE"
        ? await getClientPortalFinancialSnapshot({ customerId: auth.account.customerId })
        : {
            summary: {
              creditLimit: 0,
              totalInvoiced: 0,
              totalPaid: 0,
              totalUnpaid: 0,
              creditAvailable: null,
              currency: "YER",
            },
            bills: [],
            statementRows: [],
          };

    return NextResponse.json({
      success: true,
      tenantSlug: auth.scope.tenantSlug,
      account,
      summary: snapshot.summary,
    });
  } catch (err) {
    console.error("GET /api/client-portal/me error:", err);
    return jsonError("تعذر تحميل ملف العميل", 500);
  }
});

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const updated = await updateClientPortalProfile(auth.account.id, {
      fullName: body.fullName ? String(body.fullName) : undefined,
      tradeName: body.tradeName !== undefined ? String(body.tradeName || "") : undefined,
      email: body.email ? String(body.email) : undefined,
      preferredPickup:
        body.preferredPickup !== undefined ? String(body.preferredPickup || "") : undefined,
      customFields:
        body.customFields && typeof body.customFields === "object"
          ? (body.customFields as Record<string, unknown>)
          : undefined,
      notes: body.notes !== undefined ? String(body.notes || "") : undefined,
      newPassword: body.newPassword ? String(body.newPassword) : undefined,
      currentPassword: body.currentPassword ? String(body.currentPassword) : undefined,
    });

    return NextResponse.json({
      success: true,
      account: updated,
      message: "✅ تم تحديث الملف الشخصي بنجاح",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تحديث الملف الشخصي";
    return jsonError(msg, 400);
  }
});

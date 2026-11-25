import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import {
  attachClientSessionCookie,
  issueClientPortalToken,
  resolveAuthenticatedClient,
} from "@/lib/clientPortal/clientAuth";
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
              creditUtilizationPct: 0,
              openBillsCount: 0,
              paidBillsCount: 0,
              currency: "YER",
            },
            bills: [],
            receipts: [],
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
      avatarColor: body.avatarColor ? String(body.avatarColor) : undefined,
      customFields:
        body.customFields && typeof body.customFields === "object"
          ? (body.customFields as Record<string, unknown>)
          : undefined,
      notes: body.notes !== undefined ? String(body.notes || "") : undefined,
      newPassword: body.newPassword ? String(body.newPassword) : undefined,
      currentPassword: body.currentPassword ? String(body.currentPassword) : undefined,
    });

    if (updated.passwordChanged) {
      const freshToken = issueClientPortalToken({
        clientAccountId: updated.account.id,
        customerId: updated.account.customerId,
        tenantId: auth.scope.tenantId,
        tenantSlug: auth.scope.tenantSlug,
        phone: updated.account.phone,
        displayName: updated.account.fullName,
        sessionVersion: updated.sessionVersion,
      });
      const res = NextResponse.json({
        success: true,
        account: updated.account,
        token: freshToken,
        message: "✅ تم تحديث كلمة المرور والملف الشخصي بنجاح",
      });
      return attachClientSessionCookie(res, freshToken, req);
    }

    return NextResponse.json({
      success: true,
      account: updated.account,
      message: "✅ تم تحديث الملف الشخصي بنجاح",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تحديث الملف الشخصي";
    return jsonError(msg, 400);
  }
});

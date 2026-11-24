import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import { getClientPortalFinancialSnapshot } from "@/lib/clientPortal/portalService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/client-portal/statement
 * Strictly resolves only the authenticated client's own bills & account statement
 * within the resolved tenant workspace. Zero cross-client or cost leakage.
 */
export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    if (auth.account.status !== "ACTIVE") {
      return jsonError("حسابك قيد المراجعة — لا يمكن عرض الفواتير وكشف الحساب قبل التفعيل", 403);
    }

    const { searchParams } = new URL(req.url);
    const fromDate = (searchParams.get("fromDate") || "").trim() || undefined;
    const toDate = (searchParams.get("toDate") || "").trim() || undefined;

    const snapshot = await getClientPortalFinancialSnapshot({
      customerId: auth.account.customerId,
      fromDate,
      toDate,
    });

    return NextResponse.json({
      success: true,
      tenantSlug: auth.scope.tenantSlug,
      clientName: auth.account.tradeName || auth.account.fullName,
      phone: auth.account.phone,
      ...snapshot,
    });
  } catch (err) {
    console.error("GET /api/client-portal/statement error:", err);
    return jsonError("تعذر تحميل كشف الحساب والفواتير", 500);
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import {
  getClientPortalFinancialSnapshot,
  getClientPortalNotifications,
} from "@/lib/clientPortal/portalService";

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
    const search = (searchParams.get("search") || searchParams.get("q") || "").trim().toLowerCase();
    const page = searchParams.get("page") ? Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1) : null;
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("pageSize") || "50", 10) || 50));

    const [snapshot, notifications] = await Promise.all([
      getClientPortalFinancialSnapshot({
        customerId: auth.account.customerId,
        fromDate,
        toDate,
      }),
      getClientPortalNotifications(auth.account.id),
    ]);

    const filteredBills = search
      ? snapshot.bills.filter(
        (b) =>
          b.invoiceNumber.toLowerCase().includes(search) ||
          b.notes.toLowerCase().includes(search)
      )
      : snapshot.bills;
    const filteredRows = search
      ? snapshot.statementRows.filter(
        (r) =>
          r.reference.toLowerCase().includes(search) ||
          r.description.toLowerCase().includes(search) ||
          r.typeAr.toLowerCase().includes(search)
      )
      : snapshot.statementRows;

    const pagedBills = page ? filteredBills.slice((page - 1) * pageSize, page * pageSize) : filteredBills;
    const pagedRows = page ? filteredRows.slice((page - 1) * pageSize, page * pageSize) : filteredRows;

    return NextResponse.json({
      success: true,
      tenantSlug: auth.scope.tenantSlug,
      clientName: auth.account.tradeName || auth.account.fullName,
      phone: auth.account.phone,
      summary: snapshot.summary,
      bills: pagedBills,
      receipts: snapshot.receipts,
      statementRows: pagedRows,
      pagination: {
        page: page || 1,
        pageSize,
        totalBills: filteredBills.length,
        totalStatementRows: filteredRows.length,
        totalPagesBills: Math.max(1, Math.ceil(filteredBills.length / pageSize)),
        totalPagesRows: Math.max(1, Math.ceil(filteredRows.length / pageSize)),
      },
      notifications,
    });
  } catch (err) {
    console.error("GET /api/client-portal/statement error:", err);
    return jsonError("تعذر تحميل كشف الحساب والفواتير", 500);
  }
});

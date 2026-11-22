import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { generateFinancialReports } from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const projectId = searchParams.get("projectId") || undefined;
    const subProjectId = searchParams.get("subProjectId") || undefined;
    const costCenterId = searchParams.get("costCenterId") || undefined;
    const compareToDate = searchParams.get("compareToDate") || undefined;

    const [reports, comparativeReports] = await Promise.all([
      generateFinancialReports({ fromDate, toDate, projectId, costCenterId, subProjectId }),
      compareToDate
        ? generateFinancialReports({
            toDate: compareToDate,
            projectId,
            costCenterId,
            subProjectId,
          })
        : Promise.resolve(null),
    ]);
    return NextResponse.json({
      filters: reports.filters,
      ...reports.balanceSheet,
      ...(comparativeReports ? { comparative: comparativeReports.balanceSheet } : {}),
    });
  } catch (error) {
    console.error("GET /api/accounting/reports/balance-sheet error:", error);
    return jsonError("تعذر توليد الميزانية العمومية", 500);
  }
});


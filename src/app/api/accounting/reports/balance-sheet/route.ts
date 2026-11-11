import { NextRequest, NextResponse } from "next/server";
import { generateFinancialReports } from "@/lib/accounting/ledgerService";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const projectId = searchParams.get("projectId") || undefined;

    const reports = await generateFinancialReports({ fromDate, toDate, projectId });
    return NextResponse.json({
      filters: reports.filters,
      ...reports.balanceSheet,
    });
  } catch (error) {
    console.error("GET /api/accounting/reports/balance-sheet error:", error);
    return jsonError("تعذر توليد الميزانية العمومية", 500);
  }
}


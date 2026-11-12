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
    const subProjectId = searchParams.get("subProjectId") || undefined;
    const levelParam = Number(searchParams.get("level") || 6);
    const maxLevel = Number.isFinite(levelParam) ? Math.min(6, Math.max(1, levelParam)) : 6;

    const reports = await generateFinancialReports({ fromDate, toDate, projectId, subProjectId, maxLevel });
    return NextResponse.json({
      filters: reports.filters,
      ...reports.trialBalance,
    });
  } catch (error) {
    console.error("GET /api/accounting/reports/trial-balance error:", error);
    return jsonError("تعذر توليد ميزان المراجعة", 500);
  }
}


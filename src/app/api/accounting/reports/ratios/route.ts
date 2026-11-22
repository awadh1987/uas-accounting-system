import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { generateFinancialRatios } from "@/lib/accounting/statutoryReportsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const projectId = searchParams.get("projectId") || undefined;
    const compareFromDate = searchParams.get("compareFromDate") || undefined;
    const compareToDate = searchParams.get("compareToDate") || undefined;

    const [ratios, comparative] = await Promise.all([
      generateFinancialRatios({ fromDate, toDate, projectId }),
      compareFromDate || compareToDate
        ? generateFinancialRatios({
            fromDate: compareFromDate,
            toDate: compareToDate,
            projectId,
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ ...ratios, comparative });
  } catch (error) {
    console.error("GET /api/accounting/reports/ratios error:", error);
    return jsonError("تعذر احتساب النسب المالية", 500);
  }
});

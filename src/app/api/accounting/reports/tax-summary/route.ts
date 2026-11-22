import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { generateTaxSummaryReport } from "@/lib/accounting/taxEngine";

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

    const [summary, comparative] = await Promise.all([
      generateTaxSummaryReport({ fromDate, toDate, projectId }),
      compareFromDate || compareToDate
        ? generateTaxSummaryReport({
            fromDate: compareFromDate,
            toDate: compareToDate,
            projectId,
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ ...summary, comparative });
  } catch (error) {
    console.error("GET /api/accounting/reports/tax-summary error:", error);
    return jsonError("تعذر توليد ملخص الإقرار الضريبي", 500);
  }
});

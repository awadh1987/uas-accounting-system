import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { generateCashFlowStatement } from "@/lib/accounting/statutoryReportsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const projectId = searchParams.get("projectId") || undefined;
    const costCenterId = searchParams.get("costCenterId") || undefined;
    const compareFromDate = searchParams.get("compareFromDate") || undefined;
    const compareToDate = searchParams.get("compareToDate") || undefined;

    const [statement, comparative] = await Promise.all([
      generateCashFlowStatement({ fromDate, toDate, projectId, costCenterId }),
      compareFromDate || compareToDate
        ? generateCashFlowStatement({
            fromDate: compareFromDate,
            toDate: compareToDate,
            projectId,
            costCenterId,
          })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ ...statement, comparative });
  } catch (error) {
    console.error("GET /api/accounting/reports/cash-flow error:", error);
    return jsonError("تعذر توليد قائمة التدفقات النقدية", 500);
  }
});

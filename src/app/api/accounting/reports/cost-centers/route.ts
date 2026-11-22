import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { costCenterProfitAndLoss } from "@/lib/accountingCoreEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const report = await costCenterProfitAndLoss({
      costCenterId: searchParams.get("costCenterId") || undefined,
      fromDate: searchParams.get("fromDate") || undefined,
      toDate: searchParams.get("toDate") || undefined,
    });
    return NextResponse.json(report);
  } catch (error) {
    console.error("GET /api/accounting/reports/cost-centers error:", error);
    return jsonError("Failed to build cost center report / تعذر توليد تقرير مراكز التكلفة", 500);
  }
});

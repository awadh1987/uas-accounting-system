import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { getAccountDrilldownLines } from "@/lib/accounting/statutoryReportsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId") || undefined;
    const accountCode = searchParams.get("accountCode") || undefined;
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const projectId = searchParams.get("projectId") || undefined;
    const subProjectId = searchParams.get("subProjectId") || undefined;
    const costCenterId = searchParams.get("costCenterId") || undefined;

    if (!accountId && !accountCode) {
      return jsonError("يرجى تحديد رمز أو معرف الحساب", 400);
    }

    const lines = await getAccountDrilldownLines({
      accountId,
      accountCode,
      fromDate,
      toDate,
      projectId,
      subProjectId,
      costCenterId,
    });
    return NextResponse.json({ lines });
  } catch (error) {
    console.error("GET /api/accounting/reports/drilldown error:", error);
    return jsonError("تعذر تحميل تفاصيل حركات الحساب", 500);
  }
});

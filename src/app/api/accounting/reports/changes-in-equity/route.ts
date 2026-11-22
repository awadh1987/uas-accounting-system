import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { generateStatementOfChangesInEquity } from "@/lib/accounting/statutoryReportsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;
    const projectId = searchParams.get("projectId") || undefined;
    const result = await generateStatementOfChangesInEquity({ fromDate, toDate, projectId });
    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/accounting/reports/changes-in-equity error:", error);
    return jsonError("تعذر توليد قائمة التغيرات في حقوق الملكية", 500);
  }
});

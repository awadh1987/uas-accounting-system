import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { generateAgingReport } from "@/lib/accounting/statutoryReportsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type")?.toUpperCase() === "AP" ? "AP" : "AR";
    const asOfDate = searchParams.get("asOfDate") || searchParams.get("toDate") || undefined;
    const projectId = searchParams.get("projectId") || undefined;
    const report = await generateAgingReport({ type, asOfDate, projectId });
    return NextResponse.json(report);
  } catch (error) {
    console.error("GET /api/accounting/reports/aging error:", error);
    return jsonError("تعذر توليد تقرير أعمار الديون", 500);
  }
});

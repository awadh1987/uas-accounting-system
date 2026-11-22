import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { createFiscalYear, listFiscalYears } from "@/lib/fiscalYearClosingEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    const fiscalYears = await listFiscalYears();
    return NextResponse.json({ fiscalYears });
  } catch (error) {
    console.error("GET /api/accounting/fiscal-years error:", error);
    return jsonError("تعذر تحميل السنوات المالية / Failed to load fiscal years", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { moduleId: "coa", action: "post" });
    if (!auth.ok) return auth.response;

    const fiscalYear = await createFiscalYear({
      code: String(body.code || ""),
      nameAr: String(body.nameAr || ""),
      nameEn: body.nameEn ? String(body.nameEn) : undefined,
      startDate: String(body.startDate || ""),
      endDate: String(body.endDate || ""),
    });
    return NextResponse.json({ success: true, fiscalYear }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إنشاء السنة المالية";
    const bad = /^(FISCAL_YEAR|INVALID_FISCAL|DUPLICATE_FISCAL)/.test(msg);
    return jsonError(msg, bad ? 400 : 500);
  }
});

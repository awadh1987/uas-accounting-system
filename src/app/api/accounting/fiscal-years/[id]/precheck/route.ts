import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { jsonError } from "@/lib/apiHelpers";
import { runFiscalYearPrecheck } from "@/lib/fiscalYearClosingEngine";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSqliteDatabaseReady();
    const { id } = await context.params;
    if (!id) return jsonError("معرف السنة المالية مطلوب", 400);
    const precheck = await runFiscalYearPrecheck(id);
    return NextResponse.json({ success: true, precheck });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر فحص جاهزية الإقفال";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

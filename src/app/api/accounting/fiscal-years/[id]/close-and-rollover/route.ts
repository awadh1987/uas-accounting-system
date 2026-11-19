import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { executeFiscalYearCloseAndRollover } from "@/lib/fiscalYearClosingEngine";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSqliteDatabaseReady();
    const { id } = await context.params;
    if (!id) return jsonError("معرف السنة المالية مطلوب", 400);

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const auth = await authorizeApiAction(body, req, { moduleId: "coa", action: "post" });
    if (!auth.ok) return auth.response;

    const result = await executeFiscalYearCloseAndRollover(id, {
      userId: auth.actor.userId ?? undefined,
      userName: auth.actor.userDisplay,
    });
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إقفال السنة المالية وترحيل الأرصدة";
    const status = msg.includes("NOT_FOUND") ? 404 : msg.includes("PRECHECK_FAILED") || msg.includes("ALREADY_CLOSED") ? 400 : 500;
    return jsonError(msg, status);
  }
}

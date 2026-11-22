import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import {
  listApprovalRequests,
  submitApprovalRequest,
  type ApprovalActionType,
} from "@/lib/approvalEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "audit" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const moduleFilter = searchParams.get("module") || undefined;
    const requests = await listApprovalRequests({ status, module: moduleFilter });
    const pendingCount = requests.filter((r) => r.status === "PENDING").length;
    return NextResponse.json({ requests, pendingCount });
  } catch (error) {
    console.error("GET /api/approvals error:", error);
    return jsonError("تعذر تحميل طلبات الاعتماد", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "ledger",
      action: "create",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const request = await submitApprovalRequest({
      module: String(body.module || "ACCOUNTING"),
      actionType: String(body.actionType || "GL_POSTING").toUpperCase() as ApprovalActionType,
      targetType: String(body.targetType || "JournalEntry"),
      targetId: String(body.targetId || ""),
      documentNumber: String(body.documentNumber || "DOC"),
      summaryAr: String(body.summaryAr || "طلب اعتماد"),
      summaryEn: body.summaryEn ? String(body.summaryEn) : undefined,
      amountBase: Number(body.amountBase) || 0,
      currencyCode: body.currencyCode ? String(body.currencyCode) : "YER",
      beforeSnapshot:
        body.beforeSnapshot && typeof body.beforeSnapshot === "object"
          ? (body.beforeSnapshot as Record<string, unknown>)
          : null,
      afterSnapshot:
        body.afterSnapshot && typeof body.afterSnapshot === "object"
          ? (body.afterSnapshot as Record<string, unknown>)
          : {},
      reasonAr: body.reasonAr ? String(body.reasonAr) : null,
      actor: {
        userId: actor.userId!,
        userName: actor.userDisplay,
        userRole: actor.userRole,
      },
    });
    return NextResponse.json({ success: true, request }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إرسال طلب الاعتماد";
    return jsonError(msg, 400);
  }
});

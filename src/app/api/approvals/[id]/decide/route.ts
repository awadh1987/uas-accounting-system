import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { decideApprovalRequest, type ApprovalDecision } from "@/lib/approvalEngine";
import { withIdempotency } from "@/lib/idempotencyGuard";
import { hasGranularPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const { id } = await context.params;
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "ledger",
        action: "approve",
      });
      if (!auth.ok) return auth.response;
      const actor = auth.actor;

      const decision = String(body.decision || "").toUpperCase() as ApprovalDecision;
      if (!["APPROVED", "REJECTED", "RETURNED_FOR_EDIT"].includes(decision)) {
        return jsonError("قرار الاعتماد غير صالح (APPROVED | REJECTED | RETURNED_FOR_EDIT)", 400);
      }

      if (!hasGranularPermission(actor.user || actor.userRole, "approvals.decide")) {
        return forbiddenError("غير مصرح: ليس لديك صلاحية اتخاذ قرارات الاعتماد المالي");
      }

      const result = await decideApprovalRequest({
        requestId: id,
        decision,
        reviewNotes: body.reviewNotes ? String(body.reviewNotes) : null,
        reviewer: {
          userId: actor.userId!,
          userName: actor.userDisplay,
          userRole: actor.userRole,
        },
      });
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "تعذر تنفيذ قرار الاعتماد";
      const status = msg.includes("NOT_FOUND")
        ? 404
        : msg.includes("FORBIDDEN") || msg.includes("ROLE_REQUIRED")
        ? 403
        : 400;
      return jsonError(msg, status);
    }
  });
});

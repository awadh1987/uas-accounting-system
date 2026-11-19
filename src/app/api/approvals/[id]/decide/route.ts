import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";
import { decideApprovalRequest, type ApprovalDecision } from "@/lib/approvalEngine";
import { withIdempotency } from "@/lib/idempotencyGuard";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const { id } = await context.params;
      const body = (await r.json()) as Record<string, unknown>;
      const actor = extractActor(body, r);
      const decision = String(body.decision || "").toUpperCase() as ApprovalDecision;
      if (!["APPROVED", "REJECTED", "RETURNED_FOR_EDIT"].includes(decision)) {
        return jsonError("قرار الاعتماد غير صالح (APPROVED | REJECTED | RETURNED_FOR_EDIT)", 400);
      }

      const { hasGranularPermission } = await import("@/lib/permissions");
      if (!hasGranularPermission(actor.userRole, "approvals.decide")) {
        return jsonError("غير مصرح: ليس لديك صلاحية اتخاذ قرارات الاعتماد المالي", 403);
      }

      const result = await decideApprovalRequest({
        requestId: id,
        decision,
        reviewNotes: body.reviewNotes ? String(body.reviewNotes) : null,
        reviewer: {
          userId: actor.userId || "u1",
          userName: actor.userDisplay || "المدير المالي",
          userRole: actor.userRole || "SUPER_ADMIN",
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
}

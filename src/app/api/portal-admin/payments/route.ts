import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import {
  listClientPaymentReceipts,
  reviewClientPaymentReceipt,
} from "@/lib/clientPortal/paymentGateService";
import { canApprove, canEdit, canManageTreasury } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const scope = resolveRequestTenantScope(req);
    await ensurePortalSchemaReady(scope.tenantSlug);
    const auth = await authorizeApiAction({}, req, { moduleId: "sales" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();
    const search = (searchParams.get("search") || searchParams.get("q") || "").trim();
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("pageSize") || "50", 10) || 50));

    const result = await listClientPaymentReceipts({
      tenantSlug: scope.tenantSlug,
      status,
      search,
      page,
      pageSize,
    });

    return NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      ...result,
    });
  } catch (err) {
    console.error("GET /api/portal-admin/payments error:", err);
    return jsonError("تعذر تحميل قائمة إيصالات السداد", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const scope = resolveRequestTenantScope(req);
    await ensurePortalSchemaReady(scope.tenantSlug);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: "edit",
    });
    if (!auth.ok) return auth.response;

    const actorSubject = auth.actor.user || auth.actor.userRole;
    if (
      !canApprove(actorSubject) &&
      !canManageTreasury(actorSubject) &&
      !canEdit(actorSubject, "sales")
    ) {
      return forbiddenError("⛔ ليس لديك صلاحية مراجعة واعتماد إيصالات سداد العملاء");
    }

    const paymentId = String(body.paymentId || body.id || "").trim();
    const actionRaw = String(body.action || "").trim().toUpperCase();
    const action =
      actionRaw === "APPROVE" ||
      actionRaw === "RETURN_FOR_CLARIFICATION" ||
      actionRaw === "REJECT"
        ? actionRaw
        : null;

    if (!paymentId || !action) {
      return jsonError(
        "paymentId و action (APPROVE | RETURN_FOR_CLARIFICATION | REJECT) مطلوبان",
        400
      );
    }

    const result = await reviewClientPaymentReceipt({
      tenantSlug: scope.tenantSlug,
      paymentId,
      action,
      staffNotes: body.staffNotes !== undefined ? String(body.staffNotes) : null,
      reason: body.reason !== undefined ? String(body.reason) : null,
      actor: {
        userId: auth.actor.userId,
        username: auth.actor.user?.username || auth.actor.userDisplay,
        userDisplay: auth.actor.userDisplay || "المحاسب",
        userRole: auth.actor.userRole,
      },
    });

    const msg = result.idempotentReplay
      ? "ℹ️ تم اعتماد وترحيل هذا الإيصال مسبقاً (حماية ضد التكرار)"
      : action === "APPROVE"
      ? `✅ تم اعتماد الإيصال وترحيل سند القبض (${result.receiptVoucherNumber}) وإعداد مسودة واتساب`
      : action === "RETURN_FOR_CLARIFICATION"
      ? "↩️ تم إعادة الإيصال للعميل للتوضيح دون التأثير على الأرصدة"
      : "❌ تم رفض الإيصال وإغلاقه في سجل المراجعة";

    return NextResponse.json({
      success: true,
      ...result,
      message: msg,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر معالجة إيصال السداد";
    const status = msg.startsWith("NOT_FOUND:") ? 404 : 400;
    return jsonError(msg.replace(/^NOT_FOUND:\s*/, ""), status);
  }
});

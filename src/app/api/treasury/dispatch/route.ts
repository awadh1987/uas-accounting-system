import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { withIdempotency } from "@/lib/idempotencyGuard";
import { authorizeApiAction, forbiddenError } from "@/lib/apiHelpers";
import { hasGranularPermission } from "@/lib/permissions";
import { executeBankOrWalletPayout } from "@/lib/treasury/bankWalletGateway";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (guardedReq) => {
    try {
      const body = (await guardedReq.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, guardedReq, {
        moduleId: "treasury",
        action: "treasury",
      });
      if (!auth.ok) return auth.response;

      if (!hasGranularPermission(auth.actor.user || auth.actor.userRole, "treasury.execute_gateway")) {
        return forbiddenError("⛔ ليس لديك صلاحية تنفيذ التحويلات البنكية الآلية");
      }

      const idempotencyKey =
        guardedReq.headers.get("x-idempotency-key") ||
        (body.idempotencyKey ? String(body.idempotencyKey) : "") ||
        `DSP-KEY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const result = await executeBankOrWalletPayout({
        treasuryAccountId: String(body.treasuryAccountId || ""),
        sourceVoucherType: String(body.sourceVoucherType || "PAYMENT_VOUCHER") as any,
        sourceVoucherId: String(body.sourceVoucherId || "MANUAL"),
        beneficiaryName: String(body.beneficiaryName || ""),
        beneficiaryAccountOrPhone: String(body.beneficiaryAccountOrPhone || ""),
        amount: Number(body.amount),
        currencyCode: String(body.currencyCode || "YER"),
        exchangeRate: Number(body.exchangeRate) || 1,
        costCenterId: body.costCenterId ? String(body.costCenterId) : null,
        idempotencyKey,
        actor: {
          userId: auth.actor.userId!,
          userName: auth.actor.userDisplay,
          role: auth.actor.userRole,
        },
      });

      return NextResponse.json(result, { status: 200 });
    } catch (err: any) {
      const msg = err?.message || "DISPATCH_FAILED";
      const isDailyLimit = msg.includes("DAILY_LIMIT_EXCEEDED");
      const isInsufficient = msg.includes("INSUFFICIENT_TREASURY_BALANCE");
      const isFiscalYear = msg.includes("FISCAL_YEAR_CLOSED");
      const status = isDailyLimit || isInsufficient || isFiscalYear ? 422 : 400;

      return NextResponse.json(
        {
          ok: false,
          error: msg,
          messageAr: isDailyLimit
            ? "تجاوز مبلغ التحويل الحد اليومي المسموح به للخزينة"
            : isInsufficient
            ? "رصيد الخزينة أو المحفظة غير كافٍ لإتمام التحويل والرسوم"
            : isFiscalYear
            ? "لا يمكن ترحيل قيود في سنة مالية مقفلة"
            : msg,
          messageEn: msg,
        },
        { status }
      );
    }
  });
});

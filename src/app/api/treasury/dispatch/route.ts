import { NextRequest, NextResponse } from "next/server";
import { withIdempotency } from "@/lib/idempotencyGuard";
import { executeBankOrWalletPayout } from "@/lib/treasury/bankWalletGateway";

export async function POST(req: NextRequest) {
  return withIdempotency(req, async (guardedReq) => {
    try {
      const body = await guardedReq.json();
      const userId = guardedReq.headers.get("x-uas-user-id") || body?.actor?.userId || "admin";
      const userName = guardedReq.headers.get("x-uas-user-name") || body?.actor?.userName || "Admin User";
      const userRole = guardedReq.headers.get("x-uas-role") || body?.actor?.role || "SUPER_ADMIN";

      const idempotencyKey =
        guardedReq.headers.get("x-idempotency-key") ||
        body.idempotencyKey ||
        `DSP-KEY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const result = await executeBankOrWalletPayout({
        treasuryAccountId: body.treasuryAccountId,
        sourceVoucherType: body.sourceVoucherType || "PAYMENT_VOUCHER",
        sourceVoucherId: body.sourceVoucherId || "MANUAL",
        beneficiaryName: body.beneficiaryName,
        beneficiaryAccountOrPhone: body.beneficiaryAccountOrPhone,
        amount: Number(body.amount),
        currencyCode: body.currencyCode || "YER",
        exchangeRate: Number(body.exchangeRate) || 1,
        costCenterId: body.costCenterId || null,
        idempotencyKey,
        actor: {
          userId,
          userName,
          role: userRole,
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
}

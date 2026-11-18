import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  generateFinancialReports,
  postJournalEntry,
  recordAuditDiffTx,
} from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { collectServerSupportDiagnostics } from "@/lib/supportDiagnosticsServer";
import {
  canCreate,
  canPostLedger,
  isReadOnly,
  normalizeRole,
  type ModuleIdentifier,
} from "@/lib/permissions";
import type { ResolvedActor } from "@/lib/apiHelpers";
import type {
  ConfirmationPreviewCard,
  PreviewLedgerLine,
  UasAgentExecutionContext,
  UasAgentJournalSummary,
} from "./uasAgentTools";

export async function buildServerAgentContext(
  actor?: ResolvedActor | null,
  lang?: "ar" | "en"
): Promise<UasAgentExecutionContext> {
  await ensureSqliteDatabaseReady();

  const [state, reports, diagnostics, rawEntries] = await Promise.all([
    getBootstrapState(),
    generateFinancialReports(),
    collectServerSupportDiagnostics(),
    prisma.journalEntry.findMany({
      take: 20,
      orderBy: [{ date: "desc" }, { entryNumber: "desc" }],
      include: { lines: true },
    }),
  ]);

  const coaAccounts = reports.trialBalance.rows.map((r) => ({
    code: r.code,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    level: r.level,
    type: r.type,
    isPosting: r.isPosting,
    rolledUpBalance: r.balance,
    balance: r.balance,
  }));

  const journalEntries: UasAgentJournalSummary[] = rawEntries.map((e) => ({
    id: e.id,
    entryNumber: e.entryNumber,
    date: e.date.toISOString(),
    narrationAr: e.narrationAr,
    narrationEn: e.narrationEn ?? undefined,
    totalDebit: e.lines.reduce((s, l) => s + Number(l.debitBase), 0),
    totalCredit: e.lines.reduce((s, l) => s + Number(l.creditBase), 0),
    status: e.status,
  }));

  const qrLookupHook: UasAgentExecutionContext["qrLookupHook"] = async (q: string) => {
    const [installment, payment, receipt, invoice, bill, journal] = await Promise.all([
      prisma.installmentVoucher.findFirst({
        where: { OR: [{ voucherNo: q }, { qrVerificationHash: q }] },
      }),
      prisma.paymentVoucher.findFirst({
        where: { OR: [{ voucherNumber: q }, { qrVerificationHash: q }] },
        include: { vendor: { select: { nameAr: true } } },
      }),
      prisma.receiptVoucher.findFirst({
        where: { OR: [{ voucherNumber: q }, { qrVerificationHash: q }] },
        include: { customer: { select: { nameAr: true } } },
      }),
      prisma.salesInvoice.findFirst({
        where: { OR: [{ invoiceNumber: q }, { qrVerificationHash: q }] },
        include: { customer: { select: { nameAr: true } } },
      }),
      prisma.vendorBill.findFirst({
        where: { billNumber: q },
        include: { vendor: { select: { nameAr: true } } },
      }),
      prisma.journalEntry.findFirst({
        where: { OR: [{ entryNumber: q }, { reference: q }] },
        include: { lines: true },
      }),
    ]);

    if (installment) {
      return {
        verified: true,
        documentType: installment.type === "CUSTOMER_RECEIPT" ? "سند قبض عميل" : "سند صرف عامل",
        reference: installment.voucherNo,
        party: installment.targetName,
        amount: installment.amountYER,
        currency: "YER",
        date: installment.paymentDate,
        status: "VERIFIED_IMMUTABLE",
      };
    }
    if (payment) {
      return {
        verified: true,
        documentType: "سند صرف مورد (Payment Voucher)",
        reference: payment.voucherNumber,
        party: payment.vendor.nameAr,
        amount: Number(payment.amount),
        currency: payment.currency,
        date: payment.date.toISOString().slice(0, 10),
        status: "POSTED_TO_GL",
      };
    }
    if (receipt) {
      return {
        verified: true,
        documentType: "سند قبض مبيعات (Receipt Voucher)",
        reference: receipt.voucherNumber,
        party: receipt.customer.nameAr,
        amount: Number(receipt.amount),
        currency: receipt.currency,
        date: receipt.date.toISOString().slice(0, 10),
        status: "POSTED_TO_GL",
      };
    }
    if (invoice) {
      return {
        verified: true,
        documentType: "فاتورة مبيعات (Sales Invoice)",
        reference: invoice.invoiceNumber,
        party: invoice.customer.nameAr,
        amount: Number(invoice.totalAmount),
        currency: invoice.currency,
        date: invoice.date.toISOString().slice(0, 10),
        status: invoice.status,
      };
    }
    if (bill) {
      return {
        verified: true,
        documentType: "فاتورة مشتريات مورد (Vendor Bill)",
        reference: bill.billNumber,
        party: bill.vendor.nameAr,
        amount: Number(bill.totalAmount),
        currency: bill.currency,
        date: bill.date.toISOString().slice(0, 10),
        status: bill.status,
      };
    }
    if (journal) {
      const totalDr = journal.lines.reduce((s, l) => s + Number(l.debitBase), 0);
      return {
        verified: true,
        documentType: "قيد يومية عام (Journal Entry)",
        reference: journal.entryNumber,
        party: journal.narrationAr,
        amount: totalDr,
        currency: "YER",
        date: journal.date.toISOString().slice(0, 10),
        status: journal.status,
      };
    }
    return null;
  };

  return {
    user: actor?.user ?? actor?.userRole ?? "SUPER_ADMIN",
    lang,
    state,
    coaAccounts,
    journalEntries,
    reportSnapshot: {
      totalDebits: reports.trialBalance.totalDebits,
      totalCredits: reports.trialBalance.totalCredits,
      isBalanced: reports.trialBalance.isBalanced,
      totalRevenue: reports.incomeStatement.totalRevenue,
      totalExpenses: reports.incomeStatement.totalExpenses,
      netIncome:
        reports.incomeStatement.totalRevenue - reports.incomeStatement.totalExpenses,
      totalAssets: reports.balanceSheet.totalAssets,
      totalLiabilities: reports.balanceSheet.totalLiabilities,
      totalEquity: reports.balanceSheet.totalEquity,
    },
    diagnostics,
    qrLookupHook,
  };
}

export interface ConfirmedExecutionResult {
  ok: boolean;
  status: number;
  code?: string;
  executed_by_ai: boolean;
  entryNumber?: string;
  journalEntryId?: string;
  summaryAr: string;
  summaryEn: string;
}

export async function executeConfirmedAiAction(input: {
  confirmationCard: ConfirmationPreviewCard;
  actor: ResolvedActor;
}): Promise<ConfirmedExecutionResult> {
  await ensureSqliteDatabaseReady();
  const { confirmationCard, actor } = input;
  const targetUser = actor.user ?? actor.userRole;
  const role = normalizeRole(targetUser);

  if (isReadOnly(targetUser)) {
    return {
      ok: false,
      status: 403,
      code: "RBAC_FORBIDDEN",
      executed_by_ai: false,
      summaryAr: `⛔ غير مصرح: حساب (${role}) للقراءة فقط ولا يمكنه اعتماد أو ترحيل العمليات.`,
      summaryEn: `⛔ RBAC Blocked: Role (${role}) is Read-Only and cannot confirm or post transactions.`,
    };
  }

  const op = confirmationCard.operationType;
  if (op === "JOURNAL_ENTRY" && !canPostLedger(targetUser)) {
    return {
      ok: false,
      status: 403,
      code: "RBAC_FORBIDDEN",
      executed_by_ai: false,
      summaryAr: `⛔ غير مصرح: ترحيل قيود اليومية المباشرة محصور بمدير النظام ورئيس الحسابات.`,
      summaryEn: `⛔ RBAC Blocked: Direct General Ledger posting requires SUPER_ADMIN or CHIEF_ACCOUNTANT.`,
    };
  }

  const moduleMap: Record<ConfirmationPreviewCard["operationType"], ModuleIdentifier> = {
    JOURNAL_ENTRY: "ledger",
    RECEIPT_VOUCHER: "sales",
    PAYMENT_VOUCHER: "expenses",
    SALES_INVOICE: "sales",
    PURCHASE_BILL: "procurement",
  };
  const requiredModule = moduleMap[op] || "ledger";
  if (!canCreate(targetUser, requiredModule)) {
    return {
      ok: false,
      status: 403,
      code: "RBAC_FORBIDDEN",
      executed_by_ai: false,
      summaryAr: `⛔ غير مصرح: دورك الحالي (${role}) لا يملك صلاحية الترحيل في قسم (${requiredModule}).`,
      summaryEn: `⛔ RBAC Blocked: Role (${role}) does not have create permission in '${requiredModule}'.`,
    };
  }

  const lines: PreviewLedgerLine[] = Array.isArray(confirmationCard.lines)
    ? confirmationCard.lines
    : [];
  if (lines.length < 2) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_JOURNAL_LINES",
      executed_by_ai: false,
      summaryAr: "⚠️ القيد المعاين يجب أن يحتوي على سطرين على الأقل.",
      summaryEn: "⚠️ Previewed entry must contain at least 2 lines.",
    };
  }

  const totalDr = Number(lines.reduce((s, l) => s + Number(l.debit || 0), 0).toFixed(2));
  const totalCr = Number(lines.reduce((s, l) => s + Number(l.credit || 0), 0).toFixed(2));
  if (totalDr <= 0 || Math.abs(totalDr - totalCr) > 0.005) {
    return {
      ok: false,
      status: 400,
      code: "UNBALANCED_JOURNAL_ENTRY",
      executed_by_ai: false,
      summaryAr: `⚠️ القيد غير متوازن (${totalDr} !== ${totalCr}).`,
      summaryEn: `⚠️ Unbalanced journal lines (${totalDr} !== ${totalCr}).`,
    };
  }

  try {
    const posted = await prisma.$transaction(async (tx) => {
      const entry = await postJournalEntry({
        tx,
        date: confirmationCard.date || new Date().toISOString().slice(0, 10),
        narrationAr: confirmationCard.narrationAr,
        narrationEn: confirmationCard.narrationEn,
        sourceType: `AI_COPILOT_${op}`,
        projectId: confirmationCard.projectId ?? null,
        createdById: actor.userId ?? undefined,
        lines: lines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
          currency: confirmationCard.currency || "YER",
          memo: l.memo || confirmationCard.narrationAr,
        })),
      });

      await recordAuditDiffTx(tx, {
        userId: actor.userId,
        action: "POST",
        entity: "JournalEntry",
        entityId: entry.id,
        before: null,
        after: {
          entryNumber: entry.entryNumber,
          operationType: op,
          totalDebit: totalDr,
          totalCredit: totalCr,
          executed_by_ai: true,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: `ترحيل عملية محاسبية عبر المساعد الذكي (${op}) [executed_by_ai: true]`,
        entityReference: entry.entryNumber,
        details: JSON.stringify({
          entryNumber: entry.entryNumber,
          operationType: op,
          narrationAr: confirmationCard.narrationAr,
          totalDebit: totalDr,
          totalCredit: totalCr,
          currency: confirmationCard.currency || "YER",
          executed_by_ai: true,
        }),
      });

      return entry;
    });

    return {
      ok: true,
      status: 200,
      executed_by_ai: true,
      entryNumber: posted.entryNumber,
      journalEntryId: posted.id,
      summaryAr: `✅ **تم التأكيد والترحيل بنجاح!** رقم القيد في دفتر الأستاذ: **${posted.entryNumber}** بمبلغ **${totalDr.toLocaleString()} ${confirmationCard.currency}** (موثق في سجل التدقيق بعلامة \`executed_by_ai: true\`).`,
      summaryEn: `✅ **Confirmed & Posted to General Ledger!** Entry Number: **${posted.entryNumber}** for **${totalDr.toLocaleString()} ${confirmationCard.currency}** (recorded in the audit trail with \`executed_by_ai: true\`).`,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 400,
      code: "EXECUTION_FAILED",
      executed_by_ai: false,
      summaryAr: `⚠️ تعذر ترحيل العملية: ${err?.message || "خطأ غير معروف"}`,
      summaryEn: `⚠️ Failed to post confirmed transaction: ${err?.message || "Unknown error"}`,
    };
  }
}

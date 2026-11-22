/**
 * Fiscal Year-End Closing & Opening Balance Migration Engine (Mission 2 / Phase 2)
 * --------------------------------------------------------------------------
 * Handles:
 *   1. Fiscal Year lifecycle (OPEN -> CLOSING_IN_PROGRESS -> CLOSED)
 *   2. Pre-closing audit checklist (zero pending drafts/approvals, balanced TB,
 *      FX closing spot rates configured, Retained Earnings account mapped)
 *   3. Atomic Year-End Closing & Rollover:
 *      - Step A: P&L Closing Entry (YEAR_END_CLOSING) preserving Cost Centers
 *      - Step B: Lock Closed Fiscal Year & advance SystemSettings.periodLockDate
 *      - Step C: Open next Fiscal Year & migrate Balance Sheet + Gen-6 Sub-Ledger
 *                + Multi-Currency (Foreign + Base) opening balances + StockBalance roll-forward
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CONTROL_ACCOUNTS, parseAccountingSettings } from "@/lib/accountingSettings";

type Db = Prisma.TransactionClient | typeof prisma;

export type FiscalYearStatus = "OPEN" | "CLOSING_IN_PROGRESS" | "CLOSED";
export type JournalEntryType = "NORMAL" | "OPENING" | "ADJUSTMENT" | "YEAR_END_CLOSING";

export interface FiscalYearPrecheckItem {
  key: "pendingDocuments" | "trialBalance" | "fxSpotRates" | "retainedEarnings";
  titleAr: string;
  titleEn: string;
  passed: boolean;
  detailsAr: string;
  detailsEn: string;
  count?: number;
}

export interface FiscalYearPrecheckResult {
  fiscalYearId: string;
  fiscalYearCode: string;
  status: string;
  canClose: boolean;
  checks: FiscalYearPrecheckItem[];
  pnlPreview: {
    totalRevenueBase: number;
    totalExpensesBase: number;
    netProfitLossBase: number;
    retainedEarningsAccountCode: string;
    retainedEarningsAccountNameAr: string;
    closingLineCount: number;
  };
  openingPreview: {
    nextFiscalYearCode: string;
    nextStartDate: string;
    nextEndDate: string;
    totalAssetsBase: number;
    totalLiabilitiesBase: number;
    totalEquityBase: number;
    balanceSheetLineCount: number;
    gen6SubLedgerCount: number;
    fxCurrencies: string[];
    stockBalanceCount: number;
    totalInventoryValuationBase: number;
  };
}

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return Number(v.toString()) || 0;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function lineBaseDebit(l: {
  baseDebit?: Prisma.Decimal | number | null;
  debitBase?: Prisma.Decimal | number | null;
  debit?: Prisma.Decimal | number | null;
  exchangeRate?: Prisma.Decimal | number | null;
}): number {
  const bd = toNum(l.baseDebit);
  if (bd > 0) return bd;
  const db = toNum(l.debitBase);
  if (db > 0) return db;
  return round4(toNum(l.debit) * (toNum(l.exchangeRate) || 1));
}

function lineBaseCredit(l: {
  baseCredit?: Prisma.Decimal | number | null;
  creditBase?: Prisma.Decimal | number | null;
  credit?: Prisma.Decimal | number | null;
  exchangeRate?: Prisma.Decimal | number | null;
}): number {
  const bc = toNum(l.baseCredit);
  if (bc > 0) return bc;
  const cb = toNum(l.creditBase);
  if (cb > 0) return cb;
  return round4(toNum(l.credit) * (toNum(l.exchangeRate) || 1));
}

function lineForeignDebit(l: {
  foreignDebit?: Prisma.Decimal | number | null;
  debit?: Prisma.Decimal | number | null;
}): number {
  const fd = toNum(l.foreignDebit);
  return fd > 0 ? fd : toNum(l.debit);
}

function lineForeignCredit(l: {
  foreignCredit?: Prisma.Decimal | number | null;
  credit?: Prisma.Decimal | number | null;
}): number {
  const fc = toNum(l.foreignCredit);
  return fc > 0 ? fc : toNum(l.credit);
}

function lineCurrency(l: { currencyCode?: string | null; currency?: string | null }): string {
  return (l.currencyCode || l.currency || "YER").toUpperCase();
}

function computeNextFiscalYearDates(endDate: Date): {
  code: string;
  nameAr: string;
  nameEn: string;
  startDate: Date;
  endDate: Date;
} {
  const start = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate() + 1, 0, 0, 0, 0));
  const nextYear = start.getUTCFullYear();
  const end = new Date(Date.UTC(nextYear, start.getUTCMonth(), start.getUTCDate() - 1, 23, 59, 59, 999));
  // If start is Jan 1, end should be Dec 31 of the SAME nextYear
  const finalEnd =
    start.getUTCMonth() === 0 && start.getUTCDate() === 1
      ? new Date(Date.UTC(nextYear, 11, 31, 23, 59, 59, 999))
      : new Date(Date.UTC(nextYear + 1, start.getUTCMonth(), start.getUTCDate() - 1, 23, 59, 59, 999));
  void end;
  return {
    code: `FY-${nextYear}`,
    nameAr: `السنة المالية ${nextYear}`,
    nameEn: `Fiscal Year ${nextYear}`,
    startDate: start,
    endDate: finalEnd,
  };
}

export async function ensureDefaultFiscalYear(client: Db = prisma) {
  const count = await client.fiscalYear.count();
  if (count > 0) return;
  const settings = await client.systemSettings.findUnique({ where: { id: "default" } });
  const parsed = parseAccountingSettings(settings);
  const startStr = parsed.fiscalYearStart || "2026-01-01";
  const endStr = parsed.fiscalYearEnd || "2026-12-31";
  const year = new Date(`${startStr}T00:00:00Z`).getUTCFullYear() || 2026;
  await client.fiscalYear.upsert({
    where: { code: `FY-${year}` },
    update: {},
    create: {
      code: `FY-${year}`,
      nameAr: `السنة المالية ${year}`,
      nameEn: `Fiscal Year ${year}`,
      startDate: new Date(`${startStr}T00:00:00.000Z`),
      endDate: new Date(`${endStr}T23:59:59.999Z`),
      status: "OPEN",
    },
  });
}

export async function listFiscalYears(client: Db = prisma) {
  await ensureDefaultFiscalYear(client);
  return client.fiscalYear.findMany({ orderBy: { startDate: "desc" } });
}

export interface CreateFiscalYearInput {
  code: string;
  nameAr: string;
  nameEn?: string;
  startDate: string | Date;
  endDate: string | Date;
}

export async function createFiscalYear(input: CreateFiscalYearInput, client: Db = prisma) {
  const code = input.code?.trim().toUpperCase();
  if (!code) throw new Error("FISCAL_YEAR_CODE_REQUIRED: رمز السنة المالية مطلوب");
  const nameAr = input.nameAr?.trim();
  if (!nameAr) throw new Error("FISCAL_YEAR_NAME_REQUIRED: اسم السنة المالية مطلوب");
  const startDate =
    typeof input.startDate === "string" && input.startDate.length <= 10
      ? new Date(`${input.startDate}T00:00:00.000Z`)
      : new Date(input.startDate);
  const endDate =
    typeof input.endDate === "string" && input.endDate.length <= 10
      ? new Date(`${input.endDate}T23:59:59.999Z`)
      : new Date(input.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate) {
    throw new Error("INVALID_FISCAL_YEAR_DATES: تاريخ البداية يجب أن يكون قبل تاريخ النهاية");
  }
  const existing = await client.fiscalYear.findUnique({ where: { code } });
  if (existing) throw new Error(`DUPLICATE_FISCAL_YEAR_CODE:${code}`);
  return client.fiscalYear.create({
    data: {
      code,
      nameAr,
      nameEn: input.nameEn?.trim() || nameAr,
      startDate,
      endDate,
      status: "OPEN",
    },
  });
}

async function resolveClosingSpotRate(tx: Db, currencyCode: string, asOfDate: Date): Promise<number | null> {
  const cur = currencyCode.toUpperCase();
  if (cur === "YER") return 1;
  const er = await tx.exchangeRate.findFirst({
    where: { currencyCode: cur, rateDate: { lte: asOfDate } },
    orderBy: { rateDate: "desc" },
  });
  if (er && Number(er.midRate) > 0) return Number(er.midRate);
  const cr = await tx.currencyRate.findUnique({ where: { currencyCode: cur } });
  if (cr && Number(cr.rateToYER) > 0) return Number(cr.rateToYER);
  return null;
}

/**
 * Checks whether a posting date is blocked by either a CLOSED FiscalYear
 * or SystemSettings.periodLockDate.
 */
export async function assertDateNotInClosedFiscalYear(tx: Db, entryDate: Date) {
  const closedFy = await tx.fiscalYear.findFirst({
    where: {
      status: "CLOSED",
      startDate: { lte: entryDate },
      endDate: { gte: entryDate },
    },
    select: { code: true, nameAr: true, endDate: true },
  });
  if (closedFy) {
    throw new Error(
      `FISCAL_YEAR_CLOSED: السنة المالية ${closedFy.code} (${closedFy.nameAr}) مقفلة نهائياً ولا يمكن ترحيل قيود بتاريخ ${entryDate.toISOString().slice(0, 10)}.`
    );
  }
  const settings = await tx.systemSettings.findUnique({
    where: { id: "default" },
    select: { periodLockDate: true },
  });
  if (settings?.periodLockDate) {
    const lockEnd = new Date(`${settings.periodLockDate}T23:59:59.999Z`);
    if (!Number.isNaN(lockEnd.getTime()) && entryDate <= lockEnd) {
      throw new Error(
        `PERIOD_LOCKED: التاريخ ${entryDate.toISOString().slice(0, 10)} يقع ضمن فترة محاسبية مقفلة حتى ${settings.periodLockDate}.`
      );
    }
  }
}

/**
 * Comprehensive Pre-Closing Audit Checklist & Preview for a Fiscal Year.
 */
export async function runFiscalYearPrecheck(
  fiscalYearId: string,
  client: Db = prisma
): Promise<FiscalYearPrecheckResult> {
  const fy = await client.fiscalYear.findUnique({ where: { id: fiscalYearId } });
  if (!fy) throw new Error("FISCAL_YEAR_NOT_FOUND");

  const dateRange = { gte: fy.startDate, lte: fy.endDate };

  // 1. Pending / Draft documents in closing year
  const [pendingEntries, pendingInvoices, pendingBills, pendingDrafts] = await Promise.all([
    client.journalEntry.count({
      where: { date: dateRange, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
    }),
    client.salesInvoice.count({
      where: { date: dateRange, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
    }),
    client.vendorBill.count({
      where: { date: dateRange, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
    }),
    client.workspaceDraft.count({
      where: { createdAt: dateRange, status: { in: ["ACTIVE_DRAFT", "SUBMITTED_FOR_APPROVAL"] } },
    }),
  ]);
  const totalPending = pendingEntries + pendingInvoices + pendingBills + pendingDrafts;

  // 2. Posted lines in closing year (exclude prior YEAR_END_CLOSING if re-inspecting)
  const postedLines = await client.journalEntryLine.findMany({
    where: {
      journalEntry: {
        status: "POSTED",
        date: dateRange,
        entryType: { not: "YEAR_END_CLOSING" },
      },
    },
    include: { account: true },
  });

  let totalBaseDebit = 0;
  let totalBaseCredit = 0;
  let totalRevenueBase = 0;
  let totalExpensesBase = 0;
  const pnlKeys = new Set<string>();
  const bsBalances = new Map<
    string,
    {
      accountId: string;
      type: string;
      generation: number;
      subLedgerType: string | null;
      currencyCode: string;
      costCenterId: string | null;
      netBase: number;
      netForeign: number;
    }
  >();
  const fxCurrenciesSet = new Set<string>();

  for (const l of postedLines) {
    const drBase = lineBaseDebit(l);
    const crBase = lineBaseCredit(l);
    const drFor = lineForeignDebit(l);
    const crFor = lineForeignCredit(l);
    const cur = lineCurrency(l);

    totalBaseDebit = round4(totalBaseDebit + drBase);
    totalBaseCredit = round4(totalBaseCredit + crBase);

    if (cur !== "YER") fxCurrenciesSet.add(cur);

    if (l.account.type === "REVENUE") {
      totalRevenueBase = round4(totalRevenueBase + (crBase - drBase));
      pnlKeys.add(`${l.accountId}::${l.costCenterId ?? ""}`);
    } else if (l.account.type === "EXPENSE") {
      totalExpensesBase = round4(totalExpensesBase + (drBase - crBase));
      pnlKeys.add(`${l.accountId}::${l.costCenterId ?? ""}`);
    } else if (l.account.type === "ASSET" || l.account.type === "LIABILITY" || l.account.type === "EQUITY") {
      const key = `${l.accountId}::${cur}::${l.costCenterId ?? ""}`;
      const existing = bsBalances.get(key) ?? {
        accountId: l.accountId,
        type: l.account.type,
        generation: l.account.generation || l.account.level,
        subLedgerType: l.account.subLedgerType ?? null,
        currencyCode: cur,
        costCenterId: l.costCenterId ?? null,
        netBase: 0,
        netForeign: 0,
      };
      existing.netBase = round4(existing.netBase + (drBase - crBase));
      existing.netForeign = round4(existing.netForeign + (drFor - crFor));
      bsBalances.set(key, existing);
    }
  }

  const tbDiff = round4(Math.abs(totalBaseDebit - totalBaseCredit));
  const tbBalanced = tbDiff <= 0.01;

  // 3. FX closing spot rates check
  const missingFx: string[] = [];
  for (const cur of fxCurrenciesSet) {
    const rate = await resolveClosingSpotRate(client, cur, fy.endDate);
    if (!rate || rate <= 0) missingFx.push(cur);
  }

  // 4. Retained Earnings control account check
  const settingsRow = await client.systemSettings.findUnique({ where: { id: "default" } });
  const settings = parseAccountingSettings(settingsRow);
  const reCode = settings.controlAccounts.retainedEarningsAccount || DEFAULT_CONTROL_ACCOUNTS.retainedEarningsAccount;
  const reAccount = await client.account.findUnique({ where: { code: reCode } });
  const reValid = Boolean(reAccount && reAccount.isPosting);

  // Preview calculations
  const netProfitLossBase = round4(totalRevenueBase - totalExpensesBase);
  let totalAssetsBase = 0;
  let totalLiabilitiesBase = 0;
  let totalEquityBase = 0;
  let balanceSheetLineCount = 0;
  let gen6SubLedgerCount = 0;

  for (const b of bsBalances.values()) {
    if (Math.abs(b.netBase) < 0.005 && Math.abs(b.netForeign) < 0.005) continue;
    balanceSheetLineCount++;
    if (b.generation === 6 || (b.subLedgerType && b.subLedgerType !== "NONE")) gen6SubLedgerCount++;
    if (b.type === "ASSET") totalAssetsBase = round4(totalAssetsBase + b.netBase);
    else if (b.type === "LIABILITY") totalLiabilitiesBase = round4(totalLiabilitiesBase - b.netBase);
    else if (b.type === "EQUITY") totalEquityBase = round4(totalEquityBase - b.netBase);
  }
  // Include Net Profit / Loss in Equity preview
  totalEquityBase = round4(totalEquityBase + netProfitLossBase);

  const stockBalances = await client.stockBalance.findMany({ where: { qtyOnHandBase: { gt: 0 } } });
  const totalInventoryValuationBase = round4(
    stockBalances.reduce(
      (sum, sb) => sum + Number(sb.qtyOnHandBase) * Number(sb.avgUnitCostBase),
      0
    )
  );

  const nextFy = computeNextFiscalYearDates(fy.endDate);

  const checks: FiscalYearPrecheckItem[] = [
    {
      key: "pendingDocuments",
      titleAr: "خلو السنة من المسودات أو المستندات بانتظار الاعتماد",
      titleEn: "Zero unposted drafts or pending-approval documents",
      passed: totalPending === 0,
      count: totalPending,
      detailsAr:
        totalPending === 0
          ? "لا توجد مستندات معلقة أو مسودات غير مرحلة في السنة المالية."
          : `يوجد ${totalPending} مستند غير مرحل (قيود: ${pendingEntries}، فواتير مبيعات: ${pendingInvoices}، فواتير موردين: ${pendingBills}).`,
      detailsEn:
        totalPending === 0
          ? "All documents in this fiscal year are posted."
          : `${totalPending} unposted document(s) found (Journals: ${pendingEntries}, Invoices: ${pendingInvoices}, Bills: ${pendingBills}).`,
    },
    {
      key: "trialBalance",
      titleAr: "توازن ميزان المراجعة بالعملة الأساسية (YER)",
      titleEn: "Base-currency Trial Balance strictly balanced",
      passed: tbBalanced,
      detailsAr: tbBalanced
        ? `ميزان المراجعة متوازن تماماً (مدين: ${totalBaseDebit.toLocaleString()} = دائن: ${totalBaseCredit.toLocaleString()}).`
        : `ميزان المراجعة غير متوازن بفرق ${tbDiff} YER (مدين: ${totalBaseDebit} مقابل دائن: ${totalBaseCredit}).`,
      detailsEn: tbBalanced
        ? `Trial Balance balanced (Debit ${totalBaseDebit} = Credit ${totalBaseCredit}).`
        : `Trial Balance out of balance by ${tbDiff} YER.`,
    },
    {
      key: "fxSpotRates",
      titleAr: "توفر أسعار صرف الإقفال للعملات الأجنبية",
      titleEn: "Closing spot exchange rates configured for foreign currencies",
      passed: missingFx.length === 0,
      count: missingFx.length,
      detailsAr:
        missingFx.length === 0
          ? fxCurrenciesSet.size === 0
            ? "لا توجد أرصدة بعملات أجنبية مفتوحة."
            : `أسعار الصرف مكتملة للعملات: ${[...fxCurrenciesSet].join("، ")}.`
          : `يرجى ضبط سعر الصرف للعملات: ${missingFx.join("، ")}.`,
      detailsEn:
        missingFx.length === 0
          ? fxCurrenciesSet.size === 0
            ? "No open foreign-currency balances."
            : `Spot rates configured for: ${[...fxCurrenciesSet].join(", ")}.`
          : `Missing closing spot rate(s) for: ${missingFx.join(", ")}.`,
    },
    {
      key: "retainedEarnings",
      titleAr: "ربط حساب الأرباح المحتجزة (Retained Earnings)",
      titleEn: "Retained Earnings control account mapped & postable",
      passed: reValid,
      detailsAr: reValid
        ? `الحساب المعتمد: ${reAccount!.code} — ${reAccount!.nameAr}.`
        : `حساب الأرباح المحتجزة (${reCode}) غير موجود أو غير قابل للترحيل.`,
      detailsEn: reValid
        ? `Mapped to ${reAccount!.code} — ${reAccount!.nameEn}.`
        : `Retained Earnings account (${reCode}) is missing or non-postable.`,
    },
  ];

  const canClose = fy.status !== "CLOSED" && checks.every((c) => c.passed);

  return {
    fiscalYearId: fy.id,
    fiscalYearCode: fy.code,
    status: fy.status,
    canClose,
    checks,
    pnlPreview: {
      totalRevenueBase,
      totalExpensesBase,
      netProfitLossBase,
      retainedEarningsAccountCode: reAccount?.code ?? reCode,
      retainedEarningsAccountNameAr: reAccount?.nameAr ?? "الأرباح المحتجزة",
      closingLineCount: pnlKeys.size + (Math.abs(netProfitLossBase) >= 0.005 ? 1 : 0),
    },
    openingPreview: {
      nextFiscalYearCode: nextFy.code,
      nextStartDate: nextFy.startDate.toISOString().slice(0, 10),
      nextEndDate: nextFy.endDate.toISOString().slice(0, 10),
      totalAssetsBase,
      totalLiabilitiesBase,
      totalEquityBase,
      balanceSheetLineCount,
      gen6SubLedgerCount,
      fxCurrencies: [...fxCurrenciesSet],
      stockBalanceCount: stockBalances.length,
      totalInventoryValuationBase,
    },
  };
}

export interface CloseRolloverActor {
  userId?: string;
  userName?: string;
}

/**
 * Atomic Year-End Closing & New Fiscal Year Opening Balance Migration.
 */
export async function executeFiscalYearCloseAndRollover(
  fiscalYearId: string,
  actor: CloseRolloverActor = {},
  client: typeof prisma = prisma
) {
  return client.$transaction(async (tx) => {
    // Concurrency State Guard: Atomically lock fiscal year with WHERE status = 'OPEN'
    const guarded = await tx.fiscalYear.updateMany({
      where: { id: fiscalYearId, status: "OPEN" },
      data: { status: "CLOSING_IN_PROGRESS" },
    });
    if (guarded.count === 0) {
      const existing = await tx.fiscalYear.findUnique({ where: { id: fiscalYearId } });
      if (!existing) throw new Error("FISCAL_YEAR_NOT_FOUND");
      if (existing.status === "CLOSED") {
        throw new Error(`FISCAL_YEAR_ALREADY_CLOSED: السنة المالية ${existing.code} مقفلة بالفعل.`);
      }
      throw new Error(`FISCAL_YEAR_NOT_OPEN: السنة المالية في حالة (${existing.status}) ولا يمكن إقفالها`);
    }

    const fy = await tx.fiscalYear.findUniqueOrThrow({ where: { id: fiscalYearId } });

    const precheck = await runFiscalYearPrecheck(fiscalYearId, tx);
    if (!precheck.canClose) {
      const failed = precheck.checks.filter((c) => !c.passed).map((c) => c.key).join(", ");
      throw new Error(`FISCAL_YEAR_PRECHECK_FAILED: تعذر إقفال السنة المالية (${failed})`);
    }

    // Resolve actor userId
    let actorId = actor.userId;
    if (actorId) {
      const u = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
      if (!u) actorId = undefined;
    }
    if (!actorId) {
      const fallbackUser = await tx.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
      if (!fallbackUser) throw new Error("NO_SYSTEM_USER_FOUND");
      actorId = fallbackUser.id;
    }
    const actorName = actor.userName || "System Administrator";

    // Mark in-progress
    await tx.fiscalYear.update({
      where: { id: fy.id },
      data: { status: "CLOSING_IN_PROGRESS" },
    });

    const settingsRow = await tx.systemSettings.findUnique({ where: { id: "default" } });
    const settings = parseAccountingSettings(settingsRow);
    const reCode = settings.controlAccounts.retainedEarningsAccount || DEFAULT_CONTROL_ACCOUNTS.retainedEarningsAccount;
    const reAccount = await tx.account.findUniqueOrThrow({ where: { code: reCode } });

    const dateRange = { gte: fy.startDate, lte: fy.endDate };

    // Fetch all posted lines in the closing year
    const postedLines = await tx.journalEntryLine.findMany({
      where: {
        journalEntry: {
          status: "POSTED",
          date: dateRange,
          entryType: { not: "YEAR_END_CLOSING" },
        },
      },
      include: { account: true },
    });

    // =========================================================================
    // STEP A: P&L CLOSING ENTRY (YEAR_END_CLOSING) preserving Cost Centers
    // =========================================================================
    const pnlByKey = new Map<
      string,
      { accountId: string; type: string; costCenterId: string | null; netCreditMinusDebit: number }
    >();

    for (const l of postedLines) {
      if (l.account.type !== "REVENUE" && l.account.type !== "EXPENSE") continue;
      const key = `${l.accountId}::${l.costCenterId ?? ""}`;
      const cur = pnlByKey.get(key) ?? {
        accountId: l.accountId,
        type: l.account.type,
        costCenterId: l.costCenterId ?? null,
        netCreditMinusDebit: 0,
      };
      cur.netCreditMinusDebit = round4(cur.netCreditMinusDebit + (lineBaseCredit(l) - lineBaseDebit(l)));
      pnlByKey.set(key, cur);
    }

    const closingLinesData: Array<{
      accountId: string;
      debit: number;
      credit: number;
      currency: string;
      currencyCode: string;
      exchangeRate: number;
      foreignDebit: number;
      foreignCredit: number;
      debitBase: number;
      creditBase: number;
      baseDebit: number;
      baseCredit: number;
      memo: string;
      costCenterId: string | null;
    }> = [];

    let netProfitLossBase = 0;
    for (const grp of pnlByKey.values()) {
      if (Math.abs(grp.netCreditMinusDebit) < 0.005) continue;
      netProfitLossBase = round4(netProfitLossBase + grp.netCreditMinusDebit);
      // To zero out a net-credit balance (Revenue), we DEBIT it. To zero out a net-debit balance (Expense), we CREDIT it.
      const dr = grp.netCreditMinusDebit > 0 ? round4(grp.netCreditMinusDebit) : 0;
      const cr = grp.netCreditMinusDebit < 0 ? round4(Math.abs(grp.netCreditMinusDebit)) : 0;
      closingLinesData.push({
        accountId: grp.accountId,
        debit: dr,
        credit: cr,
        currency: "YER",
        currencyCode: "YER",
        exchangeRate: 1,
        foreignDebit: dr,
        foreignCredit: cr,
        debitBase: dr,
        creditBase: cr,
        baseDebit: dr,
        baseCredit: cr,
        memo: `إقفال ${grp.type === "REVENUE" ? "إيراد" : "مصروف"} السنة المالية ${fy.code}`,
        costCenterId: grp.costCenterId,
      });
    }

    let closingJournalEntryId: string | null = null;
    if (closingLinesData.length > 0) {
      if (Math.abs(netProfitLossBase) >= 0.005) {
        const reDr = netProfitLossBase < 0 ? round4(Math.abs(netProfitLossBase)) : 0;
        const reCr = netProfitLossBase > 0 ? round4(netProfitLossBase) : 0;
        closingLinesData.push({
          accountId: reAccount.id,
          debit: reDr,
          credit: reCr,
          currency: "YER",
          currencyCode: "YER",
          exchangeRate: 1,
          foreignDebit: reDr,
          foreignCredit: reCr,
          debitBase: reDr,
          creditBase: reCr,
          baseDebit: reDr,
          baseCredit: reCr,
          memo:
            netProfitLossBase >= 0
              ? `ترحيل صافي ربح السنة المالية ${fy.code} إلى الأرباح المحتجزة`
              : `ترحيل صافي خسارة السنة المالية ${fy.code} إلى الأرباح المحتجزة`,
          costCenterId: null,
        });
      }

      const closingEntryNumber = `YEC-${fy.code}-${Date.now().toString().slice(-4)}`;
      const closingEntry = await tx.journalEntry.create({
        data: {
          entryNumber: closingEntryNumber,
          date: fy.endDate,
          reference: `CLOSE-${fy.code}`,
          narrationAr: `قيد إقفال الإيرادات والمصروفات للسنة المالية ${fy.code} وترحيل صافي النتيجة للأرباح المحتجزة`,
          narrationEn: `Year-End P&L Closing Entry for ${fy.code} to Retained Earnings`,
          status: "POSTED",
          sourceType: "YEAR_END_CLOSING",
          entryType: "YEAR_END_CLOSING",
          fiscalYearId: fy.id,
          createdById: actorId,
          lines: { create: closingLinesData },
        },
      });
      closingJournalEntryId = closingEntry.id;
    }

    // =========================================================================
    // STEP B: LOCK CLOSED YEAR & ADVANCE periodLockDate
    // =========================================================================
    const closedYear = await tx.fiscalYear.update({
      where: { id: fy.id },
      data: {
        status: "CLOSED",
        closingJournalEntryId,
        retainedEarningsAccountId: reAccount.id,
        netProfitLossBase,
        closedById: actorId,
        closedByName: actorName,
        closedAt: new Date(),
      },
    });

    const nextSpec = computeNextFiscalYearDates(fy.endDate);
    const lockDateStr = fy.endDate.toISOString().slice(0, 10);

    await tx.systemSettings.upsert({
      where: { id: "default" },
      update: {
        periodLockDate: lockDateStr,
        fiscalYearStart: nextSpec.startDate.toISOString().slice(0, 10),
        fiscalYearEnd: nextSpec.endDate.toISOString().slice(0, 10),
      },
      create: {
        id: "default",
        periodLockDate: lockDateStr,
        fiscalYearStart: nextSpec.startDate.toISOString().slice(0, 10),
        fiscalYearEnd: nextSpec.endDate.toISOString().slice(0, 10),
      },
    });

    // =========================================================================
    // STEP C: OPEN NEW FISCAL YEAR & MIGRATE OPENING BALANCES (OPENING)
    // =========================================================================
    let nextFy = await tx.fiscalYear.findUnique({ where: { code: nextSpec.code } });
    if (!nextFy) {
      nextFy = await tx.fiscalYear.create({
        data: {
          code: nextSpec.code,
          nameAr: nextSpec.nameAr,
          nameEn: nextSpec.nameEn,
          startDate: nextSpec.startDate,
          endDate: nextSpec.endDate,
          status: "OPEN",
        },
      });
    }

    // Re-query ALL posted Balance Sheet lines through fy.endDate (INCLUDING the new closing entry on Retained Earnings!)
    const bsLines = await tx.journalEntryLine.findMany({
      where: {
        journalEntry: {
          status: "POSTED",
          date: dateRange,
        },
        account: {
          type: { in: ["ASSET", "LIABILITY", "EQUITY"] },
        },
      },
      include: { account: true },
    });

    const bsGrouped = new Map<
      string,
      {
        accountId: string;
        accountCode: string;
        accountNameAr: string;
        currencyCode: string;
        costCenterId: string | null;
        netBase: number;
        netForeign: number;
      }
    >();

    for (const l of bsLines) {
      const cur = lineCurrency(l);
      const key = `${l.accountId}::${cur}::${l.costCenterId ?? ""}`;
      const grp = bsGrouped.get(key) ?? {
        accountId: l.accountId,
        accountCode: l.account.code,
        accountNameAr: l.account.nameAr,
        currencyCode: cur,
        costCenterId: l.costCenterId ?? null,
        netBase: 0,
        netForeign: 0,
      };
      grp.netBase = round4(grp.netBase + (lineBaseDebit(l) - lineBaseCredit(l)));
      grp.netForeign = round4(grp.netForeign + (lineForeignDebit(l) - lineForeignCredit(l)));
      bsGrouped.set(key, grp);
    }

    const openingLinesData: Array<{
      accountId: string;
      debit: number;
      credit: number;
      currency: string;
      currencyCode: string;
      exchangeRate: number;
      foreignDebit: number;
      foreignCredit: number;
      debitBase: number;
      creditBase: number;
      baseDebit: number;
      baseCredit: number;
      memo: string;
      costCenterId: string | null;
    }> = [];

    let openTotalBaseDr = 0;
    let openTotalBaseCr = 0;

    for (const grp of bsGrouped.values()) {
      if (Math.abs(grp.netBase) < 0.005 && Math.abs(grp.netForeign) < 0.005) continue;
      const isDebit = grp.netBase >= 0;
      const baseAmt = round4(Math.abs(grp.netBase));
      const spotRate =
        grp.currencyCode === "YER"
          ? 1
          : (await resolveClosingSpotRate(tx, grp.currencyCode, fy.endDate)) ??
            (Math.abs(grp.netForeign) > 0 ? round4(baseAmt / Math.abs(grp.netForeign)) : 1);
      const foreignAmt =
        grp.currencyCode === "YER"
          ? baseAmt
          : Math.abs(grp.netForeign) >= 0.0001
          ? round4(Math.abs(grp.netForeign))
          : round4(baseAmt / spotRate);
      const effectiveRate = foreignAmt > 0 ? round4(baseAmt / foreignAmt) : spotRate;

      const drFor = isDebit ? foreignAmt : 0;
      const crFor = isDebit ? 0 : foreignAmt;
      const drBase = isDebit ? baseAmt : 0;
      const crBase = isDebit ? 0 : baseAmt;

      openTotalBaseDr = round4(openTotalBaseDr + drBase);
      openTotalBaseCr = round4(openTotalBaseCr + crBase);

      openingLinesData.push({
        accountId: grp.accountId,
        debit: drFor,
        credit: crFor,
        currency: grp.currencyCode,
        currencyCode: grp.currencyCode,
        exchangeRate: effectiveRate,
        foreignDebit: drFor,
        foreignCredit: crFor,
        debitBase: drBase,
        creditBase: crBase,
        baseDebit: drBase,
        baseCredit: crBase,
        memo: `رصيد افتتاحي مرحل من ${fy.code} — ${grp.accountNameAr}`,
        costCenterId: grp.costCenterId,
      });
    }

    // Sub-unit rounding guard so Opening Entry is 100% strictly balanced
    const openDiff = round4(openTotalBaseDr - openTotalBaseCr);
    if (Math.abs(openDiff) >= 0.005 && openingLinesData.length > 0) {
      const drAdj = openDiff < 0 ? round4(Math.abs(openDiff)) : 0;
      const crAdj = openDiff > 0 ? round4(openDiff) : 0;
      openingLinesData.push({
        accountId: reAccount.id,
        debit: drAdj,
        credit: crAdj,
        currency: "YER",
        currencyCode: "YER",
        exchangeRate: 1,
        foreignDebit: drAdj,
        foreignCredit: crAdj,
        debitBase: drAdj,
        creditBase: crAdj,
        baseDebit: drAdj,
        baseCredit: crAdj,
        memo: `تسوية فروق تقريب الأرصدة الافتتاحية ${nextFy.code}`,
        costCenterId: null,
      });
    }

    let openingJournalEntryId: string | null = null;
    if (openingLinesData.length >= 2) {
      const openingEntryNumber = `OPN-${nextFy.code}-${Date.now().toString().slice(-4)}`;
      const openingEntry = await tx.journalEntry.create({
        data: {
          entryNumber: openingEntryNumber,
          date: nextFy.startDate,
          reference: `OPEN-${nextFy.code}`,
          narrationAr: `القيد الافتتاحي للسنة المالية ${nextFy.code} (أرصدة مرحّلة من ${fy.code})`,
          narrationEn: `Opening Balance Entry for ${nextFy.code} rolled over from ${fy.code}`,
          status: "POSTED",
          sourceType: "OPENING",
          entryType: "OPENING",
          fiscalYearId: nextFy.id,
          createdById: actorId,
          lines: { create: openingLinesData },
        },
      });
      openingJournalEntryId = openingEntry.id;
      nextFy = await tx.fiscalYear.update({
        where: { id: nextFy.id },
        data: { openingJournalEntryId },
      });
    }

    // Roll forward StockBalance snapshot markers (non-mutating OPENING StockMovement audit trail)
    const activeStocks = await tx.stockBalance.findMany({
      where: { qtyOnHandBase: { gt: 0 } },
      include: { item: true, warehouse: true },
    });
    for (const sb of activeStocks) {
      await tx.stockMovement.create({
        data: {
          itemId: sb.itemId,
          warehouseId: sb.warehouseId,
          movementType: "OPENING",
          enteredQty: sb.qtyOnHandBase,
          enteredUnitId: sb.item.baseUnitId,
          factorToBase: 1,
          baseQtyDelta: 0, // StockBalance already holds exact carried-forward qty & avgUnitCostBase
          unitCostBase: sb.avgUnitCostBase,
          referenceType: "FISCAL_YEAR_OPENING",
          referenceId: nextFy.id,
          costCenterId: sb.warehouse.costCenterId ?? null,
          notes: `رصيد افتتاحي مرحل من ${fy.code} (${sb.qtyOnHandBase} @ ${sb.avgUnitCostBase} YER)`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "FISCAL_YEAR_CLOSE",
        entity: "FiscalYear",
        entityId: closedYear.id,
        details: {
          closedFiscalYearCode: closedYear.code,
          nextFiscalYearCode: nextFy.code,
          netProfitLossBase,
          closingJournalEntryId,
          openingJournalEntryId,
          openingLinesMigrated: openingLinesData.length,
          stockBalancesRolledForward: activeStocks.length,
          periodLockDate: lockDateStr,
        },
      },
    });

    return {
      closedFiscalYear: closedYear,
      nextFiscalYear: nextFy,
      netProfitLossBase,
      closingJournalEntryId,
      openingJournalEntryId,
      openingLinesMigrated: openingLinesData.length,
      stockBalancesRolledForward: activeStocks.length,
      periodLockDate: lockDateStr,
    };
  });
}

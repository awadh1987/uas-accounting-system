import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateFinancialReports } from "@/lib/accounting/ledgerService";
import { dAdd, dMul, dSub, round4Decimal } from "@/lib/decimalMath";

type Db = Prisma.TransactionClient | typeof prisma;

const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];
const ENGLISH_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type AccountingPeriodStatus = "OPEN" | "SOFT_CLOSED" | "HARD_CLOSED";

export async function ensurePeriodsForYear(
  year: number,
  fiscalYearId?: string | null,
  client: Db = prisma
) {
  const safeYear = Math.max(2000, Math.min(2100, Math.floor(year)));
  let resolvedFyId = fiscalYearId ?? null;
  if (!resolvedFyId) {
    const fy = await client.fiscalYear.findFirst({
      where: {
        startDate: { lte: new Date(Date.UTC(safeYear, 6, 1)) },
        endDate: { gte: new Date(Date.UTC(safeYear, 6, 1)) },
      },
      select: { id: true },
    });
    resolvedFyId = fy?.id ?? null;
  }

  const createdOrExisting = [];
  for (let month = 1; month <= 12; month++) {
    const code = `${safeYear}-${String(month).padStart(2, "0")}`;
    const existing = await client.accountingPeriod.findUnique({ where: { code } });
    if (existing) {
      createdOrExisting.push(existing);
      continue;
    }
    const startDate = new Date(Date.UTC(safeYear, month - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(safeYear, month, 0, 23, 59, 59, 999));
    const row = await client.accountingPeriod.create({
      data: {
        fiscalYearId: resolvedFyId,
        year: safeYear,
        month,
        code,
        nameAr: `${ARABIC_MONTHS[month - 1]} ${safeYear}`,
        nameEn: `${ENGLISH_MONTHS[month - 1]} ${safeYear}`,
        startDate,
        endDate,
        status: "OPEN",
      },
    });
    createdOrExisting.push(row);
  }
  return createdOrExisting;
}

export async function listAccountingPeriods(
  filters: { year?: number; fiscalYearId?: string } = {},
  client: Db = prisma
) {
  if (filters.year) {
    await ensurePeriodsForYear(filters.year, filters.fiscalYearId ?? null, client);
  }
  return client.accountingPeriod.findMany({
    where: {
      ...(filters.year ? { year: filters.year } : {}),
      ...(filters.fiscalYearId ? { fiscalYearId: filters.fiscalYearId } : {}),
    },
    orderBy: [{ year: "desc" }, { month: "asc" }],
  });
}

/**
 * Enforces monthly AccountingPeriod locks inside postJournalEntry():
 * - HARD_CLOSED blocks ALL postings unconditionally (except YEAR_END_CLOSING/OPENING if bypassed before calling).
 * - SOFT_CLOSED blocks normal operational postings unless `allowLockedAdjustment` is true.
 */
export async function assertDateInOpenAccountingPeriod(
  tx: Db,
  entryDate: Date,
  options: { allowSoftCloseOverride?: boolean } = {}
) {
  const year = entryDate.getUTCFullYear();
  const month = entryDate.getUTCMonth() + 1;
  const code = `${year}-${String(month).padStart(2, "0")}`;

  const period = await tx.accountingPeriod.findFirst({
    where: {
      OR: [
        { code },
        { startDate: { lte: entryDate }, endDate: { gte: entryDate } },
      ],
    },
  });

  if (!period) return;

  if (period.status === "HARD_CLOSED") {
    throw new Error(
      `PERIOD_HARD_CLOSED: الفترة المحاسبية الشهرية (${period.code} - ${period.nameAr}) مقفلة إقفالاً نهائياً ولا تقبل أي قيود.`
    );
  }

  if (period.status === "SOFT_CLOSED" && !options.allowSoftCloseOverride) {
    throw new Error(
      `PERIOD_SOFT_CLOSED: الفترة المحاسبية (${period.code} - ${period.nameAr}) مقفلة إقفالاً مؤقتاً (Soft Close). يتطلب صلاحية قيود التسوية لترحيلها.`
    );
  }
}

export async function runPeriodCloseChecklist(
  periodId: string,
  client: Db = prisma
) {
  const period = await client.accountingPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error("ACCOUNTING_PERIOD_NOT_FOUND");

  const [pendingApprovals, activeDrafts, stockBalances, reports] = await Promise.all([
    client.approvalRequest.count({
      where: {
        status: "PENDING",
        createdAt: { gte: period.startDate, lte: period.endDate },
      },
    }),
    client.workspaceDraft.count({
      where: {
        status: "ACTIVE_DRAFT",
        createdAt: { gte: period.startDate, lte: period.endDate },
      },
    }),
    client.stockBalance.findMany({
      select: { qtyOnHandBase: true, avgUnitCostBase: true },
    }),
    generateFinancialReports({
      toDate: period.endDate,
    }),
  ]);

  const inventorySubLedgerValue = round4Decimal(
    stockBalances.reduce(
      (sum, sb) => dAdd(sum, dMul(Number(sb.qtyOnHandBase), Number(sb.avgUnitCostBase), 4), 4),
      0
    )
  );
  const glInventoryValue = round4Decimal(
    reports.balanceSheet.assetLines
      .filter((a) => a.code.startsWith("113"))
      .reduce((sum, a) => dAdd(sum, Number(a.balance), 4), 0)
  );
  const inventoryGlVariance = round4Decimal(dSub(inventorySubLedgerValue, glInventoryValue, 4));

  const recentFxReval = await client.journalEntry.count({
    where: {
      sourceType: "FX_REVALUATION",
      status: "POSTED",
      date: { gte: period.startDate, lte: period.endDate },
    },
  });

  return {
    period,
    checks: {
      pendingApprovals,
      activeDrafts,
      inventorySubLedgerValue,
      glInventoryValue,
      inventoryGlVariance,
      isInventoryTiedToGl: Math.abs(inventoryGlVariance) <= 1,
      hasFxRevaluationRun: recentFxReval > 0,
      trialBalanceBalanced: reports.trialBalance.isBalanced,
    },
  };
}

export async function updateAccountingPeriodStatus(input: {
  periodId: string;
  status: AccountingPeriodStatus;
  actorUserId?: string | null;
  notes?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.accountingPeriod.findUnique({ where: { id: input.periodId } });
    if (!existing) throw new Error("ACCOUNTING_PERIOD_NOT_FOUND");
    if (existing.status === "HARD_CLOSED" && input.status !== "HARD_CLOSED") {
      // Allow reopening only by updating explicitly (guarded by API route RBAC)
    }

    const updated = await tx.accountingPeriod.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        closedById: input.status === "OPEN" ? null : input.actorUserId ?? null,
        closedAt: input.status === "OPEN" ? null : new Date(),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (input.actorUserId) {
      await tx.auditLog.create({
        data: {
          userId: input.actorUserId,
          action: "PERIOD_STATUS_UPDATE",
          entity: "AccountingPeriod",
          entityId: updated.id,
          details: { code: updated.code, from: existing.status, to: updated.status },
        },
      });
    }

    return updated;
  });
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateFinancialReports } from "@/lib/accounting/ledgerService";
import { dAdd, dDiv, dMul, dSub, round2Decimal, round4Decimal } from "@/lib/decimalMath";

type Db = Prisma.TransactionClient | typeof prisma;

function buildDateFilter(fromDate?: string | Date, toDate?: string | Date): Prisma.DateTimeFilter {
  const df: Prisma.DateTimeFilter = {};
  if (fromDate) df.gte = new Date(fromDate);
  if (toDate) {
    const end = new Date(toDate);
    if (typeof toDate === "string" && toDate.length <= 10) {
      end.setUTCHours(23, 59, 59, 999);
    }
    df.lte = end;
  }
  return df;
}

/**
 * Step 3.1: IAS 7 Cash Flow Statement (Indirect & Direct Methods)
 * Reconciles Net Profit + Working Capital Changes + Investing + Financing to Cash & Bank Balances.
 */
export async function generateCashFlowStatement(
  filters: { fromDate?: string | Date; toDate?: string | Date; projectId?: string; costCenterId?: string } = {},
  client: Db = prisma
) {
  const fromDt = filters.fromDate ? new Date(filters.fromDate) : null;
  const endDt = filters.toDate
    ? (() => {
        const d = new Date(filters.toDate);
        if (typeof filters.toDate === "string" && filters.toDate.length <= 10) {
          d.setUTCHours(23, 59, 59, 999);
        }
        return d;
      })()
    : new Date();

  const openingToDate = fromDt ? new Date(fromDt.getTime() - 1) : null;

  const [periodReports, openingReports, periodLines] = await Promise.all([
    generateFinancialReports({
      fromDate: filters.fromDate,
      toDate: endDt,
      projectId: filters.projectId,
      costCenterId: filters.costCenterId,
    }),
    openingToDate
      ? generateFinancialReports({
          toDate: openingToDate,
          projectId: filters.projectId,
          costCenterId: filters.costCenterId,
        })
      : Promise.resolve(null),
    client.journalEntryLine.findMany({
      where: {
        ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
        ...(filters.costCenterId && filters.costCenterId !== "ALL" ? { costCenterId: filters.costCenterId } : {}),
        journalEntry: {
          status: "POSTED",
          documentStatus: "POSTED",
          entryType: { notIn: ["YEAR_END_CLOSING", "OPENING"] },
          ...(filters.fromDate || filters.toDate ? { date: buildDateFilter(filters.fromDate, endDt) } : {}),
        },
      },
      include: {
        account: { select: { code: true, type: true } },
        journalEntry: { select: { sourceType: true } },
      },
    }),
  ]);

  const sumCode = (lines: Array<{ code: string; balance: number }>, prefix: string) =>
    lines.filter((l) => l.code.startsWith(prefix)).reduce((s, l) => dAdd(s, l.balance, 4), 0);

  const openBs = openingReports?.balanceSheet;
  const closeBs = periodReports.balanceSheet;

  const openingCash = openBs ? round4Decimal(sumCode(openBs.assetLines, "111")) : 0;
  const closingCash = round4Decimal(sumCode(closeBs.assetLines, "111"));

  const openAr = openBs ? sumCode(openBs.assetLines, "112") + sumCode(openBs.assetLines, "114") : 0;
  const closeAr = sumCode(closeBs.assetLines, "112") + sumCode(closeBs.assetLines, "114");
  const changeInReceivables = round4Decimal(dSub(openAr, closeAr, 4)); // Increase in AR is cash outflow

  const openInv = openBs ? sumCode(openBs.assetLines, "113") : 0;
  const closeInv = sumCode(closeBs.assetLines, "113");
  const changeInInventory = round4Decimal(dSub(openInv, closeInv, 4));

  const openAp = openBs ? sumCode(openBs.liabilityLines, "21") : 0;
  const closeAp = sumCode(closeBs.liabilityLines, "21");
  const changeInPayables = round4Decimal(dSub(closeAp, openAp, 4)); // Increase in AP is cash inflow

  const openFixed = openBs ? sumCode(openBs.assetLines, "12") : 0;
  const closeFixed = sumCode(closeBs.assetLines, "12");
  const investingCashFlow = round4Decimal(dSub(openFixed, closeFixed, 4));

  const openEquity = openBs ? openBs.contributedEquity : 0;
  const closeEquity = closeBs.contributedEquity;
  const openNonCurrentLiab = openBs ? sumCode(openBs.liabilityLines, "22") : 0;
  const closeNonCurrentLiab = sumCode(closeBs.liabilityLines, "22");
  const financingCashFlow = round4Decimal(
    dAdd(dSub(closeEquity, openEquity, 4), dSub(closeNonCurrentLiab, openNonCurrentLiab, 4), 4)
  );

  // Exclude prior closing/retained shift if rolled over inside period; true period net profit comes from P&L
  const netProfit = periodReports.incomeStatement.netProfit;
  const indirectOperatingCashFlow = round4Decimal(
    dAdd(dAdd(netProfit, changeInReceivables, 4), dAdd(changeInInventory, changeInPayables, 4), 4)
  );
  const netCashFlow = round4Decimal(
    dAdd(indirectOperatingCashFlow, dAdd(investingCashFlow, financingCashFlow, 4), 4)
  );

  // Direct Method from cash-account postings in the period
  let directReceiptsFromCustomers = 0;
  let directPaidToSuppliersAndExpenses = 0;
  let directPaidToEmployees = 0;
  let directFinancingOrCapital = 0;
  let directInvesting = 0;

  for (const line of periodLines) {
    if (!line.account.code.startsWith("111")) continue;
    const netDelta = dSub(Number(line.baseDebit), Number(line.baseCredit), 4);
    const st = (line.journalEntry.sourceType || "").toUpperCase();
    if (st === "TREASURY_TRANSFER") continue; // internal cash movement nets to zero
    if (st.includes("RECEIPT") || st === "BANK_GATEWAY_COLLECTION" || st === "INSTALLMENT") {
      directReceiptsFromCustomers = dAdd(directReceiptsFromCustomers, netDelta, 4);
    } else if (st.includes("WORKER")) {
      directPaidToEmployees = dAdd(directPaidToEmployees, netDelta, 4);
    } else if (st.includes("TREASURY_OPENING") || st.includes("CAPITAL")) {
      directFinancingOrCapital = dAdd(directFinancingOrCapital, netDelta, 4);
    } else if (st.includes("ASSET")) {
      directInvesting = dAdd(directInvesting, netDelta, 4);
    } else if (netDelta >= 0) {
      directReceiptsFromCustomers = dAdd(directReceiptsFromCustomers, netDelta, 4);
    } else {
      directPaidToSuppliersAndExpenses = dAdd(directPaidToSuppliersAndExpenses, netDelta, 4);
    }
  }

  const directOperatingCashFlow = round4Decimal(
    dAdd(directReceiptsFromCustomers, dAdd(directPaidToSuppliersAndExpenses, directPaidToEmployees, 4), 4)
  );

  return {
    filters: periodReports.filters,
    indirectMethod: {
      netProfit,
      adjustments: {
        changeInReceivables,
        changeInInventory,
        changeInPayables,
      },
      operatingCashFlow: indirectOperatingCashFlow,
      investingCashFlow,
      financingCashFlow,
      netChangeInCash: netCashFlow,
    },
    directMethod: {
      cashReceiptsFromCustomers: round4Decimal(directReceiptsFromCustomers),
      cashPaidToSuppliersAndExpenses: round4Decimal(directPaidToSuppliersAndExpenses),
      cashPaidToEmployees: round4Decimal(directPaidToEmployees),
      operatingCashFlow: directOperatingCashFlow,
      investingCashFlow: round4Decimal(directInvesting),
      financingCashFlow: round4Decimal(directFinancingOrCapital),
    },
    reconciliation: {
      openingCashBalance: openingCash,
      closingCashBalance: closingCash,
      actualCashChange: round4Decimal(dSub(closingCash, openingCash, 4)),
    },
  };
}

/**
 * Step 3.1: Statement of Changes in Equity
 */
export async function generateStatementOfChangesInEquity(
  filters: { fromDate?: string | Date; toDate?: string | Date; projectId?: string } = {}
) {
  const fromDt = filters.fromDate ? new Date(filters.fromDate) : null;
  const openingToDate = fromDt ? new Date(fromDt.getTime() - 1) : null;

  const [periodReports, openingReports] = await Promise.all([
    generateFinancialReports({
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      projectId: filters.projectId,
    }),
    openingToDate
      ? generateFinancialReports({
          toDate: openingToDate,
          projectId: filters.projectId,
        })
      : Promise.resolve(null),
  ]);

  const openingEquity = openingReports ? openingReports.balanceSheet.totalEquity : 0;
  const closingContributedEquity = periodReports.balanceSheet.contributedEquity;
  const openingContributedEquity = openingReports ? openingReports.balanceSheet.contributedEquity : 0;
  const capitalChanges = round4Decimal(dSub(closingContributedEquity, openingContributedEquity, 4));
  const netProfitForPeriod = periodReports.incomeStatement.netProfit;
  const closingEquity = periodReports.balanceSheet.totalEquity;

  return {
    openingEquity: round4Decimal(openingEquity),
    capitalAndReserveMovements: capitalChanges,
    netProfitForPeriod: round4Decimal(netProfitForPeriod),
    closingEquity: round4Decimal(closingEquity),
    equityBreakdown: periodReports.balanceSheet.equityLines,
  };
}

/**
 * Step 3.1: AR & AP Aging Report (uses dueDate ?? date)
 */
export async function generateAgingReport(
  params: { type: "AR" | "AP"; asOfDate?: string | Date; projectId?: string },
  client: Db = prisma
) {
  const asOf = params.asOfDate
    ? (() => {
        const d = new Date(params.asOfDate);
        if (typeof params.asOfDate === "string" && params.asOfDate.length <= 10) {
          d.setUTCHours(23, 59, 59, 999);
        }
        return d;
      })()
    : new Date();

  const bucketFor = (dueDt: Date) => {
    const diffDays = Math.floor((asOf.getTime() - dueDt.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "current" as const;
    if (diffDays <= 30) return "days1_30" as const;
    if (diffDays <= 60) return "days31_60" as const;
    if (diffDays <= 90) return "days61_90" as const;
    return "days90Plus" as const;
  };

  type AgingRow = {
    partyId: string;
    partyCode: string;
    partyName: string;
    current: number;
    days1_30: number;
    days31_60: number;
    days61_90: number;
    days90Plus: number;
    totalOpen: number;
    documentsCount: number;
  };

  const map = new Map<string, AgingRow>();

  if (params.type === "AR") {
    const invoices = await client.salesInvoice.findMany({
      where: {
        balanceDue: { gt: 0.005 },
        status: { not: "VOIDED" },
        documentStatus: { not: "VOIDED" },
        invoiceType: { not: "CREDIT_NOTE" },
        date: { lte: asOf },
        ...(params.projectId && params.projectId !== "ALL" ? { projectId: params.projectId } : {}),
      },
      include: { customer: { select: { id: true, code: true, nameAr: true } } },
    });

    for (const inv of invoices) {
      const due = inv.dueDate || inv.date;
      const bucket = bucketFor(due);
      const amtBase = round4Decimal(dMul(Number(inv.balanceDue), Number(inv.exchangeRate) || 1, 4));
      const row = map.get(inv.customerId) || {
        partyId: inv.customerId,
        partyCode: inv.customer.code,
        partyName: inv.customer.nameAr,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days90Plus: 0,
        totalOpen: 0,
        documentsCount: 0,
      };
      row[bucket] = round4Decimal(dAdd(row[bucket], amtBase, 4));
      row.totalOpen = round4Decimal(dAdd(row.totalOpen, amtBase, 4));
      row.documentsCount += 1;
      map.set(inv.customerId, row);
    }
  } else {
    const bills = await client.vendorBill.findMany({
      where: {
        balanceDue: { gt: 0.005 },
        status: { not: "VOIDED" },
        documentStatus: { not: "VOIDED" },
        billType: { not: "CREDIT_NOTE" },
        date: { lte: asOf },
        ...(params.projectId && params.projectId !== "ALL" ? { projectId: params.projectId } : {}),
      },
      include: { vendor: { select: { id: true, code: true, nameAr: true } } },
    });

    for (const bill of bills) {
      const due = bill.dueDate || bill.date;
      const bucket = bucketFor(due);
      const amtBase = round4Decimal(dMul(Number(bill.balanceDue), Number(bill.exchangeRate) || 1, 4));
      const row = map.get(bill.vendorId) || {
        partyId: bill.vendorId,
        partyCode: bill.vendor.code,
        partyName: bill.vendor.nameAr,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days90Plus: 0,
        totalOpen: 0,
        documentsCount: 0,
      };
      row[bucket] = round4Decimal(dAdd(row[bucket], amtBase, 4));
      row.totalOpen = round4Decimal(dAdd(row.totalOpen, amtBase, 4));
      row.documentsCount += 1;
      map.set(bill.vendorId, row);
    }
  }

  const rows = Array.from(map.values()).sort((a, b) => b.totalOpen - a.totalOpen);
  const totals = rows.reduce(
    (acc, r) => ({
      current: round4Decimal(dAdd(acc.current, r.current, 4)),
      days1_30: round4Decimal(dAdd(acc.days1_30, r.days1_30, 4)),
      days31_60: round4Decimal(dAdd(acc.days31_60, r.days31_60, 4)),
      days61_90: round4Decimal(dAdd(acc.days61_90, r.days61_90, 4)),
      days90Plus: round4Decimal(dAdd(acc.days90Plus, r.days90Plus, 4)),
      totalOpen: round4Decimal(dAdd(acc.totalOpen, r.totalOpen, 4)),
    }),
    { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0, totalOpen: 0 }
  );

  return { type: params.type, asOfDate: asOf.toISOString(), rows, totals };
}

/**
 * Step 3.1: GL-Derived Customer / Vendor / Account Running-Balance Statement
 */
export async function generateEntityOrAccountStatement(
  params: {
    entityType: "CUSTOMER" | "VENDOR" | "ACCOUNT";
    entityId: string;
    fromDate?: string | Date;
    toDate?: string | Date;
  },
  client: Db = prisma
) {
  let accountId = params.entityId;
  let titleAr = "";
  let code = "";
  let normalCredit = false;

  if (params.entityType === "CUSTOMER") {
    const cust = await client.customer.findUnique({
      where: { id: params.entityId },
      include: { account: { select: { id: true, code: true, nameAr: true } } },
    });
    if (!cust) throw new Error("CUSTOMER_NOT_FOUND");
    accountId = cust.accountId;
    titleAr = cust.nameAr;
    code = cust.code;
  } else if (params.entityType === "VENDOR") {
    const vendor = await client.vendor.findUnique({
      where: { id: params.entityId },
      include: { account: { select: { id: true, code: true, nameAr: true } } },
    });
    if (!vendor) throw new Error("VENDOR_NOT_FOUND");
    accountId = vendor.accountId;
    titleAr = vendor.nameAr;
    code = vendor.code;
    normalCredit = true;
  } else {
    const acc = await client.account.findFirst({
      where: { OR: [{ id: params.entityId }, { code: params.entityId }] },
    });
    if (!acc) throw new Error("ACCOUNT_NOT_FOUND");
    accountId = acc.id;
    titleAr = acc.nameAr;
    code = acc.code;
    normalCredit = acc.type === "LIABILITY" || acc.type === "EQUITY" || acc.type === "REVENUE";
  }

  const fromDt = params.fromDate ? new Date(params.fromDate) : null;
  const endDt = params.toDate
    ? (() => {
        const d = new Date(params.toDate);
        if (typeof params.toDate === "string" && params.toDate.length <= 10) {
          d.setUTCHours(23, 59, 59, 999);
        }
        return d;
      })()
    : null;

  let openingBalance = 0;
  if (fromDt) {
    const priorLines = await client.journalEntryLine.findMany({
      where: {
        accountId,
        journalEntry: {
          status: "POSTED",
          documentStatus: "POSTED",
          entryType: { not: "YEAR_END_CLOSING" },
          date: { lt: fromDt },
        },
      },
      select: { baseDebit: true, baseCredit: true },
    });
    for (const pl of priorLines) {
      const delta = normalCredit
        ? dSub(Number(pl.baseCredit), Number(pl.baseDebit), 4)
        : dSub(Number(pl.baseDebit), Number(pl.baseCredit), 4);
      openingBalance = dAdd(openingBalance, delta, 4);
    }
  }

  const lines = await client.journalEntryLine.findMany({
    where: {
      accountId,
      journalEntry: {
        status: "POSTED",
        documentStatus: "POSTED",
        entryType: { not: "YEAR_END_CLOSING" },
        ...(fromDt || endDt
          ? {
              date: {
                ...(fromDt ? { gte: fromDt } : {}),
                ...(endDt ? { lte: endDt } : {}),
              },
            }
          : {}),
      },
    },
    include: {
      journalEntry: {
        select: {
          id: true,
          entryNumber: true,
          date: true,
          reference: true,
          narrationAr: true,
          sourceType: true,
          sourceId: true,
        },
      },
    },
    orderBy: [{ journalEntry: { date: "asc" } }, { id: "asc" }],
  });

  let runningBalance = round4Decimal(openingBalance);
  const rows = lines.map((l) => {
    const debitBase = Number(l.baseDebit);
    const creditBase = Number(l.baseCredit);
    const delta = normalCredit
      ? dSub(creditBase, debitBase, 4)
      : dSub(debitBase, creditBase, 4);
    runningBalance = round4Decimal(dAdd(runningBalance, delta, 4));
    return {
      lineId: l.id,
      journalEntryId: l.journalEntryId,
      entryNumber: l.journalEntry.entryNumber,
      date: l.journalEntry.date.toISOString(),
      reference: l.journalEntry.reference,
      sourceType: l.journalEntry.sourceType,
      sourceId: l.journalEntry.sourceId,
      memo: l.memo || l.journalEntry.narrationAr,
      currencyCode: l.currencyCode,
      foreignDebit: Number(l.foreignDebit),
      foreignCredit: Number(l.foreignCredit),
      debitBase,
      creditBase,
      runningBalance,
    };
  });

  return {
    entityType: params.entityType,
    accountId,
    code,
    titleAr,
    normalSide: normalCredit ? "CREDIT" : "DEBIT",
    openingBalance: round4Decimal(openingBalance),
    closingBalance: runningBalance,
    rows,
  };
}

/**
 * Step 3.1: Financial Ratios & Liquidity / Profitability Metrics
 */
export async function generateFinancialRatios(filters: {
  fromDate?: string | Date;
  toDate?: string | Date;
  projectId?: string;
} = {}) {
  const reports = await generateFinancialReports(filters);
  const bs = reports.balanceSheet;
  const pl = reports.incomeStatement;

  const currentAssets = bs.assetLines
    .filter((a) => a.code.startsWith("11"))
    .reduce((s, a) => dAdd(s, a.balance, 4), 0);
  const inventoryAssets = bs.assetLines
    .filter((a) => a.code.startsWith("113"))
    .reduce((s, a) => dAdd(s, a.balance, 4), 0);
  const arAssets = bs.assetLines
    .filter((a) => a.code.startsWith("112"))
    .reduce((s, a) => dAdd(s, a.balance, 4), 0);
  const currentLiabilities = bs.liabilityLines
    .filter((l) => l.code.startsWith("21"))
    .reduce((s, l) => dAdd(s, l.balance, 4), 0);
  const apLiabilities = bs.liabilityLines
    .filter((l) => l.code.startsWith("211"))
    .reduce((s, l) => dAdd(s, l.balance, 4), 0);

  const currentRatio = currentLiabilities > 0 ? round2Decimal(dDiv(currentAssets, currentLiabilities, 4)) : 0;
  const quickRatio =
    currentLiabilities > 0
      ? round2Decimal(dDiv(dSub(currentAssets, inventoryAssets, 4), currentLiabilities, 4))
      : 0;
  const grossMarginPct = pl.totalRevenue > 0 ? round2Decimal(dMul(dDiv(pl.grossProfit, pl.totalRevenue, 6), 100, 4)) : 0;
  const netMarginPct = pl.totalRevenue > 0 ? round2Decimal(dMul(dDiv(pl.netProfit, pl.totalRevenue, 6), 100, 4)) : 0;
  const returnOnAssetsPct =
    bs.totalAssets > 0 ? round2Decimal(dMul(dDiv(pl.netProfit, bs.totalAssets, 6), 100, 4)) : 0;
  const debtToEquity = bs.totalEquity > 0 ? round2Decimal(dDiv(bs.totalLiabilities, bs.totalEquity, 4)) : 0;
  const arDaysDso = pl.totalRevenue > 0 ? round2Decimal(dMul(dDiv(arAssets, pl.totalRevenue, 6), 365, 4)) : 0;
  const apDaysDpo = pl.totalCogs > 0 ? round2Decimal(dMul(dDiv(apLiabilities, pl.totalCogs, 6), 365, 4)) : 0;

  return {
    liquidity: {
      currentAssets: round4Decimal(currentAssets),
      currentLiabilities: round4Decimal(currentLiabilities),
      currentRatio,
      quickRatio,
    },
    profitability: {
      grossMarginPct,
      netMarginPct,
      returnOnAssetsPct,
    },
    leverage: {
      debtToEquity,
    },
    efficiency: {
      arDaysDso,
      apDaysDpo,
    },
  };
}

/**
 * Step 3.1: Click-Through Account & Voucher Drill-Down Lines
 */
export async function getAccountDrilldownLines(
  params: {
    accountId?: string;
    accountCode?: string;
    fromDate?: string | Date;
    toDate?: string | Date;
    projectId?: string;
    subProjectId?: string;
    costCenterId?: string;
  },
  client: Db = prisma
) {
  let targetAccIds: string[] = [];
  if (params.accountId) {
    targetAccIds = [params.accountId];
  } else if (params.accountCode) {
    const acc = await client.account.findUnique({ where: { code: params.accountCode } });
    if (acc) {
      if (acc.isPosting) {
        targetAccIds = [acc.id];
      } else {
        // Summary node: include all descendant posting leaves whose code starts with non-zero prefix or parent subtree
        const allAccs = await client.account.findMany({ where: { isPosting: true } });
        const byParent = new Map<string, string[]>();
        const allWithParent = await client.account.findMany({ select: { id: true, parentId: true } });
        for (const a of allWithParent) {
          if (a.parentId) {
            const arr = byParent.get(a.parentId) || [];
            arr.push(a.id);
            byParent.set(a.parentId, arr);
          }
        }
        const descendantIds = new Set<string>([acc.id]);
        const stack = [acc.id];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          for (const childId of byParent.get(cur) || []) {
            if (!descendantIds.has(childId)) {
              descendantIds.add(childId);
              stack.push(childId);
            }
          }
        }
        targetAccIds = allAccs.filter((a) => descendantIds.has(a.id)).map((a) => a.id);
      }
    }
  }

  if (targetAccIds.length === 0) return [];

  const lines = await client.journalEntryLine.findMany({
    where: {
      accountId: { in: targetAccIds },
      ...(params.projectId && params.projectId !== "ALL" ? { projectId: params.projectId } : {}),
      ...(params.subProjectId && params.subProjectId !== "ALL" ? { subProjectId: params.subProjectId } : {}),
      ...(params.costCenterId && params.costCenterId !== "ALL" ? { costCenterId: params.costCenterId } : {}),
      journalEntry: {
        status: "POSTED",
        documentStatus: "POSTED",
        entryType: { not: "YEAR_END_CLOSING" },
        ...(params.fromDate || params.toDate ? { date: buildDateFilter(params.fromDate, params.toDate) } : {}),
      },
    },
    include: {
      account: { select: { code: true, nameAr: true } },
      journalEntry: {
        select: {
          id: true,
          entryNumber: true,
          date: true,
          reference: true,
          narrationAr: true,
          sourceType: true,
          sourceId: true,
        },
      },
      costCenter: { select: { code: true, nameAr: true } },
    },
    orderBy: [{ journalEntry: { date: "desc" } }],
    take: 250,
  });

  return lines.map((l) => ({
    lineId: l.id,
    journalEntryId: l.journalEntryId,
    entryNumber: l.journalEntry.entryNumber,
    date: l.journalEntry.date.toISOString(),
    reference: l.journalEntry.reference,
    narrationAr: l.journalEntry.narrationAr,
    sourceType: l.journalEntry.sourceType,
    sourceId: l.journalEntry.sourceId,
    accountCode: l.account.code,
    accountNameAr: l.account.nameAr,
    costCenterCode: l.costCenter?.code || null,
    costCenterNameAr: l.costCenter?.nameAr || null,
    currencyCode: l.currencyCode,
    debitBase: Number(l.baseDebit),
    creditBase: Number(l.baseCredit),
    memo: l.memo,
  }));
}

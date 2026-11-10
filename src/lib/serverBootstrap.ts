import crypto from "node:crypto";
import type {
  CurrencyRate,
  HarvestCycle,
  HarvestInventoryBatch,
  ImmutableAuditLog,
  InstallmentVoucher,
  OperatingExpense,
  Prisma,
  SaleTransaction,
  SystemSettings,
  TreasuryAccount,
  WorkerWageEntry,
} from "@prisma/client";
import { formatAuditTimestamp, type CurrencyCode } from "@/lib/formulas";
import { prisma } from "@/lib/prisma";
import type {
  UasAuditLog,
  UasBootstrapState,
  UasInstallmentVoucher,
  UasInventoryBatch,
  UasOperatingExpense,
  UasProject,
  UasSaleTransaction,
  UasSystemSettings,
  UasTreasuryAccount,
  UasWorkerWage,
} from "@/types/uas";

type ProjectWithCycles = Prisma.ProjectGetPayload<{
  include: { harvestCycles: true };
}>;

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function generateAuditHash(payload: string): string {
  return (
    "UAS-" +
    crypto
      .createHash("sha256")
      .update(`${payload}:${Date.now()}`)
      .digest("hex")
      .slice(0, 6)
      .toUpperCase()
  );
}

export async function findHarvestCycle(
  tx: Prisma.TransactionClient,
  projectId: string,
  harvestName: string
): Promise<HarvestCycle | null> {
  return tx.harvestCycle.findFirst({
    where: {
      projectId,
      name: harvestName,
    },
  });
}

export async function isHarvestLockedTx(
  tx: Prisma.TransactionClient,
  projectId: string,
  harvestName: string
): Promise<boolean> {
  const cycle = await findHarvestCycle(tx, projectId, harvestName);
  return Boolean(cycle?.isLocked);
}

export async function appendAuditLogTx(
  tx: Prisma.TransactionClient,
  input: {
    userId?: string | null;
    userDisplay: string;
    userRole: string;
    actionType: string;
    entityReference: string;
    details: string;
  }
): Promise<ImmutableAuditLog> {
  const timestamp = formatAuditTimestamp(new Date());
  const sha256Hash = generateAuditHash(
    `${timestamp}|${input.userDisplay}|${input.actionType}|${input.entityReference}|${input.details}`
  );
  return tx.immutableAuditLog.create({
    data: {
      timestamp,
      userId: input.userId ?? null,
      userDisplay: input.userDisplay,
      userRole: input.userRole,
      actionType: input.actionType,
      entityReference: input.entityReference,
      details: input.details,
      sha256Hash,
    },
  });
}

function mapSettings(settingsRow: SystemSettings | null): UasSystemSettings {
  return {
    orgName:
      settingsRow?.orgName || "النظام المحاسبي الموحد Unified Accounting System (UAS)",
    logoText: settingsRow?.logoText || "UAS",
    defaultLang: settingsRow?.defaultLang === "en" ? "en" : "ar",
    defaultTheme:
      settingsRow?.defaultTheme === "dark" || settingsRow?.defaultTheme === "royal"
        ? settingsRow.defaultTheme
        : "emerald",
    defaultCurrency:
      settingsRow?.defaultCurrency === "SAR" || settingsRow?.defaultCurrency === "USD"
        ? settingsRow.defaultCurrency
        : "YER",
  };
}

function mapExchangeRates(rates: CurrencyRate[]): Record<CurrencyCode, number> {
  const exchangeRates: Record<CurrencyCode, number> = {
    YER: 1,
    SAR: 425,
    USD: 1620,
  };
  for (const r of rates) {
    if (r.currencyCode === "YER" || r.currencyCode === "SAR" || r.currencyCode === "USD") {
      exchangeRates[r.currencyCode] = r.rateToYER;
    }
  }
  return exchangeRates;
}

function mapProjects(projects: ProjectWithCycles[]): {
  mappedProjects: UasProject[];
  lockedPeriods: Record<string, boolean>;
} {
  const lockedPeriods: Record<string, boolean> = {};
  const mappedProjects: UasProject[] = projects.map((p: ProjectWithCycles) => {
    for (const hc of p.harvestCycles) {
      lockedPeriods[`${p.id}::${hc.name}`] = hc.isLocked;
    }
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      parentProjectId: p.parentProjectId || "",
      estimatedValue: p.estimatedValue,
      plannedHarvests: p.plannedHarvestCount,
      notes: p.notes,
      harvests: p.harvestCycles.map((hc: HarvestCycle) => hc.name),
      harvestCycles: p.harvestCycles.map((hc: HarvestCycle) => ({
        id: hc.id,
        projectId: hc.projectId,
        name: hc.name,
        sortOrder: hc.sortOrder,
        isLocked: hc.isLocked,
      })),
    };
  });
  return { mappedProjects, lockedPeriods };
}

function mapTreasury(accounts: TreasuryAccount[]): UasTreasuryAccount[] {
  return accounts.map((t: TreasuryAccount) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    accountNo: t.accountNumber,
    currencyCode: t.currencyCode,
    balanceYER: t.balanceYER,
  }));
}

function mapInstallments(installments: InstallmentVoucher[]): UasInstallmentVoucher[] {
  return installments.map((inst: InstallmentVoucher) => ({
    id: inst.id,
    voucherNo: inst.voucherNo,
    type: inst.type,
    targetId: inst.saleTransactionId || inst.workerWageEntryId || "",
    targetName: inst.targetName,
    phone: inst.phone,
    treasuryId: inst.treasuryAccountId,
    amount: inst.amountYER,
    qrVerificationHash: inst.qrVerificationHash,
    date: inst.paymentDate,
    notes: inst.notes,
  }));
}

function mapInventory(batches: HarvestInventoryBatch[]): UasInventoryBatch[] {
  return batches.map((b: HarvestInventoryBatch) => ({
    id: b.id,
    projectId: b.projectId,
    harvest: b.harvestName,
    grade: b.productGrade,
    harvestedBundles: b.harvestedBundles,
    shrinkageBundles: b.shrinkageBundles,
    notes: b.notes,
  }));
}

function mapAuditLogs(logs: ImmutableAuditLog[]): UasAuditLog[] {
  return logs.map((a: ImmutableAuditLog) => ({
    id: a.id,
    timestamp: a.timestamp,
    user: a.userDisplay,
    action: a.actionType,
    details: a.details,
    hash: a.sha256Hash,
  }));
}

function mapExpenses(expenses: OperatingExpense[]): UasOperatingExpense[] {
  return expenses.map((e: OperatingExpense) => ({
    id: e.id,
    projectId: e.projectId,
    harvest: e.harvestName,
    category: e.category,
    subType: e.subType,
    qty: e.quantity,
    unitPrice: e.unitPrice,
    total: e.totalAmount,
    date: e.expenseDate,
    notes: e.notes,
  }));
}

function mapWorkers(workers: WorkerWageEntry[]): UasWorkerWage[] {
  return workers.map((w: WorkerWageEntry) => ({
    id: w.id,
    workerId: w.workerId,
    projectId: w.projectId,
    harvest: w.harvestName,
    name: w.workerName,
    dailyWage: w.dailyWage,
    days: w.daysWorked,
    total: w.totalWage,
    credit: w.creditAmount,
    debit: w.debitBalance,
    date: w.workDate,
    notes: w.notes,
  }));
}

function mapSales(sales: SaleTransaction[]): UasSaleTransaction[] {
  return sales.map((s: SaleTransaction) => ({
    id: s.id,
    customerId: s.customerId,
    projectId: s.projectId,
    harvest: s.harvestName,
    batch: s.saleBatchLabel,
    customer: s.customerName,
    phone: s.customerPhone,
    grade: s.productGrade,
    bundles: s.bundlesCount,
    price: s.unitPrice,
    total: s.totalAmount,
    credit: s.creditPaid,
    debit: s.debitReceivable,
    date: s.saleDate,
    voucherNo: s.receiptVoucherNo,
    notes: s.notes,
  }));
}

export async function getBootstrapState(): Promise<UasBootstrapState> {
  const [
    settingsRow,
    rates,
    treasuryAccounts,
    installments,
    inventoryBatches,
    auditLogs,
  ] = await Promise.all([
    prisma.systemSettings.findUnique({ where: { id: "default" } }),
    prisma.currencyRate.findMany(),
    prisma.treasuryAccount.findMany({ orderBy: { id: "asc" } }),
    prisma.installmentVoucher.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.harvestInventoryBatch.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.immutableAuditLog.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const [users, projects, expenses, workers, sales] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        avatarChar: true,
      },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        harvestCycles: {
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
    prisma.operatingExpense.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.workerWageEntry.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.saleTransaction.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const { mappedProjects, lockedPeriods } = mapProjects(projects);

  return {
    settings: mapSettings(settingsRow),
    exchangeRates: mapExchangeRates(rates),
    treasuryAccounts: mapTreasury(treasuryAccounts),
    installments: mapInstallments(installments),
    inventoryBatches: mapInventory(inventoryBatches),
    lockedPeriods,
    auditLogs: mapAuditLogs(auditLogs),
    users,
    projects: mappedProjects,
    expenses: mapExpenses(expenses),
    workers: mapWorkers(workers),
    sales: mapSales(sales),
  };
}

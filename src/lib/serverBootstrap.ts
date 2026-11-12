import crypto from "node:crypto";
import type {
  CurrencyRate,
  EnterpriseProfile,
  HarvestCycle,
  HarvestInventoryBatch,
  ImmutableAuditLog,
  InstallmentVoucher,
  OperatingExpense,
  Prisma,
  ProjectAcquisitionCycle,
  SaleTransaction,
  SubProject,
  SystemSettings,
  TreasuryAccount,
  WorkerWageEntry,
} from "@prisma/client";
import { formatAuditTimestamp, type CurrencyCode } from "@/lib/formulas";
import { prisma } from "@/lib/prisma";
import type {
  UasAuditLog,
  UasBootstrapState,
  UasEnterpriseProfile,
  UasInstallmentVoucher,
  UasInventoryBatch,
  UasOperatingExpense,
  UasProject,
  UasSaleTransaction,
  UasSystemSettings,
  UasTreasuryAccount,
  UasWorkerWage,
} from "@/types/uas";

type ProjectWithRelations = Prisma.ProjectGetPayload<{
  include: {
    harvestCycles: true;
    subProjects: true;
    ownerVendor: { select: { id: true; nameAr: true } };
    acquisitions: true;
  };
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

export function parseAssignedProjects(
  raw: string | null | undefined,
): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function findHarvestCycle(
  tx: Prisma.TransactionClient,
  projectId: string,
  harvestName: string,
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
  harvestName: string,
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
  },
): Promise<ImmutableAuditLog> {
  const timestamp = formatAuditTimestamp(new Date());
  const sha256Hash = generateAuditHash(
    `${timestamp}|${input.userDisplay}|${input.actionType}|${input.entityReference}|${input.details}`,
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

function mapEnterpriseProfile(
  row: EnterpriseProfile | null,
): UasEnterpriseProfile {
  return {
    id: row?.id || "default",
    legalNameAr: row?.legalNameAr || "شركة الجبري الزراعية للتنمية والاستثمار",
    legalNameEn:
      row?.legalNameEn || "Al-Jabri Agricultural Development & Investment Co.",
    taxNumber: row?.taxNumber ?? "30049811200003",
    commercialReg: row?.commercialReg ?? "CR-YE-2026-8841",
    currencyCode: row?.currencyCode || "YER",
    address: row?.address ?? "الجمهورية اليمنية - مزارع الجبري الإنتاجية",
    phone: row?.phone ?? "783118231",
    email: row?.email ?? "finance@aljabri-agri.com",
    logoUrl: row?.logoUrl ?? "/icons/icon.svg",
    brandColor: row?.brandColor || "#059669",
    showUasLogo: row?.showUasLogo ?? true,
    uasLogoStyle: row?.uasLogoStyle || "geometric",
    uasLogoCustomUrl: row?.uasLogoCustomUrl ?? null,
    showEnterpriseLogo: row?.showEnterpriseLogo ?? true,
    enterpriseLogoStyle: row?.enterpriseLogoStyle || "emblem",
    enterpriseLogoCustomUrl: row?.enterpriseLogoCustomUrl ?? null,
    heroBadgeAr: row?.heroBadgeAr || "نظام المحاسبة الموحد (UAS Enterprise)",
    heroBadgeEn:
      row?.heroBadgeEn || "Unified Accounting System (UAS Enterprise)",
    heroTitleAr:
      row?.heroTitleAr ||
      "الإدارة المالية والمحاسبية المتكاملة للمشاريع الزراعية",
    heroTitleEn:
      row?.heroTitleEn ||
      "Integrated Financial & Agricultural Enterprise Resource Planning",
    heroSubtitleAr:
      row?.heroSubtitleAr ||
      "منظومة قيد مزدوج متكاملة، إدارة الخزينة والبنوك، المشتريات والمبيعات، وتتبع مواسم الحصاد بدقة مؤسسية.",
    heroSubtitleEn:
      row?.heroSubtitleEn ||
      "Complete double-entry GL engine, multi-currency treasury, procurement, sales, and harvest cycle analytics.",
    aboutMissionAr:
      row?.aboutMissionAr ||
      "تحقيق أعلى مستويات الشفافية المالية والانضباط المحاسبي لجميع المشاريع الاستثمارية والزراعية.",
    aboutMissionEn:
      row?.aboutMissionEn ||
      "Delivering institutional financial transparency and double-entry precision across agricultural ventures.",
    contactPhone: row?.contactPhone || "783118231",
    contactWhatsApp: row?.contactWhatsApp || "967783118231",
    contactAddress: row?.contactAddress || "الجمهورية اليمنية - صنعاء",
    showPublicMetrics: row?.showPublicMetrics ?? true,
    showPublicVerify: row?.showPublicVerify ?? true,
    ctaPrimaryTextAr: row?.ctaPrimaryTextAr || "دخول النظام المالي",
    ctaPrimaryTextEn: row?.ctaPrimaryTextEn || "Launch ERP Console",
  };
}

function mapSettings(settingsRow: SystemSettings | null): UasSystemSettings {
  return {
    orgName:
      settingsRow?.orgName || "شركة الجبري الزراعية للتنمية والاستثمار | UAS",
    logoText: settingsRow?.logoText || "UAS",
    defaultLang: settingsRow?.defaultLang === "en" ? "en" : "ar",
    defaultTheme:
      settingsRow?.defaultTheme === "dark" ||
      settingsRow?.defaultTheme === "royal"
        ? settingsRow.defaultTheme
        : "emerald",
    defaultCurrency:
      settingsRow?.defaultCurrency === "SAR" ||
      settingsRow?.defaultCurrency === "USD"
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
    if (
      r.currencyCode === "YER" ||
      r.currencyCode === "SAR" ||
      r.currencyCode === "USD"
    ) {
      exchangeRates[r.currencyCode] = r.rateToYER;
    }
  }
  return exchangeRates;
}

function mapProjects(projects: ProjectWithRelations[]): {
  mappedProjects: UasProject[];
  lockedPeriods: Record<string, boolean>;
} {
  const lockedPeriods: Record<string, boolean> = {};
  const mappedProjects: UasProject[] = projects.map(
    (p: ProjectWithRelations) => {
      for (const hc of p.harvestCycles) {
        lockedPeriods[`${p.id}::${hc.name}`] = hc.isLocked;
      }
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        type: p.type,
        parentProjectId: p.parentProjectId || "",
        vendorId: p.vendorId ?? null,
        ownerVendorName: p.ownerVendor?.nameAr ?? null,
        budgetTotal: Number(p.budgetTotal) || p.estimatedValue,
        estimatedValue: p.estimatedValue,
        plannedHarvests: p.plannedHarvestCount,
        status: p.status,
        notes: p.notes,
        harvests: p.harvestCycles.map((hc: HarvestCycle) => hc.name),
        harvestCycles: p.harvestCycles.map((hc: HarvestCycle) => ({
          id: hc.id,
          projectId: hc.projectId,
          cycleNumber: hc.cycleNumber,
          name: hc.name,
          sortOrder: hc.sortOrder,
          isLocked: hc.isLocked,
        })),
        subProjects: p.subProjects.map((sp: SubProject) => ({
          id: sp.id,
          projectId: sp.projectId,
          code: sp.code,
          nameAr: sp.nameAr,
          nameEn: sp.nameEn,
          budget: Number(sp.budget) || 0,
        })),
        acquisitions: p.acquisitions.map((ac: ProjectAcquisitionCycle) => ({
          id: ac.id,
          projectId: ac.projectId,
          cycleTitle: ac.cycleTitle,
          startDate: ac.startDate.toISOString().slice(0, 10),
          endDate: ac.endDate.toISOString().slice(0, 10),
          contractAmount: Number(ac.contractAmount) || 0,
          currency: ac.currency,
          status: ac.status,
          notes: ac.notes ?? "",
        })),
      };
    },
  );
  return { mappedProjects, lockedPeriods };
}

function mapTreasury(accounts: TreasuryAccount[]): UasTreasuryAccount[] {
  return accounts.map((t: TreasuryAccount) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    nameAr: t.nameAr,
    nameEn: t.nameEn,
    type: t.type,
    providerNameAr: t.providerNameAr,
    providerNameEn: t.providerNameEn,
    accountHolderName: t.accountHolderName,
    accountNo: t.accountNumber,
    ibanOrSwift: t.ibanOrSwift,
    branchOrAgent: t.branchOrAgent,
    transferFeePercent: Number(t.transferFeePercent) || 0,
    dailyLimit: Number(t.dailyLimit) || 0,
    isDefaultReceipts: t.isDefaultReceipts,
    isDefaultPayments: t.isDefaultPayments,
    isActive: t.isActive,
    notes: t.notes,
    accountId: t.accountId,
    currencyCode: t.currencyCode || t.currency,
    balance: Number(t.balance) || t.balanceYER,
    balanceYER: t.balanceYER,
  }));
}

function mapInstallments(
  installments: InstallmentVoucher[],
): UasInstallmentVoucher[] {
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
    enterpriseProfile,
    settingsRow,
    rates,
    treasuryAccounts,
    installments,
    inventoryBatches,
    auditLogs,
  ] = await Promise.all([
    prisma.enterpriseProfile.findUnique({ where: { id: "default" } }),
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
        username: true,
        name: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        active: true,
        avatarChar: true,
        assignedProjects: true,
      },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        harvestCycles: {
          orderBy: { sortOrder: "asc" },
        },
        subProjects: {
          orderBy: { code: "asc" },
        },
        ownerVendor: {
          select: { id: true, nameAr: true },
        },
        acquisitions: {
          orderBy: { startDate: "asc" },
        },
      },
    }),
    prisma.operatingExpense.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.workerWageEntry.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.saleTransaction.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const { mappedProjects, lockedPeriods } = mapProjects(projects);

  return {
    enterpriseProfile: mapEnterpriseProfile(enterpriseProfile),
    settings: mapSettings(settingsRow),
    exchangeRates: mapExchangeRates(rates),
    treasuryAccounts: mapTreasury(treasuryAccounts),
    installments: mapInstallments(installments),
    inventoryBatches: mapInventory(inventoryBatches),
    lockedPeriods,
    auditLogs: mapAuditLogs(auditLogs),
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      department: u.department,
      active: u.active,
      avatarChar: u.avatarChar,
      assignedProjects: parseAssignedProjects(u.assignedProjects),
    })),
    projects: mappedProjects,
    expenses: mapExpenses(expenses),
    workers: mapWorkers(workers),
    sales: mapSales(sales),
  };
}

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
    subProjects: {
      include: {
        vendor: { select: { id: true; nameAr: true } };
      };
    };
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
    legalNameAr: row?.legalNameAr || "اسم المنشأة",
    legalNameEn: row?.legalNameEn || "Enterprise Name",
    taxNumber: row?.taxNumber || "",
    commercialReg: row?.commercialReg || "",
    currencyCode: row?.currencyCode || "YER",
    isConfigured: row?.isConfigured ?? false,
    address: row?.address || "",
    phone: row?.phone || "",
    email: row?.email || "",
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
      "نظام إدارة الحسابات وتخطيط موارد المؤسسات",
    heroTitleEn:
      row?.heroTitleEn ||
      "Enterprise Resource Planning & Financial Management",
    heroSubtitleAr:
      row?.heroSubtitleAr ||
      "منظومة قيد مزدوج متكاملة، إدارة الخزينة والبنوك، المشتريات والمبيعات، ومتابعة العمليات بدقة لحظية.",
    heroSubtitleEn:
      row?.heroSubtitleEn ||
      "Complete double-entry GL engine, multi-currency treasury, procurement, sales, and supply chain analytics.",
    aboutMissionAr:
      row?.aboutMissionAr ||
      "تحقيق أعلى مستويات الشفافية المالية والانضباط المحاسبي لجميع المشاريع الاستثمارية والتجارية.",
    aboutMissionEn:
      row?.aboutMissionEn ||
      "Delivering institutional financial transparency and double-entry precision across business ventures.",
    contactPhone: row?.contactPhone || "",
    contactWhatsApp: row?.contactWhatsApp || "",
    contactAddress: row?.contactAddress || "",
    showPublicMetrics: row?.showPublicMetrics ?? true,
    showPublicVerify: row?.showPublicVerify ?? true,
    ctaPrimaryTextAr: row?.ctaPrimaryTextAr || "دخول النظام المالي",
    ctaPrimaryTextEn: row?.ctaPrimaryTextEn || "Launch ERP Console",
  };
}

function mapSettings(settingsRow: SystemSettings | null): UasSystemSettings {
  return {
    orgName:
      settingsRow?.orgName || "النظام المحاسبي الموحد (UAS Enterprise)",
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
        subProjects: p.subProjects.map((sp) => ({
          id: sp.id,
          projectId: sp.projectId,
          code: sp.code,
          nameAr: sp.nameAr,
          nameEn: sp.nameEn,
          budget: Number(sp.budget) || 0,
          status: sp.status,
          notes: sp.notes,
          vendorId: sp.vendorId,
          vendorName: sp.vendor?.nameAr ?? null,
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
    subProjectId: b.subProjectId ?? null,
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
    subProjectId: e.subProjectId ?? null,
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
    subProjectId: w.subProjectId ?? null,
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
    sequenceNumber: s.sequenceNumber ?? null,
    dailyBatchLabel: s.dailyBatchLabel ?? s.saleBatchLabel,
    salesOfficerId: s.salesOfficerId ?? null,
    salesOfficerTitle: s.salesOfficerTitle ?? null,
    revenueAccountCode: s.revenueAccountCode ?? "411101",
    treasuryAccountId: s.treasuryAccountId ?? null,
    customerId: s.customerId,
    projectId: s.projectId,
    subProjectId: s.subProjectId ?? null,
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
  let enterpriseProfile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
  if (!enterpriseProfile) {
    try {
      enterpriseProfile = await prisma.enterpriseProfile.create({
        data: {
          id: "default",
          legalNameAr: "اسم المنشأة",
          legalNameEn: "Enterprise Name",
          taxNumber: "",
          commercialReg: "",
          currencyCode: "YER",
          isConfigured: false,
          address: "",
          phone: "",
          email: "",
          logoUrl: "/icons/icon.svg",
          brandColor: "#059669",
          contactPhone: "",
          contactWhatsApp: "",
          contactAddress: "",
        },
      });
    } catch {
      enterpriseProfile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
    }
  }

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
        username: true,
        name: true,
        fullName: true,
        displayName: true,
        phone: true,
        email: true,
        role: true,
        department: true,
        active: true,
        isActive: true,
        avatarChar: true,
        avatarUrl: true,
        avatarColor: true,
        preferredLang: true,
        preferredCurrency: true,
        preferredTheme: true,
        defaultModule: true,
        lastLoginAt: true,
        useCustomPermissions: true,
        customAllowedGroups: true,
        customPermissionsJson: true,
        mustChangePassword: true,
        passwordUpdatedAt: true,
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
          include: {
            vendor: {
              select: { id: true, nameAr: true },
            },
          },
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
    users: users.map((u) => {
      let customAllowedGroups: string[] = [];
      try {
        if (u.customAllowedGroups) {
          const parsed = JSON.parse(u.customAllowedGroups);
          if (Array.isArray(parsed)) customAllowedGroups = parsed.map(String);
        }
      } catch {
        customAllowedGroups = [];
      }

      let customPermissionsJson: Record<string, boolean> = {};
      try {
        if (u.customPermissionsJson) {
          const parsed = JSON.parse(u.customPermissionsJson);
          if (parsed && typeof parsed === "object") customPermissionsJson = parsed;
        }
      } catch {
        customPermissionsJson = {};
      }

      const activeState = u.active && (u.isActive ?? true);

      return {
        id: u.id,
        username: u.username,
        name: u.name,
        fullName: u.fullName,
        displayName: u.displayName ?? "",
        phone: u.phone ?? "",
        email: u.email,
        role: u.role,
        department: u.department,
        active: activeState,
        isActive: u.isActive ?? u.active,
        avatarChar: u.avatarChar,
        avatarUrl: u.avatarUrl ?? "",
        avatarColor: u.avatarColor ?? "#059669",
        preferredLang: u.preferredLang ?? "ar",
        preferredCurrency: u.preferredCurrency ?? "YER",
        preferredTheme: u.preferredTheme ?? "emerald",
        defaultModule: u.defaultModule ?? "",
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        useCustomPermissions: Boolean(u.useCustomPermissions),
        customAllowedGroups,
        customPermissionsJson,
        mustChangePassword: Boolean(u.mustChangePassword),
        passwordUpdatedAt: u.passwordUpdatedAt ? u.passwordUpdatedAt.toISOString() : null,
        assignedProjects: parseAssignedProjects(u.assignedProjects),
      };
    }),
    projects: mappedProjects,
    expenses: mapExpenses(expenses),
    workers: mapWorkers(workers),
    sales: mapSales(sales),
  };
}

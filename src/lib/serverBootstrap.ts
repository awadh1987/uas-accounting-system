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
import { issueSessionToken } from "@/lib/authSession";
import {
  canApprove,
  canCreate,
  canDeleteVoid,
  canEdit,
  canEditDate,
  canLockPeriod,
  canManageLandingCms,
  canManageTreasury,
  canManageUsers,
  canPostLedger,
  getAccessibleGroups,
  getAccessibleTabs,
  isReadOnly,
  normalizeRole,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
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
  UasUser,
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

const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string, explicitSalt?: string): string {
  const salt = explicitSalt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${SCRYPT_PREFIX}${salt}$${derived}`;
}

export function isLegacySha256Hash(storedHash: string | null | undefined): boolean {
  if (!storedHash || typeof storedHash !== "string") return false;
  return /^[a-f0-9]{64}$/i.test(storedHash.trim());
}

export function verifyPassword(
  password: string,
  storedHash: string | null | undefined
): boolean {
  if (!password || !storedHash || typeof storedHash !== "string") return false;
  const trimmed = storedHash.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith(SCRYPT_PREFIX)) {
    const parts = trimmed.split("$");
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
    const [, salt, expectedHex] = parts;
    try {
      const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
      const expected = Buffer.from(expectedHex, "hex");
      if (derived.length !== expected.length) return false;
      return crypto.timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  if (isLegacySha256Hash(trimmed)) {
    try {
      const legacyDigest = crypto.createHash("sha256").update(password).digest();
      const expected = Buffer.from(trimmed, "hex");
      if (legacyDigest.length !== expected.length) return false;
      return crypto.timingSafeEqual(legacyDigest, expected);
    } catch {
      return false;
    }
  }

  return false;
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
    logoUrl: row?.logoUrl ?? "/uas-logo.png",
    brandColor: row?.brandColor || "#059669",
    showUasLogo: row?.showUasLogo ?? true,
    uasLogoStyle: row?.uasLogoStyle || "official-brand",
    uasLogoCustomUrl: row?.uasLogoCustomUrl ?? "/uas-logo.png",
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
    tenantSlug: row?.tenantSlug ?? null,
    welcomeNoticeAr: row?.welcomeNoticeAr || "",
    welcomeNoticeEn: row?.welcomeNoticeEn || "",
    supportEmail: row?.supportEmail || "",
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
    periodLockDate: settingsRow?.periodLockDate ?? null,
    autoSyncEnabled: settingsRow?.autoSyncEnabled ?? true,
    autoSyncIntervalSec: settingsRow?.autoSyncIntervalSec ?? 60,
    defaultDeviceSyncMode:
      settingsRow?.defaultDeviceSyncMode === "MANUAL" ? "MANUAL" : "AUTO",
    requireDeviceApproval: settingsRow?.requireDeviceApproval ?? false,
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
      exchangeRates[r.currencyCode] = Number(r.rateToYER);
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
        budgetTotal: Number(p.budgetTotal) || Number(p.estimatedValue),
        estimatedValue: Number(p.estimatedValue),
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
    balance: Number(t.balance) || Number(t.balanceYER),
    balanceYER: Number(t.balanceYER),
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
    amount: Number(inst.amountYER),
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
    qty: Number(e.quantity),
    unitPrice: Number(e.unitPrice),
    total: Number(e.totalAmount),
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
    dailyWage: Number(w.dailyWage),
    days: Number(w.daysWorked),
    total: Number(w.totalWage),
    credit: Number(w.creditAmount),
    debit: Number(w.debitBalance),
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
    price: Number(s.unitPrice),
    total: Number(s.totalAmount),
    credit: Number(s.creditPaid),
    debit: Number(s.debitReceivable),
    date: s.saleDate,
    voucherNo: s.receiptVoucherNo,
    notes: s.notes,
  }));
}

export async function getBootstrapState(): Promise<UasBootstrapState> {
  await ensureSqliteDatabaseReady();

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
          logoUrl: "/uas-logo.png",
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

  const [usersQuery, projects, expenses, workers, sales] = await Promise.all([
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
        archivedAt: true,
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

  let users = usersQuery;
  // If no users exist at all in PostgreSQL, create a single initial Administrator account.
  // Existing real users are never deleted or overwritten.
  if (users.length === 0) {
    try {
      await prisma.user.create({
        data: {
          id: "u1",
          username: "system_owner",
          name: "مدير النظام العام",
          fullName: "مدير النظام العام / System Owner",
          displayName: "",
          phone: "",
          email: process.env.INITIAL_ADMIN_EMAIL || "",
          passwordHash: process.env.INITIAL_ADMIN_PASSWORD ? hashPassword(process.env.INITIAL_ADMIN_PASSWORD) : "",
          role: "SUPER_ADMIN",
          department: "الإدارة العليا وتقنية المعلومات",
          active: true,
          isActive: true,
          avatarChar: "م",
          avatarColor: "#059669",
          preferredLang: "ar",
          preferredCurrency: "YER",
          preferredTheme: "emerald",
          useCustomPermissions: false,
          customAllowedGroups: "[]",
          customPermissionsJson: "{}",
          mustChangePassword: false,
          assignedProjects: "[]",
        },
      });
      users = await prisma.user.findMany({
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
          archivedAt: true,
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
      });
    } catch (e) {
      console.warn("Initial admin bootstrap fallback error:", e);
    }
  }

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
        archivedAt: u.archivedAt ? u.archivedAt.toISOString() : null,
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

export async function authenticateAndBuildSessionTx(
  user: {
    id: string;
    username: string;
    name: string;
    fullName: string;
    displayName: string | null;
    phone: string | null;
    email: string;
    passwordHash: string;
    role: string;
    department: string;
    active: boolean;
    isActive: boolean;
    avatarChar: string;
    avatarUrl: string | null;
    avatarColor: string | null;
    preferredLang: string | null;
    preferredCurrency: string | null;
    preferredTheme: string | null;
    defaultModule: string | null;
    useCustomPermissions: boolean;
    customAllowedGroups: string;
    customPermissionsJson: string;
    mustChangePassword: boolean;
    passwordUpdatedAt: Date | null;
    assignedProjects: string;
  },
  activeTenantId: string,
  opts: { plainPassword?: string; auditAction?: string; auditDetailsPrefix?: string; now?: Date } = {}
) {
  const now = opts.now ?? new Date();
  const shouldUpgradeHash = Boolean(opts.plainPassword && isLegacySha256Hash(user.passwordHash));
  const userDisplay = `${user.displayName || user.name} (${normalizeRole(user.role)})`;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        ...(shouldUpgradeHash && opts.plainPassword
          ? { passwordHash: hashPassword(opts.plainPassword), passwordUpdatedAt: now }
          : {}),
      },
    });

    await appendAuditLogTx(tx, {
      userId: user.id,
      userDisplay,
      userRole: user.role,
      actionType: opts.auditAction || "تسجيل دخول",
      entityReference: user.id,
      details: `${opts.auditDetailsPrefix || "تم تسجيل الدخول بنجاح بحساب"} ${user.displayName || user.name}`,
    });
  });

  let customAllowedGroups: string[] = [];
  try {
    if (user.customAllowedGroups) {
      const parsed = JSON.parse(user.customAllowedGroups);
      if (Array.isArray(parsed)) customAllowedGroups = parsed.map(String);
    }
  } catch {
    customAllowedGroups = [];
  }

  let customPermissionsJson: Record<string, boolean> = {};
  try {
    if (user.customPermissionsJson) {
      const parsed = JSON.parse(user.customPermissionsJson);
      if (parsed && typeof parsed === "object") customPermissionsJson = parsed;
    }
  } catch {
    customPermissionsJson = {};
  }

  const uasUser: UasUser = {
    id: user.id,
    username: user.username,
    name: user.name,
    fullName: user.fullName,
    displayName: user.displayName ?? "",
    phone: user.phone ?? "",
    email: user.email,
    role: user.role as UasUser["role"],
    department: user.department,
    active: user.active && (user.isActive ?? true),
    isActive: user.isActive ?? user.active,
    avatarChar: user.avatarChar,
    avatarUrl: user.avatarUrl ?? "",
    avatarColor: user.avatarColor ?? "#059669",
    preferredLang: (user.preferredLang ?? "ar") as UasUser["preferredLang"],
    preferredCurrency: (user.preferredCurrency ?? "YER") as UasUser["preferredCurrency"],
    preferredTheme: (user.preferredTheme ?? "emerald") as UasUser["preferredTheme"],
    defaultModule: user.defaultModule ?? "",
    lastLoginAt: now.toISOString(),
    useCustomPermissions: Boolean(user.useCustomPermissions),
    customAllowedGroups,
    customPermissionsJson,
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordUpdatedAt: user.passwordUpdatedAt ? user.passwordUpdatedAt.toISOString() : null,
    assignedProjects: parseAssignedProjects(user.assignedProjects),
  };

  const normalizedUserRole = normalizeRole(user.role);
  const sessionToken = issueSessionToken({
    userId: user.id,
    userRole: normalizedUserRole,
    tenantId: activeTenantId,
    userDisplay: `${user.displayName || user.name} (${normalizedUserRole})`,
  });

  return {
    user: uasUser,
    sessionToken,
    preferences: {
      preferredLang: uasUser.preferredLang,
      preferredCurrency: uasUser.preferredCurrency,
      preferredTheme: uasUser.preferredTheme,
      defaultModule: uasUser.defaultModule,
    },
    mustChangePassword: uasUser.mustChangePassword,
    tenantId: activeTenantId,
    permissions: {
      allowedGroups: getAccessibleGroups(uasUser),
      accessibleTabs: getAccessibleTabs(uasUser),
      canCreate: canCreate(uasUser),
      canEdit: canEdit(uasUser),
      canEditDate: canEditDate(uasUser),
      canDeleteVoid: canDeleteVoid(uasUser),
      canApprove: canApprove(uasUser),
      canPostLedger: canPostLedger(uasUser),
      canManageTreasury: canManageTreasury(uasUser),
      canManageLandingCms: canManageLandingCms(uasUser),
      canLockPeriod: canLockPeriod(uasUser),
      canManageUsers: canManageUsers(uasUser),
      isReadOnly: isReadOnly(uasUser),
    },
  };
}

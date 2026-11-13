import type { CurrencyCode } from "@/lib/formulas";

export type ThemeName = "emerald" | "dark" | "royal";
export type LanguageCode = "ar" | "en";

export type UserRole =
  | "SUPER_ADMIN"
  | "PROJECT_MANAGER"
  | "CHIEF_ACCOUNTANT"
  | "PROCUREMENT_OFFICER"
  | "SALES_COLLECTOR"
  | "FIELD_ACCOUNTANT"
  | "EXTERNAL_AUDITOR";

export type ErpGroupId =
  | "public"
  | "projects"
  | "commercial"
  | "operations"
  | "finance"
  | "intelligence"
  | "admin";

export type TabId =
  | "dashboard"
  | "commercial"
  | "operations"
  | "finance"
  | "accounting"
  | "coa"
  | "ledger"
  | "procurement"
  | "reports"
  | "projects"
  | "expenses"
  | "workers"
  | "sales"
  | "customers"
  | "system"
  | "treasury"
  | "inventory"
  | "audit"
  | "mobile"
  | "prompt";

export interface UasUserCustomOverrides {
  allowedGroups?: ErpGroupId[];
  canCreate?: boolean;
  canEdit?: boolean;
  canEditDate?: boolean;
  canDeleteVoid?: boolean;
  canApprove?: boolean;
  canPostLedger?: boolean;
  canLockPeriod?: boolean;
  canManageTreasury?: boolean;
  canManageLandingCms?: boolean;
  canManageUsers?: boolean;
  [key: string]: boolean | ErpGroupId[] | undefined;
}

export interface UasUser {
  id: string;
  username?: string;
  name: string;
  fullName?: string;
  displayName?: string;
  phone?: string;
  email: string;
  role: UserRole | string;
  department?: string;
  active: boolean;
  isActive?: boolean;
  avatarChar: string;
  avatarUrl?: string;
  avatarColor?: string;
  preferredLang?: string;
  preferredCurrency?: string;
  preferredTheme?: string;
  defaultModule?: string;
  lastLoginAt?: string | null;
  useCustomPermissions?: boolean;
  customAllowedGroups?: ErpGroupId[] | string[] | string;
  customPermissionsJson?: Record<string, boolean> | string;
  customOverrides?: UasUserCustomOverrides;
  mustChangePassword?: boolean;
  passwordUpdatedAt?: string | null;
  assignedProjects?: string[];
}

export interface UasEnterpriseProfile {
  id: string;
  legalNameAr: string;
  legalNameEn: string;
  taxNumber?: string | null;
  commercialReg?: string | null;
  currencyCode: string;
  isConfigured?: boolean;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  brandColor: string;
  showUasLogo?: boolean;
  uasLogoStyle?: string;
  uasLogoCustomUrl?: string | null;
  showEnterpriseLogo?: boolean;
  enterpriseLogoStyle?: string;
  enterpriseLogoCustomUrl?: string | null;
  heroBadgeAr?: string;
  heroBadgeEn?: string;
  heroTitleAr?: string;
  heroTitleEn?: string;
  heroSubtitleAr?: string;
  heroSubtitleEn?: string;
  aboutMissionAr?: string;
  aboutMissionEn?: string;
  contactPhone?: string;
  contactWhatsApp?: string;
  contactAddress?: string;
  showPublicMetrics?: boolean;
  showPublicVerify?: boolean;
  ctaPrimaryTextAr?: string;
  ctaPrimaryTextEn?: string;
}

export type CoaGenerationLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface UasCoaLineageItem {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
}

export interface UasCoaAccount {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: CoaGenerationLevel | number;
  type: string;
  isPosting: boolean;
  parentCode?: string | null;
  parentId: string | null;
  directDebit: number;
  directCredit: number;
  rolledUpDebit: number;
  rolledUpCredit: number;
  rolledUpBalance: number;
  // Aliases for backwards compatibility:
  rollupDebit?: number;
  rollupCredit?: number;
  balance?: number;
  childrenCount?: number;
  lineageChain?: UasCoaLineageItem[];
  children?: UasCoaAccount[];
}

export interface UasSubProject {
  id: string;
  projectId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  budget: number;
  status?: "ACTIVE" | "PAUSED" | "COMPLETED" | string;
  notes?: string;
  vendorId?: string | null;
  vendorName?: string | null;
  actualSpend?: number;
  revenue?: number;
  netProfit?: number;
  remainingBudget?: number;
}

export interface UasHarvestCycle {
  id: string;
  projectId: string;
  cycleNumber?: number;
  name: string;
  sortOrder: number;
  isLocked: boolean;
}

export interface UasProjectAcquisitionCycle {
  id: string;
  projectId: string;
  cycleTitle: string;
  startDate: string;
  endDate: string;
  contractAmount: number;
  currency: string;
  status: string;
  notes?: string | null;
}

export interface UasProject {
  id: string;
  code?: string;
  name: string;
  nameAr?: string;
  nameEn?: string;
  type: string;
  parentProjectId: string;
  vendorId?: string | null;
  ownerVendorName?: string | null;
  budgetTotal?: number;
  estimatedValue: number;
  plannedHarvests: number;
  status?: string;
  notes: string;
  harvests: string[];
  harvestCycles?: UasHarvestCycle[];
  subProjects?: UasSubProject[];
  acquisitions?: UasProjectAcquisitionCycle[];
}

export interface UasOperatingExpense {
  id: string;
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  category: string;
  subType: string;
  qty: number;
  unitPrice: number;
  total: number;
  date: string;
  notes: string;
}

export interface UasWorkerWage {
  id: string;
  workerId?: string;
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  name: string;
  dailyWage: number;
  days: number;
  total: number;
  credit: number;
  debit: number;
  date: string;
  notes: string;
}

export interface UasSaleTransaction {
  id: string;
  sequenceNumber?: string | null;
  dailyBatchLabel?: string | null;
  salesOfficerId?: string | null;
  salesOfficerTitle?: string | null;
  revenueAccountCode?: string;
  treasuryAccountId?: string | null;
  treasuryName?: string | null;
  customerId?: string;
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  batch: string;
  customer: string;
  phone: string;
  grade: string;
  bundles: number;
  price: number;
  total: number;
  credit: number;
  debit: number;
  date: string;
  voucherNo: string;
  notes: string;
}

export interface UasTreasuryAccount {
  id: string;
  code?: string;
  name: string;
  nameAr?: string;
  nameEn?: string;
  type: "VAULT" | "CASH" | "BANK" | "WALLET" | string;
  providerNameAr?: string;
  providerNameEn?: string;
  accountHolderName?: string;
  accountNo: string;
  ibanOrSwift?: string;
  branchOrAgent?: string;
  transferFeePercent?: number;
  dailyLimit?: number;
  isDefaultReceipts?: boolean;
  isDefaultPayments?: boolean;
  isActive?: boolean;
  notes?: string;
  accountId?: string;
  currencyCode: CurrencyCode | string;
  balance?: number;
  balanceYER: number;
}

export interface UasInstallmentVoucher {
  id: string;
  voucherNo: string;
  type: "CUSTOMER_RECEIPT" | "WORKER_PAYOUT" | string;
  targetId: string;
  targetName: string;
  phone: string;
  treasuryId: string;
  amount: number;
  qrVerificationHash?: string;
  date: string;
  notes: string;
}

export interface UasInventoryBatch {
  id: string;
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  grade: string;
  harvestedBundles: number;
  shrinkageBundles: number;
  notes: string;
}

export interface UasAuditLog {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  details: string;
  hash: string;
}

export interface UasSystemSettings {
  orgName: string;
  logoText: string;
  defaultLang: LanguageCode;
  defaultTheme: ThemeName;
  defaultCurrency: CurrencyCode;
}

export interface UasBootstrapState {
  enterpriseProfile?: UasEnterpriseProfile;
  settings: UasSystemSettings;
  exchangeRates: Record<CurrencyCode, number>;
  treasuryAccounts: UasTreasuryAccount[];
  installments: UasInstallmentVoucher[];
  inventoryBatches: UasInventoryBatch[];
  lockedPeriods: Record<string, boolean>;
  auditLogs: UasAuditLog[];
  users: UasUser[];
  projects: UasProject[];
  expenses: UasOperatingExpense[];
  workers: UasWorkerWage[];
  sales: UasSaleTransaction[];
}

export interface VoucherModalPayload {
  title: string;
  subtitle?: string;
  kind: "sale" | "worker" | "installment" | "vendor_payment" | "vendor_bill";
  voucherNo: string;
  date: string;
  partyLabel: string;
  partyName: string;
  phone: string;
  projectHarvest: string;
  detailLineLabel: string;
  detailLineValue: string;
  totalAmount?: number;
  creditAmount?: number;
  debitAmount?: number;
  singleAmountYER?: number;
  treasuryName?: string;
  notes?: string;
  qrPayload: string;
  whatsappText: string;
}

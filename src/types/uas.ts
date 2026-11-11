import type { CurrencyCode } from "@/lib/formulas";

export type ThemeName = "emerald" | "dark" | "royal";
export type LanguageCode = "ar" | "en";

export type TabId =
  | "dashboard"
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

export interface UasUser {
  id: string;
  username?: string;
  name: string;
  fullName?: string;
  email: string;
  role: string;
  active: boolean;
  avatarChar: string;
  assignedProjects?: string[];
}

export interface UasEnterpriseProfile {
  id: string;
  legalNameAr: string;
  legalNameEn: string;
  taxNumber?: string | null;
  commercialReg?: string | null;
  currencyCode: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  brandColor: string;
}

export interface UasSubProject {
  id: string;
  projectId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  budget: number;
}

export interface UasHarvestCycle {
  id: string;
  projectId: string;
  cycleNumber?: number;
  name: string;
  sortOrder: number;
  isLocked: boolean;
}

export interface UasProject {
  id: string;
  code?: string;
  name: string;
  nameAr?: string;
  nameEn?: string;
  type: string;
  parentProjectId: string;
  budgetTotal?: number;
  estimatedValue: number;
  plannedHarvests: number;
  status?: string;
  notes: string;
  harvests: string[];
  harvestCycles?: UasHarvestCycle[];
  subProjects?: UasSubProject[];
}

export interface UasOperatingExpense {
  id: string;
  projectId: string;
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
  customerId?: string;
  projectId: string;
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
  accountNo: string;
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

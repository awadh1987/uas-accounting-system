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
  canCloseFiscalYear?: boolean;
  canFxRevalue?: boolean;
  canDecideApprovals?: boolean;
  canConfigureApprovals?: boolean;
  canManageAllDrafts?: boolean;
  canCustomUom?: boolean;
  canArchiveDeleteRecords?: boolean;
  canExecuteGateway?: boolean;
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
  archivedAt?: string | null;
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
  faviconUrl?: string | null;
  brandColor: string;
  taglineAr?: string;
  taglineEn?: string;
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
  tenantSlug?: string | null;
  welcomeNoticeAr?: string;
  welcomeNoticeEn?: string;
  supportEmail?: string;
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
  documentStatus?: string | null;
  status?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
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
  documentStatus?: string | null;
  status?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
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
  documentStatus?: string | null;
  status?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
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
  archivedAt?: string | null;
  notes?: string;
  accountId?: string;
  currencyCode: CurrencyCode | string;
  balance?: number;
  balanceYER: number;
  gatewayProvider?: "MANUAL" | "KURAIMI_API" | "JAWALI_API" | "JEEB_API" | "ONECASH_API" | "FLOOSAK_API" | "CUSTOM_WEBHOOK" | string;
  gatewayMerchantId?: string | null;
  gatewayEndpointUrl?: string | null;
  gatewayCredentialsEnc?: string | null;
  isSandbox?: boolean;
  dailyUsedAmount?: number;
  lastDailyResetDate?: string | null;
}

export type GatewayProvider =
  | "MANUAL"
  | "KURAIMI_API"
  | "JAWALI_API"
  | "JEEB_API"
  | "ONECASH_API"
  | "FLOOSAK_API"
  | "CUSTOM_WEBHOOK";

export type DispatchStatus = "QUEUED" | "PENDING_OTP" | "EXECUTED" | "FAILED" | "RECONCILED";

export interface UasBankPaymentDispatch {
  id: string;
  dispatchNumber: string;
  treasuryAccountId: string;
  sourceVoucherType: "PAYMENT_VOUCHER" | "VENDOR_BILL" | "WORKER_WAGE" | "TREASURY_TRANSFER" | string;
  sourceVoucherId: string;
  beneficiaryName: string;
  beneficiaryAccountOrPhone: string;
  amount: number;
  feeAmount: number;
  currencyCode: string;
  exchangeRate: number;
  baseAmount: number;
  provider: GatewayProvider | string;
  externalReferenceId?: string | null;
  status: DispatchStatus | string;
  rawResponseJson?: string | null;
  errorMessage?: string | null;
  idempotencyKey: string;
  costCenterId?: string | null;
  journalEntryId?: string | null;
  executedById: string;
  executedByName: string;
  executedAt?: string | null;
  createdAt: string;
}

export interface BankPayoutPayload {
  treasuryAccountId: string;
  sourceVoucherType: "PAYMENT_VOUCHER" | "VENDOR_BILL" | "WORKER_WAGE" | "TREASURY_TRANSFER" | string;
  sourceVoucherId: string;
  beneficiaryName: string;
  beneficiaryAccountOrPhone: string;
  amount: number;
  currencyCode?: string;
  exchangeRate?: number;
  costCenterId?: string | null;
  idempotencyKey: string;
  actor?: {
    userId: string;
    userName: string;
    role?: string;
  };
}

export interface BankPayoutResult {
  ok: boolean;
  dispatch: UasBankPaymentDispatch;
  feeAmount: number;
  totalDebited: number;
  externalReferenceId?: string | null;
  journalEntryId?: string | null;
  messageAr: string;
  messageEn: string;
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
  periodLockDate?: string | null;
  autoSyncEnabled?: boolean;
  autoSyncIntervalSec?: number;
  defaultDeviceSyncMode?: "AUTO" | "MANUAL" | string;
  requireDeviceApproval?: boolean;
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

export type NotificationEventType =
  | "JOURNAL_POSTED"
  | "APPROVAL_REQUIRED"
  | "LOW_STOCK"
  | "SYNC_COMPLETED"
  | "SYNC_CONFLICT"
  | "BACKUP_COMPLETED"
  | "RESTORE_COMPLETED"
  | "DEVICE_LOCKED"
  | "PASSWORD_RESET"
  | "SYSTEM_ALERT";

export type NotificationChannelId = "approvals" | "sync" | "security" | "general";

export type NotificationSeverity = "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";

export interface UasNotificationEvent {
  id: string;
  eventType: NotificationEventType | string;
  channel: NotificationChannelId | string;
  severity: NotificationSeverity | string;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  targetTab?: TabId | string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  recipientUserId?: string | null;
  actorUserId?: string | null;
  isRead: boolean;
  readAt?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type TenantDeviceStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";
export type DeviceSyncMode = "AUTO" | "MANUAL";
export type DevicePlatformType = "web" | "windows" | "android";

export interface UasTenantDevice {
  id: string;
  deviceId: string;
  tenantSlug: string;
  platform: DevicePlatformType | string;
  appVersion: string;
  osVersion: string;
  deviceLabel: string;
  userId?: string | null;
  userEmail?: string | null;
  userDisplay?: string | null;
  lastSeenAt: string;
  ipAddress?: string | null;
  status: TenantDeviceStatus | string;
  syncMode: DeviceSyncMode | string;
  syncIntervalSec: number;
  pendingQueueCount: number;
  lastCursor: number;
  syncLag?: number;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  pendingCommand?: string | null;
  pendingCommandAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UasSyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  idempotencyKey?: string | null;
  deviceId?: string | null;
  status: "CONFLICT_PENDING" | "RESOLVED_KEEP_SERVER" | "RESOLVED_APPLY_CLIENT" | "DISMISSED" | string;
  reason: string;
  clientPayload: Record<string, unknown>;
  serverSnapshot: Record<string, unknown>;
  resolutionNotes?: string | null;
  resolvedById?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UasTenantAdminConfig {
  tenantId: string;
  slug: string;
  tenantUrl: string;
  legalNameAr: string;
  legalNameEn: string;
  brandColor: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  taglineAr?: string;
  taglineEn?: string;
  welcomeNoticeAr: string;
  welcomeNoticeEn: string;
  supportEmail: string;
  contactPhone: string;
  contactWhatsApp: string;
  contactAddress: string;
  defaultLang: LanguageCode;
  defaultCurrency: CurrencyCode;
  requireApprovalWorkflow: boolean;
  periodLockDate: string | null;
  autoSyncEnabled: boolean;
  autoSyncIntervalSec: number;
  defaultDeviceSyncMode: "AUTO" | "MANUAL";
  requireDeviceApproval: boolean;
  showPublicMetrics: boolean;
  showPublicVerify: boolean;
}

export interface ExtractedDocumentLine {
  description: string;
  accountCode: string;
  accountNameAr: string;
  accountNameEn: string;
  debit: number;
  credit: number;
  quantity?: number;
  unitPrice?: number;
  taxAmount?: number;
  costCenterId?: string | null;
  projectId?: string | null;
}

export interface DocumentValidationWarning {
  code:
    | "MISSING_FIELD"
    | "UNBALANCED"
    | "DUPLICATE_SUSPECTED"
    | "FISCAL_PERIOD_LOCKED"
    | "LOW_CONFIDENCE"
    | string;
  severity: "warning" | "error";
  messageAr: string;
  messageEn: string;
  field?: string;
}

export interface ExtractedDocumentDraft {
  draftId: string;
  documentType: "PURCHASE_BILL" | "SALES_INVOICE" | "EXPENSE_SLIP" | "RECEIPT" | "DELIVERY_NOTE" | "JOURNAL_VOUCHER";
  fileName: string;
  mimeType: string;
  partyName: string;
  partyType: "VENDOR" | "CUSTOMER" | "OTHER";
  date: string;
  reference: string;
  currency: string;
  paymentMethod: "CASH" | "BANK" | "WALLET" | "CREDIT";
  subtotal: number;
  taxTotal: number;
  totalAmount: number;
  projectId?: string | null;
  costCenterId?: string | null;
  narrationAr: string;
  narrationEn: string;
  confidence: number; // 0..1
  extractionProvider: "cloud_llm" | "local_parser";
  lines: ExtractedDocumentLine[];
  warnings: DocumentValidationWarning[];
  rawTextPreview?: string;
}


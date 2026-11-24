export interface ControlAccountsMap {
  cashAccount: string;
  arAccount: string;
  apAccount: string;
  salesAccount: string;
  salesReturnsAccount: string;
  cogsAccount: string;
  directLaborAccount?: string;
  operatingExpenseAccount?: string;
  bankFeeAccount?: string;
  capitalAccount?: string;
  inventoryAssetAccount: string;
  inventoryInputsAccount?: string;
  inventoryShrinkageAccount: string;
  cogsInventoryAccount?: string;
  grnClearingAccount?: string;
  realizedFxGainAccount: string;
  realizedFxLossAccount: string;
  unrealizedFxGainAccount: string;
  unrealizedFxLossAccount: string;
  fxRoundingAccount: string;
  taxPayableAccount: string;
  taxReceivableAccount: string;
  whtPayableAccount?: string;
  retainedEarningsAccount: string;
}

export interface DocumentSequenceConfig {
  prefix: string;
  nextNumber: number;
  padding: number;
}

export type DocumentSequenceKey = "JV" | "RV" | "PV" | "INV" | "BILL" | "TRN";

export type DocumentSequencesMap = Record<DocumentSequenceKey, DocumentSequenceConfig>;

export const DEFAULT_DISK_ALERT_THRESHOLD_PERCENT = 80;
export const MIN_DISK_ALERT_THRESHOLD_PERCENT = 50;
export const MAX_DISK_ALERT_THRESHOLD_PERCENT = 95;

export function clampDiskAlertThresholdPercent(
  value: unknown,
  fallback: number = DEFAULT_DISK_ALERT_THRESHOLD_PERCENT
): number {
  const num = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(
    MAX_DISK_ALERT_THRESHOLD_PERCENT,
    Math.max(MIN_DISK_ALERT_THRESHOLD_PERCENT, Math.round(num))
  );
}

export function resolveDefaultDiskAlertThresholdPercent(): number {
  const envRaw = (process.env.UAS_DISK_ALERT_THRESHOLD_PERCENT || "").trim();
  if (!envRaw) return DEFAULT_DISK_ALERT_THRESHOLD_PERCENT;
  return clampDiskAlertThresholdPercent(envRaw, DEFAULT_DISK_ALERT_THRESHOLD_PERCENT);
}

export function parseTenantAdminConfigJson(raw?: string | null): Record<string, unknown> {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function resolveEffectiveDiskThresholdPercent(
  row?: { tenantAdminConfigJson?: string | null } | null
): number {
  const envDefault = resolveDefaultDiskAlertThresholdPercent();
  const cfg = parseTenantAdminConfigJson(row?.tenantAdminConfigJson);
  if (
    cfg.diskAlertThresholdPercent !== undefined &&
    cfg.diskAlertThresholdPercent !== null &&
    String(cfg.diskAlertThresholdPercent).trim() !== ""
  ) {
    return clampDiskAlertThresholdPercent(cfg.diskAlertThresholdPercent, envDefault);
  }
  return envDefault;
}

export interface AccountingSettingsConfig {
  orgName: string;
  logoText: string;
  defaultLang: "ar" | "en";
  defaultTheme: "emerald" | "dark" | "royal";
  defaultCurrency: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  periodLockDate: string | null;
  requireApprovalWorkflow: boolean;
  enforceThreeWayMatch: boolean;
  threeWayTolerancePct: number;
  threeWayToleranceAmount: number;
  costingMethod: "WEIGHTED_AVERAGE" | "FIFO";
  negativeStockPolicy: "BLOCK" | "WARN";
  printLayout: "A4" | "80MM" | string;
  diskAlertThresholdPercent: number;
  controlAccounts: ControlAccountsMap;
  documentSequences: DocumentSequencesMap;
}

export const DEFAULT_CONTROL_ACCOUNTS: ControlAccountsMap = {
  cashAccount: "111101",
  arAccount: "112101",
  apAccount: "211101",
  salesAccount: "411101",
  salesReturnsAccount: "411401",
  cogsAccount: "511101",
  cogsInventoryAccount: "512201",
  directLaborAccount: "511101",
  operatingExpenseAccount: "524101",
  bankFeeAccount: "531201",
  capitalAccount: "311101",
  inventoryAssetAccount: "113101",
  inventoryInputsAccount: "113201",
  inventoryShrinkageAccount: "512301",
  grnClearingAccount: "215101",
  realizedFxGainAccount: "421101",
  realizedFxLossAccount: "532101",
  unrealizedFxGainAccount: "421102",
  unrealizedFxLossAccount: "532102",
  fxRoundingAccount: "532103",
  taxPayableAccount: "214101",
  taxReceivableAccount: "114301",
  whtPayableAccount: "214201",
  retainedEarningsAccount: "312101",
};

export const DEFAULT_DOCUMENT_SEQUENCES: DocumentSequencesMap = {
  JV: { prefix: "JV-", nextNumber: 1, padding: 5 },
  RV: { prefix: "RV-", nextNumber: 1, padding: 5 },
  PV: { prefix: "PV-", nextNumber: 1, padding: 5 },
  INV: { prefix: "INV-", nextNumber: 1, padding: 5 },
  BILL: { prefix: "BILL-", nextNumber: 1, padding: 5 },
  TRN: { prefix: "TRN-", nextNumber: 1, padding: 5 },
};

export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettingsConfig = {
  orgName: "النظام المحاسبي الموحد (UAS Enterprise)",
  logoText: "UAS",
  defaultLang: "ar",
  defaultTheme: "emerald",
  defaultCurrency: "YER",
  fiscalYearStart: "2026-01-01",
  fiscalYearEnd: "2026-12-31",
  periodLockDate: null,
  requireApprovalWorkflow: false,
  enforceThreeWayMatch: true,
  threeWayTolerancePct: 0,
  threeWayToleranceAmount: 0.01,
  costingMethod: "WEIGHTED_AVERAGE",
  negativeStockPolicy: "BLOCK",
  printLayout: "A4",
  diskAlertThresholdPercent: DEFAULT_DISK_ALERT_THRESHOLD_PERCENT,
  controlAccounts: { ...DEFAULT_CONTROL_ACCOUNTS },
  documentSequences: structuredClone(DEFAULT_DOCUMENT_SEQUENCES),
};

export function parseAccountingSettings(row: {
  orgName?: string | null;
  logoText?: string | null;
  defaultLang?: string | null;
  defaultTheme?: string | null;
  defaultCurrency?: string | null;
  fiscalYearStart?: string | null;
  fiscalYearEnd?: string | null;
  periodLockDate?: string | null;
  requireApprovalWorkflow?: boolean | null;
  enforceThreeWayMatch?: boolean | null;
  threeWayTolerancePct?: unknown;
  threeWayToleranceAmount?: unknown;
  costingMethod?: string | null;
  negativeStockPolicy?: string | null;
  printLayout?: string | null;
  controlAccountsJson?: string | null;
  documentSequencesJson?: string | null;
  tenantAdminConfigJson?: string | null;
} | null): AccountingSettingsConfig {
  if (!row) {
    return {
      ...structuredClone(DEFAULT_ACCOUNTING_SETTINGS),
      diskAlertThresholdPercent: resolveDefaultDiskAlertThresholdPercent(),
    };
  }

  let parsedControl: Partial<ControlAccountsMap> = {};
  try {
    if (row.controlAccountsJson) {
      const obj = JSON.parse(row.controlAccountsJson);
      if (obj && typeof obj === "object") parsedControl = obj;
    }
  } catch {
    parsedControl = {};
  }

  let parsedSeq: Partial<DocumentSequencesMap> = {};
  try {
    if (row.documentSequencesJson) {
      const obj = JSON.parse(row.documentSequencesJson);
      if (obj && typeof obj === "object") parsedSeq = obj;
    }
  } catch {
    parsedSeq = {};
  }

  const mergedSequences: DocumentSequencesMap = {
    JV: { ...DEFAULT_DOCUMENT_SEQUENCES.JV, ...(parsedSeq.JV || {}) },
    RV: { ...DEFAULT_DOCUMENT_SEQUENCES.RV, ...(parsedSeq.RV || {}) },
    PV: { ...DEFAULT_DOCUMENT_SEQUENCES.PV, ...(parsedSeq.PV || {}) },
    INV: { ...DEFAULT_DOCUMENT_SEQUENCES.INV, ...(parsedSeq.INV || {}) },
    BILL: { ...DEFAULT_DOCUMENT_SEQUENCES.BILL, ...(parsedSeq.BILL || {}) },
    TRN: { ...DEFAULT_DOCUMENT_SEQUENCES.TRN, ...(parsedSeq.TRN || {}) },
  };

  return {
    orgName: row.orgName || DEFAULT_ACCOUNTING_SETTINGS.orgName,
    logoText: row.logoText || DEFAULT_ACCOUNTING_SETTINGS.logoText,
    defaultLang: row.defaultLang === "en" ? "en" : "ar",
    defaultTheme:
      row.defaultTheme === "dark" || row.defaultTheme === "royal" ? row.defaultTheme : "emerald",
    defaultCurrency: (row.defaultCurrency || "YER").toUpperCase(),
    fiscalYearStart: row.fiscalYearStart || "2026-01-01",
    fiscalYearEnd: row.fiscalYearEnd || "2026-12-31",
    periodLockDate: row.periodLockDate || null,
    requireApprovalWorkflow: Boolean(row.requireApprovalWorkflow),
    enforceThreeWayMatch:
      row.enforceThreeWayMatch !== undefined && row.enforceThreeWayMatch !== null
        ? Boolean(row.enforceThreeWayMatch)
        : true,
    threeWayTolerancePct: Math.max(0, Number(row.threeWayTolerancePct) || 0),
    threeWayToleranceAmount:
      row.threeWayToleranceAmount !== undefined && row.threeWayToleranceAmount !== null
        ? Math.max(0, Number(row.threeWayToleranceAmount) || 0)
        : 0.01,
    costingMethod: row.costingMethod === "FIFO" ? "FIFO" : "WEIGHTED_AVERAGE",
    negativeStockPolicy: row.negativeStockPolicy === "WARN" ? "WARN" : "BLOCK",
    printLayout: row.printLayout || "A4",
    diskAlertThresholdPercent: resolveEffectiveDiskThresholdPercent(row),
    controlAccounts: { ...DEFAULT_CONTROL_ACCOUNTS, ...parsedControl },
    documentSequences: mergedSequences,
  };
}

/**
 * Throws a clear bilingual error if `txDate` falls on or before `periodLockDate`.
 */
export function assertNotInLockedPeriod(
  txDate: Date | string,
  periodLockDate: string | null | undefined
): { ok: true } | { ok: false; error: string } {
  if (!periodLockDate || !periodLockDate.trim()) return { ok: true };
  const lockTs = new Date(`${periodLockDate.slice(0, 10)}T23:59:59.999Z`).getTime();
  const txIso = typeof txDate === "string" ? txDate : txDate.toISOString();
  const txTs = new Date(txIso.length === 10 ? `${txIso}T12:00:00.000Z` : txIso).getTime();
  if (Number.isNaN(lockTs) || Number.isNaN(txTs)) return { ok: true };
  if (txTs <= lockTs) {
    return {
      ok: false,
      error: `🔒 التاريخ (${txIso.slice(0, 10)}) يقع ضمن فترة محاسبية مقفلة حتى ${periodLockDate.slice(0, 10)} / Transaction date falls on or before locked period date (${periodLockDate.slice(0, 10)}).`,
    };
  }
  return { ok: true };
}

/**
 * Generates the next formatted document number (e.g. `JV-2026-00001`) and returns the incremented sequence map.
 */
export function generateNextDocumentNumber(
  docType: DocumentSequenceKey,
  sequences: DocumentSequencesMap,
  year: number = new Date().getFullYear()
): { documentNumber: string; nextSequences: DocumentSequencesMap } {
  const current = sequences[docType] || DEFAULT_DOCUMENT_SEQUENCES[docType];
  const numStr = String(Math.max(1, Math.floor(current.nextNumber))).padStart(current.padding || 5, "0");
  const prefix = current.prefix.endsWith("-") ? current.prefix : `${current.prefix}-`;
  const documentNumber = `${prefix}${year}-${numStr}`;
  const nextSequences: DocumentSequencesMap = {
    ...sequences,
    [docType]: {
      ...current,
      nextNumber: current.nextNumber + 1,
    },
  };
  return { documentNumber, nextSequences };
}

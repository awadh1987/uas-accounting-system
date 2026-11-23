/**
 * UAS Enterprise — Full On-Device Android Local Persistence Adapter
 *
 * When running inside the Capacitor Android APK in `"local"` mode
 * (`isNativeAndroid() && getStoredRuntimeMode() === "local"`), this adapter
 * intercepts all `/api/*` requests and persists them directly into structured
 * `localStorage` collections (`uas_offline_db_*`) seeded with a clean default
 * company (`admin@uas-ye.com` only — ZERO shared `qat.world` accounts).
 *
 * Every mutation (`POST`, `PUT`, `PATCH`, `DELETE`) is also appended to
 * `uas_offline_sync_queue` so it can be replayed later if the company connects
 * to a dedicated Office LAN or Cloud server.
 */
import {
  computeOperatingExpenseTotal,
  computeQrVerificationCode,
  computeSaleTotals,
  computeWorkerWageTotals,
  formatAuditTimestamp,
} from "@/lib/formulas";
import { evaluateSaleAgainstHarvestStock } from "@/lib/harvestReconciliation";
import { INITIAL_FALLBACK_STATE } from "@/lib/seedFallback";
import { normalizeRole, ROLE_DEFINITIONS } from "@/lib/permissions";
import {
  LocalStorageProfileStore,
  LocalStorageSeatStore,
  loadOfflineClientLicense,
  releaseSeat,
  seatPolicyFromLicense,
  isCompanyLockedPayload,
} from "@/lib/licensing";
import { DEFAULT_CURRENCIES } from "@/lib/multiCurrencyEngine";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_UOMS,
  DEFAULT_WAREHOUSES,
  slugifyLookupCode,
} from "@/lib/multiUnitInventoryEngine";
import {
  applyMemoryUpsert,
  normalizeMemoryTenantSlug,
  type CopilotMemoryCategory,
  type CopilotMemoryEntry,
  type CopilotMemoryScope,
} from "@/lib/ai/copilotMemoryTypes";
import { generateExecutiveBriefing } from "@/lib/ai/executiveBriefingEngine";
import type {
  UasBootstrapState,
  UasEnterpriseProfile,
  UasOperatingExpense,
  UasProject,
  UasTreasuryAccount,
  UasUser,
  UasWorkerWage,
} from "@/types/uas";

export const OFFLINE_DB_STATE_KEY = "uas_offline_db_state";
export const OFFLINE_DB_PASSWORDS_KEY = "uas_offline_db_passwords";
export const OFFLINE_DB_COA_KEY = "uas_offline_db_coa";
export const OFFLINE_DB_JOURNALS_KEY = "uas_offline_db_journals";
export const OFFLINE_DB_VENDORS_KEY = "uas_offline_db_vendors";
export const OFFLINE_DB_CUSTOMERS_KEY = "uas_offline_db_customers";
export const OFFLINE_DB_INVOICES_KEY = "uas_offline_db_invoices";
export const OFFLINE_DB_BILLS_KEY = "uas_offline_db_bills";
export const OFFLINE_DB_POS_KEY = "uas_offline_db_pos";
export const OFFLINE_DB_RECEIPTS_KEY = "uas_offline_db_receipts";
export const OFFLINE_DB_PAYMENTS_KEY = "uas_offline_db_payments";
export const OFFLINE_DB_CURRENCIES_KEY = "uas_offline_db_currencies";
export const OFFLINE_DB_EXCHANGE_RATES_KEY = "uas_offline_db_exchange_rates";
export const OFFLINE_DB_UOMS_KEY = "uas_offline_db_uoms";
export const OFFLINE_DB_CATEGORIES_KEY = "uas_offline_db_categories";
export const OFFLINE_DB_WAREHOUSES_KEY = "uas_offline_db_warehouses";
export const OFFLINE_DB_ITEMS_KEY = "uas_offline_db_items";
export const OFFLINE_DB_MOVEMENTS_KEY = "uas_offline_db_movements";
export const OFFLINE_DB_COST_CENTERS_KEY = "uas_offline_db_cost_centers";
export const OFFLINE_DB_FISCAL_YEARS_KEY = "uas_offline_db_fiscal_years";
export const OFFLINE_DB_DRAFTS_KEY = "uas_offline_db_drafts";
export const OFFLINE_DB_APPROVAL_RULES_KEY = "uas_offline_db_approval_rules";
export const OFFLINE_DB_APPROVAL_REQUESTS_KEY = "uas_offline_db_approval_requests";
export const OFFLINE_DB_IDEMPOTENCY_KEY = "uas_offline_db_idempotency";
export const OFFLINE_DB_DISPATCHES_KEY = "uas_offline_db_dispatches";
export const OFFLINE_SYNC_QUEUE_KEY = "uas_offline_sync_queue";

export const DEFAULT_LOCAL_ADMIN_EMAIL = "admin@uas-ye.com";
export const DEFAULT_LOCAL_ADMIN_PASSWORD = "123456";

export interface OfflineStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear?: () => void;
}

export interface OfflineSyncQueueEntry {
  id: string;
  endpoint: string;
  method: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

function getDefaultStorage(): OfflineStorageLike | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Clean default company state for Android Local Mode:
 * Contains ONLY the local `admin@uas-ye.com` SUPER_ADMIN account and Main Cash Vault (0.00).
 * Never contains shared `qat.world` accounts (e.g. `admin@qat.world` or `hadi@qat.world`).
 */
export function createCleanOfflineCompanyState(): UasBootstrapState {
  const base = structuredClone(INITIAL_FALLBACK_STATE);
  base.users = [
    {
      id: "u1",
      username: "admin",
      name: "مدير النظام العام",
      fullName: "مدير النظام العام / System Owner",
      displayName: "",
      phone: "",
      email: DEFAULT_LOCAL_ADMIN_EMAIL,
      role: "SUPER_ADMIN",
      department: "الإدارة العليا وتقنية المعلومات",
      active: true,
      isActive: true,
      archivedAt: null,
      avatarChar: "م",
      avatarColor: "#059669",
      preferredLang: "ar",
      preferredCurrency: "YER",
      preferredTheme: "emerald",
      defaultModule: "dashboard",
      useCustomPermissions: false,
      customAllowedGroups: [],
      customPermissionsJson: {},
      mustChangePassword: false,
      assignedProjects: [],
    },
  ];
  return base;
}

export function loadOfflineAndroidState(storage?: OfflineStorageLike | null): UasBootstrapState {
  const s = storage ?? getDefaultStorage();
  if (!s) return createCleanOfflineCompanyState();
  const applyInstalledCreds = (st: UasBootstrapState): UasBootstrapState => {
    const lic = loadOfflineClientLicense(s);
    const cred = lic?.admin_credentials;
    if (cred && st.users.length === 1 && st.users[0]?.email === DEFAULT_LOCAL_ADMIN_EMAIL) {
      st.users[0].email = cred.email.trim().toLowerCase();
      st.users[0].username = cred.username.trim();
      st.users[0].fullName = `مدير النظام العام / ${lic.company_name || lic.customer_name}`;
    }
    return st;
  };
  const normalizeStateShape = (st: UasBootstrapState): UasBootstrapState => {
    if (!Array.isArray(st.projects)) st.projects = [];
    if (!Array.isArray(st.expenses)) st.expenses = [];
    if (!Array.isArray(st.workers)) st.workers = [];
    if (!Array.isArray(st.sales)) st.sales = [];
    if (!Array.isArray(st.installments)) st.installments = [];
    if (!Array.isArray(st.inventoryBatches)) st.inventoryBatches = [];
    if (!Array.isArray(st.treasuryAccounts)) st.treasuryAccounts = [];
    if (!Array.isArray(st.auditLogs)) st.auditLogs = [];
    if (!st.lockedPeriods || typeof st.lockedPeriods !== "object") st.lockedPeriods = {};
    if (!st.exchangeRates || typeof st.exchangeRates !== "object") {
      st.exchangeRates = structuredClone(INITIAL_FALLBACK_STATE.exchangeRates);
    }
    return st;
  };
  try {
    const raw = s.getItem(OFFLINE_DB_STATE_KEY);
    if (!raw) {
      const clean = normalizeStateShape(applyInstalledCreds(createCleanOfflineCompanyState()));
      s.setItem(OFFLINE_DB_STATE_KEY, JSON.stringify(clean));
      return clean;
    }
    const parsed = JSON.parse(raw) as UasBootstrapState;
    if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) {
      const clean = normalizeStateShape(applyInstalledCreds(createCleanOfflineCompanyState()));
      s.setItem(OFFLINE_DB_STATE_KEY, JSON.stringify(clean));
      return clean;
    }
    return normalizeStateShape(parsed);
  } catch {
    const clean = normalizeStateShape(applyInstalledCreds(createCleanOfflineCompanyState()));
    try {
      s.setItem(OFFLINE_DB_STATE_KEY, JSON.stringify(clean));
    } catch {
      // ignore
    }
    return clean;
  }
}

export function saveOfflineAndroidState(
  state: UasBootstrapState,
  storage?: OfflineStorageLike | null
): void {
  const s = storage ?? getDefaultStorage();
  if (!s) return;
  s.setItem(OFFLINE_DB_STATE_KEY, JSON.stringify(state));
}

function readCollection<T>(key: string, storage?: OfflineStorageLike | null): T[] {
  const s = storage ?? getDefaultStorage();
  if (!s) return [];
  try {
    const raw = s.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeCollection<T>(key: string, rows: T[], storage?: OfflineStorageLike | null): void {
  const s = storage ?? getDefaultStorage();
  if (!s) return;
  s.setItem(key, JSON.stringify(rows));
}

function readPasswordMap(storage?: OfflineStorageLike | null): Record<string, string> {
  const s = storage ?? getDefaultStorage();
  const buildDefaultMap = (): Record<string, string> => {
    const base: Record<string, string> = { [DEFAULT_LOCAL_ADMIN_EMAIL]: DEFAULT_LOCAL_ADMIN_PASSWORD };
    const cred = s ? loadOfflineClientLicense(s)?.admin_credentials : undefined;
    if (cred?.email && cred?.password) {
      base[cred.email.trim().toLowerCase()] = cred.password;
    }
    return base;
  };
  if (!s) return buildDefaultMap();
  try {
    const raw = s.getItem(OFFLINE_DB_PASSWORDS_KEY);
    if (!raw) {
      const initial = buildDefaultMap();
      s.setItem(OFFLINE_DB_PASSWORDS_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object"
      ? parsed
      : buildDefaultMap();
  } catch {
    return buildDefaultMap();
  }
}

function writePasswordMap(map: Record<string, string>, storage?: OfflineStorageLike | null): void {
  const s = storage ?? getDefaultStorage();
  if (!s) return;
  s.setItem(OFFLINE_DB_PASSWORDS_KEY, JSON.stringify(map));
}

export function getOfflineSyncQueue(storage?: OfflineStorageLike | null): OfflineSyncQueueEntry[] {
  return readCollection<OfflineSyncQueueEntry>(OFFLINE_SYNC_QUEUE_KEY, storage);
}

/**
 * Resolves replay priority tier for an offline mutation endpoint (lower number = earlier replay).
 * Ensures parent master models (Currencies, Cost Centers, UOMs, Categories, Items, Accounts)
 * sync before child transactions, movements, drafts, and approval decisions.
 */
export function getEndpointSyncPriority(endpoint: string): number {
  const ep = endpoint.toLowerCase();

  // Tier 1: Currencies, Exchange Rates, Fiscal Years, System Settings
  if (ep.includes("/api/currencies") || ep.includes("/api/exchange-rates") || ep.includes("/api/fiscal-years") || ep.includes("/api/system")) {
    return 10;
  }
  // Tier 2: Cost Centers
  if (ep.includes("/api/cost-centers") || ep.includes("/api/accounting/cost-centers")) {
    return 20;
  }
  // Tier 3: Inventory Lookups (UOMs, Categories, Warehouses)
  if (
    ep.includes("/api/inventory/uom") ||
    ep.includes("/api/inventory/categories") ||
    ep.includes("/api/inventory/warehouses")
  ) {
    return 30;
  }
  // Tier 4: Master Entities & Catalog (COA Accounts, Customers, Vendors, Workers, Projects, Items, Conversions, Harvest Batches)
  if (
    ep.includes("/api/coa") ||
    ep.includes("/api/accounting/coa") ||
    ep.includes("/api/customers") ||
    ep.includes("/api/sales/customers") ||
    ep.includes("/api/vendors") ||
    ep.includes("/api/procurement/vendors") ||
    ep.includes("/api/workers") ||
    ep.includes("/api/projects") ||
    ep.includes("/api/inventory/items") ||
    ep.includes("/api/inventory/conversions") ||
    (ep.startsWith("/api/inventory") && !ep.includes("/movements"))
  ) {
    return 40;
  }
  // Tier 5: Rules & Drafts Creation
  if (ep.includes("/api/approvals/rules") || (ep.includes("/api/drafts") && !ep.includes("/promote"))) {
    return 50;
  }
  // Tier 6: Core Operational Transactions & Movements
  if (
    ep.includes("/api/sales") ||
    ep.includes("/api/procurement") ||
    ep.includes("/api/treasury") ||
    ep.includes("/api/expenses") ||
    ep.includes("/api/inventory/movements") ||
    ep.includes("/api/ledger") ||
    ep.includes("/api/accounting/journal") ||
    ep.includes("/api/installments") ||
    ep.includes("/api/installment-vouchers")
  ) {
    return 60;
  }
  // Tier 7: Approval Decisions & Draft Promotions
  if (ep.includes("/api/approvals/decide") || ep.includes("/api/approvals") || ep.includes("/api/drafts/promote")) {
    return 70;
  }

  // Tier 8: Catch-all
  return 80;
}

export function sortSyncQueueTopologically(queue: OfflineSyncQueueEntry[]): OfflineSyncQueueEntry[] {
  return [...queue].sort((a, b) => {
    const prioA = getEndpointSyncPriority(a.endpoint);
    const prioB = getEndpointSyncPriority(b.endpoint);
    if (prioA !== prioB) return prioA - prioB;
    // Maintain FIFO for identical priority
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

export function getPrioritizedOfflineSyncQueue(storage?: OfflineStorageLike | null): OfflineSyncQueueEntry[] {
  const queue = getOfflineSyncQueue(storage);
  return sortSyncQueueTopologically(queue);
}

export function appendOfflineSyncQueue(
  endpoint: string,
  method: string,
  payload: Record<string, unknown>,
  storage?: OfflineStorageLike | null
): void {
  const queue = getOfflineSyncQueue(storage);
  queue.push({
    id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    endpoint,
    method: method.toUpperCase(),
    payload,
    createdAt: new Date().toISOString(),
  });
  writeCollection(OFFLINE_SYNC_QUEUE_KEY, queue, storage);
}

// ---------------------------------------------------------------------------
// Accounting-Core (Phase 1) local mirror: Gen-6 sub-ledger accounts + Cost Centers
// ---------------------------------------------------------------------------
export type LocalSubLedgerType = "CUSTOMER" | "VENDOR" | "WORKER" | "TREASURY" | "WAREHOUSE" | "PROJECT";

const LOCAL_CONTROL: Record<LocalSubLedgerType, { gen5: string; type: string; ccPrefix: string; ccGroupAr: string; ccGroupEn: string; centerType: string; prefixAr: string }> = {
  CUSTOMER: { gen5: "112190", type: "ASSET", ccPrefix: "CUS", ccGroupAr: "مراكز تكلفة العملاء", ccGroupEn: "Customer Cost Centers", centerType: "OTHER", prefixAr: "" },
  VENDOR: { gen5: "211190", type: "LIABILITY", ccPrefix: "VND", ccGroupAr: "مراكز تكلفة الموردين", ccGroupEn: "Supplier Cost Centers", centerType: "OTHER", prefixAr: "" },
  WORKER: { gen5: "212190", type: "LIABILITY", ccPrefix: "WRK", ccGroupAr: "مراكز تكلفة العمال", ccGroupEn: "Worker Cost Centers", centerType: "OTHER", prefixAr: "مستحقات العامل " },
  TREASURY: { gen5: "111190", type: "ASSET", ccPrefix: "TRS", ccGroupAr: "مراكز تكلفة الخزينة", ccGroupEn: "Treasury Cost Centers", centerType: "OTHER", prefixAr: "" },
  WAREHOUSE: { gen5: "113390", type: "ASSET", ccPrefix: "WH", ccGroupAr: "مراكز تكلفة المخازن", ccGroupEn: "Warehouse Cost Centers", centerType: "DEPARTMENT", prefixAr: "مخزون " },
  PROJECT: { gen5: "121390", type: "ASSET", ccPrefix: "PRJ", ccGroupAr: "مراكز تكلفة المشاريع", ccGroupEn: "Project Cost Centers", centerType: "PROJECT", prefixAr: "مشروع " },
};

const LOCAL_CENTER_TYPES = ["BRANCH", "PROJECT", "FARM", "DEPARTMENT", "FLEET", "OTHER"];

/**
 * Offline equivalent of provisionEntityGen6AccountAndCostCenter(): creates the entity's Gen-6 postable leaf
 * account (code = Gen-5 control + 3-digit sequence) and a Cost Center, entirely inside local storage.
 */
export function provisionLocalGen6AccountAndCostCenter(
  entityType: LocalSubLedgerType,
  entity: { id: string; nameAr: string; nameEn?: string },
  storage?: OfflineStorageLike | null
): { glAccountId: string; glAccountCode: string; costCenterId: string; costCenterCode: string } {
  const s = storage ?? getDefaultStorage();
  const spec = LOCAL_CONTROL[entityType];
  const accounts = readCollection<Record<string, unknown>>(OFFLINE_DB_COA_KEY, s);
  const centers = readCollection<Record<string, unknown>>(OFFLINE_DB_COST_CENTERS_KEY, s);

  const existing = accounts.find((a) => a.subLedgerType === entityType && a.subLedgerEntityId === entity.id && a.generation === 6);
  if (existing) {
    return {
      glAccountId: String(existing.id),
      glAccountCode: String(existing.code),
      costCenterId: String(existing.defaultCostCenterId || ""),
      costCenterCode: String(centers.find((c) => c.id === existing.defaultCostCenterId)?.code || ""),
    };
  }

  if (!accounts.some((a) => a.code === spec.gen5)) {
    accounts.push({
      id: `acc-${spec.gen5}`, code: spec.gen5, nameAr: spec.ccGroupAr.replace("مراكز تكلفة", "حساب رقابي"), nameEn: `${entityType} Control`,
      level: 5, generation: 5, type: spec.type, isPosting: false, isPostable: false, subLedgerType: entityType,
    });
  }
  let groupCenter = centers.find((c) => c.code === `CC-${spec.ccPrefix}`);
  if (!groupCenter) {
    groupCenter = { id: `cc-${spec.ccPrefix}`, code: `CC-${spec.ccPrefix}`, nameAr: spec.ccGroupAr, nameEn: spec.ccGroupEn, parentId: null, generation: 1, centerType: spec.centerType, isCustom: false, isActive: true };
    centers.push(groupCenter);
  }
  const ccSeq = centers.filter((c) => String(c.code).startsWith(`CC-${spec.ccPrefix}-`)).length + 1;
  const costCenter = {
    id: `cc-${spec.ccPrefix}-${Date.now().toString(36)}-${ccSeq}`,
    code: `CC-${spec.ccPrefix}-${String(ccSeq).padStart(4, "0")}`,
    nameAr: entity.nameAr, nameEn: entity.nameEn || entity.nameAr, parentId: String(groupCenter.id), generation: 2,
    centerType: spec.centerType, isCustom: false, isActive: true,
  };
  centers.push(costCenter);

  const seq = accounts.filter((a) => String(a.code).startsWith(spec.gen5) && String(a.code).length === spec.gen5.length + 3).length + 1;
  const leaf = {
    id: `acc-${spec.gen5}${String(seq).padStart(3, "0")}`,
    code: `${spec.gen5}${String(seq).padStart(3, "0")}`,
    nameAr: `${spec.prefixAr}${entity.nameAr}`, nameEn: entity.nameEn || entity.nameAr,
    level: 6, generation: 6, type: spec.type, isPosting: true, isPostable: true, parentCode: spec.gen5,
    subLedgerType: entityType, subLedgerEntityId: entity.id, defaultCostCenterId: costCenter.id,
  };
  accounts.push(leaf);
  writeCollection(OFFLINE_DB_COA_KEY, accounts, s);
  writeCollection(OFFLINE_DB_COST_CENTERS_KEY, centers, s);
  return { glAccountId: leaf.id, glAccountCode: leaf.code, costCenterId: costCenter.id, costCenterCode: costCenter.code };
}

/** Offline mirror of /api/accounting/cost-centers (GET | POST | PUT | DELETE). */
export function handleLocalCostCenters(
  method: string,
  body: Record<string, unknown>,
  query: URLSearchParams,
  storage?: OfflineStorageLike | null
): Response {
  const s = storage ?? getDefaultStorage();
  const centers = readCollection<Record<string, unknown>>(OFFLINE_DB_COST_CENTERS_KEY, s);
  if (method === "GET") return jsonResponse({ costCenters: centers, offline: true }, 200);

  if (method === "POST") {
    const nameAr = String(body.nameAr || "").trim();
    if (!nameAr) return jsonResponse({ error: "COST_CENTER_NAME_REQUIRED" }, 400);
    const centerType = String(body.centerType || "OTHER").toUpperCase();
    if (!LOCAL_CENTER_TYPES.includes(centerType)) return jsonResponse({ error: `INVALID_CENTER_TYPE:${centerType}` }, 400);
    let generation = 1;
    if (body.parentId) {
      const parent = centers.find((c) => c.id === body.parentId);
      if (!parent) return jsonResponse({ error: "PARENT_COST_CENTER_NOT_FOUND" }, 400);
      if (Number(parent.generation) >= 6) return jsonResponse({ error: "COST_CENTER_MAX_GENERATION" }, 400);
      generation = Number(parent.generation) + 1;
    }
    const code = String(body.code || `CC-GEN-${String(centers.length + 1).padStart(4, "0")}`).trim();
    if (centers.some((c) => c.code === code)) return jsonResponse({ error: `DUPLICATE_COST_CENTER_CODE:${code}` }, 400);
    const costCenter = {
      id: `cc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      code, nameAr, nameEn: String(body.nameEn || nameAr), parentId: body.parentId ? String(body.parentId) : null,
      generation, centerType, customLabel: body.customLabel ? String(body.customLabel) : null,
      isCustom: centerType === "OTHER", isActive: true,
    };
    centers.push(costCenter);
    writeCollection(OFFLINE_DB_COST_CENTERS_KEY, centers, s);
    appendOfflineSyncQueue("/api/accounting/cost-centers", method, body, s);
    return jsonResponse({ success: true, costCenter, costCenters: centers, offline: true }, 201);
  }

  const id = String(body.id || query.get("id") || "");
  const idx = centers.findIndex((c) => c.id === id);
  if (idx < 0) return jsonResponse({ error: "COST_CENTER_NOT_FOUND" }, 404);

  if (method === "PUT" || method === "PATCH") {
    const cur = centers[idx];
    if (body.nameAr !== undefined) cur.nameAr = String(body.nameAr);
    if (body.nameEn !== undefined) cur.nameEn = String(body.nameEn);
    if (body.isActive !== undefined) cur.isActive = Boolean(body.isActive);
    if (body.customLabel !== undefined) cur.customLabel = body.customLabel ? String(body.customLabel) : null;
    if (body.centerType !== undefined) {
      const t = String(body.centerType).toUpperCase();
      if (!LOCAL_CENTER_TYPES.includes(t)) return jsonResponse({ error: `INVALID_CENTER_TYPE:${t}` }, 400);
      cur.centerType = t;
      cur.isCustom = t === "OTHER";
    }
    writeCollection(OFFLINE_DB_COST_CENTERS_KEY, centers, s);
    appendOfflineSyncQueue("/api/accounting/cost-centers", method, body, s);
    return jsonResponse({ success: true, costCenter: cur, offline: true }, 200);
  }

  if (method === "DELETE") {
    const accounts = readCollection<Record<string, unknown>>(OFFLINE_DB_COA_KEY, s);
    const journals = readCollection<Record<string, unknown>>(OFFLINE_DB_JOURNALS_KEY, s);
    const inUse =
      centers.some((c) => c.parentId === id) ||
      accounts.some((a) => a.defaultCostCenterId === id) ||
      journals.some((j) => JSON.stringify(j).includes(`"costCenterId":"${id}"`));
    if (inUse) {
      centers[idx].isActive = false;
      writeCollection(OFFLINE_DB_COST_CENTERS_KEY, centers, s);
      appendOfflineSyncQueue("/api/accounting/cost-centers", method, body, s);
      return jsonResponse({ success: true, deleted: false, deactivated: true, offline: true }, 200);
    }
    centers.splice(idx, 1);
    writeCollection(OFFLINE_DB_COST_CENTERS_KEY, centers, s);
    appendOfflineSyncQueue("/api/accounting/cost-centers", method, body, s);
    return jsonResponse({ success: true, deleted: true, deactivated: false, offline: true }, 200);
  }
  return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-UAS-Offline-Local": "1",
    },
  });
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body) return {};
  if (typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function extractActorFromReq(body: Record<string, unknown>, init?: RequestInit) {
  const headers = new Headers(init?.headers || undefined);
  const actorObj =
    body.actor && typeof body.actor === "object" ? (body.actor as Record<string, unknown>) : {};
  const userId = String(actorObj.userId || body.userId || headers.get("x-uas-user-id") || "u1");
  const userRole = String(actorObj.userRole || body.userRole || headers.get("x-uas-role") || "SUPER_ADMIN");
  const userDisplay = String(
    actorObj.userDisplay || body.userDisplay || headers.get("x-uas-user-display") || "مدير النظام العام (SUPER_ADMIN)"
  );
  return { userId, userRole, userDisplay };
}

function addLocalAudit(state: UasBootstrapState, userDisplay: string, action: string, details: string): void {
  const ts = formatAuditTimestamp(new Date());
  state.auditLogs.unshift({
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: ts,
    user: userDisplay,
    action,
    details,
    hash: computeQrVerificationCode(`${action}:${details}:${Date.now()}`),
  });
}

async function releaseLocalSeatsForEmail(email: string, storage?: OfflineStorageLike | null): Promise<number> {
  const s = storage ?? getDefaultStorage();
  if (!s) return 0;
  const license = loadOfflineClientLicense(s);
  if (!license || !isCompanyLockedPayload(license)) return 0;
  try {
    const seatStore = new LocalStorageSeatStore(s);
    const res = await releaseSeat(
      seatStore,
      seatPolicyFromLicense(license),
      license.license_id,
      email.trim().toLowerCase(),
      "all"
    );
    return res.released;
  } catch {
    return 0;
  }
}

export function extractOfflineIdempotencyKey(init?: RequestInit): string | null {
  if (!init || !init.headers) return null;
  const headers = new Headers(init.headers);
  return (
    headers.get("x-idempotency-key") ||
    headers.get("X-Idempotency-Key") ||
    headers.get("X-IDEMPOTENCY-KEY")
  );
}

export function handleLocalMasterLifecycle(
  entityType: string,
  id: string,
  action: string,
  actor: { userId: string; userDisplay: string; userRole: string },
  s: OfflineStorageLike | null
): Response {
  const normAction = action.toUpperCase();
  const state = loadOfflineAndroidState(s);
  const now = new Date().toISOString();

  if (entityType === "Customer") {
    const customers = readCollection<Record<string, unknown>>(OFFLINE_DB_CUSTOMERS_KEY, s);
    const idx = customers.findIndex((c) => c.id === id || c.code === id);
    if (idx < 0) return jsonResponse({ ok: false, status: 404, message: "العميل غير موجود" }, 404);

    if (normAction === "RESTORE") {
      customers[idx].isActive = true;
      customers[idx].archivedAt = null;
      writeCollection(OFFLINE_DB_CUSTOMERS_KEY, customers, s);
      addLocalAudit(state, actor.userDisplay, "استعادة عميل (محلي)", String(customers[idx].name || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, restored: true, message: "تمت استعادة العميل بنجاح", entityType, id });
    }

    if (normAction === "ARCHIVE") {
      customers[idx].isActive = false;
      customers[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_CUSTOMERS_KEY, customers, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة عميل (محلي)", String(customers[idx].name || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, archived: true, message: "تمت أرشفة العميل بنجاح", entityType, id });
    }

    const journals = readCollection<Record<string, unknown>>(OFFLINE_DB_JOURNALS_KEY, s);
    const invoices = readCollection<Record<string, unknown>>(OFFLINE_DB_INVOICES_KEY, s);
    const hasLinked =
      state.sales.some((sale) => sale.customerId === id || sale.customer === customers[idx].name) ||
      invoices.some((inv) => inv.customerId === id) ||
      journals.some((j) => JSON.stringify(j).includes(id));

    if (hasLinked) {
      customers[idx].isActive = false;
      customers[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_CUSTOMERS_KEY, customers, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة آلية لعميل لوجود حركات (محلي)", String(customers[idx].name || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({
        ok: true,
        deleted: false,
        archived: true,
        linkedCount: 1,
        message: "تم أرشفة العميل لوجود حركات مالية وتاريخية مرتبطة",
        entityType,
        id,
      });
    }

    customers.splice(idx, 1);
    writeCollection(OFFLINE_DB_CUSTOMERS_KEY, customers, s);
    addLocalAudit(state, actor.userDisplay, "حذف نهائي لعميل (محلي)", id);
    saveOfflineAndroidState(state, s);
    return jsonResponse({
      ok: true,
      deleted: true,
      archived: false,
      linkedCount: 0,
      message: "تم حذف العميل نهائياً لعدم وجود حركات مرتبطة",
      entityType,
      id,
    });
  }

  if (entityType === "Vendor") {
    const vendors = readCollection<Record<string, unknown>>(OFFLINE_DB_VENDORS_KEY, s);
    const idx = vendors.findIndex((v) => v.id === id || v.code === id);
    if (idx < 0) return jsonResponse({ ok: false, status: 404, message: "المورد غير موجود" }, 404);

    if (normAction === "RESTORE") {
      vendors[idx].isActive = true;
      vendors[idx].archivedAt = null;
      writeCollection(OFFLINE_DB_VENDORS_KEY, vendors, s);
      addLocalAudit(state, actor.userDisplay, "استعادة مورد (محلي)", String(vendors[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, restored: true, message: "تمت استعادة المورد بنجاح", entityType, id });
    }

    if (normAction === "ARCHIVE") {
      vendors[idx].isActive = false;
      vendors[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_VENDORS_KEY, vendors, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة مورد (محلي)", String(vendors[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, archived: true, message: "تمت أرشفة المورد بنجاح", entityType, id });
    }

    const bills = readCollection<Record<string, unknown>>(OFFLINE_DB_BILLS_KEY, s);
    const pos = readCollection<Record<string, unknown>>(OFFLINE_DB_POS_KEY, s);
    const journals = readCollection<Record<string, unknown>>(OFFLINE_DB_JOURNALS_KEY, s);
    const hasLinked =
      bills.some((b) => b.vendorId === id) ||
      pos.some((p) => p.vendorId === id) ||
      journals.some((j) => JSON.stringify(j).includes(id));

    if (hasLinked) {
      vendors[idx].isActive = false;
      vendors[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_VENDORS_KEY, vendors, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة آلية لمورد لوجود حركات (محلي)", String(vendors[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({
        ok: true,
        deleted: false,
        archived: true,
        linkedCount: 1,
        message: "تم أرشفة المورد لوجود حركات مالية وتاريخية مرتبطة",
        entityType,
        id,
      });
    }

    vendors.splice(idx, 1);
    writeCollection(OFFLINE_DB_VENDORS_KEY, vendors, s);
    addLocalAudit(state, actor.userDisplay, "حذف نهائي لمورد (محلي)", id);
    saveOfflineAndroidState(state, s);
    return jsonResponse({
      ok: true,
      deleted: true,
      archived: false,
      linkedCount: 0,
      message: "تم حذف المورد نهائياً لعدم وجود حركات مرتبطة",
      entityType,
      id,
    });
  }

  if (entityType === "Worker") {
    const idx = state.workers.findIndex((w) => w.id === id || w.name === id);
    if (idx < 0) return jsonResponse({ ok: false, status: 404, message: "العامل غير موجود" }, 404);

    if (normAction === "RESTORE") {
      state.workers[idx].isActive = true;
      state.workers[idx].archivedAt = null;
      addLocalAudit(state, actor.userDisplay, "استعادة عامل (محلي)", state.workers[idx].name);
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, restored: true, message: "تمت استعادة العامل بنجاح", entityType, id });
    }

    if (normAction === "ARCHIVE") {
      state.workers[idx].isActive = false;
      state.workers[idx].archivedAt = now;
      addLocalAudit(state, actor.userDisplay, "أرشفة عامل (محلي)", state.workers[idx].name);
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, archived: true, message: "تمت أرشفة العامل بنجاح", entityType, id });
    }

    const journals = readCollection<Record<string, unknown>>(OFFLINE_DB_JOURNALS_KEY, s);
    const hasLinked =
      (state.workers[idx].days || 0) > 0 ||
      (state.workers[idx].total || 0) > 0 ||
      journals.some((j) => JSON.stringify(j).includes(id));

    if (hasLinked) {
      state.workers[idx].isActive = false;
      state.workers[idx].archivedAt = now;
      addLocalAudit(state, actor.userDisplay, "أرشفة آلية لعامل لوجود حركات (محلي)", state.workers[idx].name);
      saveOfflineAndroidState(state, s);
      return jsonResponse({
        ok: true,
        deleted: false,
        archived: true,
        linkedCount: 1,
        message: "تم أرشفة العامل لوجود حركات مرتبطة",
        entityType,
        id,
      });
    }

    state.workers.splice(idx, 1);
    addLocalAudit(state, actor.userDisplay, "حذف نهائي لعامل (محلي)", id);
    saveOfflineAndroidState(state, s);
    return jsonResponse({
      ok: true,
      deleted: true,
      archived: false,
      linkedCount: 0,
      message: "تم حذف العامل نهائياً لعدم وجود حركات مرتبطة",
      entityType,
      id,
    });
  }

  if (entityType === "Warehouse") {
    const warehouses = readCollection<Record<string, unknown>>(OFFLINE_DB_WAREHOUSES_KEY, s);
    const idx = warehouses.findIndex((w) => w.id === id || w.code === id);
    if (idx < 0) return jsonResponse({ ok: false, status: 404, message: "المستودع غير موجود" }, 404);

    if (normAction === "RESTORE") {
      warehouses[idx].isActive = true;
      warehouses[idx].archivedAt = null;
      writeCollection(OFFLINE_DB_WAREHOUSES_KEY, warehouses, s);
      addLocalAudit(state, actor.userDisplay, "استعادة مستودع (محلي)", String(warehouses[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, restored: true, message: "تمت استعادة المستودع بنجاح", entityType, id });
    }

    if (normAction === "ARCHIVE") {
      warehouses[idx].isActive = false;
      warehouses[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_WAREHOUSES_KEY, warehouses, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة مستودع (محلي)", String(warehouses[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, archived: true, message: "تمت أرشفة المستودع بنجاح", entityType, id });
    }

    const movements = readCollection<Record<string, unknown>>(OFFLINE_DB_MOVEMENTS_KEY, s);
    const inUse = movements.some((m) => m.warehouseId === id);

    if (inUse) {
      warehouses[idx].isActive = false;
      warehouses[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_WAREHOUSES_KEY, warehouses, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة آلية لمستودع لوجود حركات (محلي)", String(warehouses[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({
        ok: true,
        deleted: false,
        archived: true,
        linkedCount: 1,
        message: "تم أرشفة المستودع لوجود حركات مخزنية مرتبطة",
        entityType,
        id,
      });
    }

    warehouses.splice(idx, 1);
    writeCollection(OFFLINE_DB_WAREHOUSES_KEY, warehouses, s);
    addLocalAudit(state, actor.userDisplay, "حذف نهائي لمستودع (محلي)", id);
    saveOfflineAndroidState(state, s);
    return jsonResponse({
      ok: true,
      deleted: true,
      archived: false,
      linkedCount: 0,
      message: "تم حذف المستودع نهائياً لعدم وجود حركات مرتبطة",
      entityType,
      id,
    });
  }

  if (entityType === "InventoryItem") {
    const items = readCollection<Record<string, unknown>>(OFFLINE_DB_ITEMS_KEY, s);
    const idx = items.findIndex((i) => i.id === id || i.sku === id);
    if (idx < 0) return jsonResponse({ ok: false, status: 404, message: "الصنف غير موجود" }, 404);

    if (normAction === "RESTORE") {
      items[idx].isActive = true;
      items[idx].archivedAt = null;
      writeCollection(OFFLINE_DB_ITEMS_KEY, items, s);
      addLocalAudit(state, actor.userDisplay, "استعادة صنف (محلي)", String(items[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, restored: true, message: "تمت استعادة الصنف بنجاح", entityType, id });
    }

    if (normAction === "ARCHIVE") {
      items[idx].isActive = false;
      items[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_ITEMS_KEY, items, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة صنف (محلي)", String(items[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, archived: true, message: "تمت أرشفة الصنف بنجاح", entityType, id });
    }

    const movements = readCollection<Record<string, unknown>>(OFFLINE_DB_MOVEMENTS_KEY, s);
    const inUse = movements.some((m) => m.itemId === id);

    if (inUse) {
      items[idx].isActive = false;
      items[idx].archivedAt = now;
      writeCollection(OFFLINE_DB_ITEMS_KEY, items, s);
      addLocalAudit(state, actor.userDisplay, "أرشفة آلية لصنف لوجود حركات (محلي)", String(items[idx].nameAr || id));
      saveOfflineAndroidState(state, s);
      return jsonResponse({
        ok: true,
        deleted: false,
        archived: true,
        linkedCount: 1,
        message: "تم أرشفة الصنف لوجود حركات مخزنية مرتبطة",
        entityType,
        id,
      });
    }

    items.splice(idx, 1);
    writeCollection(OFFLINE_DB_ITEMS_KEY, items, s);
    addLocalAudit(state, actor.userDisplay, "حذف نهائي لصنف (محلي)", id);
    saveOfflineAndroidState(state, s);
    return jsonResponse({
      ok: true,
      deleted: true,
      archived: false,
      linkedCount: 0,
      message: "تم حذف الصنف نهائياً لعدم وجود حركات مرتبطة",
      entityType,
      id,
    });
  }

  if (entityType === "WorkspaceDraft") {
    const drafts = readCollection<Record<string, unknown>>(OFFLINE_DB_DRAFTS_KEY, s);
    const idx = drafts.findIndex((d) => d.id === id || d.draftNumber === id);
    if (idx >= 0) {
      drafts[idx].status = "DISCARDED";
      writeCollection(OFFLINE_DB_DRAFTS_KEY, drafts, s);
      return jsonResponse({ ok: true, deleted: true, message: "تم إلغاء المسودة", entityType, id });
    }
    return jsonResponse({ ok: false, status: 404, message: "المسودة غير موجودة" }, 404);
  }

  if (entityType === "TreasuryAccount") {
    const idx = state.treasuryAccounts.findIndex((t) => t.id === id || t.code === id);
    if (idx < 0) return jsonResponse({ ok: false, status: 404, message: "حساب الخزينة غير موجود" }, 404);

    if (normAction === "RESTORE") {
      state.treasuryAccounts[idx].isActive = true;
      state.treasuryAccounts[idx].archivedAt = null;
      addLocalAudit(state, actor.userDisplay, "استعادة حساب خزينة (محلي)", state.treasuryAccounts[idx].nameAr || id);
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, restored: true, message: "تمت استعادة حساب الخزينة بنجاح", entityType, id });
    }

    if (normAction === "ARCHIVE") {
      state.treasuryAccounts[idx].isActive = false;
      state.treasuryAccounts[idx].archivedAt = now;
      addLocalAudit(state, actor.userDisplay, "أرشفة حساب خزينة (محلي)", state.treasuryAccounts[idx].nameAr || id);
      saveOfflineAndroidState(state, s);
      return jsonResponse({ ok: true, archived: true, message: "تمت أرشفة حساب الخزينة بنجاح", entityType, id });
    }

    // SAFE_DELETE
    const dispatches = readCollection<Record<string, unknown>>(OFFLINE_DB_DISPATCHES_KEY, s).filter(
      (d) => d.treasuryAccountId === id
    );
    if (dispatches.length > 0 || (Number(state.treasuryAccounts[idx].balance) || 0) > 0) {
      state.treasuryAccounts[idx].isActive = false;
      state.treasuryAccounts[idx].archivedAt = now;
      addLocalAudit(
        state,
        actor.userDisplay,
        "أرشفة آلية لحساب خزينة (محلي)",
        state.treasuryAccounts[idx].nameAr || id
      );
      saveOfflineAndroidState(state, s);
      return jsonResponse({
        ok: true,
        archived: true,
        deleted: false,
        linkedCount: dispatches.length || 1,
        message: "تم أرشفة حساب الخزينة لوجود حركات مالية أو رصيد مرتبط به",
        entityType,
        id,
      });
    }

    state.treasuryAccounts.splice(idx, 1);
    addLocalAudit(state, actor.userDisplay, "حذف نهائي لحساب خزينة (محلي)", id);
    saveOfflineAndroidState(state, s);
    return jsonResponse({
      ok: true,
      deleted: true,
      archived: false,
      linkedCount: 0,
      message: "تم حذف حساب الخزينة نهائياً لعدم وجود حركات مرتبطة به",
      entityType,
      id,
    });
  }

  return jsonResponse({ ok: true, message: "تمت معالجة السجل محلياً", entityType, id });
}

/**
 * Handles any relative `/api/*` request locally on Android in `"local"` mode.
 * Returns a standard `Response` with `application/json` — never touches `https://qat.world`
 * and never falls through to Capacitor's `<!DOCTYPE html>` SPA fallback.
 */
export async function handleOfflineAndroidApiRequest(
  rawUrl: string,
  init?: RequestInit,
  storage?: OfflineStorageLike | null
): Promise<Response> {
  const s = storage ?? getDefaultStorage();
  const method = (init?.method || "GET").toUpperCase();
  const isMutating = method !== "GET" && method !== "HEAD";
  const idempotencyKey = extractOfflineIdempotencyKey(init);

  if (idempotencyKey && isMutating) {
    const cached = readCollection<{
      idempotencyKey: string;
      statusCode: number;
      responseJson: string;
      expiresAt: number;
    }>(OFFLINE_DB_IDEMPOTENCY_KEY, s);

    const hit = cached.find(
      (r) => r.idempotencyKey === idempotencyKey && r.expiresAt > Date.now()
    );
    if (hit) {
      return new Response(hit.responseJson, {
        status: hit.statusCode,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-UAS-Offline-Local": "1",
          "X-Idempotency-Hit": "true",
          "X-Idempotency-Key": idempotencyKey,
        },
      });
    }
  }

  const res = await handleOfflineAndroidApiRequestCore(rawUrl, init, s);

  if (idempotencyKey && isMutating && res.status < 500) {
    try {
      const cloned = res.clone();
      const text = await cloned.text();
      const cached = readCollection<{
        idempotencyKey: string;
        statusCode: number;
        responseJson: string;
        expiresAt: number;
      }>(OFFLINE_DB_IDEMPOTENCY_KEY, s);
      const next = cached.filter(
        (r) => r.expiresAt > Date.now() && r.idempotencyKey !== idempotencyKey
      );
      next.push({
        idempotencyKey,
        statusCode: res.status,
        responseJson: text,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      writeCollection(OFFLINE_DB_IDEMPOTENCY_KEY, next, s);
    } catch {
      // Ignore cache persistence error
    }
  }

  return res;
}

function handleOfflineScopedReset(
  reqBody: Record<string, unknown>,
  actor: { userId?: string | null; userDisplay: string; userRole: string },
  storage?: OfflineStorageLike | null
): Response {
  const s = storage ?? getDefaultStorage();
  const scope = String(reqBody.scope || "section");
  const sectionModule = String(reqBody.sectionModule || "sales");
  const unitType = reqBody.unitType ? String(reqBody.unitType) : undefined;
  const unitId = reqBody.unitId ? String(reqBody.unitId) : undefined;
  const coaMode = String(reqBody.coaMode || "starter_template");
  const confirmationPhrase = String(reqBody.confirmationPhrase || "").trim().toUpperCase();

  if (actor.userRole !== "SUPER_ADMIN") {
    return jsonResponse(
      { error: "صلاحية المشرف العام (SUPER_ADMIN) مطلوبة لتنفيذ عمليات إعادة الضبط" },
      403
    );
  }

  let expectedPhrase = "RESET_SECTION";
  if (scope === "section") {
    expectedPhrase = `RESET_SECTION_${sectionModule.toUpperCase()}`;
  } else if (scope === "unit") {
    expectedPhrase = "RESET_UNIT";
  } else {
    expectedPhrase = "FACTORY_RESET";
  }

  if (
    confirmationPhrase !== expectedPhrase &&
    confirmationPhrase !== "CONFIRM-RESET" &&
    confirmationPhrase !== "CONFIRM-FACTORY-RESET"
  ) {
    return jsonResponse(
      { error: `عبارة التأكيد غير صحيحة. يرجى إدخال: "${expectedPhrase}" للمتابعة.` },
      400
    );
  }

  interface OfflineResetState extends Omit<UasBootstrapState, "treasuryAccounts" | "workers" | "projects" | "expenses"> {
    treasuryAccounts: Array<UasTreasuryAccount & { currentBalance?: number }>;
    workers: Array<UasWorkerWage & { currentBalance?: number }>;
    projects: Array<UasProject & { spentAmount?: number; revenueAmount?: number }>;
    expenses: Array<UasOperatingExpense & { costCenterId?: string }>;
    salesInvoices?: Array<{ projectId?: string }>;
    saleTransactions?: unknown[];
    installmentVouchers?: unknown[];
    customers?: Array<{ balance?: number; currentBalance?: number }>;
    purchaseOrders?: Array<{ projectId?: string }>;
    vendorBills?: unknown[];
    paymentVouchers?: unknown[];
    vendors?: Array<{ balance?: number; currentBalance?: number }>;
    stockMovements?: unknown[];
    stockBalances?: unknown[];
    inventoryLots?: unknown[];
    stockItems?: Array<{ currentStock?: number }>;
    treasuryTransactions?: unknown[];
    vouchers?: unknown[];
    wageEntries?: Array<{ projectId?: string }>;
    costCenters?: Array<{ id?: string; currentBalance?: number }>;
    journalEntries?: unknown[];
    drafts?: unknown[];
    accounts?: unknown[];
  }

  interface OfflineCoaAccountResetItem {
    code: string;
    nameAr: string;
    nameEn: string;
    level: number;
    type: string;
    isPosting: boolean;
    debit?: number;
    credit?: number;
    balance?: number;
  }

  const state = loadOfflineAndroidState(s) as OfflineResetState;
  const deletedCounts: Record<string, number> = {};

  const backupKey = `uas_offline_prereset_${Date.now()}`;
  if (s) {
    try {
      s.setItem(backupKey, JSON.stringify(state));
    } catch {}
  }

  // Purge sync queue entries matching the reset scope to prevent sync loops
  const syncQueueRaw = s?.getItem("uas_offline_sync_queue");
  let syncQueue: OfflineSyncQueueEntry[] = [];
  if (syncQueueRaw) {
    try {
      const parsed = JSON.parse(syncQueueRaw);
      if (Array.isArray(parsed)) syncQueue = parsed as OfflineSyncQueueEntry[];
    } catch {
      syncQueue = [];
    }
  }

  if (scope === "section") {
    if (sectionModule === "sales") {
      deletedCounts.salesInvoices = (state.salesInvoices || []).length;
      state.salesInvoices = [];
      state.saleTransactions = [];
      state.installmentVouchers = [];
      for (const c of state.customers || []) {
        c.balance = 0;
        c.currentBalance = 0;
      }
      syncQueue = syncQueue.filter(
        (item: OfflineSyncQueueEntry) =>
          !item.endpoint?.includes("/api/commercial/sales") &&
          !item.endpoint?.includes("/api/installments")
      );
    } else if (sectionModule === "procurement") {
      deletedCounts.purchaseOrders = (state.purchaseOrders || []).length;
      state.purchaseOrders = [];
      state.vendorBills = [];
      state.paymentVouchers = [];
      for (const v of state.vendors || []) {
        v.balance = 0;
        v.currentBalance = 0;
      }
      syncQueue = syncQueue.filter(
        (item: OfflineSyncQueueEntry) =>
          !item.endpoint?.includes("/api/procurement") &&
          !item.endpoint?.includes("/api/purchases")
      );
    } else if (sectionModule === "inventory") {
      state.stockMovements = [];
      state.stockBalances = [];
      state.inventoryLots = [];
      for (const it of state.stockItems || []) {
        it.currentStock = 0;
      }
      syncQueue = syncQueue.filter((item: OfflineSyncQueueEntry) => !item.endpoint?.includes("/api/inventory"));
    } else if (sectionModule === "treasury") {
      state.treasuryTransactions = [];
      state.vouchers = [];
      for (const t of state.treasuryAccounts || []) {
        t.currentBalance = 0;
      }
      syncQueue = syncQueue.filter((item: OfflineSyncQueueEntry) => !item.endpoint?.includes("/api/treasury"));
    } else if (sectionModule === "expenses_wages") {
      state.expenses = [];
      state.wageEntries = [];
      for (const w of state.workers || []) {
        w.currentBalance = 0;
      }
      syncQueue = syncQueue.filter(
        (item: OfflineSyncQueueEntry) =>
          !item.endpoint?.includes("/api/expenses") &&
          !item.endpoint?.includes("/api/workers")
      );
    }
  } else if (scope === "unit") {
    if (unitType === "project" && unitId) {
      state.expenses = (state.expenses || []).filter((e: { projectId?: string }) => e.projectId !== unitId);
      state.wageEntries = (state.wageEntries || []).filter((w: { projectId?: string }) => w.projectId !== unitId);
      state.purchaseOrders = (state.purchaseOrders || []).filter((p: { projectId?: string }) => p.projectId !== unitId);
      state.salesInvoices = (state.salesInvoices || []).filter((s: { projectId?: string }) => s.projectId !== unitId);
      const proj = (state.projects || []).find((p: { id?: string }) => p.id === unitId);
      if (proj) {
        proj.spentAmount = 0;
        proj.revenueAmount = 0;
      }
      syncQueue = syncQueue.filter(
        (item: OfflineSyncQueueEntry) =>
          (item.payload as Record<string, unknown> | undefined)?.projectId !== unitId
      );
    } else if (unitType === "costCenter" && unitId) {
      state.expenses = (state.expenses || []).filter((e: { costCenterId?: string }) => e.costCenterId !== unitId);
      const cc = (state.costCenters || []).find((c: { id?: string }) => c.id === unitId);
      if (cc) {
        cc.currentBalance = 0;
      }
      syncQueue = syncQueue.filter(
        (item: OfflineSyncQueueEntry) =>
          (item.payload as Record<string, unknown> | undefined)?.costCenterId !== unitId
      );
    }
  } else if (scope === "factory") {
    state.journalEntries = [];
    state.salesInvoices = [];
    state.saleTransactions = [];
    state.installmentVouchers = [];
    state.purchaseOrders = [];
    state.vendorBills = [];
    state.paymentVouchers = [];
    state.vouchers = [];
    state.expenses = [];
    state.wageEntries = [];
    state.treasuryTransactions = [];
    state.stockMovements = [];
    state.stockBalances = [];
    state.inventoryLots = [];
    state.drafts = [];

    for (const c of state.customers || []) { c.balance = 0; c.currentBalance = 0; }
    for (const v of state.vendors || []) { v.balance = 0; v.currentBalance = 0; }
    for (const w of state.workers || []) { w.currentBalance = 0; }
    for (const it of state.stockItems || []) { it.currentStock = 0; }
    for (const t of state.treasuryAccounts || []) { t.currentBalance = 0; }
    for (const p of state.projects || []) { p.spentAmount = 0; p.revenueAmount = 0; }
    for (const cc of state.costCenters || []) { cc.currentBalance = 0; }

    let coa = readCollection<OfflineCoaAccountResetItem>(OFFLINE_DB_COA_KEY, s);
    if (!Array.isArray(coa) || coa.length === 0) {
      coa = (Array.isArray(state.accounts) && state.accounts.length > 0
        ? (state.accounts as unknown as OfflineCoaAccountResetItem[])
        : [
            { code: "1", nameAr: "الأصول", nameEn: "Assets", level: 1, type: "ASSET", isPosting: false },
            { code: "2", nameAr: "الخصوم", nameEn: "Liabilities", level: 1, type: "LIABILITY", isPosting: false },
            { code: "3", nameAr: "حقوق الملكية", nameEn: "Equity", level: 1, type: "EQUITY", isPosting: false },
            { code: "4", nameAr: "الإيرادات", nameEn: "Revenue", level: 1, type: "REVENUE", isPosting: false },
            { code: "5", nameAr: "المصروفات", nameEn: "Expenses", level: 1, type: "EXPENSE", isPosting: false },
          ]);
    }
    if (coaMode === "blank_coa") {
      coa = coa.filter((a: OfflineCoaAccountResetItem) => ["1", "2", "3", "4", "5"].includes(a.code));
    }
    for (const a of coa) {
      a.debit = 0;
      a.credit = 0;
      a.balance = 0;
    }
    writeCollection(OFFLINE_DB_COA_KEY, coa, s);
    state.accounts = coa;

    syncQueue = [];
  }

  if (s) {
    try {
      s.setItem("uas_offline_sync_queue", JSON.stringify(syncQueue));
    } catch {}
  }

  saveOfflineAndroidState(state, s);

  return jsonResponse({
    ok: true,
    result: {
      ok: true,
      scope,
      preResetBackupFilename: backupKey,
      deletedCounts,
      preservedLicense: true,
      summaryAr: "تم تنفيذ إعادة الضبط في الوضع المحلي للأندرويد بنجاح",
      summaryEn: "Scoped reset executed successfully in Android Local Mode",
    },
  }, 200);
}

async function handleOfflineAndroidApiRequestCore(
  rawUrl: string,
  init?: RequestInit,
  storage?: OfflineStorageLike | null
): Promise<Response> {
  const s = storage ?? getDefaultStorage();
  const method = (init?.method || "GET").toUpperCase();
  const body = method !== "GET" && method !== "HEAD" ? parseJsonBody(init) : {};
  const actor = extractActorFromReq(body, init);

  let pathname = rawUrl;
  try {
    const u = new URL(rawUrl, "https://localhost");
    pathname = u.pathname;
  } catch {
    pathname = rawUrl.split("?")[0];
  }

  if (pathname === "/api/system/lifecycle" && method === "POST") {
    const entityType = String(body.entityType || "");
    const id = String(body.id || "");
    const action = String(body.action || "SAFE_DELETE").toUpperCase();
    return handleLocalMasterLifecycle(entityType, id, action, actor, s);
  }

  if (pathname === "/api/system/reset") {
    if (method === "GET") {
      const scope = (rawUrl.includes("scope=factory")
        ? "factory"
        : rawUrl.includes("scope=unit")
        ? "unit"
        : "section") as string;
      let expectedPhrase = "RESET_SECTION";
      if (scope === "unit") expectedPhrase = "RESET_UNIT";
      else if (scope === "factory") expectedPhrase = "FACTORY_RESET";
      else {
        if (rawUrl.includes("sectionModule=procurement")) expectedPhrase = "RESET_SECTION_PROCUREMENT";
        else if (rawUrl.includes("sectionModule=inventory")) expectedPhrase = "RESET_SECTION_INVENTORY";
        else if (rawUrl.includes("sectionModule=treasury")) expectedPhrase = "RESET_SECTION_TREASURY";
        else if (rawUrl.includes("sectionModule=expenses_wages")) expectedPhrase = "RESET_SECTION_EXPENSES_WAGES";
        else expectedPhrase = "RESET_SECTION_SALES";
      }

      return jsonResponse({
        ok: true,
        check: {
          scope,
          requiredConfirmationPhrase: expectedPhrase,
          hasClosedFiscalYear: false,
          closedFiscalYearsCount: 0,
          unpostedDraftsCount: 0,
          affectedRecordsStats: {},
          warningsAr: [],
          warningsEn: [],
          safeToProceed: true,
        },
      }, 200);
    }
    if (method === "POST") {
      return handleOfflineScopedReset(body, actor, s);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Bootstrap & Health
  // -------------------------------------------------------------------------
  if (pathname === "/api/bootstrap" && method === "GET") {
    const state = loadOfflineAndroidState(s);
    return jsonResponse(state, 200);
  }

  if (pathname === "/api/public/verify") {
    return jsonResponse({ ok: true, mode: "local", offline: true }, 200);
  }

  // -------------------------------------------------------------------------
  // 2. Local Authentication
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/login" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const identifier = String(body.email || body.username || body.identifier || "").trim().toLowerCase();
    const password = String(body.password || "");
    const passwords = readPasswordMap(s);

    const found = state.users.find(
      (u) =>
        u.email.toLowerCase() === identifier ||
        (u.username || "").toLowerCase() === identifier ||
        u.name.toLowerCase() === identifier
    );
    if (!found) {
      return jsonResponse({ error: "بيانات الدخول غير صحيحة / Invalid credentials" }, 401);
    }
    if (found.archivedAt || !found.active || found.isActive === false) {
      return jsonResponse({ error: "هذا الحساب موقوف أو مؤرشف / Account is suspended or archived" }, 403);
    }
    const expectedPass = passwords[found.email.toLowerCase()] ?? DEFAULT_LOCAL_ADMIN_PASSWORD;
    if (password && password !== expectedPass) {
      return jsonResponse({ error: "كلمة المرور غير صحيحة / Invalid password" }, 401);
    }
    found.lastLoginAt = new Date().toISOString();
    saveOfflineAndroidState(state, s);
    return jsonResponse({ success: true, user: found, state }, 200);
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    return jsonResponse({ success: true }, 200);
  }

  // -------------------------------------------------------------------------
  // 3. System Branding & Settings (fixes "تعذر الاتصال بالخادم لحفظ الهوية المؤسسية")
  // -------------------------------------------------------------------------
  if (pathname === "/api/system/branding") {
    const state = loadOfflineAndroidState(s);
    if (method === "GET") {
      return jsonResponse({ enterpriseProfile: state.enterpriseProfile }, 200);
    }
    if (method === "PUT" || method === "POST" || method === "PATCH") {
      const profileStore = new LocalStorageProfileStore(s);
      if (body.legalNameAr !== undefined || body.legalNameEn !== undefined) {
        const lockCheck = await profileStore.updateNames({
          legalNameAr: body.legalNameAr !== undefined ? String(body.legalNameAr) : undefined,
          legalNameEn: body.legalNameEn !== undefined ? String(body.legalNameEn) : undefined,
        });
        if (!lockCheck.ok) {
          return jsonResponse({ error: lockCheck.error, code: lockCheck.code }, 403);
        }
      }

      const patch = { ...body };
      delete patch.actor;
      const baseProfile: UasEnterpriseProfile = state.enterpriseProfile ?? {
        id: "default",
        legalNameAr: "اسم المنشأة",
        legalNameEn: "Enterprise Name",
        currencyCode: "YER",
        brandColor: "#059669",
      };
      const updatedProfile: UasEnterpriseProfile = {
        ...baseProfile,
        ...(patch as Partial<UasEnterpriseProfile>),
        id: baseProfile.id || "default",
        isConfigured: true,
      };
      state.enterpriseProfile = updatedProfile;
      if (updatedProfile.legalNameAr && updatedProfile.legalNameAr !== "اسم المنشأة") {
        state.settings.orgName = updatedProfile.legalNameAr;
      }
      addLocalAudit(state, actor.userDisplay, "تحديث الهوية المؤسسية (محلي)", updatedProfile.legalNameAr);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, patch, s);
      return jsonResponse({ success: true, enterpriseProfile: updatedProfile, state }, 200);
    }
  }

  if (pathname === "/api/system/settings") {
    const state = loadOfflineAndroidState(s);
    if (method === "GET") {
      return jsonResponse({ settings: state.settings, exchangeRates: state.exchangeRates }, 200);
    }
    if (method === "PUT" || method === "POST" || method === "PATCH") {
      state.settings = {
        ...state.settings,
        ...(body.orgName !== undefined ? { orgName: String(body.orgName) } : {}),
        ...(body.logoText !== undefined ? { logoText: String(body.logoText) } : {}),
        ...(body.defaultLang !== undefined ? { defaultLang: body.defaultLang as "ar" | "en" } : {}),
        ...(body.defaultTheme !== undefined ? { defaultTheme: body.defaultTheme as "emerald" | "dark" | "royal" } : {}),
        ...(body.defaultCurrency !== undefined ? { defaultCurrency: body.defaultCurrency as "YER" | "SAR" | "USD" } : {}),
      };
      if (body.exchangeRates && typeof body.exchangeRates === "object") {
        state.exchangeRates = {
          ...state.exchangeRates,
          ...(body.exchangeRates as Record<string, number>),
        };
      }
      addLocalAudit(state, actor.userDisplay, "تحديث إعدادات النظام (محلي)", state.settings.orgName);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, settings: state.settings, state }, 200);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Users CRUD, Archive, Restore & Safe Delete
  // -------------------------------------------------------------------------
  if (pathname === "/api/users") {
    const state = loadOfflineAndroidState(s);
    if (method === "GET") {
      return jsonResponse({ users: state.users }, 200);
    }
    if (method === "POST") {
      const name = String(body.name || "").trim();
      if (!name) return jsonResponse({ error: "يرجى إدخال اسم المستخدم" }, 400);
      const role = normalizeRole(String(body.role || "FIELD_ACCOUNTANT").trim());
      const email = String(body.email || "").trim().toLowerCase() || `user-${Date.now()}@uas-ye.com`;
      const password = String(body.password || DEFAULT_LOCAL_ADMIN_PASSWORD);
      const newUser: UasUser = {
        id: `u-${Date.now()}`,
        username: String(body.username || email.split("@")[0] || `user_${Date.now()}`),
        name,
        fullName: String(body.fullName || `${name} - ${ROLE_DEFINITIONS[role].labelAr}`),
        displayName: String(body.displayName || ""),
        phone: String(body.phone || ""),
        email,
        role,
        department: String(body.department || ROLE_DEFINITIONS[role].departmentAr),
        active: true,
        isActive: true,
        archivedAt: null,
        avatarChar: name.charAt(0) || "م",
        avatarColor: "#059669",
        preferredLang: "ar",
        preferredCurrency: "YER",
        preferredTheme: "emerald",
        useCustomPermissions: false,
        customAllowedGroups: [],
        customPermissionsJson: {},
        mustChangePassword: false,
        assignedProjects: Array.isArray(body.assignedProjects) ? body.assignedProjects.map(String) : [],
      };
      state.users.push(newUser);
      const passwords = readPasswordMap(s);
      passwords[email] = password;
      writePasswordMap(passwords, s);
      addLocalAudit(state, actor.userDisplay, "إضافة مستخدم نظام (محلي)", `${name} (${role})`);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, user: newUser, state }, 201);
    }
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch) {
    const targetId = decodeURIComponent(userMatch[1]).trim();
    const state = loadOfflineAndroidState(s);
    const idx = state.users.findIndex(
      (u) =>
        u.id === targetId ||
        u.email.toLowerCase() === targetId.toLowerCase() ||
        u.username?.toLowerCase() === targetId.toLowerCase() ||
        u.name.toLowerCase() === targetId.toLowerCase()
    );
    if (idx < 0) return jsonResponse({ error: `المستخدم غير موجود (${targetId})` }, 404);
    const existing = state.users[idx];

    if (method === "PATCH") {
      const action = String(body.action || "").trim().toLowerCase();
      if (action === "archive") {
        if (existing.id === actor.userId || targetId === actor.userId) {
          return jsonResponse({ error: "لا يمكن أرشفة حسابك الشخصي المسجل به حالياً" }, 400);
        }
        if (existing.role === "SUPER_ADMIN") {
          const activeAdmins = state.users.filter((u) => u.role === "SUPER_ADMIN" && u.active && !u.archivedAt);
          if (activeAdmins.length <= 1 && existing.active && !existing.archivedAt) {
            return jsonResponse({ error: "لا يمكن أرشفة المشرف العام الوحيد المتبقي في المنشأة" }, 400);
          }
        }
        existing.active = false;
        existing.isActive = false;
        existing.archivedAt = new Date().toISOString();
        const released = await releaseLocalSeatsForEmail(existing.email, s);
        addLocalAudit(state, actor.userDisplay, "أرشفة مستخدم (محلي)", `${existing.name} (${existing.email})`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({
          success: true,
          archived: true,
          seatsReleased: released,
          user: existing,
          state,
        });
      }
      if (action === "restore") {
        existing.active = true;
        existing.isActive = true;
        existing.archivedAt = null;
        addLocalAudit(state, actor.userDisplay, "استعادة مستخدم مؤرشف (محلي)", `${existing.name} (${existing.email})`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, restored: true, user: existing, state });
      }

      if (body.toggleActive === true) {
        const nextActive = !(existing.active && (existing.isActive ?? true));
        existing.active = nextActive;
        existing.isActive = nextActive;
        if (nextActive) existing.archivedAt = null;
      } else if (typeof body.isActive === "boolean") {
        existing.active = body.isActive;
        existing.isActive = body.isActive;
      }
      if (body.name) existing.name = String(body.name).trim();
      if (body.displayName !== undefined) existing.displayName = String(body.displayName).trim();
      if (body.phone !== undefined) existing.phone = String(body.phone).trim();
      if (body.role) existing.role = normalizeRole(String(body.role));
      if (body.department !== undefined) existing.department = String(body.department).trim();
      if (typeof body.useCustomPermissions === "boolean") existing.useCustomPermissions = body.useCustomPermissions;
      if (Array.isArray(body.customAllowedGroups)) existing.customAllowedGroups = body.customAllowedGroups.map(String);
      if (body.customPermissionsJson && typeof body.customPermissionsJson === "object") {
        existing.customPermissionsJson = body.customPermissionsJson as Record<string, boolean>;
      }
      if (Array.isArray(body.assignedProjects)) existing.assignedProjects = body.assignedProjects.map(String);
      if (body.newPassword) {
        const passwords = readPasswordMap(s);
        passwords[existing.email.toLowerCase()] = String(body.newPassword);
        writePasswordMap(passwords, s);
        existing.passwordUpdatedAt = new Date().toISOString();
      }
      addLocalAudit(state, actor.userDisplay, "تحديث حساب مستخدم (محلي)", existing.name);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, user: existing, state }, 200);
    }

    if (method === "DELETE") {
      if (existing.id === actor.userId || targetId === actor.userId) {
        return jsonResponse({
          error: "لا يمكن حذف حسابك الشخصي المسجل به حالياً. يمكنك استخدام خيار إيقاف الحساب أو تسليم الصلاحيات لمشرف آخر.",
          code: "SELF_DELETION_FORBIDDEN",
          guardReason: "SELF_DELETION",
          guidance: "لا يمكنك حذف حسابك الشخصي المسجل به حالياً. استخدم خيار (إيقاف) أو تسليم الصلاحيات لمشرف آخر أولاً.",
        }, 400);
      }
      if (existing.role === "SUPER_ADMIN") {
        const activeAdmins = state.users.filter((u) => u.role === "SUPER_ADMIN" && u.active && !u.archivedAt);
        if (activeAdmins.length <= 1 && existing.active && !existing.archivedAt) {
          return jsonResponse({
            error: "لا يمكن حذف أو أرشفة المشرف العام الوحيد المتبقي في المنشأة لضمان استمرارية إدارة النظام. يرجى إنشاء أو ترقية مشرف بديل أولاً، أو استخدام خيار الإيقاف.",
            code: "LAST_ADMIN_PROTECTED",
            guardReason: "LAST_ADMIN",
            guidance: "للحفاظ على النظام، قم بإنشاء أو ترقية حساب مشرف عام بديل أولاً، أو استخدم خيار الإيقاف المؤقت (إيقاف).",
          }, 400);
        }
      }

      const journals = readCollection<{ createdById?: string }>(OFFLINE_DB_JOURNALS_KEY, s);
      const hasLinked =
        journals.some((j) => j.createdById === existing.id || j.createdById === targetId) ||
        state.sales.some((sale) => sale.salesOfficerId === existing.id || sale.salesOfficerId === targetId) ||
        state.auditLogs.some((a) => a.user.includes(existing.name) || a.user.includes(existing.email));
      const released = await releaseLocalSeatsForEmail(existing.email, s);

      if (hasLinked) {
        existing.active = false;
        existing.isActive = false;
        existing.archivedAt = new Date().toISOString();
        addLocalAudit(state, actor.userDisplay, "أرشفة تلقائية لمستخدم مرتبط بقيود (محلي)", existing.email);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({
          success: true,
          deleted: false,
          archived: true,
          seatsReleased: released,
          guardReason: "LINKED_RECORDS",
          guidance: "تم تحويل العملية تلقائياً إلى الأرشفة وتحرير مقعد الترخيص لحماية القيود المحاسبية وسجلات التدقيق. يمكنك إيقافه أو استعادته لاحقاً.",
          message: "تمت أرشفة المستخدم لوجود قيود محاسبية وسجلات مرتبطة به مع تحرير مقعد الترخيص. يمكنك استخدام خيار الإيقاف أو استعادته.",
          state,
        });
      }

      state.users.splice(idx, 1);
      addLocalAudit(state, actor.userDisplay, "حذف مستخدم نهائياً (محلي)", existing.email);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({
        success: true,
        deleted: true,
        archived: false,
        seatsReleased: released,
        guardReason: "NONE",
        message: "تم حذف المستخدم نهائياً وتحرير مقعد الترخيص بنجاح",
        state,
      });
    }
  }

  const userResetMatch = pathname.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if (userResetMatch && method === "POST") {
    const targetId = decodeURIComponent(userResetMatch[1]).trim();
    const targetEmail = String(body.targetUserEmail || body.email || "").trim().toLowerCase();
    const state = loadOfflineAndroidState(s);
    const existing = state.users.find(
      (u) =>
        u.id === targetId ||
        (targetEmail && u.email.toLowerCase() === targetEmail) ||
        u.email.toLowerCase() === targetId.toLowerCase() ||
        u.username?.toLowerCase() === targetId.toLowerCase() ||
        u.name.toLowerCase() === targetId.toLowerCase()
    );
    if (!existing) {
      return jsonResponse({
        error: `المستخدم غير موجود (${targetId}) في المنشأة المحددة`,
        guidance: "تأكد من وجود المستخدم ضمن نفس الشركة أو المنشأة، أو تحقق من دقة المعرف.",
        code: "USER_NOT_FOUND",
      }, 404);
    }
    const newPass = String(body.newPassword || "").trim();
    if (!newPass || newPass.length < 6) {
      return jsonResponse(
        {
          error: "يجب أن تتكون كلمة المرور الجديدة من 6 أحرف على الأقل",
          guidance: "يرجى اختيار كلمة مرور قوية مكونة من 6 أحرف أو أرقام على الأقل لضمان أمان الحساب.",
          code: "PASSWORD_TOO_SHORT",
        },
        400
      );
    }
    const passwords = readPasswordMap(s);
    passwords[existing.email.toLowerCase()] = newPass;
    writePasswordMap(passwords, s);
    existing.mustChangePassword = Boolean(body.mustChangePassword);
    existing.passwordUpdatedAt = new Date().toISOString();
    addLocalAudit(state, actor.userDisplay, "إعادة تعيين كلمة مرور (محلي)", existing.email);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse(
      {
        success: true,
        message: `تمت إعادة تعيين كلمة مرور ${existing.name} بنجاح`,
        state,
      },
      200
    );
  }

  if (pathname === "/api/users/me/avatar") {
    const state = loadOfflineAndroidState(s);
    const currentUser =
      state.users.find((u) => u.id === actor.userId) ||
      state.users.find((u) => u.active && u.isActive !== false) ||
      state.users[0];
    if (!currentUser) {
      return jsonResponse({ error: "المستخدم غير موجود" }, 404);
    }
    if (method === "POST") {
      const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl.trim() : "";
      if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(dataUrl)) {
        return jsonResponse(
          { error: "صيغة الصورة غير صالحة (المسموح: PNG, JPG, WEBP, GIF)" },
          400
        );
      }
      currentUser.avatarUrl = dataUrl;
      addLocalAudit(state, actor.userDisplay, "تحديث الصورة الشخصية (محلي)", currentUser.displayName || currentUser.name);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue("/api/users/me/profile", "PATCH", { avatarUrl: dataUrl }, s);
      return jsonResponse({ success: true, avatarUrl: dataUrl, user: currentUser, state, offline: true }, 200);
    }
    if (method === "DELETE") {
      currentUser.avatarUrl = "";
      addLocalAudit(state, actor.userDisplay, "إزالة الصورة الشخصية (محلي)", currentUser.displayName || currentUser.name);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue("/api/users/me/profile", "PATCH", { avatarUrl: "" }, s);
      return jsonResponse({ success: true, avatarUrl: "", user: currentUser, state, offline: true }, 200);
    }
  }

  if (pathname === "/api/users/me/profile") {
    const state = loadOfflineAndroidState(s);
    const currentUser =
      state.users.find((u) => u.id === actor.userId) ||
      state.users.find((u) => u.active && u.isActive !== false) ||
      state.users[0];
    if (!currentUser) {
      return jsonResponse({ error: "المستخدم غير موجود" }, 404);
    }
    if (method === "GET") {
      return jsonResponse({ user: currentUser, offline: true }, 200);
    }
    if (method === "PATCH" || method === "PUT") {
      if (body.displayName !== undefined) currentUser.displayName = String(body.displayName).trim();
      if (body.phone !== undefined) currentUser.phone = String(body.phone).trim();
      if (body.email !== undefined && String(body.email).trim()) {
        currentUser.email = String(body.email).trim().toLowerCase();
      }
      if (body.avatarUrl !== undefined) currentUser.avatarUrl = String(body.avatarUrl).trim();
      if (body.avatarChar !== undefined) currentUser.avatarChar = String(body.avatarChar).slice(0, 2);
      if (body.avatarColor !== undefined) currentUser.avatarColor = String(body.avatarColor).trim();
      if (body.preferredLang === "ar" || body.preferredLang === "en") {
        currentUser.preferredLang = body.preferredLang;
      }
      if (body.preferredCurrency === "YER" || body.preferredCurrency === "SAR" || body.preferredCurrency === "USD") {
        currentUser.preferredCurrency = body.preferredCurrency;
      }
      if (body.preferredTheme === "emerald" || body.preferredTheme === "dark" || body.preferredTheme === "royal") {
        currentUser.preferredTheme = body.preferredTheme;
      }
      if (body.defaultModule !== undefined) currentUser.defaultModule = String(body.defaultModule).trim();
      addLocalAudit(state, actor.userDisplay, "تحديث الملف الشخصي (محلي)", currentUser.displayName || currentUser.name);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, user: currentUser, state, offline: true }, 200);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Projects, Expenses, Workers, Sales, Treasury, Inventory, Accounting
  // -------------------------------------------------------------------------
  if (pathname === "/api/accounting/cost-centers") {
    return handleLocalCostCenters(method, body, new URL(pathname, "http://local").searchParams, s);
  }

  if (pathname === "/api/approvals" || pathname.startsWith("/api/approvals/")) {
    if (pathname === "/api/approvals/rules") {
      const rules = readCollection<Record<string, unknown>>(OFFLINE_DB_APPROVAL_RULES_KEY, s);
      if (method === "GET") return jsonResponse({ rules, offline: true }, 200);
      if (method === "POST") {
        const rule = {
          id: `apr-rule-${Date.now().toString(36)}`,
          module: String(body.module || "ACCOUNTING").toUpperCase(),
          actionType: String(body.actionType || "GL_POSTING").toUpperCase(),
          minAmountBase: Number(body.minAmountBase) || 0,
          currencyCode: String(body.currencyCode || "YER").toUpperCase(),
          requiredRole: String(body.requiredRole || "CHIEF_ACCOUNTANT").toUpperCase(),
          approverUserIdsJson: JSON.stringify(Array.isArray(body.approverUserIds) ? body.approverUserIds : []),
          allowSelfApproval: Boolean(body.allowSelfApproval),
          isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
          createdAt: new Date().toISOString(),
        };
        rules.push(rule);
        writeCollection(OFFLINE_DB_APPROVAL_RULES_KEY, rules, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, rule, offline: true }, 201);
      }
      if (method === "PUT") {
        const rule = rules.find((r) => r.id === body.id);
        if (!rule) return jsonResponse({ error: "APPROVAL_RULE_NOT_FOUND" }, 404);
        Object.assign(rule, body);
        writeCollection(OFFLINE_DB_APPROVAL_RULES_KEY, rules, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, rule, offline: true }, 200);
      }
      if (method === "DELETE") {
        const next = rules.filter((r) => r.id !== body.id);
        writeCollection(OFFLINE_DB_APPROVAL_RULES_KEY, next, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, deleted: true, offline: true }, 200);
      }
    }

    const requests = readCollection<Record<string, unknown>>(OFFLINE_DB_APPROVAL_REQUESTS_KEY, s);
    if (pathname === "/api/approvals" && method === "GET") {
      const pendingCount = requests.filter((r) => r.status === "PENDING").length;
      return jsonResponse({ requests, pendingCount, offline: true }, 200);
    }
    if (pathname === "/api/approvals" && method === "POST") {
      const seq = requests.length + 1;
      const reqItem = {
        id: `apr-${Date.now().toString(36)}-${seq}`,
        requestNumber: `APR-${new Date().getUTCFullYear()}-${String(seq).padStart(4, "0")}`,
        module: String(body.module || "ACCOUNTING").toUpperCase(),
        actionType: String(body.actionType || "GL_POSTING").toUpperCase(),
        targetType: String(body.targetType || "JournalEntry"),
        targetId: String(body.targetId || ""),
        documentNumber: String(body.documentNumber || "DOC"),
        summaryAr: String(body.summaryAr || "طلب اعتماد"),
        summaryEn: String(body.summaryEn || body.summaryAr || "Approval Request"),
        amountBase: Number(body.amountBase) || 0,
        currencyCode: String(body.currencyCode || "YER").toUpperCase(),
        beforeSnapshot: body.beforeSnapshot ?? null,
        afterSnapshot: body.afterSnapshot ?? {},
        diffs: [],
        reasonAr: body.reasonAr ? String(body.reasonAr) : null,
        status: "PENDING",
        requestedById: actor.userId || "u1",
        requestedByName: actor.userDisplay || "مستخدم محلي",
        createdAt: new Date().toISOString(),
      };
      requests.unshift(reqItem);
      writeCollection(OFFLINE_DB_APPROVAL_REQUESTS_KEY, requests, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, request: reqItem, offline: true }, 201);
    }

    const decideMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/decide$/);
    if (decideMatch && method === "POST") {
      const targetId = decodeURIComponent(decideMatch[1]);
      const reqItem = requests.find((r) => r.id === targetId);
      if (!reqItem) return jsonResponse({ error: "APPROVAL_REQUEST_NOT_FOUND" }, 404);
      reqItem.status = String(body.decision || "APPROVED").toUpperCase();
      reqItem.reviewedById = actor.userId || "u1";
      reqItem.reviewedByName = actor.userDisplay || "مستخدم محلي";
      reqItem.reviewNotes = body.reviewNotes ? String(body.reviewNotes) : null;
      reqItem.reviewedAt = new Date().toISOString();
      writeCollection(OFFLINE_DB_APPROVAL_REQUESTS_KEY, requests, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, request: reqItem, offline: true }, 200);
    }
  }

  if (pathname === "/api/drafts" || pathname.startsWith("/api/drafts/")) {
    const drafts = readCollection<Record<string, unknown>>(OFFLINE_DB_DRAFTS_KEY, s);
    if (pathname === "/api/drafts" && method === "GET") {
      const active = drafts.filter((d) => d.status === "ACTIVE_DRAFT" || d.status === "SUBMITTED_FOR_APPROVAL");
      return jsonResponse({ drafts: active, activeCount: active.length, offline: true }, 200);
    }
    if (pathname === "/api/drafts" && method === "POST") {
      const seq = drafts.length + 1;
      const now = new Date().toISOString();
      const draft = {
        id: `drf-${Date.now().toString(36)}-${seq}`,
        draftNumber: `DRF-${new Date().getUTCFullYear()}-${String(seq).padStart(4, "0")}`,
        module: String(body.module || "ACCOUNTING").toUpperCase(),
        formType: String(body.formType || "GENERIC").toUpperCase(),
        entityId: body.entityId ? String(body.entityId) : null,
        titleAr: String(body.titleAr || "مسودة"),
        titleEn: String(body.titleEn || body.titleAr || "Draft"),
        payload: body.payload && typeof body.payload === "object" ? body.payload : {},
        payloadJson: JSON.stringify(body.payload && typeof body.payload === "object" ? body.payload : {}),
        totalAmount: body.totalAmount !== undefined ? Number(body.totalAmount) : null,
        currencyCode: String(body.currencyCode || "YER").toUpperCase(),
        visibility: body.visibility === "PRIVATE" ? "PRIVATE" : "SHARED_WORKSPACE",
        status: "ACTIVE_DRAFT",
        createdById: actor.userId || "u1",
        createdByName: actor.userDisplay || "مستخدم محلي",
        updatedById: actor.userId || "u1",
        updatedByName: actor.userDisplay || "مستخدم محلي",
        createdAt: now,
        updatedAt: now,
      };
      drafts.unshift(draft);
      writeCollection(OFFLINE_DB_DRAFTS_KEY, drafts, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, draft, offline: true }, 201);
    }

    const promoteMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/promote$/);
    if (promoteMatch && method === "POST") {
      const targetId = decodeURIComponent(promoteMatch[1]);
      const draft = drafts.find((d) => d.id === targetId);
      if (!draft) return jsonResponse({ error: "DRAFT_NOT_FOUND" }, 404);
      draft.status = "CONVERTED";
      draft.convertedEntityId = `LOC-PROMOTED-${draft.draftNumber}`;
      draft.updatedAt = new Date().toISOString();
      writeCollection(OFFLINE_DB_DRAFTS_KEY, drafts, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, draft, convertedEntityId: draft.convertedEntityId, offline: true }, 200);
    }

    const idMatch = pathname.match(/^\/api\/drafts\/([^/]+)$/);
    if (idMatch) {
      const targetId = decodeURIComponent(idMatch[1]);
      const draft = drafts.find((d) => d.id === targetId);
      if (!draft) return jsonResponse({ error: "DRAFT_NOT_FOUND" }, 404);
      if (method === "GET") return jsonResponse({ draft, offline: true }, 200);
      if (method === "PATCH") {
        if (body.titleAr !== undefined) draft.titleAr = String(body.titleAr);
        if (body.titleEn !== undefined) draft.titleEn = String(body.titleEn);
        if (body.payload !== undefined) {
          draft.payload = body.payload;
          draft.payloadJson = JSON.stringify(body.payload);
        }
        if (body.totalAmount !== undefined) draft.totalAmount = Number(body.totalAmount);
        if (body.visibility !== undefined) draft.visibility = String(body.visibility);
        if (body.status !== undefined) draft.status = String(body.status);
        draft.updatedAt = new Date().toISOString();
        writeCollection(OFFLINE_DB_DRAFTS_KEY, drafts, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, draft, offline: true }, 200);
      }
      if (method === "DELETE") {
        draft.status = "DISCARDED";
        draft.updatedAt = new Date().toISOString();
        writeCollection(OFFLINE_DB_DRAFTS_KEY, drafts, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, draft, offline: true }, 200);
      }
    }
  }

  if (pathname === "/api/accounting/fiscal-years" || pathname.startsWith("/api/accounting/fiscal-years/")) {
    let years = readCollection<Record<string, unknown>>(OFFLINE_DB_FISCAL_YEARS_KEY, s);
    if (years.length === 0) {
      years = [
        {
          id: "fy-2026",
          code: "FY-2026",
          nameAr: "السنة المالية 2026",
          nameEn: "Fiscal Year 2026",
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-12-31T23:59:59.999Z",
          status: "OPEN",
          netProfitLossBase: null,
          createdAt: new Date().toISOString(),
        },
      ];
      writeCollection(OFFLINE_DB_FISCAL_YEARS_KEY, years, s);
    }

    if (pathname === "/api/accounting/fiscal-years" && method === "GET") {
      return jsonResponse({ fiscalYears: years, offline: true }, 200);
    }
    if (pathname === "/api/accounting/fiscal-years" && method === "POST") {
      const code = String(body.code || "").trim().toUpperCase();
      const nameAr = String(body.nameAr || code).trim();
      if (!code || !nameAr) return jsonResponse({ error: "FISCAL_YEAR_CODE_REQUIRED" }, 400);
      const fy = {
        id: `fy-${Date.now().toString(36)}`,
        code,
        nameAr,
        nameEn: String(body.nameEn || nameAr),
        startDate: String(body.startDate || "2026-01-01T00:00:00.000Z"),
        endDate: String(body.endDate || "2026-12-31T23:59:59.999Z"),
        status: "OPEN",
        createdAt: new Date().toISOString(),
      };
      years.unshift(fy);
      writeCollection(OFFLINE_DB_FISCAL_YEARS_KEY, years, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, fiscalYear: fy, offline: true }, 201);
    }

    const precheckMatch = pathname.match(/^\/api\/accounting\/fiscal-years\/([^/]+)\/precheck$/);
    if (precheckMatch && method === "POST") {
      const targetId = decodeURIComponent(precheckMatch[1]);
      const fy = years.find((y) => y.id === targetId);
      if (!fy) return jsonResponse({ error: "FISCAL_YEAR_NOT_FOUND" }, 404);
      const endYear = new Date(String(fy.endDate)).getUTCFullYear() || 2026;
      const nextYear = endYear + 1;
      return jsonResponse(
        {
          success: true,
          precheck: {
            fiscalYearId: fy.id,
            fiscalYearCode: fy.code,
            status: fy.status,
            canClose: fy.status !== "CLOSED",
            checks: [
              { key: "pendingDocuments", titleAr: "خلو السنة من المسودات أو المستندات بانتظار الاعتماد", titleEn: "Zero pending drafts/approvals", passed: true, detailsAr: "لا توجد مستندات معلقة (الوضع المحلي).", detailsEn: "No pending documents (local mode)." },
              { key: "trialBalance", titleAr: "توازن ميزان المراجعة بالعملة الأساسية (YER)", titleEn: "Base-currency Trial Balance balanced", passed: true, detailsAr: "ميزان المراجعة متوازن (الوضع المحلي).", detailsEn: "Trial balance is balanced (local mode)." },
              { key: "fxSpotRates", titleAr: "توفر أسعار صرف الإقفال للعملات الأجنبية", titleEn: "Closing FX spot rates configured", passed: true, detailsAr: "أسعار الصرف مضبوطة.", detailsEn: "Spot rates configured." },
              { key: "retainedEarnings", titleAr: "ربط حساب الأرباح المحتجزة (Retained Earnings)", titleEn: "Retained Earnings account mapped", passed: true, detailsAr: "الحساب المعتمد: 312101 — حساب الأرباح المبقاة.", detailsEn: "Mapped to 312101." },
            ],
            pnlPreview: { totalRevenueBase: 0, totalExpensesBase: 0, netProfitLossBase: 0, retainedEarningsAccountCode: "312101", retainedEarningsAccountNameAr: "حساب الأرباح المبقاة", closingLineCount: 0 },
            openingPreview: { nextFiscalYearCode: `FY-${nextYear}`, nextStartDate: `${nextYear}-01-01`, nextEndDate: `${nextYear}-12-31`, totalAssetsBase: 0, totalLiabilitiesBase: 0, totalEquityBase: 0, balanceSheetLineCount: 0, gen6SubLedgerCount: 0, fxCurrencies: [], stockBalanceCount: 0, totalInventoryValuationBase: 0 },
          },
          offline: true,
        },
        200
      );
    }

    const closeMatch = pathname.match(/^\/api\/accounting\/fiscal-years\/([^/]+)\/close-and-rollover$/);
    if (closeMatch && method === "POST") {
      const targetId = decodeURIComponent(closeMatch[1]);
      const fy = years.find((y) => y.id === targetId);
      if (!fy) return jsonResponse({ error: "FISCAL_YEAR_NOT_FOUND" }, 404);
      if (fy.status === "CLOSED") return jsonResponse({ error: "FISCAL_YEAR_ALREADY_CLOSED" }, 400);
      fy.status = "CLOSED";
      fy.closedAt = new Date().toISOString();
      fy.netProfitLossBase = 0;
      const endYear = new Date(String(fy.endDate)).getUTCFullYear() || 2026;
      const nextYear = endYear + 1;
      const nextCode = `FY-${nextYear}`;
      let nextFy = years.find((y) => y.code === nextCode);
      if (!nextFy) {
        nextFy = {
          id: `fy-${nextYear}`,
          code: nextCode,
          nameAr: `السنة المالية ${nextYear}`,
          nameEn: `Fiscal Year ${nextYear}`,
          startDate: `${nextYear}-01-01T00:00:00.000Z`,
          endDate: `${nextYear}-12-31T23:59:59.999Z`,
          status: "OPEN",
          createdAt: new Date().toISOString(),
        };
        years.unshift(nextFy);
      }
      writeCollection(OFFLINE_DB_FISCAL_YEARS_KEY, years, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, closedFiscalYear: fy, nextFiscalYear: nextFy, netProfitLossBase: 0, offline: true }, 200);
    }
  }

  if (pathname === "/api/projects" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const name = String(body.name || "").trim();
    const count = Math.max(1, Number(body.plannedHarvests) || 1);
    const ordinals = ["القطفة الأولى", "القطفة الثانية", "القطفة الثالثة", "القطفة الرابعة", "القطفة الخامسة"];
    const harvests = Array.from({ length: count }, (_, i) => ordinals[i] || `القطفة ${i + 1}`);
    const id = `p-${Date.now()}`;
    state.projects.push({
      id,
      name,
      type: String(body.type || "مشروع رئيسي"),
      parentProjectId: body.parentProjectId ? String(body.parentProjectId) : "",
      estimatedValue: Number(body.estimatedValue) || 0,
      plannedHarvests: count,
      notes: String(body.notes || ""),
      harvests,
    });
    harvests.forEach((h) => {
      state.lockedPeriods[`${id}::${h}`] = false;
    });
    const prjProv = provisionLocalGen6AccountAndCostCenter("PROJECT", { id, nameAr: name, nameEn: name }, s);
    Object.assign(state.projects[state.projects.length - 1], { glAccountId: prjProv.glAccountId, costCenterId: prjProv.costCenterId });
    addLocalAudit(state, actor.userDisplay, "إنشاء مشروع (محلي)", name);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, state }, 201);
  }

  if (pathname.startsWith("/api/projects/")) {
    const id = decodeURIComponent(pathname.slice("/api/projects/".length));
    const state = loadOfflineAndroidState(s);
    const idx = state.projects.findIndex((p) => p.id === id);
    if (idx >= 0) {
      if (method === "PATCH" || method === "PUT") {
        const target = state.projects[idx];
        if (body.name !== undefined) target.name = String(body.name).trim();
        if (body.type !== undefined) target.type = String(body.type);
        if (body.estimatedValue !== undefined) target.estimatedValue = Number(body.estimatedValue) || 0;
        if (body.notes !== undefined) target.notes = String(body.notes);
        addLocalAudit(state, actor.userDisplay, "تعديل مشروع (محلي)", target.name);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, project: target, state, offline: true }, 200);
      }
      if (method === "DELETE") {
        const [removed] = state.projects.splice(idx, 1);
        addLocalAudit(state, actor.userDisplay, "حذف مشروع (محلي)", removed.name);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, state, offline: true }, 200);
      }
    }
  }

  if (pathname === "/api/expenses" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const projectId = String(body.projectId || "");
    const harvest = String(body.harvest || "");
    if (state.lockedPeriods[`${projectId}::${harvest}`]) {
      return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
    }
    const qty = Number(body.qty) || 1;
    const unitPrice = Number(body.unitPrice) || 0;
    const total = computeOperatingExpenseTotal(qty, unitPrice);
    state.expenses.push({
      id: `e-${Date.now()}`,
      projectId,
      subProjectId: body.subProjectId ? String(body.subProjectId) : undefined,
      harvest,
      category: String(body.category || "وقود/محروقات"),
      subType: String(body.subType || body.category || ""),
      qty,
      unitPrice,
      total,
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      notes: String(body.notes || ""),
    });
    addLocalAudit(state, actor.userDisplay, "إضافة مصروف (محلي)", `${body.category} — ${total}`);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, state }, 201);
  }

  if (pathname.startsWith("/api/expenses/")) {
    const id = decodeURIComponent(pathname.slice("/api/expenses/".length));
    const state = loadOfflineAndroidState(s);
    const idx = state.expenses.findIndex((e) => e.id === id);
    if (idx >= 0) {
      const existing = state.expenses[idx];
      if (state.lockedPeriods[`${existing.projectId}::${existing.harvest}`]) {
        return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
      }
      if (method === "PATCH" || method === "PUT") {
        if (body.category !== undefined) existing.category = String(body.category);
        if (body.subType !== undefined) existing.subType = String(body.subType);
        if (body.qty !== undefined) existing.qty = Number(body.qty) || 1;
        if (body.unitPrice !== undefined) existing.unitPrice = Number(body.unitPrice) || 0;
        existing.total = computeOperatingExpenseTotal(existing.qty, existing.unitPrice);
        if (body.date !== undefined) existing.date = String(body.date);
        if (body.notes !== undefined) existing.notes = String(body.notes);
        addLocalAudit(state, actor.userDisplay, "تعديل مصروف (محلي)", `${existing.category} — ${existing.total}`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, expense: existing, state, offline: true }, 200);
      }
      if (method === "DELETE") {
        state.expenses.splice(idx, 1);
        addLocalAudit(state, actor.userDisplay, "حذف مصروف (محلي)", `${existing.category} — ${existing.total}`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, state, offline: true }, 200);
      }
    }
  }

  if (pathname === "/api/workers" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const projectId = String(body.projectId || "");
    const harvest = String(body.harvest || "");
    if (state.lockedPeriods[`${projectId}::${harvest}`]) {
      return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
    }
    const dailyWage = Number(body.dailyWage) || 0;
    const days = Number(body.days) || 1;
    const credit = Number(body.credit) || 0;
    const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, days, credit);
    const workerLocalId = `w-${Date.now()}`;
    const wrkProv = provisionLocalGen6AccountAndCostCenter("WORKER", { id: `worker:${String(body.name || "").trim()}`, nameAr: String(body.name || "").trim() }, s);
    state.workers.push({
      id: workerLocalId,
      projectId,
      subProjectId: body.subProjectId ? String(body.subProjectId) : undefined,
      harvest,
      name: String(body.name || ""),
      dailyWage,
      days,
      total: totalWage,
      credit,
      debit: debitBalance,
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      notes: String(body.notes || ""),
    });
    Object.assign(state.workers[state.workers.length - 1], { glAccountId: wrkProv.glAccountId, costCenterId: wrkProv.costCenterId });
    addLocalAudit(state, actor.userDisplay, "إضافة سجل عامل (محلي)", `${body.name} — ${totalWage}`);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, state }, 201);
  }

  if (pathname.startsWith("/api/workers/")) {
    const id = decodeURIComponent(pathname.slice("/api/workers/".length));
    const state = loadOfflineAndroidState(s);
    const idx = state.workers.findIndex((w) => w.id === id);
    if (idx >= 0) {
      const existing = state.workers[idx];
      if (state.lockedPeriods[`${existing.projectId}::${existing.harvest}`]) {
        return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
      }
      if (method === "PATCH" || method === "PUT") {
        if (body.name !== undefined) existing.name = String(body.name);
        if (body.dailyWage !== undefined) existing.dailyWage = Number(body.dailyWage) || 0;
        if (body.days !== undefined) existing.days = Number(body.days) || 1;
        if (body.credit !== undefined) existing.credit = Number(body.credit) || 0;
        const { totalWage, debitBalance } = computeWorkerWageTotals(existing.dailyWage, existing.days, existing.credit);
        existing.total = totalWage;
        existing.debit = debitBalance;
        if (body.date !== undefined) existing.date = String(body.date);
        if (body.notes !== undefined) existing.notes = String(body.notes);
        addLocalAudit(state, actor.userDisplay, "تعديل سجل عامل (محلي)", `${existing.name} — ${existing.total}`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, worker: existing, state, offline: true }, 200);
      }
      if (method === "DELETE") {
        state.workers.splice(idx, 1);
        addLocalAudit(state, actor.userDisplay, "حذف سجل عامل (محلي)", `${existing.name} — ${existing.total}`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, state, offline: true }, 200);
      }
    }
  }

  if (pathname === "/api/sales" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const projectId = String(body.projectId || "");
    const harvest = String(body.harvest || "");
    if (state.lockedPeriods[`${projectId}::${harvest}`]) {
      return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
    }
    const bundles = Number(body.bundles) || 0;
    const price = Number(body.price) || 0;
    const credit = Number(body.credit) || 0;
    const subProjectId = body.subProjectId ? String(body.subProjectId) : undefined;
    const grade = String(body.grade || "رقم 1");
    if (bundles > 0) {
      const stockCheck = evaluateSaleAgainstHarvestStock({
        batches: state.inventoryBatches,
        sales: state.sales,
        projectId,
        subProjectId,
        harvest,
        grade,
        requestedBundles: bundles,
      });
      const canOverride =
        Boolean(body.allowNegativeStock) &&
        (actor.userRole === "SUPER_ADMIN" || actor.userRole === "CHIEF_ACCOUNTANT");
      if (stockCheck.hasTrackedBatches && !stockCheck.withinStock && !canOverride) {
        return jsonResponse(
          {
            error: `الكمية المطلوبة (${bundles}) تتجاوز الرصيد المتاح في مخزون الحصاد (${Math.max(0, stockCheck.availableBundles)}) بعجز ${stockCheck.shortageBundles} علاقية.`,
            code: "NEGATIVE_STOCK_BLOCKED",
          },
          400
        );
      }
    }
    const { totalAmount, debitReceivable } = computeSaleTotals(bundles, price, credit);
    const seq = String(
      body.sequenceNumber || body.batch || `SO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`
    );
    state.sales.push({
      id: `s-${Date.now()}`,
      projectId,
      subProjectId: body.subProjectId ? String(body.subProjectId) : undefined,
      harvest,
      batch: String(body.batch || seq),
      sequenceNumber: seq,
      dailyBatchLabel: String(body.dailyBatchLabel || "وردية مفتوحة"),
      salesOfficerId: body.salesOfficerId ? String(body.salesOfficerId) : undefined,
      salesOfficerTitle: body.salesOfficerTitle ? String(body.salesOfficerTitle) : undefined,
      revenueAccountCode: String(body.revenueAccountCode || "411101"),
      treasuryAccountId: body.treasuryAccountId ? String(body.treasuryAccountId) : undefined,
      customer: String(body.customer || ""),
      phone: String(body.phone || ""),
      grade: String(body.grade || "رقم 1"),
      bundles,
      price,
      total: totalAmount,
      credit,
      debit: debitReceivable,
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      voucherNo: String(body.voucherNo || `RV-${Date.now().toString().slice(-3)}`),
      notes: String(body.notes || ""),
    });
    addLocalAudit(state, actor.userDisplay, "إضافة عملية بيع (محلي)", `${body.customer} — ${totalAmount}`);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, state }, 201);
  }

  if (pathname.startsWith("/api/sales/") && !pathname.startsWith("/api/sales/customers") && !pathname.startsWith("/api/sales/invoices") && !pathname.startsWith("/api/sales/receipts")) {
    const id = decodeURIComponent(pathname.slice("/api/sales/".length));
    const state = loadOfflineAndroidState(s);
    const idx = state.sales.findIndex((x) => x.id === id);
    if (idx >= 0) {
      const existing = state.sales[idx];
      if (state.lockedPeriods[`${existing.projectId}::${existing.harvest}`]) {
        return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
      }
      if (method === "PATCH" || method === "PUT") {
        if (body.projectId !== undefined) existing.projectId = String(body.projectId);
        if (body.subProjectId !== undefined) {
          existing.subProjectId = body.subProjectId ? String(body.subProjectId) : undefined;
        }
        if (body.harvest !== undefined) existing.harvest = String(body.harvest);
        if (body.batch !== undefined) existing.batch = String(body.batch);
        if (body.customer !== undefined) existing.customer = String(body.customer);
        if (body.phone !== undefined) existing.phone = String(body.phone);
        if (body.grade !== undefined) existing.grade = String(body.grade);
        if (body.date !== undefined) existing.date = String(body.date);
        if (body.voucherNo !== undefined) existing.voucherNo = String(body.voucherNo);
        if (body.notes !== undefined) existing.notes = String(body.notes);
        const nextBundles = body.bundles !== undefined ? Number(body.bundles) || 0 : existing.bundles;
        const nextPrice = body.price !== undefined ? Number(body.price) || 0 : existing.price;
        const nextCredit = body.credit !== undefined ? Number(body.credit) || 0 : existing.credit;
        const { totalAmount, debitReceivable } = computeSaleTotals(nextBundles, nextPrice, nextCredit);
        existing.bundles = nextBundles;
        existing.price = nextPrice;
        existing.credit = nextCredit;
        existing.total = totalAmount;
        existing.debit = debitReceivable;
        addLocalAudit(state, actor.userDisplay, "تعديل عملية بيع (محلي)", `${existing.customer} — ${totalAmount}`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, sale: existing, state, offline: true }, 200);
      }
      if (method === "DELETE") {
        state.sales.splice(idx, 1);
        addLocalAudit(state, actor.userDisplay, "حذف عملية بيع (محلي)", `${existing.customer} — ${existing.total}`);
        saveOfflineAndroidState(state, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, state, offline: true }, 200);
      }
    }
  }

  if (pathname === "/api/installments" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const type = (String(body.type || "CUSTOMER_RECEIPT") === "WORKER_PAYMENT" ? "WORKER_PAYMENT" : "CUSTOMER_RECEIPT") as
      | "CUSTOMER_RECEIPT"
      | "WORKER_PAYMENT";
    const targetId = String(body.targetId || "");
    const treasuryId = String(body.treasuryId || state.treasuryAccounts[0]?.id || "t1");
    const amount = Number(body.amount) || 0;
    const voucherNo = String(body.voucherNo || `RV-INST-${Date.now().toString().slice(-3)}`);
    const date = String(body.date || new Date().toISOString().slice(0, 10));
    const notes = String(body.notes || "دفعة مسجلة");
    const treas = state.treasuryAccounts.find((t) => t.id === treasuryId);
    let targetName = "";
    let phone = "";

    if (type === "CUSTOMER_RECEIPT") {
      const sale = state.sales.find((x) => x.id === targetId);
      if (!sale) return jsonResponse({ error: "الفاتورة غير موجودة" }, 404);
      if (state.lockedPeriods[`${sale.projectId}::${sale.harvest}`]) {
        return jsonResponse({ error: "🔒 القطفة مغلقة محاسبياً!" }, 423);
      }
      sale.credit += amount;
      sale.debit = sale.total - sale.credit;
      targetName = `${sale.customer} (${sale.batch})`;
      phone = sale.phone || "";
      if (treas) treas.balanceYER += amount;
    } else {
      const worker = state.workers.find((x) => x.id === targetId);
      if (!worker) return jsonResponse({ error: "سجل العامل غير موجود" }, 404);
      if (state.lockedPeriods[`${worker.projectId}::${worker.harvest}`]) {
        return jsonResponse({ error: "🔒 القطفة مغلقة محاسبياً!" }, 423);
      }
      worker.credit += amount;
      worker.debit = worker.total - worker.credit;
      targetName = `${worker.name} (${worker.harvest})`;
      if (treas) treas.balanceYER -= amount;
    }
    state.installments.unshift({
      id: `inst-${Date.now()}`,
      voucherNo,
      type,
      targetId,
      targetName,
      phone,
      treasuryId,
      amount,
      date,
      notes,
    });
    addLocalAudit(state, actor.userDisplay, type === "CUSTOMER_RECEIPT" ? "سند قبض دفعة عميل (محلي)" : "سند صرف دفعة عامل (محلي)", `${voucherNo} — ${amount}`);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, state, offline: true }, 201);
  }

  if (pathname === "/api/audit/lock" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const key = String(body.key || "");
    const nextLocked = !state.lockedPeriods[key];
    state.lockedPeriods[key] = nextLocked;
    addLocalAudit(state, actor.userDisplay, nextLocked ? "إغلاق فترة قطفة 🔒" : "إعادة فتح فترة قطفة 🔓", key);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, locked: nextLocked, state, offline: true }, 200);
  }

  if (pathname === "/api/audit/adjustments" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const label = String(body.periodLabel || body.key || "");
    const reason = String(body.reason || "");
    const amount = Number(body.amount) || 0;
    addLocalAudit(state, actor.userDisplay, "قيد تسوية محاسبي معتمد (محلي)", `[${label}] ${reason} — ${amount}`);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, state, offline: true }, 200);
  }

  // Structured collection endpoints for Accounting, Procurement, Sales, Treasury, Inventory
  const collectionMap: Array<{ prefix: string; storageKey: string; listProp: string }> = [
    { prefix: "/api/accounting/coa", storageKey: OFFLINE_DB_COA_KEY, listProp: "accounts" },
    { prefix: "/api/accounting/journal", storageKey: OFFLINE_DB_JOURNALS_KEY, listProp: "entries" },
    { prefix: "/api/procurement/vendors", storageKey: OFFLINE_DB_VENDORS_KEY, listProp: "vendors" },
    { prefix: "/api/procurement/pos", storageKey: OFFLINE_DB_POS_KEY, listProp: "purchaseOrders" },
    { prefix: "/api/procurement/bills", storageKey: OFFLINE_DB_BILLS_KEY, listProp: "bills" },
    { prefix: "/api/procurement/payments", storageKey: OFFLINE_DB_PAYMENTS_KEY, listProp: "payments" },
    { prefix: "/api/sales/customers", storageKey: OFFLINE_DB_CUSTOMERS_KEY, listProp: "customers" },
    { prefix: "/api/sales/invoices", storageKey: OFFLINE_DB_INVOICES_KEY, listProp: "invoices" },
    { prefix: "/api/sales/receipts", storageKey: OFFLINE_DB_RECEIPTS_KEY, listProp: "receipts" },
  ];

  for (const col of collectionMap) {
    if (pathname === col.prefix || pathname.startsWith(`${col.prefix}/`)) {
      const rows = readCollection<Record<string, unknown>>(col.storageKey, s);
      if (method === "GET") {
        return jsonResponse({ [col.listProp]: rows, items: rows, offline: true }, 200);
      }
      if (method === "POST") {
        const record: Record<string, unknown> = {
          id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          ...body,
          createdAt: new Date().toISOString(),
        };
        const subLedger: LocalSubLedgerType | null =
          col.prefix === "/api/sales/customers" ? "CUSTOMER" : col.prefix === "/api/procurement/vendors" ? "VENDOR" : null;
        if (subLedger) {
          const prov = provisionLocalGen6AccountAndCostCenter(
            subLedger,
            { id: String(record.id), nameAr: String(body.nameAr || body.name || "").trim() || "—", nameEn: body.nameEn ? String(body.nameEn) : undefined },
            s
          );
          record.glAccountId = prov.glAccountId;
          record.glAccountCode = prov.glAccountCode;
          record.costCenterId = prov.costCenterId;
        }
        rows.unshift(record);
        writeCollection(col.storageKey, rows, s);
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, item: record, [col.listProp]: rows, offline: true }, 201);
      }
      if (method === "DELETE") {
        const id = String(body.id || "");
        if (id) {
          if (col.prefix === "/api/sales/customers") {
            return handleLocalMasterLifecycle("Customer", id, String(body.action || "SAFE_DELETE"), actor, s);
          }
          if (col.prefix === "/api/procurement/vendors") {
            return handleLocalMasterLifecycle("Vendor", id, String(body.action || "SAFE_DELETE"), actor, s);
          }
          if (col.prefix === "/api/procurement/bills") {
            const bill = rows.find((r) => r.id === id);
            if (bill && Number(bill.paidAmount || 0) > 0) {
              return jsonResponse({ error: "لا يمكن حذف فاتورة تم سدادها أو سداد جزء منها", offline: true }, 400);
            }
            const nextRows = rows.filter((r) => r.id !== id);
            writeCollection(col.storageKey, nextRows, s);
            appendOfflineSyncQueue(pathname, method, body, s);
            return jsonResponse({ success: true, deleted: true, bills: nextRows, offline: true }, 200);
          }
          if (col.prefix === "/api/procurement/payments") {
            const nextRows = rows.filter((r) => r.id !== id);
            writeCollection(col.storageKey, nextRows, s);
            appendOfflineSyncQueue(pathname, method, body, s);
            return jsonResponse({ success: true, deleted: true, payments: nextRows, offline: true }, 200);
          }
        }
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, [col.listProp]: rows, offline: true }, 200);
      }
      if (method === "PUT" || method === "PATCH") {
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, [col.listProp]: rows, offline: true }, 200);
      }
    }
  }

  // Bank & E-Wallet Gateway Execution Dispatch
  if (pathname === "/api/treasury/dispatch") {
    if (method === "GET") {
      const dispatches = readCollection<Record<string, unknown>>(OFFLINE_DB_DISPATCHES_KEY, s);
      return jsonResponse({ dispatches, count: dispatches.length, offline: true }, 200);
    }
    if (method === "POST") {
      const {
        treasuryAccountId,
        sourceVoucherType = "PAYMENT_VOUCHER",
        sourceVoucherId = "MANUAL",
        beneficiaryName,
        beneficiaryAccountOrPhone,
        amount,
        currencyCode = "YER",
        exchangeRate = 1,
        costCenterId = null,
      } = body;
      const numAmount = Number(amount) || 0;
      if (!treasuryAccountId || !beneficiaryName || !beneficiaryAccountOrPhone || numAmount <= 0) {
        return jsonResponse(
          { ok: false, error: "INVALID_DISPATCH_INPUT", messageAr: "بيانات التحويل غير مكتملة" },
          400
        );
      }
      const state = loadOfflineAndroidState(s);
      const treasury = state.treasuryAccounts.find((t) => t.id === treasuryAccountId);
      if (!treasury) {
        return jsonResponse(
          { ok: false, error: "TREASURY_ACCOUNT_NOT_FOUND", messageAr: "حساب الخزينة غير موجود" },
          404
        );
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      if (treasury.lastDailyResetDate !== todayStr) {
        treasury.dailyUsedAmount = 0;
        treasury.lastDailyResetDate = todayStr;
      }
      const dailyLimit = Number(treasury.dailyLimit) || 0;
      const currentUsed = Number(treasury.dailyUsedAmount) || 0;
      if (dailyLimit > 0 && currentUsed + numAmount > dailyLimit) {
        return jsonResponse(
          {
            ok: false,
            error: "DAILY_LIMIT_EXCEEDED",
            messageAr: "تجاوز مبلغ التحويل الحد اليومي المسموح به للخزينة",
          },
          422
        );
      }

      const feePercent = Number(treasury.transferFeePercent) || 0;
      const feeAmount = numAmount * (feePercent / 100);
      const totalDeduct = numAmount + feeAmount;
      const currentBal = Number(treasury.balance ?? 0);
      if (currentBal < totalDeduct) {
        return jsonResponse(
          {
            ok: false,
            error: "INSUFFICIENT_TREASURY_BALANCE",
            messageAr: "رصيد الخزينة أو المحفظة غير كافٍ لإتمام التحويل والرسوم",
          },
          422
        );
      }

      treasury.balance = currentBal - totalDeduct;
      treasury.dailyUsedAmount = currentUsed + numAmount;

      const dispatches = readCollection<Record<string, unknown>>(OFFLINE_DB_DISPATCHES_KEY, s);
      const dispatchNumber = `DSP-${new Date().getFullYear()}-${String(dispatches.length + 1).padStart(4, "0")}`;
      const provider = treasury.gatewayProvider || "MANUAL";
      const extRef = `${provider.slice(0, 3)}-SBX-${Date.now().toString().slice(-6)}`;

      const dispatchRecord = {
        id: `dsp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        dispatchNumber,
        treasuryAccountId,
        sourceVoucherType,
        sourceVoucherId,
        beneficiaryName,
        beneficiaryAccountOrPhone,
        amount: numAmount,
        feeAmount,
        currencyCode,
        exchangeRate: Number(exchangeRate) || 1,
        baseAmount: numAmount * (Number(exchangeRate) || 1),
        provider,
        externalReferenceId: extRef,
        status: "EXECUTED",
        rawResponseJson: JSON.stringify({ mode: "OFFLINE_LOCAL_SIMULATOR", extRef }),
        idempotencyKey: extractOfflineIdempotencyKey(init) || `dsp-key-${Date.now()}`,
        costCenterId,
        executedById: actor.userId,
        executedByName: actor.userDisplay,
        executedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      dispatches.push(dispatchRecord);
      writeCollection(OFFLINE_DB_DISPATCHES_KEY, dispatches, s);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);

      return jsonResponse(
        {
          ok: true,
          dispatch: dispatchRecord,
          balanceAfter: treasury.balance,
          dailyRemaining: dailyLimit > 0 ? dailyLimit - (treasury.dailyUsedAmount ?? 0) : null,
          offline: true,
        },
        200
      );
    }
  }

  // Bulk Bank/Wallet Transfer Export
  if (pathname === "/api/treasury/batch-export" && method === "POST") {
    const { treasuryName = "Bank", provider = "BANK", items = [], format = "xlsx" } = body;
    interface BatchExportRow {
      serial: number;
      beneficiaryName: string;
      accountOrPhone: string;
      amount: number;
      currencyCode: string;
      reference: string;
      notes: string;
    }
    const rows: BatchExportRow[] = (Array.isArray(items) ? (items as Array<Record<string, unknown>>) : []).map(
      (it, idx: number) => ({
        serial: idx + 1,
        beneficiaryName: String(it.beneficiaryName || ""),
        accountOrPhone: String(it.accountOrPhone || ""),
        amount: Number(it.amount) || 0,
        currencyCode: String(it.currencyCode || "YER"),
        reference: String(it.reference || `BATCH-${Date.now().toString().slice(-4)}-${idx + 1}`),
        notes: String(it.notes || "مستحقات دفعات UAS"),
      })
    );
    const totalAmount = rows.reduce((acc: number, r: BatchExportRow) => acc + r.amount, 0);
    const header = "رقم التسلسل,اسم المستفيد,رقم الحساب أو المحفظة,المبلغ,العملة,المرجع,البيان\n";
    const csvContent =
      "\uFEFF" +
      header +
      rows
        .map(
          (r: BatchExportRow) =>
            `"${r.serial}","${r.beneficiaryName}","${r.accountOrPhone}","${r.amount}","${r.currencyCode}","${r.reference}","${r.notes}"`
        )
        .join("\n");
    const base64 =
      typeof btoa === "function"
        ? btoa(unescape(encodeURIComponent(csvContent)))
        : Buffer.from(csvContent).toString("base64");
    const ext = format === "csv" ? "csv" : "csv";
    const filename = `UAS_Payout_Batch_${provider}_${String(treasuryName).replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.${ext}`;
    return jsonResponse(
      {
        ok: true,
        filename,
        mimeType: "text/csv; charset=utf-8",
        base64,
        count: rows.length,
        totalAmount,
        offline: true,
      },
      200
    );
  }

  // Statement Auto-Reconciliation Import
  if (pathname === "/api/treasury/reconcile-import" && method === "POST") {
    const { treasuryAccountId, statementRows = [] } = body;
    interface OfflineDispatchRecord {
      id: string;
      dispatchNumber?: string;
      treasuryAccountId?: string;
      amount?: number;
      beneficiaryName?: string;
      externalReferenceId?: string;
      createdAt?: string;
    }
    const dispatches = readCollection<OfflineDispatchRecord>(OFFLINE_DB_DISPATCHES_KEY, s).filter(
      (d) => d.treasuryAccountId === treasuryAccountId
    );

    const matchedRows: Array<Record<string, unknown>> = [];
    const unmatchedInUas: Array<Record<string, unknown>> = [];
    const matchedDispatchIds = new Set<string>();

    for (const row of Array.isArray(statementRows) ? (statementRows as Array<Record<string, unknown>>) : []) {
      const rowAmt = Number(row.credit || row.debit) || 0;
      let match = row.referenceId
        ? dispatches.find(
            (d) =>
              d.externalReferenceId &&
              String(d.externalReferenceId).toLowerCase() === String(row.referenceId).toLowerCase() &&
              !matchedDispatchIds.has(d.id)
          )
        : null;
      if (match) {
        matchedDispatchIds.add(match.id);
        matchedRows.push({
          statementRow: row,
          dispatchId: match.id,
          dispatchNumber: match.dispatchNumber,
          externalReferenceId: match.externalReferenceId,
          matchedBy: "externalReferenceId",
        });
        continue;
      }
      match = dispatches.find(
        (d) => Math.abs(Number(d.amount) - rowAmt) < 0.01 && !matchedDispatchIds.has(d.id)
      );
      if (match) {
        matchedDispatchIds.add(match.id);
        matchedRows.push({
          statementRow: row,
          dispatchId: match.id,
          dispatchNumber: match.dispatchNumber,
          externalReferenceId: match.externalReferenceId,
          matchedBy: "amount_and_date",
        });
      } else {
        unmatchedInUas.push(row);
      }
    }

    const unmatchedInBank = dispatches
      .filter((d) => !matchedDispatchIds.has(d.id))
      .map((d) => ({
        dispatchId: d.id,
        dispatchNumber: d.dispatchNumber,
        amount: d.amount,
        beneficiaryName: d.beneficiaryName,
        externalReferenceId: d.externalReferenceId,
        createdAt: d.createdAt,
      }));

    return jsonResponse(
      {
        ok: true,
        result: {
          treasuryAccountId,
          statementTotalRows: Array.isArray(statementRows) ? statementRows.length : 0,
          matchedCount: matchedRows.length,
          unmatchedInUasCount: unmatchedInUas.length,
          unmatchedInBankCount: unmatchedInBank.length,
          matchedRows,
          unmatchedInUas,
          unmatchedInBank,
          offline: true,
        },
      },
      200
    );
  }

  if (pathname === "/api/treasury/transfer" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const fromId = String(body.fromTreasuryId || "");
    const toId = String(body.toTreasuryId || "");
    const amount = Number(body.amount) || 0;
    const fromAcc = state.treasuryAccounts.find((t) => t.id === fromId || t.code === fromId);
    const toAcc = state.treasuryAccounts.find((t) => t.id === toId || t.code === toId);
    if (!fromAcc || !toAcc || amount <= 0 || fromAcc.id === toAcc.id) {
      return jsonResponse({ error: "بيانات التحويل المالي غير مكتملة" }, 400);
    }
    fromAcc.balance = Number(fromAcc.balance || 0) - amount;
    fromAcc.balanceYER = Number(fromAcc.balanceYER || fromAcc.balance || 0) - amount;
    toAcc.balance = Number(toAcc.balance || 0) + amount;
    toAcc.balanceYER = Number(toAcc.balanceYER || toAcc.balance || 0) + amount;
    const entryNumber = `TRF-LOC-${Date.now().toString().slice(-5)}`;
    addLocalAudit(state, actor.userDisplay, "تحويل مالي داخلي (محلي)", `${fromAcc.nameAr} -> ${toAcc.nameAr} (${amount})`);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, entryNumber, treasuryAccounts: state.treasuryAccounts, state, offline: true }, 201);
  }

  if (pathname.startsWith("/api/treasury")) {
    const state = loadOfflineAndroidState(s);
    if (method === "GET") {
      return jsonResponse({ treasuryAccounts: state.treasuryAccounts, accounts: state.treasuryAccounts, offline: true }, 200);
    }
    appendOfflineSyncQueue(pathname, method, body, s);
    saveOfflineAndroidState(state, s);
    return jsonResponse({ success: true, treasuryAccounts: state.treasuryAccounts, state, offline: true }, 200);
  }

  // Multi-Currency & FX endpoints (with default YER/SAR/USD/AED/OMR + custom "Other" currencies)
  if (pathname === "/api/accounting/currencies") {
    let currencies = readCollection<Record<string, unknown>>(OFFLINE_DB_CURRENCIES_KEY, s);
    if (currencies.length === 0) {
      currencies = DEFAULT_CURRENCIES.map((c) => ({
        id: `cur-${c.code}`,
        ...c,
        isActive: true,
        latestRate: {
          buyRate: c.defaultRateToBase,
          sellRate: c.defaultRateToBase,
          midRate: c.defaultRateToBase,
          rateDate: new Date().toISOString(),
        },
      }));
      writeCollection(OFFLINE_DB_CURRENCIES_KEY, currencies, s);
    }
    if (method === "GET") return jsonResponse({ currencies, offline: true }, 200);
    if (method === "POST" || method === "PUT") {
      const code = String(body.code || "").trim().toUpperCase();
      const midRate = Number(body.initialRate ?? body.midRate ?? 1);
      const record = {
        id: `cur-${code || Date.now()}`,
        code,
        nameAr: String(body.nameAr || code),
        nameEn: String(body.nameEn || body.nameAr || code),
        symbol: String(body.symbol || code),
        decimalPlaces: Number(body.decimalPlaces ?? 2),
        isBaseCurrency: Boolean(body.isBaseCurrency),
        isCustom: body.isCustom !== undefined ? Boolean(body.isCustom) : true,
        isActive: true,
        latestRate: { buyRate: midRate, sellRate: midRate, midRate, rateDate: new Date().toISOString() },
      };
      const idx = currencies.findIndex((c) => c.code === code);
      if (idx >= 0) currencies[idx] = record;
      else currencies.push(record);
      writeCollection(OFFLINE_DB_CURRENCIES_KEY, currencies, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, currency: record, currencies, offline: true }, 201);
    }
  }

  if (pathname === "/api/accounting/exchange-rates") {
    const rates = readCollection<Record<string, unknown>>(OFFLINE_DB_EXCHANGE_RATES_KEY, s);
    if (method === "GET") return jsonResponse({ rates, offline: true }, 200);
    if (method === "POST") {
      const rate = {
        id: `fx-${Date.now()}`,
        currencyCode: String(body.currencyCode || "USD").toUpperCase(),
        buyRate: Number(body.buyRate ?? body.midRate ?? 1),
        sellRate: Number(body.sellRate ?? body.midRate ?? 1),
        midRate: Number(body.midRate ?? 1),
        rateDate: String(body.rateDate || new Date().toISOString()),
        source: String(body.source || "MANUAL"),
      };
      rates.unshift(rate);
      writeCollection(OFFLINE_DB_EXCHANGE_RATES_KEY, rates, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, rate, offline: true }, 201);
    }
  }

  if (pathname === "/api/accounting/fx-revaluation") {
    if (method === "GET") {
      return jsonResponse({
        success: true,
        rows: [],
        totalUnrealizedGain: 0,
        totalUnrealizedLoss: 0,
        netImpact: 0,
        journalLines: [],
        offline: true,
      });
    }
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, posted: false, offline: true }, 200);
  }

  // Multi-Unit Inventory Lookups & Items (with default seeds + custom "Other" creation)
  if (pathname === "/api/inventory/uom" || pathname === "/api/inventory/uoms") {
    let units = readCollection<Record<string, unknown>>(OFFLINE_DB_UOMS_KEY, s);
    if (units.length === 0) {
      units = DEFAULT_UOMS.map((u) => ({ id: `uom-${u.code}`, ...u }));
      writeCollection(OFFLINE_DB_UOMS_KEY, units, s);
    }
    if (method === "GET") return jsonResponse({ units, offline: true }, 200);
    if (method === "POST") {
      const nameAr = String(body.nameAr || body.customUnitLabel || "").trim();
      const code = String(body.code || slugifyLookupCode(nameAr, "UOM")).toUpperCase();
      const unit = {
        id: `uom-${code}`,
        code,
        nameAr,
        nameEn: String(body.nameEn || nameAr),
        isBaseDefault: Boolean(body.isBaseDefault),
        isCustom: true,
      };
      units.push(unit);
      writeCollection(OFFLINE_DB_UOMS_KEY, units, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, unit, units, offline: true }, 201);
    }
  }

  if (pathname === "/api/inventory/categories") {
    let categories = readCollection<Record<string, unknown>>(OFFLINE_DB_CATEGORIES_KEY, s);
    if (categories.length === 0) {
      categories = DEFAULT_CATEGORIES.map((c) => ({ id: `cat-${c.code}`, ...c }));
      writeCollection(OFFLINE_DB_CATEGORIES_KEY, categories, s);
    }
    if (method === "GET") return jsonResponse({ categories, offline: true }, 200);
    if (method === "POST") {
      const nameAr = String(body.nameAr || "").trim();
      const code = String(body.code || slugifyLookupCode(nameAr, "CAT")).toUpperCase();
      const category = {
        id: `cat-${code}`,
        code,
        nameAr,
        nameEn: String(body.nameEn || nameAr),
        isCustom: true,
      };
      categories.push(category);
      writeCollection(OFFLINE_DB_CATEGORIES_KEY, categories, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, category, categories, offline: true }, 201);
    }
  }

  if (pathname === "/api/inventory/warehouses") {
    let warehouses = readCollection<Record<string, unknown>>(OFFLINE_DB_WAREHOUSES_KEY, s);
    if (warehouses.length === 0) {
      warehouses = DEFAULT_WAREHOUSES.map((w) => ({ id: `wh-${w.code}`, ...w, isActive: true }));
      writeCollection(OFFLINE_DB_WAREHOUSES_KEY, warehouses, s);
    }
    if (method === "GET") return jsonResponse({ warehouses, offline: true }, 200);
    if (method === "POST") {
      const nameAr = String(body.nameAr || "").trim();
      const code = String(body.code || slugifyLookupCode(nameAr, "WH")).toUpperCase();
      const warehouse = {
        id: `wh-${code}`,
        code,
        nameAr,
        nameEn: String(body.nameEn || nameAr),
        location: body.location ? String(body.location) : "",
        isDefault: Boolean(body.isDefault),
        isCustom: true,
        isActive: true,
      } as Record<string, unknown>;
      const whProv = provisionLocalGen6AccountAndCostCenter("WAREHOUSE", { id: String(warehouse.id), nameAr, nameEn: String(warehouse.nameEn) }, s);
      warehouse.glAccountId = whProv.glAccountId;
      warehouse.costCenterId = whProv.costCenterId;
      warehouses.push(warehouse);
      writeCollection(OFFLINE_DB_WAREHOUSES_KEY, warehouses, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, warehouse, warehouses, offline: true }, 201);
    }
  }

  if (pathname === "/api/inventory/items") {
    const items = readCollection<Record<string, unknown>>(OFFLINE_DB_ITEMS_KEY, s);
    if (method === "GET") return jsonResponse({ items, offline: true }, 200);
    if (method === "POST" || method === "PUT") {
      const item = {
        id: String(body.id || `item-${Date.now()}`),
        sku: String(body.sku || `SKU-${Date.now().toString(36).toUpperCase()}`),
        ...body,
        totalBaseQty: 0,
        compoundBreakdown: "0",
      };
      const idx = items.findIndex((i) => i.id === item.id || i.sku === item.sku);
      if (idx >= 0) items[idx] = item;
      else items.unshift(item);
      writeCollection(OFFLINE_DB_ITEMS_KEY, items, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, item, items, offline: true }, 201);
    }
  }

  if (pathname === "/api/inventory/movements") {
    const movements = readCollection<Record<string, unknown>>(OFFLINE_DB_MOVEMENTS_KEY, s);
    if (method === "GET") return jsonResponse({ movements, offline: true }, 200);
    if (method === "POST") {
      const movement = { id: `mov-${Date.now()}`, ...body, createdAt: new Date().toISOString() };
      movements.unshift(movement);
      writeCollection(OFFLINE_DB_MOVEMENTS_KEY, movements, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, movement, offline: true }, 201);
    }
  }

  if (pathname === "/api/inventory" || pathname.startsWith("/api/inventory/")) {
    const state = loadOfflineAndroidState(s);
    const items = readCollection<Record<string, unknown>>(OFFLINE_DB_ITEMS_KEY, s);
    if (method === "GET") {
      return jsonResponse({ inventoryBatches: state.inventoryBatches, items, state, offline: true }, 200);
    }
    if (method === "POST") {
      const projectId = String(body.projectId || "");
      const harvest = String(body.harvest || "");
      if (state.lockedPeriods[`${projectId}::${harvest}`]) {
        return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
      }
      const batch = {
        id: String(body.id || `inv-${Date.now()}`),
        projectId,
        subProjectId: body.subProjectId ? String(body.subProjectId) : undefined,
        harvest,
        grade: String(body.grade || "رقم 1"),
        harvestedBundles: Math.max(0, Math.round(Number(body.harvestedBundles) || 0)),
        shrinkageBundles: Math.max(0, Math.round(Number(body.shrinkageBundles) || 0)),
        notes: String(body.notes || ""),
      };
      state.inventoryBatches.push(batch);
      addLocalAudit(state, actor.userDisplay, "إضافة دفعة مخزون علاقيات (محلي)", `${harvest} (${batch.grade}) — ${batch.harvestedBundles} علاقية`);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, createdId: batch.id, batch, inventoryBatches: state.inventoryBatches, items, state, offline: true }, 201);
    }
    if (method === "PATCH" || method === "PUT") {
      const pathId = pathname.startsWith("/api/inventory/") ? decodeURIComponent(pathname.slice("/api/inventory/".length)) : "";
      const id = String(body.id || pathId || "").trim();
      const rec = state.inventoryBatches.find((b) => b.id === id);
      if (!rec) {
        return jsonResponse({ error: "دفعة المخزون غير موجودة" }, 404);
      }
      if (state.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
        return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
      }
      if (body.projectId !== undefined) rec.projectId = String(body.projectId);
      if (body.subProjectId !== undefined) {
        rec.subProjectId = body.subProjectId ? String(body.subProjectId) : undefined;
      }
      if (body.harvest !== undefined) rec.harvest = String(body.harvest);
      if (body.grade !== undefined) rec.grade = String(body.grade);
      if (body.harvestedBundles !== undefined) {
        rec.harvestedBundles = Math.max(0, Math.round(Number(body.harvestedBundles) || 0));
      }
      if (body.shrinkageBundles !== undefined) {
        rec.shrinkageBundles = Math.max(0, Math.round(Number(body.shrinkageBundles) || 0));
      }
      if (body.notes !== undefined) rec.notes = String(body.notes);
      addLocalAudit(state, actor.userDisplay, "تعديل دفعة مخزون (محلي)", `${rec.harvest} (${rec.grade}) — ${rec.harvestedBundles} علاقية`);
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, batch: rec, inventoryBatches: state.inventoryBatches, items, state, offline: true }, 200);
    }
    if (method === "DELETE") {
      const pathId = pathname.startsWith("/api/inventory/") ? decodeURIComponent(pathname.slice("/api/inventory/".length)) : "";
      const id = String(body.id || pathId || "").trim();
      const idx = state.inventoryBatches.findIndex((b) => b.id === id);
      if (idx >= 0) {
        const existing = state.inventoryBatches[idx];
        if (state.lockedPeriods[`${existing.projectId}::${existing.harvest}`]) {
          return jsonResponse({ error: "🔒 هذه القطفة مغلقة محاسبياً!" }, 423);
        }
        state.inventoryBatches.splice(idx, 1);
        addLocalAudit(state, actor.userDisplay, "حذف دفعة مخزون (محلي)", `${existing.harvest} (${existing.grade})`);
      }
      saveOfflineAndroidState(state, s);
      appendOfflineSyncQueue(pathname, method, body, s);
      return jsonResponse({ success: true, inventoryBatches: state.inventoryBatches, items, state, offline: true }, 200);
    }
  }

  if (pathname === "/api/accounting/reports/cost-centers") {
    const state = loadOfflineAndroidState(s);
    const rows = state.projects.map((p) => {
      const revenue = state.sales.filter((x) => x.projectId === p.id).reduce((sum, x) => sum + (Number(x.total) || 0), 0);
      const opExp = state.expenses.filter((x) => x.projectId === p.id).reduce((sum, x) => sum + (Number(x.total) || 0), 0);
      const wages = state.workers.filter((x) => x.projectId === p.id).reduce((sum, x) => sum + (Number(x.total) || 0), 0);
      const expense = opExp + wages;
      return {
        id: p.id,
        code: p.id,
        nameAr: p.name,
        nameEn: p.name,
        revenue,
        expense,
        net: revenue - expense,
      };
    });
    const totals = rows.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        expense: acc.expense + r.expense,
        net: acc.net + r.net,
      }),
      { revenue: 0, expense: 0, net: 0 }
    );
    return jsonResponse({ rows, totals, offline: true }, 200);
  }

  if (pathname.startsWith("/api/accounting/reports/")) {
    const state = loadOfflineAndroidState(s);
    const totalRevenue = state.sales.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
    const totalCollected = state.sales.reduce((sum, x) => sum + (Number(x.credit) || 0), 0);
    const totalReceivables = state.sales.reduce((sum, x) => sum + (Number(x.debit) || 0), 0);
    const totalExpenses = state.expenses.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
    const totalWages = state.workers.reduce((sum, x) => sum + (Number(x.total) || 0), 0);
    const netIncome = totalRevenue - (totalExpenses + totalWages);
    const rows = [
      { code: "1101", nameAr: "الصناديق والخزائن", nameEn: "Treasury & Cash", type: "ASSET", debit: totalCollected, credit: 0 },
      { code: "1120", nameAr: "الذمم المدينة (العملاء)", nameEn: "Accounts Receivable", type: "ASSET", debit: totalReceivables, credit: 0 },
      { code: "4100", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "REVENUE", debit: 0, credit: totalRevenue },
      { code: "5100", nameAr: "المصروفات التشغيلية", nameEn: "Operating Expenses", type: "EXPENSE", debit: totalExpenses, credit: 0 },
      { code: "5200", nameAr: "أجور العمال والحصاد", nameEn: "Labor & Harvest Wages", type: "EXPENSE", debit: totalWages, credit: 0 },
    ].filter((r) => r.debit > 0 || r.credit > 0);
    const totals = rows.reduce(
      (acc, r) => ({
        debit: acc.debit + r.debit,
        credit: acc.credit + r.credit,
        netIncome,
      }),
      { debit: 0, credit: 0, netIncome }
    );
    return jsonResponse({ rows, totals, offline: true }, 200);
  }

  if (pathname === "/api/ai/briefing") {
    const state = loadOfflineAndroidState(s);
    const tenantSlug = normalizeMemoryTenantSlug(
      state.enterpriseProfile?.tenantSlug || "default"
    );
    let memories: CopilotMemoryEntry[] = [];
    try {
      const rawMem = s?.getItem(`uas_copilot_memory_v1_${tenantSlug}`);
      if (rawMem) {
        const parsed = JSON.parse(rawMem);
        if (Array.isArray(parsed)) memories = parsed as CopilotMemoryEntry[];
      }
    } catch {
      memories = [];
    }
    const queue = readCollection<Record<string, unknown>>(OFFLINE_SYNC_QUEUE_KEY, s);
    const reqUrl = new URL(rawUrl, "https://localhost");
    const langParam = body.lang || reqUrl.searchParams.get("lang");
    const dialectParam = body.dialect || reqUrl.searchParams.get("dialect");
    const focusParam = body.focus || reqUrl.searchParams.get("focus");
    const lang: "ar" | "en" = langParam === "en" ? "en" : "ar";
    const dialect = dialectParam === "msa" ? "msa" : "yemeni";
    const focus =
      focusParam === "low_stock" || focusParam === "overdue_receivables"
        ? focusParam
        : "all";
    const report = generateExecutiveBriefing({
      tenantSlug,
      lang,
      dialect,
      user: state.users?.[0] || "SUPER_ADMIN",
      state,
      memories,
      offlineQueueCount: queue.length,
      focus,
    });
    return jsonResponse({ success: true, ...report, offline: true }, 200);
  }

  if (pathname === "/api/ai/memory") {
    const state = loadOfflineAndroidState(s);
    const tenantSlug = normalizeMemoryTenantSlug(
      state.enterpriseProfile?.tenantSlug || "default"
    );
    const storageKey = `uas_copilot_memory_v1_${tenantSlug}`;
    const readMem = (): CopilotMemoryEntry[] => {
      if (!s) return [];
      try {
        const raw = s.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as CopilotMemoryEntry[]) : [];
      } catch {
        return [];
      }
    };
    const writeMem = (list: CopilotMemoryEntry[]) => {
      if (!s) return;
      try {
        s.setItem(storageKey, JSON.stringify(list));
      } catch {
        // ignore quota errors
      }
    };

    if (method === "GET") {
      return jsonResponse({ success: true, tenantSlug, memories: readMem(), offline: true }, 200);
    }

    const action = String(body.action || "upsert").toLowerCase();
    let current = readMem();
    if (action === "sync" && Array.isArray(body.entries)) {
      for (const rawEntry of body.entries as Array<Partial<CopilotMemoryEntry>>) {
        const res = applyMemoryUpsert(current, {
          id: rawEntry.id,
          tenantSlug,
          scope: (rawEntry.scope === "user" ? "user" : "workspace") as CopilotMemoryScope,
          userId: rawEntry.userId,
          category: (rawEntry.category || "domain_fact") as CopilotMemoryCategory,
          topicKey: String(rawEntry.topicKey || rawEntry.content || "rule"),
          content: String(rawEntry.content || ""),
          sourceSnippet: rawEntry.sourceSnippet,
          confidence: rawEntry.confidence,
          pinned: Boolean(rawEntry.pinned),
          active: rawEntry.active !== false,
        });
        current = res.nextList;
      }
      writeMem(current);
      return jsonResponse({ success: true, tenantSlug, memories: current, offline: true }, 200);
    }
    if (action === "delete" || action === "undo") {
      const id = String(body.id || "").trim();
      current = current.filter((m) => m.id !== id);
      if (action === "undo" && body.previousEntry && typeof body.previousEntry === "object") {
        const prev = body.previousEntry as CopilotMemoryEntry;
        current = applyMemoryUpsert(current, { ...prev, tenantSlug }).nextList;
      }
      writeMem(current);
      return jsonResponse({ success: true, tenantSlug, memories: current, offline: true }, 200);
    }
    if (action === "update" || action === "toggle" || action === "pin") {
      const id = String(body.id || "").trim();
      current = current.map((m) =>
        m.id === id
          ? {
              ...m,
              ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
              ...(body.pinned !== undefined ? { pinned: Boolean(body.pinned) } : {}),
              ...(typeof body.content === "string" && body.content.trim()
                ? { content: body.content.trim() }
                : {}),
              updatedAt: new Date().toISOString(),
            }
          : m
      );
      writeMem(current);
      return jsonResponse({ success: true, tenantSlug, memories: current, offline: true }, 200);
    }
    const upsertRes = applyMemoryUpsert(current, {
      id: typeof body.id === "string" ? body.id : undefined,
      tenantSlug,
      scope: (body.scope === "user" ? "user" : "workspace") as CopilotMemoryScope,
      userId: typeof body.userId === "string" ? body.userId : undefined,
      category: (body.category || "domain_fact") as CopilotMemoryCategory,
      topicKey: String(body.topicKey || body.content || "rule"),
      content: String(body.content || ""),
      sourceSnippet: typeof body.sourceSnippet === "string" ? body.sourceSnippet : undefined,
      confidence: typeof body.confidence === "number" ? body.confidence : 0.92,
      pinned: Boolean(body.pinned),
      active: body.active !== false,
    });
    if (!upsertRes.event) {
      return jsonResponse({ success: false, error: "DISALLOWED_OR_INVALID_MEMORY" }, 400);
    }
    writeMem(upsertRes.nextList);
    return jsonResponse(
      {
        success: true,
        tenantSlug,
        event: upsertRes.event,
        memories: upsertRes.nextList,
        offline: true,
      },
      200
    );
  }

  // Generic local fallback for any other `/api/*` write/read in Android Local Mode
  if (method !== "GET" && method !== "HEAD") {
    appendOfflineSyncQueue(pathname, method, body, s);
    const state = loadOfflineAndroidState(s);
    return jsonResponse({ success: true, state, offline: true }, 200);
  }
  return jsonResponse({ success: true, offline: true }, 200);
}

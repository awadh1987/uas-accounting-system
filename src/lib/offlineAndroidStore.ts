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
import type { UasBootstrapState, UasEnterpriseProfile, UasUser } from "@/types/uas";

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
export const OFFLINE_SYNC_QUEUE_KEY = "uas_offline_sync_queue";

export const DEFAULT_LOCAL_ADMIN_EMAIL = "admin@uas-ye.com";
export const DEFAULT_LOCAL_ADMIN_PASSWORD = "123456";

export interface OfflineStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
  try {
    const raw = s.getItem(OFFLINE_DB_STATE_KEY);
    if (!raw) {
      const clean = createCleanOfflineCompanyState();
      s.setItem(OFFLINE_DB_STATE_KEY, JSON.stringify(clean));
      return clean;
    }
    const parsed = JSON.parse(raw) as UasBootstrapState;
    if (!parsed || !Array.isArray(parsed.users) || parsed.users.length === 0) {
      const clean = createCleanOfflineCompanyState();
      s.setItem(OFFLINE_DB_STATE_KEY, JSON.stringify(clean));
      return clean;
    }
    return parsed;
  } catch {
    const clean = createCleanOfflineCompanyState();
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
  if (!s) return { [DEFAULT_LOCAL_ADMIN_EMAIL]: DEFAULT_LOCAL_ADMIN_PASSWORD };
  try {
    const raw = s.getItem(OFFLINE_DB_PASSWORDS_KEY);
    if (!raw) {
      const initial = { [DEFAULT_LOCAL_ADMIN_EMAIL]: DEFAULT_LOCAL_ADMIN_PASSWORD };
      s.setItem(OFFLINE_DB_PASSWORDS_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object"
      ? parsed
      : { [DEFAULT_LOCAL_ADMIN_EMAIL]: DEFAULT_LOCAL_ADMIN_PASSWORD };
  } catch {
    return { [DEFAULT_LOCAL_ADMIN_EMAIL]: DEFAULT_LOCAL_ADMIN_PASSWORD };
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
  const body = method !== "GET" && method !== "HEAD" ? parseJsonBody(init) : {};
  const actor = extractActorFromReq(body, init);

  let pathname = rawUrl;
  try {
    const u = new URL(rawUrl, "https://localhost");
    pathname = u.pathname;
  } catch {
    pathname = rawUrl.split("?")[0];
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
    const targetId = decodeURIComponent(userMatch[1]);
    const state = loadOfflineAndroidState(s);
    const idx = state.users.findIndex((u) => u.id === targetId);
    if (idx < 0) return jsonResponse({ error: "المستخدم غير موجود" }, 404);
    const existing = state.users[idx];

    if (method === "PATCH") {
      const action = String(body.action || "").trim().toLowerCase();
      if (action === "archive") {
        if (targetId === actor.userId) {
          return jsonResponse({ error: "لا يمكن أرشفة حسابك الشخصي المسجل به حالياً" }, 400);
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
      if (targetId === actor.userId) {
        return jsonResponse({ error: "لا يمكن حذف حسابك الشخصي المسجل به حالياً" }, 400);
      }
      const journals = readCollection<{ createdById?: string }>(OFFLINE_DB_JOURNALS_KEY, s);
      const hasLinked =
        journals.some((j) => j.createdById === targetId) ||
        state.sales.some((sale) => sale.salesOfficerId === targetId) ||
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
          message: "تمت أرشفة المستخدم لوجود قيود محاسبية مرتبطة به مع تحرير مقعد الترخيص",
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
        message: "تم حذف المستخدم نهائياً وتحرير مقعد الترخيص بنجاح",
        state,
      });
    }
  }

  const userResetMatch = pathname.match(/^\/api\/users\/([^/]+)\/reset-password$/);
  if (userResetMatch && method === "POST") {
    const targetId = decodeURIComponent(userResetMatch[1]);
    const state = loadOfflineAndroidState(s);
    const existing = state.users.find((u) => u.id === targetId);
    if (!existing) return jsonResponse({ error: "المستخدم غير موجود" }, 404);
    const passwords = readPasswordMap(s);
    passwords[existing.email.toLowerCase()] = String(body.newPassword || DEFAULT_LOCAL_ADMIN_PASSWORD);
    writePasswordMap(passwords, s);
    existing.mustChangePassword = Boolean(body.mustChangePassword);
    existing.passwordUpdatedAt = new Date().toISOString();
    addLocalAudit(state, actor.userDisplay, "إعادة تعيين كلمة مرور (محلي)", existing.email);
    saveOfflineAndroidState(state, s);
    appendOfflineSyncQueue(pathname, method, body, s);
    return jsonResponse({ success: true, state }, 200);
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

  if (pathname === "/api/expenses" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const qty = Number(body.qty) || 1;
    const unitPrice = Number(body.unitPrice) || 0;
    const total = computeOperatingExpenseTotal(qty, unitPrice);
    state.expenses.push({
      id: `e-${Date.now()}`,
      projectId: String(body.projectId || ""),
      harvest: String(body.harvest || ""),
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

  if (pathname === "/api/workers" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const dailyWage = Number(body.dailyWage) || 0;
    const days = Number(body.days) || 1;
    const credit = Number(body.credit) || 0;
    const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, days, credit);
    const workerLocalId = `w-${Date.now()}`;
    const wrkProv = provisionLocalGen6AccountAndCostCenter("WORKER", { id: `worker:${String(body.name || "").trim()}`, nameAr: String(body.name || "").trim() }, s);
    state.workers.push({
      id: workerLocalId,
      projectId: String(body.projectId || ""),
      harvest: String(body.harvest || ""),
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

  if (pathname === "/api/sales" && method === "POST") {
    const state = loadOfflineAndroidState(s);
    const bundles = Number(body.bundles) || 0;
    const price = Number(body.price) || 0;
    const credit = Number(body.credit) || 0;
    const { totalAmount, debitReceivable } = computeSaleTotals(bundles, price, credit);
    state.sales.push({
      id: `s-${Date.now()}`,
      projectId: String(body.projectId || ""),
      harvest: String(body.harvest || ""),
      batch: String(body.batch || `SO-${Date.now().toString().slice(-4)}`),
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
      if (method === "PUT" || method === "PATCH" || method === "DELETE") {
        appendOfflineSyncQueue(pathname, method, body, s);
        return jsonResponse({ success: true, [col.listProp]: rows, offline: true }, 200);
      }
    }
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
  if (pathname === "/api/inventory/uom") {
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

  if (pathname.startsWith("/api/inventory")) {
    const state = loadOfflineAndroidState(s);
    if (method === "GET") {
      return jsonResponse({ inventoryBatches: state.inventoryBatches, items: [], offline: true }, 200);
    }
    appendOfflineSyncQueue(pathname, method, body, s);
    saveOfflineAndroidState(state, s);
    return jsonResponse({ success: true, inventoryBatches: state.inventoryBatches, state, offline: true }, 200);
  }

  if (pathname === "/api/accounting/reports/cost-centers") {
    return jsonResponse({ rows: [], totals: { revenue: 0, expense: 0, net: 0 }, offline: true }, 200);
  }

  if (pathname.startsWith("/api/accounting/reports/")) {
    return jsonResponse({ rows: [], totals: { debit: 0, credit: 0, netIncome: 0 }, offline: true }, 200);
  }

  // Generic local fallback for any other `/api/*` write/read in Android Local Mode
  if (method !== "GET" && method !== "HEAD") {
    appendOfflineSyncQueue(pathname, method, body, s);
    const state = loadOfflineAndroidState(s);
    return jsonResponse({ success: true, state, offline: true }, 200);
  }
  return jsonResponse({ success: true, offline: true }, 200);
}

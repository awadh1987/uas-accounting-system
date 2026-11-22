/**
 * Client-side & Capacitor Android offline licensing verifier and seat store.
 *
 * Uses zero Node-only modules (`node:fs`, `node:child_process`, `@prisma/client`) so it can be
 * bundled directly into Next.js client components and the static Capacitor Android APK (`out/`).
 *
 * Shares the exact same `enforceActivationPolicy`, `evaluateCompanyLock`, `checkProfileUpdateAgainstLock`,
 * `bindSeat`, and `releaseSeat` functions used by local SQLite and `https://qat.world`.
 */
import {
  canonicalizeLicensePayload,
  extractUasKeyToken,
  isCompanyLockedPayload,
  parseHwidTargets,
  validateLicenseStructure,
  type LicenseAdminCredentials,
  type SeatPlatform,
  type UasSignedLicense,
} from "./licenseSchema";
import { UAS_LICENSE_PUBLIC_KEY } from "./publicKey";
import {
  checkProfileUpdateAgainstLock,
  PLACEHOLDER_NAME_AR,
  PLACEHOLDER_NAME_EN,
  type ProfileNames,
  type ProfileRepo,
} from "./companyLock";
import {
  getSeatUsage,
  normalizePlatform,
  normalizeUserEmail,
  releaseSeat,
  seatPolicyFromLicense,
  summarizeSeatUsage,
  type SeatBindingRecord,
  type SeatStore,
  type SeatUsage,
} from "./seatService";
import { enforceActivationPolicy } from "./activationPolicy";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const OFFLINE_LICENSE_STORAGE_KEY = "uas_offline_installed_license_v2";
export const OFFLINE_SEATS_STORAGE_KEY = "uas_offline_seat_bindings_v2";
export const OFFLINE_PROFILE_STORAGE_KEY = "uas_offline_enterprise_profile_v2";
export const CLIENT_HWID_STORAGE_KEY = "uas_client_device_hwid";

export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(k) {
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

function getDefaultStorage(): KeyValueStorage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Base64 helpers (browser + Node without importing node:buffer)
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\r\n\s]/g, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function decodeBase64Utf8(b64: string): string {
  const bytes = base64ToBytes(b64);
  return new TextDecoder("utf-8").decode(bytes);
}

// ---------------------------------------------------------------------------
// Platform & persistent client HWID
// ---------------------------------------------------------------------------

export function detectClientPlatform(): SeatPlatform {
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      Capacitor?: { getPlatform?: () => string };
    };
    const capPlatform = w.Capacitor?.getPlatform?.()?.toLowerCase();
    if (capPlatform === "android") return "android";
    if (typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)) {
      return "android";
    }
  }
  return "windows";
}

export function getClientDeviceHwid(storage: KeyValueStorage | null = getDefaultStorage()): string {
  if (storage) {
    try {
      const existing = storage.getItem(CLIENT_HWID_STORAGE_KEY);
      if (existing && /^[A-F0-9]{16,64}$/i.test(existing.trim())) {
        return existing.trim().toUpperCase();
      }
    } catch {
      // ignore storage read error
    }
  }

  const randomBytes = new Uint8Array(32);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  if (storage) {
    try {
      storage.setItem(CLIENT_HWID_STORAGE_KEY, hex);
    } catch {
      // ignore storage write error
    }
  }
  return hex;
}

export function getClientRequestCode(storage: KeyValueStorage | null = getDefaultStorage()): string {
  const hwid = getClientDeviceHwid(storage);
  const slice = hwid.slice(0, 16).padEnd(16, "0");
  return `REQ-${slice.slice(0, 4)}-${slice.slice(4, 8)}-${slice.slice(8, 12)}-${slice.slice(12, 16)}`;
}

// ---------------------------------------------------------------------------
// Client-safe HWID & WebCrypto Ed25519 Verification
// ---------------------------------------------------------------------------

export function matchClientHwid(inputTarget: string, deviceHwid: string): boolean {
  const { wildcard, targets } = parseHwidTargets(inputTarget);
  if (wildcard) return true;
  if (targets.length === 0) return false;
  return targets.some((t) => {
    if (t === "ANY" || t === "GLOBAL") return true;
    const targetClean = t.replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
    const machineClean = deviceHwid.replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
    if (!targetClean || !machineClean) return false;
    if (targetClean === machineClean) return true;
    if (targetClean.length >= 16 && machineClean.startsWith(targetClean.slice(0, 16))) return true;
    if (machineClean.length >= 16 && targetClean.startsWith(machineClean.slice(0, 16))) return true;
    return false;
  });
}

export async function verifyLicenseSignatureWebCrypto(
  license: UasSignedLicense,
  publicKeyPem: string = UAS_LICENSE_PUBLIC_KEY
): Promise<boolean> {
  try {
    if (!globalThis.crypto?.subtle) return false;
    const pemBody = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/g, "")
      .replace(/-----END PUBLIC KEY-----/g, "")
      .replace(/[\r\n\s]/g, "");
    const spkiBytes = base64ToBytes(pemBody);
    const sigBytes = base64ToBytes(license.signature);
    const canonical = canonicalizeLicensePayload(license);
    const dataBytes = new TextEncoder().encode(canonical);

    const key = await globalThis.crypto.subtle.importKey(
      "spki",
      spkiBytes.buffer.slice(spkiBytes.byteOffset, spkiBytes.byteOffset + spkiBytes.byteLength) as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
      dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength) as ArrayBuffer
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// LocalStorage SeatStore & ProfileRepo (Capacitor Android Offline Mode)
// ---------------------------------------------------------------------------

interface StoredSeatRow {
  id: string;
  licenseId: string;
  userEmail: string;
  platform: SeatPlatform;
  hwid: string;
  deviceName: string;
  activatedAt: string;
  lastSeenAt: string;
  active: boolean;
}

export class LocalStorageSeatStore implements SeatStore {
  private storage: KeyValueStorage;
  private storageKey: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(storage: KeyValueStorage | null = getDefaultStorage(), storageKey = OFFLINE_SEATS_STORAGE_KEY) {
    this.storage = storage ?? createMemoryStorage();
    this.storageKey = storageKey;
  }

  private readAll(): StoredSeatRow[] {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(rows: StoredSeatRow[]): void {
    this.storage.setItem(this.storageKey, JSON.stringify(rows));
  }

  private toRecord(r: StoredSeatRow): SeatBindingRecord {
    return {
      id: r.id,
      licenseId: r.licenseId,
      userEmail: r.userEmail,
      platform: r.platform,
      hwid: r.hwid,
      deviceName: r.deviceName,
      activatedAt: new Date(r.activatedAt),
      lastSeenAt: new Date(r.lastSeenAt),
      active: Boolean(r.active),
    };
  }

  async list(licenseId: string): Promise<SeatBindingRecord[]> {
    const id = licenseId.trim().toUpperCase();
    return this.readAll()
      .filter((r) => r.licenseId === id)
      .map((r) => this.toRecord(r));
  }

  async upsert(record: SeatBindingRecord): Promise<SeatBindingRecord> {
    const rows = this.readAll();
    const idx = rows.findIndex(
      (r) =>
        r.licenseId === record.licenseId &&
        r.userEmail === record.userEmail &&
        r.platform === record.platform
    );
    const saved: StoredSeatRow = {
      id: record.id ?? (idx >= 0 ? rows[idx].id : `cap-${rows.length + 1}-${Date.now()}`),
      licenseId: record.licenseId,
      userEmail: record.userEmail,
      platform: record.platform,
      hwid: record.hwid,
      deviceName: record.deviceName,
      activatedAt: record.activatedAt.toISOString(),
      lastSeenAt: record.lastSeenAt.toISOString(),
      active: record.active,
    };
    if (idx >= 0) {
      rows[idx] = saved;
    } else {
      rows.push(saved);
    }
    this.writeAll(rows);
    return this.toRecord(saved);
  }

  async setActive(
    licenseId: string,
    userEmail: string,
    platform: SeatPlatform | "all",
    active: boolean
  ): Promise<number> {
    const rows = this.readAll();
    let changed = 0;
    for (const r of rows) {
      if (r.licenseId !== licenseId || r.userEmail !== userEmail) continue;
      if (platform !== "all" && r.platform !== platform) continue;
      if (r.active !== active) {
        r.active = active;
        changed++;
      }
    }
    if (changed > 0) this.writeAll(rows);
    return changed;
  }

  transaction<T>(fn: (store: SeatStore) => Promise<T>): Promise<T> {
    const run = this.chain.then(() => fn(this));
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export class LocalStorageProfileStore implements ProfileRepo {
  private storage: KeyValueStorage;
  private storageKey: string;

  constructor(storage: KeyValueStorage | null = getDefaultStorage(), storageKey = OFFLINE_PROFILE_STORAGE_KEY) {
    this.storage = storage ?? createMemoryStorage();
    this.storageKey = storageKey;
  }

  async get(): Promise<ProfileNames | null> {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        legalNameAr: String(parsed.legalNameAr ?? PLACEHOLDER_NAME_AR),
        legalNameEn: String(parsed.legalNameEn ?? PLACEHOLDER_NAME_EN),
        isConfigured: Boolean(parsed.isConfigured),
      };
    } catch {
      return null;
    }
  }

  async adopt(patch: { legalNameAr: string; legalNameEn: string; isConfigured: true }): Promise<void> {
    this.storage.setItem(this.storageKey, JSON.stringify(patch));
  }

  /**
   * Attempt to update the offline EnterpriseProfile names while respecting any active
   * company-locked license installed in offline storage.
   */
  async updateNames(
    patch: { legalNameAr?: string | null; legalNameEn?: string | null },
    publicKeyPem: string = UAS_LICENSE_PUBLIC_KEY
  ): Promise<{ ok: true; profile: ProfileNames } | { ok: false; code: string; error: string }> {
    const existing = await this.get();
    const installed = loadOfflineClientLicense(this.storage);
    if (installed && isCompanyLockedPayload(installed)) {
      const sigOk = await verifyLicenseSignatureWebCrypto(installed, publicKeyPem);
      if (sigOk) {
        const check = checkProfileUpdateAgainstLock(installed.company_name as string, existing, patch);
        if (!check.ok) {
          return { ok: false, code: "COMPANY_NAME_LOCKED", error: check.error };
        }
      }
    }

    const updated: ProfileNames = {
      legalNameAr:
        typeof patch.legalNameAr === "string" && patch.legalNameAr.trim()
          ? patch.legalNameAr.trim()
          : existing?.legalNameAr || PLACEHOLDER_NAME_AR,
      legalNameEn:
        typeof patch.legalNameEn === "string" && patch.legalNameEn.trim()
          ? patch.legalNameEn.trim()
          : existing?.legalNameEn || PLACEHOLDER_NAME_EN,
      isConfigured: true,
    };
    this.storage.setItem(this.storageKey, JSON.stringify(updated));
    return { ok: true, profile: updated };
  }
}

export function loadOfflineClientLicense(
  storage: KeyValueStorage | null = getDefaultStorage()
): UasSignedLicense | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(OFFLINE_LICENSE_STORAGE_KEY);
    if (!raw) return null;
    return validateLicenseStructure(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveOfflineClientLicense(
  license: UasSignedLicense,
  storage: KeyValueStorage | null = getDefaultStorage()
): void {
  if (!storage) return;
  storage.setItem(OFFLINE_LICENSE_STORAGE_KEY, JSON.stringify(license));
}

// ---------------------------------------------------------------------------
// Offline / Capacitor activation, seat bind & release
// ---------------------------------------------------------------------------

function decodeBase64FlexibleUtf8(raw: string): string {
  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return decodeBase64Utf8(normalized + "=".repeat(padLen));
}

export interface OfflineActivationInput {
  licenseFileContent?: string | Record<string, unknown>;
  activationKey?: string;
  confirmCompanyName?: string;
  company_name?: string;
  userEmail?: string;
  user_email?: string;
  platform?: SeatPlatform | string;
  hwid?: string;
  deviceName?: string;
  mode?: "local" | "lan" | "cloud";
}

export interface OfflineClientOptions {
  storage?: KeyValueStorage;
  seatStore?: SeatStore;
  profileRepo?: ProfileRepo;
  publicKeyPem?: string;
  now?: Date;
}

export interface OfflineAutoLoginUser {
  id: string;
  username: string;
  name: string;
  fullName: string;
  displayName: string;
  phone: string;
  email: string;
  role: "SUPER_ADMIN";
  department: string;
  active: boolean;
  isActive: boolean;
  archivedAt: null;
  avatarChar: string;
  avatarColor: string;
  preferredLang: "ar" | "en";
  preferredCurrency: "YER" | "SAR" | "USD";
  preferredTheme: "emerald" | "slate" | "amber";
  defaultModule: string;
  lastLoginAt: string;
  useCustomPermissions: boolean;
  customAllowedGroups: string[];
  customPermissionsJson: Record<string, boolean>;
  mustChangePassword: boolean;
  assignedProjects: string[];
}

export type OfflineActivationResult =
  | {
      success: true;
      license: UasSignedLicense;
      company_lock: "ADOPTED" | "MATCHED" | "NOT_REQUIRED";
      tenant_slug?: string | null;
      tenantSlug?: string | null;
      tenant_url?: string | null;
      tenantUrl?: string | null;
      allowed_modes?: ("local" | "lan" | "cloud")[];
      allowedModes?: ("local" | "lan" | "cloud")[];
      syncMetadata?: {
        tenantSlug: string | null;
        tenantUrl: string | null;
        allowedModes: ("local" | "lan" | "cloud")[];
      };
      auto_login?: boolean;
      user?: OfflineAutoLoginUser | null;
      admin_credentials?: LicenseAdminCredentials | null;
      seat?: {
        user_email: string;
        platform: SeatPlatform;
        hwid: string;
        status: "CREATED" | "REFRESHED" | "REBOUND";
      } | null;
      usage?: SeatUsage;
    }
  | {
      success: false;
      status: number;
      code: string;
      error: string;
    };

function tryOfflineAutoLogin(
  storage: KeyValueStorage,
  licenseObj: UasSignedLicense,
  hadPriorLicense: boolean
): {
  auto_login: boolean;
  user?: OfflineAutoLoginUser;
  admin_credentials?: LicenseAdminCredentials;
} {
  const cred = licenseObj.admin_credentials;
  if (!cred) return { auto_login: false };

  const credEmail = cred.email.trim().toLowerCase();
  const credUsername = cred.username.trim();
  const nowIso = new Date().toISOString();

  let passwords: Record<string, string> = {};
  try {
    const rawPw = storage.getItem("uas_offline_db_passwords");
    if (rawPw) {
      const parsed = JSON.parse(rawPw);
      if (parsed && typeof parsed === "object") passwords = parsed as Record<string, string>;
    }
  } catch {
    passwords = {};
  }

  let matchedUserRecord: Record<string, unknown> | null = null;
  let parsedState: Record<string, unknown> | null = null;
  try {
    const rawState = storage.getItem("uas_offline_db_state");
    if (rawState) {
      const st = JSON.parse(rawState);
      if (st && typeof st === "object" && Array.isArray((st as { users?: unknown[] }).users)) {
        parsedState = st as Record<string, unknown>;
        const users = (st as { users: Array<Record<string, unknown>> }).users;
        matchedUserRecord =
          users.find(
            (u) =>
              String(u.email || "").trim().toLowerCase() === credEmail ||
              String(u.username || "").trim().toLowerCase() === credUsername.toLowerCase()
          ) ?? null;

        if (!matchedUserRecord && !hadPriorLicense) {
          const defaultU1 = users.find(
            (u) =>
              String(u.id || "") === "u1" &&
              String(u.email || "").trim().toLowerCase() === "admin@uas-ye.com"
          );
          if (defaultU1) {
            defaultU1.email = credEmail;
            defaultU1.username = credUsername;
            defaultU1.fullName = `مدير النظام العام / ${licenseObj.company_name || licenseObj.customer_name}`;
            matchedUserRecord = defaultU1;
          }
        }
      }
    }
  } catch {
    parsedState = null;
  }

  const lookupEmail = matchedUserRecord
    ? String(matchedUserRecord.email || credEmail).trim().toLowerCase()
    : credEmail;
  const existingStoredPass = passwords[lookupEmail] ?? passwords[credEmail];
  if (typeof existingStoredPass === "string" && existingStoredPass !== cred.password) {
    return { auto_login: false };
  }

  if (
    matchedUserRecord &&
    (matchedUserRecord.archivedAt ||
      matchedUserRecord.active === false ||
      matchedUserRecord.isActive === false)
  ) {
    return { auto_login: false };
  }

  passwords[lookupEmail] = cred.password;
  try {
    storage.setItem("uas_offline_db_passwords", JSON.stringify(passwords));
  } catch {
    // ignore storage errors
  }

  if (matchedUserRecord && parsedState) {
    matchedUserRecord.lastLoginAt = nowIso;
    try {
      storage.setItem("uas_offline_db_state", JSON.stringify(parsedState));
    } catch {
      // ignore storage errors
    }
  }

  const companyLabel = (licenseObj.name_ar || licenseObj.company_name || licenseObj.customer_name || "").trim();
  const autoUser: OfflineAutoLoginUser = {
    id: String(matchedUserRecord?.id || "u1"),
    username: String(matchedUserRecord?.username || credUsername),
    name: String(matchedUserRecord?.name || "مدير النظام العام"),
    fullName: String(matchedUserRecord?.fullName || `مدير النظام العام / ${companyLabel}`),
    displayName: String(matchedUserRecord?.displayName || ""),
    phone: String(matchedUserRecord?.phone || ""),
    email: lookupEmail,
    role: "SUPER_ADMIN",
    department: String(matchedUserRecord?.department || "الإدارة العليا وتقنية المعلومات"),
    active: true,
    isActive: true,
    archivedAt: null,
    avatarChar: String(matchedUserRecord?.avatarChar || "م"),
    avatarColor: String(matchedUserRecord?.avatarColor || "#059669"),
    preferredLang: (matchedUserRecord?.preferredLang === "en" ? "en" : "ar"),
    preferredCurrency:
      matchedUserRecord?.preferredCurrency === "SAR" || matchedUserRecord?.preferredCurrency === "USD"
        ? matchedUserRecord.preferredCurrency
        : "YER",
    preferredTheme:
      matchedUserRecord?.preferredTheme === "slate" || matchedUserRecord?.preferredTheme === "amber"
        ? matchedUserRecord.preferredTheme
        : "emerald",
    defaultModule: String(matchedUserRecord?.defaultModule || "dashboard"),
    lastLoginAt: nowIso,
    useCustomPermissions: false,
    customAllowedGroups: [],
    customPermissionsJson: {},
    mustChangePassword: false,
    assignedProjects: Array.isArray(matchedUserRecord?.assignedProjects)
      ? (matchedUserRecord.assignedProjects as string[])
      : [],
  };

  try {
    storage.setItem("uas_user", autoUser.id);
    storage.setItem("uas_view_mode", "erp");
  } catch {
    // ignore storage errors
  }

  return {
    auto_login: true,
    user: autoUser,
    admin_credentials: cred,
  };
}

export async function activateOfflineClientLicense(
  input: OfflineActivationInput,
  opts: OfflineClientOptions = {}
): Promise<OfflineActivationResult> {
  const storage = opts.storage ?? getDefaultStorage() ?? createMemoryStorage();
  const seatStore = opts.seatStore ?? new LocalStorageSeatStore(storage);
  const profileRepo = opts.profileRepo ?? new LocalStorageProfileStore(storage);
  const now = opts.now ?? new Date();
  const hadPriorLicense = Boolean(loadOfflineClientLicense(storage));

  let licenseObj: UasSignedLicense | null = null;
  try {
    if (input.licenseFileContent) {
      const content = input.licenseFileContent;
      if (typeof content === "string") {
        const trimmed = content.trim();
        if (trimmed.startsWith("{")) {
          licenseObj = validateLicenseStructure(JSON.parse(trimmed));
        } else {
          const token = extractUasKeyToken(trimmed);
          if (token) {
            licenseObj = validateLicenseStructure(JSON.parse(decodeBase64FlexibleUtf8(token.slice(7).trim())));
          }
        }
      } else {
        licenseObj = validateLicenseStructure(content);
      }
    } else if (input.activationKey) {
      const key = input.activationKey.trim();
      const token = extractUasKeyToken(key);
      if (token) {
        const decoded = decodeBase64FlexibleUtf8(token.slice(7).trim());
        licenseObj = validateLicenseStructure(JSON.parse(decoded));
      } else if (key.startsWith("{")) {
        licenseObj = validateLicenseStructure(JSON.parse(key));
      }
    }
  } catch {
    licenseObj = null;
  }

  if (!licenseObj) {
    return {
      success: false,
      status: 400,
      code: "INVALID_LICENSE",
      error: "بيانات ملف الترخيص أو مفتاح التفعيل غير صالحة. / Invalid license payload or activation key format.",
    };
  }

  const sigOk = await verifyLicenseSignatureWebCrypto(licenseObj, opts.publicKeyPem ?? UAS_LICENSE_PUBLIC_KEY);
  if (!sigOk) {
    return {
      success: false,
      status: 403,
      code: "INVALID_SIGNATURE",
      error: "التوقيع الرقمي للترخيص غير صحيح أو تم التلاعب به / Invalid cryptographic signature",
    };
  }

  const expires = new Date(licenseObj.expires_at);
  if (Number.isNaN(expires.getTime()) || now.getTime() > expires.getTime()) {
    return {
      success: false,
      status: 403,
      code: "EXPIRED",
      error: "انتهت صلاحية هذا الترخيص، يرجى التجديد / License has expired",
    };
  }

  if (input.mode && !licenseObj.allowed_modes.includes(input.mode)) {
    return {
      success: false,
      status: 403,
      code: "MODE_NOT_ALLOWED",
      error: `وضع التشغيل (${input.mode}) غير مصرح به في هذا الترخيص / Mode (${input.mode}) is not allowed by license.`,
    };
  }

  const platform = normalizePlatform(String(input.platform ?? detectClientPlatform()));
  if (!platform) {
    return {
      success: false,
      status: 400,
      code: "INVALID_REQUEST",
      error: "منصة غير صالحة (windows | android). / Invalid platform (windows | android).",
    };
  }

  const hwid = (input.hwid?.trim() || getClientDeviceHwid(storage)).toUpperCase();
  if (platform === "windows" && !matchClientHwid(licenseObj.hwid, hwid)) {
    return {
      success: false,
      status: 403,
      code: "HWID_MISMATCH",
      error: "الترخيص مرتبط بجهاز كمبيوتر آخر / Hardware fingerprint mismatch",
    };
  }

  if (!hadPriorLicense && !opts.profileRepo && licenseObj.company_name) {
    await profileRepo.adopt({
      legalNameAr: licenseObj.name_ar || licenseObj.company_name.trim(),
      legalNameEn: licenseObj.name_en || licenseObj.company_name.trim(),
      isConfigured: true,
    });
  }

  const confirmCompanyName = (input.confirmCompanyName ?? input.company_name ?? "").trim();
  const userEmail = (input.userEmail ?? input.user_email ?? "").trim();

  const policyResult = await enforceActivationPolicy(
    {
      license: licenseObj,
      confirmCompanyName,
      userEmail,
      platform,
      hwid,
      deviceName: input.deviceName,
    },
    { profileRepo, seatStore, now }
  );

  if (!policyResult.ok) {
    return {
      success: false,
      status: policyResult.status,
      code: policyResult.code,
      error: policyResult.error,
    };
  }

  saveOfflineClientLicense(licenseObj, storage);

  const tenantSlug = licenseObj.tenant_slug || null;
  const tenantUrl = licenseObj.tenant_url || (tenantSlug ? `https://${tenantSlug}.qat.world` : null);
  try {
    if (tenantSlug) {
      storage.setItem("uas_tenant_id", tenantSlug);
    }
    if (tenantUrl) {
      storage.setItem("uas_cloud_server_url", tenantUrl);
    }
    const storedMode = (storage.getItem("uas_runtime_mode") || "").trim().toLowerCase();
    if (
      storedMode &&
      (storedMode === "local" || storedMode === "lan" || storedMode === "cloud") &&
      !licenseObj.allowed_modes.includes(storedMode)
    ) {
      storage.setItem("uas_runtime_mode", licenseObj.allowed_modes[0]);
    }
  } catch {
    // Ignore storage quota errors
  }

  const usage = isCompanyLockedPayload(licenseObj)
    ? await getSeatUsage(seatStore, licenseObj.license_id, seatPolicyFromLicense(licenseObj))
    : undefined;

  const autoLogin = tryOfflineAutoLogin(storage, licenseObj, hadPriorLicense);

  return {
    success: true,
    license: licenseObj,
    company_lock: policyResult.companyLock,
    tenant_slug: tenantSlug,
    tenantSlug,
    tenant_url: tenantUrl,
    tenantUrl,
    allowed_modes: licenseObj.allowed_modes,
    allowedModes: licenseObj.allowed_modes,
    syncMetadata: {
      tenantSlug,
      tenantUrl,
      allowedModes: licenseObj.allowed_modes,
    },
    auto_login: autoLogin.auto_login,
    ...(autoLogin.auto_login
      ? {
          user: autoLogin.user,
          admin_credentials: autoLogin.admin_credentials,
        }
      : {}),
    seat: policyResult.seat
      ? {
          user_email: policyResult.seat.binding.userEmail,
          platform: policyResult.seat.binding.platform,
          hwid: policyResult.seat.binding.hwid,
          status: policyResult.seat.status,
        }
      : null,
    usage,
  };
}

export async function releaseOfflineClientSeat(
  input: {
    userEmail: string;
    platform?: SeatPlatform | "all";
    actorRole?: string;
  },
  opts: OfflineClientOptions = {}
): Promise<
  | { success: true; released: number; usage: SeatUsage }
  | { success: false; status: number; code: string; error: string }
> {
  if (String(input.actorRole ?? "").trim().toUpperCase() !== "SUPER_ADMIN") {
    return {
      success: false,
      status: 403,
      code: "FORBIDDEN",
      error: "⛔ إلغاء ربط الأجهزة محصور بمدير النظام العام / Releasing device seats is restricted to SUPER_ADMIN.",
    };
  }

  const storage = opts.storage ?? getDefaultStorage() ?? createMemoryStorage();
  const seatStore = opts.seatStore ?? new LocalStorageSeatStore(storage);
  const license = loadOfflineClientLicense(storage);
  if (!license || !isCompanyLockedPayload(license)) {
    return {
      success: false,
      status: 400,
      code: "NOT_SEAT_MANAGED",
      error: "لا يوجد ترخيص بمقاعد مُدارة. / No seat-managed license installed.",
    };
  }

  const userEmail = normalizeUserEmail(input.userEmail);
  const rawPlatform = String(input.platform ?? "all").trim().toLowerCase();
  const platform = rawPlatform === "all" ? "all" : normalizePlatform(rawPlatform);
  if (!userEmail || !platform) {
    return {
      success: false,
      status: 400,
      code: "INVALID_REQUEST",
      error: "userEmail / platform غير صالح / Invalid userEmail or platform.",
    };
  }

  const res = await releaseSeat(seatStore, seatPolicyFromLicense(license), license.license_id, userEmail, platform);
  return { success: true, released: res.released, usage: res.usage };
}

export async function getOfflineClientSeatUsage(
  opts: OfflineClientOptions & { actorRole?: string } = {}
): Promise<{
  success: boolean;
  seat_managed: boolean;
  company_name?: string;
  license_id?: string;
  can_manage?: boolean;
  usage?: SeatUsage | Omit<SeatUsage, "users">;
}> {
  const storage = opts.storage ?? getDefaultStorage() ?? createMemoryStorage();
  const seatStore = opts.seatStore ?? new LocalStorageSeatStore(storage);
  const license = loadOfflineClientLicense(storage);
  if (!license || !isCompanyLockedPayload(license)) {
    return { success: true, seat_managed: false };
  }
  const usage = await getSeatUsage(seatStore, license.license_id, seatPolicyFromLicense(license));
  const isAdmin = String(opts.actorRole ?? "").trim().toUpperCase() === "SUPER_ADMIN";
  return {
    success: true,
    seat_managed: true,
    company_name: license.company_name,
    license_id: license.license_id,
    can_manage: isAdmin,
    usage: isAdmin ? usage : summarizeSeatUsage(usage),
  };
}

export async function buildOfflineClientLicenseStatus(
  opts: OfflineClientOptions = {}
): Promise<{
  request_code: string;
  hwid: string;
  active_mode: "local" | "lan" | "cloud";
  license_status:
    | "ACTIVE"
    | "UNLICENSED"
    | "EXPIRED"
    | "HWID_MISMATCH"
    | "CLOCK_TAMPER"
    | "SEAT_LIMIT_REACHED"
    | "MODE_NOT_ALLOWED"
    | "COMPANY_MISMATCH";
  is_valid: boolean;
  error?: string | null;
  customer_name?: string | null;
  company_name?: string | null;
  company_locked?: boolean;
  company_matches?: boolean | null;
  seat_managed?: boolean;
  max_users?: number | null;
  per_user_devices?: { windows: number; android: number } | null;
  seats?: {
    used_users: number;
    max_users: number;
    windows_bound: number;
    android_bound: number;
  } | null;
  license_id?: string | null;
  allowed_modes: ("local" | "lan" | "cloud")[];
  max_branches: number;
  max_lan_seats: number;
  active_seats: number;
  expires_at?: string | null;
  issued_at?: string | null;
  remaining_days: number;
  server_lan_ips: string[];
  lan_url: string;
  cloud_url?: string;
}> {
  const storage = opts.storage ?? getDefaultStorage() ?? createMemoryStorage();
  const seatStore = opts.seatStore ?? new LocalStorageSeatStore(storage);
  const hwid = getClientDeviceHwid(storage);
  const requestCode = getClientRequestCode(storage);
  const license = loadOfflineClientLicense(storage);

  // Respect persisted client runtime mode & server URLs (even while UNLICENSED)
  const rawMode = (storage.getItem("uas_runtime_mode") || "").trim().toLowerCase();
  const savedServerUrl = (storage.getItem("uas_server_url") || "").trim().replace(/\/+$/, "");
  const activeMode: "local" | "lan" | "cloud" =
    rawMode === "cloud" || rawMode === "lan" || rawMode === "local"
      ? rawMode
      : savedServerUrl.startsWith("https://")
      ? "cloud"
      : savedServerUrl.startsWith("http://")
      ? "lan"
      : "local";
  const savedLanUrl = (storage.getItem("uas_lan_server_url") || "").trim().replace(/\/+$/, "");
  const savedCloudUrl = (storage.getItem("uas_cloud_server_url") || "").trim().replace(/\/+$/, "");
  const lanUrl = savedLanUrl || (activeMode === "lan" && savedServerUrl ? savedServerUrl : "http://192.168.1.10:3000");
  const cloudUrl = savedCloudUrl || (activeMode === "cloud" && savedServerUrl ? savedServerUrl : "https://qat.world");

  if (!license) {
    return {
      request_code: requestCode,
      hwid,
      active_mode: activeMode,
      license_status: "UNLICENSED",
      is_valid: false,
      error: "المنظومة غير مفعلة بترخيص رسمي. / System is not activated with a valid license.",
      allowed_modes: ["local", "lan", "cloud"],
      max_branches: 1,
      max_lan_seats: 1,
      active_seats: 0,
      remaining_days: 0,
      server_lan_ips: ["127.0.0.1"],
      lan_url: lanUrl,
      cloud_url: cloudUrl,
    };
  }

  const sigOk = await verifyLicenseSignatureWebCrypto(license, opts.publicKeyPem ?? UAS_LICENSE_PUBLIC_KEY);
  const now = opts.now ?? new Date();
  const expires = new Date(license.expires_at);
  const isExpired = Number.isNaN(expires.getTime()) || now.getTime() > expires.getTime();
  const remainingDays = isExpired
    ? 0
    : Math.max(0, Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const companyLocked = isCompanyLockedPayload(license);
  const policy = seatPolicyFromLicense(license);
  const usage = companyLocked
    ? await getSeatUsage(seatStore, license.license_id, policy)
    : null;

  return {
    request_code: requestCode,
    hwid,
    active_mode: activeMode,
    license_status: !sigOk ? "HWID_MISMATCH" : isExpired ? "EXPIRED" : "ACTIVE",
    is_valid: sigOk && !isExpired,
    error: !sigOk
      ? "التوقيع الرقمي للترخيص غير صحيح / Invalid cryptographic signature"
      : isExpired
      ? "انتهت صلاحية هذا الترخيص / License has expired"
      : null,
    customer_name: license.customer_name,
    company_name: license.company_name ?? license.customer_name,
    company_locked: companyLocked,
    company_matches: true,
    seat_managed: companyLocked,
    max_users: policy.maxUsers,
    per_user_devices: policy.perUserDevices,
    seats: usage
      ? {
          used_users: usage.usedUsers,
          max_users: usage.maxUsers,
          windows_bound: usage.windowsBound,
          android_bound: usage.androidBound,
        }
      : null,
    license_id: license.license_id,
    allowed_modes: license.allowed_modes,
    max_branches: license.max_branches,
    max_lan_seats: license.max_lan_seats,
    active_seats: usage?.usedUsers ?? 1,
    expires_at: license.expires_at,
    issued_at: license.issued_at,
    remaining_days: remainingDays,
    server_lan_ips: ["127.0.0.1"],
    lan_url: lanUrl,
    cloud_url: cloudUrl,
  };
}

function encodeUtf8Base64(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * Online `UASKEY-...` activation flow for Android APK (`https://localhost`) and remote clients.
 * Resolves `/api/licensing/verify-key` against the configured Cloud/LAN server URL
 * (defaulting to `https://qat.world`), parses JSON safely (never throws `Unexpected token '<'`),
 * and persists the verified license + seat binding into `localStorage`.
 * Falls back cleanly to offline WebCrypto verification if the device has no internet access.
 */
export async function activateOnlineKeyOnClient(
  input: {
    activationKey: string;
    confirmCompanyName?: string;
    userEmail?: string;
    platform?: SeatPlatform | string;
    hwid?: string;
    deviceName?: string;
    serverBaseUrl?: string;
  },
  opts: OfflineClientOptions & { fetchImpl?: typeof fetch } = {}
): Promise<OfflineActivationResult & { verifiedOnline?: boolean; resolvedServerUrl?: string }> {
  const storage = opts.storage ?? getDefaultStorage() ?? createMemoryStorage();
  const rawKeyInput = input.activationKey.trim();
  const key = extractUasKeyToken(rawKeyInput) ?? rawKeyInput;
  const platform = normalizePlatform(String(input.platform ?? detectClientPlatform())) ?? "android";
  const hwid = (input.hwid?.trim() || getClientDeviceHwid(storage)).toUpperCase();
  const confirmCompanyName = (input.confirmCompanyName ?? "").trim();
  const userEmail = (input.userEmail ?? "").trim();

  // Resolve target server URL (explicit -> saved server -> saved cloud -> https://qat.world)
  const savedServer = (storage.getItem("uas_server_url") || "").trim().replace(/\/+$/, "");
  const savedCloud = (storage.getItem("uas_cloud_server_url") || "").trim().replace(/\/+$/, "");
  const targetBase = (
    input.serverBaseUrl?.trim().replace(/\/+$/, "") ||
    savedServer ||
    savedCloud ||
    "https://qat.world"
  ).replace(/\/+$/, "");

  const fetchFn = opts.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);

  // Extract company_name from UASKEY-... payload if caller left it blank
  let decodedCompany = confirmCompanyName;
  if (!decodedCompany && /^UASKEY-/i.test(key)) {
    try {
      const parsed = validateLicenseStructure(JSON.parse(decodeBase64FlexibleUtf8(key.slice(7))));
      if (parsed?.company_name) decodedCompany = parsed.company_name;
    } catch {
      // ignore
    }
  }

  let serverLicenseObj: UasSignedLicense | null = null;
  let verifiedOnline = false;

  if (fetchFn && targetBase) {
    try {
      const res = await fetchFn(`${targetBase}/api/licensing/verify-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          company_name: decodedCompany || undefined,
          user_email: userEmail || undefined,
          platform,
          hwid,
          device_name: input.deviceName || (platform === "android" ? "Android Device" : "Windows PC"),
        }),
      });
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const rawText = await res.text();
      const trimmed = rawText.trim();
      const isHtml =
        /^<!doctype\s+html/i.test(trimmed) ||
        /^<html[\s>]/i.test(trimmed) ||
        (trimmed.startsWith("<") && !contentType.includes("application/json"));

      if (!isHtml && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
        const data = JSON.parse(trimmed) as Record<string, unknown>;
        if (res.ok && data.success) {
          verifiedOnline = true;
          if (data.license) {
            serverLicenseObj = validateLicenseStructure(data.license);
          }
        } else if (res.status === 400 || res.status === 403 || res.status === 409) {
          return {
            success: false,
            status: res.status,
            code: String(data.code || "CLOUD_REJECTED"),
            error: String(
              data.error ||
                "رفض الخادم السحابي مفتاح التفعيل (تحقق من اسم المنشأة أو حد المقاعد). / Cloud server rejected activation key."
            ),
            resolvedServerUrl: targetBase,
          };
        }
      }
    } catch {
      // Network offline or unreachable: fall through to client-side WebCrypto verification
    }
  }

  // Verify signature + persist license & seat binding locally in localStorage so app becomes ACTIVE immediately
  const localResult = await activateOfflineClientLicense(
    serverLicenseObj
      ? {
          licenseFileContent: serverLicenseObj as unknown as Record<string, unknown>,
          confirmCompanyName: decodedCompany || undefined,
          userEmail: userEmail || undefined,
          platform,
          hwid,
          deviceName: input.deviceName,
        }
      : {
          activationKey: key,
          confirmCompanyName: decodedCompany || undefined,
          userEmail: userEmail || undefined,
          platform,
          hwid,
          deviceName: input.deviceName,
        },
    opts
  );

  return {
    ...localResult,
    verifiedOnline,
    resolvedServerUrl: targetBase,
  };
}

/**
 * Best-effort background seat registration after an offline `.uas` activation on Android.
 * Never throws or blocks offline activation.
 */
export async function syncOfflineSeatInBackground(
  license: UasSignedLicense,
  input: {
    companyName?: string;
    userEmail?: string;
    platform?: SeatPlatform;
    hwid?: string;
    serverBaseUrl?: string;
  },
  fetchImpl?: typeof fetch
): Promise<boolean> {
  const fn = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fn) return false;
  const base = (input.serverBaseUrl || "https://qat.world").replace(/\/+$/, "");
  try {
    const keyToken = `UASKEY-${encodeUtf8Base64(JSON.stringify(license))}`;
    const res = await fn(`${base}/api/licensing/verify-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: keyToken,
        company_name: input.companyName || license.company_name || license.customer_name,
        user_email: input.userEmail || undefined,
        platform: input.platform || detectClientPlatform(),
        hwid: input.hwid || getClientDeviceHwid(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

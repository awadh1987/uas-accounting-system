export type RuntimeMode = "local" | "lan" | "cloud";

export type SeatPlatform = "windows" | "android";

export interface PerUserDevices {
  windows: number;
  android: number;
}

/** Default seat policy for company-locked licenses: 7 users × (1 Windows + 1 Android). */
export const DEFAULT_MAX_USERS = 7;
export const DEFAULT_PER_USER_DEVICES: PerUserDevices = { windows: 1, android: 1 };

export interface UasLicensePayload {
  license_id: string;
  customer_name: string;
  /**
   * Hardware binding. One of:
   *  - a single HWID / request code
   *  - comma-separated list of HWIDs
   *  - "*" → company-wide, seat-managed license (devices are bound via LicenseDeviceBinding)
   */
  hwid: string;
  allowed_modes: RuntimeMode[];
  max_branches: number;
  max_lan_seats: number;
  expires_at: string;
  issued_at: string;
  /**
   * Company-locked (v2) fields. When `company_name` is present the license is a v2 license and
   * ALL three fields are covered by the Ed25519 signature. Legacy (v1) licenses omit them and keep
   * their original canonical form so previously issued licenses continue to verify.
   */
  company_name?: string;
  max_users?: number;
  per_user_devices?: PerUserDevices;
}

export interface UasSignedLicense extends UasLicensePayload {
  signature: string;
}

export interface LicenseSeatPolicy {
  /** true when the license carries a signed company_name (v2). */
  companyLocked: boolean;
  companyName: string | null;
  maxUsers: number;
  perUserDevices: PerUserDevices;
  /** true when hwid === "*" (devices managed through seat bindings). */
  seatManaged: boolean;
}

// ---------------------------------------------------------------------------
// Company-name normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes an organization name for lock comparison:
 *  - trims & collapses whitespace
 *  - lowercases Latin characters
 *  - Arabic variants: أ / إ / آ → ا, ة → ه, ى → ي
 *  - strips invisible bidi/zero-width marks, tatweel and Arabic diacritics (copy-paste noise)
 */
export function normalizeCompanyName(name: string): string {
  if (typeof name !== "string") return "";
  return name
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "") // zero-width / bidi marks
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // harakat, dagger alef, tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function companyNamesMatch(a: string, b: string): boolean {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  return na.length > 0 && na === nb;
}

// ---------------------------------------------------------------------------
// HWID target parsing ("*", comma-separated, single)
// ---------------------------------------------------------------------------

export interface HwidTargets {
  /** true when the license is company-wide ("*"). */
  wildcard: boolean;
  /** Upper-cased, trimmed individual targets (empty when wildcard). */
  targets: string[];
}

export function parseHwidTargets(hwid: string): HwidTargets {
  const parts = String(hwid ?? "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p.length > 0);
  if (parts.includes("*")) return { wildcard: true, targets: [] };
  return { wildcard: false, targets: parts };
}

export function isWildcardHwid(hwid: string): boolean {
  return parseHwidTargets(hwid).wildcard;
}

// ---------------------------------------------------------------------------
// Canonicalization & validation
// ---------------------------------------------------------------------------

export function isCompanyLockedPayload(payload: Pick<UasLicensePayload, "company_name">): boolean {
  return typeof payload.company_name === "string";
}

function resolveMaxUsers(value: unknown): number {
  const n = Number(value ?? DEFAULT_MAX_USERS);
  return Number.isFinite(n) ? n : DEFAULT_MAX_USERS;
}

function resolvePerUser(value: Partial<PerUserDevices> | undefined): PerUserDevices {
  return {
    android: Number(value?.android ?? DEFAULT_PER_USER_DEVICES.android),
    windows: Number(value?.windows ?? DEFAULT_PER_USER_DEVICES.windows),
  };
}

export function canonicalizeLicensePayload(payload: UasLicensePayload): string {
  const base: Record<string, unknown> = {
    allowed_modes: [...(payload.allowed_modes || [])].sort(),
    customer_name: (payload.customer_name || "").trim(),
    expires_at: (payload.expires_at || "").trim(),
    hwid: (payload.hwid || "").trim().toUpperCase(),
    issued_at: (payload.issued_at || "").trim(),
    license_id: (payload.license_id || "").trim().toUpperCase(),
    max_branches: Number(payload.max_branches ?? 1),
    max_lan_seats: Number(payload.max_lan_seats ?? 1),
  };

  // Legacy (v1) licenses keep the exact original canonical form.
  if (!isCompanyLockedPayload(payload)) {
    return JSON.stringify(base);
  }

  // v2: company-locked multi-seat payload. Keys are emitted in alphabetical order.
  const { wildcard, targets } = parseHwidTargets(payload.hwid);
  const sorted: Record<string, unknown> = {
    allowed_modes: base.allowed_modes,
    company_name: (payload.company_name || "").trim(),
    customer_name: base.customer_name,
    expires_at: base.expires_at,
    hwid: wildcard ? "*" : targets.join(","),
    issued_at: base.issued_at,
    license_id: base.license_id,
    max_branches: base.max_branches,
    max_lan_seats: base.max_lan_seats,
    max_users: resolveMaxUsers(payload.max_users),
    per_user_devices: resolvePerUser(payload.per_user_devices),
  };
  return JSON.stringify(sorted);
}

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export function validateLicenseStructure(obj: unknown): UasSignedLicense | null {
  if (!obj || typeof obj !== "object") return null;
  const item = obj as Record<string, unknown>;

  if (
    typeof item.license_id !== "string" ||
    typeof item.customer_name !== "string" ||
    typeof item.hwid !== "string" ||
    !Array.isArray(item.allowed_modes) ||
    typeof item.expires_at !== "string" ||
    typeof item.issued_at !== "string" ||
    typeof item.signature !== "string"
  ) {
    return null;
  }

  const allowed_modes: RuntimeMode[] = [];
  for (const m of item.allowed_modes) {
    if (m === "local" || m === "lan" || m === "cloud") {
      allowed_modes.push(m);
    }
  }

  if (allowed_modes.length === 0) return null;

  const result: UasSignedLicense = {
    license_id: item.license_id,
    customer_name: item.customer_name,
    hwid: item.hwid.toUpperCase(),
    allowed_modes,
    max_branches: Number(item.max_branches || 1),
    max_lan_seats: Number(item.max_lan_seats || 1),
    expires_at: item.expires_at,
    issued_at: item.issued_at,
    signature: item.signature,
  };

  // v2 company-locked fields (all-or-nothing, strictly validated)
  if (item.company_name !== undefined) {
    if (typeof item.company_name !== "string" || item.company_name.trim().length === 0) return null;

    const maxUsers = resolveMaxUsers(item.max_users);
    if (!Number.isInteger(maxUsers) || maxUsers < 1) return null;

    const rawPer = item.per_user_devices;
    if (rawPer !== undefined && (typeof rawPer !== "object" || rawPer === null)) return null;
    const perUser = resolvePerUser(rawPer as Partial<PerUserDevices> | undefined);
    if (!isNonNegativeInt(perUser.windows) || !isNonNegativeInt(perUser.android)) return null;
    if (perUser.windows + perUser.android < 1) return null;

    result.company_name = item.company_name;
    result.max_users = maxUsers;
    result.per_user_devices = perUser;
  }

  return result;
}

/** Effective seat policy of a license (defaults applied for legacy licenses). */
export function getLicenseSeatPolicy(license: UasLicensePayload): LicenseSeatPolicy {
  const companyLocked = isCompanyLockedPayload(license);
  return {
    companyLocked,
    companyName: companyLocked ? (license.company_name as string).trim() : null,
    maxUsers: resolveMaxUsers(license.max_users),
    perUserDevices: resolvePerUser(license.per_user_devices),
    seatManaged: isWildcardHwid(license.hwid),
  };
}

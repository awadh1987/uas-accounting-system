/**
 * Shared seat-binding service — the SINGLE implementation of the company-license seat rules:
 *
 *   • at most `maxUsers` distinct ACTIVE users per license (default 7)
 *   • at most `perUserDevices.windows` / `.android` active device(s) per user (default 1 + 1)
 *   • re-activating the same (userEmail, platform, hwid) refreshes `lastSeenAt` and succeeds
 *   • releasing a seat frees the slot
 *
 * It is storage-agnostic (SeatStore) so the exact same rules run in:
 *   - local / LAN SQLite  (Prisma `LicenseDeviceBinding`)      → prismaSeatStore.ts
 *   - the qat.world cloud authority (`/api/licensing/verify-key`) → prismaSeatStore.ts
 *   - the Capacitor Android app when offline (localStorage)     → seatClient.ts
 *   - unit tests (in-memory)                                    → MemorySeatStore below
 *
 * No Node-only imports — safe for the browser / static Capacitor bundle.
 */
import type { PerUserDevices, SeatPlatform } from "./licenseSchema";
import { DEFAULT_MAX_USERS, DEFAULT_PER_USER_DEVICES } from "./licenseSchema";

export const SEAT_PLATFORMS: readonly SeatPlatform[] = ["windows", "android"] as const;

export interface SeatBindingRecord {
  id?: string;
  licenseId: string;
  userEmail: string;
  platform: SeatPlatform;
  hwid: string;
  deviceName: string;
  activatedAt: Date;
  lastSeenAt: Date;
  active: boolean;
}

export interface SeatStore {
  /** All rows (active and released) for a license. */
  list(licenseId: string): Promise<SeatBindingRecord[]>;
  /** Insert or update the row identified by (licenseId, userEmail, platform). */
  upsert(record: SeatBindingRecord): Promise<SeatBindingRecord>;
  /** Mark rows active/inactive. Returns the number of rows changed. */
  setActive(licenseId: string, userEmail: string, platform: SeatPlatform | "all", active: boolean): Promise<number>;
  /** Optional: run `fn` atomically (serializes concurrent binds). */
  transaction?<T>(fn: (store: SeatStore) => Promise<T>): Promise<T>;
}

export interface SeatPolicy {
  maxUsers: number;
  perUserDevices: PerUserDevices;
}

export interface SeatSlot {
  hwid: string;
  deviceName: string;
  activatedAt: string;
  lastSeenAt: string;
}

export interface SeatUserUsage {
  userEmail: string;
  windows: SeatSlot | null;
  android: SeatSlot | null;
}

export interface SeatUsage {
  licenseId: string;
  usedUsers: number;
  maxUsers: number;
  perUserDevices: PerUserDevices;
  windowsBound: number;
  androidBound: number;
  users: SeatUserUsage[];
}

export type SeatErrorCode =
  | "INVALID_REQUEST"
  | "PLATFORM_NOT_ALLOWED"
  | "MAX_USERS_REACHED"
  | "DEVICE_LIMIT_REACHED";

export type SeatBindResult =
  | {
      ok: true;
      status: "CREATED" | "REFRESHED" | "REBOUND";
      binding: SeatBindingRecord;
      usage: SeatUsage;
    }
  | {
      ok: false;
      code: SeatErrorCode;
      error: string;
      usage?: SeatUsage;
    };

export interface SeatBindRequest {
  licenseId: string;
  userEmail: string;
  platform: string;
  hwid: string;
  deviceName?: string;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeUserEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

export function normalizePlatform(platform: string): SeatPlatform | null {
  const p = String(platform ?? "").trim().toLowerCase();
  return p === "windows" || p === "android" ? p : null;
}

export function normalizeSeatHwid(hwid: string): string {
  return String(hwid ?? "").trim().toUpperCase();
}

export function seatPolicyFromLicense(license: {
  max_users?: number;
  per_user_devices?: Partial<PerUserDevices>;
}): SeatPolicy {
  return {
    maxUsers: Number.isFinite(Number(license.max_users)) && Number(license.max_users) >= 1
      ? Number(license.max_users)
      : DEFAULT_MAX_USERS,
    perUserDevices: {
      windows: Number(license.per_user_devices?.windows ?? DEFAULT_PER_USER_DEVICES.windows),
      android: Number(license.per_user_devices?.android ?? DEFAULT_PER_USER_DEVICES.android),
    },
  };
}

const PLATFORM_LABEL: Record<SeatPlatform, { ar: string; en: string }> = {
  windows: { ar: "ويندوز", en: "Windows" },
  android: { ar: "أندرويد", en: "Android" },
};

export function seatErrorMessage(code: SeatErrorCode, ctx: { maxUsers?: number; platform?: SeatPlatform } = {}): string {
  const label = ctx.platform ? PLATFORM_LABEL[ctx.platform] : { ar: "", en: "" };
  switch (code) {
    case "MAX_USERS_REACHED":
      return `تم الوصول للحد الأقصى لعدد المستخدمين المرخّصين (${ctx.maxUsers}). يرجى إلغاء ربط مستخدم آخر أولاً. / Maximum licensed users (${ctx.maxUsers}) reached. Release another user's seat first.`;
    case "DEVICE_LIMIT_REACHED":
      return `لدى هذا المستخدم جهاز ${label.ar} مربوط بالفعل. يرجى إلغاء ربط الجهاز القديم أولاً. / This user already has a bound ${label.en} device. Release the old device first.`;
    case "PLATFORM_NOT_ALLOWED":
      return `هذا الترخيص لا يتضمن أجهزة ${label.ar}. / This license does not include ${label.en} devices.`;
    default:
      return "طلب ربط الجهاز غير صالح (البريد الإلكتروني أو المنصة أو معرّف الجهاز). / Invalid seat request (email, platform or device id).";
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function toSlot(r: SeatBindingRecord): SeatSlot {
  return {
    hwid: r.hwid,
    deviceName: r.deviceName,
    activatedAt: r.activatedAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}

export function computeSeatUsage(licenseId: string, rows: SeatBindingRecord[], policy: SeatPolicy): SeatUsage {
  const byUser = new Map<string, SeatUserUsage>();
  let windowsBound = 0;
  let androidBound = 0;
  for (const r of rows) {
    if (!r.active) continue;
    let u = byUser.get(r.userEmail);
    if (!u) {
      u = { userEmail: r.userEmail, windows: null, android: null };
      byUser.set(r.userEmail, u);
    }
    u[r.platform] = toSlot(r);
    if (r.platform === "windows") windowsBound++;
    else androidBound++;
  }
  const users = [...byUser.values()].sort((a, b) => a.userEmail.localeCompare(b.userEmail));
  return {
    licenseId,
    usedUsers: users.length,
    maxUsers: policy.maxUsers,
    perUserDevices: policy.perUserDevices,
    windowsBound,
    androidBound,
    users,
  };
}

export async function getSeatUsage(store: SeatStore, licenseId: string, policy: SeatPolicy): Promise<SeatUsage> {
  return computeSeatUsage(licenseId, await store.list(licenseId), policy);
}

/** Strips device identifiers / emails — safe to show to non-admin callers. */
export function summarizeSeatUsage(usage: SeatUsage): Omit<SeatUsage, "users"> {
  const { users: _users, ...rest } = usage;
  void _users;
  return rest;
}

// ---------------------------------------------------------------------------
// Bind / release
// ---------------------------------------------------------------------------

async function bindSeatCore(
  store: SeatStore,
  policy: SeatPolicy,
  req: SeatBindRequest,
  now: Date
): Promise<SeatBindResult> {
  const licenseId = String(req.licenseId ?? "").trim().toUpperCase();
  const userEmail = normalizeUserEmail(req.userEmail);
  const platform = normalizePlatform(req.platform);
  const hwid = normalizeSeatHwid(req.hwid);

  if (!licenseId || !userEmail || userEmail.length > 254 || !platform || !hwid) {
    return { ok: false, code: "INVALID_REQUEST", error: seatErrorMessage("INVALID_REQUEST") };
  }

  const rows = await store.list(licenseId);
  const usage = computeSeatUsage(licenseId, rows, policy);

  const limit = policy.perUserDevices[platform];
  if (limit < 1) {
    return {
      ok: false,
      code: "PLATFORM_NOT_ALLOWED",
      error: seatErrorMessage("PLATFORM_NOT_ALLOWED", { platform }),
      usage,
    };
  }

  const userRows = rows.filter((r) => r.userEmail === userEmail);
  const sameSlot = userRows.find((r) => r.platform === platform);
  const userIsActive = userRows.some((r) => r.active);

  // 1) Same (user, platform, hwid) already active → refresh and succeed.
  if (sameSlot && sameSlot.active && sameSlot.hwid === hwid) {
    const updated = await store.upsert({
      ...sameSlot,
      deviceName: req.deviceName?.trim() || sameSlot.deviceName,
      lastSeenAt: now,
    });
    return { ok: true, status: "REFRESHED", binding: updated, usage: await getSeatUsage(store, licenseId, policy) };
  }

  // 2) The user already holds an ACTIVE device on this platform with a different HWID → device limit.
  if (sameSlot && sameSlot.active && sameSlot.hwid !== hwid) {
    return {
      ok: false,
      code: "DEVICE_LIMIT_REACHED",
      error: seatErrorMessage("DEVICE_LIMIT_REACHED", { platform }),
      usage,
    };
  }

  // 3) A brand-new active user must fit under max_users.
  if (!userIsActive && usage.usedUsers >= policy.maxUsers) {
    return {
      ok: false,
      code: "MAX_USERS_REACHED",
      error: seatErrorMessage("MAX_USERS_REACHED", { maxUsers: policy.maxUsers }),
      usage,
    };
  }

  // 4) Create the seat, or re-activate a previously released slot (possibly on a new device).
  const record: SeatBindingRecord = {
    id: sameSlot?.id,
    licenseId,
    userEmail,
    platform,
    hwid,
    deviceName: req.deviceName?.trim() || sameSlot?.deviceName || "",
    activatedAt: now,
    lastSeenAt: now,
    active: true,
  };
  const saved = await store.upsert(record);
  return {
    ok: true,
    status: sameSlot ? "REBOUND" : "CREATED",
    binding: saved,
    usage: await getSeatUsage(store, licenseId, policy),
  };
}

export async function bindSeat(
  store: SeatStore,
  policy: SeatPolicy,
  req: SeatBindRequest,
  now: Date = new Date()
): Promise<SeatBindResult> {
  if (store.transaction) {
    return store.transaction((tx) => bindSeatCore(tx, policy, req, now));
  }
  return bindSeatCore(store, policy, req, now);
}

export interface SeatReleaseResult {
  released: number;
  usage: SeatUsage;
}

/** Frees one platform slot of a user (or both with platform "all"). Idempotent. */
export async function releaseSeat(
  store: SeatStore,
  policy: SeatPolicy,
  licenseId: string,
  userEmail: string,
  platform: SeatPlatform | "all" = "all"
): Promise<SeatReleaseResult> {
  const id = String(licenseId ?? "").trim().toUpperCase();
  const email = normalizeUserEmail(userEmail);
  const released = await store.setActive(id, email, platform, false);
  return { released, usage: await getSeatUsage(store, id, policy) };
}

// ---------------------------------------------------------------------------
// In-memory store (unit tests / reference implementation)
// ---------------------------------------------------------------------------

export class MemorySeatStore implements SeatStore {
  protected rows = new Map<string, SeatBindingRecord>();
  private chain: Promise<unknown> = Promise.resolve();

  private key(r: { licenseId: string; userEmail: string; platform: string }): string {
    return `${r.licenseId}|${r.userEmail}|${r.platform}`;
  }

  async list(licenseId: string): Promise<SeatBindingRecord[]> {
    return [...this.rows.values()].filter((r) => r.licenseId === licenseId).map((r) => ({ ...r }));
  }

  async upsert(record: SeatBindingRecord): Promise<SeatBindingRecord> {
    const saved = { ...record, id: record.id ?? `mem-${this.rows.size + 1}-${Math.random().toString(36).slice(2, 8)}` };
    this.rows.set(this.key(saved), saved);
    return { ...saved };
  }

  async setActive(licenseId: string, userEmail: string, platform: SeatPlatform | "all", active: boolean): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.licenseId !== licenseId || r.userEmail !== userEmail) continue;
      if (platform !== "all" && r.platform !== platform) continue;
      if (r.active !== active) {
        r.active = active;
        n++;
      }
    }
    return n;
  }

  /** Serializes concurrent binds so the quota cannot be raced. */
  transaction<T>(fn: (store: SeatStore) => Promise<T>): Promise<T> {
    const run = this.chain.then(() => fn(this));
    this.chain = run.catch(() => undefined);
    return run;
  }

  snapshot(): SeatBindingRecord[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

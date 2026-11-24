import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveLicenseDataDirectory } from "@/lib/licensing/verifier";
import { normalizeTenantId } from "@/lib/tenant/tenantContext";

export type LicenseGovernanceStatus = "active" | "suspended" | "revoked" | "expired";

export interface TenantGovernanceRecord {
  slug: string;
  status: LicenseGovernanceStatus;
  reason?: string;
  licenseId?: string | null;
  expiresAtOverride?: string | null;
  maxSeatsOverride?: number | null;
  planOverride?: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface RotatedKeyRecord {
  licenseId: string;
  slug: string;
  rotatedAt: string;
  graceUntil: string | null;
  immediatelyRevoked: boolean;
  replacedByLicenseId: string;
  actorEmail: string;
  reason?: string;
}

export interface UserSessionRevocationRecord {
  tenantId: string;
  userId: string;
  revokedBeforeMs: number;
  blockSignIn: boolean;
  reason?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DeviceSessionRevocationRecord {
  tenantId: string;
  deviceId: string;
  revokedBeforeMs: number;
  reason?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ControlPanelAuditEntry {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorRole: string;
  actionType: string;
  targetTenantSlug: string | null;
  targetEntityType: "TENANT" | "LICENSE" | "DEVICE" | "USER";
  targetEntityId: string;
  details: string;
  metadata?: Record<string, unknown>;
}

interface GovernanceStateFile {
  version: 1;
  tenants: Record<string, TenantGovernanceRecord>;
  rotatedKeys: RotatedKeyRecord[];
  userSessionRevocations: Record<string, UserSessionRevocationRecord>;
  deviceSessionRevocations: Record<string, DeviceSessionRevocationRecord>;
  auditLogs: ControlPanelAuditEntry[];
}

const MAX_AUDIT_ENTRIES = 1000;

let cachedState: GovernanceStateFile | null = null;
let cachedFilePath = "";
let cachedMtimeMs = -1;

function createEmptyState(): GovernanceStateFile {
  return {
    version: 1,
    tenants: {},
    rotatedKeys: [],
    userSessionRevocations: {},
    deviceSessionRevocations: {},
    auditLogs: [],
  };
}

export function getGovernanceFilePath(): string {
  const dataDir = resolveLicenseDataDirectory();
  return path.resolve(/*turbopackIgnore: true*/ dataDir, "control-panel", "governance.json");
}

function loadState(): GovernanceStateFile {
  const filePath = getGovernanceFilePath();
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      const mtimeMs = fs.statSync(/*turbopackIgnore: true*/ filePath).mtimeMs;
      if (cachedState && cachedFilePath === filePath && cachedMtimeMs === mtimeMs) {
        return cachedState;
      }
      const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<GovernanceStateFile>;
      cachedState = {
        version: 1,
        tenants: parsed.tenants && typeof parsed.tenants === "object" ? parsed.tenants : {},
        rotatedKeys: Array.isArray(parsed.rotatedKeys) ? parsed.rotatedKeys : [],
        userSessionRevocations:
          parsed.userSessionRevocations && typeof parsed.userSessionRevocations === "object"
            ? parsed.userSessionRevocations
            : {},
        deviceSessionRevocations:
          parsed.deviceSessionRevocations && typeof parsed.deviceSessionRevocations === "object"
            ? parsed.deviceSessionRevocations
            : {},
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
      };
      cachedFilePath = filePath;
      cachedMtimeMs = mtimeMs;
      return cachedState;
    }
  } catch (err) {
    console.warn("[GovernanceStore] Notice loading governance state:", err);
  }
  cachedState = createEmptyState();
  cachedFilePath = filePath;
  cachedMtimeMs = -1;
  return cachedState;
}

function saveState(state: GovernanceStateFile): void {
  const filePath = getGovernanceFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }
  const serialized = JSON.stringify(state, null, 2);
  fs.writeFileSync(/*turbopackIgnore: true*/ filePath, serialized, "utf8");
  cachedState = state;
  cachedFilePath = filePath;
  try {
    cachedMtimeMs = fs.statSync(/*turbopackIgnore: true*/ filePath).mtimeMs;
  } catch {
    cachedMtimeMs = -1;
  }

  // Mirror to .next/standalone/data/control-panel/governance.json when running without explicit UAS_DATA_DIR
  if (!(process.env.UAS_DATA_DIR || "").trim()) {
    try {
      const projectRoot = path.resolve(dir, "..", "..");
      const standalonePath = path.join(
        /*turbopackIgnore: true*/ projectRoot,
        ".next",
        "standalone",
        "data",
        "control-panel",
        "governance.json"
      );
      if (
        fs.existsSync(path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone")) &&
        path.resolve(standalonePath) !== path.resolve(filePath)
      ) {
        fs.mkdirSync(path.dirname(standalonePath), { recursive: true });
        fs.writeFileSync(/*turbopackIgnore: true*/ standalonePath, serialized, "utf8");
      }
    } catch {
      // Non-fatal mirror
    }
  }
}

export function resetGovernanceStoreCacheForTests(): void {
  cachedState = null;
  cachedFilePath = "";
  cachedMtimeMs = -1;
}

function normalizeSlugKey(slugOrId: string): string {
  return String(slugOrId || "").trim().toLowerCase().replace(/_/g, "-");
}

export function getTenantGovernanceRecord(slugOrId: string): TenantGovernanceRecord | null {
  const state = loadState();
  const key = normalizeSlugKey(slugOrId);
  if (!key) return null;
  return state.tenants[key] || state.tenants[normalizeTenantId(slugOrId)] || null;
}

export function setTenantGovernanceRecord(
  slug: string,
  patch: Partial<Omit<TenantGovernanceRecord, "slug">> & {
    status: LicenseGovernanceStatus;
    updatedBy: string;
  }
): TenantGovernanceRecord {
  const state = loadState();
  const key = normalizeSlugKey(slug);
  const existing = state.tenants[key];
  const record: TenantGovernanceRecord = {
    slug: key,
    status: patch.status,
    reason: patch.reason !== undefined ? patch.reason : existing?.reason,
    licenseId: patch.licenseId !== undefined ? patch.licenseId : existing?.licenseId,
    expiresAtOverride:
      patch.expiresAtOverride !== undefined
        ? patch.expiresAtOverride
        : existing?.expiresAtOverride,
    maxSeatsOverride:
      patch.maxSeatsOverride !== undefined
        ? patch.maxSeatsOverride
        : existing?.maxSeatsOverride,
    planOverride:
      patch.planOverride !== undefined ? patch.planOverride : existing?.planOverride,
    updatedAt: new Date().toISOString(),
    updatedBy: patch.updatedBy,
  };
  state.tenants[key] = record;
  saveState(state);
  return record;
}

export function recordRotatedLicenseKey(entry: RotatedKeyRecord): void {
  const state = loadState();
  const cleanId = entry.licenseId.trim().toUpperCase();
  const filtered = state.rotatedKeys.filter(
    (k) => !(k.licenseId.toUpperCase() === cleanId && normalizeSlugKey(k.slug) === normalizeSlugKey(entry.slug))
  );
  filtered.unshift({
    ...entry,
    licenseId: cleanId,
    slug: normalizeSlugKey(entry.slug),
  });
  state.rotatedKeys = filtered;
  saveState(state);
}

export function listRotatedLicenseKeys(slug?: string): RotatedKeyRecord[] {
  const state = loadState();
  if (!slug) return [...state.rotatedKeys];
  const key = normalizeSlugKey(slug);
  return state.rotatedKeys.filter((k) => normalizeSlugKey(k.slug) === key);
}

export interface LicenseGovernanceEvaluation {
  allowed: boolean;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED";
  code?: string;
  error?: string;
  record?: TenantGovernanceRecord | null;
}

export function evaluateLicenseGovernance(input: {
  licenseId?: string | null;
  slug?: string | null;
  registryStatus?: string | null;
  expiresAt?: string | null;
  now?: Date;
}): LicenseGovernanceEvaluation {
  const state = loadState();
  const now = input.now ?? new Date();
  const cleanLicId = input.licenseId ? input.licenseId.trim().toUpperCase() : "";
  const slugKey = input.slug ? normalizeSlugKey(input.slug) : "";

  // 1. Check rotated / superseded keys
  if (cleanLicId) {
    const rotated = state.rotatedKeys.find((r) => r.licenseId.toUpperCase() === cleanLicId);
    if (rotated) {
      const graceExpired =
        rotated.immediatelyRevoked ||
        !rotated.graceUntil ||
        Number.isNaN(Date.parse(rotated.graceUntil)) ||
        now.getTime() > Date.parse(rotated.graceUntil);
      if (graceExpired) {
        return {
          allowed: false,
          status: "REVOKED",
          code: "LICENSE_ROTATED_REVOKED",
          error:
            "تم تدوير وإلغاء مفتاح الترخيص السابق واستبداله بمفتاح أحدث. يرجى استخدام المفتاح الجديد / Prior license key was rotated and revoked. Use the newly issued key.",
        };
      }
    }
  }

  // 2. Check explicit tenant governance override
  const govRecord = slugKey ? getTenantGovernanceRecord(slugKey) : null;
  if (govRecord) {
    if (govRecord.status === "suspended") {
      return {
        allowed: false,
        status: "SUSPENDED",
        code: "LICENSE_SUSPENDED",
        error: govRecord.reason
          ? `تم تعليق ترخيص المنشأة مؤقتاً: ${govRecord.reason} / License suspended: ${govRecord.reason}`
          : "تم تعليق ترخيص المنشأة مؤقتاً من لوحة تحكم المنصة / Tenant license is suspended by platform owner.",
        record: govRecord,
      };
    }
    if (govRecord.status === "revoked") {
      return {
        allowed: false,
        status: "REVOKED",
        code: "LICENSE_REVOKED",
        error: govRecord.reason
          ? `تم إلغاء ترخيص المنشأة نهائياً: ${govRecord.reason} / License revoked: ${govRecord.reason}`
          : "تم إلغاء ترخيص المنشأة من لوحة تحكم المنصة / Tenant license has been revoked by platform owner.",
        record: govRecord,
      };
    }
    if (govRecord.status === "expired") {
      return {
        allowed: false,
        status: "EXPIRED",
        code: "LICENSE_EXPIRED",
        error: "انتهت صلاحية ترخيص المنشأة / Tenant license marked expired by platform owner.",
        record: govRecord,
      };
    }
  }

  // 3. Check registry status fallback
  const regStatus = String(input.registryStatus || "").trim().toUpperCase();
  if (regStatus === "SUSPENDED") {
    return {
      allowed: false,
      status: "SUSPENDED",
      code: "LICENSE_SUSPENDED",
      error: "تم تعليق ترخيص المنشأة مؤقتاً / Tenant license is suspended.",
      record: govRecord,
    };
  }
  if (regStatus === "REVOKED" || regStatus === "ARCHIVED") {
    return {
      allowed: false,
      status: "REVOKED",
      code: "LICENSE_REVOKED",
      error: "تم إلغاء ترخيص المنشأة / Tenant license is revoked.",
      record: govRecord,
    };
  }
  if (regStatus === "EXPIRED") {
    return {
      allowed: false,
      status: "EXPIRED",
      code: "LICENSE_EXPIRED",
      error: "انتهت صلاحية ترخيص المنشأة / Tenant license has expired.",
      record: govRecord,
    };
  }

  // 4. Check effective expiration
  const effectiveExpiry = govRecord?.expiresAtOverride || input.expiresAt;
  if (effectiveExpiry) {
    const expMs = Date.parse(effectiveExpiry);
    if (!Number.isNaN(expMs) && now.getTime() > expMs) {
      return {
        allowed: false,
        status: "EXPIRED",
        code: "LICENSE_EXPIRED",
        error: "انتهت صلاحية هذا الترخيص، يرجى التجديد / License has expired.",
        record: govRecord,
      };
    }
  }

  return {
    allowed: true,
    status: "ACTIVE",
    record: govRecord,
  };
}

function makeUserRevocationKey(tenantId: string, userId: string): string {
  return `${normalizeTenantId(tenantId)}::${String(userId || "").trim()}`;
}

export function recordUserSessionRevocation(
  tenantId: string,
  userId: string,
  opts: {
    revokedBeforeMs?: number;
    blockSignIn: boolean;
    reason?: string;
    updatedBy: string;
  }
): UserSessionRevocationRecord {
  const state = loadState();
  const key = makeUserRevocationKey(tenantId, userId);
  const existing = state.userSessionRevocations[key];
  const next: UserSessionRevocationRecord = {
    tenantId: normalizeTenantId(tenantId),
    userId: String(userId).trim(),
    revokedBeforeMs: opts.revokedBeforeMs ?? Date.now(),
    blockSignIn: opts.blockSignIn,
    reason: opts.reason !== undefined ? opts.reason : existing?.reason,
    updatedAt: new Date().toISOString(),
    updatedBy: opts.updatedBy,
  };
  state.userSessionRevocations[key] = next;
  saveState(state);
  return next;
}

export function getUserSessionRevocation(
  tenantId: string,
  userId: string
): UserSessionRevocationRecord | null {
  const state = loadState();
  return state.userSessionRevocations[makeUserRevocationKey(tenantId, userId)] || null;
}

export function isUserSessionRevoked(
  tenantId: string,
  userId: string,
  tokenIatMs?: number | null
): boolean {
  const rec = getUserSessionRevocation(tenantId, userId);
  if (!rec) return false;
  if (rec.blockSignIn) return true;
  if (typeof tokenIatMs === "number" && tokenIatMs <= rec.revokedBeforeMs) {
    return true;
  }
  return false;
}

export function clearUserSignInBlock(
  tenantId: string,
  userId: string,
  updatedBy: string
): UserSessionRevocationRecord | null {
  const state = loadState();
  const key = makeUserRevocationKey(tenantId, userId);
  const existing = state.userSessionRevocations[key];
  if (!existing) return null;
  const next: UserSessionRevocationRecord = {
    ...existing,
    blockSignIn: false,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  state.userSessionRevocations[key] = next;
  saveState(state);
  return next;
}

function makeDeviceRevocationKey(tenantId: string, deviceId: string): string {
  return `${normalizeTenantId(tenantId)}::${String(deviceId || "").trim().toLowerCase()}`;
}

export function recordDeviceSessionRevocation(
  tenantId: string,
  deviceId: string,
  opts: {
    revokedBeforeMs?: number;
    reason?: string;
    updatedBy: string;
  }
): DeviceSessionRevocationRecord {
  const state = loadState();
  const key = makeDeviceRevocationKey(tenantId, deviceId);
  const next: DeviceSessionRevocationRecord = {
    tenantId: normalizeTenantId(tenantId),
    deviceId: String(deviceId).trim(),
    revokedBeforeMs: opts.revokedBeforeMs ?? Date.now(),
    reason: opts.reason,
    updatedAt: new Date().toISOString(),
    updatedBy: opts.updatedBy,
  };
  state.deviceSessionRevocations[key] = next;
  saveState(state);
  return next;
}

export function isDeviceSessionRevoked(
  tenantId: string,
  deviceId: string,
  tokenIatMs?: number | null
): boolean {
  const state = loadState();
  const rec = state.deviceSessionRevocations?.[makeDeviceRevocationKey(tenantId, deviceId)];
  if (!rec) return false;
  if (typeof tokenIatMs === "number" && tokenIatMs <= rec.revokedBeforeMs) {
    return true;
  }
  return false;
}

export function clearDeviceSessionRevocation(tenantId: string, deviceId: string): void {
  const state = loadState();
  const key = makeDeviceRevocationKey(tenantId, deviceId);
  if (state.deviceSessionRevocations && state.deviceSessionRevocations[key]) {
    delete state.deviceSessionRevocations[key];
    saveState(state);
  }
}

export function appendControlPanelAudit(
  entry: Omit<ControlPanelAuditEntry, "id" | "timestamp"> & { timestamp?: string }
): ControlPanelAuditEntry {
  const state = loadState();
  const record: ControlPanelAuditEntry = {
    id: `cpa_${crypto.randomBytes(8).toString("hex")}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    actionType: entry.actionType,
    targetTenantSlug: entry.targetTenantSlug,
    targetEntityType: entry.targetEntityType,
    targetEntityId: entry.targetEntityId,
    details: entry.details,
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  };
  state.auditLogs.unshift(record);
  if (state.auditLogs.length > MAX_AUDIT_ENTRIES) {
    state.auditLogs.length = MAX_AUDIT_ENTRIES;
  }
  saveState(state);
  return record;
}

export function listControlPanelAudits(filters?: {
  slug?: string;
  entityType?: string;
  search?: string;
  limit?: number;
}): ControlPanelAuditEntry[] {
  const state = loadState();
  let items = [...state.auditLogs];
  if (filters?.slug) {
    const slugKey = normalizeSlugKey(filters.slug);
    items = items.filter(
      (a) => a.targetTenantSlug && normalizeSlugKey(a.targetTenantSlug) === slugKey
    );
  }
  if (filters?.entityType && filters.entityType !== "ALL") {
    items = items.filter((a) => a.targetEntityType === filters.entityType);
  }
  if (filters?.search) {
    const q = filters.search.trim().toLowerCase();
    items = items.filter(
      (a) =>
        a.actionType.toLowerCase().includes(q) ||
        a.details.toLowerCase().includes(q) ||
        (a.targetTenantSlug || "").toLowerCase().includes(q) ||
        a.targetEntityId.toLowerCase().includes(q) ||
        a.actorEmail.toLowerCase().includes(q)
    );
  }
  const limit = Math.min(500, Math.max(1, filters?.limit ?? 150));
  return items.slice(0, limit);
}

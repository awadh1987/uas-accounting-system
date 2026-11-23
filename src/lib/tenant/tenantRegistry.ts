import fs from "node:fs";
import path from "node:path";
import { normalizeTenantId } from "./tenantContext";
import { buildTenantWorkspaceUrl, generateTenantSlug } from "./tenantSlug";

export interface TenantMetadata {
  tenantId: string;
  slug: string;
  companyName: string;
  nameAr?: string;
  nameEn?: string;
  tenantUrl?: string;
  licenseId?: string;
  plan?: string;
  postgresDb?: string;
  sqliteDbPath?: string;
  allowedModes?: ("local" | "lan" | "cloud")[];
  schemaOrDb: string;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED" | "EXPIRED" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  maxSeats?: number;
}

const inMemoryRegistry = new Map<string, TenantMetadata>();
let isRegistryInitialized = false;
let lastLoadedMtimeMs = -1;

function createDefaultTenantMetadata(): TenantMetadata {
  const now = new Date().toISOString();
  return {
    tenantId: "default",
    slug: "default",
    companyName: "النظام المحاسبي الموحد (Default)",
    schemaOrDb: "default",
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    maxSeats: 10,
  };
}

/**
 * Dynamically resolves the runtime data directory without static string literals
 * that Turbopack's AST asset analyzer could trace as build-time dependencies.
 */
export function getDynamicDataDirectory(): string {
  // 1. Explicit runtime environment directory
  const envDir = (process.env.UAS_DATA_DIR || process.env.UAS_BACKUPS_DIR || "").trim();
  if (envDir) {
    return path.resolve(/*turbopackIgnore: true*/ envDir);
  }

  // 2. Derive from active SQLite database location if present
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (dbUrl.toLowerCase().startsWith("file:")) {
    let clean = dbUrl.slice(5).split("?")[0];
    if (clean && clean !== ":memory:") {
      if (/^\/[A-Za-z]:/.test(clean)) clean = clean.slice(1);
      const abs = path.isAbsolute(clean) ? clean : path.resolve(/*turbopackIgnore: true*/ process.cwd(), clean);
      return path.dirname(abs);
    }
  }

  // 3. Dynamic Windows data directory at runtime (constructed dynamically to prevent Turbopack AST asset tracing)
  if (typeof process !== "undefined" && process.platform === "win32") {
    const drive = process.env.SystemDrive || "C:";
    const folderSegments = ["UAS", "Data"];
    const winDir = path.join(/*turbopackIgnore: true*/ drive, path.sep, folderSegments.join("-"));
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ winDir)) {
        return winDir;
      }
    } catch {
      // Non-fatal
    }
  }

  if (typeof process !== "undefined" && typeof process.cwd === "function") {
    const cwd = process.cwd();
    const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized.endsWith("/.next/standalone")) {
      return path.resolve(/*turbopackIgnore: true*/ cwd, "..", "..");
    }
    return cwd;
  }
  return ".";
}

/**
 * Dynamically resolves the tenants registry file path.
 */
export function getRegistryFilePath(): string {
  const baseDir = getDynamicDataDirectory();
  const fileParts = ["tenants", "registry"];
  const fileExt = ".json";
  return path.resolve(/*turbopackIgnore: true*/ baseDir, `${fileParts.join("_")}${fileExt}`);
}

function loadRegistryFromDisk(): void {
  try {
    const filePath = getRegistryFilePath();
    const dir = path.dirname(filePath);

    // Lazily ensure directory exists at runtime
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      try {
        fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
      } catch (mkdirErr) {
        console.warn("[TenantRegistry] Notice creating registry directory:", mkdirErr);
      }
    }

    if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      try {
        lastLoadedMtimeMs = fs.statSync(/*turbopackIgnore: true*/ filePath).mtimeMs;
      } catch {
        lastLoadedMtimeMs = -1;
      }
      const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        inMemoryRegistry.clear();
        for (const item of list) {
          if (item && (item.tenantId || item.slug)) {
            const key = normalizeTenantId(item.slug || item.tenantId);
            inMemoryRegistry.set(key, item);
          }
        }
      }
    } else {
      // Lazily create initial default registry file on disk if missing
      const defaultMeta = createDefaultTenantMetadata();
      inMemoryRegistry.set("default", defaultMeta);
      try {
        fs.writeFileSync(/*turbopackIgnore: true*/ filePath, JSON.stringify([defaultMeta], null, 2), "utf8");
        lastLoadedMtimeMs = fs.statSync(/*turbopackIgnore: true*/ filePath).mtimeMs;
      } catch (writeErr) {
        console.warn("[TenantRegistry] Notice writing initial registry to disk:", writeErr);
      }
    }
  } catch (err) {
    console.warn("[TenantRegistry] Warning loading registry from disk:", err);
  }

  // Ensure default tenant always exists in memory
  if (!inMemoryRegistry.has("default")) {
    inMemoryRegistry.set("default", createDefaultTenantMetadata());
  }
}

function saveRegistryToDisk(): void {
  try {
    const filePath = getRegistryFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    }
    const list = Array.from(inMemoryRegistry.values());
    const serialized = JSON.stringify(list, null, 2);
    fs.writeFileSync(/*turbopackIgnore: true*/ filePath, serialized, "utf8");
    try {
      const standaloneDir = path.join(/*turbopackIgnore: true*/ path.dirname(filePath), ".next", "standalone");
      if (fs.existsSync(/*turbopackIgnore: true*/ standaloneDir)) {
        const standalonePath = path.join(/*turbopackIgnore: true*/ standaloneDir, path.basename(filePath));
        if (path.resolve(standalonePath) !== path.resolve(filePath)) {
          fs.writeFileSync(/*turbopackIgnore: true*/ standalonePath, serialized, "utf8");
        }
      }
    } catch {
      // Non-fatal standalone registry mirror notice
    }
    try {
      lastLoadedMtimeMs = fs.statSync(/*turbopackIgnore: true*/ filePath).mtimeMs;
    } catch {
      // Ignore stat error
    }
  } catch (err) {
    console.warn("[TenantRegistry] Warning saving registry to disk:", err);
  }
}

/**
 * Ensures the tenant registry is loaded into memory lazily upon first access at runtime,
 * never during static module evaluation or build-time bundling.
 * Reloads transparently if `tenants_registry.json` was updated externally on disk.
 */
export function ensureRegistryInitialized(): void {
  if (isRegistryInitialized) {
    try {
      const filePath = getRegistryFilePath();
      if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
        const mtimeMs = fs.statSync(/*turbopackIgnore: true*/ filePath).mtimeMs;
        if (mtimeMs !== lastLoadedMtimeMs) {
          loadRegistryFromDisk();
        }
      }
    } catch {
      // Non-fatal
    }
    return;
  }
  isRegistryInitialized = true;
  loadRegistryFromDisk();
}

/**
 * Resets the in-memory registry cache (useful for test isolation).
 */
export function resetRegistryForTests(): void {
  inMemoryRegistry.clear();
  isRegistryInitialized = false;
  lastLoadedMtimeMs = -1;
}

export function unregisterTenant(rawTenantId?: string | null): boolean {
  ensureRegistryInitialized();
  const normId = normalizeTenantId(rawTenantId);
  if (normId === "default") return false;
  const existed = inMemoryRegistry.delete(normId);
  if (existed) {
    saveRegistryToDisk();
  }
  return existed;
}

export function updateTenantMetadata(
  rawTenantIdOrSlug: string,
  patch: Partial<
    Pick<
      TenantMetadata,
      | "status"
      | "plan"
      | "maxSeats"
      | "licenseId"
      | "allowedModes"
      | "companyName"
      | "nameAr"
      | "nameEn"
    >
  >
): TenantMetadata | null {
  ensureRegistryInitialized();
  const clean = String(rawTenantIdOrSlug || "").trim().toLowerCase();
  if (!clean) return null;
  let existing = inMemoryRegistry.get(normalizeTenantId(clean)) || null;
  if (!existing) {
    for (const item of inMemoryRegistry.values()) {
      if (item.slug?.toLowerCase() === clean) {
        existing = item;
        break;
      }
    }
  }
  if (!existing) return null;

  const updated: TenantMetadata = {
    ...existing,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
    ...(patch.maxSeats !== undefined ? { maxSeats: patch.maxSeats } : {}),
    ...(patch.licenseId !== undefined ? { licenseId: patch.licenseId } : {}),
    ...(patch.allowedModes !== undefined ? { allowedModes: patch.allowedModes } : {}),
    ...(patch.companyName !== undefined ? { companyName: patch.companyName } : {}),
    ...(patch.nameAr !== undefined ? { nameAr: patch.nameAr } : {}),
    ...(patch.nameEn !== undefined ? { nameEn: patch.nameEn } : {}),
    updatedAt: new Date().toISOString(),
  };

  const key = normalizeTenantId(updated.slug || updated.tenantId);
  inMemoryRegistry.set(key, updated);
  saveRegistryToDisk();
  return updated;
}

export function getTenantMetadata(rawTenantId?: string | null): TenantMetadata | null {
  ensureRegistryInitialized();
  const tenantId = normalizeTenantId(rawTenantId);
  return inMemoryRegistry.get(tenantId) || null;
}

export function listRegisteredTenants(): TenantMetadata[] {
  ensureRegistryInitialized();
  return Array.from(inMemoryRegistry.values());
}

export function listExistingSlugs(): Set<string> {
  ensureRegistryInitialized();
  const slugs = new Set<string>();
  for (const item of inMemoryRegistry.values()) {
    if (item.slug) slugs.add(item.slug.trim().toLowerCase());
  }
  return slugs;
}

export function findTenantBySlug(rawSlug?: string | null): TenantMetadata | null {
  ensureRegistryInitialized();
  const clean = String(rawSlug || "").trim().toLowerCase();
  if (!clean) return null;
  for (const item of inMemoryRegistry.values()) {
    if (item.slug?.toLowerCase() === clean) return item;
  }
  const norm = normalizeTenantId(clean);
  return inMemoryRegistry.get(norm) || null;
}

function isPostgresRuntimeUrl(): boolean {
  const url = (process.env.DATABASE_URL || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

function resolveSchemaOrDbIdentifier(normId: string): string {
  if (normId === "default") return "default";
  if (isPostgresRuntimeUrl()) {
    return normId.startsWith("tenant_") ? normId : `tenant_${normId}`;
  }
  return normId;
}

export function registerTenant(params: {
  tenantId: string;
  companyName: string;
  slug?: string;
  nameAr?: string;
  nameEn?: string;
  tenantUrl?: string;
  licenseId?: string;
  plan?: string;
  postgresDb?: string;
  sqliteDbPath?: string;
  allowedModes?: ("local" | "lan" | "cloud")[];
  maxSeats?: number;
  schemaOrDb?: string;
}): TenantMetadata {
  ensureRegistryInitialized();
  const normId = normalizeTenantId(params.tenantId);
  const now = new Date().toISOString();
  const existing = inMemoryRegistry.get(normId);
  const existingSlugs = listExistingSlugs();
  if (existing?.slug) existingSlugs.delete(existing.slug.toLowerCase());

  const resolvedSlug =
    params.slug?.trim().toLowerCase() ||
    existing?.slug ||
    (normId === "default"
      ? "default"
      : generateTenantSlug(params.nameEn || params.companyName || normId, {
        existingSlugs,
        preferredSlug: normId.replace(/_/g, "-"),
      }).slug);

  const resolvedUrl =
    params.tenantUrl ||
    existing?.tenantUrl ||
    buildTenantWorkspaceUrl(resolvedSlug);

  const isLegacySchemaTenant =
    Boolean(existing?.schemaOrDb?.startsWith("tenant_")) &&
    !existing?.postgresDb &&
    !params.postgresDb;

  const resolvedPostgresDb =
    normId === "default"
      ? undefined
      : params.postgresDb ??
        existing?.postgresDb ??
        (isPostgresRuntimeUrl() && !isLegacySchemaTenant
          ? `uas_${normId.replace(/^uas_/, "")}`
          : undefined);

  const resolvedSqliteDbPath =
    normId === "default"
      ? undefined
      : params.sqliteDbPath ?? existing?.sqliteDbPath ?? `data/tenants/${resolvedSlug}.db`;

  const resolvedAllowedModes =
    params.allowedModes ?? existing?.allowedModes ?? (normId === "default" ? undefined : ["local", "lan", "cloud"]);

  const meta: TenantMetadata = {
    tenantId: normId,
    slug: resolvedSlug,
    companyName: params.companyName.trim() || normId,
    nameAr: params.nameAr ?? existing?.nameAr ?? (params.companyName.trim() || normId),
    nameEn: params.nameEn ?? existing?.nameEn ?? (params.companyName.trim() || normId),
    tenantUrl: resolvedUrl,
    licenseId: params.licenseId ?? existing?.licenseId,
    ...(params.plan ?? existing?.plan ? { plan: params.plan ?? existing?.plan } : {}),
    ...(resolvedPostgresDb ? { postgresDb: resolvedPostgresDb } : {}),
    ...(resolvedSqliteDbPath ? { sqliteDbPath: resolvedSqliteDbPath } : {}),
    ...(resolvedAllowedModes ? { allowedModes: resolvedAllowedModes } : {}),
    schemaOrDb: params.schemaOrDb || resolvedPostgresDb || resolveSchemaOrDbIdentifier(normId),
    status: existing?.status || "ACTIVE",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    maxSeats: params.maxSeats ?? existing?.maxSeats ?? 10,
  };

  inMemoryRegistry.set(normId, meta);
  saveRegistryToDisk();
  return meta;
}

export function ensureTenantRegistered(
  rawTenantId?: string | null,
  companyName?: string,
  extra?: {
    slug?: string;
    nameAr?: string;
    nameEn?: string;
    licenseId?: string;
    plan?: string;
    postgresDb?: string;
    sqliteDbPath?: string;
    allowedModes?: ("local" | "lan" | "cloud")[];
    maxSeats?: number;
  }
): TenantMetadata {
  ensureRegistryInitialized();
  const normId = normalizeTenantId(rawTenantId);
  const existing = inMemoryRegistry.get(normId);
  if (existing) {
    let changed = false;
    if (companyName && companyName !== existing.companyName) {
      existing.companyName = companyName;
      changed = true;
    }
    if (extra?.slug && extra.slug !== existing.slug) {
      existing.slug = extra.slug.trim().toLowerCase();
      existing.tenantUrl = buildTenantWorkspaceUrl(existing.slug);
      changed = true;
    }
    if (extra?.nameAr && extra.nameAr !== existing.nameAr) {
      existing.nameAr = extra.nameAr;
      changed = true;
    }
    if (extra?.nameEn && extra.nameEn !== existing.nameEn) {
      existing.nameEn = extra.nameEn;
      changed = true;
    }
    if (extra?.licenseId && extra.licenseId !== existing.licenseId) {
      existing.licenseId = extra.licenseId;
      changed = true;
    }
    if (extra?.plan && extra.plan !== existing.plan) {
      existing.plan = extra.plan;
      changed = true;
    }
    if (extra?.postgresDb && extra.postgresDb !== existing.postgresDb) {
      existing.postgresDb = extra.postgresDb;
      existing.schemaOrDb = extra.postgresDb;
      changed = true;
    }
    if (extra?.sqliteDbPath && extra.sqliteDbPath !== existing.sqliteDbPath) {
      existing.sqliteDbPath = extra.sqliteDbPath;
      changed = true;
    } else if (!existing.sqliteDbPath && normId !== "default" && existing.slug) {
      existing.sqliteDbPath = `data/tenants/${existing.slug}.db`;
      changed = true;
    }
    if (extra?.allowedModes && JSON.stringify(extra.allowedModes) !== JSON.stringify(existing.allowedModes)) {
      existing.allowedModes = extra.allowedModes;
      changed = true;
    }
    if (typeof extra?.maxSeats === "number" && extra.maxSeats > 0 && extra.maxSeats !== existing.maxSeats) {
      existing.maxSeats = extra.maxSeats;
      changed = true;
    }
    if (!existing.postgresDb) {
      const expectedSchemaOrDb = resolveSchemaOrDbIdentifier(normId);
      if (existing.schemaOrDb !== expectedSchemaOrDb) {
        existing.schemaOrDb = expectedSchemaOrDb;
        changed = true;
      }
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      saveRegistryToDisk();
    }
    return existing;
  }

  return registerTenant({
    tenantId: normId,
    companyName: companyName || normId,
    slug: extra?.slug,
    nameAr: extra?.nameAr,
    nameEn: extra?.nameEn,
    licenseId: extra?.licenseId,
    plan: extra?.plan,
    postgresDb: extra?.postgresDb,
    sqliteDbPath: extra?.sqliteDbPath,
    allowedModes: extra?.allowedModes,
    maxSeats: extra?.maxSeats,
  });
}

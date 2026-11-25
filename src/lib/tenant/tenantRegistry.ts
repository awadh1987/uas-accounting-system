import fs from "node:fs";
import path from "node:path";
import { normalizeTenantId } from "./tenantContext";
import { buildTenantWorkspaceUrl, generateTenantSlug } from "./tenantSlug";

export type TenantIsolationMode = "DEDICATED_DB" | "SCHEMA" | "POOLED_RLS";

export interface TenantMetadata {
  tenantId: string;
  slug: string;
  companyName: string;
  nameAr?: string;
  nameEn?: string;
  tenantUrl?: string;
  licenseId?: string;
  plan?: string;
  isolationMode?: TenantIsolationMode;
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
const slugIndexMap = new Map<string, TenantMetadata>();
let isRegistryInitialized = false;
let cacheLoadedAtMs = 0;
let centralDbSyncedOnce = false;

function getRegistryCacheTtlMs(): number {
  const raw = Number(process.env.UAS_TENANT_REGISTRY_TTL_MS || 30_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30_000;
}

function indexTenantMetadata(meta: TenantMetadata): void {
  const normId = normalizeTenantId(meta.tenantId || meta.slug);
  const slugKey = String(meta.slug || normId).trim().toLowerCase();
  inMemoryRegistry.set(normId, meta);
  if (slugKey) {
    slugIndexMap.set(slugKey, meta);
  }
}

function removeTenantFromIndexes(normId: string): boolean {
  const existing = inMemoryRegistry.get(normId);
  if (!existing) return false;
  inMemoryRegistry.delete(normId);
  if (existing.slug) {
    slugIndexMap.delete(existing.slug.trim().toLowerCase());
  }
  return true;
}

export function invalidateTenantRegistryCache(): void {
  cacheLoadedAtMs = 0;
  centralDbSyncedOnce = false;
}

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
      const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        inMemoryRegistry.clear();
        slugIndexMap.clear();
        for (const item of list) {
          if (item && (item.tenantId || item.slug)) {
            indexTenantMetadata(item as TenantMetadata);
          }
        }
      }
    } else {
      // Lazily create initial default registry file on disk if missing
      const defaultMeta = createDefaultTenantMetadata();
      indexTenantMetadata(defaultMeta);
      try {
        fs.writeFileSync(/*turbopackIgnore: true*/ filePath, JSON.stringify([defaultMeta], null, 2), "utf8");
      } catch (writeErr) {
        console.warn("[TenantRegistry] Notice writing initial registry to disk:", writeErr);
      }
    }
  } catch (err) {
    console.warn("[TenantRegistry] Warning loading registry from disk:", err);
  }

  // Ensure default tenant always exists in memory
  if (!inMemoryRegistry.has("default")) {
    indexTenantMetadata(createDefaultTenantMetadata());
  }
  cacheLoadedAtMs = Date.now();
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
    cacheLoadedAtMs = Date.now();
  } catch (err) {
    console.warn("[TenantRegistry] Warning saving registry to disk:", err);
  }
}

function mapDbRowToTenantMetadata(row: {
  tenantId: string;
  slug: string;
  companyName: string;
  nameAr: string | null;
  nameEn: string | null;
  tenantUrl: string | null;
  licenseId: string | null;
  plan: string | null;
  isolationMode: string;
  postgresDb: string | null;
  sqliteDbPath: string | null;
  schemaOrDb: string;
  allowedModesJson: string;
  maxSeats: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): TenantMetadata {
  let allowedModes: ("local" | "lan" | "cloud")[] | undefined;
  try {
    const parsed = JSON.parse(row.allowedModesJson || "[]");
    if (Array.isArray(parsed)) {
      allowedModes = parsed as ("local" | "lan" | "cloud")[];
    }
  } catch {
    allowedModes = undefined;
  }
  const iso =
    row.isolationMode === "POOLED_RLS" || row.isolationMode === "SCHEMA"
      ? row.isolationMode
      : "DEDICATED_DB";
  return {
    tenantId: row.tenantId,
    slug: row.slug,
    companyName: row.companyName,
    ...(row.nameAr ? { nameAr: row.nameAr } : {}),
    ...(row.nameEn ? { nameEn: row.nameEn } : {}),
    ...(row.tenantUrl ? { tenantUrl: row.tenantUrl } : {}),
    ...(row.licenseId ? { licenseId: row.licenseId } : {}),
    ...(row.plan ? { plan: row.plan } : {}),
    isolationMode: iso,
    ...(row.postgresDb ? { postgresDb: row.postgresDb } : {}),
    ...(row.sqliteDbPath ? { sqliteDbPath: row.sqliteDbPath } : {}),
    ...(allowedModes ? { allowedModes } : {}),
    schemaOrDb: row.schemaOrDb,
    status: (row.status as TenantMetadata["status"]) || "ACTIVE",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    maxSeats: row.maxSeats || 10,
  };
}

/**
 * Persists a single tenant record to the central `tenants` table asynchronously (non-blocking for sync callers).
 */
export async function upsertTenantInCentralDb(meta: TenantMetadata): Promise<void> {
  try {
    const { defaultPrisma } = await import("@/lib/prisma");
    const { ensureCentralPostgresRegistryReady } = await import("@/lib/clientPortal/ensurePortalSchema");
    const { ensureSqliteDatabaseReady, isSqliteRuntime } = await import("@/lib/sqliteBootstrap");
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    } else {
      await ensureCentralPostgresRegistryReady();
    }
    await defaultPrisma.tenantRegistry.upsert({
      where: { tenantId: meta.tenantId },
      update: {
        slug: meta.slug,
        companyName: meta.companyName,
        nameAr: meta.nameAr ?? null,
        nameEn: meta.nameEn ?? null,
        tenantUrl: meta.tenantUrl ?? null,
        licenseId: meta.licenseId ?? null,
        plan: meta.plan ?? null,
        isolationMode: meta.isolationMode || "DEDICATED_DB",
        postgresDb: meta.postgresDb ?? null,
        sqliteDbPath: meta.sqliteDbPath ?? null,
        schemaOrDb: meta.schemaOrDb,
        allowedModesJson: JSON.stringify(meta.allowedModes || ["local", "lan", "cloud"]),
        maxSeats: meta.maxSeats ?? 10,
        status: meta.status || "ACTIVE",
      },
      create: {
        tenantId: meta.tenantId,
        slug: meta.slug,
        companyName: meta.companyName,
        nameAr: meta.nameAr ?? null,
        nameEn: meta.nameEn ?? null,
        tenantUrl: meta.tenantUrl ?? null,
        licenseId: meta.licenseId ?? null,
        plan: meta.plan ?? null,
        isolationMode: meta.isolationMode || "DEDICATED_DB",
        postgresDb: meta.postgresDb ?? null,
        sqliteDbPath: meta.sqliteDbPath ?? null,
        schemaOrDb: meta.schemaOrDb,
        allowedModesJson: JSON.stringify(meta.allowedModes || ["local", "lan", "cloud"]),
        maxSeats: meta.maxSeats ?? 10,
        status: meta.status || "ACTIVE",
      },
    });
  } catch {
    // Non-fatal during early bootstrap or isolated unit test contexts
  }
}

/**
 * Syncs the in-memory O(1) registry cache with the central `tenants` table in `uas_qat_prod` (or SQLite central DB).
 * Ensures any legacy entries from `tenants_registry.json` are seeded into `tenants`, and any DB entries are loaded into memory.
 */
export async function syncTenantRegistryWithDb(force = false): Promise<void> {
  ensureRegistryInitialized();
  const ttl = getRegistryCacheTtlMs();
  if (!force && centralDbSyncedOnce && Date.now() - cacheLoadedAtMs < ttl) {
    return;
  }
  try {
    const { defaultPrisma } = await import("@/lib/prisma");
    const { ensureCentralPostgresRegistryReady } = await import("@/lib/clientPortal/ensurePortalSchema");
    const { ensureSqliteDatabaseReady, isSqliteRuntime } = await import("@/lib/sqliteBootstrap");
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    } else {
      await ensureCentralPostgresRegistryReady();
    }

    const rows = await defaultPrisma.tenantRegistry.findMany();
    const dbByTenantId = new Map<string, TenantMetadata>();
    for (const r of rows) {
      const mapped = mapDbRowToTenantMetadata(r);
      dbByTenantId.set(mapped.tenantId, mapped);
      indexTenantMetadata(mapped);
    }

    // Backfill any JSON-only entries into central `tenants` table
    for (const meta of inMemoryRegistry.values()) {
      if (!dbByTenantId.has(meta.tenantId)) {
        await upsertTenantInCentralDb(meta);
      }
    }
    centralDbSyncedOnce = true;
    cacheLoadedAtMs = Date.now();
  } catch {
    // Non-fatal fallback to in-memory registry
  }
}

/**
 * O(1) tenant resolution by slug backed by TTL in-memory cache + central `tenants` table lookup on miss.
 */
export async function resolveTenantBySlugAsync(rawSlug?: string | null): Promise<TenantMetadata | null> {
  const clean = String(rawSlug || "").trim().toLowerCase();
  if (!clean) return null;

  const ttl = getRegistryCacheTtlMs();
  const isWarm = centralDbSyncedOnce && isRegistryInitialized && Date.now() - cacheLoadedAtMs < ttl;
  ensureRegistryInitialized();
  if (!isWarm) {
    await syncTenantRegistryWithDb(true).catch(() => {});
  }

  const hit = slugIndexMap.get(clean) || inMemoryRegistry.get(normalizeTenantId(clean));
  if (hit && (isWarm || centralDbSyncedOnce)) {
    return hit;
  }

  try {
    const { defaultPrisma } = await import("@/lib/prisma");
    const { ensureCentralPostgresRegistryReady } = await import("@/lib/clientPortal/ensurePortalSchema");
    const { isSqliteRuntime } = await import("@/lib/sqliteBootstrap");
    if (!isSqliteRuntime()) {
      await ensureCentralPostgresRegistryReady();
    }
    const row = await defaultPrisma.tenantRegistry.findFirst({
      where: {
        OR: [{ slug: clean }, { tenantId: normalizeTenantId(clean) }],
      },
    });
    if (row) {
      const mapped = mapDbRowToTenantMetadata(row);
      indexTenantMetadata(mapped);
      return mapped;
    }
  } catch {
    // Fallback to memory hit
  }

  return hit || null;
}

/**
 * Ensures the tenant registry is loaded into memory lazily upon first access at runtime,
 * with a pure in-memory TTL cache (zero per-request disk I/O inside TTL window).
 */
export function ensureRegistryInitialized(): void {
  const now = Date.now();
  const ttl = getRegistryCacheTtlMs();
  if (isRegistryInitialized && (ttl === 0 ? false : now - cacheLoadedAtMs < ttl)) {
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
  slugIndexMap.clear();
  isRegistryInitialized = false;
  cacheLoadedAtMs = 0;
  centralDbSyncedOnce = false;
}

export function unregisterTenant(rawTenantId?: string | null): boolean {
  ensureRegistryInitialized();
  const normId = normalizeTenantId(rawTenantId);
  if (normId === "default") return false;
  const existed = removeTenantFromIndexes(normId);
  if (existed) {
    saveRegistryToDisk();
    void (async () => {
      try {
        const { defaultPrisma } = await import("@/lib/prisma");
        const dbUrl = String(process.env.DATABASE_URL || "").trim().toLowerCase();
        if (dbUrl.startsWith("file:")) {
          const exists = await defaultPrisma.$queryRawUnsafe<Array<{ name: string }>>(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'`
          );
          if (!exists || exists.length === 0) return;
        }
        await defaultPrisma.tenantRegistry.deleteMany({ where: { tenantId: normId } });
      } catch {
        // Non-fatal
      }
    })();
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
      | "isolationMode"
    >
  >
): TenantMetadata | null {
  ensureRegistryInitialized();
  const clean = String(rawTenantIdOrSlug || "").trim().toLowerCase();
  if (!clean) return null;
  const existing = slugIndexMap.get(clean) || inMemoryRegistry.get(normalizeTenantId(clean)) || null;
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
    ...(patch.isolationMode !== undefined ? { isolationMode: patch.isolationMode } : {}),
    updatedAt: new Date().toISOString(),
  };

  indexTenantMetadata(updated);
  saveRegistryToDisk();
  void upsertTenantInCentralDb(updated);
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
  return new Set<string>(slugIndexMap.keys());
}

export function findTenantBySlug(rawSlug?: string | null): TenantMetadata | null {
  ensureRegistryInitialized();
  const clean = String(rawSlug || "").trim().toLowerCase();
  if (!clean) return null;
  const slugHit = slugIndexMap.get(clean);
  if (slugHit) return slugHit;
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
  isolationMode?: TenantIsolationMode;
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

  const resolvedIsolationMode: TenantIsolationMode =
    params.isolationMode ||
    existing?.isolationMode ||
    (isLegacySchemaTenant ? "SCHEMA" : "DEDICATED_DB");

  const resolvedPostgresDb =
    normId === "default" || resolvedIsolationMode === "POOLED_RLS"
      ? undefined
      : params.postgresDb ??
      existing?.postgresDb ??
      (isPostgresRuntimeUrl() && !isLegacySchemaTenant
        ? `uas_${normId.replace(/^uas_/, "")}`
        : undefined);

  const resolvedSqliteDbPath =
    normId === "default" || resolvedIsolationMode === "POOLED_RLS"
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
    isolationMode: resolvedIsolationMode,
    ...(resolvedPostgresDb ? { postgresDb: resolvedPostgresDb } : {}),
    ...(resolvedSqliteDbPath ? { sqliteDbPath: resolvedSqliteDbPath } : {}),
    ...(resolvedAllowedModes ? { allowedModes: resolvedAllowedModes } : {}),
    schemaOrDb:
      params.schemaOrDb ||
      (resolvedIsolationMode === "POOLED_RLS" ? "pooled_rls" : resolvedPostgresDb || resolveSchemaOrDbIdentifier(normId)),
    status: existing?.status || "ACTIVE",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    maxSeats: params.maxSeats ?? existing?.maxSeats ?? 10,
  };

  indexTenantMetadata(meta);
  saveRegistryToDisk();
  void upsertTenantInCentralDb(meta);
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
    isolationMode?: TenantIsolationMode;
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
      if (existing.slug) slugIndexMap.delete(existing.slug.trim().toLowerCase());
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
    if (extra?.isolationMode && extra.isolationMode !== existing.isolationMode) {
      existing.isolationMode = extra.isolationMode;
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
    } else if (!existing.sqliteDbPath && normId !== "default" && existing.slug && existing.isolationMode !== "POOLED_RLS") {
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
    if (!existing.postgresDb && existing.isolationMode !== "POOLED_RLS") {
      const expectedSchemaOrDb = resolveSchemaOrDbIdentifier(normId);
      if (existing.schemaOrDb !== expectedSchemaOrDb) {
        existing.schemaOrDb = expectedSchemaOrDb;
        changed = true;
      }
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      indexTenantMetadata(existing);
      saveRegistryToDisk();
      void upsertTenantInCentralDb(existing);
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
    isolationMode: extra?.isolationMode,
    postgresDb: extra?.postgresDb,
    sqliteDbPath: extra?.sqliteDbPath,
    allowedModes: extra?.allowedModes,
    maxSeats: extra?.maxSeats,
  });
}

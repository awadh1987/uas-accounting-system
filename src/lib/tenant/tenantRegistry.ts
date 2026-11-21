import fs from "node:fs";
import path from "node:path";
import { normalizeTenantId } from "./tenantContext";

export interface TenantMetadata {
  tenantId: string;
  slug: string;
  companyName: string;
  schemaOrDb: string;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  maxSeats?: number;
}

const inMemoryRegistry = new Map<string, TenantMetadata>();
let isRegistryInitialized = false;

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

  return typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : ".";
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
        for (const item of list) {
          if (item && item.tenantId) {
            inMemoryRegistry.set(item.tenantId, item);
          }
        }
      }
    } else {
      // Lazily create initial default registry file on disk if missing
      const defaultMeta = createDefaultTenantMetadata();
      inMemoryRegistry.set("default", defaultMeta);
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
    fs.writeFileSync(/*turbopackIgnore: true*/ filePath, JSON.stringify(list, null, 2), "utf8");
  } catch (err) {
    console.warn("[TenantRegistry] Warning saving registry to disk:", err);
  }
}

/**
 * Ensures the tenant registry is loaded into memory lazily upon first access at runtime,
 * never during static module evaluation or build-time bundling.
 */
export function ensureRegistryInitialized(): void {
  if (isRegistryInitialized) return;
  isRegistryInitialized = true;
  loadRegistryFromDisk();
}

/**
 * Resets the in-memory registry cache (useful for test isolation).
 */
export function resetRegistryForTests(): void {
  inMemoryRegistry.clear();
  isRegistryInitialized = false;
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

export function registerTenant(params: {
  tenantId: string;
  companyName: string;
  slug?: string;
  maxSeats?: number;
}): TenantMetadata {
  ensureRegistryInitialized();
  const normId = normalizeTenantId(params.tenantId);
  const now = new Date().toISOString();
  const existing = inMemoryRegistry.get(normId);

  const meta: TenantMetadata = {
    tenantId: normId,
    slug: params.slug || normId,
    companyName: params.companyName.trim() || normId,
    schemaOrDb: normId,
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
  companyName?: string
): TenantMetadata {
  ensureRegistryInitialized();
  const normId = normalizeTenantId(rawTenantId);
  const existing = inMemoryRegistry.get(normId);
  if (existing) {
    if (companyName && companyName !== existing.companyName) {
      existing.companyName = companyName;
      existing.updatedAt = new Date().toISOString();
      saveRegistryToDisk();
    }
    return existing;
  }

  return registerTenant({
    tenantId: normId,
    companyName: companyName || normId,
  });
}

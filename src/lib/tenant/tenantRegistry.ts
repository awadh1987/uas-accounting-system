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

function getRegistryFilePath(): string {
  const customDir = (process.env.UAS_BACKUPS_DIR || "").trim();
  if (customDir && fs.existsSync(customDir)) {
    return path.join(customDir, "tenants_registry.json");
  }
  if (process.platform === "win32") {
    const winData = "C:\\UAS-Data";
    if (fs.existsSync(winData)) {
      return path.join(winData, "tenants_registry.json");
    }
  }
  return path.resolve(process.cwd(), "tenants_registry.json");
}

function loadRegistryFromDisk(): void {
  try {
    const filePath = getRegistryFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.tenantId) {
            inMemoryRegistry.set(item.tenantId, item);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[TenantRegistry] Warning reading registry from disk:", err);
  }

  // Ensure default tenant always exists
  if (!inMemoryRegistry.has("default")) {
    const now = new Date().toISOString();
    inMemoryRegistry.set("default", {
      tenantId: "default",
      slug: "default",
      companyName: "النظام المحاسبي الموحد (Default)",
      schemaOrDb: "default",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      maxSeats: 10,
    });
  }
}

function saveRegistryToDisk(): void {
  try {
    const filePath = getRegistryFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const list = Array.from(inMemoryRegistry.values());
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf8");
  } catch (err) {
    console.warn("[TenantRegistry] Warning saving registry to disk:", err);
  }
}

// Initialize on module load
loadRegistryFromDisk();

export function getTenantMetadata(rawTenantId?: string | null): TenantMetadata | null {
  const tenantId = normalizeTenantId(rawTenantId);
  return inMemoryRegistry.get(tenantId) || null;
}

export function listRegisteredTenants(): TenantMetadata[] {
  return Array.from(inMemoryRegistry.values());
}

export function registerTenant(params: {
  tenantId: string;
  companyName: string;
  slug?: string;
  maxSeats?: number;
}): TenantMetadata {
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

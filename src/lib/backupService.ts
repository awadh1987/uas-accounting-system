import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { prisma } from "@/lib/prisma";
import { getActiveTenantId, normalizeTenantId, runWithTenant } from "@/lib/tenant/tenantContext";
import { findTenantBySlug, getTenantMetadata, listRegisteredTenants } from "@/lib/tenant/tenantRegistry";
import {
  resetTenantClientsForTests,
  resolveTenantDatabaseUrl,
  resolveTenantDbFilePath,
  resolveTenantSchemaName,
} from "@/lib/tenant/tenantDbManager";
import {
  ensureSqliteDatabaseReady,
  isSqliteRuntime,
  resetSqliteBootstrapCacheForTests,
  resolveSqliteFilePath,
} from "@/lib/sqliteBootstrap";
import { companyNamesMatch } from "@/lib/licensing/licenseSchema";
import { loadInstalledLicense } from "@/lib/licensing/verifier";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { ensure6GenerationCoaHierarchy } from "@/lib/accountingCoreEngine";
import { ensureDefaultFiscalYear } from "@/lib/fiscalYearClosingEngine";
import { emitNotification } from "@/lib/notifications/notificationService";

const execFileAsync = promisify(execFile);

export const UAS_BACKUP_SCHEMA_VERSION = "uas-schema-v3.1";

export const GFS_RETENTION_POLICY = {
  daily: 7,
  weekly: 4,
  monthly: 6,
  preRestore: 3,
  orphanTempMaxAgeDays: 7,
} as const;

export interface FullSchemaBackupData {
  format: "UAS-FULL-SCHEMA-JSON-V1";
  version: "3.0.0";
  createdAt: string;
  companyName: string;
  licenseId: string;
  tenantId?: string;
  tableCounts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export const FULL_SCHEMA_TABLE_ORDER = [
  // 1. Core Config & Master Lookups
  "enterpriseProfile",
  "systemSettings",
  "currency",
  "exchangeRate",
  "costCenter",
  "fiscalYear",
  "unitOfMeasure",
  "itemCategory",
  "warehouse",
  "user",
  "licenseState",
  "licenseDeviceBinding",
  "currencyRate",
  // 2. Chart of Accounts & Projects
  "account",
  "project",
  "subProject",
  "projectAcquisitionCycle",
  "harvestCycle",
  "treasuryAccount",
  // 3. Parties & Items
  "vendor",
  "customer",
  "worker",
  "inventoryItem",
  "itemUnitConversion",
  "stockBalance",
  "inventoryLot",
  "harvestInventoryBatch",
  // 4. Governance & Drafts
  "approvalRule",
  "workspaceDraft",
  "idempotencyRecord",
  // 5. Transactions & Documents
  "purchaseOrder",
  "purchaseOrderItem",
  "goodsReceipt",
  "vendorBill",
  "paymentVoucher",
  "salesInvoice",
  "receiptVoucher",
  "saleTransaction",
  "installmentVoucher",
  "operatingExpense",
  "workerWageEntry",
  "stockMovement",
  "treasuryTransaction",
  "journalEntry",
  "journalEntryLine",
  "attachment",
  "adjustmentEntry",
  "approvalRequest",
  // 6. Audit Logs & Sync/Notification/Device Governance
  "auditLog",
  "immutableAuditLog",
  "syncChangeLog",
  "syncConflict",
  "notificationEvent",
  "tenantDevice",
] as const;

export async function backfillLegacyBaseCurrencies(client: typeof prisma = prisma) {
  try {
    await client.$executeRawUnsafe(`
      UPDATE "JournalEntryLine"
      SET "baseDebit" = "debit",
          "debitBase" = "debit",
          "foreignDebit" = CASE WHEN "foreignDebit" = 0 THEN "debit" ELSE "foreignDebit" END,
          "exchangeRate" = CASE WHEN "exchangeRate" = 0 THEN 1.0 ELSE "exchangeRate" END,
          "currencyCode" = CASE WHEN "currencyCode" IS NULL OR "currencyCode" = '' THEN "currency" ELSE "currencyCode" END
      WHERE ("baseDebit" = 0 OR "baseDebit" IS NULL) AND "debit" > 0;
    `);

    await client.$executeRawUnsafe(`
      UPDATE "JournalEntryLine"
      SET "baseCredit" = "credit",
          "creditBase" = "credit",
          "foreignCredit" = CASE WHEN "foreignCredit" = 0 THEN "credit" ELSE "foreignCredit" END,
          "exchangeRate" = CASE WHEN "exchangeRate" = 0 THEN 1.0 ELSE "exchangeRate" END,
          "currencyCode" = CASE WHEN "currencyCode" IS NULL OR "currencyCode" = '' THEN "currency" ELSE "currencyCode" END
      WHERE ("baseCredit" = 0 OR "baseCredit" IS NULL) AND "credit" > 0;
    `);
  } catch (err) {
    console.warn("[BackupService] backfillLegacyBaseCurrencies non-fatal error:", err);
  }
}

export interface UasbakManifest {
  tenantSlug: string;
  tenantId: string;
  companyName: string;
  licenseId: string;
  engine: "postgresql" | "sqlite";
  createdAt: string;
  schemaVersion: string;
  sha256: string;
  sizeBytes: number;
  postgresDb?: string;
}

export interface UasbakEnvelope {
  format: "UAS-BACKUP-V1";
  manifest?: UasbakManifest;
  engine?: "sqlite";
  schemaVersion?: string;
  createdAt: string;
  companyName: string;
  licenseId: string;
  tenantId?: string;
  tenantSlug?: string;
  sha256: string;
  sizeBytes: number;
  dbBase64: string;
}

export interface UasbakPortableEnvelopeV2 {
  format: "UAS-BACKUP-V2";
  manifest?: UasbakManifest;
  engine: "sqlite" | "postgresql";
  schemaVersion?: string;
  createdAt: string;
  companyName: string;
  licenseId: string;
  tenantId?: string;
  tenantSlug?: string;
  sha256: string;
  sizeBytes: number;
  schemaBackup: FullSchemaBackupData;
}

export interface UasbakPgDumpEnvelopeV3 {
  format: "UAS-BACKUP-PG-V3";
  manifest: UasbakManifest;
  tenantSlug: string;
  tenantId: string;
  engine: "postgresql";
  createdAt: string;
  schemaVersion: string;
  companyName: string;
  licenseId: string;
  sha256: string;
  sizeBytes: number;
  pgDumpBase64: string;
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  type: "auto" | "pre-restore" | "manual";
  tenantSlug?: string;
  engine?: "postgresql" | "sqlite" | "portable";
  sha256?: string | null;
}

function resolveAppProjectRoot(): string {
  const cwd = process.cwd();
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/.next/standalone")) {
    return path.resolve(/*turbopackIgnore: true*/ cwd, "..", "..");
  }
  return cwd;
}

export function normalizeBackupTenantSlug(raw?: string | null): string {
  const cleaned = String(raw || "").trim().toLowerCase();
  if (!cleaned || cleaned === "default" || cleaned === "root" || cleaned === "public") {
    return "default";
  }
  const meta = getTenantMetadata(cleaned) || findTenantBySlug(cleaned);
  if (meta?.slug) {
    return meta.slug.trim().toLowerCase() || "default";
  }
  const norm = normalizeTenantId(cleaned).replace(/_/g, "-");
  return norm || "default";
}

export function buildContentDispositionHeader(filename: string): string {
  const safeBase = path.basename(String(filename || "backup.uasbak")).replace(/["\r\n]/g, "_");
  const asciiFallback =
    safeBase
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+(?=\.)/, "uas-backup") || "uas-backup.uasbak";
  const encoded = encodeURIComponent(safeBase);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function isExcludedDevBackupFile(filename: string): boolean {
  const base = path.basename(String(filename || "").trim());
  if (!base) return true;
  if (/^standalone_dev_/i.test(base)) return true;
  if (/_phase1_core_/i.test(base) || /-phase1_core_/i.test(base)) return true;
  if (/\.(tmp|part|toc)$/i.test(base)) return true;
  return false;
}

const REQUIRED_CORE_TABLES = [
  "User",
  "Account",
  "JournalEntry",
  "EnterpriseProfile",
];

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const PGDUMP_HEADER = Buffer.from("PGDMP", "ascii");

export function hasValidPgDumpHeader(buffer: Buffer): boolean {
  if (!buffer || buffer.length < PGDUMP_HEADER.length) return false;
  return buffer.subarray(0, PGDUMP_HEADER.length).equals(PGDUMP_HEADER);
}

export function getBackupsDirectory(): string {
  const customDir = (process.env.UAS_BACKUPS_DIR || "").trim();
  if (customDir) {
    const abs = path.resolve(/*turbopackIgnore: true*/ customDir);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
    }
    return abs;
  }

  // Windows Desktop standard directory
  if (process.platform === "win32") {
    const winDataBackups = "C:\\UAS-Data\\backups";
    try {
      if (fs.existsSync("C:\\UAS-Data") || !fs.existsSync(winDataBackups)) {
        fs.mkdirSync(winDataBackups, { recursive: true });
        return winDataBackups;
      }
    } catch {
      // Fall through to database parent directory if C:\UAS-Data is not writable
    }
  }

  const envDataDir = (process.env.UAS_DATA_DIR || "").trim();
  if (envDataDir) {
    const target = path.join(path.resolve(/*turbopackIgnore: true*/ envDataDir), "backups");
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    return target;
  }

  const dbPath = isSqliteRuntime() ? resolveSqliteFilePath() : null;
  const parentDir = dbPath ? path.dirname(dbPath) : resolveAppProjectRoot();
  const target = path.join(parentDir, "backups");
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

export function getTenantBackupsDirectory(
  tenantIdOrSlug?: string | null,
  baseBackupsDir?: string
): string {
  const base = baseBackupsDir ? path.resolve(baseBackupsDir) : getBackupsDirectory();
  const slug = normalizeBackupTenantSlug(tenantIdOrSlug ?? getActiveTenantId());
  const safeSlug = slug.replace(/[^a-z0-9_-]/g, "") || "default";
  const dir = path.join(base, safeSlug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function parseBackupDateFromFilenameOrStat(filename: string, mtime: Date): Date {
  const isoMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})(?:[_T-](\d{2})(\d{2})(\d{2})?)?/);
  if (isoMatch) {
    const [, y, m, d, hh = "02", mm = "30", ss = "00"] = isoMatch;
    const parsed = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  const compactMatch = filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (compactMatch) {
    const [, y, m, d, hh, mm, ss] = compactMatch;
    const parsed = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return mtime;
}

function getIsoWeekKey(date: Date): string {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const PROTECTED_NON_BACKUP_DIR_NAMES = new Set([
  "uploads",
  "vision-archive",
  "attachments",
  "branding",
  "receipts",
  "tenants",
  "licenses",
]);

function isProtectedPath(candidatePath: string): boolean {
  const parts = path.resolve(candidatePath).split(path.sep).map((p) => p.toLowerCase());
  return parts.some((p) => PROTECTED_NON_BACKUP_DIR_NAMES.has(p));
}

export interface PruneTenantBackupsOptions {
  tenantSlug?: string | null;
  baseBackupsDir?: string;
  now?: Date;
  dailyKeep?: number;
  weeklyKeep?: number;
  monthlyKeep?: number;
  preRestoreKeep?: number;
  orphanTempMaxAgeDays?: number;
  tempDirs?: string[];
}

export interface PruneTenantBackupsResult {
  tenantSlug: string;
  keptAutoCount: number;
  keptPreRestoreCount: number;
  deletedAutoCount: number;
  deletedPreRestoreCount: number;
  deletedTempCount: number;
  totalDeleted: number;
  freedBytes: number;
  keptFiles: string[];
  deletedFiles: string[];
  buckets: {
    daily: string[];
    weekly: string[];
    monthly: string[];
    preRestore: string[];
  };
}

export function pruneTenantBackups(
  opts: PruneTenantBackupsOptions = {}
): PruneTenantBackupsResult {
  const tenantSlug = normalizeBackupTenantSlug(opts.tenantSlug ?? getActiveTenantId());
  const baseDir = opts.baseBackupsDir
    ? path.resolve(opts.baseBackupsDir)
    : getBackupsDirectory();
  const tenantDir = getTenantBackupsDirectory(tenantSlug, baseDir);
  const now = opts.now ?? new Date();
  const dailyKeep = opts.dailyKeep ?? GFS_RETENTION_POLICY.daily;
  const weeklyKeep = opts.weeklyKeep ?? GFS_RETENTION_POLICY.weekly;
  const monthlyKeep = opts.monthlyKeep ?? GFS_RETENTION_POLICY.monthly;
  const preRestoreKeep = opts.preRestoreKeep ?? GFS_RETENTION_POLICY.preRestore;
  const orphanTempMaxAgeDays =
    opts.orphanTempMaxAgeDays ?? GFS_RETENTION_POLICY.orphanTempMaxAgeDays;

  const autoItems: Array<{ name: string; full: string; date: Date; size: number }> = [];
  const preRestoreItems: Array<{ name: string; full: string; date: Date; size: number }> = [];
  const seenPaths = new Set<string>();

  const scanDirs = Array.from(new Set([tenantDir, baseDir]));
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir) || isProtectedPath(dir)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const isTenantSubdir = path.resolve(dir) === path.resolve(tenantDir);
    for (const file of entries) {
      if (isExcludedDevBackupFile(file)) continue;
      if (!/\.(uasbak|db|dump|json)$/i.test(file)) continue;
      if (!isTenantSubdir && !doesBackupFilenameBelongToTenant(file, tenantSlug)) {
        continue;
      }
      const full = path.join(dir, file);
      if (seenPaths.has(full)) continue;
      seenPaths.add(full);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        const date = parseBackupDateFromFilenameOrStat(file, stat.mtime);
        if (/^pre-restore-/i.test(file)) {
          preRestoreItems.push({ name: file, full, date, size: stat.size });
        } else if (/^uas-auto-/i.test(file)) {
          autoItems.push({ name: file, full, date, size: stat.size });
        }
      } catch {
        // Ignore stat error
      }
    }
  }

  autoItems.sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.name.localeCompare(a.name)
  );
  preRestoreItems.sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.name.localeCompare(a.name)
  );

  const dailyDays = new Map<string, string>();
  const weeklyWeeks = new Map<string, string>();
  const monthlyMonths = new Map<string, string>();
  const keepAutoSet = new Set<string>();

  for (const item of autoItems) {
    const dayKey = getDayKey(item.date);
    if (!dailyDays.has(dayKey) && dailyDays.size < dailyKeep) {
      dailyDays.set(dayKey, item.name);
      keepAutoSet.add(item.full);
    }
  }
  for (const item of autoItems) {
    const weekKey = getIsoWeekKey(item.date);
    if (!weeklyWeeks.has(weekKey) && weeklyWeeks.size < weeklyKeep) {
      weeklyWeeks.set(weekKey, item.name);
      keepAutoSet.add(item.full);
    }
  }
  for (const item of autoItems) {
    const monthKey = getMonthKey(item.date);
    if (!monthlyMonths.has(monthKey) && monthlyMonths.size < monthlyKeep) {
      monthlyMonths.set(monthKey, item.name);
      keepAutoSet.add(item.full);
    }
  }

  const keepPreRestore = preRestoreItems.slice(0, preRestoreKeep);
  const keepPreSet = new Set(keepPreRestore.map((item) => item.full));

  const deletedFiles: string[] = [];
  const keptFiles: string[] = [];
  let deletedAutoCount = 0;
  let deletedPreRestoreCount = 0;
  let deletedTempCount = 0;
  let freedBytes = 0;

  for (const item of autoItems) {
    if (keepAutoSet.has(item.full)) {
      keptFiles.push(item.name);
    } else {
      try {
        fs.unlinkSync(item.full);
        deletedFiles.push(item.name);
        deletedAutoCount++;
        freedBytes += item.size;
      } catch {
        // Ignore unlink errors
      }
    }
  }

  for (const item of preRestoreItems) {
    if (keepPreSet.has(item.full)) {
      keptFiles.push(item.name);
    } else {
      try {
        fs.unlinkSync(item.full);
        deletedFiles.push(item.name);
        deletedPreRestoreCount++;
        freedBytes += item.size;
      } catch {
        // Ignore unlink errors
      }
    }
  }

  // Prune orphaned backup temp files older than orphanTempMaxAgeDays (never touching attachments/uploads)
  const cutoffMs = now.getTime() - orphanTempMaxAgeDays * 86400_000;
  const tempScanDirs = Array.from(new Set(opts.tempDirs ?? [tenantDir, baseDir, os.tmpdir()]));
  for (const tDir of tempScanDirs) {
    if (!fs.existsSync(tDir) || isProtectedPath(tDir)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(tDir);
    } catch {
      continue;
    }
    const isSystemTmp = path.resolve(tDir) === path.resolve(os.tmpdir());
    for (const file of entries) {
      const isUasTempPattern =
        /^uas-(snap|xengine|pgdump|restore-tmp)-/i.test(file) ||
        (!isSystemTmp && /\.(tmp|part|toc)$/i.test(file));
      if (!isUasTempPattern) continue;
      const full = path.join(tDir, file);
      if (isProtectedPath(full)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.isFile() && stat.mtimeMs < cutoffMs) {
          fs.unlinkSync(full);
          deletedFiles.push(file);
          deletedTempCount++;
          freedBytes += stat.size;
        }
      } catch {
        // Ignore temp cleanup failure
      }
    }
  }

  return {
    tenantSlug,
    keptAutoCount: keepAutoSet.size,
    keptPreRestoreCount: keepPreSet.size,
    deletedAutoCount,
    deletedPreRestoreCount,
    deletedTempCount,
    totalDeleted: deletedAutoCount + deletedPreRestoreCount + deletedTempCount,
    freedBytes,
    keptFiles,
    deletedFiles,
    buckets: {
      daily: Array.from(dailyDays.values()),
      weekly: Array.from(weeklyWeeks.values()),
      monthly: Array.from(monthlyMonths.values()),
      preRestore: keepPreRestore.map((i) => i.name),
    },
  };
}

export function pruneRollingBackups(backupsDir: string, maxRetention = 14): number {
  if (!fs.existsSync(backupsDir)) return 0;
  let deletedCount = 0;
  try {
    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => /^uas-auto-\d{4}-\d{2}-\d{2}\.db$/i.test(f))
      .map((f) => {
        const full = path.join(backupsDir, f);
        const stat = fs.statSync(full);
        return { name: f, full, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.name.localeCompare(a.name)); // Latest date first

    if (files.length > maxRetention) {
      const toDelete = files.slice(maxRetention);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.full);
          deletedCount++;
        } catch (e) {
          console.warn("[BackupService] Failed to prune old backup:", item.full, e);
        }
      }
    }
  } catch (err) {
    console.warn("[BackupService] Pruning error:", err);
  }
  return deletedCount;
}

export async function performDailyAutoBackupIfNeeded(): Promise<{
  created: boolean;
  path?: string;
  reason?: string;
}> {
  if (!isSqliteRuntime()) {
    return { created: false, reason: "not_sqlite_runtime" };
  }

  const activeDbPath = resolveSqliteFilePath();
  if (!activeDbPath || !fs.existsSync(activeDbPath)) {
    return { created: false, reason: "no_active_database_file" };
  }

  const backupsDir = getBackupsDirectory();
  const todayStr = new Date().toISOString().slice(0, 10);
  const targetFilename = `uas-auto-${todayStr}.db`;
  const targetPath = path.join(backupsDir, targetFilename);

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
    return { created: false, reason: "already_exists_today", path: targetPath };
  }

  try {
    const escaped = targetPath.replace(/\\/g, "/").replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
    pruneRollingBackups(backupsDir, 14);
    console.log(`[BackupService] Daily auto-backup created: ${targetFilename}`);
    return { created: true, path: targetPath };
  } catch (error) {
    console.error("[BackupService] Daily auto-backup failed:", error);
    return { created: false, reason: (error as Error).message };
  }
}

export async function createTempBackupSnapshot(): Promise<{
  tempPath: string;
  sha256: string;
  sizeBytes: number;
  buffer: Buffer;
}> {
  if (!isSqliteRuntime()) {
    throw new Error("Live VACUUM snapshot is only supported on SQLite runtime");
  }

  const tempFilename = `uas-snap-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`;
  const tempPath = path.join(os.tmpdir(), tempFilename);
  const escaped = tempPath.replace(/\\/g, "/").replace(/'/g, "''");

  await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
  const buffer = fs.readFileSync(tempPath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const sizeBytes = buffer.length;

  try {
    fs.unlinkSync(tempPath);
  } catch {
    // Ignore temp unlink error
  }

  return { tempPath, sha256, sizeBytes, buffer };
}

async function resolveCompanyAndLicenseForTenant(
  activeTenant: string,
  companyNameOverride?: string,
  licenseIdOverride?: string
): Promise<{ tenantSlug: string; companyName: string; licenseId: string }> {
  const tenantSlug = normalizeBackupTenantSlug(activeTenant);
  const meta = getTenantMetadata(activeTenant) || findTenantBySlug(activeTenant);
  let compName = (companyNameOverride || "").trim();
  let licId = (licenseIdOverride || "").trim();

  if (meta) {
    if (!compName) {
      compName = (meta.companyName || meta.nameAr || meta.nameEn || "").trim();
    }
    if (!licId && meta.licenseId) {
      licId = meta.licenseId.trim();
    }
  }

  if (!compName || !licId) {
    try {
      const { license } = loadInstalledLicense(activeTenant);
      if (license) {
        if (!compName && license.company_name) compName = license.company_name;
        if (!licId && license.license_id) licId = license.license_id;
      }
    } catch {
      // Ignore if license is unavailable
    }
  }

  if (!compName) {
    try {
      const profile = await prisma.enterpriseProfile.findFirst({
        select: { legalNameAr: true, legalNameEn: true },
      });
      if (profile) {
        compName = profile.legalNameAr || profile.legalNameEn || "UAS-Enterprise";
      }
    } catch {
      // Fallback
    }
  }

  if (!compName) compName = "UAS-Enterprise";
  if (!licId) licId = "COMMERCIAL";
  return {
    tenantSlug,
    companyName: compName || "UAS-Enterprise",
    licenseId: licId || "COMMERCIAL",
  };
}

export interface PostgresToolConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  schema: string;
}

export function resolvePostgresPgToolConnection(tenantId?: string): PostgresToolConnection {
  const activeTenant = tenantId || getActiveTenantId();
  const rawUrl = resolveTenantDatabaseUrl(activeTenant);
  const url = new URL(rawUrl);
  const meta = getTenantMetadata(activeTenant) || findTenantBySlug(activeTenant);
  const urlDbName = url.pathname.replace(/^\//, "") || "uas_qat_prod";
  const database =
    activeTenant === "default" ? urlDbName : meta?.postgresDb || urlDbName;
  const schema =
    url.searchParams.get("schema") ||
    (meta?.postgresDb || activeTenant === "default" ? "public" : resolveTenantSchemaName(activeTenant));

  return {
    host: url.hostname || "127.0.0.1",
    port: url.port || "5432",
    user: decodeURIComponent(url.username || "uas_admin"),
    password: decodeURIComponent(url.password || ""),
    database: database || "uas_qat_prod",
    schema: schema || "public",
  };
}

export async function createPostgresPgDumpSnapshot(params?: {
  companyName?: string;
  licenseId?: string;
  tenantId?: string;
  filenamePrefix?: string;
}): Promise<{
  buffer: Buffer;
  sha256: string;
  sizeBytes: number;
  manifest: UasbakManifest;
  envelope: UasbakPgDumpEnvelopeV3;
  filename: string;
}> {
  const activeTenant = params?.tenantId || getActiveTenantId();
  const conn = resolvePostgresPgToolConnection(activeTenant);
  const { tenantSlug, companyName, licenseId } = await resolveCompanyAndLicenseForTenant(
    activeTenant,
    params?.companyName,
    params?.licenseId
  );

  const tmpDumpPath = path.join(
    os.tmpdir(),
    `uas-pgdump-${tenantSlug}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.dump`
  );

  try {
    const args = [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--schema=${conn.schema}`,
      "-h",
      conn.host,
      "-p",
      conn.port,
      "-U",
      conn.user,
      "-f",
      tmpDumpPath,
      conn.database,
    ];

    await execFileAsync("pg_dump", args, {
      env: {
        ...process.env,
        PGPASSWORD: conn.password,
      },
      maxBuffer: 32 * 1024 * 1024,
    });

    const buffer = fs.readFileSync(tmpDumpPath);
    if (!hasValidPgDumpHeader(buffer)) {
      throw new Error("Generated pg_dump archive failed PGDMP header verification");
    }

    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const sizeBytes = buffer.length;
    const createdAt = new Date().toISOString();

    const manifest: UasbakManifest = {
      tenantSlug,
      tenantId: activeTenant,
      companyName,
      licenseId,
      engine: "postgresql",
      createdAt,
      schemaVersion: UAS_BACKUP_SCHEMA_VERSION,
      sha256,
      sizeBytes,
      postgresDb: conn.database,
    };

    const todayStr = createdAt.slice(0, 10);
    const asciiComp = companyName
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24);
    const labelPart = tenantSlug !== "default" ? tenantSlug : asciiComp || "root";
    const filename = params?.filenamePrefix
      ? `${params.filenamePrefix}.uasbak`
      : `UAS-Backup-${labelPart}-${todayStr}.uasbak`;

    const envelope: UasbakPgDumpEnvelopeV3 = {
      format: "UAS-BACKUP-PG-V3",
      manifest,
      tenantSlug,
      tenantId: activeTenant,
      engine: "postgresql",
      createdAt,
      schemaVersion: UAS_BACKUP_SCHEMA_VERSION,
      companyName,
      licenseId,
      sha256,
      sizeBytes,
      pgDumpBase64: buffer.toString("base64"),
    };

    return { buffer, sha256, sizeBytes, manifest, envelope, filename };
  } finally {
    try {
      if (fs.existsSync(tmpDumpPath)) fs.unlinkSync(tmpDumpPath);
    } catch {
      // Ignore temp unlink
    }
  }
}

export async function createUasbakEnvelope(params?: {
  companyName?: string;
  licenseId?: string;
  tenantId?: string;
}): Promise<{
  envelope: UasbakEnvelope;
  filename: string;
}> {
  const activeTenant = params?.tenantId || getActiveTenantId();
  const { sha256, sizeBytes, buffer } = await createTempBackupSnapshot();
  const { tenantSlug, companyName: compName, licenseId: licId } =
    await resolveCompanyAndLicenseForTenant(
      activeTenant,
      params?.companyName,
      params?.licenseId
    );

  const createdAt = new Date().toISOString();
  const todayStr = createdAt.slice(0, 10);
  const asciiComp = compName
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const labelPart = tenantSlug !== "default" ? tenantSlug : asciiComp || "root";
  const filename = `UAS-Backup-${labelPart}-${todayStr}.uasbak`;

  const manifest: UasbakManifest = {
    tenantSlug,
    tenantId: activeTenant,
    companyName: compName,
    licenseId: licId,
    engine: "sqlite",
    createdAt,
    schemaVersion: UAS_BACKUP_SCHEMA_VERSION,
    sha256,
    sizeBytes,
  };

  const envelope: UasbakEnvelope = {
    format: "UAS-BACKUP-V1",
    manifest,
    engine: "sqlite",
    schemaVersion: UAS_BACKUP_SCHEMA_VERSION,
    createdAt,
    companyName: compName,
    licenseId: licId,
    tenantId: activeTenant,
    tenantSlug,
    sha256,
    sizeBytes,
    dbBase64: buffer.toString("base64"),
  };

  return { envelope, filename };
}

export function validateCandidateSqliteHeader(buffer: Buffer): boolean {
  if (buffer.length < 16) return false;
  return buffer.subarray(0, 16).equals(SQLITE_HEADER);
}

export function validateAndInspectCandidateDb(
  buffer: Buffer,
  expectedCompanyName?: string
): {
  ok: boolean;
  error?: string;
  companyName?: string;
} {
  if (!validateCandidateSqliteHeader(buffer)) {
    return {
      ok: false,
      error: "الملف المحدد ليس قاعدة بيانات SQLite صالحة (SQLite header missing)",
    };
  }

  const tempCandidatePath = path.join(
    os.tmpdir(),
    `candidate-check-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`
  );

  try {
    fs.writeFileSync(tempCandidatePath, buffer);

    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(tempCandidatePath, { readOnly: true });

      // 1. PRAGMA integrity_check
      const integrityStmt = db.prepare("PRAGMA integrity_check(1);");
      const integrityRow = integrityStmt.get() as { integrity_check?: string } | undefined;
      const integrityResult = integrityRow?.integrity_check || Object.values(integrityRow || {})[0];
      if (integrityResult !== "ok") {
        return {
          ok: false,
          error: `فحص سلامة قاعدة البيانات فشل: ${integrityResult}`,
        };
      }

      // 2. Check Core Tables
      const tablesStmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
      );
      const tables = tablesStmt.all() as Array<{ name: string }>;
      const tableNames = new Set(tables.map((t) => t.name));

      for (const required of REQUIRED_CORE_TABLES) {
        if (!tableNames.has(required)) {
          return {
            ok: false,
            error: `قاعدة البيانات تفتقر إلى الجداول الأساسية لنظام UAS (الجدول المفقود: ${required})`,
          };
        }
      }

      // 3. Inspect EnterpriseProfile for company name matching
      let candidateCompanyName = "";
      try {
        const profileStmt = db.prepare(
          "SELECT legalNameAr, legalNameEn FROM EnterpriseProfile LIMIT 1;"
        );
        const profileRow = profileStmt.get() as
          | { legalNameAr?: string; legalNameEn?: string }
          | undefined;
        if (profileRow) {
          candidateCompanyName =
            (profileRow.legalNameAr || profileRow.legalNameEn || "").trim();
        }
      } catch {
        // Table exists but maybe empty
      }

      // 4. Verify company match against expected license company name
      if (expectedCompanyName && candidateCompanyName) {
        if (!companyNamesMatch(candidateCompanyName, expectedCompanyName)) {
          return {
            ok: false,
            companyName: candidateCompanyName,
            error: `اسم المنشأة في النسخة الاحتياطية (${candidateCompanyName}) لا يطابق المنشأة المرخصة في هذا النظام (${expectedCompanyName}). لا يمكن استبدال بيانات المنشأة بقاعدة بيانات منشأة أخرى!`,
          };
        }
      }

      return {
        ok: true,
        companyName: candidateCompanyName,
      };
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close error
        }
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: `تعذر فحص قاعدة البيانات: ${(err as Error).message}`,
    };
  } finally {
    try {
      if (fs.existsSync(tempCandidatePath)) {
        fs.unlinkSync(tempCandidatePath);
      }
    } catch {
      // Ignore temp unlink error
    }
  }
}

function doesBackupFilenameBelongToTenant(filename: string, targetSlug: string): boolean {
  const lower = filename.toLowerCase();
  const knownNonDefaultSlugs = listRegisteredTenants()
    .map((t) => normalizeBackupTenantSlug(t.slug || t.tenantId))
    .filter((s) => s !== "default");

  if (targetSlug !== "default") {
    return (
      lower.includes(`-${targetSlug}-`) ||
      lower.includes(`-${targetSlug}.`) ||
      lower.includes(`_${targetSlug}_`) ||
      lower.includes(`_${targetSlug}.`) ||
      lower.startsWith(`uas_${targetSlug.replace(/-/g, "_")}_`)
    );
  }

  // Root ("default") excludes files carrying any non-default registered tenant slug
  for (const otherSlug of knownNonDefaultSlugs) {
    if (
      lower.includes(`-${otherSlug}-`) ||
      lower.includes(`-${otherSlug}.`) ||
      lower.includes(`_${otherSlug}_`) ||
      lower.includes(`_${otherSlug}.`) ||
      lower.startsWith(`uas_${otherSlug.replace(/-/g, "_")}_`)
    ) {
      return false;
    }
  }
  return true;
}

function readSmallManifestPreview(
  fullPath: string
): { tenantSlug?: string; engine?: "postgresql" | "sqlite" | "portable"; sha256?: string | null } {
  try {
    const fd = fs.openSync(fullPath, "r");
    try {
      const buf = Buffer.alloc(1024);
      const read = fs.readSync(fd, buf, 0, 1024, 0);
      const head = buf.subarray(0, read).toString("utf8");
      if (head.startsWith("PGDMP")) {
        return { engine: "postgresql" };
      }
      if (head.startsWith("SQLite format 3")) {
        return { engine: "sqlite" };
      }
      if (head.trimStart().startsWith("{")) {
        const formatMatch = head.match(/"format"\s*:\s*"([^"]+)"/);
        const slugMatch = head.match(/"tenantSlug"\s*:\s*"([^"]+)"/);
        const engineMatch = head.match(/"engine"\s*:\s*"(postgresql|sqlite)"/);
        const shaMatch = head.match(/"sha256"\s*:\s*"([a-fA-F0-9]{64})"/);
        const fmt = formatMatch?.[1];
        const engine =
          fmt === "UAS-BACKUP-V2"
            ? "portable"
            : (engineMatch?.[1] as "postgresql" | "sqlite" | undefined);
        return {
          tenantSlug: slugMatch?.[1],
          engine,
          sha256: shaMatch?.[1] || null,
        };
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Ignore preview read error
  }
  return {};
}

export function resolveTenantBackupFilePath(filename: string, tenantId?: string): string | null {
  const safeName = path.basename(String(filename || "").trim());
  if (!safeName || safeName === "." || safeName === ".." || isExcludedDevBackupFile(safeName)) {
    return null;
  }
  const activeTenant = tenantId || getActiveTenantId();
  const targetSlug = normalizeBackupTenantSlug(activeTenant);
  const tenantDir = getTenantBackupsDirectory(targetSlug);
  const candidateInTenant = path.resolve(tenantDir, safeName);
  if (
    candidateInTenant.startsWith(path.resolve(tenantDir) + path.sep) &&
    fs.existsSync(candidateInTenant) &&
    fs.statSync(candidateInTenant).isFile()
  ) {
    return candidateInTenant;
  }

  const baseDir = getBackupsDirectory();
  const candidateInBase = path.resolve(baseDir, safeName);
  if (
    candidateInBase.startsWith(path.resolve(baseDir) + path.sep) &&
    fs.existsSync(candidateInBase) &&
    fs.statSync(candidateInBase).isFile() &&
    doesBackupFilenameBelongToTenant(safeName, targetSlug)
  ) {
    return candidateInBase;
  }
  return null;
}

export function listLocalBackups(tenantId?: string): BackupFileInfo[] {
  const baseDir = getBackupsDirectory();
  const activeTenant = tenantId || getActiveTenantId();
  const targetSlug = normalizeBackupTenantSlug(activeTenant);
  const tenantDir = getTenantBackupsDirectory(targetSlug, baseDir);

  const results: BackupFileInfo[] = [];
  const seenFilenames = new Set<string>();

  const scanDirs = Array.from(new Set([tenantDir, baseDir]));
  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    const isTenantSubdir = path.resolve(dir) === path.resolve(tenantDir);
    try {
      const entries = fs.readdirSync(dir);
      for (const file of entries) {
        if (isExcludedDevBackupFile(file)) continue;
        if (!/\.(db|uasbak|dump|json)$/i.test(file)) continue;
        if (!isTenantSubdir && !doesBackupFilenameBelongToTenant(file, targetSlug)) {
          continue;
        }
        if (seenFilenames.has(file)) continue;
        const full = path.join(dir, file);
        try {
          const stat = fs.statSync(full);
          if (!stat.isFile()) continue;
          seenFilenames.add(file);
          let type: "auto" | "pre-restore" | "manual" = "manual";
          if (file.startsWith("uas-auto-")) type = "auto";
          else if (file.startsWith("pre-restore-")) type = "pre-restore";

          const preview = readSmallManifestPreview(full);
          results.push({
            filename: file,
            sizeBytes: stat.size,
            sizeFormatted: formatBytes(stat.size),
            createdAt: stat.mtime.toISOString(),
            type,
            tenantSlug: preview.tenantSlug || targetSlug,
            engine:
              preview.engine ||
              (file.endsWith(".dump")
                ? "postgresql"
                : file.endsWith(".db")
                  ? "sqlite"
                  : isSqliteRuntime()
                    ? "sqlite"
                    : "postgresql"),
            sha256: preview.sha256 ?? null,
          });
        } catch {
          // Skip unreadable files
        }
      }
    } catch (err) {
      console.warn("[BackupService] listLocalBackups error:", err);
    }
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveBackupEnvelopeToTenantDir(
  filename: string,
  envelope: unknown,
  tenantId?: string
): Promise<string> {
  const safeName = path.basename(filename);
  const tenantDir = getTenantBackupsDirectory(tenantId ?? getActiveTenantId());
  const fullPath = path.join(tenantDir, safeName);
  const tmpPath = `${fullPath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), "utf8");
  fs.renameSync(tmpPath, fullPath);
  return fullPath;
}

export async function deleteTenantBackupSnapshot(
  filename: string,
  actor: { userId?: string | null; userDisplay: string; userRole: string },
  tenantId?: string
): Promise<{ ok: boolean; deletedFilename: string }> {
  const activeTenant = tenantId || getActiveTenantId();
  const safeName = path.basename(String(filename || "").trim());
  if (!safeName || isExcludedDevBackupFile(safeName)) {
    throw new Error("INVALID_BACKUP_FILENAME");
  }
  const fullPath = resolveTenantBackupFilePath(safeName, activeTenant);
  if (!fullPath) {
    throw new Error("BACKUP_NOT_FOUND");
  }
  fs.unlinkSync(fullPath);

  await prisma.$transaction(async (tx) => {
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "BACKUP_SNAPSHOT_DELETED",
      entityReference: `Backup:${safeName}`,
      details: `تم حذف النسخة الاحتياطية ${safeName} للمنشأة (${normalizeBackupTenantSlug(activeTenant)})`,
    });
  });

  return { ok: true, deletedFilename: safeName };
}

export async function restoreDatabaseFromBuffer(
  buffer: Buffer,
  actor: {
    userId?: string | null;
    userDisplay: string;
    userRole: string;
  },
  sourceDesc: string,
  tenantId?: string
): Promise<{
  ok: boolean;
  preRestoreSnapshot: string;
  companyName?: string;
}> {
  if (!isSqliteRuntime()) {
    throw new Error("Database restore is only supported on SQLite runtime");
  }

  const activeTenant = tenantId || getActiveTenantId();
  const activeDbPath = resolveTenantDbFilePath(activeTenant) || resolveSqliteFilePath();
  if (!activeDbPath) {
    throw new Error("Unable to resolve active SQLite database path");
  }

  // Load expected company name: from tenant metadata if isolated, else from installed license
  let expectedCompany: string | undefined;
  if (activeTenant !== "default") {
    const meta = getTenantMetadata(activeTenant);
    expectedCompany = meta?.companyName;
  }
  if (!expectedCompany) {
    const { license } = loadInstalledLicense();
    expectedCompany = license?.company_name;
  }

  // 1. Verify candidate database structure and company lock
  const inspection = validateAndInspectCandidateDb(buffer, expectedCompany);
  if (!inspection.ok) {
    throw new Error(inspection.error || "Candidate database verification failed");
  }

  // 2. Save an automatic pre-restore safety snapshot
  const tenantSlug = normalizeBackupTenantSlug(activeTenant);
  const backupsDir = getTenantBackupsDirectory(tenantSlug);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const tenantPrefix = tenantSlug !== "default" ? `pre-restore-${tenantSlug}-` : "pre-restore-";
  const preRestoreFilename = `${tenantPrefix}${timestamp}.db`;
  const preRestorePath = path.join(backupsDir, preRestoreFilename);

  if (fs.existsSync(activeDbPath)) {
    fs.copyFileSync(activeDbPath, preRestorePath);
    console.log(`[BackupService] Safety pre-restore snapshot saved to: ${preRestoreFilename}`);
  }

  // 3. Disconnect Prisma to release locks
  await prisma.$disconnect();

  // 4. Atomically replace database file via temp staging + rename
  const tmpRestorePath = `${activeDbPath}.restore-${Date.now()}.tmp`;
  fs.writeFileSync(tmpRestorePath, buffer);
  fs.renameSync(tmpRestorePath, activeDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    try {
      if (fs.existsSync(`${activeDbPath}${suffix}`)) {
        fs.unlinkSync(`${activeDbPath}${suffix}`);
      }
    } catch { }
  }

  pruneTenantBackups({ tenantSlug });

  // 5. Re-initialize Prisma & self-healing bootstrap
  resetSqliteBootstrapCacheForTests();
  await ensureSqliteDatabaseReady();

  // Automatic backward-compatible migration for restored databases
  try {
    await ensure6GenerationCoaHierarchy();
    await backfillLegacyBaseCurrencies();
    await ensureDefaultFiscalYear();
  } catch (err) {
    console.warn("[BackupService] Post-restore migration warning:", err);
  }

  // 6. Record immutable audit log & notification
  await prisma.$transaction(async (tx) => {
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "DATABASE_RESTORED_BY_ADMIN",
      entityReference: preRestoreFilename,
      details: `تمت استعادة قاعدة بيانات المنشأة (${inspection.companyName || "UAS"}) بنجاح من (${sourceDesc}). تم حفظ نسخة أمان سابقة: ${preRestoreFilename}`,
    });

    await emitNotification(
      {
        eventType: "RESTORE_COMPLETED",
        channel: "security",
        severity: "SUCCESS",
        titleAr: "تمت استعادة النسخة الاحتياطية بنجاح",
        titleEn: "Database Backup Restored Successfully",
        messageAr: `تمت الاستعادة من (${sourceDesc}) مع حفظ نقطة أمان (${preRestoreFilename}).`,
        messageEn: `Restored from (${sourceDesc}) with safety snapshot (${preRestoreFilename}).`,
        targetTab: "system",
        actorUserId: actor.userId ?? null,
        metadata: { preRestoreSnapshot: preRestoreFilename, sourceDesc, tenantId: activeTenant },
      },
      tx
    );
  });

  return {
    ok: true,
    preRestoreSnapshot: preRestoreFilename,
    companyName: inspection.companyName,
  };
}

export async function exportFullSchemaJsonBackup(params?: {
  companyName?: string;
  licenseId?: string;
  tenantId?: string;
}): Promise<{
  backup: FullSchemaBackupData;
  filename: string;
}> {
  const activeTenant = params?.tenantId || getActiveTenantId();
  if (isSqliteRuntime()) {
    await ensureSqliteDatabaseReady();
  }
  const tableCounts: Record<string, number> = {};
  const tables: Record<string, unknown[]> = {};

  for (const tableKey of FULL_SCHEMA_TABLE_ORDER) {
    const delegate = (prisma as unknown as Record<string, { findMany?: () => Promise<unknown[]> }>)[tableKey];
    if (delegate && typeof delegate.findMany === "function") {
      try {
        const rows = await delegate.findMany();
        tables[tableKey] = rows;
        tableCounts[tableKey] = rows.length;
      } catch {
        tables[tableKey] = [];
        tableCounts[tableKey] = 0;
      }
    }
  }

  let compName = (params?.companyName || "").trim();
  let licId = (params?.licenseId || "").trim();

  if (activeTenant !== "default") {
    const meta = getTenantMetadata(activeTenant);
    if (meta?.companyName && !compName) {
      compName = meta.companyName;
    }
  }

  if (!compName || !licId) {
    const { license } = loadInstalledLicense();
    if (license) {
      if (!compName && license.company_name) compName = license.company_name;
      if (!licId && license.license_id) licId = license.license_id;
    }
  }
  if (!compName) {
    try {
      const profile = await prisma.enterpriseProfile.findFirst({ select: { legalNameAr: true } });
      compName = profile?.legalNameAr || "UAS-Enterprise";
    } catch {
      compName = "UAS-Enterprise";
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const slug = compName.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "_").slice(0, 30);
  const tenantSuffix = activeTenant !== "default" ? `-${activeTenant}` : "";
  const filename = `UAS-FullBackup-${slug}${tenantSuffix}-${todayStr}.json`;

  const backup: FullSchemaBackupData = {
    format: "UAS-FULL-SCHEMA-JSON-V1",
    version: "3.0.0",
    createdAt: new Date().toISOString(),
    companyName: compName,
    licenseId: licId || "COMMERCIAL",
    tenantId: activeTenant,
    tableCounts,
    tables,
  };

  return { backup, filename };
}

export async function restorePostgresFromPgDumpBuffer(
  buffer: Buffer,
  actor: {
    userId?: string | null;
    userDisplay: string;
    userRole: string;
  },
  sourceDesc: string,
  opts?: {
    tenantId?: string;
    expectedSha256?: string;
    expectedTenantSlug?: string | null;
  }
): Promise<{
  ok: boolean;
  preRestoreSnapshot: string;
  tenantSlug: string;
  database: string;
}> {
  if (isSqliteRuntime()) {
    throw new Error("pg_restore is only applicable on PostgreSQL runtime");
  }
  if (!hasValidPgDumpHeader(buffer)) {
    throw new Error(
      "ملف الاستعادة لا يحمل ترويسة pg_dump الصالحة (Invalid PGDMP header)."
    );
  }
  if (opts?.expectedSha256) {
    const actualSha = crypto.createHash("sha256").update(buffer).digest("hex");
    if (actualSha !== opts.expectedSha256) {
      throw new Error(
        "فشل التحقق من صحة بصمة التشفير (SHA-256 Checksum Mismatch)."
      );
    }
  }

  const activeTenant = opts?.tenantId || getActiveTenantId();
  const activeSlug = normalizeBackupTenantSlug(activeTenant);
  if (opts?.expectedTenantSlug) {
    const incomingSlug = normalizeBackupTenantSlug(opts.expectedTenantSlug);
    if (incomingSlug !== activeSlug) {
      throw new Error(
        `⛔ رفض أمني: النسخة الاحتياطية تخص المنشأة (${incomingSlug}) ولا تطابق المنشأة النشطة (${activeSlug}) / Tenant slug mismatch.`
      );
    }
  }

  const conn = resolvePostgresPgToolConnection(activeTenant);
  const backupsDir = getTenantBackupsDirectory(activeSlug);
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const preRestoreFilename = `pre-restore-${activeSlug}-${timestamp}.uasbak`;

  // 1. Automatic pre-restore safety snapshot before altering database
  const preSnap = await createPostgresPgDumpSnapshot({
    tenantId: activeTenant,
    filenamePrefix: preRestoreFilename.replace(/\.uasbak$/, ""),
  });
  await saveBackupEnvelopeToTenantDir(preRestoreFilename, preSnap.envelope, activeTenant);

  const tmpDumpPath = path.join(
    os.tmpdir(),
    `uas-restore-tmp-${activeSlug}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.dump`
  );
  const tmpTocPath = `${tmpDumpPath}.toc`;

  try {
    fs.writeFileSync(tmpDumpPath, buffer);

    const { stdout: rawToc } = await execFileAsync("pg_restore", ["--list", tmpDumpPath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const escapedSchema = conn.schema.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const schemaDeclPattern = new RegExp(`\\bSCHEMA\\s+-\\s+${escapedSchema}\\b`, "i");
    const tocLines = rawToc
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(";")) return false;
        if (/\bSCHEMA\s+-\s+public\b/i.test(trimmed) || schemaDeclPattern.test(trimmed)) return false;
        if (/\b(EXTENSION|COMMENT\s+-\s+EXTENSION)\b/i.test(trimmed)) return false;
        return true;
      });

    if (tocLines.length === 0) {
      throw new Error("أرشيف pg_dump لا يحتوي على كائنات قاعدة بيانات صالحة للاستعادة.");
    }
    fs.writeFileSync(tmpTocPath, tocLines.join("\n") + "\n", "utf8");

    await execFileAsync(
      "pg_restore",
      [
        "--single-transaction",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        `--use-list=${tmpTocPath}`,
        "-h",
        conn.host,
        "-p",
        conn.port,
        "-U",
        conn.user,
        "-d",
        conn.database,
        tmpDumpPath,
      ],
      {
        env: {
          ...process.env,
          PGPASSWORD: conn.password,
        },
        maxBuffer: 32 * 1024 * 1024,
      }
    );
  } finally {
    for (const p of [tmpDumpPath, tmpTocPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch { }
    }
  }

  pruneTenantBackups({ tenantSlug: activeSlug, baseBackupsDir: path.dirname(backupsDir) });

  await resetTenantClientsForTests();

  await runWithTenant(activeTenant, async () => {
    await prisma.$transaction(async (tx) => {
      await appendAuditLogTx(tx, {
        userId: actor.userId ?? null,
        userDisplay: actor.userDisplay,
        userRole: actor.userRole,
        actionType: "DATABASE_POSTGRES_RESTORED_BY_ADMIN",
        entityReference: preRestoreFilename,
        details: `تمت استعادة قاعدة بيانات PostgreSQL (${conn.database} / ${activeSlug}) ذرياً من (${sourceDesc}). نقطة الأمان: ${preRestoreFilename}`,
      });

      await emitNotification(
        {
          eventType: "RESTORE_COMPLETED",
          channel: "security",
          severity: "SUCCESS",
          titleAr: "تمت استعادة نسخة PostgreSQL الاحتياطية بنجاح",
          titleEn: "PostgreSQL Backup Restored Successfully",
          messageAr: `تمت الاستعادة لقاعدة البيانات ${conn.database} (${activeSlug}) وحفظ نقطة الأمان ${preRestoreFilename}.`,
          messageEn: `Atomically restored ${conn.database} (${activeSlug}) with pre-restore snapshot ${preRestoreFilename}.`,
          targetTab: "system",
          actorUserId: actor.userId ?? null,
          metadata: {
            preRestoreSnapshot: preRestoreFilename,
            tenantSlug: activeSlug,
            database: conn.database,
            sourceDesc,
          },
        },
        tx
      );
    });
  });

  return {
    ok: true,
    preRestoreSnapshot: preRestoreFilename,
    tenantSlug: activeSlug,
    database: conn.database,
  };
}

export async function restoreFullSchemaJsonBackup(
  backupData: FullSchemaBackupData | { tables: Record<string, unknown[]>; companyName?: string; tenantId?: string; tenantSlug?: string },
  actor: { userId?: string | null; userDisplay: string; userRole: string },
  sourceDesc = "json_restore",
  tenantId?: string
): Promise<{
  ok: boolean;
  preRestoreSnapshot: string;
  companyName?: string;
  restoredTables: string[];
}> {
  await ensureSqliteDatabaseReady();

  const incomingRawSlug =
    (backupData as { tenantSlug?: string }).tenantSlug ||
    (backupData as { tenantId?: string }).tenantId ||
    "";
  const activeTenant = tenantId || getActiveTenantId();
  const activeSlug = normalizeBackupTenantSlug(activeTenant);
  if (incomingRawSlug) {
    const incomingSlug = normalizeBackupTenantSlug(incomingRawSlug);
    if (incomingSlug !== activeSlug) {
      throw new Error(
        `⛔ رفض أمني: هذه النسخة تخص المنشأة (${incomingSlug}) ولا تطابق المنشأة النشطة (${activeSlug}) / Tenant slug mismatch.`
      );
    }
  }

  let expectedCompany: string | undefined;
  if (activeTenant !== "default") {
    const meta = getTenantMetadata(activeTenant);
    expectedCompany = meta?.companyName;
  }
  if (!expectedCompany) {
    const { license } = loadInstalledLicense();
    expectedCompany = license?.company_name;
  }

  if (expectedCompany && backupData.companyName) {
    if (!companyNamesMatch(backupData.companyName, expectedCompany)) {
      throw new Error(
        `اسم المنشأة في النسخة الاحتياطية (${backupData.companyName}) لا يطابق المنشأة المرخصة في هذا النظام (${expectedCompany}).`
      );
    }
  }

  // Save safety pre-restore snapshot
  let preRestoreFilename = "";
  if (isSqliteRuntime()) {
    const activeDbPath = resolveTenantDbFilePath(activeTenant) || resolveSqliteFilePath();
    if (activeDbPath && fs.existsSync(activeDbPath)) {
      const backupsDir = getTenantBackupsDirectory(activeSlug);
      const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const tenantPrefix = activeSlug !== "default" ? `pre-restore-${activeSlug}-` : "pre-restore-";
      preRestoreFilename = `${tenantPrefix}${timestamp}.db`;
      try {
        fs.copyFileSync(activeDbPath, path.join(backupsDir, preRestoreFilename));
      } catch { }
    }
  } else {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    preRestoreFilename = `pre-restore-${activeSlug}-${timestamp}.uasbak`;
    try {
      const preSnap = await createPostgresPgDumpSnapshot({
        tenantId: activeTenant,
        filenamePrefix: preRestoreFilename.replace(/\.uasbak$/, ""),
      });
      await saveBackupEnvelopeToTenantDir(preRestoreFilename, preSnap.envelope, activeTenant);
    } catch (snapErr) {
      console.warn("[BackupService] Pre-restore pg_dump warning:", snapErr);
    }
  }

  const restoredTables: string[] = [];

  if (isSqliteRuntime()) {
    try {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF;");
    } catch { }
    try {
      // 1. Delete rows in REVERSE topological order (children first)
      const reversedOrder = [...FULL_SCHEMA_TABLE_ORDER].reverse();
      for (const tableKey of reversedOrder) {
        const delegate = (prisma as unknown as Record<string, { deleteMany?: () => Promise<unknown> }>)[tableKey];
        if (delegate && typeof delegate.deleteMany === "function") {
          try {
            await delegate.deleteMany();
          } catch { }
        }
      }

      // 2. Insert rows in FORWARD topological order (parents first)
      for (const tableKey of FULL_SCHEMA_TABLE_ORDER) {
        const rows = backupData.tables?.[tableKey];
        const delegate = (prisma as unknown as Record<string, {
          createMany?: (arg: { data: unknown[] }) => Promise<unknown>;
          create?: (arg: { data: unknown }) => Promise<unknown>;
        }>)[tableKey];
        if (Array.isArray(rows) && rows.length > 0 && delegate) {
          let inserted = false;
          if (typeof delegate.createMany === "function") {
            try {
              await delegate.createMany({ data: rows });
              inserted = true;
            } catch { }
          }
          if (!inserted && typeof delegate.create === "function") {
            for (const r of rows) {
              try {
                await delegate.create({ data: r });
              } catch { }
            }
            inserted = true;
          }
          if (inserted) {
            restoredTables.push(tableKey);
          }
        }
      }
    } finally {
      try {
        await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
      } catch { }
    }
  } else {
    await prisma.$transaction(
      async (tx) => {
        const reversedOrder = [...FULL_SCHEMA_TABLE_ORDER].reverse();
        for (const tableKey of reversedOrder) {
          const delegate = (tx as unknown as Record<string, { deleteMany?: () => Promise<unknown> }>)[tableKey];
          if (delegate && typeof delegate.deleteMany === "function") {
            await delegate.deleteMany();
          }
        }
        for (const tableKey of FULL_SCHEMA_TABLE_ORDER) {
          const rows = backupData.tables?.[tableKey];
          const delegate = (tx as unknown as Record<string, {
            createMany?: (arg: { data: unknown[]; skipDuplicates?: boolean }) => Promise<unknown>;
            create?: (arg: { data: unknown }) => Promise<unknown>;
          }>)[tableKey];
          if (Array.isArray(rows) && rows.length > 0 && delegate) {
            if (typeof delegate.createMany === "function") {
              await delegate.createMany({ data: rows, skipDuplicates: true });
              restoredTables.push(tableKey);
            } else if (typeof delegate.create === "function") {
              for (const r of rows) {
                await delegate.create({ data: r });
              }
              restoredTables.push(tableKey);
            }
          }
        }
      },
      { maxWait: 15000, timeout: 120000 }
    );
  }

  // 3. Post-restore migration hooks
  await ensure6GenerationCoaHierarchy();
  await backfillLegacyBaseCurrencies();
  await ensureDefaultFiscalYear();

  // 4. Record immutable audit log & notification
  await prisma.$transaction(async (tx) => {
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "DATABASE_JSON_RESTORED_BY_ADMIN",
      entityReference: preRestoreFilename || "JSON_RESTORE",
      details: `تمت استعادة قاعدة بيانات المنشأة (${backupData.companyName || "UAS"}) بنجاح من (${sourceDesc}). عدد الجداول المستعادة: ${restoredTables.length}`,
    });

    await emitNotification(
      {
        eventType: "RESTORE_COMPLETED",
        channel: "security",
        severity: "SUCCESS",
        titleAr: "تمت استعادة النسخة الاحتياطية المحمولة بنجاح",
        titleEn: "Portable Backup Restored Successfully",
        messageAr: `تمت استعادة ${restoredTables.length} جدول من (${sourceDesc}).`,
        messageEn: `Restored ${restoredTables.length} tables from (${sourceDesc}).`,
        targetTab: "system",
        actorUserId: actor.userId ?? null,
        metadata: {
          preRestoreSnapshot: preRestoreFilename,
          restoredTablesCount: restoredTables.length,
          tenantId: activeTenant,
        },
      },
      tx
    );
  });

  return {
    ok: true,
    preRestoreSnapshot: preRestoreFilename,
    companyName: backupData.companyName,
    restoredTables,
  };
}

/**
 * Creates a portable `.uasbak` envelope across BOTH Local/LAN SQLite (`UAS-BACKUP-V1`)
 * and Live Cloud PostgreSQL (`UAS-BACKUP-PG-V3` via `pg_dump`, or `UAS-BACKUP-V2` JSON when `forcePortableV2` is set).
 */
export async function createPortableUasbakEnvelope(params?: {
  companyName?: string;
  licenseId?: string;
  tenantId?: string;
  forcePortableV2?: boolean;
}): Promise<{
  envelope: UasbakEnvelope | UasbakPortableEnvelopeV2 | UasbakPgDumpEnvelopeV3;
  filename: string;
}> {
  if (!isSqliteRuntime() && !params?.forcePortableV2) {
    const pgSnap = await createPostgresPgDumpSnapshot(params);
    return { envelope: pgSnap.envelope, filename: pgSnap.filename };
  }

  if (isSqliteRuntime() && !params?.forcePortableV2) {
    return createUasbakEnvelope(params);
  }

  const activeTenant = params?.tenantId || getActiveTenantId();
  const tenantSlug = normalizeBackupTenantSlug(activeTenant);
  const { backup, filename: jsonName } = await exportFullSchemaJsonBackup(params);
  const serialized = JSON.stringify(backup);
  const sha256 = crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  const filename = jsonName.replace(/\.json$/i, ".uasbak");
  const engine = isSqliteRuntime() ? "sqlite" : "postgresql";

  const manifest: UasbakManifest = {
    tenantSlug,
    tenantId: activeTenant,
    companyName: backup.companyName,
    licenseId: backup.licenseId,
    engine,
    createdAt: backup.createdAt,
    schemaVersion: UAS_BACKUP_SCHEMA_VERSION,
    sha256,
    sizeBytes,
  };

  const envelope: UasbakPortableEnvelopeV2 = {
    format: "UAS-BACKUP-V2",
    manifest,
    engine,
    schemaVersion: UAS_BACKUP_SCHEMA_VERSION,
    createdAt: backup.createdAt,
    companyName: backup.companyName,
    licenseId: backup.licenseId,
    tenantId: activeTenant,
    tenantSlug,
    sha256,
    sizeBytes,
    schemaBackup: backup,
  };

  return { envelope, filename };
}

export async function createScheduledAutoBackupForActiveTenant(date: Date = new Date()): Promise<{
  tenantSlug: string;
  filename: string;
  filePath: string;
  engine: "postgresql" | "sqlite";
  sha256: string;
  sizeBytes: number;
}> {
  const activeTenant = getActiveTenantId();
  const tenantSlug = normalizeBackupTenantSlug(activeTenant);
  const dateStr = date.toISOString().slice(0, 10);
  const prefix = `uas-auto-${tenantSlug}-${dateStr}`;
  const filename = `${prefix}.uasbak`;

  if (!isSqliteRuntime()) {
    const snap = await createPostgresPgDumpSnapshot({
      tenantId: activeTenant,
      filenamePrefix: prefix,
    });
    const filePath = await saveBackupEnvelopeToTenantDir(filename, snap.envelope, activeTenant);
    return {
      tenantSlug,
      filename,
      filePath,
      engine: "postgresql",
      sha256: snap.sha256,
      sizeBytes: snap.sizeBytes,
    };
  }

  const envRes = await createUasbakEnvelope({ tenantId: activeTenant });
  const filePath = await saveBackupEnvelopeToTenantDir(filename, envRes.envelope, activeTenant);
  return {
    tenantSlug,
    filename,
    filePath,
    engine: "sqlite",
    sha256: envRes.envelope.sha256,
    sizeBytes: envRes.envelope.sizeBytes,
  };
}

/**
 * Extracts a `FullSchemaBackupData` payload from a SQLite binary buffer so a `.uasbak`
 * taken from Local SQLite or Office LAN can be restored directly into a PostgreSQL cloud tenant DB.
 */
export function extractFullSchemaFromSqliteBuffer(
  buffer: Buffer,
  expectedCompanyName?: string
): FullSchemaBackupData {
  const inspection = validateAndInspectCandidateDb(buffer, expectedCompanyName);
  if (!inspection.ok) {
    throw new Error(inspection.error || "Invalid SQLite backup file");
  }

  const tempPath = path.join(
    os.tmpdir(),
    `uas-xengine-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`
  );
  fs.writeFileSync(tempPath, buffer);

  const tables: Record<string, unknown[]> = {};
  const tableCounts: Record<string, number> = {};
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(tempPath, { readOnly: true });
    for (const modelKey of FULL_SCHEMA_TABLE_ORDER) {
      const tableName = modelKey.charAt(0).toUpperCase() + modelKey.slice(1);
      try {
        const rows = db.prepare(`SELECT * FROM "${tableName}";`).all();
        tables[modelKey] = rows;
        tableCounts[modelKey] = rows.length;
      } catch {
        tables[modelKey] = [];
        tableCounts[modelKey] = 0;
      }
    }
  } finally {
    if (db) {
      try {
        db.close();
      } catch { }
    }
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch { }
  }

  return {
    format: "UAS-FULL-SCHEMA-JSON-V1",
    version: "3.0.0",
    createdAt: new Date().toISOString(),
    companyName: inspection.companyName || expectedCompanyName || "UAS-Enterprise",
    licenseId: "PORTABLE-RESTORE",
    tenantId: getActiveTenantId(),
    tableCounts,
    tables,
  };
}

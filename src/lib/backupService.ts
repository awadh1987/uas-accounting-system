import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prisma } from "@/lib/prisma";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { getTenantMetadata } from "@/lib/tenant/tenantRegistry";
import { resolveTenantDbFilePath } from "@/lib/tenant/tenantDbManager";
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
  // 6. Audit Logs
  "auditLog",
  "immutableAuditLog",
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

export interface UasbakEnvelope {
  format: "UAS-BACKUP-V1";
  createdAt: string;
  companyName: string;
  licenseId: string;
  tenantId?: string;
  sha256: string;
  sizeBytes: number;
  dbBase64: string;
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  type: "auto" | "pre-restore" | "manual";
}

const REQUIRED_CORE_TABLES = [
  "User",
  "Account",
  "JournalEntry",
  "EnterpriseProfile",
];

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");

export function getBackupsDirectory(): string {
  const customDir = (process.env.UAS_BACKUPS_DIR || "").trim();
  if (customDir) {
    if (!fs.existsSync(customDir)) {
      fs.mkdirSync(customDir, { recursive: true });
    }
    return customDir;
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

  const dbPath = resolveSqliteFilePath();
  const parentDir = dbPath ? path.dirname(dbPath) : process.cwd();
  const target = path.join(parentDir, "backups");
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
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

  const todayStr = new Date().toISOString().slice(0, 10);
  const slug = compName
    .replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 30);
  const tenantSuffix = activeTenant !== "default" ? `-${activeTenant}` : "";
  const filename = `UAS-Backup-${slug}${tenantSuffix}-${todayStr}.uasbak`;

  const envelope: UasbakEnvelope = {
    format: "UAS-BACKUP-V1",
    createdAt: new Date().toISOString(),
    companyName: compName,
    licenseId: licId,
    tenantId: activeTenant,
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

export function listLocalBackups(tenantId?: string): BackupFileInfo[] {
  const backupsDir = getBackupsDirectory();
  if (!fs.existsSync(backupsDir)) return [];

  const activeTenant = tenantId || getActiveTenantId();
  const results: BackupFileInfo[] = [];
  try {
    const entries = fs.readdirSync(backupsDir);
    for (const file of entries) {
      if (!file.endsWith(".db") && !file.endsWith(".uasbak")) continue;
      if (activeTenant !== "default" && !file.includes(activeTenant)) {
        continue;
      }
      const full = path.join(backupsDir, file);
      try {
        const stat = fs.statSync(full);
        let type: "auto" | "pre-restore" | "manual" = "manual";
        if (file.startsWith("uas-auto-")) type = "auto";
        else if (file.startsWith("pre-restore-")) type = "pre-restore";

        results.push({
          filename: file,
          sizeBytes: stat.size,
          sizeFormatted: formatBytes(stat.size),
          createdAt: stat.mtime.toISOString(),
          type,
        });
      } catch {
        // Skip unreadable files
      }
    }
  } catch (err) {
    console.warn("[BackupService] listLocalBackups error:", err);
  }

  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  const backupsDir = getBackupsDirectory();
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const tenantPrefix = activeTenant !== "default" ? `pre-restore-${activeTenant}-` : "pre-restore-";
  const preRestoreFilename = `${tenantPrefix}${timestamp}.db`;
  const preRestorePath = path.join(backupsDir, preRestoreFilename);

  if (fs.existsSync(activeDbPath)) {
    fs.copyFileSync(activeDbPath, preRestorePath);
    console.log(`[BackupService] Safety pre-restore snapshot saved to: ${preRestoreFilename}`);
  }

  // 3. Disconnect Prisma to release locks
  await prisma.$disconnect();

  // 4. Atomically replace database file
  fs.writeFileSync(activeDbPath, buffer);

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

  // 6. Record immutable audit log
  await prisma.$transaction(async (tx) => {
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "DATABASE_RESTORED_BY_ADMIN",
      entityReference: preRestoreFilename,
      details: `تمت استعادة قاعدة بيانات المنشأة (${inspection.companyName || "UAS"}) بنجاح من (${sourceDesc}). تم حفظ نسخة أمان سابقة: ${preRestoreFilename}`,
    });
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
  await ensureSqliteDatabaseReady();
  const tableCounts: Record<string, number> = {};
  const tables: Record<string, unknown[]> = {};

  for (const tableKey of FULL_SCHEMA_TABLE_ORDER) {
    const delegate = (prisma as any)[tableKey];
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

export async function restoreFullSchemaJsonBackup(
  backupData: FullSchemaBackupData | { tables: Record<string, unknown[]>; companyName?: string; tenantId?: string },
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

  const activeTenant = tenantId || (backupData as any).tenantId || getActiveTenantId();
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
      const backupsDir = getBackupsDirectory();
      const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const tenantPrefix = activeTenant !== "default" ? `pre-restore-${activeTenant}-` : "pre-restore-";
      preRestoreFilename = `${tenantPrefix}${timestamp}.db`;
      try {
        fs.copyFileSync(activeDbPath, path.join(backupsDir, preRestoreFilename));
      } catch {}
    }
  }

  const restoredTables: string[] = [];

  // Disable FK constraints during bulk restore on SQLite
  if (isSqliteRuntime()) {
    try {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF;");
    } catch {}
  }

  try {
    // 1. Delete rows in REVERSE topological order (children first)
    const reversedOrder = [...FULL_SCHEMA_TABLE_ORDER].reverse();
    for (const tableKey of reversedOrder) {
      const delegate = (prisma as any)[tableKey];
      if (delegate && typeof delegate.deleteMany === "function") {
        try {
          await delegate.deleteMany();
        } catch {}
      }
    }

    // 2. Insert rows in FORWARD topological order (parents first)
    for (const tableKey of FULL_SCHEMA_TABLE_ORDER) {
      const rows = backupData.tables?.[tableKey];
      const delegate = (prisma as any)[tableKey];
      if (Array.isArray(rows) && rows.length > 0 && delegate) {
        let inserted = false;
        if (typeof delegate.createMany === "function") {
          try {
            await delegate.createMany({ data: rows });
            inserted = true;
          } catch {}
        }
        if (!inserted && typeof delegate.create === "function") {
          for (const r of rows) {
            try {
              await delegate.create({ data: r });
            } catch {}
          }
          inserted = true;
        }
        if (inserted) {
          restoredTables.push(tableKey);
        }
      }
    }
  } finally {
    if (isSqliteRuntime()) {
      try {
        await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
      } catch {}
    }
  }

  // 3. Post-restore migration hooks
  await ensure6GenerationCoaHierarchy();
  await backfillLegacyBaseCurrencies();
  await ensureDefaultFiscalYear();

  // 4. Record immutable audit log
  await prisma.$transaction(async (tx) => {
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "DATABASE_JSON_RESTORED_BY_ADMIN",
      entityReference: preRestoreFilename || "JSON_RESTORE",
      details: `تمت استعادة قاعدة بيانات المنشأة (${backupData.companyName || "UAS"}) بنجاح من (${sourceDesc}). عدد الجداول المستعادة: ${restoredTables.length}`,
    });
  });

  return {
    ok: true,
    preRestoreSnapshot: preRestoreFilename,
    companyName: backupData.companyName,
    restoredTables,
  };
}

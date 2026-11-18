import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prisma } from "@/lib/prisma";
import {
  ensureSqliteDatabaseReady,
  isSqliteRuntime,
  resetSqliteBootstrapCacheForTests,
  resolveSqliteFilePath,
} from "@/lib/sqliteBootstrap";
import { companyNamesMatch } from "@/lib/licensing/licenseSchema";
import { loadInstalledLicense } from "@/lib/licensing/verifier";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export interface UasbakEnvelope {
  format: "UAS-BACKUP-V1";
  createdAt: string;
  companyName: string;
  licenseId: string;
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
}): Promise<{
  envelope: UasbakEnvelope;
  filename: string;
}> {
  const { sha256, sizeBytes, buffer } = await createTempBackupSnapshot();

  let compName = (params?.companyName || "").trim();
  let licId = (params?.licenseId || "").trim();

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
  const filename = `UAS-Backup-${slug}-${todayStr}.uasbak`;

  const envelope: UasbakEnvelope = {
    format: "UAS-BACKUP-V1",
    createdAt: new Date().toISOString(),
    companyName: compName,
    licenseId: licId,
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

export function listLocalBackups(): BackupFileInfo[] {
  const backupsDir = getBackupsDirectory();
  if (!fs.existsSync(backupsDir)) return [];

  const results: BackupFileInfo[] = [];
  try {
    const entries = fs.readdirSync(backupsDir);
    for (const file of entries) {
      if (!file.endsWith(".db") && !file.endsWith(".uasbak")) continue;
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
  sourceDesc: string
): Promise<{
  ok: boolean;
  preRestoreSnapshot: string;
  companyName?: string;
}> {
  if (!isSqliteRuntime()) {
    throw new Error("Database restore is only supported on SQLite runtime");
  }

  const activeDbPath = resolveSqliteFilePath();
  if (!activeDbPath) {
    throw new Error("Unable to resolve active SQLite database path");
  }

  // Load installed license to enforce company lock on restore
  const { license } = loadInstalledLicense();
  const expectedCompany = license?.company_name;

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
  const preRestoreFilename = `pre-restore-${timestamp}.db`;
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

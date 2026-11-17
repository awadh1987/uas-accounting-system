import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { STANDARD_COA_NODES } from "@/lib/accounting/coaCatalog";
import {
  EMBEDDED_SQLITE_MIGRATION_SQL,
  INITIAL_MIGRATION_NAME,
} from "@/lib/sqliteInitSql";

const REQUIRED_CORE_TABLES = [
  "EnterpriseProfile",
  "SystemSettings",
  "LicenseState",
  "Account",
  "Project",
  "User",
  "TreasuryAccount",
  "CurrencyRate",
  "JournalEntry",
  "ImmutableAuditLog",
];

const globalForSqliteInit = globalThis as unknown as {
  __uasSqliteInitReady?: boolean;
  __uasSqliteInitPromise?: Promise<void>;
  __uasSqliteInitDbUrl?: string;
};

export function isSqliteRuntime(): boolean {
  const url = (process.env.DATABASE_URL || "").trim().toLowerCase();
  if (!url) return true;
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    return false;
  }
  return url.startsWith("file:") || !url.includes("://");
}

function resolveSqliteFilePath(): string | null {
  const raw = (process.env.DATABASE_URL || "").trim();
  if (!raw) return null;
  if (!raw.toLowerCase().startsWith("file:")) return null;

  let filePart = raw.slice(5); // strip "file:"
  const qIdx = filePart.indexOf("?");
  if (qIdx >= 0) filePart = filePart.slice(0, qIdx);
  if (!filePart || filePart === ":memory:") return null;

  // Handle file:///C:/... or file:C:/... or file:./dev.db
  if (/^\/[A-Za-z]:/.test(filePart)) {
    filePart = filePart.slice(1);
  }

  if (path.isAbsolute(filePart)) {
    return filePart;
  }

  // Relative paths in Prisma SQLite URLs are resolved relative to prisma/ when using schema,
  // or cwd depending on invocation. Ensure both parent directory candidates exist safely.
  const prismaRelative = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "prisma", filePart);
  const cwdRelative = path.resolve(/*turbopackIgnore: true*/ process.cwd(), filePart);
  return fs.existsSync(/*turbopackIgnore: true*/ path.dirname(prismaRelative))
    ? prismaRelative
    : cwdRelative;
}

function ensureDatabaseDirectoryExists(): void {
  const dbPath = resolveSqliteFilePath();
  if (!dbPath) return;
  const dir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    }
  } catch (err) {
    console.warn("[SQLite Bootstrap] Could not create DB parent dir:", err);
  }
}

interface MigrationFile {
  name: string;
  sql: string;
}

function loadMigrationFilesFromDisk(): MigrationFile[] {
  const candidateRoots = [
    path.resolve(process.cwd(), "prisma", "migrations"),
    path.resolve(process.cwd(), "migrations"),
  ];
  if (process.platform === "win32") {
    candidateRoots.push("C:\\UAS\\app\\prisma\\migrations");
  }

  for (const root of candidateRoots) {
    try {
      if (!fs.existsSync(/*turbopackIgnore: true*/ root)) continue;
      const entries = fs
        .readdirSync(/*turbopackIgnore: true*/ root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(); // chronological order (YYYYMMDDHHMMSS_name)

      const migrations: MigrationFile[] = [];
      for (const dirName of entries) {
        const sqlFile = path.join(root, dirName, "migration.sql");
        if (fs.existsSync(/*turbopackIgnore: true*/ sqlFile)) {
          const sql = fs.readFileSync(/*turbopackIgnore: true*/ sqlFile, "utf8");
          if (sql.trim().length > 0) {
            migrations.push({ name: dirName, sql });
          }
        }
      }
      if (migrations.length > 0) {
        return migrations;
      }
    } catch {
      // Try next candidate
    }
  }

  // Zero-dependency embedded fallback compiled directly into the standalone bundle
  return [
    {
      name: INITIAL_MIGRATION_NAME,
      sql: EMBEDDED_SQLITE_MIGRATION_SQL,
    },
  ];
}

function splitSqlStatements(rawSql: string): string[] {
  // Strip UTF-8 BOM if present
  const clean = rawSql.replace(/^\uFEFF/, "");
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  const lines = clean.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inSingleQuote && !inDoubleQuote && (trimmed.startsWith("--") || trimmed === "")) {
      continue;
    }

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        current += ch;
      } else if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += ch;
      } else if (ch === ";" && !inSingleQuote && !inDoubleQuote) {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = "";
      } else {
        current += ch;
      }
    }
    current += "\n";
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function makeStatementIdempotent(stmt: string): string {
  return stmt
    .replace(/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")
    .replace(
      /^CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i,
      "CREATE UNIQUE INDEX IF NOT EXISTS "
    )
    .replace(/^CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE INDEX IF NOT EXISTS ");
}

async function applyMigrationsIfNeeded(missingCoreTables: boolean): Promise<void> {
  // Ensure _prisma_migrations tracking table exists
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  const appliedRows = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
    `SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`
  );
  const appliedSet = new Set(appliedRows.map((r) => r.migration_name));
  const migrations = loadMigrationFilesFromDisk();

  for (const migration of migrations) {
    if (!missingCoreTables && appliedSet.has(migration.name)) {
      continue;
    }

    const statements = splitSqlStatements(migration.sql);
    let appliedSteps = 0;

    for (const rawStmt of statements) {
      const idempotentStmt = makeStatementIdempotent(rawStmt);
      try {
        await prisma.$executeRawUnsafe(idempotentStmt);
        appliedSteps++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Ignore already-exists errors during idempotent self-healing
        if (
          msg.includes("already exists") ||
          msg.includes("duplicate column name")
        ) {
          appliedSteps++;
          continue;
        }
        throw err;
      }
    }

    if (!appliedSet.has(migration.name)) {
      const checksum = crypto
        .createHash("sha256")
        .update(migration.sql, "utf8")
        .digest("hex");
      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();

      await prisma.$executeRawUnsafe(
        `INSERT OR IGNORE INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "started_at", "applied_steps_count") VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        id,
        checksum,
        nowIso,
        migration.name,
        nowIso,
        appliedSteps
      );
      appliedSet.add(migration.name);
    }

    console.log(
      `[SQLite Bootstrap] Applied migration ${migration.name} (${appliedSteps} statements).`
    );
  }
}

async function seedDefaultBaselineRecords(): Promise<void> {
  // 1. EnterpriseProfile (id: "default")
  await prisma.enterpriseProfile.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      legalNameAr: "اسم المنشأة",
      legalNameEn: "Enterprise Name",
      taxNumber: "",
      commercialReg: "",
      currencyCode: "YER",
      isConfigured: false,
      address: "",
      phone: "",
      email: "",
      logoUrl: "/uas-logo.png",
      brandColor: "#059669",
      contactPhone: "",
      contactWhatsApp: "",
      contactAddress: "",
    },
  });

  // 2. SystemSettings (id: "default")
  await prisma.systemSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      orgName: "النظام المحاسبي الموحد (UAS Enterprise)",
      logoText: "UAS",
      defaultLang: "ar",
      defaultTheme: "emerald",
      defaultCurrency: "YER",
    },
  });

  // 3. LicenseState (id: "active")
  await prisma.licenseState.upsert({
    where: { id: "active" },
    update: {},
    create: {
      id: "active",
      status: "UNLICENSED",
      seatRegistryJson: "[]",
    },
  });

  // 4. Default Exchange Rates (only if empty)
  const ratesCount = await prisma.currencyRate.count();
  if (ratesCount === 0) {
    await prisma.currencyRate.createMany({
      data: [
        { currencyCode: "YER", rateToYER: 1 },
        { currencyCode: "SAR", rateToYER: 425 },
        { currencyCode: "USD", rateToYER: 1620 },
      ],
    });
  }

  // 5. Complete 6-Generation Chart of Accounts (only if empty)
  const accountCount = await prisma.account.count();
  if (accountCount === 0) {
    const accountIdByCode = new Map<string, string>();
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const nodes = STANDARD_COA_NODES.filter((n) => n.level === level);
      for (const node of nodes) {
        const parentId = node.parentCode
          ? (accountIdByCode.get(node.parentCode) ?? null)
          : null;
        const created = await prisma.account.create({
          data: {
            code: node.code,
            nameAr: node.nameAr,
            nameEn: node.nameEn,
            level: node.level,
            type: node.type,
            isPosting: node.isPosting,
            parentCode: node.parentCode,
            parentId,
          },
        });
        accountIdByCode.set(node.code, created.id);
      }
    }

    // 6. Main Cash Vault linked to COA 111101 (only if empty)
    const treasuryCount = await prisma.treasuryAccount.count();
    const cashAccId = accountIdByCode.get("111101");
    if (treasuryCount === 0 && cashAccId) {
      await prisma.treasuryAccount.create({
        data: {
          id: "t1",
          code: "TR-VAULT-YER",
          name: "الصندوق الرئيسي - يمني (Main Cash Vault - YER)",
          nameAr: "الصندوق الرئيسي - يمني",
          nameEn: "Main Cash Vault - YER",
          type: "VAULT",
          providerNameAr: "الخزينة النقدية الرئيسية",
          providerNameEn: "Main Cash Vault",
          accountHolderName: "الإدارة المالية",
          accountNumber: "CASH-01",
          branchOrAgent: "المركز الرئيسي",
          transferFeePercent: 0,
          dailyLimit: 0,
          isDefaultReceipts: true,
          isDefaultPayments: true,
          isActive: true,
          accountId: cashAccId,
          currency: "YER",
          currencyCode: "YER",
          balance: 0,
          balanceYER: 0,
        },
      });
    }
  }

  // 7. Initial ImmutableAuditLog entry (only if empty)
  const auditCount = await prisma.immutableAuditLog.count();
  if (auditCount === 0) {
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const hash =
      "SHA256-" +
      crypto
        .createHash("sha256")
        .update("UAS-ZERO-BASELINE-2026")
        .digest("hex")
        .slice(0, 12)
        .toUpperCase();

    await prisma.immutableAuditLog.create({
      data: {
        id: "aud-zero-init",
        timestamp: nowStr,
        userId: "u1",
        userDisplay: "مدير النظام العام (SUPER_ADMIN)",
        userRole: "SUPER_ADMIN",
        actionType: "تهيئة النظام المحاسبي (وضع البداية الصفرية)",
        entityReference: "COA-6GEN-ZERO",
        details:
          "تم تهيئة شجرة الحسابات سداسية الأجيال (6-Generation COA) والصندوق الرئيسي (0.00) بنجاح عبر التهيئة الذاتية.",
        sha256Hash: hash,
      },
    });
  }
}

async function runSelfHealingBootstrap(): Promise<void> {
  if (!isSqliteRuntime()) return;

  ensureDatabaseDirectoryExists();

  // Enable foreign keys & WAL journal mode for reliability under concurrent LAN access
  try {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
    await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
    await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
  } catch {
    // Some SQLite environments may restrict WAL; non-fatal
  }

  const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  const existingTableNames = new Set(tables.map((t) => t.name));
  const missingTables = REQUIRED_CORE_TABLES.filter(
    (table) => !existingTableNames.has(table)
  );

  if (missingTables.length > 0) {
    console.log(
      `[SQLite Bootstrap] Missing core tables detected (${missingTables.join(", ")}). Running zero-CLI pure-runtime schema initialization...`
    );
    await applyMigrationsIfNeeded(true);
    await seedDefaultBaselineRecords();
    console.log("[SQLite Bootstrap] Self-healing SQLite initialization completed successfully.");
  } else {
    // Check if any new migration files need to be applied, and ensure baseline singletons exist
    await applyMigrationsIfNeeded(false);
    await seedDefaultBaselineRecords();
  }
}

export async function ensureSqliteDatabaseReady(): Promise<void> {
  if (!isSqliteRuntime()) return;

  const currentDbUrl = process.env.DATABASE_URL || "";
  if (
    globalForSqliteInit.__uasSqliteInitReady &&
    globalForSqliteInit.__uasSqliteInitDbUrl === currentDbUrl
  ) {
    return;
  }

  if (
    !globalForSqliteInit.__uasSqliteInitPromise ||
    globalForSqliteInit.__uasSqliteInitDbUrl !== currentDbUrl
  ) {
    globalForSqliteInit.__uasSqliteInitDbUrl = currentDbUrl;
    globalForSqliteInit.__uasSqliteInitReady = false;
    globalForSqliteInit.__uasSqliteInitPromise = runSelfHealingBootstrap()
      .then(() => {
        globalForSqliteInit.__uasSqliteInitReady = true;
      })
      .catch((err) => {
        // Reset promise so subsequent request can retry if transient lock occurred
        globalForSqliteInit.__uasSqliteInitPromise = undefined;
        globalForSqliteInit.__uasSqliteInitReady = false;
        console.error("[SQLite Bootstrap] Initialization error:", err);
        throw err;
      });
  }

  await globalForSqliteInit.__uasSqliteInitPromise;
}

export function resetSqliteBootstrapCacheForTests(): void {
  globalForSqliteInit.__uasSqliteInitReady = false;
  globalForSqliteInit.__uasSqliteInitPromise = undefined;
  globalForSqliteInit.__uasSqliteInitDbUrl = undefined;
}

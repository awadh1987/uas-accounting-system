import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/tenant/tenantContext";
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
  "LicenseDeviceBinding",
  "SyncChangeLog",
  "SyncConflict",
  "NotificationEvent",
  "TenantDevice",
];

const globalForSqliteInit = globalThis as unknown as {
  __uasSqliteInitReady?: boolean;
  __uasSqliteInitPromise?: Promise<void>;
  __uasSqliteInitDbUrl?: string;
};

export function isSqliteRuntime(): boolean {
  const url = (process.env.DATABASE_URL || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  if (!url) return true;
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    return false;
  }
  return url.startsWith("file:") || !url.includes("://");
}

export function resolveSqliteFilePath(): string | null {
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
      faviconUrl: null,
      brandColor: "#059669",
      taglineAr: "",
      taglineEn: "",
      showUasLogo: true,
      uasLogoStyle: "official-brand",
      showEnterpriseLogo: false,
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
            generation: node.level,
            isPostable: node.isPosting,
            parentAccountId: parentId,
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

async function ensureAdditiveColumns(client: {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}): Promise<void> {
  const specs: Array<{ table: string; columns: Array<{ name: string; ddl: string }> }> = [
    {
      table: "EnterpriseProfile",
      columns: [
        { name: "tenantSlug", ddl: 'ALTER TABLE "EnterpriseProfile" ADD COLUMN "tenantSlug" TEXT' },
        {
          name: "welcomeNoticeAr",
          ddl: 'ALTER TABLE "EnterpriseProfile" ADD COLUMN "welcomeNoticeAr" TEXT NOT NULL DEFAULT \'\'',
        },
        {
          name: "welcomeNoticeEn",
          ddl: 'ALTER TABLE "EnterpriseProfile" ADD COLUMN "welcomeNoticeEn" TEXT NOT NULL DEFAULT \'\'',
        },
        {
          name: "supportEmail",
          ddl: 'ALTER TABLE "EnterpriseProfile" ADD COLUMN "supportEmail" TEXT NOT NULL DEFAULT \'\'',
        },
        {
          name: "faviconUrl",
          ddl: 'ALTER TABLE "EnterpriseProfile" ADD COLUMN "faviconUrl" TEXT',
        },
        {
          name: "taglineAr",
          ddl: 'ALTER TABLE "EnterpriseProfile" ADD COLUMN "taglineAr" TEXT NOT NULL DEFAULT \'\'',
        },
        {
          name: "taglineEn",
          ddl: 'ALTER TABLE "EnterpriseProfile" ADD COLUMN "taglineEn" TEXT NOT NULL DEFAULT \'\'',
        },
      ],
    },
    {
      table: "SystemSettings",
      columns: [
        {
          name: "autoSyncEnabled",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "autoSyncEnabled" INTEGER NOT NULL DEFAULT 1',
        },
        {
          name: "autoSyncIntervalSec",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "autoSyncIntervalSec" INTEGER NOT NULL DEFAULT 60',
        },
        {
          name: "defaultDeviceSyncMode",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "defaultDeviceSyncMode" TEXT NOT NULL DEFAULT \'AUTO\'',
        },
        {
          name: "requireDeviceApproval",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "requireDeviceApproval" INTEGER NOT NULL DEFAULT 0',
        },
        {
          name: "tenantAdminConfigJson",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "tenantAdminConfigJson" TEXT NOT NULL DEFAULT \'{}\'',
        },
        {
          name: "enforceThreeWayMatch",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "enforceThreeWayMatch" INTEGER NOT NULL DEFAULT 1',
        },
        {
          name: "threeWayTolerancePct",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "threeWayTolerancePct" REAL NOT NULL DEFAULT 0',
        },
        {
          name: "threeWayToleranceAmount",
          ddl: 'ALTER TABLE "SystemSettings" ADD COLUMN "threeWayToleranceAmount" REAL NOT NULL DEFAULT 0.01',
        },
      ],
    },
    {
      table: "JournalEntry",
      columns: [
        {
          name: "isReversed",
          ddl: 'ALTER TABLE "JournalEntry" ADD COLUMN "isReversed" INTEGER NOT NULL DEFAULT 0',
        },
        {
          name: "reversedByEntryId",
          ddl: 'ALTER TABLE "JournalEntry" ADD COLUMN "reversedByEntryId" TEXT',
        },
      ],
    },
    {
      table: "GoodsReceipt",
      columns: [
        { name: "warehouseId", ddl: 'ALTER TABLE "GoodsReceipt" ADD COLUMN "warehouseId" TEXT' },
        { name: "journalEntryId", ddl: 'ALTER TABLE "GoodsReceipt" ADD COLUMN "journalEntryId" TEXT' },
        { name: "itemsJson", ddl: 'ALTER TABLE "GoodsReceipt" ADD COLUMN "itemsJson" TEXT' },
      ],
    },
    {
      table: "VendorBill",
      columns: [
        { name: "billType", ddl: 'ALTER TABLE "VendorBill" ADD COLUMN "billType" TEXT NOT NULL DEFAULT \'BILL\'' },
        { name: "originalBillId", ddl: 'ALTER TABLE "VendorBill" ADD COLUMN "originalBillId" TEXT' },
        { name: "subTotal", ddl: 'ALTER TABLE "VendorBill" ADD COLUMN "subTotal" REAL NOT NULL DEFAULT 0' },
        { name: "taxAmount", ddl: 'ALTER TABLE "VendorBill" ADD COLUMN "taxAmount" REAL NOT NULL DEFAULT 0' },
        { name: "whtAmount", ddl: 'ALTER TABLE "VendorBill" ADD COLUMN "whtAmount" REAL NOT NULL DEFAULT 0' },
      ],
    },
    {
      table: "PaymentVoucher",
      columns: [
        { name: "allocationsJson", ddl: 'ALTER TABLE "PaymentVoucher" ADD COLUMN "allocationsJson" TEXT' },
      ],
    },
    {
      table: "SalesInvoice",
      columns: [
        { name: "invoiceType", ddl: 'ALTER TABLE "SalesInvoice" ADD COLUMN "invoiceType" TEXT NOT NULL DEFAULT \'INVOICE\'' },
        { name: "originalInvoiceId", ddl: 'ALTER TABLE "SalesInvoice" ADD COLUMN "originalInvoiceId" TEXT' },
        { name: "dueDate", ddl: 'ALTER TABLE "SalesInvoice" ADD COLUMN "dueDate" DATETIME' },
        { name: "subTotal", ddl: 'ALTER TABLE "SalesInvoice" ADD COLUMN "subTotal" REAL NOT NULL DEFAULT 0' },
        { name: "taxAmount", ddl: 'ALTER TABLE "SalesInvoice" ADD COLUMN "taxAmount" REAL NOT NULL DEFAULT 0' },
        { name: "whtAmount", ddl: 'ALTER TABLE "SalesInvoice" ADD COLUMN "whtAmount" REAL NOT NULL DEFAULT 0' },
        { name: "cogsJournalEntryId", ddl: 'ALTER TABLE "SalesInvoice" ADD COLUMN "cogsJournalEntryId" TEXT' },
      ],
    },
    {
      table: "ReceiptVoucher",
      columns: [
        { name: "allocationsJson", ddl: 'ALTER TABLE "ReceiptVoucher" ADD COLUMN "allocationsJson" TEXT' },
      ],
    },
    {
      table: "InventoryLot",
      columns: [
        { name: "itemId", ddl: 'ALTER TABLE "InventoryLot" ADD COLUMN "itemId" TEXT' },
        { name: "warehouseId", ddl: 'ALTER TABLE "InventoryLot" ADD COLUMN "warehouseId" TEXT' },
        { name: "receivedDate", ddl: 'ALTER TABLE "InventoryLot" ADD COLUMN "receivedDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP' },
      ],
    },
    {
      table: "OperatingExpense",
      columns: [
        { name: "taxCodeId", ddl: 'ALTER TABLE "OperatingExpense" ADD COLUMN "taxCodeId" TEXT' },
        { name: "netAmount", ddl: 'ALTER TABLE "OperatingExpense" ADD COLUMN "netAmount" REAL NOT NULL DEFAULT 0' },
        { name: "taxAmount", ddl: 'ALTER TABLE "OperatingExpense" ADD COLUMN "taxAmount" REAL NOT NULL DEFAULT 0' },
        { name: "whtAmount", ddl: 'ALTER TABLE "OperatingExpense" ADD COLUMN "whtAmount" REAL NOT NULL DEFAULT 0' },
        { name: "documentStatus", ddl: 'ALTER TABLE "OperatingExpense" ADD COLUMN "documentStatus" TEXT NOT NULL DEFAULT \'POSTED\'' },
      ],
    },
    {
      table: "WorkerWageEntry",
      columns: [
        { name: "documentStatus", ddl: 'ALTER TABLE "WorkerWageEntry" ADD COLUMN "documentStatus" TEXT NOT NULL DEFAULT \'POSTED\'' },
      ],
    },
    {
      table: "TenantDevice",
      columns: [
        { name: "activationKey", ddl: 'ALTER TABLE "TenantDevice" ADD COLUMN "activationKey" TEXT' },
      ],
    },
    {
      table: "User",
      columns: [
        { name: "displayName", ddl: 'ALTER TABLE "User" ADD COLUMN "displayName" TEXT' },
        { name: "phone", ddl: 'ALTER TABLE "User" ADD COLUMN "phone" TEXT' },
        { name: "isActive", ddl: 'ALTER TABLE "User" ADD COLUMN "isActive" INTEGER NOT NULL DEFAULT 1' },
        { name: "archivedAt", ddl: 'ALTER TABLE "User" ADD COLUMN "archivedAt" DATETIME' },
        { name: "avatarUrl", ddl: 'ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT' },
        { name: "avatarColor", ddl: 'ALTER TABLE "User" ADD COLUMN "avatarColor" TEXT NOT NULL DEFAULT \'#059669\'' },
        { name: "preferredLang", ddl: 'ALTER TABLE "User" ADD COLUMN "preferredLang" TEXT NOT NULL DEFAULT \'ar\'' },
        { name: "preferredCurrency", ddl: 'ALTER TABLE "User" ADD COLUMN "preferredCurrency" TEXT NOT NULL DEFAULT \'YER\'' },
        { name: "preferredTheme", ddl: 'ALTER TABLE "User" ADD COLUMN "preferredTheme" TEXT NOT NULL DEFAULT \'emerald\'' },
        { name: "defaultModule", ddl: 'ALTER TABLE "User" ADD COLUMN "defaultModule" TEXT' },
        { name: "lastLoginAt", ddl: 'ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME' },
        { name: "useCustomPermissions", ddl: 'ALTER TABLE "User" ADD COLUMN "useCustomPermissions" INTEGER NOT NULL DEFAULT 0' },
        { name: "customAllowedGroups", ddl: 'ALTER TABLE "User" ADD COLUMN "customAllowedGroups" TEXT NOT NULL DEFAULT \'[]\'' },
        { name: "customPermissionsJson", ddl: 'ALTER TABLE "User" ADD COLUMN "customPermissionsJson" TEXT NOT NULL DEFAULT \'{}\'' },
        { name: "mustChangePassword", ddl: 'ALTER TABLE "User" ADD COLUMN "mustChangePassword" INTEGER NOT NULL DEFAULT 0' },
        { name: "passwordUpdatedAt", ddl: 'ALTER TABLE "User" ADD COLUMN "passwordUpdatedAt" DATETIME' },
        { name: "assignedProjects", ddl: 'ALTER TABLE "User" ADD COLUMN "assignedProjects" TEXT NOT NULL DEFAULT \'[]\'' },
      ],
    },
    {
      table: "ClientGoodsRequest",
      columns: [
        { name: "linkedSalesRecordId", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "linkedSalesRecordId" TEXT' },
        { name: "linkedDraftId", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "linkedDraftId" TEXT' },
        { name: "creditPaidPlanned", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "creditPaidPlanned" DECIMAL NOT NULL DEFAULT 0' },
        { name: "debitPlanned", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "debitPlanned" DECIMAL NOT NULL DEFAULT 0' },
        { name: "approvedByUserId", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "approvedByUserId" TEXT' },
        { name: "approvedByName", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "approvedByName" TEXT' },
        { name: "approvedAt", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "approvedAt" DATETIME' },
        { name: "reviewerRemarks", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "reviewerRemarks" TEXT' },
        { name: "amendmentDiffJson", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "amendmentDiffJson" TEXT NOT NULL DEFAULT \'[]\'' },
        { name: "beforeSnapshotJson", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "beforeSnapshotJson" TEXT' },
        { name: "afterSnapshotJson", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "afterSnapshotJson" TEXT' },
        { name: "revisionNumber", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 1' },
        { name: "returnedToClientAt", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "returnedToClientAt" DATETIME' },
        { name: "returnedByUserId", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "returnedByUserId" TEXT' },
        { name: "returnedByName", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "returnedByName" TEXT' },
        { name: "clientResponseStatus", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "clientResponseStatus" TEXT' },
        { name: "clientResponseNote", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "clientResponseNote" TEXT' },
        { name: "clientRespondedAt", ddl: 'ALTER TABLE "ClientGoodsRequest" ADD COLUMN "clientRespondedAt" DATETIME' },
      ],
    },
    {
      table: "ClientPortalAccount",
      columns: [
        { name: "avatarUrl", ddl: 'ALTER TABLE "ClientPortalAccount" ADD COLUMN "avatarUrl" TEXT' },
        { name: "avatarColor", ddl: 'ALTER TABLE "ClientPortalAccount" ADD COLUMN "avatarColor" TEXT NOT NULL DEFAULT \'#059669\'' },
        { name: "mustChangePassword", ddl: 'ALTER TABLE "ClientPortalAccount" ADD COLUMN "mustChangePassword" INTEGER NOT NULL DEFAULT 0' },
        { name: "passwordUpdatedAt", ddl: 'ALTER TABLE "ClientPortalAccount" ADD COLUMN "passwordUpdatedAt" DATETIME' },
        { name: "sessionVersion", ddl: 'ALTER TABLE "ClientPortalAccount" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1' },
      ],
    },
  ];

  const additiveTables = [
    `CREATE TABLE IF NOT EXISTS "VendorBillItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "billId" TEXT NOT NULL,
      "itemId" TEXT,
      "warehouseId" TEXT,
      "taxCodeId" TEXT,
      "description" TEXT NOT NULL,
      "unitId" TEXT,
      "quantity" DECIMAL NOT NULL,
      "unitPrice" DECIMAL NOT NULL,
      "netAmount" DECIMAL NOT NULL,
      "taxAmount" DECIMAL NOT NULL DEFAULT 0,
      "whtAmount" DECIMAL NOT NULL DEFAULT 0,
      "totalAmount" DECIMAL NOT NULL,
      CONSTRAINT "VendorBillItem_billId_fkey" FOREIGN KEY ("billId") REFERENCES "VendorBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "VendorBillItem_billId_idx" ON "VendorBillItem"("billId")`,
    `CREATE TABLE IF NOT EXISTS "SalesInvoiceItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "invoiceId" TEXT NOT NULL,
      "itemId" TEXT,
      "warehouseId" TEXT,
      "taxCodeId" TEXT,
      "description" TEXT NOT NULL,
      "unitId" TEXT,
      "quantity" DECIMAL NOT NULL,
      "unitPrice" DECIMAL NOT NULL,
      "netAmount" DECIMAL NOT NULL,
      "taxAmount" DECIMAL NOT NULL DEFAULT 0,
      "whtAmount" DECIMAL NOT NULL DEFAULT 0,
      "totalAmount" DECIMAL NOT NULL,
      "costOfGoodsSold" DECIMAL NOT NULL DEFAULT 0,
      CONSTRAINT "SalesInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SalesInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "SalesInvoiceItem_invoiceId_idx" ON "SalesInvoiceItem"("invoiceId")`,
    `CREATE TABLE IF NOT EXISTS "AccountingPeriod" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "fiscalYearId" TEXT,
      "year" INTEGER NOT NULL,
      "month" INTEGER NOT NULL,
      "code" TEXT NOT NULL,
      "nameAr" TEXT NOT NULL,
      "nameEn" TEXT NOT NULL,
      "startDate" DATETIME NOT NULL,
      "endDate" DATETIME NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'OPEN',
      "closedById" TEXT,
      "closedAt" DATETIME,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "AccountingPeriod_code_key" ON "AccountingPeriod"("code")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "AccountingPeriod_year_month_key" ON "AccountingPeriod"("year", "month")`,
    `CREATE TABLE IF NOT EXISTS "TaxCode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL,
      "nameAr" TEXT NOT NULL,
      "nameEn" TEXT NOT NULL,
      "taxType" TEXT NOT NULL DEFAULT 'VAT',
      "ratePct" DECIMAL NOT NULL DEFAULT 0,
      "isCompound" INTEGER NOT NULL DEFAULT 0,
      "isInclusive" INTEGER NOT NULL DEFAULT 0,
      "salesTaxAccountCode" TEXT DEFAULT '214101',
      "purchaseTaxAccountCode" TEXT DEFAULT '114301',
      "whtAccountCode" TEXT DEFAULT '214201',
      "isActive" INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "TaxCode_code_key" ON "TaxCode"("code")`,
    `CREATE TABLE IF NOT EXISTS "TaxRate" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "taxCodeId" TEXT NOT NULL,
      "ratePct" DECIMAL NOT NULL,
      "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "effectiveTo" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TaxRate_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "ClientPortalAccount" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "customerId" TEXT,
      "fullName" TEXT NOT NULL,
      "tradeName" TEXT,
      "phone" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "avatarUrl" TEXT,
      "avatarColor" TEXT NOT NULL DEFAULT '#059669',
      "mustChangePassword" INTEGER NOT NULL DEFAULT 0,
      "passwordUpdatedAt" DATETIME,
      "sessionVersion" INTEGER NOT NULL DEFAULT 1,
      "clientType" TEXT NOT NULL DEFAULT 'DIRECT_CLIENT',
      "customClientType" TEXT,
      "preferredPickup" TEXT NOT NULL DEFAULT 'السوق',
      "customFieldsJson" TEXT NOT NULL DEFAULT '{}',
      "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      "notes" TEXT,
      "approvedById" TEXT,
      "approvedByName" TEXT,
      "approvedAt" DATETIME,
      "rejectedReason" TEXT,
      "lastLoginAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccount_phone_key" ON "ClientPortalAccount"("phone")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccount_email_key" ON "ClientPortalAccount"("email")`,
    `CREATE INDEX IF NOT EXISTS "ClientPortalAccount_status_createdAt_idx" ON "ClientPortalAccount"("status", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "ClientPortalAccount_customerId_idx" ON "ClientPortalAccount"("customerId")`,
    `CREATE TABLE IF NOT EXISTS "ClientPasswordResetToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "clientAccountId" TEXT NOT NULL,
      "codeHash" TEXT NOT NULL,
      "initiatedBy" TEXT NOT NULL DEFAULT 'SELF',
      "staffUserId" TEXT,
      "staffUserName" TEXT,
      "expiresAt" DATETIME NOT NULL,
      "usedAt" DATETIME,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClientPasswordResetToken_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientPortalAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "ClientPasswordResetToken_clientAccountId_createdAt_idx" ON "ClientPasswordResetToken"("clientAccountId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "ClientPasswordResetToken_expiresAt_idx" ON "ClientPasswordResetToken"("expiresAt")`,
    `CREATE TABLE IF NOT EXISTS "ClientGoodsRequest" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "requestNumber" TEXT NOT NULL,
      "clientAccountId" TEXT NOT NULL,
      "customerId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      "pickupType" TEXT NOT NULL DEFAULT 'MARKET',
      "pickupLocation" TEXT NOT NULL DEFAULT 'السوق',
      "pickupNotes" TEXT,
      "customDataJson" TEXT NOT NULL DEFAULT '{}',
      "reserveStock" BOOLEAN NOT NULL DEFAULT false,
      "reservedSummaryJson" TEXT NOT NULL DEFAULT '[]',
      "totalEstimated" DECIMAL NOT NULL DEFAULT 0,
      "totalConfirmed" DECIMAL NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'YER',
      "projectId" TEXT,
      "subProjectId" TEXT,
      "harvestName" TEXT,
      "linkedInvoiceId" TEXT,
      "linkedSaleId" TEXT,
      "linkedReceiptId" TEXT,
      "linkedSalesRecordId" TEXT,
      "linkedDraftId" TEXT,
      "creditPaidPlanned" DECIMAL NOT NULL DEFAULT 0,
      "debitPlanned" DECIMAL NOT NULL DEFAULT 0,
      "approvedByUserId" TEXT,
      "approvedByName" TEXT,
      "approvedAt" DATETIME,
      "reviewedById" TEXT,
      "reviewedByName" TEXT,
      "reviewedAt" DATETIME,
      "readyAt" DATETIME,
      "handedOverById" TEXT,
      "handedOverByName" TEXT,
      "handedOverAt" DATETIME,
      "staffNotes" TEXT,
      "reviewerRemarks" TEXT,
      "amendmentDiffJson" TEXT NOT NULL DEFAULT '[]',
      "beforeSnapshotJson" TEXT,
      "afterSnapshotJson" TEXT,
      "revisionNumber" INTEGER NOT NULL DEFAULT 1,
      "returnedToClientAt" DATETIME,
      "returnedByUserId" TEXT,
      "returnedByName" TEXT,
      "clientResponseStatus" TEXT,
      "clientResponseNote" TEXT,
      "clientRespondedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClientGoodsRequest_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientPortalAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "ClientGoodsRequest_requestNumber_key" ON "ClientGoodsRequest"("requestNumber")`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_clientAccountId_createdAt_idx" ON "ClientGoodsRequest"("clientAccountId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_customerId_status_idx" ON "ClientGoodsRequest"("customerId", "status")`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_status_createdAt_idx" ON "ClientGoodsRequest"("status", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequest_linkedSalesRecordId_idx" ON "ClientGoodsRequest"("linkedSalesRecordId")`,
    `CREATE TABLE IF NOT EXISTS "ClientGoodsRequestLine" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "requestId" TEXT NOT NULL,
      "lineOrder" INTEGER NOT NULL DEFAULT 1,
      "itemId" TEXT,
      "itemTitle" TEXT NOT NULL,
      "requestedQty" DECIMAL NOT NULL,
      "confirmedQty" DECIMAL,
      "unitCode" TEXT NOT NULL DEFAULT 'QAT_BUNCH',
      "unitLabel" TEXT NOT NULL DEFAULT 'علاقية قات',
      "customUnitLabel" TEXT,
      "unitPrice" DECIMAL NOT NULL DEFAULT 0,
      "lineTotal" DECIMAL NOT NULL DEFAULT 0,
      "notes" TEXT,
      CONSTRAINT "ClientGoodsRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ClientGoodsRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "ClientGoodsRequestLine_requestId_idx" ON "ClientGoodsRequestLine"("requestId")`,
    `CREATE TABLE IF NOT EXISTS "WhatsAppOutboxMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "draftNumber" TEXT NOT NULL,
      "eventType" TEXT NOT NULL,
      "clientAccountId" TEXT,
      "customerId" TEXT,
      "requestId" TEXT,
      "recipientName" TEXT NOT NULL,
      "recipientPhone" TEXT NOT NULL,
      "templateKey" TEXT,
      "originalMessageText" TEXT NOT NULL,
      "finalMessageText" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      "dispatchChannel" TEXT NOT NULL DEFAULT 'WHATSAPP_LINK',
      "approvedByUserId" TEXT,
      "approvedByName" TEXT,
      "approvedAt" DATETIME,
      "sentAt" DATETIME,
      "skippedReason" TEXT,
      "providerResponseJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_draftNumber_key" ON "WhatsAppOutboxMessage"("draftNumber")`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_status_createdAt_idx" ON "WhatsAppOutboxMessage"("status", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_clientAccountId_createdAt_idx" ON "WhatsAppOutboxMessage"("clientAccountId", "createdAt")`,
    `CREATE INDEX IF NOT EXISTS "WhatsAppOutboxMessage_customerId_createdAt_idx" ON "WhatsAppOutboxMessage"("customerId", "createdAt")`,
    `CREATE TABLE IF NOT EXISTS "TenantIntegrationSetting" (
      "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'whatsapp',
      "provider" TEXT NOT NULL DEFAULT 'WHATSAPP_WEB_LINK',
      "gatewayUrl" TEXT,
      "credentialsEnc" TEXT,
      "senderPhone" TEXT,
      "defaultCountryCode" TEXT NOT NULL DEFAULT '967',
      "autoDraftEventsJson" TEXT NOT NULL DEFAULT '{}',
      "templatesJson" TEXT NOT NULL DEFAULT '{}',
      "configJson" TEXT NOT NULL DEFAULT '{}',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "updatedById" TEXT,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS "PortalCatalogBoardItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "inventoryItemId" TEXT,
      "sku" TEXT,
      "titleAr" TEXT NOT NULL,
      "titleEn" TEXT,
      "gradeLabel" TEXT NOT NULL DEFAULT 'درجة أولى',
      "categoryLabel" TEXT NOT NULL DEFAULT 'أصناف عامة',
      "unitCode" TEXT NOT NULL DEFAULT 'QAT_BUNCH',
      "unitLabel" TEXT NOT NULL DEFAULT 'علاقية قات',
      "customUnitLabel" TEXT,
      "unitPrice" DECIMAL NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'YER',
      "availabilityStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
      "pickupLocation" TEXT,
      "freshnessLabel" TEXT NOT NULL DEFAULT 'قائمة أسعار اليوم',
      "effectiveDate" TEXT,
      "validityNote" TEXT,
      "displayOrder" INTEGER NOT NULL DEFAULT 1,
      "isPublished" INTEGER NOT NULL DEFAULT 0,
      "publishedAt" DATETIME,
      "publishedById" TEXT,
      "publishedByName" TEXT,
      "notes" TEXT,
      "createdById" TEXT,
      "createdByName" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS "PortalCatalogBoardItem_isPublished_displayOrder_idx" ON "PortalCatalogBoardItem"("isPublished", "displayOrder")`,
    `CREATE INDEX IF NOT EXISTS "PortalCatalogBoardItem_gradeLabel_availabilityStatus_idx" ON "PortalCatalogBoardItem"("gradeLabel", "availabilityStatus")`,
  ];

  for (const ddl of additiveTables) {
    try {
      await client.$executeRawUnsafe(ddl);
    } catch {
      // Ignore table already exists / lock
    }
  }

  for (const spec of specs) {
    try {
      const info = (await client.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${spec.table}");`
      )) as Array<{ name: string }>;
      const existingCols = new Set(info.map((c) => c.name));
      for (const col of spec.columns) {
        if (!existingCols.has(col.name)) {
          try {
            await client.$executeRawUnsafe(col.ddl);
          } catch {
            // Ignore duplicate column error if raced
          }
        }
      }
    } catch {
      // Ignore if table doesn't exist yet
    }
  }
}

export async function ensureSqliteAdditiveSchema(client: {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await ensureAdditiveColumns(client);
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
    await ensureAdditiveColumns(prisma);
    await seedDefaultBaselineRecords();
    console.log("[SQLite Bootstrap] Self-healing SQLite initialization completed successfully.");
  } else {
    // Check if any new migration files need to be applied, and ensure baseline singletons exist
    await applyMigrationsIfNeeded(false);
    await ensureAdditiveColumns(prisma);
    await seedDefaultBaselineRecords();
  }

  // Automated rolling SQLite backup (at most once per 24 hours)
  try {
    const { performDailyAutoBackupIfNeeded } = await import("./backupService");
    await performDailyAutoBackupIfNeeded();
  } catch (backupErr) {
    console.warn("[SQLite Bootstrap] Daily auto-backup notice:", backupErr);
  }
}

export async function ensureSqliteDatabaseReady(): Promise<void> {
  if (!isSqliteRuntime()) return;

  const tenantCtx = getTenantContext();
  if (tenantCtx && tenantCtx.tenantId !== "default") {
    // Isolated tenant databases are initialized upon resolution by getTenantPrisma()
    return;
  }

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

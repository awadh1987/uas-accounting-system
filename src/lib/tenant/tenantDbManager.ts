import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { STANDARD_COA_NODES } from "@/lib/accounting/coaCatalog";
import { EMBEDDED_SQLITE_MIGRATION_SQL } from "@/lib/sqliteInitSql";
import { hashPassword } from "@/lib/serverBootstrap";
import { isSqliteRuntime, resolveSqliteFilePath } from "@/lib/sqliteBootstrap";
import { normalizeTenantId } from "./tenantContext";
import { ensureTenantRegistered, getTenantMetadata } from "./tenantRegistry";

const tenantPrismaCache = new Map<string, PrismaClient>();
const readyTenantDbUrls = new Set<string>();

/**
 * Resolves the isolated database file path or schema identifier for a tenant.
 */
export function resolveTenantDbFilePath(rawTenantId?: string | null): string | null {
  const tenantId = normalizeTenantId(rawTenantId);
  if (!isSqliteRuntime()) return null;

  const baseDbPath = resolveSqliteFilePath();
  if (tenantId === "default") {
    return baseDbPath;
  }

  const baseDir = baseDbPath ? path.dirname(baseDbPath) : process.cwd();
  const tenantsDir = path.join(baseDir, "tenants");
  if (!fs.existsSync(tenantsDir)) {
    fs.mkdirSync(tenantsDir, { recursive: true });
  }

  return path.join(tenantsDir, `uas_tenant_${tenantId}.db`);
}

/**
 * Resolves connection URL for a tenant.
 * - SQLite: returns file:<path-to-tenant-db>
 * - PostgreSQL: returns base URL with ?schema=tenant_<slug>
 */
export function resolveTenantDatabaseUrl(rawTenantId?: string | null): string {
  const tenantId = normalizeTenantId(rawTenantId);
  const rawBaseUrl = (process.env.DATABASE_URL || "file:./dev.db").trim();

  if (isSqliteRuntime()) {
    if (tenantId === "default") {
      return rawBaseUrl;
    }
    const tenantPath = resolveTenantDbFilePath(tenantId);
    if (!tenantPath) return rawBaseUrl;
    return `file:${tenantPath.replace(/\\/g, "/")}`;
  }

  // PostgreSQL runtime:
  if (tenantId === "default") {
    return rawBaseUrl;
  }

  try {
    const url = new URL(rawBaseUrl);
    url.searchParams.set("schema", `tenant_${tenantId}`);
    return url.toString();
  } catch {
    const sep = rawBaseUrl.includes("?") ? "&" : "?";
    return `${rawBaseUrl}${sep}schema=tenant_${tenantId}`;
  }
}

function splitSqlStatements(rawSql: string): string[] {
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

/**
 * Initializes and seeds a newly provisioned tenant database/schema.
 */
async function initializeTenantDatabase(
  client: PrismaClient,
  tenantId: string
): Promise<void> {
  const meta = getTenantMetadata(tenantId) || ensureTenantRegistered(tenantId);
  const companyName = meta.companyName || (tenantId === "default" ? "النظام المحاسبي الموحد" : `منشأة ${tenantId}`);

  if (isSqliteRuntime()) {
    try {
      await client.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
      await client.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
      await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
    } catch {
      // Non-fatal
    }

    const statements = splitSqlStatements(EMBEDDED_SQLITE_MIGRATION_SQL);
    for (const rawStmt of statements) {
      const stmt = makeStatementIdempotent(rawStmt);
      try {
        await client.$executeRawUnsafe(stmt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists") || msg.includes("duplicate column name")) {
          continue;
        }
        throw err;
      }
    }
  } else {
    // PostgreSQL runtime: ensure schema exists
    try {
      await client.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "tenant_${tenantId}";`);
    } catch {
      // Schema may already exist
    }
  }

  // 1. EnterpriseProfile
  await client.enterpriseProfile.upsert({
    where: { id: "default" },
    update: {
      legalNameAr: companyName,
    },
    create: {
      id: "default",
      legalNameAr: companyName,
      legalNameEn: `${tenantId.toUpperCase()} Enterprise`,
      taxNumber: "",
      commercialReg: "",
      currencyCode: "YER",
      isConfigured: true,
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

  // 2. SystemSettings
  await client.systemSettings.upsert({
    where: { id: "default" },
    update: {
      orgName: companyName,
    },
    create: {
      id: "default",
      orgName: companyName,
      logoText: "UAS",
      defaultLang: "ar",
      defaultTheme: "emerald",
      defaultCurrency: "YER",
    },
  });

  // 3. LicenseState
  await client.licenseState.upsert({
    where: { id: "active" },
    update: {},
    create: {
      id: "active",
      status: "ACTIVE",
      seatRegistryJson: "[]",
    },
  });

  // 4. Default Currencies & Rates
  const ratesCount = await client.currencyRate.count();
  if (ratesCount === 0) {
    await client.currencyRate.createMany({
      data: [
        { currencyCode: "YER", rateToYER: 1 },
        { currencyCode: "SAR", rateToYER: 425 },
        { currencyCode: "USD", rateToYER: 1620 },
      ],
    });
  }

  // 5. 6-Generation Chart of Accounts
  const accountCount = await client.account.count();
  let cashAccId: string | undefined;
  if (accountCount === 0) {
    const accountIdByCode = new Map<string, string>();
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const nodes = STANDARD_COA_NODES.filter((n) => n.level === level);
      for (const node of nodes) {
        const parentId = node.parentCode
          ? (accountIdByCode.get(node.parentCode) ?? null)
          : null;
        const created = await client.account.create({
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
    cashAccId = accountIdByCode.get("111101");
  }

  // 6. Main Cash Vault
  const treasuryCount = await client.treasuryAccount.count();
  if (treasuryCount === 0) {
    if (!cashAccId) {
      const acc = await client.account.findUnique({ where: { code: "111101" } });
      cashAccId = acc?.id;
    }
    if (cashAccId) {
      await client.treasuryAccount.create({
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

  // 7. Initial SUPER_ADMIN user
  const usersCount = await client.user.count();
  if (usersCount === 0) {
    const adminEmail = tenantId === "default" ? "admin@uas-ye.com" : `admin@${tenantId}.uas`;
    await client.user.create({
      data: {
        id: "u1",
        username: "system_owner",
        name: "مدير النظام العام",
        fullName: `مدير النظام العام / ${companyName}`,
        displayName: "مدير النظام",
        phone: "",
        email: adminEmail,
        passwordHash: hashPassword("123456"),
        role: "SUPER_ADMIN",
        department: "الإدارة العليا",
        active: true,
        isActive: true,
        avatarChar: "م",
        avatarColor: "#059669",
        preferredLang: "ar",
        preferredCurrency: "YER",
        preferredTheme: "emerald",
        assignedProjects: "[]",
      },
    });
  }

  // 8. Baseline Audit Log
  const auditCount = await client.immutableAuditLog.count();
  if (auditCount === 0) {
    const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
    const hash =
      "SHA256-" +
      crypto
        .createHash("sha256")
        .update(`UAS-TENANT-${tenantId}-INIT`)
        .digest("hex")
        .slice(0, 12)
        .toUpperCase();

    await client.immutableAuditLog.create({
      data: {
        id: `aud-init-${tenantId}`,
        timestamp: nowStr,
        userId: "u1",
        userDisplay: "مدير النظام العام (SUPER_ADMIN)",
        userRole: "SUPER_ADMIN",
        actionType: "تهيئة قاعدة بيانات المنشأة المستقلة",
        entityReference: `TENANT:${tenantId}`,
        details: `تمت تهيئة قاعدة البيانات المستقلة للمنشأة (${companyName}) بنجاح مع شجرة الحسابات والمسؤول الافتراضي.`,
        sha256Hash: hash,
      },
    });
  }
}

/**
 * Retrieves or initializes an isolated PrismaClient for the given tenant ID.
 */
export async function getTenantPrisma(rawTenantId?: string | null): Promise<PrismaClient> {
  const tenantId = normalizeTenantId(rawTenantId);

  // Return cached client if already loaded
  const existing = tenantPrismaCache.get(tenantId);
  if (existing) {
    return existing;
  }

  const tenantDbUrl = resolveTenantDatabaseUrl(tenantId);

  const client = new PrismaClient({
    datasources: {
      db: {
        url: tenantDbUrl,
      },
    },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  // Ensure tables and baseline records exist
  if (!readyTenantDbUrls.has(tenantDbUrl)) {
    try {
      await initializeTenantDatabase(client, tenantId);
      readyTenantDbUrls.add(tenantDbUrl);
    } catch (err) {
      console.error(`[TenantDbManager] Error initializing tenant DB for '${tenantId}':`, err);
      // Still cache client so subsequent operations can proceed or retry
    }
  }

  tenantPrismaCache.set(tenantId, client);
  return client;
}

/**
 * Resets tenant clients cache and disconnects all connections (for test cleanup).
 */
export async function resetTenantClientsForTests(): Promise<void> {
  for (const client of tenantPrismaCache.values()) {
    try {
      await client.$disconnect();
    } catch {
      // Ignore disconnect error
    }
  }
  tenantPrismaCache.clear();
  readyTenantDbUrls.clear();
}

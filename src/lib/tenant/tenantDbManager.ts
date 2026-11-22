import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { STANDARD_COA_NODES } from "@/lib/accounting/coaCatalog";
import { EMBEDDED_SQLITE_MIGRATION_SQL } from "@/lib/sqliteInitSql";
import { hashPassword } from "@/lib/serverBootstrap";
import { ensureSqliteAdditiveSchema, isSqliteRuntime, resolveSqliteFilePath } from "@/lib/sqliteBootstrap";
import { normalizeTenantId } from "./tenantContext";
import { ensureTenantRegistered, getTenantMetadata } from "./tenantRegistry";

export interface TenantInitOptions {
  adminUsername?: string;
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
  forceReinitialize?: boolean;
}

const tenantPrismaCache = new Map<string, PrismaClient>();
const readyTenantDbUrls = new Set<string>();
const pendingTenantInitializations = new Map<string, Promise<PrismaClient>>();

function cleanEnvDatabaseUrl(raw?: string | null): string {
  return (raw || "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Checks whether the active database runtime is PostgreSQL.
 */
export function isPostgresRuntime(): boolean {
  const url = cleanEnvDatabaseUrl(process.env.DATABASE_URL).toLowerCase();
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

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
 * Resolves the PostgreSQL schema name for a tenant.
 * - 'default' -> 'public'
 * - 'tenant_alpha' or 'tenant-alpha' -> 'tenant_alpha' (avoids double 'tenant_tenant_...' prefix)
 */
export function resolveTenantSchemaName(rawTenantId?: string | null): string {
  const tenantId = normalizeTenantId(rawTenantId);
  if (tenantId === "default") return "public";
  return tenantId.startsWith("tenant_") ? tenantId : `tenant_${tenantId}`;
}

/**
 * Resolves connection URL for a tenant.
 * - SQLite: returns file:<path-to-tenant-db>
 * - PostgreSQL: returns base URL with ?schema=tenant_<slug>
 */
export function resolveTenantDatabaseUrl(
  rawTenantId?: string | null,
  overrideBaseUrl?: string
): string {
  const tenantId = normalizeTenantId(rawTenantId);
  const rawBaseUrl = cleanEnvDatabaseUrl(overrideBaseUrl || process.env.DATABASE_URL) || "file:./dev.db";
  const lowerBaseUrl = rawBaseUrl.toLowerCase();

  const isSqlite =
    lowerBaseUrl.startsWith("file:") ||
    (!lowerBaseUrl.startsWith("postgresql://") &&
      !lowerBaseUrl.startsWith("postgres://") &&
      !lowerBaseUrl.includes("://"));

  if (isSqlite) {
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

  const schemaName = resolveTenantSchemaName(tenantId);
  try {
    const url = new URL(rawBaseUrl);
    url.searchParams.set("schema", schemaName);
    return url.toString();
  } catch {
    const sep = rawBaseUrl.includes("?") ? "&" : "?";
    return `${rawBaseUrl}${sep}schema=${schemaName}`;
  }
}

export function splitSqlStatements(rawSql: string): string[] {
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

export function makeStatementIdempotent(stmt: string): string {
  return stmt
    .replace(/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")
    .replace(
      /^CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i,
      "CREATE UNIQUE INDEX IF NOT EXISTS "
    )
    .replace(/^CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE INDEX IF NOT EXISTS ");
}

/**
 * Converts a SQLite DDL statement into PostgreSQL-compatible DDL targeting the specified schema.
 */
export function convertSqliteStatementToPostgres(stmt: string, schemaName: string): string {
  let s = stmt.trim();
  if (!s) return "";

  // Replace SQLite AUTOINCREMENT with PostgreSQL SERIAL
  s = s.replace(/\bINTEGER\s+NOT\s+NULL\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, "SERIAL PRIMARY KEY");
  s = s.replace(/\bAUTOINCREMENT\b/gi, "");

  // Replace DATETIME with TIMESTAMP(3)
  s = s.replace(/\bDATETIME\b/g, "TIMESTAMP(3)");

  // Qualify CREATE TABLE "TableName" with schemaName
  s = s.replace(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/i,
    `CREATE TABLE IF NOT EXISTS "${schemaName}"."$1"`
  );

  // Qualify CREATE [UNIQUE] INDEX "IndexName" ON "TableName"("col")
  s = s.replace(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?\s+ON\s+"?([a-zA-Z0-9_]+)"?/i,
    `CREATE $1INDEX IF NOT EXISTS "$2_${schemaName}" ON "${schemaName}"."$3"`
  );

  // Qualify REFERENCES "TargetTable" with schemaName
  s = s.replace(
    /REFERENCES\s+"?([a-zA-Z0-9_]+)"?/gi,
    `REFERENCES "${schemaName}"."$1"`
  );

  // Qualify CONSTRAINT "Name" to avoid global collision
  s = s.replace(
    /CONSTRAINT\s+"?([a-zA-Z0-9_]+)"?/gi,
    `CONSTRAINT "$1_${schemaName}"`
  );

  return s;
}

/**
 * Generates an array of PostgreSQL DDL statements targeting a tenant schema from raw SQLite migration SQL.
 */
export function generatePostgresDdlFromSqlite(rawSql: string, schemaName: string): string[] {
  const rawStmts = splitSqlStatements(rawSql);
  const result: string[] = [];
  for (const raw of rawStmts) {
    const converted = convertSqliteStatementToPostgres(raw, schemaName);
    if (converted) {
      result.push(converted);
    }
  }
  return result;
}

export type QueryableClient = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

export interface PostgresProvisioningResult {
  tablesProvisioned: string[];
  enumsProvisioned: string[];
  columnsRemapped: number;
  fksProvisioned: number;
  clonedFromPublic: boolean;
}

/**
 * Clones all PostgreSQL ENUM types from the 'public' schema into the target tenant schema.
 */
export async function clonePostgresEnumTypes(
  client: QueryableClient,
  schemaName: string
): Promise<string[]> {
  const enumRows = await client.$queryRawUnsafe<
    Array<{
      type_name: string;
      enum_label: string;
      sort_order?: number;
    }>
  >(`
    SELECT
      t.typname AS type_name,
      e.enumlabel AS enum_label,
      e.enumsortorder AS sort_order
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public' AND t.typtype = 'e'
    ORDER BY t.typname, e.enumsortorder;
  `);

  if (!Array.isArray(enumRows) || enumRows.length === 0) {
    return [];
  }

  const enumMap = new Map<string, string[]>();
  for (const row of enumRows) {
    const list = enumMap.get(row.type_name) || [];
    list.push(row.enum_label);
    enumMap.set(row.type_name, list);
  }

  const enumsCreated: string[] = [];

  for (const [typeName, labels] of enumMap.entries()) {
    try {
      const quotedLabels = labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(", ");
      await client.$executeRawUnsafe(`
        DO $$
        BEGIN
          CREATE TYPE "${schemaName}"."${typeName}" AS ENUM (${quotedLabels});
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);
      enumsCreated.push(typeName);

      // Ensure any additional labels are added if enum already existed
      for (const label of labels) {
        try {
          await client.$executeRawUnsafe(`
            DO $$
            BEGIN
              ALTER TYPE "${schemaName}"."${typeName}" ADD VALUE IF NOT EXISTS '${label.replace(/'/g, "''")}';
            EXCEPTION
              WHEN duplicate_object THEN NULL;
            END $$;
          `);
        } catch {
          // Non-fatal
        }
      }
    } catch (enumErr) {
      console.warn(`[TenantDbManager] Notice creating enum ${typeName} in ${schemaName}:`, enumErr);
    }
  }

  return enumsCreated;
}

/**
 * Remaps columns in the tenant schema that reference 'public' ENUM types so they use
 * the tenant's own isolated enum types (e.g. "tenant_beta"."Role" instead of public."Role").
 */
export async function remapPostgresEnumColumns(
  client: QueryableClient,
  schemaName: string,
  enumNames: Set<string>
): Promise<number> {
  if (enumNames.size === 0) return 0;

  let columnsToRemap: Array<{
    table_name: string;
    column_name: string;
    udt_name: string;
    column_default: string | null;
  }> = [];

  try {
    columnsToRemap = await client.$queryRawUnsafe<
      Array<{
        table_name: string;
        column_name: string;
        udt_name: string;
        column_default: string | null;
      }>
    >(
      `
      SELECT
        c.table_name,
        c.column_name,
        c.udt_name,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = $1
        AND c.udt_schema = 'public';
      `,
      schemaName
    );
  } catch (colErr) {
    console.warn(`[TenantDbManager] Notice checking columns for enum remapping in ${schemaName}:`, colErr);
    return 0;
  }

  let remappedCount = 0;

  for (const col of columnsToRemap) {
    if (!enumNames.has(col.udt_name)) continue;

    try {
      // 1. Drop existing default if present to allow type alteration
      if (col.column_default) {
        await client.$executeRawUnsafe(
          `ALTER TABLE "${schemaName}"."${col.table_name}" ALTER COLUMN "${col.column_name}" DROP DEFAULT;`
        );
      }

      // 2. Alter column type to use tenant's enum type
      await client.$executeRawUnsafe(
        `ALTER TABLE "${schemaName}"."${col.table_name}" ALTER COLUMN "${col.column_name}" TYPE "${schemaName}"."${col.udt_name}" USING "${col.column_name}"::text::"${schemaName}"."${col.udt_name}";`
      );

      // 3. Re-apply rewritten default pointing to tenant enum
      if (col.column_default) {
        const rewrittenDefault = col.column_default.replace(
          /(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/g,
          (match, name) => (name === col.udt_name ? `"${schemaName}"."${col.udt_name}"` : match)
        );
        await client.$executeRawUnsafe(
          `ALTER TABLE "${schemaName}"."${col.table_name}" ALTER COLUMN "${col.column_name}" SET DEFAULT ${rewrittenDefault};`
        );
      }

      remappedCount++;
    } catch (remapErr) {
      console.warn(
        `[TenantDbManager] Notice remapping column ${col.table_name}.${col.column_name} to ${schemaName}.${col.udt_name}:`,
        remapErr
      );
    }
  }

  return remappedCount;
}

async function executePostgresFallbackDdl(
  client: QueryableClient,
  schemaName: string
): Promise<{ tablesProvisioned: string[]; enumsProvisioned: string[]; fksProvisioned: number }> {
  const roleLabels = [
    "SUPER_ADMIN",
    "PROJECT_MANAGER",
    "CHIEF_ACCOUNTANT",
    "PROCUREMENT_OFFICER",
    "SALES_COLLECTOR",
    "FIELD_ACCOUNTANT",
    "EXTERNAL_AUDITOR",
  ];
  const quotedRoleLabels = roleLabels.map((l) => `'${l}'`).join(", ");
  await client.$executeRawUnsafe(`
    DO $$
    BEGIN
      CREATE TYPE "${schemaName}"."Role" AS ENUM (${quotedRoleLabels});
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  const postgresStatements = generatePostgresDdlFromSqlite(EMBEDDED_SQLITE_MIGRATION_SQL, schemaName);
  const tableStatements: string[] = [];
  const indexStatements: string[] = [];
  const deferredFks: Array<{ table: string; name: string; def: string }> = [];

  for (const stmt of postgresStatements) {
    const createTableMatch = stmt.match(
      new RegExp(`^CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+"${schemaName}"\\."([^"]+)"`, "i")
    );
    if (createTableMatch) {
      const tableName = createTableMatch[1];
      let adjusted = stmt;

      if (tableName === "AuditLog") {
        adjusted = adjusted.replace(/"details"\s+TEXT\s+NOT\s+NULL/i, `"details" JSONB NOT NULL`);
      }
      if (tableName === "User") {
        adjusted = adjusted.replace(
          /"role"\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'FIELD_ACCOUNTANT'/i,
          `"role" "${schemaName}"."Role" NOT NULL DEFAULT 'FIELD_ACCOUNTANT'::"${schemaName}"."Role"`
        );
      }

      const fkRegex =
        /,\s*CONSTRAINT\s+"([^"]+)"\s+(FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s+[^\n;]+?)(?=\s*(?:,\s*CONSTRAINT|\n\s*\)|\)))/gi;
      adjusted = adjusted.replace(fkRegex, (_match, name: string, def: string) => {
        deferredFks.push({ table: tableName, name: name.slice(0, 63), def: def.trim() });
        return "";
      });

      adjusted = adjusted.replace(/,\s*\n(\s*\);?\s*)$/, "\n$1");
      tableStatements.push(adjusted);
    } else {
      indexStatements.push(stmt);
    }
  }

  const tablesProvisioned: string[] = [];
  for (const stmt of tableStatements) {
    try {
      await client.$executeRawUnsafe(stmt);
      tablesProvisioned.push("DDL_STATEMENT");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("duplicate")) continue;
      throw err;
    }
  }

  for (const stmt of indexStatements) {
    try {
      await client.$executeRawUnsafe(stmt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("duplicate")) continue;
      console.warn(`[TenantDbManager] Fallback index creation notice for ${schemaName}:`, msg);
    }
  }

  let fksProvisioned = 0;
  for (const fk of deferredFks) {
    try {
      await client.$executeRawUnsafe(
        `ALTER TABLE "${schemaName}"."${fk.table}" ADD CONSTRAINT "${fk.name}" ${fk.def};`
      );
      fksProvisioned++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("duplicate")) continue;
      console.warn(`[TenantDbManager] Fallback FK notice on ${schemaName}.${fk.table}:`, msg);
    }
  }

  return {
    tablesProvisioned,
    enumsProvisioned: ["Role"],
    fksProvisioned,
  };
}

/**
 * Provisions all Prisma tables, indexes, constraints, and sequences into a PostgreSQL tenant schema.
 * Clones structure from the authoritative 'public' schema using:
 * `CREATE TABLE IF NOT EXISTS "${schemaName}"."${tbl}" (LIKE public."${tbl}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`
 * and replicates intra-schema foreign key constraints.
 */
export async function provisionPostgresTenantSchema(
  client: QueryableClient,
  schemaName: string
): Promise<PostgresProvisioningResult> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL tenant schema identifier: "${schemaName}"`);
  }

  // 1. Ensure schema exists
  await client.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);

  // 2. Clone all PostgreSQL ENUM types from 'public' into the tenant schema BEFORE cloning tables
  let enumsProvisioned: string[] = [];
  try {
    enumsProvisioned = await clonePostgresEnumTypes(client, schemaName);
  } catch (enumErr) {
    console.warn(`[TenantDbManager] Notice cloning enums for ${schemaName}:`, enumErr);
  }
  const clonedEnumSet = new Set(enumsProvisioned);

  // 3. Query existing tables in tenant schema
  let existingRows: Array<{ tablename: string }> = [];
  try {
    existingRows = await client.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1;`,
      schemaName
    );
  } catch {
    existingRows = [];
  }
  const existingSet = new Set((existingRows || []).map((r) => r.tablename));

  // 4. Query public schema tables (authoritative Prisma tables)
  let publicRows: Array<{ tablename: string }> = [];
  try {
    publicRows = await client.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma_%';`
    );
  } catch (err) {
    console.warn(`[TenantDbManager] Notice checking public schema tables on PostgreSQL:`, err);
  }

  const tablesProvisioned: string[] = [];
  let columnsRemapped = 0;
  let fksProvisioned = 0;

  if (Array.isArray(publicRows) && publicRows.length > 0) {
    // Clone each table from public into tenant schema
    for (const row of publicRows) {
      const tbl = row.tablename;
      if (!existingSet.has(tbl)) {
        await client.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS "${schemaName}"."${tbl}" (LIKE public."${tbl}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);`
        );
        tablesProvisioned.push(tbl);
      }
    }

    // 5. Remap all columns that were copied from public referencing public ENUMs to the tenant's own ENUMs
    try {
      columnsRemapped = await remapPostgresEnumColumns(client, schemaName, clonedEnumSet);
    } catch (colErr) {
      console.warn(`[TenantDbManager] Notice remapping enum columns for ${schemaName}:`, colErr);
    }

    // 6. Replicate foreign keys
    try {
      const fkRows = await client.$queryRawUnsafe<
        Array<{
          constraint_name: string;
          table_name: string;
          def: string;
        }>
      >(`
        SELECT
          c.conname AS constraint_name,
          src_tbl.relname AS table_name,
          pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class src_tbl ON src_tbl.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.contype = 'f';
      `);

      if (Array.isArray(fkRows)) {
        for (const fk of fkRows) {
          try {
            const rewrittenDef = fk.def.replace(
              /REFERENCES\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i,
              `REFERENCES "${schemaName}"."$1"`
            );
            const safeConstraintName = `${fk.constraint_name}_${schemaName}`.slice(0, 63);
            await client.$executeRawUnsafe(
              `ALTER TABLE "${schemaName}"."${fk.table_name}" ADD CONSTRAINT "${safeConstraintName}" ${rewrittenDef};`
            );
            fksProvisioned++;
          } catch {
            // Foreign key may already exist or fail non-fatally
          }
        }
      }
    } catch (fkErr) {
      console.warn(`[TenantDbManager] Non-fatal notice cloning foreign keys for ${schemaName}:`, fkErr);
    }

    return {
      tablesProvisioned,
      enumsProvisioned,
      columnsRemapped,
      fksProvisioned,
      clonedFromPublic: true,
    };
  } else {
    // Fallback: public schema is empty or inaccessible, provision from embedded migration DDL
    const fallback = await executePostgresFallbackDdl(client, schemaName);
    return {
      tablesProvisioned: fallback.tablesProvisioned,
      enumsProvisioned: fallback.enumsProvisioned,
      columnsRemapped: 0,
      fksProvisioned: fallback.fksProvisioned,
      clonedFromPublic: false,
    };
  }
}

/**
 * Initializes and seeds a newly provisioned tenant database/schema.
 */
async function initializeTenantDatabase(
  client: PrismaClient,
  tenantId: string,
  options?: TenantInitOptions
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
    await ensureSqliteAdditiveSchema(client);
  } else {
    // PostgreSQL runtime:
    if (tenantId === "default") {
      // Default tenant continues using existing public schema without alteration
      return;
    }
    const schemaName = resolveTenantSchemaName(tenantId);
    await provisionPostgresTenantSchema(client, schemaName);

    const requiredCoreTables = [
      "User",
      "EnterpriseProfile",
      "SystemSettings",
      "Account",
      "TreasuryAccount",
      "CurrencyRate",
      "LicenseState",
      "ImmutableAuditLog",
      "SyncChangeLog",
      "TenantDevice",
    ];
    const tableRows = await client.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1;`,
      schemaName
    );
    const presentTables = new Set((tableRows || []).map((r) => r.tablename));
    const missingTables = requiredCoreTables.filter((tbl) => !presentTables.has(tbl));
    if (missingTables.length > 0) {
      throw new Error(
        `PostgreSQL tenant schema "${schemaName}" is incomplete; missing required tables: ${missingTables.join(", ")}`
      );
    }
  }

  // 1. EnterpriseProfile
  const profileNameAr = meta.nameAr || companyName;
  const profileNameEn = meta.nameEn || `${tenantId.toUpperCase()} Enterprise`;
  const profileSlug = meta.slug && meta.slug !== "default" ? meta.slug : null;
  await client.enterpriseProfile.upsert({
    where: { id: "default" },
    update: {
      legalNameAr: profileNameAr,
      ...(profileSlug ? { tenantSlug: profileSlug } : {}),
    },
    create: {
      id: "default",
      legalNameAr: profileNameAr,
      legalNameEn: profileNameEn,
      tenantSlug: profileSlug,
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

  // 7. Initial SUPER_ADMIN / OWNER user
  const hasExplicitAdminInput = Boolean(
    options?.adminUsername || options?.adminEmail || options?.adminPassword
  );
  const adminUsername = (options?.adminUsername || "system_owner").trim() || "system_owner";
  const adminEmail = (
    options?.adminEmail ||
    (tenantId === "default" ? "admin@uas-ye.com" : `admin@${tenantId}.uas`)
  )
    .trim()
    .toLowerCase();
  const adminPassword = options?.adminPassword || "123456";
  const adminName = (options?.adminName || "مدير النظام العام").trim() || "مدير النظام العام";

  const activeSuperAdmin = await client.user.findFirst({
    where: {
      role: "SUPER_ADMIN",
      active: true,
      isActive: true,
    },
    select: { id: true },
  });

  if (!activeSuperAdmin) {
    const existingU1 = await client.user.findUnique({ where: { id: "u1" }, select: { id: true } });
    const targetId = existingU1 ? undefined : "u1";
    await client.user.create({
      data: {
        ...(targetId ? { id: targetId } : {}),
        username: existingU1 ? `${adminUsername}_${tenantId}` : adminUsername,
        name: adminName,
        fullName: `${adminName} / ${companyName}`,
        displayName: "مدير النظام",
        phone: "",
        email: existingU1 ? `owner.${Date.now()}@${tenantId}.uas` : adminEmail,
        passwordHash: hashPassword(adminPassword),
        role: "SUPER_ADMIN",
        department: "الإدارة العليا",
        active: true,
        isActive: true,
        avatarChar: adminName.charAt(0) || "م",
        avatarColor: "#059669",
        preferredLang: "ar",
        preferredCurrency: "YER",
        preferredTheme: "emerald",
        assignedProjects: "[]",
      },
    });
  } else if (hasExplicitAdminInput) {
    const matchedAdmin = await client.user.findFirst({
      where: {
        OR: [{ username: adminUsername }, { email: adminEmail }],
      },
      select: { id: true },
    });

    if (matchedAdmin) {
      await client.user.update({
        where: { id: matchedAdmin.id },
        data: {
          role: "SUPER_ADMIN",
          active: true,
          isActive: true,
          archivedAt: null,
          ...(options?.adminName ? { name: adminName, fullName: `${adminName} / ${companyName}` } : {}),
          ...(options?.adminPassword ? { passwordHash: hashPassword(adminPassword) } : {}),
        },
      });
    } else {
      await client.user.create({
        data: {
          username: adminUsername,
          name: adminName,
          fullName: `${adminName} / ${companyName}`,
          displayName: "مدير النظام",
          phone: "",
          email: adminEmail,
          passwordHash: hashPassword(adminPassword),
          role: "SUPER_ADMIN",
          department: "الإدارة العليا",
          active: true,
          isActive: true,
          avatarChar: adminName.charAt(0) || "م",
          avatarColor: "#059669",
          preferredLang: "ar",
          preferredCurrency: "YER",
          preferredTheme: "emerald",
          assignedProjects: "[]",
        },
      });
    }
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
 * Never caches an uninitialized client or marks a URL ready if initialization fails.
 */
export async function getTenantPrisma(
  rawTenantId?: string | null,
  options?: TenantInitOptions
): Promise<PrismaClient> {
  const tenantId = normalizeTenantId(rawTenantId);
  const tenantDbUrl = resolveTenantDatabaseUrl(tenantId);

  if (!options?.forceReinitialize) {
    const existing = tenantPrismaCache.get(tenantId);
    if (existing && readyTenantDbUrls.has(tenantDbUrl)) {
      return existing;
    }
  } else {
    const stale = tenantPrismaCache.get(tenantId);
    if (stale) {
      tenantPrismaCache.delete(tenantId);
      readyTenantDbUrls.delete(tenantDbUrl);
      await stale.$disconnect().catch(() => {});
    }
  }

  const inflight = pendingTenantInitializations.get(tenantId);
  if (inflight) {
    return inflight;
  }

  const initPromise = (async (): Promise<PrismaClient> => {
    const client = new PrismaClient({
      datasources: {
        db: {
          url: tenantDbUrl,
        },
      },
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

    try {
      await initializeTenantDatabase(client, tenantId, options);
      readyTenantDbUrls.add(tenantDbUrl);
      tenantPrismaCache.set(tenantId, client);
      return client;
    } catch (err) {
      readyTenantDbUrls.delete(tenantDbUrl);
      tenantPrismaCache.delete(tenantId);
      await client.$disconnect().catch(() => {});
      console.error(`[TenantDbManager] Error initializing tenant DB for '${tenantId}':`, err);
      throw err;
    }
  })().finally(() => {
    pendingTenantInitializations.delete(tenantId);
  });

  pendingTenantInitializations.set(tenantId, initPromise);
  return initPromise;
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
  pendingTenantInitializations.clear();
}

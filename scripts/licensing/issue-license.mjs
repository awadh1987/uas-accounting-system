import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * UAS License Issuer (Ed25519) — company-locked multi-seat licenses (v3) with
 * automatic Dual-Storage Tenant Provisioning (PostgreSQL + SQLite).
 *
 * Usage:
 *   node scripts/licensing/issue-license.mjs --company "Al-Jabri Trading" --slug "al-jabri" --users 7 \
 *     --win-per-user 1 --android-per-user 1 --hwid "*" --modes "local,lan,cloud" --days 365
 *
 * Flags:
 *   --company <name>          Company name locked into the signed payload (required; alias: --customer)
 *   --slug <slug>             Subdomain slug (3–32 chars [a-z0-9-], reserved-word guarded).
 *                             When provided, automatically provisions isolated PostgreSQL + SQLite DBs,
 *                             subdomain registry, and initial SUPER_ADMIN user.
 *   --name-ar <name>          Optional localized Arabic company name
 *   --name-en <name>          Optional localized English company name
 *   --admin-email <email>     Optional initial tenant admin email (default: admin@<slug>.qat.world)
 *   --admin-password <pass>   Optional initial tenant admin password (default: strong generated password)
 *   --admin-username <user>   Optional initial tenant admin username (default: admin)
 *   --admin-name <name>       Optional initial tenant admin display name
 *   --preview                 Preview derived slug & https://<slug>.qat.world without writing files
 *   --provision               Force tenant provisioning even if --slug was auto-derived
 *   --no-provision            Skip database/registry provisioning even when --slug is passed
 *   --users <n>               Max distinct users (default 7)
 *   --win-per-user <n>        Windows devices per user (default 1)
 *   --android-per-user <n>    Android devices per user (default 1)
 *   --hwid <"*"|HWID[,HWID]>  "*" = company-wide seat-managed; comma list; single HWID.
 *                             Omitted → this machine's HWID. (alias: --request-code REQ-XXXX-...)
 *   --modes <csv>             local,lan,cloud (default all)
 *   --days <n> | --expires <ISO>
 *   --branches <n> --seats <n> --license-id <id> --out <path>
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const DEFAULT_MAX_USERS = 7;

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = true;
      }
    }
  }
  return params;
}

function fail(message) {
  console.error(`[Error] ${message}`);
  process.exit(1);
}

function parseIntStrict(name, value, { min, max, fallback }) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (typeof value === "boolean" || !Number.isInteger(n) || n < min || n > max) {
    fail(`--${name} must be an integer between ${min} and ${max} (got "${value}")`);
  }
  return n;
}

/** Mirrors parseHwidTargets() in src/lib/licensing/licenseSchema.ts */
function parseHwidTargets(hwid) {
  const parts = String(hwid ?? "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p.length > 0);
  if (parts.includes("*")) return { wildcard: true, targets: [] };
  return { wildcard: false, targets: parts };
}

const TENANT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "root", "auth", "login", "logout", "register", "signup",
  "mail", "smtp", "imap", "pop", "ftp", "cdn", "static", "assets", "downloads", "docs",
  "help", "support", "status", "billing", "portal", "dashboard", "system", "platform",
  "superadmin", "qat", "uas", "default", "public", "localhost", "staging", "dev", "test",
  "demo", "ns1", "ns2", "mx", "webmail", "cpanel", "whm", "db", "sql", "sync", "ws", "wss", "vpn",
]);
const ARABIC_CHAR_MAP = {
  أ: "a", إ: "i", آ: "a", ا: "a", ى: "a", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh",
  د: "d", ذ: "dh", ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z",
  ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", ة: "h",
  و: "w", ؤ: "w", ي: "y", ئ: "y", ء: "",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

function transliterateArabic(input) {
  const stripped = String(input || "")
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/لا/g, "la")
    .trim();
  let out = "";
  for (const ch of stripped) {
    out += ARABIC_CHAR_MAP[ch] !== undefined ? ARABIC_CHAR_MAP[ch] : ch;
  }
  return out.toLowerCase();
}

function loadExistingSlugsFromRegistry() {
  const slugs = new Set();
  const regPath = path.join(projectRoot, "tenants_registry.json");
  try {
    if (fs.existsSync(regPath)) {
      const list = JSON.parse(fs.readFileSync(regPath, "utf8"));
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.slug) slugs.add(String(item.slug).trim().toLowerCase());
        }
      }
    }
  } catch {}
  return { slugs, regPath };
}

function deriveValidatedSlug(companyName, preferredSlug, existingSlugs) {
  if (preferredSlug && typeof preferredSlug === "string") {
    const clean = preferredSlug.trim().toLowerCase();
    if (!TENANT_SLUG_REGEX.test(clean) || clean.includes("--") || RESERVED_SLUGS.has(clean)) {
      fail(`Invalid or reserved --slug "${preferredSlug}". Must be 3-32 lowercase [a-z0-9-] chars and not reserved.`);
    }
    // Explicit --slug is deterministic and idempotent for re-issuance / updates
    return clean;
  }

  let ascii = transliterateArabic(companyName)
    .replace(/[\s_./\\]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!ascii) {
    ascii = `org-${crypto.createHash("sha256").update(companyName).digest("hex").slice(0, 6)}`;
  } else if (ascii.length < 3) {
    ascii = `${ascii}-co`.replace(/-+/g, "-");
  }
  if (ascii.length > 32) ascii = ascii.slice(0, 32).replace(/-+$/g, "");
  if (RESERVED_SLUGS.has(ascii)) {
    ascii = `${ascii.slice(0, 28).replace(/-+$/g, "")}-org`;
  }

  let candidate = ascii;
  let counter = 2;
  while (existingSlugs.has(candidate) || RESERVED_SLUGS.has(candidate) || !TENANT_SLUG_REGEX.test(candidate)) {
    const suffix = `-${counter}`;
    const prefix = ascii.slice(0, Math.max(1, 32 - suffix.length)).replace(/-+$/g, "");
    candidate = `${prefix || "org"}${suffix}`;
    counter++;
  }
  return candidate;
}

function loadEnvFromDisk() {
  for (const filename of [".env", ".env.production"]) {
    const filePath = path.join(projectRoot, filename);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const cleanLine = line.startsWith("export ") ? line.slice(7).trim() : line;
        const eqIdx = cleanLine.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = cleanLine.slice(0, eqIdx).trim();
        let val = cleanLine.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // Ignore env read errors
    }
  }
}

/** Exact match to hashPassword() in src/lib/serverBootstrap.ts */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function generateStrongPassword(tenantSlug) {
  const tag = tenantSlug.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "uas";
  const capTag = tag.charAt(0).toUpperCase() + tag.slice(1);
  const rand = crypto.randomBytes(4).toString("hex");
  return `Uas@${capTag}#${rand}!`;
}

function splitSqlStatements(rawSql) {
  const clean = rawSql.replace(/^\uFEFF/, "");
  const statements = [];
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

function makeStatementIdempotent(stmt) {
  return stmt
    .replace(/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE UNIQUE INDEX IF NOT EXISTS ")
    .replace(/^CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, "CREATE INDEX IF NOT EXISTS ");
}

function loadCoaNodes() {
  const tsxEntrypoint = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  if (fs.existsSync(tsxEntrypoint)) {
    try {
      const out = execFileSync(
        process.execPath,
        [
          tsxEntrypoint,
          "-e",
          'import { STANDARD_COA_NODES } from "./src/lib/accounting/coaCatalog.ts"; process.stdout.write(JSON.stringify(STANDARD_COA_NODES));',
        ],
        { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Fallback below
    }
  }

  // Fallback parser for coaCatalog.ts
  const catalogPath = path.join(projectRoot, "src", "lib", "accounting", "coaCatalog.ts");
  const src = fs.readFileSync(catalogPath, "utf8");
  const nodes = [];
  const rowRegex =
    /\{\s*code:\s*"([^"]+)",\s*nameAr:\s*"([^"]+)",\s*nameEn:\s*"([^"]+)",\s*level:\s*(\d+),\s*type:\s*"([^"]+)",\s*isPosting:\s*(true|false),\s*parentCode:\s*(null|"([^"]+)")\s*\}/g;
  let m;
  while ((m = rowRegex.exec(src)) !== null) {
    nodes.push({
      code: m[1],
      nameAr: m[2],
      nameEn: m[3],
      level: Number(m[4]),
      type: m[5],
      isPosting: m[6] === "true",
      parentCode: m[7] === "null" ? null : m[8],
    });
  }
  return nodes;
}

function createCuidLike(prefix = "c") {
  return `${prefix}${crypto.randomBytes(12).toString("hex")}`;
}

function sqlLit(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function buildPostgresSeedSql({
  tenantSlug,
  tenantPgDbName,
  companyName,
  nameAr,
  nameEn,
  adminUsername,
  adminEmail,
  adminName,
  adminPasswordHash,
  signedLicense,
  coaNodes,
}) {
  const nowIso = new Date().toISOString();
  const auditHash =
    "SHA256-" +
    crypto
      .createHash("sha256")
      .update(`UAS-TENANT-${tenantSlug}-INIT`)
      .digest("hex")
      .slice(0, 12)
      .toUpperCase();
  const auditNow = nowIso.slice(0, 16).replace("T", " ");
  const licJson = JSON.stringify(signedLicense);

  const lines = [
    "BEGIN;",
    `INSERT INTO "EnterpriseProfile" ("id","legalNameAr","legalNameEn","taxNumber","commercialReg","currencyCode","isConfigured","address","phone","email","logoUrl","brandColor","contactPhone","contactWhatsApp","contactAddress","tenantSlug","supportEmail","updatedAt")
     VALUES ('default',${sqlLit(nameAr)},${sqlLit(nameEn)},'','','YER',TRUE,'','','','/uas-logo.png','#059669','','','',${sqlLit(tenantSlug)},${sqlLit(adminEmail)},NOW())
     ON CONFLICT ("id") DO UPDATE SET
       "legalNameAr" = EXCLUDED."legalNameAr",
       "legalNameEn" = EXCLUDED."legalNameEn",
       "tenantSlug" = EXCLUDED."tenantSlug",
       "supportEmail" = EXCLUDED."supportEmail",
       "isConfigured" = TRUE,
       "updatedAt" = NOW();`,
    `INSERT INTO "SystemSettings" ("id","orgName","logoText","defaultLang","defaultTheme","defaultCurrency","updatedAt")
     VALUES ('default',${sqlLit(companyName)},'UAS','ar','emerald','YER',NOW())
     ON CONFLICT ("id") DO UPDATE SET "orgName" = EXCLUDED."orgName", "updatedAt" = NOW();`,
    `INSERT INTO "LicenseState" ("id","license_id","customer_name","hwid_hash","last_verified_utc","status","seat_registry_json","license_data_json","updatedAt")
     VALUES ('active',${sqlLit(signedLicense.license_id)},${sqlLit(companyName)},${sqlLit(signedLicense.hwid)},NOW(),'ACTIVE','[]',${sqlLit(licJson)},NOW())
     ON CONFLICT ("id") DO UPDATE SET
       "license_id" = EXCLUDED."license_id",
       "customer_name" = EXCLUDED."customer_name",
       "hwid_hash" = EXCLUDED."hwid_hash",
       "last_verified_utc" = NOW(),
       "status" = 'ACTIVE',
       "license_data_json" = EXCLUDED."license_data_json",
       "updatedAt" = NOW();`,
    `INSERT INTO "CurrencyRate" ("currencyCode","rateToYER","updatedAt") VALUES ('YER',1,NOW()) ON CONFLICT ("currencyCode") DO NOTHING;`,
    `INSERT INTO "CurrencyRate" ("currencyCode","rateToYER","updatedAt") VALUES ('SAR',425,NOW()) ON CONFLICT ("currencyCode") DO NOTHING;`,
    `INSERT INTO "CurrencyRate" ("currencyCode","rateToYER","updatedAt") VALUES ('USD',1620,NOW()) ON CONFLICT ("currencyCode") DO NOTHING;`,
  ];

  // Accounts (ordered by level 1..6)
  const idByCode = new Map();
  for (const level of [1, 2, 3, 4, 5, 6]) {
    for (const node of coaNodes.filter((n) => n.level === level)) {
      const id = createCuidLike("acc_");
      idByCode.set(node.code, id);
      const parentId = node.parentCode ? idByCode.get(node.parentCode) ?? null : null;
      lines.push(
        `INSERT INTO "Account" ("id","code","nameAr","nameEn","level","type","isPosting","parentCode","parentId","generation","isPostable","parentAccountId","updatedAt")
         VALUES (${sqlLit(id)},${sqlLit(node.code)},${sqlLit(node.nameAr)},${sqlLit(node.nameEn)},${node.level},${sqlLit(node.type)},${node.isPosting ? "TRUE" : "FALSE"},${sqlLit(node.parentCode)},${sqlLit(parentId)},${node.level},${node.isPosting ? "TRUE" : "FALSE"},${sqlLit(parentId)},NOW())
         ON CONFLICT ("code") DO NOTHING;`
      );
    }
  }

  // Main Cash Vault linked to Account 111101
  lines.push(
    `INSERT INTO "TreasuryAccount" ("id","code","name","nameAr","nameEn","type","providerNameAr","providerNameEn","accountHolderName","accountNumber","branchOrAgent","transferFeePercent","dailyLimit","isDefaultReceipts","isDefaultPayments","isActive","accountId","currency","currencyCode","balance","balanceYER","updatedAt")
     SELECT 't1','TR-VAULT-YER','الصندوق الرئيسي - يمني (Main Cash Vault - YER)','الصندوق الرئيسي - يمني','Main Cash Vault - YER','VAULT','الخزينة النقدية الرئيسية','Main Cash Vault','الإدارة المالية','CASH-01','المركز الرئيسي',0,0,TRUE,TRUE,TRUE,a."id",'YER','YER',0,0,NOW()
     FROM "Account" a WHERE a."code" = '111101'
     ON CONFLICT ("code") DO NOTHING;`
  );

  // Initial Tenant Admin User (upsert by email or username)
  const adminId = createCuidLike("usr_");
  const fullName = `${adminName} / ${companyName}`;
  lines.push(
    `DO $$
     DECLARE existing_id TEXT;
     BEGIN
       SELECT "id" INTO existing_id FROM "User" WHERE lower("email") = lower(${sqlLit(adminEmail)}) OR lower("username") = lower(${sqlLit(adminUsername)}) LIMIT 1;
       IF existing_id IS NOT NULL THEN
         UPDATE "User" SET
           "username" = ${sqlLit(adminUsername)},
           "email" = ${sqlLit(adminEmail)},
           "name" = ${sqlLit(adminName)},
           "fullName" = ${sqlLit(fullName)},
           "passwordHash" = ${sqlLit(adminPasswordHash)},
           "role" = 'SUPER_ADMIN'::"Role",
           "active" = TRUE,
           "isActive" = TRUE,
           "archivedAt" = NULL,
           "mustChangePassword" = FALSE,
           "passwordUpdatedAt" = NOW(),
           "updatedAt" = NOW()
         WHERE "id" = existing_id;
       ELSE
         INSERT INTO "User" ("id","username","name","fullName","displayName","phone","email","passwordHash","role","department","active","isActive","avatarChar","avatarColor","preferredLang","preferredCurrency","preferredTheme","assignedProjects","mustChangePassword","passwordUpdatedAt","updatedAt")
         VALUES (${sqlLit(adminId)},${sqlLit(adminUsername)},${sqlLit(adminName)},${sqlLit(fullName)},'مدير النظام','',${sqlLit(adminEmail)},${sqlLit(adminPasswordHash)},'SUPER_ADMIN'::"Role",'الإدارة العليا',TRUE,TRUE,${sqlLit(adminName.charAt(0) || "م")},'#059669','ar','YER','emerald','[]',FALSE,NOW(),NOW());
       END IF;
     END $$;`
  );

  lines.push(
    `INSERT INTO "ImmutableAuditLog" ("id","timestamp","userId","userDisplay","userRole","actionType","entityReference","details","sha256Hash")
     VALUES (${sqlLit(`aud-init-${tenantSlug}`)},${sqlLit(auditNow)},NULL,'مدير النظام العام (SUPER_ADMIN)','SUPER_ADMIN','تهيئة قاعدة بيانات المنشأة المستقلة',${sqlLit(`TENANT:${tenantSlug}`)},${sqlLit(`تمت تهيئة قاعدة البيانات المستقلة (${tenantPgDbName}) للمنشأة (${companyName}) بنجاح.`)},${sqlLit(auditHash)})
     ON CONFLICT ("id") DO NOTHING;`
  );
  lines.push("COMMIT;");
  return lines.join("\n");
}

function runPsql(connectionUrl, sqlInput, { tuplesOnly = false } = {}) {
  const parsed = new URL(connectionUrl);
  const env = {
    ...process.env,
    PGHOST: parsed.hostname || "127.0.0.1",
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username || "uas_admin"),
    PGPASSWORD: decodeURIComponent(parsed.password || ""),
    PGDATABASE: parsed.pathname.replace(/^\//, "") || "postgres",
  };
  const args = ["-v", "ON_ERROR_STOP=1", "-X"];
  if (tuplesOnly) args.push("-At");
  return execFileSync("psql", args, {
    cwd: projectRoot,
    env,
    input: sqlInput,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function provisionIsolatedPostgresDb({
  basePgUrl,
  tenantSlug,
  tenantPgDbName,
  companyName,
  nameAr,
  nameEn,
  adminUsername,
  adminEmail,
  adminName,
  adminPasswordHash,
  signedLicense,
  coaNodes,
}) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tenantPgDbName)) {
    fail(`Invalid PostgreSQL database identifier: ${tenantPgDbName}`);
  }

  const targetUrlObj = new URL(basePgUrl);
  targetUrlObj.pathname = `/${tenantPgDbName}`;
  targetUrlObj.searchParams.set("schema", "public");
  const tenantPgUrl = targetUrlObj.toString();

  // 1. Ensure isolated PostgreSQL database exists
  const existsOut = runPsql(
    basePgUrl,
    `SELECT 1 FROM pg_database WHERE datname = ${sqlLit(tenantPgDbName)};`,
    { tuplesOnly: true }
  ).trim();

  if (existsOut !== "1") {
    runPsql(basePgUrl, `CREATE DATABASE "${tenantPgDbName}";`);
  }

  // 2. Apply full Prisma schema to isolated PostgreSQL database via temporary PostgreSQL schema copy
  const prismaCli = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(prismaCli)) {
    fail(`Local Prisma CLI not found at ${prismaCli}`);
  }

  const schemaSrc = fs.readFileSync(path.join(projectRoot, "prisma", "schema.prisma"), "utf8");
  const pgSchemaSrc = schemaSrc.replace(/provider\s*=\s*"(sqlite|postgresql)"/, 'provider = "postgresql"');
  const tmpSchemaPath = path.join(os.tmpdir(), `uas-pg-schema-${process.pid}-${Date.now()}.prisma`);
  fs.writeFileSync(tmpSchemaPath, pgSchemaSrc, "utf8");
  try {
    execFileSync(
      process.execPath,
      [prismaCli, "db", "push", "--schema", tmpSchemaPath, "--skip-generate", "--accept-data-loss"],
      {
        cwd: projectRoot,
        env: { ...process.env, DATABASE_URL: tenantPgUrl },
        stdio: "pipe",
      }
    );
  } finally {
    if (fs.existsSync(tmpSchemaPath)) fs.unlinkSync(tmpSchemaPath);
  }

  // 3. Seed EnterpriseProfile, SystemSettings, LicenseState, COA, Treasury, and initial Admin user
  const seedSql = buildPostgresSeedSql({
    tenantSlug,
    tenantPgDbName,
    companyName,
    nameAr,
    nameEn,
    adminUsername,
    adminEmail,
    adminName,
    adminPasswordHash,
    signedLicense,
    coaNodes,
  });
  runPsql(tenantPgUrl, seedSql);
  return { tenantPgDbName, tenantPgUrl };
}

async function provisionIsolatedSqliteDb({
  tenantSlug,
  companyName,
  nameAr,
  nameEn,
  adminUsername,
  adminEmail,
  adminName,
  adminPasswordHash,
  signedLicense,
  coaNodes,
}) {
  const { DatabaseSync } = await import("node:sqlite");
  const relPath = `data/tenants/${tenantSlug}.db`;
  const sqlitePath = path.join(projectRoot, relPath);
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");

    const existingTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);

    if (!existingTables.includes("User") || !existingTables.includes("EnterpriseProfile") || !existingTables.includes("Account")) {
      const migrationName = "20261117000000_init";
      const migrationPath = path.join(projectRoot, "prisma", "migrations", migrationName, "migration.sql");
      if (!fs.existsSync(migrationPath)) {
        fail(`SQLite migration SQL not found at ${migrationPath}`);
      }
      const rawMigrationSql = fs.readFileSync(migrationPath, "utf8");
      const statements = splitSqlStatements(rawMigrationSql);
      for (const stmt of statements) {
        const idempotentStmt = makeStatementIdempotent(stmt);
        try {
          db.exec(idempotentStmt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("already exists") || msg.includes("duplicate")) continue;
          throw err;
        }
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "checksum" TEXT NOT NULL,
          "finished_at" DATETIME,
          "migration_name" TEXT NOT NULL,
          "logs" TEXT,
          "rolled_back_at" DATETIME,
          "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "applied_steps_count" INTEGER NOT NULL DEFAULT 0
        );
      `);
      const checksum = crypto.createHash("sha256").update(rawMigrationSql, "utf8").digest("hex");
      const nowIso = new Date().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","started_at","applied_steps_count")
         VALUES (?, ?, ?, ?, NULL, ?, ?)`
      ).run(crypto.randomUUID(), checksum, nowIso, migrationName, nowIso, statements.length);
    }

    const nowIso = new Date().toISOString();
    const auditNow = nowIso.slice(0, 16).replace("T", " ");
    const licJson = JSON.stringify(signedLicense);

    db.exec("BEGIN;");
    try {
      db.prepare(`
        INSERT INTO "EnterpriseProfile" (
          "id","legalNameAr","legalNameEn","taxNumber","commercialReg","currencyCode","isConfigured",
          "address","phone","email","logoUrl","brandColor","contactPhone","contactWhatsApp","contactAddress",
          "tenantSlug","supportEmail","updatedAt"
        ) VALUES ('default', ?, ?, '', '', 'YER', 1, '', '', '', '/uas-logo.png', '#059669', '', '', '', ?, ?, ?)
        ON CONFLICT("id") DO UPDATE SET
          "legalNameAr" = excluded."legalNameAr",
          "legalNameEn" = excluded."legalNameEn",
          "tenantSlug" = excluded."tenantSlug",
          "supportEmail" = excluded."supportEmail",
          "isConfigured" = 1,
          "updatedAt" = excluded."updatedAt"
      `).run(nameAr, nameEn, tenantSlug, adminEmail, nowIso);

      db.prepare(`
        INSERT INTO "SystemSettings" ("id","orgName","logoText","defaultLang","defaultTheme","defaultCurrency","updatedAt")
        VALUES ('default', ?, 'UAS', 'ar', 'emerald', 'YER', ?)
        ON CONFLICT("id") DO UPDATE SET
          "orgName" = excluded."orgName",
          "updatedAt" = excluded."updatedAt"
      `).run(companyName, nowIso);

      db.prepare(`
        INSERT INTO "LicenseState" ("id","license_id","customer_name","hwid_hash","last_verified_utc","status","seat_registry_json","license_data_json","updatedAt")
        VALUES ('active', ?, ?, ?, ?, 'ACTIVE', '[]', ?, ?)
        ON CONFLICT("id") DO UPDATE SET
          "license_id" = excluded."license_id",
          "customer_name" = excluded."customer_name",
          "hwid_hash" = excluded."hwid_hash",
          "last_verified_utc" = excluded."last_verified_utc",
          "status" = 'ACTIVE',
          "license_data_json" = excluded."license_data_json",
          "updatedAt" = excluded."updatedAt"
      `).run(signedLicense.license_id, companyName, signedLicense.hwid, nowIso, licJson, nowIso);

      const ratesCount = db.prepare(`SELECT COUNT(*) AS cnt FROM "CurrencyRate"`).get().cnt;
      if (ratesCount === 0) {
        const insertRate = db.prepare(`INSERT OR IGNORE INTO "CurrencyRate" ("currencyCode","rateToYER","updatedAt") VALUES (?, ?, ?)`);
        insertRate.run("YER", 1, nowIso);
        insertRate.run("SAR", 425, nowIso);
        insertRate.run("USD", 1620, nowIso);
      }

      const accCount = db.prepare(`SELECT COUNT(*) AS cnt FROM "Account"`).get().cnt;
      if (accCount === 0) {
        const idByCode = new Map();
        const insertAcc = db.prepare(`
          INSERT INTO "Account" ("id","code","nameAr","nameEn","level","type","isPosting","parentCode","parentId","generation","isPostable","parentAccountId","updatedAt")
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const level of [1, 2, 3, 4, 5, 6]) {
          for (const node of coaNodes.filter((n) => n.level === level)) {
            const id = createCuidLike("acc_");
            idByCode.set(node.code, id);
            const parentId = node.parentCode ? idByCode.get(node.parentCode) ?? null : null;
            insertAcc.run(
              id,
              node.code,
              node.nameAr,
              node.nameEn,
              node.level,
              node.type,
              node.isPosting ? 1 : 0,
              node.parentCode,
              parentId,
              node.level,
              node.isPosting ? 1 : 0,
              parentId,
              nowIso
            );
          }
        }
      }

      const trCount = db.prepare(`SELECT COUNT(*) AS cnt FROM "TreasuryAccount"`).get().cnt;
      if (trCount === 0) {
        const cashAcc = db.prepare(`SELECT "id" FROM "Account" WHERE "code" = '111101' LIMIT 1`).get();
        if (cashAcc?.id) {
          db.prepare(`
            INSERT INTO "TreasuryAccount" (
              "id","code","name","nameAr","nameEn","type","providerNameAr","providerNameEn",
              "accountHolderName","accountNumber","branchOrAgent","transferFeePercent","dailyLimit",
              "isDefaultReceipts","isDefaultPayments","isActive","accountId","currency","currencyCode",
              "balance","balanceYER","updatedAt"
            ) VALUES (
              't1','TR-VAULT-YER','الصندوق الرئيسي - يمني (Main Cash Vault - YER)',
              'الصندوق الرئيسي - يمني','Main Cash Vault - YER','VAULT',
              'الخزينة النقدية الرئيسية','Main Cash Vault','الإدارة المالية',
              'CASH-01','المركز الرئيسي',0,0,1,1,1,?,'YER','YER',0,0,?
            )
          `).run(cashAcc.id, nowIso);
        }
      }

      const existingAdmin = db
        .prepare(`SELECT "id" FROM "User" WHERE lower("email") = lower(?) OR lower("username") = lower(?) LIMIT 1`)
        .get(adminEmail, adminUsername);
      const fullName = `${adminName} / ${companyName}`;
      if (existingAdmin?.id) {
        db.prepare(`
          UPDATE "User" SET
            "username" = ?, "email" = ?, "name" = ?, "fullName" = ?, "passwordHash" = ?,
            "role" = 'SUPER_ADMIN', "active" = 1, "isActive" = 1, "archivedAt" = NULL,
            "mustChangePassword" = 0, "passwordUpdatedAt" = ?, "updatedAt" = ?
          WHERE "id" = ?
        `).run(adminUsername, adminEmail, adminName, fullName, adminPasswordHash, nowIso, nowIso, existingAdmin.id);
      } else {
        db.prepare(`
          INSERT INTO "User" (
            "id","username","name","fullName","displayName","phone","email","passwordHash",
            "role","department","active","isActive","avatarChar","avatarColor",
            "preferredLang","preferredCurrency","preferredTheme","assignedProjects",
            "mustChangePassword","passwordUpdatedAt","updatedAt"
          ) VALUES (?, ?, ?, ?, 'مدير النظام', '', ?, ?, 'SUPER_ADMIN', 'الإدارة العليا', 1, 1, ?, '#059669', 'ar', 'YER', 'emerald', '[]', 0, ?, ?)
        `).run(
          createCuidLike("usr_"),
          adminUsername,
          adminName,
          fullName,
          adminEmail,
          adminPasswordHash,
          adminName.charAt(0) || "م",
          nowIso,
          nowIso
        );
      }

      const auditCount = db.prepare(`SELECT COUNT(*) AS cnt FROM "ImmutableAuditLog"`).get().cnt;
      if (auditCount === 0) {
        const auditHash =
          "SHA256-" +
          crypto
            .createHash("sha256")
            .update(`UAS-TENANT-${tenantSlug}-INIT`)
            .digest("hex")
            .slice(0, 12)
            .toUpperCase();
        db.prepare(`
          INSERT INTO "ImmutableAuditLog" ("id","timestamp","userId","userDisplay","userRole","actionType","entityReference","details","sha256Hash")
          VALUES (?, ?, NULL, 'مدير النظام العام (SUPER_ADMIN)', 'SUPER_ADMIN', 'تهيئة قاعدة بيانات المنشأة المستقلة', ?, ?, ?)
        `).run(
          `aud-init-${tenantSlug}`,
          auditNow,
          `TENANT:${tenantSlug}`,
          `تمت تهيئة قاعدة البيانات المحلية المستقلة (${relPath}) للمنشأة (${companyName}) بنجاح.`,
          auditHash
        );
      }

      db.exec("COMMIT;");
    } catch (txErr) {
      db.exec("ROLLBACK;");
      throw txErr;
    }

    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.exec("PRAGMA journal_mode = DELETE;");
  } finally {
    db.close();
  }

  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = sqlitePath + suffix;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  const standaloneDir = path.join(projectRoot, ".next", "standalone");
  let standaloneSqlitePath = null;
  if (fs.existsSync(standaloneDir)) {
    standaloneSqlitePath = path.join(standaloneDir, relPath);
    fs.mkdirSync(path.dirname(standaloneSqlitePath), { recursive: true });
    fs.copyFileSync(sqlitePath, standaloneSqlitePath);
  }

  return { relPath, sqlitePath, standaloneSqlitePath };
}

function chownForUasIfRoot(paths) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) return;
  try {
    execSync("id -u uas >/dev/null 2>&1");
  } catch {
    return;
  }
  for (const target of paths) {
    if (target && fs.existsSync(target)) {
      try {
        execFileSync("chown", ["-R", "uas:uas", target], { stdio: "ignore" });
      } catch {
        // Non-fatal
      }
    }
  }
}

const params = parseArgs();

const privateKeyPath = path.join(projectRoot, "keys", "uas-license-private.pem");
if (!fs.existsSync(privateKeyPath)) {
  console.error(`[Error] Private key not found at: ${privateKeyPath}`);
  console.error("Please run keygen first: npm run license:keygen");
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
const privateKey = crypto.createPrivateKey(privateKeyPem);

// ---------------------------------------------------------------------------
// Company name (locked into the signed payload)
// ---------------------------------------------------------------------------
const rawCompany = params.company ?? params.customer;
if (rawCompany === undefined || rawCompany === true || String(rawCompany).trim().length === 0) {
  fail('--company "<Company Name>" is required (the license is locked to this company name).');
}
const companyName = String(rawCompany).trim().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
// Seat policy
// ---------------------------------------------------------------------------
const maxUsers = parseIntStrict("users", params.users, { min: 1, max: 10000, fallback: DEFAULT_MAX_USERS });
const winPerUser = parseIntStrict("win-per-user", params["win-per-user"], { min: 0, max: 10, fallback: 1 });
const androidPerUser = parseIntStrict("android-per-user", params["android-per-user"], { min: 0, max: 10, fallback: 1 });
if (winPerUser + androidPerUser < 1) {
  fail("At least one of --win-per-user / --android-per-user must be >= 1.");
}

// ---------------------------------------------------------------------------
// HWID: "*" | comma-separated list | single | request code | auto-detect this machine
// ---------------------------------------------------------------------------
let hwidInput = typeof params.hwid === "string" ? params.hwid : "";
if (!hwidInput && typeof params["request-code"] === "string") {
  hwidInput = params["request-code"].replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
}
if (!hwidInput) {
  try {
    const isWindows = process.platform === "win32";
    let boardUuid = "";
    let cpuId = "";
    let machineGuid = "";

    if (isWindows) {
      try {
        const cmd = 'powershell -NoProfile -NonInteractive -Command "$b=(Get-CimInstance Win32_ComputerSystemProduct).UUID; $c=(Get-CimInstance Win32_Processor).ProcessorId; $g=(Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\').MachineGuid; Write-Output \\"$b:::$c:::$g\\""';
        const out = execSync(cmd, { encoding: "utf8", timeout: 12000 }).trim();
        const parts = out.split(":::");
        if (parts.length >= 3) {
          boardUuid = parts[0].trim();
          cpuId = parts[1].trim();
          machineGuid = parts[2].trim();
        }
      } catch {}
    }

    const fallback = `${os.hostname()}::${os.arch()}::${os.platform()}`;
    const rawParts = [
      boardUuid || "NO_BOARD_UUID",
      cpuId || "NO_CPUID",
      machineGuid || "NO_MACHINE_GUID",
      fallback,
    ].join("::");

    hwidInput = crypto.createHash("sha256").update(rawParts, "utf8").digest("hex").toUpperCase();
  } catch {
    hwidInput = "GLOBAL-UNIVERSAL-HWID-2026";
  }
}
const hwidParsed = parseHwidTargets(hwidInput);
if (!hwidParsed.wildcard && hwidParsed.targets.length === 0) {
  fail('--hwid must be "*", a HWID, or a comma-separated list of HWIDs.');
}
const hwid = hwidParsed.wildcard ? "*" : hwidParsed.targets.join(",");

// ---------------------------------------------------------------------------
// Remaining payload fields
// ---------------------------------------------------------------------------
const licenseId = String(params["license-id"] || `UAS-2026-${Math.floor(1000 + Math.random() * 9000)}`).trim().toUpperCase();

const rawModes = typeof params.modes === "string" ? params.modes.split(",").map((s) => s.trim().toLowerCase()) : ["local", "lan", "cloud"];
const allowed_modes = rawModes.filter((m) => ["local", "lan", "cloud"].includes(m));
if (allowed_modes.length === 0) allowed_modes.push("local", "lan", "cloud");

const maxBranches = parseIntStrict("branches", params.branches, { min: 1, max: 1000, fallback: 3 });
const maxLanSeats = parseIntStrict("seats", params.seats, { min: 1, max: 10000, fallback: 10 });
const days = parseIntStrict("days", params.days, { min: 1, max: 36500, fallback: 365 });

const issuedAt = new Date().toISOString();
const expiresAt = typeof params.expires === "string" ? params.expires : new Date(Date.now() + days * 86400000).toISOString();
if (Number.isNaN(new Date(expiresAt).getTime())) fail(`--expires is not a valid date: "${params.expires}"`);

const nameAr = typeof params["name-ar"] === "string" ? params["name-ar"].trim() : companyName;
const nameEn = typeof params["name-en"] === "string" ? params["name-en"].trim() : companyName;
const { slugs: existingSlugs, regPath } = loadExistingSlugsFromRegistry();
const explicitSlug = typeof params.slug === "string" ? params.slug : undefined;
const tenantSlug = deriveValidatedSlug(nameEn || companyName, explicitSlug, existingSlugs);
const tenantUrl = `https://${tenantSlug}.qat.world`;

if (params.preview) {
  console.log(JSON.stringify({ companyName, nameAr, nameEn, slug: tenantSlug, tenantUrl }, null, 2));
  process.exit(0);
}

const payload = {
  license_id: licenseId,
  customer_name: companyName,
  company_name: companyName,
  name_ar: nameAr,
  name_en: nameEn,
  tenant_slug: tenantSlug,
  tenant_url: tenantUrl,
  hwid,
  allowed_modes: [...new Set(allowed_modes)].sort(),
  max_branches: maxBranches,
  max_lan_seats: maxLanSeats,
  max_users: maxUsers,
  per_user_devices: { windows: winPerUser, android: androidPerUser },
  expires_at: expiresAt,
  issued_at: issuedAt,
};

// Canonicalize deterministically — MUST mirror canonicalizeLicensePayload() (v2/v3) in
// src/lib/licensing/licenseSchema.ts (alphabetical keys, nested per_user_devices sorted).
const sortedPayload = {
  allowed_modes: [...payload.allowed_modes].sort(),
  company_name: payload.company_name.trim(),
  customer_name: payload.customer_name.trim(),
  expires_at: payload.expires_at.trim(),
  hwid: payload.hwid,
  issued_at: payload.issued_at.trim(),
  license_id: payload.license_id.trim().toUpperCase(),
  max_branches: Number(payload.max_branches),
  max_lan_seats: Number(payload.max_lan_seats),
  max_users: Number(payload.max_users),
  name_ar: payload.name_ar,
  name_en: payload.name_en,
  per_user_devices: {
    android: Number(payload.per_user_devices.android),
    windows: Number(payload.per_user_devices.windows),
  },
  tenant_slug: payload.tenant_slug,
  tenant_url: payload.tenant_url,
};
const canonical = JSON.stringify(sortedPayload);

// Sign with Ed25519
const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");

const signedLicense = {
  ...payload,
  signature,
};

// Output file destination
const outRelPath = typeof params.out === "string" ? params.out : "license.uas";
const outPath = path.isAbsolute(outRelPath) ? outRelPath : path.resolve(projectRoot, outRelPath);
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outPath, JSON.stringify(signedLicense, null, 2), "utf8");

// Compact Base64 activation key (full token, also saved next to the license file)
const activationToken = `UASKEY-${Buffer.from(JSON.stringify(signedLicense)).toString("base64")}`;
const keyPath = outPath.replace(/\.[^./\\]+$/, "") + ".uaskey.txt";
fs.writeFileSync(keyPath, activationToken + "\n", "utf8");

// ---------------------------------------------------------------------------
// Automatic Dual-Storage Provisioning (PostgreSQL + SQLite + Registry)
// Triggered automatically whenever --slug <slug> or --provision is passed.
// ---------------------------------------------------------------------------
const shouldProvision = Boolean(explicitSlug || params.provision) && !params["no-provision"];
let provisionSummary = null;

if (shouldProvision) {
  loadEnvFromDisk();

  const adminEmail = (
    typeof params["admin-email"] === "string" && params["admin-email"].trim()
      ? params["admin-email"].trim()
      : `admin@${tenantSlug}.qat.world`
  ).toLowerCase();
  const adminUsername =
    typeof params["admin-username"] === "string" && params["admin-username"].trim()
      ? params["admin-username"].trim()
      : "admin";
  const adminPassword =
    typeof params["admin-password"] === "string" && params["admin-password"].length > 0
      ? params["admin-password"]
      : generateStrongPassword(tenantSlug);
  if (adminPassword.length < 6) {
    fail("--admin-password must be at least 6 characters.");
  }
  const adminName =
    typeof params["admin-name"] === "string" && params["admin-name"].trim()
      ? params["admin-name"].trim()
      : "مدير النظام العام";

  const adminPasswordHash = hashPassword(adminPassword);
  const coaNodes = loadCoaNodes();
  const tenantPgDbName = `uas_${tenantSlug.replace(/-/g, "_").replace(/^uas_/, "")}`;
  const rawDbUrl = String(process.env.DATABASE_URL || "").trim().replace(/^["']|["']$/g, "");

  // A. Isolated PostgreSQL Database
  let pgResult = null;
  if (rawDbUrl.toLowerCase().startsWith("postgresql://") || rawDbUrl.toLowerCase().startsWith("postgres://")) {
    pgResult = await provisionIsolatedPostgresDb({
      basePgUrl: rawDbUrl,
      tenantSlug,
      tenantPgDbName,
      companyName,
      nameAr,
      nameEn,
      adminUsername,
      adminEmail,
      adminName,
      adminPasswordHash,
      signedLicense,
      coaNodes,
    });
  } else {
    console.warn("[Warning] DATABASE_URL is not PostgreSQL; skipping isolated PostgreSQL provisioning.");
  }

  // B. Isolated SQLite Database (data/tenants/<slug>.db)
  const sqliteResult = await provisionIsolatedSqliteDb({
    tenantSlug,
    companyName,
    nameAr,
    nameEn,
    adminUsername,
    adminEmail,
    adminName,
    adminPasswordHash,
    signedLicense,
    coaNodes,
  });

  // C. Mirror license files under data/licenses/<slug>/ & .next/standalone/data/licenses/<slug>/
  const tenantLicDir = path.join(projectRoot, "data", "licenses", tenantSlug);
  fs.mkdirSync(tenantLicDir, { recursive: true });
  const canonicalLicFile = path.join(tenantLicDir, "license.uas");
  const slugLicFile = path.join(tenantLicDir, `${tenantSlug}.uas`);
  const slugKeyFile = path.join(tenantLicDir, `${tenantSlug}.uaskey.txt`);
  fs.writeFileSync(canonicalLicFile, JSON.stringify(signedLicense, null, 2), "utf8");
  fs.writeFileSync(slugLicFile, JSON.stringify(signedLicense, null, 2), "utf8");
  fs.writeFileSync(slugKeyFile, activationToken + "\n", "utf8");

  const standaloneDir = path.join(projectRoot, ".next", "standalone");
  const standaloneTenantLicDir = path.join(standaloneDir, "data", "licenses", tenantSlug);
  if (fs.existsSync(standaloneDir)) {
    fs.mkdirSync(standaloneTenantLicDir, { recursive: true });
    fs.writeFileSync(path.join(standaloneTenantLicDir, "license.uas"), JSON.stringify(signedLicense, null, 2), "utf8");
    fs.writeFileSync(path.join(standaloneTenantLicDir, `${tenantSlug}.uas`), JSON.stringify(signedLicense, null, 2), "utf8");
    fs.writeFileSync(path.join(standaloneTenantLicDir, `${tenantSlug}.uaskey.txt`), activationToken + "\n", "utf8");
  }

  // D. Upsert tenants_registry.json & .next/standalone/tenants_registry.json
  const existingList = fs.existsSync(regPath) ? JSON.parse(fs.readFileSync(regPath, "utf8")) : [];
  const list = Array.isArray(existingList) ? existingList : [];
  const normUnderscoreId = tenantSlug.replace(/-/g, "_");
  const nowIso = new Date().toISOString();
  const idx = list.findIndex(
    (t) =>
      t?.slug === tenantSlug ||
      t?.tenantId === tenantSlug ||
      t?.tenantId === normUnderscoreId
  );
  const meta = {
    tenantId: tenantSlug,
    slug: tenantSlug,
    companyName,
    nameAr,
    nameEn,
    tenantUrl,
    licenseId,
    postgresDb: tenantPgDbName,
    sqliteDbPath: sqliteResult.relPath,
    schemaOrDb: tenantPgDbName,
    allowedModes: payload.allowed_modes,
    maxSeats: maxUsers,
    status: "ACTIVE",
    createdAt: idx >= 0 ? list[idx].createdAt : nowIso,
    updatedAt: nowIso,
  };
  if (idx >= 0) list[idx] = meta;
  else list.push(meta);

  const registryJson = JSON.stringify(list, null, 2);
  fs.writeFileSync(regPath, registryJson, "utf8");
  const standaloneRegPath = path.join(standaloneDir, "tenants_registry.json");
  if (fs.existsSync(standaloneDir)) {
    fs.writeFileSync(standaloneRegPath, registryJson, "utf8");
  }

  chownForUasIfRoot([
    outDir,
    tenantLicDir,
    standaloneTenantLicDir,
    path.join(projectRoot, "data", "tenants"),
    path.join(standaloneDir, "data", "tenants"),
    regPath,
    standaloneRegPath,
  ]);

  provisionSummary = {
    postgresDb: pgResult ? pgResult.tenantPgDbName : "(skipped - non-PostgreSQL DATABASE_URL)",
    sqliteDbPath: sqliteResult.relPath,
    adminEmail,
    adminUsername,
    adminPassword,
  };
}

const hwidLabel = hwidParsed.wildcard
  ? '* (company-wide, seat-managed)'
  : hwidParsed.targets.length > 1
    ? `${hwidParsed.targets.length} HWIDs (comma-separated)`
    : hwid;

console.log("\n=======================================================");
console.log("       UAS CRYPTOGRAPHIC LICENSE ISSUED SUCCESSFULLY    ");
console.log("=======================================================");
console.log(`License ID      : ${licenseId}`);
console.log(`Company Name    : ${companyName}`);
console.log(`Tenant Slug     : ${tenantSlug}`);
console.log(`Workspace URL   : ${tenantUrl}`);
if (provisionSummary) {
  console.log(`PostgreSQL DB   : ${provisionSummary.postgresDb}`);
  console.log(`SQLite DB Path  : ${provisionSummary.sqliteDbPath}`);
  console.log(`Admin Email     : ${provisionSummary.adminEmail}`);
  console.log(`Admin Username  : ${provisionSummary.adminUsername}`);
  console.log(`Admin Password  : ${provisionSummary.adminPassword}`);
}
console.log(`Max Users       : ${maxUsers}`);
console.log(`Devices/User    : ${winPerUser} Windows + ${androidPerUser} Android`);
console.log(`Target HWID     : ${hwidLabel}`);
console.log(`Allowed Modes   : ${payload.allowed_modes.join(", ")}`);
console.log(`Max Branches    : ${maxBranches}`);
console.log(`Max LAN Seats   : ${maxLanSeats}`);
console.log(`Valid Until     : ${expiresAt} (${days} days)`);
console.log(`License File    : ${outPath}`);
console.log(`Key File        : ${keyPath}`);
console.log("-------------------------------------------------------");
console.log("Online Activation Key (Serial Token):");
console.log(activationToken);
console.log("=======================================================\n");

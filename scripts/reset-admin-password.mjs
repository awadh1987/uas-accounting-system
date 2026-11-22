#!/usr/bin/env node
/**
 * UAS Enterprise Accounting System - Admin Password Reset CLI (PostgreSQL & SQLite)
 *
 * Usage:
 *   node scripts/reset-admin-password.mjs --password "NewSecurePassword123"
 *   node scripts/reset-admin-password.mjs --tenant "alwaha" --password "NewSecurePassword123"
 *   node scripts/reset-admin-password.mjs --username "system_owner" --password "NewSecurePassword123"
 *   node scripts/reset-admin-password.mjs --db "C:\UAS-Data\uas-enterprise.db" --password "NewSecurePassword123"
 *
 * Options:
 *   --url <dbUrl>       Explicit DATABASE_URL override (PostgreSQL or SQLite file:...)
 *   --db <path>         Path to SQLite database file (optional, for local SQLite overrides)
 *   --tenant <slug>     Target tenant slug/ID on PostgreSQL (defaults to public / default)
 *   --username <user>   Target username, email, or user ID (default: SUPER_ADMIN / system_owner / admin)
 *   --password <pass>   New password (min 6 characters)
 *   --help              Display this help message
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_KEYLEN = 64;

function loadEnvFiles() {
  const candidates = [".env.production", ".env"];
  for (const filename of candidates) {
    const filePath = path.resolve(process.cwd(), filename);
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
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch (err) {
      console.warn(`[WARN] Could not parse ${filename}:`, err.message);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: "",
    db: "",
    tenant: "",
    password: "",
    username: "",
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--url" && i + 1 < args.length) {
      options.url = args[++i];
    } else if (arg === "--db" && i + 1 < args.length) {
      options.db = args[++i];
    } else if (arg === "--tenant" && i + 1 < args.length) {
      options.tenant = args[++i];
    } else if (arg === "--password" && i + 1 < args.length) {
      options.password = args[++i];
    } else if (arg === "--username" && i + 1 < args.length) {
      options.username = args[++i];
    }
  }

  return options;
}

function cleanDatabaseUrl(raw) {
  return String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

function isPostgresUrl(url) {
  const lower = cleanDatabaseUrl(url).toLowerCase();
  return lower.startsWith("postgresql://") || lower.startsWith("postgres://");
}

function normalizeTenantSchema(rawTenant) {
  const clean = String(rawTenant || "").trim().toLowerCase();
  if (!clean || clean === "default" || clean === "public") return "public";
  const slug = clean
    .replace(/[.\s\-/]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 48);
  if (!slug || slug === "default") return "public";
  return slug.startsWith("tenant_") ? slug : `tenant_${slug}`;
}

function withPostgresTenantSchema(rawUrl, tenant) {
  const cleaned = cleanDatabaseUrl(rawUrl);
  if (!tenant) return cleaned;
  const schema = normalizeTenantSchema(tenant);
  if (schema === "public") return cleaned;
  try {
    const parsed = new URL(cleaned);
    parsed.searchParams.set("schema", schema);
    return parsed.toString();
  } catch {
    const sep = cleaned.includes("?") ? "&" : "?";
    return `${cleaned}${sep}schema=${schema}`;
  }
}

function resolveSqliteDatabasePath(explicitPath, envUrl) {
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) return path.resolve(explicitPath);
    console.error(`[ERROR] Specified SQLite database path does not exist: ${explicitPath}`);
    process.exit(1);
  }

  const cleanedUrl = cleanDatabaseUrl(envUrl);
  if (cleanedUrl.toLowerCase().startsWith("file:")) {
    let filePart = cleanedUrl.slice(5).split("?")[0];
    if (/^\/[A-Za-z]:/.test(filePart)) filePart = filePart.slice(1);
    if (fs.existsSync(filePart)) return path.resolve(filePart);
    const prismaRel = path.resolve(process.cwd(), "prisma", filePart);
    if (fs.existsSync(prismaRel)) return prismaRel;
  }

  const candidates = [
    path.resolve(process.cwd(), "prisma", "dev.db"),
    path.resolve(process.cwd(), "dev.db"),
    path.resolve(process.cwd(), "uas-enterprise.db"),
    "C:\\UAS-Data\\uas-enterprise.db",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return candidates[0];
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${SCRYPT_PREFIX}${salt}$${derived}`;
}

async function resetViaPrisma(databaseUrl, options) {
  const targetUrl = isPostgresUrl(databaseUrl)
    ? withPostgresTenantSchema(databaseUrl, options.tenant)
    : cleanDatabaseUrl(databaseUrl);

  const redactedUrl = targetUrl.replace(/:([^:@/]+)@/, ":***@");
  console.log(`[UAS Reset] Connecting via Prisma (@prisma/client): ${redactedUrl}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: {
      db: { url: targetUrl },
    },
  });

  try {
    const cleanTarget = options.username.trim();
    const userRow = cleanTarget
      ? await prisma.user.findFirst({
          where: {
            OR: [
              { id: cleanTarget },
              { username: cleanTarget },
              { username: cleanTarget.toLowerCase() },
              { email: cleanTarget.toLowerCase() },
            ],
          },
          select: {
            id: true,
            username: true,
            displayName: true,
            name: true,
            role: true,
            email: true,
          },
        })
      : await prisma.user.findFirst({
          where: {
            OR: [
              { role: "SUPER_ADMIN" },
              { username: "system_owner" },
              { username: "admin" },
            ],
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            username: true,
            displayName: true,
            name: true,
            role: true,
            email: true,
          },
        });

    if (!userRow) {
      console.error("[ERROR] No matching SUPER_ADMIN or target user found in database!");
      process.exit(1);
    }

    const newHash = hashPassword(options.password.trim());
    const now = new Date();

    await prisma.user.update({
      where: { id: userRow.id },
      data: {
        passwordHash: newHash,
        active: true,
        isActive: true,
        archivedAt: null,
        mustChangePassword: false,
        passwordUpdatedAt: now,
      },
    });

    const auditId = "audit_" + crypto.randomBytes(8).toString("hex");
    const auditDetails = `تم إعادة تعيين كلمة مرور مدير النظام عبر أداة CLI للمستخدم (${userRow.username})`;
    const auditHash =
      "UAS-" +
      crypto
        .createHash("sha256")
        .update(`${auditId}:${Date.now()}`)
        .digest("hex")
        .slice(0, 6)
        .toUpperCase();

    try {
      await prisma.immutableAuditLog.create({
        data: {
          id: auditId,
          timestamp: now.toISOString(),
          userId: userRow.id,
          userDisplay: `${userRow.displayName || userRow.name} (${userRow.role})`,
          userRole: String(userRow.role),
          actionType: "ADMIN_PASSWORD_RESET_VIA_CLI",
          entityReference: userRow.id,
          details: auditDetails,
          sha256Hash: auditHash,
        },
      });
    } catch (auditErr) {
      console.warn("[WARN] Could not record to ImmutableAuditLog (non-fatal):", auditErr.message);
    }

    printSuccess(userRow, options.tenant || "default");
  } finally {
    await prisma.$disconnect();
  }
}

async function resetViaSqliteFile(dbPath, options) {
  if (!fs.existsSync(dbPath)) {
    console.error(`[ERROR] SQLite database file not found at: ${dbPath}`);
    console.error("Please specify a valid SQLite path with --db <path> or set DATABASE_URL to PostgreSQL.");
    process.exit(1);
  }

  console.log(`[UAS Reset] Opening SQLite database: ${dbPath}`);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);

  try {
    const integrityRow = db.prepare("PRAGMA integrity_check(1);").get();
    const integrityRes = integrityRow?.integrity_check || Object.values(integrityRow || {})[0];
    if (integrityRes !== "ok") {
      console.error(`[ERROR] Database integrity check failed: ${integrityRes}`);
      process.exit(1);
    }

    const cleanTarget = options.username.trim();
    const userRow = cleanTarget
      ? db
          .prepare(
            "SELECT id, username, displayName, name, role, email FROM User WHERE id = ? OR lower(username) = lower(?) OR lower(email) = lower(?) LIMIT 1"
          )
          .get(cleanTarget, cleanTarget, cleanTarget)
      : db
          .prepare(
            "SELECT id, username, displayName, name, role, email FROM User WHERE role = ? OR username = ? OR username = ? LIMIT 1"
          )
          .get("SUPER_ADMIN", "system_owner", "admin");

    if (!userRow) {
      console.error("[ERROR] No matching SUPER_ADMIN or admin user found in SQLite database!");
      process.exit(1);
    }

    const newHash = hashPassword(options.password.trim());
    const nowIso = new Date().toISOString();
    const userCols = db.prepare("PRAGMA table_info(User);").all().map((c) => c.name);
    const hasArchivedAt = userCols.includes("archivedAt");

    db.prepare(`
      UPDATE User
      SET passwordHash = ?,
          active = 1,
          isActive = 1,
          ${hasArchivedAt ? "archivedAt = NULL," : ""}
          mustChangePassword = 0,
          passwordUpdatedAt = ?
      WHERE id = ?
    `).run(newHash, nowIso, userRow.id);

    const auditId = "audit_" + crypto.randomBytes(8).toString("hex");
    const auditDetails = `تم إعادة تعيين كلمة مرور مدير النظام عبر أداة CLI المحلية للمستخدم (${userRow.username})`;
    const auditHash =
      "UAS-" +
      crypto
        .createHash("sha256")
        .update(`${auditId}:${Date.now()}`)
        .digest("hex")
        .slice(0, 6)
        .toUpperCase();

    try {
      db.prepare(`
        INSERT INTO ImmutableAuditLog (
          id, timestamp, userId, userDisplay, userRole, actionType, entityReference, details, sha256Hash, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        auditId,
        nowIso,
        userRow.id,
        `${userRow.displayName || userRow.name} (${userRow.role})`,
        userRow.role,
        "ADMIN_PASSWORD_RESET_VIA_CLI",
        userRow.id,
        auditDetails,
        auditHash,
        nowIso
      );
    } catch (auditErr) {
      console.warn("[WARN] Could not record to ImmutableAuditLog (non-fatal):", auditErr.message);
    }

    printSuccess(userRow, "sqlite");
  } finally {
    db.close();
  }
}

function printSuccess(userRow, targetScope) {
  console.log("---------------------------------------------------------");
  console.log("[SUCCESS] Admin password reset successfully!");
  console.log(`Scope:     ${targetScope}`);
  console.log(`User ID:   ${userRow.id}`);
  console.log(`Username:  ${userRow.username}`);
  console.log(`Email:     ${userRow.email}`);
  console.log(`Role:      ${userRow.role}`);
  console.log("Hash Alg:  scrypt$ (keylen=64)");
  console.log("Status:    ACTIVE");
  console.log("---------------------------------------------------------");
}

async function main() {
  loadEnvFiles();
  const options = parseArgs();

  if (options.help || (!options.password && process.argv.length <= 2)) {
    console.log(`
UAS Enterprise Accounting System - Admin Password Reset (PostgreSQL & SQLite)
=============================================================================
Usage:
  node scripts/reset-admin-password.mjs --password "<new-password>" [--tenant "<slug>"] [--username "<user>"]
  node scripts/reset-admin-password.mjs --db "<path-to-sqlite.db>" --password "<new-password>"

Examples:
  node scripts/reset-admin-password.mjs --password "AdminPass2026!"
  node scripts/reset-admin-password.mjs --tenant "alwaha" --password "AdminPass2026!"
  node scripts/reset-admin-password.mjs --username "system_owner" --password "AdminPass2026!"
`);
    process.exit(0);
  }

  if (!options.password || options.password.trim().length < 6) {
    console.error("[ERROR] Missing or invalid --password argument. Must be at least 6 characters.");
    process.exit(1);
  }

  const effectiveUrl = cleanDatabaseUrl(options.url || process.env.DATABASE_URL || "");

  if (options.db) {
    const dbPath = resolveSqliteDatabasePath(options.db, effectiveUrl);
    await resetViaSqliteFile(dbPath, options);
    return;
  }

  if (isPostgresUrl(effectiveUrl)) {
    await resetViaPrisma(effectiveUrl, options);
    return;
  }

  // Fallback for local SQLite file URL or auto-detected dev.db
  if (effectiveUrl.toLowerCase().startsWith("file:")) {
    try {
      await resetViaPrisma(effectiveUrl, options);
      return;
    } catch {
      // Fallback to direct node:sqlite if Prisma schema was generated for postgresql
    }
  }

  const dbPath = resolveSqliteDatabasePath("", effectiveUrl);
  await resetViaSqliteFile(dbPath, options);
}

main().catch((err) => {
  console.error("[ERROR] Password reset failed:", err);
  process.exit(1);
});

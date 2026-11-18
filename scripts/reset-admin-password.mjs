#!/usr/bin/env node
/**
 * UAS Enterprise Accounting System - Local CLI Admin Password Reset Script
 *
 * Usage:
 *   node scripts/reset-admin-password.mjs --db "C:\UAS-Data\uas-enterprise.db" --password "NewSecurePassword123"
 *
 * Options:
 *   --db <path>         Path to SQLite database (default: auto-detected)
 *   --password <pass>   New password for SUPER_ADMIN (min 6 characters)
 *   --username <user>   Target username (default: auto-detects SUPER_ADMIN)
 *   --help              Display this help message
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    db: "",
    password: "",
    username: "",
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--db" && i + 1 < args.length) {
      options.db = args[++i];
    } else if (arg === "--password" && i + 1 < args.length) {
      options.password = args[++i];
    } else if (arg === "--username" && i + 1 < args.length) {
      options.username = args[++i];
    }
  }

  return options;
}

function resolveDatabasePath(explicitPath) {
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) return path.resolve(explicitPath);
    console.error(`[ERROR] Specified database path does not exist: ${explicitPath}`);
    process.exit(1);
  }

  const envUrl = process.env.DATABASE_URL || "";
  if (envUrl.toLowerCase().startsWith("file:")) {
    let filePart = envUrl.slice(5).split("?")[0];
    if (/^\/[A-Za-z]:/.test(filePart)) filePart = filePart.slice(1);
    if (fs.existsSync(filePart)) return path.resolve(filePart);
  }

  const candidates = [
    "C:\\UAS-Data\\uas-enterprise.db",
    path.resolve(process.cwd(), "prisma", "dev.db"),
    path.resolve(process.cwd(), "dev.db"),
    path.resolve(process.cwd(), "uas-enterprise.db"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return candidates[0]; // fallback
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function main() {
  const options = parseArgs();

  if (options.help || (!options.password && process.argv.length <= 2)) {
    console.log(`
UAS Enterprise Accounting System - Local Admin Password Reset
==============================================================
Usage:
  node scripts/reset-admin-password.mjs --db "<path-to-db>" --password "<new-password>"

Examples:
  node scripts/reset-admin-password.mjs --db "C:\\UAS-Data\\uas-enterprise.db" --password "AdminPass2026!"
  node scripts/reset-admin-password.mjs --password "AdminPass2026!"
`);
    process.exit(0);
  }

  if (!options.password || options.password.trim().length < 6) {
    console.error("[ERROR] Missing or invalid --password argument. Must be at least 6 characters.");
    process.exit(1);
  }

  const dbPath = resolveDatabasePath(options.db);
  if (!fs.existsSync(dbPath)) {
    console.error(`[ERROR] SQLite database file not found at: ${dbPath}`);
    console.error("Please specify valid database path with --db <path>");
    process.exit(1);
  }

  console.log(`[UAS Reset] Opening database: ${dbPath}`);
  let db;
  try {
    db = new DatabaseSync(dbPath);
  } catch (err) {
    console.error(`[ERROR] Failed to open SQLite database: ${err.message}`);
    process.exit(1);
  }

  try {
    // 1. Check integrity
    const integrityRow = db.prepare("PRAGMA integrity_check(1);").get();
    const integrityRes = integrityRow?.integrity_check || Object.values(integrityRow || {})[0];
    if (integrityRes !== "ok") {
      console.error(`[ERROR] Database integrity check failed: ${integrityRes}`);
      process.exit(1);
    }

    // 2. Locate Admin user
    let userRow;
    if (options.username) {
      userRow = db
        .prepare("SELECT id, username, displayName, name, role, email FROM User WHERE username = ? LIMIT 1")
        .get(options.username);
    } else {
      userRow = db
        .prepare("SELECT id, username, displayName, name, role, email FROM User WHERE role = ? OR username = ? LIMIT 1")
        .get("SUPER_ADMIN", "admin");
    }

    if (!userRow) {
      console.error("[ERROR] No matching SUPER_ADMIN or admin user found in database!");
      process.exit(1);
    }

    const newHash = hashPassword(options.password.trim());
    const nowIso = new Date().toISOString();

    // 3. Update password and activate user
    const updateStmt = db.prepare(`
      UPDATE User
      SET passwordHash = ?,
          active = 1,
          isActive = 1,
          mustChangePassword = 0,
          passwordUpdatedAt = ?
      WHERE id = ?
    `);
    updateStmt.run(newHash, nowIso, userRow.id);

    // 4. Record audit log
    const auditId = "audit_" + crypto.randomBytes(8).toString("hex");
    const auditDetails = `تم إعادة تعيين كلمة مرور مدير النظام عبر أداة CLI المحلية للمستخدم (${userRow.username})`;
    const auditHash = "UAS-" + crypto.createHash("sha256").update(`${auditId}:${Date.now()}`).digest("hex").slice(0, 6).toUpperCase();

    try {
      const auditStmt = db.prepare(`
        INSERT INTO ImmutableAuditLog (
          id, timestamp, userId, userDisplay, userRole, actionType, entityReference, details, sha256Hash, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      auditStmt.run(
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

    console.log("---------------------------------------------------------");
    console.log(`[SUCCESS] Admin password reset successfully!`);
    console.log(`User ID:   ${userRow.id}`);
    console.log(`Username:  ${userRow.username}`);
    console.log(`Email:     ${userRow.email}`);
    console.log(`Role:      ${userRow.role}`);
    console.log(`Status:    ACTIVE`);
    console.log("---------------------------------------------------------");
  } finally {
    db.close();
  }
}

main();

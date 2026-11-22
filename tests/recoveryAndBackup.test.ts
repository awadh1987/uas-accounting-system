import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  formatBytes,
  pruneRollingBackups,
  validateCandidateSqliteHeader,
  validateAndInspectCandidateDb,
} from "../src/lib/backupService";
import {
  companyNamesMatch,
  canonicalizeLicensePayload,
  type UasSignedLicense,
} from "../src/lib/licensing/licenseSchema";
import { verifyLicenseSignature } from "../src/lib/licensing/verifier";
import { hashPassword, isLegacySha256Hash, verifyPassword } from "../src/lib/serverBootstrap";
import { execFileSync } from "node:child_process";

// Test Ed25519 Keypair for test licenses
const TEST_KEYPAIR = crypto.generateKeyPairSync("ed25519");
const TEST_PRIVATE_KEY_PEM = TEST_KEYPAIR.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const TEST_PUBLIC_KEY_PEM = TEST_KEYPAIR.publicKey.export({
  type: "spki",
  format: "pem",
}) as string;

function createSignedTestLicense(
  overrides?: Partial<UasSignedLicense>
): UasSignedLicense {
  const base: Omit<UasSignedLicense, "signature"> = {
    license_id: "UAS-TEST-LIC-2026",
    customer_name: "مؤسسة القات للتجارة والإنتاج الزراعي",
    company_name: "مؤسسة القات للتجارة والإنتاج الزراعي",
    hwid: "*",
    allowed_modes: ["local", "lan", "cloud"],
    max_branches: 1,
    max_lan_seats: 7,
    max_users: 7,
    per_user_devices: { windows: 1, android: 1 },
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
    ...overrides,
  };

  const canonical = canonicalizeLicensePayload(base);
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), TEST_PRIVATE_KEY_PEM);
  return {
    ...base,
    signature: sig.toString("base64"),
  };
}

describe("SUPER_ADMIN Password Recovery & Cryptographic Verification", () => {
  it("verifies Ed25519 signature of valid test license", () => {
    const license = createSignedTestLicense();
    const valid = verifyLicenseSignature(license, TEST_PUBLIC_KEY_PEM);
    assert.equal(valid, true, "Signature must be valid");
  });

  it("rejects tampered or corrupt license signature", () => {
    const license = createSignedTestLicense();
    const tampered: UasSignedLicense = {
      ...license,
      company_name: "شركة أخرى غير مصرح بها",
    };
    const valid = verifyLicenseSignature(tampered, TEST_PUBLIC_KEY_PEM);
    assert.equal(valid, false, "Tampered license must fail signature check");
  });

  it("verifies company name normalization and Arabic letter matching", () => {
    const licensedName = "مؤسسة القات للتجارة والإنتاج الزراعي";
    assert.equal(
      companyNamesMatch("مؤسسة القات للتجارة والانتاج الزراعي", licensedName),
      true,
      "Alef variants must match"
    );
    assert.equal(
      companyNamesMatch("شركة الصيدلية الحديثة", licensedName),
      false,
      "Different company must fail"
    );
  });

  it("hashes password with salted scrypt and supports legacy SHA-256 verification", () => {
    const pass = "AdminPass2026!";
    const hash1 = hashPassword(pass);
    const hash2 = hashPassword(pass);
    assert.ok(hash1.startsWith("scrypt$"));
    assert.notEqual(hash1, hash2, "Random salts must produce unique hashes");
    assert.equal(verifyPassword(pass, hash1), true);
    assert.equal(verifyPassword(pass, hash2), true);
    assert.equal(verifyPassword("WrongPass!", hash1), false);

    // Backward compatibility for legacy unsalted SHA-256 hashes
    const legacySha256 = crypto.createHash("sha256").update(pass).digest("hex");
    assert.equal(isLegacySha256Hash(legacySha256), true);
    assert.equal(verifyPassword(pass, legacySha256), true);
    assert.equal(verifyPassword("WrongPass!", legacySha256), false);
  });
});

describe("Backup Service - SQLite Headers, Envelope & Rolling Pruning", () => {
  it("validates candidate SQLite header magic bytes", () => {
    const validHeader = Buffer.from("SQLite format 3\0SomeData...", "utf8");
    assert.equal(validateCandidateSqliteHeader(validHeader), true);

    const invalidHeader = Buffer.from("NOT_A_SQLITE_DATABASE_FILE", "utf8");
    assert.equal(validateCandidateSqliteHeader(invalidHeader), false);

    const empty = Buffer.alloc(0);
    assert.equal(validateCandidateSqliteHeader(empty), false);
  });

  it("formats bytes accurately for UI display", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1024), "1 KB");
    assert.equal(formatBytes(1024 * 1024 * 4.5), "4.5 MB");
  });

  it("prunes rolling daily backups to maximum 14 snapshots", () => {
    const tmpDir = path.join(os.tmpdir(), "uas-prune-test-" + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Create 20 mock daily snapshots
      for (let i = 1; i <= 20; i++) {
        const day = String(i).padStart(2, "0");
        const filename = `uas-auto-2026-11-${day}.db`;
        fs.writeFileSync(path.join(tmpDir, filename), "MOCK_DB_CONTENT");
      }

      const filesBefore = fs.readdirSync(tmpDir);
      assert.equal(filesBefore.length, 20);

      const deleted = pruneRollingBackups(tmpDir, 14);
      assert.equal(deleted, 6, "Must prune 6 files so only 14 remain");

      const filesAfter = fs.readdirSync(tmpDir);
      assert.equal(filesAfter.length, 14);

      // Verify oldest days (01 through 06) were pruned, and newest (07 through 20) remain
      assert.equal(fs.existsSync(path.join(tmpDir, "uas-auto-2026-11-01.db")), false);
      assert.equal(fs.existsSync(path.join(tmpDir, "uas-auto-2026-11-20.db")), true);
      assert.equal(fs.existsSync(path.join(tmpDir, "uas-auto-2026-11-07.db")), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies and inspects valid SQLite database with core tables and company lock", () => {
    const tmpDbPath = path.join(os.tmpdir(), "uas-valid-check-" + Date.now() + ".db");
    const db = new DatabaseSync(tmpDbPath);

    try {
      db.exec(`
        CREATE TABLE User (id TEXT PRIMARY KEY, username TEXT, role TEXT);
        CREATE TABLE Account (id TEXT PRIMARY KEY, code TEXT, nameAr TEXT);
        CREATE TABLE JournalEntry (id TEXT PRIMARY KEY, entryNumber TEXT);
        CREATE TABLE EnterpriseProfile (id TEXT PRIMARY KEY, legalNameAr TEXT, legalNameEn TEXT);
        INSERT INTO EnterpriseProfile (id, legalNameAr, legalNameEn) VALUES ('default', 'مؤسسة القات للتجارة والإنتاج الزراعي', 'Al-Qat Trading & Agri Co');
      `);
      db.close();

      const buffer = fs.readFileSync(tmpDbPath);

      // 1. Should pass when company name matches
      const checkValid = validateAndInspectCandidateDb(
        buffer,
        "مؤسسة القات للتجارة والإنتاج الزراعي"
      );
      assert.equal(checkValid.ok, true);
      assert.equal(checkValid.companyName, "مؤسسة القات للتجارة والإنتاج الزراعي");

      // 2. Should reject when company name belongs to another organization
      const checkMismatch = validateAndInspectCandidateDb(
        buffer,
        "شركة الرواد للاستثمار والتطوير"
      );
      assert.equal(checkMismatch.ok, false);
      assert.match(checkMismatch.error || "", /لا يطابق/);
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
    }
  });

  it("rejects database missing core tables", () => {
    const tmpDbPath = path.join(os.tmpdir(), "uas-missing-table-" + Date.now() + ".db");
    const db = new DatabaseSync(tmpDbPath);

    try {
      // Only create 1 table
      db.exec("CREATE TABLE User (id TEXT PRIMARY KEY, username TEXT);");
      db.close();

      const buffer = fs.readFileSync(tmpDbPath);
      const res = validateAndInspectCandidateDb(buffer);
      assert.equal(res.ok, false);
      assert.match(res.error || "", /تفتقر إلى الجداول الأساسية/);
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
    }
  });
});

describe("Local CLI Admin Password Reset Script (scripts/reset-admin-password.mjs)", () => {
  it("executes CLI script against SQLite database and updates password", () => {
    const tmpDbPath = path.join(os.tmpdir(), "uas-cli-reset-" + Date.now() + ".db");
    const db = new DatabaseSync(tmpDbPath);

    try {
      db.exec(`
        CREATE TABLE User (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE,
          displayName TEXT,
          name TEXT,
          email TEXT UNIQUE,
          passwordHash TEXT,
          role TEXT,
          active INTEGER DEFAULT 0,
          isActive INTEGER DEFAULT 0,
          mustChangePassword INTEGER DEFAULT 1,
          passwordUpdatedAt TEXT
        );
        CREATE TABLE ImmutableAuditLog (
          id TEXT PRIMARY KEY,
          timestamp TEXT,
          userId TEXT,
          userDisplay TEXT,
          userRole TEXT,
          actionType TEXT,
          entityReference TEXT,
          details TEXT,
          sha256Hash TEXT,
          createdAt TEXT
        );
        INSERT INTO User (id, username, displayName, name, email, passwordHash, role, active, isActive)
        VALUES ('u1', 'admin', 'مدير النظام', 'Admin', 'admin@uas.local', 'OLD_HASH', 'SUPER_ADMIN', 0, 0);
      `);
      db.close();

      // Run CLI script
      const scriptPath = path.resolve(process.cwd(), "scripts", "reset-admin-password.mjs");
      const newPass = "SuperSecretNewPass2026!";
      const output = execFileSync(
        process.execPath,
        [scriptPath, "--db", tmpDbPath, "--password", newPass],
        { encoding: "utf8" }
      );

      assert.match(output, /SUCCESS/);
      assert.match(output, /Admin password reset successfully/);

      // Verify SQLite state
      const dbCheck = new DatabaseSync(tmpDbPath);
      const row = dbCheck
        .prepare("SELECT username, passwordHash, active, isActive, mustChangePassword FROM User WHERE id = 'u1'")
        .get() as {
        username: string;
        passwordHash: string;
        active: number;
        isActive: number;
        mustChangePassword: number;
      };

      assert.equal(row.username, "admin");
      assert.ok(row.passwordHash.startsWith("scrypt$"));
      assert.equal(verifyPassword(newPass, row.passwordHash), true);
      assert.equal(verifyPassword("WrongPass!", row.passwordHash), false);
      assert.equal(row.active, 1);
      assert.equal(row.isActive, 1);
      assert.equal(row.mustChangePassword, 0);

      const auditRow = dbCheck
        .prepare("SELECT actionType, details FROM ImmutableAuditLog LIMIT 1")
        .get() as { actionType: string; details: string };
      assert.equal(auditRow.actionType, "ADMIN_PASSWORD_RESET_VIA_CLI");

      dbCheck.close();
    } finally {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
    }
  });
});

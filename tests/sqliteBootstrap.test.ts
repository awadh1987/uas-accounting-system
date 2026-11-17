import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("Pure-Runtime Self-Healing SQLite Initialization (Zero CLI / Zero npx)", () => {
  it("creates missing SQLite file, applies all migrations, and seeds baseline records automatically", () => {
    const tmpDir = path.resolve(process.cwd(), "tests", ".tmp-sqlite-heal");
    const tmpDbPath = path.join(tmpDir, "fresh-customer.db");

    // Ensure fresh state: remove any prior temp DB
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    assert.equal(fs.existsSync(tmpDbPath), false, "DB file must not exist before self-healing");

    const dbUrl = `file:${tmpDbPath.replace(/\\/g, "/")}`;
    const runnerScript = `
      import { ensureSqliteDatabaseReady } from "../src/lib/sqliteBootstrap";
      import { prisma } from "../src/lib/prisma";

      async function run() {
        await ensureSqliteDatabaseReady();
        const tables = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'");
        const migrations = await prisma.$queryRawUnsafe("SELECT migration_name, applied_steps_count FROM _prisma_migrations");
        const profile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
        const settings = await prisma.systemSettings.findUnique({ where: { id: "default" } });
        const license = await prisma.licenseState.findUnique({ where: { id: "active" } });
        const accountCount = await prisma.account.count();
        const treasuryCount = await prisma.treasuryAccount.count();
        const ratesCount = await prisma.currencyRate.count();
        const projectCount = await prisma.project.count();

        // Call a second time to verify idempotency
        await ensureSqliteDatabaseReady();

        console.log(JSON.stringify({
          tableCount: tables.length,
          tableNames: tables.map((t) => t.name),
          migrations,
          hasProfile: Boolean(profile),
          hasSettings: Boolean(settings),
          licenseStatus: license?.status,
          accountCount,
          treasuryCount,
          ratesCount,
          projectCount,
        }));
        await prisma.$disconnect();
      }
      run().catch((err) => { console.error(err); process.exit(1); });
    `;

    const tmpScriptPath = path.resolve(process.cwd(), "tests", ".tmp-heal-runner.ts");
    fs.writeFileSync(tmpScriptPath, runnerScript, "utf8");

    try {
      const tsxBin = path.resolve(
        process.cwd(),
        "node_modules",
        ".bin",
        process.platform === "win32" ? "tsx.cmd" : "tsx"
      );
      const stdout = execFileSync(tsxBin, [tmpScriptPath], {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
        },
      });

      const lastLine = stdout.trim().split(/\r?\n/).pop() || "{}";
      const summary = JSON.parse(lastLine);

      assert.equal(fs.existsSync(tmpDbPath), true, "SQLite DB file must be created automatically");
      assert.ok(summary.tableNames.includes("EnterpriseProfile"), "EnterpriseProfile table must exist");
      assert.ok(summary.tableNames.includes("LicenseState"), "LicenseState table must exist");
      assert.ok(summary.tableNames.includes("Account"), "Account table must exist");
      assert.ok(summary.tableNames.includes("Project"), "Project table must exist");
      assert.ok(summary.tableNames.includes("_prisma_migrations"), "_prisma_migrations table must exist");
      assert.ok(summary.migrations.length >= 1, "At least 1 migration must be recorded in _prisma_migrations");
      assert.equal(summary.hasProfile, true, "Default EnterpriseProfile must be upserted");
      assert.equal(summary.hasSettings, true, "Default SystemSettings must be upserted");
      assert.equal(summary.licenseStatus, "UNLICENSED", "Default LicenseState must be upserted");
      assert.ok(summary.accountCount > 50, `Full 6-generation COA should be seeded (got ${summary.accountCount})`);
      assert.equal(summary.treasuryCount, 1, "Main Cash Vault should be seeded");
      assert.equal(summary.ratesCount, 3, "Default currency rates (YER, SAR, USD) should be seeded");
      assert.equal(summary.projectCount, 0, "Zero-transaction clean baseline must have 0 demo projects");
    } finally {
      if (fs.existsSync(tmpScriptPath)) fs.unlinkSync(tmpScriptPath);
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

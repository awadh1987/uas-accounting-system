import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const targetArg = process.argv[2] || path.join(projectRoot, "release", "UAS-Commercial-Dist", "app", "prisma", "template.db");
const templateDbPath = path.isAbsolute(targetArg) ? targetArg : path.resolve(projectRoot, targetArg);
const templateDir = path.dirname(templateDbPath);

fs.mkdirSync(templateDir, { recursive: true });

// Remove any prior template.db or SQLite WAL sidecar files
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const f = templateDbPath + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const dbUrl = `file:${templateDbPath.replace(/\\/g, "/")}`;
const tsxEntrypoint = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

if (!fs.existsSync(tsxEntrypoint)) {
  console.error(`[ERROR] Local tsx entrypoint not found at ${tsxEntrypoint}`);
  process.exit(1);
}

console.log(`[Template DB] Building pre-migrated, zero-transaction template.db at: ${templateDbPath}`);

// Step 1: Apply all SQLite migrations & _prisma_migrations tracking via pure-runtime sqliteBootstrap (ZERO npx!)
const bootstrapSnippet = `
import { ensureSqliteDatabaseReady } from "../src/lib/sqliteBootstrap";
import { prisma } from "../src/lib/prisma";

async function run() {
  await ensureSqliteDatabaseReady();
  await prisma.$disconnect();
}
run().catch((err) => { console.error(err); process.exit(1); });
`;
const tmpBootstrapTs = path.join(projectRoot, "scripts", ".tmp-init-template.ts");
fs.writeFileSync(tmpBootstrapTs, bootstrapSnippet, "utf8");

try {
  execFileSync(process.execPath, [tsxEntrypoint, tmpBootstrapTs], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
    },
  });

  // Step 2: Run full clean enterprise seed (6-Gen COA, Main Cash Vault, EnterpriseProfile, SystemSettings, Initial Admin)
  execFileSync(process.execPath, [tsxEntrypoint, path.join(projectRoot, "prisma", "seed.ts")], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
    },
  });

  // Step 3: Upsert LicenseState + flush WAL journal back into single self-contained template.db & verify tables
  const verifySnippet = `
import { prisma } from "../src/lib/prisma";

async function verify() {
  await prisma.licenseState.upsert({
    where: { id: "active" },
    update: {},
    create: {
      id: "active",
      status: "UNLICENSED",
      seatRegistryJson: "[]",
    },
  });

  const tables = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table'");
  const names = tables.map((t) => t.name);
  const required = ["EnterpriseProfile", "LicenseState", "LicenseDeviceBinding", "Account", "Project", "User", "SystemSettings", "_prisma_migrations"];
  for (const r of required) {
    if (!names.includes(r)) {
      throw new Error("Template DB missing required table: " + r);
    }
  }
  const accountCount = await prisma.account.count();
  const userCount = await prisma.user.count();

  // Consolidate WAL into main DB file so template.db is a clean single file
  await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = DELETE;");

  console.log(\`[Template DB] Verified \${names.length} tables, \${accountCount} COA accounts, \${userCount} admin baseline account.\`);
  await prisma.$disconnect();
}
verify().catch((err) => { console.error(err); process.exit(1); });
`;
  const tmpVerifyTs = path.join(projectRoot, "scripts", ".tmp-verify-template.ts");
  fs.writeFileSync(tmpVerifyTs, verifySnippet, "utf8");

  try {
    execFileSync(process.execPath, [tsxEntrypoint, tmpVerifyTs], {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
      },
    });
  } finally {
    if (fs.existsSync(tmpVerifyTs)) fs.unlinkSync(tmpVerifyTs);
  }
} finally {
  if (fs.existsSync(tmpBootstrapTs)) fs.unlinkSync(tmpBootstrapTs);
}

// Clean up any trailing WAL/SHM files after DELETE journal mode
for (const suffix of ["-wal", "-shm", "-journal"]) {
  const f = templateDbPath + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const stat = fs.statSync(templateDbPath);
console.log(`[Template DB] Ready: ${templateDbPath} (${(stat.size / 1024).toFixed(1)} KB)`);

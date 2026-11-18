import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

async function waitForUrl(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return res;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {}
}

async function runScenario(name, exe, args, env, dbPathToVerify, port = 3000) {
  console.log(`\n=== ${name} ===`);
  let logs = "";
  const appDir = path.join(projectRoot, "release", "UAS-Commercial-Dist", "app");
  const child = spawn(exe, args, {
    cwd: appDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => {
    logs += d.toString();
  });
  child.stderr.on("data", (d) => {
    logs += d.toString();
  });

  try {
    await waitForUrl(`http://127.0.0.1:${port}/api/public/verify`);

    const rHome = await fetch(`http://127.0.0.1:${port}/`);
    const homeHtml = await rHome.text();
    const rVerify = await fetch(`http://127.0.0.1:${port}/api/public/verify`);
    const rBoot = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
    const rLic = await fetch(`http://127.0.0.1:${port}/api/licensing/status`);

    // Verify all linked /_next/static CSS chunks return 200 OK with text/css
    const cssHrefs = [...homeHtml.matchAll(/href="(\/_next\/static\/[^"]+\.css[^"]*)"/g)].map(
      (m) => m[1]
    );
    const cssResults = [];
    for (const href of cssHrefs) {
      const rCss = await fetch(`http://127.0.0.1:${port}${href}`);
      const cssBody = await rCss.text();
      cssResults.push({
        href,
        status: rCss.status,
        contentType: rCss.headers.get("content-type"),
        sizeBytes: cssBody.length,
        hasTailwind: cssBody.includes("--tw-") || cssBody.includes("card-surface"),
      });
    }

    const hasExeDownloadInHtml = homeHtml.includes("UAS-Setup-Win64.exe");
    const hasApkDownloadInHtml = homeHtml.includes("uas-latest.apk");

    const jVerify = await rVerify.json();
    const jBoot = await rBoot.json();
    const jLic = await rLic.json();

    const hasP2021 = logs.includes("P2021");
    const hasPrismaErr = logs.includes("prisma:error");
    const dbExists = fs.existsSync(dbPathToVerify);
    const dbSizeBytes = dbExists ? fs.statSync(dbPathToVerify).size : 0;

    console.log({
      homeStatus: rHome.status,
      cssResults,
      hasExeDownloadInHtml,
      hasApkDownloadInHtml,
      verifyStatus: rVerify.status,
      bootstrapStatus: rBoot.status,
      licensingStatus: rLic.status,
      profileName: jVerify.profile?.legalNameEn,
      treasuryCount: jBoot.treasuryAccounts?.length,
      requestCode: jLic.request_code,
      licenseStatus: jLic.license_status,
      dbExists,
      dbSizeBytes,
      hasP2021,
      hasPrismaErr,
    });

    const cssOk =
      cssResults.length > 0 &&
      cssResults.every(
        (c) =>
          c.status === 200 &&
          String(c.contentType || "").includes("text/css") &&
          c.sizeBytes > 1000 &&
          c.hasTailwind
      );

    if (
      rHome.status !== 200 ||
      !cssOk ||
      hasExeDownloadInHtml ||
      hasApkDownloadInHtml ||
      rVerify.status !== 200 ||
      rBoot.status !== 200 ||
      rLic.status !== 200 ||
      hasP2021 ||
      hasPrismaErr ||
      !dbExists ||
      dbSizeBytes === 0
    ) {
      console.error("[FAIL] Captured server logs:\n" + logs);
      process.exitCode = 1;
    } else {
      console.log("[PASS] Clean boot: HTTP 200 + Tailwind CSS 200 OK + zero downloads in HTML + zero P2021!");
    }
  } catch (err) {
    console.error("[ERROR]", err.message);
    console.error("Captured logs:\n" + logs);
    process.exitCode = 1;
  } finally {
    killTree(child.pid);
    await new Promise((r) => setTimeout(r, 800));
  }
}

async function main() {
  const appDir = path.join(projectRoot, "release", "UAS-Commercial-Dist", "app");

  // TEST A: Brand-new nonexistent DB file -> pure-runtime self-healing via bundled runtime/node.exe
  const tmpDirA = path.join(projectRoot, "release", ".tmp-test-zero-db");
  fs.rmSync(tmpDirA, { recursive: true, force: true });
  const dbPathA = path.join(tmpDirA, "zero-boot.db");

  await runScenario(
    "TEST A: Deleted/Missing DB -> Pure-Runtime Self-Healing (Bundled runtime/node.exe)",
    path.join(appDir, "runtime", "node.exe"),
    [path.join(appDir, "server.js")],
    {
      NODE_ENV: "production",
      PORT: "3000",
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: `file:${dbPathA.replace(/\\/g, "/")}`,
    },
    dbPathA,
    3000
  );
  fs.rmSync(tmpDirA, { recursive: true, force: true });

  // TEST B: Native UAS.exe Launcher -> delete DB, verify first-launch template.db copy + clean boot on http://localhost:3000
  const activeDataDir = fs.existsSync("C:\\UAS-Data")
    ? "C:\\UAS-Data"
    : path.join(projectRoot, "release", "UAS-Commercial-Dist", "UAS-Data");
  const dbPathB = path.join(activeDataDir, "uas-enterprise.db");
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const f = dbPathB + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  await runScenario(
    "TEST B: Native UAS.exe First-Launch -> template.db Copy + Clean Boot (http://localhost:3000)",
    path.join(appDir, "UAS.exe"),
    ["--local", "--no-browser", "--port", "3000"],
    {},
    dbPathB,
    3000
  );
}

main();

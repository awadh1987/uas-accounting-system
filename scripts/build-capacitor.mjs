import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const rootDir = process.cwd();
const apiDir = path.join(rootDir, "src", "app", "api");
const controlPanelPageDir = path.join(rootDir, "src", "app", "control-panel");
const superadminPageDir = path.join(rootDir, "src", "app", "superadmin");
const proxyFile = path.join(rootDir, "src", "proxy.ts");
const backupDir = path.join(rootDir, ".capacitor-api-backup");
const backupApiDir = path.join(backupDir, "api");
const backupControlPanelDir = path.join(backupDir, "control-panel");
const backupSuperadminDir = path.join(backupDir, "superadmin");
const backupProxyFile = path.join(backupDir, "proxy.ts");
const nextCacheDir = path.join(rootDir, ".next");
const apkStashDir = path.join(rootDir, ".capacitor-apk-stash");
const publicDownloadsDir = path.join(rootDir, "public", "downloads");
const androidAssetsPublicDir = path.join(rootDir, "android", "app", "src", "main", "assets", "public");

/**
 * Safely moves a file or directory, preferring an atomic rename and falling
 * back to recursive copy + remove when cross-device or Windows locks apply.
 * @param {string} src
 * @param {string} dest
 * @returns {boolean}
 */
function movePathSafe(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.cpSync(src, dest, { recursive: true });
    if (!fs.existsSync(dest)) {
      throw new Error(`Failed to copy ${src} to ${dest}`);
    }
    fs.rmSync(src, { recursive: true, force: true });
  }
  return true;
}

/** @type {Array<{ name: string, src: string, dest: string }>} */
const stashedApks = [];
let movedApi = false;
let movedControlPanel = false;
let movedSuperadmin = false;
let movedProxy = false;
let isCleaningUp = false;

/**
 * Temporarily stash any .apk / .exe files from public/downloads to avoid bundling them into static export.
 */
function stashPublicApks() {
  if (!fs.existsSync(publicDownloadsDir)) return;
  fs.mkdirSync(apkStashDir, { recursive: true });
  for (const entry of fs.readdirSync(publicDownloadsDir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.toLowerCase().endsWith(".apk") || entry.name.toLowerCase().endsWith(".exe"))) {
      const src = path.join(publicDownloadsDir, entry.name);
      const dest = path.join(apkStashDir, entry.name);
      stashedApks.push({ name: entry.name, src, dest });
      movePathSafe(src, dest);
      console.log(`[stash-apk] Temporarily stashed ${entry.name} out of public/downloads during Capacitor build.`);
    }
  }
}

/**
 * Restore all stashed files back to public/downloads (including any left in apkStashDir on disk).
 */
function restorePublicApks() {
  const restoredNames = new Set();

  for (const item of stashedApks) {
    if (fs.existsSync(item.dest)) {
      movePathSafe(item.dest, item.src);
      restoredNames.add(item.name);
      console.log(`[restore-apk] Restored ${item.name} to public/downloads.`);
    }
  }
  stashedApks.length = 0;

  if (fs.existsSync(apkStashDir)) {
    for (const entry of fs.readdirSync(apkStashDir, { withFileTypes: true })) {
      if (entry.isFile() || entry.isDirectory()) {
        const dest = path.join(apkStashDir, entry.name);
        const target = path.join(publicDownloadsDir, entry.name);
        movePathSafe(dest, target);
        if (!restoredNames.has(entry.name)) {
          console.log(`[restore-apk] Restored ${entry.name} to public/downloads.`);
        }
      }
    }
    if (fs.readdirSync(apkStashDir).length === 0) {
      fs.rmSync(apkStashDir, { recursive: true, force: true });
    }
  }
}

/**
 * Restores any temporarily moved API routes, proxy file, and stashed downloads.
 * Safe to invoke multiple times (idempotent).
 */
function restoreWorkspace() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  try {
    if ((movedApi || !fs.existsSync(apiDir)) && fs.existsSync(backupApiDir)) {
      movePathSafe(backupApiDir, apiDir);
      movedApi = false;
    }
    if ((movedControlPanel || !fs.existsSync(controlPanelPageDir)) && fs.existsSync(backupControlPanelDir)) {
      movePathSafe(backupControlPanelDir, controlPanelPageDir);
      movedControlPanel = false;
    }
    if ((movedSuperadmin || !fs.existsSync(superadminPageDir)) && fs.existsSync(backupSuperadminDir)) {
      movePathSafe(backupSuperadminDir, superadminPageDir);
      movedSuperadmin = false;
    }
    if ((movedProxy || !fs.existsSync(proxyFile)) && fs.existsSync(backupProxyFile)) {
      movePathSafe(backupProxyFile, proxyFile);
      movedProxy = false;
    }
    if (fs.existsSync(backupDir) && fs.readdirSync(backupDir).length === 0) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
    restorePublicApks();
  } finally {
    isCleaningUp = false;
  }
}

/**
 * Recursively removes any .apk or .exe files from a directory to prevent APK bloating.
 * @param {string} dir
 */
function cleanApkFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanApkFiles(full);
    } else if (entry.name.toLowerCase().endsWith(".apk") || entry.name.toLowerCase().endsWith(".exe")) {
      console.log(`[clean-apk] Removing stale APK file: ${full}`);
      fs.rmSync(full, { force: true });
    }
  }
}

/**
 * Strips .map sourcemaps and removes /downloads from ./out before `cap sync`
 * so the Android APK remains compact and contains zero self-download artifacts.
 * @param {string} outDir
 */
function stripSourcemapsAndDownloads(outDir) {
  if (!fs.existsSync(outDir)) return;
  const outDownloads = path.join(outDir, "downloads");
  if (fs.existsSync(outDownloads)) {
    fs.rmSync(outDownloads, { recursive: true, force: true });
    console.log(`[optimize-apk] Removed ${outDownloads} from static export.`);
  }
  let removedMaps = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.toLowerCase().endsWith(".map")) {
        fs.rmSync(full, { force: true });
        removedMaps++;
      }
    }
  }
  walk(outDir);
  if (removedMaps > 0) {
    console.log(`[optimize-apk] Stripped ${removedMaps} .map sourcemap file(s) from ./out.`);
  }
}

function handleTerminationSignal(signal) {
  console.error(`\n[build-mobile] Received ${signal}; restoring stashed files before exit...`);
  restoreWorkspace();
  process.exit(1);
}

process.on("SIGINT", handleTerminationSignal);
process.on("SIGTERM", handleTerminationSignal);
process.on("SIGHUP", handleTerminationSignal);
process.on("uncaughtException", (err) => {
  console.error("[build-mobile] Uncaught exception; restoring stashed files:", err);
  restoreWorkspace();
  process.exit(1);
});
process.on("exit", () => {
  restoreWorkspace();
});

try {
  // Recover any leftover stashed/backed-up files from a previously interrupted run
  restoreWorkspace();

  // Stash public downloads APKs/EXEs so next export doesn't copy large binaries into out/
  stashPublicApks();

  // Exclude/clean stale APK files from public/, out/ and android assets before building
  cleanApkFiles(path.join(rootDir, "public"));
  cleanApkFiles(path.join(rootDir, "out"));
  cleanApkFiles(androidAssetsPublicDir);

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  movedApi = movePathSafe(apiDir, backupApiDir);
  movedControlPanel = movePathSafe(controlPanelPageDir, backupControlPanelDir);
  movedSuperadmin = movePathSafe(superadminPageDir, backupSuperadminDir);
  movedProxy = movePathSafe(proxyFile, backupProxyFile);

  if (fs.existsSync(nextCacheDir)) {
    fs.rmSync(nextCacheDir, { recursive: true, force: true });
  }

  console.log("Building static Capacitor web bundle into ./out (excluding Control Panel & Superadmin License Generator)...");
  execSync("npx next build", {
    stdio: "inherit",
    env: {
      ...process.env,
      CAPACITOR_EXPORT: "1",
      NEXT_PUBLIC_CAPACITOR_EXPORT: "1",
      NEXT_PUBLIC_UAS_BUILD_TARGET: "mobile",
      UAS_BUILD_TARGET: "mobile",
      NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN: "0",
    },
  });

  // Ensure no excluded root-platform routes leaked into ./out
  for (const excludedOut of ["control-panel", "superadmin"]) {
    const excludedPath = path.join(rootDir, "out", excludedOut);
    if (fs.existsSync(excludedPath)) {
      fs.rmSync(excludedPath, { recursive: true, force: true });
    }
    const htmlFile = path.join(rootDir, "out", `${excludedOut}.html`);
    if (fs.existsSync(htmlFile)) {
      fs.rmSync(htmlFile, { force: true });
    }
  }

  // Ensure no stale .apk, .exe, .map sourcemaps, or /downloads folder exist in out/ before capacitor sync
  cleanApkFiles(path.join(rootDir, "out"));
  stripSourcemapsAndDownloads(path.join(rootDir, "out"));
  cleanApkFiles(androidAssetsPublicDir);
} finally {
  restoreWorkspace();
  // Remove static-export .next artifacts so `next start` does not boot without API routes
  if (fs.existsSync(nextCacheDir)) {
    fs.rmSync(nextCacheDir, { recursive: true, force: true });
  }
}

if (fs.existsSync(path.join(rootDir, "android")) || fs.existsSync(path.join(rootDir, "ios"))) {
  console.log("Syncing static ./out bundle to Capacitor native platforms...");
  execSync("npx cap sync", { stdio: "inherit" });
  cleanApkFiles(androidAssetsPublicDir);
}

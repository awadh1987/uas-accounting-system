import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const rootDir = process.cwd();
const apiDir = path.join(rootDir, "src", "app", "api");
const proxyFile = path.join(rootDir, "src", "proxy.ts");
const backupDir = path.join(rootDir, ".capacitor-api-backup");
const backupApiDir = path.join(backupDir, "api");
const backupProxyFile = path.join(backupDir, "proxy.ts");
const nextCacheDir = path.join(rootDir, ".next");
const apkStashDir = path.join(rootDir, ".capacitor-apk-stash");
const publicDownloadsDir = path.join(rootDir, "public", "downloads");
const androidAssetsPublicDir = path.join(rootDir, "android", "app", "src", "main", "assets", "public");

/**
 * @param {string} src
 * @param {string} dest
 * @returns {boolean}
 */
function movePathSafe(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  fs.rmSync(src, { recursive: true, force: true });
  return true;
}

let movedApi = false;
let movedProxy = false;
/** @type {Array<{ name: string, src: string, dest: string }>} */
let stashedApks = [];

/**
 * Temporarily stash any .apk files from public/downloads to avoid bundling them into static export.
 */
function stashPublicApks() {
  if (!fs.existsSync(publicDownloadsDir)) return [];
  const list = [];
  fs.mkdirSync(apkStashDir, { recursive: true });
  for (const entry of fs.readdirSync(publicDownloadsDir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.toLowerCase().endsWith(".apk") || entry.name.toLowerCase().endsWith(".exe"))) {
      const src = path.join(publicDownloadsDir, entry.name);
      const dest = path.join(apkStashDir, entry.name);
      fs.cpSync(src, dest);
      fs.rmSync(src, { force: true });
      list.push({ name: entry.name, src, dest });
      console.log(`[stash-apk] Temporarily stashed ${entry.name} out of public/downloads during Capacitor build.`);
    }
  }
  return list;
}

/**
 * Restore stashed APKs back to public/downloads.
 * @param {Array<{ name: string, src: string, dest: string }>} items
 */
function restorePublicApks(items) {
  for (const item of items) {
    if (fs.existsSync(item.dest)) {
      fs.mkdirSync(path.dirname(item.src), { recursive: true });
      fs.cpSync(item.dest, item.src);
      console.log(`[restore-apk] Restored ${item.name} to public/downloads.`);
    }
  }
  if (fs.existsSync(apkStashDir)) {
    fs.rmSync(apkStashDir, { recursive: true, force: true });
  }
}

/**
 * Recursively removes any .apk files from a directory to prevent APK bloating.
 * @param {string} dir
 */
function cleanApkFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanApkFiles(full);
    } else if ((entry.name.toLowerCase().endsWith(".apk") || entry.name.toLowerCase().endsWith(".exe"))) {
      console.log(`[clean-apk] Removing stale APK file: ${full}`);
      fs.rmSync(full, { force: true });
    }
  }
}

try {
  // Stash public downloads APKs so next export doesn't copy large APKs into out/
  stashedApks = stashPublicApks();

  // Exclude/clean stale APK files from public/, out/ and android assets before building
  cleanApkFiles(path.join(rootDir, "public"));
  cleanApkFiles(path.join(rootDir, "out"));
  cleanApkFiles(androidAssetsPublicDir);

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  movedApi = movePathSafe(apiDir, backupApiDir);
  movedProxy = movePathSafe(proxyFile, backupProxyFile);

  if (fs.existsSync(nextCacheDir)) {
    fs.rmSync(nextCacheDir, { recursive: true, force: true });
  }

  console.log("Building static Capacitor web bundle into ./out ...");
  execSync("npx next build", {
    stdio: "inherit",
    env: { ...process.env, CAPACITOR_EXPORT: "1" },
  });

  // Ensure no stale or copied .apk exists in out/ before capacitor sync
  cleanApkFiles(path.join(rootDir, "out"));
  cleanApkFiles(androidAssetsPublicDir);
} finally {
  if (movedApi && fs.existsSync(backupApiDir)) {
    movePathSafe(backupApiDir, apiDir);
  }
  if (movedProxy && fs.existsSync(backupProxyFile)) {
    movePathSafe(backupProxyFile, proxyFile);
  }
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
  // Remove static-export .next artifacts so `next start` does not boot without API routes
  if (fs.existsSync(nextCacheDir)) {
    fs.rmSync(nextCacheDir, { recursive: true, force: true });
  }
  // Restore stashed APKs to public/downloads for direct web serving
  restorePublicApks(stashedApks);
}

if (fs.existsSync(path.join(rootDir, "android")) || fs.existsSync(path.join(rootDir, "ios"))) {
  console.log("Syncing static ./out bundle to Capacitor native platforms...");
  execSync("npx cap sync", { stdio: "inherit" });
  cleanApkFiles(androidAssetsPublicDir);
}


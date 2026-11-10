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

try {
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
}

if (fs.existsSync(path.join(rootDir, "android")) || fs.existsSync(path.join(rootDir, "ios"))) {
  console.log("Syncing static ./out bundle to Capacitor native platforms...");
  execSync("npx cap sync", { stdio: "inherit" });
}

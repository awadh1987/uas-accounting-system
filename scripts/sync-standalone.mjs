import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const nextDir = path.join(rootDir, ".next");
const standaloneDir = path.join(nextDir, "standalone");

if (!fs.existsSync(standaloneDir)) {
  console.error("[sync-standalone] Missing .next/standalone directory. Run `next build` first.");
  process.exit(1);
}

function copyDirClean(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

copyDirClean(path.join(nextDir, "static"), path.join(standaloneDir, ".next", "static"));
copyDirClean(path.join(rootDir, "public"), path.join(standaloneDir, "public"));
copyDirClean(path.join(rootDir, "data"), path.join(standaloneDir, "data"));

for (const fileName of [".env.production", "tenants_registry.json"]) {
  const srcFile = path.join(rootDir, fileName);
  if (fs.existsSync(srcFile)) {
    fs.copyFileSync(srcFile, path.join(standaloneDir, fileName));
  }
}

const sqliteSrc = path.join(rootDir, "prisma", "dev.db");
if (fs.existsSync(sqliteSrc)) {
  fs.mkdirSync(path.join(standaloneDir, "prisma"), { recursive: true });
  fs.copyFileSync(sqliteSrc, path.join(standaloneDir, "prisma", "dev.db"));
}

// Verify all binaries and manifest in public/downloads/ were preserved cleanly in standalone
const pubDownloads = path.join(rootDir, "public", "downloads");
const outDownloads = path.join(standaloneDir, "public", "downloads");
if (fs.existsSync(pubDownloads)) {
  fs.mkdirSync(outDownloads, { recursive: true });
  const entries = fs.readdirSync(pubDownloads, { withFileTypes: true }).filter((e) => e.isFile());
  for (const entry of entries) {
    const src = path.join(pubDownloads, entry.name);
    const dst = path.join(outDownloads, entry.name);
    const srcStat = fs.statSync(src);
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== srcStat.size) {
      fs.copyFileSync(src, dst);
    }
    fs.chmodSync(dst, 0o644);
    console.log(`[sync-standalone] Verified download asset: ${entry.name} (${srcStat.size} bytes)`);
  }
}

console.log("[sync-standalone] Standalone sync completed successfully.");

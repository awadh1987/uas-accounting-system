import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { formatDownloadBytes } from "../src/lib/downloadsTypes";
import { getPublicDownloadsInventory } from "../src/lib/downloadsServer";

test("formatDownloadBytes formats installer sizes cleanly", () => {
  assert.equal(formatDownloadBytes(0), "0 B");
  assert.equal(formatDownloadBytes(512), "512 B");
  assert.equal(formatDownloadBytes(4848454), "4.62 MB");
  assert.equal(formatDownloadBytes(57509784), "54.8 MB");
});

test("getPublicDownloadsInventory inspects present and missing artifacts safely", () => {
  const realDir = path.resolve(__dirname, "..", "public", "downloads");
  const live = getPublicDownloadsInventory(realDir);
  assert.equal(live.ok, true);
  assert.equal(live.packages.length, 2);

  const apk = live.packages.find((p) => p.platform === "android");
  const exe = live.packages.find((p) => p.platform === "windows");
  assert.ok(apk && apk.exists);
  assert.equal(apk.downloadUrl, "/downloads/UAS-Mobile-Release-qat.world.apk");
  assert.equal(apk.mimeType, "application/vnd.android.package-archive");
  assert.ok(apk.sizeBytes > 1000000);

  assert.ok(exe && exe.exists);
  assert.equal(exe.downloadUrl, "/downloads/UAS-Setup-Win64.exe");
  assert.equal(exe.mimeType, "application/vnd.microsoft.portable-executable");
  assert.ok(exe.sizeBytes > 10000000);

  // Missing directory gracefully returns pending availability without crashing
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-empty-dl-"));
  try {
    const empty = getPublicDownloadsInventory(emptyDir);
    assert.equal(empty.ok, true);
    assert.equal(empty.packages[0].exists, false);
    assert.equal(empty.packages[1].exists, false);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("LandingPage and LoginView expose public /downloads links without admin leakage", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const landing = fs.readFileSync(path.join(repoRoot, "src/components/LandingPage.tsx"), "utf8");
  // Landing keeps only the two top download buttons (no duplicate downloads section).
  assert.ok(!landing.includes('data-testid="public-downloads-section"'));
  assert.ok(landing.includes("/downloads/UAS-Mobile-Release-qat.world.apk"));
  assert.ok(landing.includes("/downloads/UAS-Setup-Win64.exe"));
  assert.ok(!landing.includes("superadmin") && !landing.includes("control-panel"));

  const login = fs.readFileSync(path.join(repoRoot, "src/components/LoginView.tsx"), "utf8");
  assert.ok(login.includes("/downloads/UAS-Mobile-Release-qat.world.apk"));
  assert.ok(login.includes("/downloads/UAS-Setup-Win64.exe"));
});

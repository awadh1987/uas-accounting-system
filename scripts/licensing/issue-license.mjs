import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * UAS License Issuer (Ed25519) — company-locked multi-seat licenses (v2).
 *
 * Usage:
 *   node scripts/licensing/issue-license.mjs --company "Al-Jabri Trading" --users 7 \
 *     --win-per-user 1 --android-per-user 1 --hwid "*" --modes "local,lan,cloud" --days 365
 *
 * Flags:
 *   --company <name>          Company name locked into the signed payload (required; alias: --customer)
 *   --users <n>               Max distinct users (default 7)
 *   --win-per-user <n>        Windows devices per user (default 1)
 *   --android-per-user <n>    Android devices per user (default 1)
 *   --hwid <"*"|HWID[,HWID]>  "*" = company-wide seat-managed; comma list; single HWID.
 *                             Omitted → this machine's HWID. (alias: --request-code REQ-XXXX-...)
 *   --modes <csv>             local,lan,cloud (default all)
 *   --days <n> | --expires <ISO>
 *   --branches <n> --seats <n> --license-id <id> --out <path>
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const DEFAULT_MAX_USERS = 7;

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = true;
      }
    }
  }
  return params;
}

function fail(message) {
  console.error(`[Error] ${message}`);
  process.exit(1);
}

function parseIntStrict(name, value, { min, max, fallback }) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (typeof value === "boolean" || !Number.isInteger(n) || n < min || n > max) {
    fail(`--${name} must be an integer between ${min} and ${max} (got "${value}")`);
  }
  return n;
}

/** Mirrors parseHwidTargets() in src/lib/licensing/licenseSchema.ts */
function parseHwidTargets(hwid) {
  const parts = String(hwid ?? "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p.length > 0);
  if (parts.includes("*")) return { wildcard: true, targets: [] };
  return { wildcard: false, targets: parts };
}

const params = parseArgs();

const privateKeyPath = path.join(projectRoot, "keys", "uas-license-private.pem");
if (!fs.existsSync(privateKeyPath)) {
  console.error(`[Error] Private key not found at: ${privateKeyPath}`);
  console.error("Please run keygen first: npm run license:keygen");
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(privateKeyPath, "utf8");
const privateKey = crypto.createPrivateKey(privateKeyPem);

// ---------------------------------------------------------------------------
// Company name (locked into the signed payload)
// ---------------------------------------------------------------------------
const rawCompany = params.company ?? params.customer;
if (rawCompany === undefined || rawCompany === true || String(rawCompany).trim().length === 0) {
  fail('--company "<Company Name>" is required (the license is locked to this company name).');
}
const companyName = String(rawCompany).trim().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
// Seat policy
// ---------------------------------------------------------------------------
const maxUsers = parseIntStrict("users", params.users, { min: 1, max: 10000, fallback: DEFAULT_MAX_USERS });
const winPerUser = parseIntStrict("win-per-user", params["win-per-user"], { min: 0, max: 10, fallback: 1 });
const androidPerUser = parseIntStrict("android-per-user", params["android-per-user"], { min: 0, max: 10, fallback: 1 });
if (winPerUser + androidPerUser < 1) {
  fail("At least one of --win-per-user / --android-per-user must be >= 1.");
}

// ---------------------------------------------------------------------------
// HWID: "*" | comma-separated list | single | request code | auto-detect this machine
// ---------------------------------------------------------------------------
let hwidInput = typeof params.hwid === "string" ? params.hwid : "";
if (!hwidInput && typeof params["request-code"] === "string") {
  hwidInput = params["request-code"].replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
}
if (!hwidInput) {
  try {
    const isWindows = process.platform === "win32";
    const { execSync } = await import("node:child_process");
    let boardUuid = "";
    let cpuId = "";
    let machineGuid = "";

    if (isWindows) {
      try {
        const cmd = 'powershell -NoProfile -NonInteractive -Command "$b=(Get-CimInstance Win32_ComputerSystemProduct).UUID; $c=(Get-CimInstance Win32_Processor).ProcessorId; $g=(Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\').MachineGuid; Write-Output \\"$b:::$c:::$g\\""';
        const out = execSync(cmd, { encoding: "utf8", timeout: 12000 }).trim();
        const parts = out.split(":::");
        if (parts.length >= 3) {
          boardUuid = parts[0].trim();
          cpuId = parts[1].trim();
          machineGuid = parts[2].trim();
        }
      } catch {}
    }

    const fallback = `${os.hostname()}::${os.arch()}::${os.platform()}`;
    const rawParts = [
      boardUuid || "NO_BOARD_UUID",
      cpuId || "NO_CPUID",
      machineGuid || "NO_MACHINE_GUID",
      fallback,
    ].join("::");

    hwidInput = crypto.createHash("sha256").update(rawParts, "utf8").digest("hex").toUpperCase();
  } catch {
    hwidInput = "GLOBAL-UNIVERSAL-HWID-2026";
  }
}
const hwidParsed = parseHwidTargets(hwidInput);
if (!hwidParsed.wildcard && hwidParsed.targets.length === 0) {
  fail('--hwid must be "*", a HWID, or a comma-separated list of HWIDs.');
}
const hwid = hwidParsed.wildcard ? "*" : hwidParsed.targets.join(",");

// ---------------------------------------------------------------------------
// Remaining payload fields
// ---------------------------------------------------------------------------
const licenseId = String(params["license-id"] || `UAS-2026-${Math.floor(1000 + Math.random() * 9000)}`).trim().toUpperCase();

const rawModes = typeof params.modes === "string" ? params.modes.split(",").map((s) => s.trim().toLowerCase()) : ["local", "lan", "cloud"];
const allowed_modes = rawModes.filter((m) => ["local", "lan", "cloud"].includes(m));
if (allowed_modes.length === 0) allowed_modes.push("local", "lan", "cloud");

const maxBranches = parseIntStrict("branches", params.branches, { min: 1, max: 1000, fallback: 3 });
const maxLanSeats = parseIntStrict("seats", params.seats, { min: 1, max: 10000, fallback: 10 });
const days = parseIntStrict("days", params.days, { min: 1, max: 36500, fallback: 365 });

const issuedAt = new Date().toISOString();
const expiresAt = typeof params.expires === "string" ? params.expires : new Date(Date.now() + days * 86400000).toISOString();
if (Number.isNaN(new Date(expiresAt).getTime())) fail(`--expires is not a valid date: "${params.expires}"`);

const payload = {
  license_id: licenseId,
  customer_name: companyName,
  company_name: companyName,
  hwid,
  allowed_modes: [...new Set(allowed_modes)].sort(),
  max_branches: maxBranches,
  max_lan_seats: maxLanSeats,
  max_users: maxUsers,
  per_user_devices: { windows: winPerUser, android: androidPerUser },
  expires_at: expiresAt,
  issued_at: issuedAt,
};

// Canonicalize deterministically — MUST mirror canonicalizeLicensePayload() (v2) in
// src/lib/licensing/licenseSchema.ts (alphabetical keys, nested per_user_devices sorted).
const sortedPayload = {
  allowed_modes: [...payload.allowed_modes].sort(),
  company_name: payload.company_name.trim(),
  customer_name: payload.customer_name.trim(),
  expires_at: payload.expires_at.trim(),
  hwid: payload.hwid,
  issued_at: payload.issued_at.trim(),
  license_id: payload.license_id.trim().toUpperCase(),
  max_branches: Number(payload.max_branches),
  max_lan_seats: Number(payload.max_lan_seats),
  max_users: Number(payload.max_users),
  per_user_devices: {
    android: Number(payload.per_user_devices.android),
    windows: Number(payload.per_user_devices.windows),
  },
};
const canonical = JSON.stringify(sortedPayload);

// Sign with Ed25519
const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");

const signedLicense = {
  ...payload,
  signature,
};

// Output file destination
const outRelPath = typeof params.out === "string" ? params.out : "license.uas";
const outPath = path.isAbsolute(outRelPath) ? outRelPath : path.resolve(projectRoot, outRelPath);
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outPath, JSON.stringify(signedLicense, null, 2), "utf8");

// Compact Base64 activation key (full token, also saved next to the license file)
const activationToken = `UASKEY-${Buffer.from(JSON.stringify(signedLicense)).toString("base64")}`;
const keyPath = outPath.replace(/\.[^./\\]+$/, "") + ".uaskey.txt";
fs.writeFileSync(keyPath, activationToken + "\n", "utf8");

const hwidLabel = hwidParsed.wildcard
  ? '* (company-wide, seat-managed)'
  : hwidParsed.targets.length > 1
    ? `${hwidParsed.targets.length} HWIDs (comma-separated)`
    : hwid;

console.log("\n=======================================================");
console.log("       UAS CRYPTOGRAPHIC LICENSE ISSUED SUCCESSFULLY    ");
console.log("=======================================================");
console.log(`License ID      : ${licenseId}`);
console.log(`Company Name    : ${companyName}`);
console.log(`Max Users       : ${maxUsers}`);
console.log(`Devices/User    : ${winPerUser} Windows + ${androidPerUser} Android`);
console.log(`Target HWID     : ${hwidLabel}`);
console.log(`Allowed Modes   : ${payload.allowed_modes.join(", ")}`);
console.log(`Max Branches    : ${maxBranches}`);
console.log(`Max LAN Seats   : ${maxLanSeats}`);
console.log(`Valid Until     : ${expiresAt} (${days} days)`);
console.log(`License File    : ${outPath}`);
console.log(`Key File        : ${keyPath}`);
console.log("-------------------------------------------------------");
console.log("Online Activation Key (Serial Token):");
console.log(activationToken);
console.log("=======================================================\n");

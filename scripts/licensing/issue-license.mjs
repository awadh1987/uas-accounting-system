import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * UAS License Issuer (Ed25519) — company-locked multi-seat licenses (v2).
 *
 * Usage:
 *   node scripts/licensing/issue-license.mjs --company "Al-Jabri Trading" --slug "al-jabri" --users 7 \
 *     --win-per-user 1 --android-per-user 1 --hwid "*" --modes "local,lan,cloud" --days 365
 *
 * Flags:
 *   --company <name>          Company name locked into the signed payload (required; alias: --customer)
 *   --slug <slug>             Optional subdomain slug (3–32 chars [a-z0-9-], reserved-word guarded)
 *   --name-ar <name>          Optional localized Arabic company name
 *   --name-en <name>          Optional localized English company name
 *   --preview                 Preview derived slug & https://<slug>.qat.world without writing files
 *   --provision               Register tenant in tenants_registry.json immediately on key creation
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

const TENANT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "root", "auth", "login", "logout", "register", "signup",
  "mail", "smtp", "imap", "pop", "ftp", "cdn", "static", "assets", "downloads", "docs",
  "help", "support", "status", "billing", "portal", "dashboard", "system", "platform",
  "superadmin", "qat", "uas", "default", "public", "localhost", "staging", "dev", "test",
  "demo", "ns1", "ns2", "mx", "webmail", "cpanel", "whm", "db", "sql", "sync", "ws", "wss", "vpn",
]);
const ARABIC_CHAR_MAP = {
  أ: "a", إ: "i", آ: "a", ا: "a", ى: "a", ب: "b", ت: "t", ث: "th", ج: "j", ح: "h", خ: "kh",
  د: "d", ذ: "dh", ر: "r", ز: "z", س: "s", ش: "sh", ص: "s", ض: "d", ط: "t", ظ: "z",
  ع: "a", غ: "gh", ف: "f", ق: "q", ك: "k", ل: "l", م: "m", ن: "n", ه: "h", ة: "h",
  و: "w", ؤ: "w", ي: "y", ئ: "y", ء: "",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

function transliterateArabic(input) {
  const stripped = String(input || "")
    .replace(/[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/لا/g, "la")
    .trim();
  let out = "";
  for (const ch of stripped) {
    out += ARABIC_CHAR_MAP[ch] !== undefined ? ARABIC_CHAR_MAP[ch] : ch;
  }
  return out.toLowerCase();
}

function loadExistingSlugsFromRegistry() {
  const slugs = new Set();
  const regPath = path.join(projectRoot, "tenants_registry.json");
  try {
    if (fs.existsSync(regPath)) {
      const list = JSON.parse(fs.readFileSync(regPath, "utf8"));
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.slug) slugs.add(String(item.slug).trim().toLowerCase());
        }
      }
    }
  } catch {}
  return { slugs, regPath };
}

function deriveValidatedSlug(companyName, preferredSlug, existingSlugs) {
  let base = "";
  if (preferredSlug && typeof preferredSlug === "string") {
    const clean = preferredSlug.trim().toLowerCase();
    if (!TENANT_SLUG_REGEX.test(clean) || clean.includes("--") || RESERVED_SLUGS.has(clean)) {
      fail(`Invalid or reserved --slug "${preferredSlug}". Must be 3-32 lowercase [a-z0-9-] chars and not reserved.`);
    }
    base = clean;
  } else {
    let ascii = transliterateArabic(companyName)
      .replace(/[\s_./\\]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!ascii) {
      ascii = `org-${crypto.createHash("sha256").update(companyName).digest("hex").slice(0, 6)}`;
    } else if (ascii.length < 3) {
      ascii = `${ascii}-co`.replace(/-+/g, "-");
    }
    if (ascii.length > 32) ascii = ascii.slice(0, 32).replace(/-+$/g, "");
    if (RESERVED_SLUGS.has(ascii)) {
      ascii = `${ascii.slice(0, 28).replace(/-+$/g, "")}-org`;
    }
    base = ascii;
  }

  let candidate = base;
  let counter = 2;
  while (existingSlugs.has(candidate) || RESERVED_SLUGS.has(candidate) || !TENANT_SLUG_REGEX.test(candidate)) {
    const suffix = `-${counter}`;
    const prefix = base.slice(0, Math.max(1, 32 - suffix.length)).replace(/-+$/g, "");
    candidate = `${prefix || "org"}${suffix}`;
    counter++;
  }
  return candidate;
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

const nameAr = typeof params["name-ar"] === "string" ? params["name-ar"].trim() : companyName;
const nameEn = typeof params["name-en"] === "string" ? params["name-en"].trim() : companyName;
const { slugs: existingSlugs, regPath } = loadExistingSlugsFromRegistry();
const tenantSlug = deriveValidatedSlug(nameEn || companyName, params.slug, existingSlugs);
const tenantUrl = `https://${tenantSlug}.qat.world`;

if (params.preview) {
  console.log(JSON.stringify({ companyName, nameAr, nameEn, slug: tenantSlug, tenantUrl }, null, 2));
  process.exit(0);
}

const payload = {
  license_id: licenseId,
  customer_name: companyName,
  company_name: companyName,
  name_ar: nameAr,
  name_en: nameEn,
  tenant_slug: tenantSlug,
  tenant_url: tenantUrl,
  hwid,
  allowed_modes: [...new Set(allowed_modes)].sort(),
  max_branches: maxBranches,
  max_lan_seats: maxLanSeats,
  max_users: maxUsers,
  per_user_devices: { windows: winPerUser, android: androidPerUser },
  expires_at: expiresAt,
  issued_at: issuedAt,
};

// Canonicalize deterministically — MUST mirror canonicalizeLicensePayload() (v2/v3) in
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
  name_ar: payload.name_ar,
  name_en: payload.name_en,
  per_user_devices: {
    android: Number(payload.per_user_devices.android),
    windows: Number(payload.per_user_devices.windows),
  },
  tenant_slug: payload.tenant_slug,
  tenant_url: payload.tenant_url,
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

if (params.provision) {
  try {
    const existingList = fs.existsSync(regPath) ? JSON.parse(fs.readFileSync(regPath, "utf8")) : [];
    const list = Array.isArray(existingList) ? existingList : [];
    const tenantId = tenantSlug.replace(/-/g, "_");
    const nowIso = new Date().toISOString();
    const idx = list.findIndex((t) => t?.slug === tenantSlug || t?.tenantId === tenantId);
    const meta = {
      tenantId,
      slug: tenantSlug,
      companyName,
      nameAr,
      nameEn,
      tenantUrl,
      licenseId,
      schemaOrDb: tenantId,
      status: "ACTIVE",
      createdAt: idx >= 0 ? list[idx].createdAt : nowIso,
      updatedAt: nowIso,
      maxSeats: maxUsers,
    };
    if (idx >= 0) list[idx] = meta;
    else list.push(meta);
    fs.writeFileSync(regPath, JSON.stringify(list, null, 2), "utf8");
  } catch (regErr) {
    console.warn(`[Warning] Could not update tenants_registry.json: ${regErr.message}`);
  }
}

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
console.log(`Tenant Slug     : ${tenantSlug}`);
console.log(`Workspace URL   : ${tenantUrl}`);
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

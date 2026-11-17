import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = true;
      }
    }
  }
  return params;
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

import os from "node:os";

// Determine HWID
let hwid = params.hwid || "";
if (!hwid && params["request-code"]) {
  hwid = params["request-code"].replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
}
if (!hwid) {
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

    hwid = crypto.createHash("sha256").update(rawParts, "utf8").digest("hex").toUpperCase();
  } catch {
    hwid = "GLOBAL-UNIVERSAL-HWID-2026";
  }
}

const customerName = params.customer || "Enterprise Client";
const licenseId = params["license-id"] || `UAS-2026-${Math.floor(1000 + Math.random() * 9000)}`;

const rawModes = params.modes ? params.modes.split(",").map((s) => s.trim().toLowerCase()) : ["local", "lan", "cloud"];
const allowed_modes = rawModes.filter((m) => ["local", "lan", "cloud"].includes(m));
if (allowed_modes.length === 0) allowed_modes.push("local", "lan", "cloud");

const maxBranches = parseInt(params.branches || "3", 10);
const maxLanSeats = parseInt(params.seats || "10", 10);
const days = parseInt(params.days || "365", 10);

const issuedAt = new Date().toISOString();
const expiresAt = params.expires || new Date(Date.now() + days * 86400000).toISOString();

const payload = {
  license_id: licenseId,
  customer_name: customerName,
  hwid: hwid.toUpperCase(),
  allowed_modes: allowed_modes.sort(),
  max_branches: maxBranches,
  max_lan_seats: maxLanSeats,
  expires_at: expiresAt,
  issued_at: issuedAt,
};

// Canonicalize deterministically
const sortedPayload = {
  allowed_modes: [...payload.allowed_modes].sort(),
  customer_name: payload.customer_name.trim(),
  expires_at: payload.expires_at.trim(),
  hwid: payload.hwid.trim().toUpperCase(),
  issued_at: payload.issued_at.trim(),
  license_id: payload.license_id.trim().toUpperCase(),
  max_branches: Number(payload.max_branches),
  max_lan_seats: Number(payload.max_lan_seats),
};
const canonical = JSON.stringify(sortedPayload);

// Sign with Ed25519
const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");

const signedLicense = {
  ...payload,
  signature,
};

// Output file destination
const outRelPath = params.out || "license.uas";
const outPath = path.isAbsolute(outRelPath) ? outRelPath : path.resolve(projectRoot, outRelPath);
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outPath, JSON.stringify(signedLicense, null, 2), "utf8");

// Also generate compact Base64 activation key
const activationToken = `UASKEY-${Buffer.from(JSON.stringify(signedLicense)).toString("base64")}`;

console.log("\n=======================================================");
console.log("       UAS CRYPTOGRAPHIC LICENSE ISSUED SUCCESSFULLY    ");
console.log("=======================================================");
console.log(`License ID      : ${licenseId}`);
console.log(`Customer        : ${customerName}`);
console.log(`Target HWID     : ${payload.hwid}`);
console.log(`Allowed Modes   : ${allowed_modes.join(", ")}`);
console.log(`Max Branches    : ${maxBranches}`);
console.log(`Max LAN Seats   : ${maxLanSeats}`);
console.log(`Valid Until     : ${expiresAt} (${days} days)`);
console.log(`File Saved To   : ${outPath}`);
console.log("-------------------------------------------------------");
console.log("Online Activation Key (Serial Token):");
console.log(activationToken.slice(0, 80) + "...");
console.log("=======================================================\n");

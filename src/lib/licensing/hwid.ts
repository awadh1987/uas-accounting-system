import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { parseHwidTargets } from "./licenseSchema";

let cachedHwid: string | null = null;
let cachedRequestCode: string | null = null;

function getWindowsHardwareDetails(): { boardUuid: string; cpuId: string; machineGuid: string } {
  try {
    const cmd = 'powershell -NoProfile -NonInteractive -Command "$b=(Get-CimInstance Win32_ComputerSystemProduct).UUID; $c=(Get-CimInstance Win32_Processor).ProcessorId; $g=(Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\').MachineGuid; Write-Output \\"$b:::$c:::$g\\""';
    const output = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 12000,
    }).trim();

    const parts = output.split(":::");
    if (parts.length >= 3) {
      return {
        boardUuid: parts[0].trim(),
        cpuId: parts[1].trim(),
        machineGuid: parts[2].trim(),
      };
    }
  } catch {
    // Fallback to individual checks or reg query
  }

  // Fallback if CIM instance is blocked
  let boardUuid = "";
  let cpuId = "";
  let machineGuid = "";

  try {
    const wmicBoard = execSync("wmic csproduct get uuid", { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
    boardUuid = wmicBoard.replace(/UUID/i, "").trim();
  } catch {}

  try {
    const wmicCpu = execSync("wmic cpu get processorid", { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
    cpuId = wmicCpu.replace(/ProcessorId/i, "").trim();
  } catch {}

  try {
    const regOut = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
    const match = regOut.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if (match && match[1]) machineGuid = match[1].trim();
  } catch {}

  return { boardUuid, cpuId, machineGuid };
}

function getLinuxMachineId(): string {
  const paths = [
    "/etc/machine-id",
    "/var/lib/dbus/machine-id",
    "/sys/class/dmi/id/product_uuid",
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        const id = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8").trim();
        if (id && id.length > 5) return id;
      }
    } catch {}
  }
  return "";
}

export function computeHwid(): { hwid: string; requestCode: string } {
  if (cachedHwid && cachedRequestCode) {
    return { hwid: cachedHwid, requestCode: cachedRequestCode };
  }

  const isWindows = process.platform === "win32";
  let boardUuid = "";
  let cpuId = "";
  let machineGuid = "";

  if (isWindows) {
    const winDetails = getWindowsHardwareDetails();
    boardUuid = winDetails.boardUuid;
    cpuId = winDetails.cpuId;
    machineGuid = winDetails.machineGuid;
  } else {
    machineGuid = getLinuxMachineId();
    try {
      boardUuid = execSync("cat /sys/class/dmi/id/product_uuid", { encoding: "utf8" }).trim();
    } catch {}
    try {
      cpuId = execSync("lscpu | grep 'Model name' | head -1", { encoding: "utf8" }).trim();
    } catch {}
  }

  // Consistent machine identity
  const fallback = `${os.hostname()}::${os.arch()}::${os.platform()}`;
  const rawParts = [
    boardUuid || "NO_BOARD_UUID",
    cpuId || "NO_CPUID",
    machineGuid || "NO_MACHINE_GUID",
    fallback,
  ].join("::");

  const hash = crypto.createHash("sha256").update(rawParts, "utf8").digest("hex").toUpperCase();
  cachedHwid = hash;

  // Format human-readable Machine Request Code: REQ-XXXX-XXXX-XXXX-XXXX
  const rawSlice = hash.slice(0, 16);
  cachedRequestCode = `REQ-${rawSlice.slice(0, 4)}-${rawSlice.slice(4, 8)}-${rawSlice.slice(8, 12)}-${rawSlice.slice(12, 16)}`;

  return { hwid: cachedHwid, requestCode: cachedRequestCode };
}

export function getMachineHwid(): string {
  return computeHwid().hwid;
}

export function getMachineRequestCode(): string {
  return computeHwid().requestCode;
}

export function formatRequestCodeFromHwid(hwid: string): string {
  const clean = hwid.replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
  const rawSlice = clean.slice(0, 16).padEnd(16, "0");
  return `REQ-${rawSlice.slice(0, 4)}-${rawSlice.slice(4, 8)}-${rawSlice.slice(8, 12)}-${rawSlice.slice(12, 16)}`;
}

/**
 * Matches a license `hwid` field against this machine.
 *  - `"*"`            → company-wide seat-managed license (always matches; seats are enforced separately)
 *  - `"A,B,C"`        → comma-separated list: matches if ANY entry matches
 *  - single HWID / REQ-XXXX-XXXX-XXXX-XXXX request code
 */
export function matchHwidOrRequestCode(inputTarget: string, machineHwid: string): boolean {
  const { wildcard, targets } = parseHwidTargets(inputTarget);
  if (wildcard) return true;
  if (targets.length === 0) return false;
  if (targets.length > 1) {
    return targets.some((t) => matchSingleHwid(t, machineHwid));
  }
  return matchSingleHwid(targets[0], machineHwid);
}

function matchSingleHwid(inputTarget: string, machineHwid: string): boolean {
  if (inputTarget.toUpperCase() === "ANY" || inputTarget.toUpperCase() === "GLOBAL") return true;

  const targetClean = inputTarget.replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();
  const machineClean = machineHwid.replace(/^REQ-?/i, "").replace(/[^A-Fa-f0-9]/g, "").toUpperCase();

  // If exact HWID matches
  if (targetClean === machineClean) return true;

  // If 16-hex char request code matches prefix of machine HWID
  if (targetClean.length >= 16 && machineClean.startsWith(targetClean.slice(0, 16))) return true;
  if (machineClean.length >= 16 && targetClean.startsWith(machineClean.slice(0, 16))) return true;

  return false;
}

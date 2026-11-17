import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalizeLicensePayload,
  validateLicenseStructure,
  type RuntimeMode,
  type UasSignedLicense,
} from "./licenseSchema";
import { UAS_LICENSE_PUBLIC_KEY } from "./publicKey";
import { getMachineHwid, matchHwidOrRequestCode } from "./hwid";

export interface LicenseVerificationResult {
  valid: boolean;
  status: "ACTIVE" | "UNLICENSED" | "EXPIRED" | "HWID_MISMATCH" | "INVALID_SIGNATURE" | "CORRUPT";
  error?: string;
  license?: UasSignedLicense;
  remainingDays?: number;
}

export function verifyLicenseSignature(
  license: UasSignedLicense,
  publicKeyPem: string = UAS_LICENSE_PUBLIC_KEY
): boolean {
  try {
    const canonical = canonicalizeLicensePayload(license);
    const signatureBuffer = Buffer.from(license.signature, "base64");
    const dataBuffer = Buffer.from(canonical, "utf8");

    const publicKeyObj = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, dataBuffer, publicKeyObj, signatureBuffer);
  } catch {
    return false;
  }
}

export function verifyLicense(
  licenseInput: unknown,
  expectedMode?: RuntimeMode
): LicenseVerificationResult {
  const license = validateLicenseStructure(licenseInput);
  if (!license) {
    return {
      valid: false,
      status: "CORRUPT",
      error: "ملف الترخيص غير صالح من الناحية الهيكلية / Malformed license structure",
    };
  }

  // 1. Cryptographic Signature Check
  const signatureOk = verifyLicenseSignature(license);
  if (!signatureOk) {
    return {
      valid: false,
      status: "INVALID_SIGNATURE",
      error: "التوقيع الرقمي للترخيص غير صحيح أو تم التلاعب به / Invalid cryptographic signature",
      license,
    };
  }

  // 2. Hardware Binding Check
  const currentHwid = getMachineHwid();
  const hwidMatched = matchHwidOrRequestCode(license.hwid, currentHwid);
  if (!hwidMatched) {
    return {
      valid: false,
      status: "HWID_MISMATCH",
      error: "الترخيص مرتبط بجهاز كمبيوتر آخر / Hardware fingerprint mismatch",
      license,
    };
  }

  // 3. Expiration Check
  const now = new Date();
  const expires = new Date(license.expires_at);
  if (isNaN(expires.getTime()) || now.getTime() > expires.getTime()) {
    return {
      valid: false,
      status: "EXPIRED",
      error: "انتهت صلاحية هذا الترخيص، يرجى التجديد / License has expired",
      license,
      remainingDays: 0,
    };
  }

  // 4. Runtime Mode Check
  if (expectedMode && !license.allowed_modes.includes(expectedMode)) {
    return {
      valid: false,
      status: "ACTIVE", // License is signed, but mode is not permitted
      error: `وضع التشغيل الحالي (${expectedMode}) غير مدرج ضمن الأوضاع المصرح بها في الترخيص / Mode not allowed by license`,
      license,
    };
  }

  const remainingMs = expires.getTime() - now.getTime();
  const remainingDays = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60 * 24)));

  return {
    valid: true,
    status: "ACTIVE",
    license,
    remainingDays,
  };
}

export function getLicenseCandidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.UAS_LICENSE_PATH) {
    paths.push(process.env.UAS_LICENSE_PATH);
  }
  // Windows typical persistent data directory
  if (process.platform === "win32") {
    paths.push("C:\\UAS-Data\\license.uas");
    paths.push("C:\\UAS\\license.uas");
  }
  // Project root and current working directory
  paths.push(path.resolve(process.cwd(), "license.uas"));
  paths.push(path.resolve(process.cwd(), "data", "license.uas"));
  return paths;
}

export function loadInstalledLicense(): { license: UasSignedLicense | null; sourcePath?: string } {
  const candidates = getLicenseCandidatePaths();
  for (const p of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        const raw = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
        const parsed = JSON.parse(raw);
        const valid = validateLicenseStructure(parsed);
        if (valid) {
          return { license: valid, sourcePath: p };
        }
      }
    } catch {
      // Continue to next candidate
    }
  }
  return { license: null };
}

export function saveInstalledLicense(license: UasSignedLicense): string {
  let targetPath = path.resolve(process.cwd(), "license.uas");
  if (process.platform === "win32" && fs.existsSync("C:\\UAS-Data")) {
    targetPath = "C:\\UAS-Data\\license.uas";
  } else if (process.platform === "win32" && fs.existsSync("C:\\UAS")) {
    targetPath = "C:\\UAS\\license.uas";
  }

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, JSON.stringify(license, null, 2), "utf8");
  return targetPath;
}

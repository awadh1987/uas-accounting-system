import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getActiveTenantId, normalizeTenantId } from "@/lib/tenant/tenantContext";
import { getTenantMetadata } from "@/lib/tenant/tenantRegistry";
import {
  canonicalizeLicensePayload,
  extractUasKeyToken,
  getLicenseSeatPolicy,
  validateLicenseStructure,
  type LicenseSeatPolicy,
  type RuntimeMode,
  type UasSignedLicense,
} from "./licenseSchema";

export { extractUasKeyToken };

/**
 * Decodes either a raw `.uas` JSON string or a single/multi-line `UASKEY-...` token
 * (including `.uaskey.txt` files containing trailing summary metadata).
 */
export function decodeLicenseInput(rawInput: string): UasSignedLicense | null {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      return validateLicenseStructure(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  const token = extractUasKeyToken(trimmed);
  if (!token) return null;
  const b64 = token.slice(7).trim();
  for (const encoding of ["base64", "base64url"] as const) {
    try {
      const decoded = Buffer.from(b64, encoding).toString("utf8");
      const parsed = validateLicenseStructure(JSON.parse(decoded));
      if (parsed) return parsed;
    } catch {
      // Try next encoding
    }
  }
  return null;
}
import { UAS_LICENSE_PUBLIC_KEY } from "./publicKey";
import { getMachineHwid, matchHwidOrRequestCode } from "./hwid";

export interface LicenseVerificationResult {
  valid: boolean;
  status: "ACTIVE" | "UNLICENSED" | "EXPIRED" | "HWID_MISMATCH" | "INVALID_SIGNATURE" | "CORRUPT";
  error?: string;
  license?: UasSignedLicense;
  remainingDays?: number;
  /** Effective company-lock / seat policy of the verified license (populated for signed licenses). */
  seatPolicy?: LicenseSeatPolicy;
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
    seatPolicy: getLicenseSeatPolicy(license),
  };
}

/**
 * Resolves the writable project root directory.
 * When Next.js standalone runs with `process.cwd()` inside `.next/standalone`,
 * walks two levels up to the real project root so files are never written inside `.next/standalone`.
 */
export function resolveWritableProjectRoot(cwdOverride?: string): string {
  const cwd = path.resolve(cwdOverride || process.cwd());
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/.next/standalone")) {
    return path.resolve(cwd, "..", "..");
  }
  return cwd;
}

/**
 * Resolves the persistent, writable data root directory for tenant license storage.
 * Priority: `UAS_DATA_DIR` > `DATA_DIR` > `C:\UAS-Data` / `C:\UAS` (Windows if present) > `<projectRoot>/data`.
 */
export function resolveLicenseDataDirectory(cwdOverride?: string): string {
  const envDataDir = (process.env.UAS_DATA_DIR || process.env.DATA_DIR || "").trim();
  if (envDataDir) {
    return path.resolve(/*turbopackIgnore: true*/ envDataDir);
  }

  if (process.platform === "win32") {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ "C:\\UAS-Data")) {
        return "C:\\UAS-Data";
      }
      if (fs.existsSync(/*turbopackIgnore: true*/ "C:\\UAS")) {
        return "C:\\UAS";
      }
    } catch {
      // Ignore filesystem check errors
    }
  }

  const projectRoot = resolveWritableProjectRoot(cwdOverride);
  return path.join(/*turbopackIgnore: true*/ projectRoot, "data");
}

function resolveTenantLicenseKeys(rawTenantId?: string | null): string[] {
  const effectiveTenantId = normalizeTenantId(rawTenantId ?? getActiveTenantId());
  if (effectiveTenantId === "default") {
    return ["default"];
  }

  const meta = getTenantMetadata(effectiveTenantId);
  const keys: string[] = [];
  if (meta?.slug && meta.slug !== "default") {
    keys.push(meta.slug.trim().toLowerCase());
  }
  if (!keys.includes(effectiveTenantId)) {
    keys.push(effectiveTenantId);
  }
  const hyphenSlug = effectiveTenantId.replace(/_/g, "-");
  if (hyphenSlug && !keys.includes(hyphenSlug)) {
    keys.push(hyphenSlug);
  }
  return keys;
}

/**
 * Resolves the canonical tenant-scoped license file path:
 * `<dataRoot>/licenses/<tenantSlug>/license.uas`
 */
export function resolveTenantLicensePath(
  explicitTenantId?: string | null,
  cwdOverride?: string
): string {
  const dataDir = resolveLicenseDataDirectory(cwdOverride);
  const [primaryKey] = resolveTenantLicenseKeys(explicitTenantId);
  return path.join(/*turbopackIgnore: true*/ dataDir, "licenses", primaryKey, "license.uas");
}

/**
 * Resolves candidate license file paths strictly scoped to the target/active tenant.
 * Non-default tenants ONLY inspect `licenses/<tenantSlug>/license.uas` (never falling back to `default`).
 * The `default` tenant checks `UAS_LICENSE_PATH`, `licenses/default/license.uas`, Windows legacy paths,
 * and `<projectRoot>/license.uas` / `<projectRoot>/data/license.uas`.
 */
export function getLicenseCandidatePaths(explicitTenantId?: string | null): string[] {
  const effectiveTenantId = normalizeTenantId(explicitTenantId ?? getActiveTenantId());
  const dataDir = resolveLicenseDataDirectory();
  const projectRoot = resolveWritableProjectRoot();

  if (effectiveTenantId !== "default") {
    const keys = resolveTenantLicenseKeys(effectiveTenantId);
    const seen = new Set<string>();
    const tenantPaths: string[] = [];
    for (const key of keys) {
      for (const fileName of ["license.uas", `${key}.uas`]) {
        const p = path.join(/*turbopackIgnore: true*/ dataDir, "licenses", key, fileName);
        if (!seen.has(p)) {
          seen.add(p);
          tenantPaths.push(p);
        }
      }
    }
    return tenantPaths;
  }

  const paths: string[] = [];
  if (process.env.UAS_LICENSE_PATH?.trim()) {
    paths.push(path.resolve(/*turbopackIgnore: true*/ process.env.UAS_LICENSE_PATH.trim()));
  }
  paths.push(path.join(/*turbopackIgnore: true*/ dataDir, "licenses", "default", "license.uas"));
  if (process.platform === "win32") {
    paths.push("C:\\UAS-Data\\license.uas");
    paths.push("C:\\UAS\\license.uas");
  }
  paths.push(path.resolve(/*turbopackIgnore: true*/ projectRoot, "license.uas"));
  paths.push(path.resolve(/*turbopackIgnore: true*/ projectRoot, "data", "license.uas"));
  return Array.from(new Set(paths));
}

export function loadInstalledLicense(
  explicitTenantId?: string | null
): { license: UasSignedLicense | null; sourcePath?: string } {
  const candidates = getLicenseCandidatePaths(explicitTenantId);
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

export function saveInstalledLicense(
  license: UasSignedLicense,
  explicitTenantId?: string | null
): string {
  const targetPath = resolveTenantLicensePath(explicitTenantId);
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }

  const serialized = JSON.stringify(license, null, 2);
  fs.writeFileSync(/*turbopackIgnore: true*/ targetPath, serialized, "utf8");

  const effectiveTenantId = normalizeTenantId(explicitTenantId ?? getActiveTenantId());
  if (effectiveTenantId !== "default") {
    const [primaryKey] = resolveTenantLicenseKeys(effectiveTenantId);
    if (primaryKey && primaryKey !== "default") {
      const slugNamedPath = path.join(/*turbopackIgnore: true*/ dir, `${primaryKey}.uas`);
      if (path.resolve(slugNamedPath) !== path.resolve(targetPath)) {
        fs.writeFileSync(/*turbopackIgnore: true*/ slugNamedPath, serialized, "utf8");
      }
    }
  }
  return targetPath;
}

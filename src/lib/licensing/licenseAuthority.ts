import {
  companyNamesMatch,
  isCompanyLockedPayload,
  isWildcardHwid,
  validateLicenseStructure,
  type UasSignedLicense,
} from "./licenseSchema";
import { matchHwidOrRequestCode } from "./hwid";
import { verifyLicenseSignature } from "./verifier";
import { UAS_LICENSE_PUBLIC_KEY } from "./publicKey";
import {
  bindSeat,
  normalizePlatform,
  releaseSeat,
  seatPolicyFromLicense,
  summarizeSeatUsage,
  type SeatStore,
} from "./seatService";
import { companyMismatchMessage } from "./companyLock";
import { seatFailure } from "./activationPolicy";
import { buildTenantWorkspaceUrl, generateTenantSlug } from "@/lib/tenant/tenantSlug";

export interface VerifyKeyRequest {
  key?: unknown;
  company_name?: unknown;
  user_email?: unknown;
  platform?: unknown;
  hwid?: unknown;
  device_name?: unknown;
}

export interface VerifyKeyResponse {
  status: number;
  body: Record<string, unknown>;
}

function fail(status: number, code: string, error: string): VerifyKeyResponse {
  return { status, body: { success: false, code, error } };
}

function parseSignedKey(
  rawKey: unknown,
  publicKeyPem?: string
): { license: UasSignedLicense } | VerifyKeyResponse {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!key) {
    return fail(400, "INVALID_KEY", "مفتاح التفعيل مطلوب. / Activation key is required.");
  }
  if (!key.startsWith("UASKEY-")) {
    return fail(404, "KEY_NOT_FOUND", "مفتاح التفعيل غير معروف. / Unknown activation key.");
  }

  let license: UasSignedLicense | null = null;
  try {
    license = validateLicenseStructure(JSON.parse(Buffer.from(key.slice(7), "base64").toString("utf8")));
  } catch {
    license = null;
  }
  if (!license) {
    return fail(400, "INVALID_KEY", "مفتاح التفعيل تالف أو غير صالح. / Malformed activation key.");
  }

  if (!verifyLicenseSignature(license, publicKeyPem ?? UAS_LICENSE_PUBLIC_KEY)) {
    return fail(403, "INVALID_SIGNATURE", "التوقيع الرقمي للترخيص غير صحيح أو تم التلاعب به / Invalid cryptographic signature");
  }
  return { license };
}

/**
 * Vendor-side seat release for the cloud authority (lost / replaced laptop or phone).
 * The route guards this with a vendor admin token; the key is verified here.
 */
export async function releaseKeySeat(
  req: { key?: unknown; user_email?: unknown; platform?: unknown },
  deps: { store: SeatStore; publicKeyPem?: string }
): Promise<VerifyKeyResponse> {
  const parsed = parseSignedKey(req.key, deps.publicKeyPem);
  if ("status" in parsed) return parsed;
  const license = parsed.license;
  if (!isCompanyLockedPayload(license)) {
    return fail(400, "NOT_SEAT_MANAGED", "هذا الترخيص لا يدير المقاعد. / This license is not seat-managed.");
  }
  const userEmail = typeof req.user_email === "string" ? req.user_email : "";
  if (!userEmail.trim()) {
    return fail(400, "INVALID_REQUEST", "user_email is required.");
  }
  const rawPlatform = String(req.platform ?? "all").trim().toLowerCase();
  const platform = rawPlatform === "all" ? "all" : normalizePlatform(rawPlatform);
  if (!platform) {
    return fail(400, "INVALID_REQUEST", "Invalid platform (windows | android | all).");
  }
  const result = await releaseSeat(deps.store, seatPolicyFromLicense(license), license.license_id, userEmail, platform);
  return { status: 200, body: { success: true, released: result.released, usage: summarizeSeatUsage(result.usage) } };
}
/**
 * Cloud license authority (qat.world `/api/licensing/verify-key`).
 *
 * The UASKEY token carries the Ed25519-signed license, so verification is stateless; only seat
 * bindings are stored (LicenseDeviceBinding) — through the very same `bindSeat` service used by the
 * local SQLite server and the Capacitor offline client.
 */
export async function verifyKeyRequest(
  req: VerifyKeyRequest,
  deps: { store: SeatStore; publicKeyPem?: string; now?: Date }
): Promise<VerifyKeyResponse> {
  const now = deps.now ?? new Date();
  const parsed = parseSignedKey(req.key, deps.publicKeyPem);
  if ("status" in parsed) return parsed;
  const license = parsed.license;

  const expires = new Date(license.expires_at);
  if (Number.isNaN(expires.getTime()) || now.getTime() > expires.getTime()) {
    return fail(403, "EXPIRED", "انتهت صلاحية هذا الترخيص، يرجى التجديد / License has expired");
  }

  const hwid = typeof req.hwid === "string" ? req.hwid.trim() : "";
  const platform = normalizePlatform(String(req.platform ?? "windows"));
  if (!platform) {
    return fail(400, "INVALID_REQUEST", "منصة غير صالحة (windows | android). / Invalid platform (windows | android).");
  }

  // Hardware list / single-HWID binding applies to Windows machines only
  // (Android devices have no Windows HWID and are governed by their seat).
  if (!isWildcardHwid(license.hwid) && platform === "windows") {
    if (!hwid || !matchHwidOrRequestCode(license.hwid, hwid)) {
      return fail(403, "HWID_MISMATCH", "الترخيص مرتبط بجهاز كمبيوتر آخر / Hardware fingerprint mismatch");
    }
  }

  // Legacy (v1) license: signature + expiry + HWID are all that apply.
  if (!isCompanyLockedPayload(license)) {
    return { status: 200, body: { success: true, license, seat_managed: false } };
  }

  const companyName = (license.company_name as string).trim();
  const suppliedCompany = typeof req.company_name === "string" ? req.company_name.trim() : "";
  if (!suppliedCompany) {
    return fail(400, "COMPANY_NAME_REQUIRED", "اسم المنشأة مطلوب لهذا الترخيص. / Company name is required for this license.");
  }
  if (!companyNamesMatch(suppliedCompany, companyName)) {
    return fail(403, "COMPANY_MISMATCH", companyMismatchMessage(companyName));
  }

  const userEmail = typeof req.user_email === "string" ? req.user_email : "";
  if (!userEmail.trim() || !hwid) {
    return fail(
      400,
      "INVALID_REQUEST",
      "البريد الإلكتروني للمستخدم ومعرّف الجهاز مطلوبان. / user_email and hwid are required."
    );
  }

  const result = await bindSeat(
    deps.store,
    seatPolicyFromLicense(license),
    {
      licenseId: license.license_id,
      userEmail,
      platform,
      hwid,
      deviceName: typeof req.device_name === "string" ? req.device_name : undefined,
    },
    now
  );
  if (!result.ok) {
    const f = seatFailure(result);
    return {
      status: f.status,
      body: { success: false, code: f.code, error: f.error, usage: result.usage ? summarizeSeatUsage(result.usage) : undefined },
    };
  }

  const tenantSlug =
    license.tenant_slug ||
    generateTenantSlug(license.name_en || companyName).slug;
  const tenantUrl = license.tenant_url || buildTenantWorkspaceUrl(tenantSlug);

  return {
    status: 200,
    body: {
      success: true,
      license,
      seat_managed: true,
      seat_status: result.status,
      tenant_slug: tenantSlug,
      tenant_url: tenantUrl,
      binding: {
        user_email: result.binding.userEmail,
        platform: result.binding.platform,
        hwid: result.binding.hwid,
        activated_at: result.binding.activatedAt.toISOString(),
        last_seen_at: result.binding.lastSeenAt.toISOString(),
      },
      usage: summarizeSeatUsage(result.usage),
    },
  };
}

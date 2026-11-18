import {
  companyNamesMatch,
  isCompanyLockedPayload,
  type UasSignedLicense,
} from "./licenseSchema";
import {
  bindSeat,
  seatPolicyFromLicense,
  type SeatBindResult,
  type SeatStore,
} from "./seatService";
import {
  companyMismatchMessage,
  evaluateCompanyLock,
  type ProfileRepo,
} from "./companyLock";

export type PolicyFailure = { ok: false; status: number; code: string; error: string };

export const SEAT_ERROR_HTTP_STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  PLATFORM_NOT_ALLOWED: 403,
  MAX_USERS_REACHED: 409,
  DEVICE_LIMIT_REACHED: 409,
};

export function seatFailure(result: Extract<SeatBindResult, { ok: false }>): PolicyFailure {
  return {
    ok: false,
    status: SEAT_ERROR_HTTP_STATUS[result.code] ?? 409,
    code: result.code,
    error: result.error,
  };
}

export interface ActivationPolicyInput {
  license: UasSignedLicense;
  /** Company name typed by the operator in the activation form (optional, validated when present). */
  confirmCompanyName?: string;
  /** Activating user — when present the seat is bound immediately. */
  userEmail?: string;
  platform?: string;
  /** Device identity used for the seat (machine HWID for the local desktop app). */
  hwid: string;
  deviceName?: string;
}

export type ActivationPolicyResult =
  | {
      ok: true;
      companyLock: "ADOPTED" | "MATCHED" | "NOT_REQUIRED";
      seat?: Extract<SeatBindResult, { ok: true }>;
    }
  | PolicyFailure;

/**
 * Activation-time policy for company-locked (v2) licenses:
 *   1. optional company-name confirmation must match the signed company_name
 *   2. EnterpriseProfile must be unconfigured (→ adopted) or already match (→ otherwise rejected)
 *   3. activating user's seat is bound (≤ max_users, 1 Windows + 1 Android per user)
 * The profile is only written after the seat succeeded so a rejected activation has no side effects.
 * Legacy (v1) licenses are unaffected.
 */
export async function enforceActivationPolicy(
  input: ActivationPolicyInput,
  deps: { profileRepo: ProfileRepo; seatStore: SeatStore; now?: Date }
): Promise<ActivationPolicyResult> {
  const { license } = input;
  if (!isCompanyLockedPayload(license)) {
    return { ok: true, companyLock: "NOT_REQUIRED" };
  }
  const companyName = (license.company_name as string).trim();

  const confirm = input.confirmCompanyName?.trim();
  if (confirm && !companyNamesMatch(confirm, companyName)) {
    return { ok: false, status: 403, code: "COMPANY_MISMATCH", error: companyMismatchMessage(companyName) };
  }

  const evaluation = evaluateCompanyLock(companyName, await deps.profileRepo.get());
  if (evaluation.outcome === "MISMATCH") {
    return { ok: false, status: 403, code: "COMPANY_MISMATCH", error: evaluation.error };
  }

  let seat: Extract<SeatBindResult, { ok: true }> | undefined;
  if (input.userEmail?.trim()) {
    const result = await bindSeat(
      deps.seatStore,
      seatPolicyFromLicense(license),
      {
        licenseId: license.license_id,
        userEmail: input.userEmail,
        platform: input.platform || "windows",
        hwid: input.hwid,
        deviceName: input.deviceName,
      },
      deps.now
    );
    if (!result.ok) return seatFailure(result);
    seat = result;
  }

  if (evaluation.outcome === "ADOPT") {
    await deps.profileRepo.adopt(evaluation.patch);
  }

  return {
    ok: true,
    companyLock: evaluation.outcome === "ADOPT" ? "ADOPTED" : "MATCHED",
    seat,
  };
}

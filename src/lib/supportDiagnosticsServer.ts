import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { getMachineRequestCode } from "@/lib/licensing/hwid";
import { loadInstalledLicense } from "@/lib/licensing/verifier";
import { checkLicenseAndClock } from "@/lib/licensing/guard";
import { getLicenseSeatPolicy } from "@/lib/licensing/licenseSchema";
import { createPrismaSeatStore } from "@/lib/licensing/prismaSeatStore";
import { createPrismaProfileRepo } from "@/lib/licensing/companyLockServer";
import { evaluateCompanyLock } from "@/lib/licensing/companyLock";
import { getSeatUsage, seatPolicyFromLicense } from "@/lib/licensing/seatService";
import { getLanServerUrl, getRuntimeConfig } from "@/lib/runtimeMode";
import type { SupportSystemDiagnostics } from "@/lib/localSupportEngine";

export async function collectServerSupportDiagnostics(): Promise<SupportSystemDiagnostics> {
  await ensureSqliteDatabaseReady();
  const runtimeConfig = getRuntimeConfig();
  const lanUrl = getLanServerUrl(runtimeConfig.port);
  const requestCode = getMachineRequestCode();
  const guardResult = await checkLicenseAndClock(runtimeConfig.mode);
  const { license } = loadInstalledLicense();

  let remainingDays = 0;
  if (license?.expires_at) {
    const diff = new Date(license.expires_at).getTime() - Date.now();
    remainingDays = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }

  const seatPolicy = license ? getLicenseSeatPolicy(license) : null;
  let usedUsers = 0;
  let maxUsers = seatPolicy?.maxUsers ?? 7;
  let windowsBound = 0;
  let androidBound = 0;
  const perUserDevices = seatPolicy?.perUserDevices ?? { windows: 1, android: 1 };
  let companyMatches: boolean | null = null;
  let enterpriseNameAr: string | null = null;
  let enterpriseNameEn: string | null = null;

  try {
    const profile = await createPrismaProfileRepo().get();
    if (profile) {
      enterpriseNameAr = profile.legalNameAr;
      enterpriseNameEn = profile.legalNameEn;
    }
    if (license && seatPolicy?.companyLocked) {
      const usage = await getSeatUsage(
        createPrismaSeatStore(),
        license.license_id,
        seatPolicyFromLicense(license)
      );
      usedUsers = usage.usedUsers;
      maxUsers = usage.maxUsers;
      windowsBound = usage.windowsBound;
      androidBound = usage.androidBound;
      const evaluation = evaluateCompanyLock(seatPolicy.companyName as string, profile);
      companyMatches = evaluation.outcome !== "MISMATCH";
    }
  } catch (err) {
    console.error("[Support Diagnostics] Warning collecting DB state:", err);
  }

  return {
    license_status: guardResult.status,
    is_valid: guardResult.allowed,
    company_name: seatPolicy?.companyName ?? license?.customer_name ?? null,
    enterprise_name_ar: enterpriseNameAr,
    enterprise_name_en: enterpriseNameEn,
    company_locked: Boolean(seatPolicy?.companyLocked),
    company_matches: companyMatches,
    seat_managed: Boolean(seatPolicy?.companyLocked),
    used_users: usedUsers,
    max_users: maxUsers,
    per_user_devices: perUserDevices,
    windows_bound: windowsBound,
    android_bound: androidBound,
    active_mode: runtimeConfig.mode,
    lan_url: lanUrl,
    cloud_url: runtimeConfig.cloudUrl,
    remaining_days: remainingDays,
    request_code: requestCode,
    license_id: license?.license_id ?? null,
    error: guardResult.error ?? null,
  };
}

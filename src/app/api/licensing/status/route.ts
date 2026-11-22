import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { getActiveTenantId, getTenantMetadata } from "@/lib/tenant";
import { getMachineHwid, getMachineRequestCode } from "@/lib/licensing/hwid";
import { loadInstalledLicense } from "@/lib/licensing/verifier";
import { checkLicenseAndClock } from "@/lib/licensing/guard";
import { getRuntimeConfig, getServerLanIps, getLanServerUrl } from "@/lib/runtimeMode";
import { getLicenseSeatPolicy } from "@/lib/licensing/licenseSchema";
import { createPrismaSeatStore } from "@/lib/licensing/prismaSeatStore";
import { createPrismaProfileRepo } from "@/lib/licensing/companyLockServer";
import { evaluateCompanyLock } from "@/lib/licensing/companyLock";
import { getSeatUsage, seatPolicyFromLicense } from "@/lib/licensing/seatService";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  const hwid = getMachineHwid();
  const requestCode = getMachineRequestCode();
  const runtimeConfig = getRuntimeConfig();
  const lanIps = getServerLanIps();
  const lanUrl = getLanServerUrl(runtimeConfig.port);

  const tenantId = getActiveTenantId();
  const meta = getTenantMetadata(tenantId);
  const seatToken = req.headers.get("x-uas-seat-token") || undefined;
  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";

  const guardResult = await checkLicenseAndClock(runtimeConfig.mode, seatToken, clientIp);
  const { license } = loadInstalledLicense(tenantId);

  let remainingDays = 0;
  if (license?.expires_at) {
    const diff = new Date(license.expires_at).getTime() - Date.now();
    remainingDays = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }

  // Company lock + seat usage (company-locked v2 licenses only; counts only — no emails/devices)
  const seatPolicy = license ? getLicenseSeatPolicy(license) : null;
  let seats: { used_users: number; max_users: number; windows_bound: number; android_bound: number } | null = null;
  let companyMatches: boolean | null = null;
  if (license && seatPolicy?.companyLocked) {
    try {
      const usage = await getSeatUsage(createPrismaSeatStore(), license.license_id, seatPolicyFromLicense(license));
      seats = {
        used_users: usage.usedUsers,
        max_users: usage.maxUsers,
        windows_bound: usage.windowsBound,
        android_bound: usage.androidBound,
      };
      const evaluation = evaluateCompanyLock(seatPolicy.companyName as string, await createPrismaProfileRepo().get());
      companyMatches = evaluation.outcome !== "MISMATCH";
    } catch (e) {
      console.error("[Licensing Status] seat usage unavailable:", e);
    }
  }

  return NextResponse.json({
    request_code: requestCode,
    hwid,
    active_mode: runtimeConfig.mode,
    tenant_id: tenantId,
    tenant_slug: meta?.slug && meta.slug !== "default" ? meta.slug : tenantId === "default" ? null : tenantId,
    license_status: guardResult.status,
    code: guardResult.code || null,
    is_valid: guardResult.allowed,
    error: guardResult.error || null,
    customer_name: license?.customer_name || null,
    company_name: seatPolicy?.companyName ?? null,
    company_locked: Boolean(seatPolicy?.companyLocked),
    company_matches: companyMatches,
    seat_managed: Boolean(seatPolicy?.companyLocked),
    max_users: seatPolicy?.companyLocked ? seatPolicy.maxUsers : null,
    per_user_devices: seatPolicy?.companyLocked ? seatPolicy.perUserDevices : null,
    seats,
    license_id: license?.license_id || null,
    allowed_modes: license?.allowed_modes || ["local", "lan", "cloud"],
    max_branches: license?.max_branches || 1,
    max_lan_seats: license?.max_lan_seats || 1,
    active_seats: guardResult.activeSeatsCount || 1,
    expires_at: license?.expires_at || null,
    issued_at: license?.issued_at || null,
    remaining_days: remainingDays,
    server_lan_ips: lanIps,
    lan_url: lanUrl,
    cloud_url: runtimeConfig.cloudUrl,
  });
});

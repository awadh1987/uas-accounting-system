import { NextRequest, NextResponse } from "next/server";
import { getMachineHwid, getMachineRequestCode } from "@/lib/licensing/hwid";
import { loadInstalledLicense } from "@/lib/licensing/verifier";
import { checkLicenseAndClock } from "@/lib/licensing/guard";
import { getRuntimeConfig, getServerLanIps, getLanServerUrl } from "@/lib/runtimeMode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const hwid = getMachineHwid();
  const requestCode = getMachineRequestCode();
  const runtimeConfig = getRuntimeConfig();
  const lanIps = getServerLanIps();
  const lanUrl = getLanServerUrl(runtimeConfig.port);

  const seatToken = req.headers.get("x-uas-seat-token") || undefined;
  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";

  const guardResult = await checkLicenseAndClock(runtimeConfig.mode, seatToken, clientIp);
  const { license } = loadInstalledLicense();

  let remainingDays = 0;
  if (license?.expires_at) {
    const diff = new Date(license.expires_at).getTime() - Date.now();
    remainingDays = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }

  return NextResponse.json({
    request_code: requestCode,
    hwid,
    active_mode: runtimeConfig.mode,
    license_status: guardResult.status,
    is_valid: guardResult.allowed,
    error: guardResult.error || null,
    customer_name: license?.customer_name || null,
    license_id: license?.license_id || null,
    allowed_modes: license?.allowed_modes || ["local"],
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
}

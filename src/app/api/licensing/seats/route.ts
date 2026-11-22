import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { getRuntimeConfig } from "@/lib/runtimeMode";
import { getMachineHwid } from "@/lib/licensing/hwid";
import { loadInstalledLicense, verifyLicense } from "@/lib/licensing/verifier";
import { isCompanyLockedPayload } from "@/lib/licensing/licenseSchema";
import { createPrismaSeatStore } from "@/lib/licensing/prismaSeatStore";
import { createPrismaProfileRepo } from "@/lib/licensing/companyLockServer";
import { enforceActivationPolicy } from "@/lib/licensing/activationPolicy";
import { isLoopbackRequest, requireSuperAdmin, resolveSeatHwid } from "@/lib/licensing/seatContext";
import {
  getSeatUsage,
  normalizePlatform,
  seatPolicyFromLicense,
  summarizeSeatUsage,
} from "@/lib/licensing/seatService";

export const dynamic = "force-dynamic";

function noLicense() {
  return NextResponse.json(
    {
      success: false,
      code: "LICENSE_MISSING",
      error: "المنظومة غير مفعلة بترخيص رسمي. / System is not activated with a valid license.",
    },
    { status: 403 }
  );
}

/** Seat usage for the installed license. Per-user device details are returned to SUPER_ADMIN only. */
export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const { license } = loadInstalledLicense();
    if (!license) return noLicense();
    if (!isCompanyLockedPayload(license)) {
      return NextResponse.json({ success: true, seat_managed: false });
    }

    const policy = seatPolicyFromLicense(license);
    const usage = await getSeatUsage(createPrismaSeatStore(), license.license_id, policy);
    const admin = await requireSuperAdmin(req);

    return NextResponse.json({
      success: true,
      seat_managed: true,
      company_name: license.company_name,
      license_id: license.license_id,
      can_manage: admin.ok,
      usage: admin.ok ? usage : summarizeSeatUsage(usage),
    });
  } catch (err) {
    console.error("GET /api/licensing/seats error:", err);
    return NextResponse.json({ success: false, error: "تعذر تحميل المقاعد. / Failed to load seats." }, { status: 500 });
  }
});

/**
 * Bind (or refresh) the seat of the signed-in user on this device.
 * Body: { userEmail, platform?: "windows"|"android", deviceId?, deviceName? }
 */
export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;

    const { license } = loadInstalledLicense();
    if (!license) return noLicense();

    const runtime = getRuntimeConfig();
    const verification = verifyLicense(license, runtime.mode);
    if (!verification.valid) {
      return NextResponse.json(
        { success: false, code: `LICENSE_${verification.status}`, error: verification.error },
        { status: 403 }
      );
    }

    if (!isCompanyLockedPayload(license)) {
      return NextResponse.json({ success: true, seat_managed: false, license });
    }

    const platform = normalizePlatform(String(body.platform ?? "windows"));
    if (!platform) {
      return NextResponse.json(
        { success: false, code: "INVALID_REQUEST", error: "منصة غير صالحة / Invalid platform (windows | android)." },
        { status: 400 }
      );
    }

    const hwid = resolveSeatHwid(req, platform, body.deviceId);
    if (!hwid) {
      return NextResponse.json(
        { success: false, code: "INVALID_REQUEST", error: "معرّف الجهاز مطلوب / deviceId is required." },
        { status: 400 }
      );
    }

    const result = await enforceActivationPolicy(
      {
        license,
        userEmail: typeof body.userEmail === "string" ? body.userEmail : "",
        platform,
        hwid,
        deviceName: typeof body.deviceName === "string" ? body.deviceName : undefined,
      },
      { profileRepo: createPrismaProfileRepo(), seatStore: createPrismaSeatStore() }
    );

    if (!result.ok) {
      return NextResponse.json({ success: false, code: result.code, error: result.error }, { status: result.status });
    }
    if (!result.seat) {
      return NextResponse.json(
        { success: false, code: "INVALID_REQUEST", error: "البريد الإلكتروني مطلوب / userEmail is required." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      seat_managed: true,
      seat_status: result.seat.status,
      license,
      binding: {
        user_email: result.seat.binding.userEmail,
        platform: result.seat.binding.platform,
        hwid: result.seat.binding.hwid,
        activated_at: result.seat.binding.activatedAt.toISOString(),
        last_seen_at: result.seat.binding.lastSeenAt.toISOString(),
      },
      usage: summarizeSeatUsage(result.seat.usage),
      local_device: isLoopbackRequest(req) && platform === "windows" ? getMachineHwid() : undefined,
    });
  } catch (err) {
    console.error("POST /api/licensing/seats error:", err);
    return NextResponse.json({ success: false, error: "تعذر ربط الجهاز. / Failed to bind device." }, { status: 500 });
  }
});

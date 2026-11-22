import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { loadInstalledLicense } from "@/lib/licensing/verifier";
import { isCompanyLockedPayload } from "@/lib/licensing/licenseSchema";
import { createPrismaSeatStore } from "@/lib/licensing/prismaSeatStore";
import { requireSuperAdmin } from "@/lib/licensing/seatContext";
import {
  normalizePlatform,
  normalizeUserEmail,
  releaseSeat,
  seatPolicyFromLicense,
} from "@/lib/licensing/seatService";

export const dynamic = "force-dynamic";

/**
 * SUPER_ADMIN: release a device seat ("إلغاء ربط الجهاز / Release Device Seat") so a lost or replaced
 * laptop/phone frees its slot. Body: { userEmail, platform?: "windows"|"android"|"all" }
 */
export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;

    const admin = await requireSuperAdmin(req, body);
    if (!admin.ok) {
      return NextResponse.json(
        {
          success: false,
          code: "FORBIDDEN",
          error: "⛔ إلغاء ربط الأجهزة محصور بمدير النظام العام / Releasing device seats is restricted to SUPER_ADMIN.",
        },
        { status: 403 }
      );
    }

    const { license } = loadInstalledLicense();
    if (!license || !isCompanyLockedPayload(license)) {
      return NextResponse.json(
        { success: false, code: "NOT_SEAT_MANAGED", error: "لا يوجد ترخيص بمقاعد مُدارة. / No seat-managed license installed." },
        { status: 400 }
      );
    }

    const userEmail = normalizeUserEmail(String(body.userEmail ?? ""));
    const rawPlatform = String(body.platform ?? "all").trim().toLowerCase();
    const platform = rawPlatform === "all" ? "all" : normalizePlatform(rawPlatform);
    if (!userEmail || !platform) {
      return NextResponse.json(
        { success: false, code: "INVALID_REQUEST", error: "userEmail / platform غير صالح / Invalid userEmail or platform." },
        { status: 400 }
      );
    }

    const policy = seatPolicyFromLicense(license);
    const result = await prisma.$transaction(async (tx) => {
      const res = await releaseSeat(createPrismaSeatStore(tx), policy, license.license_id, userEmail, platform);
      await appendAuditLogTx(tx, {
        ...admin.actor,
        actionType: "إلغاء ربط جهاز الترخيص (Release Device Seat)",
        entityReference: `license:${license.license_id}`,
        details: `إلغاء ربط ${platform === "all" ? "جميع أجهزة" : `جهاز ${platform} الخاص بـ`} المستخدم ${userEmail} (${res.released} مقعد)`,
      });
      return res;
    });

    return NextResponse.json({
      success: true,
      released: result.released,
      usage: result.usage,
    });
  } catch (err) {
    console.error("POST /api/licensing/seats/release error:", err);
    return NextResponse.json({ success: false, error: "تعذر إلغاء ربط الجهاز. / Failed to release seat." }, { status: 500 });
  }
});

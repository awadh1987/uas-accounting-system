import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { recordAuditDiffTx } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { checkProfileUpdateAgainstLock } from "@/lib/licensing/companyLock";
import { loadActiveLockedLicense } from "@/lib/licensing/companyLockServer";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET() {
  try {
    const state = await getBootstrapState();
    return NextResponse.json({ enterpriseProfile: state.enterpriseProfile });
  } catch (error) {
    console.error("GET /api/system/branding error:", error);
    return jsonError("تعذر تحميل إعدادات الهوية البصرية", 500);
  }
});

async function handleUpdateBranding(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "cms",
    });
    if (!auth.ok) return auth.response;

    const existing = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });

    const strOpt = (key: string) =>
      body[key] !== undefined ? String(body[key] ?? "").trim() : undefined;
    const nullableStrOpt = (key: string) =>
      body[key] !== undefined ? (body[key] ? String(body[key]).trim() : null) : undefined;
    const boolOpt = (key: string) =>
      body[key] !== undefined ? Boolean(body[key]) : undefined;

    // Company-name lock: legalNameAr / legalNameEn may not be changed to a name that violates the
    // active company-locked license (signed company_name).
    const lockedLicense = loadActiveLockedLicense();
    if (lockedLicense) {
      const check = checkProfileUpdateAgainstLock(
        lockedLicense.company_name as string,
        existing
          ? { legalNameAr: existing.legalNameAr, legalNameEn: existing.legalNameEn, isConfigured: existing.isConfigured }
          : null,
        { legalNameAr: strOpt("legalNameAr"), legalNameEn: strOpt("legalNameEn") }
      );
      if (!check.ok) {
        return NextResponse.json({ error: check.error, code: "COMPANY_NAME_LOCKED" }, { status: 403 });
      }
    }

    const updateData = {
      isConfigured: true,
      ...(strOpt("legalNameAr") ? { legalNameAr: strOpt("legalNameAr") } : {}),
      ...(strOpt("legalNameEn") ? { legalNameEn: strOpt("legalNameEn") } : {}),
      ...(nullableStrOpt("taxNumber") !== undefined ? { taxNumber: nullableStrOpt("taxNumber") } : {}),
      ...(nullableStrOpt("commercialReg") !== undefined
        ? { commercialReg: nullableStrOpt("commercialReg") }
        : {}),
      ...(strOpt("currencyCode") ? { currencyCode: strOpt("currencyCode") } : {}),
      ...(nullableStrOpt("address") !== undefined ? { address: nullableStrOpt("address") } : {}),
      ...(nullableStrOpt("phone") !== undefined ? { phone: nullableStrOpt("phone") } : {}),
      ...(nullableStrOpt("email") !== undefined ? { email: nullableStrOpt("email") } : {}),
      ...(nullableStrOpt("logoUrl") !== undefined ? { logoUrl: nullableStrOpt("logoUrl") } : {}),
      ...(strOpt("brandColor") ? { brandColor: strOpt("brandColor") } : {}),
      ...(boolOpt("showUasLogo") !== undefined ? { showUasLogo: boolOpt("showUasLogo") } : {}),
      ...(strOpt("uasLogoStyle") ? { uasLogoStyle: strOpt("uasLogoStyle") } : {}),
      ...(nullableStrOpt("uasLogoCustomUrl") !== undefined
        ? { uasLogoCustomUrl: nullableStrOpt("uasLogoCustomUrl") }
        : {}),
      ...(boolOpt("showEnterpriseLogo") !== undefined
        ? { showEnterpriseLogo: boolOpt("showEnterpriseLogo") }
        : {}),
      ...(strOpt("enterpriseLogoStyle") ? { enterpriseLogoStyle: strOpt("enterpriseLogoStyle") } : {}),
      ...(nullableStrOpt("enterpriseLogoCustomUrl") !== undefined
        ? { enterpriseLogoCustomUrl: nullableStrOpt("enterpriseLogoCustomUrl") }
        : {}),
      ...(strOpt("heroBadgeAr") !== undefined ? { heroBadgeAr: strOpt("heroBadgeAr") } : {}),
      ...(strOpt("heroBadgeEn") !== undefined ? { heroBadgeEn: strOpt("heroBadgeEn") } : {}),
      ...(strOpt("heroTitleAr") !== undefined ? { heroTitleAr: strOpt("heroTitleAr") } : {}),
      ...(strOpt("heroTitleEn") !== undefined ? { heroTitleEn: strOpt("heroTitleEn") } : {}),
      ...(strOpt("heroSubtitleAr") !== undefined ? { heroSubtitleAr: strOpt("heroSubtitleAr") } : {}),
      ...(strOpt("heroSubtitleEn") !== undefined ? { heroSubtitleEn: strOpt("heroSubtitleEn") } : {}),
      ...(strOpt("aboutMissionAr") !== undefined ? { aboutMissionAr: strOpt("aboutMissionAr") } : {}),
      ...(strOpt("aboutMissionEn") !== undefined ? { aboutMissionEn: strOpt("aboutMissionEn") } : {}),
      ...(strOpt("contactPhone") !== undefined ? { contactPhone: strOpt("contactPhone") } : {}),
      ...(strOpt("contactWhatsApp") !== undefined ? { contactWhatsApp: strOpt("contactWhatsApp") } : {}),
      ...(strOpt("contactAddress") !== undefined ? { contactAddress: strOpt("contactAddress") } : {}),
      ...(boolOpt("showPublicMetrics") !== undefined
        ? { showPublicMetrics: boolOpt("showPublicMetrics") }
        : {}),
      ...(boolOpt("showPublicVerify") !== undefined
        ? { showPublicVerify: boolOpt("showPublicVerify") }
        : {}),
      ...(strOpt("ctaPrimaryTextAr") !== undefined
        ? { ctaPrimaryTextAr: strOpt("ctaPrimaryTextAr") }
        : {}),
      ...(strOpt("ctaPrimaryTextEn") !== undefined
        ? { ctaPrimaryTextEn: strOpt("ctaPrimaryTextEn") }
        : {}),
      ...(strOpt("welcomeNoticeAr") !== undefined
        ? { welcomeNoticeAr: strOpt("welcomeNoticeAr") }
        : {}),
      ...(strOpt("welcomeNoticeEn") !== undefined
        ? { welcomeNoticeEn: strOpt("welcomeNoticeEn") }
        : {}),
      ...(strOpt("supportEmail") !== undefined ? { supportEmail: strOpt("supportEmail") } : {}),
    };

    const updated = await prisma.$transaction(async (tx) => {
      const profile = await tx.enterpriseProfile.upsert({
        where: { id: "default" },
        update: updateData,
        create: {
          id: "default",
          legalNameAr: strOpt("legalNameAr") || "اسم المنشأة",
          legalNameEn:
            strOpt("legalNameEn") || "Enterprise Name",
          currencyCode: strOpt("currencyCode") || "YER",
          brandColor: strOpt("brandColor") || "#059669",
          ...updateData,
        },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "EnterpriseProfile",
        entityId: "default",
        before: existing
          ? {
              legalNameAr: existing.legalNameAr,
              showUasLogo: existing.showUasLogo,
              showEnterpriseLogo: existing.showEnterpriseLogo,
              heroTitleAr: existing.heroTitleAr,
            }
          : null,
        after: {
          legalNameAr: profile.legalNameAr,
          showUasLogo: profile.showUasLogo,
          showEnterpriseLogo: profile.showEnterpriseLogo,
          heroTitleAr: profile.heroTitleAr,
        },
      });

      await appendAuditLogTx(tx, {
        ...auth.actor,
        actionType: "تحديث الهوية البصرية وبوابة CMS",
        entityReference: "enterprise_profile",
        details: `تحديث بيانات المؤسسة (${profile.legalNameAr}) وإعدادات الشعار وبوابة الواجهة`,
      });

      return profile;
    });

    const state = await getBootstrapState();
    return NextResponse.json({ enterpriseProfile: updated, state });
  } catch (error) {
    console.error("PUT /api/system/branding error:", error);
    return jsonError("تعذر حفظ إعدادات الهوية البصرية وبوابة CMS", 500);
  }
}

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  return handleUpdateBranding(req);
});

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  return handleUpdateBranding(req);
});


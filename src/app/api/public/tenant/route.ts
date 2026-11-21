import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  buildTenantWorkspaceUrl,
  extractTenantResolutionFromRequest,
  getTenantMetadata,
} from "@/lib/tenant";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/tenant
 * Returns ONLY the resolved tenant's public landing & branding payload.
 * Never leaks data across tenants or from the root qat.world marketing portal.
 */
export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const resolution = extractTenantResolutionFromRequest(req);
    const meta = getTenantMetadata(resolution.tenantId);
    const profile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
    const settings = await prisma.systemSettings.findUnique({ where: { id: "default" } });

    const effectiveSlug =
      resolution.slug ||
      profile?.tenantSlug ||
      (meta?.slug && meta.slug !== "default" ? meta.slug : null);
    const isTenantWorkspace = Boolean(effectiveSlug && effectiveSlug !== "default");

    return NextResponse.json(
      {
        success: true,
        isTenantWorkspace,
        tenantId: resolution.tenantId,
        tenantSlug: effectiveSlug,
        tenantUrl: effectiveSlug ? buildTenantWorkspaceUrl(effectiveSlug) : "https://qat.world",
        resolutionSource: resolution.source,
        profile: profile
          ? {
              id: profile.id,
              legalNameAr: profile.legalNameAr,
              legalNameEn: profile.legalNameEn,
              taxNumber: profile.taxNumber || "",
              commercialReg: profile.commercialReg || "",
              currencyCode: profile.currencyCode,
              brandColor: profile.brandColor,
              logoUrl: profile.logoUrl,
              showUasLogo: profile.showUasLogo,
              uasLogoStyle: profile.uasLogoStyle,
              uasLogoCustomUrl: profile.uasLogoCustomUrl,
              showEnterpriseLogo: profile.showEnterpriseLogo,
              enterpriseLogoStyle: profile.enterpriseLogoStyle,
              enterpriseLogoCustomUrl: profile.enterpriseLogoCustomUrl,
              heroBadgeAr: profile.heroBadgeAr,
              heroBadgeEn: profile.heroBadgeEn,
              heroTitleAr: profile.heroTitleAr,
              heroTitleEn: profile.heroTitleEn,
              heroSubtitleAr: profile.heroSubtitleAr,
              heroSubtitleEn: profile.heroSubtitleEn,
              aboutMissionAr: profile.aboutMissionAr,
              aboutMissionEn: profile.aboutMissionEn,
              contactPhone: profile.contactPhone,
              contactWhatsApp: profile.contactWhatsApp,
              contactAddress: profile.contactAddress,
              supportEmail: profile.supportEmail || profile.email || "",
              welcomeNoticeAr: profile.welcomeNoticeAr || "",
              welcomeNoticeEn: profile.welcomeNoticeEn || "",
              showPublicMetrics: profile.showPublicMetrics,
              showPublicVerify: profile.showPublicVerify,
              ctaPrimaryTextAr: profile.ctaPrimaryTextAr,
              ctaPrimaryTextEn: profile.ctaPrimaryTextEn,
              tenantSlug: effectiveSlug,
            }
          : null,
        defaults: {
          defaultLang: settings?.defaultLang || "ar",
          defaultTheme: settings?.defaultTheme || "emerald",
          defaultCurrency: settings?.defaultCurrency || "YER",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (err) {
    console.error("GET /api/public/tenant error:", err);
    return jsonError("تعذر تحميل بيانات بوابة المنشأة / Failed to load tenant portal", 500);
  }
});

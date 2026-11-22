import { NextRequest, NextResponse } from "next/server";
import type { EnterpriseProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildTenantWorkspaceUrl,
  getTenantMetadata,
  runWithTenant,
} from "@/lib/tenant";
import { resolvePublicTenantFromRequest } from "@/lib/publicTenantResolver";
import { resolveEffectiveBrandInfo } from "@/lib/branding";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

function mapPublicProfile(profile: EnterpriseProfile | null, effectiveSlug: string | null) {
  if (!profile) return null;
  const brand = resolveEffectiveBrandInfo(profile, effectiveSlug);
  return {
    id: profile.id,
    legalNameAr: profile.legalNameAr,
    legalNameEn: profile.legalNameEn,
    taxNumber: profile.taxNumber || "",
    commercialReg: profile.commercialReg || "",
    currencyCode: profile.currencyCode,
    brandColor: profile.brandColor,
    logoUrl: profile.logoUrl,
    faviconUrl: profile.faviconUrl,
    taglineAr: profile.taglineAr || "",
    taglineEn: profile.taglineEn || "",
    effectiveLogoUrl: brand.effectiveLogoUrl,
    effectiveFaviconUrl: brand.effectiveFaviconUrl,
    hasCustomLogo: brand.hasCustomLogo,
    hasCustomFavicon: brand.hasCustomFavicon,
    hasCustomBrand: brand.hasCustomBrand,
    tabTitleEn: brand.tabTitleEn,
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
  };
}

/**
 * GET /api/public/tenant
 * Returns ONLY the resolved tenant's public landing & branding payload.
 * Never leaks data across tenants or from the root qat.world marketing portal.
 * Supports `?slug=<slug>` on root/IP hosts to resolve a matching registered tenant workspace.
 */
export async function GET(req: NextRequest) {
  try {
    const lookup = await resolvePublicTenantFromRequest(req);
    if (!lookup.found) {
      return NextResponse.json(
        {
          success: false,
          code: "TENANT_NOT_FOUND",
          error: `لم يتم العثور على مساحة منشأة مسجلة للنطاق "${lookup.explicitQuerySlug}" / Registered tenant workspace not found`,
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    const targetTenantId = lookup.tenantId;
    const resolvedSlug = lookup.resolvedSlug;
    const resolutionSource = lookup.resolutionSource;

    const meta = getTenantMetadata(targetTenantId);
    const { profile, settings } = await runWithTenant(targetTenantId, async () => {
      const [p, s] = await Promise.all([
        prisma.enterpriseProfile.findUnique({ where: { id: "default" } }),
        prisma.systemSettings.findUnique({ where: { id: "default" } }),
      ]);
      return { profile: p, settings: s };
    });

    const effectiveSlug =
      resolvedSlug ||
      profile?.tenantSlug ||
      (meta?.slug && meta.slug !== "default" ? meta.slug : null);
    const isTenantWorkspace = Boolean(effectiveSlug && effectiveSlug !== "default");
    const brandInfo = resolveEffectiveBrandInfo(profile, effectiveSlug);

    return NextResponse.json(
      {
        success: true,
        isTenantWorkspace,
        tenantId: targetTenantId,
        tenantSlug: effectiveSlug,
        tenantUrl: effectiveSlug
          ? meta?.tenantUrl || buildTenantWorkspaceUrl(effectiveSlug)
          : "https://qat.world",
        resolutionSource,
        branding: brandInfo,
        profile: mapPublicProfile(profile, effectiveSlug),
        defaults: {
          defaultLang: settings?.defaultLang || "ar",
          defaultTheme: settings?.defaultTheme || "emerald",
          defaultCurrency: settings?.defaultCurrency || "YER",
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "x-uas-tenant-id": targetTenantId,
          ...(effectiveSlug ? { "x-uas-tenant-slug": effectiveSlug } : {}),
        },
      }
    );
  } catch (err) {
    console.error("GET /api/public/tenant error:", err);
    return jsonError("تعذر تحميل بيانات بوابة المنشأة / Failed to load tenant portal", 500);
  }
}

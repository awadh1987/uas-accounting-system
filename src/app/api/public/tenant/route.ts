import { NextRequest, NextResponse } from "next/server";
import type { EnterpriseProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import {
  buildTenantWorkspaceUrl,
  extractSubdomainSlugFromHost,
  extractTenantResolutionFromRequest,
  findTenantBySlug,
  getTenantMetadata,
  runWithTenant,
} from "@/lib/tenant";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

function mapPublicProfile(profile: EnterpriseProfile | null, effectiveSlug: string | null) {
  if (!profile) return null;
  return {
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
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }

    const hostSubSlug =
      extractSubdomainSlugFromHost(req.headers.get("x-forwarded-host")) ||
      extractSubdomainSlugFromHost(req.headers.get("host")) ||
      extractSubdomainSlugFromHost(new URL(req.url, "http://localhost").host);

    const url = new URL(req.url, "http://localhost");
    const explicitQuerySlug = (url.searchParams.get("slug") || "").trim().toLowerCase();

    let targetTenantId = "default";
    let resolvedSlug: string | null = null;
    let resolutionSource = "default";

    if (!hostSubSlug && explicitQuerySlug) {
      if (explicitQuerySlug === "default") {
        targetTenantId = "default";
        resolvedSlug = null;
        resolutionSource = "query";
      } else {
        const matched = findTenantBySlug(explicitQuerySlug);
        if (!matched || matched.status !== "ACTIVE") {
          return NextResponse.json(
            {
              success: false,
              code: "TENANT_NOT_FOUND",
              error: `لم يتم العثور على مساحة منشأة مسجلة للنطاق "${explicitQuerySlug}" / Registered tenant workspace not found`,
            },
            {
              status: 404,
              headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate",
              },
            }
          );
        }
        targetTenantId = matched.tenantId;
        resolvedSlug = matched.slug || explicitQuerySlug;
        resolutionSource = "query";
      }
    } else {
      const resolution = extractTenantResolutionFromRequest(req);
      targetTenantId = resolution.tenantId;
      resolvedSlug = resolution.slug;
      resolutionSource = resolution.source;
    }

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

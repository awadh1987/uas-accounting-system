import type { LanguageCode, UasEnterpriseProfile } from "@/types/uas";

export const DEFAULT_TAGLINE_AR = "منظومة مالية ومحاسبية مؤسسية";
export const DEFAULT_TAGLINE_EN = "Financial & Accounting Enterprise System";
export const DEFAULT_TAB_TITLE = "UAS Accounting System";
export const DEFAULT_UAS_LOGO_URL = "/uas-logo.png";
export const DEFAULT_UAS_FAVICON_URL = "/favicon-32x32.png";
export const DEFAULT_UAS_APPLE_ICON_URL = "/apple-touch-icon.png";

const DEFAULT_UAS_ASSET_PATHS = new Set<string>([
  "/uas-logo.png",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/icons/apple-touch-icon.png",
  "/icons/apple-touch-icon-180x180.png",
  "/icons/icon-192.png",
  "/icons/icon-192x192.png",
  "/icons/icon-512.png",
  "/icons/icon-512x512.png",
  "/icons/icon-maskable-512.png",
  "/icons/icon.png",
  "/icons/icon.svg",
  "/icons/uas-logo.png",
]);

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g;

const GENERIC_EN_PLACEHOLDERS = new Set<string>([
  "enterprise name",
  "enterprise legal name",
  "unified accounting system",
  "unified accounting system (default)",
  "unified accounting system (uas)",
  "unified accounting system (uas enterprise)",
  "uas",
  "uas enterprise",
  "uas accounting system",
  "accounting system",
  "default",
]);

export function isDefaultUasAssetUrl(rawUrl?: string | null): boolean {
  const clean = (rawUrl || "").trim();
  if (!clean) return true;
  const withoutQuery = clean.split("?")[0].split("#")[0].toLowerCase();
  return DEFAULT_UAS_ASSET_PATHS.has(withoutQuery);
}

export function resolveCustomLogoUrl(
  profile?: Partial<UasEnterpriseProfile> | null
): string | null {
  if (!profile) return null;
  const entCustom = (profile.enterpriseLogoCustomUrl || "").trim();
  if (entCustom && !isDefaultUasAssetUrl(entCustom)) {
    return entCustom;
  }
  const logoUrl = (profile.logoUrl || "").trim();
  if (logoUrl && !isDefaultUasAssetUrl(logoUrl)) {
    return logoUrl;
  }
  return null;
}

export function resolveCustomFaviconUrl(
  profile?: Partial<UasEnterpriseProfile> | null
): string | null {
  if (!profile) return null;
  const fav = (profile.faviconUrl || "").trim();
  if (fav && !isDefaultUasAssetUrl(fav)) {
    return fav;
  }
  return null;
}

export function resolveEffectiveTagline(
  profile?: Partial<UasEnterpriseProfile> | null,
  lang: LanguageCode = "ar"
): string {
  const raw =
    lang === "ar"
      ? (profile?.taglineAr || "").trim()
      : (profile?.taglineEn || "").trim();
  if (raw) return raw;
  return lang === "ar" ? DEFAULT_TAGLINE_AR : DEFAULT_TAGLINE_EN;
}

export function stripArabicChars(input: string): string {
  return input
    .replace(ARABIC_CHAR_REGEX, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s|•\-–—/]+|[\s|•\-–—/]+$/g, "")
    .trim();
}

export function formatSlugAsEnglishTitle(slug?: string | null): string {
  const clean = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!clean || clean === "default") return "";
  return clean
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface EffectiveBrandInfo {
  hasCustomLogo: boolean;
  hasCustomFavicon: boolean;
  hasCustomBrand: boolean;
  customLogoUrl: string | null;
  customFaviconUrl: string | null;
  effectiveLogoUrl: string;
  effectiveFaviconUrl: string;
  derivedFaviconFromLogo: boolean;
  tabTitleEn: string;
  taglineAr: string;
  taglineEn: string;
}

export function resolveEffectiveBrandInfo(
  profile?: Partial<UasEnterpriseProfile> | null,
  tenantSlug?: string | null
): EffectiveBrandInfo {
  const effectiveSlug =
    (tenantSlug || profile?.tenantSlug || "").trim().toLowerCase() || null;
  const isTenantWorkspace = Boolean(effectiveSlug && effectiveSlug !== "default");

  const customLogoUrl = resolveCustomLogoUrl(profile);
  const customFaviconUrl = resolveCustomFaviconUrl(profile);
  const hasCustomLogo = Boolean(customLogoUrl);
  const hasCustomFavicon = Boolean(customFaviconUrl);
  const derivedFaviconFromLogo = !hasCustomFavicon && hasCustomLogo;
  const hasCustomBrand = hasCustomLogo || hasCustomFavicon;

  const slugQuery = isTenantWorkspace && effectiveSlug ? `?slug=${encodeURIComponent(effectiveSlug)}` : "";

  const effectiveLogoUrl = hasCustomLogo
    ? customLogoUrl!.startsWith("data:")
      ? isTenantWorkspace
        ? `/api/public/tenant/logo${slugQuery}`
        : customLogoUrl!
      : customLogoUrl!
    : DEFAULT_UAS_LOGO_URL;

  const extractVersionParam = (url?: string | null): string => {
    if (!url || url.startsWith("data:")) return "";
    const qIdx = url.indexOf("?");
    if (qIdx < 0) return "";
    const params = new URLSearchParams(url.slice(qIdx + 1));
    return (params.get("v") || "").trim();
  };

  let effectiveFaviconUrl = DEFAULT_UAS_FAVICON_URL;
  if (hasCustomFavicon) {
    effectiveFaviconUrl = customFaviconUrl!.startsWith("data:")
      ? `/api/public/tenant/favicon${slugQuery}`
      : customFaviconUrl!;
  } else if (hasCustomLogo) {
    const ver = extractVersionParam(customLogoUrl);
    const params = new URLSearchParams();
    if (isTenantWorkspace && effectiveSlug) params.set("slug", effectiveSlug);
    if (ver) params.set("v", ver);
    const qs = params.toString();
    effectiveFaviconUrl = `/api/public/tenant/favicon${qs ? `?${qs}` : ""}`;
  }

  const tabTitleEn = buildEnglishTabTitle(profile, effectiveSlug);

  return {
    hasCustomLogo,
    hasCustomFavicon,
    hasCustomBrand,
    customLogoUrl,
    customFaviconUrl,
    effectiveLogoUrl,
    effectiveFaviconUrl,
    derivedFaviconFromLogo,
    tabTitleEn,
    taglineAr: resolveEffectiveTagline(profile, "ar"),
    taglineEn: resolveEffectiveTagline(profile, "en"),
  };
}

/**
 * Computes an English-only browser `<title>` for any tenant or the default UAS brand.
 * Never returns Arabic characters, regardless of active UI locale (`ar` / `en`).
 */
export function buildEnglishTabTitle(
  profile?: Partial<UasEnterpriseProfile> | null,
  tenantSlug?: string | null
): string {
  const cleanSlug = (tenantSlug || profile?.tenantSlug || "").trim().toLowerCase();
  const isTenantWorkspace = Boolean(cleanSlug && cleanSlug !== "default");

  const rawEn = stripArabicChars(String(profile?.legalNameEn || ""));
  const isMeaningfulEn =
    Boolean(rawEn) && !GENERIC_EN_PLACEHOLDERS.has(rawEn.toLowerCase());

  const hasCustomAssets =
    Boolean(resolveCustomLogoUrl(profile)) || Boolean(resolveCustomFaviconUrl(profile));

  if (isTenantWorkspace) {
    const tenantEnglishName = isMeaningfulEn
      ? rawEn
      : formatSlugAsEnglishTitle(cleanSlug);
    if (tenantEnglishName) {
      return hasCustomAssets ? tenantEnglishName : `${tenantEnglishName} | UAS`;
    }
    return DEFAULT_TAB_TITLE;
  }

  if (isMeaningfulEn) {
    return hasCustomAssets ? rawEn : `${rawEn} | UAS`;
  }

  return DEFAULT_TAB_TITLE;
}

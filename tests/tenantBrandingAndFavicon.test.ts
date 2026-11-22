import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  DEFAULT_TAB_TITLE,
  DEFAULT_TAGLINE_AR,
  DEFAULT_TAGLINE_EN,
  DEFAULT_UAS_FAVICON_URL,
  DEFAULT_UAS_LOGO_URL,
  buildEnglishTabTitle,
  resolveEffectiveBrandInfo,
  resolveEffectiveTagline,
} from "../src/lib/branding";
import {
  deleteTenantBrandAssetFile,
  resolveTenantBrandingDir,
} from "../src/lib/brandingAssets";
import { canonicalizeLicensePayload, type UasSignedLicense } from "../src/lib/licensing";
import {
  ensureTenantRegistered,
  normalizeTenantId,
  resetRegistryForTests,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
  unregisterTenant,
} from "../src/lib/tenant";
import { prisma } from "../src/lib/prisma";
import { POST as licensingActivatePOST } from "../src/app/api/licensing/activate/route";
import { GET as publicTenantGET } from "../src/app/api/public/tenant/route";
import { GET as publicTenantFaviconGET } from "../src/app/api/public/tenant/favicon/route";
import { GET as publicTenantLogoGET } from "../src/app/api/public/tenant/logo/route";
import { PUT as brandingPUT } from "../src/app/api/system/branding/route";
import { DELETE as brandingUploadDELETE } from "../src/app/api/system/branding/upload/route";
import { PUT as tenantConfigPUT } from "../src/app/api/tenant/config/route";

const HAS_ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const SAMPLE_SVG_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1d4ed8"/><text x="32" y="40" text-anchor="middle" fill="#fff" font-size="24">YB</text></svg>';
const SAMPLE_SVG_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(SAMPLE_SVG_LOGO, "utf8").toString("base64")}`;

// Minimal valid 1x1 transparent PNG
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;

describe("Tenant Branding, Custom Favicon/Logo, Editable Tagline & English-Only Tab Title", () => {
  const testSlug = `brandtest-${Date.now().toString().slice(-6)}`;
  const testTenantId = normalizeTenantId(testSlug);

  after(async () => {
    deleteTenantBrandAssetFile(testSlug, "all");
    const brandDir = resolveTenantBrandingDir(testSlug);
    try {
      if (fs.existsSync(brandDir)) fs.rmSync(brandDir, { recursive: true, force: true });
    } catch {}
    unregisterTenant(testTenantId);
    await resetTenantClientsForTests();
    const dbPath = resolveTenantDbFilePath(testTenantId);
    if (dbPath) {
      for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
        if (fs.existsSync(f)) {
          try {
            fs.unlinkSync(f);
          } catch {}
        }
      }
    }
  });

  it("enforces English-only browser tab <title> regardless of active locale or mixed Arabic input", () => {
    // Default qat.world root
    assert.equal(buildEnglishTabTitle(null, null), DEFAULT_TAB_TITLE);
    assert.equal(
      buildEnglishTabTitle({ legalNameAr: "النظام المحاسبي الموحد", legalNameEn: "Unified Accounting System" }, "default"),
      "UAS Accounting System"
    );
    assert.equal(HAS_ARABIC_REGEX.test(DEFAULT_TAB_TITLE), false);

    // Tenant without custom assets
    const t1 = buildEnglishTabTitle(
      {
        legalNameAr: "وكالة ياسر البوكلي لتجارة القات",
        legalNameEn: "Yasser Albukli Qat Trading",
        logoUrl: "/uas-logo.png",
        tenantSlug: "yasser-albukli",
      },
      "yasser-albukli"
    );
    assert.equal(t1, "Yasser Albukli Qat Trading | UAS");
    assert.equal(HAS_ARABIC_REGEX.test(t1), false);

    // Tenant with custom brand asset
    const t2 = buildEnglishTabTitle(
      {
        legalNameAr: "وكالة الجابري لتجارة القات",
        legalNameEn: "Al-Jabri Qat Trading",
        enterpriseLogoCustomUrl: "/api/public/tenant/logo?slug=aljabri&v=1",
        tenantSlug: "aljabri",
      },
      "aljabri"
    );
    assert.equal(t2, "Al-Jabri Qat Trading");
    assert.equal(HAS_ARABIC_REGEX.test(t2), false);

    // Mixed Arabic + English accidentally stored in legalNameEn -> Arabic stripped cleanly
    const t3 = buildEnglishTabTitle(
      {
        legalNameAr: "وكالة العامري",
        legalNameEn: "وكالة العامري Al-Ameri Qat Trading",
        tenantSlug: "alameri",
      },
      "alameri"
    );
    assert.equal(t3, "Al-Ameri Qat Trading | UAS");
    assert.equal(HAS_ARABIC_REGEX.test(t3), false);

    // Purely Arabic legalNameEn falls back to formatted English slug
    const t4 = buildEnglishTabTitle(
      {
        legalNameAr: "وكالة ياسر البوكلي",
        legalNameEn: "وكالة ياسر البوكلي",
        tenantSlug: "yasser-albukli",
      },
      "yasser-albukli"
    );
    assert.equal(t4, "Yasser Albukli | UAS");
    assert.equal(HAS_ARABIC_REGEX.test(t4), false);
  });

  it("falls back to UAS brand assets by default and derives favicon when custom logo is provided", () => {
    const defaultBrand = resolveEffectiveBrandInfo(
      {
        legalNameAr: "وكالة الجابري",
        legalNameEn: "Al-Jabri Qat Trading",
        logoUrl: "/uas-logo.png",
        tenantSlug: "aljabri",
      },
      "aljabri"
    );
    assert.equal(defaultBrand.hasCustomBrand, false);
    assert.equal(defaultBrand.effectiveLogoUrl, DEFAULT_UAS_LOGO_URL);
    assert.equal(defaultBrand.effectiveFaviconUrl, DEFAULT_UAS_FAVICON_URL);
    assert.equal(defaultBrand.derivedFaviconFromLogo, false);

    const logoOnlyBrand = resolveEffectiveBrandInfo(
      {
        legalNameAr: "وكالة الجابري",
        legalNameEn: "Al-Jabri Qat Trading",
        enterpriseLogoCustomUrl: "/api/public/tenant/logo?slug=aljabri&v=42",
        tenantSlug: "aljabri",
      },
      "aljabri"
    );
    assert.equal(logoOnlyBrand.hasCustomLogo, true);
    assert.equal(logoOnlyBrand.hasCustomFavicon, false);
    assert.equal(logoOnlyBrand.derivedFaviconFromLogo, true);
    assert.equal(logoOnlyBrand.effectiveFaviconUrl, "/api/public/tenant/favicon?slug=aljabri&v=42");

    const explicitFaviconBrand = resolveEffectiveBrandInfo(
      {
        legalNameAr: "وكالة الجابري",
        legalNameEn: "Al-Jabri Qat Trading",
        enterpriseLogoCustomUrl: "/api/public/tenant/logo?slug=aljabri&v=42",
        faviconUrl: "/api/public/tenant/favicon?slug=aljabri&v=99",
        tenantSlug: "aljabri",
      },
      "aljabri"
    );
    assert.equal(explicitFaviconBrand.hasCustomFavicon, true);
    assert.equal(explicitFaviconBrand.derivedFaviconFromLogo, false);
    assert.equal(explicitFaviconBrand.effectiveFaviconUrl, "/api/public/tenant/favicon?slug=aljabri&v=99");
  });

  it("resolves editable tagline with default Arabic/English fallback", () => {
    assert.equal(resolveEffectiveTagline(null, "ar"), DEFAULT_TAGLINE_AR);
    assert.equal(resolveEffectiveTagline(undefined, "en"), DEFAULT_TAGLINE_EN);
    assert.equal(
      resolveEffectiveTagline({ taglineAr: "تجارة القات الفاخر - صنعاء", taglineEn: "Premium Qat Trading" }, "ar"),
      "تجارة القات الفاخر - صنعاء"
    );
    assert.equal(
      resolveEffectiveTagline({ taglineAr: "تجارة القات الفاخر", taglineEn: "Premium Qat Trading" }, "en"),
      "Premium Qat Trading"
    );
  });

  it("removes hardcoded green UAS badge next to company name in header, sidebar & login components", () => {
    const root = process.cwd();
    const landingSrc = fs.readFileSync(path.join(root, "src/components/LandingPage.tsx"), "utf8");
    const loginSrc = fs.readFileSync(path.join(root, "src/components/LoginView.tsx"), "utf8");
    const sidebarSrc = fs.readFileSync(path.join(root, "src/components/SidebarNav.tsx"), "utf8");
    const topBarSrc = fs.readFileSync(path.join(root, "src/components/TopCommandBar.tsx"), "utf8");

    assert.equal(landingSrc.includes("{state.settings.logoText || \"UAS\"}"), false);
    assert.equal(sidebarSrc.includes("{logoText || \"UAS\"}"), false);
    assert.equal(loginSrc.includes("bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-black"), false);
    assert.equal(topBarSrc.includes("<span>{logoText || \"UAS\"}</span>"), false);

    assert.equal(landingSrc.includes("resolveEffectiveTagline"), true);
    assert.equal(loginSrc.includes("resolveEffectiveTagline"), true);
    assert.equal(sidebarSrc.includes("resolveEffectiveTagline"), true);
  });

  it("persists custom logo, derived/custom favicon & editable tagline via APIs and resets back to UAS", async () => {
    const tmpDataDir = path.join(fs.mkdtempSync("/tmp/uas-brand-test-"), "data");
    const prevDataDir = process.env.UAS_DATA_DIR;
    process.env.UAS_DATA_DIR = tmpDataDir;

    try {
    ensureTenantRegistered(testTenantId, "وكالة الاختبار للتجارة", {
      slug: testSlug,
      nameAr: "وكالة الاختبار للتجارة",
      nameEn: "Brand Test Qat Trading",
    });

    await runWithTenant(testTenantId, async () => {
      await prisma.enterpriseProfile.updateMany({
        where: { id: "default" },
        data: {
          tenantSlug: testSlug,
          legalNameAr: "وكالة الاختبار للتجارة",
          legalNameEn: "Brand Test Qat Trading",
          isConfigured: true,
        },
      });
    });

    // Activate valid signed license for test tenant in isolated tmpDataDir
    const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));
    const licPayload = {
      license_id: `UAS-BRAND-${Date.now()}`,
      customer_name: "وكالة الاختبار للتجارة",
      company_name: "وكالة الاختبار للتجارة",
      name_ar: "وكالة الاختبار للتجارة",
      name_en: "Brand Test Qat Trading",
      tenant_slug: testSlug,
      tenant_url: `https://${testSlug}.qat.world`,
      hwid: "*",
      allowed_modes: ["local" as const, "lan" as const, "cloud" as const],
      max_branches: 3,
      max_lan_seats: 10,
      max_users: 7,
      per_user_devices: { windows: 1, android: 1 },
      issued_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 86400_000 * 30).toISOString(),
    };
    const signature = crypto
      .sign(null, Buffer.from(canonicalizeLicensePayload(licPayload), "utf8"), privateKey)
      .toString("base64");
    const signedLic: UasSignedLicense = { ...licPayload, signature };
    const actRes = await licensingActivatePOST(
      new NextRequest(`https://${testSlug}.qat.world/api/licensing/activate`, {
        method: "POST",
        headers: { host: `${testSlug}.qat.world`, "content-type": "application/json" },
        body: JSON.stringify({
          licenseFileContent: JSON.stringify(signedLic),
          userEmail: `admin@${testSlug}.qat.world`,
          platform: "windows",
        }),
      })
    );
    assert.equal(actRes.status, 200);

    // 1. Before custom branding: public endpoint and icon routes fall back cleanly to UAS
    const initialPubRes = await publicTenantGET(
      new NextRequest(`https://${testSlug}.qat.world/api/public/tenant`, {
        headers: { host: `${testSlug}.qat.world` },
      })
    );
    assert.equal(initialPubRes.status, 200);
    const initialPub = await initialPubRes.json();
    assert.equal(initialPub.branding?.hasCustomBrand, false);
    assert.equal(initialPub.branding?.effectiveLogoUrl, "/uas-logo.png");
    assert.equal(initialPub.branding?.effectiveFaviconUrl, "/favicon-32x32.png");
    assert.equal(initialPub.branding?.tabTitleEn, "Brand Test Qat Trading | UAS");
    assert.equal(initialPub.branding?.taglineAr, DEFAULT_TAGLINE_AR);

    const defaultFavRes = await publicTenantFaviconGET(
      new NextRequest(`https://${testSlug}.qat.world/api/public/tenant/favicon`, {
        headers: { host: `${testSlug}.qat.world` },
      })
    );
    assert.equal(defaultFavRes.status, 200);
    assert.equal(defaultFavRes.headers.get("content-type"), "image/png");

    // 2. Save custom SVG logo + custom tagline via PUT /api/system/branding
    const updateRes = await brandingPUT(
      new NextRequest(`https://${testSlug}.qat.world/api/system/branding`, {
        method: "PUT",
        headers: {
          host: `${testSlug}.qat.world`,
          "content-type": "application/json",
          "x-uas-user-id": "u1",
          "x-uas-role": "SUPER_ADMIN",
        },
        body: JSON.stringify({
          enterpriseLogoCustomUrl: SAMPLE_SVG_DATA_URL,
          enterpriseLogoStyle: "custom",
          showEnterpriseLogo: true,
          taglineAr: "أجود أنواع القات اليمني الفاخر",
          taglineEn: "Finest Yemeni Qat Wholesale",
          actor: { userId: "u1", userDisplay: "Admin", userRole: "SUPER_ADMIN" },
        }),
      })
    );
    assert.equal(updateRes.status, 200);
    const updateJson = await updateRes.json();
    assert.ok(String(updateJson.enterpriseProfile?.enterpriseLogoCustomUrl).startsWith("/api/public/tenant/logo"));
    assert.equal(updateJson.enterpriseProfile?.taglineAr, "أجود أنواع القات اليمني الفاخر");

    // Verify file was written to tenant-scoped directory
    const brandDir = resolveTenantBrandingDir(testSlug);
    assert.equal(fs.existsSync(path.join(brandDir, "logo.svg")), true);

    // Public tenant payload now reflects custom logo + derived favicon + custom tagline
    const brandedPubRes = await publicTenantGET(
      new NextRequest(`https://${testSlug}.qat.world/api/public/tenant`, {
        headers: { host: `${testSlug}.qat.world` },
      })
    );
    const brandedPub = await brandedPubRes.json();
    assert.equal(brandedPub.branding?.hasCustomLogo, true);
    assert.equal(brandedPub.branding?.hasCustomFavicon, false);
    assert.equal(brandedPub.branding?.derivedFaviconFromLogo, true);
    assert.equal(brandedPub.branding?.tabTitleEn, "Brand Test Qat Trading");
    assert.equal(brandedPub.branding?.taglineAr, "أجود أنواع القات اليمني الفاخر");
    assert.equal(brandedPub.branding?.taglineEn, "Finest Yemeni Qat Wholesale");

    // Tenant logo & derived favicon endpoints both serve the custom SVG
    const customLogoRes = await publicTenantLogoGET(
      new NextRequest(`https://${testSlug}.qat.world/api/public/tenant/logo`, {
        headers: { host: `${testSlug}.qat.world` },
      })
    );
    assert.equal(customLogoRes.status, 200);
    assert.equal(customLogoRes.headers.get("content-type"), "image/svg+xml");

    const derivedFavRes = await publicTenantFaviconGET(
      new NextRequest(`https://${testSlug}.qat.world/api/public/tenant/favicon`, {
        headers: { host: `${testSlug}.qat.world` },
      })
    );
    assert.equal(derivedFavRes.status, 200);
    assert.equal(derivedFavRes.headers.get("content-type"), "image/svg+xml");

    // 3. Upload explicit PNG favicon via PUT /api/tenant/config
    const cfgRes = await tenantConfigPUT(
      new NextRequest(`https://${testSlug}.qat.world/api/tenant/config`, {
        method: "PUT",
        headers: {
          host: `${testSlug}.qat.world`,
          "content-type": "application/json",
          "x-uas-user-id": "u1",
          "x-uas-role": "SUPER_ADMIN",
        },
        body: JSON.stringify({
          faviconUrl: SAMPLE_PNG_DATA_URL,
          taglineAr: "وكالة الاختبار المعتمدة",
          actor: { userId: "u1", userDisplay: "Admin", userRole: "SUPER_ADMIN" },
        }),
      })
    );
    assert.equal(cfgRes.status, 200);
    assert.equal(fs.existsSync(path.join(brandDir, "favicon.png")), true);

    const explicitFavRes = await publicTenantFaviconGET(
      new NextRequest(`https://${testSlug}.qat.world/api/public/tenant/favicon`, {
        headers: { host: `${testSlug}.qat.world` },
      })
    );
    assert.equal(explicitFavRes.status, 200);
    assert.equal(explicitFavRes.headers.get("content-type"), "image/png");

    // 4. Reset back to default UAS branding via DELETE /api/system/branding/upload?kind=all
    const resetRes = await brandingUploadDELETE(
      new NextRequest(`https://${testSlug}.qat.world/api/system/branding/upload?kind=all`, {
        method: "DELETE",
        headers: {
          host: `${testSlug}.qat.world`,
          "x-uas-user-id": "u1",
          "x-uas-role": "SUPER_ADMIN",
        },
      })
    );
    assert.equal(resetRes.status, 200);
    assert.equal(fs.existsSync(path.join(brandDir, "logo.svg")), false);
    assert.equal(fs.existsSync(path.join(brandDir, "favicon.png")), false);

    const afterResetPubRes = await publicTenantGET(
      new NextRequest(`https://${testSlug}.qat.world/api/public/tenant`, {
        headers: { host: `${testSlug}.qat.world` },
      })
    );
    const afterResetPub = await afterResetPubRes.json();
    assert.equal(afterResetPub.branding?.hasCustomBrand, false);
    assert.equal(afterResetPub.branding?.effectiveLogoUrl, "/uas-logo.png");
    assert.equal(afterResetPub.branding?.effectiveFaviconUrl, "/favicon-32x32.png");
    assert.equal(afterResetPub.branding?.taglineAr, DEFAULT_TAGLINE_AR);
    } finally {
      unregisterTenant(testTenantId);
      await resetTenantClientsForTests();
      resetRegistryForTests();
      if (prevDataDir === undefined) delete process.env.UAS_DATA_DIR;
      else process.env.UAS_DATA_DIR = prevDataDir;
      try {
        fs.rmSync(path.dirname(tmpDataDir), { recursive: true, force: true });
      } catch {}
    }
  });
});

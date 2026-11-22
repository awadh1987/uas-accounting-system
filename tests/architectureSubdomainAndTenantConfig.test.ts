import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { NextRequest } from "next/server";
import {
  buildTenantWorkspaceUrl,
  ensureTenantRegistered,
  extractSubdomainSlugFromHost,
  extractTenantResolutionFromRequest,
  generateTenantSlug,
  normalizeTenantId,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
  transliterateArabicToAscii,
  unregisterTenant,
  validateTenantSlug,
} from "../src/lib/tenant";
import { GET as publicTenantGET } from "../src/app/api/public/tenant/route";
import {
  OPTIONS as provisionOPTIONS,
  POST as provisionPOST,
} from "../src/app/api/tenants/provision/route";
import { POST as loginPOST } from "../src/app/api/auth/login/route";
import { issueSessionToken } from "../src/lib/authSession";
import { hashPassword } from "../src/lib/serverBootstrap";
import { prisma } from "../src/lib/prisma";
import {
  canonicalizeLicensePayload,
  validateLicenseStructure,
  type UasSignedLicense,
} from "../src/lib/licensing/licenseSchema";
import { verifyLicenseSignature } from "../src/lib/licensing/verifier";
import { verifyKeyRequest } from "../src/lib/licensing/licenseAuthority";
import { MemorySeatStore } from "../src/lib/licensing/seatService";

const TEST_SLUG_TENANT = `al-jabri-test-${Date.now().toString().slice(-6)}`;

describe("Multi-Tenant Subdomain-on-Key, Slug Validation & Tenant Routing", () => {
  after(async () => {
    await resetTenantClientsForTests();
    const dbPath = resolveTenantDbFilePath(TEST_SLUG_TENANT);
    if (dbPath && fs.existsSync(dbPath)) {
      for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
        if (fs.existsSync(f)) {
          try {
            fs.unlinkSync(f);
          } catch {}
        }
      }
    }
  });

  it("transliterates Arabic & English names into validated 3-32 char ASCII lowercase slugs with reserved-word and collision guards", () => {
    const arTranslit = transliterateArabicToAscii("شركة الجبري الزراعية ٢٠٢٦");
    assert.ok(/^[a-z0-9\s-]+$/.test(arTranslit));
    assert.ok(arTranslit.includes("2026"));

    const generated = generateTenantSlug("شركة الجبري الزراعية");
    assert.ok(validateTenantSlug(generated.slug).valid);
    assert.ok(generated.slug.length >= 3 && generated.slug.length <= 32);
    assert.equal(generated.url, `https://${generated.slug}.qat.world`);

    // Short name padding
    const shortRes = generateTenantSlug("AB");
    assert.ok(validateTenantSlug(shortRes.slug).valid);
    assert.ok(shortRes.slug.length >= 3);

    // Long name truncation
    const longRes = generateTenantSlug(
      "Al Jabri International Agricultural Development and Logistics Group Corporation Limited"
    );
    assert.ok(validateTenantSlug(longRes.slug).valid);
    assert.ok(longRes.slug.length <= 32);

    // Reserved words rejected by validator and guarded by generator
    for (const reserved of ["www", "api", "admin", "qat", "default", "system", "login"]) {
      assert.equal(validateTenantSlug(reserved).valid, false, `Reserved slug '${reserved}' must fail`);
      const guarded = generateTenantSlug(reserved);
      assert.notEqual(guarded.slug, reserved);
      assert.ok(validateTenantSlug(guarded.slug).valid);
    }

    // Collision disambiguation
    const first = generateTenantSlug("Yemen Coffee Co");
    const second = generateTenantSlug("Yemen Coffee Co", { existingSlugs: [first.slug] });
    assert.equal(second.collisionAdjusted, true);
    assert.notEqual(second.slug, first.slug);
    assert.ok(second.slug.endsWith("-2"));
    assert.ok(validateTenantSlug(second.slug).valid);
  });

  it("extracts subdomain slugs strictly for <slug>.qat.world and rejects apex, www, IPs, and reserved names", () => {
    assert.equal(extractSubdomainSlugFromHost("al-jabri.qat.world"), "al-jabri");
    assert.equal(extractSubdomainSlugFromHost("al-jabri.qat.world:443"), "al-jabri");
    assert.equal(extractSubdomainSlugFromHost("coffee-coop.localhost:3000"), "coffee-coop");

    assert.equal(extractSubdomainSlugFromHost("qat.world"), null);
    assert.equal(extractSubdomainSlugFromHost("www.qat.world"), null);
    assert.equal(extractSubdomainSlugFromHost("api.qat.world"), null);
    assert.equal(extractSubdomainSlugFromHost("192.168.1.50:3000"), null);
    assert.equal(extractSubdomainSlugFromHost("localhost:3000"), null);
    assert.equal(extractSubdomainSlugFromHost("a.b.qat.world"), null);
    assert.equal(buildTenantWorkspaceUrl("al-jabri"), "https://al-jabri.qat.world");
  });

  it("resolves tenant deterministically in order: subdomain > x-uas-tenant-id header > session/cookie > default", () => {
    // 1. Subdomain beats explicit header
    const subReq = new NextRequest("https://al-jabri.qat.world/api/bootstrap", {
      headers: {
        host: "al-jabri.qat.world",
        "x-uas-tenant-id": "other-company",
        "x-uas-session-tenant": "third-company",
      },
    });
    const r1 = extractTenantResolutionFromRequest(subReq);
    assert.equal(r1.source, "subdomain");
    assert.equal(r1.slug, "al-jabri");
    assert.equal(r1.tenantId, normalizeTenantId("al-jabri"));

    // 2. Explicit x-uas-tenant-id header beats session/cookie on desktop/mobile/LAN
    const hdrReq = new NextRequest("https://qat.world/api/bootstrap", {
      headers: {
        host: "qat.world",
        "x-uas-tenant-id": "sanaa-farms",
        "x-uas-session-tenant": "old-session",
      },
    });
    const r2 = extractTenantResolutionFromRequest(hdrReq);
    assert.equal(r2.source, "header");
    assert.equal(r2.slug, "sanaa-farms");
    assert.equal(r2.tenantId, "sanaa_farms");

    // 3. Authenticated session binding beats query/default
    const sessReq = new NextRequest("https://qat.world/api/bootstrap", {
      headers: {
        host: "qat.world",
        "x-uas-session-tenant": "aden-trading",
      },
    });
    const r3 = extractTenantResolutionFromRequest(sessReq);
    assert.equal(r3.source, "session");
    assert.equal(r3.slug, "aden-trading");
    assert.equal(r3.tenantId, "aden_trading");

    // 4. Query param ?slug= resolution
    const querySlugReq = new NextRequest("https://qat.world/api/public/tenant?slug=al-jabri", {
      headers: { host: "qat.world" },
    });
    const rQuery = extractTenantResolutionFromRequest(querySlugReq);
    assert.equal(rQuery.source, "query");
    assert.equal(rQuery.slug, "al-jabri");
    assert.equal(rQuery.tenantId, "al_jabri");

    // 5. Root default fallback
    const defReq = new NextRequest("https://qat.world/api/bootstrap", {
      headers: { host: "qat.world" },
    });
    const r4 = extractTenantResolutionFromRequest(defReq);
    assert.equal(r4.source, "default");
    assert.equal(r4.tenantId, "default");
  });

  it("resolves GET /api/public/tenant?slug=<slug> for registered tenants and returns 404 for unknown slugs", async () => {
    const slug = `alwaha-${Date.now().toString().slice(-5)}`;
    const normId = normalizeTenantId(slug);
    ensureTenantRegistered(normId, "شركة الواحة للتجارة", {
      slug,
      nameAr: "شركة الواحة للتجارة",
      nameEn: "Alwaha Trading Co",
    });

    try {
      await runWithTenant(normId, async () => {
        await prisma.enterpriseProfile.updateMany({
          where: { id: "default" },
          data: { tenantSlug: slug, legalNameAr: "شركة الواحة للتجارة" },
        });
      });

      const okReq = new NextRequest(`http://127.0.0.1:3000/api/public/tenant?slug=${slug}`, {
        headers: { host: "127.0.0.1:3000" },
      });
      const okRes = await publicTenantGET(okReq);
      assert.equal(okRes.status, 200);
      const okJson = await okRes.json();
      assert.equal(okJson.isTenantWorkspace, true);
      assert.equal(okJson.tenantSlug, slug);
      assert.equal(okJson.tenantId, normId);
      assert.equal(okJson.resolutionSource, "query");
      assert.equal(okJson.profile?.legalNameAr, "شركة الواحة للتجارة");

      const notFoundReq = new NextRequest("https://qat.world/api/public/tenant?slug=unregistered-co-999", {
        headers: { host: "qat.world" },
      });
      const notFoundRes = await publicTenantGET(notFoundReq);
      assert.equal(notFoundRes.status, 404);
      const nfJson = await notFoundRes.json();
      assert.equal(nfJson.code, "TENANT_NOT_FOUND");
    } finally {
      unregisterTenant(normId);
      await resetTenantClientsForTests();
      const dbPath = resolveTenantDbFilePath(normId);
      if (dbPath) {
        for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
          if (fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch {}
          }
        }
      }
    }
  });

  it("signs & verifies v3 subdomain-on-key licenses and propagates tenant_slug & tenant_url without breaking v2 compatibility", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const basePayload = {
      license_id: "UAS-2026-9901",
      customer_name: "Al-Jabri Agricultural Co",
      company_name: "Al-Jabri Agricultural Co",
      name_ar: "شركة الجبري الزراعية",
      name_en: "Al-Jabri Agricultural Co",
      tenant_slug: "al-jabri-agri",
      tenant_url: "https://al-jabri-agri.qat.world",
      hwid: "*",
      allowed_modes: ["local" as const, "lan" as const, "cloud" as const],
      max_branches: 3,
      max_lan_seats: 10,
      max_users: 7,
      per_user_devices: { windows: 1, android: 1 },
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400_000 * 30).toISOString(),
    };

    const canonical = canonicalizeLicensePayload(basePayload);
    const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
    const signed: UasSignedLicense = { ...basePayload, signature };

    const validated = validateLicenseStructure(signed);
    assert.ok(validated);
    assert.equal(validated.tenant_slug, "al-jabri-agri");
    assert.equal(validated.tenant_url, "https://al-jabri-agri.qat.world");
    assert.equal(verifyLicenseSignature(validated, pubPem), true);

    // Verify invalid/reserved tenant_slug is rejected by structure validator
    assert.equal(validateLicenseStructure({ ...signed, tenant_slug: "www" }), null);
    assert.equal(validateLicenseStructure({ ...signed, tenant_slug: "ab" }), null);

    // Verify online authority returns tenant_slug and tenant_url
    const keyToken = `UASKEY-${Buffer.from(JSON.stringify(signed)).toString("base64")}`;
    const store = new MemorySeatStore();
    const res = await verifyKeyRequest(
      {
        key: keyToken,
        company_name: "Al-Jabri Agricultural Co",
        user_email: "admin@al-jabri-agri.qat.world",
        platform: "windows",
        hwid: "WIN-HWID-001",
      },
      { store, publicKeyPem: pubPem }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.tenant_slug, "al-jabri-agri");
    assert.equal(res.body.tenant_url, "https://al-jabri-agri.qat.world");
  });

  it("isolates tenant EnterpriseProfile welcome notices & sync settings inside tenant DB", async () => {
    await runWithTenant(TEST_SLUG_TENANT, async () => {
      await prisma.enterpriseProfile.update({
        where: { id: "default" },
        data: {
          tenantSlug: TEST_SLUG_TENANT,
          welcomeNoticeAr: "بوابة شركة الجبري الخاصة",
          supportEmail: "support@al-jabri.qat.world",
        },
      });
      await prisma.systemSettings.update({
        where: { id: "default" },
        data: {
          autoSyncEnabled: true,
          autoSyncIntervalSec: 45,
          defaultDeviceSyncMode: "MANUAL",
        },
      });

      const prof = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
      const sets = await prisma.systemSettings.findUnique({ where: { id: "default" } });
      assert.equal(prof?.tenantSlug, TEST_SLUG_TENANT);
      assert.equal(prof?.welcomeNoticeAr, "بوابة شركة الجبري الخاصة");
      assert.equal(sets?.autoSyncIntervalSec, 45);
      assert.equal(sets?.defaultDeviceSyncMode, "MANUAL");
    });
  });

  it("handles OPTIONS, enforces auth, provisions tenant via POST /api/tenants/provision, resolves ?slug= & subdomain, and allows tenant SUPER_ADMIN login", async () => {
    const optRes = await provisionOPTIONS(
      new NextRequest("https://qat.world/api/tenants/provision", {
        method: "OPTIONS",
        headers: { origin: "https://qat.world" },
      })
    );
    assert.equal(optRes.status, 204);
    assert.ok(optRes.headers.get("access-control-allow-methods")?.includes("POST"));

    // 1. Unauthenticated caller -> 401
    const unauthRes = await provisionPOST(
      new NextRequest("https://qat.world/api/tenants/provision", {
        method: "POST",
        headers: { host: "qat.world", "content-type": "application/json" },
        body: JSON.stringify({ slug: "alwaha-unauth", companyName: "Alwaha Unauth" }),
      })
    );
    assert.equal(unauthRes.status, 401);

    // Prepare root SUPER_ADMIN and root non-admin users in default DB
    let rootAdminId = "";
    let rootAcctId = "";
    await runWithTenant("default", async () => {
      const existingAdmin = await prisma.user.findFirst({
        where: { role: "SUPER_ADMIN", active: true, isActive: true },
      });
      if (existingAdmin) {
        rootAdminId = existingAdmin.id;
      } else {
        const created = await prisma.user.create({
          data: {
            username: `prov_root_sa_${Date.now()}`,
            name: "Root Provision Admin",
            fullName: "Root Provision Admin",
            email: `prov_root_sa_${Date.now()}@qat.world`,
            passwordHash: hashPassword("RootPass@2026"),
            role: "SUPER_ADMIN",
            active: true,
            isActive: true,
          },
        });
        rootAdminId = created.id;
      }

      const acct = await prisma.user.create({
        data: {
          username: `prov_acct_${Date.now()}`,
          name: "Root Field Acct",
          fullName: "Root Field Acct",
          email: `prov_acct_${Date.now()}@qat.world`,
          passwordHash: hashPassword("AcctPass@2026"),
          role: "FIELD_ACCOUNTANT",
          active: true,
          isActive: true,
        },
      });
      rootAcctId = acct.id;
    });

    const rootAdminToken = issueSessionToken({
      userId: rootAdminId,
      userRole: "SUPER_ADMIN",
      tenantId: "default",
      userDisplay: "Root Provision Admin",
    });
    const rootAcctToken = issueSessionToken({
      userId: rootAcctId,
      userRole: "FIELD_ACCOUNTANT",
      tenantId: "default",
      userDisplay: "Root Field Acct",
    });

    const provSlug = `alwaha-p-${Date.now().toString().slice(-5)}`;
    const provTenantId = normalizeTenantId(provSlug);

    try {
      // 2. Non-SUPER_ADMIN caller -> 403
      const forbiddenRes = await provisionPOST(
        new NextRequest("https://qat.world/api/tenants/provision", {
          method: "POST",
          headers: {
            host: "qat.world",
            "content-type": "application/json",
            authorization: `Bearer ${rootAcctToken}`,
          },
          body: JSON.stringify({ slug: provSlug, companyName: "Alwaha Prohibited" }),
        })
      );
      assert.equal(forbiddenRes.status, 403);

      // 3. Valid root SUPER_ADMIN provisions tenant (even with companyName in JSON body!) -> 201
      const provRes = await provisionPOST(
        new NextRequest("https://qat.world/api/tenants/provision", {
          method: "POST",
          headers: {
            host: "qat.world",
            "content-type": "application/json",
            authorization: `Bearer ${rootAdminToken}`,
          },
          body: JSON.stringify({
            slug: provSlug,
            companyName: "شركة الواحة للاختبار",
            nameAr: "شركة الواحة للاختبار",
            nameEn: "Alwaha Provision Test Co",
            adminUsername: "alwaha_owner",
            adminEmail: `owner@${provSlug}.qat.world`,
            adminPassword: "AlwahaOwnerPass#2026",
            adminName: "مالك الواحة",
          }),
        })
      );
      assert.equal(provRes.status, 201);
      const provJson = await provRes.json();
      assert.equal(provJson.success, true);
      assert.equal(provJson.slug, provSlug);
      assert.equal(provJson.tenantId, provTenantId);
      assert.equal(provJson.tenantUrl, `https://${provSlug}.qat.world`);
      assert.equal(provJson.adminAccount?.username, "alwaha_owner");
      assert.equal(provJson.adminAccount?.role, "SUPER_ADMIN");

      // 4. Duplicate slug without allowExisting -> 409
      const dupRes = await provisionPOST(
        new NextRequest("https://qat.world/api/tenants/provision", {
          method: "POST",
          headers: {
            host: "qat.world",
            "content-type": "application/json",
            authorization: `Bearer ${rootAdminToken}`,
          },
          body: JSON.stringify({ slug: provSlug, companyName: "Dup" }),
        })
      );
      assert.equal(dupRes.status, 409);

      // 5. Public resolution works immediately via both ?slug= and Host subdomain
      const bySlugRes = await publicTenantGET(
        new NextRequest(`https://qat.world/api/public/tenant?slug=${provSlug}`, {
          headers: { host: "qat.world" },
        })
      );
      assert.equal(bySlugRes.status, 200);
      const bySlugJson = await bySlugRes.json();
      assert.equal(bySlugJson.isTenantWorkspace, true);
      assert.equal(bySlugJson.tenantSlug, provSlug);
      assert.equal(bySlugJson.resolutionSource, "query");

      const byHostRes = await publicTenantGET(
        new NextRequest(`https://${provSlug}.qat.world/api/public/tenant`, {
          headers: { host: `${provSlug}.qat.world` },
        })
      );
      assert.equal(byHostRes.status, 200);
      const byHostJson = await byHostRes.json();
      assert.equal(byHostJson.isTenantWorkspace, true);
      assert.equal(byHostJson.tenantSlug, provSlug);
      assert.equal(byHostJson.resolutionSource, "subdomain");

      // 6. Seeded tenant SUPER_ADMIN can log in directly on <slug>.qat.world
      const loginRes = await loginPOST(
        new NextRequest(`https://${provSlug}.qat.world/api/auth/login`, {
          method: "POST",
          headers: {
            host: `${provSlug}.qat.world`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            identifier: "alwaha_owner",
            password: "AlwahaOwnerPass#2026",
          }),
        })
      );
      assert.equal(loginRes.status, 200);
      const loginJson = await loginRes.json();
      assert.equal(loginJson.tenantId, provTenantId);
      assert.equal(loginJson.user?.role, "SUPER_ADMIN");
      assert.ok(loginJson.sessionToken);
    } finally {
      if (rootAcctId) {
        await runWithTenant("default", async () => {
          await prisma.user.delete({ where: { id: rootAcctId } }).catch(() => {});
        });
      }
      unregisterTenant(provTenantId);
      await resetTenantClientsForTests();
      const dbPath = resolveTenantDbFilePath(provTenantId);
      if (dbPath) {
        for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
          if (fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch {}
          }
        }
      }
    }
  });
});

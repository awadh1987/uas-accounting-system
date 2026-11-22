import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  ensureTenantRegistered,
  findTenantBySlug,
  getTenantMetadata,
  normalizeTenantId,
  resetRegistryForTests,
  resetTenantClientsForTests,
  resolveTenantDatabaseUrl,
  resolveTenantDbFilePath,
  resolveTenantPostgresDbName,
  resolveTenantSqliteFilePath,
  runWithTenant,
  unregisterTenant,
} from "../src/lib/tenant";
import { prisma } from "../src/lib/prisma";
import {
  activateOfflineClientLicense,
  canonicalizeLicensePayload,
  createMemoryStorage,
  type UasSignedLicense,
} from "../src/lib/licensing";
import { verifyLicenseSignature } from "../src/lib/licensing/verifier";
import { evaluateCompanyLock } from "../src/lib/licensing/companyLock";
import { POST as licensingActivatePOST } from "../src/app/api/licensing/activate/route";

const TEST_SLUG = `dual-test-${Date.now().toString().slice(-6)}`;
const TEST_ID = normalizeTenantId(TEST_SLUG);

describe("Dual-Storage Tenant Provisioning, Routing & Cross-Mode Activation", () => {
  after(async () => {
    unregisterTenant(TEST_ID);
    await resetTenantClientsForTests();
    resetRegistryForTests();
    const dbPath = resolveTenantSqliteFilePath(TEST_SLUG);
    for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`, `${dbPath}-journal`]) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
    }
  });

  it("derives isolated PostgreSQL DB names and SQLite paths under data/tenants/<slug>.db", () => {
    assert.equal(resolveTenantPostgresDbName("default"), "uas_qat_prod");
    assert.equal(resolveTenantPostgresDbName("yasser-albukli"), "uas_yasser_albukli");
    assert.equal(resolveTenantPostgresDbName("yasser_albukli"), "uas_yasser_albukli");

    const sqlitePath = resolveTenantSqliteFilePath(TEST_SLUG);
    assert.ok(sqlitePath.replace(/\\/g, "/").endsWith(`/data/tenants/${TEST_SLUG}.db`));
    assert.equal(resolveTenantDbFilePath(TEST_SLUG), sqlitePath);
    assert.equal(resolveTenantDbFilePath(TEST_ID), sqlitePath);
  });

  it("routes registered PostgreSQL tenants with postgresDb to isolated database URL while preserving legacy schema fallback", () => {
    const prevUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://uas_admin:pass@127.0.0.1:5432/uas_qat_prod?schema=public";

      ensureTenantRegistered(TEST_ID, "وكالة اختبار مزدوجة", {
        slug: TEST_SLUG,
        postgresDb: `uas_${TEST_ID}`,
        sqliteDbPath: `data/tenants/${TEST_SLUG}.db`,
        allowedModes: ["local", "lan", "cloud"],
      });

      const metaBySlug = findTenantBySlug(TEST_SLUG);
      const metaByNorm = getTenantMetadata(TEST_ID);
      assert.ok(metaBySlug);
      assert.equal(metaByNorm?.postgresDb, `uas_${TEST_ID}`);

      const pgTargetUrl = resolveTenantDatabaseUrl(TEST_SLUG);
      assert.equal(
        pgTargetUrl,
        `postgresql://uas_admin:pass@127.0.0.1:5432/uas_${TEST_ID}?schema=public`
      );

      // Unregistered tenant falls back to schema isolation
      const unregisteredUrl = resolveTenantDatabaseUrl("unregistered-co-test");
      assert.ok(unregisteredUrl.includes("schema=tenant_unregistered_co_test"));
    } finally {
      unregisterTenant(TEST_ID);
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
    }
  });

  it("treats seeded system placeholder names as unconfigured in evaluateCompanyLock", () => {
    const evalDefault = evaluateCompanyLock("وكالة ياسر البوكلي لتجارة القات", {
      legalNameAr: "النظام المحاسبي الموحد (Default)",
      legalNameEn: "Unified Accounting System",
      isConfigured: true,
    });
    assert.equal(evalDefault.outcome, "ADOPT");
  });

  it("enforces allowed_modes, aligns profile on first offline activation, and stores tenantUrl/tenantSlug", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    const base = {
      license_id: "UAS-DUAL-OFF-1",
      customer_name: "Yasser Test Co",
      company_name: "Yasser Test Co",
      name_ar: "وكالة ياسر للاختبار",
      name_en: "Yasser Test Co",
      tenant_slug: "yasser-test",
      tenant_url: "https://yasser-test.qat.world",
      hwid: "*",
      allowed_modes: ["local" as const, "cloud" as const],
      max_branches: 3,
      max_lan_seats: 10,
      max_users: 7,
      per_user_devices: { windows: 1, android: 1 },
      issued_at: new Date(Date.now() - 3600_000).toISOString(),
      expires_at: new Date(Date.now() + 86400_000 * 30).toISOString(),
    };
    const sig = crypto.sign(null, Buffer.from(canonicalizeLicensePayload(base), "utf8"), privateKey).toString("base64");
    const signed: UasSignedLicense = { ...base, signature: sig };
    assert.equal(verifyLicenseSignature(signed, pubPem), true);

    const storage = createMemoryStorage();
    // Simulate stale placeholder profile before first activation
    storage.setItem(
      "uas_offline_enterprise_profile_v2",
      JSON.stringify({ legalNameAr: "النظام المحاسبي الموحد (Default)", legalNameEn: "Default", isConfigured: true })
    );

    const blockedMode = await activateOfflineClientLicense(
      {
        activationKey: `UASKEY-${Buffer.from(JSON.stringify(signed)).toString("base64")}`,
        userEmail: "admin@yasser-test.qat.world",
        platform: "android",
        mode: "lan",
      },
      { storage, publicKeyPem: pubPem }
    );
    assert.equal(blockedMode.success, false);
    if (!blockedMode.success) assert.equal(blockedMode.code, "MODE_NOT_ALLOWED");

    const okRes = await activateOfflineClientLicense(
      {
        activationKey: `UASKEY-${Buffer.from(JSON.stringify(signed)).toString("base64")}`,
        userEmail: "admin@yasser-test.qat.world",
        platform: "android",
        mode: "cloud",
      },
      { storage, publicKeyPem: pubPem }
    );
    assert.equal(okRes.success, true);
    if (okRes.success) {
      assert.equal(okRes.tenantSlug, "yasser-test");
      assert.equal(okRes.tenantUrl, "https://yasser-test.qat.world");
      assert.deepEqual(okRes.allowedModes, ["local", "cloud"]);
      assert.equal(storage.getItem("uas_tenant_id"), "yasser-test");
      assert.equal(storage.getItem("uas_cloud_server_url"), "https://yasser-test.qat.world");
    }
  });

  it("aligns placeholder EnterpriseProfile on first POST /api/licensing/activate and returns tenantUrl & syncMetadata", async () => {
    const tmpDataDir = path.join(fs.mkdtempSync("/tmp/uas-dual-act-"), "data");
    const prevDataDir = process.env.UAS_DATA_DIR;
    const slug = `align-${Date.now().toString().slice(-5)}`;
    const tid = normalizeTenantId(slug);
    const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
    assert.equal(fs.existsSync(privPath), true);
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));

    try {
      process.env.UAS_DATA_DIR = tmpDataDir;
      ensureTenantRegistered(tid, `منشأة ${tid}`, {
        slug,
        nameAr: `منشأة ${tid}`,
        nameEn: `${tid} Enterprise`,
      });

      await runWithTenant(tid, async () => {
        await prisma.enterpriseProfile.upsert({
          where: { id: "default" },
          update: { legalNameAr: `منشأة ${tid}`, legalNameEn: `${tid} Enterprise`, isConfigured: true },
          create: { id: "default", legalNameAr: `منشأة ${tid}`, legalNameEn: `${tid} Enterprise`, isConfigured: true },
        });
      });

      const licPayload = {
        license_id: `UAS-ALIGN-${Date.now()}`,
        customer_name: "وكالة اختبار التوافق",
        company_name: "وكالة اختبار التوافق",
        name_ar: "وكالة اختبار التوافق",
        name_en: "Alignment Test Trading",
        tenant_slug: slug,
        tenant_url: `https://${slug}.qat.world`,
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

      const req = new NextRequest(`https://${slug}.qat.world/api/licensing/activate`, {
        method: "POST",
        headers: { host: `${slug}.qat.world`, "content-type": "application/json" },
        body: JSON.stringify({
          licenseFileContent: JSON.stringify(signedLic),
          userEmail: `admin@${slug}.qat.world`,
          platform: "windows",
        }),
      });
      const res = await licensingActivatePOST(req);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.tenantUrl, `https://${slug}.qat.world`);
      assert.equal(body.tenantSlug, slug);
      assert.deepEqual(body.allowedModes, ["local", "lan", "cloud"]);
      assert.equal(body.syncMetadata?.tenantSlug, slug);

      await runWithTenant(tid, async () => {
        const profile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
        assert.equal(profile?.legalNameAr, "وكالة اختبار التوافق");
        assert.equal(profile?.legalNameEn, "Alignment Test Trading");
        assert.equal(profile?.tenantSlug, slug);
      });
    } finally {
      if (prevDataDir === undefined) delete process.env.UAS_DATA_DIR;
      else process.env.UAS_DATA_DIR = prevDataDir;
      unregisterTenant(tid);
      await resetTenantClientsForTests();
      const dbPath = resolveTenantSqliteFilePath(slug);
      for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`, `${dbPath}-journal`]) {
        if (fs.existsSync(f)) {
          try { fs.unlinkSync(f); } catch {}
        }
      }
      fs.rmSync(path.dirname(tmpDataDir), { recursive: true, force: true });
    }
  });
});

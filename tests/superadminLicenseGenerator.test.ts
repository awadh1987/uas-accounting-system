import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { issueSessionToken } from "../src/lib/authSession";
import { decodeLicenseInput, verifyLicenseSignature } from "../src/lib/licensing/verifier";
import { defaultPrisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/serverBootstrap";
import { ensureSqliteDatabaseReady } from "../src/lib/sqliteBootstrap";
import { resetRegistryForTests, resetTenantClientsForTests } from "../src/lib/tenant";
import {
  GET as superadminLicensesGET,
  POST as superadminLicensesPOST,
} from "../src/app/api/superadmin/licenses/route";
import { GET as superadminDownloadGET } from "../src/app/api/superadmin/licenses/[slug]/download/route";

describe("Superadmin License Generator & Tenant Provisioner API", () => {
  const createdUserIds: string[] = [];
  let tmpRootDir = "";
  let tmpDataDir = "";
  let prevDataDir: string | undefined;
  let prevDatabaseUrl: string | undefined;

  let ownerUserId = "";
  let nonOwnerSuperAdminId = "";
  let managerUserId = "";
  let ownerToken = "";
  let nonOwnerSuperAdminToken = "";
  let managerToken = "";
  let tenantSessionToken = "";

  const issuedSlug = `sup-test-${Date.now().toString().slice(-6)}`;

  before(async () => {
    prevDataDir = process.env.UAS_DATA_DIR;
    prevDatabaseUrl = process.env.DATABASE_URL;

    tmpRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-superadmin-lic-"));
    tmpDataDir = path.join(tmpRootDir, "data");
    fs.mkdirSync(tmpDataDir, { recursive: true });

    process.env.UAS_DATA_DIR = tmpDataDir;
    if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith("file:")) {
      process.env.DATABASE_URL = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
    }

    await ensureSqliteDatabaseReady();

    // 1. Ensure active platform owner admin@qat.world
    const existingOwner = await defaultPrisma.user.findFirst({
      where: { email: "admin@qat.world" },
    });
    if (existingOwner) {
      ownerUserId = existingOwner.id;
      if (!existingOwner.active || !existingOwner.isActive) {
        await defaultPrisma.user.update({
          where: { id: existingOwner.id },
          data: { active: true, isActive: true, role: "SUPER_ADMIN" },
        });
      }
    } else {
      const created = await defaultPrisma.user.create({
        data: {
          username: `admin_root_${Date.now()}`,
          name: "Platform Owner",
          fullName: "Platform Owner",
          email: "admin@qat.world",
          passwordHash: hashPassword("OwnerPass@2026"),
          role: "SUPER_ADMIN",
          active: true,
          isActive: true,
        },
      });
      ownerUserId = created.id;
      createdUserIds.push(created.id);
    }

    // 2. Non-admin@qat.world SUPER_ADMIN account
    const otherSa = await defaultPrisma.user.create({
      data: {
        username: `other_sa_${Date.now()}`,
        name: "Other Super Admin",
        fullName: "Other Super Admin",
        email: `other-sa-${Date.now()}@qat.world`,
        passwordHash: hashPassword("OtherPass@2026"),
        role: "SUPER_ADMIN",
        active: true,
        isActive: true,
      },
    });
    nonOwnerSuperAdminId = otherSa.id;
    createdUserIds.push(otherSa.id);

    // 3. Non-owner PROJECT_MANAGER account
    const mgr = await defaultPrisma.user.create({
      data: {
        username: `mgr_test_${Date.now()}`,
        name: "Manager User",
        fullName: "Manager User",
        email: `mgr-${Date.now()}@qat.world`,
        passwordHash: hashPassword("MgrPass@2026"),
        role: "PROJECT_MANAGER",
        active: true,
        isActive: true,
      },
    });
    managerUserId = mgr.id;
    createdUserIds.push(mgr.id);

    ownerToken = issueSessionToken({
      userId: ownerUserId,
      userRole: "SUPER_ADMIN",
      tenantId: "default",
      userDisplay: "Platform Owner (SUPER_ADMIN)",
    });

    nonOwnerSuperAdminToken = issueSessionToken({
      userId: nonOwnerSuperAdminId,
      userRole: "SUPER_ADMIN",
      tenantId: "default",
      userDisplay: "Other SA (SUPER_ADMIN)",
    });

    managerToken = issueSessionToken({
      userId: managerUserId,
      userRole: "PROJECT_MANAGER",
      tenantId: "default",
      userDisplay: "Manager (PROJECT_MANAGER)",
    });

    tenantSessionToken = issueSessionToken({
      userId: ownerUserId,
      userRole: "SUPER_ADMIN",
      tenantId: "aljabri",
      userDisplay: "Tenant Admin (SUPER_ADMIN)",
    });
  });

  after(async () => {
    for (const uid of createdUserIds) {
      await defaultPrisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await resetTenantClientsForTests();
    resetRegistryForTests();

    if (prevDataDir === undefined) delete process.env.UAS_DATA_DIR;
    else process.env.UAS_DATA_DIR = prevDataDir;

    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;

    if (tmpRootDir && fs.existsSync(tmpRootDir)) {
      fs.rmSync(tmpRootDir, { recursive: true, force: true });
    }
  });

  it("blocks unauthenticated requests with 401 across list, issue, and download routes", async () => {
    const getRes = await superadminLicensesGET(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        headers: { host: "qat.world" },
      })
    );
    assert.equal(getRes.status, 401);

    const postRes = await superadminLicensesPOST(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        method: "POST",
        headers: { host: "qat.world", "content-type": "application/json" },
        body: JSON.stringify({ slug: "unauth-co", companyName: "Unauth Co" }),
      })
    );
    assert.equal(postRes.status, 401);

    const dlRes = await superadminDownloadGET(
      new NextRequest("https://qat.world/api/superadmin/licenses/aljabri/download?type=uas", {
        headers: { host: "qat.world" },
      }),
      { params: Promise.resolve({ slug: "aljabri" }) }
    );
    assert.equal(dlRes.status, 401);

    // Spoofed headers without signed session token must also fail with 401
    const spoofRes = await superadminLicensesGET(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        headers: {
          host: "qat.world",
          "x-uas-user-id": ownerUserId,
          "x-uas-role": "SUPER_ADMIN",
        },
      })
    );
    assert.equal(spoofRes.status, 401);
  });

  it("blocks non-admin@qat.world accounts and tenant subdomains (*.qat.world) with 403", async () => {
    // Non-owner PROJECT_MANAGER -> 403
    const mgrRes = await superadminLicensesGET(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        headers: {
          host: "qat.world",
          "x-uas-session-token": managerToken,
        },
      })
    );
    assert.equal(mgrRes.status, 403);

    // Another SUPER_ADMIN whose email is not admin@qat.world -> 403
    const otherSaRes = await superadminLicensesPOST(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": nonOwnerSuperAdminToken,
        },
        body: JSON.stringify({ slug: "blocked-co", companyName: "Blocked Co" }),
      })
    );
    assert.equal(otherSaRes.status, 403);

    // Tenant-scoped session token -> 403
    const tenantSessRes = await superadminLicensesGET(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        headers: {
          host: "qat.world",
          "x-uas-session-token": tenantSessionToken,
        },
      })
    );
    assert.equal(tenantSessRes.status, 403);

    // Request arriving on tenant subdomain (*.qat.world) even with owner token -> 403
    const subRes = await superadminLicensesGET(
      new NextRequest("https://aljabri.qat.world/api/superadmin/licenses", {
        headers: {
          host: "aljabri.qat.world",
          "x-forwarded-host": "aljabri.qat.world",
          "x-uas-session-token": ownerToken,
        },
      })
    );
    assert.equal(subRes.status, 403);

    // Explicit tenant header override -> 403
    const hdrTenantRes = await superadminLicensesPOST(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-tenant-id": "aljabri",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ slug: "blocked-sub", companyName: "Blocked Sub" }),
      })
    );
    assert.equal(hdrTenantRes.status, 403);
  });

  it("validates slug rules, plan, email, and expiry date for admin@qat.world", async () => {
    const invalidCases = [
      { slug: "ab", companyName: "Short Slug" },
      { slug: "www", companyName: "Reserved Slug" },
      { slug: "bad_slug", companyName: "Underscore Slug" },
      { slug: "bad--slug", companyName: "Double Hyphen" },
      { slug: "../etc", companyName: "Traversal Slug" },
      { slug: "valid-slug", companyName: "" },
      { slug: "valid-slug", companyName: "Valid Co", plan: "ultra" },
      { slug: "valid-slug", companyName: "Valid Co", expiresAt: "2020-01-01" },
    ];

    for (const payload of invalidCases) {
      const res = await superadminLicensesPOST(
        new NextRequest("https://qat.world/api/superadmin/licenses", {
          method: "POST",
          headers: {
            host: "qat.world",
            "content-type": "application/json",
            "x-uas-session-token": ownerToken,
          },
          body: JSON.stringify(payload),
        })
      );
      assert.equal(res.status, 400, `Expected 400 for payload: ${JSON.stringify(payload)}`);
    }
  });

  it("issues signed license, persists .uas & .uaskey.txt under data/licenses/<slug>/, lists tenant, and serves safe downloads", async () => {
    const issueRes = await superadminLicensesPOST(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({
          slug: issuedSlug,
          companyName: "مؤسسة الاختبار السحابية",
          plan: "pro",
          expiresAt: "2027-12-31",
        }),
      })
    );
    assert.equal(issueRes.status, 201);

    const issueBody = (await issueRes.json()) as {
      success: boolean;
      license: {
        licenseId: string;
        slug: string;
        workspaceUrl: string;
        plan: string;
        adminEmail: string;
        adminUsername: string;
        adminPassword: string;
        uaskey: string;
        expiresAt: string;
        hasUasFile: boolean;
        hasTxtFile: boolean;
      };
    };

    assert.equal(issueBody.success, true);
    assert.equal(issueBody.license.slug, issuedSlug);
    assert.equal(issueBody.license.workspaceUrl, `https://${issuedSlug}.qat.world`);
    assert.equal(issueBody.license.adminEmail, `admin@${issuedSlug}.qat.world`);
    assert.equal(issueBody.license.adminUsername, "admin");
    assert.ok(issueBody.license.adminPassword.length >= 8);
    assert.equal(issueBody.license.plan, "pro");
    assert.ok(issueBody.license.uaskey.startsWith("UASKEY-"));
    assert.equal(issueBody.license.hasUasFile, true);
    assert.equal(issueBody.license.hasTxtFile, true);

    // Verify files exist in data/licenses/<slug>/ and SQLite DB in data/tenants/<slug>.db
    const uasFilePath = path.join(tmpDataDir, "licenses", issuedSlug, `${issuedSlug}.uas`);
    const txtFilePath = path.join(tmpDataDir, "licenses", issuedSlug, `${issuedSlug}.uaskey.txt`);
    const sqlitePath = path.join(tmpDataDir, "tenants", `${issuedSlug}.db`);
    assert.equal(fs.existsSync(uasFilePath), true);
    assert.equal(fs.existsSync(txtFilePath), true);
    assert.equal(fs.existsSync(sqlitePath), true);

    // Verify no stray root-level license.uas / license.uaskey.txt exist
    assert.equal(fs.existsSync(path.join(process.cwd(), "license.uas")), false);
    assert.equal(fs.existsSync(path.join(process.cwd(), "license.uaskey.txt")), false);

    // Verify Ed25519 signature of issued key
    const decoded = decodeLicenseInput(issueBody.license.uaskey);
    assert.ok(decoded);
    assert.equal(decoded.tenant_slug, issuedSlug);
    assert.equal(decoded.max_users, 5); // pro plan defaults
    assert.equal(verifyLicenseSignature(decoded), true);

    // GET /api/superadmin/licenses lists the newly issued tenant
    const listRes = await superadminLicensesGET(
      new NextRequest("https://qat.world/api/superadmin/licenses", {
        headers: {
          host: "qat.world",
          "x-uas-session-token": ownerToken,
        },
      })
    );
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as {
      success: boolean;
      tenants: Array<{
        slug: string;
        plan: string;
        adminEmail: string;
        hasUasFile: boolean;
        hasTxtFile: boolean;
        uaskey: string;
      }>;
    };
    const found = listBody.tenants.find((t) => t.slug === issuedSlug);
    assert.ok(found);
    assert.equal(found.plan, "pro");
    assert.equal(found.adminEmail, `admin@${issuedSlug}.qat.world`);
    assert.equal(found.hasUasFile, true);
    assert.equal(found.hasTxtFile, true);
    assert.equal(found.uaskey, issueBody.license.uaskey);

    // Download .uas attachment
    const dlUasRes = await superadminDownloadGET(
      new NextRequest(`https://qat.world/api/superadmin/licenses/${issuedSlug}/download?type=uas`, {
        headers: {
          host: "qat.world",
          "x-uas-session-token": ownerToken,
        },
      }),
      { params: Promise.resolve({ slug: issuedSlug }) }
    );
    assert.equal(dlUasRes.status, 200);
    assert.equal(dlUasRes.headers.get("content-type"), "application/octet-stream");
    assert.equal(
      dlUasRes.headers.get("content-disposition"),
      `attachment; filename="${issuedSlug}.uas"`
    );
    const uasText = await dlUasRes.text();
    assert.ok(JSON.parse(uasText).signature);

    // Download .uaskey.txt attachment
    const dlTxtRes = await superadminDownloadGET(
      new NextRequest(`https://qat.world/api/superadmin/licenses/${issuedSlug}/download?type=txt`, {
        headers: {
          host: "qat.world",
          "x-uas-session-token": ownerToken,
        },
      }),
      { params: Promise.resolve({ slug: issuedSlug }) }
    );
    assert.equal(dlTxtRes.status, 200);
    assert.equal(dlTxtRes.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(
      dlTxtRes.headers.get("content-disposition"),
      `attachment; filename="${issuedSlug}.uaskey.txt"`
    );
    const txtContent = await dlTxtRes.text();
    assert.ok(txtContent.startsWith("UASKEY-"));

    // Path traversal & invalid type protection
    const travRes = await superadminDownloadGET(
      new NextRequest("https://qat.world/api/superadmin/licenses/..%2F..%2Fkeys/download?type=uas", {
        headers: {
          host: "qat.world",
          "x-uas-session-token": ownerToken,
        },
      }),
      { params: Promise.resolve({ slug: "../../keys" }) }
    );
    assert.equal(travRes.status, 400);

    const badTypeRes = await superadminDownloadGET(
      new NextRequest(`https://qat.world/api/superadmin/licenses/${issuedSlug}/download?type=pem`, {
        headers: {
          host: "qat.world",
          "x-uas-session-token": ownerToken,
        },
      }),
      { params: Promise.resolve({ slug: issuedSlug }) }
    );
    assert.equal(badTypeRes.status, 400);
  });
});

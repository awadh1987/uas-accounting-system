import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { issueSessionToken } from "../src/lib/authSession";
import { defaultPrisma, prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/serverBootstrap";
import { ensureSqliteDatabaseReady } from "../src/lib/sqliteBootstrap";
import {
  resetRegistryForTests,
  resetTenantClientsForTests,
  runWithTenant,
} from "../src/lib/tenant";
import { resetGovernanceStoreCacheForTests } from "../src/lib/controlPanel/governanceStore";
import { checkLicenseAndClock } from "../src/lib/licensing/guard";
import { decodeLicenseInput, verifyLicenseSignature } from "../src/lib/licensing/verifier";

import {
  GET as cpTenantsGET,
  POST as cpTenantsPOST,
} from "../src/app/api/control-panel/tenants/route";
import {
  GET as cpTenantDetailGET,
  PATCH as cpTenantPATCH,
} from "../src/app/api/control-panel/tenants/[slug]/route";
import { POST as cpRotatePOST } from "../src/app/api/control-panel/tenants/[slug]/rotate/route";
import { GET as cpDownloadGET } from "../src/app/api/control-panel/tenants/[slug]/download/route";
import { GET as cpDevicesGET } from "../src/app/api/control-panel/tenants/[slug]/devices/route";
import { PATCH as cpDevicePATCH } from "../src/app/api/control-panel/tenants/[slug]/devices/[deviceId]/route";
import { GET as cpUsersGET } from "../src/app/api/control-panel/tenants/[slug]/users/route";
import { POST as cpUserPOST } from "../src/app/api/control-panel/tenants/[slug]/users/[userId]/route";
import { GET as cpAuditGET } from "../src/app/api/control-panel/audit/route";

import { POST as verifyKeyPOST } from "../src/app/api/licensing/verify-key/route";
import { POST as loginPOST } from "../src/app/api/auth/login/route";
import { GET as usersGET } from "../src/app/api/users/route";

describe("Phase 1: UAS Platform Control Panel Governance Suite", () => {
  const createdUserIds: string[] = [];
  let tmpRootDir = "";
  let tmpDataDir = "";
  let prevDataDir: string | undefined;
  let prevDatabaseUrl: string | undefined;

  let ownerUserId = "";
  let otherSaUserId = "";
  let managerUserId = "";
  let ownerToken = "";
  let otherSaToken = "";
  let managerToken = "";
  let tenantScopedToken = "";

  const slug = `cp-test-${Date.now().toString().slice(-6)}`;
  let initialLicenseId = "";
  let initialUaskey = "";
  let rotatedLicenseId = "";
  let rotatedUaskey = "";
  let tenantAdminUserId = "";
  let tenantAdminEmail = "";
  let tenantAdminToken = "";
  const testDeviceId = "dev-cp-win-01";

  before(async () => {
    prevDataDir = process.env.UAS_DATA_DIR;
    prevDatabaseUrl = process.env.DATABASE_URL;

    tmpRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-cp-gov-"));
    tmpDataDir = path.join(tmpRootDir, "data");
    fs.mkdirSync(tmpDataDir, { recursive: true });

    process.env.UAS_DATA_DIR = tmpDataDir;
    if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith("file:")) {
      process.env.DATABASE_URL = `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
    }

    resetGovernanceStoreCacheForTests();
    await ensureSqliteDatabaseReady();

    const existingOwner = await defaultPrisma.user.findFirst({
      where: { email: "admin@qat.world" },
    });
    if (existingOwner) {
      ownerUserId = existingOwner.id;
      await defaultPrisma.user.update({
        where: { id: existingOwner.id },
        data: { active: true, isActive: true, role: "SUPER_ADMIN" },
      });
    } else {
      const created = await defaultPrisma.user.create({
        data: {
          username: `owner_${Date.now()}`,
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

    const otherSa = await defaultPrisma.user.create({
      data: {
        username: `other_sa_cp_${Date.now()}`,
        name: "Other SA",
        fullName: "Other SA",
        email: `other-sa-cp-${Date.now()}@qat.world`,
        passwordHash: hashPassword("OtherPass@2026"),
        role: "SUPER_ADMIN",
        active: true,
        isActive: true,
      },
    });
    otherSaUserId = otherSa.id;
    createdUserIds.push(otherSa.id);

    const mgr = await defaultPrisma.user.create({
      data: {
        username: `mgr_cp_${Date.now()}`,
        name: "Manager CP",
        fullName: "Manager CP",
        email: `mgr-cp-${Date.now()}@qat.world`,
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
      userDisplay: "Owner",
    });
    otherSaToken = issueSessionToken({
      userId: otherSaUserId,
      userRole: "SUPER_ADMIN",
      tenantId: "default",
      userDisplay: "OtherSA",
    });
    managerToken = issueSessionToken({
      userId: managerUserId,
      userRole: "PROJECT_MANAGER",
      tenantId: "default",
      userDisplay: "Manager",
    });
    tenantScopedToken = issueSessionToken({
      userId: ownerUserId,
      userRole: "SUPER_ADMIN",
      tenantId: slug,
      userDisplay: "TenantSA",
    });
  });

  after(async () => {
    for (const uid of createdUserIds) {
      await defaultPrisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await resetTenantClientsForTests();
    resetRegistryForTests();
    resetGovernanceStoreCacheForTests();

    if (prevDataDir === undefined) delete process.env.UAS_DATA_DIR;
    else process.env.UAS_DATA_DIR = prevDataDir;

    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;

    if (tmpRootDir && fs.existsSync(tmpRootDir)) {
      fs.rmSync(tmpRootDir, { recursive: true, force: true });
    }
  });

  it("enforces strict 401/403 authorization on control-panel routes", async () => {
    // 401 unauthenticated
    const r1 = await cpTenantsGET(
      new NextRequest("https://qat.world/api/control-panel/tenants", { headers: { host: "qat.world" } })
    );
    assert.equal(r1.status, 401);

    const rAuditUnauth = await cpAuditGET(
      new NextRequest("https://qat.world/api/control-panel/audit", { headers: { host: "qat.world" } })
    );
    assert.equal(rAuditUnauth.status, 401);

    // 403 non-owner SUPER_ADMIN
    const r2 = await cpTenantsGET(
      new NextRequest("https://qat.world/api/control-panel/tenants", {
        headers: { host: "qat.world", "x-uas-session-token": otherSaToken },
      })
    );
    assert.equal(r2.status, 403);

    // 403 PROJECT_MANAGER
    const r3 = await cpTenantsPOST(
      new NextRequest("https://qat.world/api/control-panel/tenants", {
        method: "POST",
        headers: { host: "qat.world", "content-type": "application/json", "x-uas-session-token": managerToken },
        body: JSON.stringify({ slug: "blocked-mgr", companyName: "Blocked" }),
      })
    );
    assert.equal(r3.status, 403);

    // 403 *.qat.world subdomain even with owner token
    const r4 = await cpTenantsGET(
      new NextRequest(`https://${slug}.qat.world/api/control-panel/tenants`, {
        headers: {
          host: `${slug}.qat.world`,
          "x-forwarded-host": `${slug}.qat.world`,
          "x-uas-session-token": ownerToken,
        },
      })
    );
    assert.equal(r4.status, 403);

    // 403 tenant-scoped session token
    const r5 = await cpTenantsGET(
      new NextRequest("https://qat.world/api/control-panel/tenants", {
        headers: { host: "qat.world", "x-uas-session-token": tenantScopedToken },
      })
    );
    assert.equal(r5.status, 403);
  });

  it("issues tenant license, rotates key with immediate revocation, and enforces across verify-key & guard", async () => {
    const issueRes = await cpTenantsPOST(
      new NextRequest("https://qat.world/api/control-panel/tenants", {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({
          slug,
          companyName: "مؤسسة حوكمة الاختبار",
          plan: "pro",
          expiresAt: "2027-12-31",
        }),
      })
    );
    assert.equal(issueRes.status, 201);
    const issueBody = (await issueRes.json()) as {
      success: boolean;
      license: { licenseId: string; uaskey: string; adminEmail: string };
    };
    assert.equal(issueBody.success, true);
    initialLicenseId = issueBody.license.licenseId;
    initialUaskey = issueBody.license.uaskey;
    tenantAdminEmail = issueBody.license.adminEmail;

    // Verify initial key passes online verify-key
    const v1 = await verifyKeyPOST(
      new NextRequest("https://qat.world/api/licensing/verify-key", {
        method: "POST",
        headers: { host: "qat.world", "content-type": "application/json" },
        body: JSON.stringify({
          key: initialUaskey,
          company_name: "مؤسسة حوكمة الاختبار",
          user_email: tenantAdminEmail,
          platform: "windows",
          hwid: "HWID-INIT-01",
        }),
      })
    );
    assert.equal(v1.status, 200);

    // Rotate key with immediate prior-key revocation
    const rotRes = await cpRotatePOST(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/rotate`, {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({
          plan: "enterprise",
          maxSeats: 12,
          expiresAt: "2028-06-30",
          revokePriorKeyImmediately: true,
          reason: "Security rotation test",
        }),
      }),
      { params: Promise.resolve({ slug }) }
    );
    assert.equal(rotRes.status, 200);
    const rotBody = (await rotRes.json()) as {
      success: boolean;
      priorLicenseId: string;
      license: { licenseId: string; uaskey: string };
    };
    assert.equal(rotBody.success, true);
    assert.equal(rotBody.priorLicenseId, initialLicenseId);
    assert.notEqual(rotBody.license.licenseId, initialLicenseId);
    rotatedLicenseId = rotBody.license.licenseId;
    rotatedUaskey = rotBody.license.uaskey;

    const decodedRotated = decodeLicenseInput(rotatedUaskey);
    assert.ok(decodedRotated);
    assert.equal(decodedRotated.max_users, 12);
    assert.equal(verifyLicenseSignature(decodedRotated), true);

    // Old key must now be rejected on verify-key (403 LICENSE_ROTATED_REVOKED)
    const vOld = await verifyKeyPOST(
      new NextRequest("https://qat.world/api/licensing/verify-key", {
        method: "POST",
        headers: { host: "qat.world", "content-type": "application/json" },
        body: JSON.stringify({
          key: initialUaskey,
          company_name: "مؤسسة حوكمة الاختبار",
          user_email: tenantAdminEmail,
          platform: "windows",
          hwid: "HWID-INIT-02",
        }),
      })
    );
    assert.equal(vOld.status, 403);
    const vOldBody = (await vOld.json()) as { code?: string };
    assert.equal(vOldBody.code, "LICENSE_ROTATED_REVOKED");

    // New rotated key must succeed
    const vNew = await verifyKeyPOST(
      new NextRequest("https://qat.world/api/licensing/verify-key", {
        method: "POST",
        headers: { host: "qat.world", "content-type": "application/json" },
        body: JSON.stringify({
          key: rotatedUaskey,
          company_name: "مؤسسة حوكمة الاختبار",
          user_email: tenantAdminEmail,
          platform: "windows",
          hwid: "HWID-NEW-01",
        }),
      })
    );
    assert.equal(vNew.status, 200);

    // Download route works on control-panel
    const dlRes = await cpDownloadGET(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/download?type=uas`, {
        headers: { host: "qat.world", "x-uas-session-token": ownerToken },
      }),
      { params: Promise.resolve({ slug }) }
    );
    assert.equal(dlRes.status, 200);
    const dlLic = JSON.parse(await dlRes.text()) as { license_id: string };
    assert.equal(dlLic.license_id, rotatedLicenseId);
  });

  it("suspends, reactivates, and revokes tenant with immediate online & local guard enforcement", async () => {
    // Suspend tenant
    const suspRes = await cpTenantPATCH(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}`, {
        method: "PATCH",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "suspend", reason: "Overdue invoice" }),
      }),
      { params: Promise.resolve({ slug }) }
    );
    assert.equal(suspRes.status, 200);
    const suspBody = (await suspRes.json()) as { tenant: { effectiveStatus: string } };
    assert.equal(suspBody.tenant.effectiveStatus, "suspended");

    // Verify-key rejects suspended tenant
    const vSusp = await verifyKeyPOST(
      new NextRequest("https://qat.world/api/licensing/verify-key", {
        method: "POST",
        headers: { host: "qat.world", "content-type": "application/json" },
        body: JSON.stringify({
          key: rotatedUaskey,
          company_name: "مؤسسة حوكمة الاختبار",
          user_email: tenantAdminEmail,
          platform: "windows",
          hwid: "HWID-NEW-01",
        }),
      })
    );
    assert.equal(vSusp.status, 403);

    // Local/LAN checkLicenseAndClock rejects suspended tenant
    const localGuardSusp = await runWithTenant(slug, () => checkLicenseAndClock("local"));
    assert.equal(localGuardSusp.allowed, false);
    assert.equal(localGuardSusp.status, "SUSPENDED");

    // Reactivate tenant
    const reactRes = await cpTenantPATCH(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}`, {
        method: "PATCH",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "reactivate", reason: "Payment cleared" }),
      }),
      { params: Promise.resolve({ slug }) }
    );
    assert.equal(reactRes.status, 200);

    const localGuardOk = await runWithTenant(slug, () => checkLicenseAndClock("local"));
    assert.equal(localGuardOk.allowed, true);
    assert.equal(localGuardOk.status, "ACTIVE");
  });

  it("manages registered devices (approve, suspend, revoke, reset) and tenant user session revocation & password reset", async () => {
    // Seed a TenantDevice & locate tenant admin user
    await runWithTenant(slug, async () => {
      const adminUser = await prisma.user.findFirstOrThrow({
        where: { role: "SUPER_ADMIN" },
      });
      tenantAdminUserId = adminUser.id;
      tenantAdminEmail = adminUser.email;
      tenantAdminToken = issueSessionToken({
        userId: adminUser.id,
        userRole: "SUPER_ADMIN",
        tenantId: slug,
        userDisplay: adminUser.name,
      });

      await prisma.tenantDevice.create({
        data: {
          deviceId: testDeviceId,
          tenantSlug: slug,
          platform: "android",
          appVersion: "1.2.0",
          osVersion: "Android 14",
          deviceLabel: "Field Tablet 01",
          userId: adminUser.id,
          userEmail: adminUser.email,
          userDisplay: adminUser.name,
          status: "SUSPENDED",
          ipAddress: "10.0.0.5",
        },
      });
    });

    // List devices
    const devListRes = await cpDevicesGET(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/devices`, {
        headers: { host: "qat.world", "x-uas-session-token": ownerToken },
      }),
      { params: Promise.resolve({ slug }) }
    );
    assert.equal(devListRes.status, 200);
    const devListBody = (await devListRes.json()) as {
      devices: Array<{ deviceId: string; status: string }>;
    };
    assert.ok(devListBody.devices.some((d) => d.deviceId === testDeviceId));

    // Approve device
    const approveRes = await cpDevicePATCH(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/devices/${testDeviceId}`, {
        method: "PATCH",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ slug, deviceId: testDeviceId }) }
    );
    assert.equal(approveRes.status, 200);
    const approveBody = (await approveRes.json()) as {
      devices: Array<{ deviceId: string; status: string }>;
    };
    assert.equal(approveBody.devices.find((d) => d.deviceId === testDeviceId)?.status, "ACTIVE");

    // Revoke device
    const revokeDevRes = await cpDevicePATCH(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/devices/${testDeviceId}`, {
        method: "PATCH",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "revoke", reason: "Lost tablet" }),
      }),
      { params: Promise.resolve({ slug, deviceId: testDeviceId }) }
    );
    assert.equal(revokeDevRes.status, 200);
    const revokeDevBody = (await revokeDevRes.json()) as {
      devices: Array<{ deviceId: string; status: string; pendingCommand: string | null }>;
    };
    const revokedDev = revokeDevBody.devices.find((d) => d.deviceId === testDeviceId);
    assert.equal(revokedDev?.status, "REVOKED");
    assert.equal(revokedDev?.pendingCommand, "WIPE_CREDENTIALS");

    // Reset/re-enroll device
    const resetDevRes = await cpDevicePATCH(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/devices/${testDeviceId}`, {
        method: "PATCH",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "reset" }),
      }),
      { params: Promise.resolve({ slug, deviceId: testDeviceId }) }
    );
    assert.equal(resetDevRes.status, 200);

    // List tenant users
    const usersListRes = await cpUsersGET(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/users`, {
        headers: { host: "qat.world", "x-uas-session-token": ownerToken },
      }),
      { params: Promise.resolve({ slug }) }
    );
    assert.equal(usersListRes.status, 200);

    // Confirm existing tenantAdminToken works BEFORE revocation
    const preRevokeCall = await usersGET(
      new NextRequest(`https://${slug}.qat.world/api/users`, {
        headers: {
          host: `${slug}.qat.world`,
          "x-forwarded-host": `${slug}.qat.world`,
          "x-uas-session-token": tenantAdminToken,
        },
      })
    );
    assert.equal(preRevokeCall.status, 200);

    // Revoke access & sessions for tenant admin user
    const revokeUserRes = await cpUserPOST(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/users/${tenantAdminUserId}`, {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "revoke_access", reason: "Compromised account" }),
      }),
      { params: Promise.resolve({ slug, userId: tenantAdminUserId }) }
    );
    assert.equal(revokeUserRes.status, 200);

    // Existing token is immediately rejected (401 SESSION_REVOKED)
    const postRevokeCall = await usersGET(
      new NextRequest(`https://${slug}.qat.world/api/users`, {
        headers: {
          host: `${slug}.qat.world`,
          "x-forwarded-host": `${slug}.qat.world`,
          "x-uas-session-token": tenantAdminToken,
        },
      })
    );
    assert.equal(postRevokeCall.status, 401);

    // Reactivate user & reset password
    await cpUserPOST(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/users/${tenantAdminUserId}`, {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "reactivate" }),
      }),
      { params: Promise.resolve({ slug, userId: tenantAdminUserId }) }
    );

    // Old token remains dead even after reactivation
    const oldTokenStillDead = await usersGET(
      new NextRequest(`https://${slug}.qat.world/api/users`, {
        headers: {
          host: `${slug}.qat.world`,
          "x-forwarded-host": `${slug}.qat.world`,
          "x-uas-session-token": tenantAdminToken,
        },
      })
    );
    assert.equal(oldTokenStillDead.status, 401);

    // Password reset generates temporary password and allows login
    const pwResetRes = await cpUserPOST(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}/users/${tenantAdminUserId}`, {
        method: "POST",
        headers: {
          host: "qat.world",
          "content-type": "application/json",
          "x-uas-session-token": ownerToken,
        },
        body: JSON.stringify({ action: "reset_password" }),
      }),
      { params: Promise.resolve({ slug, userId: tenantAdminUserId }) }
    );
    assert.equal(pwResetRes.status, 200);
    const pwResetBody = (await pwResetRes.json()) as {
      temporaryPassword?: string;
      user: { mustChangePassword: boolean };
    };
    assert.ok(pwResetBody.temporaryPassword && pwResetBody.temporaryPassword.length >= 10);
    assert.equal(pwResetBody.user.mustChangePassword, true);

    const newLoginRes = await loginPOST(
      new NextRequest(`https://${slug}.qat.world/api/auth/login`, {
        method: "POST",
        headers: {
          host: `${slug}.qat.world`,
          "x-forwarded-host": `${slug}.qat.world`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          identifier: tenantAdminEmail,
          password: pwResetBody.temporaryPassword,
        }),
      })
    );
    assert.equal(newLoginRes.status, 200);

    // Audit log & tenant detail view reflect operations
    const detailRes = await cpTenantDetailGET(
      new NextRequest(`https://qat.world/api/control-panel/tenants/${slug}`, {
        headers: { host: "qat.world", "x-uas-session-token": ownerToken },
      }),
      { params: Promise.resolve({ slug }) }
    );
    assert.equal(detailRes.status, 200);
    const detailBody = (await detailRes.json()) as {
      auditLogs: Array<{ actionType: string }>;
    };
    assert.ok(detailBody.auditLogs.length >= 5);
  });
});

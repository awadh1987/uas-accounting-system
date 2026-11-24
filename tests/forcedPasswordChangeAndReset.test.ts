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
  extractTenantResolutionFromRequest,
  resetRegistryForTests,
  resetTenantClientsForTests,
  runWithTenant,
} from "../src/lib/tenant";
import { resetGovernanceStoreCacheForTests } from "../src/lib/controlPanel/governanceStore";
import { safeFetchJson, sanitizeHeadersInit, sanitizeHeaderValue } from "../src/lib/apiClient";
import { handleOfflineAndroidApiRequest, type OfflineStorageLike } from "../src/lib/offlineAndroidStore";

import { POST as cpTenantsPOST } from "../src/app/api/control-panel/tenants/route";
import { POST as loginPOST } from "../src/app/api/auth/login/route";
import { GET as bootstrapGET } from "../src/app/api/bootstrap/route";
import { POST as usersPOST } from "../src/app/api/users/route";
import { POST as resetPasswordPOST } from "../src/app/api/users/[id]/reset-password/route";
import { POST as mePasswordPOST } from "../src/app/api/users/me/password/route";
import { POST as authChangePasswordPOST } from "../src/app/api/auth/change-password/route";
import { POST as projectsPOST } from "../src/app/api/projects/route";

function createMemoryStorage(): OfflineStorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe("Password Reset & Forced Password Change End-to-End", () => {
  const ts = Date.now().toString().slice(-6);
  const tenantA = `aljabri-qa-${ts}`;
  const tenantB = `other-qa-${ts}`;
  const createdRootUserIds: string[] = [];
  const createdDbNames: string[] = [];

  let tmpRootDir = "";
  let tmpDataDir = "";
  let prevDataDir: string | undefined;
  let prevDatabaseUrl: string | undefined;
  let ownerUserId = "";
  let ownerToken = "";

  before(async () => {
    prevDataDir = process.env.UAS_DATA_DIR;
    prevDatabaseUrl = process.env.DATABASE_URL;

    tmpRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-fpw-test-"));
    tmpDataDir = path.join(tmpRootDir, "data");
    fs.mkdirSync(tmpDataDir, { recursive: true });
    process.env.UAS_DATA_DIR = tmpDataDir;

    resetRegistryForTests();
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
          username: `owner_fpw_${ts}`,
          name: "مدير المنصة العام",
          fullName: "مدير المنصة العام",
          email: "admin@qat.world",
          passwordHash: hashPassword("OwnerPass@2026"),
          role: "SUPER_ADMIN",
          active: true,
          isActive: true,
        },
      });
      ownerUserId = created.id;
      createdRootUserIds.push(created.id);
    }

    ownerToken = issueSessionToken({
      userId: ownerUserId,
      userRole: "SUPER_ADMIN",
      tenantId: "default",
      userDisplay: "مدير المنصة العام (SUPER_ADMIN)",
    });

    for (const [slug, companyName] of [
      [tenantA, `شركة الجابري للاختبار ${ts}`],
      [tenantB, `شركة أخرى للاختبار ${ts}`],
    ]) {
      const res = await cpTenantsPOST(
        new NextRequest("https://qat.world/api/control-panel/tenants", {
          method: "POST",
          headers: {
            host: "qat.world",
            "content-type": "application/json",
            "x-uas-session-token": ownerToken,
          },
          body: JSON.stringify({
            slug,
            companyName,
            plan: "pro",
            expiresAt: "2027-12-31",
          }),
        })
      );
      assert.equal(res.status, 201, `Provisioning ${slug} must succeed`);
      const body = (await res.json()) as { tenant?: { postgresDb?: string } };
      if (body.tenant?.postgresDb) {
        createdDbNames.push(body.tenant.postgresDb);
      }
    }
  });

  after(async () => {
    await resetTenantClientsForTests();
    for (const dbName of createdDbNames) {
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
        await defaultPrisma
          .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`)
          .catch(() => {});
      }
    }
    for (const uid of createdRootUserIds) {
      await defaultPrisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
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

  it("sanitizes Arabic HTTP header values so safeFetchJson never crashes on non-ISO-8859-1 characters", async () => {
    const rawArabic = "مدير النظام العام (SUPER_ADMIN)";
    const sanitized = sanitizeHeaderValue(rawArabic);
    assert.equal(/[^\u0000-\u00FF]/.test(sanitized), false);
    assert.equal(decodeURIComponent(sanitized), rawArabic);

    const headers = sanitizeHeadersInit({
      "Content-Type": "application/json",
      "x-uas-user-display": rawArabic,
    });
    assert.equal(decodeURIComponent(headers.get("x-uas-user-display") || ""), rawArabic);

    let seenHeader: string | null = null;
    const mockFetch: typeof fetch = async (_input, init) => {
      seenHeader = new Headers(init?.headers).get("x-uas-user-display");
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const res = await safeFetchJson<{ success?: boolean }>(
      "/api/users/u2/reset-password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-uas-user-display": rawArabic,
        },
        body: JSON.stringify({ newPassword: "TempPass@123" }),
      },
      mockFetch
    );
    assert.equal(res.ok, true);
    assert.equal(res.data?.success, true);
    assert.equal(decodeURIComponent(seenHeader || ""), rawArabic);
  });

  it("resolves aljabri.qat.world subdomain deterministically and isolates password resets per tenant", async () => {
    const resolution = extractTenantResolutionFromRequest(
      new NextRequest("https://aljabri.qat.world/api/users/u2/reset-password", {
        headers: { host: "aljabri.qat.world", "x-forwarded-host": "aljabri.qat.world" },
      })
    );
    assert.equal(resolution.tenantId, "aljabri");
    assert.equal(resolution.slug, "aljabri");
    assert.equal(resolution.source, "subdomain");

    const createUserInTenant = async (slug: string, email: string, name: string) => {
      return runWithTenant(slug, async () => {
        const admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
        assert.ok(admin);
        const token = issueSessionToken({
          userId: admin.id,
          userRole: "SUPER_ADMIN",
          tenantId: slug,
          userDisplay: `${admin.name} (SUPER_ADMIN)`,
        });
        const createRes = await usersPOST(
          new NextRequest(`https://${slug}.qat.world/api/users`, {
            method: "POST",
            headers: {
              host: `${slug}.qat.world`,
              "x-forwarded-host": `${slug}.qat.world`,
              "content-type": "application/json",
              "x-uas-session-token": token,
              "x-uas-user-display": sanitizeHeaderValue(`${admin.name} (SUPER_ADMIN)`),
            },
            body: JSON.stringify({
              name,
              email,
              role: "SALES_COLLECTOR",
              password: "InitialUser@123",
            }),
          })
        );
        assert.equal(createRes.status, 201);
        const created = await prisma.user.findFirst({ where: { email } });
        assert.ok(created);
        return { adminId: admin.id, adminToken: token, userId: created.id };
      });
    };

    const userA = await createUserInTenant(tenantA, `walid@${tenantA}.qat.world`, "وليد الجابري");
    const userB = await createUserInTenant(tenantB, `salem@${tenantB}.qat.world`, "سالم الآخر");

    // Pre-existing session token for userA before reset
    const preResetTokenA = issueSessionToken({
      userId: userA.userId,
      userRole: "SALES_COLLECTOR",
      tenantId: tenantA,
      userDisplay: "وليد الجابري (SALES_COLLECTOR)",
    });

    // Reset password in tenantA with mustChangePassword: true and encoded Arabic header
    const resetResA = await resetPasswordPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/users/${userA.userId}/reset-password`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
          "x-uas-session-token": userA.adminToken,
          "x-uas-user-id": userA.adminId,
          "x-uas-role": "SUPER_ADMIN",
          "x-uas-user-display": sanitizeHeaderValue("مدير النظام العام (SUPER_ADMIN)"),
        },
        body: JSON.stringify({
          newPassword: "TempPass#2026",
          mustChangePassword: true,
          targetUserId: userA.userId,
          targetUserEmail: `walid@${tenantA}.qat.world`,
        }),
      }),
      { params: Promise.resolve({ id: userA.userId }) }
    );
    assert.equal(resetResA.status, 200);
    const resetBodyA = (await resetResA.json()) as {
      success: boolean;
      mustChangePassword: boolean;
      user: { id: string; mustChangePassword: boolean };
    };
    assert.equal(resetBodyA.success, true);
    assert.equal(resetBodyA.mustChangePassword, true);
    assert.equal(resetBodyA.user.mustChangePassword, true);

    // Confirm tenantB user was NOT affected (tenant isolation)
    await runWithTenant(tenantB, async () => {
      const bRow = await prisma.user.findUnique({ where: { id: userB.userId } });
      assert.equal(bRow?.mustChangePassword, false);
    });

    // Confirm tenantA user's pre-reset token is now invalidated (401 SESSION_REVOKED)
    const oldSessionCheck = await projectsPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/projects`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
          "x-uas-session-token": preResetTokenA,
        },
        body: JSON.stringify({ name: "ShouldFailRevoked" }),
      })
    );
    assert.equal(oldSessionCheck.status, 401);

    // Reset userB with mustChangePassword: false and verify flag persisted as false
    const resetResB = await resetPasswordPOST(
      new NextRequest(`https://${tenantB}.qat.world/api/users/${userB.userId}/reset-password`, {
        method: "POST",
        headers: {
          host: `${tenantB}.qat.world`,
          "x-forwarded-host": `${tenantB}.qat.world`,
          "content-type": "application/json",
          "x-uas-session-token": userB.adminToken,
        },
        body: JSON.stringify({
          newPassword: "DirectPass#2026",
          mustChangePassword: false,
        }),
      }),
      { params: Promise.resolve({ id: userB.userId }) }
    );
    assert.equal(resetResB.status, 200);
    const resetBodyB = (await resetResB.json()) as { mustChangePassword: boolean };
    assert.equal(resetBodyB.mustChangePassword, false);

    // Login as userA using temporary password -> mustChangePassword: true
    const loginResA = await loginPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/auth/login`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          identifier: `walid@${tenantA}.qat.world`,
          password: "TempPass#2026",
        }),
      })
    );
    assert.equal(loginResA.status, 200);
    const loginBodyA = (await loginResA.json()) as {
      mustChangePassword: boolean;
      sessionToken: string;
      user: { mustChangePassword: boolean };
    };
    assert.equal(loginBodyA.mustChangePassword, true);
    assert.equal(loginBodyA.user.mustChangePassword, true);
    assert.ok(loginBodyA.sessionToken);

    // Bootstrap with userA's token reports mustChangePassword: true
    const bootRes1 = await bootstrapGET(
      new NextRequest(`https://${tenantA}.qat.world/api/bootstrap`, {
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "x-uas-session-token": loginBodyA.sessionToken,
        },
      })
    );
    assert.equal(bootRes1.status, 200);
    const bootBody1 = (await bootRes1.json()) as {
      mustChangePassword?: boolean;
      sessionUser?: { mustChangePassword?: boolean };
    };
    assert.equal(bootBody1.mustChangePassword, true);
    assert.equal(bootBody1.sessionUser?.mustChangePassword, true);

    // Normal workspace mutations are BLOCKED while mustChangePassword === true
    const blockedMutation = await projectsPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/projects`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
          "x-uas-session-token": loginBodyA.sessionToken,
        },
        body: JSON.stringify({ name: "BlockedUntilPasswordChange" }),
      })
    );
    assert.equal(blockedMutation.status, 403);
    const blockedJson = (await blockedMutation.json()) as { code?: string; mustChangePassword?: boolean };
    assert.equal(blockedJson.code, "MUST_CHANGE_PASSWORD");
    assert.equal(blockedJson.mustChangePassword, true);

    // Reusing the same temporary password via /api/users/me/password is rejected
    const samePassRes = await mePasswordPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/users/me/password`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
          "x-uas-session-token": loginBodyA.sessionToken,
        },
        body: JSON.stringify({
          currentPassword: "TempPass#2026",
          newPassword: "TempPass#2026",
          confirmPassword: "TempPass#2026",
        }),
      })
    );
    assert.equal(samePassRes.status, 400);

    // Wrong current password via /api/auth/change-password is rejected
    const wrongCurrRes = await authChangePasswordPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/auth/change-password`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
          "x-uas-session-token": loginBodyA.sessionToken,
        },
        body: JSON.stringify({
          currentPassword: "WrongPassword",
          newPassword: "FinalUserPass@2026",
          confirmPassword: "FinalUserPass@2026",
        }),
      })
    );
    assert.equal(wrongCurrRes.status, 400);

    // Valid password change clears mustChangePassword and refreshes session
    const changeRes = await mePasswordPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/users/me/password`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
          "x-uas-session-token": loginBodyA.sessionToken,
        },
        body: JSON.stringify({
          currentPassword: "TempPass#2026",
          newPassword: "FinalUserPass@2026",
          confirmPassword: "FinalUserPass@2026",
        }),
      })
    );
    assert.equal(changeRes.status, 200);
    const changeBody = (await changeRes.json()) as {
      success: boolean;
      mustChangePassword: boolean;
      sessionToken: string;
      user: { mustChangePassword: boolean };
    };
    assert.equal(changeBody.success, true);
    assert.equal(changeBody.mustChangePassword, false);
    assert.equal(changeBody.user.mustChangePassword, false);
    assert.ok(changeBody.sessionToken);

    // Bootstrap and login now report mustChangePassword: false
    const bootRes2 = await bootstrapGET(
      new NextRequest(`https://${tenantA}.qat.world/api/bootstrap`, {
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "x-uas-session-token": changeBody.sessionToken,
        },
      })
    );
    assert.equal(bootRes2.status, 200);
    const bootBody2 = (await bootRes2.json()) as {
      mustChangePassword?: boolean;
      sessionUser?: { mustChangePassword?: boolean };
    };
    assert.equal(bootBody2.mustChangePassword, false);
    assert.equal(bootBody2.sessionUser?.mustChangePassword, false);

    const loginResAfter = await loginPOST(
      new NextRequest(`https://${tenantA}.qat.world/api/auth/login`, {
        method: "POST",
        headers: {
          host: `${tenantA}.qat.world`,
          "x-forwarded-host": `${tenantA}.qat.world`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          identifier: `walid@${tenantA}.qat.world`,
          password: "FinalUserPass@2026",
        }),
      })
    );
    assert.equal(loginResAfter.status, 200);
    const loginBodyAfter = (await loginResAfter.json()) as { mustChangePassword: boolean };
    assert.equal(loginBodyAfter.mustChangePassword, false);
  });

  it("enforces password reset and mandatory password change in offlineAndroidStore", async () => {
    const storage = createMemoryStorage();

    // 1. Add a second user in offline store
    const addRes = await handleOfflineAndroidApiRequest(
      "/api/users",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "محاسب ميداني",
          email: "field@aljabri.local",
          role: "FIELD_ACCOUNTANT",
          password: "FieldInit@123",
          actor: { userId: "u1", userDisplay: "مدير النظام العام", userRole: "SUPER_ADMIN" },
        }),
      },
      storage
    );
    assert.equal(addRes.status, 201);
    const addJson = (await addRes.json()) as { user: { id: string } };
    const fieldId = addJson.user.id;

    // 2. Admin resets password with mustChangePassword: true
    const resetRes = await handleOfflineAndroidApiRequest(
      `/api/users/${encodeURIComponent(fieldId)}/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPassword: "TempField@999",
          mustChangePassword: true,
          actor: { userId: "u1", userDisplay: "مدير النظام العام", userRole: "SUPER_ADMIN" },
        }),
      },
      storage
    );
    assert.equal(resetRes.status, 200);
    const resetJson = (await resetRes.json()) as { mustChangePassword: boolean; user: { mustChangePassword: boolean } };
    assert.equal(resetJson.mustChangePassword, true);
    assert.equal(resetJson.user.mustChangePassword, true);

    // 3. Login returns mustChangePassword: true
    const loginRes = await handleOfflineAndroidApiRequest(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: "field@aljabri.local",
          password: "TempField@999",
        }),
      },
      storage
    );
    assert.equal(loginRes.status, 200);
    const loginJson = (await loginRes.json()) as { mustChangePassword: boolean; user: { mustChangePassword: boolean } };
    assert.equal(loginJson.mustChangePassword, true);
    assert.equal(loginJson.user.mustChangePassword, true);

    // 4. Offline mutations are blocked while mustChangePassword === true
    const blockedOffline = await handleOfflineAndroidApiRequest(
      "/api/expenses",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-uas-user-id": fieldId },
        body: JSON.stringify({
          projectId: "p1",
          category: "وقود/محروقات",
          qty: 1,
          unitPrice: 1000,
          actor: { userId: fieldId, userDisplay: "محاسب ميداني", userRole: "FIELD_ACCOUNTANT" },
        }),
      },
      storage
    );
    assert.equal(blockedOffline.status, 403);
    const blockedJson = (await blockedOffline.json()) as { code?: string };
    assert.equal(blockedJson.code, "MUST_CHANGE_PASSWORD");

    // 5. User changes password via /api/users/me/password -> clears flag & unlocks offline mutations
    const changeRes = await handleOfflineAndroidApiRequest(
      "/api/users/me/password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-uas-user-id": fieldId },
        body: JSON.stringify({
          currentPassword: "TempField@999",
          newPassword: "NewField@2026",
          confirmPassword: "NewField@2026",
          actor: { userId: fieldId, userDisplay: "محاسب ميداني", userRole: "FIELD_ACCOUNTANT" },
        }),
      },
      storage
    );
    assert.equal(changeRes.status, 200);
    const changeJson = (await changeRes.json()) as { mustChangePassword: boolean; user: { mustChangePassword: boolean } };
    assert.equal(changeJson.mustChangePassword, false);
    assert.equal(changeJson.user.mustChangePassword, false);

    // 6. Login after password change reports mustChangePassword: false
    const loginAfter = await handleOfflineAndroidApiRequest(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: "field@aljabri.local",
          password: "NewField@2026",
        }),
      },
      storage
    );
    assert.equal(loginAfter.status, 200);
    const loginAfterJson = (await loginAfter.json()) as { mustChangePassword: boolean };
    assert.equal(loginAfterJson.mustChangePassword, false);
  });
});

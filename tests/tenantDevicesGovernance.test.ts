import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { issueSessionToken, verifySessionToken } from "../src/lib/authSession";
import { resolveVerifiedActor, authorizeApiAction } from "../src/lib/apiHelpers";
import {
  clearDeviceSessionRevocation,
  isDeviceSessionRevoked,
  recordDeviceSessionRevocation,
  resetGovernanceStoreCacheForTests,
} from "../src/lib/controlPanel/governanceStore";
import { detectClientDevicePlatform } from "../src/lib/apiClient";
import {
  listTenantDevices,
  maskActivationKey,
  registerOrHeartbeatDevice,
  removeTenantDevice,
  sanitizeActivationKey,
  updateDeviceGovernance,
} from "../src/lib/devices/deviceService";
import { defaultPrisma, prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/serverBootstrap";
import { pullChangesSince } from "../src/lib/sync/syncEngine";
import {
  ensureTenantRegistered,
  isPostgresRuntime,
  resetRegistryForTests,
  resetTenantClientsForTests,
  runWithTenant,
} from "../src/lib/tenant";
import {
  hasLicensePrivateKey,
  signLicensePayload,
} from "../src/lib/licensing/licenseSigner";
import { saveInstalledLicense } from "../src/lib/licensing/verifier";
import { PATCH as devicePATCH } from "../src/app/api/devices/[deviceId]/route";
import { GET as devicesGET } from "../src/app/api/devices/route";
import { POST as loginPOST } from "../src/app/api/auth/login/route";

const TS = Date.now().toString().slice(-6);
const TENANT_A = `devgov-a-${TS}`;
const TENANT_B = `devgov-b-${TS}`;

const ACTOR = {
  userId: "u-admin-1",
  userDisplay: "مدير المنشأة (SUPER_ADMIN)",
  userRole: "SUPER_ADMIN",
};

function makeFakeUaskey(licenseId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      license_id: licenseId,
      company_name: "Test Tenant Co",
      expires_at: "2027-01-01T00:00:00Z",
    }),
    "utf8"
  ).toString("base64url");
  return `UASKEY-${payload}.fake-secret-signature-0123456789abcdef`;
}

describe("Phase 2: Tenant Devices Control Plane & Per-Device Sync Governance", () => {
  let tmpDataDir = "";
  let prevDataDir: string | undefined;

  before(() => {
    prevDataDir = process.env.UAS_DATA_DIR;
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-devgov-"));
    process.env.UAS_DATA_DIR = tmpDataDir;
    resetGovernanceStoreCacheForTests();
    resetRegistryForTests();

    ensureTenantRegistered(TENANT_A, "شركة الجبري التجريبية", {
      slug: TENANT_A,
      nameAr: "شركة الجبري التجريبية",
      licenseId: "UAS-2026-4894",
    });
    ensureTenantRegistered(TENANT_B, "شركة العامري التجريبية", {
      slug: TENANT_B,
      nameAr: "شركة العامري التجريبية",
      licenseId: "UAS-2026-6600",
    });
  });

  after(async () => {
    await resetTenantClientsForTests();
    if (isPostgresRuntime()) {
      for (const slug of [TENANT_A, TENANT_B]) {
        const schema = `tenant_${slug.replace(/-/g, "_")}`;
        if (/^tenant_devgov_[ab]_[0-9]+$/.test(schema)) {
          await defaultPrisma
            .$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            .catch(() => undefined);
        }
      }
    }
    if (tmpDataDir && fs.existsSync(tmpDataDir)) {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
    if (prevDataDir === undefined) {
      delete process.env.UAS_DATA_DIR;
    } else {
      process.env.UAS_DATA_DIR = prevDataDir;
    }
    resetGovernanceStoreCacheForTests();
    resetRegistryForTests();
  });

  it("sanitizes & masks activation keys without leaking raw UASKEY secrets and detects iOS/Android/Windows/Web", () => {
    const rawUaskey = makeFakeUaskey("UAS-2026-4894");
    assert.equal(sanitizeActivationKey(rawUaskey), "UAS-2026-4894");
    assert.equal(sanitizeActivationKey("  uas-2026-4894  "), "UAS-2026-4894");
    assert.equal(sanitizeActivationKey("x".repeat(90)), null);
    assert.equal(maskActivationKey(rawUaskey), "UAS-••••-4894");
    assert.equal(maskActivationKey("UAS-2026-6600"), "UAS-••••-6600");

    assert.equal(
      detectClientDevicePlatform({
        Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
      }),
      "ios"
    );
    assert.equal(
      detectClientDevicePlatform({
        Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
      }),
      "android"
    );
    assert.equal(
      detectClientDevicePlatform({
        navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) UAS-Desktop" },
      }),
      "windows"
    );
    assert.equal(
      detectClientDevicePlatform({
        navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
      }),
      "web"
    );
  });

  it("binds deviceId in session tokens and invalidates prior device tokens upon revocation", () => {
    const t0 = Date.now() - 5000;
    const oldToken = issueSessionToken({
      userId: "u1",
      userRole: "ACCOUNTANT",
      tenantId: TENANT_A,
      userDisplay: "محاسب (ACCOUNTANT)",
      deviceId: "dev-tok-01",
      nowMs: t0,
    });
    const verifiedOld = verifySessionToken(oldToken);
    assert.ok(verifiedOld);
    assert.equal(verifiedOld.did, "dev-tok-01");

    recordDeviceSessionRevocation(TENANT_A, "dev-tok-01", {
      revokedBeforeMs: t0 + 1000,
      reason: "Revoked test",
      updatedBy: ACTOR.userDisplay,
    });
    assert.equal(isDeviceSessionRevoked(TENANT_A, "dev-tok-01", verifiedOld.iat), true);

    const freshToken = issueSessionToken({
      userId: "u1",
      userRole: "ACCOUNTANT",
      tenantId: TENANT_A,
      userDisplay: "محاسب (ACCOUNTANT)",
      deviceId: "dev-tok-01",
      nowMs: t0 + 3000,
    });
    const verifiedFresh = verifySessionToken(freshToken);
    assert.ok(verifiedFresh);
    assert.equal(isDeviceSessionRevoked(TENANT_A, "dev-tok-01", verifiedFresh.iat), false);

    clearDeviceSessionRevocation(TENANT_A, "dev-tok-01");
    assert.equal(isDeviceSessionRevoked(TENANT_A, "dev-tok-01", verifiedOld.iat), false);
  });

  it("persists tenant & key metadata, enforces tenant isolation, frees seats & invalidates sync/auth on REVOKE", async () => {
    if (hasLicensePrivateKey()) {
      const signed = signLicensePayload({
        license_id: "UAS-2026-4894",
        customer_name: "شركة الجبري التجريبية",
        company_name: "شركة الجبري التجريبية",
        hwid: "*",
        allowed_modes: ["local", "lan", "cloud"],
        max_branches: 5,
        max_lan_seats: 10,
        max_users: 10,
        issued_at: new Date().toISOString(),
        expires_at: "2027-12-31T23:59:59.000Z",
      });
      saveInstalledLicense(signed, TENANT_A);
    }

    await runWithTenant(TENANT_A, async () => {
      await prisma.user.create({
        data: {
          id: "u-admin-1",
          username: "tenant_a_admin",
          name: "أحمد الجبري",
          fullName: "أحمد الجبري",
          email: "acct@aljabri.ye",
          passwordHash: hashPassword("Pass@2026"),
          role: "SUPER_ADMIN",
          active: true,
          isActive: true,
        },
      });

      await prisma.licenseDeviceBinding.create({
        data: {
          licenseId: "UAS-2026-4894",
          userEmail: "acct@aljabri.ye",
          platform: "windows",
          hwid: "win-alpha-01",
          deviceName: "Workstation 01",
          active: true,
        },
      });

      const { device: winDev } = await registerOrHeartbeatDevice({
        deviceId: "win-alpha-01",
        platform: "windows",
        appVersion: "2.4.0",
        osVersion: "Windows 11",
        deviceLabel: "جهاز المحاسب الرئيسي",
        activationKey: makeFakeUaskey("UAS-2026-4894"),
        userId: "u-admin-1",
        userEmail: "acct@aljabri.ye",
        userDisplay: "أحمد الجبري",
        ipAddress: "192.168.1.50",
        pendingQueueCount: 4,
      });

      assert.equal(winDev.tenantSlug, TENANT_A);
      assert.equal(winDev.tenantName, "شركة الجبري التجريبية");
      assert.equal(winDev.activationKey, "UAS-2026-4894");
      assert.equal(winDev.maskedActivationKey, "UAS-••••-4894");
      assert.equal(winDev.clientPlatform, "windows");
      assert.equal(winDev.queueCount, 4);
      assert.equal(winDev.syncPolicy, "AUTO");
      assert.equal(winDev.keyMismatch, false);
      assert.equal(winDev.tenantMismatch, false);

      const { device: staleKeyDev } = await registerOrHeartbeatDevice({
        deviceId: "ios-stale-02",
        platform: "ios",
        appVersion: "2.3.9",
        deviceLabel: "iPad المدير",
        activationKey: "UAS-2024-9999",
        userId: "u-admin-1",
        userEmail: "ipad@aljabri.ye",
        userDisplay: "iPad Manager",
      });
      assert.equal(staleKeyDev.clientPlatform, "ios");
      assert.equal(staleKeyDev.keyMismatch, true);

      // Seed a rogue cross-tenant row to verify server-side filter & guard even in shared DB tables
      await prisma.tenantDevice.create({
        data: {
          deviceId: "rogue-beta-99",
          tenantSlug: TENANT_B,
          activationKey: "UAS-2026-6600",
          platform: "android",
          deviceLabel: "Rogue Cross Tenant",
        },
      });

      const listRes = await listTenantDevices();
      assert.equal(listRes.activeTenantSlug, TENANT_A);
      assert.equal(listRes.workspaceLicenseKey, "UAS-2026-4894");
      assert.ok(listRes.devices.some((d) => d.deviceId === "win-alpha-01" && d.seatBound === true));
      assert.ok(listRes.devices.some((d) => d.deviceId === "ios-stale-02" && d.keyMismatch === true));
      assert.equal(
        listRes.devices.some((d) => d.deviceId === "rogue-beta-99"),
        false,
        "Cross-tenant devices must never be listed for Tenant A"
      );

      await assert.rejects(
        () =>
          updateDeviceGovernance({
            deviceId: "rogue-beta-99",
            action: "SUSPEND",
            actor: ACTOR,
          }),
        /FORBIDDEN_CROSS_TENANT/
      );

      const crossToken = issueSessionToken({
        userId: "u-admin-1",
        userRole: "SUPER_ADMIN",
        tenantId: TENANT_A,
        userDisplay: ACTOR.userDisplay,
        deviceId: "win-alpha-01",
      });

      const listHttpReq = new NextRequest(`https://${TENANT_A}.qat.world/api/devices`, {
        method: "GET",
        headers: {
          "x-uas-tenant-id": TENANT_A,
          "x-uas-session-token": crossToken,
        },
      });
      const listHttpRes = await devicesGET(listHttpReq);
      assert.equal(listHttpRes.status, 200);
      const listHttpJson = (await listHttpRes.json()) as {
        activeTenantSlug?: string;
        devices?: Array<{ deviceId: string }>;
      };
      assert.equal(listHttpJson.activeTenantSlug, TENANT_A);
      assert.equal(
        Boolean(listHttpJson.devices?.some((d) => d.deviceId === "rogue-beta-99")),
        false
      );

      if (hasLicensePrivateKey()) {
        const crossReq = new NextRequest(`https://${TENANT_A}.qat.world/api/devices/rogue-beta-99`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-uas-tenant-id": TENANT_A,
            "x-uas-session-token": crossToken,
          },
          body: JSON.stringify({ action: "SUSPEND" }),
        });
        const crossPatchRes = await devicePATCH(crossReq, {
          params: Promise.resolve({ deviceId: "rogue-beta-99" }),
        });
        assert.equal(crossPatchRes.status, 403);
      }

      // Interactive sync policy update
      const manualPolicy = await updateDeviceGovernance({
        deviceId: "win-alpha-01",
        action: "SET_SYNC_POLICY",
        syncMode: "MANUAL",
        actor: ACTOR,
      });
      assert.equal(manualPolicy.syncMode, "MANUAL");
      assert.equal(manualPolicy.syncPolicy, "MANUAL");

      // Revoke -> invalidates session/sync token & frees LicenseDeviceBinding seat
      const preRevokeToken = issueSessionToken({
        userId: "u-admin-1",
        userRole: "SUPER_ADMIN",
        tenantId: TENANT_A,
        userDisplay: ACTOR.userDisplay,
        deviceId: "win-alpha-01",
      });

      const revoked = await updateDeviceGovernance({
        deviceId: "win-alpha-01",
        action: "REVOKE",
        reason: "Employee device replaced",
        actor: ACTOR,
      });
      assert.equal(revoked.status, "REVOKED");
      assert.equal(revoked.pendingCommand, "WIPE_CREDENTIALS");

      const remainingSeats = await prisma.licenseDeviceBinding.count({
        where: { licenseId: "UAS-2026-4894", active: true },
      });
      assert.equal(remainingSeats, 0, "REVOKE must deactivate matching active seat binding");

      const blockedPull = await pullChangesSince({ sinceCursor: 0, deviceId: "win-alpha-01" });
      assert.equal(blockedPull.blocked, true);
      assert.equal(blockedPull.status, 403);
      assert.equal(blockedPull.code, "DEVICE_REVOKED");

      const apiReq = new NextRequest(`https://${TENANT_A}.qat.world/api/projects`, {
        method: "GET",
        headers: {
          "x-uas-tenant-id": TENANT_A,
          "x-uas-device-id": "win-alpha-01",
          "x-uas-session-token": preRevokeToken,
        },
      });
      const actorCheck = await resolveVerifiedActor({}, apiReq);
      assert.equal(actorCheck.authenticated, false);
      assert.equal(actorCheck.deviceRevoked, true);

      const authRes = await authorizeApiAction({}, apiReq, {});
      assert.equal(authRes.ok, false);
      if (!authRes.ok) {
        assert.equal(authRes.response.status, 403);
        const body = (await authRes.response.json()) as { code?: string; clearCredentials?: boolean };
        assert.equal(body.code, "DEVICE_REVOKED");
        assert.equal(body.clearCredentials, true);
      }

      const revokedLoginReq = new NextRequest(`https://${TENANT_A}.qat.world/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: `${TENANT_A}.qat.world`,
          "x-uas-tenant-id": TENANT_A,
          "x-uas-device-id": "win-alpha-01",
        },
        body: JSON.stringify({
          identifier: "acct@aljabri.ye",
          password: "Pass@2026",
        }),
      });
      const loginRes = await loginPOST(revokedLoginReq);
      assert.equal(loginRes.status, 403);
      const loginJson = (await loginRes.json()) as { code?: string };
      assert.equal(loginJson.code, "DEVICE_REVOKED");

      // Re-approve -> clears revocation and delete removes cleanly
      const approved = await updateDeviceGovernance({
        deviceId: "win-alpha-01",
        action: "APPROVE",
        actor: ACTOR,
      });
      assert.equal(approved.status, "ACTIVE");

      const deleted = await removeTenantDevice("ios-stale-02", ACTOR);
      assert.equal(deleted, true);
    });
  });
});

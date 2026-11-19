import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  DEFAULT_CLOUD_API_URL,
  getStoredRuntimeMode,
  isNativeAndroid,
  resolveApiBaseUrl,
  safeFetchJson,
  setStoredRuntimeMode,
  type StorageLike,
} from "../src/lib/apiClient";
import {
  activateOfflineClientLicense,
  activateOnlineKeyOnClient,
  buildOfflineClientLicenseStatus,
  canonicalizeLicensePayload,
  createMemoryStorage,
  type UasSignedLicense,
} from "../src/lib/licensing";

function createTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyObj: privateKey,
  };
}

function signTestLicense(
  privateKey: crypto.KeyObject,
  overrides: Partial<Omit<UasSignedLicense, "signature">> = {}
): UasSignedLicense {
  const base: Omit<UasSignedLicense, "signature"> = {
    license_id: "UAS-LIC-ANDROID-001",
    customer_name: "شركة العمري للتجارة",
    company_name: "شركة العمري للتجارة",
    hwid: "*",
    allowed_modes: ["local", "lan", "cloud"],
    max_branches: 5,
    max_lan_seats: 10,
    max_users: 7,
    per_user_devices: { windows: 1, android: 1 },
    issued_at: new Date(Date.now() - 86_400_000).toISOString(),
    expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    ...overrides,
  };
  const canonical = canonicalizeLicensePayload(base);
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
  return { ...base, signature: sig };
}

function createFullMemoryStorage(): StorageLike {
  const mem = createMemoryStorage();
  return {
    getItem: (k) => mem.getItem(k),
    setItem: (k, v) => mem.setItem(k, v),
    removeItem: (k) => mem.removeItem?.(k),
  };
}

const ANDROID_CAPACITOR_WIN = {
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
  location: {
    protocol: "https:",
    hostname: "localhost",
    origin: "https://localhost",
  },
  navigator: {
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  },
};

describe("Android APK Licensing Activation, Mode Switching & Safe JSON Parsing", () => {
  it("safeFetchJson catches Capacitor <!DOCTYPE html> 200 OK fallback without throwing SyntaxError", async () => {
    const fakeFetch = (async () =>
      new Response("<!DOCTYPE html><html><body>SPA Shell</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;

    const result = await safeFetchJson("/api/licensing/activate", { method: "POST" }, fakeFetch);
    assert.equal(result.ok, false);
    assert.equal(result.isHtmlFallback, true);
    assert.equal(result.data, null);
    assert.equal(result.error, "STATIC_HTML_FALLBACK");
  });

  it("allows unauthenticated Cloud & LAN mode switching while UNLICENSED and never snaps back to local", async () => {
    const storage = createFullMemoryStorage();

    // Verify Android detection
    assert.equal(isNativeAndroid(ANDROID_CAPACITOR_WIN), true);

    // Initially UNLICENSED and local
    const initialStatus = await buildOfflineClientLicenseStatus({ storage });
    assert.equal(initialStatus.license_status, "UNLICENSED");
    assert.equal(initialStatus.active_mode, "local");
    assert.deepEqual(initialStatus.allowed_modes, ["local", "lan", "cloud"]);

    // Switch to Cloud while UNLICENSED -> defaults to https://qat.world
    const cloudSwitch = setStoredRuntimeMode("cloud", undefined, storage);
    assert.equal(cloudSwitch.mode, "cloud");
    assert.equal(cloudSwitch.serverUrl, DEFAULT_CLOUD_API_URL);
    assert.equal(getStoredRuntimeMode(storage), "cloud");
    assert.equal(
      resolveApiBaseUrl({ storage, win: ANDROID_CAPACITOR_WIN }),
      "https://qat.world"
    );

    const cloudStatus = await buildOfflineClientLicenseStatus({ storage });
    assert.equal(cloudStatus.active_mode, "cloud");
    assert.equal(cloudStatus.cloud_url, "https://qat.world");

    // Switch to LAN with custom office IP while UNLICENSED
    const lanSwitch = setStoredRuntimeMode("lan", "http://192.168.1.50:3000/", storage);
    assert.equal(lanSwitch.mode, "lan");
    assert.equal(lanSwitch.serverUrl, "http://192.168.1.50:3000");
    assert.equal(
      resolveApiBaseUrl({ storage, win: ANDROID_CAPACITOR_WIN }),
      "http://192.168.1.50:3000"
    );

    const lanStatus = await buildOfflineClientLicenseStatus({ storage });
    assert.equal(lanStatus.active_mode, "lan");
    assert.equal(lanStatus.lan_url, "http://192.168.1.50:3000");

    // Switch back to Local, verify preferCloudFallback still resolves https://qat.world on Android https://localhost
    setStoredRuntimeMode("local", "", storage);
    assert.equal(resolveApiBaseUrl({ storage, win: ANDROID_CAPACITOR_WIN }), "");
    assert.equal(
      resolveApiBaseUrl({ preferCloudFallback: true, storage, win: ANDROID_CAPACITOR_WIN }),
      "https://qat.world"
    );
  });

  it("activates offline .uas file on Android client-side via WebCrypto and transitions UNLICENSED -> ACTIVE", async () => {
    const { publicKeyPem, privateKeyObj } = createTestKeyPair();
    const license = signTestLicense(privateKeyObj);
    const storage = createFullMemoryStorage();

    const res = await activateOfflineClientLicense(
      {
        licenseFileContent: JSON.stringify(license),
        confirmCompanyName: "شركة العمري للتجارة",
        userEmail: "admin@alamri.com",
        platform: "android",
      },
      { storage, publicKeyPem }
    );

    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.license.license_id, "UAS-LIC-ANDROID-001");
      assert.equal(res.seat?.platform, "android");
    }

    const statusAfter = await buildOfflineClientLicenseStatus({ storage, publicKeyPem });
    assert.equal(statusAfter.license_status, "ACTIVE");
    assert.equal(statusAfter.is_valid, true);
    assert.equal(statusAfter.company_name, "شركة العمري للتجارة");
    assert.equal(statusAfter.seats?.android_bound, 1);
  });

  it("activates online UASKEY-... on Android against https://qat.world/api/licensing/verify-key and persists locally", async () => {
    const { publicKeyPem, privateKeyObj } = createTestKeyPair();
    const license = signTestLicense(privateKeyObj);
    const keyToken = `UASKEY-${Buffer.from(JSON.stringify(license), "utf8").toString("base64")}`;
    const storage = createFullMemoryStorage();

    let requestedUrl = "";
    const mockFetch = (async (url: string) => {
      requestedUrl = url;
      return new Response(
        JSON.stringify({
          success: true,
          license,
          company_name: license.company_name,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }) as unknown as typeof fetch;

    const res = await activateOnlineKeyOnClient(
      {
        activationKey: keyToken,
        confirmCompanyName: "شركة العمري للتجارة",
        userEmail: "field@alamri.com",
        platform: "android",
      },
      { storage, publicKeyPem, fetchImpl: mockFetch }
    );

    assert.equal(requestedUrl, "https://qat.world/api/licensing/verify-key");
    assert.equal(res.success, true);
    assert.equal(res.verifiedOnline, true);

    const statusAfter = await buildOfflineClientLicenseStatus({ storage, publicKeyPem });
    assert.equal(statusAfter.license_status, "ACTIVE");
    assert.equal(statusAfter.is_valid, true);
    assert.equal(statusAfter.seats?.used_users, 1);
    assert.equal(statusAfter.seats?.android_bound, 1);
  });

  it("falls back cleanly to offline WebCrypto verification if https://qat.world is unreachable during UASKEY-... activation", async () => {
    const { publicKeyPem, privateKeyObj } = createTestKeyPair();
    const license = signTestLicense(privateKeyObj);
    const keyToken = `UASKEY-${Buffer.from(JSON.stringify(license), "utf8").toString("base64")}`;
    const storage = createFullMemoryStorage();

    const offlineFetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const res = await activateOnlineKeyOnClient(
      {
        activationKey: keyToken,
        confirmCompanyName: "شركة العمري للتجارة",
        userEmail: "offline@alamri.com",
        platform: "android",
      },
      { storage, publicKeyPem, fetchImpl: offlineFetch }
    );

    assert.equal(res.success, true);
    assert.equal(res.verifiedOnline, false);
    const statusAfter = await buildOfflineClientLicenseStatus({ storage, publicKeyPem });
    assert.equal(statusAfter.license_status, "ACTIVE");
    assert.equal(statusAfter.is_valid, true);
  });
});

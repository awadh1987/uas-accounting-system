import assert from "node:assert/strict";
import { describe, it } from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalizeLicensePayload,
  type UasLicensePayload,
  type UasSignedLicense,
} from "../src/lib/licensing/licenseSchema";
import { UAS_LICENSE_PUBLIC_KEY } from "../src/lib/licensing/publicKey";
import {
  activateOfflineClientLicense,
  buildOfflineClientLicenseStatus,
  createMemoryStorage,
  recordOfflineLicenseGovernance,
  verifyLicenseSignaturePure,
  verifyLicenseSignatureWebCrypto,
} from "../src/lib/licensing/seatClient";
import { verifyEd25519SpkiPure } from "../src/lib/licensing/ed25519Pure";
import {
  getPrioritizedOfflineSyncQueue,
  handleOfflineAndroidApiRequest,
} from "../src/lib/offlineAndroidStore";

function signWithRealOrGeneratedKey(): {
  privateKey: crypto.KeyObject;
  publicKeyPem: string;
} {
  const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
  if (fs.existsSync(privPath)) {
    return {
      privateKey: crypto.createPrivateKey(fs.readFileSync(privPath, "utf8")),
      publicKeyPem: UAS_LICENSE_PUBLIC_KEY,
    };
  }
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function makeSignedLicense(
  privateKey: crypto.KeyObject,
  overrides: Partial<UasLicensePayload> = {}
): UasSignedLicense {
  const payload: UasLicensePayload = {
    license_id: `UAS-OFF-${Math.floor(1000 + Math.random() * 9000)}`,
    customer_name: "مؤسسة الوادي الأخضر التجارية",
    company_name: "مؤسسة الوادي الأخضر التجارية",
    tenant_slug: "alwadi",
    tenant_url: "https://alwadi.qat.world",
    name_ar: "مؤسسة الوادي الأخضر التجارية",
    name_en: "Alwadi Trading",
    hwid: "*",
    allowed_modes: ["local", "lan", "cloud"],
    max_branches: 4,
    max_lan_seats: 10,
    max_users: 7,
    per_user_devices: { windows: 1, android: 1 },
    issued_at: new Date(Date.now() - 86_400_000).toISOString(),
    expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    ...overrides,
  };
  const canonical = canonicalizeLicensePayload(payload);
  const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
  return { ...payload, signature: sig };
}

describe("Phase 2: Offline Ed25519 Signature & Data/Sync Parity", () => {
  it("verifies Ed25519 signatures via pure RFC 8032 even when WebCrypto Ed25519 throws or crypto.subtle is unavailable", async () => {
    const { privateKey, publicKeyPem } = signWithRealOrGeneratedKey();
    const signed = makeSignedLicense(privateKey);

    assert.equal(verifyLicenseSignaturePure(signed, publicKeyPem), true);

    // Tamper signature -> must fail
    const badSig: UasSignedLicense = {
      ...signed,
      signature: Buffer.from(crypto.randomBytes(64)).toString("base64"),
    };
    assert.equal(verifyLicenseSignaturePure(badSig, publicKeyPem), false);

    // Tamper company payload -> must fail
    const tamperedPayload: UasSignedLicense = {
      ...signed,
      max_users: 99,
    };
    assert.equal(verifyLicenseSignaturePure(tamperedPayload, publicKeyPem), false);

    // Simulate non-HTTPS LAN origin or Capacitor WebView where SubtleCrypto rejects Ed25519
    const originalCryptoDesc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    try {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: {
          getRandomValues: (arr: Uint8Array) => crypto.randomFillSync(arr),
          subtle: {
            async importKey() {
              throw new Error("NotSupportedError: Ed25519 unsupported in offline WebView");
            },
            async verify() {
              throw new Error("NotSupportedError");
            },
          },
        },
      });

      const okFallback = await verifyLicenseSignatureWebCrypto(signed, publicKeyPem);
      assert.equal(okFallback, true);

      const failFallback = await verifyLicenseSignatureWebCrypto(tamperedPayload, publicKeyPem);
      assert.equal(failFallback, false);

      // Verify raw SPKI parser rejects wrong header lengths
      assert.equal(verifyEd25519SpkiPure(new Uint8Array(10), new Uint8Array(4), new Uint8Array(64)), false);
    } finally {
      if (originalCryptoDesc) {
        Object.defineProperty(globalThis, "crypto", originalCryptoDesc);
      }
    }
  });

  it("activates .uas and UASKEY offline, reports INVALID_SIGNATURE on tampering, and enforces persisted revocation", async () => {
    const { privateKey, publicKeyPem } = signWithRealOrGeneratedKey();
    const signed = makeSignedLicense(privateKey);
    const storage = createMemoryStorage();

    // Activate via multi-line .uaskey.txt token offline
    const uaskeyB64 = Buffer.from(JSON.stringify(signed), "utf8").toString("base64");
    const uaskeyText = `UAS LICENSE CERTIFICATE\nUASKEY-${uaskeyB64}\nTenant: alwadi`;

    const res = await activateOfflineClientLicense(
      {
        activationKey: uaskeyText,
        userEmail: "owner@alwadi.com",
        platform: "android",
        mode: "local",
      },
      { storage, publicKeyPem }
    );
    assert.equal(res.success, true);

    const activeStatus = await buildOfflineClientLicenseStatus({ storage, publicKeyPem });
    assert.equal(activeStatus.is_valid, true);
    assert.equal(activeStatus.license_status, "ACTIVE");

    // Server governance revocation must enforce offline status + block offline reactivation
    recordOfflineLicenseGovernance(
      { licenseId: signed.license_id, status: "REVOKED", reason: "Key rotated" },
      storage
    );
    const revokedStatus = await buildOfflineClientLicenseStatus({ storage, publicKeyPem });
    assert.equal(revokedStatus.is_valid, false);
    assert.equal(revokedStatus.license_status, "REVOKED");

    const reactivateBlocked = await activateOfflineClientLicense(
      {
        licenseFileContent: JSON.stringify(signed),
        userEmail: "owner@alwadi.com",
        platform: "android",
        mode: "local",
      },
      { storage, publicKeyPem }
    );
    assert.equal(reactivateBlocked.success, false);
    assert.equal(reactivateBlocked.status, 403);

    // Corrupted stored signature reports INVALID_SIGNATURE (never HWID_MISMATCH)
    const storageBad = createMemoryStorage();
    recordOfflineLicenseGovernance({ licenseId: signed.license_id, status: "ACTIVE" }, storageBad);
    const forged: UasSignedLicense = {
      ...signed,
      signature: Buffer.from(crypto.randomBytes(64)).toString("base64"),
    };
    storageBad.setItem("uas_offline_installed_license_v2", JSON.stringify(forged));
    const badStatus = await buildOfflineClientLicenseStatus({ storage: storageBad, publicKeyPem });
    assert.equal(badStatus.is_valid, false);
    assert.equal(badStatus.license_status, "INVALID_SIGNATURE");
  });

  it("persists offline inventory batches, sales updates, user profile changes, and topological sync queue order", async () => {
    const storage = createMemoryStorage();
    const s = {
      getItem: (k: string) => storage.getItem(k),
      setItem: (k: string, v: string) => storage.setItem(k, v),
      removeItem: (k: string) => storage.removeItem?.(k),
    };

    // 1. Create a harvest batch offline -> verify persisted in state.inventoryBatches
    const createInvRes = await handleOfflineAndroidApiRequest(
      "/api/inventory",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          harvest: "القطفة الأولى",
          grade: "رقم 1",
          harvestedBundles: 120,
          shrinkageBundles: 5,
          notes: "حصاد صباحي",
        }),
      },
      s
    );
    assert.equal(createInvRes.status, 201);
    const createInvBody = (await createInvRes.json()) as {
      createdId: string;
      inventoryBatches: Array<{ id: string; harvestedBundles: number; shrinkageBundles: number }>;
    };
    assert.equal(createInvBody.inventoryBatches.length, 1);
    assert.equal(createInvBody.inventoryBatches[0].harvestedBundles, 120);

    // 2. Patch harvest batch -> verify updated
    const patchInvRes = await handleOfflineAndroidApiRequest(
      "/api/inventory",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: createInvBody.createdId,
          shrinkageBundles: 10,
        }),
      },
      s
    );
    assert.equal(patchInvRes.status, 200);
    const patchInvBody = (await patchInvRes.json()) as {
      batch: { shrinkageBundles: number };
    };
    assert.equal(patchInvBody.batch.shrinkageBundles, 10);

    // 3. Enqueue sales before customer and UOM offline, then check topological sort prioritizes UOM -> customer/inventory -> sales
    await handleOfflineAndroidApiRequest(
      "/api/sales",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          harvest: "القطفة الأولى",
          customer: "عميل نقدي",
          grade: "رقم 1",
          bundles: 10,
          price: 5000,
          credit: 50000,
        }),
      },
      s
    );
    await handleOfflineAndroidApiRequest(
      "/api/sales/customers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameAr: "عميل الجملة", phone: "777000111" }),
      },
      s
    );
    await handleOfflineAndroidApiRequest(
      "/api/inventory/uom",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameAr: "ربطة" }),
      },
      s
    );

    const sorted = getPrioritizedOfflineSyncQueue(s);
    const uomIdx = sorted.findIndex((q) => q.endpoint === "/api/inventory/uom");
    const custIdx = sorted.findIndex((q) => q.endpoint === "/api/sales/customers");
    const invIdx = sorted.findIndex((q) => q.endpoint === "/api/inventory");
    const saleIdx = sorted.findIndex((q) => q.endpoint === "/api/sales");

    assert.ok(uomIdx >= 0 && custIdx >= 0 && invIdx >= 0 && saleIdx >= 0);
    assert.ok(uomIdx < custIdx, "UOMs must replay before customers");
    assert.ok(custIdx < saleIdx, "Customers must replay before sales");
    assert.ok(invIdx < saleIdx, "Inventory batches must replay before sales");

    // 4. Offline user profile PATCH persists avatarUrl & displayName
    const profRes = await handleOfflineAndroidApiRequest(
      "/api/users/me/profile",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "مدير المزرعة",
          avatarUrl: "data:image/png;base64,iVBORw0KGgo=",
        }),
      },
      s
    );
    assert.equal(profRes.status, 200);
    const profBody = (await profRes.json()) as {
      user: { displayName: string; avatarUrl: string };
    };
    assert.equal(profBody.user.displayName, "مدير المزرعة");
    assert.equal(profBody.user.avatarUrl, "data:image/png;base64,iVBORw0KGgo=");
  });
});

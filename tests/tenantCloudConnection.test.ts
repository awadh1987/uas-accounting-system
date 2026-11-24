import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CLOUD_API_URL,
  DEFAULT_LAN_API_URL,
  getStoredServerUrls,
  resetApiBaseUrl,
  resolveApiBaseUrl,
  setStoredLanUrl,
  setStoredRuntimeMode,
  setStoredTenantId,
  setStoredTenantSlug,
  type StorageLike,
} from "../src/lib/apiClient";
import {
  collectLanDetectionCandidates,
  detectReachableLanEndpoint,
  evaluateConnectionOriginSwitch,
  normalizeActiveTenantSlug,
  probeTenantEndpoint,
  resolveActiveWorkspaceSlug,
  resolveTenantCloudUrl,
} from "../src/lib/serverConnection";
import { resolveTransportTarget } from "../src/lib/transportResolver";

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

describe("Phase 1: Tenant-Aware Server Connection, Auto-LAN & Subdomain Drift Guard", () => {
  it("resolves https://<slug>.qat.world for all non-default tenants and https://qat.world only for default/unset", () => {
    for (const slug of ["aljabri", "alameri", "yasser-albukli", "uas-ye", "custom-firm-99"]) {
      assert.equal(resolveTenantCloudUrl(slug), `https://${slug}.qat.world`);
      assert.equal(
        resolveTenantCloudUrl(`  ${slug.toUpperCase()}  `, `https://${slug}.qat.world`),
        `https://${slug}.qat.world`
      );
      // Even if currentOrigin is root qat.world, non-default tenant resolves to <slug>.qat.world
      assert.equal(
        resolveTenantCloudUrl(slug, "https://qat.world"),
        `https://${slug}.qat.world`
      );
    }

    assert.equal(resolveTenantCloudUrl("default"), "https://qat.world");
    assert.equal(resolveTenantCloudUrl(null), "https://qat.world");
    assert.equal(resolveTenantCloudUrl(undefined), "https://qat.world");
    assert.equal(resolveTenantCloudUrl(""), "https://qat.world");
    assert.equal(resolveTenantCloudUrl("invalid/slug"), "https://qat.world");
    assert.equal(normalizeActiveTenantSlug("YASSER-ALBUKLI"), "yasser-albukli");
    assert.equal(normalizeActiveTenantSlug("default"), null);
  });

  it("keeps LAN URL empty by default with zero hardcoded dummy 192.168.1.100 or 192.168.1.10 defaults", () => {
    assert.equal(DEFAULT_LAN_API_URL, "");
    assert.equal(DEFAULT_CLOUD_API_URL, "https://qat.world");

    const storage = createMemoryStorage();
    setStoredTenantSlug("aljabri", storage);
    const urls = getStoredServerUrls(storage);
    assert.equal(urls.lanUrl, "");
    assert.equal(urls.cloudUrl, "https://aljabri.qat.world");

    // Reset Default Origin restores tenant cloud URL without injecting a dummy LAN IP
    const restored = resetApiBaseUrl({ tenantSlug: "aljabri", storage });
    assert.equal(restored, "https://aljabri.qat.world");
    assert.equal(getStoredServerUrls(storage).lanUrl, "");

    const restoredDefault = resetApiBaseUrl({ tenantSlug: "default", storage });
    assert.equal(restoredDefault, "https://qat.world");
    assert.equal(getStoredServerUrls(storage).lanUrl, "");

    // Editable LAN URL persists when user enters one and clears cleanly when emptied
    setStoredLanUrl("http://192.168.10.25:3000/", storage);
    assert.equal(getStoredServerUrls(storage).lanUrl, "http://192.168.10.25:3000");
    setStoredLanUrl("", storage);
    assert.equal(getStoredServerUrls(storage).lanUrl, "");

    // Verify SystemTab source has zero hardcoded 192.168.1.100 dummy presets
    const systemTabSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/tabs/SystemTab.tsx"),
      "utf8"
    );
    assert.equal(systemTabSrc.includes("192.168.1.100"), false);
  });

  it("resolves active workspace slug and transport targets across tenants", () => {
    const storage = createMemoryStorage();
    setStoredTenantId("yasser-albukli", storage);
    setStoredRuntimeMode("cloud", undefined, storage);

    assert.equal(
      resolveActiveWorkspaceSlug({
        currentOriginOrHost: "https://yasser-albukli.qat.world",
      }),
      "yasser-albukli"
    );

    const target = resolveTransportTarget({ storage });
    assert.equal(target.mode, "cloud");
    assert.equal(target.baseUrl, "https://yasser-albukli.qat.world");
    assert.equal(target.tenantSlug, "yasser-albukli");

    const androidWin = {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
      location: { protocol: "https:", hostname: "localhost", origin: "https://localhost" },
    };
    assert.equal(
      resolveApiBaseUrl({ storage, win: androidWin }),
      "https://yasser-albukli.qat.world"
    );
  });

  it("auto-detects reachable LAN endpoints via GET /api/public/tenant without hardcoded dummy IPs", async () => {
    const candidates = collectLanDetectionCandidates({
      currentOrigin: "http://192.168.88.14:3000",
      savedLanUrl: "",
      serverLanIps: ["10.0.0.5"],
    });
    assert.deepEqual(candidates, ["http://192.168.88.14:3000", "http://10.0.0.5:3000"]);

    const probedUrls: string[] = [];
    const mockFetch = (async (url: string) => {
      probedUrls.push(url);
      if (url.startsWith("http://10.0.0.5:3000/api/public/tenant")) {
        return new Response(
          JSON.stringify({
            success: true,
            isTenantWorkspace: true,
            tenantId: "alameri",
            tenantSlug: "alameri",
            profile: { legalNameAr: "وكالة العامري" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    const detection = await detectReachableLanEndpoint({
      currentOrigin: "https://localhost",
      savedLanUrl: "",
      serverLanIps: ["192.168.88.14", "10.0.0.5"],
      expectedTenantSlug: "alameri",
      timeoutMs: 1000,
      fetchImpl: mockFetch,
      win: {
        location: { protocol: "https:", hostname: "localhost" },
        navigator: { onLine: true, connection: { type: "wifi" } },
        Capacitor: { isNativePlatform: () => true },
      },
    });

    assert.equal(detection.detectedUrl, "http://10.0.0.5:3000");
    assert.equal(detection.probe?.tenantSlug, "alameri");
    assert.ok(probedUrls.every((u) => !u.includes("192.168.1.100")));

    // When on cellular only, auto-LAN detection skips probing
    const cellularSkip = await detectReachableLanEndpoint({
      serverLanIps: ["10.0.0.5"],
      fetchImpl: mockFetch,
      win: {
        navigator: { onLine: true, connection: { type: "cellular" } },
      },
    });
    assert.equal(cellularSkip.detectedUrl, null);
    assert.deepEqual(cellularSkip.checkedCandidates, []);
  });

  it("raises bilingual subdomain drift and tenant-mismatch warnings when switching away from active tenant origin", async () => {
    // 1. Switching from aljabri.qat.world to root qat.world with pending offline queue items
    const rootDrift = evaluateConnectionOriginSwitch({
      activeTenantSlug: "aljabri",
      targetUrl: "https://qat.world",
      currentOrigin: "https://aljabri.qat.world",
      offlineQueueCount: 3,
    });
    assert.equal(rootDrift.hasWarning, true);
    assert.equal(rootDrift.requiresConfirmation, true);
    assert.equal(rootDrift.driftKind, "root_or_other_subdomain");
    assert.ok(rootDrift.messageAr.includes("aljabri"));
    assert.ok(rootDrift.messageAr.includes("3"));
    assert.ok(rootDrift.messageEn.includes("3"));

    // 2. Switching to another tenant subdomain (alameri)
    const crossSubdomainDrift = evaluateConnectionOriginSwitch({
      activeTenantSlug: "uas-ye",
      targetUrl: "https://alameri.qat.world",
      currentOrigin: "https://uas-ye.qat.world",
      offlineQueueCount: 0,
    });
    assert.equal(crossSubdomainDrift.requiresConfirmation, true);
    assert.equal(crossSubdomainDrift.driftKind, "root_or_other_subdomain");

    // 3. Target /api/public/tenant resolves to mismatched tenant
    const probe = await probeTenantEndpoint("http://192.168.5.20:3000", {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            success: true,
            isTenantWorkspace: true,
            tenantId: "alameri",
            tenantSlug: "alameri",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )) as unknown as typeof fetch,
    });
    assert.equal(probe.ok, true);
    assert.equal(probe.tenantSlug, "alameri");

    const mismatch = evaluateConnectionOriginSwitch({
      activeTenantSlug: "aljabri",
      targetUrl: "http://192.168.5.20:3000",
      targetResolvedTenantSlug: probe.tenantSlug,
      targetIsTenantWorkspace: probe.isTenantWorkspace,
      offlineQueueCount: 2,
    });
    assert.equal(mismatch.hasWarning, true);
    assert.equal(mismatch.requiresConfirmation, true);
    assert.equal(mismatch.driftKind, "resolved_tenant_mismatch");

    // 4. Staying on matching <slug>.qat.world raises zero warnings
    const cleanMatch = evaluateConnectionOriginSwitch({
      activeTenantSlug: "aljabri",
      targetUrl: "https://aljabri.qat.world",
      targetResolvedTenantSlug: "aljabri",
      targetIsTenantWorkspace: true,
    });
    assert.equal(cleanMatch.hasWarning, false);
    assert.equal(cleanMatch.requiresConfirmation, false);
  });
});

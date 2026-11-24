"use client";

import {
  computeOperatingExpenseTotal,
  computeQrVerificationCode,
  computeSaleTotals,
  computeWorkerWageTotals,
  formatAuditTimestamp,
} from "@/lib/formulas";
import { evaluateSaleAgainstHarvestStock } from "@/lib/harvestReconciliation";
import {
  enqueueOfflineMutation,
  getOfflineQueue,
  getOfflineQueueCount,
  loadOfflineSnapshot,
  removeOfflineQueueItem,
  saveOfflineSnapshot,
} from "@/lib/offlineDb";
import { INITIAL_FALLBACK_STATE } from "@/lib/seedFallback";
import {
  getEndpointSyncPriority,
  getOfflineSyncQueue,
  handleOfflineAndroidApiRequest,
  loadOfflineAndroidState,
} from "@/lib/offlineAndroidStore";
import {
  normalizeActiveTenantSlug,
  ROOT_CLOUD_URL,
  resolveTenantCloudUrl,
} from "@/lib/serverConnection";
import type { UasBootstrapState, UasUser } from "@/types/uas";

export const SERVER_URL_STORAGE_KEY = "uas_server_url";
export const RUNTIME_MODE_STORAGE_KEY = "uas_runtime_mode";
export const LAN_URL_STORAGE_KEY = "uas_lan_server_url";
export const CLOUD_URL_STORAGE_KEY = "uas_cloud_server_url";
export const TENANT_ID_STORAGE_KEY = "uas_tenant_id";
export const TENANT_SLUG_STORAGE_KEY = "uas_tenant_slug";
export const DEVICE_ID_STORAGE_KEY = "uas_device_id";
export const LICENSE_KEY_STORAGE_KEY = "uas_license_key";
export const SESSION_TOKEN_STORAGE_KEY = "uas_session_token";
export const DEFAULT_CLOUD_API_URL = ROOT_CLOUD_URL;
export const DEFAULT_LAN_API_URL = "";

function extractSafeClientLicenseId(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  if (!trimmed || trimmed.startsWith("UASKEY-") || trimmed.startsWith("{") || trimmed.length > 64 || /\s/.test(trimmed)) {
    return "";
  }
  return /^UAS-/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export function getStoredLicenseKeyId(storage?: Pick<StorageLike, "getItem"> | null): string {
  const s = getStorage(storage);
  return extractSafeClientLicenseId(s?.getItem(LICENSE_KEY_STORAGE_KEY));
}

export function setStoredLicenseKeyId(
  licenseId: string | null | undefined,
  storage?: StorageLike | null
): void {
  const s = getWritableStorage(storage);
  if (!s) return;
  const cleaned = extractSafeClientLicenseId(licenseId);
  if (!cleaned) {
    s.removeItem(LICENSE_KEY_STORAGE_KEY);
  } else {
    s.setItem(LICENSE_KEY_STORAGE_KEY, cleaned);
  }
}

export function getStoredSessionToken(storage?: Pick<StorageLike, "getItem"> | null): string {
  const s = getStorage(storage);
  return (s?.getItem(SESSION_TOKEN_STORAGE_KEY) || "").trim();
}

export function setStoredSessionToken(token: string | null | undefined, storage?: StorageLike | null): void {
  const s = getWritableStorage(storage);
  if (!s) return;
  const cleaned = (token || "").trim();
  if (!cleaned) {
    s.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } else {
    s.setItem(SESSION_TOKEN_STORAGE_KEY, cleaned);
  }
}

export function getOrCreateClientDeviceId(storage?: StorageLike | null): string {
  const s = getWritableStorage(storage);
  if (s) {
    const existing = (s.getItem(DEVICE_ID_STORAGE_KEY) || "").trim();
    if (existing) return existing;
    const generated = `dev-${generateClientUuid()}`;
    try {
      s.setItem(DEVICE_ID_STORAGE_KEY, generated);
    } catch {
      // Ignore quota errors
    }
    return generated;
  }
  return "dev-ephemeral";
}

export function detectClientDevicePlatform(
  winOverride?: BrowserEnvLike
): "android" | "windows" | "ios" | "web" {
  const win: BrowserEnvLike | undefined =
    winOverride ?? (typeof window !== "undefined" ? (window as unknown as BrowserEnvLike) : undefined);
  const capPlat = win?.Capacitor?.getPlatform?.()?.toLowerCase();
  if (capPlat === "ios") return "ios";
  if (isNativeAndroid(winOverride)) return "android";
  const ua = win?.navigator?.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/electron|uas-desktop|windows nt/i.test(ua)) return "windows";
  return "web";
}

function handlePotentialRevocation(status: number, bodyObj: unknown): void {
  if (
    status === 403 &&
    bodyObj &&
    typeof bodyObj === "object" &&
    (bodyObj as { code?: unknown }).code === "DEVICE_REVOKED"
  ) {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("uas_user");
        window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent("uas:device-revoked", { detail: bodyObj }));
      } catch {
        // Ignore
      }
    }
  }
}

export function getStoredTenantId(storage?: Pick<StorageLike, "getItem"> | null): string {
  const s = getStorage(storage);
  return (s?.getItem(TENANT_ID_STORAGE_KEY) || "").trim() || "default";
}

export function getStoredTenantSlug(storage?: Pick<StorageLike, "getItem"> | null): string | null {
  const s = getStorage(storage);
  const explicitSlug = normalizeActiveTenantSlug(s?.getItem(TENANT_SLUG_STORAGE_KEY));
  if (explicitSlug) return explicitSlug;
  return normalizeActiveTenantSlug(s?.getItem(TENANT_ID_STORAGE_KEY));
}

export function setStoredTenantSlug(
  tenantSlug: string | null | undefined,
  storage?: StorageLike | null
): void {
  const s = getWritableStorage(storage);
  if (!s) return;
  const cleaned = normalizeActiveTenantSlug(tenantSlug);
  if (!cleaned) {
    s.removeItem(TENANT_SLUG_STORAGE_KEY);
  } else {
    s.setItem(TENANT_SLUG_STORAGE_KEY, cleaned);
  }
}

export function setStoredTenantId(tenantId: string, storage?: StorageLike | null): void {
  const s = getWritableStorage(storage);
  if (s) {
    const cleaned = (tenantId || "").trim();
    if (!cleaned || cleaned === "default") {
      s.removeItem(TENANT_ID_STORAGE_KEY);
      s.removeItem(TENANT_SLUG_STORAGE_KEY);
    } else {
      s.setItem(TENANT_ID_STORAGE_KEY, cleaned);
      const validSlug = normalizeActiveTenantSlug(cleaned);
      if (validSlug) {
        s.setItem(TENANT_SLUG_STORAGE_KEY, validSlug);
      }
    }
  }
}

export function generateClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type ClientRuntimeMode = "local" | "lan" | "cloud";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserEnvLike {
  UasAndroidNative?: unknown;
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
  location?: { protocol?: string; hostname?: string; origin?: string };
  navigator?: { userAgent?: string };
  localStorage?: StorageLike;
}

function getStorage(storage?: Pick<StorageLike, "getItem"> | null): Pick<StorageLike, "getItem"> | null {
  if (storage !== undefined) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

function getWritableStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  return null;
}

export function isNativeAndroid(winOverride?: BrowserEnvLike): boolean {
  const win: BrowserEnvLike | undefined =
    winOverride ?? (typeof window !== "undefined" ? (window as unknown as BrowserEnvLike) : undefined);
  if (!win) return false;
  if (win.UasAndroidNative) return true;
  if (win.Capacitor?.isNativePlatform?.()) return true;
  if (win.Capacitor?.getPlatform?.()?.toLowerCase() === "android") return true;
  const proto = (win.location?.protocol || "").toLowerCase();
  if (proto === "capacitor:" || proto === "file:") return true;
  const host = (win.location?.hostname || "").toLowerCase();
  const ua = win.navigator?.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (host === "localhost" && /android/i.test(ua)) return true;
  return false;
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function getStoredServerUrls(
  storage?: Pick<StorageLike, "getItem"> | null,
  opts?: { tenantSlug?: string | null; currentOrigin?: string }
): { lanUrl: string; cloudUrl: string } {
  const s = getStorage(storage);
  const savedLan = s?.getItem(LAN_URL_STORAGE_KEY)?.trim() || "";
  const savedCloud = s?.getItem(CLOUD_URL_STORAGE_KEY)?.trim() || "";
  const activeSlug = opts?.tenantSlug ?? getStoredTenantSlug(s);
  const fallbackCloud = resolveTenantCloudUrl(
    activeSlug,
    opts?.currentOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined)
  );
  return {
    lanUrl: savedLan ? savedLan.replace(/\/+$/, "") : "",
    cloudUrl: savedCloud ? savedCloud.replace(/\/+$/, "") : fallbackCloud,
  };
}

export function getStoredRuntimeMode(
  storage?: Pick<StorageLike, "getItem"> | null
): ClientRuntimeMode {
  const s = getStorage(storage);
  if (s) {
    const raw = (s.getItem(RUNTIME_MODE_STORAGE_KEY) || "").trim().toLowerCase();
    if (raw === "local" || raw === "lan" || raw === "cloud") {
      return raw;
    }
    const savedUrl = (s.getItem(SERVER_URL_STORAGE_KEY) || "").trim().toLowerCase();
    if (savedUrl.startsWith("https://")) return "cloud";
    if (savedUrl.startsWith("http://")) return "lan";
  }
  return "local";
}

export function setStoredRuntimeMode(
  mode: ClientRuntimeMode,
  customUrl?: string,
  storage?: StorageLike | null,
  opts?: { tenantSlug?: string | null; currentOrigin?: string }
): { mode: ClientRuntimeMode; serverUrl: string } {
  const s = getWritableStorage(storage);
  const existing = getStoredServerUrls(s, opts);
  const defaultCloud = resolveTenantCloudUrl(
    opts?.tenantSlug ?? getStoredTenantSlug(s),
    opts?.currentOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined)
  );
  let serverUrl = "";

  if (mode === "cloud") {
    serverUrl = normalizeServerUrl(customUrl || existing.cloudUrl || defaultCloud);
    if (s) {
      s.setItem(RUNTIME_MODE_STORAGE_KEY, "cloud");
      s.setItem(CLOUD_URL_STORAGE_KEY, serverUrl);
      s.setItem(SERVER_URL_STORAGE_KEY, serverUrl);
    }
  } else if (mode === "lan") {
    serverUrl = normalizeServerUrl(customUrl !== undefined ? customUrl : existing.lanUrl);
    if (s) {
      s.setItem(RUNTIME_MODE_STORAGE_KEY, "lan");
      if (serverUrl) {
        s.setItem(LAN_URL_STORAGE_KEY, serverUrl);
        s.setItem(SERVER_URL_STORAGE_KEY, serverUrl);
      } else {
        s.removeItem(LAN_URL_STORAGE_KEY);
        s.removeItem(SERVER_URL_STORAGE_KEY);
      }
    }
  } else {
    serverUrl = "";
    if (s) {
      s.setItem(RUNTIME_MODE_STORAGE_KEY, "local");
      s.removeItem(SERVER_URL_STORAGE_KEY);
    }
  }

  return { mode, serverUrl };
}

export function isAndroidLocalIsolatedMode(
  winOverride?: BrowserEnvLike,
  storage?: Pick<StorageLike, "getItem"> | null
): boolean {
  return isNativeAndroid(winOverride) && getStoredRuntimeMode(storage) === "local";
}

export function resolveApiBaseUrl(opts?: {
  preferCloudFallback?: boolean;
  storage?: Pick<StorageLike, "getItem"> | null;
  win?: BrowserEnvLike;
}): string {
  const s = getStorage(opts?.storage);
  const win: BrowserEnvLike | undefined =
    opts?.win ?? (typeof window !== "undefined" ? (window as unknown as BrowserEnvLike) : undefined);
  const onAndroid = isNativeAndroid(win);
  const mode = getStoredRuntimeMode(s);

  // STRICT LOCAL ISOLATION: On Android in `"local"` mode, NEVER route business APIs
  // (`/api/bootstrap`, `/api/users`, `/api/system/branding`, accounting/inventory) to `https://qat.world`.
  // Only explicit licensing calls (`preferCloudFallback: true`) may contact `https://qat.world`.
  if (onAndroid && mode === "local") {
    if (opts?.preferCloudFallback) {
      const urls = getStoredServerUrls(s);
      return urls.cloudUrl || DEFAULT_CLOUD_API_URL;
    }
    return "";
  }

  if (s) {
    const saved = s.getItem(SERVER_URL_STORAGE_KEY);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, "");
    }
  }

  const host = (win?.location?.hostname || "").toLowerCase();
  const proto = (win?.location?.protocol || "").toLowerCase();
  const isCapacitorLocalOrigin = onAndroid && (host === "localhost" || proto === "capacitor:" || proto === "file:" || !host);

  if (isCapacitorLocalOrigin) {
    const urls = getStoredServerUrls(s);
    if (mode === "cloud") {
      return urls.cloudUrl || DEFAULT_CLOUD_API_URL;
    }
    if (mode === "lan" && s?.getItem(LAN_URL_STORAGE_KEY)?.trim()) {
      return urls.lanUrl;
    }
    if (opts?.preferCloudFallback) {
      return urls.cloudUrl || DEFAULT_CLOUD_API_URL;
    }
  }

  const envBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
  if (envBase) return envBase;
  if (opts?.preferCloudFallback) return DEFAULT_CLOUD_API_URL;
  return "";
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl();
}

export function setStoredLanUrl(url: string, storage?: StorageLike | null): string {
  const s = getWritableStorage(storage);
  const cleaned = normalizeServerUrl(url);
  if (!s) return cleaned;
  if (!cleaned) {
    s.removeItem(LAN_URL_STORAGE_KEY);
  } else {
    s.setItem(LAN_URL_STORAGE_KEY, cleaned);
  }
  return cleaned;
}

export function setApiBaseUrl(url: string, storage?: StorageLike | null): void {
  const s = getWritableStorage(storage);
  if (!s) return;
  const cleaned = url.trim().replace(/\/+$/, "");
  if (!cleaned) {
    s.removeItem(SERVER_URL_STORAGE_KEY);
  } else {
    s.setItem(SERVER_URL_STORAGE_KEY, cleaned);
    if (/^https:\/\//i.test(cleaned)) {
      s.setItem(CLOUD_URL_STORAGE_KEY, cleaned);
    } else if (/^http:\/\//i.test(cleaned)) {
      s.setItem(LAN_URL_STORAGE_KEY, cleaned);
    }
  }
}

export function resetApiBaseUrl(opts?: {
  tenantSlug?: string | null;
  currentOrigin?: string;
  storage?: StorageLike | null;
}): string {
  const s = getWritableStorage(opts?.storage);
  const restored = resolveTenantCloudUrl(
    opts?.tenantSlug ?? getStoredTenantSlug(s),
    opts?.currentOrigin ?? (typeof window !== "undefined" ? window.location.origin : undefined)
  );
  if (s) {
    s.removeItem(SERVER_URL_STORAGE_KEY);
    s.removeItem(CLOUD_URL_STORAGE_KEY);
  }
  return restored;
}

export interface SafeFetchJsonResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  isHtmlFallback: boolean;
  data: T | null;
  rawText?: string;
  error?: string;
}

/**
 * Safely fetches JSON and detects Capacitor/static-export HTML fallbacks
 * (e.g. `<!DOCTYPE html>...` returned with HTTP 200 on `https://localhost`)
 * so callers never throw `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 */
export function sanitizeHeaderValue(value: string): string {
  // Web Fetch `Headers` only permits ISO-8859-1 (ByteString, code points <= 0xff).
  // Encode values containing non-Latin1 characters (e.g. Arabic display names) so Headers() never throws.
  return /[^\u0000-\u00FF]/.test(value) ? encodeURIComponent(value) : value;
}

export function sanitizeHeadersInit(initHeaders?: HeadersInit): Headers {
  const headers = new Headers();
  if (!initHeaders) return headers;
  if (initHeaders instanceof Headers) {
    initHeaders.forEach((v, k) => headers.set(k, sanitizeHeaderValue(v)));
    return headers;
  }
  if (Array.isArray(initHeaders)) {
    for (const [k, v] of initHeaders) {
      headers.set(k, sanitizeHeaderValue(String(v)));
    }
    return headers;
  }
  for (const [k, v] of Object.entries(initHeaders)) {
    if (v !== undefined) {
      headers.set(k, sanitizeHeaderValue(String(v)));
    }
  }
  return headers;
}

export async function safeFetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
  fetchImpl?: typeof fetch
): Promise<SafeFetchJsonResult<T>> {
  const fn = fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fn) {
    return {
      ok: false,
      status: 0,
      isHtmlFallback: false,
      data: null,
      error: "Fetch API unavailable",
    };
  }
  try {
    const method = (init?.method || "GET").toUpperCase();
    const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const headers = sanitizeHeadersInit(init?.headers);

    if (isMutating) {
      if (!headers.has("x-idempotency-key") && !headers.has("X-Idempotency-Key")) {
        headers.set("X-Idempotency-Key", generateClientUuid());
      }
    }

    if (!headers.has("x-uas-tenant-id") && !headers.has("X-UAS-Tenant-Id")) {
      const tid = getStoredTenantId();
      if (tid) {
        headers.set("x-uas-tenant-id", tid);
      }
    }
    if (!headers.has("x-uas-device-id")) {
      headers.set("x-uas-device-id", getOrCreateClientDeviceId());
    }
    if (!headers.has("x-uas-platform")) {
      headers.set("x-uas-platform", detectClientDevicePlatform());
    }
    if (!headers.has("x-uas-license-key")) {
      const licKey = getStoredLicenseKeyId();
      if (licKey) headers.set("x-uas-license-key", licKey);
    }
    if (!headers.has("x-uas-session-token")) {
      const sessionTok = getStoredSessionToken();
      if (sessionTok) headers.set("x-uas-session-token", sessionTok);
    }
    const finalInit = { ...init, headers };

    const baseUrl = resolveApiBaseUrl();
    const finalUrl = baseUrl && url.startsWith("/api/") ? `${baseUrl}${url}` : url;

    const { resilientFetch } = await import("@/lib/transportResolver");
    const res = await resilientFetch(finalUrl, finalInit, { fetchImpl: fn });
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();
    const trimmed = text.trim();
    const looksLikeHtml =
      /^<!doctype\s+html/i.test(trimmed) ||
      /^<html[\s>]/i.test(trimmed) ||
      (trimmed.startsWith("<") && !contentType.includes("application/json"));

    if (looksLikeHtml || (!contentType.includes("application/json") && !trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return {
        ok: false,
        status: res.status,
        isHtmlFallback: true,
        data: null,
        rawText: trimmed.slice(0, 160),
        error: "STATIC_HTML_FALLBACK",
      };
    }

    try {
      const parsed = JSON.parse(trimmed) as T;
      handlePotentialRevocation(res.status, parsed);
      const errRecord =
        parsed && typeof parsed === "object"
          ? (parsed as { error?: string; message?: string })
          : undefined;
      const parsedErr = errRecord?.error || errRecord?.message;
      return {
        ok: res.ok,
        status: res.status,
        isHtmlFallback: false,
        data: parsed,
        error: !res.ok ? (parsedErr || `HTTP_${res.status}`) : undefined,
      };
    } catch {
      return {
        ok: false,
        status: res.status,
        isHtmlFallback: false,
        data: null,
        rawText: trimmed.slice(0, 160),
        error: "INVALID_JSON_RESPONSE",
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      isHtmlFallback: false,
      data: null,
      error: err instanceof Error ? err.message : "Network request failed",
    };
  }
}

let fetchInterceptorInstalled = false;

export function installGlobalApiFetchInterceptor(): void {
  if (typeof window === "undefined" || fetchInterceptorInstalled) return;
  fetchInterceptorInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
    const isRelativeApi = urlStr.startsWith("/api/");
    const isLocalhostApi = /^https?:\/\/localhost(?::\d+)?\/api\//i.test(urlStr);

    if (isRelativeApi || isLocalhostApi) {
      const method = (init?.method || "GET").toUpperCase();
      const headers = sanitizeHeadersInit(init?.headers);
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        if (!headers.has("x-idempotency-key") && !headers.has("X-Idempotency-Key")) {
          headers.set("X-Idempotency-Key", generateClientUuid());
        }
      }
      if (!headers.has("x-uas-tenant-id") && !headers.has("X-UAS-Tenant-Id")) {
        const tid = getStoredTenantId();
        if (tid && tid !== "default") {
          headers.set("x-uas-tenant-id", tid);
        }
      }
      if (!headers.has("x-uas-device-id")) {
        headers.set("x-uas-device-id", getOrCreateClientDeviceId());
      }
      if (!headers.has("x-uas-platform")) {
        headers.set("x-uas-platform", detectClientDevicePlatform());
      }
      if (!headers.has("x-uas-license-key")) {
        const licKey = getStoredLicenseKeyId();
        if (licKey) headers.set("x-uas-license-key", licKey);
      }
      if (!headers.has("x-uas-session-token")) {
        const sessionTok = getStoredSessionToken();
        if (sessionTok) headers.set("x-uas-session-token", sessionTok);
      }
      const patchedInit = { ...init, headers };

      // On Android in `"local"` mode, route all local `/api/*` calls to on-device localStorage adapter
      // (never reaching https://qat.world or Capacitor's HTML fallback).
      if (isAndroidLocalIsolatedMode()) {
        return handleOfflineAndroidApiRequest(urlStr, patchedInit);
      }
      const base = resolveApiBaseUrl();
      if (base && isRelativeApi) {
        return originalFetch(`${base}${urlStr}`, patchedInit);
      }
    }
    return originalFetch(input, init);
  };
}

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");

export interface ApiMutationResult {
  state: UasBootstrapState;
  queuedOffline: boolean;
  queueCount: number;
  error?: string;
}

function makeActorPayload(currentUser: UasUser) {
  return {
    userId: currentUser.id,
    userDisplay: `${currentUser.name} (${currentUser.role})`,
    userRole: currentUser.role,
  };
}

function makeLocalHash(seed: string): string {
  return computeQrVerificationCode(`${seed}-${Date.now()}`);
}

export async function fetchBootstrapState(): Promise<{
  state: UasBootstrapState;
  fromOfflineCache: boolean;
  queueCount: number;
}> {
  if (isAndroidLocalIsolatedMode()) {
    const localState = loadOfflineAndroidState();
    const syncQueueLen = getOfflineSyncQueue().length;
    return { state: localState, fromOfflineCache: true, queueCount: syncQueueLen };
  }

  const queueCount = await getOfflineQueueCount();
  try {
    const base = resolveApiBaseUrl();
    const tid = getStoredTenantId();
    const headers: Record<string, string> = {
      "x-uas-device-id": getOrCreateClientDeviceId(),
      "x-uas-platform": detectClientDevicePlatform(),
    };
    if (tid && tid !== "default") {
      headers["x-uas-tenant-id"] = tid;
    }
    const sessionTok = getStoredSessionToken();
    if (sessionTok) {
      headers["x-uas-session-token"] = sessionTok;
    }
    const res = await fetch(`${base}/api/bootstrap`, {
      cache: "no-store",
      headers,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      throw new Error("Non-JSON bootstrap response");
    }
    const serverState = (await res.json()) as UasBootstrapState;
    await saveOfflineSnapshot(serverState);
    return { state: serverState, fromOfflineCache: false, queueCount };
  } catch {
    const cached = await loadOfflineSnapshot();
    if (cached) {
      return { state: cached, fromOfflineCache: true, queueCount };
    }
    await saveOfflineSnapshot(INITIAL_FALLBACK_STATE);
    return { state: INITIAL_FALLBACK_STATE, fromOfflineCache: true, queueCount };
  }
}

function applyLocalOptimistic(
  prev: UasBootstrapState,
  endpoint: string,
  method: "POST" | "PATCH" | "DELETE",
  payload: Record<string, unknown>,
  currentUser: UasUser
): { next: UasBootstrapState; error?: string } {
  const next: UasBootstrapState = structuredClone(prev);
  const ts = formatAuditTimestamp(new Date());
  const actorLabel = `${currentUser.name} (${currentUser.role})`;

  const addAudit = (action: string, details: string) => {
    next.auditLogs.unshift({
      id: "aud-" + Date.now(),
      timestamp: ts,
      user: actorLabel,
      action,
      details,
      hash: makeLocalHash(action + details),
    });
  };

  if (endpoint === "/api/projects" && method === "POST") {
    const name = String(payload.name || "").trim();
    const type = String(payload.type || "مشروع رئيسي");
    const parentProjectId = type === "مشروع فرعي" ? String(payload.parentProjectId || "") : "";
    const estimatedValue = Number(payload.estimatedValue) || 0;
    const count = Math.max(1, Number(payload.plannedHarvests) || 1);
    const notes = String(payload.notes || "");
    const ordinals = ["القطفة الأولى", "القطفة الثانية", "القطفة الثالثة", "القطفة الرابعة", "القطفة الخامسة"];
    const harvests = Array.from({ length: count }, (_, i) => ordinals[i] || `القطفة ${i + 1}`);
    const id = "p" + Date.now();
    next.projects.push({
      id,
      name,
      type,
      parentProjectId,
      estimatedValue,
      plannedHarvests: count,
      notes,
      harvests,
    });
    harvests.forEach((h) => {
      next.lockedPeriods[`${id}::${h}`] = false;
    });
    addAudit("إنشاء مشروع (محلي)", `${name} بقيمة ${estimatedValue.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint === "/api/projects/harvests" && method === "POST") {
    const pid = String(payload.projectId || "");
    const hName = String(payload.name || "").trim();
    const proj = next.projects.find((p) => p.id === pid);
    if (proj && hName && !proj.harvests.includes(hName)) {
      proj.harvests.push(hName);
      proj.plannedHarvests = proj.harvests.length;
      next.lockedPeriods[`${pid}::${hName}`] = false;
      addAudit("إضافة قطفة / مرشة (محلي)", `${proj.name} — ${hName}`);
    }
    return { next };
  }

  if (endpoint === "/api/expenses" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const qty = Number(payload.qty) || 1;
    const unitPrice = Number(payload.unitPrice) || 0;
    const total = computeOperatingExpenseTotal(qty, unitPrice);
    next.expenses.push({
      id: "e" + Date.now(),
      projectId,
      harvest,
      category: String(payload.category || "وقود/محروقات"),
      subType: String(payload.subType || payload.category || ""),
      qty,
      unitPrice,
      total,
      date: String(payload.date || ts.slice(0, 10)),
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة مصروف تشغيلي (محلي)", `${payload.category} — ${total.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint.startsWith("/api/expenses/") && method === "DELETE") {
    const id = endpoint.split("/").pop() || "";
    const rec = next.expenses.find((e) => e.id === id);
    if (rec && next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
      return {
        next: prev,
        error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      };
    }
    next.expenses = next.expenses.filter((e) => e.id !== id);
    addAudit("حذف مصروف تشغيلي (محلي)", rec ? `${rec.category} - ${rec.total} ريال` : id);
    return { next };
  }

  if (endpoint === "/api/workers" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const dailyWage = Number(payload.dailyWage) || 0;
    const days = Number(payload.days) || 1;
    const credit = Number(payload.credit) || 0;
    const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, days, credit);
    next.workers.push({
      id: "w" + Date.now(),
      projectId,
      harvest,
      name: String(payload.name || ""),
      dailyWage,
      days,
      total: totalWage,
      credit,
      debit: debitBalance,
      date: String(payload.date || ts.slice(0, 10)),
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة سجل أجر عامل (محلي)", `${payload.name} — ${totalWage.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint.startsWith("/api/workers/") && method === "DELETE") {
    const id = endpoint.split("/").pop() || "";
    const rec = next.workers.find((w) => w.id === id);
    if (rec && next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
      return {
        next: prev,
        error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      };
    }
    next.workers = next.workers.filter((w) => w.id !== id);
    addAudit("حذف سجل عامل (محلي)", rec ? `${rec.name} - ${rec.total} ريال` : id);
    return { next };
  }

  if (endpoint === "/api/sales" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const bundles = Number(payload.bundles) || 0;
    const price = Number(payload.price) || 0;
    const credit = Number(payload.credit) || 0;
    const grade = String(payload.grade || "رقم 1");
    const subProjectId = payload.subProjectId ? String(payload.subProjectId) : undefined;
    if (bundles > 0) {
      const stockCheck = evaluateSaleAgainstHarvestStock({
        batches: next.inventoryBatches,
        sales: next.sales,
        projectId,
        subProjectId,
        harvest,
        grade,
        requestedBundles: bundles,
      });
      const canOverride =
        Boolean(payload.allowNegativeStock) &&
        (currentUser.role === "SUPER_ADMIN" || currentUser.role === "CHIEF_ACCOUNTANT");
      if (stockCheck.hasTrackedBatches && !stockCheck.withinStock && !canOverride) {
        return {
          next: prev,
          error: `⛔ الكمية المطلوبة (${bundles}) تتجاوز المتاح بالمخزون (${Math.max(0, stockCheck.availableBundles)}) بعجز ${stockCheck.shortageBundles} علاقية`,
        };
      }
    }
    const { totalAmount, debitReceivable } = computeSaleTotals(bundles, price, credit);
    const seq = String(
      payload.sequenceNumber ||
      payload.batch ||
      `SO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`
    );
    next.sales.push({
      id: "s" + Date.now(),
      projectId,
      subProjectId: payload.subProjectId ? String(payload.subProjectId) : undefined,
      harvest,
      batch: String(payload.batch || seq),
      sequenceNumber: seq,
      dailyBatchLabel: String(payload.dailyBatchLabel || "وردية مفتوحة"),
      salesOfficerId: payload.salesOfficerId ? String(payload.salesOfficerId) : undefined,
      salesOfficerTitle: payload.salesOfficerTitle ? String(payload.salesOfficerTitle) : undefined,
      revenueAccountCode: String(payload.revenueAccountCode || "411101"),
      treasuryAccountId: payload.treasuryAccountId ? String(payload.treasuryAccountId) : undefined,
      customer: String(payload.customer || ""),
      phone: String(payload.phone || ""),
      grade: String(payload.grade || "رقم 1"),
      bundles,
      price,
      total: totalAmount,
      credit,
      debit: debitReceivable,
      date: String(payload.date || ts.slice(0, 10)),
      voucherNo: String(payload.voucherNo || "RV-" + Date.now().toString().slice(-3)),
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة عملية بيع (محلي)", `${payload.customer} — ${totalAmount.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint.startsWith("/api/sales/") && method === "PATCH") {
    const id = endpoint.split("/").pop() || "";
    const rec = next.sales.find((s) => s.id === id);
    if (rec) {
      if (next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
        return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
      }
      if (payload.projectId !== undefined) rec.projectId = String(payload.projectId);
      if (payload.subProjectId !== undefined) {
        rec.subProjectId = payload.subProjectId ? String(payload.subProjectId) : undefined;
      }
      if (payload.harvest !== undefined) rec.harvest = String(payload.harvest);
      if (payload.batch !== undefined) rec.batch = String(payload.batch);
      if (payload.customer !== undefined) rec.customer = String(payload.customer);
      if (payload.phone !== undefined) rec.phone = String(payload.phone);
      if (payload.grade !== undefined) rec.grade = String(payload.grade);
      if (payload.date !== undefined) rec.date = String(payload.date);
      if (payload.voucherNo !== undefined) rec.voucherNo = String(payload.voucherNo);
      if (payload.notes !== undefined) rec.notes = String(payload.notes);
      const nextBundles = payload.bundles !== undefined ? Number(payload.bundles) || 0 : rec.bundles;
      const nextPrice = payload.price !== undefined ? Number(payload.price) || 0 : rec.price;
      const nextCredit = payload.credit !== undefined ? Number(payload.credit) || 0 : rec.credit;
      const { totalAmount, debitReceivable } = computeSaleTotals(nextBundles, nextPrice, nextCredit);
      rec.bundles = nextBundles;
      rec.price = nextPrice;
      rec.credit = nextCredit;
      rec.total = totalAmount;
      rec.debit = debitReceivable;
      addAudit("تعديل عملية بيع (محلي)", `${rec.customer} — ${totalAmount.toLocaleString("en-US")} ريال`);
    }
    return { next };
  }

  if (endpoint.startsWith("/api/sales/") && method === "DELETE") {
    const id = endpoint.split("/").pop() || "";
    const rec = next.sales.find((s) => s.id === id);
    if (rec && next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
      return {
        next: prev,
        error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      };
    }
    next.sales = next.sales.filter((s) => s.id !== id);
    addAudit("حذف عملية بيع (محلي)", rec ? `${rec.customer} - ${rec.total} ريال` : id);
    return { next };
  }

  if (endpoint === "/api/installments" && method === "POST") {
    const type = String(payload.type || "CUSTOMER_RECEIPT");
    const targetId = String(payload.targetId || "");
    const treasuryId = String(payload.treasuryId || "t1");
    const amount = Number(payload.amount) || 0;
    const voucherNo = String(payload.voucherNo || "RV-INST-" + Date.now().toString().slice(-3));
    const date = String(payload.date || ts.slice(0, 10));
    const notes = String(payload.notes || "دفعة مسجلة");

    const treas = next.treasuryAccounts.find((t) => t.id === treasuryId);
    let targetName = "";
    let phone = "";

    if (type === "CUSTOMER_RECEIPT") {
      const sale = next.sales.find((s) => s.id === targetId);
      if (!sale) return { next: prev, error: "الفاتورة غير موجودة" };
      if (next.lockedPeriods[`${sale.projectId}::${sale.harvest}`]) {
        return { next: prev, error: "🔒 القطفة مغلقة محاسبياً!" };
      }
      sale.credit += amount;
      sale.debit = sale.total - sale.credit;
      targetName = `${sale.customer} (${sale.batch})`;
      phone = sale.phone || "";
      if (treas) treas.balanceYER += amount;
    } else {
      const worker = next.workers.find((w) => w.id === targetId);
      if (!worker) return { next: prev, error: "سجل العامل غير موجود" };
      if (next.lockedPeriods[`${worker.projectId}::${worker.harvest}`]) {
        return { next: prev, error: "🔒 القطفة مغلقة محاسبياً!" };
      }
      worker.credit += amount;
      worker.debit = worker.total - worker.credit;
      targetName = `${worker.name} (${worker.harvest})`;
      if (treas) treas.balanceYER -= amount;
    }

    next.installments.unshift({
      id: "inst" + Date.now(),
      voucherNo,
      type,
      targetId,
      targetName,
      phone,
      treasuryId,
      amount,
      date,
      notes,
    });
    addAudit(
      type === "CUSTOMER_RECEIPT" ? "سند قبض دفعة عميل (محلي)" : "سند صرف دفعة عامل (محلي)",
      `سند ${voucherNo} — ${targetName} — ${amount.toLocaleString("en-US")} ريال`
    );
    return { next };
  }

  if (endpoint === "/api/inventory" && method === "POST") {
    const projectId = String(payload.projectId || "");
    const harvest = String(payload.harvest || "");
    if (next.lockedPeriods[`${projectId}::${harvest}`]) {
      return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
    }
    const harvestedBundles = Number(payload.harvestedBundles) || 0;
    const shrinkageBundles = Number(payload.shrinkageBundles) || 0;
    next.inventoryBatches.push({
      id: "inv" + Date.now(),
      projectId,
      subProjectId: payload.subProjectId ? String(payload.subProjectId) : undefined,
      harvest,
      grade: String(payload.grade || "رقم 1"),
      harvestedBundles,
      shrinkageBundles,
      notes: String(payload.notes || ""),
    });
    addAudit("إضافة دفعة مخزون علاقيات (محلي)", `${harvest} — ${harvestedBundles} علاقية`);
    return { next };
  }

  if ((endpoint === "/api/inventory" || endpoint.startsWith("/api/inventory/")) && method === "PATCH") {
    const id = String(payload.id || endpoint.split("/").pop() || "").trim();
    const rec = next.inventoryBatches.find((b) => b.id === id);
    if (rec) {
      if (next.lockedPeriods[`${rec.projectId}::${rec.harvest}`]) {
        return { next: prev, error: "🔒 هذه القطفة مغلقة محاسبياً!" };
      }
      if (payload.projectId !== undefined) rec.projectId = String(payload.projectId);
      if (payload.subProjectId !== undefined) {
        rec.subProjectId = payload.subProjectId ? String(payload.subProjectId) : undefined;
      }
      if (payload.harvest !== undefined) rec.harvest = String(payload.harvest);
      if (payload.grade !== undefined) rec.grade = String(payload.grade);
      if (payload.harvestedBundles !== undefined) {
        rec.harvestedBundles = Math.max(0, Math.round(Number(payload.harvestedBundles) || 0));
      }
      if (payload.shrinkageBundles !== undefined) {
        rec.shrinkageBundles = Math.max(0, Math.round(Number(payload.shrinkageBundles) || 0));
      }
      if (payload.notes !== undefined) rec.notes = String(payload.notes);
      addAudit("تعديل دفعة مخزون (محلي)", `${rec.harvest} (${rec.grade}) — ${rec.harvestedBundles} علاقية`);
    }
    return { next };
  }

  if (endpoint === "/api/audit/lock" && method === "POST") {
    const key = String(payload.key || "");
    const nextLocked = !next.lockedPeriods[key];
    next.lockedPeriods[key] = nextLocked;
    addAudit(nextLocked ? "إغلاق فترة قطفة 🔒" : "إعادة فتح فترة قطفة 🔓", `المعرف: ${key}`);
    return { next };
  }

  if (endpoint === "/api/audit/adjustments" && method === "POST") {
    const label = String(payload.periodLabel || payload.key || "");
    const reason = String(payload.reason || "");
    const amount = Number(payload.amount) || 0;
    addAudit("قيد تسوية محاسبي معتمد", `[${label}] ${reason} — القيمة: ${amount.toLocaleString("en-US")} ريال`);
    return { next };
  }

  if (endpoint === "/api/audit/log" && method === "POST") {
    addAudit(String(payload.action || ""), String(payload.details || ""));
    return { next };
  }

  if (endpoint === "/api/treasury/transfer" && method === "POST") {
    const fromId = String(payload.fromTreasuryId || "");
    const toId = String(payload.toTreasuryId || "");
    const amount = Number(payload.amount) || 0;
    const fromAcc = next.treasuryAccounts.find((t) => t.id === fromId || t.code === fromId);
    const toAcc = next.treasuryAccounts.find((t) => t.id === toId || t.code === toId);
    if (fromAcc && toAcc && amount > 0) {
      fromAcc.balance = Math.max(0, Number(fromAcc.balance || 0) - amount);
      fromAcc.balanceYER = Math.max(0, Number(fromAcc.balanceYER || fromAcc.balance || 0) - amount);
      toAcc.balance = Number(toAcc.balance || 0) + amount;
      toAcc.balanceYER = Number(toAcc.balanceYER || toAcc.balance || 0) + amount;
      addAudit("تحويل مالي داخلي (محلي)", `${fromAcc.nameAr} -> ${toAcc.nameAr} (${amount.toLocaleString()})`);
    }
    return { next };
  }

  if (endpoint === "/api/sales/customers" && method === "POST") {
    addAudit("إنشاء عميل جديد (محلي)", String(payload.name || payload.nameAr || ""));
    return { next };
  }

  if (endpoint === "/api/procurement/vendors" && method === "POST") {
    addAudit("إنشاء مورد جديد (محلي)", String(payload.nameAr || payload.name || ""));
    return { next };
  }

  if (endpoint === "/api/system/settings" && method === "PATCH") {
    if (payload.orgName) next.settings.orgName = String(payload.orgName);
    if (payload.logoText) next.settings.logoText = String(payload.logoText);
    if (payload.defaultLang === "ar" || payload.defaultLang === "en") {
      next.settings.defaultLang = payload.defaultLang;
    }
    if (
      payload.defaultTheme === "emerald" ||
      payload.defaultTheme === "dark" ||
      payload.defaultTheme === "royal"
    ) {
      next.settings.defaultTheme = payload.defaultTheme;
    }
    if (
      payload.defaultCurrency === "YER" ||
      payload.defaultCurrency === "SAR" ||
      payload.defaultCurrency === "USD"
    ) {
      next.settings.defaultCurrency = payload.defaultCurrency;
    }
    return { next };
  }

  if (endpoint === "/api/users" && method === "POST") {
    const name = String(payload.name || "");
    next.users.push({
      id: "u" + Date.now(),
      name,
      email: String(payload.email || ""),
      role: String(payload.role || "محاسب رئيسي (Accountant)"),
      active: true,
      avatarChar: name.charAt(0) || "م",
    });
    addAudit("إضافة مستخدم نظام (محلي)", name);
    return { next };
  }

  if (endpoint === "/api/users/me/profile" && method === "PATCH") {
    const u = next.users.find((x) => x.id === currentUser.id);
    if (u) {
      if (payload.displayName !== undefined) u.displayName = String(payload.displayName).trim();
      if (payload.phone !== undefined) u.phone = String(payload.phone).trim();
      if (payload.email !== undefined) u.email = String(payload.email).trim().toLowerCase();
      if (payload.avatarUrl !== undefined) u.avatarUrl = String(payload.avatarUrl).trim();
      if (payload.avatarChar !== undefined) u.avatarChar = String(payload.avatarChar).slice(0, 2);
      if (payload.avatarColor !== undefined) u.avatarColor = String(payload.avatarColor).trim();
      if (payload.preferredLang === "ar" || payload.preferredLang === "en") u.preferredLang = payload.preferredLang;
      if (payload.preferredCurrency === "YER" || payload.preferredCurrency === "SAR" || payload.preferredCurrency === "USD") {
        u.preferredCurrency = payload.preferredCurrency;
      }
      if (payload.preferredTheme === "emerald" || payload.preferredTheme === "dark" || payload.preferredTheme === "royal") {
        u.preferredTheme = payload.preferredTheme;
      }
    }
    return { next };
  }

  if (endpoint.startsWith("/api/users/") && method === "PATCH") {
    const id = endpoint.split("/").pop() || "";
    const u = next.users.find((x) => x.id === id);
    if (u) {
      if (payload.toggleActive === true) u.active = !u.active;
      if (payload.name) u.name = String(payload.name);
      if (payload.avatarChar) u.avatarChar = String(payload.avatarChar).slice(0, 2);
      if (payload.avatarUrl !== undefined) u.avatarUrl = String(payload.avatarUrl).trim();
    }
    return { next };
  }

  return { next };
}

export async function executeMutation(opts: {
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  payload: Record<string, unknown>;
  label: string;
  currentState: UasBootstrapState;
  currentUser: UasUser;
  offlineMode: boolean;
}): Promise<ApiMutationResult> {
  const bodyWithActor = {
    ...opts.payload,
    actor: makeActorPayload(opts.currentUser),
  };

  const idempotencyKey = generateClientUuid();
  const isBrowserOffline = typeof navigator !== "undefined" && !navigator.onLine;
  if (opts.offlineMode || isBrowserOffline) {
    const optimistic = applyLocalOptimistic(
      opts.currentState,
      opts.endpoint,
      opts.method,
      opts.payload,
      opts.currentUser
    );
    if (optimistic.error) {
      const queueCount = await getOfflineQueueCount();
      return {
        state: opts.currentState,
        queuedOffline: false,
        queueCount,
        error: optimistic.error,
      };
    }
    await saveOfflineSnapshot(optimistic.next);
    const queueCount = await enqueueOfflineMutation({
      endpoint: opts.endpoint,
      method: opts.method,
      payload: bodyWithActor,
      label: opts.label,
      idempotencyKey,
    });
    return {
      state: optimistic.next,
      queuedOffline: true,
      queueCount,
    };
  }

  try {
    const base = getApiBaseUrl();
    const tid = getStoredTenantId();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
      "x-uas-device-id": getOrCreateClientDeviceId(),
      "x-uas-platform": detectClientDevicePlatform(),
    };
    if (tid && tid !== "default") {
      headers["x-uas-tenant-id"] = tid;
    }
    const sessionTok = getStoredSessionToken();
    if (sessionTok) {
      headers["x-uas-session-token"] = sessionTok;
    }
    const { resilientFetch } = await import("@/lib/transportResolver");
    const res = await resilientFetch(`${base}${opts.endpoint}`, {
      method: opts.method,
      headers,
      body: JSON.stringify(bodyWithActor),
    });
    const data = (await res.json().catch(() => ({}))) as {
      state?: UasBootstrapState;
      error?: string;
      code?: string;
    };
    handlePotentialRevocation(res.status, data);

    if (!res.ok) {
      // Static Capacitor APK without a configured LAN/Cloud server returns HTML 404 for /api/*
      if ((res.status === 404 || res.status === 405) && !data.error) {
        throw new Error("STATIC_EXPORT_OFFLINE_FALLBACK");
      }
      const queueCount = await getOfflineQueueCount();
      return {
        state: opts.currentState,
        queuedOffline: false,
        queueCount,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    if (data.state) {
      await saveOfflineSnapshot(data.state);
      const queueCount = await getOfflineQueueCount();
      return { state: data.state, queuedOffline: false, queueCount };
    }

    const refreshed = await fetchBootstrapState();
    return {
      state: refreshed.state,
      queuedOffline: false,
      queueCount: refreshed.queueCount,
    };
  } catch {
    // Network dropped mid-request: fall back seamlessly to offline queue
    const optimistic = applyLocalOptimistic(
      opts.currentState,
      opts.endpoint,
      opts.method,
      opts.payload,
      opts.currentUser
    );
    if (optimistic.error) {
      const queueCount = await getOfflineQueueCount();
      return {
        state: opts.currentState,
        queuedOffline: false,
        queueCount,
        error: optimistic.error,
      };
    }
    await saveOfflineSnapshot(optimistic.next);
    const queueCount = await enqueueOfflineMutation({
      endpoint: opts.endpoint,
      method: opts.method,
      payload: bodyWithActor,
      label: opts.label,
      idempotencyKey,
    });
    return {
      state: optimistic.next,
      queuedOffline: true,
      queueCount,
    };
  }
}

export async function syncQueuedOfflineMutations(currentUser: UasUser): Promise<{
  syncedCount: number;
  failedCount: number;
  state: UasBootstrapState;
  remainingQueue: number;
}> {
  const rawItems = await getOfflineQueue();
  const items = [...rawItems].sort((a, b) => {
    const prioDiff = getEndpointSyncPriority(a.endpoint) - getEndpointSyncPriority(b.endpoint);
    if (prioDiff !== 0) return prioDiff;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
  let syncedCount = 0;
  let failedCount = 0;

  const base = getApiBaseUrl();
  const tid = getStoredTenantId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-uas-device-id": getOrCreateClientDeviceId(),
    "x-uas-platform": detectClientDevicePlatform(),
  };
  if (tid && tid !== "default") {
    headers["x-uas-tenant-id"] = tid;
  }
  const sessionTok = getStoredSessionToken();
  if (sessionTok) {
    headers["x-uas-session-token"] = sessionTok;
  }
  const { resilientFetch } = await import("@/lib/transportResolver");
  for (const item of items) {
    try {
      const res = await resilientFetch(`${base}${item.endpoint}`, {
        method: item.method,
        headers: {
          ...headers,
          "X-Idempotency-Key": item.idempotencyKey || generateClientUuid(),
        },
        body: JSON.stringify(item.payload),
      });
      if (res.ok || res.status === 404 || res.status === 423) {
        if (item.id !== undefined) await removeOfflineQueueItem(item.id);
        if (res.ok) syncedCount++;
        else failedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  if (syncedCount > 0) {
    await fetch(`${base}/api/audit/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "مزامنة سحابية (Cloud Sync)",
        details: `تمت مزامنة ${syncedCount} عمليات ميدانية من IndexedDB مع قاعدة البيانات المركزية`,
        actor: makeActorPayload(currentUser),
      }),
    }).catch(() => null);
  }

  const refreshed = await fetchBootstrapState();
  return {
    syncedCount,
    failedCount,
    state: refreshed.state,
    remainingQueue: refreshed.queueCount,
  };
}


import {
  DEFAULT_CLOUD_API_URL,
  getStoredRuntimeMode,
  getStoredServerUrls,
  getStoredTenantId,
  isNativeAndroid,
  type BrowserEnvLike,
  type ClientRuntimeMode,
  type StorageLike,
} from "@/lib/apiClient";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";

export interface ResolvedTransportTarget {
  mode: ClientRuntimeMode;
  baseUrl: string;
  tenantId: string;
  tenantSlug: string | null;
  isOffline: boolean;
  badgeLabelAr: string;
  badgeLabelEn: string;
}

export function resolveTransportTarget(opts?: {
  storage?: Pick<StorageLike, "getItem"> | null;
  win?: BrowserEnvLike;
  offlineMode?: boolean;
}): ResolvedTransportTarget {
  const win: BrowserEnvLike | undefined =
    opts?.win ?? (typeof window !== "undefined" ? (window as unknown as BrowserEnvLike) : undefined);
  const onAndroid = isNativeAndroid(win);
  const mode = getStoredRuntimeMode(opts?.storage);
  const urls = getStoredServerUrls(opts?.storage);
  const storedTenant = getStoredTenantId(opts?.storage);

  const hostSlug = extractSubdomainSlugFromHost(win?.location?.hostname);
  const tenantSlug = hostSlug || (storedTenant !== "default" ? storedTenant : null);
  const tenantId = tenantSlug || storedTenant || "default";

  const browserOffline =
    opts?.offlineMode === true ||
    (typeof navigator !== "undefined" && navigator.onLine === false);

  if (mode === "cloud") {
    let cloudBase = urls.cloudUrl || resolveTenantCloudUrl(tenantSlug, win?.location?.origin);
    if (hostSlug && win?.location?.origin && !onAndroid) {
      cloudBase = win.location.origin.replace(/\/+$/, "");
    } else if (tenantSlug && cloudBase === DEFAULT_CLOUD_API_URL) {
      cloudBase = resolveTenantCloudUrl(tenantSlug, win?.location?.origin);
    }
    return {
      mode: "cloud",
      baseUrl: cloudBase,
      tenantId,
      tenantSlug,
      isOffline: browserOffline,
      badgeLabelAr: browserOffline
        ? "سحابي (أوفلاين مؤقت)"
        : tenantSlug
          ? `سحابي (${tenantSlug}.qat.world)`
          : "سحابي (qat.world)",
      badgeLabelEn: browserOffline
        ? "Cloud (Offline Queue)"
        : tenantSlug
          ? `Cloud (${tenantSlug}.qat.world)`
          : "Cloud (qat.world)",
    };
  }

  if (mode === "lan") {
    const lanBase = urls.lanUrl || "";
    return {
      mode: "lan",
      baseUrl: lanBase,
      tenantId,
      tenantSlug,
      isOffline: browserOffline,
      badgeLabelAr: browserOffline ? "شبكة المكتب (غير متصل)" : "شبكة المكتب LAN",
      badgeLabelEn: browserOffline ? "Office LAN (Offline)" : "Office LAN",
    };
  }

  return {
    mode: "local",
    baseUrl: "",
    tenantId,
    tenantSlug,
    isOffline: browserOffline,
    badgeLabelAr: onAndroid ? "محلي معزول (SQLite / جهاز)" : "محلي (SQLite)",
    badgeLabelEn: onAndroid ? "Local Device (Isolated)" : "Local SQLite",
  };
}

export interface ResilientFetchOptions {
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  fetchImpl?: typeof fetch;
  randomFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeBackoffWithJitterMs(
  attempt: number,
  baseBackoffMs = 350,
  maxBackoffMs = 5000,
  randomFn: () => number = Math.random
): number {
  const exp = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, attempt)));
  const jitterFactor = 0.5 + Math.max(0, Math.min(1, randomFn())) * 0.5;
  return Math.round(exp * jitterFactor);
}

/**
 * Hardened transport fetch with:
 * - Request timeout (AbortController)
 * - Exponential backoff with jitter on transient 502/503/504/408 and network failures
 * - Zero retries on 4xx client/auth/policy responses
 * - Idempotency safety: mutating methods only retry when `X-Idempotency-Key` is attached
 */
export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: ResilientFetchOptions
): Promise<Response> {
  const fn = opts?.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fn) {
    throw new Error("Fetch API unavailable");
  }

  const timeoutMs = opts?.timeoutMs ?? 12000;
  const maxRetries = Math.max(0, opts?.maxRetries ?? 2);
  const baseBackoffMs = opts?.baseBackoffMs ?? 350;
  const maxBackoffMs = opts?.maxBackoffMs ?? 5000;
  const randomFn = opts?.randomFn ?? Math.random;
  const sleepFn = opts?.sleepFn ?? defaultSleep;

  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers || {});
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const hasIdempotencyKey =
    headers.has("x-idempotency-key") || headers.has("X-Idempotency-Key");
  const canRetry = !isMutating || hasIdempotencyKey;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const externalSignal = init?.signal;
    let onAbort: (() => void) | null = null;
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        onAbort = () => controller.abort();
        externalSignal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
        : null;

    try {
      const response = await fn(input, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (timer) clearTimeout(timer);
      if (externalSignal && onAbort) externalSignal.removeEventListener("abort", onAbort);

      // Never retry 4xx client errors (400, 401, 403, 404, 409, 423, etc.)
      if (!TRANSIENT_HTTP_STATUSES.has(response.status)) {
        return response;
      }

      if (!canRetry || attempt === maxRetries) {
        return response;
      }

      const waitMs = computeBackoffWithJitterMs(attempt, baseBackoffMs, maxBackoffMs, randomFn);
      await sleepFn(waitMs);
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (externalSignal && onAbort) externalSignal.removeEventListener("abort", onAbort);
      lastError = err;

      // Do not retry if explicitly aborted by caller
      if (externalSignal?.aborted || !canRetry || attempt === maxRetries) {
        throw err;
      }

      const waitMs = computeBackoffWithJitterMs(attempt, baseBackoffMs, maxBackoffMs, randomFn);
      await sleepFn(waitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed after retries");
}

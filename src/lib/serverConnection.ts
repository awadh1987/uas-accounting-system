import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";

export const ROOT_CLOUD_URL = "https://qat.world";
export const ROOT_CLOUD_DOMAIN = "qat.world";

const TENANT_SLUG_INPUT_REGEX = /^[a-z0-9-]+$/;

export interface NetworkNavigatorLike {
  onLine?: boolean;
  connection?: {
    type?: string;
    effectiveType?: string;
  };
}

export interface ConnectionWindowLike {
  location?: {
    protocol?: string;
    hostname?: string;
    host?: string;
    origin?: string;
  };
  navigator?: NetworkNavigatorLike;
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: {
      Network?: {
        getStatus?: () => Promise<{ connected?: boolean; connectionType?: string }>;
      };
    };
  };
  UasAndroidNative?: {
    getLocalLanCandidates?: () => string | string[];
  };
}

export interface TenantEndpointProbeResult {
  ok: boolean;
  url: string;
  status: number;
  tenantId: string | null;
  tenantSlug: string | null;
  isTenantWorkspace: boolean;
  companyName: string | null;
  mixedContentBlocked?: boolean;
  error?: string;
}

export interface ConnectionSwitchWarningResult {
  hasWarning: boolean;
  requiresConfirmation: boolean;
  driftKind:
    | "none"
    | "root_or_other_subdomain"
    | "resolved_tenant_mismatch"
    | "lan_endpoint_change";
  expectedCloudUrl: string;
  targetUrl: string;
  activeTenantSlug: string | null;
  targetTenantSlug: string | null;
  offlineQueueCount: number;
  messageAr: string;
  messageEn: string;
}

export function normalizeConnectionUrl(url?: string | null): string {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/**
 * Normalizes a tenant slug (`^[a-z0-9-]+$`) and returns null for empty, invalid, or `"default"`.
 */
export function normalizeActiveTenantSlug(rawSlug?: string | null): string | null {
  const clean = String(rawSlug || "").trim().toLowerCase();
  if (!clean || clean === "default") return null;
  if (!TENANT_SLUG_INPUT_REGEX.test(clean)) return null;
  if (clean.startsWith("-") || clean.endsWith("-") || clean.includes("--")) return null;
  return clean;
}

/**
 * Resolves the tenant-aware Cloud origin URL:
 * - Returns `https://<slug>.qat.world` for any valid non-`"default"` slug.
 * - Preserves `currentOrigin` when it already matches `https://<slug>.qat.world`.
 * - Returns `https://qat.world` only when `tenantSlug` is `"default"` or unset.
 */
export function resolveTenantCloudUrl(
  tenantSlug?: string | null,
  currentOrigin?: string | null
): string {
  const slug = normalizeActiveTenantSlug(tenantSlug);
  if (!slug) {
    return ROOT_CLOUD_URL;
  }

  const canonicalUrl = `https://${slug}.${ROOT_CLOUD_DOMAIN}`;
  const rawOrigin = String(currentOrigin || "").trim().replace(/\/+$/, "");
  if (rawOrigin) {
    try {
      const parsed = new URL(rawOrigin);
      if (parsed.origin.toLowerCase() === canonicalUrl.toLowerCase()) {
        return canonicalUrl;
      }
    } catch {
      // Ignore malformed origin and return canonical tenant URL
    }
  }
  return canonicalUrl;
}

export function resolveActiveWorkspaceSlug(opts?: {
  tenantSlug?: string | null;
  profileTenantSlug?: string | null;
  licenseTenantSlug?: string | null;
  storedTenantId?: string | null;
  currentOriginOrHost?: string | null;
}): string | null {
  const rawHost = String(opts?.currentOriginOrHost || "").trim();
  if (rawHost) {
    let hostCandidate = rawHost;
    if (/^https?:\/\//i.test(rawHost)) {
      try {
        hostCandidate = new URL(rawHost).host;
      } catch {
        hostCandidate = rawHost;
      }
    }
    const fromHost = extractSubdomainSlugFromHost(hostCandidate);
    if (fromHost) return fromHost;
  }

  const candidates = [
    opts?.tenantSlug,
    opts?.profileTenantSlug,
    opts?.licenseTenantSlug,
    opts?.storedTenantId,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeActiveTenantSlug(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function isPrivateLanHostname(hostname?: string | null): boolean {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  if (host.endsWith(".local")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const m172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172) {
    const second = Number(m172[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

export function isPrivateLanOrigin(originOrUrl?: string | null): boolean {
  const raw = String(originOrUrl || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(normalizeConnectionUrl(raw));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isPrivateLanHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function collectLanDetectionCandidates(opts?: {
  currentOrigin?: string | null;
  savedLanUrl?: string | null;
  serverLanIps?: string[] | null;
  nativeCandidates?: string[] | null;
  defaultPort?: number;
}): string[] {
  const port = opts?.defaultPort ?? 3000;
  const seen = new Set<string>();
  const out: string[] = [];

  const pushCandidate = (raw?: string | null) => {
    const norm = normalizeConnectionUrl(raw);
    if (!norm) return;
    try {
      const parsed = new URL(norm);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      // Never treat public qat.world cloud origins or Capacitor localhost shell as LAN candidates
      if (
        parsed.hostname === ROOT_CLOUD_DOMAIN ||
        parsed.hostname.endsWith(`.${ROOT_CLOUD_DOMAIN}`) ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1"
      ) {
        return;
      }
      const cleanOrigin = parsed.origin.replace(/\/+$/, "");
      if (!seen.has(cleanOrigin)) {
        seen.add(cleanOrigin);
        out.push(cleanOrigin);
      }
    } catch {
      // Ignore malformed candidate
    }
  };

  if (isPrivateLanOrigin(opts?.currentOrigin)) {
    pushCandidate(opts?.currentOrigin);
  }

  if (opts?.savedLanUrl && isPrivateLanOrigin(opts.savedLanUrl)) {
    pushCandidate(opts.savedLanUrl);
  } else if (opts?.savedLanUrl) {
    // Allow explicit saved non-cloud custom host if user entered one
    pushCandidate(opts.savedLanUrl);
  }

  for (const item of opts?.nativeCandidates || []) {
    pushCandidate(item);
  }

  for (const ip of opts?.serverLanIps || []) {
    const cleanIp = String(ip || "").trim();
    if (isPrivateLanHostname(cleanIp)) {
      pushCandidate(`http://${cleanIp}:${port}`);
    }
  }

  return out;
}

export async function hasLocalNetworkConnection(
  winOverride?: ConnectionWindowLike
): Promise<boolean> {
  const win: ConnectionWindowLike | undefined =
    winOverride ??
    (typeof window !== "undefined" ? (window as unknown as ConnectionWindowLike) : undefined);
  const nav =
    win?.navigator ??
    (typeof navigator !== "undefined" ? (navigator as unknown as NetworkNavigatorLike) : undefined);

  if (nav && nav.onLine === false) {
    return false;
  }

  try {
    const capNetwork = win?.Capacitor?.Plugins?.Network;
    if (capNetwork?.getStatus) {
      const status = await capNetwork.getStatus();
      if (status && status.connected === false) {
        return false;
      }
      if (status?.connectionType && status.connectionType.toLowerCase() === "cellular") {
        return false;
      }
      return true;
    }
  } catch {
    // Fall back to navigator checks
  }

  const connType = nav?.connection?.type?.toLowerCase();
  if (connType === "none" || connType === "cellular") {
    return false;
  }

  return true;
}

export function isHttpsToHttpMixedContent(
  targetUrl: string,
  winOverride?: ConnectionWindowLike
): boolean {
  const win: ConnectionWindowLike | undefined =
    winOverride ??
    (typeof window !== "undefined" ? (window as unknown as ConnectionWindowLike) : undefined);
  const proto = (win?.location?.protocol || "").toLowerCase();
  const host = (win?.location?.hostname || "").toLowerCase();
  const isCapacitorNative =
    Boolean(win?.Capacitor?.isNativePlatform?.()) ||
    Boolean(win?.UasAndroidNative) ||
    proto === "capacitor:" ||
    proto === "file:" ||
    host === "localhost";
  if (isCapacitorNative) return false;
  return proto === "https:" && /^http:\/\//i.test(targetUrl.trim());
}

export async function probeTenantEndpoint(
  targetUrl: string,
  opts?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    win?: ConnectionWindowLike;
  }
): Promise<TenantEndpointProbeResult> {
  const cleanTarget = normalizeConnectionUrl(targetUrl);
  if (!cleanTarget) {
    return {
      ok: false,
      url: "",
      status: 0,
      tenantId: null,
      tenantSlug: null,
      isTenantWorkspace: false,
      companyName: null,
      error: "EMPTY_URL",
    };
  }

  if (isHttpsToHttpMixedContent(cleanTarget, opts?.win)) {
    return {
      ok: false,
      url: cleanTarget,
      status: 0,
      tenantId: null,
      tenantSlug: null,
      isTenantWorkspace: false,
      companyName: null,
      mixedContentBlocked: true,
      error: "MIXED_CONTENT_BLOCKED",
    };
  }

  const fn = opts?.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!fn) {
    return {
      ok: false,
      url: cleanTarget,
      status: 0,
      tenantId: null,
      tenantSlug: null,
      isTenantWorkspace: false,
      companyName: null,
      error: "FETCH_UNAVAILABLE",
    };
  }

  const timeoutMs = opts?.timeoutMs ?? 2500;
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fn(`${cleanTarget}/api/public/tenant`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    const rawSlug = typeof parsed?.tenantSlug === "string" ? parsed.tenantSlug : null;
    const rawTenantId = typeof parsed?.tenantId === "string" ? parsed.tenantId : null;
    const profile =
      parsed?.profile && typeof parsed.profile === "object"
        ? (parsed.profile as Record<string, unknown>)
        : null;
    const companyName =
      (typeof profile?.legalNameAr === "string" && profile.legalNameAr) ||
      (typeof profile?.legalNameEn === "string" && profile.legalNameEn) ||
      null;

    return {
      ok: res.ok && parsed !== null,
      url: cleanTarget,
      status: res.status,
      tenantId: rawTenantId,
      tenantSlug: normalizeActiveTenantSlug(rawSlug),
      isTenantWorkspace: Boolean(parsed?.isTenantWorkspace),
      companyName,
      error: res.ok ? undefined : typeof parsed?.error === "string" ? parsed.error : `HTTP_${res.status}`,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      url: cleanTarget,
      status: 0,
      tenantId: null,
      tenantSlug: null,
      isTenantWorkspace: false,
      companyName: null,
      error: isAbort ? "TIMEOUT" : err instanceof Error ? err.message : "NETWORK_ERROR",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function detectReachableLanEndpoint(opts?: {
  currentOrigin?: string | null;
  savedLanUrl?: string | null;
  serverLanIps?: string[] | null;
  nativeCandidates?: string[] | null;
  expectedTenantSlug?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  win?: ConnectionWindowLike;
}): Promise<{
  detectedUrl: string | null;
  probe: TenantEndpointProbeResult | null;
  checkedCandidates: string[];
}> {
  const connected = await hasLocalNetworkConnection(opts?.win);
  if (!connected) {
    return { detectedUrl: null, probe: null, checkedCandidates: [] };
  }

  let nativeList = [...(opts?.nativeCandidates || [])];
  try {
    const fromNative = opts?.win?.UasAndroidNative?.getLocalLanCandidates?.();
    if (Array.isArray(fromNative)) {
      nativeList = nativeList.concat(fromNative.map(String));
    } else if (typeof fromNative === "string" && fromNative.trim()) {
      const parsed = JSON.parse(fromNative);
      if (Array.isArray(parsed)) {
        nativeList = nativeList.concat(parsed.map(String));
      }
    }
  } catch {
    // Ignore optional native hook parse errors
  }

  const candidates = collectLanDetectionCandidates({
    currentOrigin: opts?.currentOrigin,
    savedLanUrl: opts?.savedLanUrl,
    serverLanIps: opts?.serverLanIps,
    nativeCandidates: nativeList,
  });

  if (candidates.length === 0) {
    return { detectedUrl: null, probe: null, checkedCandidates: [] };
  }

  const timeoutMs = opts?.timeoutMs ?? 1500;
  const results = await Promise.all(
    candidates.map((candidate) =>
      probeTenantEndpoint(candidate, {
        timeoutMs,
        fetchImpl: opts?.fetchImpl,
        win: opts?.win,
      })
    )
  );

  const expectedSlug = normalizeActiveTenantSlug(opts?.expectedTenantSlug);
  const matchingTenant = expectedSlug
    ? results.find((r) => r.ok && r.tenantSlug === expectedSlug)
    : undefined;
  const firstReachable = matchingTenant || results.find((r) => r.ok) || null;

  return {
    detectedUrl: firstReachable ? firstReachable.url : null,
    probe: firstReachable,
    checkedCandidates: candidates,
  };
}

export function evaluateConnectionOriginSwitch(opts: {
  activeTenantSlug?: string | null;
  targetUrl?: string | null;
  currentOrigin?: string | null;
  offlineQueueCount?: number;
  targetResolvedTenantSlug?: string | null;
  targetIsTenantWorkspace?: boolean;
}): ConnectionSwitchWarningResult {
  const activeSlug = normalizeActiveTenantSlug(opts.activeTenantSlug);
  const expectedCloudUrl = resolveTenantCloudUrl(activeSlug, opts.currentOrigin);
  const normalizedTarget = normalizeConnectionUrl(opts.targetUrl);
  const offlineQueueCount = Math.max(0, Number(opts.offlineQueueCount || 0));

  if (!activeSlug) {
    const resolvedSlug = normalizeActiveTenantSlug(opts.targetResolvedTenantSlug);
    if (resolvedSlug) {
      return {
        hasWarning: true,
        requiresConfirmation: true,
        driftKind: "resolved_tenant_mismatch",
        expectedCloudUrl,
        targetUrl: normalizedTarget,
        activeTenantSlug: null,
        targetTenantSlug: resolvedSlug,
        offlineQueueCount,
        messageAr: `تحذير: الخادم الهدف (${normalizedTarget}) يتبع منشأة "${resolvedSlug}" بينما جلستك الحالية على النطاق الرئيسي الافتراضي (qat.world).`,
        messageEn: `Warning: Target endpoint (${normalizedTarget}) resolves to tenant "${resolvedSlug}" while your current session is on the default root portal (qat.world).`,
      };
    }

    return {
      hasWarning: false,
      requiresConfirmation: false,
      driftKind: "none",
      expectedCloudUrl,
      targetUrl: normalizedTarget || expectedCloudUrl,
      activeTenantSlug: null,
      targetTenantSlug: null,
      offlineQueueCount,
      messageAr: "",
      messageEn: "",
    };
  }

  let targetHostSlug: string | null = null;
  let targetHostIsRootCloud = false;
  let targetIsLan = false;
  if (normalizedTarget) {
    try {
      const parsed = new URL(normalizedTarget);
      const hostname = parsed.hostname.toLowerCase();
      targetHostSlug = extractSubdomainSlugFromHost(parsed.host);
      targetHostIsRootCloud = hostname === ROOT_CLOUD_DOMAIN || hostname === `www.${ROOT_CLOUD_DOMAIN}`;
      targetIsLan = isPrivateLanHostname(hostname);
    } catch {
      targetHostSlug = null;
    }
  }

  const resolvedProbeSlug =
    opts.targetResolvedTenantSlug !== undefined
      ? normalizeActiveTenantSlug(opts.targetResolvedTenantSlug)
      : undefined;

  const queueNoteAr =
    offlineQueueCount > 0
      ? ` لديك ${offlineQueueCount} عملية محلية غير مزامنة في قائمة الانتظار وقد تتأثر أو تتوقف مزامنتها عند تغيير الأصل أو قاعدة البيانات.`
      : " قد يؤدي تغيير الأصل/النطاق إلى تبديل قاعدة البيانات وتعذر مزامنة العمليات المحلية المعلقة في قائمة الأوفلاين.";
  const queueNoteEn =
    offlineQueueCount > 0
      ? ` You have ${offlineQueueCount} un-synced local offline queue item(s) that may fail to sync or become isolated after switching origin/database.`
      : " Changing origin switches the target database and can strand or reject un-synced local offline queue items.";

  // 1. Switching from <activeSlug>.qat.world to root qat.world or another subdomain
  if (normalizedTarget && (targetHostIsRootCloud || (targetHostSlug && targetHostSlug !== activeSlug))) {
    const targetDesc = targetHostIsRootCloud ? ROOT_CLOUD_URL : normalizedTarget;
    return {
      hasWarning: true,
      requiresConfirmation: true,
      driftKind: "root_or_other_subdomain",
      expectedCloudUrl,
      targetUrl: normalizedTarget,
      activeTenantSlug: activeSlug,
      targetTenantSlug: targetHostSlug,
      offlineQueueCount,
      messageAr: `تحذير انحراف النطاق: أنت مسجل حالياً في مساحة منشأة "${activeSlug}" (${expectedCloudUrl}). الانتقال إلى "${targetDesc}" سيغير الخادم وقاعدة البيانات المستهدفة.${queueNoteAr}`,
      messageEn: `Subdomain Drift Warning: You are signed into tenant "${activeSlug}" (${expectedCloudUrl}). Switching to "${targetDesc}" changes the active origin and database.${queueNoteEn}`,
    };
  }

  // 2. Probed /api/public/tenant resolved to a different tenant than activeSlug
  if (
    resolvedProbeSlug !== undefined &&
    resolvedProbeSlug !== activeSlug &&
    (!targetIsLan || resolvedProbeSlug !== null)
  ) {
    return {
      hasWarning: true,
      requiresConfirmation: true,
      driftKind: "resolved_tenant_mismatch",
      expectedCloudUrl,
      targetUrl: normalizedTarget,
      activeTenantSlug: activeSlug,
      targetTenantSlug: resolvedProbeSlug,
      offlineQueueCount,
      messageAr: `تحذير عدم تطابق المنشأة: الخادم (${normalizedTarget}) استجاب ببيانات منشأة "${resolvedProbeSlug || "default"}" بدلاً من منشأتك النشطة "${activeSlug}".${queueNoteAr}`,
      messageEn: `Tenant Mismatch Warning: Endpoint (${normalizedTarget}) resolved to "${resolvedProbeSlug || "default"}" instead of your active workspace "${activeSlug}".${queueNoteEn}`,
    };
  }

  return {
    hasWarning: false,
    requiresConfirmation: false,
    driftKind: "none",
    expectedCloudUrl,
    targetUrl: normalizedTarget || expectedCloudUrl,
    activeTenantSlug: activeSlug,
    targetTenantSlug: resolvedProbeSlug ?? targetHostSlug ?? activeSlug,
    offlineQueueCount,
    messageAr: "",
    messageEn: "",
  };
}

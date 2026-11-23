import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractSubdomainSlugFromHost, validateTenantSlug } from "./tenantSlug";
import { extractSessionTokenFromRequest } from "@/lib/authSession";

export interface TenantContext {
  tenantId: string;
  slug?: string;
  companyName?: string;
  prisma: PrismaClient;
}

export type TenantResolutionSource =
  | "subdomain"
  | "header"
  | "session"
  | "query"
  | "body"
  | "default";

export interface TenantResolutionResult {
  tenantId: string;
  slug: string | null;
  source: TenantResolutionSource;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Normalizes a raw tenant identifier into a clean, safe slug.
 * Examples:
 * - "مؤسسة القات للتجارة" -> "al_qat" or sanitized hash
 * - "Company 123" -> "company_123"
 * - "ahmed.awadh@qat.world" -> "qat_world"
 * - "" / null / undefined -> "default"
 */
export function normalizeTenantId(raw?: string | null): string {
  if (!raw) return "default";
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "default") return "default";

  // If email passed as tenant, extract domain part
  let candidate = trimmed;
  if (candidate.includes("@")) {
    candidate = candidate.split("@")[1] || candidate;
  }

  // Convert Arabic/Unicode or special chars into clean safe ASCII-alphanumeric + underscore
  const slug = candidate
    .replace(/[.\s\-/]+/g, "_")
    .replace(/[^a-z0-9_\u0600-\u06FF]/gi, "")
    .replace(/_+/g, "_")
    .slice(0, 48);

  return slug || "default";
}

/**
 * Deterministic tenant resolution following exact priority order:
 * 1. Subdomain `<slug>.qat.world` from `X-Forwarded-Host` / `Host` / URL
 * 2. Explicit `x-uas-tenant-id` (or alias) header
 * 3. Authenticated session/token tenant binding (`x-uas-session-tenant`, `uas_tenant_id` cookie)
 * 4. Query param / body fallback
 * 5. `"default"`
 */
export function extractTenantResolutionFromRequest(
  req?: NextRequest | Request,
  body?: Record<string, unknown>
): TenantResolutionResult {
  if (req) {
    const headers = req.headers;

    // 1. Subdomain from X-Forwarded-Host / Host / request URL
    const forwardedHost = headers.get("x-forwarded-host");
    const hostHeader = headers.get("host");
    let urlHost = "";
    try {
      urlHost = new URL(req.url, "http://localhost").host;
    } catch {
      urlHost = "";
    }
    const subSlug =
      extractSubdomainSlugFromHost(forwardedHost) ||
      extractSubdomainSlugFromHost(hostHeader) ||
      extractSubdomainSlugFromHost(urlHost);
    if (subSlug) {
      return {
        tenantId: normalizeTenantId(subSlug),
        slug: subSlug,
        source: "subdomain",
      };
    }

    // 2. Explicit header (Desktop / Mobile / API / LAN clients)
    const headerTenant =
      headers.get("x-uas-tenant-id") ||
      headers.get("x-tenant-id") ||
      headers.get("x-uas-company-id") ||
      headers.get("x-uas-company") ||
      headers.get("x-uas-resolved-tenant");
    if (headerTenant) {
      const slugCheck = validateTenantSlug(headerTenant);
      return {
        tenantId: normalizeTenantId(headerTenant),
        slug: slugCheck.valid ? slugCheck.normalized : null,
        source: "header",
      };
    }

    // 3. Authenticated session/token tenant binding
    const verifiedSession = extractSessionTokenFromRequest(req);
    if (verifiedSession.payload?.tid && verifiedSession.payload.tid !== "default") {
      const slugCheck = validateTenantSlug(verifiedSession.payload.tid);
      return {
        tenantId: normalizeTenantId(verifiedSession.payload.tid),
        slug: slugCheck.valid ? slugCheck.normalized : null,
        source: "session",
      };
    }

    const sessionHeader = headers.get("x-uas-session-tenant");
    if (sessionHeader && sessionHeader.trim()) {
      const slugCheck = validateTenantSlug(sessionHeader);
      return {
        tenantId: normalizeTenantId(sessionHeader),
        slug: slugCheck.valid ? slugCheck.normalized : null,
        source: "session",
      };
    }

    if ("cookies" in req && typeof req.cookies?.get === "function") {
      const cookieTenant = req.cookies.get("uas_tenant_id")?.value;
      if (cookieTenant) {
        const slugCheck = validateTenantSlug(cookieTenant);
        return {
          tenantId: normalizeTenantId(cookieTenant),
          slug: slugCheck.valid ? slugCheck.normalized : null,
          source: "session",
        };
      }
    }

    // 4a. Query parameter fallback
    try {
      const url = new URL(req.url, "http://localhost");
      const queryTenant =
        url.searchParams.get("slug") ||
        url.searchParams.get("tenantId") ||
        url.searchParams.get("tenant") ||
        url.searchParams.get("company");
      if (queryTenant) {
        const slugCheck = validateTenantSlug(queryTenant);
        return {
          tenantId: normalizeTenantId(queryTenant),
          slug: slugCheck.valid ? slugCheck.normalized : null,
          source: "query",
        };
      }
    } catch {
      // Ignore URL parse error
    }
  }

  // 4b. Body fallback
  if (body) {
    const bodyTenant =
      body.tenantId ||
      body.tenant ||
      body.companyId ||
      body.companyName;
    if (typeof bodyTenant === "string" && bodyTenant.trim()) {
      const slugCheck = validateTenantSlug(bodyTenant);
      return {
        tenantId: normalizeTenantId(bodyTenant),
        slug: slugCheck.valid ? slugCheck.normalized : null,
        source: "body",
      };
    }
  }

  return { tenantId: "default", slug: null, source: "default" };
}

/**
 * Extracts tenant identifier from NextRequest headers, query params, cookies or body.
 */
export function extractTenantIdFromRequest(
  req?: NextRequest | Request,
  body?: Record<string, unknown>
): string {
  return extractTenantResolutionFromRequest(req, body).tenantId;
}

/**
 * Retrieves the active tenant context from AsyncLocalStorage.
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/**
 * Returns the currently active tenant ID (defaults to "default").
 */
export function getActiveTenantId(): string {
  return tenantStorage.getStore()?.tenantId || "default";
}

/**
 * Executes an async callback within an explicit TenantContext.
 */
export function runWithTenantContext<T>(
  context: TenantContext,
  fn: () => Promise<T>
): Promise<T> {
  return tenantStorage.run(context, fn);
}

/**
 * Executes an async callback with the resolved PrismaClient for a given tenant ID.
 */
export async function runWithTenant<T>(
  tenantId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const normTenant = normalizeTenantId(tenantId);
  const { getTenantPrisma } = await import("./tenantDbManager");
  const tenantPrisma = await getTenantPrisma(normTenant);

  const context: TenantContext = {
    tenantId: normTenant,
    prisma: tenantPrisma,
  };

  return tenantStorage.run(context, fn);
}

/**
 * Higher-order helper for Next.js App Router route handlers.
 * Automatically resolves tenant from request, sets TenantContext in AsyncLocalStorage,
 * enforces per-tenant device access governance (`403 DEVICE_REVOKED` / `DEVICE_LOCKED`),
 * and sets `x-uas-tenant-id` / `x-uas-tenant-slug` in response headers.
 */
export function withTenantRoute<Args extends unknown[]>(
  handler: (req: NextRequest, ...args: Args) => Promise<NextResponse>
): (req: NextRequest, ...args: Args) => Promise<NextResponse> {
  return async (req: NextRequest, ...args: Args): Promise<NextResponse> => {
    const resolution = extractTenantResolutionFromRequest(req);
    const tenantId = resolution.tenantId;
    return runWithTenant(tenantId, async () => {
      let pathname = "";
      try {
        pathname = req.nextUrl?.pathname || new URL(req.url, "http://localhost").pathname;
      } catch {
        pathname = "";
      }
      const deviceId = (req.headers.get("x-uas-device-id") || "").trim();
      if (deviceId) {
        const isExempt =
          pathname.startsWith("/api/public/") ||
          pathname.startsWith("/api/auth/logout") ||
          pathname.startsWith("/api/devices") ||
          pathname.startsWith("/api/licensing/") ||
          pathname.startsWith("/api/control-panel/") ||
          pathname.startsWith("/api/superadmin/");
        if (!isExempt) {
          try {
            const ctx = getTenantContext();
            const device = await ctx?.prisma.tenantDevice.findUnique({
              where: { deviceId },
              select: { status: true },
            });
            if (device?.status === "REVOKED") {
              return NextResponse.json(
                {
                  error:
                    "تم إلغاء صلاحية هذا الجهاز من قبل مسؤول المنشأة / This device has been revoked by tenant administrator.",
                  code: "DEVICE_REVOKED",
                  clearCredentials: true,
                },
                {
                  status: 403,
                  headers: {
                    "x-uas-tenant-id": tenantId,
                    ...(resolution.slug ? { "x-uas-tenant-slug": resolution.slug } : {}),
                  },
                }
              );
            }
            if (device?.status === "SUSPENDED") {
              return NextResponse.json(
                {
                  error:
                    "تم إيقاف/قفل هذا الجهاز مؤقتاً من قبل مسؤول المنشأة / This device is suspended by tenant administrator.",
                  code: "DEVICE_LOCKED",
                },
                {
                  status: 403,
                  headers: {
                    "x-uas-tenant-id": tenantId,
                    ...(resolution.slug ? { "x-uas-tenant-slug": resolution.slug } : {}),
                  },
                }
              );
            }
          } catch {
            // Do not break requests if TenantDevice table is unavailable during early bootstrap
          }
        }
      }

      const isExemptForTenantStatus =
        pathname.startsWith("/api/public/") ||
        pathname.startsWith("/api/auth/logout") ||
        pathname.startsWith("/api/licensing/") ||
        pathname.startsWith("/api/control-panel/") ||
        pathname.startsWith("/api/superadmin/");

      if (tenantId !== "default" && !isExemptForTenantStatus) {
        try {
          const [{ getTenantMetadata }, { evaluateLicenseGovernance }] = await Promise.all([
            import("./tenantRegistry"),
            import("@/lib/controlPanel/governanceStore"),
          ]);
          const meta = getTenantMetadata(tenantId);
          const gov = evaluateLicenseGovernance({
            slug: meta?.slug || tenantId,
            licenseId: meta?.licenseId || null,
            registryStatus: meta?.status || null,
          });
          if (!gov.allowed && (gov.status === "SUSPENDED" || gov.status === "REVOKED")) {
            return NextResponse.json(
              {
                error: gov.error,
                code: gov.code || `TENANT_${gov.status}`,
                status: gov.status,
              },
              {
                status: 403,
                headers: {
                  "x-uas-tenant-id": tenantId,
                  ...(resolution.slug ? { "x-uas-tenant-slug": resolution.slug } : {}),
                },
              }
            );
          }
        } catch {
          // Non-fatal fallback
        }
      }

      const res = await handler(req, ...args);
      try {
        res.headers.set("x-uas-tenant-id", tenantId);
        if (resolution.slug) {
          res.headers.set("x-uas-tenant-slug", resolution.slug);
        }
      } catch {
        // Response may be immutable in some contexts
      }
      return res;
    });
  };
}

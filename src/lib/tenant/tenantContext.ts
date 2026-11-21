import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export interface TenantContext {
  tenantId: string;
  companyName?: string;
  prisma: PrismaClient;
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
 * Extracts tenant identifier from NextRequest headers, query params, cookies or body.
 */
export function extractTenantIdFromRequest(
  req?: NextRequest | Request,
  body?: Record<string, unknown>
): string {
  if (req) {
    const headers = req.headers;
    const headerTenant =
      headers.get("x-uas-tenant-id") ||
      headers.get("x-tenant-id") ||
      headers.get("x-uas-company-id") ||
      headers.get("x-uas-company");
    if (headerTenant) return normalizeTenantId(headerTenant);

    try {
      const url = new URL(req.url);
      const queryTenant =
        url.searchParams.get("tenantId") ||
        url.searchParams.get("tenant") ||
        url.searchParams.get("company");
      if (queryTenant) return normalizeTenantId(queryTenant);
    } catch {
      // Ignore URL parse error
    }

    if ("cookies" in req && typeof req.cookies?.get === "function") {
      const cookieTenant = req.cookies.get("uas_tenant_id")?.value;
      if (cookieTenant) return normalizeTenantId(cookieTenant);
    }
  }

  if (body) {
    const bodyTenant =
      body.tenantId ||
      body.tenant ||
      body.companyId ||
      body.companyName;
    if (typeof bodyTenant === "string" && bodyTenant.trim()) {
      return normalizeTenantId(bodyTenant);
    }
  }

  return "default";
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
 * and sets `x-uas-tenant-id` in response headers.
 */
export function withTenantRoute<
  T extends (req: NextRequest, context?: any) => Promise<NextResponse>
>(handler: T): T {
  return (async (req: NextRequest, context?: any) => {
    const tenantId = extractTenantIdFromRequest(req);
    return runWithTenant(tenantId, async () => {
      const res = await handler(req, context);
      try {
        res.headers.set("x-uas-tenant-id", tenantId);
      } catch {
        // Response may be immutable in some contexts
      }
      return res;
    });
  }) as T;
}

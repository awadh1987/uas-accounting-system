import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";

const ALLOWED_CORS_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "https://qat.world",
  "https://www.qat.world",
]);

export function isAllowedCorsOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_CORS_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host))
    ) {
      return true;
    }
    if (parsed.protocol === "https:" && host.endsWith(".qat.world")) {
      return Boolean(extractSubdomainSlugFromHost(parsed.host));
    }
  } catch {
    return false;
  }
  return false;
}

export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const trustedOrigin = Boolean(origin && isAllowedCorsOrigin(origin));
  const allowOrigin = trustedOrigin && origin ? origin : !origin ? "*" : "https://qat.world";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    ...(trustedOrigin ? { "Access-Control-Allow-Credentials": "true" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, x-uas-seat-token, x-uas-device-name, x-uas-device-id, x-uas-platform, x-uas-app-version, x-uas-os-version, x-uas-user-id, x-uas-role, x-uas-user-display, x-uas-tenant-id, x-tenant-id, x-uas-company-id, x-uas-session-tenant, x-uas-session-token, x-uas-client-token, x-uas-license-key, x-idempotency-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Host, X-Forwarded-Host",
  };
}

export function corsOptionsResponse(req: NextRequest | Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(req.headers.get("origin")),
  });
}

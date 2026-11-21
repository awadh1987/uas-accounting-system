import { NextRequest, NextResponse } from "next/server";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";

const ALLOWED_CORS_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "https://qat.world",
  "https://www.qat.world",
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_CORS_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "https:" && parsed.hostname.endsWith(".qat.world")) {
      return Boolean(extractSubdomainSlugFromHost(parsed.host));
    }
  } catch {
    return false;
  }
  return false;
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = origin && isAllowedOrigin(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, x-uas-seat-token, x-uas-device-name, x-uas-device-id, x-uas-platform, x-uas-app-version, x-uas-os-version, x-uas-user-id, x-uas-role, x-uas-user-display, x-uas-tenant-id, x-tenant-id, x-uas-company-id, x-uas-session-tenant, x-idempotency-key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin, Host, X-Forwarded-Host",
  };
}

export function proxy(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request.headers.get("origin"));
  const resolvedSlug =
    extractSubdomainSlugFromHost(request.headers.get("x-forwarded-host")) ||
    extractSubdomainSlugFromHost(request.headers.get("host"));

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const requestHeaders = new Headers(request.headers);
  if (resolvedSlug && !requestHeaders.has("x-uas-resolved-tenant")) {
    requestHeaders.set("x-uas-resolved-tenant", resolvedSlug);
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  if (resolvedSlug) {
    response.headers.set("x-uas-tenant-slug", resolvedSlug);
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};


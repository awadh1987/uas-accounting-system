import { NextRequest, NextResponse } from "next/server";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";
import { buildCorsHeaders } from "@/lib/cors";

export function proxy(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const corsHeaders = isApiRoute ? buildCorsHeaders(request.headers.get("origin")) : {};
  const resolvedSlug =
    extractSubdomainSlugFromHost(request.headers.get("x-forwarded-host")) ||
    extractSubdomainSlugFromHost(request.headers.get("host"));

  if (isApiRoute && request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const requestHeaders = new Headers(request.headers);
  if (resolvedSlug) {
    // Authoritatively bind subdomain slug from Host/X-Forwarded-Host so spoofed client headers cannot override it.
    requestHeaders.set("x-uas-resolved-tenant", resolvedSlug);
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  response.headers.append("Vary", "Host, X-Forwarded-Host");
  if (resolvedSlug) {
    response.headers.set("x-uas-tenant-slug", resolvedSlug);
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/", "/portal"],
};

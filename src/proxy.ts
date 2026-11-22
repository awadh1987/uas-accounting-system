import { NextRequest, NextResponse } from "next/server";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";
import { buildCorsHeaders } from "@/lib/cors";

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

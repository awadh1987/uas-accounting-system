import { NextRequest } from "next/server";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import {
  extractSubdomainSlugFromHost,
  extractTenantResolutionFromRequest,
  findTenantBySlug,
  getTenantMetadata,
  resolveTenantBySlugAsync,
  syncTenantRegistryWithDb,
} from "@/lib/tenant";

export interface PublicTenantLookupResult {
  found: boolean;
  tenantId: string;
  resolvedSlug: string | null;
  resolutionSource: string;
  explicitQuerySlug: string;
}

export async function resolvePublicTenantFromRequest(
  req: NextRequest
): Promise<PublicTenantLookupResult> {
  if (isSqliteRuntime()) {
    await ensureSqliteDatabaseReady();
  } else {
    await syncTenantRegistryWithDb().catch(() => { });
  }

  const hostSubSlug =
    extractSubdomainSlugFromHost(req.headers.get("x-forwarded-host")) ||
    extractSubdomainSlugFromHost(req.headers.get("host")) ||
    extractSubdomainSlugFromHost(new URL(req.url, "http://localhost").host);

  const url = new URL(req.url, "http://localhost");
  const explicitQuerySlug = (url.searchParams.get("slug") || "").trim().toLowerCase();

  if (!hostSubSlug && explicitQuerySlug) {
    if (explicitQuerySlug === "default") {
      return {
        found: true,
        tenantId: "default",
        resolvedSlug: null,
        resolutionSource: "query",
        explicitQuerySlug,
      };
    }

    const matched = (await resolveTenantBySlugAsync(explicitQuerySlug)) || findTenantBySlug(explicitQuerySlug);
    if (!matched || matched.status !== "ACTIVE") {
      return {
        found: false,
        tenantId: "default",
        resolvedSlug: explicitQuerySlug,
        resolutionSource: "query",
        explicitQuerySlug,
      };
    }

    return {
      found: true,
      tenantId: matched.tenantId,
      resolvedSlug: matched.slug || explicitQuerySlug,
      resolutionSource: "query",
      explicitQuerySlug,
    };
  }

  const resolution = extractTenantResolutionFromRequest(req);
  const meta =
    (resolution.slug ? await resolveTenantBySlugAsync(resolution.slug) : null) ||
    getTenantMetadata(resolution.tenantId);
  return {
    found: true,
    tenantId: meta?.tenantId || resolution.tenantId,
    resolvedSlug:
      resolution.slug || (meta?.slug && meta.slug !== "default" ? meta.slug : null),
    resolutionSource: resolution.source,
    explicitQuerySlug,
  };
}

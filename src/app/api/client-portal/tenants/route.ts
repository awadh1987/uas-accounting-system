import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import { listClientTenantMemberships } from "@/lib/clientPortal/globalClientService";
import { buildTenantWorkspaceUrl, listRegisteredTenants, syncTenantRegistryWithDb } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/client-portal/tenants
 * Returns all tenant memberships linked to the authenticated client's Global Identity
 * (for the "My Tenants / Workspace Switcher") plus available active workspaces.
 */
export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    await syncTenantRegistryWithDb().catch(() => {});

    const memberships = await listClientTenantMemberships({
      globalClientId: auth.account.globalClientId,
      normalizedPhone: auth.account.normalizedPhone || auth.account.phone,
      normalizedEmail: auth.account.normalizedEmail || auth.account.email,
    });

    const joinedSlugs = new Set(memberships.map((m) => m.tenantSlug.toLowerCase()));
    const availableTenants = listRegisteredTenants()
      .filter(
        (t) =>
          t.status === "ACTIVE" &&
          t.slug &&
          t.slug !== "default" &&
          !t.slug.includes("-test-") &&
          !joinedSlugs.has(t.slug.toLowerCase())
      )
      .slice(0, 50)
      .map((t) => ({
        slug: t.slug,
        tenantId: t.tenantId,
        nameAr: t.nameAr || t.companyName || t.slug,
        nameEn: t.nameEn || t.companyName || t.slug,
        tenantUrl: t.tenantUrl || buildTenantWorkspaceUrl(t.slug),
      }));

    return NextResponse.json({
      success: true,
      activeTenantSlug: auth.scope.tenantSlug,
      globalClientId: auth.account.globalClientId ?? null,
      memberships,
      availableTenants,
    });
  } catch (err) {
    console.error("GET /api/client-portal/tenants error:", err);
    return jsonError("تعذر تحميل قائمة المنشآت المسجلة", 500);
  }
});

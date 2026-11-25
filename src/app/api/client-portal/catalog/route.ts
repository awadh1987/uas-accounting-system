import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { listPublishedClientCatalogBoard } from "@/lib/clientPortal/catalogBoard";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import { isSectorAllowed } from "@/lib/clientPortal/portalPolicy";
import { resolveClientSectorAccess } from "@/lib/clientPortal/portalService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/client-portal/catalog
 * Public / client-facing tenant-scoped pricing, grading & availability board.
 * Returns strictly published items (isPublished = true) with zero purchasePrice,
 * internal cost, profit margin, or cross-tenant data.
 */
export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const scope = resolveRequestTenantScope(req);
    const { items: allItems, stats } = await listPublishedClientCatalogBoard();
    let items = allItems;
    // Authenticated clients only receive catalog items of sectors enabled for their account (403 on explicit forbidden sector).
    const auth = await resolveAuthenticatedClient(req);
    if (auth.ok) {
      const access = await resolveClientSectorAccess(auth.account);
      const wanted = (new URL(req.url).searchParams.get("sectorType") || "").trim().toUpperCase();
      if (wanted && !isSectorAllowed(access.sectorMode, wanted)) {
        return jsonError("⛔ هذا القطاع غير متاح لحسابك", 403);
      }
      items = allItems.filter((it) => isSectorAllowed(access.sectorMode, it.sectorType || "HARVEST"));
    }

    return NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      items,
      stats,
    });
  } catch (err) {
    console.error("GET /api/client-portal/catalog error:", err);
    return jsonError("تعذر تحميل قائمة الأصناف والأسعار المنشورة", 500);
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { listPublishedClientCatalogBoard } from "@/lib/clientPortal/catalogBoard";

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
    const { items, stats } = await listPublishedClientCatalogBoard();

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

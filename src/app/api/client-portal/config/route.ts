import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { getTenantFormConfig } from "@/lib/clientPortal/portalConfig";
import { resolveEffectiveBrandInfo } from "@/lib/branding";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/client-portal/config
 * Public tenant-scoped endpoint returning portal form configuration, tenant branding,
 * and client-facing sellable items ONLY (zero purchasePrice / cost / vendor / secrets).
 */
export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const scope = resolveRequestTenantScope(req);
    const [formConfig, profile, catalogItems] = await Promise.all([
      getTenantFormConfig(),
      prisma.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null),
      prisma.inventoryItem.findMany({
        where: { isActive: true },
        select: {
          id: true,
          sku: true,
          nameAr: true,
          nameEn: true,
          grade: true,
          origin: true,
          wholesalePrice: true,
          retailPrice: true,
          baseUnit: { select: { code: true, nameAr: true, nameEn: true } },
        },
        orderBy: { nameAr: "asc" },
        take: 150,
      }),
    ]);

    const brand = resolveEffectiveBrandInfo(profile, scope.tenantSlug === "default" ? null : scope.tenantSlug);

    return NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      tenantNameAr: profile?.legalNameAr || "النظام المحاسبي الموحد",
      tenantNameEn: profile?.legalNameEn || "Unified Accounting System",
      brandColor: profile?.brandColor || "#059669",
      effectiveLogoUrl: brand.effectiveLogoUrl,
      contactPhone: profile?.contactPhone || "",
      contactAddress: profile?.contactAddress || "",
      formConfig,
      items: catalogItems.map((it) => ({
        id: it.id,
        sku: it.sku,
        nameAr: it.nameAr,
        nameEn: it.nameEn,
        grade: it.grade,
        origin: it.origin,
        unitPrice: Number(it.wholesalePrice || it.retailPrice || 0),
        baseUnit: it.baseUnit,
      })),
    });
  } catch (err) {
    console.error("GET /api/client-portal/config error:", err);
    return jsonError("تعذر تحميل إعدادات بوابة العملاء", 500);
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import {
  deleteStaffCatalogBoardItem,
  listStaffCatalogBoard,
  seedCatalogBoardFromInventory,
  setCatalogBoardPublishState,
  upsertStaffCatalogBoardItem,
} from "@/lib/clientPortal/catalogBoard";
import {
  publishHarvestBatchesToCatalogBoard,
  syncPublishedCatalogStockTx,
} from "@/lib/clientPortal/catalogStockSync";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/portal-admin/catalog
 * Authorized staff endpoint for preparing, grading, pricing, and publishing
 * the tenant-scoped Client Portal Pricing & Availability Board.
 */
export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "sales" });
    if (!auth.ok) return auth.response;

    const scope = resolveRequestTenantScope(req);
    const data = await listStaffCatalogBoard();

    return NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      ...data,
    });
  } catch (err) {
    console.error("GET /api/portal-admin/catalog error:", err);
    return jsonError("تعذر تحميل لوحة إعداد الأصناف والأسعار", 500);
  }
});

/**
 * POST /api/portal-admin/catalog
 * Actions: UPSERT | PUBLISH | UNPUBLISH | SEED_FROM_INVENTORY | DELETE
 */
export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "UPSERT").trim().toUpperCase();

    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: action === "DELETE" ? "delete" : body.id ? "edit" : "create",
    });
    if (!auth.ok) return auth.response;

    const scope = resolveRequestTenantScope(req);
    const actor = {
      userId: auth.actor.userId,
      userDisplay: auth.actor.userDisplay || "موظف المبيعات",
      userRole: auth.actor.userRole,
    };

    if (action === "PUBLISH" || action === "UNPUBLISH") {
      const ids = Array.isArray(body.ids)
        ? body.ids.map((x) => String(x || "")).filter(Boolean)
        : body.id
        ? [String(body.id)]
        : [];
      const res = await setCatalogBoardPublishState({
        ids,
        publish: action === "PUBLISH",
        freshnessLabel: body.freshnessLabel ? String(body.freshnessLabel) : undefined,
        effectiveDate: body.effectiveDate ? String(body.effectiveDate) : undefined,
        validityNote:
          body.validityNote !== undefined ? String(body.validityNote || "") : undefined,
        tenantSlug: scope.tenantSlug,
        actor,
      });
      return NextResponse.json({
        success: true,
        updatedCount: res.count,
        message:
          action === "PUBLISH"
            ? `✅ تم نشر ${res.count} صنفاً على بوابة العملاء بنجاح`
            : `✅ تم إخفاء ${res.count} صنفاً من بوابة العملاء (مسودة داخلية)`,
      });
    }

    if (action === "SYNC_FROM_HARVEST") {
      const batchIds = Array.isArray(body.batchIds)
        ? body.batchIds.map((x) => String(x || "")).filter(Boolean)
        : undefined;
      const synced = await publishHarvestBatchesToCatalogBoard({
        batchIds,
        publishImmediately: Boolean(body.publishImmediately ?? true),
        tenantSlug: scope.tenantSlug,
        actor,
      });
      return NextResponse.json({
        success: true,
        syncedCount: synced.syncedCount,
        message: `✅ تم ربط ومزامنة ${synced.syncedCount} دفعة فرز ومخزون مع قائمة الأصناف والأسعار للعملاء`,
      });
    }

    if (action === "SYNC_STOCK") {
      const res = await syncPublishedCatalogStockTx();
      return NextResponse.json({
        success: true,
        updatedCount: res.updatedCount,
        message: `✅ تم تحديث الأرصدة الحية لعدد ${res.updatedCount} صنف في القائمة المنشورة`,
      });
    }

    if (action === "SEED_FROM_INVENTORY") {
      const seeded = await seedCatalogBoardFromInventory({
        tenantSlug: scope.tenantSlug,
        freshnessLabel: body.freshnessLabel ? String(body.freshnessLabel) : undefined,
        effectiveDate: body.effectiveDate ? String(body.effectiveDate) : undefined,
        actor,
      });
      return NextResponse.json({
        success: true,
        createdCount: seeded.createdCount,
        message:
          seeded.createdCount > 0
            ? `✅ تم استيراد ${seeded.createdCount} صنفاً كمسودات للمراجعة والنشر`
            : "لا توجد أصناف مخزون جديدة للاستيراد حالياً",
      });
    }

    if (action === "DELETE") {
      const id = String(body.id || "").trim();
      if (!id) return jsonError("معرف الصنف (id) مطلوب للحذف", 400);
      await deleteStaffCatalogBoardItem({ id, tenantSlug: scope.tenantSlug, actor });
      return NextResponse.json({
        success: true,
        message: "✅ تم حذف الصنف من لوحة الأسعار",
      });
    }

    const item = await upsertStaffCatalogBoardItem({
      id: body.id ? String(body.id) : undefined,
      inventoryItemId: body.inventoryItemId ? String(body.inventoryItemId) : null,
      harvestBatchId: body.harvestBatchId ? String(body.harvestBatchId) : null,
      projectId: body.projectId ? String(body.projectId) : null,
      harvestName: body.harvestName ? String(body.harvestName) : null,
      sku: body.sku ? String(body.sku) : null,
      titleAr: String(body.titleAr || ""),
      titleEn: body.titleEn ? String(body.titleEn) : null,
      gradeLabel: body.gradeLabel ? String(body.gradeLabel) : undefined,
      categoryLabel: body.categoryLabel ? String(body.categoryLabel) : undefined,
      sectorType: body.sectorType ? String(body.sectorType) : undefined,
      categoryGroup: body.categoryGroup ? String(body.categoryGroup) : undefined,
      saleMode: body.saleMode ? String(body.saleMode) : undefined,
      unitCode: body.unitCode ? String(body.unitCode) : undefined,
      unitLabel: body.unitLabel ? String(body.unitLabel) : undefined,
      customUnitLabel: body.customUnitLabel ? String(body.customUnitLabel) : null,
      unitPrice: Number(body.unitPrice ?? 0),
      bulkUnitLabel: body.bulkUnitLabel ? String(body.bulkUnitLabel) : null,
      partialUnitLabel: body.partialUnitLabel ? String(body.partialUnitLabel) : null,
      partialUnitPrice: body.partialUnitPrice !== undefined ? Number(body.partialUnitPrice) : undefined,
      multiplierToBase: body.multiplierToBase !== undefined ? Number(body.multiplierToBase) : undefined,
      publishedQty: body.publishedQty !== undefined && body.publishedQty !== null ? Number(body.publishedQty) : null,
      remainingQty: body.remainingQty !== undefined && body.remainingQty !== null ? Number(body.remainingQty) : null,
      lowStockThreshold: body.lowStockThreshold !== undefined ? Number(body.lowStockThreshold) : undefined,
      currency: body.currency ? String(body.currency) : "YER",
      availabilityStatus: body.availabilityStatus ? String(body.availabilityStatus) : undefined,
      pickupLocation: body.pickupLocation ? String(body.pickupLocation) : null,
      freshnessLabel: body.freshnessLabel ? String(body.freshnessLabel) : undefined,
      effectiveDate: body.effectiveDate ? String(body.effectiveDate) : null,
      validityNote: body.validityNote ? String(body.validityNote) : null,
      displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : undefined,
      isPublished: Boolean(body.isPublished),
      notes: body.notes ? String(body.notes) : null,
      tenantSlug: scope.tenantSlug,
      actor,
    });

    return NextResponse.json({
      success: true,
      item,
      message: item.isPublished
        ? `✅ تم حفظ ونشر (${item.titleAr}) للعملاء بنجاح`
        : `✅ تم حفظ مسودة (${item.titleAr}) للمراجعة الداخلية`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تحديث لوحة الأصناف والأسعار";
    return jsonError(msg, 400);
  }
});

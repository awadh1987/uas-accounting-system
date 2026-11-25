import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { listStaffCatalogBoard, upsertStaffCatalogBoardItem } from "@/lib/clientPortal/catalogBoard";
import { serializeRequest } from "@/lib/clientPortal/portalService";
import { syncPublishedCatalogStockTx } from "@/lib/clientPortal/catalogStockSync";
import { formatIsoToDmyTime } from "@/lib/uiFormatters";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { recordStockLayerInTx } from "@/lib/inventoryGlBridge";
import { postJournalEntry } from "@/lib/accounting/ledgerService";
import { convertToBaseQty } from "@/lib/multiUnitInventoryEngine";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "sales" });
    if (!auth.ok) return auth.response;

    const scope = resolveRequestTenantScope(req);
    const [catalogData, reqRows, stockRows, warehouseRows, dispatchRows, vendorRows] =
      await Promise.all([
        listStaffCatalogBoard(),
        prisma.clientGoodsRequest.findMany({
          where: { sectorType: "COMMERCIAL" },
          include: {
            clientAccount: {
              select: {
                id: true,
                fullName: true,
                tradeName: true,
                phone: true,
                email: true,
                clientType: true,
                customerId: true,
              },
            },
            lines: { orderBy: { lineOrder: "asc" } },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
        prisma.stockBalance.findMany({
          include: {
            item: { include: { baseUnit: true } },
            warehouse: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 150,
        }),
        prisma.warehouse.findMany({
          where: { isActive: true },
          select: { id: true, code: true, nameAr: true },
          orderBy: { code: "asc" },
        }),
        prisma.commercialDispatchOrder
          .findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
          })
          .catch(() => []),
        prisma.vendor.findMany({
          where: { isActive: true },
          select: { id: true, code: true, nameAr: true },
          orderBy: { nameAr: "asc" },
          take: 100,
        }),
      ]);

    const commercialCatalog = catalogData.items.filter(
      (i) => (i.sectorType || "HARVEST").toUpperCase() === "COMMERCIAL"
    );

    const stagedByItem = new Map<string, number>();
    for (const d of dispatchRows) {
      if (!["PENDING_PICK", "PICKING", "PACKED_STAGED", "IN_TRANSIT"].includes(d.tripStatus)) {
        continue;
      }
      try {
        const parsed = JSON.parse(d.itemsJson || "[]") as Array<{
          itemId?: string;
          qtyBase?: number;
          qty?: number;
        }>;
        for (const it of parsed) {
          if (!it.itemId) continue;
          stagedByItem.set(
            it.itemId,
            (stagedByItem.get(it.itemId) || 0) + Math.max(0, Number(it.qtyBase ?? it.qty ?? 0))
          );
        }
      } catch {
        // ignore invalid json
      }
    }

    const stockBuckets = stockRows.map((sb) => {
      const onHandBaseQty = Math.max(0, Number(sb.qtyOnHandBase || 0));
      const reservedBaseQty = 0;
      const outboundStagedBaseQty = stagedByItem.get(sb.itemId) || 0;
      const availableBaseQty = Math.max(
        0,
        onHandBaseQty - reservedBaseQty - outboundStagedBaseQty
      );
      return {
        id: sb.id,
        itemId: sb.itemId,
        sku: sb.item.sku,
        itemNameAr: sb.item.nameAr,
        baseUnitLabel: sb.item.baseUnit?.nameAr || "وحدة",
        warehouseId: sb.warehouseId,
        warehouseNameAr: sb.warehouse.nameAr,
        onHandBaseQty,
        reservedBaseQty,
        outboundStagedBaseQty,
        availableBaseQty,
        avgUnitCostBase: Number(sb.avgUnitCostBase || 0),
        updatedAtDisplay: formatIsoToDmyTime(sb.updatedAt),
      };
    });

    const dispatches = dispatchRows.map((d) => {
      let items: unknown[] = [];
      try {
        const p = JSON.parse(d.itemsJson || "[]");
        if (Array.isArray(p)) items = p;
      } catch {
        items = [];
      }
      return {
        ...d,
        items,
        createdAt: d.createdAt.toISOString(),
        createdAtDisplay: formatIsoToDmyTime(d.createdAt),
        pickedAtDisplay: d.pickedAt ? formatIsoToDmyTime(d.pickedAt) : null,
        packedAtDisplay: d.packedAt ? formatIsoToDmyTime(d.packedAt) : null,
        dispatchedAtDisplay: d.dispatchedAt ? formatIsoToDmyTime(d.dispatchedAt) : null,
        deliveredAtDisplay: d.deliveredAt ? formatIsoToDmyTime(d.deliveredAt) : null,
      };
    });

    return NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      commercialCatalog,
      allInventorySuggestions: catalogData.inventorySuggestions,
      requests: reqRows.map(serializeRequest),
      stockBuckets,
      warehouses: warehouseRows,
      vendors: vendorRows,
      dispatches,
    });
  } catch (err) {
    console.error("GET /api/commercial/ops error:", err);
    return jsonError("تعذر تحميل عمليات القطاع التجاري", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "").trim().toUpperCase();

    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: action.includes("CREATE") || action === "UPSERT_ITEM" ? "create" : "edit",
    });
    if (!auth.ok) return auth.response;

    const scope = resolveRequestTenantScope(req);
    const actor = {
      userId: auth.actor.userId,
      userDisplay: auth.actor.userDisplay || "مسؤول القطاع التجاري",
      userRole: auth.actor.userRole,
    };

    if (action === "UPSERT_ITEM") {
      const item = await upsertStaffCatalogBoardItem({
        id: body.id ? String(body.id) : undefined,
        inventoryItemId: body.inventoryItemId ? String(body.inventoryItemId) : null,
        sku: body.sku ? String(body.sku) : null,
        titleAr: String(body.titleAr || ""),
        titleEn: body.titleEn ? String(body.titleEn) : null,
        gradeLabel: String(body.gradeLabel || "قياسي / تجاري"),
        categoryLabel: String(body.categoryLabel || "بضائع وسلع تجارية"),
        sectorType: "COMMERCIAL",
        categoryGroup: String(body.categoryGroup || "GENERAL_COMMERCIAL"),
        saleMode: String(body.saleMode || "BOTH"),
        unitCode: String(body.unitCode || "CARTON"),
        unitLabel: String(body.unitLabel || "كرتون / طرد"),
        customUnitLabel: body.customUnitLabel ? String(body.customUnitLabel) : null,
        unitPrice: Number(body.unitPrice ?? 0),
        bulkUnitLabel: body.bulkUnitLabel ? String(body.bulkUnitLabel) : null,
        partialUnitLabel: body.partialUnitLabel ? String(body.partialUnitLabel) : "مفرّق / قطعة",
        partialUnitPrice: Number(body.partialUnitPrice ?? 0),
        multiplierToBase: Number(body.multiplierToBase ?? 1),
        publishedQty: body.publishedQty !== undefined && body.publishedQty !== null ? Number(body.publishedQty) : null,
        remainingQty: body.remainingQty !== undefined && body.remainingQty !== null ? Number(body.remainingQty) : null,
        availabilityStatus: body.availabilityStatus ? String(body.availabilityStatus) : "AVAILABLE",
        pickupLocation: body.pickupLocation ? String(body.pickupLocation) : null,
        freshnessLabel: String(body.freshnessLabel || "عرض القطاع التجاري"),
        validityNote: body.validityNote ? String(body.validityNote) : null,
        isPublished: body.isPublished !== undefined ? Boolean(body.isPublished) : true,
        tenantSlug: scope.tenantSlug,
        actor,
      });
      return NextResponse.json({
        success: true,
        item,
        message: `✅ تم حفظ الصنف التجاري (${item.titleAr})`,
      });
    }

    if (action === "CREATE_INBOUND_GRN") {
      const itemId = String(body.itemId || "").trim();
      const warehouseId = String(body.warehouseId || "").trim();
      const enteredQty = Number(body.enteredQty || 0);
      const unitCost = Math.max(0, Number(body.unitCost || 0));
      if (!itemId || !warehouseId || !Number.isFinite(enteredQty) || enteredQty <= 0) {
        return jsonError("يرجى اختيار الصنف والمستودع وإدخال كمية استلام موجبة", 400);
      }

      const grnRes = await prisma.$transaction(async (tx) => {
        const item = await tx.inventoryItem.findUnique({
          where: { id: itemId },
          include: { baseUnit: true, conversions: true },
        });
        if (!item) throw new Error("الصنف المخزني غير موجود");
        const factorToBase = 1;
        const qtyBase = convertToBaseQty(enteredQty, factorToBase);
        const rec = await recordStockLayerInTx(tx, {
          itemId: item.id,
          warehouseId,
          enteredQty,
          enteredUnitId: item.baseUnitId,
          factorToBase,
          qtyBase,
          unitCostBase: unitCost,
          movementType: "PURCHASE_IN",
          referenceType: "COMMERCIAL_GRN",
          referenceId: body.vendorId ? String(body.vendorId) : undefined,
          notes: body.notes ? String(body.notes) : "استلام بضاعة القطاع التجاري (GRN)",
          date: new Date(),
          postGl: false,
          createdById: actor.userId ?? undefined,
          postJeFn: postJournalEntry,
        });
        await syncPublishedCatalogStockTx(tx).catch(() => null);
        await appendAuditLogTx(tx, {
          userId: actor.userId,
          userDisplay: actor.userDisplay,
          userRole: actor.userRole,
          actionType: "COMMERCIAL_INBOUND_GRN",
          entityReference: rec.movement.id,
          details: `[tenant:${scope.tenantSlug}] استلام بضاعة تجارية: ${item.nameAr} × ${enteredQty}`,
        });
        return rec;
      });

      return NextResponse.json({
        success: true,
        movementId: grnRes.movement.id,
        message: "✅ تم قيد استلام البضاعة وتحديث أرصدة المستودع والكتالوج المنشور",
      });
    }

    if (action === "CREATE_DISPATCH_TRIP") {
      const driverName = String(body.driverName || "").trim();
      const vehicleInfo = String(body.vehicleInfo || "").trim();
      const warehouseId = body.warehouseId ? String(body.warehouseId).trim() : null;
      const requestId = body.requestId ? String(body.requestId).trim() : null;
      const itemsJson = Array.isArray(body.items) ? JSON.stringify(body.items) : "[]";
      const dispatchNumber = `CDISP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto
        .randomBytes(2)
        .toString("hex")
        .toUpperCase()}`;

      const created = await prisma.$transaction(async (tx) => {
        const rec = await tx.commercialDispatchOrder.create({
          data: {
            dispatchNumber,
            requestId,
            sectorType: "COMMERCIAL",
            warehouseId,
            driverName: driverName || "سائق توصيل",
            vehicleInfo: vehicleInfo || "مركبة توزيع",
            tripStatus: "PENDING_PICK",
            podNotes: body.podNotes ? String(body.podNotes) : null,
            itemsJson,
            createdById: actor.userId ?? null,
            createdByName: actor.userDisplay,
          },
        });
        await appendAuditLogTx(tx, {
          userId: actor.userId,
          userDisplay: actor.userDisplay,
          userRole: actor.userRole,
          actionType: "COMMERCIAL_DISPATCH_CREATED",
          entityReference: dispatchNumber,
          details: `[tenant:${scope.tenantSlug}] إنشاء أمر تجهيز ورحلة توصيل ${dispatchNumber}`,
        });
        return rec;
      });

      return NextResponse.json(
        {
          success: true,
          dispatch: {
            ...created,
            createdAtDisplay: formatIsoToDmyTime(created.createdAt),
          },
          message: `✅ تم إنشاء رحلة التجهيز والتوصيل (${dispatchNumber})`,
        },
        { status: 201 }
      );
    }

    if (action === "UPDATE_TRIP_STATUS") {
      const dispatchId = String(body.dispatchId || "").trim();
      const tripStatus = String(body.tripStatus || "").trim().toUpperCase();
      const allowed = [
        "PENDING_PICK",
        "PICKING",
        "PACKED_STAGED",
        "IN_TRANSIT",
        "DELIVERED",
        "PARTIAL_RETURN",
      ];
      if (!dispatchId || !allowed.includes(tripStatus)) {
        return jsonError("معرف الرحلة وحالة التنفيذ مطلوبان", 400);
      }

      const now = new Date();
      const updated = await prisma.commercialDispatchOrder.update({
        where: { id: dispatchId },
        data: {
          tripStatus,
          ...(body.driverName ? { driverName: String(body.driverName) } : {}),
          ...(body.vehicleInfo ? { vehicleInfo: String(body.vehicleInfo) } : {}),
          ...(body.podNotes !== undefined ? { podNotes: String(body.podNotes || "") } : {}),
          ...(tripStatus === "PICKING" ? { pickedAt: now } : {}),
          ...(tripStatus === "PACKED_STAGED" ? { packedAt: now } : {}),
          ...(tripStatus === "IN_TRANSIT" ? { dispatchedAt: now } : {}),
          ...(tripStatus === "DELIVERED" ? { deliveredAt: now } : {}),
        },
      });

      return NextResponse.json({
        success: true,
        dispatch: {
          ...updated,
          createdAtDisplay: formatIsoToDmyTime(updated.createdAt),
          deliveredAtDisplay: updated.deliveredAt ? formatIsoToDmyTime(updated.deliveredAt) : null,
        },
        message: "✅ تم تحديث مرحلة التجهيز والتوصيل وإثبات التسليم",
      });
    }

    return jsonError("إجراء غير معروف في عمليات القطاع التجاري", 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تنفيذ العملية التجارية";
    return jsonError(msg, 400);
  }
});

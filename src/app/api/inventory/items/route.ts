import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { ensureDefaultUomsSeeded } from "@/app/api/inventory/uom/route";
import { ensureDefaultCategoriesSeeded } from "@/app/api/inventory/categories/route";
import { ensureDefaultWarehousesSeeded } from "@/app/api/inventory/warehouses/route";
import {
  formatCompoundStockBreakdown,
  slugifyLookupCode,
} from "@/lib/multiUnitInventoryEngine";
import { extractActor, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { withIdempotency } from "@/lib/idempotencyGuard";
import {
  archiveMasterRecord,
  restoreMasterRecord,
  safeDeleteOrArchiveMasterRecord,
} from "@/lib/masterLifecycle";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    await Promise.all([
      ensureDefaultUomsSeeded(),
      ensureDefaultCategoriesSeeded(),
      ensureDefaultWarehousesSeeded(),
    ]);

    const items = await prisma.inventoryItem.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        category: true,
        baseUnit: true,
        defaultWarehouse: true,
        conversions: { include: { unit: true } },
        balances: { include: { warehouse: true } },
      },
    });

    const enriched = items.map((item) => {
      const totalBaseQty = item.balances.reduce((acc, b) => acc + b.qtyOnHandBase, 0);
      const breakdown = formatCompoundStockBreakdown(
        totalBaseQty,
        item.baseUnit.nameAr,
        item.conversions.map((c) => ({
          label: c.customUnitLabel || c.unit.nameAr,
          factorToBase: c.factorToBase,
        }))
      );
      return {
        ...item,
        totalBaseQty,
        compoundBreakdown: breakdown.formatted,
        breakdownParts: breakdown.parts,
      };
    });

    return NextResponse.json({ items: enriched });
  } catch (error) {
    console.error("GET /api/inventory/items error:", error);
    return jsonError("تعذر تحميل بطاقات الأصناف / Failed to load inventory items", 500);
  }
}

async function upsertItem(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await Promise.all([
      ensureDefaultUomsSeeded(),
      ensureDefaultCategoriesSeeded(),
      ensureDefaultWarehousesSeeded(),
    ]);

    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body, req);

    const nameAr = String(body.nameAr || "").trim();
    const nameEn = String(body.nameEn || nameAr).trim();
    const sku =
      String(body.sku || "").trim().toUpperCase() ||
      `SKU-${Date.now().toString(36).toUpperCase()}`;

    if (!nameAr) {
      return jsonError("يرجى إدخال اسم الصنف / Item name is required.", 400);
    }

    const saved = await prisma.$transaction(async (tx) => {
      // 1. Resolve or auto-create Base Unit (supports "OTHER" inline custom unit creation)
      let baseUnitId = String(body.baseUnitId || "").trim();
      const customBaseUnitName = String(body.customBaseUnitName || "").trim();
      if (!baseUnitId || baseUnitId === "OTHER") {
        if (customBaseUnitName) {
          const code = slugifyLookupCode(customBaseUnitName, "UOM");
          const createdUom = await tx.unitOfMeasure.upsert({
            where: { code },
            update: { nameAr: customBaseUnitName },
            create: {
              code,
              nameAr: customBaseUnitName,
              nameEn: String(body.customBaseUnitNameEn || customBaseUnitName),
              isBaseDefault: false,
              isCustom: true,
            },
          });
          baseUnitId = createdUom.id;
        } else {
          const defaultUnit = await tx.unitOfMeasure.findFirst({
            orderBy: { isBaseDefault: "desc" },
          });
          if (!defaultUnit) throw new Error("No base unit available");
          baseUnitId = defaultUnit.id;
        }
      }

      // 2. Resolve or auto-create Category (supports "OTHER" inline custom category)
      let categoryId: string | null = body.categoryId ? String(body.categoryId).trim() : null;
      const customCategoryName = String(body.customCategoryName || "").trim();
      if (categoryId === "OTHER" || (!categoryId && customCategoryName)) {
        if (customCategoryName) {
          const code = slugifyLookupCode(customCategoryName, "CAT");
          const createdCat = await tx.itemCategory.upsert({
            where: { code },
            update: { nameAr: customCategoryName },
            create: {
              code,
              nameAr: customCategoryName,
              nameEn: String(body.customCategoryNameEn || customCategoryName),
              isCustom: true,
            },
          });
          categoryId = createdCat.id;
        } else {
          categoryId = null;
        }
      }

      // 3. Resolve or auto-create Default Warehouse (supports "OTHER" inline custom warehouse)
      let defaultWarehouseId: string | null = body.defaultWarehouseId
        ? String(body.defaultWarehouseId).trim()
        : null;
      const customWarehouseName = String(body.customWarehouseName || "").trim();
      if (defaultWarehouseId === "OTHER" || (!defaultWarehouseId && customWarehouseName)) {
        if (customWarehouseName) {
          const code = slugifyLookupCode(customWarehouseName, "WH");
          const createdWh = await tx.warehouse.upsert({
            where: { code },
            update: { nameAr: customWarehouseName },
            create: {
              code,
              nameAr: customWarehouseName,
              nameEn: String(body.customWarehouseNameEn || customWarehouseName),
              isDefault: false,
              isCustom: true,
              isActive: true,
            },
          });
          defaultWarehouseId = createdWh.id;
        } else {
          const defaultWh = await tx.warehouse.findFirst({ orderBy: { isDefault: "desc" } });
          defaultWarehouseId = defaultWh?.id ?? null;
        }
      }

      // 4. Open Item Type, Grade, and Origin (supporting "OTHER" custom strings)
      const rawType = String(body.itemType || "STOCKABLE").trim();
      const itemType =
        rawType === "OTHER" && body.customItemType
          ? String(body.customItemType).trim()
          : rawType || "STOCKABLE";
      const rawGrade = body.grade ? String(body.grade).trim() : "";
      const grade =
        rawGrade === "OTHER" && body.customGrade
          ? String(body.customGrade).trim()
          : rawGrade || null;
      const rawOrigin = body.origin ? String(body.origin).trim() : "";
      const origin =
        rawOrigin === "OTHER" && body.customOrigin
          ? String(body.customOrigin).trim()
          : rawOrigin || null;

      const itemData = {
        sku,
        barcode: body.barcode ? String(body.barcode).trim() : null,
        nameAr,
        nameEn,
        categoryId,
        itemType,
        grade,
        origin,
        baseUnitId,
        defaultWarehouseId,
        purchasePrice: Number(body.purchasePrice || 0),
        wholesalePrice: Number(body.wholesalePrice || 0),
        retailPrice: Number(body.retailPrice || 0),
        minSellPrice: Number(body.minSellPrice || 0),
        minStockAlert: Number(body.minStockAlert || 0),
        maxStockLevel: Number(body.maxStockLevel || 0),
        inventoryAccountId: body.inventoryAccountId ? String(body.inventoryAccountId) : null,
        cogsAccountId: body.cogsAccountId ? String(body.cogsAccountId) : null,
        revenueAccountId: body.revenueAccountId ? String(body.revenueAccountId) : null,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      };

      const item = body.id
        ? await tx.inventoryItem.update({
            where: { id: String(body.id) },
            data: itemData,
          })
        : await tx.inventoryItem.upsert({
            where: { sku },
            update: itemData,
            create: itemData,
          });

      // 5. Save Multi-Unit Conversion Matrix (auto-creating custom UOMs when unitId === "OTHER")
      if (Array.isArray(body.conversions)) {
        await tx.itemUnitConversion.deleteMany({ where: { itemId: item.id } });
        for (const rawConv of body.conversions as Array<Record<string, unknown>>) {
          const factorToBase = Number(rawConv.factorToBase);
          if (!Number.isFinite(factorToBase) || factorToBase <= 0) continue;

          let unitId = String(rawConv.unitId || "").trim();
          const customLabel = String(rawConv.customUnitLabel || rawConv.customUnitName || "").trim();
          if (!unitId || unitId === "OTHER") {
            if (!customLabel) continue;
            const code = slugifyLookupCode(customLabel, "UOM");
            const createdUom = await tx.unitOfMeasure.upsert({
              where: { code },
              update: { nameAr: customLabel },
              create: {
                code,
                nameAr: customLabel,
                nameEn: customLabel,
                isBaseDefault: false,
                isCustom: true,
              },
            });
            unitId = createdUom.id;
          }

          await tx.itemUnitConversion.upsert({
            where: { itemId_unitId: { itemId: item.id, unitId } },
            update: {
              customUnitLabel: customLabel || null,
              factorToBase,
              barcode: rawConv.barcode ? String(rawConv.barcode) : null,
              purchasePrice: rawConv.purchasePrice !== undefined ? Number(rawConv.purchasePrice) : null,
              sellPrice: rawConv.sellPrice !== undefined ? Number(rawConv.sellPrice) : null,
              isDefaultSalesUnit: Boolean(rawConv.isDefaultSalesUnit),
              isDefaultPurchaseUnit: Boolean(rawConv.isDefaultPurchaseUnit),
            },
            create: {
              itemId: item.id,
              unitId,
              customUnitLabel: customLabel || null,
              factorToBase,
              barcode: rawConv.barcode ? String(rawConv.barcode) : null,
              purchasePrice: rawConv.purchasePrice !== undefined ? Number(rawConv.purchasePrice) : null,
              sellPrice: rawConv.sellPrice !== undefined ? Number(rawConv.sellPrice) : null,
              isDefaultSalesUnit: Boolean(rawConv.isDefaultSalesUnit),
              isDefaultPurchaseUnit: Boolean(rawConv.isDefaultPurchaseUnit),
            },
          });
        }
      }

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: body.id ? "تحديث بطاقة صنف" : "إنشاء بطاقة صنف متعددة الوحدات",
        entityReference: `Item:${item.sku}`,
        details: `${item.nameAr} (${item.sku})`,
      });

      return tx.inventoryItem.findUnique({
        where: { id: item.id },
        include: {
          category: true,
          baseUnit: true,
          defaultWarehouse: true,
          conversions: { include: { unit: true } },
          balances: { include: { warehouse: true } },
        },
      });
    });

    return NextResponse.json({ success: true, item: saved }, { status: body.id ? 200 : 201 });
  } catch (error) {
    console.error("POST/PUT /api/inventory/items error:", error);
    return jsonError("تعذر حفظ بطاقة الصنف / Failed to save inventory item", 500);
  }
}

export async function POST(req: NextRequest) {
  return withIdempotency(req, (r) => upsertItem(r));
}

export async function PUT(req: NextRequest) {
  return upsertItem(req);
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const actor = extractActor(body, req);
    const id = searchParams.get("id") || String(body.id || "");
    const action = String(body.action || searchParams.get("action") || "SAFE_DELETE").toUpperCase();
    if (!id) return jsonError("معرف الصنف مطلوب / Item id is required", 400);

    const validActor = {
      userId: actor.userId,
      userRole: actor.userRole,
      userDisplay: actor.userDisplay || "مستخدم النظام",
    };

    let result;
    if (action === "ARCHIVE") {
      result = await archiveMasterRecord("InventoryItem", id, validActor);
    } else if (action === "RESTORE") {
      result = await restoreMasterRecord("InventoryItem", id, validActor);
    } else {
      result = await safeDeleteOrArchiveMasterRecord("InventoryItem", id, validActor);
    }

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/inventory/items error:", error);
    return jsonError("تعذر حذف أو أرشفة الصنف", 500);
  }
}

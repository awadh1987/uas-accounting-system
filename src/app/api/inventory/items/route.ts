import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { ensureDefaultUomsSeeded } from "@/app/api/inventory/uom/route";
import { ensureDefaultCategoriesSeeded } from "@/app/api/inventory/categories/route";
import { ensureDefaultWarehousesSeeded } from "@/app/api/inventory/warehouses/route";
import {
  formatCompoundStockBreakdown,
  slugifyLookupCode,
} from "@/lib/multiUnitInventoryEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { withIdempotency } from "@/lib/idempotencyGuard";
import {
  archiveMasterRecord,
  restoreMasterRecord,
  safeDeleteOrArchiveMasterRecord,
} from "@/lib/masterLifecycle";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await Promise.all([
      ensureDefaultUomsSeeded(),
      ensureDefaultCategoriesSeeded(),
      ensureDefaultWarehousesSeeded(),
    ]);

    const rawSector = (req.nextUrl.searchParams.get("sectorType") || "").trim().toUpperCase();
    const sectorFilter =
      rawSector === "COMMERCIAL" || rawSector === "HARVEST" ? rawSector : undefined;

    const items = await prisma.inventoryItem.findMany({
      where: sectorFilter ? { sectorType: sectorFilter } : undefined,
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
      const totalBaseQty = item.balances.reduce((acc, b) => acc + Number(b.qtyOnHandBase), 0);
      const breakdown = formatCompoundStockBreakdown(
        totalBaseQty,
        item.baseUnit.nameAr,
        item.conversions.map((c) => ({
          label: c.customUnitLabel || c.unit.nameAr,
          factorToBase: Number(c.factorToBase),
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
});

async function upsertItem(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await Promise.all([
      ensureDefaultUomsSeeded(),
      ensureDefaultCategoriesSeeded(),
      ensureDefaultWarehousesSeeded(),
    ]);

    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "inventory",
      action: body.id ? "edit" : "create",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    if (String(body.action || "").toUpperCase() === "BULK_IMPORT_ITEMS") {
      const rawRows = Array.isArray(body.rows)
        ? (body.rows as Array<Record<string, unknown>>)
        : [];
      if (rawRows.length === 0) {
        return jsonError("يرجى توفير صفوف الأصناف للاستيراد / Bulk rows are required.", 400);
      }
      if (rawRows.length > 100) {
        return jsonError("الحد الأقصى للاستيراد الجماعي هو 100 صنف في الدفعة.", 400);
      }
      const defaultSector =
        String(body.sectorType || "COMMERCIAL").trim().toUpperCase() === "HARVEST"
          ? "HARVEST"
          : "COMMERCIAL";

      const imported = await prisma.$transaction(async (tx) => {
        const fallbackUnit = await tx.unitOfMeasure.findFirst({
          orderBy: { isBaseDefault: "desc" },
        });
        const fallbackWh = await tx.warehouse.findFirst({
          orderBy: { isDefault: "desc" },
        });
        if (!fallbackUnit) throw new Error("No default unit available");

        const results: Array<{ id: string; sku: string; nameAr: string }> = [];
        for (let idx = 0; idx < rawRows.length; idx++) {
          const row = rawRows[idx] || {};
          const rowName = String(row.nameAr || row.titleAr || "").trim();
          if (!rowName) continue;

          const rowSector =
            String(row.sectorType || defaultSector).trim().toUpperCase() === "HARVEST"
              ? "HARVEST"
              : "COMMERCIAL";
          const rowSku =
            String(row.sku || "").trim().toUpperCase() ||
            `BULK-${Date.now().toString(36).toUpperCase()}-${idx + 1}`;

          const unitText = String(row.unitLabel || row.baseUnitLabel || "").trim();
          let resolvedUnitId = fallbackUnit.id;
          if (unitText) {
            const matchedUom = await tx.unitOfMeasure.findFirst({
              where: {
                OR: [{ code: unitText.toUpperCase() }, { nameAr: unitText }, { nameEn: unitText }],
              },
            });
            if (matchedUom) {
              resolvedUnitId = matchedUom.id;
            } else {
              const uomCode = slugifyLookupCode(unitText, "UOM");
              const createdUom = await tx.unitOfMeasure.upsert({
                where: { code: uomCode },
                update: { nameAr: unitText },
                create: {
                  code: uomCode,
                  nameAr: unitText,
                  nameEn: unitText,
                  isBaseDefault: false,
                  isCustom: true,
                },
              });
              resolvedUnitId = createdUom.id;
            }
          }

          const catText = String(row.categoryLabel || row.category || "").trim();
          let resolvedCatId: string | null = null;
          if (catText) {
            const catCode = slugifyLookupCode(catText, "CAT");
            const cat = await tx.itemCategory.upsert({
              where: { code: catCode },
              update: { nameAr: catText },
              create: { code: catCode, nameAr: catText, nameEn: catText, isCustom: true },
            });
            resolvedCatId = cat.id;
          }

          const country = row.countryOfOrigin ? String(row.countryOfOrigin).trim() || null : null;
          const producer = row.producerCompany ? String(row.producerCompany).trim() || null : null;
          const prodDate = row.productionDate ? String(row.productionDate).trim().slice(0, 10) || null : null;
          const expDate = row.expiryDate ? String(row.expiryDate).trim().slice(0, 10) || null : null;
          const pPrice = Math.max(0, Number(row.purchasePrice || 0));
          const dCost = Math.max(0, Number(row.dispatchCost || 0));
          const tRate = Math.max(0, Number(row.taxRate || 0));
          const wPrice = Math.max(0, Number(row.wholesalePrice || row.salePrice || 0));
          const rPrice = Math.max(0, Number(row.retailPrice || wPrice));

          const itemPayload = {
            sku: rowSku,
            nameAr: rowName,
            nameEn: String(row.nameEn || rowName).trim(),
            categoryId: resolvedCatId,
            itemType: String(row.itemType || "STOCKABLE").trim() || "STOCKABLE",
            sectorType: rowSector,
            grade: row.grade ? String(row.grade).trim() || null : null,
            origin: country,
            producerCompany: producer,
            countryOfOrigin: country,
            productionDate: prodDate,
            expiryDate: expDate,
            baseUnitId: resolvedUnitId,
            defaultWarehouseId: fallbackWh?.id || null,
            purchasePrice: pPrice,
            dispatchCost: dCost,
            taxRate: tRate,
            wholesalePrice: wPrice,
            retailPrice: rPrice,
            isActive: true,
          };

          const upserted = await tx.inventoryItem.upsert({
            where: { sku: rowSku },
            update: itemPayload,
            create: itemPayload,
          });

          const openQty = Number(row.openingQty ?? row.quantity ?? 0);
          if (fallbackWh?.id && Number.isFinite(openQty) && openQty > 0) {
            const existingBal = await tx.stockBalance.findUnique({
              where: { itemId_warehouseId: { itemId: upserted.id, warehouseId: fallbackWh.id } },
            });
            if (!existingBal) {
              const unitCostBase = pPrice + dCost;
              await tx.stockBalance.create({
                data: {
                  itemId: upserted.id,
                  warehouseId: fallbackWh.id,
                  qtyOnHandBase: openQty,
                  avgUnitCostBase: unitCostBase,
                },
              });
              await tx.stockMovement.create({
                data: {
                  itemId: upserted.id,
                  warehouseId: fallbackWh.id,
                  movementType: "OPENING",
                  enteredQty: openQty,
                  enteredUnitId: resolvedUnitId,
                  factorToBase: 1,
                  baseQtyDelta: openQty,
                  unitCostBase,
                  referenceType: "BULK_IMPORT",
                  referenceId: upserted.id,
                  notes: "استيراد جماعي — رصيد افتتاحي",
                },
              });
            }
          }
          results.push({ id: upserted.id, sku: upserted.sku, nameAr: upserted.nameAr });
        }

        await appendAuditLogTx(tx, {
          ...actor,
          actionType: "استيراد جماعي للأصناف",
          entityReference: `BulkImport:${results.length}`,
          details: `تم استيراد/تحديث ${results.length} صنفاً في ${defaultSector}`,
        });
        return results;
      });

      return NextResponse.json(
        {
          success: true,
          importedCount: imported.length,
          items: imported,
          message: `✅ تم استيراد ${imported.length} صنفاً بنجاح`,
        },
        { status: 201 }
      );
    }

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

      const rawSectorType = String(body.sectorType || "HARVEST").trim().toUpperCase();
      const sectorType = rawSectorType === "COMMERCIAL" ? "COMMERCIAL" : "HARVEST";
      const producerCompany = body.producerCompany ? String(body.producerCompany).trim() || null : null;
      const countryOfOrigin = body.countryOfOrigin ? String(body.countryOfOrigin).trim() || null : null;
      const productionDate = body.productionDate ? String(body.productionDate).trim().slice(0, 10) || null : null;
      const expiryDate = body.expiryDate ? String(body.expiryDate).trim().slice(0, 10) || null : null;

      const itemData = {
        sku,
        barcode: body.barcode ? String(body.barcode).trim() : null,
        nameAr,
        nameEn,
        categoryId,
        itemType,
        sectorType,
        grade,
        origin: origin || countryOfOrigin,
        producerCompany,
        countryOfOrigin: countryOfOrigin || origin,
        productionDate,
        expiryDate,
        baseUnitId,
        defaultWarehouseId,
        purchasePrice: Number(body.purchasePrice || 0),
        dispatchCost: Number(body.dispatchCost || 0),
        taxRate: Number(body.taxRate || 0),
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

      // 5b. Record opening stock balance & movement if openingQty > 0 on creation
      const openingQty = Number(body.openingQty || 0);
      if (!body.id && Number.isFinite(openingQty) && openingQty > 0) {
        const whId =
          defaultWarehouseId ||
          (await tx.warehouse.findFirst({ orderBy: { isDefault: "desc" } }))?.id ||
          null;
        if (whId) {
          const unitCostBase =
            Math.max(0, Number(body.purchasePrice || 0)) + Math.max(0, Number(body.dispatchCost || 0));
          const existingBal = await tx.stockBalance.findUnique({
            where: { itemId_warehouseId: { itemId: item.id, warehouseId: whId } },
          });
          if (!existingBal) {
            await tx.stockBalance.create({
              data: {
                itemId: item.id,
                warehouseId: whId,
                qtyOnHandBase: openingQty,
                avgUnitCostBase: unitCostBase,
              },
            });
            await tx.stockMovement.create({
              data: {
                itemId: item.id,
                warehouseId: whId,
                movementType: "OPENING",
                enteredQty: openingQty,
                enteredUnitId: baseUnitId,
                factorToBase: 1,
                baseQtyDelta: openingQty,
                unitCostBase,
                referenceType: "ITEM_OPENING",
                referenceId: item.id,
                notes: "رصيد افتتاحي عند إنشاء الصنف",
              },
            });
          }
        }
      }

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: body.id ? "تحديث بطاقة صنف" : "إنشاء بطاقة صنف متعددة الوحدات",
        entityReference: `Item:${item.sku}`,
        details: `${item.nameAr} (${item.sku}) [${sectorType}]`,
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

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, (r) => upsertItem(r));
});

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  return upsertItem(req);
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, {
      moduleId: "inventory",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
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
});

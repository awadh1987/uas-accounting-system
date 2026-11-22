import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  checkNegativeStockPolicy,
  computeWeightedAverageCost,
  convertToBaseQty,
  formatCompoundStockBreakdown,
} from "../src/lib/multiUnitInventoryEngine";
import { handleOfflineAndroidApiRequest } from "../src/lib/offlineAndroidStore";
import { createMemoryStorage } from "../src/lib/licensing";

const PREFIX = `MUI_${Date.now().toString(36).toUpperCase()}`;
const cleanupIds = {
  itemIds: [] as string[],
  uomIds: [] as string[],
  catIds: [] as string[],
  whIds: [] as string[],
};

describe("Phase 2 — Multi-Unit Inventory, Custom 'Other' Lookups, WAC & Compound Breakdown", () => {
  after(async () => {
    for (const id of cleanupIds.itemIds) {
      await prisma.stockMovement.deleteMany({ where: { itemId: id } }).catch(() => {});
      await prisma.stockBalance.deleteMany({ where: { itemId: id } }).catch(() => {});
      await prisma.itemUnitConversion.deleteMany({ where: { itemId: id } }).catch(() => {});
      await prisma.inventoryItem.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of cleanupIds.uomIds) {
      await prisma.unitOfMeasure.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of cleanupIds.catIds) {
      await prisma.itemCategory.deleteMany({ where: { id } }).catch(() => {});
    }
    for (const id of cleanupIds.whIds) {
      await prisma.warehouse.deleteMany({ where: { id } }).catch(() => {});
    }
  });

  it("converts entered unit quantities via factorToBase and rejects invalid factors", () => {
    assert.equal(convertToBaseQty(2, 240), 480); // 2 cartons * 240 pieces
    assert.equal(convertToBaseQty(5, 10), 50); // 5 bundles * 10 pieces
    assert.throws(() => convertToBaseQty(5, 0));
    assert.throws(() => convertToBaseQty(-1, 10));
  });

  it("recalculates Weighted Average Cost (WAC) accurately on incoming purchases", () => {
    // 100 base units @ 500 YER + 100 base units @ 700 YER => 200 base units @ 600 YER
    const wac = computeWeightedAverageCost({
      prevQtyBase: 100,
      prevAvgCostBase: 500,
      incomingQtyBase: 100,
      incomingUnitCostBase: 700,
    });
    assert.equal(wac.newQtyBase, 200);
    assert.equal(wac.newAvgCostBase, 600);
  });

  it("formats compound stock breakdown across Carton / Bundle / Piece tiers", () => {
    // 2 * 240 + 5 * 10 + 3 = 533 base pieces
    const breakdown = formatCompoundStockBreakdown(533, "حبة", [
      { label: "ربطة", factorToBase: 10 },
      { label: "كرتون", factorToBase: 240 },
    ]);
    assert.equal(breakdown.formatted, "2 كرتون + 5 ربطة + 3 حبة");
    assert.equal(breakdown.parts.length, 3);
  });

  it("enforces negative stock policy (BLOCK vs WARN)", () => {
    const blocked = checkNegativeStockPolicy({
      currentQtyBase: 10,
      outgoingQtyBase: 15,
      policy: "BLOCK",
    });
    assert.equal(blocked.ok, false);

    const warned = checkNegativeStockPolicy({
      currentQtyBase: 10,
      outgoingQtyBase: 15,
      policy: "WARN",
    });
    assert.equal(warned.ok, true);
    if (warned.ok) {
      assert.equal(warned.resultingQtyBase, -5);
      assert.ok(warned.warning);
    }
  });

  it("persists custom 'Other' UOM, custom Category, multi-unit InventoryItem & StockBalance in SQLite", async () => {
    const baseUom = await prisma.unitOfMeasure.create({
      data: { code: `${PREFIX}_PC`, nameAr: "حبة اختبار", nameEn: "Test Piece", isCustom: true },
    });
    const customBoxUom = await prisma.unitOfMeasure.create({
      data: { code: `${PREFIX}_BOX`, nameAr: "صندوق خاص", nameEn: "Custom Box", isCustom: true },
    });
    cleanupIds.uomIds.push(baseUom.id, customBoxUom.id);

    const customCat = await prisma.itemCategory.create({
      data: { code: `${PREFIX}_CAT`, nameAr: "تصنيف مخصص", nameEn: "Custom Cat", isCustom: true },
    });
    cleanupIds.catIds.push(customCat.id);

    const wh = await prisma.warehouse.create({
      data: { code: `${PREFIX}_WH`, nameAr: "مستودع مخصص", nameEn: "Custom WH", isCustom: true },
    });
    cleanupIds.whIds.push(wh.id);

    const item = await prisma.inventoryItem.create({
      data: {
        sku: `${PREFIX}_SKU1`,
        nameAr: "صنف متعدد الوحدات",
        nameEn: "Multi-Unit Item",
        categoryId: customCat.id,
        itemType: "CUSTOM_AGRI_PACK",
        grade: "درجة ممتازة خاصة",
        origin: "الضالع",
        baseUnitId: baseUom.id,
        defaultWarehouseId: wh.id,
        purchasePrice: 500,
        retailPrice: 750,
        conversions: {
          create: [
            {
              unitId: customBoxUom.id,
              customUnitLabel: "صندوق خاص",
              factorToBase: 24,
              sellPrice: 17500,
              isDefaultSalesUnit: true,
            },
          ],
        },
      },
      include: { conversions: true },
    });
    cleanupIds.itemIds.push(item.id);
    assert.equal(item.conversions.length, 1);
    assert.equal(Number(item.conversions[0].factorToBase), 24);

    // Record incoming 3 boxes (3 * 24 = 72 base units)
    const baseDelta = convertToBaseQty(3, 24);
    const bal = await prisma.stockBalance.create({
      data: {
        itemId: item.id,
        warehouseId: wh.id,
        qtyOnHandBase: baseDelta,
        avgUnitCostBase: 500,
      },
    });
    assert.equal(Number(bal.qtyOnHandBase), 72);
  });

  it("supports custom 'Other' UOM and custom Currency creation in Android offline local store", async () => {
    const mem = createMemoryStorage();
    const storage = {
      getItem: (k: string) => mem.getItem(k),
      setItem: (k: string, v: string) => mem.setItem(k, v),
      removeItem: (k: string) => mem.removeItem?.(k),
    };

    const uomRes = await handleOfflineAndroidApiRequest(
      "/api/inventory/uom",
      { method: "POST", body: JSON.stringify({ nameAr: "شوال 50 كجم", nameEn: "50kg Sack" }) },
      storage
    );
    assert.equal(uomRes.status, 201);
    const uomData = (await uomRes.json()) as { unit: { nameAr: string; isCustom: boolean } };
    assert.equal(uomData.unit.nameAr, "شوال 50 كجم");
    assert.equal(uomData.unit.isCustom, true);

    const curRes = await handleOfflineAndroidApiRequest(
      "/api/accounting/currencies",
      { method: "POST", body: JSON.stringify({ code: "EUR", nameAr: "يورو", symbol: "€", midRate: 1750 }) },
      storage
    );
    assert.equal(curRes.status, 201);
    const curData = (await curRes.json()) as { currency: { code: string; isCustom: boolean } };
    assert.equal(curData.currency.code, "EUR");
    assert.equal(curData.currency.isCustom, true);
  });
});

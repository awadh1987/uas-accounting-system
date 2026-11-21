import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  checkNegativeStockPolicy,
  computeWeightedAverageCost,
  convertToBaseQty,
  formatCompoundStockBreakdown,
  slugifyLookupCode,
} from "@/lib/multiUnitInventoryEngine";
import { parseAccountingSettings } from "@/lib/accountingSettings";
import { extractActor, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { emitNotification } from "@/lib/notifications/notificationService";
import { withIdempotency } from "@/lib/idempotencyGuard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const itemId = req.nextUrl.searchParams.get("itemId")?.trim() || undefined;
    const warehouseId = req.nextUrl.searchParams.get("warehouseId")?.trim() || undefined;

    const movements = await prisma.stockMovement.findMany({
      where: {
        ...(itemId ? { itemId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        item: { include: { baseUnit: true, conversions: { include: { unit: true } } } },
        warehouse: true,
        enteredUnit: true,
      },
    });

    return NextResponse.json({ movements });
  } catch (error) {
    console.error("GET /api/inventory/movements error:", error);
    return jsonError("تعذر تحميل حركات المخزون / Failed to load stock movements", 500);
  }
}

export async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const body = (await r.json()) as Record<string, unknown>;
      const actor = extractActor(body, r);

    const itemId = String(body.itemId || "").trim();
    const movementType = String(body.movementType || "ADJUSTMENT_IN").trim().toUpperCase();
    const enteredQty = Number(body.enteredQty ?? body.quantity ?? 0);
    const enteredUnitCost = Number(body.unitCost ?? body.unitCostBase ?? 0);

    if (!itemId || !Number.isFinite(enteredQty) || enteredQty <= 0) {
      return jsonError("يرجى تحديد الصنف وكمية موجبة / Valid itemId and positive enteredQty required.", 400);
    }

    const isOutgoing = ["SALE_OUT", "ADJUSTMENT_OUT", "TRANSFER_OUT"].includes(movementType);
    const settingsRow = await prisma.systemSettings.findUnique({ where: { id: "default" } });
    const settings = parseAccountingSettings(settingsRow);

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        include: { baseUnit: true, conversions: { include: { unit: true } } },
      });
      if (!item) {
        return { error: "الصنف غير موجود / Item not found", status: 404 as const };
      }

      // Resolve warehouse (or default warehouse, or inline custom warehouse)
      let warehouseId = String(body.warehouseId || item.defaultWarehouseId || "").trim();
      if (!warehouseId || warehouseId === "OTHER") {
        const customWh = String(body.customWarehouseName || "").trim();
        if (customWh) {
          const code = slugifyLookupCode(customWh, "WH");
          const wh = await tx.warehouse.upsert({
            where: { code },
            update: { nameAr: customWh },
            create: { code, nameAr: customWh, nameEn: customWh, isCustom: true, isActive: true },
          });
          warehouseId = wh.id;
        } else {
          const defaultWh = await tx.warehouse.findFirst({ orderBy: { isDefault: "desc" } });
          if (!defaultWh) return { error: "لا يوجد مستودع افتراضي / No warehouse available", status: 400 as const };
          warehouseId = defaultWh.id;
        }
      }

      // Resolve unit & factorToBase (supports "OTHER" custom unit with custom factorToBase!)
      let enteredUnitId = String(body.enteredUnitId || item.baseUnitId).trim();
      let factorToBase = Number(body.factorToBase || 0);

      if (enteredUnitId === "OTHER" && body.customUnitLabel) {
        const customLabel = String(body.customUnitLabel).trim();
        const code = slugifyLookupCode(customLabel, "UOM");
        const createdUom = await tx.unitOfMeasure.upsert({
          where: { code },
          update: { nameAr: customLabel },
          create: { code, nameAr: customLabel, nameEn: customLabel, isCustom: true },
        });
        enteredUnitId = createdUom.id;
        if (!Number.isFinite(factorToBase) || factorToBase <= 0) factorToBase = 1;
        await tx.itemUnitConversion.upsert({
          where: { itemId_unitId: { itemId: item.id, unitId: enteredUnitId } },
          update: { factorToBase, customUnitLabel: customLabel },
          create: { itemId: item.id, unitId: enteredUnitId, factorToBase, customUnitLabel: customLabel },
        });
      } else if (!Number.isFinite(factorToBase) || factorToBase <= 0) {
        if (enteredUnitId === item.baseUnitId) {
          factorToBase = 1;
        } else {
          const conv = item.conversions.find((c) => c.unitId === enteredUnitId);
          factorToBase = conv ? conv.factorToBase : 1;
        }
      }

      const absBaseQty = convertToBaseQty(enteredQty, factorToBase);
      const baseQtyDelta = isOutgoing ? -absBaseQty : absBaseQty;

      const existingBalance = await tx.stockBalance.findUnique({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId } },
      });
      const prevQtyBase = existingBalance?.qtyOnHandBase ?? 0;
      const prevAvgCostBase = existingBalance?.avgUnitCostBase ?? item.purchasePrice ?? 0;

      let warning: string | undefined;
      let newQtyBase = prevQtyBase;
      let newAvgCostBase = prevAvgCostBase;

      if (isOutgoing) {
        const policyCheck = checkNegativeStockPolicy({
          currentQtyBase: prevQtyBase,
          outgoingQtyBase: absBaseQty,
          policy: settings.negativeStockPolicy,
        });
        if (!policyCheck.ok) {
          return { error: policyCheck.error, status: 400 as const };
        }
        warning = policyCheck.warning;
        newQtyBase = policyCheck.resultingQtyBase;
      } else {
        const incomingUnitCostBase =
          enteredUnitCost > 0 ? enteredUnitCost / factorToBase : prevAvgCostBase;
        const wac = computeWeightedAverageCost({
          prevQtyBase,
          prevAvgCostBase,
          incomingQtyBase: absBaseQty,
          incomingUnitCostBase,
        });
        newQtyBase = wac.newQtyBase;
        newAvgCostBase = wac.newAvgCostBase;
      }

      const balance = await tx.stockBalance.upsert({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId } },
        update: { qtyOnHandBase: newQtyBase, avgUnitCostBase: newAvgCostBase },
        create: {
          itemId: item.id,
          warehouseId,
          qtyOnHandBase: newQtyBase,
          avgUnitCostBase: newAvgCostBase,
        },
      });

      const whForCc = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { costCenterId: true } });
      const movement = await tx.stockMovement.create({
        data: {
          costCenterId: body.costCenterId ? String(body.costCenterId) : whForCc?.costCenterId ?? null,
          itemId: item.id,
          warehouseId,
          movementType,
          enteredQty,
          enteredUnitId,
          factorToBase,
          baseQtyDelta,
          unitCostBase: isOutgoing ? prevAvgCostBase : newAvgCostBase,
          referenceType: body.referenceType ? String(body.referenceType) : "MANUAL",
          referenceId: body.referenceId ? String(body.referenceId) : null,
          notes: body.notes ? String(body.notes) : null,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: `حركة مخزنية (${movementType})`,
        entityReference: `StockMovement:${movement.id}`,
        details: `${item.nameAr} | ${enteredQty} × ${factorToBase} = ${baseQtyDelta} base`,
      });

      if (item.minStockAlert > 0 && balance.qtyOnHandBase <= item.minStockAlert) {
        await emitNotification(
          {
            eventType: "LOW_STOCK",
            channel: "general",
            severity: "WARNING",
            titleAr: `تنبيه انخفاض المخزون (${item.nameAr})`,
            titleEn: `Low Stock Alert (${item.nameEn || item.nameAr})`,
            messageAr: `الرصيد المتبقي (${balance.qtyOnHandBase}) وصل أو أقل من حد التنبيه (${item.minStockAlert}).`,
            messageEn: `Remaining balance (${balance.qtyOnHandBase}) is at or below alert threshold (${item.minStockAlert}).`,
            targetTab: "inventory",
            targetEntityType: "InventoryItem",
            targetEntityId: item.id,
            actorUserId: actor.userId,
            metadata: { itemId: item.id, sku: item.sku, qtyOnHandBase: balance.qtyOnHandBase, minStockAlert: item.minStockAlert },
          },
          tx
        );
      }

      const breakdown = formatCompoundStockBreakdown(
        balance.qtyOnHandBase,
        item.baseUnit.nameAr,
        item.conversions.map((c) => ({
          label: c.customUnitLabel || c.unit.nameAr,
          factorToBase: c.factorToBase,
        }))
      );

      return {
        movement,
        balance,
        warning,
        compoundBreakdown: breakdown.formatted,
      };
    });

    if ("error" in result) {
      return jsonError(result.error || "خطأ في الحركة المخزنية", result.status);
    }

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    console.error("POST /api/inventory/movements error:", error);
    return jsonError("تعذر تسجيل الحركة المخزنية / Failed to record stock movement", 500);
  }
  });
}

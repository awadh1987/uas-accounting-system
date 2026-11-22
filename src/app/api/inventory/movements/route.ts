import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  formatCompoundStockBreakdown,
  slugifyLookupCode,
} from "@/lib/multiUnitInventoryEngine";
import { parseAccountingSettings } from "@/lib/accountingSettings";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { postJournalEntry } from "@/lib/accounting/ledgerService";
import { consumeStockLayersOutTx, recordStockLayerInTx } from "@/lib/inventoryGlBridge";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { emitNotification } from "@/lib/notifications/notificationService";
import { withIdempotency } from "@/lib/idempotencyGuard";

import { convertToBaseQty } from "@/lib/multiUnitInventoryEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "inventory" });
    if (!auth.ok) return auth.response;

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
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "inventory",
        action: "create",
      });
      if (!auth.ok) return auth.response;
      const actor = auth.actor;

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
          factorToBase = conv ? Number(conv.factorToBase) : 1;
        }
      }

      const absBaseQty = convertToBaseQty(enteredQty, factorToBase);
      const baseQtyDelta = isOutgoing ? -absBaseQty : absBaseQty;
      const whForCc = await tx.warehouse.findUnique({ where: { id: warehouseId }, select: { costCenterId: true } });
      const resolvedCostCenterId = body.costCenterId ? String(body.costCenterId) : whForCc?.costCenterId ?? null;
      const projectId = body.projectId ? String(body.projectId).trim() : null;
      const postGl = body.postGl !== false;
      const contraAccountCode = body.contraAccountCode ? String(body.contraAccountCode).trim() : undefined;
      const contraAccountId = body.contraAccountId ? String(body.contraAccountId).trim() : undefined;
      const moveDate = body.date ? new Date(String(body.date)) : new Date();

      let movement;
      let balance;
      let warning: string | undefined;
      let journalEntry: { id: string; entryNumber: string; status: string } | null = null;

      if (isOutgoing) {
        try {
          const outRes = await consumeStockLayersOutTx(tx, {
            itemId: item.id,
            warehouseId,
            enteredQty,
            enteredUnitId,
            factorToBase,
            qtyBase: absBaseQty,
            movementType: movementType as "SALE_OUT" | "ADJUSTMENT_OUT" | "TRANSFER_OUT",
            referenceType: body.referenceType ? String(body.referenceType) : "MANUAL",
            referenceId: body.referenceId ? String(body.referenceId) : undefined,
            projectId,
            costCenterId: resolvedCostCenterId,
            notes: body.notes ? String(body.notes) : null,
            date: moveDate,
            postGl,
            contraAccountCode,
            contraAccountId,
            createdById: actor.userId ?? undefined,
            postJeFn: postJournalEntry,
          });
          movement = outRes.movement;
          balance = outRes.balance;
          warning = outRes.warning;
          journalEntry = outRes.journalEntry;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "NEGATIVE_STOCK_BLOCKED";
          return { error: msg.replace(/^NEGATIVE_STOCK_BLOCKED:\s*/, ""), status: 400 as const };
        }
      } else {
        const existingBalance = await tx.stockBalance.findUnique({
          where: { itemId_warehouseId: { itemId: item.id, warehouseId } },
        });
        const fallbackUnitCostBase = Number(existingBalance?.avgUnitCostBase ?? item.purchasePrice ?? 0);
        const incomingUnitCostBase =
          enteredUnitCost > 0 ? enteredUnitCost / factorToBase : fallbackUnitCostBase;

        const inRes = await recordStockLayerInTx(tx, {
          itemId: item.id,
          warehouseId,
          enteredQty,
          enteredUnitId,
          factorToBase,
          qtyBase: absBaseQty,
          unitCostBase: incomingUnitCostBase,
          movementType: movementType as "PURCHASE_IN" | "ADJUSTMENT_IN" | "TRANSFER_IN" | "OPENING",
          referenceType: body.referenceType ? String(body.referenceType) : "MANUAL",
          referenceId: body.referenceId ? String(body.referenceId) : undefined,
          projectId,
          costCenterId: resolvedCostCenterId,
          notes: body.notes ? String(body.notes) : null,
          date: moveDate,
          postGl,
          contraAccountCode,
          contraAccountId,
          createdById: actor.userId ?? undefined,
          postJeFn: postJournalEntry,
        });
        movement = inRes.movement;
        balance = inRes.balance;
        journalEntry = inRes.journalEntry;
      }

      void settings;

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: `حركة مخزنية (${movementType})`,
        entityReference: `StockMovement:${movement.id}`,
        details: `${item.nameAr} | ${enteredQty} × ${factorToBase} = ${baseQtyDelta} base`,
      });

      if (Number(item.minStockAlert) > 0 && Number(balance.qtyOnHandBase) <= Number(item.minStockAlert)) {
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
            metadata: { itemId: item.id, sku: item.sku, qtyOnHandBase: Number(balance.qtyOnHandBase), minStockAlert: Number(item.minStockAlert) },
          },
          tx
        );
      }

      const breakdown = formatCompoundStockBreakdown(
        Number(balance.qtyOnHandBase),
        item.baseUnit.nameAr,
        item.conversions.map((c) => ({
          label: c.customUnitLabel || c.unit.nameAr,
          factorToBase: Number(c.factorToBase),
        }))
      );

      return {
        movement,
        balance,
        journalEntry,
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
});

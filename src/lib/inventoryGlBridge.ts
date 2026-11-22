import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseAccountingSettings } from "@/lib/accountingSettings";
import {
  checkNegativeStockPolicy,
  computeWeightedAverageCost,
} from "@/lib/multiUnitInventoryEngine";
import { dAdd, dDiv, dMul, dSub, round4Decimal } from "@/lib/decimalMath";

export interface StockPostJournalFn {
  (input: {
    tx: Prisma.TransactionClient;
    date?: Date | string;
    reference?: string;
    narrationAr: string;
    narrationEn?: string;
    sourceType?: string;
    sourceId?: string;
    projectId?: string | null;
    subProjectId?: string | null;
    costCenterId?: string | null;
    createdById?: string;
    status?: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "VOIDED";
    lines: Array<{
      accountId?: string;
      accountCode?: string;
      debit?: number;
      credit?: number;
      memo?: string;
      projectId?: string | null;
      subProjectId?: string | null;
      harvestCycleId?: string | null;
      costCenterId?: string | null;
    }>;
  }): Promise<{ id: string; entryNumber: string; status: string }>;
}

function resolveInventoryGlAccountSpec(
  item: { inventoryAccountId?: string | null; itemType?: string | null },
  controlAccounts: ReturnType<typeof parseAccountingSettings>["controlAccounts"]
): { accountId?: string; accountCode?: string } {
  if (item.inventoryAccountId) return { accountId: item.inventoryAccountId };
  const code =
    item.itemType === "CONSUMABLE"
      ? controlAccounts.inventoryInputsAccount || "113201"
      : controlAccounts.inventoryAssetAccount || "113101";
  return { accountCode: code };
}

function resolveCogsGlAccountSpec(
  item: { cogsAccountId?: string | null },
  controlAccounts: ReturnType<typeof parseAccountingSettings>["controlAccounts"]
): { accountId?: string; accountCode?: string } {
  if (item.cogsAccountId) return { accountId: item.cogsAccountId };
  return {
    accountCode: controlAccounts.cogsInventoryAccount || controlAccounts.cogsAccount || "512201",
  };
}

/**
 * Records incoming inventory layer (WAC StockBalance update + FIFO InventoryLot + StockMovement)
 * and optionally posts balanced Inventory GL journal via postJournalEntry.
 */
export async function recordStockLayerInTx(
  tx: Prisma.TransactionClient,
  params: {
    itemId: string;
    warehouseId: string;
    enteredQty: number;
    enteredUnitId?: string;
    factorToBase?: number;
    qtyBase: number;
    unitCostBase: number;
    movementType: "PURCHASE_IN" | "ADJUSTMENT_IN" | "TRANSFER_IN" | "OPENING";
    referenceType?: string;
    referenceId?: string;
    projectId?: string | null;
    harvestCycleId?: string | null;
    costCenterId?: string | null;
    notes?: string | null;
    date?: Date;
    postGl?: boolean;
    contraAccountId?: string;
    contraAccountCode?: string;
    createdById?: string;
    postJeFn?: StockPostJournalFn;
  }
) {
  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: params.itemId } });
  const existingBalance = await tx.stockBalance.findUnique({
    where: { itemId_warehouseId: { itemId: item.id, warehouseId: params.warehouseId } },
  });

  const prevQty = Number(existingBalance?.qtyOnHandBase ?? 0);
  const prevCost = Number(existingBalance?.avgUnitCostBase ?? item.purchasePrice ?? 0);
  const inCost =
    params.unitCostBase > 0 ? round4Decimal(params.unitCostBase) : prevCost;

  const wac = computeWeightedAverageCost({
    prevQtyBase: prevQty,
    prevAvgCostBase: prevCost,
    incomingQtyBase: params.qtyBase,
    incomingUnitCostBase: inCost,
  });

  const balance = await tx.stockBalance.upsert({
    where: { itemId_warehouseId: { itemId: item.id, warehouseId: params.warehouseId } },
    update: { qtyOnHandBase: wac.newQtyBase, avgUnitCostBase: wac.newAvgCostBase },
    create: {
      itemId: item.id,
      warehouseId: params.warehouseId,
      qtyOnHandBase: wac.newQtyBase,
      avgUnitCostBase: wac.newAvgCostBase,
    },
  });

  const receivedDate = params.date ?? new Date();
  const lot = await tx.inventoryLot.create({
    data: {
      lotNumber: `LOT-${receivedDate.getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      projectId: params.projectId ?? null,
      harvestCycleId: params.harvestCycleId ?? null,
      itemId: item.id,
      warehouseId: params.warehouseId,
      grade: item.grade || item.nameAr,
      initialQuantity: params.qtyBase,
      currentQuantity: params.qtyBase,
      unitCost: inCost,
      receivedDate,
    },
  });

  const movement = await tx.stockMovement.create({
    data: {
      itemId: item.id,
      warehouseId: params.warehouseId,
      movementType: params.movementType,
      enteredQty: params.enteredQty,
      enteredUnitId: params.enteredUnitId || item.baseUnitId,
      factorToBase: params.factorToBase || 1,
      baseQtyDelta: params.qtyBase,
      unitCostBase: inCost,
      referenceType: params.referenceType ?? "MANUAL",
      referenceId: params.referenceId ?? null,
      costCenterId: params.costCenterId ?? null,
      notes: params.notes ?? null,
    },
  });

  let journalEntry: { id: string; entryNumber: string; status: string } | null = null;
  const totalCost = round4Decimal(dMul(params.qtyBase, inCost, 4));

  if (params.postGl && params.postJeFn && totalCost > 0.005) {
    const settingsRow = await tx.systemSettings.findUnique({ where: { id: "default" } });
    const settings = parseAccountingSettings(settingsRow);
    const invSpec = resolveInventoryGlAccountSpec(item, settings.controlAccounts);
    const contraSpec = params.contraAccountId
      ? { accountId: params.contraAccountId }
      : {
          accountCode:
            params.contraAccountCode ||
            (params.movementType === "OPENING"
              ? settings.controlAccounts.capitalAccount || "311101"
              : params.movementType === "PURCHASE_IN"
              ? settings.controlAccounts.grnClearingAccount || "215101"
              : settings.controlAccounts.inventoryShrinkageAccount || "512301"),
        };

    journalEntry = await params.postJeFn({
      tx,
      date: receivedDate,
      reference: `${params.movementType}-${movement.id.slice(-6).toUpperCase()}`,
      narrationAr: `إضافة مخزنية (${params.movementType}): ${item.nameAr} × ${params.qtyBase}`,
      narrationEn: `Inventory Receipt (${params.movementType}): ${item.nameEn || item.nameAr}`,
      sourceType: "INVENTORY_MOVEMENT",
      sourceId: movement.id,
      projectId: params.projectId ?? null,
      costCenterId: params.costCenterId ?? null,
      createdById: params.createdById,
      status: "POSTED",
      lines: [
        {
          ...invSpec,
          debit: totalCost,
          projectId: params.projectId ?? null,
          costCenterId: params.costCenterId ?? null,
          memo: `وارد مخزون: ${item.nameAr}`,
        },
        {
          ...contraSpec,
          credit: totalCost,
          projectId: params.projectId ?? null,
          costCenterId: params.costCenterId ?? null,
          memo: params.notes || `مقابل حركة مخزنية (${params.movementType})`,
        },
      ],
    });
  }

  return { movement, balance, lot, totalCost, journalEntry };
}

/**
 * Consumes outgoing inventory using FIFO lots (when costingMethod === "FIFO") or WAC,
 * records StockMovement, decrements StockBalance, and optionally posts GL DR COGS/Shrinkage CR Inventory.
 */
export async function consumeStockLayersOutTx(
  tx: Prisma.TransactionClient,
  params: {
    itemId: string;
    warehouseId: string;
    enteredQty: number;
    enteredUnitId?: string;
    factorToBase?: number;
    qtyBase: number;
    movementType: "SALE_OUT" | "ADJUSTMENT_OUT" | "TRANSFER_OUT";
    referenceType?: string;
    referenceId?: string;
    projectId?: string | null;
    costCenterId?: string | null;
    notes?: string | null;
    date?: Date;
    postGl?: boolean;
    contraAccountId?: string;
    contraAccountCode?: string;
    createdById?: string;
    postJeFn?: StockPostJournalFn;
  }
) {
  const settingsRow = await tx.systemSettings.findUnique({ where: { id: "default" } });
  const settings = parseAccountingSettings(settingsRow);

  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: params.itemId } });
  const existingBalance = await tx.stockBalance.findUnique({
    where: { itemId_warehouseId: { itemId: item.id, warehouseId: params.warehouseId } },
  });

  const prevQty = Number(existingBalance?.qtyOnHandBase ?? 0);
  const prevAvgCost = Number(existingBalance?.avgUnitCostBase ?? item.purchasePrice ?? 0);

  const policy = checkNegativeStockPolicy({
    currentQtyBase: prevQty,
    outgoingQtyBase: params.qtyBase,
    policy: settings.negativeStockPolicy,
  });
  if (!policy.ok) {
    throw new Error(`NEGATIVE_STOCK_BLOCKED: ${policy.error}`);
  }

  let totalCost = 0;
  let remainingToConsume = params.qtyBase;

  // Always deplete open FIFO lots; under FIFO use exact lot unitCost, under WAC value at prevAvgCost
  const openLots = await tx.inventoryLot.findMany({
    where: {
      itemId: item.id,
      warehouseId: params.warehouseId,
      currentQuantity: { gt: 0 },
    },
    orderBy: [{ receivedDate: "asc" }, { createdAt: "asc" }],
  });

  if (settings.costingMethod === "FIFO" && openLots.length > 0) {
    for (const lot of openLots) {
      if (remainingToConsume <= 0.0001) break;
      const lotAvail = Number(lot.currentQuantity);
      const take = Math.min(remainingToConsume, lotAvail);
      totalCost = dAdd(totalCost, dMul(take, Number(lot.unitCost), 4), 4);
      remainingToConsume = dSub(remainingToConsume, take, 4);
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: { currentQuantity: round4Decimal(dSub(lotAvail, take, 4)) },
      });
    }
    if (remainingToConsume > 0.0001) {
      // Any residual un-lotted legacy stock priced at avg cost
      totalCost = dAdd(totalCost, dMul(remainingToConsume, prevAvgCost, 4), 4);
    }
  } else {
    // Weighted Average Cost (still keep InventoryLot quantities synced FIFO)
    totalCost = round4Decimal(dMul(params.qtyBase, prevAvgCost, 4));
    let lotRem = params.qtyBase;
    for (const lot of openLots) {
      if (lotRem <= 0.0001) break;
      const lotAvail = Number(lot.currentQuantity);
      const take = Math.min(lotRem, lotAvail);
      lotRem = dSub(lotRem, take, 4);
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: { currentQuantity: round4Decimal(dSub(lotAvail, take, 4)) },
      });
    }
  }

  totalCost = round4Decimal(totalCost);
  const unitCostOutBase = params.qtyBase > 0 ? round4Decimal(dDiv(totalCost, params.qtyBase, 4)) : prevAvgCost;

  const balance = await tx.stockBalance.upsert({
    where: { itemId_warehouseId: { itemId: item.id, warehouseId: params.warehouseId } },
    update: { qtyOnHandBase: policy.resultingQtyBase },
    create: {
      itemId: item.id,
      warehouseId: params.warehouseId,
      qtyOnHandBase: policy.resultingQtyBase,
      avgUnitCostBase: prevAvgCost,
    },
  });

  const txDate = params.date ?? new Date();
  const movement = await tx.stockMovement.create({
    data: {
      itemId: item.id,
      warehouseId: params.warehouseId,
      movementType: params.movementType,
      enteredQty: params.enteredQty,
      enteredUnitId: params.enteredUnitId || item.baseUnitId,
      factorToBase: params.factorToBase || 1,
      baseQtyDelta: -Math.abs(params.qtyBase),
      unitCostBase: unitCostOutBase,
      referenceType: params.referenceType ?? "MANUAL",
      referenceId: params.referenceId ?? null,
      costCenterId: params.costCenterId ?? null,
      notes: params.notes ?? null,
    },
  });

  let journalEntry: { id: string; entryNumber: string; status: string } | null = null;
  if (params.postGl && params.postJeFn && totalCost > 0.005) {
    const invSpec = resolveInventoryGlAccountSpec(item, settings.controlAccounts);
    const contraSpec = params.contraAccountId
      ? { accountId: params.contraAccountId }
      : params.contraAccountCode
      ? { accountCode: params.contraAccountCode }
      : params.movementType === "SALE_OUT"
      ? resolveCogsGlAccountSpec(item, settings.controlAccounts)
      : {
          accountCode: settings.controlAccounts.inventoryShrinkageAccount || "512301",
        };

    journalEntry = await params.postJeFn({
      tx,
      date: txDate,
      reference: `${params.movementType}-${movement.id.slice(-6).toUpperCase()}`,
      narrationAr: `صرف مخزني (${params.movementType}): ${item.nameAr} × ${params.qtyBase}`,
      narrationEn: `Inventory Issue (${params.movementType}): ${item.nameEn || item.nameAr}`,
      sourceType: "INVENTORY_MOVEMENT",
      sourceId: movement.id,
      projectId: params.projectId ?? null,
      costCenterId: params.costCenterId ?? null,
      createdById: params.createdById,
      status: "POSTED",
      lines: [
        {
          ...contraSpec,
          debit: totalCost,
          projectId: params.projectId ?? null,
          costCenterId: params.costCenterId ?? null,
          memo:
            params.movementType === "SALE_OUT"
              ? `تكلفة مبيعات: ${item.nameAr}`
              : params.notes || `صرف مخزون (${params.movementType})`,
        },
        {
          ...invSpec,
          credit: totalCost,
          projectId: params.projectId ?? null,
          costCenterId: params.costCenterId ?? null,
          memo: `تخفيض مخزون: ${item.nameAr}`,
        },
      ],
    });
  }

  return {
    movement,
    balance,
    totalCost,
    unitCostOutBase,
    warning: policy.warning,
    journalEntry,
  };
}

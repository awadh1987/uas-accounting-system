import type { Prisma, PrismaClient } from "@prisma/client";
import {
  evaluateSaleAgainstHarvestStock,
  reconcileHarvestInventory,
} from "@/lib/harvestReconciliation";
import type { UasInventoryBatch, UasSaleTransaction } from "@/types/uas";

type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function canOverrideNegativeStock(role: string | null | undefined): boolean {
  const norm = String(role || "").trim().toUpperCase();
  return norm === "SUPER_ADMIN" || norm === "CHIEF_ACCOUNTANT";
}

function mapBatches(
  rows: Array<{
    id: string;
    projectId: string;
    subProjectId: string | null;
    harvestName: string;
    productGrade: string;
    harvestedBundles: number;
    shrinkageBundles: number;
    notes: string;
  }>
): UasInventoryBatch[] {
  return rows.map((b) => ({
    id: b.id,
    projectId: b.projectId,
    subProjectId: b.subProjectId ?? null,
    harvest: b.harvestName,
    grade: b.productGrade,
    harvestedBundles: b.harvestedBundles,
    shrinkageBundles: b.shrinkageBundles,
    notes: b.notes,
  }));
}

function mapSales(
  rows: Array<{
    id: string;
    projectId: string;
    subProjectId: string | null;
    harvestName: string;
    saleBatchLabel: string;
    customerName: string;
    customerPhone: string;
    productGrade: string;
    bundlesCount: number;
    unitPrice: Prisma.Decimal | number | string;
    totalAmount: Prisma.Decimal | number | string;
    creditPaid: Prisma.Decimal | number | string;
    debitReceivable: Prisma.Decimal | number | string;
    saleDate: string;
    receiptVoucherNo: string;
    notes: string;
  }>
): UasSaleTransaction[] {
  return rows.map((s) => ({
    id: s.id,
    projectId: s.projectId,
    subProjectId: s.subProjectId ?? null,
    harvest: s.harvestName,
    batch: s.saleBatchLabel,
    customer: s.customerName,
    phone: s.customerPhone,
    grade: s.productGrade,
    bundles: s.bundlesCount,
    price: Number(s.unitPrice),
    total: Number(s.totalAmount),
    credit: Number(s.creditPaid),
    debit: Number(s.debitReceivable),
    date: s.saleDate,
    voucherNo: s.receiptVoucherNo,
    notes: s.notes,
  }));
}

export async function validateHarvestStockForSaleTx(
  tx: PrismaTx,
  params: {
    projectId: string;
    subProjectId?: string | null;
    harvestName: string;
    productGrade: string;
    requestedBundles: number;
    excludeSaleId?: string;
    allowNegativeStock?: boolean;
    actorRole?: string | null;
  }
): Promise<{
  overridden: boolean;
  hasTrackedBatches: boolean;
  availableBundles: number;
  shortageBundles: number;
}> {
  const [batchRows, saleRows] = await Promise.all([
    tx.harvestInventoryBatch.findMany({
      where: { projectId: params.projectId },
      orderBy: { createdAt: "asc" },
    }),
    tx.saleTransaction.findMany({
      where: { projectId: params.projectId },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const check = evaluateSaleAgainstHarvestStock({
    batches: mapBatches(batchRows),
    sales: mapSales(saleRows),
    projectId: params.projectId,
    subProjectId: params.subProjectId,
    harvest: params.harvestName,
    grade: params.productGrade,
    requestedBundles: params.requestedBundles,
    excludeSaleId: params.excludeSaleId,
  });

  if (!check.hasTrackedBatches || check.withinStock) {
    return {
      overridden: false,
      hasTrackedBatches: check.hasTrackedBatches,
      availableBundles: check.availableBundles,
      shortageBundles: 0,
    };
  }

  if (params.allowNegativeStock) {
    if (!canOverrideNegativeStock(params.actorRole)) {
      throw new Error(
        `NEGATIVE_STOCK_OVERRIDE_FORBIDDEN: تجاوز الرصيد المتاح (${check.availableBundles}) يتطلب صلاحية المدير العام أو كبير المحاسبين / Negative stock override requires SUPER_ADMIN or CHIEF_ACCOUNTANT.`
      );
    }
    return {
      overridden: true,
      hasTrackedBatches: true,
      availableBundles: check.availableBundles,
      shortageBundles: check.shortageBundles,
    };
  }

  throw new Error(
    `NEGATIVE_STOCK_BLOCKED: الكمية المطلوبة (${check.requestedBundles}) تتجاوز الرصيد المتاح في مخزون الحصاد (${Math.max(0, check.availableBundles)}) بعجز ${check.shortageBundles} علاقية. يرجى مراجعة كميات الحصاد أو استخدام اعتماد التجاوز المحاسبي / Requested (${check.requestedBundles}) exceeds available harvest stock (${Math.max(0, check.availableBundles)}) by ${check.shortageBundles}.`
  );
}

export async function validateHarvestStockAfterBatchUpdateTx(
  tx: PrismaTx,
  params: {
    batchId: string;
    nextProjectId: string;
    nextSubProjectId?: string | null;
    nextHarvestName: string;
    nextProductGrade: string;
    nextHarvestedBundles: number;
    nextShrinkageBundles: number;
    allowNegativeStock?: boolean;
    actorRole?: string | null;
  }
): Promise<{ overridden: boolean; deficitBundles: number }> {
  const [batchRows, saleRows] = await Promise.all([
    tx.harvestInventoryBatch.findMany({
      where: { projectId: params.nextProjectId },
      orderBy: { createdAt: "asc" },
    }),
    tx.saleTransaction.findMany({
      where: { projectId: params.nextProjectId },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const mappedBatches = mapBatches(batchRows).map((b) =>
    b.id === params.batchId
      ? {
          ...b,
          projectId: params.nextProjectId,
          subProjectId: params.nextSubProjectId ?? null,
          harvest: params.nextHarvestName,
          grade: params.nextProductGrade,
          harvestedBundles: params.nextHarvestedBundles,
          shrinkageBundles: params.nextShrinkageBundles,
        }
      : b
  );

  const report = reconcileHarvestInventory(mappedBatches, mapSales(saleRows));
  const row = report.byBatchId[params.batchId];
  if (!row || row.remainingBundles >= 0) {
    return { overridden: false, deficitBundles: 0 };
  }

  const deficit = Math.abs(row.remainingBundles);
  if (params.allowNegativeStock) {
    if (!canOverrideNegativeStock(params.actorRole)) {
      throw new Error(
        `NEGATIVE_STOCK_OVERRIDE_FORBIDDEN: تعديل الدفعة يسبب عجزاً (${deficit}) ويتطلب اعتماد المدير العام أو كبير المحاسبين.`
      );
    }
    return { overridden: true, deficitBundles: deficit };
  }

  throw new Error(
    `NEGATIVE_STOCK_BLOCKED: لا يمكن خفض الصافي المتاح عن الكمية المباعة بالفعل (${row.soldBundles} علاقية) — العجز الناتج: ${deficit} علاقية.`
  );
}

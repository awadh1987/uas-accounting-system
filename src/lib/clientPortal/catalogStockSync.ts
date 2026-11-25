import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizeReconciliationText,
  reconcileHarvestInventory,
} from "@/lib/harvestReconciliation";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import type { CatalogAvailabilityStatus } from "@/lib/clientPortal/portalTypes";

type TxOrClient = Prisma.TransactionClient | typeof prisma;

export function computeBoardAvailabilityFromStock(
  remainingQty: number | null,
  lowStockThreshold = 5
): CatalogAvailabilityStatus {
  if (remainingQty === null || !Number.isFinite(remainingQty)) return "AVAILABLE";
  if (remainingQty <= 0) return "UNAVAILABLE";
  if (remainingQty <= Math.max(0, lowStockThreshold)) return "LIMITED";
  return "AVAILABLE";
}

/**
 * Synchronizes published/draft PortalCatalogBoardItem remainingQty and availabilityStatus
 * directly from HarvestInventoryBatch - SaleTransaction reconciliation AND InventoryItem
 * StockBalance (quantityOnHand - quantityReserved).
 */
export async function syncPublishedCatalogStockTx(tx: TxOrClient = prisma): Promise<{
  updatedCount: number;
}> {
  const boardItems = await tx.portalCatalogBoardItem
    .findMany({
      where: {
        OR: [
          { harvestBatchId: { not: null } },
          { inventoryItemId: { not: null } },
          { projectId: { not: null } },
        ],
      },
    })
    .catch(() => []);

  if (boardItems.length === 0) {
    return { updatedCount: 0 };
  }

  const [harvestBatches, salesRows, stockBalances] = await Promise.all([
    tx.harvestInventoryBatch.findMany({
      select: {
        id: true,
        projectId: true,
        subProjectId: true,
        harvestName: true,
        productGrade: true,
        harvestedBundles: true,
        shrinkageBundles: true,
      },
    }),
    tx.saleTransaction.findMany({
      select: {
        id: true,
        projectId: true,
        subProjectId: true,
        harvestName: true,
        productGrade: true,
        bundlesCount: true,
      },
    }),
    tx.stockBalance.findMany({
      select: {
        itemId: true,
        qtyOnHandBase: true,
      },
    }),
  ]);

  const harvestRecon = reconcileHarvestInventory(
    harvestBatches.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      subProjectId: b.subProjectId ?? null,
      harvest: b.harvestName,
      grade: b.productGrade,
      harvestedBundles: Number(b.harvestedBundles || 0),
      shrinkageBundles: Number(b.shrinkageBundles || 0),
      notes: "",
    })),
    salesRows.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      subProjectId: s.subProjectId ?? null,
      harvest: s.harvestName,
      grade: s.productGrade,
      bundles: Number(s.bundlesCount || 0),
      batch: "",
      customer: "",
      phone: "",
      price: 0,
      total: 0,
      credit: 0,
      debit: 0,
      date: "",
      voucherNo: "",
      notes: "",
    }))
  );

  const inventoryAvailableByItem = new Map<string, number>();
  for (const sb of stockBalances) {
    const avail = Math.max(0, Number(sb.qtyOnHandBase || 0));
    inventoryAvailableByItem.set(
      sb.itemId,
      (inventoryAvailableByItem.get(sb.itemId) || 0) + avail
    );
  }

  let updatedCount = 0;
  for (const item of boardItems) {
    let nextRemaining: number | null = null;

    if (item.harvestBatchId) {
      const targetBatch = harvestBatches.find((b) => b.id === item.harvestBatchId);
      if (targetBatch) {
        const matchedRow = harvestRecon.rows.find(
          (r) =>
            r.batch.id === targetBatch.id ||
            (r.batch.projectId === targetBatch.projectId &&
              normalizeReconciliationText(r.batch.harvest) ===
                normalizeReconciliationText(targetBatch.harvestName) &&
              normalizeReconciliationText(r.batch.grade) ===
                normalizeReconciliationText(targetBatch.productGrade))
        );
        if (matchedRow) {
          nextRemaining = Math.max(0, matchedRow.remainingBundles);
        }
      }
    } else if (item.projectId && item.harvestName) {
      const matchedRow = harvestRecon.rows.find(
        (r) =>
          r.batch.projectId === item.projectId &&
          normalizeReconciliationText(r.batch.harvest) ===
            normalizeReconciliationText(item.harvestName) &&
          normalizeReconciliationText(r.batch.grade) ===
            normalizeReconciliationText(item.gradeLabel)
      );
      if (matchedRow) {
        nextRemaining = Math.max(0, matchedRow.remainingBundles);
      }
    } else if (item.inventoryItemId && inventoryAvailableByItem.has(item.inventoryItemId)) {
      nextRemaining = Math.max(0, inventoryAvailableByItem.get(item.inventoryItemId) || 0);
    }

    if (nextRemaining !== null) {
      const nextStatus = computeBoardAvailabilityFromStock(
        nextRemaining,
        Number(item.lowStockThreshold || 5)
      );
      const prevRemaining =
        item.remainingQty !== null && item.remainingQty !== undefined
          ? Number(item.remainingQty)
          : null;
      if (
        prevRemaining === null ||
        Math.abs(prevRemaining - nextRemaining) > 0.0001 ||
        item.availabilityStatus !== nextStatus
      ) {
        await tx.portalCatalogBoardItem.update({
          where: { id: item.id },
          data: {
            remainingQty: nextRemaining,
            availabilityStatus: nextStatus,
          },
        });
        updatedCount += 1;
      }
    }
  }

  return { updatedCount };
}

/**
 * Deducts live published board stock when a client portal request is confirmed or handed over,
 * prioritizing items with catalogBoardItemId that carry standalone publishedQty/remainingQty.
 */
export async function deductPublishedCatalogStockForLinesTx(
  tx: TxOrClient,
  lines: Array<{
    catalogBoardItemId?: string | null;
    qty: number;
  }>
): Promise<void> {
  for (const line of lines) {
    if (!line.catalogBoardItemId || line.qty <= 0) continue;
    const board = await tx.portalCatalogBoardItem
      .findUnique({ where: { id: line.catalogBoardItemId } })
      .catch(() => null);
    if (!board) continue;
    // Skip direct decrement if harvest/inventory reconciliation manages this item dynamically
    if (board.harvestBatchId || board.inventoryItemId) continue;
    if (board.remainingQty === null || board.remainingQty === undefined) continue;

    const nextRemaining = Math.max(0, Number(board.remainingQty) - line.qty);
    const nextStatus = computeBoardAvailabilityFromStock(
      nextRemaining,
      Number(board.lowStockThreshold || 5)
    );
    await tx.portalCatalogBoardItem.update({
      where: { id: board.id },
      data: {
        remainingQty: nextRemaining,
        availabilityStatus: nextStatus,
      },
    });
  }
}

export async function publishHarvestBatchesToCatalogBoard(params: {
  batchIds?: string[];
  unitPriceByBatchId?: Record<string, number>;
  publishImmediately?: boolean;
  tenantSlug?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const [batches, projects, salesRows] = await Promise.all([
    prisma.harvestInventoryBatch.findMany({
      where:
        params.batchIds && params.batchIds.length > 0
          ? { id: { in: params.batchIds } }
          : undefined,
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({ select: { id: true, nameAr: true } }),
    prisma.saleTransaction.findMany({
      select: {
        id: true,
        projectId: true,
        subProjectId: true,
        harvestName: true,
        productGrade: true,
        bundlesCount: true,
      },
    }),
  ]);

  const projectNames = new Map(projects.map((p) => [p.id, p.nameAr]));
  const recon = reconcileHarvestInventory(
    batches.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      subProjectId: b.subProjectId ?? null,
      harvest: b.harvestName,
      grade: b.productGrade,
      harvestedBundles: Number(b.harvestedBundles || 0),
      shrinkageBundles: Number(b.shrinkageBundles || 0),
      notes: "",
    })),
    salesRows.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      subProjectId: s.subProjectId ?? null,
      harvest: s.harvestName,
      grade: s.productGrade,
      bundles: Number(s.bundlesCount || 0),
      batch: "",
      customer: "",
      phone: "",
      price: 0,
      total: 0,
      credit: 0,
      debit: 0,
      date: "",
      voucherNo: "",
      notes: "",
    }))
  );

  const now = new Date();
  let createdOrUpdated = 0;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      const matched = recon.rows.find(
        (r) =>
          r.batch.id === b.id ||
          (r.batch.projectId === b.projectId &&
            normalizeReconciliationText(r.batch.harvest) === normalizeReconciliationText(b.harvestName) &&
            normalizeReconciliationText(r.batch.grade) === normalizeReconciliationText(b.productGrade))
      );
      const remainingQty = Math.max(
        0,
        matched
          ? matched.remainingBundles
          : Math.max(0, Number(b.harvestedBundles) - Number(b.shrinkageBundles))
      );
      const netHarvested = Math.max(0, Number(b.harvestedBundles) - Number(b.shrinkageBundles));
      const availabilityStatus = computeBoardAvailabilityFromStock(remainingQty, 5);
      const existing = await tx.portalCatalogBoardItem.findFirst({
        where: { harvestBatchId: b.id },
      });
      const projLabel = projectNames.get(b.projectId) || "المشروع";
      const explicitPrice = params.unitPriceByBatchId?.[b.id];

      if (existing) {
        await tx.portalCatalogBoardItem.update({
          where: { id: existing.id },
          data: {
            publishedQty: netHarvested,
            remainingQty,
            availabilityStatus,
            ...(explicitPrice !== undefined && explicitPrice >= 0
              ? { unitPrice: explicitPrice }
              : {}),
            ...(params.publishImmediately
              ? {
                  isPublished: true,
                  publishedAt: now,
                  publishedById: params.actor.userId ?? null,
                  publishedByName: params.actor.userDisplay,
                }
              : {}),
          },
        });
      } else {
        await tx.portalCatalogBoardItem.create({
          data: {
            harvestBatchId: b.id,
            projectId: b.projectId,
            harvestName: b.harvestName,
            titleAr: `${b.harvestName} — ${b.productGrade}`,
            gradeLabel: b.productGrade || "درجة أولى",
            categoryLabel: projLabel,
            sectorType: "HARVEST",
            categoryGroup: "HARVEST",
            saleMode: "BOTH",
            unitCode: "QAT_BUNCH",
            unitLabel: "علاقية قات",
            unitPrice: explicitPrice !== undefined && explicitPrice >= 0 ? explicitPrice : 0,
            publishedQty: netHarvested,
            remainingQty,
            lowStockThreshold: 5,
            currency: "YER",
            availabilityStatus,
            freshnessLabel: `متبقي من الفرز: ${remainingQty} علاقية`,
            effectiveDate: now.toISOString().slice(0, 10),
            displayOrder: i + 1,
            isPublished: Boolean(params.publishImmediately),
            publishedAt: params.publishImmediately ? now : null,
            publishedById: params.actor.userId ?? null,
            publishedByName: params.actor.userDisplay,
            createdById: params.actor.userId ?? null,
            createdByName: params.actor.userDisplay,
          },
        });
      }
      createdOrUpdated += 1;
    }

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: "PORTAL_CATALOG_HARVEST_SYNC",
      entityReference: `HARVEST_SYNC:${createdOrUpdated}`,
      details: `[tenant:${params.tenantSlug || "default"}] مزامنة ونشر ${createdOrUpdated} دفعة فرز ومخزون مع قائمة الأصناف والأسعار`,
    });
  });

  return { syncedCount: createdOrUpdated };
}

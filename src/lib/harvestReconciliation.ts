import { computeRemainingStock } from "@/lib/formulas";
import type { UasInventoryBatch, UasSaleTransaction } from "@/types/uas";

export function normalizeReconciliationText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitGradeTokens(grade: string): string[] {
  const norm = normalizeReconciliationText(grade);
  if (!norm) return [];
  return norm
    .split(/[\/|,،]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function gradeMatchesBatch(batchGrade: string, saleGrade: string): { exact: boolean; composite: boolean } {
  const bg = normalizeReconciliationText(batchGrade);
  const sg = normalizeReconciliationText(saleGrade);
  if (!bg || !sg) return { exact: false, composite: false };
  if (bg === sg) return { exact: true, composite: false };
  const batchTokens = splitGradeTokens(bg);
  if (
    batchTokens.length > 1 &&
    (batchTokens.includes(sg) || sg.includes("ميكس") || sg.includes("مختلط"))
  ) {
    return { exact: false, composite: true };
  }
  if (bg.includes("ميكس") || bg.includes("مختلط")) {
    return { exact: false, composite: true };
  }
  return { exact: false, composite: false };
}

export type ReconciliationStatus = "MATCHED" | "DEPLETED" | "SHORTAGE";

export interface ReconciledBatchRow {
  batch: UasInventoryBatch;
  harvestedBundles: number;
  shrinkageBundles: number;
  usableBundles: number;
  soldBundles: number;
  remainingBundles: number;
  shortageBundles: number;
  status: ReconciliationStatus;
  matchedViaComposite: boolean;
}

export interface UnmatchedSalesGroup {
  projectId: string;
  subProjectId: string | null;
  harvest: string;
  grade: string;
  soldBundles: number;
  saleCount: number;
}

export interface HarvestReconciliationSummary {
  totalHarvested: number;
  totalShrinkage: number;
  totalUsable: number;
  totalMatchedSold: number;
  totalUnmatchedSold: number;
  totalRemaining: number;
  shortageBatchCount: number;
}

export interface HarvestReconciliationReport {
  rows: ReconciledBatchRow[];
  byBatchId: Record<string, ReconciledBatchRow>;
  unmatchedSalesGroups: UnmatchedSalesGroup[];
  summary: HarvestReconciliationSummary;
}

/**
 * Reconciles harvested batches, spoilage/shrinkage, and sales transactions without
 * double-deducting `harvestedBundles` or duplicating group sales across multiple batches.
 *
 * Allocation order:
 *  1) Exact `(projectId, subProjectId?, harvest, grade)` batches (FIFO across batches in group)
 *  2) Unallocated exact-project/harvest/grade batches ignoring empty subProjectId mismatch
 *  3) Composite/mixed-grade batches in the same `(projectId, harvest)`
 */
export function reconcileHarvestInventory(
  batches: UasInventoryBatch[],
  sales: UasSaleTransaction[]
): HarvestReconciliationReport {
  const rowStates: ReconciledBatchRow[] = batches.map((b) => {
    const harvested = Math.max(0, Math.round(Number(b.harvestedBundles) || 0));
    const shrinkage = Math.max(0, Math.round(Number(b.shrinkageBundles) || 0));
    const usable = Math.max(0, harvested - shrinkage);
    return {
      batch: b,
      harvestedBundles: harvested,
      shrinkageBundles: shrinkage,
      usableBundles: usable,
      soldBundles: 0,
      remainingBundles: computeRemainingStock(harvested, 0, shrinkage),
      shortageBundles: 0,
      status: usable === 0 && harvested - shrinkage < 0 ? "SHORTAGE" : "MATCHED",
      matchedViaComposite: false,
    };
  });

  // Track unallocated bundles per sale
  const remainingSaleBundles = sales.map((s) => Math.max(0, Number(s.bundles) || 0));

  const allocateToCandidates = (
    saleIdx: number,
    candidates: ReconciledBatchRow[],
    viaComposite: boolean
  ) => {
    let toAllocate = remainingSaleBundles[saleIdx];
    if (toAllocate <= 0 || candidates.length === 0) return;

    // First fill available capacity across matching batches FIFO
    for (const row of candidates) {
      if (toAllocate <= 0) break;
      const room = Math.max(0, row.usableBundles - row.soldBundles);
      if (room > 0) {
        const take = Math.min(room, toAllocate);
        row.soldBundles += take;
        if (viaComposite) row.matchedViaComposite = true;
        toAllocate -= take;
      }
    }

    // Any overflow beyond batch usable capacity is attributed once to the last batch in the bucket
    if (toAllocate > 0) {
      const target = candidates[candidates.length - 1];
      target.soldBundles += toAllocate;
      if (viaComposite) target.matchedViaComposite = true;
      toAllocate = 0;
    }

    remainingSaleBundles[saleIdx] = toAllocate;
  };

  // Pass 1 & 2: Exact grade match (first same subProject, then project/harvest-wide)
  for (let i = 0; i < sales.length; i++) {
    if (remainingSaleBundles[i] <= 0) continue;
    const s = sales[i];
    const sHarvest = normalizeReconciliationText(s.harvest);
    const sSub = (s.subProjectId || "").trim();

    const exactSameSub = rowStates.filter((r) => {
      const b = r.batch;
      if (b.projectId !== s.projectId) return false;
      if (normalizeReconciliationText(b.harvest) !== sHarvest) return false;
      if ((b.subProjectId || "").trim() !== sSub) return false;
      return gradeMatchesBatch(b.grade, s.grade).exact;
    });
    if (exactSameSub.length > 0) {
      allocateToCandidates(i, exactSameSub, false);
      continue;
    }

    const exactAnySub = rowStates.filter((r) => {
      const b = r.batch;
      if (b.projectId !== s.projectId) return false;
      if (normalizeReconciliationText(b.harvest) !== sHarvest) return false;
      if (sSub && (b.subProjectId || "").trim() && (b.subProjectId || "").trim() !== sSub) return false;
      return gradeMatchesBatch(b.grade, s.grade).exact;
    });
    if (exactAnySub.length > 0) {
      allocateToCandidates(i, exactAnySub, false);
    }
  }

  // Pass 3: Composite / mixed harvest batches (e.g., "رقم 1/رقم 2/رقم 3/ روس/بزغة")
  for (let i = 0; i < sales.length; i++) {
    if (remainingSaleBundles[i] <= 0) continue;
    const s = sales[i];
    const sHarvest = normalizeReconciliationText(s.harvest);
    const sSub = (s.subProjectId || "").trim();

    const compositeCandidates = rowStates.filter((r) => {
      const b = r.batch;
      if (b.projectId !== s.projectId) return false;
      if (normalizeReconciliationText(b.harvest) !== sHarvest) return false;
      if (sSub && (b.subProjectId || "").trim() && (b.subProjectId || "").trim() !== sSub) return false;
      return gradeMatchesBatch(b.grade, s.grade).composite;
    });
    if (compositeCandidates.length > 0) {
      allocateToCandidates(i, compositeCandidates, true);
    }
  }

  // Finalize per-row remaining & status
  const byBatchId: Record<string, ReconciledBatchRow> = {};
  for (const row of rowStates) {
    const remaining = computeRemainingStock(
      row.harvestedBundles,
      row.soldBundles,
      row.shrinkageBundles
    );
    row.remainingBundles = remaining;
    row.shortageBundles = remaining < 0 ? Math.abs(remaining) : 0;
    if (remaining < 0) {
      row.status = "SHORTAGE";
    } else if (remaining === 0) {
      row.status = "DEPLETED";
    } else {
      row.status = "MATCHED";
    }
    byBatchId[row.batch.id] = row;
  }

  // Pass 4: Group any unposted-harvest sales cleanly
  const unmatchedMap = new Map<string, UnmatchedSalesGroup>();
  let totalUnmatchedSold = 0;
  for (let i = 0; i < sales.length; i++) {
    const unalloc = remainingSaleBundles[i];
    if (unalloc <= 0) continue;
    const s = sales[i];
    totalUnmatchedSold += unalloc;
    const key = `${s.projectId}::${s.subProjectId || ""}::${normalizeReconciliationText(s.harvest)}::${normalizeReconciliationText(s.grade)}`;
    const existing = unmatchedMap.get(key);
    if (existing) {
      existing.soldBundles += unalloc;
      existing.saleCount += 1;
    } else {
      unmatchedMap.set(key, {
        projectId: s.projectId,
        subProjectId: s.subProjectId || null,
        harvest: s.harvest,
        grade: s.grade,
        soldBundles: unalloc,
        saleCount: 1,
      });
    }
  }

  const summary = rowStates.reduce<HarvestReconciliationSummary>(
    (acc, r) => {
      acc.totalHarvested += r.harvestedBundles;
      acc.totalShrinkage += r.shrinkageBundles;
      acc.totalUsable += r.usableBundles;
      acc.totalMatchedSold += r.soldBundles;
      acc.totalRemaining += r.remainingBundles;
      if (r.status === "SHORTAGE") acc.shortageBatchCount += 1;
      return acc;
    },
    {
      totalHarvested: 0,
      totalShrinkage: 0,
      totalUsable: 0,
      totalMatchedSold: 0,
      totalUnmatchedSold,
      totalRemaining: 0,
      shortageBatchCount: 0,
    }
  );

  return {
    rows: rowStates,
    byBatchId,
    unmatchedSalesGroups: Array.from(unmatchedMap.values()),
    summary,
  };
}

export interface HarvestStockCheckResult {
  hasTrackedBatches: boolean;
  availableBundles: number;
  requestedBundles: number;
  shortageBundles: number;
  withinStock: boolean;
}

/**
 * Checks whether selling `requestedBundles` for `(projectId, subProjectId?, harvest, grade)`
 * fits within posted harvest inventory (excluding `excludeSaleId` when editing an existing sale).
 */
export function evaluateSaleAgainstHarvestStock(params: {
  batches: UasInventoryBatch[];
  sales: UasSaleTransaction[];
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  grade: string;
  requestedBundles: number;
  excludeSaleId?: string;
}): HarvestStockCheckResult {
  const targetHarvest = normalizeReconciliationText(params.harvest);
  const targetSub = (params.subProjectId || "").trim();

  const relevantBatches = params.batches.filter((b) => {
    if (b.projectId !== params.projectId) return false;
    if (normalizeReconciliationText(b.harvest) !== targetHarvest) return false;
    if (targetSub && (b.subProjectId || "").trim() && (b.subProjectId || "").trim() !== targetSub) {
      return false;
    }
    const m = gradeMatchesBatch(b.grade, params.grade);
    return m.exact || m.composite;
  });

  if (relevantBatches.length === 0) {
    return {
      hasTrackedBatches: false,
      availableBundles: 0,
      requestedBundles: params.requestedBundles,
      shortageBundles: 0,
      withinStock: true,
    };
  }

  const filteredSales = params.excludeSaleId
    ? params.sales.filter((s) => s.id !== params.excludeSaleId)
    : params.sales;

  const report = reconcileHarvestInventory(relevantBatches, filteredSales);
  const totalAvailable = report.summary.totalRemaining;
  const reqBundles = Math.max(0, Math.round(Number(params.requestedBundles) || 0));
  const shortage = Math.max(0, reqBundles - Math.max(0, totalAvailable));

  return {
    hasTrackedBatches: true,
    availableBundles: totalAvailable,
    requestedBundles: reqBundles,
    shortageBundles: shortage,
    withinStock: reqBundles <= totalAvailable,
  };
}

import { formatIsoToDmy } from "@/lib/uiFormatters";

export type CatalogAvailabilityStatus = "AVAILABLE" | "LIMITED" | "UNAVAILABLE";

export const CATALOG_AVAILABILITY_LABELS: Record<CatalogAvailabilityStatus, string> = {
  AVAILABLE: "متوفر",
  LIMITED: "كمية محدودة",
  UNAVAILABLE: "غير متوفر",
};

export const PORTAL_GRADE_PRESETS = [
  "نخب ممتاز",
  "درجة أولى",
  "درجة ثانية",
  "عروسي / خاص",
  "فرز يومي",
] as const;

export interface ClientCatalogBoardItemView {
  id: string;
  inventoryItemId: string | null;
  harvestBatchId?: string | null;
  projectId?: string | null;
  harvestName?: string | null;
  sku: string | null;
  titleAr: string;
  titleEn: string | null;
  gradeLabel: string;
  categoryLabel: string;
  sectorType?: string;
  categoryGroup?: string;
  saleMode?: string;
  unitCode: string;
  unitLabel: string;
  customUnitLabel: string | null;
  displayUnitLabel: string;
  unitPrice: number;
  bulkUnitLabel?: string | null;
  partialUnitLabel?: string | null;
  partialUnitPrice?: number;
  multiplierToBase?: number;
  publishedQty?: number | null;
  remainingQty?: number | null;
  lowStockThreshold?: number;
  currency: string;
  availabilityStatus: CatalogAvailabilityStatus;
  availabilityLabelAr: string;
  pickupLocation: string | null;
  freshnessLabel: string;
  effectiveDate: string | null;
  effectiveDateDmy: string;
  validityNote: string | null;
  displayOrder: number;
  publishedAt: string | null;
  notes: string | null;
}

export interface StaffCatalogBoardItemView extends ClientCatalogBoardItemView {
  isPublished: boolean;
  publishedByName: string | null;
  createdByName: string | null;
  updatedAt: string;
}

export interface ClientCatalogBoardStats {
  totalPublished: number;
  availableCount: number;
  limitedCount: number;
  unavailableCount: number;
  gradesCount: number;
  categoriesCount: number;
  grades: string[];
  categories: string[];
  units: Array<{ unitCode: string; displayUnitLabel: string }>;
  latestFreshnessLabel: string;
  latestEffectiveDate: string | null;
  latestEffectiveDateDmy: string;
  latestValidityNote: string | null;
}

export interface AmendmentDiffEntry {
  field: string;
  labelAr: string;
  before: string;
  after: string;
}

export interface RequestAmendmentSnapshot {
  pickupType: string;
  pickupLocation: string;
  pickupNotes: string | null;
  creditPaidPlanned: number;
  debitPlanned: number;
  totalAmount: number;
  lines: Array<{
    id: string;
    itemTitle: string;
    qty: number;
    unitCode: string;
    unitLabel: string;
    customUnitLabel: string | null;
    displayUnitLabel: string;
    unitPrice: number;
    lineTotal: number;
  }>;
}

export function computeClientCatalogBoardStats(
  items: ClientCatalogBoardItemView[]
): ClientCatalogBoardStats {
  const gradeSet = new Set<string>();
  const categorySet = new Set<string>();
  const unitMap = new Map<string, string>();
  let availableCount = 0;
  let limitedCount = 0;
  let unavailableCount = 0;

  let latestFreshnessLabel = "قائمة أسعار اليوم";
  let latestEffectiveDate: string | null = null;
  let latestValidityNote: string | null = null;

  for (const it of items) {
    if (it.gradeLabel) gradeSet.add(it.gradeLabel);
    if (it.categoryLabel) categorySet.add(it.categoryLabel);
    if (!unitMap.has(it.unitCode)) {
      unitMap.set(it.unitCode, it.displayUnitLabel);
    }
    if (it.availabilityStatus === "AVAILABLE") availableCount += 1;
    else if (it.availabilityStatus === "LIMITED") limitedCount += 1;
    else unavailableCount += 1;

    if (it.effectiveDate && (!latestEffectiveDate || it.effectiveDate >= latestEffectiveDate)) {
      latestEffectiveDate = it.effectiveDate;
      latestFreshnessLabel = it.freshnessLabel || latestFreshnessLabel;
      latestValidityNote = it.validityNote ?? latestValidityNote;
    } else if (!latestEffectiveDate && it.freshnessLabel) {
      latestFreshnessLabel = it.freshnessLabel;
      latestValidityNote = it.validityNote ?? latestValidityNote;
    }
  }

  return {
    totalPublished: items.length,
    availableCount,
    limitedCount,
    unavailableCount,
    gradesCount: gradeSet.size,
    categoriesCount: categorySet.size,
    grades: Array.from(gradeSet),
    categories: Array.from(categorySet),
    units: Array.from(unitMap.entries()).map(([unitCode, displayUnitLabel]) => ({
      unitCode,
      displayUnitLabel,
    })),
    latestFreshnessLabel,
    latestEffectiveDate,
    latestEffectiveDateDmy: latestEffectiveDate ? formatIsoToDmy(latestEffectiveDate) : "",
    latestValidityNote,
  };
}

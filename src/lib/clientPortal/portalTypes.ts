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
  sku: string | null;
  titleAr: string;
  titleEn: string | null;
  gradeLabel: string;
  categoryLabel: string;
  unitCode: string;
  unitLabel: string;
  customUnitLabel: string | null;
  displayUnitLabel: string;
  unitPrice: number;
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

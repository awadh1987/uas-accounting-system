export interface UomSeedDef {
  code: string;
  nameAr: string;
  nameEn: string;
  isBaseDefault: boolean;
  isCustom: boolean;
}

export const DEFAULT_UOMS: UomSeedDef[] = [
  { code: "PIECE", nameAr: "حبة", nameEn: "Piece", isBaseDefault: true, isCustom: false },
  { code: "BUNDLE", nameAr: "ربطة / علاقية", nameEn: "Bundle", isBaseDefault: false, isCustom: false },
  { code: "BAG", nameAr: "كيس", nameEn: "Bag", isBaseDefault: false, isCustom: false },
  { code: "CARTON", nameAr: "كرتون", nameEn: "Carton", isBaseDefault: false, isCustom: false },
  { code: "KG", nameAr: "كجم", nameEn: "Kilogram", isBaseDefault: false, isCustom: false },
  { code: "GRAM", nameAr: "جرام", nameEn: "Gram", isBaseDefault: false, isCustom: false },
  { code: "TON", nameAr: "طن", nameEn: "Metric Ton", isBaseDefault: false, isCustom: false },
];

export const DEFAULT_CATEGORIES = [
  { code: "GENERAL", nameAr: "أصناف عامة", nameEn: "General Items", isCustom: false },
  { code: "AGRICULTURAL", nameAr: "منتجات زراعية", nameEn: "Agricultural Products", isCustom: false },
  { code: "INPUTS", nameAr: "مستلزمات ومواد خام", nameEn: "Inputs & Raw Materials", isCustom: false },
  { code: "SERVICES", nameAr: "خدمات", nameEn: "Services", isCustom: false },
];

export const DEFAULT_WAREHOUSES = [
  {
    code: "WH-MAIN",
    nameAr: "المستودع الرئيسي",
    nameEn: "Main Warehouse",
    location: "المقر الرئيسي",
    isDefault: true,
    isCustom: false,
  },
];

export function slugifyLookupCode(label: string, prefix: string): string {
  const ascii = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (ascii.length >= 2) return `${prefix}_${ascii}`.slice(0, 32);
  return `${prefix}_${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Converts an entered quantity in a given unit into base units using `factorToBase`.
 */
export function convertToBaseQty(enteredQty: number, factorToBase: number): number {
  if (!Number.isFinite(enteredQty) || enteredQty < 0) {
    throw new Error("الكمية المدخلة يجب أن تكون رقماً غير سالب / Entered quantity must be non-negative.");
  }
  if (!Number.isFinite(factorToBase) || factorToBase <= 0) {
    throw new Error("معامل التحويل إلى الوحدة الأساسية يجب أن يكون أكبر من الصفر / factorToBase must be > 0.");
  }
  return Math.round((enteredQty * factorToBase + Number.EPSILON) * 10000) / 10000;
}

/**
 * Recalculates Weighted Average Cost (WAC) on incoming stock.
 * Outgoing movements keep the existing `prevAvgCostBase`.
 */
export function computeWeightedAverageCost(params: {
  prevQtyBase: number;
  prevAvgCostBase: number;
  incomingQtyBase: number;
  incomingUnitCostBase: number;
}): { newQtyBase: number; newAvgCostBase: number } {
  const prevQty = Math.max(0, Number(params.prevQtyBase) || 0);
  const prevCost = Math.max(0, Number(params.prevAvgCostBase) || 0);
  const inQty = Math.max(0, Number(params.incomingQtyBase) || 0);
  const inCost = Math.max(0, Number(params.incomingUnitCostBase) || 0);

  const newQtyBase = Math.round((prevQty + inQty + Number.EPSILON) * 10000) / 10000;
  if (newQtyBase <= 0) {
    return { newQtyBase: 0, newAvgCostBase: prevCost };
  }
  const totalValue = prevQty * prevCost + inQty * inCost;
  const newAvgCostBase = Math.round((totalValue / newQtyBase + Number.EPSILON) * 10000) / 10000;
  return { newQtyBase, newAvgCostBase };
}

export interface UnitBreakdownTier {
  label: string;
  factorToBase: number;
}

/**
 * Formats a total base-unit stock quantity into a human-readable compound breakdown
 * (e.g., 533 base pieces with `كرتون=240`, `ربطة=10`, `حبة=1` -> `"2 كرتون + 5 ربطة + 3 حبة"`).
 */
export function formatCompoundStockBreakdown(
  totalBaseQty: number,
  baseUnitLabel: string,
  conversions: UnitBreakdownTier[]
): {
  parts: Array<{ qty: number; label: string; factorToBase: number }>;
  formatted: string;
} {
  const sign = totalBaseQty < 0 ? "-" : "";
  let remaining = Math.abs(totalBaseQty);

  const tiers = conversions
    .filter((c) => Number.isFinite(c.factorToBase) && c.factorToBase > 1)
    .sort((a, b) => b.factorToBase - a.factorToBase);

  const parts: Array<{ qty: number; label: string; factorToBase: number }> = [];

  for (const tier of tiers) {
    const count = Math.floor(remaining / tier.factorToBase);
    if (count > 0) {
      parts.push({ qty: count, label: tier.label, factorToBase: tier.factorToBase });
      remaining = Math.round((remaining - count * tier.factorToBase + Number.EPSILON) * 10000) / 10000;
    }
  }

  if (remaining > 0 || parts.length === 0) {
    const cleanRem = Math.round((remaining + Number.EPSILON) * 10000) / 10000;
    parts.push({ qty: cleanRem, label: baseUnitLabel, factorToBase: 1 });
  }

  const formatted = `${sign}${parts.map((p) => `${p.qty} ${p.label}`).join(" + ")}`;
  return { parts, formatted };
}

/**
 * Enforces negative stock policy (`BLOCK` vs `WARN`).
 */
export function checkNegativeStockPolicy(params: {
  currentQtyBase: number;
  outgoingQtyBase: number;
  policy: "BLOCK" | "WARN";
}): { ok: true; warning?: string; resultingQtyBase: number } | { ok: false; error: string; resultingQtyBase: number } {
  const resultingQtyBase =
    Math.round((params.currentQtyBase - params.outgoingQtyBase + Number.EPSILON) * 10000) / 10000;
  if (resultingQtyBase < 0) {
    if (params.policy === "BLOCK") {
      return {
        ok: false,
        resultingQtyBase,
        error: `⛔ الرصيد المخزني غير كافٍ (المتاح: ${params.currentQtyBase}، المطلوب: ${params.outgoingQtyBase}) / Insufficient stock balance (available: ${params.currentQtyBase}, requested: ${params.outgoingQtyBase}).`,
      };
    }
    return {
      ok: true,
      resultingQtyBase,
      warning: `⚠️ تحذير: الرصيد المخزني أصبح سالباً (${resultingQtyBase}) / Warning: stock balance is now negative (${resultingQtyBase}).`,
    };
  }
  return { ok: true, resultingQtyBase };
}

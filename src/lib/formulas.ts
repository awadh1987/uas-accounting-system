/**
 * Pure accounting formulas and deterministic verification utilities grounded in UAS.xlsx.
 */

export type CurrencyCode = "YER" | "SAR" | "USD";

export const DEFAULT_EXCHANGE_RATES: Record<CurrencyCode, number> = {
  YER: 1,
  SAR: 425,
  USD: 1620,
};

/**
 * Operating expense total = quantity * unitPrice
 */
export function computeOperatingExpenseTotal(quantity: number, unitPrice: number): number {
  const q = Number(quantity) || 0;
  const p = Number(unitPrice) || 0;
  return q * p;
}

/**
 * Worker wages formulas from UAS.xlsx:
 *   totalWage (=F*G) = dailyWage * daysWorked
 *   debitBalance (=H-I) = totalWage - creditAmount
 */
export function computeWorkerWageTotals(
  dailyWage: number,
  daysWorked: number,
  creditAmount: number
): { totalWage: number; debitBalance: number } {
  const wage = Number(dailyWage) || 0;
  const days = Number(daysWorked) || 0;
  const credit = Number(creditAmount) || 0;
  const totalWage = wage * days;
  const debitBalance = totalWage - credit;
  return { totalWage, debitBalance };
}

/**
 * Customer sales formulas from UAS.xlsx:
 *   totalAmount (=P*Q) = bundlesCount * unitPrice
 *   debitReceivable (=R-S) = totalAmount - creditPaid
 */
export function computeSaleTotals(
  bundlesCount: number,
  unitPrice: number,
  creditPaid: number
): { totalAmount: number; debitReceivable: number } {
  const bundles = Number(bundlesCount) || 0;
  const price = Number(unitPrice) || 0;
  const credit = Number(creditPaid) || 0;
  const totalAmount = bundles * price;
  const debitReceivable = totalAmount - credit;
  return { totalAmount, debitReceivable };
}

/**
 * Net operating profit = totalSales - (totalOperatingExpenses + totalWorkerWages)
 */
export function computeNetOperatingProfit(
  totalSales: number,
  totalOperatingExpenses: number,
  totalWorkerWages: number
): number {
  return (Number(totalSales) || 0) - ((Number(totalOperatingExpenses) || 0) + (Number(totalWorkerWages) || 0));
}

/**
 * Remaining harvest inventory = harvestedBundles - soldBundles - shrinkageBundles
 */
export function computeRemainingStock(
  harvestedBundles: number,
  soldBundles: number,
  shrinkageBundles: number
): number {
  return (Number(harvestedBundles) || 0) - (Number(soldBundles) || 0) - (Number(shrinkageBundles) || 0);
}

export function fmtNum(n: number | string | null | undefined): string {
  const val = Number(n) || 0;
  return val.toLocaleString("en-US");
}

export function formatCurrencyVal(
  amountYER: number,
  currency: CurrencyCode = "YER",
  exchangeRates: Record<string, number> = DEFAULT_EXCHANGE_RATES
): string {
  const rate = exchangeRates[currency] || 1;
  const converted = (Number(amountYER) || 0) / rate;
  const formatted =
    currency === "YER" ? Math.round(converted).toLocaleString("en-US") : converted.toFixed(2);
  return `${formatted} ${currency}`;
}

/**
 * Deterministic verification hash & QR matrix generator matching unified_accounting_system_uas.html
 */
export function computeQrVerificationCode(payloadText: string): string {
  let hash = 2166136261;
  for (let i = 0; i < payloadText.length; i++) {
    hash ^= payloadText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "UAS-" + Math.abs(hash).toString(16).toUpperCase().slice(0, 6);
}

export function generateQrMatrix(payloadText: string, size = 11): { cells: Array<{ r: number; c: number }>; codeHash: string } {
  let hash = 2166136261;
  for (let i = 0; i < payloadText.length; i++) {
    hash ^= payloadText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const cells: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const isCorner = (r < 3 && c < 3) || (r < 3 && c >= size - 3) || (r >= size - 3 && c < 3);
      const bit = isCorner ? 1 : Math.abs(hash + r * 31 + c * 17) % 3 === 0 ? 1 : 0;
      if (bit) {
        cells.push({ r, c });
      }
    }
  }
  const codeHash = "UAS-" + Math.abs(hash).toString(16).toUpperCase().slice(0, 6);
  return { cells, codeHash };
}

export function formatAuditTimestamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}


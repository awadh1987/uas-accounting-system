import { DEFAULT_CONTROL_ACCOUNTS } from "@/lib/accountingSettings";
import { dAdd, dMul, dSub, roundDecimal } from "@/lib/decimalMath";

export interface CurrencySeedDef {
  code: string;
  nameAr: string;
  nameEn: string;
  symbol: string;
  decimalPlaces: number;
  isBaseCurrency: boolean;
  isCustom: boolean;
  defaultRateToBase: number;
}

export const DEFAULT_CURRENCIES: CurrencySeedDef[] = [
  {
    code: "YER",
    nameAr: "ريال يمني",
    nameEn: "Yemeni Rial",
    symbol: "ر.ي",
    decimalPlaces: 0,
    isBaseCurrency: true,
    isCustom: false,
    defaultRateToBase: 1,
  },
  {
    code: "SAR",
    nameAr: "ريال سعودي",
    nameEn: "Saudi Riyal",
    symbol: "ر.س",
    decimalPlaces: 2,
    isBaseCurrency: false,
    isCustom: false,
    defaultRateToBase: 425,
  },
  {
    code: "USD",
    nameAr: "دولار أمريكي",
    nameEn: "US Dollar",
    symbol: "$",
    decimalPlaces: 2,
    isBaseCurrency: false,
    isCustom: false,
    defaultRateToBase: 1620,
  },
  {
    code: "AED",
    nameAr: "درهم إماراتي",
    nameEn: "UAE Dirham",
    symbol: "د.إ",
    decimalPlaces: 2,
    isBaseCurrency: false,
    isCustom: false,
    defaultRateToBase: 441,
  },
  {
    code: "OMR",
    nameAr: "ريال عماني",
    nameEn: "Omani Rial",
    symbol: "ر.ع",
    decimalPlaces: 3,
    isBaseCurrency: false,
    isCustom: false,
    defaultRateToBase: 4208,
  },
];

export interface DualCurrencyLineInput {
  accountId?: string;
  accountCode?: string;
  currencyCode?: string;
  exchangeRate?: number;
  foreignDebit?: number;
  foreignCredit?: number;
  baseDebit?: number;
  baseCredit?: number;
  memo?: string;
}

export interface BalancedDualCurrencyLine {
  accountId?: string;
  accountCode?: string;
  currencyCode: string;
  exchangeRate: number;
  foreignDebit: number;
  foreignCredit: number;
  baseDebit: number;
  baseCredit: number;
  memo?: string;
  isFxRoundingLine?: boolean;
}

function roundMoney(n: number, decimals = 2): number {
  return roundDecimal(n, decimals);
}

/**
 * Normalizes and validates dual-currency journal lines so `SUM(baseDebit) === SUM(baseCredit)`.
 * Sub-unit FX conversion rounding differences (<= 1.0 base unit) are routed automatically
 * to the configured FX Rounding Account. Differences > 1.0 reject as unbalanced.
 */
export function balanceDualCurrencyLines(
  lines: DualCurrencyLineInput[],
  fxRoundingAccountCode: string = DEFAULT_CONTROL_ACCOUNTS.fxRoundingAccount
): {
  ok: true;
  lines: BalancedDualCurrencyLine[];
  totalBaseDebit: number;
  totalBaseCredit: number;
  roundingAdjustment: number;
} | {
  ok: false;
  error: string;
  totalBaseDebit: number;
  totalBaseCredit: number;
} {
  if (!Array.isArray(lines) || lines.length < 2) {
    return {
      ok: false,
      error: "يجب أن يحتوي القيد على سطرين محاسبيين على الأقل / Journal entry requires at least 2 lines.",
      totalBaseDebit: 0,
      totalBaseCredit: 0,
    };
  }

  const normalized: BalancedDualCurrencyLine[] = lines.map((l) => {
    const currencyCode = (l.currencyCode || "YER").trim().toUpperCase();
    const rate = currencyCode === "YER" ? 1 : Number(l.exchangeRate || 1);
    const foreignDebit = roundMoney(Number(l.foreignDebit || 0), 4);
    const foreignCredit = roundMoney(Number(l.foreignCredit || 0), 4);
    const baseDebit =
      l.baseDebit !== undefined && l.baseDebit > 0
        ? roundMoney(Number(l.baseDebit), 2)
        : roundMoney(foreignDebit * rate, 2);
    const baseCredit =
      l.baseCredit !== undefined && l.baseCredit > 0
        ? roundMoney(Number(l.baseCredit), 2)
        : roundMoney(foreignCredit * rate, 2);

    return {
      accountId: l.accountId,
      accountCode: l.accountCode,
      currencyCode,
      exchangeRate: rate,
      foreignDebit,
      foreignCredit,
      baseDebit,
      baseCredit,
      memo: l.memo,
    };
  });

  let sumBaseDebit = roundMoney(normalized.reduce((acc, l) => acc + l.baseDebit, 0), 2);
  let sumBaseCredit = roundMoney(normalized.reduce((acc, l) => acc + l.baseCredit, 0), 2);
  const diff = roundMoney(sumBaseDebit - sumBaseCredit, 2);

  if (Math.abs(diff) > 1.0) {
    return {
      ok: false,
      error: `القيد غير متوازن بعملة الأساس (المدين: ${sumBaseDebit} ≠ الدائن: ${sumBaseCredit}) / Unbalanced journal in base currency (Debit ${sumBaseDebit} != Credit ${sumBaseCredit}).`,
      totalBaseDebit: sumBaseDebit,
      totalBaseCredit: sumBaseCredit,
    };
  }

  let roundingAdjustment = 0;
  if (Math.abs(diff) > 0) {
    roundingAdjustment = diff;
    if (diff > 0) {
      // Debit > Credit -> add Credit rounding line
      normalized.push({
        accountCode: fxRoundingAccountCode,
        currencyCode: "YER",
        exchangeRate: 1,
        foreignDebit: 0,
        foreignCredit: diff,
        baseDebit: 0,
        baseCredit: diff,
        memo: "فروق تقريب عملات أجنبية / FX rounding adjustment",
        isFxRoundingLine: true,
      });
      sumBaseCredit = roundMoney(sumBaseCredit + diff, 2);
    } else {
      const absDiff = Math.abs(diff);
      normalized.push({
        accountCode: fxRoundingAccountCode,
        currencyCode: "YER",
        exchangeRate: 1,
        foreignDebit: absDiff,
        foreignCredit: 0,
        baseDebit: absDiff,
        baseCredit: 0,
        memo: "فروق تقريب عملات أجنبية / FX rounding adjustment",
        isFxRoundingLine: true,
      });
      sumBaseDebit = roundMoney(sumBaseDebit + absDiff, 2);
    }
  }

  return {
    ok: true,
    lines: normalized,
    totalBaseDebit: sumBaseDebit,
    totalBaseCredit: sumBaseCredit,
    roundingAdjustment,
  };
}

/**
 * Computes Realized FX Gain/Loss when settling a foreign-currency Receivable (AR) or Payable (AP).
 *
 * - For RECEIVABLE (Customer Receipt): if settlementRate > bookedRate -> GAIN (we collect more base currency).
 * - For PAYABLE (Vendor Payment): if settlementRate < bookedRate -> GAIN (we pay less base currency).
 */
export function computeRealizedFxGainLoss(params: {
  foreignAmount: number;
  bookedRate: number;
  settlementRate: number;
  side: "RECEIVABLE" | "PAYABLE";
}): {
  bookedBase: number;
  settledBase: number;
  gainAmount: number;
  lossAmount: number;
  netFxDiff: number;
} {
  const bookedBase = dMul(params.foreignAmount, params.bookedRate, 2);
  const settledBase = dMul(params.foreignAmount, params.settlementRate, 2);
  const signedImpact =
    params.side === "RECEIVABLE"
      ? dSub(settledBase, bookedBase, 2)
      : dSub(bookedBase, settledBase, 2);

  return {
    bookedBase,
    settledBase,
    gainAmount: signedImpact > 0 ? signedImpact : 0,
    lossAmount: signedImpact < 0 ? Math.abs(signedImpact) : 0,
    netFxDiff: signedImpact,
  };
}

export interface FxOpenPosition {
  accountId: string;
  accountCode: string;
  accountNameAr: string;
  accountType: "ASSET" | "LIABILITY" | string;
  currencyCode: string;
  foreignBalance: number; // Positive for debit balance (assets), positive for credit balance (liabilities)
  bookedBaseBalance: number;
  spotRate: number;
}

export interface FxRevaluationRow extends FxOpenPosition {
  revaluedBaseBalance: number;
  unrealizedGain: number;
  unrealizedLoss: number;
  netDiff: number;
}

/**
 * Period-end Unrealized FX Revaluation calculator.
 * Evaluates open foreign-currency monetary balances against period-end spot rates and builds
 * balanced revaluation journal lines.
 */
export function computeUnrealizedFxRevaluation(
  positions: FxOpenPosition[],
  accounts: {
    unrealizedFxGainAccount?: string;
    unrealizedFxLossAccount?: string;
  } = {}
): {
  rows: FxRevaluationRow[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netImpact: number;
  journalLines: BalancedDualCurrencyLine[];
} {
  const gainAcc = accounts.unrealizedFxGainAccount || DEFAULT_CONTROL_ACCOUNTS.unrealizedFxGainAccount;
  const lossAcc = accounts.unrealizedFxLossAccount || DEFAULT_CONTROL_ACCOUNTS.unrealizedFxLossAccount;

  const rows: FxRevaluationRow[] = [];
  const journalLines: BalancedDualCurrencyLine[] = [];
  let totalUnrealizedGain = 0;
  let totalUnrealizedLoss = 0;

  for (const pos of positions) {
    if (pos.currencyCode.toUpperCase() === "YER" || pos.foreignBalance === 0) continue;
    const revaluedBaseBalance = dMul(pos.foreignBalance, pos.spotRate, 2);
    const rawDiff = dSub(revaluedBaseBalance, pos.bookedBaseBalance, 2);
    if (rawDiff === 0) continue;

    const isLiability = pos.accountType.toUpperCase() === "LIABILITY";
    // For ASSET: increase in base value = GAIN (Debit Asset, Credit Unrealized FX Gain)
    // For LIABILITY: increase in base value = LOSS (Debit Unrealized FX Loss, Credit Liability)
    const netDiff = isLiability ? -rawDiff : rawDiff;
    const unrealizedGain = netDiff > 0 ? netDiff : 0;
    const unrealizedLoss = netDiff < 0 ? Math.abs(netDiff) : 0;

    totalUnrealizedGain = dAdd(totalUnrealizedGain, unrealizedGain, 2);
    totalUnrealizedLoss = dAdd(totalUnrealizedLoss, unrealizedLoss, 2);

    rows.push({
      ...pos,
      revaluedBaseBalance,
      unrealizedGain,
      unrealizedLoss,
      netDiff,
    });

    if (unrealizedGain > 0) {
      if (!isLiability) {
        journalLines.push({
          accountId: pos.accountId,
          accountCode: pos.accountCode,
          currencyCode: "YER",
          exchangeRate: 1,
          foreignDebit: unrealizedGain,
          foreignCredit: 0,
          baseDebit: unrealizedGain,
          baseCredit: 0,
          memo: `إعادة تقييم عملة ${pos.currencyCode} بسعر ${pos.spotRate}`,
        });
      } else {
        journalLines.push({
          accountId: pos.accountId,
          accountCode: pos.accountCode,
          currencyCode: "YER",
          exchangeRate: 1,
          foreignDebit: unrealizedGain,
          foreignCredit: 0,
          baseDebit: unrealizedGain,
          baseCredit: 0,
          memo: `إعادة تقييم التزام بعملة ${pos.currencyCode} بسعر ${pos.spotRate}`,
        });
      }
      journalLines.push({
        accountCode: gainAcc,
        currencyCode: "YER",
        exchangeRate: 1,
        foreignDebit: 0,
        foreignCredit: unrealizedGain,
        baseDebit: 0,
        baseCredit: unrealizedGain,
        memo: `أرباح فروق عملة غير محققة (${pos.currencyCode})`,
      });
    } else if (unrealizedLoss > 0) {
      journalLines.push({
        accountCode: lossAcc,
        currencyCode: "YER",
        exchangeRate: 1,
        foreignDebit: unrealizedLoss,
        foreignCredit: 0,
        baseDebit: unrealizedLoss,
        baseCredit: 0,
        memo: `خسائر فروق عملة غير محققة (${pos.currencyCode})`,
      });
      journalLines.push({
        accountId: pos.accountId,
        accountCode: pos.accountCode,
        currencyCode: "YER",
        exchangeRate: 1,
        foreignDebit: 0,
        foreignCredit: unrealizedLoss,
        baseDebit: 0,
        baseCredit: unrealizedLoss,
        memo: `إعادة تقييم عملة ${pos.currencyCode} بسعر ${pos.spotRate}`,
      });
    }
  }

  return {
    rows,
    totalUnrealizedGain,
    totalUnrealizedLoss,
    netImpact: roundMoney(totalUnrealizedGain - totalUnrealizedLoss, 2),
    journalLines,
  };
}

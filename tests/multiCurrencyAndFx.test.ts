import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  balanceDualCurrencyLines,
  computeRealizedFxGainLoss,
  computeUnrealizedFxRevaluation,
} from "../src/lib/multiCurrencyEngine";
import {
  assertNotInLockedPeriod,
  DEFAULT_DOCUMENT_SEQUENCES,
  generateNextDocumentNumber,
} from "../src/lib/accountingSettings";

const TEST_CUR_CODE = `X${Date.now().toString().slice(-4)}`;

describe("Phase 2 — Multi-Currency, FX Revaluation, Period Lock & Sequences", () => {
  after(async () => {
    await prisma.exchangeRate.deleteMany({ where: { currencyCode: TEST_CUR_CODE } }).catch(() => {});
    await prisma.currency.deleteMany({ where: { code: TEST_CUR_CODE } }).catch(() => {});
  });

  it("balances dual-currency journal lines and routes sub-unit rounding diffs to FX Rounding Account", () => {
    // Exact balance in USD @ 1620 YER
    const exact = balanceDualCurrencyLines([
      { accountCode: "111101", currencyCode: "USD", exchangeRate: 1620, foreignDebit: 100 },
      { accountCode: "411101", currencyCode: "USD", exchangeRate: 1620, foreignCredit: 100 },
    ]);
    assert.equal(exact.ok, true);
    if (exact.ok) {
      assert.equal(exact.totalBaseDebit, 162000);
      assert.equal(exact.totalBaseCredit, 162000);
      assert.equal(exact.roundingAdjustment, 0);
      assert.equal(exact.lines.length, 2);
    }

    // Sub-unit rounding diff (0.40 YER) automatically balanced via FX Rounding Account
    const rounded = balanceDualCurrencyLines([
      { accountCode: "111101", currencyCode: "USD", exchangeRate: 1620, foreignDebit: 10, baseDebit: 16200.4 },
      { accountCode: "411101", currencyCode: "USD", exchangeRate: 1620, foreignCredit: 10, baseCredit: 16200 },
    ]);
    assert.equal(rounded.ok, true);
    if (rounded.ok) {
      assert.equal(rounded.totalBaseDebit, rounded.totalBaseCredit);
      assert.equal(rounded.roundingAdjustment, 0.4);
      assert.equal(rounded.lines.length, 3);
      assert.equal(rounded.lines[2].isFxRoundingLine, true);
    }

    // Unbalanced diff > 1.0 YER rejected
    const unbalanced = balanceDualCurrencyLines([
      { accountCode: "111101", currencyCode: "USD", exchangeRate: 1620, foreignDebit: 100 },
      { accountCode: "411101", currencyCode: "USD", exchangeRate: 1620, foreignCredit: 90 },
    ]);
    assert.equal(unbalanced.ok, false);
  });

  it("computes Realized FX Gain/Loss accurately for both Receivables and Payables", () => {
    // AR: Invoice 1000 USD booked at 1600, collected at 1650 -> +50,000 YER Gain
    const arGain = computeRealizedFxGainLoss({
      foreignAmount: 1000,
      bookedRate: 1600,
      settlementRate: 1650,
      side: "RECEIVABLE",
    });
    assert.equal(arGain.gainAmount, 50000);
    assert.equal(arGain.lossAmount, 0);

    // AP: Vendor bill 1000 USD booked at 1600, paid at 1650 -> 50,000 YER Loss
    const apLoss = computeRealizedFxGainLoss({
      foreignAmount: 1000,
      bookedRate: 1600,
      settlementRate: 1650,
      side: "PAYABLE",
    });
    assert.equal(apLoss.gainAmount, 0);
    assert.equal(apLoss.lossAmount, 50000);
  });

  it("computes period-end Unrealized FX Revaluation with balanced Debit === Credit journal lines", () => {
    const reval = computeUnrealizedFxRevaluation([
      {
        accountId: "acc-usd-cash",
        accountCode: "111102",
        accountNameAr: "صندوق الدولار",
        accountType: "ASSET",
        currencyCode: "USD",
        foreignBalance: 1000,
        bookedBaseBalance: 1600000,
        spotRate: 1630, // +30,000 YER unrealized gain
      },
      {
        accountId: "acc-sar-ap",
        accountCode: "211102",
        accountNameAr: "موردون بالريال السعودي",
        accountType: "LIABILITY",
        currencyCode: "SAR",
        foreignBalance: 2000,
        bookedBaseBalance: 840000,
        spotRate: 430, // liability increased by 20,000 YER -> 20,000 YER unrealized loss
      },
    ]);

    assert.equal(reval.rows.length, 2);
    assert.equal(reval.totalUnrealizedGain, 30000);
    assert.equal(reval.totalUnrealizedLoss, 20000);
    assert.equal(reval.netImpact, 10000);

    const sumDebit = reval.journalLines.reduce((s, l) => s + l.baseDebit, 0);
    const sumCredit = reval.journalLines.reduce((s, l) => s + l.baseCredit, 0);
    assert.equal(sumDebit, sumCredit);
    assert.equal(sumDebit, 50000);
  });

  it("enforces periodLockDate and generates sequential document numbers", () => {
    const locked = assertNotInLockedPeriod("2026-03-15", "2026-03-31");
    assert.equal(locked.ok, false);

    const open = assertNotInLockedPeriod("2026-04-01", "2026-03-31");
    assert.equal(open.ok, true);

    const seq1 = generateNextDocumentNumber("JV", DEFAULT_DOCUMENT_SEQUENCES, 2026);
    assert.equal(seq1.documentNumber, "JV-2026-00001");
    const seq2 = generateNextDocumentNumber("JV", seq1.nextSequences, 2026);
    assert.equal(seq2.documentNumber, "JV-2026-00002");
  });

  it("persists custom currency & exchange rate in SQLite Prisma tables", async () => {
    const cur = await prisma.currency.create({
      data: {
        code: TEST_CUR_CODE,
        nameAr: "عملة مخصصة اختبارية",
        nameEn: "Custom Test Currency",
        symbol: "XT",
        decimalPlaces: 2,
        isBaseCurrency: false,
        isCustom: true,
        isActive: true,
      },
    });
    assert.equal(cur.code, TEST_CUR_CODE);
    assert.equal(cur.isCustom, true);

    const rate = await prisma.exchangeRate.create({
      data: {
        currencyCode: TEST_CUR_CODE,
        buyRate: 500,
        sellRate: 510,
        midRate: 505,
        source: "TEST",
      },
    });
    assert.equal(rate.midRate, 505);
  });
});

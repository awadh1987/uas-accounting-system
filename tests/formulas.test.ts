import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNetOperatingProfit,
  computeOperatingExpenseTotal,
  computeQrVerificationCode,
  computeRemainingStock,
  computeSaleTotals,
  computeWorkerWageTotals,
  DEFAULT_EXCHANGE_RATES,
  formatCurrencyVal,
  generateQrMatrix,
} from "../src/lib/formulas";

describe("UAS.xlsx accounting formulas", () => {
  it("computes operating expense totals (quantity * unitPrice)", () => {
    assert.equal(computeOperatingExpenseTotal(40, 1000), 40000);
    assert.equal(computeOperatingExpenseTotal(1, 18000), 18000);
  });

  it("computes worker wages (=F*G) and debit balance (=H-I) matching seed workers", () => {
    assert.deepEqual(computeWorkerWageTotals(5000, 10, 10000), {
      totalWage: 50000,
      debitBalance: 40000,
    });
    assert.deepEqual(computeWorkerWageTotals(4000, 5, 10000), {
      totalWage: 20000,
      debitBalance: 10000,
    });
    assert.deepEqual(computeWorkerWageTotals(3000, 20, 10000), {
      totalWage: 60000,
      debitBalance: 50000,
    });
  });

  it("computes sale totals (=P*Q) and customer receivable (=R-S) matching seed sales", () => {
    assert.deepEqual(computeSaleTotals(100, 2000, 50000), {
      totalAmount: 200000,
      debitReceivable: 150000,
    });
    assert.deepEqual(computeSaleTotals(100, 150, 10000), {
      totalAmount: 15000,
      debitReceivable: 5000,
    });
  });

  it("computes net operating profit for grounded seed totals", () => {
    // Seed totals: Sales 430,000; Expenses 85,000; Worker Wages 130,000 => Profit 215,000
    assert.equal(computeNetOperatingProfit(430000, 85000, 130000), 215000);
  });

  it("computes remaining harvest inventory stock", () => {
    // Seed batch inv1: 420 harvested, 400 sold across s1..s4, 5 shrinkage => 15 remaining
    assert.equal(computeRemainingStock(420, 400, 5), 15);
  });

  it("formats multi-currency values using exchange rates", () => {
    assert.equal(formatCurrencyVal(42500, "SAR", DEFAULT_EXCHANGE_RATES), "100.00 SAR");
    assert.equal(formatCurrencyVal(162000, "USD", DEFAULT_EXCHANGE_RATES), "100.00 USD");
    assert.equal(formatCurrencyVal(50000, "YER", DEFAULT_EXCHANGE_RATES), "50,000 YER");
  });

  it("produces deterministic QR verification codes and matrices", () => {
    const payload = "VOUCHER:RV-001|CUST:فواز الجابري|TOTAL:200000|CREDIT:50000|DEBIT:150000";
    const code1 = computeQrVerificationCode(payload);
    const code2 = computeQrVerificationCode(payload);
    assert.equal(code1, code2);
    assert.match(code1, /^UAS-[0-9A-F]+$/);

    const matrix = generateQrMatrix(payload, 11);
    assert.equal(matrix.codeHash, code1);
    assert.ok(matrix.cells.length > 0);
  });
});


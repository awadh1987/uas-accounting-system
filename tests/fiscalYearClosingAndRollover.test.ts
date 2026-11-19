import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  createFiscalYear,
  executeFiscalYearCloseAndRollover,
  runFiscalYearPrecheck,
} from "../src/lib/fiscalYearClosingEngine";
import {
  ensureCustomerWithAccountTx,
  postJournalEntry,
} from "../src/lib/accounting/ledgerService";
import { createCostCenter } from "../src/lib/accountingCoreEngine";
import {
  handleOfflineAndroidApiRequest,
  type OfflineStorageLike,
} from "../src/lib/offlineAndroidStore";

const TAG = `FY${Date.now().toString().slice(-5)}`;
// Use an isolated historical year (2019 -> 2020) so concurrent 2026 tests are never affected
const TEST_YEAR = 2019;
const NEXT_YEAR = 2020;

const createdJournalIds: string[] = [];
const createdFiscalYearIds: string[] = [];
let priorSettingsSnapshot: {
  periodLockDate: string | null;
  fiscalYearStart: string | null;
  fiscalYearEnd: string | null;
} | null = null;

function memoryStorage(): OfflineStorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("Phase 2 — Fiscal Year-End Closing & Opening Balance Migration", () => {
  after(async () => {
    // Clean up test journals and fiscal years, and restore SystemSettings periodLockDate
    for (const jid of createdJournalIds) {
      await prisma.journalEntry.deleteMany({ where: { id: jid } }).catch(() => {});
    }
    for (const fyId of createdFiscalYearIds) {
      await prisma.fiscalYear.deleteMany({ where: { id: fyId } }).catch(() => {});
    }
    await prisma.fiscalYear.deleteMany({ where: { code: `FY-${NEXT_YEAR}` } }).catch(() => {});
    await prisma.fiscalYear.deleteMany({ where: { code: `FY-${TEST_YEAR}-${TAG}` } }).catch(() => {});
    if (priorSettingsSnapshot) {
      await prisma.systemSettings
        .update({
          where: { id: "default" },
          data: {
            periodLockDate: priorSettingsSnapshot.periodLockDate,
            fiscalYearStart: priorSettingsSnapshot.fiscalYearStart,
            fiscalYearEnd: priorSettingsSnapshot.fiscalYearEnd,
          },
        })
        .catch(() => {});
    }
    await prisma.$disconnect();
  });

  it("(a) blocks close when pending-approval/draft documents exist, then passes once resolved", async () => {
    const existingSettings = await prisma.systemSettings.findUnique({ where: { id: "default" } });
    if (existingSettings) {
      priorSettingsSnapshot = {
        periodLockDate: existingSettings.periodLockDate,
        fiscalYearStart: existingSettings.fiscalYearStart,
        fiscalYearEnd: existingSettings.fiscalYearEnd,
      };
      // Temporarily clear periodLockDate if it would block 2019 test setup
      await prisma.systemSettings.update({
        where: { id: "default" },
        data: { periodLockDate: null },
      });
    }

    // Ensure clean 2019/2020 slate
    await prisma.fiscalYear.deleteMany({ where: { code: { in: [`FY-${TEST_YEAR}-${TAG}`, `FY-${NEXT_YEAR}`] } } });

    const fy = await createFiscalYear({
      code: `FY-${TEST_YEAR}-${TAG}`,
      nameAr: `السنة المالية ${TEST_YEAR}`,
      nameEn: `Fiscal Year ${TEST_YEAR}`,
      startDate: `${TEST_YEAR}-01-01`,
      endDate: `${TEST_YEAR}-12-31`,
    });
    createdFiscalYearIds.push(fy.id);

    // Create a PENDING_APPROVAL journal entry inside 2019
    const pendingJe = await postJournalEntry({
      date: `${TEST_YEAR}-06-15T10:00:00Z`,
      narrationAr: `قيد معلق للاختبار ${TAG}`,
      status: "PENDING_APPROVAL",
      lines: [
        { accountCode: "111101", debit: 1000 },
        { accountCode: "411101", credit: 1000 },
      ],
    });
    createdJournalIds.push(pendingJe.id);

    const checkBlocked = await runFiscalYearPrecheck(fy.id);
    assert.equal(checkBlocked.canClose, false, "Precheck must block when pending documents exist");
    const pendingItem = checkBlocked.checks.find((c) => c.key === "pendingDocuments")!;
    assert.equal(pendingItem.passed, false);
    assert.ok((pendingItem.count ?? 0) >= 1);

    await assert.rejects(
      () => executeFiscalYearCloseAndRollover(fy.id, { userName: "Auditor" }),
      /FISCAL_YEAR_PRECHECK_FAILED/
    );

    // Post the pending entry -> precheck now passes
    await prisma.journalEntry.update({ where: { id: pendingJe.id }, data: { status: "POSTED" } });
    const checkPassed = await runFiscalYearPrecheck(fy.id);
    assert.equal(checkPassed.canClose, true, "Precheck passes once pending documents are resolved");
  });

  it("(b, c, d) executes atomic P&L closing into Retained Earnings, locks closed year, and migrates Gen-6 + multi-currency opening balances", async () => {
    const fy = await prisma.fiscalYear.findUniqueOrThrow({ where: { code: `FY-${TEST_YEAR}-${TAG}` } });

    // Create a Cost Center + Gen-6 Customer + USD exchange rate for 2019
    const cc = await createCostCenter({ nameAr: `مركز إقفال ${TAG}`, centerType: "FARM" });
    const customer = await prisma.$transaction((tx) =>
      ensureCustomerWithAccountTx(tx, { name: `عميل إقفال ${TAG}`, nameEn: `CloseCust ${TAG}`, costCenterId: cc.id })
    );

    // 1. Revenue in YER on Gen-6 Customer (DR Customer 50,000, CR Revenue 50,000) with Cost Center
    const jeRev = await postJournalEntry({
      date: `${TEST_YEAR}-07-01T10:00:00Z`,
      narrationAr: `مبيعات إقفال ${TAG}`,
      costCenterId: cc.id,
      lines: [
        { accountId: customer.accountId, debit: 50000, costCenterId: cc.id },
        { accountCode: "411101", credit: 50000, costCenterId: cc.id },
      ],
    });
    createdJournalIds.push(jeRev.id);

    // 2. Expense in YER (DR Expense 20,000, CR Cash 20,000) with Cost Center
    const jeExp = await postJournalEntry({
      date: `${TEST_YEAR}-08-01T10:00:00Z`,
      narrationAr: `مصروف إقفال ${TAG}`,
      costCenterId: cc.id,
      lines: [
        { accountCode: "521101", debit: 20000, costCenterId: cc.id },
        { accountCode: "111101", credit: 20000, costCenterId: cc.id },
      ],
    });
    createdJournalIds.push(jeExp.id);

    // 3. Multi-currency (USD @ 1620 YER) Cash balance: DR USD Safe 100 USD (162,000 YER), CR Capital 100 USD (162,000 YER)
    const jeFx = await postJournalEntry({
      date: `${TEST_YEAR}-09-01T10:00:00Z`,
      narrationAr: `إيداع رأس مال بالدولار ${TAG}`,
      lines: [
        { accountCode: "111103", debit: 100, currency: "USD", exchangeRate: 1620 },
        { accountCode: "311101", credit: 100, currency: "USD", exchangeRate: 1620 },
      ],
    });
    createdJournalIds.push(jeFx.id);

    // Execute atomic Year-End Close & Rollover!
    const result = await executeFiscalYearCloseAndRollover(fy.id, { userName: "Chief Accountant" });
    if (result.closingJournalEntryId) createdJournalIds.push(result.closingJournalEntryId);
    if (result.openingJournalEntryId) createdJournalIds.push(result.openingJournalEntryId);
    createdFiscalYearIds.push(result.nextFiscalYear.id);

    // Verify Step A: P&L Closing Entry (Revenue = 1000 + 50000 = 51000, Expense = 20000 -> Net Profit = 31000)
    assert.equal(result.closedFiscalYear.status, "CLOSED");
    assert.equal(result.netProfitLossBase, 31000);
    assert.ok(result.closingJournalEntryId, "YEAR_END_CLOSING entry created");

    const closingJe = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: result.closingJournalEntryId! },
      include: { lines: { include: { account: true } } },
    });
    assert.equal(closingJe.entryType, "YEAR_END_CLOSING");
    const reLine = closingJe.lines.find((l) => l.account.code === "312101");
    assert.ok(reLine, "Retained Earnings line exists in closing entry");
    assert.equal(Number(reLine!.creditBase), 31000);

    // Cost Center preserved on P&L closing lines
    const ccExpLine = closingJe.lines.find((l) => l.account.code === "521101" && l.costCenterId === cc.id);
    assert.ok(ccExpLine, "Cost center breakdown preserved on closing entry");
    assert.equal(Number(ccExpLine!.creditBase), 20000);

    // Verify Step B: Closed fiscal year strictly blocks backdated postings
    await assert.rejects(
      () =>
        postJournalEntry({
          date: `${TEST_YEAR}-11-15T10:00:00Z`,
          narrationAr: "محاولة قيد بتاريخ سنة مقفلة",
          lines: [
            { accountCode: "111101", debit: 500 },
            { accountCode: "411101", credit: 500 },
          ],
        }),
      /FISCAL_YEAR_CLOSED|PERIOD_LOCKED/
    );

    // Verify Step C: New Fiscal Year opened + Balanced OPENING entry with Gen-6 Customer + USD FX balances
    assert.equal(result.nextFiscalYear.code, `FY-${NEXT_YEAR}`);
    assert.equal(result.nextFiscalYear.status, "OPEN");
    assert.ok(result.openingJournalEntryId, "OPENING entry created for new fiscal year");

    const openingJe = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: result.openingJournalEntryId! },
      include: { lines: { include: { account: true } } },
    });
    assert.equal(openingJe.entryType, "OPENING");
    assert.equal(openingJe.fiscalYearId, result.nextFiscalYear.id);

    // Strict balance check on OPENING entry
    const sumDr = openingJe.lines.reduce((s, l) => s + Number(l.baseDebit), 0);
    const sumCr = openingJe.lines.reduce((s, l) => s + Number(l.baseCredit), 0);
    assert.ok(Math.abs(sumDr - sumCr) < 0.01, `Opening entry balanced: DR ${sumDr} === CR ${sumCr}`);

    // Gen-6 Customer sub-ledger balance carried forward (50,000 YER)
    const custOpen = openingJe.lines.find((l) => l.accountId === customer.accountId);
    assert.ok(custOpen, "Gen-6 Customer leaf balance migrated to new fiscal year");
    assert.equal(Number(custOpen!.baseDebit), 50000);
    assert.equal(custOpen!.costCenterId, cc.id);

    // Multi-currency USD balance carried forward (100 USD foreign + 162,000 YER base)
    const usdOpen = openingJe.lines.find((l) => l.account.code === "111103" && l.currencyCode === "USD");
    assert.ok(usdOpen, "USD Cashbox opening balance migrated with foreign + base amounts");
    assert.equal(Number(usdOpen!.foreignDebit), 100);
    assert.equal(Number(usdOpen!.baseDebit), 162000);

    // Retained Earnings carried forward with Net Profit (31,000 YER)
    const reOpen = openingJe.lines.find((l) => l.account.code === "312101");
    assert.ok(reOpen, "Retained Earnings carried forward into new year");
    assert.equal(Number(reOpen!.baseCredit), 31000);
  });

  it("mirrors /api/accounting/fiscal-years lifecycle in Android Local Mode", async () => {
    const store = memoryStorage();
    const listRes = await handleOfflineAndroidApiRequest("/api/accounting/fiscal-years", { method: "GET" }, store);
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as { fiscalYears: Array<{ id: string; code: string; status: string }> };
    assert.ok(listData.fiscalYears.length >= 1);
    const fyId = listData.fiscalYears[0].id;

    const preRes = await handleOfflineAndroidApiRequest(
      `/api/accounting/fiscal-years/${fyId}/precheck`,
      { method: "POST" },
      store
    );
    assert.equal(preRes.status, 200);
    const preData = (await preRes.json()) as { precheck: { canClose: boolean } };
    assert.equal(preData.precheck.canClose, true);

    const closeRes = await handleOfflineAndroidApiRequest(
      `/api/accounting/fiscal-years/${fyId}/close-and-rollover`,
      { method: "POST", body: JSON.stringify({}) },
      store
    );
    assert.equal(closeRes.status, 200);
    const closeData = (await closeRes.json()) as {
      closedFiscalYear: { status: string };
      nextFiscalYear: { code: string; status: string };
    };
    assert.equal(closeData.closedFiscalYear.status, "CLOSED");
    assert.equal(closeData.nextFiscalYear.status, "OPEN");
  });
});

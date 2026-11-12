import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma";
import {
  createTreasuryAccount,
  generateAcquisitionBill,
  generateFinancialReports,
  getCoaTreeWithBalances,
  postCustomerReceipt,
  postJournalEntry,
  postOwnerBatchPayment,
  postSalesInvoice,
  postVendorBill,
  postVendorPayment,
  transferBetweenTreasuries,
  updateJournalEntry,
  updateTreasuryAccount,
} from "../src/lib/accounting/ledgerService";
import {
  canEdit,
  canEditDate,
  canManageLandingCms,
  canManageTreasury,
  isReadOnly,
} from "../src/lib/permissions";

describe("Enterprise Double-Entry General Ledger & Accounting Assertions", () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it("verifies Sum(All Debits) === Sum(All Credits) across the entire posted general ledger", async () => {
    const postedLines = await prisma.journalEntryLine.findMany({
      where: { journalEntry: { status: "POSTED" } },
      include: {
        account: { select: { code: true, level: true, isPosting: true } },
        journalEntry: { select: { entryNumber: true } },
      },
    });

    assert.ok(postedLines.length > 0, "Expected seeded posted journal lines");

    let sumAllDebits = 0;
    let sumAllCredits = 0;

    for (const line of postedLines) {
      assert.equal(
        line.account.isPosting,
        true,
        `Account ${line.account.code} on ${line.journalEntry.entryNumber} must be Tier-5 posting`
      );
      assert.equal(line.account.level, 5);
      sumAllDebits += Number(line.debitBase);
      sumAllCredits += Number(line.creditBase);
    }

    assert.ok(
      Math.abs(sumAllDebits - sumAllCredits) < 0.005,
      `Ledger out of balance: DR=${sumAllDebits}, CR=${sumAllCredits}`
    );
  });

  it("verifies 5-tier COA hierarchy rollups and dynamic financial statements balance", async () => {
    const { tree } = await getCoaTreeWithBalances();
    assert.equal(tree.length, 5, "Expected 5 Tier-1 root classes (100000..500000)");

    const reports = await generateFinancialReports();
    assert.equal(reports.trialBalance.isBalanced, true);
    assert.equal(reports.balanceSheet.isBalanced, true);
    assert.ok(
      Math.abs(reports.trialBalance.totalDebits - reports.trialBalance.totalCredits) < 0.005
    );
    assert.ok(
      Math.abs(reports.balanceSheet.totalAssets - reports.balanceSheet.liabilitiesPlusEquity) < 0.005
    );

    const p1 = reports.incomeStatement.projectBreakdown.find((p) => p.projectId === "p1");
    assert.ok(p1, "Expected Upper Al-Jabri project breakdown");
    assert.equal(p1.revenue, 430000);
    assert.equal(p1.netProfit, 215000);
  });

  it("rejects unbalanced journal entries and non-Tier-5 parent accounts", async () => {
    await assert.rejects(
      () =>
        postJournalEntry({
          narrationAr: "قيد غير متوازن للاختبار",
          lines: [
            { accountCode: "111101", debit: 5000 },
            { accountCode: "411101", credit: 4000 },
          ],
        }),
      /UNBALANCED_JOURNAL_ENTRY/
    );

    await assert.rejects(
      () =>
        postJournalEntry({
          narrationAr: "محاولة الترحيل على حساب تجميعي من المستوى 4",
          lines: [
            { accountCode: "111100", debit: 5000 },
            { accountCode: "411101", credit: 5000 },
          ],
        }),
      /NON_POSTING_ACCOUNT/
    );
  });

  it("executes atomic procurement and sales postings while preserving strict ledger balance", async () => {
    const SENTINEL = "ROLLBACK_AFTER_ASSERTION";

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          const billRes = await postVendorBill({
            vendorId: "v1",
            projectId: "p1",
            subProjectId: "sp1",
            totalAmount: 25000,
            currency: "YER",
            isInventory: true,
            debitAccountCode: "113201",
            notes: "اختبار ذري لفاتورة مورد",
            tx,
          });
          assert.equal(Number(billRes.bill.balanceDue), 25000);

          const payRes = await postVendorPayment({
            vendorId: "v1",
            billId: billRes.bill.id,
            treasuryId: "t1",
            amount: 10000,
            currency: "YER",
            notes: "اختبار سداد جزئي",
            tx,
          });
          assert.equal(Number(payRes.voucher.amount), 10000);

          const invRes = await postSalesInvoice({
            customerId: "cust1",
            projectId: "p1",
            harvestCycleId: "hc_p1_1",
            amount: 80000,
            currency: "YER",
            notes: "اختبار فاتورة مبيعات",
            tx,
          });
          assert.equal(Number(invRes.invoice.balanceDue), 80000);

          const rcpRes = await postCustomerReceipt({
            customerId: "cust1",
            invoiceId: invRes.invoice.id,
            treasuryId: "t2",
            amount: 30000,
            currency: "YER",
            notes: "اختبار تحصيل دفعة عميل",
            tx,
          });
          assert.equal(Number(rcpRes.receipt.amount), 30000);

          const allPostedLines = await tx.journalEntryLine.findMany({
            where: { journalEntry: { status: "POSTED" } },
          });
          const totalDr = allPostedLines.reduce((s, l) => s + Number(l.debitBase), 0);
          const totalCr = allPostedLines.reduce((s, l) => s + Number(l.creditBase), 0);
          assert.ok(Math.abs(totalDr - totalCr) < 0.005);

          throw new Error(SENTINEL);
        }),
      new RegExp(SENTINEL)
    );
  });

  it("verifies Phase 2 treasury setup, FX transfers with fees, project acquisitions, journal edits, and RBAC guards", async () => {
    assert.equal(isReadOnly("EXTERNAL_AUDITOR"), true);
    assert.equal(canEdit("EXTERNAL_AUDITOR", "sales"), false);
    assert.equal(canEditDate("FIELD_ACCOUNTANT"), false);
    assert.equal(canEditDate("CHIEF_ACCOUNTANT"), true);
    assert.equal(canManageTreasury("CHIEF_ACCOUNTANT"), true);
    assert.equal(canManageLandingCms("CHIEF_ACCOUNTANT"), false);
    assert.equal(canManageLandingCms("SUPER_ADMIN"), true);

    const SENTINEL = "ROLLBACK_PHASE2_TEST";
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          // 1. Create a new Bank Treasury with auto Tier-5 COA & opening balance
          const newBank = await createTreasuryAccount({
            type: "BANK",
            nameAr: "بنك سبأ الإسلامي",
            nameEn: "Saba Islamic Bank",
            currency: "YER",
            openingBalance: 100000,
            transferFeePercent: 0.5,
            isDefaultReceipts: false,
            tx,
          });
          assert.ok(newBank.treasury.account.code.startsWith("1112"));
          assert.equal(newBank.treasury.balanceYER, 100000);
          assert.ok(newBank.journalEntry);

          // 2. Update treasury setup metadata
          const editedBank = await updateTreasuryAccount({
            id: newBank.treasury.id,
            branchOrAgent: "فرع التحرير",
            transferFeePercent: 0.25,
            tx,
          });
          assert.equal(editedBank.branchOrAgent, "فرع التحرير");

          // 3. Cross-currency transfer (YER -> USD Vault t6) with fee posted to 531201
          const fxTransfer = await transferBetweenTreasuries({
            fromTreasuryId: newBank.treasury.id,
            toTreasuryId: "t6",
            amount: 81000,
            feeAmount: 500,
            notes: "تحويل تجريبي بالدولار مع رسوم",
            tx,
          });
          assert.equal(fxTransfer.creditedToAmount, 50); // 81000 / 1620 = 50 USD
          assert.equal(fxTransfer.feeYER, 500);

          // 4. Project Acquisition Bill & Owner Batch Payment
          const acqBill = await generateAcquisitionBill({
            projectId: "p1",
            acquisitionCycleId: "acq_p1_1",
            amount: 200000,
            capitalizeAsset: false,
            tx,
          });
          assert.equal(Number(acqBill.bill.balanceDue), 200000);

          const ownerPay = await postOwnerBatchPayment({
            projectId: "p1",
            acquisitionCycleId: "acq_p1_1",
            billId: acqBill.bill.id,
            treasuryId: newBank.treasury.id,
            amount: 50000,
            transferFee: 250,
            tx,
          });
          assert.equal(Number(ownerPay.voucher.amount), 50000);
          assert.equal(Number(ownerPay.voucher.transferFee), 250);

          // 5. Journal Entry edit preserves strict balance & updates date/narration
          const editedJe = await updateJournalEntry({
            id: acqBill.journalEntry.id,
            date: "2026-11-10T10:00:00Z",
            narrationAr: "قيد استحواذ معدل",
            tx,
          });
          assert.equal(editedJe.narrationAr, "قيد استحواذ معدل");

          // Verify global double-entry equilibrium across ALL posted lines
          const allPostedLines = await tx.journalEntryLine.findMany({
            where: { journalEntry: { status: "POSTED" } },
          });
          const totalDr = allPostedLines.reduce((s, l) => s + Number(l.debitBase), 0);
          const totalCr = allPostedLines.reduce((s, l) => s + Number(l.creditBase), 0);
          assert.ok(Math.abs(totalDr - totalCr) < 0.005);

          throw new Error(SENTINEL);
        }),
      new RegExp(SENTINEL)
    );
  });
});


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  ensureTenantRegistered,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
} from "../src/lib/tenant";
import { issueSessionToken, SESSION_COOKIE_NAME } from "../src/lib/authSession";
import { loadInstalledLicense } from "../src/lib/licensing/verifier";
import { hashPassword } from "../src/lib/serverBootstrap";
import {
  createTreasuryAccount,
  createVendorWithAccountTx,
  ensureCustomerWithAccountTx,
  generateFinancialReports,
  postCustomerReceipt,
  postJournalEntry,
  postSalesInvoice,
  postVendorBill,
  postVendorPayment,
  reverseJournalEntry,
  transferBetweenTreasuries,
} from "../src/lib/accounting/ledgerService";
import {
  costCenterProfitAndLoss,
  ensure6GenerationCoaHierarchy,
} from "../src/lib/accountingCoreEngine";
import {
  createFiscalYear,
  executeFiscalYearCloseAndRollover,
} from "../src/lib/fiscalYearClosingEngine";
import {
  DEFAULT_CONTROL_ACCOUNTS,
  parseAccountingSettings,
} from "../src/lib/accountingSettings";
import { dAdd, dMul, dSub, round4Decimal } from "../src/lib/decimalMath";
import {
  executeBankOrWalletPayout,
  processInboundCollectionWebhook,
} from "../src/lib/treasury/bankWalletGateway";
import {
  executeScopedReset,
  precheckScopedReset,
} from "../src/lib/scopedResetEngine";
import { POST as fxRevalPOST } from "../src/app/api/accounting/fx-revaluation/route";
import { POST as adjustmentsPOST } from "../src/app/api/audit/adjustments/route";
import { POST as expensesPOST } from "../src/app/api/expenses/route";
import { DELETE as expensesDELETE } from "../src/app/api/expenses/[id]/route";
import { POST as workersPOST } from "../src/app/api/workers/route";
import { DELETE as workersDELETE } from "../src/app/api/workers/[id]/route";

const TEST_TAG = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const TEST_TENANT = `phase1_core_${TEST_TAG}`;

function makeAuthedReq(
  urlPath: string,
  method: string,
  token: string,
  body?: unknown
): NextRequest {
  const headers: Record<string, string> = {
    "x-uas-tenant-id": TEST_TENANT,
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
  };
  let bodyText: string | undefined;
  if (body !== undefined) {
    bodyText = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  return new NextRequest(`http://localhost${urlPath}`, {
    method,
    headers,
    body: bodyText,
  });
}

async function resetTenantLedgerData() {
  await prisma.auditLog.deleteMany({});
  await prisma.approvalRequest.deleteMany({});
  await prisma.bankPaymentDispatch.deleteMany({});
  await prisma.workspaceDraft.deleteMany({});
  await prisma.installmentVoucher.deleteMany({});
  await prisma.saleTransaction.deleteMany({});
  await prisma.workerWageEntry.deleteMany({});
  await prisma.operatingExpense.deleteMany({});
  await prisma.adjustmentEntry.deleteMany({});
  await prisma.treasuryTransaction.deleteMany({});
  await prisma.receiptVoucher.deleteMany({});
  await prisma.salesInvoice.deleteMany({});
  await prisma.paymentVoucher.deleteMany({});
  await prisma.vendorBill.deleteMany({});
  await prisma.journalEntryLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.fiscalYear.deleteMany({});
  await prisma.treasuryAccount.deleteMany({});
  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {
      periodLockDate: null,
      controlAccountsJson: "{}",
      documentSequencesJson: "{}",
    },
  });
}

describe("Phase 1 — Core Accounting Integrity, Financial Reports, Treasury Sync, FX & Resets", () => {
  let adminUserId = "";
  let adminToken = "";
  let cashAccountId = "";
  let revenueAccountId = "";
  let expenseAccountId = "";
  let equityAccountId = "";

  before(async () => {
    const licensedCompanyName =
      loadInstalledLicense().license?.company_name || "وكالة الجابري لتجارة القات";
    ensureTenantRegistered(TEST_TENANT, licensedCompanyName, {
      nameAr: licensedCompanyName,
      nameEn: "Phase 1 Core Accounting Test Tenant",
    });

    await runWithTenant(TEST_TENANT, async () => {
      await prisma.enterpriseProfile.findFirst();
      await prisma.enterpriseProfile.updateMany({
        data: { legalNameAr: licensedCompanyName, isConfigured: true },
      });
      await ensure6GenerationCoaHierarchy();

      const admin = await prisma.user.create({
        data: {
          username: `p1_admin_${TEST_TAG}`,
          name: "مدير اختبار المرحلة الأولى",
          fullName: "Phase 1 Admin",
          email: `p1_admin_${TEST_TAG}@test.local`,
          passwordHash: hashPassword("Phase1Admin@2026"),
          role: "SUPER_ADMIN",
          department: "الإدارة",
          active: true,
          isActive: true,
        },
      });
      adminUserId = admin.id;
      adminToken = issueSessionToken({
        userId: admin.id,
        userRole: "SUPER_ADMIN",
        tenantId: TEST_TENANT,
        userDisplay: admin.fullName,
      });

      const resolveOrCreateTestLeaf = async (
        parentCode: string,
        suffix: string,
        nameAr: string,
        nameEn: string,
        type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"
      ) => {
        const parent = await prisma.account.findUniqueOrThrow({ where: { code: parentCode } });
        if (parent.isPosting && parent.isPostable) return parent.id;
        const existingChild = await prisma.account.findFirst({
          where: { parentId: parent.id, isPosting: true, isPostable: true },
        });
        if (existingChild) return existingChild.id;
        const leaf = await prisma.account.create({
          data: {
            code: `${parentCode}${suffix}`,
            nameAr,
            nameEn,
            type,
            level: 6,
            generation: 6,
            isPosting: true,
            isPostable: true,
            parentCode: parent.code,
            parentId: parent.id,
            parentAccountId: parent.id,
          },
        });
        return leaf.id;
      };

      cashAccountId = await resolveOrCreateTestLeaf("111101", "99", "صندوق اختبار رئيسي", "Phase 1 Test Cash Leaf", "ASSET");
      revenueAccountId = await resolveOrCreateTestLeaf("411101", "99", "إيرادات اختبار رئيسية", "Phase 1 Test Revenue Leaf", "REVENUE");
      expenseAccountId = await resolveOrCreateTestLeaf("521101", "99", "مصروفات اختبار تشغيلية", "Phase 1 Test OpEx Leaf", "EXPENSE");
      equityAccountId = await resolveOrCreateTestLeaf("311101", "99", "رأس مال اختباري", "Phase 1 Test Capital Leaf", "EQUITY");
    });
  });

  after(async () => {
    await resetTenantClientsForTests();
    const dbPath = resolveTenantDbFilePath(TEST_TENANT);
    if (dbPath && fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // ignore transient file lock
      }
    }
  });

  it("Step 1.1 — reverseJournalEntry preserves costCenterId + FX/base amounts and cancels net balance to 0.00", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantLedgerData();

      await prisma.currencyRate.upsert({
        where: { currencyCode: "SAR" },
        create: { currencyCode: "SAR", rateToYER: 425 },
        update: { rateToYER: 425 },
      });

      const cc = await prisma.costCenter.create({
        data: {
          code: `CC-P1-${TEST_TAG}`,
          nameAr: "مركز تكلفة اختبار العكس",
          nameEn: "Reversal Cost Center",
          generation: 1,
          centerType: "PROJECT",
        },
      });

      const orig = await postJournalEntry({
        date: "2026-05-10T10:00:00Z",
        narrationAr: "قيد مبيعات أجنبي لاختبار العكس",
        costCenterId: cc.id,
        createdById: adminUserId,
        lines: [
          {
            accountId: cashAccountId,
            debit: 100,
            currency: "SAR",
            exchangeRate: 425,
            costCenterId: cc.id,
            memo: "تحصيل سعودي",
          },
          {
            accountId: revenueAccountId,
            credit: 100,
            currency: "SAR",
            exchangeRate: 425,
            costCenterId: cc.id,
            memo: "إيراد مبيعات سعودي",
          },
        ],
      });

      const rev = await reverseJournalEntry({
        journalEntryId: orig.id,
        createdById: adminUserId,
        reason: "اختبار العكس المحاسبي النظيف",
      });

      const refreshedOrig = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: orig.id },
      });
      assert.equal(refreshedOrig.status, "POSTED");
      assert.equal(refreshedOrig.documentStatus, "POSTED");
      assert.equal(refreshedOrig.isReversed, true);
      assert.equal(refreshedOrig.reversedByEntryId, rev.id);

      assert.equal(rev.status, "POSTED");
      assert.equal(rev.sourceType, "REVERSAL");
      assert.equal(rev.sourceId, orig.id);

      const revLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: rev.id },
      });
      assert.equal(revLines.length, 2);
      for (const l of revLines) {
        assert.equal(l.costCenterId, cc.id);
        assert.equal(l.currencyCode, "SAR");
      }

      // Sum across all POSTED lines for this cost center must be 0.00
      const allLines = await prisma.journalEntryLine.findMany({
        where: {
          costCenterId: cc.id,
          journalEntry: { status: "POSTED", documentStatus: "POSTED" },
        },
      });
      const netCash = allLines
        .filter((l) => l.accountId === cashAccountId)
        .reduce((s, l) => dAdd(s, dSub(Number(l.baseDebit), Number(l.baseCredit))), 0);
      const netRev = allLines
        .filter((l) => l.accountId === revenueAccountId)
        .reduce((s, l) => dAdd(s, dSub(Number(l.baseCredit), Number(l.baseDebit))), 0);
      assert.equal(round4Decimal(netCash), 0);
      assert.equal(round4Decimal(netRev), 0);

      // Re-reversing an already reversed entry must fail
      await assert.rejects(
        () => reverseJournalEntry({ journalEntryId: orig.id, createdById: adminUserId }),
        /JOURNAL_ALREADY_VOIDED/
      );
    });
  });

  it("Step 1.2 — Balance Sheet ignores fromDate, excludes YEAR_END_CLOSING & avoids post-rollover double-counting; Cost Center P&L excludes YEAR_END_CLOSING", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantLedgerData();

      const cc = await prisma.costCenter.create({
        data: {
          code: `CC-FIN-${TEST_TAG}`,
          nameAr: "مركز تقارير مالية",
          nameEn: "Reports CC",
          generation: 1,
          centerType: "PROJECT",
        },
      });

      const fy2025 = await createFiscalYear({
        code: "FY2025",
        nameAr: "السنة المالية 2025",
        nameEn: "FY 2025",
        startDate: "2025-01-01T00:00:00Z",
        endDate: "2025-12-31T23:59:59Z",
      });
      await createFiscalYear({
        code: "FY2026",
        nameAr: "السنة المالية 2026",
        nameEn: "FY 2026",
        startDate: "2026-01-01T00:00:00Z",
        endDate: "2026-12-31T23:59:59Z",
      });

      // 2025 activity: 100,000 Revenue + 30,000 OpEx -> Net Cash +70,000
      await postJournalEntry({
        date: "2025-06-15T10:00:00Z",
        fiscalYearId: fy2025.id,
        narrationAr: "إيراد 2025",
        costCenterId: cc.id,
        createdById: adminUserId,
        lines: [
          { accountId: cashAccountId, debit: 100000, costCenterId: cc.id },
          { accountId: revenueAccountId, credit: 100000, costCenterId: cc.id },
        ],
      });
      await postJournalEntry({
        date: "2025-07-01T10:00:00Z",
        fiscalYearId: fy2025.id,
        narrationAr: "مصروف 2025",
        costCenterId: cc.id,
        createdById: adminUserId,
        lines: [
          { accountId: expenseAccountId, debit: 30000, costCenterId: cc.id },
          { accountId: cashAccountId, credit: 30000, costCenterId: cc.id },
        ],
      });

      // Close FY2025 -> posts YEAR_END_CLOSING at 2025-12-31 and OPENING at 2026-01-01 (70,000 Cash vs 70,000 Retained Earnings)
      await executeFiscalYearCloseAndRollover(fy2025.id, {
        userId: adminUserId,
      });

      // Verify FY2025 Income Statement excludes YEAR_END_CLOSING by default
      const fy25Report = await generateFinancialReports({
        fromDate: "2025-01-01",
        toDate: "2025-12-31",
      });
      assert.equal(fy25Report.incomeStatement.totalRevenue, 100000);
      assert.equal(fy25Report.incomeStatement.totalExpenses, 30000);
      assert.equal(fy25Report.incomeStatement.netProfit, 70000);

      // Post 2026 Q1 (Feb) and Q2 (Apr) transactions
      await postJournalEntry({
        date: "2026-02-10T10:00:00Z",
        narrationAr: "إيراد الربع الأول 2026",
        costCenterId: cc.id,
        createdById: adminUserId,
        lines: [
          { accountId: cashAccountId, debit: 40000, costCenterId: cc.id },
          { accountId: revenueAccountId, credit: 40000, costCenterId: cc.id },
        ],
      });
      await postJournalEntry({
        date: "2026-04-15T10:00:00Z",
        narrationAr: "إيراد الربع الثاني 2026",
        costCenterId: cc.id,
        createdById: adminUserId,
        lines: [
          { accountId: cashAccountId, debit: 20000, costCenterId: cc.id },
          { accountId: revenueAccountId, credit: 20000, costCenterId: cc.id },
        ],
      });
      await postJournalEntry({
        date: "2026-04-20T10:00:00Z",
        narrationAr: "مصروف الربع الثاني 2026",
        costCenterId: cc.id,
        createdById: adminUserId,
        lines: [
          { accountId: expenseAccountId, debit: 5000, costCenterId: cc.id },
          { accountId: cashAccountId, credit: 5000, costCenterId: cc.id },
        ],
      });

      // Run Q2 report (fromDate=2026-04-01, toDate=2026-04-30):
      // - P&L must strictly reflect Q2 (20,000 - 5,000 = 15,000)
      // - Balance Sheet must reflect OPENING (70,000) + Q1 (40,000) + Q2 (15,000) = 125,000
      const q2Report = await generateFinancialReports({
        fromDate: "2026-04-01",
        toDate: "2026-04-30",
      });
      assert.equal(q2Report.incomeStatement.totalRevenue, 20000);
      assert.equal(q2Report.incomeStatement.totalExpenses, 5000);
      assert.equal(q2Report.incomeStatement.netProfit, 15000);
      assert.equal(q2Report.balanceSheet.totalAssets, 125000);
      assert.equal(q2Report.balanceSheet.contributedEquity, 70000);
      assert.equal(q2Report.balanceSheet.currentYearNetProfit, 55000);
      assert.equal(q2Report.balanceSheet.totalEquity, 125000);
      assert.equal(q2Report.balanceSheet.isBalanced, true);

      // Cost Center P&L for FY2025 must exclude YEAR_END_CLOSING
      const ccPnl2025 = await costCenterProfitAndLoss({
        costCenterId: cc.id,
        fromDate: "2025-01-01",
        toDate: "2025-12-31",
      });
      assert.equal(ccPnl2025.totals.revenue, 100000);
      assert.equal(ccPnl2025.totals.expense, 30000);
      assert.equal(ccPnl2025.totals.net, 70000);
    });
  });

  it("Step 1.3 — postJournalEntry enforces periodLockDate and bankWalletGateway routes through postJournalEntry resolving real vendor account", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantLedgerData();

      await prisma.systemSettings.update({
        where: { id: "default" },
        data: { periodLockDate: "2026-03-31" },
      });

      await assert.rejects(
        () =>
          postJournalEntry({
            date: "2026-03-15T10:00:00Z",
            narrationAr: "محاولة ترحيل في فترة مقفلة",
            createdById: adminUserId,
            lines: [
              { accountId: cashAccountId, debit: 1000 },
              { accountId: equityAccountId, credit: 1000 },
            ],
          }),
        /PERIOD_LOCKED/
      );

      // Clear periodLockDate for bank gateway payout test + verify real vendor party account resolution
      await prisma.systemSettings.update({
        where: { id: "default" },
        data: { periodLockDate: null },
      });

      const proj = await prisma.project.create({
        data: {
          code: `PRJ-GW-${TEST_TAG}`,
          name: "مشروع اختبار البوابة",
          nameAr: "مشروع اختبار البوابة",
          nameEn: "Gateway Test Project",
        },
      });
      const vendor = await prisma.$transaction((tx) =>
        createVendorWithAccountTx(tx, {
          nameAr: "مورد اختبار البوابة",
          nameEn: "Gateway Vendor",
          phone: "770000001",
        })
      );
      const vendorAccountId = vendor.glAccountId || vendor.accountId;

      const trRes = await createTreasuryAccount({
        type: "BANK",
        nameAr: "بنك اختبار البوابة الموحدة",
        currency: "YER",
        openingBalance: 100000,
        transferFeePercent: 0,
        createdById: adminUserId,
      });
      await prisma.treasuryAccount.update({
        where: { id: trRes.treasury.id },
        data: { gatewayProvider: "KURAIMI_API", isSandbox: true },
      });

      const billRes = await postVendorBill({
        vendorId: vendor.id,
        projectId: proj.id,
        totalAmount: 25000,
        date: "2026-05-01",
        createdById: adminUserId,
      });
      const voucher = await prisma.paymentVoucher.create({
        data: {
          voucherNumber: `PV-GW-${TEST_TAG}`,
          vendorId: vendor.id,
          billId: billRes.bill.id,
          treasuryId: trRes.treasury.id,
          amount: 25000,
          currency: "YER",
          currencyCode: "YER",
          exchangeRate: 1,
          foreignAmount: 25000,
          baseAmount: 25000,
        },
      });

      const dispatch = await executeBankOrWalletPayout({
        treasuryAccountId: trRes.treasury.id,
        sourceVoucherType: "PAYMENT_VOUCHER",
        sourceVoucherId: voucher.id,
        beneficiaryName: vendor.nameAr,
        beneficiaryAccountOrPhone: "3000112233",
        amount: 10000,
        currencyCode: "YER",
        idempotencyKey: `idem-gw-${TEST_TAG}`,
        actor: { userId: adminUserId, userName: "Phase 1 Admin", role: "SUPER_ADMIN" },
      });

      assert.ok(dispatch.journalEntryId);
      const jeLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: dispatch.journalEntryId! },
      });
      assert.equal(jeLines.some((l) => l.accountId === vendorAccountId && Number(l.baseDebit) === 10000), true);
      assert.equal(jeLines.some((l) => l.accountId === trRes.treasury.accountId && Number(l.baseCredit) === 10000), true);
    });
  });

  it("Step 1.4 — Operating expenses, worker wages, audit adjustments & webhooks keep GL and Treasury synchronized, and TreasuryTab calls /api/system/lifecycle", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantLedgerData();

      await prisma.currencyRate.upsert({
        where: { currencyCode: "USD" },
        create: { currencyCode: "USD", rateToYER: 1620 },
        update: { rateToYER: 1620 },
      });

      const proj = await prisma.project.create({
        data: {
          code: `PRJ-SYNC-${TEST_TAG}`,
          name: "مشروع مزامنة الخزينة",
          nameAr: "مشروع مزامنة الخزينة",
          nameEn: "Treasury Sync Project",
        },
      });

      const trCash = await createTreasuryAccount({
        type: "VAULT",
        nameAr: "صندوق المزامنة الرئيسي",
        currency: "YER",
        openingBalance: 100000,
        isDefaultPayments: true,
        isDefaultReceipts: true,
        createdById: adminUserId,
      });

      // 1) POST /api/expenses -> decrements Treasury; DELETE /api/expenses/[id] -> restores Treasury & reverses JE
      const expRes = await expensesPOST(
        makeAuthedReq("/api/expenses", "POST", adminToken, {
          projectId: proj.id,
          harvest: "القطفة الأولى",
          category: "OTHER",
          subType: "وقود مولد",
          qty: 1,
          unitPrice: 15000,
          date: "2026-05-12",
          treasuryAccountId: trCash.treasury.id,
        })
      );
      assert.equal(expRes.ok, true);
      const createdExp = await prisma.operatingExpense.findFirstOrThrow({
        where: { projectId: proj.id },
        orderBy: { createdAt: "desc" },
      });
      const expId = createdExp.id;
      let afterExpTr = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: trCash.treasury.id } });
      assert.equal(Number(afterExpTr.balanceYER), 85000);

      const delExpRes = await expensesDELETE(
        makeAuthedReq(`/api/expenses/${expId}`, "DELETE", adminToken, {}),
        { params: Promise.resolve({ id: expId }) }
      );
      assert.equal(delExpRes.ok, true);
      afterExpTr = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: trCash.treasury.id } });
      assert.equal(Number(afterExpTr.balanceYER), 100000);

      // 2) POST /api/workers with creditAmount -> decrements Treasury; DELETE /api/workers/[id] -> reverses accrual+payout & restores Treasury
      const wrkRes = await workersPOST(
        makeAuthedReq("/api/workers", "POST", adminToken, {
          projectId: proj.id,
          harvest: "القطفة الأولى",
          name: `عامل اختبار ${TEST_TAG}`,
          dailyWage: 5000,
          days: 2,
          credit: 4000,
          date: "2026-05-13",
        })
      );
      assert.equal(wrkRes.ok, true);
      const createdWrk = await prisma.workerWageEntry.findFirstOrThrow({
        where: { projectId: proj.id },
        orderBy: { createdAt: "desc" },
      });
      const wrkId = createdWrk.id;
      let afterWrkTr = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: trCash.treasury.id } });
      assert.equal(Number(afterWrkTr.balanceYER), 96000);

      const delWrkRes = await workersDELETE(
        makeAuthedReq(`/api/workers/${wrkId}`, "DELETE", adminToken, {}),
        { params: Promise.resolve({ id: wrkId }) }
      );
      assert.equal(delWrkRes.ok, true);
      afterWrkTr = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: trCash.treasury.id } });
      assert.equal(Number(afterWrkTr.balanceYER), 100000);

      // 3) POST /api/audit/adjustments targeting Treasury (DR 531101, CR Treasury) -> updates Treasury balanceYER & balance cleanly to 97,500
      const adjRes = await adjustmentsPOST(
        makeAuthedReq("/api/audit/adjustments", "POST", adminToken, {
          key: `ADJ-P1-${TEST_TAG}`,
          periodLabel: "2026-05",
          reason: "تسوية جرد الصندوق بالعجز",
          amount: 2500,
          treasuryAccountId: trCash.treasury.id,
          projectId: proj.id,
        })
      );
      assert.equal(adjRes.ok, true);
      const afterAdjTr = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: trCash.treasury.id } });
      assert.equal(Number(afterAdjTr.balanceYER), 97500);
      assert.equal(Number(afterAdjTr.balance), 97500);

      // 4) processInboundCollectionWebhook against matching SalesInvoice in USD treasury
      const trUsd = await createTreasuryAccount({
        type: "BANK",
        nameAr: "بنك دولار تحصيل بوابة",
        currency: "USD",
        openingBalance: 0,
        createdById: adminUserId,
      });
      await prisma.treasuryAccount.update({
        where: { id: trUsd.treasury.id },
        data: { gatewayProvider: "JAWALI_API", gatewayMerchantId: `MERCH-${TEST_TAG}` },
      });
      const cust = await prisma.$transaction((tx) =>
        ensureCustomerWithAccountTx(tx, {
          name: `عميل تحصيل إلكتروني ${TEST_TAG}`,
          phone: "770000002",
        })
      );
      const invRes = await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        amount: 16200,
        currency: "YER",
        date: "2026-05-14",
        createdById: adminUserId,
      });

      const whRes = await processInboundCollectionWebhook({
        provider: "JAWALI_API",
        payload: {
          eventId: `EVT-WH-${TEST_TAG}`,
          referenceId: `WH-REF-${TEST_TAG}`,
          amount: 10, // 10 USD = 16,200 YER
          currency: "USD",
          invoiceNumber: invRes.invoice.invoiceNumber,
          treasuryAccountId: trUsd.treasury.id,
        },
      });
      assert.equal(whRes.ok, true);
      assert.ok(whRes.dispatchId);
      const whDispatch = await prisma.bankPaymentDispatch.findUniqueOrThrow({
        where: { id: whRes.dispatchId! },
      });
      assert.ok(whDispatch.journalEntryId);

      const afterWhUsd = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: trUsd.treasury.id } });
      assert.equal(Number(afterWhUsd.balance), 10);
      assert.equal(Number(afterWhUsd.balanceYER), 16200);
      const settledInv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invRes.invoice.id } });
      assert.equal(Number(settledInv.balanceDue), 0);
      assert.equal(settledInv.status, "PAID");

      // TreasuryTab lifecycle check
      const tabCode = fs.readFileSync(
        path.resolve(process.cwd(), "src/components/tabs/TreasuryTab.tsx"),
        "utf8"
      );
      assert.match(tabCode, /\/api\/system\/lifecycle/);
      assert.doesNotMatch(tabCode, /\/api\/records\/lifecycle/);
    });
  });

  it("Step 1.5 — FX Revaluation is idempotent at unchanged rates, settlements book Realized FX Gain/Loss, rounding diffs route cleanly & decimalMath is exact", async () => {
    assert.equal(dAdd(0.1, 0.2), 0.3);
    assert.equal(dMul(19.99, 100), 1999);

    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantLedgerData();

      await prisma.currencyRate.upsert({
        where: { currencyCode: "SAR" },
        create: { currencyCode: "SAR", rateToYER: 425 },
        update: { rateToYER: 425 },
      });

      const proj = await prisma.project.create({
        data: {
          code: `PRJ-FX-${TEST_TAG}`,
          name: "مشروع عملات",
          nameAr: "مشروع عملات",
          nameEn: "FX Test Project",
        },
      });

      // Open SAR asset position: 100 SAR @ 425 = 42,500 YER
      const trSar = await createTreasuryAccount({
        type: "BANK",
        nameAr: "حساب سعودي لإعادة التقييم",
        currency: "SAR",
        openingBalance: 100,
        createdById: adminUserId,
      });

      // Revalue at 430 -> gain of +500 YER (baseDebit=500, debit=0, foreignDebit=0)
      const rev1 = await fxRevalPOST(
        makeAuthedReq("/api/accounting/fx-revaluation", "POST", adminToken, {
          spotRates: { SAR: 430 },
          date: "2026-05-31",
        })
      );
      assert.equal(rev1.ok, true);
      const r1Json = await rev1.json();
      assert.equal(r1Json.posted, true);
      assert.equal(r1Json.totalUnrealizedGain, 500);

      // Repeat immediately at unchanged 430 -> MUST NOT double-post!
      const rev2 = await fxRevalPOST(
        makeAuthedReq("/api/accounting/fx-revaluation", "POST", adminToken, {
          spotRates: { SAR: 430 },
          date: "2026-05-31",
        })
      );
      assert.equal(rev2.ok, true);
      const r2Json = await rev2.json();
      assert.equal(r2Json.posted, false);
      assert.equal(r2Json.totalUnrealizedGain, 0);

      // Realized FX Gain/Loss on Vendor Payment & Customer Receipt settlement
      // Set SAR rate to 425 when billing, then raise to 430 when paying/receiving
      await prisma.currencyRate.update({ where: { currencyCode: "SAR" }, data: { rateToYER: 425 } });
      const vendor = await prisma.$transaction((tx) =>
        createVendorWithAccountTx(tx, { nameAr: `مورد سعودي ${TEST_TAG}`, phone: "770000003" })
      );
      const cust = await prisma.$transaction((tx) =>
        ensureCustomerWithAccountTx(tx, { name: `عميل سعودي ${TEST_TAG}`, phone: "770000004" })
      );

      const fxBill = await postVendorBill({
        vendorId: vendor.id,
        projectId: proj.id,
        totalAmount: 100,
        currency: "SAR",
        date: "2026-05-01",
        createdById: adminUserId,
      });
      const fxInv = await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        amount: 100,
        currency: "SAR",
        date: "2026-05-01",
        createdById: adminUserId,
      });

      await prisma.currencyRate.update({ where: { currencyCode: "SAR" }, data: { rateToYER: 430 } });

      const payRes = await postVendorPayment({
        vendorId: vendor.id,
        billId: fxBill.bill.id,
        treasuryId: trSar.treasury.id,
        amount: 100,
        currency: "SAR",
        date: "2026-05-15",
        createdById: adminUserId,
      });
      const payLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: payRes.journalEntry.id },
        include: { account: true },
      });
      assert.equal(
        payLines.some((l) => l.account.code === "532101" && Math.abs(Number(l.baseDebit) - 500) < 0.01),
        true,
        "Paying AP @ 430 originally booked @ 425 must realize 500 YER FX Loss (532101)"
      );

      const recRes = await postCustomerReceipt({
        customerId: cust.id,
        invoiceId: fxInv.invoice.id,
        treasuryId: trSar.treasury.id,
        amount: 100,
        currency: "SAR",
        date: "2026-05-15",
        createdById: adminUserId,
      });
      const recLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: recRes.journalEntry.id },
        include: { account: true },
      });
      assert.equal(
        recLines.some((l) => l.account.code === "421101" && Math.abs(Number(l.baseCredit) - 500) < 0.01),
        true,
        "Collecting AR @ 430 originally booked @ 425 must realize 500 YER FX Gain (421101)"
      );

      // Sub-unit dual-currency FX rounding difference (<= 1.0 YER) routes to 532103 via balanceDualCurrencyLines
      const roundedJe = await postJournalEntry({
        date: "2026-05-20",
        narrationAr: "قيد اختبار تقريب العملات",
        createdById: adminUserId,
        lines: [
          { accountId: cashAccountId, debit: 100, currency: "SAR", exchangeRate: 425.004 }, // 42500.40
          { accountId: equityAccountId, credit: 100, currency: "SAR", exchangeRate: 425 },   // 42500.00
        ],
      });
      const rLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: roundedJe.id },
        include: { account: true },
      });
      const sumDr = rLines.reduce((s, l) => dAdd(s, Number(l.baseDebit)), 0);
      const sumCr = rLines.reduce((s, l) => dAdd(s, Number(l.baseCredit)), 0);
      assert.ok(Math.abs(sumDr - sumCr) <= 0.0001);
      assert.equal(rLines.some((l) => l.account.code === "532103"), true);
    });
  });

  it("Step 1.6 — ControlAccountsMap non-colliding defaults, transactional sequences & scopedResetEngine keeps headers balanced + preserves Gen-1 roots", async () => {
    assert.notEqual(DEFAULT_CONTROL_ACCOUNTS.taxPayableAccount, "212101");
    assert.notEqual(DEFAULT_CONTROL_ACCOUNTS.taxReceivableAccount, "114101");
    assert.equal(DEFAULT_CONTROL_ACCOUNTS.taxPayableAccount, "214101");
    assert.equal(DEFAULT_CONTROL_ACCOUNTS.taxReceivableAccount, "114301");
    assert.equal(DEFAULT_CONTROL_ACCOUNTS.realizedFxLossAccount, "532101");
    assert.equal(DEFAULT_CONTROL_ACCOUNTS.unrealizedFxLossAccount, "532102");
    assert.equal(DEFAULT_CONTROL_ACCOUNTS.fxRoundingAccount, "532103");

    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantLedgerData();

      // Custom bankFeeAccount configured in SystemSettings
      const bankFeeParent = await prisma.account.findUniqueOrThrow({ where: { code: "531201" } });
      const customFeeLeaf =
        bankFeeParent.isPosting && bankFeeParent.isPostable
          ? bankFeeParent
          : await prisma.account.create({
              data: {
                code: "53120199",
                nameAr: "رسوم بنكية مخصصة",
                nameEn: "Custom Bank Fees",
                type: "EXPENSE",
                level: 6,
                generation: 6,
                isPosting: true,
                isPostable: true,
                parentCode: bankFeeParent.code,
                parentId: bankFeeParent.id,
                parentAccountId: bankFeeParent.id,
              },
            });
      await prisma.systemSettings.update({
        where: { id: "default" },
        data: {
          controlAccountsJson: JSON.stringify({
            bankFeeAccount: customFeeLeaf.code,
          }),
        },
      });

      const t1 = await createTreasuryAccount({
        type: "VAULT",
        nameAr: "صندوق التحويل الأول",
        currency: "YER",
        openingBalance: 50000,
        createdById: adminUserId,
      });
      const t2 = await createTreasuryAccount({
        type: "VAULT",
        nameAr: "صندوق التحويل الثاني",
        currency: "YER",
        openingBalance: 0,
        createdById: adminUserId,
      });
      const xfer = await transferBetweenTreasuries({
        fromTreasuryId: t1.treasury.id,
        toTreasuryId: t2.treasury.id,
        amount: 10000,
        feeAmount: 200,
        createdById: adminUserId,
      });
      const xferLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: xfer.journalEntry.id },
      });
      assert.equal(xferLines.some((l) => l.accountId === customFeeLeaf.id && Number(l.baseDebit) === 200), true);

      // Verify JV sequence persisted atomically in SystemSettings
      const sysAfterSeq = await prisma.systemSettings.findUniqueOrThrow({ where: { id: "default" } });
      const parsedSettings = parseAccountingSettings(sysAfterSeq);
      assert.ok((parsedSettings.documentSequences?.JV?.nextNumber ?? 0) >= 3);

      // Scoped reset precheck + unit reset balance guarantee
      const projA = await prisma.project.create({
        data: { code: `PA-${TEST_TAG}`, name: "مشروع أ", nameAr: "مشروع أ", nameEn: "Project A" },
      });
      const projB = await prisma.project.create({
        data: { code: `PB-${TEST_TAG}`, name: "مشروع ب", nameAr: "مشروع ب", nameEn: "Project B" },
      });

      // Cross-project JE referencing BOTH projA and projB -> must NOT leave unbalanced header when resetting projA!
      const crossJe = await postJournalEntry({
        date: "2026-05-15",
        narrationAr: "قيد مشترك بين مشروعين",
        projectId: projA.id,
        createdById: adminUserId,
        lines: [
          { accountId: expenseAccountId, debit: 3000, projectId: projA.id },
          { accountId: expenseAccountId, debit: 2000, projectId: projB.id },
          { accountId: cashAccountId, credit: 5000, projectId: projB.id },
        ],
      });

      await prisma.workspaceDraft.create({
        data: {
          draftNumber: `DRF-P1-${TEST_TAG}`,
          module: "JOURNAL",
          formType: "JOURNAL_VOUCHER",
          titleAr: "مسودة نشطة للعد",
          payloadJson: "{}",
          totalAmount: 100,
          status: "ACTIVE_DRAFT",
          createdById: adminUserId,
          createdByName: "Phase 1 Admin",
        },
      });

      const precheck = await precheckScopedReset({ scope: "unit", unitType: "project", unitId: projA.id });
      assert.ok(precheck.unpostedDraftsCount >= 1);

      await executeScopedReset({
        scope: "unit",
        unitType: "project",
        unitId: projA.id,
        confirmationPhrase: "RESET_UNIT",
        actor: {
          userId: adminUserId,
          userDisplay: "Phase 1 Admin",
          userRole: "SUPER_ADMIN",
        },
      });

      // Multi-unit header remains balanced (no single-sided deletion)
      const remainingCross = await prisma.journalEntry.findUnique({
        where: { id: crossJe.id },
        include: { lines: true },
      });
      assert.ok(remainingCross);
      const remDr = remainingCross!.lines.reduce((s, l) => dAdd(s, Number(l.baseDebit)), 0);
      const remCr = remainingCross!.lines.reduce((s, l) => dAdd(s, Number(l.baseCredit)), 0);
      assert.equal(remDr, 5000);
      assert.equal(remCr, 5000);

      // blank_coa factory reset preserves Gen-1 summary roots 100000..500000
      await executeScopedReset({
        scope: "factory",
        coaMode: "blank_coa",
        confirmationPhrase: "FACTORY_RESET",
        actor: {
          userId: adminUserId,
          userDisplay: "Phase 1 Admin",
          userRole: "SUPER_ADMIN",
        },
      });
      const gen1Roots = await prisma.account.findMany({
        where: { code: { in: ["100000", "200000", "300000", "400000", "500000"] } },
      });
      assert.equal(gen1Roots.length, 5);
    });
  });
});

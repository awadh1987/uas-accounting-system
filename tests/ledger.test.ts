import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma";
import {
  buildHierarchicalCoaTree,
  createHierarchicalAccount,
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
  resolveOrCreatePostingAccountTx,
  transferBetweenTreasuries,
  updateJournalEntry,
  updateTreasuryAccount,
} from "../src/lib/accounting/ledgerService";
import {
  canAccessModule,
  canEdit,
  canEditDate,
  canManageLandingCms,
  canManageTreasury,
  canPostLedger,
  isReadOnly,
  isUserActive,
} from "../src/lib/permissions";
import type { UasUser } from "../src/types/uas";

describe("Enterprise Double-Entry General Ledger & Accounting Assertions", () => {
  after(async () => {
    await prisma.$disconnect();
  });

  async function ensureTestFixturesTx(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
    const acc111101 = await tx.account.findUniqueOrThrow({ where: { code: "111101" } });
    const acc111103 = await tx.account.findUniqueOrThrow({ where: { code: "111103" } });
    const acc111201 = await tx.account.findUniqueOrThrow({ where: { code: "111201" } });
    const acc211101 = await tx.account.findUniqueOrThrow({ where: { code: "211101" } });
    const acc112101 = await tx.account.findUniqueOrThrow({ where: { code: "112101" } });

    await tx.treasuryAccount.upsert({
      where: { id: "t1" },
      update: {},
      create: {
        id: "t1",
        code: "TR-VAULT-YER",
        name: "الصندوق الرئيسي - يمني",
        nameAr: "الصندوق الرئيسي - يمني",
        nameEn: "Main Cash Vault - YER",
        type: "VAULT",
        accountNumber: "CASH-01",
        accountId: acc111101.id,
        currency: "YER",
        currencyCode: "YER",
        balance: 0,
        balanceYER: 0,
      },
    });

    await tx.treasuryAccount.upsert({
      where: { id: "t2" },
      update: {},
      create: {
        id: "t2",
        code: "TR-BANK-KUR",
        name: "بنك الكريمي الإسلامي",
        nameAr: "بنك الكريمي الإسلامي",
        nameEn: "Kuraimi Islamic Bank",
        type: "BANK",
        accountNumber: "KUR-01",
        accountId: acc111201.id,
        currency: "YER",
        currencyCode: "YER",
        balance: 0,
        balanceYER: 0,
      },
    });

    await tx.treasuryAccount.upsert({
      where: { id: "t6" },
      update: {},
      create: {
        id: "t6",
        code: "TR-VAULT-USD",
        name: "صندوق الدولار",
        nameAr: "صندوق الدولار",
        nameEn: "USD Central Safe",
        type: "VAULT",
        accountNumber: "USD-01",
        accountId: acc111103.id,
        currency: "USD",
        currencyCode: "USD",
        balance: 0,
        balanceYER: 0,
      },
    });

    await tx.vendor.upsert({
      where: { id: "v1" },
      update: {},
      create: {
        id: "v1",
        code: "VND-001",
        nameAr: "مورد التوريدات الزراعية",
        nameEn: "Agricultural Supplies Vendor",
        phone: "777100200",
        accountId: acc211101.id,
      },
    });

    await tx.customer.upsert({
      where: { id: "cust1" },
      update: {},
      create: {
        id: "cust1",
        code: "CUST-001",
        name: "عميل الجملة الأول",
        nameAr: "عميل الجملة الأول",
        nameEn: "Primary Wholesale Client",
        phone: "783118231",
        accountId: acc112101.id,
      },
    });

    const cust2Acc = await createHierarchicalAccount({
      parentCode: "112100",
      code: "112198",
      nameAr: "عميل الجملة الثاني",
      nameEn: "Secondary Wholesale Client",
      tx,
    });
    await tx.customer.upsert({
      where: { id: "cust2" },
      update: {},
      create: {
        id: "cust2",
        code: "CUST-002",
        name: "عميل الجملة الثاني",
        nameAr: "عميل الجملة الثاني",
        nameEn: "Secondary Wholesale Client",
        phone: "783118231",
        accountId: cust2Acc.id,
      },
    });

    await tx.project.upsert({
      where: { id: "p1" },
      update: { vendorId: "v1" },
      create: {
        id: "p1",
        code: "PRJ-001",
        name: "مشروع الاختبار الرئيسي",
        nameAr: "مشروع الاختبار الرئيسي",
        nameEn: "Main Test Project",
        type: "مشروع رئيسي",
        vendorId: "v1",
        budgetTotal: 1000000,
        estimatedValue: 1000000,
        plannedHarvestCount: 3,
        status: "ACTIVE",
      },
    });

    await tx.subProject.upsert({
      where: { id: "sp1" },
      update: {},
      create: {
        id: "sp1",
        projectId: "p1",
        code: "SUB-01",
        nameAr: "القطاع الأول",
        nameEn: "Sector 1",
        budget: 450000,
        status: "ACTIVE",
      },
    });

    await tx.subProject.upsert({
      where: { id: "sp2" },
      update: {},
      create: {
        id: "sp2",
        projectId: "p1",
        code: "SUB-02",
        nameAr: "القطاع الثاني",
        nameEn: "Sector 2",
        budget: 350000,
        status: "ACTIVE",
      },
    });

    await tx.harvestCycle.upsert({
      where: { id: "hc_p1_1" },
      update: {},
      create: {
        id: "hc_p1_1",
        projectId: "p1",
        cycleNumber: 1,
        name: "القطفة الأولى",
        sortOrder: 1,
        isLocked: false,
      },
    });

    await tx.projectAcquisitionCycle.upsert({
      where: { id: "acq_p1_1" },
      update: {},
      create: {
        id: "acq_p1_1",
        projectId: "p1",
        cycleTitle: "عقد تأسيس وتشغيل الموسم الأول",
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: new Date("2027-03-31T23:59:59Z"),
        contractAmount: 1000000,
        currency: "YER",
        status: "ACTIVE",
      },
    });
  }

  it("verifies Sum(All Debits) === Sum(All Credits) across the entire posted general ledger", async () => {
    const postedLines = await prisma.journalEntryLine.findMany({
      where: { journalEntry: { status: "POSTED" } },
      include: {
        account: { select: { code: true, level: true, isPosting: true } },
        journalEntry: { select: { entryNumber: true } },
      },
    });

    let sumAllDebits = 0;
    let sumAllCredits = 0;

    for (const line of postedLines) {
      assert.equal(
        line.account.isPosting,
        true,
        `Account ${line.account.code} on ${line.journalEntry.entryNumber} must be Tier-5 posting`
      );
      assert.ok(
        line.account.level === 5 || line.account.level === 6,
        `Posting account ${line.account.code} must be Gen 5 or Gen 6`
      );
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
          await ensureTestFixturesTx(tx);
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
          await ensureTestFixturesTx(tx);
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

  it("verifies 6-generation COA hierarchy, promotion rules, and lineage chain computation", async () => {
    // 1. Attempting to add a Gen 6 child under an account with active transactions (111101) must fail
    const SENTINEL_PARENT_TX = "ROLLBACK_PARENT_HAS_TX";
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await postJournalEntry({
            narrationAr: "قيد اختبار حركة على الحساب الأب",
            lines: [
              { accountCode: "111101", debit: 1000 },
              { accountCode: "311101", credit: 1000 },
            ],
            tx,
          });
          await assert.rejects(
            () =>
              createHierarchicalAccount({
                parentCode: "111101",
                nameAr: "حساب تشغيلي فرعي تحت صندوق به حركات",
                tx,
              }),
            /PARENT_HAS_TRANSACTIONS/
          );
          throw new Error(SENTINEL_PARENT_TX);
        }),
      new RegExp(SENTINEL_PARENT_TX)
    );

    // 2. Create a clean Gen 5 analytical account under 111100 (Central Safe)
    const gen5 = await createHierarchicalAccount({
      parentCode: "111100",
      code: "111199",
      nameAr: "صندوق العمليات الميدانية الخاص",
      nameEn: "Special Field Operations Safe",
    });
    assert.equal(gen5.level, 5);
    assert.equal(gen5.isPosting, true, "Gen 5 with no children should default to posting leaf");

    // 3. Add a Gen 6 operational leaf under 111199 -> auto-promotes 111199 to summary header (isPosting: false)
    const gen6 = await createHierarchicalAccount({
      parentId: gen5.id,
      code: "11119901",
      nameAr: "صندوق المندوب رقم 1 (تشغيلي)",
      nameEn: "Collector 1 Cash Safe (Operational)",
    });
    assert.equal(gen6.level, 6);
    assert.equal(gen6.isPosting, true, "Gen 6 must always be a posting leaf");

    // Verify parent Gen 5 was auto-promoted to summary header
    const updatedGen5 = await prisma.account.findUniqueOrThrow({ where: { id: gen5.id } });
    assert.equal(updatedGen5.isPosting, false, "Gen 5 parent must be auto-promoted to isPosting = false");

    // 4. Verify buildHierarchicalCoaTree computes 6-node lineageChain and proper rollups
    const allAccounts = await prisma.account.findMany();
    const treeResult = buildHierarchicalCoaTree(allAccounts, []);
    assert.ok(treeResult.tree.length >= 5, "Expected root generations in buildHierarchicalCoaTree");

    const { flat } = await getCoaTreeWithBalances();
    const gen6Node = flat.find((n) => n.code === "11119901");
    assert.ok(gen6Node, "Expected Gen 6 node in COA flat list");
    assert.equal(gen6Node.lineageChain.length, 6, "Expected exactly 6 nodes in lineageChain for Gen 6");
    assert.deepEqual(
      gen6Node.lineageChain.map((l) => l.level),
      [1, 2, 3, 4, 5, 6],
      "Lineage chain must be ordered Gen 1 -> Gen 2 -> Gen 3 -> Gen 4 -> Gen 5 -> Gen 6"
    );

    // Clean up test accounts
    await prisma.account.delete({ where: { id: gen6.id } });
    await prisma.account.delete({ where: { id: gen5.id } });
  });

  it("verifies Concurrent Multi-Officer Sales fields and Sub-Project relations", async () => {
    const SENTINEL = "ROLLBACK_MULTI_OFFICER_SALES";
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await ensureTestFixturesTx(tx);
          await tx.saleTransaction.create({
            data: {
              sequenceNumber: "SO-2026-0001",
              dailyBatchLabel: "دفعة صباحية #1",
              salesOfficerId: "u5",
              salesOfficerTitle: "مسؤول المبيعات والتحصيل",
              revenueAccountCode: "411101",
              treasuryAccountId: "t1",
              projectId: "p1",
              subProjectId: "sp1",
              harvestCycleId: "hc_p1_1",
              harvestName: "القطفة الأولى",
              saleBatchLabel: "عملية بيع 1",
              customerId: "cust1",
              customerName: "عميل الجملة الأول",
              customerPhone: "783118231",
              productGrade: "صنف 1",
              bundlesCount: 10,
              unitPrice: 2000,
              totalAmount: 20000,
              creditPaid: 5000,
              debitReceivable: 15000,
              saleDate: "2026-11-05",
              receiptVoucherNo: "RV-001",
            },
          });

          const sales = await tx.saleTransaction.findMany({
            include: {
              subProject: true,
              treasuryAccount: true,
            },
          });

          assert.ok(sales.length > 0, "Expected sales");
          for (const sale of sales) {
            assert.ok(sale.sequenceNumber, "Expected sequenceNumber on SaleTransaction");
            assert.ok(sale.sequenceNumber.startsWith("SO-2026-"));
            assert.ok(sale.dailyBatchLabel, "Expected dailyBatchLabel on SaleTransaction");
            assert.equal(sale.revenueAccountCode, "411101");
            assert.ok(sale.subProjectId, "Expected subProjectId link on SaleTransaction");
            assert.ok(sale.subProject, "Expected loaded subProject relation");
          }
          throw new Error(SENTINEL);
        }),
      new RegExp(SENTINEL)
    );
  });

  it("verifies atomic 'Other' custom account provisioning and dynamic accounting direction in procurement, expenses, and sales", async () => {
    const SENTINEL = "ROLLBACK_ATOMIC_PROVISIONING";
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await ensureTestFixturesTx(tx);
          // 1. Direct atomic custom account provisioning
          const customExpenseAccount = await resolveOrCreatePostingAccountTx(tx, {
            customAccount: {
              parentCode: "512100", // Operating direct expenses parent (Gen 4)
              nameAr: "مصروف بذور وأسمدة عضوية مخصصة",
              nameEn: "Custom Organic Seeds Expense",
            },
            fallbackDefaultCode: "512101",
          });
          assert.ok(customExpenseAccount);
          assert.equal(customExpenseAccount.level, 5);
          assert.equal(customExpenseAccount.isPosting, true);
          assert.equal(customExpenseAccount.nameAr, "مصروف بذور وأسمدة عضوية مخصصة");
          assert.ok(customExpenseAccount.code.startsWith("5121"));

          // 2. Post vendor bill using the newly provisioned custom account
          const billRes = await postVendorBill({
            vendorId: "v1",
            projectId: "p1",
            subProjectId: "sp1",
            totalAmount: 18500,
            currency: "YER",
            isInventory: false,
            debitAccountId: customExpenseAccount.id,
            notes: "فاتورة شراء بذور مخصصة بالتوجيه الجديد",
            tx,
          });

          assert.equal(Number(billRes.bill.totalAmount), 18500);
          assert.ok(billRes.journalEntry);
          const customLine = billRes.journalEntry.lines.find(
            (l) => l.accountId === customExpenseAccount.id
          );
          assert.ok(customLine, "Expected journal line to post directly to custom account");
          assert.equal(Number(customLine.debit), 18500);
          assert.equal(customLine.subProjectId, "sp1");

          // 3. Post sales invoice with atomic custom revenue account
          const salesRes = await postSalesInvoice({
            customerId: "cust1",
            projectId: "p1",
            subProjectId: "sp2",
            amount: 45000,
            currency: "YER",
            customAccount: {
              parentCode: "411100", // Sales revenue control account (Gen 4)
              nameAr: "إيرادات بيع منتجات زراعية ثانوية مخصصة",
              nameEn: "Custom Byproduct Sales Revenue",
            },
            sequenceNumber: "SO-2026-9999",
            dailyBatchLabel: "دفعة مسائية رقم 9",
            salesOfficerId: "usr_acc_1",
            salesOfficerTitle: "مسؤول المبيعات الميداني المناوب",
            notes: "فاتورة مبيعات مخصصة بالتوجيه الآلي",
            tx,
          });

          assert.equal(Number(salesRes.invoice.totalAmount), 45000);
          assert.equal(salesRes.invoice.sequenceNumber, "SO-2026-9999");
          assert.equal(salesRes.invoice.salesOfficerTitle, "مسؤول المبيعات الميداني المناوب");
          const revAccount = await tx.account.findUnique({
            where: { code: salesRes.invoice.revenueAccountCode! },
          });
          assert.ok(revAccount);
          assert.equal(revAccount.nameAr, "إيرادات بيع منتجات زراعية ثانوية مخصصة");

          throw new Error(SENTINEL);
        }),
      new RegExp(SENTINEL)
    );
  });

  it("verifies end-to-end lifecycle of Sub-Projects, multi-officer concurrent sales, and 6-generation financial rollups", async () => {
    const SENTINEL = "ROLLBACK_PHASE6_E2E";
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await ensureTestFixturesTx(tx);
          // 1. Create a dynamic Sub-Project (Cost Center)
          const subProject = await tx.subProject.create({
            data: {
              projectId: "p1",
              code: "SUB-E2E-01",
              nameAr: "قطاع تجارب البيوت المحمية الحديثة",
              nameEn: "Modern Greenhouses Sector",
              budget: 750000,
              status: "ACTIVE",
              notes: "قطاع تحليلي لاختبار دورة العمل سداسية الأجيال",
            },
          });
          assert.ok(subProject.id);

          // 2. Create Gen 5 and Gen 6 Accounts under Expenses (512100)
          const gen5Res = await createHierarchicalAccount({
            level: 5,
            parentCode: "512100",
            nameAr: "مصروفات وقود البيوت المحمية التجريبية",
            nameEn: "Greenhouse Fuel Expenses",
            tx,
          });
          assert.equal(gen5Res.level, 5);

          const gen6Res = await createHierarchicalAccount({
            level: 6,
            parentCode: gen5Res.code,
            nameAr: "ديزل مولد كهرباء البيت المحمي رقم 1",
            nameEn: "Greenhouse #1 Generator Diesel",
            tx,
          });
          assert.equal(gen6Res.level, 6);
          assert.equal(gen6Res.isPosting, true);

          // Verify Gen 5 was promoted to summary parent (isPosting = false)
          const gen5Parent = await tx.account.findUniqueOrThrow({ where: { id: gen5Res.id } });
          assert.equal(gen5Parent.isPosting, false);

          // 3. Post Operating Expense referencing Gen 6 account and SubProject
          const expEntry = await postJournalEntry({
            date: "2026-11-12",
            narrationAr: "شراء ديزل للبيت المحمي في القطاع الفرعي",
            narrationEn: "Greenhouse Diesel Purchase",
            projectId: "p1",
            subProjectId: subProject.id,
            createdById: "usr_acc_1",
            lines: [
              {
                accountId: gen6Res.id,
                debit: 45000,
                projectId: "p1",
                subProjectId: subProject.id,
              },
              {
                accountCode: "111101",
                credit: 45000,
                projectId: "p1",
                subProjectId: subProject.id,
              },
            ],
            tx,
          });
          assert.equal(expEntry.lines.length, 2);

          // 4. Concurrent Sale 1 by Officer A (Morning Shift)
          const saleOfficerA = await postSalesInvoice({
            customerId: "cust1",
            projectId: "p1",
            subProjectId: subProject.id,
            amount: 120000,
            currency: "YER",
            revenueAccountCode: "411101",
            sequenceNumber: "SO-2026-5001",
            dailyBatchLabel: "وردية الصباح - حوش 1",
            salesOfficerId: "officer_1",
            salesOfficerTitle: "علي المحمودي (مسؤول مبيعات أول)",
            notes: "بيع علاقيات قطفة تجريبية نخب أول",
            tx,
          });
          assert.equal(saleOfficerA.invoice.sequenceNumber, "SO-2026-5001");
          assert.equal(saleOfficerA.invoice.subProjectId, subProject.id);

          // Customer payment receipt voucher into treasury
          const receiptA = await postCustomerReceipt({
            customerId: "cust1",
            invoiceId: saleOfficerA.invoice.id,
            treasuryId: "t2",
            amount: 80000,
            currency: "YER",
            projectId: "p1",
            subProjectId: subProject.id,
            notes: "دفعة نقدية مقبوضة من العميل",
            tx,
          });
          assert.equal(Number(receiptA.receipt.amount), 80000);

          // 5. Concurrent Sale 2 by Officer B (Evening Shift)
          const saleOfficerB = await postSalesInvoice({
            customerId: "cust2",
            projectId: "p1",
            subProjectId: subProject.id,
            amount: 95000,
            currency: "YER",
            revenueAccountCode: "411101",
            sequenceNumber: "SO-2026-5002",
            dailyBatchLabel: "وردية المساء - حوش 2",
            salesOfficerId: "officer_2",
            salesOfficerTitle: "سامي القدسي (مسؤول مبيعات مسائي)",
            notes: "بيع محصول درجة مخصصة",
            tx,
          });
          assert.equal(saleOfficerB.invoice.sequenceNumber, "SO-2026-5002");
          assert.equal(saleOfficerB.invoice.salesOfficerTitle, "سامي القدسي (مسؤول مبيعات مسائي)");

          // 6. Verify Complete Double-Entry Balance
          const allPostedLines = await tx.journalEntryLine.findMany({
            where: { journalEntry: { status: "POSTED" } },
          });
          let totalDebit = 0;
          let totalCredit = 0;
          for (const l of allPostedLines) {
            totalDebit += Number(l.debitBase);
            totalCredit += Number(l.creditBase);
          }
          assert.ok(
            Math.abs(totalDebit - totalCredit) < 0.005,
            `Ledger unbalanced: DR=${totalDebit}, CR=${totalCredit}`
          );

          // 7. Verify Sub-Project Financial Aggregation
          const subProjectJournalLines = allPostedLines.filter(
            (l) => l.subProjectId === subProject.id
          );
          assert.ok(
            subProjectJournalLines.length >= 6,
            "Expected lines tagged with subProjectId"
          );

          // 8. Verify Hierarchical 6-Gen COA Rollup
          const coaAccounts = await tx.account.findMany();
          const treeData = buildHierarchicalCoaTree(coaAccounts, allPostedLines);
          const gen1Expense = treeData.tree.find((n) => n.code === "500000");
          assert.ok(gen1Expense);
          assert.ok(
            gen1Expense.rolledUpDebit > 0,
            "Gen 1 Expense rolled up balance must include Gen 6 posting lines"
          );

          throw new Error(SENTINEL);
        }),
      new RegExp(SENTINEL)
    );
  });

  it("verifies User Profile self-service preferences, dynamic RBAC overrides, and admin security controls", async () => {
    const SENTINEL = "ROLLBACK_RBAC_PROFILE";
    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          // 1. Create a standard field accountant user
          const testUser = await tx.user.create({
            data: {
              username: "test_field_officer",
              name: "محاسب ميداني تجريبي",
              fullName: "محاسب ميداني تجريبي بن صالح",
              email: "field_officer_test@qat.world",
              passwordHash: "hash_test_12345",
              role: "FIELD_ACCOUNTANT",
              department: "الحسابات الميدانية",
              preferredLang: "ar",
              preferredCurrency: "YER",
              preferredTheme: "emerald",
              isActive: true,
            },
          });

          // Test default role permissions: Field accountant cannot manage treasury or post ledger by default
          assert.equal(canManageTreasury(testUser as unknown as UasUser), false);
          assert.equal(canPostLedger(testUser as unknown as UasUser), false);
          assert.equal(canAccessModule(testUser as unknown as UasUser, "admin"), false);

          // 2. Self-Service Profile Update: update personal display name, contact, and preferences
          const updatedProfile = await tx.user.update({
            where: { id: testUser.id },
            data: {
              displayName: "أبو أحمد المحاسب",
              phone: "+967771234567",
              email: "accountant@qat.world",
              avatarColor: "#0284c7",
              preferredLang: "en",
              preferredCurrency: "SAR",
              preferredTheme: "royal",
              defaultModule: "sales",
            },
          });

          assert.equal(updatedProfile.displayName, "أبو أحمد المحاسب");
          assert.equal(updatedProfile.phone, "+967771234567");
          assert.equal(updatedProfile.preferredCurrency, "SAR");
          assert.equal(updatedProfile.preferredTheme, "royal");

          // 3. Super Admin grants Custom Dynamic RBAC Overrides
          const updatedWithOverrides = await tx.user.update({
            where: { id: testUser.id },
            data: {
              useCustomPermissions: true,
              customAllowedGroups: JSON.stringify(["admin", "finance", "commercial"]),
              customPermissionsJson: JSON.stringify({
                canManageTreasury: true,
                canPostLedger: true,
                canManageLandingCms: true,
              }),
            },
          });

          // Verify overrides take effect dynamically
          assert.equal(canManageTreasury(updatedWithOverrides as unknown as UasUser), true);
          assert.equal(canPostLedger(updatedWithOverrides as unknown as UasUser), true);
          assert.equal(canManageLandingCms(updatedWithOverrides as unknown as UasUser), true);
          assert.equal(canAccessModule(updatedWithOverrides as unknown as UasUser, "admin"), true);
          assert.equal(canAccessModule(updatedWithOverrides as unknown as UasUser, "finance"), true);

          // 4. Admin Security Control: Suspend Account (isActive: false)
          const suspendedUser = await tx.user.update({
            where: { id: testUser.id },
            data: { isActive: false },
          });

          assert.equal(isUserActive(suspendedUser as unknown as UasUser), false);
          // When inactive, all permissions evaluate to false regardless of overrides
          assert.equal(canManageTreasury(suspendedUser as unknown as UasUser), false);
          assert.equal(canPostLedger(suspendedUser as unknown as UasUser), false);

          // 5. Admin Password Reset with force password change
          const resetUser = await tx.user.update({
            where: { id: testUser.id },
            data: {
              isActive: true,
              passwordHash: "new_admin_reset_hash_999",
              mustChangePassword: true,
              passwordUpdatedAt: new Date(),
            },
          });

          assert.equal(resetUser.mustChangePassword, true);
          assert.ok(resetUser.passwordUpdatedAt);
          assert.equal(resetUser.passwordHash, "new_admin_reset_hash_999");

          throw new Error(SENTINEL);
        }),
      new RegExp(SENTINEL)
    );
  });
});


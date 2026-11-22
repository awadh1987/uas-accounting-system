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
import {
  loadInstalledLicense,
  resolveTenantLicensePath,
  saveInstalledLicense,
} from "../src/lib/licensing/verifier";
import { hashPassword } from "../src/lib/serverBootstrap";
import { ensure6GenerationCoaHierarchy } from "../src/lib/accountingCoreEngine";
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
} from "../src/lib/accounting/ledgerService";
import { createApprovalRule, decideApprovalRequest } from "../src/lib/approvalEngine";
import { createWorkspaceDraft, promoteWorkspaceDraft } from "../src/lib/workspaceDraftsEngine";
import { POST as stockMovementPOST } from "../src/app/api/inventory/movements/route";
import { POST as poPOST } from "../src/app/api/procurement/pos/route";
import { POST as billsPOST } from "../src/app/api/procurement/bills/route";
import { POST as salesPOST } from "../src/app/api/sales/route";
import { POST as expensesPOST } from "../src/app/api/expenses/route";
import { POST as workersPOST } from "../src/app/api/workers/route";
import { GET as periodsGET, POST as periodsPOST } from "../src/app/api/accounting/periods/route";
import { GET as taxesGET } from "../src/app/api/accounting/taxes/route";
import { GET as taxSummaryGET } from "../src/app/api/accounting/reports/tax-summary/route";
import { GET as cashFlowGET } from "../src/app/api/accounting/reports/cash-flow/route";
import { GET as equityGET } from "../src/app/api/accounting/reports/changes-in-equity/route";
import { GET as agingGET } from "../src/app/api/accounting/reports/aging/route";
import { GET as statementsGET } from "../src/app/api/accounting/reports/statements/route";
import { GET as ratiosGET } from "../src/app/api/accounting/reports/ratios/route";
import { GET as drilldownGET } from "../src/app/api/accounting/reports/drilldown/route";
import { GET as incomeStmtGET } from "../src/app/api/accounting/reports/income-statement/route";

const TEST_TAG = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const TEST_TENANT = `phase2_3_erp_${TEST_TAG}`;

function makeReq(
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

async function resetTenantTables() {
  await prisma.auditLog.deleteMany({});
  await prisma.approvalRequest.deleteMany({});
  await prisma.approvalRule.deleteMany({});
  await prisma.workspaceDraft.deleteMany({});
  await prisma.stockMovement.deleteMany({});
  await prisma.stockBalance.deleteMany({});
  await prisma.inventoryLot.deleteMany({});
  await prisma.saleTransaction.deleteMany({});
  await prisma.installmentVoucher.deleteMany({});
  await prisma.receiptVoucher.deleteMany({});
  await prisma.salesInvoiceItem.deleteMany({});
  await prisma.salesInvoice.deleteMany({});
  await prisma.paymentVoucher.deleteMany({});
  await prisma.vendorBillItem.deleteMany({});
  await prisma.vendorBill.deleteMany({});
  await prisma.goodsReceipt.deleteMany({});
  await prisma.purchaseOrderItem.deleteMany({});
  await prisma.purchaseOrder.deleteMany({});
  await prisma.workerWageEntry.deleteMany({});
  await prisma.operatingExpense.deleteMany({});
  await prisma.journalEntryLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.accountingPeriod.deleteMany({});
  await prisma.treasuryAccount.deleteMany({});
  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {
      periodLockDate: null,
      requireApprovalWorkflow: false,
      enforceThreeWayMatch: true,
      threeWayTolerancePct: 0,
      threeWayToleranceAmount: 0.01,
      costingMethod: "WEIGHTED_AVERAGE",
      negativeStockPolicy: "BLOCK",
    },
  });
}

describe("Phase 2 & Phase 3 Core — Inventory↔GL, Approvals, AR/AP Controls, Monthly Periods, Tax/VAT & Statutory Reports", () => {
  let adminId = "";
  let reviewerId = "";
  let adminToken = "";
  let warehouseId = "";
  let baseUomId = "";
  let cashLeafId = "";
  let equityLeafId = "";

  before(async () => {
    const defaultLicense = loadInstalledLicense("default").license;
    const licensedCompanyName =
      defaultLicense?.company_name || "وكالة الجابري لتجارة القات";
    ensureTenantRegistered(TEST_TENANT, licensedCompanyName, {
      nameAr: licensedCompanyName,
      nameEn: "Phase 2 & 3 ERP Test Tenant",
    });
    if (defaultLicense) {
      saveInstalledLicense(defaultLicense, TEST_TENANT);
    }

    await runWithTenant(TEST_TENANT, async () => {
      await prisma.enterpriseProfile.findFirst();
      await prisma.enterpriseProfile.updateMany({
        data: { legalNameAr: licensedCompanyName, isConfigured: true },
      });
      await ensure6GenerationCoaHierarchy();

      const admin = await prisma.user.create({
        data: {
          username: `p23_admin_${TEST_TAG}`,
          name: "محاسب ميداني / منشئ",
          fullName: "Phase 23 Requester",
          email: `p23_admin_${TEST_TAG}@test.local`,
          passwordHash: hashPassword("Pass@2026"),
          role: "SUPER_ADMIN",
          department: "المالية",
          active: true,
          isActive: true,
        },
      });
      const reviewer = await prisma.user.create({
        data: {
          username: `p23_chief_${TEST_TAG}`,
          name: "كبير المحاسبين المعتمد",
          fullName: "Phase 23 Reviewer",
          email: `p23_chief_${TEST_TAG}@test.local`,
          passwordHash: hashPassword("Pass@2026"),
          role: "CHIEF_ACCOUNTANT",
          department: "المراجعة",
          active: true,
          isActive: true,
        },
      });
      adminId = admin.id;
      reviewerId = reviewer.id;
      adminToken = issueSessionToken({
        userId: admin.id,
        userRole: "SUPER_ADMIN",
        tenantId: TEST_TENANT,
        userDisplay: admin.fullName,
      });

      const wh = await prisma.warehouse.findFirst({ orderBy: { isDefault: "desc" } });
      if (wh) {
        warehouseId = wh.id;
      } else {
        const createdWh = await prisma.warehouse.create({
          data: { code: "WH-MAIN", nameAr: "المستودع الرئيسي", nameEn: "Main Warehouse", isDefault: true },
        });
        warehouseId = createdWh.id;
      }

      const uom = await prisma.unitOfMeasure.findFirst({ where: { isBaseDefault: true } });
      if (uom) {
        baseUomId = uom.id;
      } else {
        const createdUom = await prisma.unitOfMeasure.create({
          data: { code: "PIECE", nameAr: "حبة", nameEn: "Piece", isBaseDefault: true },
        });
        baseUomId = createdUom.id;
      }

      const ensureLeaf = async (parentCode: string, suffix: string, nameAr: string, type: string) => {
        const p = await prisma.account.findUniqueOrThrow({ where: { code: parentCode } });
        if (p.isPosting && p.isPostable) return p.id;
        const c = await prisma.account.create({
          data: {
            code: `${parentCode}${suffix}`,
            nameAr,
            nameEn: nameAr,
            type,
            level: 6,
            generation: 6,
            isPosting: true,
            isPostable: true,
            parentCode: p.code,
            parentId: p.id,
            parentAccountId: p.id,
          },
        });
        return c.id;
      };
      cashLeafId = await ensureLeaf("111101", "88", "صندوق اختبار 23", "ASSET");
      equityLeafId = await ensureLeaf("311101", "88", "رأس مال اختبار 23", "EQUITY");
    });
  });

  after(async () => {
    await resetTenantClientsForTests();
    const licPath = resolveTenantLicensePath(TEST_TENANT);
    if (fs.existsSync(licPath)) {
      try {
        fs.rmSync(path.dirname(licPath), { recursive: true, force: true });
      } catch {}
    }
    const dbPath = resolveTenantDbFilePath(TEST_TENANT);
    if (dbPath && fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // ignore transient lock
      }
    }
  });

  it("Step 2.1 — Inventory movements post balanced GL, GRN/IR clears on VendorBill, and Sales deduct stock via FIFO with DR COGS / CR Inventory", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantTables();

      await prisma.systemSettings.update({
        where: { id: "default" },
        data: { costingMethod: "FIFO", enforceThreeWayMatch: true },
      });

      const invAssetAcc = await prisma.account.findUniqueOrThrow({ where: { code: "113101" } });
      const cogsAcc = await prisma.account.findUniqueOrThrow({ where: { code: "512201" } });

      const item = await prisma.inventoryItem.create({
        data: {
          sku: `SKU-FIFO-${TEST_TAG}`,
          nameAr: "صنف اختبار FIFO",
          nameEn: "FIFO Test Item",
          baseUnitId: baseUomId,
          defaultWarehouseId: warehouseId,
          purchasePrice: 100,
          retailPrice: 250,
          inventoryAccountId: invAssetAcc.id,
          cogsAccountId: cogsAcc.id,
        },
      });

      // Layer 1 via POST /api/inventory/movements: 10 units @ 100 = 1,000
      const mv1 = await stockMovementPOST(
        makeReq("/api/inventory/movements", "POST", adminToken, {
          itemId: item.id,
          warehouseId,
          movementType: "PURCHASE_IN",
          enteredQty: 10,
          unitCost: 100,
          date: "2026-05-01",
        })
      );
      assert.equal(mv1.status, 201);
      const mv1Json = await mv1.json();
      assert.ok(mv1Json.journalEntry?.id, "Stock movement must post balanced GL journal");

      // Layer 2: 10 units @ 200 = 2,000
      const mv2 = await stockMovementPOST(
        makeReq("/api/inventory/movements", "POST", adminToken, {
          itemId: item.id,
          warehouseId,
          movementType: "PURCHASE_IN",
          enteredQty: 10,
          unitCost: 200,
          date: "2026-05-02",
        })
      );
      assert.equal(mv2.status, 201);

      // Verify 2 FIFO InventoryLot layers exist
      const lotsBeforeSale = await prisma.inventoryLot.findMany({
        where: { itemId: item.id },
        orderBy: { receivedDate: "asc" },
      });
      assert.equal(lotsBeforeSale.length, 2);

      // Sell 15 units @ 300 via postSalesInvoice -> FIFO COGS = (10*100) + (5*200) = 2,000
      const proj = await prisma.project.create({
        data: { code: `PRJ-INV-${TEST_TAG}`, name: "مشروع مخزون", nameAr: "مشروع مخزون", nameEn: "Inv Proj" },
      });
      const cust = await prisma.$transaction((tx) =>
        ensureCustomerWithAccountTx(tx, { name: `عميل مخزون ${TEST_TAG}`, phone: "770000101" })
      );

      const invRes = await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        amount: 4500,
        date: "2026-05-10",
        items: [
          {
            itemId: item.id,
            warehouseId,
            description: "مبيعات صنف FIFO",
            quantity: 15,
            unitPrice: 300,
          },
        ],
        createdById: adminId,
      });

      assert.ok(invRes.cogsJournalEntryId, "Sales invoice must post separate DR COGS / CR Inventory JE");
      const cogsLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: invRes.cogsJournalEntryId! },
      });
      const cogsDebit = cogsLines.find((l) => l.accountId === cogsAcc.id);
      const invCredit = cogsLines.find((l) => l.accountId === invAssetAcc.id);
      assert.equal(Number(cogsDebit?.baseDebit), 2000);
      assert.equal(Number(invCredit?.baseCredit), 2000);

      // Remaining StockBalance = 5 units; Lot 1 = 0, Lot 2 = 5
      const balAfter = await prisma.stockBalance.findUniqueOrThrow({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId } },
      });
      assert.equal(Number(balAfter.qtyOnHandBase), 5);
      const lotsAfter = await prisma.inventoryLot.findMany({
        where: { itemId: item.id },
        orderBy: { receivedDate: "asc" },
      });
      assert.equal(Number(lotsAfter[0].currentQuantity), 0);
      assert.equal(Number(lotsAfter[1].currentQuantity), 5);

      // 2-Step GRN -> VendorBill clears 215101 GRN/IR without double-debiting Inventory
      const vendor = await prisma.$transaction((tx) =>
        createVendorWithAccountTx(tx, { nameAr: `مورد استلام ${TEST_TAG}`, phone: "770000102" })
      );
      const poRes = await poPOST(
        makeReq("/api/procurement/pos", "POST", adminToken, {
          vendorId: vendor.id,
          projectId: proj.id,
          items: [{ description: item.nameAr, unit: "حبة", quantity: 4, unitPrice: 150 }],
        })
      );
      assert.equal(poRes.status, 201);
      const { purchaseOrder: po } = await poRes.json();

      const grnRes = await poPOST(
        makeReq("/api/procurement/pos", "POST", adminToken, {
          action: "CREATE_GRN",
          purchaseOrderId: po.id,
          warehouseId,
          receivedTotal: 600,
          items: [{ itemId: item.id, warehouseId, quantity: 4, unitCost: 150 }],
        })
      );
      assert.equal(grnRes.status, 201);
      const { goodsReceipt: grn } = await grnRes.json();
      assert.ok(grn.journalEntryId);

      const billRes = await billsPOST(
        makeReq("/api/procurement/bills", "POST", adminToken, {
          vendorId: vendor.id,
          projectId: proj.id,
          purchaseOrderId: po.id,
          isInventory: true,
          totalAmount: 600,
          date: "2026-05-11",
        })
      );
      assert.equal(billRes.status, 201);
      const billJson = await billRes.json();
      const billLines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: billJson.journalEntry.id },
        include: { account: true },
      });
      assert.equal(
        billLines.some((l) => l.account.code === "215101" && Number(l.baseDebit) === 600),
        true,
        "VendorBill linked to inventory GRN must clear 215101 GRN/IR Clearing"
      );
    });
  });

  it("Step 2.2 — Approval Workflows hold matching postings & drafts in PENDING_APPROVAL and post GL cleanly upon approval", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantTables();

      await prisma.systemSettings.update({
        where: { id: "default" },
        data: { requireApprovalWorkflow: true },
      });
      await createApprovalRule({
        module: "ACCOUNTING",
        actionType: "GL_POSTING",
        minAmountBase: 0,
        requiredRole: "CHIEF_ACCOUNTANT",
        allowSelfApproval: false,
      });

      // 1) Direct postJournalEntry creates PENDING_APPROVAL JE & ApprovalRequest, excluded from TB until approved
      const pendingJe = await postJournalEntry({
        date: "2026-05-12",
        narrationAr: "قيد ينتظر الاعتماد",
        createdById: adminId,
        lines: [
          { accountId: cashLeafId, debit: 5000 },
          { accountId: equityLeafId, credit: 5000 },
        ],
      });
      assert.equal(pendingJe.status, "PENDING_APPROVAL");

      const reportBefore = await generateFinancialReports({ toDate: "2026-05-31" });
      assert.equal(reportBefore.trialBalance.totalDebits, 0);

      const reqJe = await prisma.approvalRequest.findFirstOrThrow({
        where: { targetType: "JournalEntry", targetId: pendingJe.id, status: "PENDING" },
      });
      await decideApprovalRequest({
        requestId: reqJe.id,
        decision: "APPROVED",
        reviewer: { userId: reviewerId, userName: "Chief Reviewer", userRole: "CHIEF_ACCOUNTANT" },
      });

      const reportAfter = await generateFinancialReports({ toDate: "2026-05-31" });
      assert.equal(reportAfter.trialBalance.totalDebits, 5000);

      // 2) Expenses, Workers, Bills, Invoices, and WorkspaceDraft promotion all route to ApprovalsCenter
      const proj = await prisma.project.create({
        data: { code: `PRJ-APP-${TEST_TAG}`, name: "مشروع اعتماد", nameAr: "مشروع اعتماد", nameEn: "App Proj" },
      });
      await createTreasuryAccount({
        type: "VAULT",
        nameAr: "صندوق الاعتماد",
        currency: "YER",
        openingBalance: 0,
        isDefaultPayments: true,
        isDefaultReceipts: true,
        createdById: adminId,
      });

      const expRes = await expensesPOST(
        makeReq("/api/expenses", "POST", adminToken, {
          projectId: proj.id,
          harvest: "القطفة 1",
          category: "OTHER",
          subType: "صيانة",
          qty: 1,
          unitPrice: 1200,
          date: "2026-05-12",
        })
      );
      assert.equal(expRes.status, 201);
      const expApp = await prisma.approvalRequest.findFirst({
        where: { targetType: "OperatingExpense", status: "PENDING" },
      });
      assert.ok(expApp);

      const wrkRes = await workersPOST(
        makeReq("/api/workers", "POST", adminToken, {
          projectId: proj.id,
          harvest: "القطفة 1",
          name: `عامل اعتماد ${TEST_TAG}`,
          dailyWage: 3000,
          days: 1,
          credit: 0,
          date: "2026-05-12",
        })
      );
      assert.equal(wrkRes.status, 201);
      const wrkApp = await prisma.approvalRequest.findFirst({
        where: { targetType: "WorkerWageEntry", status: "PENDING" },
      });
      assert.ok(wrkApp);

      const draft = await createWorkspaceDraft({
        module: "ACCOUNTING",
        formType: "JOURNAL_VOUCHER",
        titleAr: "مسودة تحتاج اعتماد",
        totalAmount: 900,
        payload: {
          date: "2026-05-13",
          narrationAr: "ترحيل من المسودة للاعتماد",
          lines: [
            { accountId: cashLeafId, debit: 900 },
            { accountId: equityLeafId, credit: 900 },
          ],
        },
        actor: { userId: adminId, userName: "Phase 23 Requester", userRole: "SUPER_ADMIN" },
      });
      const promoted = await promoteWorkspaceDraft(draft.id, {
        userId: adminId,
        userName: "Phase 23 Requester",
        userRole: "SUPER_ADMIN",
      });
      assert.equal(promoted.draft.status, "SUBMITTED_FOR_APPROVAL");
      const draftApp = await prisma.approvalRequest.findFirst({
        where: { targetType: "JournalEntry", targetId: promoted.convertedEntityId!, status: "PENDING" },
      });
      assert.ok(draftApp);
    });
  });

  it("Step 2.3 — Enforces Customer.creditLimit, 3-Way Match tolerances, removes duplicate InstallmentVoucher on sales, supports Credit Notes & Multi-Invoice Allocations", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantTables();

      const proj = await prisma.project.create({
        data: { code: `PRJ-CTL-${TEST_TAG}`, name: "مشروع ضوابط", nameAr: "مشروع ضوابط", nameEn: "Controls Proj" },
      });
      const tr = await createTreasuryAccount({
        type: "VAULT",
        nameAr: "صندوق التحصيل والضوابط",
        currency: "YER",
        openingBalance: 100000,
        isDefaultPayments: true,
        isDefaultReceipts: true,
        createdById: adminId,
      });

      // 1) Customer creditLimit enforcement
      const cust = await prisma.$transaction((tx) =>
        ensureCustomerWithAccountTx(tx, { name: `عميل ائتمان ${TEST_TAG}`, phone: "770000201" })
      );
      await prisma.customer.update({ where: { id: cust.id }, data: { creditLimit: 5000 } });

      const inv1 = await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        amount: 3000,
        date: "2026-05-01",
        dueDate: "2026-05-10",
        createdById: adminId,
      });
      await assert.rejects(
        () =>
          postSalesInvoice({
            customerId: cust.id,
            projectId: proj.id,
            amount: 2500, // 3000 + 2500 = 5500 > 5000 limit
            date: "2026-05-02",
            createdById: adminId,
          }),
        /CREDIT_LIMIT_EXCEEDED/
      );

      // Sales Credit Note reduces original invoice balanceDue -> allowing next sale cleanly
      const cn = await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        invoiceType: "CREDIT_NOTE",
        originalInvoiceId: inv1.invoice.id,
        amount: 1000,
        date: "2026-05-03",
        createdById: adminId,
      });
      assert.equal(cn.invoice.invoiceType, "CREDIT_NOTE");
      const inv1AfterCn = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv1.invoice.id } });
      assert.equal(Number(inv1AfterCn.balanceDue), 2000);

      // Multi-Invoice Customer Receipt Allocation
      const inv2 = await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        amount: 1500,
        date: "2026-05-04",
        createdById: adminId,
      });
      const multiRcp = await postCustomerReceipt({
        customerId: cust.id,
        treasuryId: tr.treasury.id,
        amount: 3500,
        date: "2026-05-05",
        allocations: [
          { invoiceId: inv1.invoice.id, amount: 2000 },
          { invoiceId: inv2.invoice.id, amount: 1500 },
        ],
        createdById: adminId,
      });
      assert.ok(multiRcp.receipt.allocationsJson);
      const inv1Settled = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv1.invoice.id } });
      const inv2Settled = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv2.invoice.id } });
      assert.equal(inv1Settled.status, "PAID");
      assert.equal(inv2Settled.status, "PAID");

      // 2) POST /api/sales creates ReceiptVoucher WITHOUT duplicate InstallmentVoucher
      const saleRes = await salesPOST(
        makeReq("/api/sales", "POST", adminToken, {
          projectId: proj.id,
          harvest: "القطفة 1",
          customer: `عميل فوري ${TEST_TAG}`,
          bundles: 2,
          price: 1000,
          credit: 2000,
          date: "2026-05-06",
          treasuryAccountId: tr.treasury.id,
        })
      );
      assert.equal(saleRes.status, 201);
      const dupInstCount = await prisma.installmentVoucher.count();
      assert.equal(dupInstCount, 0, "POST /api/sales must NOT double-create InstallmentVoucher alongside ReceiptVoucher");

      // 3) 3-Way Match Enforcement on PO -> GRN -> VendorBill + Multi-Bill Payment Allocation
      const vendor = await prisma.$transaction((tx) =>
        createVendorWithAccountTx(tx, { nameAr: `مورد مطابقة ${TEST_TAG}`, phone: "770000202" })
      );
      const poRes = await poPOST(
        makeReq("/api/procurement/pos", "POST", adminToken, {
          vendorId: vendor.id,
          projectId: proj.id,
          items: [{ description: "مستلزمات", unit: "حبة", quantity: 10, unitPrice: 100 }],
        })
      );
      const { purchaseOrder: po } = await poRes.json();

      // Missing GRN -> blocked
      const billNoGrn = await billsPOST(
        makeReq("/api/procurement/bills", "POST", adminToken, {
          vendorId: vendor.id,
          projectId: proj.id,
          purchaseOrderId: po.id,
          totalAmount: 1000,
        })
      );
      assert.equal(billNoGrn.status, 400);

      // Add GRN for 1000
      await poPOST(
        makeReq("/api/procurement/pos", "POST", adminToken, {
          action: "CREATE_GRN",
          purchaseOrderId: po.id,
          receivedTotal: 1000,
        })
      );

      // Bill variance > tolerance (1200 vs 1000) -> blocked
      const billOver = await billsPOST(
        makeReq("/api/procurement/bills", "POST", adminToken, {
          vendorId: vendor.id,
          projectId: proj.id,
          purchaseOrderId: po.id,
          totalAmount: 1200,
        })
      );
      assert.equal(billOver.status, 400);

      // Matched Bill + Purchase Credit Note + Multi-Bill Payment
      const b1 = await postVendorBill({
        vendorId: vendor.id,
        projectId: proj.id,
        purchaseOrderId: po.id,
        totalAmount: 1000,
        date: "2026-05-07",
        createdById: adminId,
      });
      const b2 = await postVendorBill({
        vendorId: vendor.id,
        projectId: proj.id,
        totalAmount: 500,
        date: "2026-05-08",
        createdById: adminId,
      });
      await postVendorPayment({
        vendorId: vendor.id,
        treasuryId: tr.treasury.id,
        amount: 1500,
        date: "2026-05-09",
        allocations: [
          { billId: b1.bill.id, amount: 1000 },
          { billId: b2.bill.id, amount: 500 },
        ],
        createdById: adminId,
      });
      const b1Paid = await prisma.vendorBill.findUniqueOrThrow({ where: { id: b1.bill.id } });
      const b2Paid = await prisma.vendorBill.findUniqueOrThrow({ where: { id: b2.bill.id } });
      assert.equal(b1Paid.status, "PAID");
      assert.equal(b2Paid.status, "PAID");
    });
  });

  it("Step 2.4 — Monthly AccountingPeriod enforces OPEN / SOFT_CLOSED / HARD_CLOSED locks & close checklists", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantTables();

      const genRes = await periodsGET(
        makeReq("/api/accounting/periods?year=2026", "GET", adminToken)
      );
      assert.equal(genRes.status, 200);
      const { periods } = (await genRes.json()) as { periods: Array<{ id: string; code: string }> };
      assert.equal(periods.length, 12);
      const mayPeriod = periods.find((p) => p.code === "2026-05")!;

      // Soft-close May 2026 -> normal entry rejected, adjustment override permitted
      const softRes = await periodsPOST(
        makeReq("/api/accounting/periods", "POST", adminToken, {
          action: "SET_STATUS",
          periodId: mayPeriod.id,
          status: "SOFT_CLOSED",
        })
      );
      assert.equal(softRes.status, 200);

      await assert.rejects(
        () =>
          postJournalEntry({
            date: "2026-05-15",
            narrationAr: "قيد عادي في شهر مقفل مؤقتاً",
            createdById: adminId,
            lines: [
              { accountId: cashLeafId, debit: 100 },
              { accountId: equityLeafId, credit: 100 },
            ],
          }),
        /PERIOD_SOFT_CLOSED/
      );

      const adjJe = await postJournalEntry({
        date: "2026-05-15",
        narrationAr: "قيد تسوية مسموح في Soft Close",
        allowLockedAdjustment: true,
        entryType: "ADJUSTMENT",
        createdById: adminId,
        lines: [
          { accountId: cashLeafId, debit: 100 },
          { accountId: equityLeafId, credit: 100 },
        ],
      });
      assert.equal(adjJe.status, "POSTED");

      // Hard-close May 2026 -> even adjustments blocked!
      const hardRes = await periodsPOST(
        makeReq("/api/accounting/periods", "POST", adminToken, {
          action: "SET_STATUS",
          periodId: mayPeriod.id,
          status: "HARD_CLOSED",
        })
      );
      assert.equal(hardRes.status, 200);

      await assert.rejects(
        () =>
          postJournalEntry({
            date: "2026-05-16",
            narrationAr: "محاولة قيد في Hard Close",
            allowLockedAdjustment: true,
            createdById: adminId,
            lines: [
              { accountId: cashLeafId, debit: 100 },
              { accountId: equityLeafId, credit: 100 },
            ],
          }),
        /PERIOD_HARD_CLOSED/
      );

      const checklistRes = await periodsGET(
        makeReq(`/api/accounting/periods?checklistId=${mayPeriod.id}`, "GET", adminToken)
      );
      assert.equal(checklistRes.status, 200);
      const clJson = await checklistRes.json();
      assert.equal(clJson.checks.trialBalanceBalanced, true);
    });
  });

  it("Step 3.2 & Step 3.1 — VAT/WHT calculation & GL split, Tax Summary, Cash Flow (IAS 7), Equity Changes, Aging, Statements, Ratios, Comparatives & Drill-Down", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      await resetTenantTables();

      // Seed default TaxCodes via GET /api/accounting/taxes
      const taxListRes = await taxesGET(
        makeReq("/api/accounting/taxes", "GET", adminToken)
      );
      assert.equal(taxListRes.status, 200);
      const { taxCodes } = await taxListRes.json();
      assert.ok(taxCodes.some((t: { code: string }) => t.code === "VAT15"));
      assert.ok(taxCodes.some((t: { code: string }) => t.code === "WHT2"));

      const proj = await prisma.project.create({
        data: { code: `PRJ-FIN-${TEST_TAG}`, name: "مشروع تقارير 3", nameAr: "مشروع تقارير 3", nameEn: "Reports P3" },
      });
      const tr = await createTreasuryAccount({
        type: "VAULT",
        nameAr: "صندوق التقارير الشاملة",
        currency: "YER",
        openingBalance: 0,
        isDefaultPayments: true,
        isDefaultReceipts: true,
        createdById: adminId,
      });
      await prisma.treasuryAccount.update({
        where: { id: tr.treasury.id },
        data: { balance: 50000, balanceYER: 50000 },
      });
      await postJournalEntry({
        date: "2026-01-01",
        narrationAr: "رصيد افتتاحي لصندوق التقارير",
        createdById: adminId,
        lines: [
          { accountId: tr.treasury.accountId, debit: 50000 },
          { accountId: equityLeafId, credit: 50000 },
        ],
      });
      const cust = await prisma.$transaction((tx) =>
        ensureCustomerWithAccountTx(tx, { name: `عميل ضرائب ${TEST_TAG}`, phone: "770000301" })
      );
      const vendor = await prisma.$transaction((tx) =>
        createVendorWithAccountTx(tx, { nameAr: `مورد ضرائب ${TEST_TAG}`, phone: "770000302" })
      );

      // Q1 invoice in comparative window
      await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        amount: 5000,
        date: "2026-02-15",
        dueDate: "2026-03-01",
        createdById: adminId,
      });

      // Q2 Sales Invoice with VAT15 (10,000 net + 1,500 VAT = 11,500 gross)
      const invVat = await postSalesInvoice({
        customerId: cust.id,
        projectId: proj.id,
        amount: 10000,
        taxCodeId: "VAT15",
        date: "2026-05-10",
        dueDate: "2026-05-15",
        createdById: adminId,
      });
      assert.equal(Number(invVat.invoice.taxAmount), 1500);
      assert.equal(Number(invVat.invoice.totalAmount), 11500);

      // Partial collection 5,000
      await postCustomerReceipt({
        customerId: cust.id,
        invoiceId: invVat.invoice.id,
        treasuryId: tr.treasury.id,
        amount: 5000,
        date: "2026-05-18",
        createdById: adminId,
      });

      // Vendor Bill with VAT15 + WHT2 (4,000 net + 600 Input VAT - 80 WHT = 4,520 net payable)
      const billVat = await postVendorBill({
        vendorId: vendor.id,
        projectId: proj.id,
        totalAmount: 4000,
        taxCodeId: "VAT15",
        whtCodeId: "WHT2",
        date: "2026-05-12",
        dueDate: "2026-05-20",
        createdById: adminId,
      });
      assert.equal(Number(billVat.bill.taxAmount), 600);
      assert.equal(Number(billVat.bill.whtAmount), 80);
      assert.equal(Number(billVat.bill.totalAmount), 4520);

      // Check Tax Summary Report (1500 Output VAT - 600 Input VAT = 900 Net VAT Payable; WHT = 80)
      const taxSumRes = await taxSummaryGET(
        makeReq("/api/accounting/reports/tax-summary?fromDate=2026-05-01&toDate=2026-05-31", "GET", adminToken)
      );
      assert.equal(taxSumRes.status, 200);
      const taxSum = await taxSumRes.json();
      assert.equal(taxSum.outputVat, 1500);
      assert.equal(taxSum.inputVat, 600);
      assert.equal(taxSum.netVatPayable, 900);
      assert.equal(taxSum.whtPayable, 80);

      // Cash Flow Statement (IAS 7) reconciled to Balance Sheet Cash
      const cfRes = await cashFlowGET(
        makeReq("/api/accounting/reports/cash-flow?fromDate=2026-05-01&toDate=2026-05-31", "GET", adminToken)
      );
      assert.equal(cfRes.status, 200);
      const cf = await cfRes.json();
      assert.equal(cf.reconciliation.openingCashBalance, 50000);
      assert.equal(cf.reconciliation.closingCashBalance, 55000); // 50k Jan opening + 5k May receipt
      assert.equal(cf.reconciliation.actualCashChange, 5000);
      assert.equal(cf.directMethod.cashReceiptsFromCustomers, 5000);

      // Changes in Equity
      const eqRes = await equityGET(
        makeReq("/api/accounting/reports/changes-in-equity?fromDate=2026-05-01&toDate=2026-05-31", "GET", adminToken)
      );
      assert.equal(eqRes.status, 200);
      const eqJson = await eqRes.json();
      assert.ok(eqJson.closingEquity > 0);

      // AR & AP Aging
      const arAgingRes = await agingGET(
        makeReq("/api/accounting/reports/aging?type=AR&asOfDate=2026-06-30", "GET", adminToken)
      );
      assert.equal(arAgingRes.status, 200);
      const arAging = await arAgingRes.json();
      assert.equal(arAging.totals.totalOpen, 11500); // Q1 5,000 + Q2 remaining 6,500

      const apAgingRes = await agingGET(
        makeReq("/api/accounting/reports/aging?type=AP&asOfDate=2026-06-30", "GET", adminToken)
      );
      assert.equal(apAgingRes.status, 200);
      const apAging = await apAgingRes.json();
      assert.equal(apAging.totals.totalOpen, 4520);

      // Customer & Account GL Statements
      const custStmtRes = await statementsGET(
        makeReq(`/api/accounting/reports/statements?entityType=CUSTOMER&entityId=${cust.id}`, "GET", adminToken)
      );
      assert.equal(custStmtRes.status, 200);
      const custStmt = await custStmtRes.json();
      assert.equal(custStmt.closingBalance, 11500);

      // Financial Ratios
      const ratRes = await ratiosGET(
        makeReq("/api/accounting/reports/ratios?fromDate=2026-01-01&toDate=2026-05-31", "GET", adminToken)
      );
      assert.equal(ratRes.status, 200);
      const rat = await ratRes.json();
      assert.ok(rat.liquidity.currentRatio > 0);

      // Comparative Income Statement (May vs Feb)
      const cmpPlRes = await incomeStmtGET(
        makeReq(
          "/api/accounting/reports/income-statement?fromDate=2026-05-01&toDate=2026-05-31&compareFromDate=2026-02-01&compareToDate=2026-02-28",
          "GET",
          adminToken
        )
      );
      assert.equal(cmpPlRes.status, 200);
      const cmpPl = await cmpPlRes.json();
      assert.equal(cmpPl.totalRevenue, 10000);
      assert.equal(cmpPl.comparative.totalRevenue, 5000);

      // Click-Through Account Drill-Down (214101 Output VAT)
      const ddRes = await drilldownGET(
        makeReq("/api/accounting/reports/drilldown?accountCode=214101", "GET", adminToken)
      );
      assert.equal(ddRes.status, 200);
      const dd = await ddRes.json();
      assert.equal(dd.lines.length, 1);
      assert.equal(dd.lines[0].creditBase, 1500);
    });
  });
});

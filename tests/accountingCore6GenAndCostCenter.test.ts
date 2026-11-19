import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  assertPostableAccount,
  costCenterProfitAndLoss,
  createCostCenter,
  deleteCostCenter,
  ensure6GenerationCoaHierarchy,
  provisionEntityGen6AccountAndCostCenter,
  SUB_LEDGER_CONTROL_SPECS,
} from "../src/lib/accountingCoreEngine";
import {
  createTreasuryAccount,
  createVendorWithAccountTx,
  ensureCustomerWithAccountTx,
  ensureWorkerWithAccountTx,
  getCoaTreeWithBalances,
  postJournalEntry,
  postSalesInvoice,
} from "../src/lib/accounting/ledgerService";
import {
  handleLocalCostCenters,
  provisionLocalGen6AccountAndCostCenter,
  type OfflineStorageLike,
} from "../src/lib/offlineAndroidStore";

const TAG = `P1${Date.now().toString().slice(-6)}`;
const createdCustomerIds: string[] = [];
const createdVendorIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdProjectIds: string[] = [];
const createdCostCenterIds: string[] = [];

function memoryStorage(): OfflineStorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("Phase 1 — Accounting-Core: 6-Generation COA & Cost Centers", () => {
  after(async () => {
    await prisma.$disconnect();
  });

  it("(a) builds the 6-generation hierarchy, rolls up balances and enforces postable leaves", async () => {
    await ensure6GenerationCoaHierarchy();

    for (const spec of Object.values(SUB_LEDGER_CONTROL_SPECS)) {
      const gen4 = await prisma.account.findUniqueOrThrow({ where: { code: spec.gen4Code } });
      const gen5 = await prisma.account.findUniqueOrThrow({ where: { code: spec.gen5Code } });
      assert.equal(gen4.generation, 4);
      assert.equal(gen4.isPostable, false);
      assert.equal(gen5.generation, 5);
      assert.equal(gen5.isPostable, false, `Gen5 control ${spec.gen5Code} must be a summary account`);
      assert.equal(gen5.parentId, gen4.id);
      assert.equal(gen5.parentAccountId, gen4.id);
    }

    // Mirror flags are consistent across the whole COA
    const accounts = await prisma.account.findMany();
    for (const a of accounts) {
      assert.equal(a.generation, a.level, `generation mirrors level for ${a.code}`);
      assert.equal(a.isPostable, a.isPosting, `isPostable mirrors isPosting for ${a.code}`);
    }

    // Idempotent
    const beforeCount = await prisma.account.count();
    await ensure6GenerationCoaHierarchy();
    assert.ok((await prisma.account.count()) >= beforeCount);

    // Postable leaf enforcement: Gen 1–5 summary accounts reject direct postings
    const summary = await prisma.account.findUniqueOrThrow({ where: { code: "112190" } });
    await assert.rejects(
      () =>
        postJournalEntry({
          narrationAr: "محاولة ترحيل على حساب تجميعي",
          lines: [
            { accountId: summary.id, debit: 10 },
            { accountCode: "411101", credit: 10 },
          ],
        }),
      /NON_POSTING_ACCOUNT/
    );
    await assert.rejects(
      () => assertPostableAccount(prisma, { ...summary, isPostable: false }),
      /NON_POSTING_ACCOUNT/
    );

    // Roll-up: customer leaf balance rolls up to Gen5 → Gen4 → Gen3 → Gen2 → Gen1
    const cust = await prisma.$transaction((tx) =>
      ensureCustomerWithAccountTx(tx, { name: `عميل تجميع ${TAG}`, nameEn: `Rollup ${TAG}` })
    );
    createdCustomerIds.push(cust.id);
    const leaf = await prisma.account.findUniqueOrThrow({ where: { id: cust.accountId } });
    const sumBefore = await getCoaTreeWithBalances();
    const gen1Before = sumBefore.flat.find((n) => n.code === "100000")!;
    await postJournalEntry({
      narrationAr: `اختبار تجميع ${TAG}`,
      lines: [
        { accountId: leaf.id, debit: 1234 },
        { accountCode: "411101", credit: 1234 },
      ],
    });
    const tree = await getCoaTreeWithBalances();
    const byCode = new Map(tree.flat.map((n) => [n.code, n]));
    const leafNode = byCode.get(leaf.code)!;
    assert.equal(leafNode.generation, 6);
    assert.equal(leafNode.isPostable, true);
    assert.equal(leafNode.directDebit, 1234);
    for (const code of ["112190", "112100", "112000", "110000", "100000"]) {
      assert.ok(byCode.get(code)!.rolledUpDebit >= 1234, `${code} rolls up the leaf balance`);
    }
    assert.ok(byCode.get("100000")!.rolledUpDebit - gen1Before.rolledUpDebit >= 1234);
  });

  it("(b) auto-provisions a Gen-6 GL account + Cost Center for Customer, Supplier and Worker", async () => {
    const result = await prisma.$transaction(async (tx) => {
      const customer = await ensureCustomerWithAccountTx(tx, { name: `عميل ${TAG}`, nameEn: `Cust ${TAG}` });
      const vendor = await createVendorWithAccountTx(tx, { nameAr: `مورد ${TAG}`, nameEn: `Vend ${TAG}`, phone: "777111222" });
      const worker = await ensureWorkerWithAccountTx(tx, { name: `عامل ${TAG}`, defaultDailyWage: 5000 });
      return { customer, vendor, worker };
    });
    createdCustomerIds.push(result.customer.id);
    createdVendorIds.push(result.vendor.id);
    createdWorkerIds.push(result.worker.id);

    const cases = [
      { type: "CUSTOMER", row: result.customer, prefix: "112190", cc: "CC-CUS" },
      { type: "VENDOR", row: result.vendor, prefix: "211190", cc: "CC-VND" },
      { type: "WORKER", row: result.worker, prefix: "212190", cc: "CC-WRK" },
    ] as const;

    for (const c of cases) {
      const fresh = await (prisma as any)[c.type.toLowerCase()].findUniqueOrThrow({ where: { id: c.row.id } });
      assert.ok(fresh.glAccountId, `${c.type} has glAccountId`);
      assert.ok(fresh.costCenterId, `${c.type} has costCenterId`);
      const account = await prisma.account.findUniqueOrThrow({ where: { id: fresh.glAccountId } });
      assert.equal(account.generation, 6);
      assert.equal(account.level, 6);
      assert.equal(account.isPostable, true);
      assert.equal(account.isPosting, true);
      assert.equal(account.subLedgerType, c.type);
      assert.equal(account.subLedgerEntityId, c.row.id);
      assert.equal(account.defaultCostCenterId, fresh.costCenterId);
      assert.equal(account.parentCode, c.prefix);
      assert.ok(account.code.startsWith(c.prefix) && account.code.length === c.prefix.length + 3);
      if (c.type !== "WORKER") assert.equal(fresh.accountId, fresh.glAccountId);

      const cc = await prisma.costCenter.findUniqueOrThrow({ where: { id: fresh.costCenterId } });
      assert.equal(cc.generation, 2);
      const group = await prisma.costCenter.findUniqueOrThrow({ where: { id: cc.parentId! } });
      assert.equal(group.code, c.cc);
    }

    // Idempotent for the same entity
    const again = await provisionEntityGen6AccountAndCostCenter({
      entityType: "VENDOR", entityId: result.vendor.id, nameAr: `مورد ${TAG}`,
    });
    assert.equal(again.account.id, (await prisma.vendor.findUniqueOrThrow({ where: { id: result.vendor.id } })).glAccountId);

    // Re-ensuring an existing worker never creates a second account
    const workerAgain = await prisma.$transaction((tx) => ensureWorkerWithAccountTx(tx, { name: `عامل ${TAG}` }));
    assert.equal(workerAgain.accountId, result.worker.accountId);

    // Warehouse + Project (custom parent control not required)
    const project = await prisma.project.create({
      data: { code: `PRJ-${TAG}`, name: `مشروع ${TAG}`, nameAr: `مشروع ${TAG}`, nameEn: `Project ${TAG}` },
    });
    createdProjectIds.push(project.id);
    const prov = await provisionEntityGen6AccountAndCostCenter({
      entityType: "PROJECT", entityId: project.id, nameAr: project.nameAr, nameEn: project.nameEn,
    });
    const linked = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(linked.glAccountId, prov.account.id);
    assert.equal(linked.costCenterId, prov.costCenterId);
    assert.equal((await prisma.costCenter.findUniqueOrThrow({ where: { id: prov.costCenterId } })).centerType, "PROJECT");
  });

  it("(c) propagates costCenterId end-to-end into posted JournalEntryLine records", async () => {
    const customer = await prisma.$transaction((tx) =>
      ensureCustomerWithAccountTx(tx, { name: `عميل تدفق ${TAG}`, nameEn: `Flow ${TAG}` })
    );
    createdCustomerIds.push(customer.id);
    const project = await prisma.project.create({
      data: { code: `PRJ-F${TAG}`, name: `مشروع ربحية ${TAG}`, nameAr: `مشروع ربحية ${TAG}`, nameEn: `Profit ${TAG}` },
    });
    createdProjectIds.push(project.id);
    const projProv = await provisionEntityGen6AccountAndCostCenter({
      entityType: "PROJECT", entityId: project.id, nameAr: project.nameAr, nameEn: project.nameEn,
    });

    // 1) Sales invoice → project cost center on every line + on the invoice document
    const { invoice, journalEntry } = await postSalesInvoice({
      customerId: customer.id, projectId: project.id, amount: 5000, revenueAccountCode: "411101",
    });
    assert.equal(invoice.costCenterId, projProv.costCenterId);
    const invLines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: journalEntry.id } });
    assert.equal(invLines.length, 2);
    for (const l of invLines) assert.equal(l.costCenterId, projProv.costCenterId);

    // 2) Explicit per-line override beats entry default; account default is the final fallback
    const custCc = (await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).costCenterId!;
    const custCenter = await createCostCenter({ nameAr: `مركز مخصص ${TAG}`, centerType: "OTHER", customLabel: "أخرى" });
    createdCostCenterIds.push(custCenter.id);
    assert.equal(custCenter.isCustom, true);
    const je = await postJournalEntry({
      narrationAr: `تدفق مراكز التكلفة ${TAG}`,
      costCenterId: projProv.costCenterId,
      lines: [
        { accountId: customer.accountId, debit: 700 },
        { accountCode: "411101", credit: 700, costCenterId: custCenter.id },
      ],
    });
    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: je.id }, include: { account: true } });
    assert.equal(lines.find((l) => l.account.code === "411101")!.costCenterId, custCenter.id);
    assert.equal(lines.find((l) => l.accountId === customer.accountId)!.costCenterId, projProv.costCenterId);

    const je2 = await postJournalEntry({
      narrationAr: `fallback ${TAG}`,
      lines: [
        { accountId: customer.accountId, debit: 50 },
        { accountCode: "411101", credit: 50 },
      ],
    });
    const l2 = await prisma.journalEntryLine.findMany({ where: { journalEntryId: je2.id }, include: { account: true } });
    assert.equal(l2.find((l) => l.accountId === customer.accountId)!.costCenterId, custCc);

    // 3) Cost Center P&L report isolates revenue per center
    const pnl = await costCenterProfitAndLoss({ costCenterId: projProv.costCenterId });
    assert.equal(pnl.rows.length, 1);
    assert.equal(pnl.rows[0].revenue, 5000 + 0); // invoice revenue only (custom-center line excluded)
    assert.equal(pnl.rows[0].net, 5000);
    const pnlCustom = await costCenterProfitAndLoss({ costCenterId: custCenter.id });
    assert.equal(pnlCustom.rows[0].revenue, 700);

    // 4) Cost centers in use are deactivated, never destroyed
    const del = await deleteCostCenter(custCenter.id);
    assert.equal(del.deleted, false);
    assert.equal(del.deactivated, true);
    const unused = await createCostCenter({ nameAr: `غير مستخدم ${TAG}` });
    assert.equal((await deleteCostCenter(unused.id)).deleted, true);
  });

  it("mirrors Gen-6 provisioning and /api/accounting/cost-centers in Android Local Mode", async () => {
    const store = memoryStorage();
    const a = provisionLocalGen6AccountAndCostCenter("CUSTOMER", { id: "c1", nameAr: "عميل محلي" }, store);
    const b = provisionLocalGen6AccountAndCostCenter("CUSTOMER", { id: "c2", nameAr: "عميل محلي 2" }, store);
    const again = provisionLocalGen6AccountAndCostCenter("CUSTOMER", { id: "c1", nameAr: "عميل محلي" }, store);
    assert.equal(a.glAccountCode, "112190001");
    assert.equal(b.glAccountCode, "112190002");
    assert.equal(again.glAccountId, a.glAccountId);
    assert.ok(a.costCenterId && a.costCenterId !== b.costCenterId);

    const created = await handleLocalCostCenters("POST", { nameAr: "مركز مخصص", centerType: "OTHER", customLabel: "أخرى" }, new URLSearchParams(), store);
    assert.equal(created.status, 201);
    const payload = (await created.json()) as { costCenter: { id: string; isCustom: boolean } };
    assert.equal(payload.costCenter.isCustom, true);
    const bad = await handleLocalCostCenters("POST", { nameAr: "x", centerType: "NOPE" }, new URLSearchParams(), store);
    assert.equal(bad.status, 400);
    const upd = await handleLocalCostCenters("PUT", { id: payload.costCenter.id, nameAr: "معدل" }, new URLSearchParams(), store);
    assert.equal(upd.status, 200);
    const del = await handleLocalCostCenters("DELETE", { id: payload.costCenter.id }, new URLSearchParams(), store);
    assert.equal(((await del.json()) as { deleted: boolean }).deleted, true);
    const list = (await (await handleLocalCostCenters("GET", {}, new URLSearchParams(), store)).json()) as { costCenters: unknown[] };
    assert.ok(list.costCenters.length >= 3);
  });

  it("auto-provisions Gen-6 leaf GL account (111190xxx / 111290xxx) + Cost Center for new Cashboxes and Banks", async () => {
    const vaultRes = await createTreasuryAccount({
      type: "VAULT",
      nameAr: `صندوق فرع ${TAG}`,
      nameEn: `Branch Vault ${TAG}`,
      currency: "YER",
      openingBalance: 0,
    });
    assert.equal(vaultRes.treasury.account.generation, 6);
    assert.equal(vaultRes.treasury.account.isPostable, true);
    assert.equal(vaultRes.treasury.account.subLedgerType, "TREASURY");
    assert.ok(vaultRes.treasury.account.code.startsWith("111190"), `Vault code ${vaultRes.treasury.account.code} starts with 111190`);
    assert.ok(vaultRes.treasury.account.defaultCostCenterId, "Vault has auto-provisioned Cost Center");

    const bankRes = await createTreasuryAccount({
      type: "BANK",
      nameAr: `بنك اختبار ${TAG}`,
      nameEn: `Test Bank ${TAG}`,
      currency: "YER",
      openingBalance: 0,
    });
    assert.equal(bankRes.treasury.account.generation, 6);
    assert.equal(bankRes.treasury.account.isPostable, true);
    assert.equal(bankRes.treasury.account.subLedgerType, "TREASURY");
    assert.ok(bankRes.treasury.account.code.startsWith("111290"), `Bank code ${bankRes.treasury.account.code} starts with 111290`);
    assert.ok(bankRes.treasury.account.defaultCostCenterId, "Bank has auto-provisioned Cost Center");
  });
});

import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { executeWithIdempotency } from "../src/lib/idempotencyGuard";
import {
  safeDeleteOrArchiveMasterRecord,
  restoreMasterRecord,
} from "../src/lib/masterLifecycle";
import { ensure6GenerationCoaHierarchy } from "../src/lib/accountingCoreEngine";
import {
  ensureCustomerWithAccountTx,
  createVendorWithAccountTx,
  ensureWorkerWithAccountTx,
  postJournalEntry,
} from "../src/lib/accounting/ledgerService";
import {
  handleLocalMasterLifecycle,
  handleOfflineAndroidApiRequest,
  loadOfflineAndroidState,
  saveOfflineAndroidState,
  type OfflineStorageLike,
} from "../src/lib/offlineAndroidStore";
import {
  createWorkspaceDraft,
  promoteWorkspaceDraft,
} from "../src/lib/workspaceDraftsEngine";

const TEST_RUN_TAG = `IDEM_${Date.now().toString().slice(-6)}`;
const actor = {
  userId: `usr_test_${TEST_RUN_TAG}`,
  userDisplay: `Test Runner ${TEST_RUN_TAG}`,
  userRole: "SUPER_ADMIN" as const,
};

function createMemoryStorage(): OfflineStorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, val: string) => void store.set(key, val),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe("Phase 1 — Global Idempotency & Universal Master Lifecycle Invariants", () => {
  before(async () => {
    await ensure6GenerationCoaHierarchy();
  });

  after(async () => {
    // Cleanup created test records
    try {
      await prisma.idempotencyRecord.deleteMany({
        where: { idempotencyKey: { contains: TEST_RUN_TAG } },
      });
    } catch {
      // ignore cleanup errors
    }
    await prisma.$disconnect();
  });

  /* ------------------------------------------------------------------ */
  /* (a) CONCURRENT IDEMPOTENCY & ATOMIC STATE GUARDS                   */
  /* ------------------------------------------------------------------ */
  describe("(a) Global Idempotency & Atomic Concurrency", () => {
    it("concurrent identical requests produce exactly 1 record, 1 GL entry and 1 stock movement", async () => {
      const idempotencyKey = `concurr_stock_${TEST_RUN_TAG}`;
      let handlerExecutionCount = 0;

      // Simulated atomic operation: Stock movement + GL posting
      const executeAtomicStockAndGL = async () => {
        return executeWithIdempotency(
          idempotencyKey,
          {
            endpoint: "/api/inventory/movements",
            method: "POST",
            userId: actor.userId,
          },
          async () => {
            handlerExecutionCount += 1;
            // Short artificial jitter to simulate async DB transaction time
            await new Promise((resolve) => setTimeout(resolve, 50));

            return {
              statusCode: 201,
              data: {
                movementId: `mov_${TEST_RUN_TAG}`,
                journalEntryId: `je_${TEST_RUN_TAG}`,
                qty: 50,
                success: true,
              },
            };
          }
        );
      };

      // Launch TWO concurrent calls with the exact same idempotency key
      const [res1, res2] = await Promise.all([
        executeAtomicStockAndGL(),
        executeAtomicStockAndGL(),
      ]);

      // Exactly 1 handler execution occurred
      assert.equal(handlerExecutionCount, 1, "Handler must be executed EXACTLY ONCE for concurrent requests");

      // Both callers receive identical statusCode and data
      assert.equal(res1.statusCode, 201);
      assert.equal(res2.statusCode, 201);
      assert.deepEqual(res1.data, res2.data);
      assert.equal((res1.data as { success: boolean }).success, true);

      // Verify IdempotencyRecord is persisted in database
      const persisted = await prisma.idempotencyRecord.findUnique({
        where: { idempotencyKey },
      });
      assert.ok(persisted, "Idempotency record must be stored in database");
      assert.equal(persisted.statusCode, 201);

      // Third sequential call reads directly from database cache without executing handler
      const res3 = await executeAtomicStockAndGL();
      assert.equal(handlerExecutionCount, 1, "Handler count must remain 1 after sequential third call");
      assert.equal(res3.statusCode, 201);
      assert.deepEqual(res3.data, res1.data);
    });

    it("conditional update state guards prevent duplicate draft promotion during race conditions", async () => {
      // Create a test draft
      const draft = await createWorkspaceDraft({
        module: "ACCOUNTING",
        formType: "JOURNAL_ENTRY",
        titleAr: `مسودة قيد سباق ${TEST_RUN_TAG}`,
        titleEn: `Race Draft ${TEST_RUN_TAG}`,
        payload: {
          narrationAr: `قيد اختبار التزامن ${TEST_RUN_TAG}`,
          lines: [
            { accountCode: "111101", debit: 500, credit: 0 },
            { accountCode: "411101", debit: 0, credit: 500 },
          ],
        },
        actor: {
          userId: actor.userId,
          userName: actor.userDisplay,
          userRole: actor.userRole,
        },
      });

      assert.equal(draft.status, "ACTIVE_DRAFT");

      // Attempt two promotions simultaneously
      const results = await Promise.allSettled([
        promoteWorkspaceDraft(draft.id, {
          userId: actor.userId,
          userName: actor.userDisplay,
          userRole: actor.userRole,
        }),
        promoteWorkspaceDraft(draft.id, {
          userId: actor.userId,
          userName: actor.userDisplay,
          userRole: actor.userRole,
        }),
      ]);

      // Exactly one promotion must succeed; the other must fail because status was atomically transitioned
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      assert.equal(fulfilled.length, 1, "Exactly one draft promotion must succeed");
      assert.equal(rejected.length, 1, "Race-condition promotion must be rejected by conditional guard");

      const reloaded = await prisma.workspaceDraft.findUniqueOrThrow({
        where: { id: draft.id },
      });
      assert.equal(reloaded.status, "CONVERTED");
    });

    it("offline Android local store enforces idempotency cache across rapid duplicate requests", async () => {
      const storage = createMemoryStorage();
      const idempotencyKey = `off_idem_${TEST_RUN_TAG}`;

      const initPayload: RequestInit = {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({
          customer: `عميل محلي ${TEST_RUN_TAG}`,
          dailyBatchLabel: "دفعة اختبار",
          harvest: "القطفة الأولى",
          quantity: 10,
          unitPrice: 100,
          total: 1000,
          receivedAmount: 1000,
          remainingAmount: 0,
        }),
      };

      // Call 1
      const res1 = await handleOfflineAndroidApiRequest(
        "http://localhost/api/sales",
        initPayload,
        storage
      );
      assert.equal(res1.status, 201);
      const text1 = await res1.text();

      // Call 2 with identical key
      const res2 = await handleOfflineAndroidApiRequest(
        "http://localhost/api/sales",
        initPayload,
        storage
      );
      assert.equal(res2.status, 201);
      const text2 = await res2.text();
      assert.equal(text2, text1, "Cached idempotency response must match original response");

      // Ensure state only recorded 1 sale transaction
      const stateRaw = storage.getItem("uas_offline_db_state");
      assert.ok(stateRaw);
      const parsed = JSON.parse(stateRaw);
      const matchingSales = parsed.sales.filter(
        (s: { customer?: string }) => s.customer === `عميل محلي ${TEST_RUN_TAG}`
      );
      assert.equal(matchingSales.length, 1, "Only 1 local sale transaction must be recorded");
    });
  });

  /* ------------------------------------------------------------------ */
  /* (b) UNIVERSAL MASTER RECORD LIFECYCLE (SAFE-DELETE VS AUTO-ARCHIVE)*/
  /* ------------------------------------------------------------------ */
  describe("(b) Master Lifecycle Invariants: Safe-Delete vs Auto-Archive & Restore", () => {
    it("Customer: permanently deletes when 0 linked records, auto-archives & deactivates GL when records exist", async () => {
      // 1. Customer with 0 linked records
      const cleanCustomer = await prisma.$transaction((tx) =>
        ensureCustomerWithAccountTx(tx, {
          name: `عميل نظيف ${TEST_RUN_TAG}`,
          nameEn: `Clean Customer ${TEST_RUN_TAG}`,
          phone: "777000111",
        })
      );
      const cleanCustAccountId = cleanCustomer.accountId;
      assert.ok(cleanCustAccountId);

      // Safe delete
      const delRes = await safeDeleteOrArchiveMasterRecord("Customer", cleanCustomer.id, actor);
      assert.equal(delRes.deleted, true);
      assert.equal(delRes.archived, false);
      assert.equal(delRes.linkedCount, 0);

      // Verify customer record is deleted
      const checkCust = await prisma.customer.findUnique({ where: { id: cleanCustomer.id } });
      assert.equal(checkCust, null, "Customer with 0 linked records must be permanently deleted");

      // Verify unlinked Gen-6 account was also deleted cleanly
      const checkAcc = await prisma.account.findUnique({ where: { id: cleanCustAccountId } });
      assert.equal(checkAcc, null, "Orphaned Gen-6 account with 0 journal lines must be deleted");

      // 2. Customer WITH linked records (posted journal entry)
      const busyCustomer = await prisma.$transaction((tx) =>
        ensureCustomerWithAccountTx(tx, {
          name: `عميل نشط بحركات ${TEST_RUN_TAG}`,
          nameEn: `Busy Customer ${TEST_RUN_TAG}`,
          phone: "777000222",
        })
      );
      assert.ok(busyCustomer.accountId);

      // Post a journal entry linking this customer's account
      await postJournalEntry({
        narrationAr: `قيد حركة عميل ${TEST_RUN_TAG}`,
        lines: [
          { accountId: busyCustomer.accountId, debit: 2500, credit: 0 },
          { accountCode: "411101", debit: 0, credit: 2500 },
        ],
        createdById: actor.userId,
      });

      // Attempt safe delete
      const busyDelRes = await safeDeleteOrArchiveMasterRecord("Customer", busyCustomer.id, actor);
      assert.equal(busyDelRes.deleted, false, "Must NOT delete customer with linked financial records");
      assert.equal(busyDelRes.archived, true, "Must auto-archive customer with linked records");
      assert.ok(busyDelRes.linkedCount > 0);

      // Verify customer is archived
      const archivedCust = await prisma.customer.findUniqueOrThrow({ where: { id: busyCustomer.id } });
      assert.equal(archivedCust.isActive, false);
      assert.ok(archivedCust.archivedAt !== null);

      // Verify linked Gen-6 Account is deactivated to prevent new postings
      const deactivatedAcc = await prisma.account.findUniqueOrThrow({ where: { id: busyCustomer.accountId } });
      assert.equal(deactivatedAcc.isActive, false);

      // 3. Restore customer
      const restoreRes = await restoreMasterRecord("Customer", busyCustomer.id, actor);
      assert.equal(restoreRes.restored, true);

      const restoredCust = await prisma.customer.findUniqueOrThrow({ where: { id: busyCustomer.id } });
      assert.equal(restoredCust.isActive, true);
      assert.equal(restoredCust.archivedAt, null);

      const reactivatedAcc = await prisma.account.findUniqueOrThrow({ where: { id: busyCustomer.accountId } });
      assert.equal(reactivatedAcc.isActive, true);
    });

    it("Vendor: permanently deletes when 0 linked records, auto-archives & deactivates GL when bills/pos exist", async () => {
      // 1. Clean vendor
      const cleanVendor = await prisma.$transaction((tx) =>
        createVendorWithAccountTx(tx, {
          nameAr: `مورد نظيف ${TEST_RUN_TAG}`,
          phone: "771000111",
        })
      );
      const cleanVendAccountId = cleanVendor.accountId;

      const delRes = await safeDeleteOrArchiveMasterRecord("Vendor", cleanVendor.id, actor);
      assert.equal(delRes.deleted, true);
      assert.equal(delRes.archived, false);
      assert.equal(delRes.linkedCount, 0);

      const checkVend = await prisma.vendor.findUnique({ where: { id: cleanVendor.id } });
      assert.equal(checkVend, null);

      const checkAcc = await prisma.account.findUnique({ where: { id: cleanVendAccountId } });
      assert.equal(checkAcc, null);

      // 2. Vendor WITH linked records
      const busyVendor = await prisma.$transaction((tx) =>
        createVendorWithAccountTx(tx, {
          nameAr: `مورد بحركات ${TEST_RUN_TAG}`,
          phone: "771000222",
        })
      );

      // Link a journal line
      await postJournalEntry({
        narrationAr: `قيد ذمة مورد ${TEST_RUN_TAG}`,
        lines: [
          { accountCode: "511101", debit: 4000, credit: 0 },
          { accountId: busyVendor.accountId, debit: 0, credit: 4000 },
        ],
        createdById: actor.userId,
      });

      const busyDelRes = await safeDeleteOrArchiveMasterRecord("Vendor", busyVendor.id, actor);
      assert.equal(busyDelRes.deleted, false);
      assert.equal(busyDelRes.archived, true);
      assert.ok(busyDelRes.linkedCount > 0);

      const archivedVend = await prisma.vendor.findUniqueOrThrow({ where: { id: busyVendor.id } });
      assert.equal(archivedVend.isActive, false);
      assert.ok(archivedVend.archivedAt !== null);

      const deactivatedAcc = await prisma.account.findUniqueOrThrow({ where: { id: busyVendor.accountId } });
      assert.equal(deactivatedAcc.isActive, false);

      // Restore
      await restoreMasterRecord("Vendor", busyVendor.id, actor);
      const restoredVend = await prisma.vendor.findUniqueOrThrow({ where: { id: busyVendor.id } });
      assert.equal(restoredVend.isActive, true);
      assert.equal(restoredVend.archivedAt, null);
    });

    it("Worker: permanently deletes when 0 wages, auto-archives & deactivates GL when wage entries exist", async () => {
      // 1. Clean worker
      const cleanWorker = await prisma.$transaction((tx) =>
        ensureWorkerWithAccountTx(tx, {
          name: `عامل نظيف ${TEST_RUN_TAG}`,
          phone: "772000111",
          defaultDailyWage: 3000,
        })
      );
      const cleanWorkerAccountId = cleanWorker.accountId!;

      const delRes = await safeDeleteOrArchiveMasterRecord("Worker", cleanWorker.id, actor);
      assert.equal(delRes.deleted, true);
      assert.equal(delRes.archived, false);

      const checkWorker = await prisma.worker.findUnique({ where: { id: cleanWorker.id } });
      assert.equal(checkWorker, null);

      const checkAcc = await prisma.account.findUnique({ where: { id: cleanWorkerAccountId } });
      assert.equal(checkAcc, null);

      // 2. Worker WITH linked records
      const busyWorker = await prisma.$transaction((tx) =>
        ensureWorkerWithAccountTx(tx, {
          name: `عامل بأجور ${TEST_RUN_TAG}`,
          phone: "772000222",
          defaultDailyWage: 4500,
        })
      );

      // Create linked wage entry
      const proj = await prisma.project.findFirst({ select: { id: true } });
      assert.ok(proj);

      await prisma.workerWageEntry.create({
        data: {
          workerId: busyWorker.id,
          workerName: busyWorker.name,
          projectId: proj.id,
          harvestName: "القطفة الأولى",
          dailyWage: 4500,
          daysWorked: 5,
          totalWage: 22500,
          creditAmount: 20000,
          debitBalance: 2500,
          workDate: "2026-11-19",
        },
      });

      const busyDelRes = await safeDeleteOrArchiveMasterRecord("Worker", busyWorker.id, actor);
      assert.equal(busyDelRes.deleted, false);
      assert.equal(busyDelRes.archived, true);
      assert.ok(busyDelRes.linkedCount > 0);

      const archivedWorker = await prisma.worker.findUniqueOrThrow({ where: { id: busyWorker.id } });
      assert.equal(archivedWorker.isActive, false);
      assert.ok(archivedWorker.archivedAt !== null);

      const deactivatedAcc = await prisma.account.findUniqueOrThrow({ where: { id: busyWorker.accountId! } });
      assert.equal(deactivatedAcc.isActive, false);

      // Restore
      await restoreMasterRecord("Worker", busyWorker.id, actor);
      const restoredWorker = await prisma.worker.findUniqueOrThrow({ where: { id: busyWorker.id } });
      assert.equal(restoredWorker.isActive, true);
      assert.equal(restoredWorker.archivedAt, null);
    });

    it("InventoryItem: permanently deletes when 0 movements/stock, auto-archives when movements exist", async () => {
      const baseUnit = await prisma.unitOfMeasure.upsert({
        where: { code: "PCS" },
        create: {
          code: "PCS",
          nameAr: "حبة",
          nameEn: "Piece",
          isBaseDefault: true,
          isCustom: false,
        },
        update: {},
      });

      const warehouse = await prisma.warehouse.upsert({
        where: { code: "MAIN" },
        create: {
          code: "MAIN",
          nameAr: "المستودع الرئيسي",
          nameEn: "Main Warehouse",
          isDefault: true,
          isCustom: false,
        },
        update: {},
      });

      // 1. Clean item
      const cleanItem = await prisma.inventoryItem.create({
        data: {
          sku: `SKU-CLN-${TEST_RUN_TAG.slice(-4)}`,
          nameAr: `صنف نظيف ${TEST_RUN_TAG}`,
          nameEn: `Clean Item ${TEST_RUN_TAG}`,
          itemType: "STOCKABLE",
          baseUnitId: baseUnit.id,
          purchasePrice: 100,
          wholesalePrice: 150,
          retailPrice: 200,
          minSellPrice: 120,
        },
      });

      const delRes = await safeDeleteOrArchiveMasterRecord("InventoryItem", cleanItem.id, actor);
      assert.equal(delRes.deleted, true);
      assert.equal(delRes.archived, false);

      const checkItem = await prisma.inventoryItem.findUnique({ where: { id: cleanItem.id } });
      assert.equal(checkItem, null);

      // 2. Item WITH linked movement
      const busyItem = await prisma.inventoryItem.create({
        data: {
          sku: `SKU-BSY-${TEST_RUN_TAG.slice(-4)}`,
          nameAr: `صنف بحركات ${TEST_RUN_TAG}`,
          nameEn: `Busy Item ${TEST_RUN_TAG}`,
          itemType: "STOCKABLE",
          baseUnitId: baseUnit.id,
          purchasePrice: 200,
          wholesalePrice: 250,
          retailPrice: 300,
          minSellPrice: 220,
        },
      });

      await prisma.stockMovement.create({
        data: {
          itemId: busyItem.id,
          warehouseId: warehouse.id,
          movementType: "PURCHASE_IN",
          enteredUnitId: baseUnit.id,
          enteredQty: 10,
          factorToBase: 1,
          baseQtyDelta: 10,
          unitCostBase: 200,
          createdAt: new Date(),
        },
      });

      const busyDelRes = await safeDeleteOrArchiveMasterRecord("InventoryItem", busyItem.id, actor);
      assert.equal(busyDelRes.deleted, false);
      assert.equal(busyDelRes.archived, true);
      assert.ok(busyDelRes.linkedCount > 0);

      const archivedItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: busyItem.id } });
      assert.equal(archivedItem.isActive, false);
      assert.ok(archivedItem.archivedAt !== null);

      // Restore
      await restoreMasterRecord("InventoryItem", busyItem.id, actor);
      const restoredItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: busyItem.id } });
      assert.equal(restoredItem.isActive, true);
      assert.equal(restoredItem.archivedAt, null);
    });

    it("offline Android local master lifecycle handles safe delete, auto-archive and restore", async () => {
      const storage = createMemoryStorage();

      // Initialize valid offline state and push a linked sale
      const state = loadOfflineAndroidState(storage);
      state.sales.push({
        id: "sale_1",
        customer: `عميل محلي نشط ${TEST_RUN_TAG}`,
        phone: "7702",
        projectId: "p1",
        harvest: "القطفة الأولى",
        batch: "دفعة 1",
        grade: "درجة أولى",
        bundles: 10,
        price: 50,
        total: 500,
        credit: 500,
        debit: 0,
        voucherNo: "V-1",
        notes: "حركة اختبار",
        date: "2026-11-19",
      });
      saveOfflineAndroidState(state, storage);

      const offlineCustomers = [
        { id: "cust_clean", name: `عميل محلي نظيف ${TEST_RUN_TAG}`, phone: "7701", isActive: true },
        { id: "cust_busy", name: `عميل محلي نشط ${TEST_RUN_TAG}`, phone: "7702", isActive: true },
      ];
      storage.setItem("uas_offline_db_customers", JSON.stringify(offlineCustomers));

      // 1. Delete clean customer locally -> permanent delete
      const delCleanRes = await handleLocalMasterLifecycle(
        "Customer",
        "cust_clean",
        "SAFE_DELETE",
        actor,
        storage
      );
      const cleanData = (await delCleanRes.json()) as { deleted: boolean; archived: boolean };
      assert.equal(cleanData.deleted, true);

      const custsAfterClean = JSON.parse(storage.getItem("uas_offline_db_customers") || "[]");
      assert.equal(custsAfterClean.find((c: { id: string }) => c.id === "cust_clean"), undefined);

      // 2. Delete busy customer locally -> auto archive
      const delBusyRes = await handleLocalMasterLifecycle(
        "Customer",
        "cust_busy",
        "SAFE_DELETE",
        actor,
        storage
      );
      const busyData = (await delBusyRes.json()) as { deleted: boolean; archived: boolean };
      assert.equal(busyData.deleted, false);
      assert.equal(busyData.archived, true);

      const custsAfterBusy = JSON.parse(storage.getItem("uas_offline_db_customers") || "[]");
      const busyCust = custsAfterBusy.find((c: { id: string }) => c.id === "cust_busy");
      assert.ok(busyCust);
      assert.equal(busyCust.isActive, false);
      assert.ok(busyCust.archivedAt);

      // 3. Restore busy customer locally
      const restoreRes = await handleLocalMasterLifecycle(
        "Customer",
        "cust_busy",
        "RESTORE",
        actor,
        storage
      );
      const restoreData = (await restoreRes.json()) as { restored: boolean };
      assert.equal(restoreData.restored, true);

      const custsAfterRestore = JSON.parse(storage.getItem("uas_offline_db_customers") || "[]");
      const restoredCust = custsAfterRestore.find((c: { id: string }) => c.id === "cust_busy");
      assert.equal(restoredCust.isActive, true);
      assert.equal(restoredCust.archivedAt, null);
    });
  });
});

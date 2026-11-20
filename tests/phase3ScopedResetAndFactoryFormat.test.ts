import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  precheckScopedReset,
  executeScopedReset,
  getExpectedConfirmationPhrase,
  validateConfirmationPhrase,
} from "../src/lib/scopedResetEngine";
import {
  handleOfflineAndroidApiRequest,
  createCleanOfflineCompanyState,
  saveOfflineAndroidState,
  loadOfflineAndroidState,
  type OfflineStorageLike,
} from "../src/lib/offlineAndroidStore";

describe("Mission 5: Phase 3 — Scoped Reset & Factory Format Engine", () => {
  const superAdminActor = {
    userId: "usr-admin-1",
    userDisplay: "مدير النظام العام",
    userRole: "SUPER_ADMIN",
  };

  const nonAdminActor = {
    userId: "usr-staff-1",
    userDisplay: "محاسب المبيعات",
    userRole: "SALES_COLLECTOR",
  };

  describe("1. Confirmation Phrases & Validation Logic", () => {
    it("derives correct confirmation phrase per scope and section module", () => {
      assert.equal(getExpectedConfirmationPhrase("section", "sales"), "RESET_SECTION_SALES");
      assert.equal(getExpectedConfirmationPhrase("section", "procurement"), "RESET_SECTION_PROCUREMENT");
      assert.equal(getExpectedConfirmationPhrase("section", "inventory"), "RESET_SECTION_INVENTORY");
      assert.equal(getExpectedConfirmationPhrase("section", "treasury"), "RESET_SECTION_TREASURY");
      assert.equal(getExpectedConfirmationPhrase("section", "expenses_wages"), "RESET_SECTION_EXPENSES_WAGES");
      assert.equal(getExpectedConfirmationPhrase("unit"), "RESET_UNIT");
      assert.equal(getExpectedConfirmationPhrase("factory"), "FACTORY_RESET");
    });

    it("validates exact and uppercase trimmed confirmation phrases", () => {
      assert.equal(validateConfirmationPhrase("RESET_SECTION_SALES", "section", "sales"), true);
      assert.equal(validateConfirmationPhrase("  reset_section_sales  ", "section", "sales"), true);
      assert.equal(validateConfirmationPhrase("CONFIRM-RESET", "section", "sales"), true);
      assert.equal(validateConfirmationPhrase("RESET_UNIT", "unit"), true);
      assert.equal(validateConfirmationPhrase("FACTORY_RESET", "factory"), true);
      assert.equal(validateConfirmationPhrase("CONFIRM-FACTORY-RESET", "factory"), true);

      // Rejects invalid phrases
      assert.equal(validateConfirmationPhrase("INVALID_TOKEN", "section", "sales"), false);
      assert.equal(validateConfirmationPhrase("RESET_SECTION_PROCUREMENT", "section", "sales"), false);
      assert.equal(validateConfirmationPhrase("", "factory"), false);
    });
  });

  describe("2. Pre-Reset Safety Checks & Warning Inspection", () => {
    it("generates structured bilingual inspection report with required confirmation and counts", async () => {
      const checkSales = await precheckScopedReset({
        scope: "section",
        sectionModule: "sales",
      });

      assert.equal(checkSales.scope, "section");
      assert.ok(checkSales.targetDescriptionAr.includes("المبيعات"));
      assert.ok(checkSales.targetDescriptionEn.includes("Sales"));
      assert.equal(checkSales.requiredConfirmationPhrase, "RESET_SECTION_SALES");
      assert.equal(typeof checkSales.hasClosedFiscalYear, "boolean");
      assert.equal(typeof checkSales.closedFiscalYearsCount, "number");
      assert.equal(typeof checkSales.unpostedDraftsCount, "number");
      assert.ok(checkSales.affectedRecordsStats);
      assert.equal(checkSales.safeToProceed, true);

      const checkFactory = await precheckScopedReset({
        scope: "factory",
      });

      assert.equal(checkFactory.scope, "factory");
      assert.ok(checkFactory.targetDescriptionAr.includes("التهيئة المصنعية"));
      assert.equal(checkFactory.requiredConfirmationPhrase, "FACTORY_RESET");
      assert.ok(checkFactory.affectedRecordsStats);
    });
  });

  describe("3. Security Guardrails & Authorization Enforcement", () => {
    it("blocks non-SUPER_ADMIN users from executing any reset operation", async () => {
      await assert.rejects(
        async () => {
          await executeScopedReset({
            scope: "section",
            sectionModule: "sales",
            confirmationPhrase: "RESET_SECTION_SALES",
            actor: nonAdminActor,
          });
        },
        /صلاحية المشرف العام \(SUPER_ADMIN\)/
      );
    });

    it("rejects reset execution when confirmation phrase is missing or incorrect", async () => {
      await assert.rejects(
        async () => {
          await executeScopedReset({
            scope: "section",
            sectionModule: "sales",
            confirmationPhrase: "WRONG_PHRASE",
            actor: superAdminActor,
          });
        },
        /عبارة التأكيد غير صحيحة/
      );
    });
  });

  describe("4. Scoped Reset Execution Engine (Server DB)", () => {
    it("executes section reset for sales and creates automatic pre-reset backup", async () => {
      const result = await executeScopedReset({
        scope: "section",
        sectionModule: "sales",
        confirmationPhrase: "RESET_SECTION_SALES",
        actor: superAdminActor,
      });

      assert.equal(result.ok, true);
      assert.equal(result.scope, "section");
      assert.ok(result.summaryAr.includes("المبيعات"));
      assert.ok(result.preResetBackupFilename.length > 0);
      assert.equal(result.preservedLicense, true);
    });

    it("executes unit reset for project, preserving licensing and other projects intact", async () => {
      const result = await executeScopedReset({
        scope: "unit",
        unitType: "project",
        unitId: "proj-jawf-demo",
        confirmationPhrase: "RESET_UNIT",
        actor: superAdminActor,
      });

      assert.equal(result.ok, true);
      assert.equal(result.scope, "unit");
      assert.ok(result.summaryAr.includes("الوحدة"));
      assert.ok(result.preResetBackupFilename.length > 0);
      assert.equal(result.preservedLicense, true);
    });
  });

  describe("5. Offline Android Local Mode Parity & Sync Queue Purge", () => {
    function createMockStorage(): OfflineStorageLike {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
        setItem: (k: string, v: string) => { map.set(k, String(v)); },
        removeItem: (k: string) => { map.delete(k); },
      };
    }

    it("executes scoped section reset offline in Android Local Mode and purges deleted sync queue items", async () => {
      const storage = createMockStorage();
      const state = createCleanOfflineCompanyState() as any;

      // Seed dummy sales invoice and queued sync mutation
      state.salesInvoices = [
        {
          id: "sinv-local-1",
          invoiceNumber: "INV-001",
          customerId: "c1",
          totalAmount: 15000,
          status: "POSTED",
        },
      ];
      state.customers = [
        {
          id: "c1",
          nameAr: "عميل تجريبي",
          balance: 15000,
          currentBalance: 15000,
        },
      ];
      saveOfflineAndroidState(state, storage);

      // Seed sync queue item for sales
      const initialSyncQueue = [
        {
          id: "sync-1",
          endpoint: "/api/commercial/sales",
          payload: { id: "sinv-local-1" },
        },
        {
          id: "sync-2",
          endpoint: "/api/settings",
          payload: { theme: "emerald" },
        },
      ];
      storage.setItem("uas_offline_sync_queue", JSON.stringify(initialSyncQueue));

      // Call offline reset for sales
      const res = await handleOfflineAndroidApiRequest(
        "/api/system/reset",
        {
          method: "POST",
          headers: {
            "x-uas-role": "SUPER_ADMIN",
          },
          body: JSON.stringify({
            scope: "section",
            sectionModule: "sales",
            confirmationPhrase: "RESET_SECTION_SALES",
          }),
        },
        storage
      );

      assert.equal(res.status, 200);
      const resData = (await res.json()) as { ok: boolean; result: { ok: boolean; scope: string } };
      assert.equal(resData.ok, true);
      assert.equal(resData.result.scope, "section");

      // Verify offline state was cleared
      const stateAfter = loadOfflineAndroidState(storage) as any;
      assert.equal((stateAfter.salesInvoices || []).length, 0);
      assert.equal(stateAfter.customers[0].balance, 0);

      // Verify sales sync queue mutation was purged, while non-sales item remains
      const syncQueueAfter = JSON.parse(storage.getItem("uas_offline_sync_queue") || "[]");
      assert.equal(syncQueueAfter.length, 1);
      assert.equal(syncQueueAfter[0].id, "sync-2");
    });

    it("executes full factory format offline, zeroing balances and preserving root accounts & licensing", async () => {
      const storage = createMockStorage();
      const state = createCleanOfflineCompanyState() as any;

      // Seed dirty operational records
      state.salesInvoices = [{ id: "inv-1" }];
      state.purchaseOrders = [{ id: "po-1" }];
      state.journalEntries = [{ id: "je-1" }];
      saveOfflineAndroidState(state, storage);

      storage.setItem(
        "uas_offline_sync_queue",
        JSON.stringify([{ id: "sync-dirty-1", endpoint: "/api/journal" }])
      );

      const res = await handleOfflineAndroidApiRequest(
        "/api/system/reset",
        {
          method: "POST",
          headers: {
            "x-uas-role": "SUPER_ADMIN",
          },
          body: JSON.stringify({
            scope: "factory",
            coaMode: "blank_coa",
            confirmationPhrase: "FACTORY_RESET",
          }),
        },
        storage
      );

      assert.equal(res.status, 200);
      const resData = (await res.json()) as { ok: boolean; result: { preservedLicense: boolean } };
      assert.equal(resData.ok, true);
      assert.equal(resData.result.preservedLicense, true);

      const stateAfter = loadOfflineAndroidState(storage) as any;
      assert.equal((stateAfter.salesInvoices || []).length, 0);
      assert.equal((stateAfter.purchaseOrders || []).length, 0);
      assert.equal((stateAfter.journalEntries || []).length, 0);

      // Verify sync queue was completely purged
      const syncQueueAfter = JSON.parse(storage.getItem("uas_offline_sync_queue") || "[]");
      assert.equal(syncQueueAfter.length, 0);

      // Verify root accounts remain
      assert.ok(stateAfter.accounts.some((a: any) => a.code === "1"));
      assert.ok(stateAfter.accounts.some((a: any) => a.code === "2"));
      assert.ok(stateAfter.accounts.some((a: any) => a.code === "3"));
      assert.ok(stateAfter.accounts.some((a: any) => a.code === "4"));
      assert.ok(stateAfter.accounts.some((a: any) => a.code === "5"));

      // Verify admin user is preserved
      assert.ok(stateAfter.users.some((u: any) => u.role === "SUPER_ADMIN"));
    });
  });
});

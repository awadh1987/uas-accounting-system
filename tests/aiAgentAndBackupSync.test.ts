import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  extractCurrencyFromPrompt,
  extractExchangeRateFromPrompt,
  extractCostCenterFromPrompt,
  extractMultiUnitQuantityFromPrompt,
  parseBilingualAgentIntent,
} from "../src/lib/ai/offlineAgentEngine";
import {
  findCoaAccount,
  executeUasAgentTool,
  type ResolvedCoaNode,
  type ConfirmationPreviewCard,
} from "../src/lib/ai/uasAgentTools";
import { executeConfirmedAiAction } from "../src/lib/ai/agentServerExecutor";
import {
  exportFullSchemaJsonBackup,
  restoreFullSchemaJsonBackup,
  backfillLegacyBaseCurrencies,
  FULL_SCHEMA_TABLE_ORDER,
} from "../src/lib/backupService";
import { loadInstalledLicense } from "../src/lib/licensing/verifier";
import {
  getEndpointSyncPriority,
  sortSyncQueueTopologically,
  getPrioritizedOfflineSyncQueue,
  type OfflineStorageLike,
  type OfflineSyncQueueEntry,
} from "../src/lib/offlineAndroidStore";
import { ensure6GenerationCoaHierarchy } from "../src/lib/accountingCoreEngine";
import { ensureDefaultFiscalYear } from "../src/lib/fiscalYearClosingEngine";
import { createApprovalRule } from "../src/lib/approvalEngine";

const TEST_RUN_TAG = `AIBKP_${Date.now().toString().slice(-6)}`;
const actor = {
  userId: `usr_ai_${TEST_RUN_TAG}`,
  userDisplay: `AI Test Runner ${TEST_RUN_TAG}`,
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

describe("Phase 3 — AI Agent Copilot, Support Engine, Full-Schema Backup & Android Sync Replay", () => {
  let closedFyId = "";
  let approvalRuleId = "";

  before(async () => {
    await ensure6GenerationCoaHierarchy();
    await ensureDefaultFiscalYear();

    // 1. Create a closed past Fiscal Year to test AI period-lock enforcement
    const closedFy = await prisma.fiscalYear.upsert({
      where: { code: `FY-CLOSED-${TEST_RUN_TAG}` },
      update: {},
      create: {
        code: `FY-CLOSED-${TEST_RUN_TAG}`,
        nameAr: "سنة مغلقة للاختبار",
        nameEn: "Closed Year Test",
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: new Date("2020-12-31T23:59:59.999Z"),
        status: "CLOSED",
      },
    });
    closedFyId = closedFy.id;

    // 2. Create a high-threshold Approval Rule for GL_POSTING
    const rule = await createApprovalRule({
      module: "ACCOUNTING",
      actionType: "GL_POSTING",
      minAmountBase: 50000, // Postings >= 50,000 YER require approval
      requiredRole: "CHIEF_ACCOUNTANT",
      currencyCode: "YER",
      isActive: true,
    });
    approvalRuleId = rule.id;
  });

  after(async () => {
    if (closedFyId) {
      await prisma.fiscalYear.deleteMany({ where: { id: closedFyId } }).catch(() => {});
    }
    if (approvalRuleId) {
      await prisma.approvalRule.deleteMany({ where: { id: approvalRuleId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // 1. AI Intent Parsing & Multi-Currency / Multi-Unit / Cost Center Extraction
  // ---------------------------------------------------------------------------
  it("(a) parses foreign currencies, FX rates, cost centers, and multi-unit quantities with factorToBase", () => {
    // Currency parsing
    assert.equal(extractCurrencyFromPrompt("سند قبض بمبلغ 500 ريال سعودي"), "SAR");
    assert.equal(extractCurrencyFromPrompt("payment voucher for 1000 USD to vendor"), "USD");
    assert.equal(extractCurrencyFromPrompt("فاتورة مشتريات بمبلغ 250 درهم إماراتي"), "AED");
    assert.equal(extractCurrencyFromPrompt("سند صرف 100 ريال عماني"), "OMR");
    assert.equal(extractCurrencyFromPrompt("قيد يومية بمبلغ 75000 ريال يمني"), "YER");

    // FX Rate extraction
    const rate1 = extractExchangeRateFromPrompt("سند صرف 500 SAR بسعر صرف 530 إلى المورد");
    assert.equal(rate1, 530);
    const rate2 = extractExchangeRateFromPrompt("sales invoice for 200 USD rate: 2000");
    assert.equal(rate2, 2000);

    // Cost Center extraction
    const cc1 = extractCostCenterFromPrompt("سجل قيد مصروفات مركز تكلفة CUS-001 بمبلغ 15000");
    assert.equal(cc1, "CUS-001");
    const cc2 = extractCostCenterFromPrompt("payment voucher cost center: CC-ADMIN amount 5000");
    assert.equal(cc2, "CC-ADMIN");

    // Multi-Unit quantity & conversion
    const mu1 = extractMultiUnitQuantityFromPrompt("فاتورة مبيعات 10 كراتين بسعر 5000");
    assert.ok(mu1);
    assert.equal(mu1?.quantity, 10);
    assert.equal(mu1?.factorToBase, 12);
    assert.equal(mu1?.baseQuantity, 120);

    const mu2 = extractMultiUnitQuantityFromPrompt("شراء 5 درازن صنف ممتاز");
    assert.ok(mu2);
    assert.equal(mu2?.quantity, 5);
    assert.equal(mu2?.factorToBase, 12);
    assert.equal(mu2?.baseQuantity, 60);

    const mu3 = extractMultiUnitQuantityFromPrompt("توريد 20 كيس قمح");
    assert.ok(mu3);
    assert.equal(mu3?.quantity, 20);
    assert.equal(mu3?.factorToBase, 50);
    assert.equal(mu3?.baseQuantity, 1000);

    // Full intent parsing
    const intent = parseBilingualAgentIntent(
      "سجل قيد يومية من حساب 111101 بمبلغ 200 SAR بسعر صرف 530 إلى حساب 524101 بمبلغ 200 SAR مركز تكلفة CC-01"
    );
    assert.equal(intent.toolName, "draft_journal_entry");
    assert.equal(intent.args.currency, "SAR");
    assert.equal(intent.args.exchangeRate, 530);
    assert.equal(intent.args.costCenterId, "CC-01");
  });

  // ---------------------------------------------------------------------------
  // 2. COA Leaf Resolution & Gen-6 Postable Hierarchy
  // ---------------------------------------------------------------------------
  it("(b) prioritizes Generation 6 postable leaf accounts and rejects non-posting summary headers", async () => {
    const mockCatalog: ResolvedCoaNode[] = [
      { code: "100000", nameAr: "الأصول", nameEn: "Assets", level: 1, type: "ASSET", isPosting: false, balance: 0 },
      { code: "110000", nameAr: "الأصول المتداولة", nameEn: "Current Assets", level: 2, type: "ASSET", isPosting: false, balance: 0 },
      { code: "112000", nameAr: "العملاء والمدينون", nameEn: "Receivables", level: 3, type: "ASSET", isPosting: false, balance: 0 },
      { code: "112100", nameAr: "العملاء المحليون", nameEn: "Trade Debtors", level: 4, type: "ASSET", isPosting: false, balance: 0 },
      { code: "112190", nameAr: "حساب التحكم للعملاء", nameEn: "Customer Control", level: 5, type: "ASSET", isPosting: false, balance: 0 },
      { code: "112190001", nameAr: "شركة الأمل للتجارة (عميل)", nameEn: "Al-Amal Co", level: 6, type: "ASSET", isPosting: true, balance: 50000 },
    ];

    // Searching for "الأمل" must match the Level 6 posting leaf
    const match = findCoaAccount(mockCatalog, "الأمل");
    assert.ok(match);
    assert.equal(match?.code, "112190001");
    assert.equal(match?.level, 6);
    assert.equal(match?.isPosting, true);

    // Drafting an entry targeting level 4 summary account 112100 must be rejected
    const draftRes = await executeUasAgentTool(
      "draft_journal_entry",
      {
        narrationAr: "قيد تجريبي غير صالح",
        lines: [
          { accountCode: "112100", debit: 5000, credit: 0 },
          { accountCode: "111101", debit: 0, credit: 5000 },
        ],
      },
      { user: "SUPER_ADMIN" }
    );
    assert.equal(draftRes.ok, false);
    assert.equal(draftRes.code, "COA_NON_POSTING_ACCOUNT");
  });

  // ---------------------------------------------------------------------------
  // 3. Execution Guardrails: Closed Fiscal Year & Approval Routing
  // ---------------------------------------------------------------------------
  it("(c) blocks AI posting into closed fiscal years and enforces approval queue routing on high amounts", async () => {
    // A. Closed Fiscal Year test: 2020-05-15 is in FY-CLOSED
    const closedCard: ConfirmationPreviewCard = {
      actionId: `act_closed_${Date.now()}`,
      toolName: "draft_journal_entry",
      operationType: "JOURNAL_ENTRY",
      titleAr: "قيد في سنة مغلقة",
      titleEn: "Closed Year Entry",
      narrationAr: "محاولة ترحيل قيد في سنة مالية مقفلة",
      narrationEn: "Attempted posting in closed year",
      date: "2020-05-15",
      currency: "YER",
      totalDebit: 1000,
      totalCredit: 1000,
      isBalanced: true,
      lines: [
        { accountCode: "111101", accountNameAr: "الصندوق", accountNameEn: "Cash", debit: 1000, credit: 0 },
        { accountCode: "411101", accountNameAr: "المبيعات", accountNameEn: "Sales", debit: 0, credit: 1000 },
      ],
      confirmButtonLabelAr: "تأكيد",
      confirmButtonLabelEn: "Confirm",
      confirmButtonLabel: "تأكيد / Confirm",
      executionPayload: {},
    };

    const closedExec = await executeConfirmedAiAction({
      confirmationCard: closedCard,
      actor,
    });
    assert.equal(closedExec.ok, false);
    assert.equal(closedExec.status, 400);
    assert.equal(closedExec.code, "FISCAL_YEAR_CLOSED");

    // B. Approval Rule Trigger: 60,000 YER exceeds 50,000 threshold
    const highValCard: ConfirmationPreviewCard = {
      actionId: `act_high_${Date.now()}`,
      toolName: "draft_journal_entry",
      operationType: "JOURNAL_ENTRY",
      titleAr: "قيد عالي القيمة يتطلب اعتماد",
      titleEn: "High Value Entry Requiring Approval",
      narrationAr: "قيد يتجاوز حد الصلاحية التلقائية",
      narrationEn: "High value journal requiring chief approval",
      date: new Date().toISOString().slice(0, 10),
      currency: "YER",
      totalDebit: 60000,
      totalCredit: 60000,
      isBalanced: true,
      lines: [
        { accountCode: "111101", accountNameAr: "الصندوق", accountNameEn: "Cash", debit: 60000, credit: 0 },
        { accountCode: "411101", accountNameAr: "المبيعات", accountNameEn: "Sales", debit: 0, credit: 60000 },
      ],
      confirmButtonLabelAr: "تأكيد",
      confirmButtonLabelEn: "Confirm",
      confirmButtonLabel: "تأكيد / Confirm",
      executionPayload: {},
    };

    const approvalExec = await executeConfirmedAiAction({
      confirmationCard: highValCard,
      actor,
    });
    assert.equal(approvalExec.ok, true);
    assert.equal(approvalExec.status, 202);
    assert.equal(approvalExec.code, "SUBMITTED_FOR_APPROVAL");
    assert.equal(approvalExec.approvalRequired, true);
    assert.ok(approvalExec.approvalRequestNumber?.startsWith("APR-"));

    // Verify in DB that documentStatus is PENDING_APPROVAL
    const entry = await prisma.journalEntry.findUnique({
      where: { id: approvalExec.journalEntryId },
      select: { documentStatus: true, status: true },
    });
    assert.equal(entry?.documentStatus, "PENDING_APPROVAL");
    assert.equal(entry?.status, "PENDING_APPROVAL");

    // C. WorkspaceDraft routing when isDraft = true
    const draftCard: ConfirmationPreviewCard = {
      actionId: `act_draft_${Date.now()}`,
      toolName: "draft_journal_entry",
      operationType: "JOURNAL_ENTRY",
      titleAr: "مسودة عمل مشتركة",
      titleEn: "Shared Workspace Draft",
      narrationAr: "حفظ كمسودة دون ترحيل",
      narrationEn: "Save as draft without posting",
      date: new Date().toISOString().slice(0, 10),
      currency: "YER",
      totalDebit: 5000,
      totalCredit: 5000,
      isBalanced: true,
      lines: [
        { accountCode: "111101", accountNameAr: "الصندوق", accountNameEn: "Cash", debit: 5000, credit: 0 },
        { accountCode: "411101", accountNameAr: "المبيعات", accountNameEn: "Sales", debit: 0, credit: 5000 },
      ],
      confirmButtonLabelAr: "حفظ كمسودة",
      confirmButtonLabelEn: "Save as Draft",
      confirmButtonLabel: "حفظ كمسودة / Save as Draft",
      executionPayload: { isDraft: true },
    };

    const draftExec = await executeConfirmedAiAction({
      confirmationCard: draftCard,
      actor,
    });
    assert.equal(draftExec.ok, true);
    assert.equal(draftExec.status, 201);
    assert.equal(draftExec.code, "DRAFT_SAVED");
    assert.ok(draftExec.draftId);
  });

  // ---------------------------------------------------------------------------
  // 4. Full-Schema Backup & Backward-Compatible Restore
  // ---------------------------------------------------------------------------
  it("(d) exports full schema JSON backup and auto-migrates 6-Gen COA & base currencies on restore", async () => {
    const { license } = loadInstalledLicense();
    const testCompanyName = license?.company_name || "UAS-Test-Backup-Company";
    const { backup, filename } = await exportFullSchemaJsonBackup({
      companyName: testCompanyName,
    });

    assert.equal(backup.format, "UAS-FULL-SCHEMA-JSON-V1");
    assert.ok(filename.endsWith(".json"));

    // Verify all newly added models are present in export dictionary
    const requiredModels = [
      "currency",
      "exchangeRate",
      "costCenter",
      "fiscalYear",
      "unitOfMeasure",
      "itemCategory",
      "warehouse",
      "inventoryItem",
      "itemUnitConversion",
      "stockBalance",
      "stockMovement",
      "treasuryTransaction",
      "workspaceDraft",
      "approvalRule",
      "approvalRequest",
      "idempotencyRecord",
    ];

    for (const mod of requiredModels) {
      assert.ok(
        mod in backup.tables,
        `Expected model '${mod}' to be exported in full schema backup tables`
      );
      assert.ok(
        (FULL_SCHEMA_TABLE_ORDER as readonly string[]).includes(mod),
        `Expected model '${mod}' in FULL_SCHEMA_TABLE_ORDER`
      );
    }

    // Test backfillLegacyBaseCurrencies
    await backfillLegacyBaseCurrencies();

    // Test restore pipeline auto-migrating and verifying company
    const restoreRes = await restoreFullSchemaJsonBackup(
      backup,
      actor,
      "vitest_automated_test"
    );
    assert.equal(restoreRes.ok, true);
    assert.ok(restoreRes.restoredTables.length > 0);
  });

  // ---------------------------------------------------------------------------
  // 5. Android Offline Sync Queue Topological Replay Ordering
  // ---------------------------------------------------------------------------
  it("(e) sorts Android offline sync queue in topological FK order for LAN/Cloud synchronization", () => {
    const memStore = createMemoryStorage();

    const sampleQueue: OfflineSyncQueueEntry[] = [
      {
        id: "1",
        endpoint: "/api/sales",
        method: "POST",
        payload: { invoice: "INV-001" },
        createdAt: "2026-11-19T10:00:00Z",
      },
      {
        id: "2",
        endpoint: "/api/approvals/decide",
        method: "POST",
        payload: { decision: "APPROVED" },
        createdAt: "2026-11-19T10:05:00Z",
      },
      {
        id: "3",
        endpoint: "/api/cost-centers",
        method: "POST",
        payload: { code: "CC-01" },
        createdAt: "2026-11-19T09:00:00Z",
      },
      {
        id: "4",
        endpoint: "/api/currencies",
        method: "POST",
        payload: { code: "SAR" },
        createdAt: "2026-11-19T08:00:00Z",
      },
      {
        id: "5",
        endpoint: "/api/inventory/uoms",
        method: "POST",
        payload: { code: "BOX" },
        createdAt: "2026-11-19T09:30:00Z",
      },
      {
        id: "6",
        endpoint: "/api/customers",
        method: "POST",
        payload: { name: "Ahmed" },
        createdAt: "2026-11-19T09:45:00Z",
      },
      {
        id: "7",
        endpoint: "/api/drafts",
        method: "POST",
        payload: { title: "Draft 1" },
        createdAt: "2026-11-19T09:50:00Z",
      },
    ];

    // Test priority ranking directly
    assert.equal(getEndpointSyncPriority("/api/currencies"), 10);
    assert.equal(getEndpointSyncPriority("/api/cost-centers"), 20);
    assert.equal(getEndpointSyncPriority("/api/inventory/uoms"), 30);
    assert.equal(getEndpointSyncPriority("/api/customers"), 40);
    assert.equal(getEndpointSyncPriority("/api/drafts"), 50);
    assert.equal(getEndpointSyncPriority("/api/sales"), 60);
    assert.equal(getEndpointSyncPriority("/api/approvals/decide"), 70);

    const sortedDirectly = sortSyncQueueTopologically(sampleQueue);
    assert.equal(sortedDirectly[0].endpoint, "/api/currencies");
    assert.equal(sortedDirectly[6].endpoint, "/api/approvals/decide");

    memStore.setItem("uas_offline_sync_queue", JSON.stringify(sampleQueue));

    const prioritized = getPrioritizedOfflineSyncQueue(memStore);

    // Expected order:
    // 1. /api/currencies (Priority 10)
    // 2. /api/cost-centers (Priority 20)
    // 3. /api/inventory/uoms (Priority 30)
    // 4. /api/customers (Priority 40)
    // 5. /api/drafts (Priority 50)
    // 6. /api/sales (Priority 60)
    // 7. /api/approvals/decide (Priority 70)
    assert.equal(prioritized[0].endpoint, "/api/currencies");
    assert.equal(prioritized[1].endpoint, "/api/cost-centers");
    assert.equal(prioritized[2].endpoint, "/api/inventory/uoms");
    assert.equal(prioritized[3].endpoint, "/api/customers");
    assert.equal(prioritized[4].endpoint, "/api/drafts");
    assert.equal(prioritized[5].endpoint, "/api/sales");
    assert.equal(prioritized[6].endpoint, "/api/approvals/decide");
  });
});

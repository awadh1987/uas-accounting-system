import test from "node:test";
import assert from "node:assert/strict";

import {
  generateExecutiveBriefing,
  loadCachedExecutiveBriefing,
  saveCachedExecutiveBriefing,
} from "../src/lib/ai/executiveBriefingEngine";
import { runUasAiAgent } from "../src/lib/ai/offlineAgentEngine";
import {
  runGeminiBriefingSynthesis,
  runGeminiCopilotAgent,
  type GeminiClientFactory,
} from "../src/lib/ai/geminiCopilotEngine";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";
import type { CopilotMemoryEntry } from "../src/lib/ai/copilotMemoryTypes";

test("Executive briefing detects low-stock harvest/catalog items and overdue receivables sorted by severity", () => {
  const sampleState = {
    ...INITIAL_FALLBACK_STATE,
    enterpriseProfile: {
      ...INITIAL_FALLBACK_STATE.enterpriseProfile,
      tenantSlug: "al-rawdah",
    },
    projects: [
      {
        id: "prj-1",
        code: "PRJ-01",
        name: "مزرعة الروضة",
        location: "صنعاء",
        budgetTotal: 500000,
        plannedHarvests: 3,
        harvests: ["القطفة الأولى"],
        subProjects: [],
      },
    ],
    inventoryBatches: [
      {
        id: "bat-crit",
        projectId: "prj-1",
        subProjectId: null,
        harvest: "القطفة الأولى",
        grade: "درجة أولى",
        harvestedBundles: 30,
        shrinkageBundles: 2,
        date: "2026-10-01",
        notes: "",
      },
      {
        id: "bat-warn",
        projectId: "prj-1",
        subProjectId: null,
        harvest: "القطفة الأولى",
        grade: "درجة ثانية",
        harvestedBundles: 25,
        shrinkageBundles: 0,
        date: "2026-10-05",
        notes: "",
      },
      {
        id: "bat-ok",
        projectId: "prj-1",
        subProjectId: null,
        harvest: "القطفة الأولى",
        grade: "درجة ثالثة",
        harvestedBundles: 120,
        shrinkageBundles: 0,
        date: "2026-10-06",
        notes: "",
      },
    ],
    sales: [
      {
        id: "sale-1",
        projectId: "prj-1",
        harvest: "القطفة الأولى",
        batch: "b1",
        customer: "شركة النور للتجارة",
        phone: "777111222",
        grade: "درجة أولى",
        bundles: 30, // Exceeds usable (28) -> critical shortage of 2!
        price: 5000,
        total: 150000,
        credit: 50000,
        debit: 100000,
        date: "2026-10-15", // 39 days before 2026-11-23 -> critical overdue
        voucherNo: "SO-1001",
        notes: "",
      },
      {
        id: "sale-2",
        projectId: "prj-1",
        harvest: "القطفة الأولى",
        batch: "b2",
        customer: "محل السعيد",
        phone: "777333444",
        grade: "درجة ثانية",
        bundles: 20, // 5 left <= threshold 10 -> warning
        price: 4000,
        total: 80000,
        credit: 80000,
        debit: 0,
        date: "2026-11-20",
        voucherNo: "SO-1002",
        notes: "",
      },
    ],
  };

  const report = generateExecutiveBriefing({
    tenantSlug: "al-rawdah",
    date: "2026-11-23",
    lang: "ar",
    dialect: "yemeni",
    user: "SUPER_ADMIN",
    state: sampleState,
    inventoryItems: [
      {
        id: "cat-1",
        nameAr: "أكياس تغليف درجة ممتاز",
        unitName: "كيس",
        qtyOnHand: 4,
        minStockAlert: 20,
      },
    ],
    salesInvoices: [
      {
        id: "inv-20",
        invoiceNumber: "INV-2026-020",
        customerName: "تاجر الحديدة",
        balanceDue: 350000,
        currency: "YER",
        date: "2026-10-01",
        dueDate: "2026-10-10", // 44 days overdue -> critical (older than sale-1)
        status: "POSTED",
      },
    ],
  });

  assert.equal(report.tenantSlug, "al-rawdah");
  assert.equal(report.counts.lowStockCount, 3);
  assert.equal(report.lowStockAlerts[0].severity, "critical");
  assert.equal(report.counts.overdueReceivablesCount, 2);
  assert.equal(report.overdueReceivableAlerts[0].customerName, "تاجر الحديدة");
  assert.equal(report.overdueReceivableAlerts[0].severity, "critical");
  assert.equal(report.counts.criticalAlertsCount >= 3, true);
  assert.equal(report.briefingAr.includes("حياك الله يا غالي"), true);
});

test("Executive briefing supports MSA Arabic, English, customer memory credit terms, and strict tenant isolation", () => {
  const memories: CopilotMemoryEntry[] = [
    {
      id: "mem-alpha",
      tenantSlug: "tenant-alpha",
      scope: "workspace",
      category: "domain_fact",
      topicKey: "entity_rule:hayel",
      content: "العميل هائل يتعامل بالآجل لمدة 45 يوم",
      sourceSnippet: "العميل هائل يتعامل بالآجل لمدة 45 يوم",
      confidence: 0.92,
      usageCount: 1,
      pinned: true,
      active: true,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "mem-beta",
      tenantSlug: "tenant-beta",
      scope: "workspace",
      category: "domain_fact",
      topicKey: "secret_rule:beta",
      content: "معلومة سرية خاصة بالمنشأة بيتا فقط",
      sourceSnippet: "معلومة سرية خاصة بالمنشأة بيتا فقط",
      confidence: 0.95,
      usageCount: 0,
      pinned: true,
      active: true,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    },
  ];

  // Sale dated 30 days ago for "العميل هائل" should NOT be overdue under tenant-alpha's 45-day rule!
  const alphaReport = generateExecutiveBriefing({
    tenantSlug: "tenant-alpha",
    date: "2026-11-23",
    lang: "ar",
    dialect: "msa",
    user: "ACCOUNTANT",
    memories,
    salesInvoices: [
      {
        id: "inv-hayel",
        invoiceNumber: "INV-H1",
        customerName: "العميل هائل",
        balanceDue: 75000,
        currency: "SAR",
        date: "2026-10-24", // 30 days ago < 45 days custom term
        dueDate: null,
        status: "POSTED",
      },
    ],
  });

  assert.equal(alphaReport.counts.overdueReceivablesCount, 0);
  assert.equal(alphaReport.briefingAr.includes("الموجز التنفيذي اليومي"), true);
  assert.equal(
    alphaReport.appliedMemories.some((m) => m.tenantSlug === undefined && m.id === "mem-alpha"),
    true
  );
  assert.equal(
    alphaReport.briefingAr.includes("منشأة بيتا"),
    false
  );

  // English variant
  const enReport = generateExecutiveBriefing({
    tenantSlug: "tenant-alpha",
    date: "2026-11-23",
    lang: "en",
    user: "ADMIN",
    memories,
    inventoryItems: [
      {
        id: "cat-en",
        nameAr: "صناديق",
        nameEn: "Export Crates",
        unitName: "crate",
        qtyOnHand: 2,
        minStockAlert: 15,
      },
    ],
  });
  assert.equal(enReport.briefingEn.includes("Daily Executive Briefing"), true);
  assert.equal(enReport.lowStockAlerts[0].itemName, "Export Crates");
});

test("RBAC External Auditor mode restricts alert follow-up prompts to read-only inspection and preserves ConfirmationPreviewCard for writes", async () => {
  const viewerReport = generateExecutiveBriefing({
    tenantSlug: "al-rawdah",
    date: "2026-11-23",
    lang: "ar",
    user: "EXTERNAL_AUDITOR",
    salesInvoices: [
      {
        id: "inv-v1",
        invoiceNumber: "INV-V1",
        customerName: "عميل متأخر",
        balanceDue: 40000,
        currency: "YER",
        date: "2026-10-01",
        dueDate: "2026-10-15",
      },
    ],
  });

  assert.equal(viewerReport.role, "EXTERNAL_AUDITOR");
  assert.equal(viewerReport.overdueReceivableAlerts[0].followUpPromptAr.includes("مسودة سند قبض"), false);
  assert.equal(viewerReport.briefingAr.includes("وضع القراءة فقط"), true);

  // Admin clicking a write follow-up prompt still hits mandatory ConfirmationPreviewCard (never auto-posts!)
  const adminFollowUp = await runUasAiAgent(
    "جهّز مسودة سند قبض من العميل عميل متأخر بمبلغ 40000 ريال",
    {
      user: "SUPER_ADMIN",
      lang: "ar",
      state: INITIAL_FALLBACK_STATE,
    }
  );
  assert.equal(adminFollowUp.ok, true);
  assert.equal(adminFollowUp.requiresConfirmation, true);
  assert.ok(adminFollowUp.confirmationCard);
});

test("Offline Copilot agent routes briefing queries to get_daily_executive_briefing and Gemini synthesis degrades gracefully", async () => {
  const offlineRes = await runUasAiAgent("أعطني ملخص اليوم وتنبيهات المخزون", {
    user: "SUPER_ADMIN",
    lang: "ar",
    state: INITIAL_FALLBACK_STATE,
    workspaceContext: {
      tenantSlug: "al-rawdah",
      activeTab: "dashboard",
      dialect: "yemeni",
    },
  });

  assert.equal(offlineRes.ok, true);
  assert.equal(offlineRes.toolName, "get_daily_executive_briefing");
  assert.equal(offlineRes.requiresConfirmation, false);
  assert.equal(offlineRes.replyAr.includes("ملخص اليوم"), true);

  // Offline / unconfigured Gemini synthesis returns null cleanly
  const noKeySynth = await runGeminiBriefingSynthesis({
    briefing: generateExecutiveBriefing({ tenantSlug: "al-rawdah", lang: "en" }),
    geminiApiKey: "",
  });
  assert.equal(noKeySynth, null);

  // Mocked online Gemini copilot agent invokes get_daily_executive_briefing tool cleanly
  const fakeFactory: GeminiClientFactory = () => ({
    models: {
      generateContent: async () =>
        ({
          text: "تم استعراض الملخص التنفيذي اليومي وتنبيهات المخزون والذمم.",
          functionCalls: [],
        }) as never,
    },
  });

  const onlineRes = await runGeminiCopilotAgent("Give me my daily executive briefing", {
    user: "SUPER_ADMIN",
    lang: "en",
    state: INITIAL_FALLBACK_STATE,
    workspaceContext: { tenantSlug: "al-rawdah", activeTab: "dashboard" },
    geminiApiKey: "fake-key",
    clientFactory: fakeFactory,
  });
  assert.equal(onlineRes.ok, true);
  assert.equal(loadCachedExecutiveBriefing("al-rawdah", "2026-11-23"), null);
  saveCachedExecutiveBriefing(
    "al-rawdah",
    generateExecutiveBriefing({ tenantSlug: "al-rawdah", date: "2026-11-23" })
  );
});

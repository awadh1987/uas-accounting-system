import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_GEMINI_FAST_MODEL,
  DEFAULT_GEMINI_REASONING_MODEL,
  runGeminiCopilotAgent,
  runGeminiSupportSynthesis,
  selectGeminiModelForPrompt,
  type GeminiClientFactory,
} from "../src/lib/ai/geminiCopilotEngine";
import { runUasAiAgent } from "../src/lib/ai/offlineAgentEngine";
import {
  buildCopilotGreetingFallback,
  buildGeminiDialectInstruction,
  formatSpokenTextForGeminiTts,
} from "../src/lib/ai/yemeniLocalization";
import { POST as speakPost, synthesizeGeminiSpeechAudio } from "../src/app/api/ai/speak/route";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";
import type { UasBootstrapState } from "../src/types/uas";

function makeMockState(): UasBootstrapState {
  const s: UasBootstrapState = structuredClone(INITIAL_FALLBACK_STATE);
  s.projects = [
    {
      id: "prj-g1",
      code: "PRJ-001",
      name: "مشروع وادي حريب",
      status: "نشط",
      plannedHarvests: 2,
      harvests: ["القطفة الأولى", "القطفة الثانية"],
      budgetTotal: 150000,
    },
  ];
  s.inventoryBatches = [
    {
      id: "lot-g1",
      projectId: "prj-g1",
      harvest: "القطفة الأولى",
      grade: "رقم 1",
      harvestedBundles: 120,
      shrinkageBundles: 10,
      notes: "قطفة 1",
    },
  ];
  s.sales = [
    {
      id: "sal-g1",
      voucherNo: "RV-201",
      projectId: "prj-g1",
      harvest: "القطفة الأولى",
      grade: "رقم 1",
      customer: "شركة النصر",
      phone: "777000111",
      bundles: 115,
      price: 3000,
      total: 345000,
      credit: 200000,
      debit: 145000,
      date: "2026-11-22",
      notes: "بيع آجل",
    },
  ];
  s.lockedPeriods = { "prj-g1::القطفة الثانية": true };
  return s;
}

test("Gemini routing selects gemini-3.8-flash for operational tasks and gemini-4-argon for deep reasoning", () => {
  const prevFast = process.env.UAS_GEMINI_FAST_MODEL;
  const prevReason = process.env.UAS_GEMINI_REASONING_MODEL;
  try {
    delete process.env.UAS_GEMINI_FAST_MODEL;
    delete process.env.UAS_GEMINI_REASONING_MODEL;

    const fastSel = selectGeminiModelForPrompt("كم رصيد حساب الصندوق الرئيسي 111101؟", {
      activeTab: "treasury",
    });
    assert.equal(fastSel.model, DEFAULT_GEMINI_FAST_MODEL);
    assert.equal(fastSel.complexity, "operational");

    const proReconcile = selectGeminiModelForPrompt(
      "Reconcile harvest inventory shrinkage and explain any stock shortage discrepancies",
      { activeTab: "inventory" }
    );
    assert.equal(proReconcile.model, DEFAULT_GEMINI_REASONING_MODEL);
    assert.equal(proReconcile.complexity, "deep_reasoning");

    const proAudit = selectGeminiModelForPrompt("فحص وإغلاق القطفة محاسبياً وتدقيق الفروقات", {
      activeTab: "audit",
      pendingConflictsCount: 2,
    });
    assert.equal(proAudit.model, DEFAULT_GEMINI_REASONING_MODEL);
    assert.equal(proAudit.complexity, "deep_reasoning");

    // Env model overrides respected on server
    process.env.UAS_GEMINI_FAST_MODEL = "gemini-3.8-flash-custom";
    process.env.UAS_GEMINI_REASONING_MODEL = "gemini-4-argon-custom";
    assert.equal(selectGeminiModelForPrompt("Open sales module").model, "gemini-3.8-flash-custom");
    assert.equal(selectGeminiModelForPrompt("Run trial balance audit").model, "gemini-4-argon-custom");
  } finally {
    if (prevFast === undefined) delete process.env.UAS_GEMINI_FAST_MODEL;
    else process.env.UAS_GEMINI_FAST_MODEL = prevFast;
    if (prevReason === undefined) delete process.env.UAS_GEMINI_REASONING_MODEL;
    else process.env.UAS_GEMINI_REASONING_MODEL = prevReason;
  }
});

test("Gemini multi-step tool loop executes tools, preserves ConfirmationPreviewCard, and enforces RBAC", async () => {
  const state = makeMockState();
  const capturedCalls: Array<{ model: string; config?: Record<string, unknown> }> = [];
  let stepIndex = 0;

  const mockFactory: GeminiClientFactory = () => ({
    models: {
      generateContent: async ({ model, config }) => {
        capturedCalls.push({ model, config });
        stepIndex++;

        // Step 1: Gemini 4 Argon requests cross-section harvest reconciliation first
        if (stepIndex === 1) {
          return {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    { text: "Checking harvest stock reconciliation and customer AR first.", thought: true },
                    {
                      functionCall: {
                        id: "call-1",
                        name: "reconcile_harvest_inventory",
                        args: { projectId: "prj-g1", harvest: "القطفة الأولى" },
                      },
                    },
                  ],
                },
              },
            ],
            functionCalls: [
              {
                id: "call-1",
                name: "reconcile_harvest_inventory",
                args: { projectId: "prj-g1", harvest: "القطفة الأولى" },
              },
            ],
          } as never;
        }

        // Step 2: Gemini 4 Argon drafts period lock toggle (must NOT mutate DB directly; must emit ConfirmationPreviewCard)
        if (stepIndex === 2) {
          return {
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        id: "call-2",
                        name: "toggle_period_lock",
                        args: { projectId: "prj-g1", harvest: "القطفة الأولى" },
                      },
                    },
                  ],
                },
              },
            ],
            functionCalls: [
              {
                id: "call-2",
                name: "toggle_period_lock",
                args: { projectId: "prj-g1", harvest: "القطفة الأولى" },
              },
            ],
          } as never;
        }

        // Step 3: Gemini 4 Argon synthesizes grounded explanation asking user to confirm
        return {
          text: "I reconciled Harvest 1 (5-bundle shortage, 145,000 YER open receivables) and prepared the period lock confirmation card. Click Confirm to lock.",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "I reconciled Harvest 1 (5-bundle shortage, 145,000 YER open receivables) and prepared the period lock confirmation card. Click Confirm to lock.",
                  },
                ],
              },
            },
          ],
          functionCalls: undefined,
        } as never;
      },
    },
  });

  const res = await runGeminiCopilotAgent(
    "Reconcile Harvest 1 discrepancies and lock the period",
    {
      lang: "en",
      user: "CHIEF_ACCOUNTANT",
      state,
      workspaceContext: {
        activeTab: "audit",
        selectedProjectId: "prj-g1",
        selectedHarvest: "القطفة الأولى",
        tenantSlug: "aljabri",
      },
      geminiApiKey: "test-server-only-key",
      clientFactory: mockFactory,
    }
  );

  assert.equal(res.ok, true);
  assert.equal(res.tierUsed, "tier1_cloud_llm");
  assert.equal(res.modelUsed, "Gemini 4 Argon");
  assert.equal(res.taskComplexity, "deep_reasoning");
  assert.equal(capturedCalls[0]?.model, DEFAULT_GEMINI_REASONING_MODEL);
  assert.ok(capturedCalls[0]?.config?.thinkingConfig);
  assert.equal(res.requiresConfirmation, true);
  assert.equal(res.confirmationCard?.operationType, "TOGGLE_PERIOD_LOCK");
  assert.ok(res.replyEn.includes("145,000"));
  assert.ok(res.reasoningTrace.some((s) => s.toolName === "reconcile_harvest_inventory"));
  assert.ok(res.reasoningTrace.some((s) => s.toolName === "toggle_period_lock"));

  // Verify RBAC enforcement still blocks unauthorized role even inside Gemini function call loop
  let rbacStep = 0;
  const blockedFactory: GeminiClientFactory = () => ({
    models: {
      generateContent: async () => {
        rbacStep++;
        if (rbacStep === 1) {
          return {
            functionCalls: [
              {
                name: "draft_journal_entry",
                args: {
                  lines: [
                    { accountCode: "521101", debit: 5000, credit: 0 },
                    { accountCode: "111101", debit: 0, credit: 5000 },
                  ],
                },
              },
            ],
          } as never;
        }
        return { text: "Direct journal posting is blocked for your role." } as never;
      },
    },
  });

  const blockedRes = await runGeminiCopilotAgent("Post a journal entry debit 521101 5000 credit 111101 5000", {
    lang: "en",
    user: "EXTERNAL_AUDITOR",
    state,
    geminiApiKey: "test-server-only-key",
    clientFactory: blockedFactory,
  });
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.toolResult.code, "RBAC_FORBIDDEN");
  assert.equal(blockedRes.requiresConfirmation, false);
});

test("Gemini Copilot and Support cleanly fall back to deterministic local engine when key missing or SDK errors", async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    const state = makeMockState();

    // Missing key falls back automatically without failing
    const noKeyRes = await runGeminiCopilotAgent("كم رصيد حساب الصندوق الرئيسي 111101؟", {
      lang: "ar",
      user: "SUPER_ADMIN",
      state,
      geminiApiKey: "",
    });
    assert.equal(noKeyRes.ok, true);
    assert.equal(noKeyRes.tierUsed, "tier3_offline_deterministic");
    assert.equal(noKeyRes.modelUsed, "Offline Local Engine");
    assert.equal(noKeyRes.toolName, "query_account_balance");

    // Rate-limit / SDK failure also falls back cleanly
    const failingFactory: GeminiClientFactory = () => ({
      models: {
        generateContent: async () => {
          throw new Error("429 RESOURCE_EXHAUSTED");
        },
      },
    });
    const errorFallback = await runGeminiCopilotAgent("Reconcile harvest inventory", {
      lang: "en",
      user: "SUPER_ADMIN",
      state,
      geminiApiKey: "dummy-key",
      clientFactory: failingFactory,
    });
    assert.equal(errorFallback.ok, true);
    assert.equal(errorFallback.tierUsed, "tier3_offline_deterministic");
    assert.equal(errorFallback.modelUsed, "Offline Local Engine");
    assert.equal(errorFallback.toolName, "reconcile_harvest_inventory");

    // Support synthesis works when Gemini responds and returns null cleanly on missing key
    const supportMissing = await runGeminiSupportSynthesis({
      query: "How do I release a device?",
      lang: "en",
      baselineAnswerAr: "test",
      baselineAnswerEn: "Open device seats.",
      diagnosticsSummary: "ACTIVE",
      geminiApiKey: "",
    });
    assert.equal(supportMissing, null);
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

test("Security: GEMINI_API_KEY & @google/genai stay strictly server-side and excluded from client/APK/desktop bundles", () => {
  const clientFiles = [
    "src/components/UasAiCopilot.tsx",
    "src/components/UasAppShell.tsx",
    "src/lib/ai/offlineAgentEngine.ts",
    "src/lib/ai/uasAgentTools.ts",
    "src/lib/ai/yemeniLocalization.ts",
    "src/lib/localSupportEngine.ts",
  ];
  for (const relPath of clientFiles) {
    const content = fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
    assert.equal(
      content.includes("GEMINI_API_KEY") || content.includes("@google/genai"),
      false,
      `${relPath} must never import @google/genai or reference GEMINI_API_KEY`
    );
  }

  // Ensure UasAiCopilot attaches stored auth token headers for online Gemini calls
  const copilotSrc = fs.readFileSync(path.join(process.cwd(), "src/components/UasAiCopilot.tsx"), "utf8");
  assert.ok(copilotSrc.includes("getStoredSessionToken"));
  assert.ok(copilotSrc.includes("/api/ai/speak"));

  // Ensure no NEXT_PUBLIC_GEMINI_* anywhere in src/
  const srcRoot = path.join(process.cwd(), "src");
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  for (const file of walk(srcRoot)) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(
      /NEXT_PUBLIC_.*GEMINI/i.test(text),
      false,
      `Disallowed NEXT_PUBLIC Gemini env ref found in ${file}`
    );
  }
});

test("Model failover cascades from gemini-4-argon to gemini-3.8-flash before offline fallback", async () => {
  const state = makeMockState();
  const attemptedModels: string[] = [];

  const cascadeFactory: GeminiClientFactory = () => ({
    models: {
      generateContent: async ({ model }) => {
        attemptedModels.push(model);
        if (model === DEFAULT_GEMINI_REASONING_MODEL) {
          throw new Error("429 RESOURCE_EXHAUSTED on reasoning model");
        }
        return {
          text: "حياك الله يا غالي! تمت المراجعة بنجاح على مشروع وادي حريب عبر النموذج السريع.",
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: "حياك الله يا غالي! تمت المراجعة بنجاح على مشروع وادي حريب عبر النموذج السريع." }],
              },
            },
          ],
        } as never;
      },
    },
  });

  const res = await runGeminiCopilotAgent("Reconcile harvest inventory discrepancies", {
    lang: "ar",
    user: "SUPER_ADMIN",
    state,
    geminiApiKey: "test-server-only-key",
    clientFactory: cascadeFactory,
  });

  assert.equal(res.ok, true);
  assert.equal(res.tierUsed, "tier1_cloud_llm");
  assert.equal(res.modelUsed, "Gemini 3.8 Flash");
  assert.equal(res.diagnostics?.retriedWithFast, true);
  assert.equal(res.diagnostics?.primaryModel, DEFAULT_GEMINI_REASONING_MODEL);
  assert.equal(res.diagnostics?.activeModel, DEFAULT_GEMINI_FAST_MODEL);
  assert.ok(attemptedModels.includes(DEFAULT_GEMINI_REASONING_MODEL));
  assert.ok(attemptedModels.includes(DEFAULT_GEMINI_FAST_MODEL));
});

test("Yemeni localization, rich greetings, spoken TTS formatting & /api/ai/speak graceful fallback", async () => {
  const yemeniPrompt = buildGeminiDialectInstruction("ar", "yemeni");
  assert.ok(yemeniPrompt.includes("حياك الله"));
  assert.ok(yemeniPrompt.includes("القطفة"));
  assert.ok(yemeniPrompt.includes("العلاقية"));

  const msaPrompt = buildGeminiDialectInstruction("ar", "msa");
  assert.ok(msaPrompt.includes("الفصحى"));

  const greet = buildCopilotGreetingFallback({ lang: "ar", dialect: "yemeni", activeTab: "inventory", projectName: "مزرعة الجوف" });
  assert.ok(greet.ar.includes("يا هلا") && greet.ar.includes("مزرعة الجوف"));

  // Offline greeting should respond with full Yemeni welcome + live context rather than boilerplate
  const offlineGreeting = await runUasAiAgent("مرحبا", {
    lang: "ar",
    state: makeMockState(),
    workspaceContext: { activeTab: "sales", selectedProjectId: "prj-g1", dialect: "yemeni" },
  });
  assert.equal(offlineGreeting.ok, true);
  assert.equal(offlineGreeting.toolName, "analyze_workspace_context");
  assert.ok(offlineGreeting.replyAr.includes("حياك الله") && offlineGreeting.replyAr.includes("مشروع وادي حريب"));

  // Spoken TTS prep strips markdown & expands currencies cleanly
  const spoken = formatSpokenTextForGeminiTts("**تم ترحيل سند** RV-101 بمبلغ 5000 YER بنسبة 15%", { lang: "ar" });
  assert.equal(spoken.includes("**"), false);
  assert.ok(spoken.includes("ريال يمني"));
  assert.ok(spoken.includes("15 في المية"));

  // /api/ai/speak returns clean 503 fallback JSON when GEMINI_API_KEY is missing
  const prevKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    const ttsMissing = await synthesizeGeminiSpeechAudio({ text: "مرحبا بكم", lang: "ar", geminiApiKey: "" });
    assert.equal(ttsMissing.ok, false);

    const req = new Request("https://qat.world/api/ai/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "مرحبا بكم", lang: "ar", dialect: "yemeni" }),
    });
    const res = await speakPost(req as never);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.fallback, true);
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
  }
});

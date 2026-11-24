/**
 * UAS Enterprise — Server-Side Google GenAI (Gemini) Copilot Orchestrator
 *
 * Strictly server-only (`GEMINI_API_KEY` is read on the server and NEVER bundled
 * into browser, Capacitor APK, or desktop client assets).
 *
 * Model routing:
 *  - Operational queries & single-domain tasks -> `UAS_GEMINI_FAST_MODEL` (default `gemini-3.8-flash`)
 *  - Deep multi-step reconciliation, audit, discrepancy RCA & complex diagnostics ->
 *    `UAS_GEMINI_REASONING_MODEL` (default `gemini-4-argon`) with thinking enabled.
 *
 * Security & correctness invariants:
 *  - All tool calls pass through `executeUasAgentTool()` which enforces RBAC, COA rules,
 *    cross-section pre-flight checks, and mandatory user ConfirmationPreviewCards for writes.
 *  - Automatically falls back to deterministic local reasoning if `GEMINI_API_KEY` is
 *    missing, rate-limited, or throws.
 */
import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type Schema,
} from "@google/genai";
import { diagnoseLiveSystemState, normalizeSupportText } from "@/lib/localSupportEngine";
import { normalizeRole } from "@/lib/permissions";
import {
  buildGeminiDialectInstruction,
  type CopilotDialectMode,
} from "./yemeniLocalization";
import {
  UAS_AGENT_TOOL_SCHEMAS,
  executeUasAgentTool,
  type UasAgentExecutionContext,
  type UasAgentToolName,
  type UasAgentToolResult,
  type UasWorkspaceContext,
} from "./uasAgentTools";
import type { CopilotMemoryEntry } from "./copilotMemoryTypes";
import type { ExecutiveBriefingReport } from "./executiveBriefingEngine";
import { extractDocumentFromVisionImage } from "./copilotVisionExtractor";
import {
  runUasAiAgent,
  type AgentReasoningStep,
  type RunUasAiAgentOptions,
  type UasAiAgentResponse,
} from "./offlineAgentEngine";

export const DEFAULT_GEMINI_FAST_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_REASONING_MODEL = "gemini-4-argon";

export type GeminiTaskComplexity = "operational" | "deep_reasoning";

export interface GeminiModelSelection {
  model: string;
  fastModel: string;
  reasoningModel: string;
  complexity: GeminiTaskComplexity;
  reasonEn: string;
  reasonAr: string;
}

export interface GeminiClientLike {
  models: {
    generateContent: (params: {
      model: string;
      contents: Content[] | string;
      config?: Record<string, unknown>;
    }) => Promise<GenerateContentResponse>;
  };
}

export type GeminiClientFactory = (apiKey: string) => GeminiClientLike;

const DEEP_REASONING_PATTERN =
  /(?:مطابق|مقارن|تدقيق|مراجع|ميزان\s+المراجع|قائم[هة]\s+الدخل|مركز\s+مالي|عجز|فارق|تلف|تالف|فاقد|تحليل|تشخيص|تعارض|مزامن|توقيع|اقفال|إقفال|اسباب|سبب|audit|reconcil|discrepancy|shortage|shrinkage|spoilage|root\s+cause|diagnos|analyze|briefing|trial\s+balance|income\s+statement|balance\s+sheet|cash\s+flow|conflict|signature|period\s+lock|why\s+|explain\s+difference|compare)/i;

export function selectGeminiModelForPrompt(
  prompt: string,
  workspaceContext?: UasWorkspaceContext | null
): GeminiModelSelection {
  const fastModel =
    (typeof process !== "undefined" && process.env?.UAS_GEMINI_FAST_MODEL?.trim()) ||
    DEFAULT_GEMINI_FAST_MODEL;
  const reasoningModel =
    (typeof process !== "undefined" && process.env?.UAS_GEMINI_REASONING_MODEL?.trim()) ||
    DEFAULT_GEMINI_REASONING_MODEL;

  const norm = normalizeSupportText(prompt);
  const activeTab = workspaceContext?.activeTab;
  const hasSyncOrConflictSignals =
    (workspaceContext?.pendingConflictsCount ?? 0) > 0 ||
    (workspaceContext?.offlineQueueCount ?? 0) > 2;

  const isMultiClause =
    prompt.length > 140 ||
    /(?:\s+ثم\s+|\s+و(?:قارن|فحص|طابق|احسب)|\band\s+then\b|\bbefore\s+posting\b|\bacross\b)/i.test(
      norm
    );

  if (
    DEEP_REASONING_PATTERN.test(norm) ||
    isMultiClause ||
    (activeTab === "audit" && /(?:فحص|اقفال|قفل|تقرير|check|lock|report)/i.test(norm)) ||
    (hasSyncOrConflictSignals && /(?:حالة|sync|مزامنة|نظام|status)/i.test(norm))
  ) {
    return {
      model: reasoningModel,
      fastModel,
      reasoningModel,
      complexity: "deep_reasoning",
      reasonEn:
        "Routed to Gemini 4 Argon reasoning model due to multi-step reconciliation, audit, discrepancy, or diagnostic complexity.",
      reasonAr:
        "تم التوجيه إلى نموذج Gemini 4 Argon للتحليل العميق والمطابقة المتعددة الخطوات والتدقيق.",
    };
  }

  return {
    model: fastModel,
    fastModel,
    reasoningModel,
    complexity: "operational",
    reasonEn: "Routed to Gemini 3.8 Flash model for low-latency operational query or single-domain execution.",
    reasonAr: "تم التوجيه إلى نموذج Gemini 3.8 Flash للاستجابة السريعة وتنفيذ العمليات اليومية.",
  };
}

function buildFunctionDeclarations(): FunctionDeclaration[] {
  return UAS_AGENT_TOOL_SCHEMAS.map((tool) => {
    const properties: Record<string, Schema> = {};

    for (const [paramName, paramDesc] of Object.entries(tool.parameters)) {
      if (tool.name === "draft_journal_entry" && paramName === "lines") {
        properties[paramName] = {
          type: Type.ARRAY,
          description: paramDesc,
          items: {
            type: Type.OBJECT,
            properties: {
              accountCode: { type: Type.STRING, description: "5-level leaf COA code (e.g. 521101, 111101)" },
              debit: { type: Type.NUMBER, description: "Debit amount >= 0" },
              credit: { type: Type.NUMBER, description: "Credit amount >= 0" },
              memo: { type: Type.STRING, description: "Line memo" },
            },
            required: ["accountCode", "debit", "credit"],
          },
        };
      } else if (
        /^(amount|budgetTotal|creditLimit|plannedHarvests|quantity|unitPrice|harvestedBundles|shrinkageBundles|bundles|price|credit|qty|dailyWage|days|limit)$/i.test(
          paramName
        )
      ) {
        properties[paramName] = {
          type: Type.NUMBER,
          description: paramDesc,
        };
      } else if (paramName === "includeSaleDetails") {
        properties[paramName] = {
          type: Type.BOOLEAN,
          description: paramDesc,
        };
      } else {
        properties[paramName] = {
          type: Type.STRING,
          description: paramDesc,
        };
      }
    }

    return {
      name: tool.name,
      description: `${tool.descriptionEn} | ${tool.descriptionAr}`,
      parameters: {
        type: Type.OBJECT,
        properties,
      },
    };
  });
}

function buildSystemGroundingPrompt(
  ctx: UasAgentExecutionContext,
  lang: "ar" | "en"
): string {
  const wCtx = ctx.workspaceContext ?? {};
  const role = ctx.user ? normalizeRole(ctx.user) : "SUPER_ADMIN";
  const profile = ctx.state?.enterpriseProfile;
  const projects = (ctx.state?.projects ?? []).slice(0, 8).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    harvests: p.harvests,
    budgetTotal: p.budgetTotal,
  }));
  const treasuries = (ctx.state?.treasuryAccounts ?? []).slice(0, 8).map((t) => ({
    id: t.id,
    code: t.code,
    nameAr: t.nameAr || t.name,
    currency: t.currencyCode,
    balance: t.balance,
  }));
  const diagReport = diagnoseLiveSystemState({
    ...(ctx.diagnostics ?? {}),
    offline_queue_count: wCtx.offlineQueueCount ?? ctx.diagnostics?.offline_queue_count ?? 0,
    pending_conflicts_count: wCtx.pendingConflictsCount ?? ctx.diagnostics?.pending_conflicts_count ?? 0,
    is_offline: Boolean(wCtx.isOffline ?? ctx.diagnostics?.is_offline),
    tenant_slug: wCtx.tenantSlug ?? ctx.diagnostics?.tenant_slug ?? null,
    active_tab: wCtx.activeTab ?? ctx.diagnostics?.active_tab ?? null,
  });

  const groundingSnapshot = {
    tenant: {
      slug: wCtx.tenantSlug || profile?.tenantSlug || "default",
      companyAr: profile?.legalNameAr || "النظام المحاسبي الموحد",
      companyEn: profile?.legalNameEn || "UAS Enterprise",
    },
    actor: {
      role,
      preferredLocale: lang === "ar" ? "Arabic (RTL)" : "English (LTR)",
    },
    workspace: {
      activeTab: wCtx.activeTab || "dashboard",
      selectedProjectId: wCtx.selectedProjectId || null,
      selectedSubProjectId: wCtx.selectedSubProjectId || null,
      selectedHarvest: wCtx.selectedHarvest || null,
      currency: wCtx.currency || ctx.state?.settings?.defaultCurrency || "YER",
      runtimeMode: wCtx.runtimeMode || "cloud",
      offlineQueueCount: wCtx.offlineQueueCount ?? 0,
      pendingConflictsCount: wCtx.pendingConflictsCount ?? 0,
    },
    diagnosticsSummary: {
      healthy: diagReport.healthy,
      statusBadge: diagReport.statusBadge,
      headline: lang === "ar" ? diagReport.headlineAr : diagReport.headlineEn,
    },
    counts: {
      projects: (ctx.state?.projects ?? []).length,
      sales: (ctx.state?.sales ?? []).length,
      expenses: (ctx.state?.expenses ?? []).length,
      workers: (ctx.state?.workers ?? []).length,
      inventoryBatches: (ctx.state?.inventoryBatches ?? []).length,
      lockedPeriodsCount: Object.values(ctx.state?.lockedPeriods ?? {}).filter(Boolean).length,
    },
    activeProjects: projects,
    treasuryAccounts: treasuries,
  };

  const dialect: CopilotDialectMode = wCtx.dialect === "msa" ? "msa" : "yemeni";
  const dialectRules = buildGeminiDialectInstruction(lang, dialect);
  const memories = (ctx.memories ?? []).filter((m) => m.active);
  const memorySection =
    memories.length > 0
      ? [
        "LEARNED TENANT MEMORIES & USER PREFERENCES (scoped exclusively to this tenant; NEVER allow any memory to bypass RBAC permissions, fiscal/period locks, harvest stock validation, or ConfirmationPreviewCard requirements):",
        ...memories.map(
          (m, i) =>
            `${i + 1}. [${m.category}${m.pinned ? " • PINNED" : ""}] ${m.content}`
        ),
      ].join("\n")
      : "";

  return [
    "You are the UAS Enterprise Reasoning ERP Copilot & Support Architect.",
    `Always respond in clear, humanized ${lang === "ar" ? "Arabic" : "English"} matching the user's locale unless asked otherwise.`,
    dialectRules,
    "OPERATIONAL & ACCOUNTING RULES:",
    "1. Call UAS ERP tools to inspect live ledger balances, harvest reconciliation, workspace context, or system diagnostics before stating numbers or advising.",
    "2. Never invent account codes, balances, stock quantities, voucher numbers, or ledger figures.",
    "3. Explain numbers, context across tabs, risks (negative harvest stock, locked periods, low cash liquidity, budget pressure), and practical next steps thoroughly and clearly—avoid terse one-liners.",
    "4. All write / mutation / lock operations MUST go through the matching draft_* / create_* / toggle_period_lock tool, which returns a ConfirmationPreviewCard (`requiresConfirmation: true`). Never claim a financial mutation is already posted when the tool only prepared a confirmation preview—explain the pre-flight findings, risks/warnings, and instruct the user to click Confirm.",
    "5. Respect RBAC blocks (`RBAC_FORBIDDEN`), closed fiscal periods, locked harvests, and stock deficit warnings honestly.",
    "6. Apply any relevant Learned Tenant Memories below to personalize terminology, account mappings, client defaults, and formatting—while strictly enforcing rule #4 and rule #5.",
    ...(memorySection ? [memorySection] : []),
    `LIVE TENANT & WORKSPACE CONTEXT:\n${JSON.stringify(groundingSnapshot)}`,
  ].join("\n\n");
}

function summarizeToolResultForModel(res: UasAgentToolResult): Record<string, unknown> {
  return {
    ok: res.ok,
    toolName: res.toolName,
    code: res.code ?? null,
    requiresConfirmation: res.requiresConfirmation,
    navigationTab: res.navigationTab ?? null,
    openLicenseModal: Boolean(res.openLicenseModal),
    summaryAr: res.summaryAr,
    summaryEn: res.summaryEn,
    data: res.data ?? null,
    preFlightChecks: res.confirmationCard?.preFlightChecks ?? null,
    warningsAr: res.confirmationCard?.warningsAr ?? null,
    warningsEn: res.confirmationCard?.warningsEn ?? null,
    hasClarificationPrompt: Boolean(res.clarificationPrompt),
    hasEscalationCard: Boolean(res.escalationCard),
  };
}

export function formatGeminiModelLabel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("argon")) return "Gemini 4 Argon";
  if (lower.includes("flash")) return "Gemini 3.8 Flash";
  return model;
}

export interface GeminiConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface RunGeminiCopilotOptions extends RunUasAiAgentOptions {
  /** Explicit server-side API key override (defaults to `process.env.GEMINI_API_KEY`). */
  geminiApiKey?: string;
  /** Recent conversation turns to preserve multi-turn continuity. */
  conversationHistory?: GeminiConversationTurn[];
  /** Dependency injection hook for tests. */
  clientFactory?: GeminiClientFactory;
  /** Optional compressed image attachment for multimodal Vision OCR extraction. */
  imageAttachment?: {
    imageBase64: string;
    mimeType: string;
    fileName?: string;
  } | null;
}

async function generateWithModelCascade(params: {
  ai: GeminiClientLike;
  primaryModel: string;
  fastModel: string;
  contents: Content[];
  baseConfig: Record<string, unknown>;
  includeThinking: boolean;
}): Promise<{
  response: GenerateContentResponse;
  activeModel: string;
  retriedWithFast: boolean;
  fallbackReasons: string[];
}> {
  const { ai, primaryModel, fastModel, contents, baseConfig, includeThinking } = params;
  const attempts: Array<{ model: string; thinking: boolean; isFastFallback: boolean }> = [
    { model: primaryModel, thinking: includeThinking, isFastFallback: false },
  ];
  if (includeThinking) {
    attempts.push({ model: primaryModel, thinking: false, isFastFallback: false });
  }
  if (fastModel && fastModel !== primaryModel) {
    attempts.push({ model: fastModel, thinking: false, isFastFallback: true });
  }

  const fallbackReasons: string[] = [];
  let lastErr: unknown = null;

  for (const attempt of attempts) {
    const config: Record<string, unknown> = { ...baseConfig };
    if (attempt.thinking) {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: 2048,
      };
    }

    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents,
        config,
      });
      return {
        response,
        activeModel: attempt.model,
        retriedWithFast: attempt.isFastFallback,
        fallbackReasons,
      };
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      fallbackReasons.push(`${attempt.model}(thinking=${attempt.thinking}): ${msg.slice(0, 180)}`);
      console.warn(
        `[GeminiCopilotEngine] Model attempt failed [${attempt.model}, thinking=${attempt.thinking}]:`,
        msg.slice(0, 220)
      );
      // Only skip the thinking-off retry if error is clearly rate limit / not found and go straight to fastModel
      const isQuotaOrNotFound = /429|RESOURCE_EXHAUSTED|404|NOT_FOUND/i.test(msg);
      if (isQuotaOrNotFound && attempt.thinking && fastModel !== primaryModel) {
        // Still allow next iteration if it's fastModel, or continue loop
      }
    }
  }

  throw lastErr ?? new Error(fallbackReasons.join(" | ") || "ALL_GEMINI_MODELS_FAILED");
}

export async function runGeminiCopilotAgent(
  prompt: string,
  opts: RunGeminiCopilotOptions = {}
): Promise<UasAiAgentResponse> {
  const cleanPrompt = String(prompt ?? "").trim();
  const lang: "ar" | "en" =
    opts.lang ?? (/[\u0600-\u06FF]/.test(cleanPrompt) ? "ar" : "en");

  // 1. Multimodal Image Attachment path (Receipts, Vouchers, Harvest Tally Sheets)
  if (opts.imageAttachment?.imageBase64) {
    const visionRes = await extractDocumentFromVisionImage({
      imageBase64: opts.imageAttachment.imageBase64,
      mimeType: opts.imageAttachment.mimeType,
      fileName: opts.imageAttachment.fileName,
      prompt: cleanPrompt,
      lang,
      dialect: opts.workspaceContext?.dialect ?? "yemeni",
      tenantSlug: opts.workspaceContext?.tenantSlug ?? undefined,
      state: opts.state,
      memories: opts.memories,
      selectedProjectId: opts.workspaceContext?.selectedProjectId,
      selectedHarvest: opts.workspaceContext?.selectedHarvest,
      geminiApiKey: opts.geminiApiKey,
      clientFactory: opts.clientFactory,
    });

    if (!visionRes.ok) {
      return {
        ok: false,
        lang,
        tierUsed: "tier3_offline_deterministic",
        modelUsed: "Vision Fallback",
        fallbackReason: visionRes.code,
        prompt: cleanPrompt,
        reply: lang === "ar" ? visionRes.errorAr : visionRes.errorEn,
        replyAr: visionRes.errorAr,
        replyEn: visionRes.errorEn,
        toolName: "analyze_workspace_context",
        toolArgs: {},
        toolResult: {
          ok: false,
          toolName: "analyze_workspace_context",
          code: visionRes.code,
          requiresConfirmation: false,
          summaryAr: visionRes.errorAr,
          summaryEn: visionRes.errorEn,
          summary: lang === "ar" ? visionRes.errorAr : visionRes.errorEn,
        },
        requiresConfirmation: false,
        reasoningTrace: [
          {
            step: 1,
            type: "observation",
            titleAr: "تعذر القراءة البصرية للصورة",
            titleEn: "Vision OCR Unavailable",
            detailAr: visionRes.errorAr,
            detailEn: visionRes.errorEn,
          },
        ],
      };
    }

    const { extraction } = visionRes;
    const toolResult = await executeUasAgentTool(
      extraction.mappedToolCall.toolName,
      extraction.mappedToolCall.args,
      {
        ...opts,
        lang,
        sourceAttachment: extraction.sourceAttachment ?? opts.sourceAttachment,
      }
    );
    const replyAr = `${extraction.summaryAr}\n\n${toolResult.summaryAr}`;
    const replyEn = `${extraction.summaryEn}\n\n${toolResult.summaryEn}`;

    return {
      ok: toolResult.ok,
      lang,
      tierUsed: "tier1_cloud_llm",
      modelUsed: extraction.modelUsed,
      modelId: extraction.modelId,
      taskComplexity: extraction.escalatedToReasoningModel
        ? "deep_reasoning"
        : "operational",
      prompt: cleanPrompt || "Vision document extraction",
      reply: lang === "ar" ? replyAr : replyEn,
      replyAr,
      replyEn,
      toolName: extraction.mappedToolCall.toolName,
      toolArgs: extraction.mappedToolCall.args,
      toolResult,
      requiresConfirmation: Boolean(
        toolResult.confirmationCard || toolResult.requiresConfirmation
      ),
      confirmationCard: toolResult.confirmationCard,
      clarificationPrompt: toolResult.clarificationPrompt,
      escalationCard: toolResult.escalationCard,
      visionExtraction: extraction,
      reasoningTrace: [
        {
          step: 1,
          type: "thought",
          titleAr: `1. تحليل الصورة (${extraction.modelUsed})`,
          titleEn: `1. Multimodal Vision Analysis (${extraction.modelUsed})`,
          detailAr: extraction.summaryAr,
          detailEn: extraction.summaryEn,
        },
        {
          step: 2,
          type: "tool_call",
          titleAr: `2. تعبئة أداة المسودة (${extraction.mappedToolCall.toolName})`,
          titleEn: `2. Draft Tool Staging (${extraction.mappedToolCall.toolName})`,
          detailAr: JSON.stringify(extraction.mappedToolCall.args),
          detailEn: JSON.stringify(extraction.mappedToolCall.args),
          toolName: extraction.mappedToolCall.toolName,
          toolArgs: extraction.mappedToolCall.args,
        },
      ],
    };
  }

  // 2. If explicitTool shortcut was requested or no prompt provided, reuse direct tool path
  if (opts.explicitTool || !cleanPrompt) {
    return runUasAiAgent(cleanPrompt, opts);
  }

  // 2. Strictly server-side API key check; fallback cleanly if absent
  const apiKey =
    opts.geminiApiKey ??
    (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY?.trim() : "");
  if (!apiKey) {
    const fallback = await runUasAiAgent(cleanPrompt, opts);
    return {
      ...fallback,
      modelUsed: fallback.modelUsed || "Offline Local Engine",
      fallbackReason: "GEMINI_API_KEY_UNCONFIGURED",
    };
  }

  const selection = selectGeminiModelForPrompt(cleanPrompt, opts.workspaceContext);
  const modelLabel = formatGeminiModelLabel(selection.model);
  const reasoningTrace: AgentReasoningStep[] = [
    {
      step: 1,
      type: "thought",
      titleAr: `1. التوجيه الذكي (${modelLabel}) وفحص السياق`,
      titleEn: `1. Model Routing (${modelLabel}) & Context Grounding`,
      detailAr: `${selection.reasonAr} [النموذج: ${selection.model}]`,
      detailEn: `${selection.reasonEn} [Model: ${selection.model}]`,
    },
  ];

  try {
    const ai: GeminiClientLike = opts.clientFactory
      ? opts.clientFactory(apiKey)
      : new GoogleGenAI({ apiKey });

    const declarations = buildFunctionDeclarations();
    const systemInstruction = buildSystemGroundingPrompt(
      { ...opts, lang },
      lang
    );

    const historyContents: Content[] = (opts.conversationHistory ?? [])
      .slice(-8)
      .filter((h) => h && typeof h.text === "string" && h.text.trim().length > 0)
      .map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.text.trim().slice(0, 1500) }],
      }));

    const contents: Content[] = [
      ...historyContents,
      {
        role: "user",
        parts: [{ text: cleanPrompt }],
      },
    ];

    let stepNum = 2;
    let lastToolName: UasAgentToolName = "analyze_workspace_context";
    let lastToolArgs: Record<string, unknown> = {};
    let lastToolResult: UasAgentToolResult | null = null;
    let preservedConfirmationCard = undefined as UasAiAgentResponse["confirmationCard"];
    let preservedClarificationPrompt = undefined as UasAiAgentResponse["clarificationPrompt"];
    let preservedEscalationCard = undefined as UasAiAgentResponse["escalationCard"];
    let preservedNavTab = undefined as UasAiAgentResponse["navigationTab"];
    let preservedOpenLicense = false;
    const collectedCitations: NonNullable<UasAiAgentResponse["citations"]> = [];
    let finalText = "";
    let activeModelUsed = selection.model;
    let retriedWithFastModel = false;
    const allFallbackReasons: string[] = [];

    const MAX_TURNS = 4;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const baseConfig: Record<string, unknown> = {
        systemInstruction,
        temperature: selection.complexity === "deep_reasoning" ? 0.25 : 0.35,
        tools: [{ functionDeclarations: declarations }],
      };

      const cascadeRes = await generateWithModelCascade({
        ai,
        primaryModel: turn === 0 ? selection.model : activeModelUsed,
        fastModel: selection.fastModel,
        contents,
        baseConfig,
        includeThinking:
          selection.complexity === "deep_reasoning" &&
          (turn === 0 ? selection.model : activeModelUsed) === selection.reasoningModel,
      });

      const response = cascadeRes.response;
      activeModelUsed = cascadeRes.activeModel;
      if (cascadeRes.retriedWithFast) retriedWithFastModel = true;
      if (cascadeRes.fallbackReasons.length > 0) {
        allFallbackReasons.push(...cascadeRes.fallbackReasons);
      }

      const candidateContent = response.candidates?.[0]?.content;
      const thoughtSummaries = (candidateContent?.parts ?? [])
        .filter((p) => Boolean((p as { thought?: boolean }).thought) && typeof p.text === "string")
        .map((p) => p.text?.trim())
        .filter(Boolean) as string[];

      if (thoughtSummaries.length > 0) {
        reasoningTrace.push({
          step: stepNum++,
          type: "thought",
          titleAr: `تفكير ${modelLabel}`,
          titleEn: `${modelLabel} Reasoning`,
          detailAr: thoughtSummaries.join("\n").slice(0, 600),
          detailEn: thoughtSummaries.join("\n").slice(0, 600),
        });
      }

      const fnCalls = response.functionCalls ?? [];
      if (fnCalls.length === 0) {
        finalText = (response.text || "").trim();
        break;
      }

      if (candidateContent) {
        contents.push(candidateContent);
      } else {
        contents.push({
          role: "model",
          parts: fnCalls.map((fc) => ({
            functionCall: {
              id: fc.id,
              name: fc.name,
              args: (fc.args ?? {}) as Record<string, unknown>,
            },
          })),
        });
      }

      const fnResponseParts = [];
      for (const fc of fnCalls) {
        const rawToolName = String(fc.name || "") as UasAgentToolName;
        const isKnownTool = UAS_AGENT_TOOL_SCHEMAS.some((s) => s.name === rawToolName);
        if (!isKnownTool) {
          fnResponseParts.push({
            functionResponse: {
              id: fc.id,
              name: rawToolName || "unknown",
              response: { error: `Unknown tool: ${rawToolName}` },
            },
          });
          continue;
        }

        const args = (fc.args && typeof fc.args === "object" ? fc.args : {}) as Record<string, unknown>;
        lastToolName = rawToolName;
        lastToolArgs = args;

        reasoningTrace.push({
          step: stepNum++,
          type: "tool_call",
          titleAr: `استدعاء الأداة (${rawToolName})`,
          titleEn: `Tool Call (${rawToolName})`,
          detailAr: `تنفيذ ${rawToolName} مع التحقق من الصلاحيات والسياق: \`${JSON.stringify(args)}\``,
          detailEn: `Executing ${rawToolName} with RBAC & workspace checks: \`${JSON.stringify(args)}\``,
          toolName: rawToolName,
          toolArgs: args,
        });

        const toolRes = await executeUasAgentTool(rawToolName, args, {
          ...opts,
          lang,
        });
        lastToolResult = toolRes;
        if (toolRes.confirmationCard) preservedConfirmationCard = toolRes.confirmationCard;
        if (toolRes.clarificationPrompt) preservedClarificationPrompt = toolRes.clarificationPrompt;
        if (toolRes.escalationCard) preservedEscalationCard = toolRes.escalationCard;
        if (toolRes.navigationTab) preservedNavTab = toolRes.navigationTab;
        if (toolRes.openLicenseModal) preservedOpenLicense = true;
        if (toolRes.citations) {
          for (const c of toolRes.citations) {
            if (!collectedCitations.some((e) => e.tab === c.tab && e.labelEn === c.labelEn)) {
              collectedCitations.push(c);
            }
          }
        }

        reasoningTrace.push({
          step: stepNum++,
          type: "observation",
          titleAr: `نتيجة الفحص (${rawToolName})`,
          titleEn: `Observation (${rawToolName})`,
          detailAr: toolRes.requiresConfirmation
            ? "تم إعداد بطاقة معاينة وتأكيد إلزامية — بانتظار موافقة المستخدم قبل التنفيذ."
            : toolRes.ok
              ? "تمت قراءة/فحص البيانات بنجاح."
              : `تم المنع/التوقف: ${toolRes.code || "BLOCKED"}`,
          detailEn: toolRes.requiresConfirmation
            ? "Prepared mandatory ConfirmationPreviewCard gate — awaiting explicit user confirmation."
            : toolRes.ok
              ? "Tool observation returned cleanly."
              : `Blocked by guardrail: ${toolRes.code || "BLOCKED"}`,
        });

        fnResponseParts.push({
          functionResponse: {
            id: fc.id,
            name: rawToolName,
            response: summarizeToolResultForModel(toolRes),
          },
        });
      }

      contents.push({
        role: "user",
        parts: fnResponseParts,
      });
    }

    // Ensure if Gemini produced a pure text reply without tool calls, build safe neutral toolResult
    if (!lastToolResult) {
      if (!finalText) {
        return await runUasAiAgent(cleanPrompt, opts);
      }
      lastToolResult = {
        ok: true,
        toolName: "analyze_workspace_context",
        requiresConfirmation: false,
        summaryAr: finalText,
        summaryEn: finalText,
        summary: finalText,
      };
    }

    const effectiveModelLabel = formatGeminiModelLabel(activeModelUsed);
    const effectiveReply =
      finalText || (lang === "ar" ? lastToolResult.summaryAr : lastToolResult.summaryEn);

    reasoningTrace.push({
      step: stepNum,
      type: "response",
      titleAr: `الاستجابة النهائية (${effectiveModelLabel})`,
      titleEn: `Final Response (${effectiveModelLabel})`,
      detailAr: `تمت الصياغة بواسطة ${effectiveModelLabel} (${selection.complexity})${retriedWithFastModel ? " بعد التحويل التلقائي للنموذج السريع" : ""}.`,
      detailEn: `Synthesized by ${effectiveModelLabel} (${selection.complexity})${retriedWithFastModel ? " via fast-model failover" : ""}.`,
    });

    return {
      ok: lastToolResult.ok,
      lang,
      tierUsed: "tier1_cloud_llm",
      modelUsed: effectiveModelLabel,
      modelId: activeModelUsed,
      taskComplexity: selection.complexity,
      fallbackReason: allFallbackReasons.length > 0 ? allFallbackReasons.join(" | ") : undefined,
      diagnostics: {
        primaryModel: selection.model,
        activeModel: activeModelUsed,
        retriedWithFast: retriedWithFastModel,
        fallbackReason: allFallbackReasons.length > 0 ? allFallbackReasons.join(" | ") : undefined,
      },
      prompt: cleanPrompt,
      reply: effectiveReply,
      replyAr: finalText || lastToolResult.summaryAr,
      replyEn: finalText || lastToolResult.summaryEn,
      toolName: lastToolName,
      toolArgs: lastToolArgs,
      toolResult: lastToolResult,
      requiresConfirmation: Boolean(preservedConfirmationCard || lastToolResult.requiresConfirmation),
      confirmationCard: preservedConfirmationCard ?? lastToolResult.confirmationCard,
      navigationTab: preservedNavTab ?? lastToolResult.navigationTab,
      openLicenseModal: preservedOpenLicense || lastToolResult.openLicenseModal,
      citations: collectedCitations.length > 0 ? collectedCitations : lastToolResult.citations,
      clarificationPrompt: preservedClarificationPrompt ?? lastToolResult.clarificationPrompt,
      escalationCard: preservedEscalationCard ?? lastToolResult.escalationCard,
      reasoningTrace,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn("[GeminiCopilotEngine] Falling back to offline deterministic engine:", errMsg);
    const fallback = await runUasAiAgent(cleanPrompt, opts);
    return {
      ...fallback,
      modelUsed: "Offline Local Engine",
      fallbackReason: errMsg || "GEMINI_ERROR",
      diagnostics: {
        primaryModel: selection.model,
        activeModel: "offline_deterministic",
        retriedWithFast: selection.model !== selection.fastModel,
        fallbackReason: errMsg || "GEMINI_ERROR",
      },
    };
  }
}

export async function runGeminiSupportSynthesis(params: {
  query: string;
  lang: "ar" | "en";
  dialect?: CopilotDialectMode;
  baselineAnswerAr: string;
  baselineAnswerEn: string;
  diagnosticsSummary: string;
  memories?: CopilotMemoryEntry[];
  geminiApiKey?: string;
  clientFactory?: GeminiClientFactory;
}): Promise<{ text: string; modelUsed: string } | null> {
  const apiKey =
    params.geminiApiKey ??
    (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY?.trim() : "");
  if (!apiKey || !params.query.trim()) return null;

  const selection = selectGeminiModelForPrompt(params.query);
  const dialectRules = buildGeminiDialectInstruction(params.lang, params.dialect ?? "yemeni");
  try {
    const ai: GeminiClientLike = params.clientFactory
      ? params.clientFactory(apiKey)
      : new GoogleGenAI({ apiKey });

    const baseline = params.lang === "ar" ? params.baselineAnswerAr : params.baselineAnswerEn;
    const cascadeRes = await generateWithModelCascade({
      ai,
      primaryModel: selection.model,
      fastModel: selection.fastModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `User Support Question (${params.lang === "ar" ? "Arabic" : "English"}): ${params.query}\n\n` +
                `Live Diagnostics Summary:\n${params.diagnosticsSummary}\n\n` +
                `Verified Knowledge Base Answer:\n${baseline}`,
            },
          ],
        },
      ],
      baseConfig: {
        systemInstruction: [
          `You are UAS Customer Support & ERP Guide. Respond naturally and warmly in ${params.lang === "ar" ? "Arabic" : "English"} grounded in the provided Live Diagnostics Summary and Verified Knowledge Base Answer. Preserve exact error codes, seat limits (7 users × 1 Win + 1 Android), and clear step-by-step instructions.`,
          dialectRules,
          ...(params.memories && params.memories.length > 0
            ? [
              "LEARNED TENANT CONTEXT:\n" +
              params.memories.map((m, i) => `${i + 1}. [${m.category}] ${m.content}`).join("\n"),
            ]
            : []),
        ].join("\n\n"),
        temperature: 0.3,
      },
      includeThinking: false,
    });
    const text = (cascadeRes.response.text || "").trim();
    if (!text) return null;
    return {
      text,
      modelUsed: formatGeminiModelLabel(cascadeRes.activeModel),
    };
  } catch (err: unknown) {
    console.warn("[GeminiSupportSynthesis] Falling back to offline KB answer:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function runGeminiBriefingSynthesis(params: {
  briefing: ExecutiveBriefingReport;
  geminiApiKey?: string;
  clientFactory?: GeminiClientFactory;
}): Promise<{ text: string; modelUsed: string } | null> {
  const apiKey =
    params.geminiApiKey ??
    (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY?.trim() : "");
  if (!apiKey) return null;

  const b = params.briefing;
  const selection = selectGeminiModelForPrompt(
    b.counts.criticalAlertsCount > 0
      ? "analyze executive briefing low stock shortage overdue receivables"
      : "daily operational briefing summary"
  );
  const dialectRules = buildGeminiDialectInstruction(b.lang, b.dialect);

  try {
    const ai: GeminiClientLike = params.clientFactory
      ? params.clientFactory(apiKey)
      : new GoogleGenAI({ apiKey });

    const baseline = b.lang === "ar" ? b.briefingAr : b.briefingEn;
    const cascadeRes = await generateWithModelCascade({
      ai,
      primaryModel: selection.model,
      fastModel: selection.fastModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `Tenant: ${b.tenantSlug} | Date: ${b.date} | Actor Role: ${b.role}\n` +
                `KPIs: ${JSON.stringify(b.counts)}\n` +
                `Low-Stock Alerts (${b.lowStockAlerts.length}): ${b.lowStockAlerts.slice(0, 5).map((a) => (b.lang === "ar" ? a.summaryAr : a.summaryEn)).join(" | ") || "None"}\n` +
                `Overdue Receivables (${b.overdueReceivableAlerts.length}): ${b.overdueReceivableAlerts.slice(0, 5).map((a) => (b.lang === "ar" ? a.summaryAr : a.summaryEn)).join(" | ") || "None"}\n` +
                `Applied Tenant Memories: ${b.appliedMemories.map((m) => m.content).join(" | ") || "None"}\n\n` +
                `Deterministic Baseline Briefing:\n${baseline}`,
            },
          ],
        },
      ],
      baseConfig: {
        systemInstruction: [
          `You are UAS Enterprise Executive Briefing Advisor. Deliver a concise, warm, humanized ${b.lang === "ar" ? "Arabic" : "English"} daily executive briefing for role (${b.role}) grounded STRICTLY in the provided KPIs, low-stock alerts, overdue receivables, and tenant memories. Never invent numbers or suggest bypassing RBAC/confirmation cards.`,
          dialectRules,
        ].join("\n\n"),
        temperature: 0.25,
      },
      includeThinking: false,
    });

    const text = (cascadeRes.response.text || "").trim();
    if (!text) return null;
    return {
      text,
      modelUsed: formatGeminiModelLabel(cascadeRes.activeModel),
    };
  } catch (err: unknown) {
    console.warn(
      "[GeminiBriefingSynthesis] Falling back to structured executive briefing:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

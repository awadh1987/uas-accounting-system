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
  UAS_AGENT_TOOL_SCHEMAS,
  executeUasAgentTool,
  type UasAgentExecutionContext,
  type UasAgentToolName,
  type UasAgentToolResult,
  type UasWorkspaceContext,
} from "./uasAgentTools";
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

  return [
    "You are the UAS Enterprise Reasoning ERP Copilot & Support Architect.",
    `Always respond in clear, humanized ${lang === "ar" ? "Arabic" : "English"} matching the user's locale unless asked otherwise.`,
    "RULES:",
    "1. Call UAS ERP tools to inspect live ledger balances, harvest reconciliation, workspace context, or system diagnostics before stating numbers or advising.",
    "2. Never invent account codes, balances, stock quantities, voucher numbers, or ledger figures.",
    "3. All write / mutation / lock operations MUST go through the matching draft_* / create_* / toggle_period_lock tool, which returns a ConfirmationPreviewCard (`requiresConfirmation: true`). Never claim a financial mutation is already posted when the tool only prepared a confirmation preview—explain the pre-flight findings, risks/warnings, and instruct the user to click Confirm.",
    "4. Respect RBAC blocks (`RBAC_FORBIDDEN`), closed fiscal periods, locked harvests, and stock deficit warnings honestly.",
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

function formatGeminiModelLabel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("argon")) return "Gemini 4 Argon";
  if (lower.includes("flash")) return "Gemini 3.8 Flash";
  return model;
}

export interface RunGeminiCopilotOptions extends RunUasAiAgentOptions {
  /** Explicit server-side API key override (defaults to `process.env.GEMINI_API_KEY`). */
  geminiApiKey?: string;
  /** Dependency injection hook for tests. */
  clientFactory?: GeminiClientFactory;
}

export async function runGeminiCopilotAgent(
  prompt: string,
  opts: RunGeminiCopilotOptions = {}
): Promise<UasAiAgentResponse> {
  const cleanPrompt = String(prompt ?? "").trim();
  const lang: "ar" | "en" =
    opts.lang ?? (/[\u0600-\u06FF]/.test(cleanPrompt) ? "ar" : "en");

  // 1. If explicitTool shortcut was requested or no prompt provided, reuse direct tool path
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

    const contents: Content[] = [
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

    const MAX_TURNS = 4;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const config: Record<string, unknown> = {
        systemInstruction,
        temperature: selection.complexity === "deep_reasoning" ? 0.2 : 0.3,
        tools: [{ functionDeclarations: declarations }],
      };

      if (selection.complexity === "deep_reasoning") {
        config.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: 2048,
        };
      }

      const response = await ai.models.generateContent({
        model: selection.model,
        contents,
        config,
      });

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

    const effectiveReply =
      finalText || (lang === "ar" ? lastToolResult.summaryAr : lastToolResult.summaryEn);

    reasoningTrace.push({
      step: stepNum,
      type: "response",
      titleAr: `الاستجابة النهائية (${modelLabel})`,
      titleEn: `Final Response (${modelLabel})`,
      detailAr: `تمت الصياغة بواسطة ${modelLabel} (${selection.complexity}).`,
      detailEn: `Synthesized by ${modelLabel} (${selection.complexity}).`,
    });

    return {
      ok: lastToolResult.ok,
      lang,
      tierUsed: "tier1_cloud_llm",
      modelUsed: modelLabel,
      modelId: selection.model,
      taskComplexity: selection.complexity,
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
    };
  }
}

export async function runGeminiSupportSynthesis(params: {
  query: string;
  lang: "ar" | "en";
  baselineAnswerAr: string;
  baselineAnswerEn: string;
  diagnosticsSummary: string;
  geminiApiKey?: string;
  clientFactory?: GeminiClientFactory;
}): Promise<{ text: string; modelUsed: string } | null> {
  const apiKey =
    params.geminiApiKey ??
    (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY?.trim() : "");
  if (!apiKey || !params.query.trim()) return null;

  const selection = selectGeminiModelForPrompt(params.query);
  try {
    const ai: GeminiClientLike = params.clientFactory
      ? params.clientFactory(apiKey)
      : new GoogleGenAI({ apiKey });

    const baseline = params.lang === "ar" ? params.baselineAnswerAr : params.baselineAnswerEn;
    const res = await ai.models.generateContent({
      model: selection.model,
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
      config: {
        systemInstruction:
          `You are UAS Customer Support. Write a concise, helpful, humanized response in ${params.lang === "ar" ? "Arabic" : "English"} grounded strictly in the provided Live Diagnostics Summary and Verified Knowledge Base Answer. Preserve exact error codes, seat limits (7 users × 1 Win + 1 Android), and remediation steps.`,
        temperature: 0.25,
        ...(selection.complexity === "deep_reasoning"
          ? { thinkingConfig: { includeThoughts: false, thinkingBudget: 1024 } }
          : {}),
      },
    });
    const text = (res.text || "").trim();
    if (!text) return null;
    return {
      text,
      modelUsed: formatGeminiModelLabel(selection.model),
    };
  } catch (err: unknown) {
    console.warn("[GeminiSupportSynthesis] Falling back to offline KB answer:", err instanceof Error ? err.message : err);
    return null;
  }
}

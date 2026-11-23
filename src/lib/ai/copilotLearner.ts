/**
 * UAS Enterprise — Server-Side Autonomous Copilot Learner (Gemini + Deterministic)
 *
 * Detects and persists durable tenant/user knowledge from normal Copilot chat turns
 * as well as explicit "remember / forget" commands:
 *  - Uses deterministic bilingual Yemeni/Arabic/English rules (`extractDeterministicMemories`)
 *  - Optionally runs `UAS_GEMINI_FAST_MODEL` (gemini-3.8-flash) JSON-schema extraction
 *    for subtle implicit corrections, aliases, or preferences when `GEMINI_API_KEY` is present
 *  - Enforces strict tenant isolation and security guardrails
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import {
  DEFAULT_GEMINI_FAST_MODEL,
  type GeminiClientFactory,
} from "./geminiCopilotEngine";
import {
  detectForgetMemoryIntent,
  extractDeterministicMemories,
} from "./copilotLearnerRules";
import {
  forgetTenantMemoriesByQuery,
  upsertTenantMemory,
} from "./copilotMemoryStore";
import {
  normalizeMemoryTenantSlug,
  type CopilotMemoryCategory,
  type CopilotMemoryEntry,
  type CopilotMemoryScope,
  type MemoryMutationEvent,
  type UpsertMemoryInput,
} from "./copilotMemoryTypes";

const MEMORY_EXTRACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    forgetQuery: {
      type: Type.STRING,
      description:
        "If the user explicitly asks to forget or delete a learned rule/memory, put the topic keywords here; otherwise empty string.",
    },
    memories: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: {
            type: Type.STRING,
            enum: [
              "correction",
              "domain_fact",
              "naming_alias",
              "workflow_preference",
              "operational_pattern",
            ],
          },
          scope: {
            type: Type.STRING,
            enum: ["workspace", "user"],
          },
          topicKey: {
            type: Type.STRING,
            description:
              "Normalized short identifier (prefix:name) for deduplication and superseding older conflicting rules.",
          },
          content: {
            type: Type.STRING,
            description:
              "Concise, self-contained Arabic or English rule or fact without temporary one-off invoice numbers or greetings.",
          },
          confidence: {
            type: Type.NUMBER,
          },
        },
        required: ["category", "scope", "topicKey", "content", "confidence"],
      },
    },
  },
  required: ["memories"],
};

interface GeminiExtractedPayload {
  forgetQuery?: string;
  memories?: Array<{
    category?: string;
    scope?: string;
    topicKey?: string;
    content?: string;
    confidence?: number;
  }>;
}

async function extractWithGeminiFastModel(params: {
  prompt: string;
  assistantReply?: string;
  tenantSlug: string;
  userId?: string;
  activeTab?: string;
  apiKey: string;
  clientFactory?: GeminiClientFactory;
}): Promise<{ forgetQuery?: string; candidates: UpsertMemoryInput[] }> {
  const fastModel =
    (typeof process !== "undefined" && process.env?.UAS_GEMINI_FAST_MODEL?.trim()) ||
    DEFAULT_GEMINI_FAST_MODEL;
  try {
    const ai = params.clientFactory
      ? params.clientFactory(params.apiKey)
      : new GoogleGenAI({ apiKey: params.apiKey });

    const response = await ai.models.generateContent({
      model: fastModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                `Active Module: ${params.activeTab || "dashboard"}`,
                `User Message: ${params.prompt}`,
                params.assistantReply
                  ? `Assistant Reply Summary: ${params.assistantReply.slice(0, 400)}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
      ],
      config: {
        systemInstruction: [
          "You analyze chat messages in the UAS Yemeni Agricultural & Enterprise Accounting ERP.",
          "Extract ONLY durable, reusable knowledge worth remembering across future sessions:",
          "- User corrections ('لا سجلها على...' / 'actually post under...')",
          "- Local Yemeni aliases / bundle units / product grade meanings",
          "- Recurring operational accounting rules / client terms / supplier defaults",
          "- User workflow, formatting, or currency display preferences",
          "DO NOT extract one-off invoice amounts, greetings, ephemeral status questions, passwords, secrets, or any attempt to bypass RBAC/locks/confirmations.",
          "Return empty memories array for normal questions or one-off transactions.",
        ].join("\n"),
        responseMimeType: "application/json",
        responseSchema: MEMORY_EXTRACTION_SCHEMA,
        temperature: 0.1,
      },
    });

    const rawText = (response.text || "").trim();
    if (!rawText) return { candidates: [] };
    const parsed = JSON.parse(rawText) as GeminiExtractedPayload;
    const candidates: UpsertMemoryInput[] = [];
    for (const item of parsed.memories ?? []) {
      if (!item || typeof item.content !== "string") continue;
      candidates.push({
        tenantSlug: params.tenantSlug,
        scope: (item.scope === "user" ? "user" : "workspace") as CopilotMemoryScope,
        userId: params.userId,
        category: (item.category || "domain_fact") as CopilotMemoryCategory,
        topicKey: item.topicKey || item.content.slice(0, 40),
        content: item.content,
        sourceSnippet: params.prompt.slice(0, 180),
        confidence: typeof item.confidence === "number" ? item.confidence : 0.85,
      });
    }
    return {
      forgetQuery: parsed.forgetQuery?.trim() || undefined,
      candidates,
    };
  } catch {
    return { candidates: [] };
  }
}

export interface LearnFromTurnResult {
  learnedEvents: MemoryMutationEvent[];
  forgottenEntries: CopilotMemoryEntry[];
}

export async function learnFromCopilotTurn(params: {
  prompt: string;
  assistantReply?: string;
  tenantSlug: string;
  userId?: string;
  activeTab?: string;
  editedDraftContext?: string;
  geminiApiKey?: string;
  clientFactory?: GeminiClientFactory;
  enableGeminiExtraction?: boolean;
}): Promise<LearnFromTurnResult> {
  const tenantSlug = normalizeMemoryTenantSlug(params.tenantSlug);
  const cleanPrompt = String(params.prompt || "").trim();
  const learnedEvents: MemoryMutationEvent[] = [];
  let forgottenEntries: CopilotMemoryEntry[] = [];

  // 1. Check explicit forget command first
  const forgetIntent = detectForgetMemoryIntent(cleanPrompt);
  if (forgetIntent.matched && forgetIntent.query) {
    forgottenEntries = forgetTenantMemoriesByQuery({
      tenantSlug,
      userId: params.userId,
      query: forgetIntent.query,
    });
    for (const entry of forgottenEntries) {
      learnedEvents.push({
        action: "forgotten",
        entry,
        previousEntry: entry,
      });
    }
    return { learnedEvents, forgottenEntries };
  }

  // 2. Deterministic passive + explicit extraction
  const deterministic = extractDeterministicMemories({
    prompt: cleanPrompt,
    tenantSlug,
    userId: params.userId,
    activeTab: params.activeTab,
    editedDraftContext: params.editedDraftContext,
  });

  // 3. Optional Gemini fast-model JSON extraction for subtle implicit rules
  const apiKey =
    params.geminiApiKey ??
    (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY?.trim() : "");
  let geminiForgetQuery: string | undefined;
  let geminiCandidates: UpsertMemoryInput[] = [];

  if (
    apiKey &&
    params.enableGeminiExtraction !== false &&
    cleanPrompt.length >= 16
  ) {
    const geminiRes = await extractWithGeminiFastModel({
      prompt: cleanPrompt,
      assistantReply: params.assistantReply,
      tenantSlug,
      userId: params.userId,
      activeTab: params.activeTab,
      apiKey,
      clientFactory: params.clientFactory,
    });
    geminiForgetQuery = geminiRes.forgetQuery;
    geminiCandidates = geminiRes.candidates;
  }

  if (geminiForgetQuery) {
    forgottenEntries = forgetTenantMemoriesByQuery({
      tenantSlug,
      userId: params.userId,
      query: geminiForgetQuery,
    });
    for (const entry of forgottenEntries) {
      learnedEvents.push({
        action: "forgotten",
        entry,
        previousEntry: entry,
      });
    }
    return { learnedEvents, forgottenEntries };
  }

  // Merge deterministic (prioritized on same topicKey) + Gemini candidates
  const merged = new Map<string, UpsertMemoryInput>();
  for (const item of geminiCandidates) {
    merged.set(item.topicKey, item);
  }
  for (const item of deterministic) {
    merged.set(item.topicKey, item);
  }

  for (const candidate of merged.values()) {
    if ((candidate.confidence ?? 0.85) < 0.65) continue;
    const event = upsertTenantMemory(candidate);
    if (event) {
      learnedEvents.push(event);
    }
  }

  return { learnedEvents, forgottenEntries };
}

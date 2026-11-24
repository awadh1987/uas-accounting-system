/**
 * UAS Enterprise — Server-Side Multimodal Gemini Vision Document & Tally Extractor
 *
 * Strictly server-only (`@google/genai` + `GEMINI_API_KEY`). Never imported by
 * browser, Capacitor APK, or Electron desktop bundles.
 *
 * Pipeline:
 *  1. Validates MIME (`image/jpeg|png|webp`) and <= 6 MB size limit.
 *  2. Grounded with tenant Copilot memories + Yemeni harvest/accounting terms.
 *  3. Runs `UAS_GEMINI_FAST_MODEL` (`gemini-3.8-flash`) with inline image + JSON schema.
 *  4. Escalates automatically to `UAS_GEMINI_REASONING_MODEL` (`gemini-4-argon`) when
 *     handwriting confidence < 0.78 OR when line-item sums do not match handwritten totals.
 *  5. Maps extracted data cleanly into `draft_harvest_batch`, `draft_operating_expense`,
 *     or `draft_sale_transaction` (always requiring `ConfirmationPreviewCard`).
 */
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import {
  DEFAULT_GEMINI_FAST_MODEL,
  DEFAULT_GEMINI_REASONING_MODEL,
  formatGeminiModelLabel,
  type GeminiClientFactory,
  type GeminiClientLike,
} from "./geminiCopilotEngine";
import { YEMENI_ERP_GLOSSARY, type CopilotDialectMode } from "./yemeniLocalization";
import type { CopilotMemoryEntry } from "./copilotMemoryTypes";
import {
  mapVisionExtractionToDraftTool,
  validateVisionImagePayload,
  type VisionDocumentType,
  type VisionExtractionMetadata,
  type VisionLineItem,
  type VisionSourceAttachment,
} from "./copilotVisionTypes";
import { archiveVisionAttachment } from "./visionAttachmentArchive";
import type { UasBootstrapState } from "@/types/uas";

const VISION_EXTRACTION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    documentType: {
      type: Type.STRING,
      enum: [
        "harvest_tally_sheet",
        "expense_or_supplier_receipt",
        "sales_or_customer_slip",
      ],
    },
    confidence: {
      type: Type.NUMBER,
      description: "Overall handwriting/print OCR extraction confidence between 0.0 and 1.0.",
    },
    partyName: {
      type: Type.STRING,
      description: "Supplier/payee name or customer name when visible.",
    },
    projectName: {
      type: Type.STRING,
      description: "Farm, plot, or project name when visible.",
    },
    harvest: {
      type: Type.STRING,
      description: "Harvest cycle label e.g. القطفة الأولى, القطفة الثانية, البزغة.",
    },
    grade: {
      type: Type.STRING,
      description: "Primary grade or quality e.g. درجة أولى, علاقي ممتاز.",
    },
    date: {
      type: Type.STRING,
      description: "Document date formatted YYYY-MM-DD when visible.",
    },
    reference: {
      type: Type.STRING,
      description: "Voucher, receipt, or tally sheet reference number.",
    },
    currency: {
      type: Type.STRING,
      description: "Currency code: YER, SAR, or USD.",
    },
    expenseCategory: {
      type: Type.STRING,
      description: "Suggested accounting expense category when applicable.",
    },
    totalBundles: {
      type: Type.NUMBER,
      description: "Total harvested/sold bundles (علاقية) written on the sheet.",
    },
    shrinkageBundles: {
      type: Type.NUMBER,
      description: "Spoilage / damaged / shrinkage count (فاقد / تالف).",
    },
    handwrittenTotal: {
      type: Type.NUMBER,
      description: "Grand monetary total written on receipt/slip.",
    },
    paidAmount: {
      type: Type.NUMBER,
      description: "Amount paid upfront (نقد/واصل); remainder is receivable credit (آجل).",
    },
    notes: {
      type: Type.STRING,
      description: "Worker notes, delivery route, or additional handwritten context.",
    },
    lineItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING },
          grade: { type: Type.STRING },
          harvest: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          unitPrice: { type: Type.NUMBER },
          total: { type: Type.NUMBER },
          shrinkageBundles: { type: Type.NUMBER },
        },
        required: ["description", "quantity", "unitPrice", "total"],
      },
    },
  },
  required: ["documentType", "confidence", "currency", "lineItems"],
};

interface RawGeminiVisionJson {
  documentType?: VisionDocumentType;
  confidence?: number;
  partyName?: string;
  projectName?: string;
  harvest?: string;
  grade?: string;
  date?: string;
  reference?: string;
  currency?: string;
  expenseCategory?: string;
  totalBundles?: number;
  shrinkageBundles?: number;
  handwrittenTotal?: number;
  paidAmount?: number;
  notes?: string;
  lineItems?: Array<Partial<VisionLineItem>>;
}

function buildVisionSystemInstruction(params: {
  lang: "ar" | "en";
  dialect: CopilotDialectMode;
  memories: CopilotMemoryEntry[];
}): string {
  const glossaryLines = YEMENI_ERP_GLOSSARY.map(
    (g) => `- ${g.termAr} (${g.english}): ${g.meaningAr}`
  ).join("\n");
  const memoryLines =
    params.memories.length > 0
      ? params.memories.map((m, i) => `${i + 1}. [${m.category}] ${m.content}`).join("\n")
      : "None";

  return [
    "You are UAS Enterprise Multimodal Vision ERP Extractor specializing in Arabic & English receipts, handwritten supplier bills, sales slips, and Yemeni agricultural harvest tally sheets.",
    "Classify each image strictly into one of:",
    "1. `harvest_tally_sheet`: كشف قطفة / حصر علاقي / بزغة / فاقد وتالف.",
    "2. `expense_or_supplier_receipt`: سند صرف / فاتورة مشتريات / مصروف نقل أو وقود أو مواد.",
    "3. `sales_or_customer_slip`: بيان بيع / سند عميل / مبيعات نقد أو آجل.",
    `YEMENI FIELD TERMINOLOGY:\n${glossaryLines}`,
    `TENANT LEARNED ALIASES & ACCOUNTING RULES:\n${memoryLines}`,
    "ACCURACY RULES:",
    "- Read Arabic-Indic digits (٠-٩) and Western digits (0-9) carefully and output standard JSON numbers.",
    "- Preserve the grand total actually written on the sheet in `handwrittenTotal` (or `totalBundles` for bundle-only tally sheets) even if it differs from the sum of line items—do NOT silently fudge numbers.",
    "- Lower `confidence` (< 0.75) if handwriting is smudged, ambiguous, or clipped.",
  ].join("\n\n");
}

function evaluateArithmeticDiscrepancy(parsed: RawGeminiVisionJson): {
  docType: VisionDocumentType;
  lineItems: VisionLineItem[];
  computedItemsSum: number;
  handwrittenTotal: number;
  discrepancyAmount: number;
  arithmeticMismatch: boolean;
} {
  const docType: VisionDocumentType =
    parsed.documentType === "harvest_tally_sheet" ||
    parsed.documentType === "sales_or_customer_slip"
      ? parsed.documentType
      : "expense_or_supplier_receipt";

  const lineItems: VisionLineItem[] = (parsed.lineItems ?? []).map((it) => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    const rowTotal = Number(it.total) || qty * price;
    return {
      description: String(it.description || "").trim() || "بند",
      grade: it.grade ? String(it.grade).trim() : undefined,
      harvest: it.harvest ? String(it.harvest).trim() : undefined,
      quantity: qty,
      unitPrice: price,
      total: Math.round(rowTotal * 100) / 100,
      shrinkageBundles:
        it.shrinkageBundles !== undefined ? Number(it.shrinkageBundles) || 0 : undefined,
    };
  });

  if (docType === "harvest_tally_sheet" && !(Number(parsed.handwrittenTotal) > 0)) {
    const computedBundles = lineItems.reduce((s, it) => s + it.quantity, 0);
    const writtenBundles = Number(parsed.totalBundles) || computedBundles;
    const diff = Math.round(Math.abs(computedBundles - writtenBundles) * 100) / 100;
    return {
      docType,
      lineItems,
      computedItemsSum: computedBundles,
      handwrittenTotal: writtenBundles,
      discrepancyAmount: diff,
      arithmeticMismatch: lineItems.length > 0 && Number(parsed.totalBundles) > 0 && diff > 0.01,
    };
  }

  const computedSum =
    Math.round(lineItems.reduce((s, it) => s + it.total, 0) * 100) / 100;
  const writtenTotal = Number(parsed.handwrittenTotal) || computedSum;
  const discrepancyAmount =
    Math.round(Math.abs(computedSum - writtenTotal) * 100) / 100;
  const arithmeticMismatch =
    lineItems.length > 0 &&
    Number(parsed.handwrittenTotal) > 0 &&
    discrepancyAmount > 0.01;

  return {
    docType,
    lineItems,
    computedItemsSum: computedSum,
    handwrittenTotal: writtenTotal,
    discrepancyAmount,
    arithmeticMismatch,
  };
}

async function runVisionModelPass(params: {
  ai: GeminiClientLike;
  model: string;
  cleanBase64: string;
  mimeType: string;
  userPrompt: string;
  systemInstruction: string;
}): Promise<RawGeminiVisionJson> {
  const response = await params.ai.models.generateContent({
    model: params.model,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: params.cleanBase64,
              mimeType: params.mimeType,
            },
          },
          {
            text:
              params.userPrompt.trim() ||
              "حلل هذه الصورة واستخرج الحقول المحاسبية أو كشف الحصاد بدقة بصيغة JSON.",
          },
        ] as never,
      },
    ],
    config: {
      systemInstruction: params.systemInstruction,
      responseMimeType: "application/json",
      responseSchema: VISION_EXTRACTION_SCHEMA,
      temperature: 0.1,
    },
  });

  const rawText = (response.text || "").trim();
  if (!rawText) {
    throw new Error("EMPTY_VISION_RESPONSE");
  }
  return JSON.parse(rawText) as RawGeminiVisionJson;
}

export async function extractDocumentFromVisionImage(input: {
  imageBase64: string;
  mimeType: string;
  fileName?: string;
  prompt?: string;
  lang?: "ar" | "en";
  dialect?: CopilotDialectMode;
  tenantSlug?: string;
  state?: UasBootstrapState | null;
  memories?: CopilotMemoryEntry[];
  selectedProjectId?: string | null;
  selectedHarvest?: string | null;
  archiveAttachment?: boolean;
  geminiApiKey?: string;
  clientFactory?: GeminiClientFactory;
}): Promise<
  | { ok: true; extraction: VisionExtractionMetadata }
  | {
      ok: false;
      code: string;
      status: number;
      errorAr: string;
      errorEn: string;
    }
> {
  const validated = validateVisionImagePayload({
    imageBase64: input.imageBase64,
    mimeType: input.mimeType,
  });
  if (!validated.ok) {
    return {
      ok: false,
      code: validated.code,
      status: validated.status,
      errorAr: validated.errorAr,
      errorEn: validated.errorEn,
    };
  }

  const apiKey =
    input.geminiApiKey ??
    (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY?.trim() : "");
  if (!apiKey) {
    return {
      ok: false,
      code: "VISION_OFFLINE_OR_UNCONFIGURED",
      status: 503,
      errorAr:
        "تحليل الصور والخط اليدوي يتطلب اتصالاً بالإنترنت مع خادم qat.world وتفعيل مفتاح Gemini على السيرفر. يمكنك حفظ الملاحظة محلياً أو إدخال المسودة يدوياً في وضع أوفلاين.",
      errorEn:
        "Multimodal Vision OCR requires an online connection to qat.world and server-side Gemini configuration. You can save an image note locally or enter the draft manually offline.",
    };
  }

  const lang: "ar" | "en" = input.lang === "en" ? "en" : "ar";
  const dialect: CopilotDialectMode = input.dialect === "msa" ? "msa" : "yemeni";
  const memories = input.memories ?? [];
  const fastModel =
    (typeof process !== "undefined" && process.env?.UAS_GEMINI_FAST_MODEL?.trim()) ||
    DEFAULT_GEMINI_FAST_MODEL;
  const reasoningModel =
    (typeof process !== "undefined" && process.env?.UAS_GEMINI_REASONING_MODEL?.trim()) ||
    DEFAULT_GEMINI_REASONING_MODEL;

  const ai: GeminiClientLike = input.clientFactory
    ? input.clientFactory(apiKey)
    : new GoogleGenAI({ apiKey });
  const systemInstruction = buildVisionSystemInstruction({
    lang,
    dialect,
    memories,
  });

  try {
    let activeModel = fastModel;
    let escalated = false;
    let parsed = await runVisionModelPass({
      ai,
      model: fastModel,
      cleanBase64: validated.cleanBase64,
      mimeType: validated.mimeType,
      userPrompt: input.prompt || "",
      systemInstruction,
    });

    let check = evaluateArithmeticDiscrepancy(parsed);
    const initialConfidence = Math.max(
      0,
      Math.min(1, Number(parsed.confidence ?? 0.8))
    );

    if (
      (initialConfidence < 0.78 || check.arithmeticMismatch) &&
      reasoningModel !== fastModel
    ) {
      try {
        const escalatedParsed = await runVisionModelPass({
          ai,
          model: reasoningModel,
          cleanBase64: validated.cleanBase64,
          mimeType: validated.mimeType,
          userPrompt:
            `${input.prompt || ""}\n\n[VERIFICATION NOTICE]: Double-check smudged handwriting and verify line-item arithmetic sum (${check.computedItemsSum}) against handwritten total (${check.handwrittenTotal}).`,
          systemInstruction,
        });
        parsed = escalatedParsed;
        check = evaluateArithmeticDiscrepancy(parsed);
        activeModel = reasoningModel;
        escalated = true;
      } catch {
        // Keep fast-model result if reasoning escalation hits rate-limit/quota
      }
    }

    const finalConfidence = Math.max(
      0,
      Math.min(1, Number(parsed.confidence ?? initialConfidence))
    );
    const currency = (parsed.currency || input.state?.settings?.defaultCurrency || "YER")
      .trim()
      .toUpperCase();

    const mappedToolCall = mapVisionExtractionToDraftTool(
      {
        documentType: check.docType,
        partyName: parsed.partyName,
        projectName: parsed.projectName,
        harvest: parsed.harvest,
        grade: parsed.grade,
        date: parsed.date,
        reference: parsed.reference,
        currency,
        expenseCategory: parsed.expenseCategory,
        totalBundles: parsed.totalBundles,
        shrinkageBundles: parsed.shrinkageBundles,
        handwrittenTotal: check.handwrittenTotal,
        paidAmount: parsed.paidAmount,
        notes: parsed.notes,
        lineItems: check.lineItems,
      },
      {
        state: input.state,
        memories,
        selectedProjectId: input.selectedProjectId,
        selectedHarvest: input.selectedHarvest,
      }
    );

    const discrepancyNoteAr = check.arithmeticMismatch
      ? `⚠️ تنبيه عدم تطابق حسابي: مجموع البنود (${check.computedItemsSum.toLocaleString()}) يختلف عن الإجمالي المكتوب يدوياً (${check.handwrittenTotal.toLocaleString()}) بفارق ${check.discrepancyAmount.toLocaleString()}.`
      : undefined;
    const discrepancyNoteEn = check.arithmeticMismatch
      ? `⚠️ Arithmetic mismatch: line-items sum (${check.computedItemsSum.toLocaleString()}) differs from handwritten total (${check.handwrittenTotal.toLocaleString()}) by ${check.discrepancyAmount.toLocaleString()}.`
      : undefined;

    const confPct = Math.round(finalConfidence * 100);
    const docLabelAr =
      check.docType === "harvest_tally_sheet"
        ? "كشف قطفات وحصاد"
        : check.docType === "sales_or_customer_slip"
        ? "بيان مبيعات / سند عميل"
        : "فاتورة / سند مصروف";
    const docLabelEn =
      check.docType === "harvest_tally_sheet"
        ? "Harvest Tally Sheet"
        : check.docType === "sales_or_customer_slip"
        ? "Sales / Customer Slip"
        : "Expense / Supplier Receipt";

    const summaryAr = [
      `📸 **تم تحليل صورة المستند (${docLabelAr}) بنجاح** — الثقة: **${confPct}%** • النموذج: **${formatGeminiModelLabel(activeModel)}**${escalated ? " (تصعيد للتحقق اليدوي)" : ""}.`,
      discrepancyNoteAr,
    ]
      .filter(Boolean)
      .join("\n");

    const summaryEn = [
      `📸 **Extracted ${docLabelEn}** — Confidence: **${confPct}%** • Model: **${formatGeminiModelLabel(activeModel)}**${escalated ? " (escalated verification)" : ""}.`,
      discrepancyNoteEn,
    ]
      .filter(Boolean)
      .join("\n");

    let sourceAttachment: VisionSourceAttachment | null = null;
    if (input.archiveAttachment !== false) {
      try {
        sourceAttachment = archiveVisionAttachment({
          tenantSlug:
            input.tenantSlug ||
            input.state?.enterpriseProfile?.tenantSlug ||
            "default",
          imageBase64: validated.cleanBase64,
          mimeType: validated.mimeType,
          fileName: input.fileName,
          documentType: check.docType,
        });
      } catch {
        // Non-fatal archive error
      }
    }

    return {
      ok: true,
      extraction: {
        documentType: check.docType,
        modelUsed: formatGeminiModelLabel(activeModel),
        modelId: activeModel,
        escalatedToReasoningModel: escalated,
        confidence: finalConfidence,
        arithmeticMismatch: check.arithmeticMismatch,
        computedItemsSum: check.computedItemsSum,
        handwrittenTotal: check.handwrittenTotal,
        discrepancyAmount: check.discrepancyAmount,
        discrepancyNoteAr,
        discrepancyNoteEn,
        partyName: parsed.partyName,
        projectName: parsed.projectName,
        harvest: parsed.harvest,
        grade: parsed.grade,
        date: parsed.date,
        reference: parsed.reference,
        currency,
        expenseCategory: parsed.expenseCategory,
        totalBundles: parsed.totalBundles,
        shrinkageBundles: parsed.shrinkageBundles,
        paidAmount: parsed.paidAmount,
        creditBalance:
          parsed.paidAmount !== undefined
            ? Math.max(0, check.handwrittenTotal - Number(parsed.paidAmount))
            : undefined,
        notes: parsed.notes,
        lineItems: check.lineItems,
        mappedToolCall,
        sourceAttachment,
        summaryAr,
        summaryEn,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: "VISION_EXTRACTION_FAILED",
      status: 502,
      errorAr: `تعذر قراءة الصورة عبر Gemini Vision (${msg.slice(0, 120)}). يرجى إعادة التقاط صورة أوضح.`,
      errorEn: `Vision OCR failed (${msg.slice(0, 120)}). Please capture a clearer photo.`,
    };
  }
}

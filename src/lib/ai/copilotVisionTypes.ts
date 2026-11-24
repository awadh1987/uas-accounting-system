/**
 * UAS Enterprise — Shared Vision Types, Image Payload Guardrails & Draft Mapper
 *
 * Zero Node-only and zero Google GenAI SDK imports so client UI, offline guards,
 * server vision extraction, and automated tests share identical validation and
 * draft tool mapping contracts.
 */
import type { CopilotMemoryEntry } from "./copilotMemoryTypes";
import type { UasBootstrapState } from "@/types/uas";

export const SUPPORTED_VISION_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedVisionMimeType = (typeof SUPPORTED_VISION_MIME_TYPES)[number];

export const MAX_VISION_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB compressed image limit

export type VisionDocumentType =
  | "harvest_tally_sheet"
  | "expense_or_supplier_receipt"
  | "sales_or_customer_slip";

export interface VisionLineItem {
  description: string;
  grade?: string;
  harvest?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  shrinkageBundles?: number;
}

export interface VisionMappedDraftCall {
  toolName:
    | "draft_harvest_batch"
    | "draft_operating_expense"
    | "draft_sale_transaction";
  args: Record<string, unknown>;
}

export interface VisionExtractionMetadata {
  documentType: VisionDocumentType;
  modelUsed: string;
  modelId: string;
  escalatedToReasoningModel: boolean;
  confidence: number;
  arithmeticMismatch: boolean;
  computedItemsSum: number;
  handwrittenTotal: number;
  discrepancyAmount: number;
  discrepancyNoteAr?: string;
  discrepancyNoteEn?: string;
  partyName?: string;
  projectName?: string;
  harvest?: string;
  grade?: string;
  date?: string;
  reference?: string;
  currency: string;
  expenseCategory?: string;
  totalBundles?: number;
  shrinkageBundles?: number;
  paidAmount?: number;
  creditBalance?: number;
  notes?: string;
  lineItems: VisionLineItem[];
  mappedToolCall: VisionMappedDraftCall;
  summaryAr: string;
  summaryEn: string;
}

export interface ValidatedVisionPayload {
  ok: true;
  mimeType: SupportedVisionMimeType;
  cleanBase64: string;
  byteLength: number;
}

export interface RejectedVisionPayload {
  ok: false;
  code: "UNSUPPORTED_MIME_TYPE" | "EMPTY_IMAGE" | "PAYLOAD_TOO_LARGE";
  status: number;
  errorAr: string;
  errorEn: string;
}

export function normalizeVisionMimeType(raw: string | null | undefined): string {
  const lower = String(raw || "").trim().toLowerCase();
  if (lower === "image/jpg") return "image/jpeg";
  return lower;
}

export function validateVisionImagePayload(input: {
  imageBase64?: string | null;
  mimeType?: string | null;
  maxBytes?: number;
}): ValidatedVisionPayload | RejectedVisionPayload {
  let mime = normalizeVisionMimeType(input.mimeType);
  let rawData = String(input.imageBase64 || "").trim();

  // Extract inline mime from data URL if supplied
  const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    if (!mime) mime = normalizeVisionMimeType(dataUrlMatch[1]);
    rawData = dataUrlMatch[2].trim();
  }

  if (
    !SUPPORTED_VISION_MIME_TYPES.includes(mime as SupportedVisionMimeType)
  ) {
    return {
      ok: false,
      code: "UNSUPPORTED_MIME_TYPE",
      status: 400,
      errorAr:
        "نوع الصورة غير مدعوم. يُسمح فقط بصور JPEG أو PNG أو WEBP.",
      errorEn:
        "Unsupported image MIME type. Only JPEG, PNG, and WEBP images are allowed.",
    };
  }

  const cleanBase64 = rawData.replace(/\s+/g, "");
  if (!cleanBase64 || !/^[A-Za-z0-9+/=_-]+$/.test(cleanBase64)) {
    return {
      ok: false,
      code: "EMPTY_IMAGE",
      status: 400,
      errorAr: "ملف الصورة فارغ أو غير صالح؛ يرجى اختيار صورة واضحة.",
      errorEn: "Image payload is empty or invalid; please select a valid image.",
    };
  }

  const padding = cleanBase64.endsWith("==")
    ? 2
    : cleanBase64.endsWith("=")
    ? 1
    : 0;
  const byteLength = Math.max(
    0,
    Math.floor((cleanBase64.length * 3) / 4) - padding
  );
  const maxBytes = input.maxBytes ?? MAX_VISION_IMAGE_BYTES;

  if (byteLength === 0) {
    return {
      ok: false,
      code: "EMPTY_IMAGE",
      status: 400,
      errorAr: "ملف الصورة فارغ.",
      errorEn: "Image file is empty.",
    };
  }

  if (byteLength > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
      errorAr: `حجم الصورة يتجاوز الحد المسموح (${maxMb} ميجابايت). يرجى ضغط الصورة أو تقليل الدقة.`,
      errorEn: `Image size exceeds maximum limit (${maxMb} MB). Please compress or resize the image.`,
    };
  }

  return {
    ok: true,
    mimeType: mime as SupportedVisionMimeType,
    cleanBase64,
    byteLength,
  };
}

/**
 * Resolves customer/category hints from tenant Copilot memories before mapping
 * an extracted Vision document to the matching `draft_*` tool call.
 */
export function mapVisionExtractionToDraftTool(
  raw: {
    documentType: VisionDocumentType;
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
    lineItems?: VisionLineItem[];
  },
  ctx?: {
    state?: UasBootstrapState | null;
    memories?: CopilotMemoryEntry[];
    selectedProjectId?: string | null;
    selectedHarvest?: string | null;
  }
): VisionMappedDraftCall {
  const items = Array.isArray(raw.lineItems) ? raw.lineItems : [];
  const memories = (ctx?.memories ?? []).filter((m) => m.active);
  const currency = (raw.currency || ctx?.state?.settings?.defaultCurrency || "YER")
    .trim()
    .toUpperCase();

  // Check learned expense/category rule from tenant memories
  let resolvedCategory = (raw.expenseCategory || "").trim();
  const partyLower = (raw.partyName || "").toLowerCase();
  const notesLower = (raw.notes || "").toLowerCase();
  if (raw.documentType === "expense_or_supplier_receipt") {
    for (const m of memories) {
      if (
        m.category === "operational_pattern" ||
        m.category === "correction" ||
        m.category === "domain_fact"
      ) {
        const memLower = m.content.toLowerCase();
        if (
          (partyLower && memLower.includes(partyLower)) ||
          items.some((it) => it.description && memLower.includes(it.description.toLowerCase())) ||
          (notesLower && memLower.includes("صنعاء") && notesLower.includes("صنعاء"))
        ) {
          const catMatch = m.content.match(
            /(?:تحت|على|فئة|حساب)\s+([^\n.!؟،]{3,40})/i
          );
          if (catMatch?.[1]) {
            resolvedCategory = catMatch[1].trim();
            break;
          }
        }
      }
    }
  }

  // Match customer name against existing tenant sales/aliases if close
  let resolvedCustomer = (raw.partyName || "").trim();
  if (raw.documentType === "sales_or_customer_slip" && resolvedCustomer) {
    const knownCustomers = Array.from(
      new Set((ctx?.state?.sales ?? []).map((s) => s.customer).filter(Boolean))
    );
    const exactOrContains = knownCustomers.find(
      (c) =>
        c.toLowerCase() === resolvedCustomer.toLowerCase() ||
        c.toLowerCase().includes(resolvedCustomer.toLowerCase()) ||
        resolvedCustomer.toLowerCase().includes(c.toLowerCase())
    );
    if (exactOrContains) {
      resolvedCustomer = exactOrContains;
    }
  }

  if (raw.documentType === "harvest_tally_sheet") {
    const bundlesFromLines = items.reduce(
      (sum, it) => sum + Math.max(0, Number(it.quantity) || 0),
      0
    );
    const shrinkageFromLines = items.reduce(
      (sum, it) => sum + Math.max(0, Number(it.shrinkageBundles) || 0),
      0
    );
    const harvestedBundles = Math.round(
      Math.max(Number(raw.totalBundles) || 0, bundlesFromLines)
    );
    const shrinkageBundles = Math.round(
      Math.max(Number(raw.shrinkageBundles) || 0, shrinkageFromLines)
    );
    return {
      toolName: "draft_harvest_batch",
      args: {
        projectId: ctx?.selectedProjectId ?? ctx?.state?.projects?.[0]?.id,
        projectName: raw.projectName || ctx?.state?.projects?.[0]?.name,
        harvest: raw.harvest || ctx?.selectedHarvest || items[0]?.harvest || "القطفة الأولى",
        grade: raw.grade || items[0]?.grade || "درجة أولى",
        harvestedBundles,
        shrinkageBundles,
        notes:
          raw.notes ||
          `مستخرج بالرؤية من كشف الحصاد${raw.reference ? ` (${raw.reference})` : ""}`,
      },
    };
  }

  if (raw.documentType === "sales_or_customer_slip") {
    const totalBundles = Math.max(
      1,
      Math.round(
        Number(raw.totalBundles) ||
          items.reduce((s, it) => s + Math.max(0, Number(it.quantity) || 0), 0) ||
          1
      )
    );
    const totalAmount =
      Number(raw.handwrittenTotal) > 0
        ? Number(raw.handwrittenTotal)
        : items.reduce((s, it) => s + (Number(it.total) || Number(it.quantity) * Number(it.unitPrice) || 0), 0);
    const unitPrice =
      items[0]?.unitPrice && items[0].unitPrice > 0
        ? Number(items[0].unitPrice)
        : Math.round((totalAmount / totalBundles) * 100) / 100;

    return {
      toolName: "draft_sale_transaction",
      args: {
        customer: resolvedCustomer || "عميل نقدي",
        bundles: totalBundles,
        price: unitPrice,
        credit:
          raw.paidAmount !== undefined && Number(raw.paidAmount) >= 0
            ? Number(raw.paidAmount)
            : totalAmount,
        projectId: ctx?.selectedProjectId ?? ctx?.state?.projects?.[0]?.id,
        harvest: raw.harvest || ctx?.selectedHarvest || ctx?.state?.projects?.[0]?.harvests?.[0] || "القطفة الأولى",
        grade: raw.grade || items[0]?.grade || items[0]?.description || "رقم 1",
        currency,
      },
    };
  }

  // Default: expense_or_supplier_receipt
  const lineSum = items.reduce(
    (sum, it) => sum + (Number(it.total) || Number(it.quantity) * Number(it.unitPrice) || 0),
    0
  );
  const totalAmount =
    Number(raw.handwrittenTotal) > 0 ? Number(raw.handwrittenTotal) : lineSum;

  return {
    toolName: "draft_operating_expense",
    args: {
      category: resolvedCategory || raw.partyName || "مصروف تشغيلي",
      subType:
        items.map((it) => it.description).filter(Boolean).slice(0, 3).join(" + ") ||
        raw.notes ||
        raw.partyName ||
        "سند مصروف",
      qty: 1,
      unitPrice: totalAmount,
      amount: totalAmount,
      date: raw.date,
      currency,
      projectId: ctx?.selectedProjectId ?? ctx?.state?.projects?.[0]?.id,
      harvest: raw.harvest || ctx?.selectedHarvest,
    },
  };
}

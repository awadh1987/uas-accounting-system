/**
 * UAS Enterprise — 3-Tier Hybrid Bilingual (Arabic / English) Reasoning ERP Copilot Engine
 *
 *   • Tier 1: Online Cloud LLM function-calling (when API key & internet available)
 *   • Tier 2: Offline Local LLM auto-detection (http://127.0.0.1:11434 Ollama / OpenAI-compatible on desktop)
 *   • Tier 3: Zero-dependency Offline Deterministic Bilingual NLP Intent & Entity Parser
 *
 * ALL tool executions across every tier pass through `executeUasAgentTool()` in `uasAgentTools.ts`,
 * guaranteeing strict RBAC enforcement, 5-level COA leaf validation, Debit === Credit balance checks,
 * and the Mandatory Confirmation Preview Card gate for all financial/data writes.
 */
import { detectSupportLanguage, normalizeSupportText } from "@/lib/localSupportEngine";
import {
  executeUasAgentTool,
  resolveNavigationTarget,
  UAS_AGENT_TOOL_SCHEMAS,
  type CitationLink,
  type ClarificationPromptData,
  type ConfirmationPreviewCard,
  type EscalationCardData,
  type UasAgentExecutionContext,
  type UasAgentToolName,
  type UasAgentToolResult,
} from "./uasAgentTools";
import {
  detectForgetMemoryIntent,
  extractDeterministicMemories,
} from "./copilotLearnerRules";
import {
  forgetLocalCopilotMemories,
  loadLocalCopilotMemories,
  normalizeMemoryTenantSlug,
  retrieveRelevantMemories,
  upsertLocalCopilotMemory,
  type CopilotMemoryEntry,
  type MemoryMutationEvent,
} from "./copilotMemoryTypes";
import {
  filterVisionArchiveAttachments,
  loadLocalVisionArchive,
  type VisionExtractionMetadata,
} from "./copilotVisionTypes";
import type { TabId } from "@/types/uas";

export type ReasoningTier =
  | "tier1_cloud_llm"
  | "tier2_local_ollama"
  | "tier3_offline_deterministic";

export interface AgentReasoningStep {
  step: number;
  type: "thought" | "tool_call" | "observation" | "response";
  titleAr: string;
  titleEn: string;
  detailAr: string;
  detailEn: string;
  toolName?: UasAgentToolName;
  toolArgs?: Record<string, unknown>;
}

export interface ParsedAgentIntent {
  toolName: UasAgentToolName;
  args: Record<string, unknown>;
  thoughtAr: string;
  thoughtEn: string;
}

export interface UasAiAgentResponse {
  ok: boolean;
  lang: "ar" | "en";
  tierUsed: ReasoningTier;
  modelUsed?: string;
  modelId?: string;
  taskComplexity?: "operational" | "deep_reasoning";
  fallbackReason?: string;
  diagnostics?: {
    primaryModel: string;
    activeModel: string;
    retriedWithFast: boolean;
    fallbackReason?: string;
  };
  prompt: string;
  reply: string;
  replyAr: string;
  replyEn: string;
  toolName: UasAgentToolName;
  toolArgs: Record<string, unknown>;
  toolResult: UasAgentToolResult;
  requiresConfirmation: boolean;
  confirmationCard?: ConfirmationPreviewCard;
  navigationTab?: TabId;
  openLicenseModal?: boolean;
  citations?: CitationLink[];
  clarificationPrompt?: ClarificationPromptData;
  escalationCard?: EscalationCardData;
  reasoningTrace: AgentReasoningStep[];
  learnedEvents?: MemoryMutationEvent[];
  forgottenEntries?: CopilotMemoryEntry[];
  appliedMemories?: CopilotMemoryEntry[];
  visionExtraction?: VisionExtractionMetadata;
}

// ---------------------------------------------------------------------------
// Arabic-Indic Digit & Entity Extraction Helpers
// ---------------------------------------------------------------------------

const ARABIC_INDIC_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function normalizeDigits(input: string): string {
  return String(input ?? "").replace(/[٠-٩]/g, (d) => ARABIC_INDIC_MAP[d] ?? d);
}

export function extractCurrencyFromPrompt(prompt: string): string {
  const norm = normalizeSupportText(prompt).toLowerCase();
  if (norm.includes("sar") || norm.includes("سعودي") || norm.includes("ريال سعودي")) return "SAR";
  if (norm.includes("usd") || norm.includes("دولار") || prompt.includes("$")) return "USD";
  if (norm.includes("aed") || norm.includes("درهم") || norm.includes("اماراتي") || norm.includes("إماراتي")) return "AED";
  if (norm.includes("omr") || norm.includes("عماني") || norm.includes("ريال عماني")) return "OMR";
  if (norm.includes("kwd") || norm.includes("كويتي") || norm.includes("دينار كويتي")) return "KWD";
  if (norm.includes("eur") || norm.includes("يورو") || prompt.includes("€")) return "EUR";
  if (norm.includes("gbp") || norm.includes("استرليني") || prompt.includes("£")) return "GBP";

  // Explicit uppercase 3-letter currency code in prompt (e.g. QAR, BHD, JOD)
  const explicitMatch = prompt.match(/\b([A-Z]{3})\b/);
  if (explicitMatch && !["UAS", "COA", "ERP", "POS", "VCH", "INV", "NOT", "FOR"].includes(explicitMatch[1])) {
    return explicitMatch[1];
  }

  return "YER";
}

export function extractExchangeRateFromPrompt(prompt: string): number | undefined {
  const clean = normalizeDigits(prompt);
  // Match "بسعر صرف" or "سعر صرف" or "سعر الصرف" or "معامل صرف" or "exchange rate" or "rate: 530"
  // Avoid matching "سند صرف 500" where "صرف" means payment voucher!
  const match = clean.match(/(?:(?:ب?سعر|معامل)\s+(?:ال)?صرف|(?:exchange|fx)\s*rate|\brate)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  if (match && match[1]) {
    const val = Number(match[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }
  return undefined;
}

export function extractCostCenterFromPrompt(prompt: string): string | undefined {
  const clean = normalizeDigits(prompt);
  const match = clean.match(/(?:مركز\s+تكلفة|مركز\s+التكلفة|مركز|cost\s*center|cc)\s*[:=]?\s*([A-Za-z0-9_\u0600-\u06FF-]+)/i);
  if (match && match[1]) {
    const val = match[1].trim();
    if (val && !["اليومية", "الرئيسي", "العام", "قيد", "سند", "فاتورة"].includes(val)) return val;
  }
  return undefined;
}

export function extractMultiUnitQuantityFromPrompt(prompt: string): {
  quantity: number;
  unitName: string;
  factorToBase: number;
  baseQuantity: number;
} | null {
  const clean = normalizeDigits(prompt);
  const match = clean.match(
    /(\d+(?:\.\d+)?)\s*(كرتون|كراتين|درزن|درازن|كيس|أكياس|اكياس|كيلو|كجم|حبة|حبات|قطعة|قطع|box|boxes|carton|cartons|dozen|dozens|bag|bags|kg|pcs|piece|pieces)(?:[\s،,.]|$)/iu
  );
  if (!match) return null;

  const quantity = Number(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const unitWord = match[2].toLowerCase();
  let factorToBase = 1;

  if (["كرتون", "كراتين", "box", "boxes", "carton", "cartons"].includes(unitWord)) {
    factorToBase = 12; // Standard carton = 12 base units
  } else if (["درزن", "درازن", "dozen", "dozens"].includes(unitWord)) {
    factorToBase = 12;
  } else if (["كيس", "أكياس", "اكياس", "bag", "bags"].includes(unitWord)) {
    factorToBase = 50; // Standard agricultural bag = 50 kg/units
  } else if (["كيلو", "كجم", "kg"].includes(unitWord)) {
    factorToBase = 1;
  } else {
    factorToBase = 1;
  }

  return {
    quantity,
    unitName: match[2],
    factorToBase,
    baseQuantity: quantity * factorToBase,
  };
}

/**
 * Extracts monetary numbers (ignoring 6- to 9-digit COA codes like 111101, 411101, 112190001).
 */
export function extractMonetaryAmounts(prompt: string, coaCodesToExclude: string[] = []): number[] {
  const clean = normalizeDigits(prompt).replace(/,/g, "");
  const excludeSet = new Set(coaCodesToExclude);
  const matches = clean.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  const amounts: number[] = [];

  for (const m of matches) {
    if (excludeSet.has(m)) continue;
    // Standard COA codes are 6 to 9 digits starting with 1..5
    if (/^[1-5]\d{5,8}$/.test(m)) {
      // Only treat as COA code if it matches COA pattern AND isn't preceded by amount keywords
      const idx = clean.indexOf(m);
      const before = clean.slice(Math.max(0, idx - 18), idx).toLowerCase();
      if (
        before.includes("حساب") ||
        before.includes("account") ||
        before.includes("code") ||
        before.includes("مدين") ||
        before.includes("دائن") ||
        before.includes("debit") ||
        before.includes("credit") ||
        before.includes("من") ||
        before.includes("الى") ||
        before.includes("إلى")
      ) {
        continue;
      }
    }
    const n = Number(m);
    if (Number.isFinite(n) && n > 0) {
      amounts.push(n);
    }
  }
  return amounts;
}

export function extractCoaCodes(prompt: string): string[] {
  const clean = normalizeDigits(prompt);
  const matches = clean.match(/\b[1-5]\d{5,8}\b/g) ?? [];
  return matches;
}

function inferAccountsFromKeywords(prompt: string): { debitCode: string; creditCode: string } {
  const norm = normalizeSupportText(prompt);
  let debitCode = "524101"; // مصروف الصيانة والمصروفات الأخرى
  let creditCode = "111101"; // الصندوق الرئيسي - يمني

  if (norm.includes("وقود") || norm.includes("ديزل") || norm.includes("fuel") || norm.includes("diesel")) {
    debitCode = "521101";
  } else if (norm.includes("وجبات") || norm.includes("غذاء") || norm.includes("meal")) {
    debitCode = "522101";
  } else if (norm.includes("نقل") || norm.includes("توريد") || norm.includes("transport")) {
    debitCode = "523101";
  } else if (norm.includes("اجور") || norm.includes("عمال") || norm.includes("wage") || norm.includes("labor")) {
    debitCode = "511101";
  } else if (norm.includes("مبيعات") || norm.includes("ايراد") || norm.includes("sales") || norm.includes("revenue")) {
    debitCode = "111101";
    creditCode = "411101";
  } else if (norm.includes("راس المال") || norm.includes("capital")) {
    debitCode = "111101";
    creditCode = "311101";
  }

  if (norm.includes("كريمي") || norm.includes("kuraimi") || norm.includes("بنك") || norm.includes("bank")) {
    if (debitCode === "111101") debitCode = "111201";
    else creditCode = "111201";
  }

  return { debitCode, creditCode };
}

function extractPartyName(prompt: string, fallbackAr: string, fallbackEn: string, lang: "ar" | "en"): string {
  const patterns = [
    /(?:للعميل|من العميل|إلى المورد|للمورد|للمستفيد|إلى|من)\s+([^\d،,\n]{2,35})/i,
    /(?:customer|vendor|client|payee|from|to|for)\s+([A-Za-z\u0600-\u06FF\s]{2,35}?)(?=\s+(?:for|amount|بمبلغ|مبلغ|\d|$))/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m && m[1]) {
      const candidate = m[1]
        .replace(/\b(بمبلغ|مبلغ|قدرها|قدره|ريال|دولار|amount|for|yer|sar|usd)\b.*$/i, "")
        .trim();
      if (candidate.length >= 2) return candidate;
    }
  }
  return lang === "ar" ? fallbackAr : fallbackEn;
}

// ---------------------------------------------------------------------------
// Tier 3: Deterministic Bilingual NLP Intent & Entity Parser
// ---------------------------------------------------------------------------

export function parseBilingualAgentIntent(
  prompt: string,
  ctx?: UasAgentExecutionContext
): ParsedAgentIntent {
  const raw = String(prompt ?? "").trim();
  const norm = normalizeSupportText(normalizeDigits(raw));
  const lang = detectSupportLanguage(raw, ctx?.lang ?? "ar");
  const currency = extractCurrencyFromPrompt(raw);
  const exchangeRate = extractExchangeRateFromPrompt(raw);
  const costCenterId = extractCostCenterFromPrompt(raw);
  const multiUnit = extractMultiUnitQuantityFromPrompt(raw);
  const activeTab = ctx?.workspaceContext?.activeTab;
  const activeProjectId = ctx?.workspaceContext?.selectedProjectId ?? undefined;
  const activeHarvest = ctx?.workspaceContext?.selectedHarvest ?? undefined;

  // 0. Proactive Daily Executive Briefing, Low-Stock & Overdue Receivable Alerts
  if (
    /(?:ملخص\s+اليوم|الموجز\s+اليومي|ملخص\s+تنفيذي|اولويات\s+اليوم|أولويات\s+اليوم|تقرير\s+اليوم\s+التنفيذي|منخفض[هة]?\s+المخزون|اصناف\s+ناقص|نقص\s+المخزون|تنبيهات\s+المخزون|العملاء\s+المتاخر|العملاء\s+المتأخر|الذمم\s+المتاخر|الذمم\s+المتأخر|مديوني[هة]\s+متاخر|مديوني[هة]\s+متأخر|daily\s+(?:executive\s+)?briefing|executive\s+briefing|low[- ]stock|overdue\s+receivable)/i.test(
      norm
    ) &&
    !/(?:فاتور|سند|قيد|انشئ|أنشئ|invoice|voucher|draft|journal)/i.test(norm)
  ) {
    const focus = /(?:مخزون|اصناف|أصناف|low[- ]stock|stock\s+alert)/i.test(norm)
      ? "low_stock"
      : /(?:متاخر|متأخر|ذمم|مديوني|overdue|aging)/i.test(norm)
      ? "overdue_receivables"
      : "all";
    return {
      toolName: "get_daily_executive_briefing",
      args: { focus },
      thoughtAr:
        focus === "low_stock"
          ? "تحليل النية: استعراض تنبيهات نقص المخزون ودفعات الحصاد تحت الحد."
          : focus === "overdue_receivables"
          ? "تحليل النية: استعراض المديونيات والفواتير المتأخرة عن السداد."
          : "تحليل النية: توليد الملخص التنفيذي اليومي والأولويات والتنبيهات الاستباقية.",
      thoughtEn:
        focus === "low_stock"
          ? "Intent parsed: Inspect low-stock items and harvest batch depletion alerts."
          : focus === "overdue_receivables"
          ? "Intent parsed: Inspect overdue customer receivables and aging priority."
          : "Intent parsed: Generate Daily Executive Briefing with low-stock and overdue-receivable alerts.",
    };
  }

  // 0.1 Search Archived Scans / Vision Documents
  if (
    /(?:ارشيف\s+المسح|أرشيف\s+المسح|ارشيف\s+الصور|أرشيف\s+الصور|المستندات\s+المؤرشف|الصور\s+المؤرشف|كشوفات\s+القطف[هة]\s+المؤرشف|search\s+archived\s+scans|vision\s+archive|archived\s+receipts)/i.test(
      norm
    )
  ) {
    const documentType = /(?:قطف|حصاد|tally|harvest)/i.test(norm)
      ? "harvest_tally_sheet"
      : /(?:مصروف|مورد|expense|supplier)/i.test(norm)
      ? "expense_or_supplier_receipt"
      : /(?:بيع|مبيع|عميل|sales|customer)/i.test(norm)
      ? "sales_or_customer_slip"
      : "all";
    return {
      toolName: "search_archived_scans",
      args: { documentType, q: "" },
      thoughtAr: "تحليل النية: البحث في أرشيف الصور والمستندات الممسوحة لهذه المنشأة.",
      thoughtEn: "Intent parsed: Search tenant-scoped archived vision scans and linked documents.",
    };
  }

  // 1. Check explicit navigation intent ("افتح قسم ...", "انتقل إلى ...", "open ...", "navigate to ...", "go to ...")
  const navMatch = raw.match(
    /^(?:افتح|انتقل\s+(?:إلى|الى)|اذهب\s+(?:إلى|الى)|اعرض\s+(?:قسم|شاشة|تبويب)|open|navigate\s+to|go\s+to|show\s+tab)\s+(.+)$/i
  );
  if (navMatch && navMatch[1]) {
    const targetCandidate = navMatch[1]
      .replace(/\b(قسم|شاشة|تبويب|صفحة|module|tab|view|screen|page)\b/gi, "")
      .trim();
    const resolved = resolveNavigationTarget(targetCandidate || navMatch[1]);
    if (resolved) {
      return {
        toolName: "navigate_to_module",
        args: { tab: resolved.tab },
        thoughtAr: `تحليل النية: طلب تنقل مباشر إلى قسم (${resolved.labelAr}).`,
        thoughtEn: `Intent parsed: Direct navigation request to module '${resolved.labelEn}' (${resolved.tab}).`,
      };
    }
  }

  // 1.1 Check create_customer intent ("عميل جديد ...", "أنشئ عميل ...", "create customer ...", "add client ...")
  const isCreateCustomer =
    /(?:عميل\s+جديد|انشئ\s+عميل|أنشئ\s+عميل|اضف\s+عميل|أضف\s+عميل|تسجيل\s+عميل|create\s+customer|new\s+customer|add\s+customer|new\s+client|create\s+client)/i.test(norm) &&
    !/(?:فاتور|سند|قيد|invoice|voucher|bill|journal)/i.test(norm);

  if (isCreateCustomer) {
    const phoneMatch = raw.match(/(?:هاتف|تلفون|جوال|phone|mobile)\s*[:=]?\s*([0-9+]{6,15})/i);
    const creditMatch = raw.match(/(?:حد\s+ائتمان|حد\s+ائتماني|credit\s*limit)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    const phone = phoneMatch ? phoneMatch[1].trim() : undefined;
    const creditLimit = creditMatch ? Number(creditMatch[1]) : 0;

    let custName = raw
      .replace(/(?:انشئ|أنشئ|اضف|أضف|سجل|تسجيل|جديد|عميل|زبون|create|add|new|customer|client)\b/gi, "")
      .replace(/(?:هاتف|تلفون|جوال|phone|mobile)\s*[:=]?\s*[0-9+]{6,15}/gi, "")
      .replace(/(?:حد\s+ائتمان|حد\s+ائتماني|credit\s*limit)\s*[:=]?\s*\d+(?:\.\d+)?/gi, "")
      .replace(/(?:مركز\s+تكلفة|cost\s*center)\s*[:=]?\s*[A-Za-z0-9_\u0600-\u06FF-]+/gi, "")
      .trim();
    if (!custName || custName.length < 2) custName = "عميل جديد";

    return {
      toolName: "create_customer",
      args: {
        name: custName,
        phone,
        creditLimit,
        costCenterId,
      },
      thoughtAr: `تحليل النية: طلب إنشاء عميل جديد (${custName})${phone ? ` برقم هاتف: ${phone}` : ""}${creditLimit > 0 ? ` وحد ائتماني: ${creditLimit}` : ""}${costCenterId ? ` ومركز تكلفة: ${costCenterId}` : ""}. سيتم توليد حساب Gen-6 ومركز تكلفة وبطاقة التأكيد.`,
      thoughtEn: `Intent parsed: Create new customer (${custName})${phone ? ` phone: ${phone}` : ""}${creditLimit > 0 ? ` credit limit: ${creditLimit}` : ""}${costCenterId ? ` CC: ${costCenterId}` : ""}. Generates Gen-6 leaf and confirmation card.`,
    };
  }

  // 1.2 Check create_vendor intent ("مورد جديد ...", "أنشئ مورد ...", "create vendor ...", "add supplier ...")
  const isCreateVendor =
    /(?:مورد\s+جديد|انشئ\s+مورد|أنشئ\s+مورد|اضف\s+مورد|أضف\s+مورد|تسجيل\s+مورد|create\s+vendor|new\s+vendor|add\s+vendor|new\s+supplier|create\s+supplier)/i.test(norm) &&
    !/(?:فاتور|سند|قيد|invoice|voucher|bill|journal)/i.test(norm);

  if (isCreateVendor) {
    const phoneMatch = raw.match(/(?:هاتف|تلفون|جوال|phone|mobile)\s*[:=]?\s*([0-9+]{6,15})/i);
    const phone = phoneMatch ? phoneMatch[1].trim() : "777000000";

    let vendName = raw
      .replace(/(?:انشئ|أنشئ|اضف|أضف|سجل|تسجيل|جديد|مورد|create|add|new|vendor|supplier)\b/gi, "")
      .replace(/(?:هاتف|تلفون|جوال|phone|mobile)\s*[:=]?\s*[0-9+]{6,15}/gi, "")
      .replace(/(?:مركز\s+تكلفة|cost\s*center)\s*[:=]?\s*[A-Za-z0-9_\u0600-\u06FF-]+/gi, "")
      .trim();
    if (!vendName || vendName.length < 2) vendName = "مورد جديد";

    return {
      toolName: "create_vendor",
      args: {
        nameAr: vendName,
        phone,
        costCenterId,
      },
      thoughtAr: `تحليل النية: طلب إنشاء مورد جديد (${vendName})${phone ? ` برقم هاتف: ${phone}` : ""}${costCenterId ? ` ومركز تكلفة: ${costCenterId}` : ""}. سيتم توليد حساب Gen-6 ومركز تكلفة وبطاقة التأكيد.`,
      thoughtEn: `Intent parsed: Create new vendor (${vendName})${phone ? ` phone: ${phone}` : ""}${costCenterId ? ` CC: ${costCenterId}` : ""}. Generates Gen-6 leaf and confirmation card.`,
    };
  }

  // 1.3 Check create_project intent ("مشروع جديد ...", "أنشئ مشروع ...", "create project ...")
  const isCreateProject =
    /(?:مشروع\s+جديد|انشئ\s+مشروع|أنشئ\s+مشروع|اضف\s+مشروع|أضف\s+مشروع|تسجيل\s+مشروع|create\s+project|new\s+project|add\s+project)/i.test(norm) &&
    !/(?:فاتور|سند|قيد|invoice|voucher|bill|journal)/i.test(norm);

  if (isCreateProject) {
    const budgetMatch = raw.match(/(?:موازنة|ميزانية|budget)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
    const amounts = extractMonetaryAmounts(raw);
    const budgetTotal = budgetMatch ? Number(budgetMatch[1]) : (amounts[0] ?? 0);
    const harvestMatch = raw.match(/(\d+)\s*(?:قطفات|قطفة|دورات|دورة|harvests|cycles)/i);
    const plannedHarvests = harvestMatch ? Number(harvestMatch[1]) : 1;

    let projName = raw
      .replace(/(?:انشئ|أنشئ|اضف|أضف|سجل|تسجيل|جديد|مشروع|create|add|new|project)\b/gi, "")
      .replace(/(?:موازنة|ميزانية|budget)\s*[:=]?\s*\d+(?:\.\d+)?/gi, "")
      .replace(/\b\d+\s*(?:قطفات|قطفة|دورات|دورة|harvests|cycles)\b/gi, "")
      .replace(/(?:مركز\s+تكلفة|cost\s*center)\s*[:=]?\s*[A-Za-z0-9_\u0600-\u06FF-]+/gi, "")
      .trim();
    if (!projName || projName.length < 2) projName = "مشروع إنتاجي جديد";

    return {
      toolName: "create_project",
      args: {
        name: projName,
        budgetTotal,
        plannedHarvests,
        costCenterId,
      },
      thoughtAr: `تحليل النية: طلب إنشاء مشروع جديد (${projName})${budgetTotal > 0 ? ` بموازنة: ${budgetTotal}` : ""} ودورات حصاد: ${plannedHarvests}. سيتم توليد حساب Gen-6 ومركز تكلفة وبطاقة التأكيد.`,
      thoughtEn: `Intent parsed: Create new project (${projName})${budgetTotal > 0 ? ` budget: ${budgetTotal}` : ""} harvests: ${plannedHarvests}. Generates Gen-6 leaf and confirmation card.`,
    };
  }

  // 1.4 Check export_client_report intent ("تقرير عميل ...", "كشف حساب عميل ...", "تصدير كشف حساب ...")
  const isClientReport =
    /(?:تقرير\s+عميل|كشف\s+حساب\s+عميل|كشف\s+حساب|تقرير\s+العميل|تصدير\s+كشف\s+حساب|طباعه\s+كشف\s+حساب|client\s+report|customer\s+statement|export\s+client\s+report|customer\s+report)/i.test(norm);

  if (isClientReport) {
    const includeSaleDetails = !/(?:دون\s+تفاصيل|بدون\s+تفاصيل|ملخص\s+فقط|summary\s+only|without\s+details)/i.test(norm);
    const partyName = extractPartyName(raw, "", "", lang);

    return {
      toolName: "export_client_report",
      args: {
        customerName: partyName,
        includeSaleDetails,
      },
      thoughtAr: `تحليل النية: طلب كشف حساب وتصدير تقرير العميل (${partyName || "الكل"})${includeSaleDetails ? " متضمناً تفاصيل كل عملية بيع" : " كملخص إجمالي"}.`,
      thoughtEn: `Intent parsed: Export client statement for (${partyName || "All"})${includeSaleDetails ? " including per-sale item details" : " summary only"}.`,
    };
  }

  // 1.5 Check query_workspace_data: Customer Balances & Debt
  const isCustomerBalanceQuery =
    /(?:رصيد\s+العميل|مديونيه\s+العميل|مديونية\s+العميل|حساب\s+العميل|كم\s+على\s+العميل|كم\s+يستحق\s+على|customer\s+balance|client\s+balance|client\s+debt)/i.test(norm) &&
    !/(?:فاتور|سند|قيد|انشئ|أنشئ|اضف|أضف|جديد|invoice|voucher|bill|journal)/i.test(norm);

  if (isCustomerBalanceQuery) {
    const custName = extractPartyName(raw, "", "", lang);
    return {
      toolName: "query_workspace_data",
      args: { scope: "customers", query: custName },
      thoughtAr: `تحليل النية: استعلام فوري عن رصيد ومديونية العميل (${custName || "الكل"}) في سجل المبيعات والعملاء مع توفير الروابط المباشرة.`,
      thoughtEn: `Intent parsed: Query client balance and receivables for (${custName || "All"}) with citation links.`,
    };
  }

  // 1.6 Check query_workspace_data: Vendor Payables
  const isVendorBalanceQuery =
    /(?:مستحقات\s+المورد|رصيد\s+المورد|حساب\s+المورد|كم\s+للمورد|مستحقات\s+الموردين|vendor\s+balance|supplier\s+balance|vendor\s+payables)/i.test(norm) &&
    !/(?:فاتور|سند|قيد|انشئ|أنشئ|اضف|أضف|جديد|invoice|voucher|bill|journal)/i.test(norm);

  if (isVendorBalanceQuery) {
    const vendName = extractPartyName(raw, "", "", lang);
    return {
      toolName: "query_workspace_data",
      args: { scope: "vendors", query: vendName },
      thoughtAr: `تحليل النية: استعلام فوري عن مستحقات وفواتير المورد (${vendName || "الكل"}) في سجل المشتريات.`,
      thoughtEn: `Intent parsed: Query vendor payables and bills for (${vendName || "All"}) with citation links.`,
    };
  }

  // 1.7 Check query_workspace_data: Project Totals & Budget
  const isProjectBudgetQuery =
    /(?:موازنه\s+مشروع|ميزانيه\s+مشروع|تكاليف\s+مشروع|مصروفات\s+مشروع|ارباح\s+مشروع|project\s+budget|project\s+costs|project\s+spend|project\s+totals)/i.test(norm) &&
    !/(?:انشئ|أنشئ|اضف|أضف|جديد|create|new|add)/i.test(norm);

  if (isProjectBudgetQuery) {
    const projName = raw
      .replace(/(?:موازنة|موازنه|ميزانية|ميزانيه|تكاليف|مصروفات|أرباح|ارباح|مشروع|project|budget|costs|totals)(?:\s+|$|\b)/gi, "")
      .trim();
    return {
      toolName: "query_workspace_data",
      args: { scope: "projects", query: projName },
      thoughtAr: `تحليل النية: استعلام فوري عن موازنة وتكاليف وأرباح المشروع (${projName || "العام"}) مع روابط بطاقة المشروع والتقارير.`,
      thoughtEn: `Intent parsed: Query project budget, costs, and profit for (${projName || "All"}) with citation links.`,
    };
  }

  // 1.8 Check query_workspace_data: Recent Vouchers
  const isRecentVouchersQuery =
    /(?:آخر\s+السندات|اخر\s+السندات|اخر\s+سندات|آخر\s+سندات|سندات\s+اليوم|السندات\s+الاخيره|السندات\s+الأخيرة|recent\s+vouchers|latest\s+vouchers)/i.test(norm);

  if (isRecentVouchersQuery) {
    return {
      toolName: "query_workspace_data",
      args: { scope: "vouchers", query: "" },
      thoughtAr: "تحليل النية: استعلام فوري عن آخر سندات القبض والصرف المسجلة بالخزينة مع رابط القسم المباشر.",
      thoughtEn: "Intent parsed: Query recent receipt and payment vouchers in Treasury with citation links.",
    };
  }

  // 2. Check draft_journal_entry intent
  const isJournalDraft =
    /(?:سجل|انشئ|أنشئ|اكمل|اعمل|مسوده|مسودة|ترحيل|رحل)?\s*(?:قيد\s+يوميه|قيد\s+محاسبي|قيد\s+مزدوج|قيد)/i.test(norm) ||
    /(?:draft|create|post|record|make)\s+(?:a\s+)?(?:journal\s+entry|journal\s+voucher|je|double\s+entry)/i.test(norm) ||
    (/(?:مدين|debit)/.test(norm) && /(?:دائن|credit)/.test(norm));

  const isJournalSearch =
    /(?:ابحث|بحث|اعرض|استعرض|قائمه|سجل)\s+(?:في\s+)?(?:القيود|قيود\s+اليوميه)/i.test(norm) ||
    /(?:search|find|list|show)\s+(?:journal\s+entries|journals|ledger\s+entries)/i.test(norm);

  if (isJournalDraft && !isJournalSearch) {
    const coaCodes = extractCoaCodes(raw);
    const amounts = extractMonetaryAmounts(raw, coaCodes);
    const inferred = inferAccountsFromKeywords(raw);

    const debitAcc = coaCodes[0] ?? inferred.debitCode;
    const creditAcc = coaCodes[1] ?? (coaCodes[0] === inferred.creditCode ? "411101" : inferred.creditCode);
    const debitAmount = amounts[0] ?? 0;
    const creditAmount = amounts.length >= 2 ? amounts[1] : debitAmount;

    return {
      toolName: "draft_journal_entry",
      args: {
        narrationAr: raw,
        narrationEn: raw,
        currency,
        exchangeRate,
        costCenterId,
        lines: [
          { accountCode: debitAcc, debit: debitAmount, credit: 0, costCenterId, currency, exchangeRate },
          { accountCode: creditAcc, debit: 0, credit: creditAmount, costCenterId, currency, exchangeRate },
        ],
      },
      thoughtAr: `تحليل النية: طلب إنشاء مسودة قيد يومية مزدوج (حساب مدين: ${debitAcc} بمبلغ ${debitAmount}، حساب دائن: ${creditAcc} بمبلغ ${creditAmount}${exchangeRate ? `، بسعر صرف ${exchangeRate}` : ""}${costCenterId ? `، مركز تكلفة ${costCenterId}` : ""}). سيتم التحقق من صلاحية الدور وتوازن القيد وإرجاع بطاقة المعاينة للتأكيد.`,
      thoughtEn: `Intent parsed: Draft double-entry journal voucher (Debit ${debitAcc} = ${debitAmount}, Credit ${creditAcc} = ${creditAmount}${exchangeRate ? `, FX rate ${exchangeRate}` : ""}${costCenterId ? `, CC ${costCenterId}` : ""}). Enforcing RBAC, 5-level COA leaf check, and Confirmation Preview Card gate.`,
    };
  }

  // 2.0 Operational Execution Intents (Harvest Batch, Sales, Expenses, Worker Wages, Treasury Transfer, Period Lock, Harvest Cycle)
  // 2.0a Period Lock / Unlock ("إغلاق القطفة ...", "قفل القطفة ...", "فتح القطفة ...", "lock period", "unlock harvest")
  if (
    /(?:اغلاق\s+القطف|إغلاق\s+القطف|قفل\s+القطف|فتح\s+القطف|اقفال\s+الفتر|إقفال\s+الفتر|lock\s+(?:period|harvest)|unlock\s+(?:period|harvest)|toggle\s+lock)/i.test(
      norm
    )
  ) {
    return {
      toolName: "toggle_period_lock",
      args: { projectId: activeProjectId, harvest: activeHarvest },
      thoughtAr: `تحليل النية: طلب تغيير حالة الإقفال المحاسبي للقطفة${activeHarvest ? ` (${activeHarvest})` : ""} مع فحص صلاحية الإدارة ومطابقة المخزون.`,
      thoughtEn: `Intent parsed: Toggle accounting period lock${activeHarvest ? ` (${activeHarvest})` : ""} with RBAC & inventory pre-lock checks.`,
    };
  }

  // 2.0b Add Harvest Cycle ("أضف قطفة ...", "قطفة جديدة ...", "add harvest cycle")
  if (/(?:اضف\s+قطف|أضف\s+قطف|اضافه\s+قطف|قطفه\s+جديد|add\s+harvest\s+cycle|new\s+harvest)/i.test(norm)) {
    const m = raw.match(/(?:باسم|قطفة|مرشة|harvest(?:\s+cycle)?)\s*[:=]?\s*([^\d،,\n]{2,40})$/i);
    const name = m ? m[1].trim() : "";
    return {
      toolName: "add_harvest_cycle",
      args: { projectId: activeProjectId, name },
      thoughtAr: `تحليل النية: طلب إضافة دورة حصاد جديدة${name ? ` (${name})` : ""}.`,
      thoughtEn: `Intent parsed: Add new harvest cycle${name ? ` (${name})` : ""}.`,
    };
  }

  // 2.0c Treasury Transfer ("تحويل مالي ...", "تحويل بين الخزائن ...", "treasury transfer")
  if (
    /(?:تحويل\s+مالي|تحويل\s+بين\s+الخزائن|تحويل\s+من\s+الصندوق|تحويل\s+الى\s+البنك|treasury\s+transfer|internal\s+transfer|transfer\s+funds)/i.test(
      norm
    )
  ) {
    const amounts = extractMonetaryAmounts(raw);
    return {
      toolName: "draft_treasury_transfer",
      args: { amount: amounts[0] ?? 0, notes: raw },
      thoughtAr: `تحليل النية: طلب تحويل مالي داخلي بين حسابات الخزينة والبنوك بمبلغ ${amounts[0] ?? 0}.`,
      thoughtEn: `Intent parsed: Draft internal treasury transfer of ${amounts[0] ?? 0}.`,
    };
  }

  // 2.0d Record Harvest Inventory Batch ("سجل دفعة حصاد ...", "إضافة دفعة مخزون ...", "record harvest batch")
  if (
    /(?:دفعه\s+حصاد|دفعه\s+مخزون|سجل\s+حصاد|اضف\s+مخزون|اضافه\s+مخزون|record\s+harvest|add\s+harvest\s+batch|log\s+harvest)/i.test(
      norm
    )
  ) {
    const amounts = extractMonetaryAmounts(raw);
    const bundles = amounts[0] ?? 0;
    const gradeMatch = raw.match(/(?:درجة|فرز|صنف|grade)\s*[:=]?\s*(رقم\s*\d+|ممتاز|[A-Za-z0-9]+)/i);
    return {
      toolName: "draft_harvest_batch",
      args: {
        projectId: activeProjectId,
        harvest: activeHarvest,
        harvestedBundles: bundles,
        grade: gradeMatch ? gradeMatch[1].trim() : "رقم 1",
        notes: raw,
      },
      thoughtAr: `تحليل النية: تسجيل دفعة مخزون حصاد (${bundles} علاقي) ضمن سياق المشروع/القطفة النشطة.`,
      thoughtEn: `Intent parsed: Record harvest inventory batch (${bundles} bundles) in active project/harvest context.`,
    };
  }

  // 2.0e Record Sale Transaction ("سجل بيع ...", "عملية بيع ...", "record sale", "sell bundles")
  if (
    /(?:سجل\s+بيع|عمليه\s+بيع|بيع\s+\d+|record\s+sale|sell\s+\d+|post\s+sale)/i.test(norm) &&
    !/(?:فاتور|invoice)/i.test(norm)
  ) {
    const amounts = extractMonetaryAmounts(raw);
    const bundles = amounts[0] ?? 0;
    const price = amounts[1] ?? 0;
    const credit = amounts[2] ?? 0;
    const customer = extractPartyName(raw, "", "", lang);
    return {
      toolName: "draft_sale_transaction",
      args: {
        projectId: activeProjectId,
        harvest: activeHarvest,
        customer,
        bundles,
        price,
        credit,
        notes: raw,
      },
      thoughtAr: `تحليل النية: إعداد عملية بيع من مخزون الحصاد مع فحص إغلاق القطفة وتوفر الكمية بالقطفة.`,
      thoughtEn: `Intent parsed: Draft harvest sale transaction with period-lock & stock availability cross-checks.`,
    };
  }

  // 2.0f Record Operating Expense ("سجل مصروف ...", "مصروف وقود ...", "record expense", "operating expense")
  if (
    /(?:سجل\s+مصروف|اضف\s+مصروف|مصروف\s+وقود|مصروف\s+نقل|مصروف\s+صيانه|record\s+expense|add\s+expense|operating\s+expense)/i.test(
      norm
    )
  ) {
    const amounts = extractMonetaryAmounts(raw);
    const amount = amounts[0] ?? 0;
    let category = "مصروفات تشغيلية";
    if (norm.includes("وقود") || norm.includes("ديزل") || norm.includes("fuel")) category = "وقود/محروقات";
    else if (norm.includes("نقل") || norm.includes("transport")) category = "نقل وتوريد";
    else if (norm.includes("وجب") || norm.includes("meal")) category = "وجبات/إعاشة";
    else if (norm.includes("صيان") || norm.includes("maint")) category = "صيانة ومستلزمات";
    return {
      toolName: "draft_operating_expense",
      args: {
        projectId: activeProjectId,
        harvest: activeHarvest,
        category,
        qty: 1,
        unitPrice: amount,
        notes: raw,
      },
      thoughtAr: `تحليل النية: إعداد مسودة مصروف تشغيلي (${category}) بمبلغ ${amount} مع فحص الموازنة ورصيد الخزينة.`,
      thoughtEn: `Intent parsed: Draft operating expense (${category}) of ${amount} with budget & treasury checks.`,
    };
  }

  // 2.0g Record Worker Wage ("سجل أجر ...", "أجر عامل ...", "يومية عامل ...", "record wage", "worker wage")
  if (
    /(?:سجل\s+اجر|اجر\s+عامل|اجر\s+العامل|يوميه\s+عامل|record\s+wage|worker\s+wage|add\s+wage)/i.test(norm)
  ) {
    const amounts = extractMonetaryAmounts(raw);
    const dailyWage = amounts[0] ?? 0;
    const daysMatch = raw.match(/(?:لمدة|عدد)\s*(\d+)\s*(?:يوم|ايام|أيام|days?)/i);
    const days = daysMatch ? Number(daysMatch[1]) : 1;
    const nameMatch = raw.match(/(?:للعامل|العامل|worker)\s+([^\d،,\n]{2,30})/i);
    const name = nameMatch ? nameMatch[1].replace(/\b(بمبلغ|مبلغ|لمدة|في|at|for)\b.*$/i, "").trim() : "";
    return {
      toolName: "draft_worker_wage",
      args: {
        projectId: activeProjectId,
        harvest: activeHarvest,
        name,
        dailyWage,
        days,
        notes: raw,
      },
      thoughtAr: `تحليل النية: إعداد قيد أجر عامل${name ? ` (${name})` : ""} بمعدل ${dailyWage} × ${days} يوم.`,
      thoughtEn: `Intent parsed: Draft worker wage${name ? ` (${name})` : ""} at ${dailyWage} × ${days} days.`,
    };
  }

  // 3. Check draft_voucher (Receipt / Payment Voucher)
  const isReceiptVoucher =
    /(?:سند\s+قبض|اقبض|قبض\s+مبلغ|تحصيل\s+سند|receipt\s+voucher|receive\s+voucher)/i.test(norm);
  const isPaymentVoucher =
    /(?:سند\s+صرف|اصرف\s+سند|صرف\s+مبلغ|payment\s+voucher|pay\s+voucher)/i.test(norm);

  if (isReceiptVoucher || isPaymentVoucher) {
    const coaCodes = extractCoaCodes(raw);
    const amounts = extractMonetaryAmounts(raw, coaCodes);
    const amount = amounts[0] ?? 0;
    const partyName = extractPartyName(
      raw,
      isReceiptVoucher ? "عميل نقدي" : "مستفيد عام",
      isReceiptVoucher ? "Cash Customer" : "General Payee",
      lang
    );

    return {
      toolName: "draft_voucher",
      args: {
        voucherType: isReceiptVoucher ? "RECEIPT" : "PAYMENT",
        partyName,
        amount,
        currency,
        exchangeRate,
        costCenterId,
        narration: raw,
      },
      thoughtAr: `تحليل النية: طلب إعداد مسودة ${isReceiptVoucher ? "سند قبض" : "سند صرف"} بمبلغ ${amount} ${currency}${exchangeRate ? ` بسعر صرف ${exchangeRate}` : ""} للطرف (${partyName})${costCenterId ? ` [مركز ${costCenterId}]` : ""}.`,
      thoughtEn: `Intent parsed: Draft ${isReceiptVoucher ? "Receipt Voucher" : "Payment Voucher"} for ${amount} ${currency}${exchangeRate ? ` at rate ${exchangeRate}` : ""} (${partyName})${costCenterId ? ` [CC ${costCenterId}]` : ""}.`,
    };
  }

  // 4. Check draft_invoice (Sales Invoice / Purchase Bill)
  const isSalesInvoice =
    /(?:فاتوره\s+مبيعات|فاتوره\s+بيع|انشئ\s+فاتوره|سجل\s+فاتوره|sales\s+invoice|draft\s+invoice|create\s+invoice)/i.test(
      norm
    );
  const isPurchaseInvoice =
    /(?:فاتوره\s+مشتريات|فاتوره\s+شراء|فاتوره\s+مورد|purchase\s+invoice|purchase\s+bill|vendor\s+bill)/i.test(
      norm
    );

  if (isSalesInvoice || isPurchaseInvoice) {
    const amounts = extractMonetaryAmounts(raw);
    const rawAmount = amounts[0] ?? 0;
    const partyName = extractPartyName(
      raw,
      isPurchaseInvoice ? "مورد معتمد" : "عميل تجاري",
      isPurchaseInvoice ? "Approved Vendor" : "Commercial Client",
      lang
    );
    const isCash = /(?:نقد|نقدا|نقدي|cash)/i.test(norm);

    const qty = multiUnit ? multiUnit.quantity : 1;
    const factorToBase = multiUnit ? multiUnit.factorToBase : 1;
    const amount = rawAmount > 0 ? rawAmount : (qty * 100);

    return {
      toolName: "draft_invoice",
      args: {
        invoiceType: isPurchaseInvoice ? "PURCHASE" : "SALES",
        partyName,
        amount,
        quantity: qty,
        unitPrice: qty > 1 ? Number((amount / qty).toFixed(2)) : amount,
        paymentMethod: isCash ? "CASH" : "CREDIT",
        currency,
        exchangeRate,
        costCenterId,
        factorToBase,
        unitName: multiUnit?.unitName,
      },
      thoughtAr: `تحليل النية: طلب إعداد مسودة ${isPurchaseInvoice ? "فاتورة مشتريات" : "فاتورة مبيعات"} بمبلغ ${amount} ${currency}${multiUnit ? ` (${qty} ${multiUnit.unitName} × معامل تحويل ${factorToBase})` : ""} (${partyName})${costCenterId ? ` [مركز ${costCenterId}]` : ""}.`,
      thoughtEn: `Intent parsed: Draft ${isPurchaseInvoice ? "Purchase Bill" : "Sales Invoice"} for ${amount} ${currency}${multiUnit ? ` (${qty} ${multiUnit.unitName} × factor ${factorToBase})` : ""} (${partyName})${costCenterId ? ` [CC ${costCenterId}]` : ""}.`,
    };
  }

  // 5. Check verify_qr_document
  const qrMatch =
    raw.match(/\b((?:VCH|INV|SAL|PAY|REC|UAS|JE|PO|BILL)-[A-Za-z0-9-]+)\b/i) ||
    (/(?:تحقق\s+من|فحص\s+سند|فحص\s+فاتوره|رمز\s*qr|verify\s+qr|verify\s+voucher|verify\s+document)/i.test(norm)
      ? raw.match(/\b([A-Za-z0-9-]{4,32})\b$/i)
      : null);
  if (
    qrMatch &&
    /(?:تحقق|فحص|صحه|موثوقيه|qr|verify|authentic|check\s+voucher|check\s+document)/i.test(norm)
  ) {
    return {
      toolName: "verify_qr_document",
      args: { code: qrMatch[1] },
      thoughtAr: `تحليل النية: التحقق الرقمي من صحة السند/الوثيقة برمز (${qrMatch[1]}).`,
      thoughtEn: `Intent parsed: Cryptographic QR verification for document reference '${qrMatch[1]}'.`,
    };
  }

  // 6. Check query_account_balance
  if (
    /(?:رصيد\s+حساب|كم\s+رصيد|استعلم\s+عن\s+حساب|رصيد\s+الصندوق|رصيد\s+البنك|account\s+balance|balance\s+of|query\s+account)/i.test(
      norm
    )
  ) {
    const codes = extractCoaCodes(raw);
    let query = codes[0] ?? "";
    if (!query) {
      if (norm.includes("صندوق") || norm.includes("خزينه") || norm.includes("vault") || norm.includes("cash")) {
        query = "111101";
      } else if (norm.includes("كريمي") || norm.includes("kuraimi") || norm.includes("بنك") || norm.includes("bank")) {
        query = "111201";
      } else if (norm.includes("عملاء") || norm.includes("receivable")) {
        query = "112101";
      } else if (norm.includes("موردين") || norm.includes("payable")) {
        query = "211101";
      } else if (norm.includes("ايراد") || norm.includes("revenue")) {
        query = "411101";
      } else {
        query = "111101";
      }
    }
    return {
      toolName: "query_account_balance",
      args: { query },
      thoughtAr: `تحليل النية: الاستعلام عن رصيد وتفاصيل الحساب (${query}) في شجرة الحسابات.`,
      thoughtEn: `Intent parsed: Query account balance and metadata for '${query}'.`,
    };
  }

  // 7. Check search_journal_entries
  if (isJournalSearch) {
    return {
      toolName: "search_journal_entries",
      args: { search: "" },
      thoughtAr: "تحليل النية: البحث واستعراض قيود اليومية في دفتر الأستاذ العام.",
      thoughtEn: "Intent parsed: Search and list General Ledger journal entries.",
    };
  }

  // 8. Check reconcile_harvest_inventory & check_item_stock
  if (
    /(?:مطابقه\s+الحصاد|مطابقه\s+المخزون|تالف\s+الحصاد|عجز\s+المخزون|reconcile\s+harvest|harvest\s+reconciliation|stock\s+shortage|shrinkage)/i.test(
      norm
    )
  ) {
    return {
      toolName: "reconcile_harvest_inventory",
      args: { projectId: activeProjectId, harvest: activeHarvest },
      thoughtAr: `تحليل النية: تنفيذ مطابقة شاملة بين دفعات الحصاد، الفاقد/التالف، المبيعات، والرصيد المتبقي.`,
      thoughtEn: `Intent parsed: Run cross-section reconciliation across harvest batches, shrinkage, sales, and remaining stock.`,
    };
  }

  if (
    /(?:تحليل\s+الوضع|تحليل\s+الشاشه|تحليل\s+السياق|ملخص\s+القسم|فحص\s+العمل|analyze\s+workspace|analyze\s+current|executive\s+briefing|what\s+needs\s+attention)/i.test(
      norm
    )
  ) {
    return {
      toolName: "analyze_workspace_context",
      args: { focus: activeTab || "dashboard" },
      thoughtAr: `تحليل النية: فحص سياق الشاشة النشطة (${activeTab || "dashboard"}) ومؤشرات المشروع والسيولة وحالة المزامنة.`,
      thoughtEn: `Intent parsed: Inspect active tab (${activeTab || "dashboard"}), project/harvest KPIs, and online/offline sync status.`,
    };
  }

  if (
    /(?:فحص\s+المخزون|كميه\s+المخزون|رصيد\s+المخزون|الاصناف\s+المتوفره|check\s+stock|item\s+stock|inventory\s+balance|available\s+stock)/i.test(
      norm
    )
  ) {
    return {
      toolName: "check_item_stock",
      args: { query: "" },
      thoughtAr: "تحليل النية: فحص الكميات المتاحة في المخزون ودفعات المحصول.",
      thoughtEn: "Intent parsed: Check available inventory stock and harvest batches.",
    };
  }

  // 8.5 Workspace Workers / Audit / Treasury Query
  if (/(?:اجور\s+العمال|ملخص\s+العمال|مستحقات\s+العمال|workers\s+summary|payroll\s+summary)/i.test(norm)) {
    return {
      toolName: "query_workspace_data",
      args: { scope: "workers", query: raw },
      thoughtAr: "تحليل النية: استعراض ملخص أجور العمال والمبالغ المدفوعة والمتبقية.",
      thoughtEn: "Intent parsed: Query worker wage totals and unpaid balances.",
    };
  }

  if (/(?:الفترات\s+المغلقه|سجل\s+التدقيق|حاله\s+المزامنه|طابور\s+الاوفلاين|audit\s+trail|locked\s+periods|sync\s+queue)/i.test(norm)) {
    return {
      toolName: "query_workspace_data",
      args: { scope: "audit", query: raw },
      thoughtAr: "تحليل النية: فحص سجل التدقيق وإقفال القطفات وطابور المزامنة.",
      thoughtEn: "Intent parsed: Query audit trail, locked harvest periods, and offline sync queue.",
    };
  }

  if (/(?:ارصده\s+الخزائن|ارصده\s+البنوك|حاله\s+السيوله|treasury\s+balances|cash\s+balances)/i.test(norm)) {
    return {
      toolName: "query_workspace_data",
      args: { scope: "treasury", query: raw },
      thoughtAr: "تحليل النية: فحص أرصدة حسابات الخزينة والبنوك المتاحة.",
      thoughtEn: "Intent parsed: Query live treasury cash and bank account balances.",
    };
  }

  // 9. Check generate_report_summary
  if (
    /(?:ميزان\s+المراجعه|قائمه\s+الدخل|الارباح\s+والخسائر|الميزانيه\s+العموميه|المركز\s+المالي|ملخص\s+التقارير|تقرير\s+مالي|trial\s+balance|income\s+statement|profit\s+and\s+loss|p&l|balance\s+sheet|financial\s+report)/i.test(
      norm
    )
  ) {
    return {
      toolName: "generate_report_summary",
      args: { reportType: "all" },
      thoughtAr: "تحليل النية: توليد ملخص فوري للقوائم المالية (ميزان المراجعة، قائمة الدخل، والميزانية العمومية).",
      thoughtEn: "Intent parsed: Generate real-time financial report summary (Trial Balance, P&L, Balance Sheet).",
    };
  }

  // 10. Check diagnose_system_health
  if (
    /(?:تشخيص\s+النظام|فحص\s+النظام|حاله\s+الترخيص|حاله\s+النظام|فحص\s+المقاعد|diagnose\s+system|system\s+health|check\s+license\s+status|seat\s+usage)/i.test(
      norm
    ) &&
    !/(?:كيف|لماذا|خطوات|دليل|how|why)/i.test(norm)
  ) {
    return {
      toolName: "diagnose_system_health",
      args: {},
      thoughtAr: "تحليل النية: تشغيل التشخيص الفوري لحالة الترخيص، تطابق اسم المنشأة، ومقاعد الـ 7 مستخدمين.",
      thoughtEn: "Intent parsed: Run live diagnostics on license status, company lock, and 7-user device seats.",
    };
  }

  // 10.5 Warm conversational greeting / capability overview (Yemeni or English)
  if (
    /^(?:مرحبا|اهلا|أهلا|هلا|حياك|السلام عليكم|صباح الخير|مساء الخير|كيف حالك|ايش تقدر|وش تقدر|من انت|hello|hi|hey|good morning|good evening|who are you)/i.test(
      norm
    )
  ) {
    return {
      toolName: "analyze_workspace_context",
      args: { focus: "greeting" },
      thoughtAr: "تحليل النية: ترحيب وتقديم مساعدة مخصصة حسب القسم والمشروع النشط.",
      thoughtEn: "Intent parsed: Conversational greeting and context-grounded assistance overview.",
    };
  }

  // 11. Default: search_user_manual (Bilingual Customer Service & User Manual + Live Diagnostics)
  return {
    toolName: "search_user_manual",
    args: { query: raw },
    thoughtAr: "تحليل النية: البحث في قاعدة معرفة خدمة العملاء ودليل المستخدم (7 فصول) مع دمج التشخيص الفوري.",
    thoughtEn: "Intent parsed: Search the 7-chapter bilingual User Manual & Customer Service knowledge base with live diagnostics.",
  };
}

// ---------------------------------------------------------------------------
// Tier 2 (Local Ollama 127.0.0.1:11434) & Tier 1 (Online Cloud LLM) Probes
// ---------------------------------------------------------------------------

async function tryLocalOllamaIntent(
  prompt: string,
  ollamaUrl = "http://127.0.0.1:11434"
): Promise<ParsedAgentIntent | null> {
  try {
    const cleanBase = ollamaUrl.replace(/\/+$/, "");
    const toolNames = UAS_AGENT_TOOL_SCHEMAS.map((t) => `${t.name}: ${t.descriptionEn}`).join("\n");
    const sysPrompt =
      `You are the UAS ERP AI router. Pick ONE tool from:\n${toolNames}\n` +
      `Respond ONLY with valid JSON: {"toolName":"...","args":{...},"thoughtAr":"...","thoughtEn":"..."}`;

    const res = await fetch(`${cleanBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.UAS_OLLAMA_MODEL || "qwen2.5:3b",
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as Partial<ParsedAgentIntent>;
    if (
      parsed.toolName &&
      UAS_AGENT_TOOL_SCHEMAS.some((s) => s.name === parsed.toolName)
    ) {
      return {
        toolName: parsed.toolName as UasAgentToolName,
        args: (parsed.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>,
        thoughtAr: parsed.thoughtAr || `تم تحليل الطلب عبر المحرك المحلي (Ollama): ${parsed.toolName}`,
        thoughtEn: parsed.thoughtEn || `Routed via local Ollama LLM: ${parsed.toolName}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function tryOnlineCloudLlmIntent(
  prompt: string,
  apiKey: string,
  apiUrl = "https://api.openai.com/v1/chat/completions"
): Promise<ParsedAgentIntent | null> {
  try {
    const toolNames = UAS_AGENT_TOOL_SCHEMAS.map((t) => `${t.name}: ${t.descriptionEn}`).join("\n");
    const sysPrompt =
      `You are the UAS ERP AI reasoning agent. Pick ONE tool from:\n${toolNames}\n` +
      `Respond ONLY with JSON: {"toolName":"...","args":{...},"thoughtAr":"...","thoughtEn":"..."}`;

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.UAS_CLOUD_LLM_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as Partial<ParsedAgentIntent>;
    if (
      parsed.toolName &&
      UAS_AGENT_TOOL_SCHEMAS.some((s) => s.name === parsed.toolName)
    ) {
      return {
        toolName: parsed.toolName as UasAgentToolName,
        args: (parsed.args && typeof parsed.args === "object" ? parsed.args : {}) as Record<string, unknown>,
        thoughtAr: parsed.thoughtAr || `تم الاستدلال عبر النموذج السحابي: ${parsed.toolName}`,
        thoughtEn: parsed.thoughtEn || `Reasoned via Cloud LLM: ${parsed.toolName}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main 3-Tier Reasoning Entrypoint
// ---------------------------------------------------------------------------

export interface RunUasAiAgentOptions extends UasAgentExecutionContext {
  /** Explicit tool invocation (bypasses NLP parsing when user clicks a quick action). */
  explicitTool?: {
    toolName: UasAgentToolName;
    args: Record<string, unknown>;
  };
  /** Set true on desktop server to probe local Ollama (http://127.0.0.1:11434) before Tier 3. */
  enableLocalOllamaProbe?: boolean;
  /** Optional cloud API key for Tier 1 online reasoning. */
  cloudApiKey?: string;
  /** Skip browser localStorage learning/forget (used when server /api/ai/agent owns persistence). */
  skipLocalLearning?: boolean;
}

export async function runUasAiAgent(
  prompt: string,
  opts: RunUasAiAgentOptions = {}
): Promise<UasAiAgentResponse> {
  const cleanPrompt = String(prompt ?? "").trim();
  const lang = opts.lang ?? detectSupportLanguage(cleanPrompt, "ar");
  const tenantSlug = normalizeMemoryTenantSlug(
    opts.workspaceContext?.tenantSlug || opts.state?.enterpriseProfile?.tenantSlug
  );
  const currentUserId =
    typeof opts.user === "object" && opts.user ? opts.user.id : undefined;

  let learnedEvents: MemoryMutationEvent[] | undefined;
  let forgottenEntries: CopilotMemoryEntry[] | undefined;

  if (!opts.skipLocalLearning && typeof window !== "undefined" && cleanPrompt) {
    const forgetIntent = detectForgetMemoryIntent(cleanPrompt);
    if (forgetIntent.matched && forgetIntent.query) {
      const removed = forgetLocalCopilotMemories({
        tenantSlug,
        userId: currentUserId,
        query: forgetIntent.query,
      });
      if (removed.length > 0) {
        forgottenEntries = removed;
        learnedEvents = removed.map((entry) => ({
          action: "forgotten" as const,
          entry,
          previousEntry: entry,
        }));
      }
    } else {
      const candidates = extractDeterministicMemories({
        prompt: cleanPrompt,
        tenantSlug,
        userId: currentUserId,
        activeTab: opts.workspaceContext?.activeTab,
      });
      const events: MemoryMutationEvent[] = [];
      for (const c of candidates) {
        const ev = upsertLocalCopilotMemory(c);
        if (ev) events.push(ev);
      }
      if (events.length > 0) {
        learnedEvents = events;
      }
    }
  }

  const candidateMemories =
    opts.memories ??
    (typeof window !== "undefined" ? loadLocalCopilotMemories(tenantSlug) : []);
  const appliedMemories = retrieveRelevantMemories({
    entries: candidateMemories,
    tenantSlug,
    userId: currentUserId,
    query: cleanPrompt,
    activeTab: opts.workspaceContext?.activeTab,
    limit: 5,
  });

  let tierUsed: ReasoningTier = "tier3_offline_deterministic";
  let intent: ParsedAgentIntent | null = null;

  if (opts.explicitTool) {
    intent = {
      toolName: opts.explicitTool.toolName,
      args: opts.explicitTool.args,
      thoughtAr: `تنفيذ الأداة المحددة مباشرة: ${opts.explicitTool.toolName}`,
      thoughtEn: `Direct tool execution: ${opts.explicitTool.toolName}`,
    };
  } else {
    // Tier 1: Online Cloud LLM (if API key configured)
    const apiKey = opts.cloudApiKey || (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : undefined);
    if (apiKey) {
      intent = await tryOnlineCloudLlmIntent(cleanPrompt, apiKey);
      if (intent) tierUsed = "tier1_cloud_llm";
    }

    // Tier 2: Offline Local Ollama (http://127.0.0.1:11434)
    if (!intent && opts.enableLocalOllamaProbe) {
      const ollamaUrl =
        (typeof process !== "undefined" ? process.env?.UAS_LOCAL_LLM_URL : undefined) ||
        "http://127.0.0.1:11434";
      intent = await tryLocalOllamaIntent(cleanPrompt, ollamaUrl);
      if (intent) tierUsed = "tier2_local_ollama";
    }

    // Tier 3: Zero-Dependency Deterministic Bilingual NLP Engine
    if (!intent) {
      intent = parseBilingualAgentIntent(cleanPrompt, { ...opts, lang });
      tierUsed = "tier3_offline_deterministic";
    }
  }

  // Execute tool through RBAC & Financial Guardrail Registry
  const localVisionEntries =
    opts.visionArchiveEntries ??
    (typeof window !== "undefined" ? loadLocalVisionArchive(tenantSlug) : []);
  void filterVisionArchiveAttachments;
  const toolResult = await executeUasAgentTool(intent.toolName, intent.args, {
    ...opts,
    lang,
    memories: appliedMemories,
    visionArchiveEntries: localVisionEntries,
  });

  const wCtx = opts.workspaceContext;
  const ctxTagAr = wCtx?.activeTab
    ? ` [الشاشة: ${wCtx.activeTab}${wCtx.isOffline ? " • وضع أوفلاين" : " • متصل"}${wCtx.offlineQueueCount ? ` • طابور: ${wCtx.offlineQueueCount}` : ""}]`
    : "";
  const ctxTagEn = wCtx?.activeTab
    ? ` [Tab: ${wCtx.activeTab}${wCtx.isOffline ? " • Offline" : " • Online"}${wCtx.offlineQueueCount ? ` • Queue: ${wCtx.offlineQueueCount}` : ""}]`
    : "";
  const preFlightWarnings = toolResult.confirmationCard?.warningsAr ?? [];
  const preFlightWarningsEn = toolResult.confirmationCard?.warningsEn ?? [];

  const reasoningTrace: AgentReasoningStep[] = [
    {
      step: 1,
      type: "thought",
      titleAr: "1. فحص السياق وتحليل النية (Context & Reasoning)",
      titleEn: "1. Context Inspection & Intent Analysis",
      detailAr: `${intent.thoughtAr}${ctxTagAr}`,
      detailEn: `${intent.thoughtEn}${ctxTagEn}`,
    },
    {
      step: 2,
      type: "tool_call",
      titleAr: `2. استدعاء الأداة المحاسبية (${intent.toolName})`,
      titleEn: `2. Tool Invocation (${intent.toolName})`,
      detailAr: `التحقق من صلاحية الدور (RBAC) وتمرير المعاملات: \`${JSON.stringify(intent.args)}\``,
      detailEn: `Verifying RBAC permissions and passing arguments: \`${JSON.stringify(intent.args)}\``,
      toolName: intent.toolName,
      toolArgs: intent.args,
    },
    {
      step: 3,
      type: "observation",
      titleAr: "3. الفحص المتقاطع وبوابة الأمان (Cross-Section Check & Safety)",
      titleEn: "3. Cross-Section Pre-Flight & Safety Gate",
      detailAr: toolResult.requiresConfirmation
        ? `تم التحقق من التوازن والصلاحيات وفحص الأقسام المرتبطة${preFlightWarnings.length > 0 ? ` (${preFlightWarnings.length} تنبيه/ملاحظة)` : ""}؛ تم تفعيل بوابة التأكيد الإلزامي.`
        : toolResult.ok
        ? "تم تنفيذ الاستعلام/التحليل المتقاطع بنجاح."
        : `تم إيقاف العملية بواسطة ضوابط الرقابة (${toolResult.code || "BLOCKED"}).`,
      detailEn: toolResult.requiresConfirmation
        ? `Verified permissions and cross-section prerequisites${preFlightWarningsEn.length > 0 ? ` (${preFlightWarningsEn.length} notice(s))` : ""}; activated mandatory Confirmation Preview Card gate.`
        : toolResult.ok
        ? "Cross-section query/analysis completed successfully."
        : `Operation blocked by safety/RBAC guardrail (${toolResult.code || "BLOCKED"}).`,
    },
    {
      step: 4,
      type: "response",
      titleAr: "4. صياغة الرد النهائي",
      titleEn: "4. Final Bilingual Response",
      detailAr:
        appliedMemories.length > 0
          ? `الاستجابة جاهزة عبر (${tierUsed}) مع مراعاة ${appliedMemories.length} قاعدة/تفضيل من ذاكرة المنشأة.`
          : `الاستجابة جاهزة عبر (${tierUsed}).`,
      detailEn:
        appliedMemories.length > 0
          ? `Response generated via (${tierUsed}) grounded with ${appliedMemories.length} learned tenant memory rule(s).`
          : `Response generated via (${tierUsed}).`,
    },
  ];

  const memoryNoticeAr =
    forgottenEntries && forgottenEntries.length > 0
      ? `\n\n🧹 **تم حذف ${forgottenEntries.length} قاعدة من ذاكرة المساعد لهذه المنشأة.**`
      : appliedMemories.length > 0 && !opts.memories
      ? `\n\n🧠 **تفضيلات وقواعد محفوظة مفعّلة:** ${appliedMemories.slice(0, 2).map((m) => m.content).join(" • ")}`
      : "";
  const memoryNoticeEn =
    forgottenEntries && forgottenEntries.length > 0
      ? `\n\n🧹 **Forgot ${forgottenEntries.length} learned rule(s) for this tenant.**`
      : appliedMemories.length > 0 && !opts.memories
      ? `\n\n🧠 **Active tenant memory applied:** ${appliedMemories.slice(0, 2).map((m) => m.content).join(" • ")}`
      : "";

  const finalAr = `${toolResult.summaryAr}${memoryNoticeAr}`;
  const finalEn = `${toolResult.summaryEn}${memoryNoticeEn}`;

  return {
    ok: toolResult.ok,
    lang,
    tierUsed,
    modelUsed:
      tierUsed === "tier3_offline_deterministic"
        ? "Offline Local Engine"
        : tierUsed === "tier2_local_ollama"
        ? "Local Ollama LLM"
        : "Cloud LLM",
    prompt: cleanPrompt,
    reply: lang === "ar" ? finalAr : finalEn,
    replyAr: finalAr,
    replyEn: finalEn,
    toolName: intent.toolName,
    toolArgs: intent.args,
    toolResult,
    requiresConfirmation: toolResult.requiresConfirmation,
    confirmationCard: toolResult.confirmationCard,
    navigationTab: toolResult.navigationTab,
    openLicenseModal: toolResult.openLicenseModal,
    citations: toolResult.citations,
    clarificationPrompt: toolResult.clarificationPrompt,
    escalationCard: toolResult.escalationCard,
    reasoningTrace,
    ...(learnedEvents ? { learnedEvents } : {}),
    ...(forgottenEntries ? { forgottenEntries } : {}),
    ...(appliedMemories.length > 0 ? { appliedMemories } : {}),
  };
}

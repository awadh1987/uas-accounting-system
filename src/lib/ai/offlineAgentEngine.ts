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
  type ConfirmationPreviewCard,
  type UasAgentExecutionContext,
  type UasAgentToolName,
  type UasAgentToolResult,
} from "./uasAgentTools";
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
  reasoningTrace: AgentReasoningStep[];
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

export function parseBilingualAgentIntent(prompt: string): ParsedAgentIntent {
  const raw = String(prompt ?? "").trim();
  const norm = normalizeSupportText(normalizeDigits(raw));
  const lang = detectSupportLanguage(raw, "ar");
  const currency = extractCurrencyFromPrompt(raw);
  const exchangeRate = extractExchangeRateFromPrompt(raw);
  const costCenterId = extractCostCenterFromPrompt(raw);
  const multiUnit = extractMultiUnitQuantityFromPrompt(raw);

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

  // 8. Check check_item_stock
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
}

export async function runUasAiAgent(
  prompt: string,
  opts: RunUasAiAgentOptions = {}
): Promise<UasAiAgentResponse> {
  const cleanPrompt = String(prompt ?? "").trim();
  const lang = opts.lang ?? detectSupportLanguage(cleanPrompt, "ar");

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
      intent = parseBilingualAgentIntent(cleanPrompt);
      tierUsed = "tier3_offline_deterministic";
    }
  }

  // Execute tool through RBAC & Financial Guardrail Registry
  const toolResult = await executeUasAgentTool(intent.toolName, intent.args, {
    ...opts,
    lang,
  });

  const reasoningTrace: AgentReasoningStep[] = [
    {
      step: 1,
      type: "thought",
      titleAr: "1. التفكير وتحليل النية (Reasoning & Intent)",
      titleEn: "1. Reasoning & Intent Analysis",
      detailAr: intent.thoughtAr,
      detailEn: intent.thoughtEn,
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
      titleAr: "3. نتيجة الفحص وبوابة الأمان (Observation & Safety Gate)",
      titleEn: "3. Observation & Financial Safety Gate",
      detailAr: toolResult.requiresConfirmation
        ? "تم التحقق من توازن المدين والدائن وصحة الحسابات الفرعية؛ تم تفعيل بوابة التأكيد الإلزامي قبل الترحيل."
        : toolResult.ok
        ? "تم تنفيذ الاستعلام/التشخيص بنجاح."
        : `تم إيقاف العملية بواسطة ضوابط الرقابة (${toolResult.code || "BLOCKED"}).`,
      detailEn: toolResult.requiresConfirmation
        ? "Verified Debit === Credit balance and leaf COA accounts; activated mandatory Confirmation Preview Card gate."
        : toolResult.ok
        ? "Read/diagnostic operation completed immediately."
        : `Operation blocked by safety/RBAC guardrail (${toolResult.code || "BLOCKED"}).`,
    },
    {
      step: 4,
      type: "response",
      titleAr: "4. صياغة الرد النهائي",
      titleEn: "4. Final Bilingual Response",
      detailAr: `الاستجابة جاهزة عبر (${tierUsed}).`,
      detailEn: `Response generated via (${tierUsed}).`,
    },
  ];

  return {
    ok: toolResult.ok,
    lang,
    tierUsed,
    prompt: cleanPrompt,
    reply: lang === "ar" ? toolResult.summaryAr : toolResult.summaryEn,
    replyAr: toolResult.summaryAr,
    replyEn: toolResult.summaryEn,
    toolName: intent.toolName,
    toolArgs: intent.args,
    toolResult,
    requiresConfirmation: toolResult.requiresConfirmation,
    confirmationCard: toolResult.confirmationCard,
    navigationTab: toolResult.navigationTab,
    openLicenseModal: toolResult.openLicenseModal,
    reasoningTrace,
  };
}

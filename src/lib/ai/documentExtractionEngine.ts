import { STANDARD_COA_NODES } from "@/lib/accounting/coaCatalog";
import { assertNotInLockedPeriod } from "@/lib/accountingSettings";
import type {
  DocumentValidationWarning,
  ExtractedDocumentDraft,
  ExtractedDocumentLine,
} from "@/types/uas";

export interface DocumentValidationContext {
  periodLockDate?: string | null;
  existingReferences?: string[];
  closedFiscalYears?: Array<{ code: string; startDate: string; endDate: string }>;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function lookupCoaNames(code: string): { nameAr: string; nameEn: string } {
  const found = STANDARD_COA_NODES.find((n) => n.code === code);
  if (found) return { nameAr: found.nameAr, nameEn: found.nameEn };
  return { nameAr: `حساب ${code}`, nameEn: `Account ${code}` };
}

/**
 * Validates an extracted (or edited) document draft for missing fields,
 * unbalanced debit/credit lines, low extraction confidence, duplicate references,
 * and fiscal-period/year locks.
 */
export function validateExtractedDraft(
  draft: ExtractedDocumentDraft,
  ctx?: DocumentValidationContext
): DocumentValidationWarning[] {
  const warnings: DocumentValidationWarning[] = [];

  if (!draft.partyName || !draft.partyName.trim()) {
    warnings.push({
      code: "MISSING_FIELD",
      severity: "warning",
      field: "partyName",
      messageAr: "اسم المورد أو العميل غير محدد — يرجى المراجعة أو التعديل قبل الترحيل.",
      messageEn: "Vendor/Customer name is missing — please enter or verify before posting.",
    });
  }

  if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    warnings.push({
      code: "MISSING_FIELD",
      severity: "error",
      field: "date",
      messageAr: "تاريخ المستند غير صالح أو مفقود (الصيغة المطلوبة YYYY-MM-DD).",
      messageEn: "Document date is missing or invalid (expected YYYY-MM-DD).",
    });
  }

  if (!draft.reference || !draft.reference.trim()) {
    warnings.push({
      code: "MISSING_FIELD",
      severity: "warning",
      field: "reference",
      messageAr: "الرقم المرجعي للفاتورة/السند غير محدد.",
      messageEn: "Document reference / invoice number is missing.",
    });
  }

  if (!Array.isArray(draft.lines) || draft.lines.length < 2) {
    warnings.push({
      code: "UNBALANCED",
      severity: "error",
      field: "lines",
      messageAr: "يجب أن يحتوي القيد على سطرين محاسبيين على الأقل (مدين ودائن).",
      messageEn: "Accounting entry must contain at least 2 balanced lines (Debit and Credit).",
    });
  } else {
    const totalDebit = round2(draft.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = round2(draft.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    if (totalDebit <= 0 || totalCredit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
      warnings.push({
        code: "UNBALANCED",
        severity: "error",
        field: "lines",
        messageAr: `القيد غير متوازن: إجمالي المدين (${totalDebit}) ≠ إجمالي الدائن (${totalCredit}).`,
        messageEn: `Entry is unbalanced: Total Debit (${totalDebit}) !== Total Credit (${totalCredit}).`,
      });
    }
  }

  if (draft.confidence < 0.6) {
    warnings.push({
      code: "LOW_CONFIDENCE",
      severity: "warning",
      messageAr: `دقة الاستخراج الآلي منخفضة (${Math.round(draft.confidence * 100)}%) — يرجى مراجعة الأرقام والحسابات بدقة.`,
      messageEn: `Extraction confidence is low (${Math.round(draft.confidence * 100)}%) — please review amounts and accounts carefully.`,
    });
  }

  if (draft.date && ctx?.periodLockDate) {
    const lockRes = assertNotInLockedPeriod(draft.date, ctx.periodLockDate);
    if (!lockRes.ok) {
      warnings.push({
        code: "FISCAL_PERIOD_LOCKED",
        severity: "error",
        field: "date",
        messageAr: lockRes.error,
        messageEn: lockRes.error,
      });
    }
  }

  if (draft.date && Array.isArray(ctx?.closedFiscalYears)) {
    const dTime = new Date(`${draft.date}T12:00:00.000Z`).getTime();
    for (const fy of ctx.closedFiscalYears) {
      const sTime = new Date(fy.startDate).getTime();
      const eTime = new Date(fy.endDate).getTime();
      if (!Number.isNaN(dTime) && dTime >= sTime && dTime <= eTime) {
        warnings.push({
          code: "FISCAL_PERIOD_LOCKED",
          severity: "error",
          field: "date",
          messageAr: `🔒 التاريخ (${draft.date}) يقع ضمن السنة المالية المغلقة (${fy.code}).`,
          messageEn: `🔒 Date (${draft.date}) falls inside closed fiscal year (${fy.code}).`,
        });
        break;
      }
    }
  }

  if (draft.reference && Array.isArray(ctx?.existingReferences)) {
    const refNorm = draft.reference.trim().toLowerCase();
    const dup = ctx.existingReferences.some((r) => r.trim().toLowerCase() === refNorm);
    if (dup) {
      warnings.push({
        code: "DUPLICATE_SUSPECTED",
        severity: "warning",
        field: "reference",
        messageAr: `⚠️ تنبيه تكرار محتمل: المرجع (${draft.reference}) موجود مسبقاً في السجلات.`,
        messageEn: `⚠️ Duplicate Warning: Reference (${draft.reference}) already exists in posted records.`,
      });
    }
  }

  return warnings;
}

function normalizeDateCandidate(raw?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!raw) return today;
  const isoMatch = raw.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }
  const dmyMatch = raw.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  }
  return today;
}

function normalizeArabicDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function detectDocumentType(text: string, fileName: string): ExtractedDocumentDraft["documentType"] {
  const lower = `${fileName} ${text}`.toLowerCase();
  if (/delivery|إشعار تسليم|سند تسليم|استلام بضاعة/.test(lower)) return "DELIVERY_NOTE";
  if (/receipt|سند قبض|إيصال قبض/.test(lower)) return "RECEIPT";
  if (/sales\s*invoice|فاتورة\s*مبيعات|عميل|customer|client/.test(lower)) return "SALES_INVOICE";
  if (/expense|مصروف|وقود|ديزل|بنزين|إيجار|صيانة|receipt\s*slip|سند\s*صرف/.test(lower)) return "EXPENSE_SLIP";
  if (/vendor|supplier|purchase|bill|مورد|فاتورة\s*مشتريات|شراء/.test(lower)) return "PURCHASE_BILL";
  return "EXPENSE_SLIP";
}

function detectCurrency(text: string, fallback = "YER"): string {
  const lower = text.toLowerCase();
  if (/\busd\b|\$|دولار|dollar/.test(lower)) return "USD";
  if (/\bsar\b|ريال سعودي|سعودي|ر\.س/.test(lower)) return "SAR";
  if (/\byer\b|ريال يمني|ر\.ي|ريال/.test(lower)) return "YER";
  return fallback;
}

function detectPaymentMethod(text: string): ExtractedDocumentDraft["paymentMethod"] {
  const lower = text.toLowerCase();
  if (/جوالي|جيب|ون كاش|فلوسك|محفظة|wallet|jawali|jeeb|onecash/.test(lower)) return "WALLET";
  if (/بنك|تحويل|شيك|bank|transfer|wire|kuraimi|كريمي/.test(lower)) return "BANK";
  if (/آجل|على الحساب|credit|due|ذمم/.test(lower)) return "CREDIT";
  return "CASH";
}

function extractAmountByRegex(text: string, patterns: RegExp[]): number {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const cleaned = m[1].replace(/,/g, "").trim();
      const val = Number(cleaned);
      if (Number.isFinite(val) && val > 0) return round2(val);
    }
  }
  return 0;
}

/**
 * Extracts structured accounting draft fields from document text / filename / optional base64
 * with deterministic bilingual Arabic+English parsing and balanced GL account suggestions.
 */
export function parseDocumentTextDeterministically(input: {
  fileName: string;
  mimeType: string;
  textContent: string;
  defaultCurrency?: string;
  validationContext?: DocumentValidationContext;
}): ExtractedDocumentDraft {
  const rawNormalized = normalizeArabicDigits(input.textContent || "");
  const docType = detectDocumentType(rawNormalized, input.fileName);
  const currency = detectCurrency(rawNormalized, input.defaultCurrency || "YER");
  const paymentMethod = detectPaymentMethod(rawNormalized);

  const dateMatch = rawNormalized.match(
    /(?:date|تاريخ|التاريخ)\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/i
  );
  const anyDateMatch = rawNormalized.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})/);
  const date = normalizeDateCandidate(dateMatch?.[1] || anyDateMatch?.[1]);

  const refMatch = rawNormalized.match(
    /(?:invoice|bill|receipt|ref|reference|no|number|رقم الفاتورة|رقم السند|المرجع|رقم)\s*[#:：]?\s*([A-Z0-9-]{3,32})/i
  );
  const reference = refMatch?.[1]?.trim() || `DOC-${Date.now().toString().slice(-6)}`;

  const partyMatch = rawNormalized.match(
    /(?:vendor|supplier|customer|client|payee|from|to|المورد|العميل|المستفيد|اسم الجهة|من)\s*[:：]\s*([^\r\n,;]{2,80})/i
  );
  const partyName = partyMatch?.[1]?.trim() || "";

  let subtotal = extractAmountByRegex(rawNormalized, [
    /(?:sub[\s-]*total|net\s+before\s+tax|before\s+tax|pre[\s-]*tax|المبلغ\s+قبل\s+الضريبة|الصافي\s+قبل\s+الضريبة|قبل\s+الضريبة|المجموع\s+الفرعي)\s*(?:\([^)]*\))?\s*[:：]?\s*([0-9,]+(?:\.\d{1,2})?)/i,
  ]);
  const textWithoutPreTaxLabels = rawNormalized.replace(
    /(?:المبلغ\s+قبل\s+الضريبة|الصافي\s+قبل\s+الضريبة|قبل\s+الضريبة|net\s+before\s+tax|before\s+tax|pre[\s-]*tax|excluding\s+tax|excl\.?\s*tax)\s*(?:\([^)]*\))?\s*[:：]?\s*[0-9,]+(?:\.\d{1,2})?/gi,
    " "
  );
  const taxTotal = extractAmountByRegex(textWithoutPreTaxLabels, [
    /(?:ضريبة\s+القيمة\s+المضافة|قيمة\s+الضريبة|الضريبة|ضريبة|vat|gst|sales\s+tax|tax)\s*(?:\([^)]*\))?\s*[:：]?\s*([0-9,]+(?:\.\d{1,2})?)/i,
  ]);
  const totalAmountRaw = extractAmountByRegex(textWithoutPreTaxLabels, [
    /(?:grand\s*total|net\s*total|total\s*amount|الإجمالي\s+النهائي|إجمالي\s+الفاتورة|الإجمالي|المجموع\s+النهائي|المجموع)\s*(?:\([^)]*\))?\s*[:：]?\s*([0-9,]+(?:\.\d{1,2})?)/i,
    /(?:^|[\r\n,;|•\t]|\s{2,})(?:total|amount\s*due|balance\s*due|الصافي|المبلغ\s+الإجمالي|المبلغ)\s*(?:\([^)]*\))?\s*[:：]?\s*([0-9,]+(?:\.\d{1,2})?)/i,
  ]);

  let totalAmount = totalAmountRaw;
  if (totalAmount <= 0) {
    // Fall back to largest positive currency-like number in document
    const nums = Array.from(rawNormalized.matchAll(/\b([0-9]{2,9}(?:,[0-9]{3})*(?:\.\d{1,2})?)\b/g))
      .map((m) => Number(m[1].replace(/,/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 1_000_000_000);
    if (nums.length > 0) {
      totalAmount = round2(Math.max(...nums));
    }
  }
  if (subtotal <= 0 && totalAmount > 0) {
    subtotal = round2(Math.max(0, totalAmount - taxTotal));
  }
  if (totalAmount <= 0 && subtotal > 0) {
    totalAmount = round2(subtotal + taxTotal);
  }

  // Suggest GL Debit & Credit accounts
  const treasuryCode = paymentMethod === "BANK" || paymentMethod === "WALLET" ? "111201" : "111101";
  const lines: ExtractedDocumentLine[] = [];

  if (totalAmount > 0) {
    if (docType === "SALES_INVOICE" || docType === "RECEIPT") {
      const debitCode = paymentMethod === "CREDIT" ? "112101" : treasuryCode;
      const revCode = "411101";
      const dMeta = lookupCoaNames(debitCode);
      const rMeta = lookupCoaNames(revCode);
      lines.push({
        description: partyName ? `${docType === "RECEIPT" ? "قبض" : "مبيعات"} — ${partyName}` : "طرف مدين",
        accountCode: debitCode,
        accountNameAr: dMeta.nameAr,
        accountNameEn: dMeta.nameEn,
        debit: totalAmount,
        credit: 0,
      });
      lines.push({
        description: `إيراد / تحصيل (${reference})`,
        accountCode: revCode,
        accountNameAr: rMeta.nameAr,
        accountNameEn: rMeta.nameEn,
        debit: 0,
        credit: subtotal > 0 ? subtotal : totalAmount,
      });
      if (taxTotal > 0 && subtotal > 0) {
        const taxMeta = lookupCoaNames("212101");
        lines.push({
          description: "ضريبة مخرجات مستحقة",
          accountCode: "212101",
          accountNameAr: taxMeta.nameAr,
          accountNameEn: taxMeta.nameEn,
          debit: 0,
          credit: taxTotal,
        });
      }
    } else {
      const debitCode = docType === "PURCHASE_BILL" ? "511101" : "524101";
      const creditCode = paymentMethod === "CREDIT" ? "211101" : treasuryCode;
      const dMeta = lookupCoaNames(debitCode);
      const cMeta = lookupCoaNames(creditCode);
      lines.push({
        description: `${docType === "PURCHASE_BILL" ? "مشتريات" : "مصروف"} (${reference})`,
        accountCode: debitCode,
        accountNameAr: dMeta.nameAr,
        accountNameEn: dMeta.nameEn,
        debit: subtotal > 0 ? subtotal : totalAmount,
        credit: 0,
      });
      if (taxTotal > 0 && subtotal > 0) {
        const taxMeta = lookupCoaNames("114101");
        lines.push({
          description: "ضريبة مدخلات مستردة",
          accountCode: "114101",
          accountNameAr: taxMeta.nameAr,
          accountNameEn: taxMeta.nameEn,
          debit: taxTotal,
          credit: 0,
        });
      }
      lines.push({
        description: partyName ? `استحقاق / سداد — ${partyName}` : "طرف دائن",
        accountCode: creditCode,
        accountNameAr: cMeta.nameAr,
        accountNameEn: cMeta.nameEn,
        debit: 0,
        credit: totalAmount,
      });
    }
  }

  let confidence = 0.4;
  if (totalAmount > 0) confidence += 0.25;
  if (partyName) confidence += 0.15;
  if (refMatch?.[1]) confidence += 0.1;
  if (dateMatch?.[1] || anyDateMatch?.[1]) confidence += 0.1;
  confidence = Math.min(0.98, round2(confidence));

  const partyType =
    docType === "SALES_INVOICE" || docType === "RECEIPT"
      ? "CUSTOMER"
      : docType === "PURCHASE_BILL"
      ? "VENDOR"
      : "OTHER";

  const draft: ExtractedDocumentDraft = {
    draftId: `docdraft-${Date.now()}`,
    documentType: docType,
    fileName: input.fileName,
    mimeType: input.mimeType,
    partyName,
    partyType,
    date,
    reference,
    currency,
    paymentMethod,
    subtotal,
    taxTotal,
    totalAmount,
    narrationAr: `${docType === "PURCHASE_BILL" ? "فاتورة مشتريات" : docType === "SALES_INVOICE" ? "فاتورة مبيعات" : docType === "RECEIPT" ? "سند قبض" : "سند مصروف"} رقم ${reference}${partyName ? ` — ${partyName}` : ""}`,
    narrationEn: `${docType} ${reference}${partyName ? ` — ${partyName}` : ""}`,
    confidence,
    extractionProvider: "local_parser",
    lines,
    warnings: [],
    rawTextPreview: rawNormalized.slice(0, 400),
  };

  draft.warnings = validateExtractedDraft(draft, input.validationContext);
  return draft;
}

/**
 * Attempts optional Cloud Vision/LLM extraction when `OPENAI_API_KEY` is configured,
 * otherwise uses deterministic local parser (safe for offline, LAN, and unit tests).
 */
export async function extractDocumentDraft(input: {
  fileName: string;
  mimeType: string;
  textContent?: string;
  base64Content?: string;
  defaultCurrency?: string;
  validationContext?: DocumentValidationContext;
}): Promise<ExtractedDocumentDraft> {
  const openAiKey = (process.env.OPENAI_API_KEY || "").trim();
  const isImage = input.mimeType.startsWith("image/");

  if (openAiKey && isImage && input.base64Content && process.env.NODE_ENV !== "test") {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract accounting invoice/receipt fields as JSON: { documentType: 'PURCHASE_BILL'|'SALES_INVOICE'|'EXPENSE_SLIP'|'RECEIPT'|'DELIVERY_NOTE', partyName, date (YYYY-MM-DD), reference, currency ('YER'|'SAR'|'USD'), paymentMethod ('CASH'|'BANK'|'WALLET'|'CREDIT'), subtotal, taxTotal, totalAmount, narrationAr, narrationEn }.",
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${input.mimeType};base64,${input.base64Content}` },
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          const syntheticText = [
            `type: ${parsed.documentType || ""}`,
            `vendor: ${parsed.partyName || ""}`,
            `date: ${parsed.date || ""}`,
            `ref: ${parsed.reference || ""}`,
            `currency: ${parsed.currency || input.defaultCurrency || "YER"}`,
            `payment: ${parsed.paymentMethod || "CASH"}`,
            `subtotal: ${parsed.subtotal || 0}`,
            `tax: ${parsed.taxTotal || 0}`,
            `total: ${parsed.totalAmount || 0}`,
          ].join("\n");
          const draft = parseDocumentTextDeterministically({
            fileName: input.fileName,
            mimeType: input.mimeType,
            textContent: syntheticText,
            defaultCurrency: input.defaultCurrency,
            validationContext: input.validationContext,
          });
          draft.extractionProvider = "cloud_llm";
          draft.confidence = 0.92;
          if (typeof parsed.narrationAr === "string" && parsed.narrationAr) {
            draft.narrationAr = parsed.narrationAr;
          }
          if (typeof parsed.narrationEn === "string" && parsed.narrationEn) {
            draft.narrationEn = parsed.narrationEn;
          }
          draft.warnings = validateExtractedDraft(draft, input.validationContext);
          return draft;
        }
      }
    } catch {
      // Fall back safely to local deterministic extractor
    }
  }

  return parseDocumentTextDeterministically({
    fileName: input.fileName,
    mimeType: input.mimeType,
    textContent: input.textContent || input.fileName,
    defaultCurrency: input.defaultCurrency,
    validationContext: input.validationContext,
  });
}

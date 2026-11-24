/**
 * UAS Enterprise — Yemeni Arabic Localization, ERP Dialect Grounding & Natural TTS Text Prep
 *
 * Tunes Copilot persona, greetings, everyday trade/cashbox/receivables/harvest expressions,
 * and spoken audio preparation so day-to-day field, warehouse, and accounting guidance
 * feels authentically Yemeni while preserving accounting precision, MSA toggling, and English support.
 */
import { sanitizeSpeechText } from "@/lib/speechSanitizer";

export type CopilotDialectMode = "yemeni" | "msa";

export const YEMENI_ERP_GLOSSARY: Array<{
  termAr: string;
  meaningAr: string;
  english: string;
}> = [
  { termAr: "القطفة", meaningAr: "دورة الحصاد أو موسم القطاف في المشروع", english: "Harvest cycle" },
  { termAr: "العلاقية / العلاقي", meaningAr: "وحدة قياس وبيع المحصول المعتمدة في المخزون والمبيعات", english: "Harvest bundle / unit" },
  { termAr: "البزغة", meaningAr: "بداية موسم التوريد أو تفتح دفعة الحصاد الجديدة", english: "Early harvest sprout / batch onset" },
  { termAr: "الفاقد / التالف", meaningAr: "الكميات المخصومة من المحصول بسبب الفرز أو التلف", english: "Shrinkage / spoilage" },
  { termAr: "المديونية / الباقي عند العملاء", meaningAr: "المبالغ المتبقية على العملاء أو المستحقات للعمال والموردين", english: "Receivables / payables" },
  { termAr: "السند (قبض / صرف)", meaningAr: "وثيقة التحصيل النقدي أو الدفع المرتبطة بالخزينة والـ QR", english: "Receipt / Payment voucher" },
  { termAr: "الصندوق / الخزينة / الكاش", meaningAr: "النقدية المتاحة في الصناديق والحسابات البنكية والمحافظ", english: "Treasury cashbox / bank" },
  { termAr: "الغلّة / الصافي", meaningAr: "صافي دخل المشروع أو المزرعة بعد خصم المصاريف والأجور والفاقد", english: "Net profit / yield" },
  { termAr: "الأجور والقطافة", meaningAr: "أجور العمال اليومية ومستحقات القطف والتعبئة والنقل", english: "Harvest labor wages & logistics" },
  { termAr: "الريال اليمني (YER)", meaningAr: "العملة الأساسية للتقارير وميزان المراجعة ما لم يُحدد غيرها", english: "Yemeni Rial base currency" },
];

export const YEMENI_EVERYDAY_PHRASES = {
  greetings: ["حياك الله يا غالي", "يا هلا وغلا، منور", "أبشر من عيوني", "سمّ بالله"],
  reassurance: ["أمورك طيبة", "ما عليك أمر", "خلّنا نراجعها حبة حبة", "شيكت لك على الحسابات"],
  cashbox: ["رصيد الصندوق / الخزينة", "السيولة المتوفرة حالياً", "الوارد والمنصرف اليوم"],
  receivables: ["الباقي عند العملاء (الذمم)", "المتأخرات والآجل", "التحصيل المستحق"],
  harvests: ["دفعات القطفة والعلاقي", "صافي الغلّة", "المصروفات والأجور على القطفة"],
} as const;

export function buildGeminiDialectInstruction(
  lang: "ar" | "en",
  dialect: CopilotDialectMode = "yemeni",
  learnedDialectTerms: string[] = []
): string {
  if (lang === "en") {
    return [
      "TONE & COMMUNICATION STYLE (English):",
      "- Speak as a warm, attentive senior Yemeni ERP & accounting advisor fluent in English.",
      "- Provide thorough, humanized, well-structured explanations with exact figures, account codes, cross-section implications, and actionable next steps.",
      "- Never reply with terse 1-line boilerplate unless the user explicitly asks for a brief answer.",
    ].join("\n");
  }

  if (dialect === "msa") {
    return [
      "أسلوب التخاطب (العربية الفصحى الميسرة):",
      "- تحدث بأسلوب مهني دافئ، واضح، ومفصل ككبير مستشاري المحاسبة وتخطيط الموارد في اليمن.",
      "- قدّم تحليلاً شاملاً بالأرقام الدقيقة وأسماء الحسابات والتوصيات العملية، وتجنب الردود المختصرة المقتضبة إلا إذا طلب المستخدم الإيجاز.",
    ].join("\n");
  }

  const lines = [
    "أسلوب التخاطب والشخصية (لهجة يمنية يومية ودية أصيلة + دقة محاسبية احترافية):",
    "- خاطب المستخدم بلهجة يمنية يومية لطيفة ومفهومة ومهذبة (مثل: «حياك الله يا غالي»، «أبشر من عيوني»، «ما عليك أمر»، «أمورك طيبة»، «خلّنا نراجعها حبة حبة»، «يعطيك العافية»).",
    "- استخدم عبارات التجارة والعمل اليومي في اليمن بشكل طبيعي عند عرض الأرقام: (الصندوق والسيولة، الباقي عند العملاء والذمم، التوريد والمشتريات، القطفة والعلاقي والبزغة، أجور العمال، التالف/الفاقد، وصافي الغلّة بالريال اليمني)، مع بقاء أسماء الحسابات وأكوادها والأرقام المحاسبية دقيقة وواضحة تماماً.",
    "- لا ترد أبداً بجملة واحدة جافة أو قالب جامد؛ اشرح الأرقام والنتائج بسلاسة، ونبّه على أي مخاطر أو عجز مخزني أو فترة مغلقة أو نقص سيولة بروح ناصحة ومساعدة، واقترح الخطوة التالية بوضوح.",
    "- في التحيات والاستفسارات العامة (مثل مرحبا / السلام عليكم / كيف حالك)، رحّب بحرارة باللهجة اليمنية واعرض المساعدة العملية المرتبطة بالقسم النشط ومشروع المستخدم الحالي.",
  ];

  if (learnedDialectTerms.length > 0) {
    lines.push(
      "- تعبيرات ومفردات مفضلة تعلمتها من أسلوب هذا المستخدم (احرص على مراعاتها بلطف عند التحدث):",
      ...learnedDialectTerms.slice(0, 5).map((t) => `  • ${t}`)
    );
  }

  return lines.join("\n");
}

export function buildCopilotGreetingFallback(params: {
  lang: "ar" | "en";
  dialect?: CopilotDialectMode;
  activeTab?: string;
  projectName?: string | null;
}): { ar: string; en: string } {
  const dialect = params.dialect ?? "yemeni";
  const tabHintAr = params.activeTab ? ` وأشوفك حالياً في قسم **(${params.activeTab})**` : "";
  const projHintAr = params.projectName ? ` على مشروع **«${params.projectName}»**` : "";

  const ar =
    dialect === "msa"
      ? `أهلاً وسهلاً بك في المستشار المحاسبي الذكي لمنظومة UAS${tabHintAr}${projHintAr}.\nيمكنني مساعدتك في مطابقة مخزون القطفات، متابعة المبيعات والذمم، مراجعة الخزينة والسندات، إعداد القيود اليومية، أو فحص حالة الترخيص والمزامنة. بماذا نبدأ؟`
      : `يا هلا وغلا وحياك الله يا غالي! نورت منظومة UAS${tabHintAr}${projHintAr}.\nأبشر من عيوني، معك مستشارك المحاسبي الذكي؛ تقدر تطلب مني بأي صيغة تناسبك:\n` +
        `- نراجع سوا **مطابقة القطفة والمخزون والعلاقي** أو نكشف أي عجز أو تالف.\n` +
        `- نسجل **عملية بيع، مصروف وقود، أجر عامل، أو سند قبض وصرف** بعد ما نفحص السيولة والفترة.\n` +
        `- نطلع **ملخص الخزينة والميزان والأرباح** أو نشيك على الترخيص والمزامنة.\n` +
        `سمّ بالله وقُل لي أيش تحب نبدأ فيه الحين؟`;

  const en =
    `Welcome! I'm your UAS Reasoning ERP Copilot${params.activeTab ? ` — currently watching your **${params.activeTab}** workspace` : ""}${params.projectName ? ` for **${params.projectName}**` : ""}.\n` +
    `Ask me to reconcile harvest batches and spoilage, check receivables and cash balances, draft sales/expenses/wages/vouchers with pre-flight safety checks, or troubleshoot sync & licensing.`;

  return { ar, en };
}

export function formatSpokenTextForGeminiTts(
  rawText: string,
  opts: {
    lang?: "ar" | "en";
    dialect?: CopilotDialectMode;
    maxChars?: number;
    speakReasoning?: boolean;
  } = {}
): string {
  return sanitizeSpeechText(rawText, {
    lang: opts.lang,
    maxChars: opts.maxChars ?? 12000,
    speakReasoning: opts.speakReasoning === true,
  });
}

/**
 * Splits a full Copilot response into natural sentence/clause chunks so Gemini TTS
 * and Web SpeechSynthesis play the ENTIRE response from start to finish without
 * ever truncating mid-reply or stalling browser utterances.
 */
export function splitTextForSequentialSpeech(
  rawText: string,
  opts: { lang?: "ar" | "en"; dialect?: CopilotDialectMode; maxChunkChars?: number } = {}
): string[] {
  const fullClean = formatSpokenTextForGeminiTts(rawText, {
    ...opts,
    maxChars: 12000,
  });
  if (!fullClean) return [];

  const maxChunk = Math.max(140, opts.maxChunkChars ?? 420);
  if (fullClean.length <= maxChunk) return [fullClean];

  // Break cleanly along sentence/clause delimiters while keeping punctuation attached
  const clauses = fullClean
    .split(/(?<=[.!؟?؛،\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = "";

  const pushWordSplit = (longStr: string) => {
    const words = longStr.split(/\s+/).filter(Boolean);
    let piece = "";
    for (const w of words) {
      if (piece && piece.length + 1 + w.length > maxChunk) {
        chunks.push(piece);
        piece = w;
      } else {
        piece = piece ? `${piece} ${w}` : w;
      }
    }
    if (piece) chunks.push(piece);
  };

  for (const clause of clauses) {
    if (clause.length > maxChunk) {
      if (buffer) {
        chunks.push(buffer);
        buffer = "";
      }
      pushWordSplit(clause);
      continue;
    }

    if (buffer && buffer.length + 1 + clause.length > maxChunk) {
      chunks.push(buffer);
      buffer = clause;
    } else {
      buffer = buffer ? `${buffer} ${clause}` : clause;
    }
  }
  if (buffer) chunks.push(buffer);

  return chunks;
}

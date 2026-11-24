/**
 * UAS Enterprise — Yemeni Arabic Localization, ERP Dialect Grounding & Natural TTS Text Prep
 *
 * Tunes Copilot persona, greetings, domain terminology, and spoken audio preparation
 * so day-to-day field, warehouse, and accounting guidance feels authentically Yemeni
 * while preserving accounting precision, formal MSA toggling, and English support.
 */

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
  { termAr: "المديونية / الذمم", meaningAr: "المبالغ المتبقية على العملاء أو المستحقات للعمال والموردين", english: "Receivables / payables" },
  { termAr: "السند (قبض / صرف)", meaningAr: "وثيقة التحصيل النقدي أو الدفع المرتبطة بالخزينة والـ QR", english: "Receipt / Payment voucher" },
  { termAr: "الخزينة / الصندوق", meaningAr: "النقدية المتاحة في الصناديق والحسابات البنكية والمحافظ", english: "Treasury cashbox / bank" },
  { termAr: "الريال اليمني (YER)", meaningAr: "العملة الأساسية للتقارير وميزان المراجعة ما لم يُحدد غيرها", english: "Yemeni Rial base currency" },
];

export function buildGeminiDialectInstruction(
  lang: "ar" | "en",
  dialect: CopilotDialectMode = "yemeni"
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

  return [
    "أسلوب التخاطب والشخصية (لهجة يمنية ودية أصيلة + دقة محاسبية احترافية):",
    "- خاطب المستخدم بلهجة يمنية محببة ومهذبة وطبيعية في الحديث اليومي (مثل: «حياك الله يا غالي»، «أبشر من عيوني»، «ما عليك أمر»، «أمورك طيبة»، «خلّنا نراجعها سوا»، «يعطيك العافية»).",
    "- استعمل مصطلحات السوق والعمل الميداني المحاسبي في اليمن بشكل طبيعي ومفهوم عند الحاجة: (القطفة، العلاقية، البزغة، الفاقد/التالف، المديونية، السند، الخزينة، والريال اليمني)، مع بقاء أسماء الحسابات وأكوادها والأرقام المحاسبية دقيقة وواضحة تماماً.",
    "- لا ترد أبداً بجملة واحدة جافة أو قالب جامد؛ اشرح الأرقام والنتائج بسلاسة، ونبّه على أي مخاطر أو عجز مخزني أو فترة مغلقة أو نقص سيولة بروح ناصحة ومساعدة، واقترح الخطوة التالية بوضوح.",
    "- في التحيات والاستفسارات العامة (مثل مرحبا / السلام عليكم / كيف حالك)، رحّب بحرارة باللهجة اليمنية واعرض المساعدة العملية المرتبطة بالقسم النشط ومشروع المستخدم الحالي.",
  ].join("\n");
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
  opts: { lang?: "ar" | "en"; dialect?: CopilotDialectMode; maxChars?: number } = {}
): string {
  const lang = opts.lang ?? (/[\u0600-\u06FF]/.test(rawText) ? "ar" : "en");
  const maxChars = opts.maxChars ?? 12000;

  let clean = String(rawText ?? "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_~>#|•✅✓❌⛔⚠️🚨🔍📊📈📦🛡️🔒🔓📡🧠💳💰🏦👷🌱📄❓📖📷📵🗂️🔗⚡]/g, " ")
    .replace(/\r?\n+/g, "، ")
    .replace(/\s+/g, " ")
    .trim();

  if (lang === "ar") {
    clean = clean
      .replace(/\bYER\b/gi, "ريال يمني")
      .replace(/\bSAR\b/gi, "ريال سعودي")
      .replace(/\bUSD\b/gi, "دولار أمريكي")
      .replace(/(\d+)\s*%/g, "$1 في المية")
      .replace(/\b(PRJ|RV|PV|JV|SO|BILL|PO|LOC)-([0-9A-Za-z-]+)\b/gi, (_, pfx, num) => `${pfx} ${String(num).split("").join(" ")}`)
      .replace(/\s*[:=]\s*/g, "، ")
      .replace(/،{2,}/g, "، ");
  } else {
    clean = clean
      .replace(/\bYER\b/gi, "Yemeni Rials")
      .replace(/\bSAR\b/gi, "Saudi Riyals")
      .replace(/\bUSD\b/gi, "US Dollars");
  }

  return clean.slice(0, maxChars).trim();
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

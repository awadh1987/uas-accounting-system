/**
 * UAS Enterprise — Copilot Chat-Only Speech Sanitizer
 *
 * Ensures voice synthesis (server Gemini TTS & browser Web SpeechSynthesis)
 * reads ONLY the final visible assistant response — strictly stripping `<think>`
 * / reasoning traces, system/developer prompts, tool call JSON, markdown syntax,
 * URLs, and internal metadata unless explicitly permitted (`speakReasoning: true`).
 */

export interface SpeechSanitizeOptions {
  /** Default false: internal reasoning traces and thoughts are NEVER spoken aloud. */
  speakReasoning?: boolean;
  lang?: "ar" | "en";
  maxChars?: number;
}

const REASONING_OR_PROMPT_LINE_RE =
  /^(?:system|developer|assistant[_\s-]?thought|internal(?:[_\s-]?(?:note|prompt|reasoning|thought))?|thought|reasoning(?:[_\s-]?(?:trace|step|steps))?|chain[_\s-]?of[_\s-]?thought|tool(?:[_\s-]?(?:call|trace|args|output|result))?|function[_\s-]?call|observation|action|prompt|role|modelUsed|tierUsed|التعليمات\s+الداخلية|سلسلة\s+التفكير|تفكير\s+النموذج|مسار\s+التحقق|المعطيات\s+الفنية|خطوة\s+التفكير)\s*[:：]/i;

const DELIVERY_PROMPT_ECHO_RE =
  /^(?:اقرأ\s+النص\s+التالي\s+بصوت[\s\S]{0,120}?[:：]|Read\s+the\s+following\s+text\s+aloud[\s\S]{0,120}?[:：]|SYSTEM\s+INSTRUCTION\s*[:：]|CRITICAL\s+RULE\s*[:：]|STRICT\s+RULES\s*[:：])/i;

function normalizeEasternArabicDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return ch;
  });
}

function stripJsonTraceBlocks(text: string): string {
  // Remove multi-line or single-line JSON payloads containing tool/reasoning/internal keys
  return text.replace(
    /\{[\s\S]{0,4000}?"(?:toolName|reasoningTrace|systemPrompt|assistantThought|confirmationCard|explicitTool|steps|args|modelUsed|tierUsed)"[\s\S]{0,4000}?\}/g,
    " "
  );
}

export function sanitizeSpeechText(
  rawText: string,
  opts: SpeechSanitizeOptions = {}
): string {
  const speakReasoning = opts.speakReasoning === true;
  const maxChars = Math.max(100, opts.maxChars ?? 12000);
  let text = String(rawText ?? "");
  if (!text.trim()) return "";

  if (!speakReasoning) {
    // Strip complete XML/tag reasoning & prompt sections
    text = text
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ")
      .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, " ")
      .replace(/<analysis\b[^>]*>[\s\S]*?<\/analysis>/gi, " ")
      .replace(/<scratchpad\b[^>]*>[\s\S]*?<\/scratchpad>/gi, " ")
      .replace(/<system\b[^>]*>[\s\S]*?<\/system>/gi, " ")
      .replace(/<developer\b[^>]*>[\s\S]*?<\/developer>/gi, " ")
      .replace(/<instructions\b[^>]*>[\s\S]*?<\/instructions>/gi, " ")
      .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, " ")
      .replace(/<function_call\b[^>]*>[\s\S]*?<\/function_call>/gi, " ")
      // Strip unclosed trailing think/reasoning tags
      .replace(/<(?:think|reasoning|scratchpad|system|developer)\b[^>]*>[\s\S]*$/gi, " ");
  } else {
    text = text.replace(/<\/?(?:think|reasoning|analysis|scratchpad)\b[^>]*>/gi, " ");
  }

  // Strip fenced code / JSON / SQL blocks & internal JSON traces
  text = text.replace(/```[\s\S]*?```/g, " ");
  if (!speakReasoning) {
    text = stripJsonTraceBlocks(text);
  }

  // Line-by-line prompt/reasoning trace filtering & echo stripping
  const lines = text.split(/\r?\n/);
  const keptLines: string[] = [];
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    line = line.replace(DELIVERY_PROMPT_ECHO_RE, "").trim();
    if (!line) continue;
    if (!speakReasoning && REASONING_OR_PROMPT_LINE_RE.test(line)) {
      continue;
    }
    keptLines.push(line);
  }

  let clean = keptLines.join("\n");

  // Preserve readable link labels while discarding raw URLs & markdown noise
  clean = clean
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~>#|•✅✓❌⛔⚠️🚨🔍📊📈📦🛡️🔒🔓📡🧠💳💰🏦👷🌱📄❓📖📷📵🗂️🔗⚡🇾🇪]/g, " ")
    .replace(/\r?\n+/g, "، ")
    .replace(/\s+/g, " ")
    .trim();

  const effectiveLang: "ar" | "en" =
    opts.lang === "en" || opts.lang === "ar"
      ? opts.lang
      : /[\u0600-\u06FF]/.test(clean)
        ? "ar"
        : "en";

  clean = normalizeEasternArabicDigits(clean);
  // Strip numeric thousands separator commas (e.g. 150,000 -> 150000) so TTS reads smooth numbers
  clean = clean.replace(/(?<=\d),(?=\d{3}\b)/g, "");

  if (effectiveLang === "ar") {
    clean = clean
      .replace(/\bYER\b/gi, "ريال يمني")
      .replace(/ر\.ي\b/g, "ريال يمني")
      .replace(/\bSAR\b/gi, "ريال سعودي")
      .replace(/ر\.س\b/g, "ريال سعودي")
      .replace(/\bUSD\b/gi, "دولار أمريكي")
      .replace(/\$\s*(\d+(?:\.\d+)?)/g, "$1 دولار أمريكي")
      .replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 في المئة")
      .replace(/\b(PRJ|RV|PV|JV|SO|BILL|PO|LOC)-([0-9A-Za-z-]+)\b/gi, (_, pfx, num) =>
        `${pfx} ${String(num).split("").join(" ")}`
      )
      .replace(/\s*[:=]\s*/g, "، ")
      .replace(/،{2,}/g, "، ")
      .replace(/^[،\s]+|[،\s]+$/g, "");
  } else {
    clean = clean
      .replace(/\bYER\b/gi, "Yemeni Rials")
      .replace(/\bSAR\b/gi, "Saudi Riyals")
      .replace(/\bUSD\b/gi, "US Dollars")
      .replace(/^[،,\s]+|[،,\s]+$/g, "");
  }

  return clean.slice(0, maxChars).trim();
}

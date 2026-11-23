/**
 * UAS Enterprise — Browser-Safe Deterministic Copilot Learner & Forget Intent Rules
 *
 * Extracts durable domain facts, Yemeni/local aliases, corrections, reporting
 * preferences, and operational patterns from normal chat turns or explicit
 * "remember / forget" commands — completely offline-capable with zero Node or
 * @google/genai imports.
 */

import {
  isSensitiveOrDisallowedMemory,
  normalizeMemoryTenantSlug,
  normalizeTopicKey,
  sanitizeMemoryCandidate,
  type CopilotMemoryCategory,
  type CopilotMemoryScope,
  type UpsertMemoryInput,
} from "./copilotMemoryTypes";

export interface DeterministicLearnContext {
  prompt: string;
  tenantSlug: string;
  userId?: string;
  activeTab?: string;
  editedDraftContext?: string;
}

export interface ForgetIntentResult {
  matched: boolean;
  query: string;
}

const TRANSIENT_ONLY_PATTERNS = [
  /^(?:السلام\s*عليكم|مرحبا|أهلا|اهلا|صباح\s*الخير|مساء\s*الخير|هلا|حياك|كيف\s*الحال|شكراً|شكرا|مشكور|يعطيك\s*العافية|hi|hello|hey|thanks|thank\s*you|ok|okay|تمام|طيب)[\s!.,؟?]*$/i,
  /^(?:اعرض|افتح|وريني|شغل|اطبع|صدر|ابحث|كم\s+(?:رصيد|عدد|إجمالي|اجمالي|مجموع))\b/i,
];

function cleanSentence(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/^[:"'«»\-–—\s]+|[:"'«»\s]+$/g, "")
    .trim();
}

function buildTopicKey(prefix: string, body: string): string {
  const words = cleanSentence(body)
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6)
    .join("_");
  return normalizeTopicKey(`${prefix}:${words}`, body);
}

/**
 * Detects explicit user requests to forget / remove a previously learned rule.
 */
export function detectForgetMemoryIntent(prompt: string): ForgetIntentResult {
  const text = cleanSentence(prompt);
  if (!text) return { matched: false, query: "" };

  const arabicForget = text.match(
    /^(?:من\s*فضلك\s*|لو\s*سمحت\s*)?(?:انسَ|انسى|احذف(?:\s+المعلومة|\s+القاعدة|\s+من\s+الذاكرة)?|امسح(?:\s+القاعدة|\s+المعلومة)?|تجاهل(?:\s+قاعدة|\s+معلومة)?|الغي|ألغِ(?:\s+تذكر)?)\s*(?:أن|ان|إن|قاعدة|معلومة|:)?\s*(.+)$/i
  );
  if (arabicForget?.[1]) {
    return { matched: true, query: cleanSentence(arabicForget[1]) };
  }

  const englishForget = text.match(
    /^(?:please\s+)?(?:forget(?:\s+that|\s+about)?|stop\s+remembering|remove\s+(?:memory|rule)(?:\s+about)?|delete\s+(?:memory|rule)(?:\s+about)?)\s*:?\s*(.+)$/i
  );
  if (englishForget?.[1]) {
    return { matched: true, query: cleanSentence(englishForget[1]) };
  }

  return { matched: false, query: "" };
}

function inferCategoryAndScope(
  content: string,
  explicitCategory?: CopilotMemoryCategory
): { category: CopilotMemoryCategory; scope: CopilotMemoryScope; prefix: string } {
  const lower = content.toLowerCase();

  if (
    explicitCategory === "workflow_preference" ||
    /(?:أفضل|افضل|خلّي|خلي|اعرض\s+لي|بالريال\s+اليمني|بالدولار|بالسعودي|ملخص\s+سريع|مختصر|تفصيلي|prefer|always\s+show|default\s+currency|summary\s+first|format\s+as)/i.test(
      lower
    )
  ) {
    return {
      category: "workflow_preference",
      scope: "user",
      prefix: "pref",
    };
  }

  if (
    explicitCategory === "naming_alias" ||
    /(?:يعني|أقصد|اقصد|المقصود|نسمي|نسمّيه|اسمه\s+عندنا|مصطلح|means|alias|refers\s+to|aka\b|called)/i.test(
      lower
    )
  ) {
    return {
      category: "naming_alias",
      scope: "workspace",
      prefix: "alias",
    };
  }

  if (explicitCategory === "correction") {
    return {
      category: "correction",
      scope: "workspace",
      prefix: "correction",
    };
  }

  if (
    explicitCategory === "operational_pattern" ||
    /(?:كل\s+(?:يوم|أسبوع|اسبوع|شهر|جمعة|خميس)|دائماً\s+(?:سجل|اربط|وزع)|عادةً|usually|every\s+(?:day|week|month)|recurring)/i.test(
      lower
    )
  ) {
    return {
      category: "operational_pattern",
      scope: "workspace",
      prefix: "pattern",
    };
  }

  return {
    category: explicitCategory || "domain_fact",
    scope: "workspace",
    prefix: "fact",
  };
}

/**
 * Deterministic extractor safe for both offline mode (APK / Electron / browser)
 * and server-side pre-extraction alongside Gemini.
 */
export function extractDeterministicMemories(
  ctx: DeterministicLearnContext
): UpsertMemoryInput[] {
  const tenantSlug = normalizeMemoryTenantSlug(ctx.tenantSlug);
  const rawPrompt = cleanSentence(ctx.prompt);
  if (!rawPrompt && !ctx.editedDraftContext) return [];

  // Do not treat forget commands as learnable rules
  if (rawPrompt && detectForgetMemoryIntent(rawPrompt).matched) {
    return [];
  }

  const candidates: UpsertMemoryInput[] = [];
  const pushCandidate = (
    content: string,
    opts: {
      category?: CopilotMemoryCategory;
      scope?: CopilotMemoryScope;
      topicKey?: string;
      confidence?: number;
      sourceSnippet?: string;
    } = {}
  ) => {
    const clean = cleanSentence(content);
    if (!clean) return;
    if (isSensitiveOrDisallowedMemory(clean).blocked) return;
    if (TRANSIENT_ONLY_PATTERNS.some((re) => re.test(clean))) return;

    const inferred = inferCategoryAndScope(clean, opts.category);
    const candidate: UpsertMemoryInput = {
      tenantSlug,
      scope: opts.scope || inferred.scope,
      userId: ctx.userId,
      category: opts.category || inferred.category,
      topicKey: opts.topicKey || buildTopicKey(inferred.prefix, clean),
      content: clean,
      sourceSnippet: cleanSentence(opts.sourceSnippet || rawPrompt).slice(0, 180),
      confidence: opts.confidence ?? 0.84,
      pinned: false,
      active: true,
    };

    const validated = sanitizeMemoryCandidate(candidate);
    if (!validated.ok) return;

    const dedupeIdx = candidates.findIndex(
      (c) =>
        c.topicKey === validated.input.topicKey ||
        c.content === validated.input.content ||
        c.content.includes(validated.input.content) ||
        validated.input.content.includes(c.content)
    );
    if (dedupeIdx >= 0) {
      // Keep the more specific category/topicKey when the same sentence matches twice
      const existing = candidates[dedupeIdx];
      candidates[dedupeIdx] =
        validated.input.category !== "domain_fact" ||
        validated.input.content.length >= existing.content.length
          ? validated.input
          : existing;
    } else {
      candidates.push(validated.input);
    }
  };

  // 0. If user edited an AI draft/correction explicitly, treat it as a correction
  if (ctx.editedDraftContext) {
    pushCandidate(ctx.editedDraftContext, {
      category: "correction",
      scope: "workspace",
      confidence: 0.9,
      sourceSnippet: ctx.editedDraftContext,
    });
  }

  if (!rawPrompt) return candidates;

  // 1. Explicit "Remember / احفظ / تذكر" commands
  const explicitAr = rawPrompt.match(
    /(?:تذكر(?:\s+أن|\s+ان|\s+إن)?|احفظ\s+(?:عندك|هذي\s+المعلومة|هذا|القاعدة)(?:\s+أن|\s+ان)?|خزن\s+عندك(?:\s+أن)?|اعتمد\s+(?:قاعدة|من\s+الآن)(?:\s+أن)?|من\s+الآن\s+فصاعداً|سجل\s+في\s+الذاكرة)\s*:?\s*(.+)$/i
  );
  if (explicitAr?.[1]) {
    pushCandidate(explicitAr[1], { confidence: 0.95 });
  }

  const explicitEn = rawPrompt.match(
    /(?:remember(?:\s+that)?|save\s+(?:this\s+)?(?:rule|fact|note)\s*:?|always\s+remember(?:\s+that)?|keep\s+in\s+mind(?:\s+that)?|from\s+now\s+on(?:,)?)\s+(.+)$/i
  );
  if (explicitEn?.[1]) {
    pushCandidate(explicitEn[1], { confidence: 0.95 });
  }

  // 2. Passive user corrections ("لا، سجلها على ... مش ..." / "الصحيح أن ..." / "no, use X not Y")
  const correctionAr = rawPrompt.match(
    /(?:لا\s*[،,]\s*(?:سجلها|احسبها|حطها|اربطها|المفروض|الصح|الصحيح)|الصحيح\s+(?:أن|ان|إن)|غلط\s*[،,]?\s*الصح|عدّل(?:ها)?\s+(?:إلى|الى|لـ))\s+(.+)$/i
  );
  if (correctionAr?.[1]) {
    pushCandidate(correctionAr[1], {
      category: "correction",
      scope: "workspace",
      confidence: 0.9,
    });
  }

  const correctionEn = rawPrompt.match(
    /(?:^|\b)(?:no\s*,\s*(?:book|post|record|use|classify|assign)\s+it\s+(?:to|under|as)|actually\s*,\s*use|correction\s*:|should\s+be\s+booked\s+under)\s+(.+)$/i
  );
  if (correctionEn?.[1]) {
    pushCandidate(correctionEn[1], {
      category: "correction",
      scope: "workspace",
      confidence: 0.9,
    });
  }

  // 3. Yemeni / local domain aliases & terminology definitions
  // e.g. "لما أقول القات الفاخر أقصد الدرجة الأولى من الروضة" or "العلاقية عندنا 10 ربطات"
  const aliasAr = rawPrompt.match(
    /(?:لما\s+(?:أقول|اقول|نقول)|المقصود\s+بـ?|كلمة\s+["«]?[^"»]+["»]?\s+(?:تعني|تقصد|يعني))\s*(.+)$/i
  );
  if (aliasAr?.[0]) {
    pushCandidate(aliasAr[0], {
      category: "naming_alias",
      scope: "workspace",
      confidence: 0.88,
    });
  }

  const aliasUnitAr = rawPrompt.match(
    /([^،.!؟\n]{3,40}\s+(?:تساوي|يعادل|تعادل|عبارة\s+عن|فيها|عندنا\s+تساوي)\s+[^.!؟\n]{3,60})/i
  );
  if (aliasUnitAr?.[1]) {
    const unitSubject = aliasUnitAr[1].split(/\s+/)[0] || "unit";
    pushCandidate(aliasUnitAr[1], {
      category: "naming_alias",
      scope: "workspace",
      topicKey: buildTopicKey("unit_alias", unitSubject),
      confidence: 0.87,
    });
  }

  const aliasEn = rawPrompt.match(
    /(?:when\s+i\s+say|["']([^"']{2,40})["']\s+(?:means|refers\s+to|stands\s+for))\s+(.+)$/i
  );
  if (aliasEn?.[0]) {
    pushCandidate(aliasEn[0], {
      category: "naming_alias",
      scope: "workspace",
      topicKey: aliasEn[1] ? buildTopicKey("alias", aliasEn[1]) : undefined,
      confidence: 0.88,
    });
  }

  // 4. Client / supplier / project / operational durable facts
  // e.g. "العميل هائل يتعامل بالآجل لمدة 30 يوم" / "مصاريف التوصيل لصنعاء تسجل تحت مصروفات النقل"
  const clientTermsAr = rawPrompt.match(
    /((?:العميل|المورد|المزرعة|مشروع|الشريك|السائق)\s+[^\n.!؟]{3,40}\s+(?:يتعامل|دائماً|حد\s+ائتمانه|بالآجل|نقداً|رقمه|بفرع|نسبته|عمولته)[^\n.!؟]{3,70})/i
  );
  if (clientTermsAr?.[1]) {
    pushCandidate(clientTermsAr[1], {
      category: "domain_fact",
      scope: "workspace",
      topicKey: buildTopicKey("entity_rule", clientTermsAr[1].slice(0, 48)),
      confidence: 0.86,
    });
  }

  const expenseMappingAr = rawPrompt.match(
    /((?:مصاريف|مصروف|تكلفة|رسوم|إيجار|نقل|توصيل)\s+[^\n.!؟]{2,45}\s+(?:تسجل|تُسجل|تُحمل|تحمل|تدرج|تربط)\s+(?:تحت|على|في)\s+[^\n.!؟]{3,60})/i
  );
  if (expenseMappingAr?.[1]) {
    pushCandidate(expenseMappingAr[1], {
      category: "operational_pattern",
      scope: "workspace",
      topicKey: buildTopicKey("expense_map", expenseMappingAr[1].slice(0, 40)),
      confidence: 0.88,
    });
  }

  // 5. User reporting / currency / style preferences
  const prefMatch = rawPrompt.match(
    /((?:أفضل|افضل|دائماً\s+اعرض|اعرض\s+لي\s+دائماً|always\s+show\s+me|i\s+prefer|default\s+(?:currency|view|report)\s+(?:is|should\s+be))\s+[^\n.!؟]{4,90})/i
  );
  if (prefMatch?.[1]) {
    pushCandidate(prefMatch[1], {
      category: "workflow_preference",
      scope: "user",
      topicKey: buildTopicKey("pref", prefMatch[1]),
      confidence: 0.88,
    });
  }

  return candidates.slice(0, 3);
}

/**
 * UAS Enterprise — Offline-Capable Bilingual (Arabic / English) Customer Service
 * Retrieval (Weighted BM25 + Keyword + Arabic Root/Stem Matching) & Live Diagnostic Engine.
 *
 * Zero Node-only dependencies — runs identically inside Next.js API routes, Windows Desktop,
 * and Capacitor Android APK offline mode.
 */
import {
  getAllSupportSections,
  UAS_SUPPORT_CHAPTERS,
  type SupportChapter,
  type SupportManualSection,
} from "./uasSupportKnowledge";
import type { CopilotMemoryEntry } from "./ai/copilotMemoryTypes";
import type { TabId } from "@/types/uas";

export interface SupportSystemDiagnostics {
  license_status:
    | "ACTIVE"
    | "UNLICENSED"
    | "EXPIRED"
    | "SUSPENDED"
    | "REVOKED"
    | "HWID_MISMATCH"
    | "INVALID_SIGNATURE"
    | "CORRUPT"
    | "CLOCK_TAMPER"
    | "SEAT_LIMIT_REACHED"
    | "MODE_NOT_ALLOWED"
    | "COMPANY_MISMATCH";
  is_valid: boolean;
  company_name: string | null;
  enterprise_name_ar?: string | null;
  enterprise_name_en?: string | null;
  company_locked: boolean;
  company_matches: boolean | null;
  seat_managed: boolean;
  used_users: number;
  max_users: number;
  per_user_devices: { windows: number; android: number };
  windows_bound: number;
  android_bound: number;
  active_mode: "local" | "lan" | "cloud";
  lan_url?: string | null;
  cloud_url?: string | null;
  remaining_days: number;
  request_code?: string | null;
  license_id?: string | null;
  error?: string | null;
  offline_queue_count?: number;
  pending_conflicts_count?: number;
  is_offline?: boolean;
  signature_verified?: boolean | null;
  tenant_slug?: string | null;
  active_tab?: string | null;
}

export interface SupportDiagnosticReport {
  healthy: boolean;
  statusBadge: string;
  headlineAr: string;
  headlineEn: string;
  findingsAr: string[];
  findingsEn: string[];
  remediationsAr: string[];
  remediationsEn: string[];
}

export interface SupportSearchMatch {
  section: SupportManualSection;
  chapter: SupportChapter;
  score: number;
  matchedTerms: string[];
}

export interface SupportSuggestedAction {
  type: "open_license_modal" | "navigate_tab" | "run_diagnostics";
  labelAr: string;
  labelEn: string;
  targetTab?: TabId;
}

export interface SupportAnswerResult {
  query: string;
  lang: "ar" | "en";
  answer: string;
  answerAr: string;
  answerEn: string;
  isDiagnosticQuery: boolean;
  diagnosticReport: SupportDiagnosticReport;
  diagnostics: SupportSystemDiagnostics;
  matches: SupportSearchMatch[];
  suggestedActions: SupportSuggestedAction[];
}

// ---------------------------------------------------------------------------
// Text Normalization, Stemming & Arabic Root Extraction
// ---------------------------------------------------------------------------

const ARABIC_CHAR_RE = /[\u0600-\u06FF]/;

export function detectSupportLanguage(text: string, fallback: "ar" | "en" = "ar"): "ar" | "en" {
  const s = String(text ?? "").trim();
  if (!s) return fallback;
  return ARABIC_CHAR_RE.test(s) ? "ar" : "en";
}

export function normalizeSupportText(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // harakat & tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ؤئ]/g, "ء")
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9.&:\\/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  // Arabic stopwords
  "من",
  "في",
  "على",
  "الي",
  "عن",
  "مع",
  "هذا",
  "هذه",
  "ذلك",
  "التي",
  "الذي",
  "هل",
  "ما",
  "هي",
  "هو",
  "او",
  "ثم",
  "كل",
  "عند",
  "بعد",
  "قبل",
  "كيف",
  "لماذا",
  "متي",
  "اين",
  "ماذا",
  "اريد",
  "النظام",
  // English stopwords
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "how",
  "what",
  "why",
  "when",
  "where",
  "can",
  "into",
  "your",
  "are",
  "is",
  "to",
  "in",
  "of",
  "on",
  "or",
  "by",
]);

const ARABIC_PREFIXES = ["وال", "بال", "كال", "فال", "لل", "ال"];
const ARABIC_SUFFIXES = ["ات", "ون", "ين", "ان", "ها", "هم", "كم", "نا", "يه", "تي", "ه", "ي"];

export function stemToken(token: string): string {
  let t = token.trim();
  if (t.length < 3) return t;

  if (ARABIC_CHAR_RE.test(t)) {
    for (const pre of ARABIC_PREFIXES) {
      if (t.startsWith(pre) && t.length - pre.length >= 3) {
        t = t.slice(pre.length);
        break;
      }
    }
    for (const suf of ARABIC_SUFFIXES) {
      if (t.endsWith(suf) && t.length - suf.length >= 3) {
        t = t.slice(0, -suf.length);
        break;
      }
    }
    return t;
  }

  // English light stemmer
  if (t.length >= 5) {
    for (const suf of ["ications", "ication", "ments", "ment", "ings", "ing", "tions", "tion", "sions", "sion", "ed", "es"]) {
      if (t.endsWith(suf) && t.length - suf.length >= 3) {
        return t.slice(0, -suf.length);
      }
    }
  }
  if (t.length >= 4 && t.endsWith("s") && !t.endsWith("ss")) {
    return t.slice(0, -1);
  }
  return t;
}

/**
 * Extracts a normalized 3-consonant Arabic skeleton/root approximation so broken plurals
 * (e.g. تراخيص/ترخيص, مقاعد/مقعد, فواتير/فاتوره, حسابات/محاسبه/حساب, منشاه/منشات) match reliably.
 */
export function extractArabicRoot(token: string): string {
  const stemmed = stemToken(token);
  if (!ARABIC_CHAR_RE.test(stemmed) || stemmed.length <= 3) return stemmed;

  // Strip initial augmentative م / ت / ا if word is 4+ letters
  let core = stemmed;
  if (core.length >= 4 && (core.startsWith("م") || core.startsWith("ت") || core.startsWith("ا") || core.startsWith("إ"))) {
    const candidate = core.slice(1);
    const strippedVowels = candidate.replace(/[اوي]/g, "");
    if (strippedVowels.length >= 3) {
      core = candidate;
    }
  }

  // Strip internal long vowels ا / و / ي to unify broken plurals (فواتير -> فتر, تراخيص -> رخص, مقاعد -> قعد)
  const consonants = core.replace(/[اوي]/g, "");
  if (consonants.length >= 3) {
    return consonants.slice(0, 3);
  }
  return core.slice(0, 3);
}

export function tokenizeSupportText(text: string): {
  rawTokens: string[];
  stems: string[];
  roots: string[];
} {
  const norm = normalizeSupportText(text);
  if (!norm) return { rawTokens: [], stems: [], roots: [] };

  const rawTokens = norm
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  const stems = rawTokens.map(stemToken);
  const roots = rawTokens.map((t) => (ARABIC_CHAR_RE.test(t) ? extractArabicRoot(t) : stemToken(t)));
  return { rawTokens, stems, roots };
}

// ---------------------------------------------------------------------------
// Weighted Bilingual BM25 + Root Index
// ---------------------------------------------------------------------------

interface IndexedSectionDoc {
  section: SupportManualSection;
  chapter: SupportChapter;
  normTitle: string;
  normKeywords: string;
  normBody: string;
  termFreq: Map<string, number>;
  docLen: number;
}

let cachedIndex: {
  docs: IndexedSectionDoc[];
  avgDocLen: number;
  docFreq: Map<string, number>;
} | null = null;

function addWeightedTerms(
  tf: Map<string, number>,
  text: string,
  weight: number
): number {
  const { rawTokens, stems, roots } = tokenizeSupportText(text);
  let count = 0;
  for (let i = 0; i < rawTokens.length; i++) {
    const raw = rawTokens[i];
    const stem = stems[i];
    const root = roots[i];

    tf.set(raw, (tf.get(raw) ?? 0) + weight);
    if (stem !== raw) {
      tf.set(`stem:${stem}`, (tf.get(`stem:${stem}`) ?? 0) + weight * 0.85);
    }
    if (root && root.length >= 3) {
      tf.set(`root:${root}`, (tf.get(`root:${root}`) ?? 0) + weight * 0.65);
    }
    count += weight;
  }
  return count;
}

function getOrBuildIndex() {
  if (cachedIndex) return cachedIndex;

  const chapterMap = new Map<string, SupportChapter>();
  for (const ch of UAS_SUPPORT_CHAPTERS) {
    chapterMap.set(ch.id, ch);
  }

  const sections = getAllSupportSections();
  const docs: IndexedSectionDoc[] = [];
  const docFreq = new Map<string, number>();
  let totalLen = 0;

  for (const section of sections) {
    const chapter = chapterMap.get(section.chapterId) ?? UAS_SUPPORT_CHAPTERS[0];
    const tf = new Map<string, number>();
    let docLen = 0;

    docLen += addWeightedTerms(tf, `${section.titleAr} ${section.titleEn} ${chapter.titleAr} ${chapter.titleEn}`, 4.0);
    docLen += addWeightedTerms(tf, `${section.keywordsAr.join(" ")} ${section.keywordsEn.join(" ")}`, 3.5);
    docLen += addWeightedTerms(
      tf,
      `${section.summaryAr} ${section.summaryEn} ${(section.troubleshootingAr ?? []).join(" ")} ${(section.troubleshootingEn ?? []).join(" ")}`,
      2.5
    );
    docLen += addWeightedTerms(
      tf,
      `${section.contentAr} ${section.contentEn} ${section.stepsAr.join(" ")} ${section.stepsEn.join(" ")}`,
      1.5
    );

    for (const term of tf.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }

    totalLen += docLen;
    docs.push({
      section,
      chapter,
      normTitle: normalizeSupportText(`${section.titleAr} ${section.titleEn}`),
      normKeywords: normalizeSupportText(`${section.keywordsAr.join(" ")} ${section.keywordsEn.join(" ")}`),
      normBody: normalizeSupportText(`${section.summaryAr} ${section.summaryEn} ${section.contentAr} ${section.contentEn}`),
      termFreq: tf,
      docLen,
    });
  }

  cachedIndex = {
    docs,
    avgDocLen: docs.length > 0 ? totalLen / docs.length : 1,
    docFreq,
  };
  return cachedIndex;
}

export function searchSupportKnowledge(
  query: string,
  opts: { topK?: number } = {}
): SupportSearchMatch[] {
  const topK = opts.topK ?? 4;
  const index = getOrBuildIndex();
  const normQuery = normalizeSupportText(query);
  if (!normQuery) return [];

  const { rawTokens, stems, roots } = tokenizeSupportText(query);
  const N = index.docs.length;
  const k1 = 1.5;
  const b = 0.75;

  const matches: SupportSearchMatch[] = [];

  for (const doc of index.docs) {
    let score = 0;
    const matchedTerms = new Set<string>();

    // Exact phrase boosts in title, keywords, or body
    if (normQuery.length >= 3) {
      if (doc.normTitle.includes(normQuery)) {
        score += 12.0;
        matchedTerms.add(normQuery);
      }
      if (doc.normKeywords.includes(normQuery)) {
        score += 10.0;
        matchedTerms.add(normQuery);
      } else if (doc.normBody.includes(normQuery)) {
        score += 5.0;
        matchedTerms.add(normQuery);
      }
    }

    for (let i = 0; i < rawTokens.length; i++) {
      const raw = rawTokens[i];
      const stem = stems[i];
      const root = roots[i];

      const candidates: Array<{ key: string; label: string; boost: number }> = [
        { key: raw, label: raw, boost: 1.0 },
        { key: `stem:${stem}`, label: raw, boost: 0.85 },
      ];
      if (root && root.length >= 3) {
        candidates.push({ key: `root:${root}`, label: raw, boost: 0.65 });
      }

      let bestTermScore = 0;
      for (const c of candidates) {
        const tf = doc.termFreq.get(c.key) ?? 0;
        if (tf <= 0) continue;
        const df = index.docFreq.get(c.key) ?? 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = tf + k1 * (1 - b + b * (doc.docLen / index.avgDocLen));
        const bm25 = idf * ((tf * (k1 + 1)) / denom) * c.boost;
        if (bm25 > bestTermScore) {
          bestTermScore = bm25;
        }
      }

      // Substring fallback on keywords for compound terms
      if (bestTermScore === 0 && raw.length >= 3 && doc.normKeywords.includes(raw)) {
        bestTermScore = 2.5;
      }

      if (bestTermScore > 0) {
        score += bestTermScore;
        matchedTerms.add(raw);
      }
    }

    if (score > 0) {
      matches.push({
        section: doc.section,
        chapter: doc.chapter,
        score: Number(score.toFixed(3)),
        matchedTerms: [...matchedTerms],
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Live System Diagnostics & Issue Detection
// ---------------------------------------------------------------------------

export const DEFAULT_SUPPORT_DIAGNOSTICS: SupportSystemDiagnostics = {
  license_status: "UNLICENSED",
  is_valid: false,
  company_name: null,
  enterprise_name_ar: null,
  enterprise_name_en: null,
  company_locked: false,
  company_matches: null,
  seat_managed: false,
  used_users: 0,
  max_users: 7,
  per_user_devices: { windows: 1, android: 1 },
  windows_bound: 0,
  android_bound: 0,
  active_mode: "local",
  lan_url: "http://127.0.0.1:3000",
  cloud_url: "https://qat.world",
  remaining_days: 0,
  request_code: null,
  license_id: null,
  error: null,
  offline_queue_count: 0,
  pending_conflicts_count: 0,
  is_offline: false,
  signature_verified: null,
  tenant_slug: null,
  active_tab: null,
};

export function normalizeDiagnostics(
  partial?: Partial<SupportSystemDiagnostics> | null
): SupportSystemDiagnostics {
  return {
    ...DEFAULT_SUPPORT_DIAGNOSTICS,
    ...(partial ?? {}),
    per_user_devices: {
      windows: Number(partial?.per_user_devices?.windows ?? 1),
      android: Number(partial?.per_user_devices?.android ?? 1),
    },
  };
}

const DIAGNOSTIC_INTENT_KEYWORDS = [
  "ترخيص",
  "تراخيص",
  "تفعيل",
  "مقعد",
  "مقاعد",
  "مستخدم",
  "اسم المنشاه",
  "لا يطابق",
  "يطابق",
  "الغاء ربط",
  "جهاز",
  "اجهزه",
  "هاتف",
  "حاله النظام",
  "تشخيص",
  "فحص",
  "مشكله",
  "خطا",
  "ساعه",
  "وضع التشغيل",
  "شبكه",
  "سحابي",
  "license",
  "activat",
  "seat",
  "seats",
  "company name",
  "mismatch",
  "release",
  "status",
  "diagnos",
  "health",
  "error",
  "problem",
  "issue",
  "block",
  "device",
  "phone",
  "laptop",
  "user",
  "mode",
  "lan",
  "cloud",
  "quota",
  "7 users",
  "مزامنه",
  "مزامنة",
  "تعارض",
  "توقيع",
  "اوفلاين",
  "دون انترنت",
  "بدون انترنت",
  "طابور",
  "sync",
  "queue",
  "conflict",
  "signature",
  "offline",
  "ed25519",
];

export function isDiagnosticRelatedQuery(query: string): boolean {
  const norm = normalizeSupportText(query);
  if (!norm) return true;
  return DIAGNOSTIC_INTENT_KEYWORDS.some((kw) => norm.includes(kw));
}

export function diagnoseLiveSystemState(
  rawDiag?: Partial<SupportSystemDiagnostics> | null
): SupportDiagnosticReport {
  const d = normalizeDiagnostics(rawDiag);
  const findingsAr: string[] = [];
  const findingsEn: string[] = [];
  const remediationsAr: string[] = [];
  const remediationsEn: string[] = [];

  const modeLabelAr =
    d.active_mode === "lan"
      ? `خادم شبكة محلية (Office LAN 0.0.0.0:3000 - ${d.lan_url || "http://0.0.0.0:3000"})`
      : d.active_mode === "cloud"
      ? `سحابي (${d.cloud_url || "https://qat.world"})`
      : "محلي مستقل (Local Standalone 127.0.0.1:3000)";
  const modeLabelEn =
    d.active_mode === "lan"
      ? `Office LAN Server (0.0.0.0:3000 - ${d.lan_url || "http://0.0.0.0:3000"})`
      : d.active_mode === "cloud"
      ? `Cloud Server (${d.cloud_url || "https://qat.world"})`
      : "Local Standalone (127.0.0.1:3000)";

  findingsAr.push(`وضع التشغيل النشط: ${modeLabelAr}`);
  findingsEn.push(`Active Operating Mode: ${modeLabelEn}`);

  findingsAr.push(
    `استهلاك مقاعد المستخدمين: ${d.used_users} / ${d.max_users} مستخدمين (الأجهزة المربوطة: ${d.windows_bound} ويندوز + ${d.android_bound} أندرويد • الحصة لكل مستخدم: ${d.per_user_devices.windows} ويندوز + ${d.per_user_devices.android} أندرويد).`
  );
  findingsEn.push(
    `Seat Usage: ${d.used_users} / ${d.max_users} Users (Bound devices: ${d.windows_bound} Windows + ${d.android_bound} Android • Quota per user: ${d.per_user_devices.windows} Win + ${d.per_user_devices.android} Android).`
  );

  // Cross-check runtime connectivity, Ed25519 signature, sync queue & conflicts
  const queueCount = Number(d.offline_queue_count ?? 0);
  const conflictCount = Number(d.pending_conflicts_count ?? 0);
  if (d.tenant_slug) {
    findingsAr.push(`مساحة العمل النشطة: ${d.tenant_slug}.qat.world${d.active_tab ? ` (القسم الحالي: ${d.active_tab})` : ""}.`);
    findingsEn.push(`Active Tenant Workspace: ${d.tenant_slug}.qat.world${d.active_tab ? ` (Current Tab: ${d.active_tab})` : ""}.`);
  }
  if (d.signature_verified === false || d.license_status === "INVALID_SIGNATURE") {
    findingsAr.push("🚨 فشل التحقق من التوقيع الرقمي Ed25519 لملف الترخيص — قد يكون الملف معدلاً أو غير مكتمل.");
    findingsEn.push("🚨 Ed25519 cryptographic license signature verification failed — the license file may be corrupted or tampered.");
    remediationsAr.push("أعد تحميل ملف license.uas الأصلي الصادر لك من المزود وارفعه من نافذة تفعيل الترخيص.");
    remediationsEn.push("Re-download your original signed license.uas file and re-import it in the License Activation Modal.");
  }
  if (d.is_offline || queueCount > 0 || conflictCount > 0) {
    findingsAr.push(
      `حالة الاتصال والمزامنة: ${d.is_offline ? "وضع العمل دون إنترنت (Offline)" : "متصل بالشبكة (Online)"} • عمليات معلقة في الطابور: ${queueCount} • تعارضات للمراجعة: ${conflictCount}.`
    );
    findingsEn.push(
      `Connectivity & Sync: ${d.is_offline ? "Offline Local Queue Mode" : "Online"} • Pending queued operations: ${queueCount} • Sync conflicts: ${conflictCount}.`
    );
    if (conflictCount > 0) {
      remediationsAr.push(`يوجد ${conflictCount} تعارض(ات) مزامنة بانتظار الحسم — افتح تبويب الجوال/المزامنة أو إعدادات المنشأة لحلها قبل إعادة الدفع.`);
      remediationsEn.push(`There are ${conflictCount} unresolved sync conflict(s) — open Mobile/Sync to review and resolve them.`);
    } else if (queueCount > 0 && !d.is_offline) {
      remediationsAr.push(`توجد ${queueCount} عملية محلية بانتظار المزامنة — اضغط «مزامنة الآن» لرفعها للخادم.`);
      remediationsEn.push(`${queueCount} offline mutation(s) are queued locally — trigger 'Sync Now' to push them to the server.`);
    }
  }

  // 1. Company Name Mismatch check
  if (d.license_status === "COMPANY_MISMATCH" || d.company_matches === false) {
    const licCo = d.company_name || "غير محدد";
    const profCo = d.enterprise_name_ar || d.enterprise_name_en || "منشأة أخرى";
    findingsAr.push(
      `⚠️ تعارض اسم المنشأة: الترخيص صادر للمنشأة '${licCo}' بينما ملف المنشأة الحالي مضبوط على '${profCo}'.`
    );
    findingsEn.push(
      `⚠️ Company Name Mismatch: License belongs to '${licCo}' while EnterpriseProfile is configured as '${profCo}'.`
    );
    remediationsAr.push(
      `ارفع ملف ترخيص (.uas) أو مفتاح (UASKEY-...) مطابق لاسم المنشأة '${profCo}'، أو إذا كانت هذه منشأة جديدة استخدم قاعدة بيانات نظيفة ليتم اعتماد '${licCo}' تلقائياً.`
    );
    remediationsEn.push(
      `Activate a license issued for '${profCo}', or initialize a clean EnterpriseProfile so it automatically adopts '${licCo}'.`
    );
    return {
      healthy: false,
      statusBadge: "COMPANY_MISMATCH",
      headlineAr: `اسم المنشأة لا يطابق الترخيص المعتمد (${licCo})`,
      headlineEn: `Company name mismatch: License belongs to '${licCo}'`,
      findingsAr,
      findingsEn,
      remediationsAr,
      remediationsEn,
    };
  }

  // 2. Seat limit check (7 / 7 Users reached)
  if (d.license_status === "SEAT_LIMIT_REACHED" || (d.seat_managed && d.used_users >= d.max_users)) {
    findingsAr.push(
      `⚠️ وصل استهلاك المقاعد إلى الحد الأقصى (${d.used_users} / ${d.max_users} مستخدمين). أي مستخدم جديد (رقم ${d.max_users + 1}) سيتم رفضه حتى تحرير مقعد.`
    );
    findingsEn.push(
      `⚠️ Seat capacity is full (${d.used_users} / ${d.max_users} Users). Any additional distinct user will be blocked until a seat is released.`
    );
    remediationsAr.push(
      "لتحرير مقعد جهاز مفقود أو مستبدل: سجل الدخول بحساب مدير النظام العام (SUPER_ADMIN)، افتح نافذة الترخيص > تبويب (مقاعد الأجهزة)، واضغط على زر (إلغاء ربط الجهاز / Release Device Seat)."
    );
    remediationsEn.push(
      "To free a seat for a lost/replaced laptop or phone: sign in as SUPER_ADMIN, open License Modal > Device Seats tab, and click 'إلغاء ربط الجهاز / Release Device Seat'."
    );
  }

  // 3. Unlicensed / Expired / Clock Tamper / HWID Mismatch
  if (!d.is_valid || d.license_status !== "ACTIVE") {
    if (d.license_status === "UNLICENSED") {
      findingsAr.push("⚠️ المنظومة غير مفعلة حالياً بترخيص رسمي.");
      findingsEn.push("⚠️ System is currently UNLICENSED.");
      remediationsAr.push(
        `افتح نافذة تفعيل الترخيص، أدخل اسم المنشأة، وارفع ملف license.uas أو أدخل مفتاح UASKEY-... (رمز طلب الجهاز: ${d.request_code || "REQ-XXXX"}).`
      );
      remediationsEn.push(
        `Open the License Activation Modal, confirm your Company Name, and upload license.uas or enter your UASKEY-... token (Request Code: ${d.request_code || "REQ-XXXX"}).`
      );
    } else if (d.license_status === "EXPIRED") {
      findingsAr.push("⚠️ انتهت فترة صلاحية الترخيص الحالي.");
      findingsEn.push("⚠️ Installed license has EXPIRED.");
      remediationsAr.push("يرجى تجديد الترخيص ورفع ملف license.uas الجديد أو مفتاح التفعيل المحدث.");
      remediationsEn.push("Please renew your subscription and upload the new license.uas file or activation key.");
    } else if (d.license_status === "HWID_MISMATCH") {
      findingsAr.push("⚠️ بصمة العتاد (HWID) للترخيص الحالي مرتبطة بجهاز كمبيوتر آخر.");
      findingsEn.push("⚠️ Hardware fingerprint (HWID) mismatch: license is bound to another machine.");
      remediationsAr.push(
        `استخدم ترخيصاً مؤسسياً شاملاً (hwid: "*") مداراً بالمقاعد، أو اطلب ترخيصاً لرمز جهازك الحالي (${d.request_code || "REQ-XXXX"}).`
      );
      remediationsEn.push(
        `Use a company-wide seat-managed license (hwid: "*") or request a license matching this machine's Request Code (${d.request_code || "REQ-XXXX"}).`
      );
    } else if (d.license_status === "CLOCK_TAMPER") {
      findingsAr.push("🚨 تم اكتشاف تراجع في ساعة وتاريخ الجهاز (Monotonic Clock Tamper Lock).");
      findingsEn.push("🚨 Monotonic clock rollback detected (CLOCK_TAMPER lock engaged).");
      remediationsAr.push("اضبط تاريخ وساعة نظام التشغيل (Windows/Android) على التوقيت الحقيقي الصحيح ثم أعد تحديث حالة الترخيص.");
      remediationsEn.push("Restore your operating system clock to the accurate current UTC date/time and refresh license status.");
    } else if (d.error) {
      findingsAr.push(`⚠️ تفاصيل الحالة: ${d.error}`);
      findingsEn.push(`⚠️ Status detail: ${d.error}`);
    }

    return {
      healthy: false,
      statusBadge: d.license_status,
      headlineAr: `تنبيه حالة الترخيص: ${d.license_status}`,
      headlineEn: `License Status Alert: ${d.license_status}`,
      findingsAr,
      findingsEn,
      remediationsAr,
      remediationsEn,
    };
  }

  // 4. Healthy active state
  if (d.company_name) {
    findingsAr.push(
      `✅ قفل اسم المنشأة متطابق ومفعل على: '${d.company_name}' (رقم الترخيص: ${d.license_id || "UAS"} • متبقي ${d.remaining_days} يوماً).`
    );
    findingsEn.push(
      `✅ Company Lock verified for '${d.company_name}' (License ID: ${d.license_id || "UAS"} • ${d.remaining_days} days remaining).`
    );
  } else {
    findingsAr.push(
      `✅ الترخيص مفعل وساري المفعول (رقم الترخيص: ${d.license_id || "UAS"} • متبقي ${d.remaining_days} يوماً).`
    );
    findingsEn.push(
      `✅ License is ACTIVE and verified (License ID: ${d.license_id || "UAS"} • ${d.remaining_days} days remaining).`
    );
  }

  if (remediationsAr.length === 0) {
    remediationsAr.push("النظام يعمل بكفاءة؛ يمكنك إدارة مقاعد الأجهزة أو التبديل بين أوضاع التشغيل (Local / LAN / Cloud) من نافذة الترخيص.");
    remediationsEn.push("System is healthy; you can manage device seats or switch runtime modes (Local / LAN / Cloud) from the License Modal.");
  }

  return {
    healthy: true,
    statusBadge: "ACTIVE",
    headlineAr: `النظام مرخص ويعمل بنجاح (${d.company_name || "منشأة معتمدة"} — ${d.used_users}/${d.max_users} مستخدمين)`,
    headlineEn: `System Active & Healthy (${d.company_name || "Authorized Enterprise"} — ${d.used_users}/${d.max_users} Users)`,
    findingsAr,
    findingsEn,
    remediationsAr,
    remediationsEn,
  };
}

// ---------------------------------------------------------------------------
// Complete Offline Customer Service & User Manual Q&A Composer
// ---------------------------------------------------------------------------

export function answerSupportQuery(
  query: string,
  opts: {
    lang?: "ar" | "en";
    diagnostics?: Partial<SupportSystemDiagnostics> | null;
    memories?: CopilotMemoryEntry[];
    topK?: number;
  } = {}
): SupportAnswerResult {
  const cleanQuery = String(query ?? "").trim();
  const lang = opts.lang ?? detectSupportLanguage(cleanQuery, "ar");
  const diagnostics = normalizeDiagnostics(opts.diagnostics);
  const diagnosticReport = diagnoseLiveSystemState(diagnostics);
  const matches = searchSupportKnowledge(
    cleanQuery || (lang === "ar" ? "ترخيص مقاعد اعداد النظام" : "license seats setup"),
    { topK: opts.topK ?? 3 }
  );
  const isDiagnosticQuery = isDiagnosticRelatedQuery(cleanQuery);

  const suggestedActions: SupportSuggestedAction[] = [];
  const seenActions = new Set<string>();

  if (isDiagnosticQuery || !diagnosticReport.healthy) {
    suggestedActions.push({
      type: "open_license_modal",
      labelAr: "فتح نافذة الترخيص ومقاعد الأجهزة",
      labelEn: "Open License & Device Seats Modal",
      targetTab: "system",
    });
    seenActions.add("open_license_modal");
  }

  for (const m of matches) {
    const key = `${m.section.relatedAction || "navigate_tab"}:${m.section.targetTab || ""}`;
    if (seenActions.has(key)) continue;
    seenActions.add(key);

    if (m.section.relatedAction === "open_license_modal") {
      if (!seenActions.has("open_license_modal")) {
        suggestedActions.push({
          type: "open_license_modal",
          labelAr: "إدارة الترخيص وإلغاء ربط الأجهزة",
          labelEn: "Manage License & Release Device Seats",
          targetTab: "system",
        });
        seenActions.add("open_license_modal");
      }
    } else if (m.section.targetTab) {
      suggestedActions.push({
        type: "navigate_tab",
        labelAr: `الانتقال إلى: ${m.section.titleAr}`,
        labelEn: `Go to: ${m.section.titleEn}`,
        targetTab: m.section.targetTab,
      });
    }
  }

  // Compose Arabic response
  const arParts: string[] = [];
  if (isDiagnosticQuery || !diagnosticReport.healthy) {
    arParts.push(`### 🔍 التشخيص الفوري لحالة النظام (${diagnosticReport.statusBadge})`);
    arParts.push(`**${diagnosticReport.headlineAr}**`);
    for (const f of diagnosticReport.findingsAr) {
      arParts.push(`- ${f}`);
    }
    if (diagnosticReport.remediationsAr.length > 0) {
      arParts.push(`**التوصيات والخطوات العملية:**`);
      for (const r of diagnosticReport.remediationsAr) {
        arParts.push(`- ${r}`);
      }
    }
  }

  if (matches.length > 0) {
    const top = matches[0].section;
    arParts.push(`### 📖 ${top.titleAr}`);
    arParts.push(top.contentAr);
    if (top.stepsAr.length > 0) {
      arParts.push(`**الخطوات:**`);
      top.stepsAr.forEach((step, idx) => {
        arParts.push(`${idx + 1}. ${step}`);
      });
    }
    if (top.troubleshootingAr && top.troubleshootingAr.length > 0) {
      arParts.push(`**حل المشكلات الشائعة:**`);
      for (const t of top.troubleshootingAr) {
        arParts.push(`- ${t}`);
      }
    }
    if (matches.length > 1) {
      arParts.push(
        `**مواضيع ذات صلة في دليل المستخدم:** ${matches
          .slice(1)
          .map((m) => m.section.titleAr)
          .join(" • ")}`
      );
    }
  } else if (arParts.length === 0) {
    arParts.push(
      "مرحباً بك في خدمة العملاء ودليل المستخدم الذكي لمنظومة UAS (يعمل 100% دون إنترنت). يمكنك السؤال عن: تفعيل الترخيص وقفل اسم المنشأة، إدارة مقاعد الـ 7 مستخدمين وإلغاء ربط الجهاز، أوضاع التشغيل (Local / LAN / Cloud)، شجرة الحسابات وقيود اليومية، سندات القبض والصرف، الفواتير والمخزون ورمز QR، أو التقارير المالية والنسخ الاحتياطي."
    );
  }

  // Compose English response
  const enParts: string[] = [];
  if (isDiagnosticQuery || !diagnosticReport.healthy) {
    enParts.push(`### 🔍 Live System Diagnostics (${diagnosticReport.statusBadge})`);
    enParts.push(`**${diagnosticReport.headlineEn}**`);
    for (const f of diagnosticReport.findingsEn) {
      enParts.push(`- ${f}`);
    }
    if (diagnosticReport.remediationsEn.length > 0) {
      enParts.push(`**Recommended Actions:**`);
      for (const r of diagnosticReport.remediationsEn) {
        enParts.push(`- ${r}`);
      }
    }
  }

  if (matches.length > 0) {
    const top = matches[0].section;
    enParts.push(`### 📖 ${top.titleEn}`);
    enParts.push(top.contentEn);
    if (top.stepsEn.length > 0) {
      enParts.push(`**Step-by-Step Guide:**`);
      top.stepsEn.forEach((step, idx) => {
        enParts.push(`${idx + 1}. ${step}`);
      });
    }
    if (top.troubleshootingEn && top.troubleshootingEn.length > 0) {
      enParts.push(`**Troubleshooting:**`);
      for (const t of top.troubleshootingEn) {
        enParts.push(`- ${t}`);
      }
    }
    if (matches.length > 1) {
      enParts.push(
        `**Related Manual Topics:** ${matches
          .slice(1)
          .map((m) => m.section.titleEn)
          .join(" • ")}`
      );
    }
  } else if (enParts.length === 0) {
    enParts.push(
      "Welcome to the UAS Offline Customer Service & Interactive User Manual Assistant. You can ask about: Company-Locked 7-User Licensing & Device Seat Release, Operating Modes (Local / Office LAN 0.0.0.0:3000 / Cloud qat.world), 5-Level Chart of Accounts & Double-Entry Journals, Receipts/Payments & Cost Centers, Invoicing/Inventory & QR Verification, or Financial Reports & SQLite Backup/Restore."
    );
  }

  const activeMemories = (opts.memories ?? []).filter((m) => m.active).slice(0, 3);
  if (activeMemories.length > 0) {
    arParts.push(
      `**قواعد وذاكرة المنشأة المطبّقة:**\n${activeMemories.map((m) => `- ${m.content}`).join("\n")}`
    );
  }

  const answerAr = arParts.join("\n\n");
  const answerEn =
    activeMemories.length > 0
      ? `${enParts.join("\n\n")}\n\n**Applied Tenant Rules & Memories:**\n${activeMemories
          .map((m) => `- ${m.content}`)
          .join("\n")}`
      : enParts.join("\n\n");

  return {
    query: cleanQuery,
    lang,
    answer: lang === "ar" ? answerAr : answerEn,
    answerAr,
    answerEn,
    isDiagnosticQuery,
    diagnosticReport,
    diagnostics,
    matches,
    suggestedActions,
  };
}

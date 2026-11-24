/**
 * UAS Enterprise — Tenant-Scoped Copilot Memory Types, Guardrails & Client Sync Store
 *
 * Zero Node-only imports so both browser/Capacitor/offline adapters and server
 * modules share identical schema, topicKey normalization, RBAC safety guardrails,
 * and retrieval ranking.
 */

export type CopilotMemoryScope = "workspace" | "user";

export type CopilotMemoryCategory =
  | "correction"
  | "domain_fact"
  | "naming_alias"
  | "workflow_preference"
  | "operational_pattern"
  | "dialect_preference";

export const DIALECT_LEARNING_SETTING_TOPIC = "pref:dialect_learning_enabled";
export const DIALECT_TERM_TOPIC_PREFIX = "dialect:";

export function isDialectLearningConfigEntry(entry: Pick<CopilotMemoryEntry, "topicKey">): boolean {
  return String(entry.topicKey || "").toLowerCase() === DIALECT_LEARNING_SETTING_TOPIC;
}

export function isDialectTermMemoryEntry(
  entry: Pick<CopilotMemoryEntry, "category" | "topicKey">
): boolean {
  if (isDialectLearningConfigEntry(entry)) return false;
  return (
    entry.category === "dialect_preference" ||
    String(entry.topicKey || "").toLowerCase().startsWith(DIALECT_TERM_TOPIC_PREFIX)
  );
}

export function extractDialectLearningEnabled(
  entries: CopilotMemoryEntry[],
  userId?: string | null
): boolean {
  const cfg = entries.find((e) => {
    if (!isDialectLearningConfigEntry(e)) return false;
    if (userId && e.userId && e.userId !== userId) return false;
    return e.active !== false;
  });
  if (!cfg) return true;
  return !/OFF|DISABLED|FALSE|0$/i.test(cfg.content.trim());
}

export interface CopilotMemoryEntry {
  id: string;
  tenantSlug: string;
  scope: CopilotMemoryScope;
  userId?: string;
  category: CopilotMemoryCategory;
  topicKey: string;
  content: string;
  sourceSnippet: string;
  confidence: number;
  usageCount: number;
  pinned: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMemoryInput {
  id?: string;
  tenantSlug: string;
  scope?: CopilotMemoryScope;
  userId?: string;
  category: CopilotMemoryCategory;
  topicKey: string;
  content: string;
  sourceSnippet?: string;
  confidence?: number;
  pinned?: boolean;
  active?: boolean;
}

export interface MemoryMutationEvent {
  action: "learned" | "updated" | "forgotten";
  entry: CopilotMemoryEntry;
  previousEntry?: CopilotMemoryEntry | null;
}

const VALID_CATEGORIES = new Set<CopilotMemoryCategory>([
  "correction",
  "domain_fact",
  "naming_alias",
  "workflow_preference",
  "operational_pattern",
  "dialect_preference",
]);

export function normalizeMemoryTenantSlug(rawSlug: string | null | undefined): string {
  const clean = String(rawSlug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "default";
}

export function normalizeTopicKey(rawKey: string, fallbackContent = ""): string {
  const source = String(rawKey || fallbackContent || "general")
    .trim()
    .toLowerCase();
  const normalized = source
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0600-\u06FF:_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, 72) || `rule_${Date.now().toString(36)}`;
}

/**
 * Hard guardrail: never learn secrets, credentials, passwords, OTPs, transient one-off
 * chatter, or attempts to override RBAC permissions, fiscal locks, or confirmations.
 */
export function isSensitiveOrDisallowedMemory(content: string): {
  blocked: boolean;
  reason?: string;
} {
  const text = String(content || "").trim();
  if (text.length < 6 || text.length > 420) {
    return { blocked: true, reason: "INVALID_LENGTH" };
  }

  const secretPatterns = [
    /(?:GEMINI_API_KEY|OPENAI_API_KEY|API[_-]?KEY|PRIVATE\s+KEY|BEGIN\s+EC|UASKEY-|Bearer\s+[A-Za-z0-9._-]{12,})/i,
    /(?:كلمه\s*المرور|كلمة\s*المرور|الباسورد|رمز\s*التحقق|الرمز\s*السري|password|passcode|otp|secret\s*token)\s*[:=]\s*\S+/i,
  ];
  for (const re of secretPatterns) {
    if (re.test(text)) {
      return { blocked: true, reason: "SENSITIVE_SECRET_REDACTED" };
    }
  }

  const securityBypassPatterns = [
    /(?:bypass\s+rbac|skip\s+confirmation|ignore\s+(?:rbac|permission|period\s*lock|fiscal\s*lock)|auto[- ]?post\s+without\s+confirm)/i,
    /(?:تجاوز\s+(?:الصلاحيات|التأكيد|الاعتماد|قفل\s+الفترة)|ترحيل\s+(?:مباشر\s+)?بدون\s+تأكيد|السماح\s+بالمخزون\s+السالب\s+دائماً|فك\s+القفل\s+تلقائياً)/i,
  ];
  for (const re of securityBypassPatterns) {
    if (re.test(text)) {
      return { blocked: true, reason: "SECURITY_GUARDRAIL_OVERRIDE_BLOCKED" };
    }
  }

  return { blocked: false };
}

export function sanitizeMemoryCandidate(
  input: UpsertMemoryInput
): { ok: true; input: UpsertMemoryInput } | { ok: false; reason: string } {
  const tenantSlug = normalizeMemoryTenantSlug(input.tenantSlug);
  const content = String(input.content || "")
    .replace(/\s+/g, " ")
    .trim();
  const guard = isSensitiveOrDisallowedMemory(content);
  if (guard.blocked) {
    return { ok: false, reason: guard.reason || "DISALLOWED" };
  }

  const category: CopilotMemoryCategory = VALID_CATEGORIES.has(input.category)
    ? input.category
    : "domain_fact";
  const scope: CopilotMemoryScope = input.scope === "user" ? "user" : "workspace";
  const topicKey = normalizeTopicKey(input.topicKey, content);
  const confidence = Math.max(0.1, Math.min(1, Number(input.confidence ?? 0.85)));

  return {
    ok: true,
    input: {
      ...input,
      tenantSlug,
      scope,
      userId: scope === "user" ? (input.userId || undefined) : input.userId,
      category,
      topicKey,
      content,
      sourceSnippet: String(input.sourceSnippet || content).slice(0, 180).trim(),
      confidence,
      pinned: Boolean(input.pinned),
      active: input.active !== false,
    },
  };
}

export function applyMemoryUpsert(
  existingList: CopilotMemoryEntry[],
  rawInput: UpsertMemoryInput
): { nextList: CopilotMemoryEntry[]; event: MemoryMutationEvent | null } {
  const checked = sanitizeMemoryCandidate(rawInput);
  if (!checked.ok) {
    return { nextList: existingList, event: null };
  }
  const clean = checked.input;
  const now = new Date().toISOString();
  const nextList = [...existingList];

  const matchIdx = nextList.findIndex(
    (m) =>
      m.tenantSlug === clean.tenantSlug &&
      (clean.id ? m.id === clean.id : m.topicKey === clean.topicKey && m.scope === clean.scope && (!clean.userId || !m.userId || m.userId === clean.userId))
  );

  if (matchIdx >= 0) {
    const prev = nextList[matchIdx];
    const updated: CopilotMemoryEntry = {
      ...prev,
      category: clean.category,
      content: clean.content,
      sourceSnippet: clean.sourceSnippet || prev.sourceSnippet,
      confidence: Math.max(prev.confidence, clean.confidence ?? 0.85),
      pinned: clean.pinned !== undefined ? Boolean(clean.pinned) : prev.pinned,
      active: clean.active !== undefined ? Boolean(clean.active) : true,
      updatedAt: now,
    };
    nextList[matchIdx] = updated;
    return {
      nextList,
      event: { action: "updated", entry: updated, previousEntry: prev },
    };
  }

  const created: CopilotMemoryEntry = {
    id: clean.id || `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    tenantSlug: clean.tenantSlug,
    scope: clean.scope || "workspace",
    userId: clean.userId,
    category: clean.category,
    topicKey: clean.topicKey,
    content: clean.content,
    sourceSnippet: clean.sourceSnippet || clean.content,
    confidence: clean.confidence ?? 0.85,
    usageCount: 0,
    pinned: Boolean(clean.pinned),
    active: clean.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  nextList.unshift(created);
  return {
    nextList: nextList.slice(0, 200),
    event: { action: "learned", entry: created, previousEntry: null },
  };
}

function tokenizeForMemorySearch(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .split(/[^a-z0-9\u0600-\u06FF]+/)
    .filter((t) => t.length >= 2);
}

export function retrieveRelevantMemories(params: {
  entries: CopilotMemoryEntry[];
  tenantSlug: string;
  userId?: string | null;
  query?: string;
  activeTab?: string;
  limit?: number;
}): CopilotMemoryEntry[] {
  const tenantSlug = normalizeMemoryTenantSlug(params.tenantSlug);
  const limit = Math.max(1, params.limit ?? 8);
  const queryTokens = tokenizeForMemorySearch(`${params.query || ""} ${params.activeTab || ""}`);

  const scoped = params.entries.filter((e) => {
    if (!e.active) return false;
    if (normalizeMemoryTenantSlug(e.tenantSlug) !== tenantSlug) return false;
    if (e.scope === "user" && params.userId && e.userId && e.userId !== params.userId) {
      return false;
    }
    return true;
  });

  const scored = scoped.map((entry) => {
    let score = entry.pinned ? 12 : 0;
    if (entry.category === "workflow_preference" || entry.category === "correction") {
      score += 4;
    }
    const haystack = `${entry.topicKey} ${entry.content} ${entry.sourceSnippet}`;
    const entryTokens = new Set(tokenizeForMemorySearch(haystack));
    for (const qt of queryTokens) {
      if (entryTokens.has(qt)) score += 3;
      else if (haystack.toLowerCase().includes(qt)) score += 1.5;
    }
    score += entry.confidence * 2;
    return { entry, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.updatedAt.localeCompare(a.entry.updatedAt);
  });

  return scored.slice(0, limit).map((s) => s.entry);
}

// ---------------------------------------------------------------------------
// Client / Offline localStorage Store (Tenant-Isolated)
// ---------------------------------------------------------------------------

const LOCAL_MEMORY_PREFIX = "uas_copilot_memory_v1_";

function localMemoryStorageKey(tenantSlug: string): string {
  return `${LOCAL_MEMORY_PREFIX}${normalizeMemoryTenantSlug(tenantSlug)}`;
}

export function loadLocalCopilotMemories(tenantSlug: string): CopilotMemoryEntry[] {
  if (typeof window === "undefined") return [];
  const normTenant = normalizeMemoryTenantSlug(tenantSlug);
  try {
    const raw = window.localStorage.getItem(localMemoryStorageKey(normTenant));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is CopilotMemoryEntry =>
        Boolean(x && typeof x.id === "string" && normalizeMemoryTenantSlug(x.tenantSlug) === normTenant)
    );
  } catch {
    return [];
  }
}

export function saveLocalCopilotMemories(tenantSlug: string, entries: CopilotMemoryEntry[]): void {
  if (typeof window === "undefined") return;
  const normTenant = normalizeMemoryTenantSlug(tenantSlug);
  const isolated = entries.filter((e) => normalizeMemoryTenantSlug(e.tenantSlug) === normTenant);
  try {
    window.localStorage.setItem(localMemoryStorageKey(normTenant), JSON.stringify(isolated));
  } catch {
    // ignore storage quota
  }
}

export function upsertLocalCopilotMemory(input: UpsertMemoryInput): MemoryMutationEvent | null {
  const current = loadLocalCopilotMemories(input.tenantSlug);
  const { nextList, event } = applyMemoryUpsert(current, input);
  if (event) {
    saveLocalCopilotMemories(input.tenantSlug, nextList);
  }
  return event;
}

export function forgetLocalCopilotMemories(params: {
  tenantSlug: string;
  userId?: string | null;
  query?: string;
  id?: string;
}): CopilotMemoryEntry[] {
  const current = loadLocalCopilotMemories(params.tenantSlug);
  const queryTokens = tokenizeForMemorySearch(params.query || "");
  const removed: CopilotMemoryEntry[] = [];

  const next = current.filter((e) => {
    if (params.id && e.id === params.id) {
      removed.push(e);
      return false;
    }
    if (!params.id && queryTokens.length > 0) {
      if (e.scope === "user" && params.userId && e.userId && e.userId !== params.userId) {
        return true;
      }
      const hay = `${e.topicKey} ${e.content} ${e.sourceSnippet}`;
      const hayTokens = new Set(tokenizeForMemorySearch(hay));
      const matched = queryTokens.some((t) => hayTokens.has(t) || hay.toLowerCase().includes(t));
      if (matched) {
        removed.push(e);
        return false;
      }
    }
    return true;
  });

  if (removed.length > 0) {
    saveLocalCopilotMemories(params.tenantSlug, next);
  }
  return removed;
}

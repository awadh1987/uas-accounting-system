/**
 * UAS Enterprise — Server-Side Tenant-Isolated Copilot Memory Persistence
 *
 * Stores per-tenant memories cleanly under `data/copilot-memory/<tenantSlug>.json`
 * (or `$UAS_DATA_DIR/copilot-memory/<tenantSlug>.json`) and mirrors into
 * `.next/standalone/data/copilot-memory/` when applicable.
 *
 * Enforces strict tenant isolation on every read/write/delete.
 */
import fs from "node:fs";
import path from "node:path";
import {
  applyMemoryUpsert,
  DIALECT_LEARNING_SETTING_TOPIC,
  extractDialectLearningEnabled,
  isDialectLearningConfigEntry,
  isDialectTermMemoryEntry,
  normalizeMemoryTenantSlug,
  retrieveRelevantMemories,
  type CopilotMemoryEntry,
  type MemoryMutationEvent,
  type UpsertMemoryInput,
} from "./copilotMemoryTypes";

function resolveMemoryDir(): string {
  const explicitDataDir = (process.env.UAS_DATA_DIR || "").trim();
  if (explicitDataDir) {
    return path.join(explicitDataDir, "copilot-memory");
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "copilot-memory");
}

function resolveTenantMemoryFilePath(tenantSlug: string): string {
  const safeSlug = normalizeMemoryTenantSlug(tenantSlug);
  return path.join(/*turbopackIgnore: true*/ resolveMemoryDir(), `${safeSlug}.json`);
}

function readTenantMemoryFile(tenantSlug: string): CopilotMemoryEntry[] {
  const safeSlug = normalizeMemoryTenantSlug(tenantSlug);
  const filePath = resolveTenantMemoryFilePath(safeSlug);
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      return [];
    }
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CopilotMemoryEntry =>
        Boolean(
          item &&
            typeof item.id === "string" &&
            normalizeMemoryTenantSlug(item.tenantSlug) === safeSlug
        )
    );
  } catch {
    return [];
  }
}

function writeTenantMemoryFile(tenantSlug: string, entries: CopilotMemoryEntry[]): void {
  const safeSlug = normalizeMemoryTenantSlug(tenantSlug);
  const isolated = entries.filter((e) => normalizeMemoryTenantSlug(e.tenantSlug) === safeSlug);
  const filePath = resolveTenantMemoryFilePath(safeSlug);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }
  const serialized = JSON.stringify(isolated, null, 2);
  fs.writeFileSync(/*turbopackIgnore: true*/ filePath, serialized, "utf8");

  // Mirror to .next/standalone/data/copilot-memory/ when running without explicit UAS_DATA_DIR
  if (!(process.env.UAS_DATA_DIR || "").trim()) {
    try {
      const projectRoot = path.resolve(dir, "..", "..");
      const standaloneRoot = path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone");
      const standalonePath = path.join(
        /*turbopackIgnore: true*/ standaloneRoot,
        "data",
        "copilot-memory",
        `${safeSlug}.json`
      );
      if (
        fs.existsSync(standaloneRoot) &&
        path.resolve(standalonePath) !== path.resolve(filePath)
      ) {
        fs.mkdirSync(path.dirname(standalonePath), { recursive: true });
        fs.writeFileSync(/*turbopackIgnore: true*/ standalonePath, serialized, "utf8");
      }
    } catch {
      // non-fatal mirror
    }
  }
}

export function listTenantMemories(params: {
  tenantSlug: string;
  userId?: string | null;
  includeInactive?: boolean;
}): CopilotMemoryEntry[] {
  const list = readTenantMemoryFile(params.tenantSlug);
  return list.filter((e) => {
    if (!params.includeInactive && !e.active) return false;
    if (e.scope === "user" && params.userId && e.userId && e.userId !== params.userId) {
      return false;
    }
    return true;
  });
}

export function upsertTenantMemory(input: UpsertMemoryInput): MemoryMutationEvent | null {
  const current = readTenantMemoryFile(input.tenantSlug);
  const { nextList, event } = applyMemoryUpsert(current, input);
  if (event) {
    writeTenantMemoryFile(input.tenantSlug, nextList);
  }
  return event;
}

export function updateTenantMemory(params: {
  tenantSlug: string;
  id: string;
  patch: Partial<Pick<CopilotMemoryEntry, "active" | "pinned" | "content" | "scope" | "category">>;
}): CopilotMemoryEntry | null {
  const current = readTenantMemoryFile(params.tenantSlug);
  const idx = current.findIndex((m) => m.id === params.id);
  if (idx < 0) return null;
  const next = {
    ...current[idx],
    ...params.patch,
    updatedAt: new Date().toISOString(),
  };
  current[idx] = next;
  writeTenantMemoryFile(params.tenantSlug, current);
  return next;
}

export function deleteTenantMemory(params: {
  tenantSlug: string;
  id: string;
}): CopilotMemoryEntry | null {
  const current = readTenantMemoryFile(params.tenantSlug);
  const idx = current.findIndex((m) => m.id === params.id);
  if (idx < 0) return null;
  const [removed] = current.splice(idx, 1);
  writeTenantMemoryFile(params.tenantSlug, current);
  return removed;
}

export function forgetTenantMemoriesByQuery(params: {
  tenantSlug: string;
  userId?: string | null;
  query: string;
}): CopilotMemoryEntry[] {
  const current = readTenantMemoryFile(params.tenantSlug);
  const normQuery = String(params.query || "").trim().toLowerCase();
  const tokens = normQuery.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];

  const removed: CopilotMemoryEntry[] = [];
  const next = current.filter((e) => {
    if (e.scope === "user" && params.userId && e.userId && e.userId !== params.userId) {
      return true;
    }
    const hay = `${e.topicKey} ${e.content} ${e.sourceSnippet}`.toLowerCase();
    const matched = tokens.some((t) => hay.includes(t));
    if (matched) {
      removed.push(e);
      return false;
    }
    return true;
  });

  if (removed.length > 0) {
    writeTenantMemoryFile(params.tenantSlug, next);
  }
  return removed;
}

export function retrieveServerCopilotMemories(params: {
  tenantSlug: string;
  userId?: string | null;
  query?: string;
  activeTab?: string;
  limit?: number;
}): CopilotMemoryEntry[] {
  const list = readTenantMemoryFile(params.tenantSlug);
  return retrieveRelevantMemories({
    entries: list,
    tenantSlug: params.tenantSlug,
    userId: params.userId,
    query: params.query,
    activeTab: params.activeTab,
    limit: params.limit,
  });
}

export function recordMemoryUsage(params: {
  tenantSlug: string;
  memoryIds: string[];
}): void {
  if (params.memoryIds.length === 0) return;
  const idSet = new Set(params.memoryIds);
  const current = readTenantMemoryFile(params.tenantSlug);
  let dirty = false;
  for (const m of current) {
    if (idSet.has(m.id)) {
      m.usageCount = (m.usageCount || 0) + 1;
      dirty = true;
    }
  }
  if (dirty) {
    writeTenantMemoryFile(params.tenantSlug, current);
  }
}

export function getUserDialectLearningEnabled(params: {
  tenantSlug: string;
  userId?: string | null;
}): boolean {
  const list = readTenantMemoryFile(params.tenantSlug);
  return extractDialectLearningEnabled(list, params.userId);
}

export function setUserDialectLearningEnabled(params: {
  tenantSlug: string;
  userId?: string | null;
  enabled: boolean;
}): CopilotMemoryEntry | null {
  const ev = upsertTenantMemory({
    tenantSlug: params.tenantSlug,
    scope: "user",
    userId: params.userId ?? undefined,
    category: "dialect_preference",
    topicKey: DIALECT_LEARNING_SETTING_TOPIC,
    content: params.enabled ? "DIALECT_LEARNING_ENABLED" : "DIALECT_LEARNING_DISABLED",
    sourceSnippet: "User Copilot Options Toggle",
    confidence: 1,
    pinned: false,
    active: true,
  });
  return ev?.entry ?? null;
}

export function countLearnedDialectEntries(params: {
  tenantSlug: string;
  userId?: string | null;
}): number {
  const list = readTenantMemoryFile(params.tenantSlug);
  return list.filter((e) => {
    if (!isDialectTermMemoryEntry(e)) return false;
    if (e.scope === "user" && params.userId && e.userId && e.userId !== params.userId) {
      return false;
    }
    return true;
  }).length;
}

export function listVisibleTenantMemories(params: {
  tenantSlug: string;
  userId?: string | null;
  includeInactive?: boolean;
}): CopilotMemoryEntry[] {
  return listTenantMemories(params).filter((e) => !isDialectLearningConfigEntry(e));
}

export function resetLearnedDialectForUser(params: {
  tenantSlug: string;
  userId?: string | null;
}): { removedCount: number; memories: CopilotMemoryEntry[] } {
  const current = readTenantMemoryFile(params.tenantSlug);
  let removedCount = 0;
  const next = current.filter((entry) => {
    if (!isDialectTermMemoryEntry(entry)) return true;
    if (entry.scope === "user" && params.userId && entry.userId && entry.userId !== params.userId) {
      return true;
    }
    if (entry.scope === "workspace" && params.userId && entry.userId && entry.userId !== params.userId) {
      return true;
    }
    removedCount++;
    return false;
  });

  if (removedCount > 0) {
    writeTenantMemoryFile(params.tenantSlug, next);
  }

  return {
    removedCount,
    memories: listVisibleTenantMemories({
      tenantSlug: params.tenantSlug,
      userId: params.userId,
      includeInactive: true,
    }),
  };
}

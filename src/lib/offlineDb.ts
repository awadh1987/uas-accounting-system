"use client";

import Dexie, { type Table } from "dexie";
import type { UasBootstrapState } from "@/types/uas";

export interface OfflineMutationItem {
  id?: number;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  payload: Record<string, unknown>;
  label: string;
  createdAt: string;
  idempotencyKey?: string;
  entityType?: string;
  entityId?: string;
  baseUpdatedAt?: string | null;
  status?: "QUEUED" | "SYNCED" | "CONFLICT_PENDING" | "FAILED";
  error?: string;
}

export interface OfflineSnapshotRow {
  key: string;
  state: UasBootstrapState;
  updatedAt: string;
}

export interface OfflineSyncMetaRow {
  key: string;
  cursor: number;
  lastSyncAt: string | null;
  lastError: string | null;
  syncMode: "AUTO" | "MANUAL";
  syncIntervalSec: number;
}

class UasOfflineDatabase extends Dexie {
  snapshots!: Table<OfflineSnapshotRow, string>;
  queue!: Table<OfflineMutationItem, number>;
  syncMeta!: Table<OfflineSyncMetaRow, string>;

  constructor() {
    super("uas_offline_db");
    this.version(1).stores({
      snapshots: "key, updatedAt",
      queue: "++id, endpoint, method, createdAt",
    });
    this.version(2).stores({
      snapshots: "key, updatedAt",
      queue: "++id, endpoint, method, createdAt, idempotencyKey, status",
      syncMeta: "key",
    });
  }
}

let dbInstance: UasOfflineDatabase | null = null;

function getDb(): UasOfflineDatabase | null {
  if (typeof window === "undefined") return null;
  if (!dbInstance) {
    dbInstance = new UasOfflineDatabase();
  }
  return dbInstance;
}

function generateOfflineKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveOfflineSnapshot(state: UasBootstrapState): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.snapshots.put({
      key: "latest",
      state,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("IndexedDB snapshot save skipped:", err);
  }
}

export async function loadOfflineSnapshot(): Promise<UasBootstrapState | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const row = await db.snapshots.get("latest");
    return row?.state ?? null;
  } catch (err) {
    console.warn("IndexedDB snapshot load skipped:", err);
    return null;
  }
}

export async function enqueueOfflineMutation(
  item: Omit<OfflineMutationItem, "id" | "createdAt">
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  await db.queue.add({
    ...item,
    idempotencyKey: item.idempotencyKey || generateOfflineKey(),
    status: item.status || "QUEUED",
    createdAt: new Date().toISOString(),
  });
  return db.queue.count();
}

export async function getOfflineQueue(): Promise<OfflineMutationItem[]> {
  const db = getDb();
  if (!db) return [];
  return db.queue.orderBy("id").toArray();
}

export async function getOfflineQueueCount(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    return await db.queue.count();
  } catch {
    return 0;
  }
}

export async function removeOfflineQueueItem(id: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.queue.delete(id);
}

export async function updateOfflineQueueItem(
  id: number,
  patch: Partial<OfflineMutationItem>
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.queue.update(id, patch);
}

export async function clearOfflineQueue(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.queue.clear();
}

export async function getSyncMeta(tenantKey = "default"): Promise<OfflineSyncMetaRow> {
  const fallback: OfflineSyncMetaRow = {
    key: tenantKey,
    cursor: 0,
    lastSyncAt: null,
    lastError: null,
    syncMode: "AUTO",
    syncIntervalSec: 60,
  };
  const db = getDb();
  if (!db) return fallback;
  try {
    const row = await db.syncMeta.get(tenantKey);
    return row || fallback;
  } catch {
    return fallback;
  }
}

export async function saveSyncMeta(
  patch: Partial<Omit<OfflineSyncMetaRow, "key">>,
  tenantKey = "default"
): Promise<OfflineSyncMetaRow> {
  const current = await getSyncMeta(tenantKey);
  const next: OfflineSyncMetaRow = {
    ...current,
    ...patch,
    key: tenantKey,
  };
  const db = getDb();
  if (db) {
    try {
      await db.syncMeta.put(next);
    } catch {
      // Ignore IndexedDB error
    }
  }
  return next;
}

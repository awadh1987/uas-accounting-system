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
}

export interface OfflineSnapshotRow {
  key: string;
  state: UasBootstrapState;
  updatedAt: string;
}

class UasOfflineDatabase extends Dexie {
  snapshots!: Table<OfflineSnapshotRow, string>;
  queue!: Table<OfflineMutationItem, number>;

  constructor() {
    super("uas_offline_db");
    this.version(1).stores({
      snapshots: "key, updatedAt",
      queue: "++id, endpoint, method, createdAt",
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

export async function clearOfflineQueue(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.queue.clear();
}


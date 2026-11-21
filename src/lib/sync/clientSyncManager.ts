"use client";

import {
  fetchBootstrapState,
  getApiBaseUrl,
  getOrCreateClientDeviceId,
  getStoredTenantId,
  isAndroidLocalIsolatedMode,
} from "@/lib/apiClient";
import {
  getOfflineQueue,
  getSyncMeta,
  removeOfflineQueueItem,
  saveSyncMeta,
  updateOfflineQueueItem,
} from "@/lib/offlineDb";
import { resilientFetch } from "@/lib/transportResolver";
import type { UasBootstrapState, UasSyncConflict, UasUser } from "@/types/uas";

export interface ClientSyncResult {
  ok: boolean;
  syncedCount: number;
  duplicateCount: number;
  conflictCount: number;
  failedCount: number;
  pulledChangesCount: number;
  latestCursor: number;
  pendingConflicts: UasSyncConflict[];
  remainingQueue: number;
  state: UasBootstrapState;
  deviceStatus?: string;
  syncMode?: "AUTO" | "MANUAL";
  error?: string;
}

function inferEntityType(endpoint: string): string {
  if (endpoint.includes("/expenses")) return "OperatingExpense";
  if (endpoint.includes("/workers")) return "WorkerWageEntry";
  if (endpoint.includes("/sales")) return "SaleTransaction";
  if (endpoint.includes("/installments")) return "InstallmentVoucher";
  if (endpoint.includes("/projects")) return "Project";
  if (endpoint.includes("/inventory")) return "HarvestInventoryBatch";
  if (endpoint.includes("/audit")) return "AuditLock";
  if (endpoint.includes("/settings")) return "SystemSettings";
  return "UasRecord";
}

function dispatchDeviceRevoked(detail?: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("uas_user");
    window.dispatchEvent(new CustomEvent("uas:device-revoked", { detail }));
  } catch {
    // Ignore storage error
  }
}

/**
 * Executes a full bidirectional manual or automatic sync cycle:
 * 1. Registers / heartbeats device identity with Tenant Devices Control Plane
 * 2. Replays offline queue items with idempotency keys & flags 409/423 conflicts as CONFLICT_PENDING
 * 3. Pulls monotonic server deltas since stored cursor (`sinceCursor`)
 * 4. Honors targeted admin commands (`SYNC_NOW`, `FORCE_FULL_RESYNC`, `WIPE_CREDENTIALS`)
 * 5. Refreshes bootstrap state and returns sync telemetry
 */
export async function performManualSyncNow(currentUser: UasUser): Promise<ClientSyncResult> {
  const tenantId = getStoredTenantId();
  const deviceId = getOrCreateClientDeviceId();
  const meta = await getSyncMeta(tenantId);

  if (isAndroidLocalIsolatedMode()) {
    const boot = await fetchBootstrapState();
    return {
      ok: true,
      syncedCount: 0,
      duplicateCount: 0,
      conflictCount: 0,
      failedCount: 0,
      pulledChangesCount: 0,
      latestCursor: meta.cursor,
      pendingConflicts: [],
      remainingQueue: boot.queueCount,
      state: boot.state,
      deviceStatus: "ACTIVE",
      syncMode: meta.syncMode,
    };
  }

  const base = getApiBaseUrl();
  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-uas-device-id": deviceId,
    "x-uas-user-id": currentUser.id,
    "x-uas-role": String(currentUser.role),
    "x-uas-user-display": `${currentUser.name} (${currentUser.role})`,
  };
  if (tenantId && tenantId !== "default") {
    commonHeaders["x-uas-tenant-id"] = tenantId;
  }

  let syncedCount = 0;
  let duplicateCount = 0;
  let conflictCount = 0;
  let failedCount = 0;
  let pulledChangesCount = 0;
  let latestCursor = meta.cursor;
  let syncMode: "AUTO" | "MANUAL" = meta.syncMode;
  let syncIntervalSec = meta.syncIntervalSec;
  let deviceStatus = "ACTIVE";

  // 1. Heartbeat / Register device
  try {
    const queueItems = await getOfflineQueue();
    const hbRes = await resilientFetch(
      `${base}/api/devices`,
      {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({
          deviceId,
          userId: currentUser.id,
          userEmail: currentUser.email,
          userDisplay: currentUser.name,
          pendingQueueCount: queueItems.length,
          lastCursor: meta.cursor,
        }),
      },
      { timeoutMs: 8000, maxRetries: 1 }
    );
    const hbData = (await hbRes.json().catch(() => ({}))) as {
      code?: string;
      clearCredentials?: boolean;
      device?: { status?: string; syncMode?: string; syncIntervalSec?: number; pendingCommand?: string | null };
    };
    if (hbRes.status === 403 && hbData.code === "DEVICE_REVOKED") {
      dispatchDeviceRevoked(hbData);
      const boot = await fetchBootstrapState();
      return {
        ok: false,
        syncedCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        failedCount: 0,
        pulledChangesCount: 0,
        latestCursor,
        pendingConflicts: [],
        remainingQueue: boot.queueCount,
        state: boot.state,
        deviceStatus: "REVOKED",
        error: "DEVICE_REVOKED",
      };
    }
    if (hbData.device) {
      deviceStatus = hbData.device.status || "ACTIVE";
      if (hbData.device.syncMode === "MANUAL" || hbData.device.syncMode === "AUTO") {
        syncMode = hbData.device.syncMode;
      }
      if (typeof hbData.device.syncIntervalSec === "number") {
        syncIntervalSec = hbData.device.syncIntervalSec;
      }
      if (hbData.device.pendingCommand === "FORCE_FULL_RESYNC") {
        latestCursor = 0;
      }
      if (hbData.device.pendingCommand === "WIPE_CREDENTIALS") {
        dispatchDeviceRevoked(hbData);
      }
    }
  } catch {
    // Continue sync attempt even if heartbeat fails transiently
  }

  // 2. Push queued offline mutations
  const queueItems = await getOfflineQueue();
  for (const item of queueItems) {
    if (item.status === "CONFLICT_PENDING") {
      conflictCount++;
      continue;
    }
    const idempKey = item.idempotencyKey || `sync-${item.id ?? Date.now()}`;
    try {
      const res = await resilientFetch(
        `${base}${item.endpoint}`,
        {
          method: item.method,
          headers: {
            ...commonHeaders,
            "X-Idempotency-Key": idempKey,
          },
          body: JSON.stringify(item.payload),
        },
        { timeoutMs: 12000, maxRetries: 2 }
      );

      if (res.status === 403) {
        const errBody = (await res.json().catch(() => ({}))) as { code?: string };
        if (errBody.code === "DEVICE_REVOKED") {
          dispatchDeviceRevoked(errBody);
          break;
        }
      }

      if (res.ok) {
        if (res.headers.get("x-idempotency-hit") === "true") {
          duplicateCount++;
        } else {
          syncedCount++;
        }
        if (item.id !== undefined) await removeOfflineQueueItem(item.id);
      } else if (res.status === 409 || res.status === 423) {
        // Flag conflict on server as CONFLICT_PENDING for side-by-side resolution
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        await resilientFetch(
          `${base}/api/sync/push`,
          {
            method: "POST",
            headers: {
              ...commonHeaders,
              "X-Idempotency-Key": `conflict-${idempKey}`,
            },
            body: JSON.stringify({
              deviceId,
              clientCursor: latestCursor,
              actor: {
                userId: currentUser.id,
                userDisplay: `${currentUser.name} (${currentUser.role})`,
                userRole: currentUser.role,
              },
              mutations: [
                {
                  idempotencyKey: idempKey,
                  entityType: item.entityType || inferEntityType(item.endpoint),
                  entityId: item.entityId || (item.payload?.id ? String(item.payload.id) : ""),
                  operation: item.method === "DELETE" ? "DELETE" : item.method === "PATCH" ? "UPDATE" : "CREATE",
                  payload: item.payload,
                  baseUpdatedAt: item.baseUpdatedAt,
                  projectId: item.payload?.projectId ? String(item.payload.projectId) : undefined,
                  harvestName: item.payload?.harvest ? String(item.payload.harvest) : undefined,
                  txDate: item.payload?.date ? String(item.payload.date) : undefined,
                },
              ],
            }),
          },
          { timeoutMs: 10000, maxRetries: 1 }
        ).catch(() => null);

        conflictCount++;
        if (item.id !== undefined) {
          await updateOfflineQueueItem(item.id, {
            status: "CONFLICT_PENDING",
            error: errData.error || "CONFLICT_PENDING",
          });
        }
      } else if (res.status === 404) {
        if (item.id !== undefined) await removeOfflineQueueItem(item.id);
        failedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  // 3. Pull server changes since monotonic cursor
  try {
    const pullRes = await resilientFetch(
      `${base}/api/sync/pull?sinceCursor=${encodeURIComponent(String(latestCursor))}&deviceId=${encodeURIComponent(deviceId)}`,
      { method: "GET", headers: commonHeaders, cache: "no-store" },
      { timeoutMs: 10000, maxRetries: 2 }
    );
    if (pullRes.ok) {
      const pullData = (await pullRes.json().catch(() => ({}))) as {
        changes?: unknown[];
        latestCursor?: number;
        devicePolicy?: {
          status?: string;
          syncMode?: "AUTO" | "MANUAL";
          syncIntervalSec?: number;
        };
      };
      pulledChangesCount = Array.isArray(pullData.changes) ? pullData.changes.length : 0;
      if (typeof pullData.latestCursor === "number") {
        latestCursor = Math.max(latestCursor, pullData.latestCursor);
      }
      if (pullData.devicePolicy?.syncMode) {
        syncMode = pullData.devicePolicy.syncMode;
      }
      if (typeof pullData.devicePolicy?.syncIntervalSec === "number") {
        syncIntervalSec = pullData.devicePolicy.syncIntervalSec;
      }
    }
  } catch {
    // Non-fatal pull failure
  }

  // 4. Fetch pending conflicts list
  let pendingConflicts: UasSyncConflict[] = [];
  try {
    const confRes = await resilientFetch(
      `${base}/api/sync/conflicts?status=CONFLICT_PENDING`,
      { method: "GET", headers: commonHeaders, cache: "no-store" },
      { timeoutMs: 8000, maxRetries: 1 }
    );
    if (confRes.ok) {
      const confData = (await confRes.json().catch(() => ({}))) as { conflicts?: UasSyncConflict[] };
      if (Array.isArray(confData.conflicts)) {
        pendingConflicts = confData.conflicts;
        conflictCount = Math.max(conflictCount, pendingConflicts.length);
      }
    }
  } catch {
    // Ignore
  }

  const nowIso = new Date().toISOString();
  await saveSyncMeta(
    {
      cursor: latestCursor,
      lastSyncAt: nowIso,
      lastError: failedCount > 0 ? `${failedCount} item(s) failed` : null,
      syncMode,
      syncIntervalSec,
    },
    tenantId
  );

  const refreshed = await fetchBootstrapState();
  return {
    ok: failedCount === 0,
    syncedCount,
    duplicateCount,
    conflictCount,
    failedCount,
    pulledChangesCount,
    latestCursor,
    pendingConflicts,
    remainingQueue: refreshed.queueCount,
    state: refreshed.state,
    deviceStatus,
    syncMode,
  };
}

/**
 * Starts background automatic sync listeners:
 * - On network reconnect (`online` event)
 * - On app/tab foreground (`visibilitychange`)
 * - Periodic configurable timer when `syncMode === "AUTO"`
 */
export function startAutoSyncController(opts: {
  currentUser: UasUser | null;
  enabled: boolean;
  intervalSec?: number;
  onSyncComplete?: (result: ClientSyncResult) => void;
}): () => void {
  if (typeof window === "undefined" || !opts.currentUser || !opts.enabled) {
    return () => {};
  }

  const user = opts.currentUser;
  let running = false;
  let disposed = false;

  const triggerAutoSync = async () => {
    if (disposed || running) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const tenantId = getStoredTenantId();
    const meta = await getSyncMeta(tenantId);
    if (meta.syncMode === "MANUAL") return;

    running = true;
    try {
      const res = await performManualSyncNow(user);
      if (!disposed) opts.onSyncComplete?.(res);
    } catch {
      // Silent background sync guard
    } finally {
      running = false;
    }
  };

  const handleOnline = () => {
    void triggerAutoSync();
  };
  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      void triggerAutoSync();
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  const ms = Math.max(15000, (opts.intervalSec || 60) * 1000);
  const timer = window.setInterval(() => {
    void triggerAutoSync();
  }, ms);

  return () => {
    disposed = true;
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
    window.clearInterval(timer);
  };
}

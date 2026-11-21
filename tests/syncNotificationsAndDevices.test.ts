import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prisma } from "../src/lib/prisma";
import {
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
} from "../src/lib/tenant";
import {
  listSyncConflicts,
  pullChangesSince,
  pushClientMutations,
  recordSyncChangeTx,
  resolveSyncConflict,
} from "../src/lib/sync/syncEngine";
import {
  emitNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_EVENT_TYPES,
} from "../src/lib/notifications/notificationService";
import {
  listTenantDevices,
  registerOrHeartbeatDevice,
  updateDeviceGovernance,
} from "../src/lib/devices/deviceService";
import {
  createPortableUasbakEnvelope,
  restoreFullSchemaJsonBackup,
} from "../src/lib/backupService";

const TEST_TENANT = `sync-gov-test-${Date.now().toString().slice(-6)}`;
const ACTOR = {
  userId: "u1",
  userDisplay: "مدير النظام العام (SUPER_ADMIN)",
  userRole: "SUPER_ADMIN",
};

describe("Sync Engine, Portable Backup, Notification Engine & Devices Control Plane", () => {
  after(async () => {
    await resetTenantClientsForTests();
    const dbPath = resolveTenantDbFilePath(TEST_TENANT);
    if (dbPath) {
      for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
        if (fs.existsSync(f)) {
          try {
            fs.unlinkSync(f);
          } catch {}
        }
      }
    }
  });

  it("pulls monotonic deltas, deduplicates idempotency keys, and flags & resolves CONFLICT_PENDING", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      // 1. Seed a project & locked harvest cycle
      const proj = await prisma.project.create({
        data: {
          code: "PRJ-SYNC-1",
          name: "مشروع المزامنة",
          nameAr: "مشروع المزامنة",
          nameEn: "Sync Project",
        },
      });
      await prisma.harvestCycle.create({
        data: {
          projectId: proj.id,
          name: "القطفة المغلقة",
          isLocked: true,
          lockedAt: new Date(),
        },
      });

      // 2. Push first valid mutation + duplicate retry with identical idempotencyKey
      const idemp1 = `idem-exp-${Date.now()}`;
      const push1 = await pushClientMutations({
        deviceId: "dev-win-1",
        clientCursor: 0,
        actor: ACTOR,
        mutations: [
          {
            idempotencyKey: idemp1,
            entityType: "OperatingExpense",
            operation: "CREATE",
            payload: {
              projectId: proj.id,
              harvest: "القطفة المفتوحة",
              category: "وقود/محروقات",
              qty: 2,
              unitPrice: 5000,
              date: "2026-11-20",
            },
          },
        ],
      });
      assert.equal(push1.ok, true);
      assert.equal(push1.appliedCount, 1);
      assert.equal(push1.duplicateCount, 0);
      assert.ok(push1.latestCursor >= 1);

      const retry1 = await pushClientMutations({
        deviceId: "dev-win-1",
        clientCursor: 0,
        actor: ACTOR,
        mutations: [
          {
            idempotencyKey: idemp1,
            entityType: "OperatingExpense",
            operation: "CREATE",
            payload: {
              projectId: proj.id,
              harvest: "القطفة المفتوحة",
              category: "وقود/محروقات",
              qty: 2,
              unitPrice: 5000,
              date: "2026-11-20",
            },
          },
        ],
      });
      assert.equal(retry1.appliedCount, 0);
      assert.equal(retry1.duplicateCount, 1);
      assert.equal(retry1.results[0].status, "DUPLICATE_SKIPPED");

      // 3. Monotonic pull sinceCursor = 0 returns the recorded change
      const pulled = await pullChangesSince({ sinceCursor: 0 });
      assert.ok(pulled.changes.length >= 1);
      assert.equal(pulled.changes[0].idempotencyKey, idemp1);

      // Pull from latestCursor returns 0 new changes
      const pulledEmpty = await pullChangesSince({ sinceCursor: pulled.latestCursor });
      assert.equal(pulledEmpty.changes.length, 0);

      // 4. Push mutation targeting a locked harvest cycle -> flagged as CONFLICT_PENDING
      const conflictPush = await pushClientMutations({
        deviceId: "dev-and-1",
        clientCursor: pulled.latestCursor,
        actor: ACTOR,
        mutations: [
          {
            idempotencyKey: `idem-locked-${Date.now()}`,
            entityType: "OperatingExpense",
            operation: "CREATE",
            projectId: proj.id,
            harvestName: "القطفة المغلقة",
            payload: {
              projectId: proj.id,
              harvest: "القطفة المغلقة",
              category: "وقود/محروقات",
              qty: 1,
              unitPrice: 3000,
            },
          },
        ],
      });
      assert.equal(conflictPush.conflictCount, 1);
      assert.equal(conflictPush.results[0].status, "CONFLICT_PENDING");
      const conflictId = conflictPush.results[0].conflictId!;

      const pendingConflicts = await listSyncConflicts("CONFLICT_PENDING");
      assert.ok(pendingConflicts.some((c) => c.id === conflictId));

      // 5. Resolve conflict side-by-side
      const resolved = await resolveSyncConflict({
        conflictId,
        resolution: "KEEP_SERVER",
        resolutionNotes: "Kept locked harvest period state",
        actor: ACTOR,
      });
      assert.equal(resolved.status, "RESOLVED_KEEP_SERVER");

      // 6. Verify concurrent edit detection via SyncChangeLog cursor
      await recordSyncChangeTx(prisma, {
        entityType: "Project",
        entityId: proj.id,
        operation: "UPDATE",
        payload: { nameAr: "تعديل الخادم" },
      });
      const stalePush = await pushClientMutations({
        deviceId: "dev-and-1",
        clientCursor: 0, // stale cursor behind server edit
        actor: ACTOR,
        mutations: [
          {
            idempotencyKey: `idem-stale-${Date.now()}`,
            entityType: "Project",
            entityId: proj.id,
            operation: "UPDATE",
            payload: { id: proj.id, nameAr: "تعديل قديم من الجوال" },
          },
        ],
      });
      assert.equal(stalePush.conflictCount, 1);
      assert.equal(stalePush.results[0].status, "CONFLICT_PENDING");
    });
  });

  it("emits tenant-scoped notifications across channels and updates read/unread counts", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      assert.equal(NOTIFICATION_EVENT_TYPES.length, 10);

      const n1 = await emitNotification({
        eventType: "APPROVAL_REQUIRED",
        titleAr: "اعتماد فاتورة",
        titleEn: "Bill Approval Required",
        messageAr: "يرجى اعتماد فاتورة رقم BILL-01",
        messageEn: "Please approve BILL-01",
        targetTab: "procurement",
      });
      assert.ok(n1);
      assert.equal(n1.channel, "approvals");
      assert.equal(n1.isRead, false);

      const list1 = await listNotifications({ unreadOnly: true });
      assert.ok(list1.unreadCount >= 1);

      const readOne = await markNotificationRead(n1.id);
      assert.equal(readOne?.isRead, true);

      const markedCount = await markAllNotificationsRead();
      assert.ok(markedCount >= 0);

      const listAfter = await listNotifications({ unreadOnly: true });
      assert.equal(listAfter.unreadCount, 0);
    });
  });

  it("creates and restores portable .uasbak envelopes with pre-restore safety snapshot and notification", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      const { envelope, filename } = await createPortableUasbakEnvelope({
        forcePortableV2: true,
      });
      assert.equal(envelope.format, "UAS-BACKUP-V2");
      assert.ok(filename.endsWith(".uasbak"));
      assert.equal(envelope.sha256.length, 64);

      if (envelope.format === "UAS-BACKUP-V2") {
        const res = await restoreFullSchemaJsonBackup(
          envelope.schemaBackup,
          ACTOR,
          "portable_uasbak_test",
          TEST_TENANT
        );
        assert.equal(res.ok, true);
        assert.ok(res.restoredTables.length > 0);
      }

      const notifs = await listNotifications({ channel: "security" });
      assert.ok(notifs.notifications.some((n) => n.eventType === "RESTORE_COMPLETED"));
    });
  });

  it("governs per-tenant devices: registration, policy toggle, targeted sync, suspend, and revoke (403 DEVICE_REVOKED)", async () => {
    await runWithTenant(TEST_TENANT, async () => {
      const { device } = await registerOrHeartbeatDevice({
        deviceId: "android-field-01",
        platform: "android",
        appVersion: "2.1.0",
        osVersion: "Android 14",
        deviceLabel: "Field Tablet 01",
        userId: "u1",
        userEmail: "field@al-jabri.qat.world",
        userDisplay: "المحاسب الميداني",
        ipAddress: "192.168.1.44",
        pendingQueueCount: 3,
        lastCursor: 0,
      });
      assert.equal(device.status, "ACTIVE");
      assert.equal(device.syncMode, "AUTO");

      const policyUpdated = await updateDeviceGovernance({
        deviceId: "android-field-01",
        action: "SET_SYNC_POLICY",
        syncMode: "MANUAL",
        syncIntervalSec: 120,
        actor: ACTOR,
      });
      assert.equal(policyUpdated.syncMode, "MANUAL");
      assert.equal(policyUpdated.syncIntervalSec, 120);

      const syncTriggered = await updateDeviceGovernance({
        deviceId: "android-field-01",
        action: "TRIGGER_SYNC",
        actor: ACTOR,
      });
      assert.equal(syncTriggered.pendingCommand, "SYNC_NOW");

      // Suspend -> push returns 403 DEVICE_LOCKED
      const suspended = await updateDeviceGovernance({
        deviceId: "android-field-01",
        action: "SUSPEND",
        reason: "Temporary audit review",
        actor: ACTOR,
      });
      assert.equal(suspended.status, "SUSPENDED");
      const suspendedPush = await pushClientMutations({
        deviceId: "android-field-01",
        actor: ACTOR,
        mutations: [],
      });
      assert.equal(suspendedPush.ok, false);
      assert.equal(suspendedPush.status, 403);
      assert.equal(suspendedPush.code, "DEVICE_LOCKED");

      // Re-approve
      const approved = await updateDeviceGovernance({
        deviceId: "android-field-01",
        action: "APPROVE",
        actor: ACTOR,
      });
      assert.equal(approved.status, "ACTIVE");

      // Revoke -> sets WIPE_CREDENTIALS & push returns 403 DEVICE_REVOKED
      const revoked = await updateDeviceGovernance({
        deviceId: "android-field-01",
        action: "REVOKE",
        reason: "Lost device",
        actor: ACTOR,
      });
      assert.equal(revoked.status, "REVOKED");
      assert.equal(revoked.pendingCommand, "WIPE_CREDENTIALS");

      const revokedPush = await pushClientMutations({
        deviceId: "android-field-01",
        actor: ACTOR,
        mutations: [],
      });
      assert.equal(revokedPush.ok, false);
      assert.equal(revokedPush.status, 403);
      assert.equal(revokedPush.code, "DEVICE_REVOKED");

      const { devices } = await listTenantDevices();
      assert.ok(devices.some((d) => d.deviceId === "android-field-01" && d.status === "REVOKED"));
    });
  });
});

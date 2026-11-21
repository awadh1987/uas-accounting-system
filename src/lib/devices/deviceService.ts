import { prisma } from "@/lib/prisma";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { getActiveTenantId, getTenantMetadata } from "@/lib/tenant";
import { emitNotification } from "@/lib/notifications/notificationService";
import type { DevicePlatformType, DeviceSyncMode, TenantDeviceStatus, UasTenantDevice } from "@/types/uas";

function mapTenantDevice(
  row: {
    id: string;
    deviceId: string;
    tenantSlug: string;
    platform: string;
    appVersion: string;
    osVersion: string;
    deviceLabel: string;
    userId: string | null;
    userEmail: string | null;
    userDisplay: string | null;
    lastSeenAt: Date;
    ipAddress: string | null;
    status: string;
    syncMode: string;
    syncIntervalSec: number;
    pendingQueueCount: number;
    lastCursor: number;
    lastSyncAt: Date | null;
    lastSyncError: string | null;
    pendingCommand: string | null;
    pendingCommandAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  latestCursor: number = row.lastCursor
): UasTenantDevice {
  return {
    id: row.id,
    deviceId: row.deviceId,
    tenantSlug: row.tenantSlug,
    platform: row.platform,
    appVersion: row.appVersion,
    osVersion: row.osVersion,
    deviceLabel: row.deviceLabel,
    userId: row.userId,
    userEmail: row.userEmail,
    userDisplay: row.userDisplay,
    lastSeenAt: row.lastSeenAt.toISOString(),
    ipAddress: row.ipAddress,
    status: row.status,
    syncMode: row.syncMode,
    syncIntervalSec: row.syncIntervalSec,
    pendingQueueCount: row.pendingQueueCount,
    lastCursor: row.lastCursor,
    syncLag: Math.max(0, latestCursor - row.lastCursor),
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastSyncError: row.lastSyncError,
    pendingCommand: row.pendingCommand,
    pendingCommandAt: row.pendingCommandAt ? row.pendingCommandAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getLatestSyncCursor(): Promise<number> {
  try {
    const latest = await prisma.syncChangeLog.findFirst({
      orderBy: { cursor: "desc" },
      select: { cursor: true },
    });
    return latest?.cursor ?? 0;
  } catch {
    return 0;
  }
}

export interface RegisterDeviceInput {
  deviceId: string;
  platform?: DevicePlatformType | string;
  appVersion?: string;
  osVersion?: string;
  deviceLabel?: string;
  userId?: string | null;
  userEmail?: string | null;
  userDisplay?: string | null;
  ipAddress?: string | null;
  pendingQueueCount?: number;
  lastCursor?: number;
  lastSyncError?: string | null;
  syncMode?: DeviceSyncMode;
}

export async function registerOrHeartbeatDevice(
  input: RegisterDeviceInput
): Promise<{ device: UasTenantDevice; latestCursor: number }> {
  const deviceId = input.deviceId.trim();
  if (!deviceId) {
    throw new Error("deviceId is required");
  }

  const tenantId = getActiveTenantId();
  const meta = getTenantMetadata(tenantId);
  const tenantSlug = meta?.slug || tenantId;

  const [existing, settings, latestCursor] = await Promise.all([
    prisma.tenantDevice.findUnique({ where: { deviceId } }),
    prisma.systemSettings.findUnique({ where: { id: "default" } }),
    getLatestSyncCursor(),
  ]);

  const rawPlat = String(input.platform || "web").trim().toLowerCase();
  const platform: DevicePlatformType =
    rawPlat === "android" ? "android" : rawPlat === "windows" ? "windows" : "web";

  const defaultSyncMode: DeviceSyncMode =
    settings?.defaultDeviceSyncMode === "MANUAL" ? "MANUAL" : "AUTO";
  const defaultInterval = settings?.autoSyncIntervalSec ?? 60;
  const initialStatus: TenantDeviceStatus = settings?.requireDeviceApproval
    ? "SUSPENDED"
    : "ACTIVE";

  const now = new Date();

  const saved = existing
    ? await prisma.tenantDevice.update({
        where: { deviceId },
        data: {
          tenantSlug,
          platform,
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          ...(input.osVersion !== undefined ? { osVersion: input.osVersion } : {}),
          ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
          ...(input.userEmail !== undefined ? { userEmail: input.userEmail } : {}),
          ...(input.userDisplay !== undefined ? { userDisplay: input.userDisplay } : {}),
          ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
          ...(input.pendingQueueCount !== undefined
            ? { pendingQueueCount: Math.max(0, Number(input.pendingQueueCount) || 0) }
            : {}),
          ...(input.lastCursor !== undefined
            ? { lastCursor: Math.max(0, Number(input.lastCursor) || 0) }
            : {}),
          ...(input.lastSyncError !== undefined ? { lastSyncError: input.lastSyncError } : {}),
          lastSeenAt: now,
        },
      })
    : await prisma.tenantDevice.create({
        data: {
          deviceId,
          tenantSlug,
          platform,
          appVersion: input.appVersion || "1.0.0",
          osVersion: input.osVersion || "",
          deviceLabel: input.deviceLabel || `${platform.toUpperCase()} Device`,
          userId: input.userId ?? null,
          userEmail: input.userEmail ?? null,
          userDisplay: input.userDisplay ?? null,
          ipAddress: input.ipAddress ?? null,
          status: initialStatus,
          syncMode: input.syncMode || defaultSyncMode,
          syncIntervalSec: defaultInterval,
          pendingQueueCount: Math.max(0, Number(input.pendingQueueCount) || 0),
          lastCursor: Math.max(0, Number(input.lastCursor) || 0),
          lastSeenAt: now,
        },
      });

  return {
    device: mapTenantDevice(saved, latestCursor),
    latestCursor,
  };
}

export async function listTenantDevices(): Promise<{
  devices: UasTenantDevice[];
  latestCursor: number;
}> {
  const [rows, latestCursor] = await Promise.all([
    prisma.tenantDevice.findMany({ orderBy: { lastSeenAt: "desc" } }),
    getLatestSyncCursor(),
  ]);
  return {
    devices: rows.map((r) => mapTenantDevice(r, latestCursor)),
    latestCursor,
  };
}

export type DeviceGovernanceAction =
  | "APPROVE"
  | "SUSPEND"
  | "REVOKE"
  | "TRIGGER_SYNC"
  | "FORCE_RESYNC"
  | "SET_SYNC_POLICY";

export async function updateDeviceGovernance(input: {
  deviceId: string;
  action: DeviceGovernanceAction;
  syncMode?: DeviceSyncMode;
  syncIntervalSec?: number;
  deviceLabel?: string;
  reason?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}): Promise<UasTenantDevice> {
  const existing = await prisma.tenantDevice.findUnique({
    where: { deviceId: input.deviceId },
  });
  if (!existing) {
    throw new Error("DEVICE_NOT_FOUND");
  }

  const now = new Date();
  const patch: Record<string, unknown> = {};
  let auditAction = "تحديث سياسة جهاز";
  let auditDetails = "";

  switch (input.action) {
    case "APPROVE":
      patch.status = "ACTIVE";
      patch.pendingCommand = null;
      auditAction = "اعتماد وتفعيل جهاز (Device Approved)";
      auditDetails = `تم تفعيل الجهاز ${existing.deviceLabel || existing.deviceId} (${existing.platform})`;
      break;
    case "SUSPEND":
      patch.status = "SUSPENDED";
      auditAction = "إيقاف / قفل جهاز مؤقتاً (Device Suspended)";
      auditDetails = `تم قفل الجهاز ${existing.deviceLabel || existing.deviceId} مؤقتاً${input.reason ? `: ${input.reason}` : ""}`;
      break;
    case "REVOKE":
      patch.status = "REVOKED";
      patch.pendingCommand = "WIPE_CREDENTIALS";
      patch.pendingCommandAt = now;
      auditAction = "إلغاء صلاحية جهاز نهائياً (Device Revoked)";
      auditDetails = `تم إلغاء اعتماد الجهاز ${existing.deviceLabel || existing.deviceId} وتفعيل أمر مسح الجلسة${input.reason ? `: ${input.reason}` : ""}`;
      break;
    case "TRIGGER_SYNC":
      patch.pendingCommand = "SYNC_NOW";
      patch.pendingCommandAt = now;
      auditAction = "أمر مزامنة فورية لجهاز (Targeted Sync Now)";
      auditDetails = `تم إرسال أمر مزامنة فورية للجهاز ${existing.deviceLabel || existing.deviceId}`;
      break;
    case "FORCE_RESYNC":
      patch.pendingCommand = "FORCE_FULL_RESYNC";
      patch.pendingCommandAt = now;
      patch.lastCursor = 0;
      auditAction = "إعادة مزامنة كاملة لجهاز (Force Full Re-Sync)";
      auditDetails = `تمت إعادة ضبط مؤشر المزامنة (Cursor=0) وإرسال أمر إعادة مزامنة كاملة للجهاز ${existing.deviceLabel || existing.deviceId}`;
      break;
    case "SET_SYNC_POLICY": {
      const mode: DeviceSyncMode = input.syncMode === "MANUAL" ? "MANUAL" : "AUTO";
      patch.syncMode = mode;
      if (input.syncIntervalSec !== undefined && Number.isFinite(input.syncIntervalSec)) {
        patch.syncIntervalSec = Math.min(3600, Math.max(10, Math.round(input.syncIntervalSec)));
      }
      if (input.deviceLabel) {
        patch.deviceLabel = input.deviceLabel.trim();
      }
      auditAction = "تغيير سياسة مزامنة الجهاز (Sync Policy)";
      auditDetails = `تم تعيين نمط المزامنة للجهاز ${existing.deviceLabel || existing.deviceId} إلى ${mode}`;
      break;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.tenantDevice.update({
      where: { deviceId: input.deviceId },
      data: patch,
    });

    await appendAuditLogTx(tx, {
      userId: input.actor.userId ?? null,
      userDisplay: input.actor.userDisplay,
      userRole: input.actor.userRole,
      actionType: auditAction,
      entityReference: `TenantDevice:${row.deviceId}`,
      details: auditDetails,
    });

    if (input.action === "SUSPEND" || input.action === "REVOKE") {
      await emitNotification(
        {
          eventType: "DEVICE_LOCKED",
          channel: "security",
          severity: "CRITICAL",
          titleAr:
            input.action === "REVOKE"
              ? `تم إلغاء صلاحية الجهاز (${row.deviceLabel || row.deviceId})`
              : `تم قفل الجهاز مؤقتاً (${row.deviceLabel || row.deviceId})`,
          titleEn:
            input.action === "REVOKE"
              ? `Device Revoked (${row.deviceLabel || row.deviceId})`
              : `Device Suspended (${row.deviceLabel || row.deviceId})`,
          messageAr: auditDetails,
          messageEn: `Device ${row.deviceId} (${row.platform}) status changed to ${row.status}.`,
          targetTab: "system",
          targetEntityType: "TenantDevice",
          targetEntityId: row.deviceId,
          recipientUserId: row.userId ?? null,
          actorUserId: input.actor.userId ?? null,
          metadata: { deviceId: row.deviceId, status: row.status, platform: row.platform },
        },
        tx
      );
    }

    return row;
  });

  const latestCursor = await getLatestSyncCursor();
  return mapTenantDevice(updated, latestCursor);
}

export async function removeTenantDevice(
  deviceId: string,
  actor: { userId?: string | null; userDisplay: string; userRole: string }
): Promise<boolean> {
  const existing = await prisma.tenantDevice.findUnique({ where: { deviceId } });
  if (!existing) return false;

  await prisma.$transaction(async (tx) => {
    await tx.tenantDevice.delete({ where: { deviceId } });
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "حذف سجل جهاز من وحدة التحكم",
      entityReference: `TenantDevice:${deviceId}`,
      details: `تم حذف الجهاز ${existing.deviceLabel || deviceId} (${existing.platform})`,
    });
  });

  return true;
}

export async function checkDeviceAccessStatus(deviceId: string): Promise<{
  exists: boolean;
  status: string;
  syncMode: string;
  pendingCommand: string | null;
}> {
  const row = await prisma.tenantDevice.findUnique({
    where: { deviceId },
    select: { status: true, syncMode: true, pendingCommand: true },
  });
  if (!row) {
    return { exists: false, status: "ACTIVE", syncMode: "AUTO", pendingCommand: null };
  }
  return {
    exists: true,
    status: row.status,
    syncMode: row.syncMode,
    pendingCommand: row.pendingCommand,
  };
}

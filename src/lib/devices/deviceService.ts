import { prisma } from "@/lib/prisma";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { getActiveTenantId, getTenantMetadata } from "@/lib/tenant";
import { emitNotification } from "@/lib/notifications/notificationService";
import {
  clearDeviceSessionRevocation,
  recordDeviceSessionRevocation,
} from "@/lib/controlPanel/governanceStore";
import { isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { loadInstalledLicense } from "@/lib/licensing/verifier";
import type {
  DevicePlatformType,
  DeviceSyncMode,
  TenantDeviceStatus,
  UasTenantDevice,
} from "@/types/uas";

const ensuredDeviceColumnTenants = new Set<string>();

export async function ensureTenantDeviceColumns(): Promise<void> {
  const tenantId = getActiveTenantId();
  const dbKey = `${process.env.DATABASE_URL || (isSqliteRuntime() ? "sqlite" : "pg")}:${tenantId}`;
  if (ensuredDeviceColumnTenants.has(dbKey)) return;
  try {
    if (isSqliteRuntime()) {
      const cols = await prisma.$queryRawUnsafe<Array<{ name?: string }>>(
        `PRAGMA table_info("TenantDevice")`
      );
      if (
        Array.isArray(cols) &&
        cols.length > 0 &&
        !cols.some((c) => c.name === "activationKey")
      ) {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "TenantDevice" ADD COLUMN "activationKey" TEXT`
        );
      }
    } else {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "TenantDevice" ADD COLUMN IF NOT EXISTS "activationKey" TEXT`
      );
    }
  } catch {
    // Non-fatal if running against restricted permissions or test harness without raw SQL
  } finally {
    ensuredDeviceColumnTenants.add(dbKey);
  }
}

export function sanitizeActivationKey(raw?: string | null): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("UASKEY-")) {
    try {
      const withoutPrefix = trimmed.slice("UASKEY-".length);
      const dotIdx = withoutPrefix.indexOf(".");
      const b64 = dotIdx >= 0 ? withoutPrefix.slice(0, dotIdx) : withoutPrefix;
      const parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as {
        license_id?: string;
      };
      if (parsed && typeof parsed.license_id === "string" && parsed.license_id.trim()) {
        return sanitizeActivationKey(parsed.license_id);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { license_id?: string };
      if (parsed && typeof parsed.license_id === "string" && parsed.license_id.trim()) {
        return sanitizeActivationKey(parsed.license_id);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (trimmed.length > 64 || /\s/.test(trimmed)) {
    return null;
  }
  return /^UAS-/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

export function maskActivationKey(key?: string | null): string | null {
  const clean = sanitizeActivationKey(key);
  if (!clean) return null;
  const parts = clean.split("-");
  if (parts.length >= 3) {
    const mid = parts
      .slice(1, -1)
      .map((p) => "•".repeat(Math.max(2, Math.min(4, p.length))));
    return `${parts[0]}-${mid.join("-")}-${parts[parts.length - 1]}`;
  }
  if (clean.length <= 6) {
    return `${clean.slice(0, 2)}•••`;
  }
  return `${clean.slice(0, 3)}••••${clean.slice(-3)}`;
}

interface WorkspaceActivationContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  workspaceLicenseKey: string | null;
}

export function resolveWorkspaceActivationInfo(tenantIdOverride?: string): WorkspaceActivationContext {
  const tenantId = tenantIdOverride || getActiveTenantId();
  const meta = getTenantMetadata(tenantId);
  const tenantSlug = meta?.slug || tenantId;
  const tenantName =
    meta?.nameAr ||
    meta?.companyName ||
    meta?.nameEn ||
    (tenantSlug === "default" ? "الشركة الأم (Root)" : tenantSlug);

  let workspaceLicenseKey = sanitizeActivationKey(meta?.licenseId);
  if (!workspaceLicenseKey) {
    try {
      const installed = loadInstalledLicense(tenantId);
      workspaceLicenseKey = sanitizeActivationKey(installed?.license?.license_id);
    } catch {
      workspaceLicenseKey = null;
    }
  }

  return {
    tenantId,
    tenantSlug,
    tenantName,
    workspaceLicenseKey,
  };
}

interface TenantDeviceRowLike {
  id: string;
  deviceId: string;
  tenantSlug: string;
  activationKey?: string | null;
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
}

function mapTenantDevice(
  row: TenantDeviceRowLike,
  latestCursor: number = row.lastCursor,
  opts?: { ctx?: WorkspaceActivationContext; seatBound?: boolean }
): UasTenantDevice {
  const ctx = opts?.ctx ?? resolveWorkspaceActivationInfo();
  const storedKey = sanitizeActivationKey(row.activationKey);
  const effectiveKey = storedKey ?? ctx.workspaceLicenseKey ?? null;
  const tenantSlug = (row.tenantSlug || "").trim() || ctx.tenantSlug;
  const tenantMeta = getTenantMetadata(tenantSlug);
  const tenantName =
    tenantMeta?.nameAr ||
    tenantMeta?.companyName ||
    tenantMeta?.nameEn ||
    (tenantSlug === ctx.tenantSlug ? ctx.tenantName : tenantSlug);
  const syncPolicy: DeviceSyncMode = row.syncMode === "MANUAL" ? "MANUAL" : "AUTO";
  const tenantMismatch = Boolean(tenantSlug && ctx.tenantSlug && tenantSlug !== ctx.tenantSlug);
  const keyMismatch = Boolean(
    ctx.workspaceLicenseKey && storedKey && storedKey !== ctx.workspaceLicenseKey
  );

  return {
    id: row.id,
    deviceId: row.deviceId,
    tenantSlug,
    tenantName,
    activationKey: effectiveKey,
    licenseKey: effectiveKey,
    maskedActivationKey: maskActivationKey(effectiveKey),
    platform: row.platform,
    clientPlatform: row.platform,
    appVersion: row.appVersion,
    osVersion: row.osVersion,
    deviceLabel: row.deviceLabel,
    userId: row.userId,
    userName: row.userDisplay || row.userEmail || row.userId || null,
    userEmail: row.userEmail,
    userDisplay: row.userDisplay,
    lastSeenAt: row.lastSeenAt.toISOString(),
    ipAddress: row.ipAddress,
    status: row.status,
    syncMode: row.syncMode,
    syncPolicy,
    syncIntervalSec: row.syncIntervalSec,
    pendingQueueCount: row.pendingQueueCount,
    queueCount: row.pendingQueueCount,
    lastCursor: row.lastCursor,
    syncLag: Math.max(0, latestCursor - row.lastCursor),
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastSyncError: row.lastSyncError,
    pendingCommand: row.pendingCommand,
    pendingCommandAt: row.pendingCommandAt ? row.pendingCommandAt.toISOString() : null,
    seatBound: opts?.seatBound,
    tenantMismatch,
    keyMismatch,
    workspaceTenantSlug: ctx.tenantSlug,
    workspaceLicenseKey: ctx.workspaceLicenseKey,
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
  activationKey?: string | null;
  licenseKey?: string | null;
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

  await ensureTenantDeviceColumns();
  const ctx = resolveWorkspaceActivationInfo();

  const [existing, settings, latestCursor] = await Promise.all([
    prisma.tenantDevice.findUnique({ where: { deviceId } }),
    prisma.systemSettings.findUnique({ where: { id: "default" } }),
    getLatestSyncCursor(),
  ]);

  const rawPlat = String(input.platform || "web").trim().toLowerCase();
  const platform: DevicePlatformType =
  rawPlat === "android"
    ? "android"
    : rawPlat === "windows"
      ? "windows"
      : rawPlat === "ios"
        ? "ios"
        : "web";

  const incomingKey = sanitizeActivationKey(input.activationKey || input.licenseKey);
  const resolvedActivationKey =
    incomingKey ?? sanitizeActivationKey(existing?.activationKey) ?? ctx.workspaceLicenseKey ?? null;

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
        tenantSlug: ctx.tenantSlug,
        ...(incomingKey || (!existing.activationKey && resolvedActivationKey)
          ? { activationKey: resolvedActivationKey }
          : {}),
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
        tenantSlug: ctx.tenantSlug,
        activationKey: resolvedActivationKey,
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
    device: mapTenantDevice(saved, latestCursor, { ctx }),
    latestCursor,
  };
}

export async function listTenantDevices(): Promise<{
  devices: UasTenantDevice[];
  latestCursor: number;
  activeTenantSlug: string;
  activeTenantName: string;
  workspaceLicenseKey: string | null;
}> {
    await ensureTenantDeviceColumns();
  const ctx = resolveWorkspaceActivationInfo();

  const [rows, latestCursor, activeBindings] = await Promise.all([
    prisma.tenantDevice.findMany({
      where: { tenantSlug: ctx.tenantSlug },
      orderBy: { lastSeenAt: "desc" },
    }),
    getLatestSyncCursor(),
    prisma.licenseDeviceBinding
      .findMany({
        where: { active: true },
        select: { hwid: true, userEmail: true, platform: true },
      })
      .catch(() => [] as Array<{ hwid: string; userEmail: string; platform: string }>),
  ]);

  return {
    devices: rows.map((r) => {
      const normEmail = (r.userEmail || "").trim().toLowerCase();
      const seatBound = activeBindings.some(
        (b) =>
          b.hwid === r.deviceId ||
          (Boolean(normEmail) &&
            b.userEmail === normEmail &&
            (r.platform === "windows" || r.platform === "android") &&
            b.platform === r.platform)
      );
      return mapTenantDevice(r, latestCursor, { ctx, seatBound });
    }),
    latestCursor,
    activeTenantSlug: ctx.tenantSlug,
    activeTenantName: ctx.tenantName,
    workspaceLicenseKey: ctx.workspaceLicenseKey,
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
  await ensureTenantDeviceColumns();
  const ctx = resolveWorkspaceActivationInfo();
  const existing = await prisma.tenantDevice.findUnique({
    where: { deviceId: input.deviceId },
  });
  if (!existing) {
    throw new Error("DEVICE_NOT_FOUND");
  }
  if (existing.tenantSlug && existing.tenantSlug !== ctx.tenantSlug) {
    throw new Error("FORBIDDEN_CROSS_TENANT");
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

    if (input.action === "REVOKE") {
      try {
        const orClauses: Array<Record<string, unknown>> = [{ hwid: existing.deviceId }];
        const normEmail = (existing.userEmail || "").trim().toLowerCase();
        const platKey =
          existing.platform === "windows"
            ? "windows"
            : existing.platform === "android"
              ? "android"
              : null;
        if (normEmail && platKey) {
          orClauses.push({ userEmail: normEmail, platform: platKey });
        }
        const released = await tx.licenseDeviceBinding.updateMany({
          where: { active: true, OR: orClauses },
          data: { active: false },
        });
        if (released.count > 0) {
          auditDetails += ` وتحرير ${released.count} مقعد ترخيص نشط`;
        }
      } catch {
        // Ignore if LicenseDeviceBinding is unavailable in minimal test DB
      }
    }

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
          metadata: {
            deviceId: row.deviceId,
            tenantSlug: row.tenantSlug,
            status: row.status,
            platform: row.platform,
          },
        },
        tx
      );
    }

    return row;
  });

  if (input.action === "REVOKE") {
    recordDeviceSessionRevocation(ctx.tenantId, existing.deviceId, {
      reason: input.reason,
      updatedBy: input.actor.userDisplay,
    });
  } else if (input.action === "APPROVE") {
    clearDeviceSessionRevocation(ctx.tenantId, existing.deviceId);
  }

  const latestCursor = await getLatestSyncCursor();
  return mapTenantDevice(updated, latestCursor, { ctx });
}

export async function removeTenantDevice(
  deviceId: string,
  actor: { userId?: string | null; userDisplay: string; userRole: string }
): Promise<boolean> {
  await ensureTenantDeviceColumns();
  const ctx = resolveWorkspaceActivationInfo();
  const existing = await prisma.tenantDevice.findUnique({ where: { deviceId } });
  if (!existing) return false;
  if (existing.tenantSlug && existing.tenantSlug !== ctx.tenantSlug) {
    throw new Error("FORBIDDEN_CROSS_TENANT");
  }

  await prisma.$transaction(async (tx) => {
    let releasedSeats = 0;
    try {
      const orClauses: Array<Record<string, unknown>> = [{ hwid: existing.deviceId }];
      const normEmail = (existing.userEmail || "").trim().toLowerCase();
      const platKey =
        existing.platform === "windows"
          ? "windows"
          : existing.platform === "android"
            ? "android"
            : null;
      if (normEmail && platKey) {
        orClauses.push({ userEmail: normEmail, platform: platKey });
      }
      const released = await tx.licenseDeviceBinding.updateMany({
        where: { active: true, OR: orClauses },
        data: { active: false },
      });
      releasedSeats = released.count;
    } catch {
      // Ignore if LicenseDeviceBinding is unavailable
    }

    await tx.tenantDevice.delete({ where: { deviceId } });
    await appendAuditLogTx(tx, {
      userId: actor.userId ?? null,
      userDisplay: actor.userDisplay,
      userRole: actor.userRole,
      actionType: "حذف سجل جهاز من وحدة التحكم",
      entityReference: `TenantDevice:${deviceId}`,
      details: `تم حذف الجهاز ${existing.deviceLabel || deviceId} (${existing.platform})${releasedSeats > 0 ? ` وتحرير ${releasedSeats} مقعد ترخيص` : ""
        }`,
    });
  });

  recordDeviceSessionRevocation(ctx.tenantId, deviceId, {
    reason: "Device deleted from control plane",
    updatedBy: actor.userDisplay,
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

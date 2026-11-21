import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  NotificationChannelId,
  NotificationEventType,
  NotificationSeverity,
  TabId,
  UasNotificationEvent,
} from "@/types/uas";

type Db = Prisma.TransactionClient | typeof prisma;

export const NOTIFICATION_EVENT_TYPES: NotificationEventType[] = [
  "JOURNAL_POSTED",
  "APPROVAL_REQUIRED",
  "LOW_STOCK",
  "SYNC_COMPLETED",
  "SYNC_CONFLICT",
  "BACKUP_COMPLETED",
  "RESTORE_COMPLETED",
  "DEVICE_LOCKED",
  "PASSWORD_RESET",
  "SYSTEM_ALERT",
];

export function resolveChannelForEvent(eventType: NotificationEventType): NotificationChannelId {
  switch (eventType) {
    case "APPROVAL_REQUIRED":
      return "approvals";
    case "SYNC_COMPLETED":
    case "SYNC_CONFLICT":
      return "sync";
    case "DEVICE_LOCKED":
    case "PASSWORD_RESET":
      return "security";
    default:
      return "general";
  }
}

export function resolveDefaultSeverityForEvent(eventType: NotificationEventType): NotificationSeverity {
  switch (eventType) {
    case "SYNC_CONFLICT":
    case "DEVICE_LOCKED":
      return "CRITICAL";
    case "APPROVAL_REQUIRED":
    case "LOW_STOCK":
    case "PASSWORD_RESET":
      return "WARNING";
    case "JOURNAL_POSTED":
    case "SYNC_COMPLETED":
    case "BACKUP_COMPLETED":
    case "RESTORE_COMPLETED":
      return "SUCCESS";
    default:
      return "INFO";
  }
}

export interface EmitNotificationInput {
  eventType: NotificationEventType;
  channel?: NotificationChannelId;
  severity?: NotificationSeverity;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  targetTab?: TabId | string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  recipientUserId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

function mapNotificationRow(row: {
  id: string;
  eventType: string;
  channel: string;
  severity: string;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  targetTab: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  recipientUserId: string | null;
  actorUserId: string | null;
  isRead: boolean;
  readAt: Date | null;
  metadataJson: string;
  createdAt: Date;
}): UasNotificationEvent {
  let metadata: Record<string, unknown> = {};
  try {
    if (row.metadataJson) {
      const parsed = JSON.parse(row.metadataJson);
      if (parsed && typeof parsed === "object") metadata = parsed;
    }
  } catch {
    metadata = {};
  }

  return {
    id: row.id,
    eventType: row.eventType,
    channel: row.channel,
    severity: row.severity,
    titleAr: row.titleAr,
    titleEn: row.titleEn,
    messageAr: row.messageAr,
    messageEn: row.messageEn,
    targetTab: row.targetTab,
    targetEntityType: row.targetEntityType,
    targetEntityId: row.targetEntityId,
    recipientUserId: row.recipientUserId,
    actorUserId: row.actorUserId,
    isRead: row.isRead,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Emits a structured tenant-scoped notification event into `NotificationEvent`.
 * Non-fatal if invoked inside an unmigrated SQLite test snapshot.
 */
export async function emitNotification(
  input: EmitNotificationInput,
  client: Db = prisma
): Promise<UasNotificationEvent | null> {
  try {
    const channel = input.channel || resolveChannelForEvent(input.eventType);
    const severity = input.severity || resolveDefaultSeverityForEvent(input.eventType);
    const row = await client.notificationEvent.create({
      data: {
        eventType: input.eventType,
        channel,
        severity,
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        messageAr: input.messageAr,
        messageEn: input.messageEn,
        targetTab: input.targetTab ?? null,
        targetEntityType: input.targetEntityType ?? null,
        targetEntityId: input.targetEntityId ?? null,
        recipientUserId: input.recipientUserId ?? null,
        actorUserId: input.actorUserId ?? null,
        metadataJson: JSON.stringify(input.metadata ?? {}),
      },
    });
    return mapNotificationRow(row);
  } catch (err) {
    console.warn("[NotificationService] Non-fatal notice emitting notification:", err);
    return null;
  }
}

export async function listNotifications(
  filters: {
    unreadOnly?: boolean;
    channel?: string;
    severity?: string;
    recipientUserId?: string;
    limit?: number;
  } = {},
  client: Db = prisma
): Promise<{ notifications: UasNotificationEvent[]; unreadCount: number }> {
  const where: Prisma.NotificationEventWhereInput = {};
  if (filters.unreadOnly) where.isRead = false;
  if (filters.channel && filters.channel !== "ALL") where.channel = filters.channel;
  if (filters.severity && filters.severity !== "ALL") where.severity = filters.severity.toUpperCase();
  if (filters.recipientUserId) {
    where.OR = [{ recipientUserId: null }, { recipientUserId: filters.recipientUserId }];
  }

  const limit = Math.min(200, Math.max(1, Number(filters.limit || 50)));

  const [rows, unreadCount] = await Promise.all([
    client.notificationEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    client.notificationEvent.count({
      where: {
        isRead: false,
        ...(filters.recipientUserId
          ? { OR: [{ recipientUserId: null }, { recipientUserId: filters.recipientUserId }] }
          : {}),
      },
    }),
  ]);

  return {
    notifications: rows.map(mapNotificationRow),
    unreadCount,
  };
}

export async function markNotificationRead(
  id: string,
  client: Db = prisma
): Promise<UasNotificationEvent | null> {
  const existing = await client.notificationEvent.findUnique({ where: { id } });
  if (!existing) return null;
  const updated = await client.notificationEvent.update({
    where: { id },
    data: { isRead: true, readAt: existing.readAt ?? new Date() },
  });
  return mapNotificationRow(updated);
}

export async function markAllNotificationsRead(
  recipientUserId?: string,
  client: Db = prisma
): Promise<number> {
  const where: Prisma.NotificationEventWhereInput = { isRead: false };
  if (recipientUserId) {
    where.OR = [{ recipientUserId: null }, { recipientUserId }];
  }
  const res = await client.notificationEvent.updateMany({
    where,
    data: { isRead: true, readAt: new Date() },
  });
  return res.count;
}

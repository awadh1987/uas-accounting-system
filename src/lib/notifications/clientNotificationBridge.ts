"use client";

import type { UasNotificationEvent } from "@/types/uas";

const OFFLINE_NOTIF_QUEUE_KEY = "uas_offline_notification_queue";

export interface QueuedLocalNotification {
  id: string;
  channel: string;
  title: string;
  body: string;
  severity: string;
  targetTab?: string | null;
  createdAt: string;
}

function getAndroidBridge(): Record<string, (...args: unknown[]) => unknown> | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as { UasAndroidNative?: Record<string, (...args: unknown[]) => unknown> };
  return win.UasAndroidNative || null;
}

/**
 * Ensures Android 13+ (API 33) POST_NOTIFICATIONS permission & notification channels
 * (`approvals`, `sync`, `security`, `general`) are registered.
 */
export async function ensureNotificationChannelsAndPermission(): Promise<{
  granted: boolean;
  platform: "android" | "web";
}> {
  const bridge = getAndroidBridge();
  if (bridge) {
    try {
      if (typeof bridge.registerNotificationChannels === "function") {
        bridge.registerNotificationChannels();
      }
      if (typeof bridge.checkNotificationPermission === "function") {
        const already = Boolean(bridge.checkNotificationPermission());
        if (already) return { granted: true, platform: "android" };
      }
      if (typeof bridge.requestNotificationPermission === "function") {
        const granted = Boolean(bridge.requestNotificationPermission());
        return { granted, platform: "android" };
      }
      return { granted: true, platform: "android" };
    } catch {
      return { granted: false, platform: "android" };
    }
  }

  if (typeof window !== "undefined" && "Notification" in window) {
    if (Notification.permission === "granted") {
      return { granted: true, platform: "web" };
    }
    if (Notification.permission === "default") {
      try {
        const res = await Notification.requestPermission();
        return { granted: res === "granted", platform: "web" };
      } catch {
        return { granted: false, platform: "web" };
      }
    }
    return { granted: false, platform: "web" };
  }

  return { granted: false, platform: "web" };
}

export function loadOfflineNotificationQueue(): QueuedLocalNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_NOTIF_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function queueOfflineNotification(item: Omit<QueuedLocalNotification, "createdAt">): void {
  if (typeof window === "undefined") return;
  try {
    const list = loadOfflineNotificationQueue();
    if (list.some((x) => x.id === item.id)) return;
    list.push({ ...item, createdAt: new Date().toISOString() });
    window.localStorage.setItem(OFFLINE_NOTIF_QUEUE_KEY, JSON.stringify(list.slice(-100)));
  } catch {
    // Ignore quota errors
  }
}

export function deliverNotificationLocally(
  notif: UasNotificationEvent,
  lang: "ar" | "en" = "ar"
): boolean {
  const title = lang === "ar" ? notif.titleAr : notif.titleEn;
  const body = lang === "ar" ? notif.messageAr : notif.messageEn;
  const bridge = getAndroidBridge();

  if (bridge && typeof bridge.showLocalNotification === "function") {
    try {
      const ok = Boolean(bridge.showLocalNotification(notif.channel || "general", title, body));
      if (ok) return true;
    } catch {
      // Fall through
    }
  }

  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: notif.id });
      return true;
    } catch {
      // Fall through
    }
  }

  queueOfflineNotification({
    id: notif.id,
    channel: notif.channel || "general",
    title,
    body,
    severity: notif.severity,
    targetTab: notif.targetTab ?? null,
  });
  return false;
}

export function flushQueuedNotifications(): number {
  const list = loadOfflineNotificationQueue();
  if (list.length === 0) return 0;

  const bridge = getAndroidBridge();
  const canWebNotify =
    typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";

  if (!bridge && !canWebNotify) return 0;

  let delivered = 0;
  const remaining: QueuedLocalNotification[] = [];

  for (const item of list) {
    let sent = false;
    if (bridge && typeof bridge.showLocalNotification === "function") {
      try {
        sent = Boolean(bridge.showLocalNotification(item.channel || "general", item.title, item.body));
      } catch {
        sent = false;
      }
    } else if (canWebNotify) {
      try {
        new Notification(item.title, { body: item.body, tag: item.id });
        sent = true;
      } catch {
        sent = false;
      }
    }
    if (sent) delivered++;
    else remaining.push(item);
  }

  if (typeof window !== "undefined") {
    try {
      if (remaining.length === 0) {
        window.localStorage.removeItem(OFFLINE_NOTIF_QUEUE_KEY);
      } else {
        window.localStorage.setItem(OFFLINE_NOTIF_QUEUE_KEY, JSON.stringify(remaining));
      }
    } catch {}
  }

  return delivered;
}

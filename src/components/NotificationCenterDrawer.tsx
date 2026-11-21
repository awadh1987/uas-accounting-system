"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  Info,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { safeFetchJson } from "@/lib/apiClient";
import {
  ensureNotificationChannelsAndPermission,
  flushQueuedNotifications,
  loadOfflineNotificationQueue,
} from "@/lib/notifications/clientNotificationBridge";
import type { LanguageCode, TabId, UasNotificationEvent, UasUser } from "@/types/uas";

interface NotificationCenterDrawerProps {
  open: boolean;
  onClose: () => void;
  lang: LanguageCode;
  currentUser: UasUser;
  onUnreadCountChange?: (count: number) => void;
  onNavigateTab: (tab: TabId) => void;
  onToast: (msg: string) => void;
}

export function NotificationCenterDrawer({
  open,
  onClose,
  lang,
  currentUser,
  onUnreadCountChange,
  onNavigateTab,
  onToast,
}: NotificationCenterDrawerProps) {
  const isAr = lang === "ar";
  const [notifications, setNotifications] = useState<UasNotificationEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [offlineQueuedCount, setOfflineQueuedCount] = useState(0);

  const refreshNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("userId", currentUser.id);
      if (severityFilter !== "ALL") qs.set("severity", severityFilter);
      if (channelFilter !== "ALL") qs.set("channel", channelFilter);

      const res = await safeFetchJson<{
        success?: boolean;
        notifications?: UasNotificationEvent[];
        unreadCount?: number;
      }>(`/api/notifications?${qs.toString()}`, { cache: "no-store" });

      if (res.ok && res.data) {
        const list = res.data.notifications || [];
        const unread = res.data.unreadCount ?? list.filter((n) => !n.isRead).length;
        setNotifications(list);
        setUnreadCount(unread);
        onUnreadCountChange?.(unread);
      }
      setOfflineQueuedCount(loadOfflineNotificationQueue().length);
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, severityFilter, channelFilter, onUnreadCountChange]);

  useEffect(() => {
    if (open) {
      void refreshNotifications();
    }
  }, [open, refreshNotifications]);

  async function handleMarkRead(notif: UasNotificationEvent) {
    if (!notif.isRead) {
      const res = await safeFetchJson<{ success?: boolean }>(
        `/api/notifications/${encodeURIComponent(notif.id)}/read`,
        { method: "POST" }
      );
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n))
        );
        const nextUnread = Math.max(0, unreadCount - 1);
        setUnreadCount(nextUnread);
        onUnreadCountChange?.(nextUnread);
      }
    }
    if (notif.targetTab) {
      onNavigateTab(notif.targetTab as TabId);
      onClose();
    }
  }

  async function handleMarkAllRead() {
    const res = await safeFetchJson<{ success?: boolean }>("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read", userId: currentUser.id }),
    });
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      onUnreadCountChange?.(0);
      onToast(isAr ? "تم تحديد جميع الإشعارات كمقروءة" : "All notifications marked as read");
    }
  }

  async function handleEnableNativeNotifications() {
    const res = await ensureNotificationChannelsAndPermission();
    const flushed = flushQueuedNotifications();
    setOfflineQueuedCount(loadOfflineNotificationQueue().length);
    if (res.granted) {
      onToast(
        isAr
          ? `✅ تم تفعيل قنوات الإشعارات بنجاح${flushed > 0 ? ` وتسليم ${flushed} إشعار معلق` : ""}`
          : `✅ Notification channels enabled${flushed > 0 ? ` (${flushed} queued delivered)` : ""}`
      );
    } else {
      onToast(
        isAr
          ? "⚠️ يرجى السماح بصلاحية الإشعارات من إعدادات المتصفح أو الهاتف"
          : "⚠️ Please allow notification permission in device or browser settings"
      );
    }
  }

  function renderSeverityIcon(severity: string) {
    if (severity === "CRITICAL") return <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />;
    if (severity === "WARNING") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
    if (severity === "SUCCESS") return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
    return <Info className="w-4 h-4 text-sky-600 shrink-0" />;
  }

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      title={isAr ? `مركز الإشعارات والتنبيهات (${unreadCount})` : `Notification Center (${unreadCount})`}
    >
      <div className="space-y-4 text-xs">
        {/* Controls & Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleEnableNativeNotifications()}
              className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>{isAr ? "تفعيل إشعارات الجهاز" : "Enable Alerts"}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 font-bold inline-flex items-center gap-1"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>{isAr ? "قراءة الكل" : "Mark All Read"}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void refreshNotifications()}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700"
            title={isAr ? "تحديث" : "Refresh"}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {offlineQueuedCount > 0 && (
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 flex items-center justify-between">
            <span>
              {isAr
                ? `يوجد ${offlineQueuedCount} إشعار محفوظ محلياً بانتظار التسليم.`
                : `${offlineQueuedCount} offline notification(s) queued for delivery.`}
            </span>
            <button
              type="button"
              onClick={() => {
                const count = flushQueuedNotifications();
                setOfflineQueuedCount(loadOfflineNotificationQueue().length);
                onToast(isAr ? `تم تسليم ${count} إشعار` : `Delivered ${count} notification(s)`);
              }}
              className="px-2 py-1 rounded-lg bg-amber-600 text-white font-bold text-[10px]"
            >
              {isAr ? "تسليم الآن" : "Flush"}
            </button>
          </div>
        )}

        {/* Channel & Severity Filter Pills */}
        <div className="grid grid-cols-2 gap-2">
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-bold"
          >
            <option value="ALL">{isAr ? "كل القنوات" : "All Channels"}</option>
            <option value="approvals">{isAr ? "الاعتمادات (Approvals)" : "Approvals"}</option>
            <option value="sync">{isAr ? "المزامنة (Sync)" : "Sync"}</option>
            <option value="security">{isAr ? "الأمان والأجهزة (Security)" : "Security"}</option>
            <option value="general">{isAr ? "المحاسبة العامة (General)" : "General"}</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-bold"
          >
            <option value="ALL">{isAr ? "كل المستويات" : "All Severities"}</option>
            <option value="CRITICAL">{isAr ? "حرج (Critical)" : "Critical"}</option>
            <option value="WARNING">{isAr ? "تحذير (Warning)" : "Warning"}</option>
            <option value="SUCCESS">{isAr ? "نجاح (Success)" : "Success"}</option>
            <option value="INFO">{isAr ? "معلومة (Info)" : "Info"}</option>
          </select>
        </div>

        {/* Notifications List */}
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <Bell className="w-8 h-8 mx-auto opacity-40" />
            <div>{isAr ? "لا توجد إشعارات مطابقة حالياً" : "No matching notifications"}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => void handleMarkRead(n)}
                className={`p-3.5 rounded-2xl border cursor-pointer transition space-y-1.5 ${
                  n.isRead
                    ? "border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 opacity-80"
                    : "border-emerald-400/70 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-xs"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-black">
                    {renderSeverityIcon(n.severity)}
                    <span>{isAr ? n.titleAr : n.titleEn}</span>
                    {!n.isRead && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {n.channel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  {isAr ? n.messageAr : n.messageEn}
                </p>
                <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                  <span className="font-mono">{n.createdAt.slice(0, 19).replace("T", " ")}</span>
                  {n.targetTab && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold">
                      <span>{isAr ? "فتح القسم" : "Open"}</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SlideOverDrawer>
  );
}

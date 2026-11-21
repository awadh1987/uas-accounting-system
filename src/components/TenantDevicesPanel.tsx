"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Laptop,
  Lock,
  Monitor,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { safeFetchJson } from "@/lib/apiClient";
import type { UasTenantDevice, UasUser } from "@/types/uas";

interface TenantDevicesPanelProps {
  lang: "ar" | "en";
  currentUser: UasUser;
  readOnly?: boolean;
  onToast: (msg: string) => void;
}

export function TenantDevicesPanel({
  lang,
  currentUser,
  readOnly = false,
  onToast,
}: TenantDevicesPanelProps) {
  const isAr = lang === "ar";
  const [devices, setDevices] = useState<UasTenantDevice[]>([]);
  const [latestCursor, setLatestCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        devices?: UasTenantDevice[];
        latestCursor?: number;
      }>("/api/devices", { cache: "no-store" });
      if (res.ok && res.data?.devices) {
        setDevices(res.data.devices);
        setLatestCursor(res.data.latestCursor ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  async function runGovernanceAction(
    device: UasTenantDevice,
    action: "APPROVE" | "SUSPEND" | "REVOKE" | "TRIGGER_SYNC" | "FORCE_RESYNC" | "SET_SYNC_POLICY",
    extra?: Record<string, unknown>
  ) {
    if (readOnly) return;
    if (action === "REVOKE" && typeof window !== "undefined") {
      const ok = window.confirm(
        isAr
          ? `هل تريد إلغاء صلاحية الجهاز "${device.deviceLabel || device.deviceId}" نهائياً ومسح بيانات الجلسة فيه؟`
          : `Revoke device "${device.deviceLabel || device.deviceId}" and wipe its session credentials?`
      );
      if (!ok) return;
    }

    setBusyDeviceId(device.deviceId);
    try {
      const res = await safeFetchJson<{ success?: boolean; device?: UasTenantDevice; error?: string }>(
        `/api/devices/${encodeURIComponent(device.deviceId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-uas-user-id": currentUser.id,
            "x-uas-role": String(currentUser.role),
            "x-uas-user-display": `${currentUser.name} (${currentUser.role})`,
          },
          body: JSON.stringify({
            action,
            ...extra,
            actor: {
              userId: currentUser.id,
              userDisplay: `${currentUser.name} (${currentUser.role})`,
              userRole: currentUser.role,
            },
          }),
        }
      );
      if (!res.ok || !res.data?.success) {
        onToast(res.data?.error || (isAr ? "تعذر تنفيذ إجراء الجهاز" : "Device action failed"));
        return;
      }
      onToast(
        isAr ? `✅ تم تنفيذ الإجراء (${action}) بنجاح` : `✅ Device action (${action}) applied`
      );
      await loadDevices();
    } finally {
      setBusyDeviceId(null);
    }
  }

  async function handleDeleteDevice(device: UasTenantDevice) {
    if (readOnly) return;
    setBusyDeviceId(device.deviceId);
    try {
      const res = await safeFetchJson<{ success?: boolean; error?: string }>(
        `/api/devices/${encodeURIComponent(device.deviceId)}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-uas-user-id": currentUser.id,
            "x-uas-role": String(currentUser.role),
            "x-uas-user-display": `${currentUser.name} (${currentUser.role})`,
          },
          body: JSON.stringify({
            actor: {
              userId: currentUser.id,
              userDisplay: `${currentUser.name} (${currentUser.role})`,
              userRole: currentUser.role,
            },
          }),
        }
      );
      if (res.ok && res.data?.success) {
        onToast(isAr ? "تم إزالة سجل الجهاز" : "Device record removed");
        await loadDevices();
      } else {
        onToast(res.data?.error || "Failed to delete device");
      }
    } finally {
      setBusyDeviceId(null);
    }
  }

  function renderPlatformIcon(platform: string) {
    if (platform === "android") return <Smartphone className="w-4 h-4 text-emerald-600" />;
    if (platform === "windows") return <Monitor className="w-4 h-4 text-indigo-600" />;
    return <Laptop className="w-4 h-4 text-sky-600" />;
  }

  return (
    <div className="space-y-4 text-xs">
      <div className="card-surface rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>
              {isAr
                ? "لوحة التحكم بأجهزة المنشأة وحوكمة المزامنة (Tenant Devices Control Plane)"
                : "Tenant Devices Control Plane & Per-Device Sync Governance"}
            </span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {isAr
              ? `إجمالي الأجهزة المسجلة: ${devices.length} • أحدث مؤشر مزامنة للخادم: #${latestCursor}`
              : `Registered Devices: ${devices.length} • Latest Server Sync Cursor: #${latestCursor}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDevices()}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>{isAr ? "تحديث الأجهزة" : "Refresh Devices"}</span>
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="card-surface rounded-2xl p-8 text-center text-slate-500">
          {loading
            ? isAr
              ? "جاري تحميل قائمة الأجهزة..."
              : "Loading devices..."
            : isAr
            ? "لا توجد أجهزة مسجلة لهذه المنشأة بعد — سيتم تسجيل الأجهزة تلقائياً عند الاتصال أو المزامنة."
            : "No devices registered for this tenant yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {devices.map((dev) => {
            const isBusy = busyDeviceId === dev.deviceId;
            const statusClass =
              dev.status === "ACTIVE"
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : dev.status === "SUSPENDED"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300";

            return (
              <div
                key={dev.deviceId}
                className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700/80 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      {renderPlatformIcon(dev.platform)}
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-sm">
                          {dev.deviceLabel || dev.deviceId}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${statusClass}`}>
                          {dev.status}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-mono text-[10px] font-bold">
                          {dev.platform} v{dev.appVersion}
                        </span>
                        {dev.pendingCommand && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                            CMD: {dev.pendingCommand}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1 font-mono">
                        <span>ID: {dev.deviceId}</span>
                        {dev.userDisplay && <span>User: {dev.userDisplay}</span>}
                        {dev.ipAddress && <span>IP: {dev.ipAddress}</span>}
                        {dev.osVersion && <span>OS: {dev.osVersion}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Telemetry Summary */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-400">{isAr ? "طابور محلي:" : "Queue:"}</span>{" "}
                      <strong className="font-mono">{dev.pendingQueueCount}</strong>
                    </div>
                    <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-400">{isAr ? "التأخر (Lag):" : "Sync Lag:"}</span>{" "}
                      <strong className="font-mono">{dev.syncLag ?? Math.max(0, latestCursor - dev.lastCursor)}</strong>
                    </div>
                    <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <span className="text-slate-400">{isAr ? "آخر مزامنة:" : "Last Sync:"}</span>{" "}
                      <strong className="font-mono">
                        {dev.lastSyncAt ? dev.lastSyncAt.slice(0, 19).replace("T", " ") : "—"}
                      </strong>
                    </div>
                  </div>
                </div>

                {dev.lastSyncError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{dev.lastSyncError}</span>
                  </div>
                )}

                {!readOnly && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500">
                        {isAr ? "نمط المزامنة:" : "Sync Policy:"}
                      </span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void runGovernanceAction(dev, "SET_SYNC_POLICY", {
                            syncMode: dev.syncMode === "AUTO" ? "MANUAL" : "AUTO",
                          })
                        }
                        className={`px-2.5 py-1 rounded-lg font-bold text-[11px] border transition ${
                          dev.syncMode === "AUTO"
                            ? "bg-emerald-500/15 border-emerald-400 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/15 border-amber-400 text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {dev.syncMode === "AUTO"
                          ? isAr
                            ? "🔄 تلقائي (AUTO)"
                            : "🔄 AUTO"
                          : isAr
                          ? "✋ يدوي (MANUAL)"
                          : "✋ MANUAL"}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runGovernanceAction(dev, "TRIGGER_SYNC")}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{isAr ? "مزامنة الآن" : "Sync Now"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runGovernanceAction(dev, "FORCE_RESYNC")}
                        className="px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 font-bold inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{isAr ? "إعادة مزامنة كاملة" : "Force Re-Sync"}</span>
                      </button>

                      {dev.status !== "ACTIVE" && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runGovernanceAction(dev, "APPROVE")}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{isAr ? "اعتماد / تفعيل" : "Approve"}</span>
                        </button>
                      )}

                      {dev.status === "ACTIVE" && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runGovernanceAction(dev, "SUSPEND")}
                          className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 font-bold inline-flex items-center gap-1"
                        >
                          <Lock className="w-3 h-3" />
                          <span>{isAr ? "قفل مؤقت" : "Suspend"}</span>
                        </button>
                      )}

                      {dev.status !== "REVOKED" && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runGovernanceAction(dev, "REVOKE")}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold inline-flex items-center gap-1"
                        >
                          <Ban className="w-3 h-3" />
                          <span>{isAr ? "إلغاء نهائي" : "Revoke"}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDeleteDevice(dev)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        title={isAr ? "حذف" : "Delete"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, RefreshCw } from "lucide-react";
import { safeFetchJson, getStoredTenantId } from "@/lib/apiClient";
import { getOfflineQueue, getSyncMeta, type OfflineMutationItem, type OfflineSyncMetaRow } from "@/lib/offlineDb";
import type { TabId, UasSyncConflict } from "@/types/uas";

interface ApkVersionMeta {
  version: string;
  versionCode: number;
  appName: string;
  fileName: string;
  fileSize?: number;
  fileSizeFormatted?: string;
  updatedAt?: string;
  downloadUrl?: string;
}

interface MobileTabProps {
  canInstallPwa: boolean;
  offlineMode: boolean;
  offlineQueueCount: number;
  onToggleMobileSim: () => void;
  onOpenQuickSheet: () => void;
  onTriggerPwaInstall: () => void;
  onSyncQueue: () => void;
  onSwitchTab: (tab: TabId) => void;
  onToast: (msg: string) => void;
}

export function MobileTab({
  canInstallPwa,
  offlineMode,
  offlineQueueCount,
  onToggleMobileSim,
  onOpenQuickSheet,
  onTriggerPwaInstall,
  onSyncQueue,
  onSwitchTab,
  onToast,
}: MobileTabProps) {
  const [queueItems, setQueueItems] = useState<OfflineMutationItem[]>([]);
  const [apkMeta, setApkMeta] = useState<ApkVersionMeta | null>(null);
  const [syncMeta, setSyncMeta] = useState<OfflineSyncMetaRow | null>(null);
  const [conflicts, setConflicts] = useState<UasSyncConflict[]>([]);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);

  const loadSyncDetails = useCallback(async () => {
    const tenantId = getStoredTenantId();
    const [items, meta, confRes] = await Promise.all([
      getOfflineQueue(),
      getSyncMeta(tenantId),
      safeFetchJson<{ conflicts?: UasSyncConflict[] }>("/api/sync/conflicts?status=CONFLICT_PENDING", {
        cache: "no-store",
      }),
    ]);
    setQueueItems(items);
    setSyncMeta(meta);
    if (confRes.ok && Array.isArray(confRes.data?.conflicts)) {
      setConflicts(confRes.data.conflicts);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/downloads/version.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApkVersionMeta | null) => {
        if (active && data) setApkMeta(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadSyncDetails();
    });
    return () => {
      active = false;
    };
  }, [offlineQueueCount, offlineMode, loadSyncDetails]);

  async function handleResolveConflict(
    conflictId: string,
    resolution: "KEEP_SERVER" | "APPLY_CLIENT" | "DISMISS"
  ) {
    setResolvingConflictId(conflictId);
    try {
      const res = await safeFetchJson<{ success?: boolean; error?: string }>("/api/sync/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictId, resolution }),
      });
      if (!res.ok || !res.data?.success) {
        onToast(res.data?.error || "تعذر حل تعارض المزامنة");
        return;
      }
      onToast("✅ تم حل تعارض المزامنة بنجاح");
      await loadSyncDetails();
      onSyncQueue();
    } finally {
      setResolvingConflictId(null);
    }
  }
  function copyCapacitorConfig() {
    const cfg = JSON.stringify(
      {
        appId: "com.uas.accounting",
        appName: "النظام المحاسبي الموحد UAS",
        webDir: "out",
        server: { androidScheme: "https" },
      },
      null,
      2
    );
    if (navigator.clipboard) {
      navigator.clipboard.writeText(cfg).catch(() => {});
    }
    onToast("📋 تم نسخ ملف إعدادات Capacitor لبناء تطبيق الأندرويد والآيفون");
  }

  return (
    <section className="space-y-6">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold">
              مركز تطبيق الجوال (Android APK / iOS IPA / Installable PWA)
            </h3>
            <p className="text-xs text-slate-500">
              تصميم متجاوب بالكامل مع شاشات الهواتف الذكية + شريط تنقل سفلي + زر إدخال ميداني سريع + بناء حزم Capacitor و Expo
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onToggleMobileSim}
              className="px-4 py-2 rounded-xl accent-bg text-xs font-bold shadow"
            >
              📱 تشغيل / إيقاف محاكي شاشة الهاتف (412px)
            </button>
            <button
              onClick={onOpenQuickSheet}
              className="px-4 py-2 rounded-xl border border-emerald-600 text-emerald-700 text-xs font-bold"
            >
              ⚡ فتح نافذة الإدخال الميداني السريع (+)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="font-extrabold text-sm text-emerald-600">
              1. تطبيق ويب تقدمي قابل للتثبيت (PWA)
            </div>
            <p className="text-slate-500 leading-relaxed">
              يدعم التثبيت المباشر على شاشة الهاتف الرئيسية (Add to Home Screen) على أندرويد و iOS بدون متجر، مع عمل كامل بدون إنترنت في المزارع عبر IndexedDB.
            </p>
            <button
              onClick={onTriggerPwaInstall}
              className="w-full py-2 rounded-lg accent-bg font-bold"
            >
              {canInstallPwa
                ? "📲 تثبيت التطبيق الآن (PWA Install)"
                : "📲 تثبيت التطبيق على الهاتف الآن"}
            </button>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-extrabold text-sm text-indigo-600">
                2. حزمة أندرويد و iOS عبر Capacitor
              </div>
              {apkMeta?.version && (
                <span className="text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                  v{apkMeta.version}
                </span>
              )}
            </div>
            <p className="text-slate-500 leading-relaxed">
              تحويل نفس واجهة النظام إلى تطبيق أصلي (Native APK / AAB &amp; iOS IPA) مع وصول مباشر للكاميرا (مسح QR)، والطباعة الحرارية Bluetooth.
            </p>
            <div className="space-y-2 pt-1">
              <a
                href={apkMeta?.downloadUrl || "/downloads/uas-latest.apk"}
                download={apkMeta?.fileName || "UAS-Mobile-Release.apk"}
                className="w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs inline-flex items-center justify-center gap-2 transition shadow-sm"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>تحميل تطبيق الأندرويد (APK)</span>
                {apkMeta?.fileSizeFormatted && (
                  <span className="text-[10px] font-mono bg-emerald-800/80 px-1.5 py-0.5 rounded">
                    {apkMeta.fileSizeFormatted}
                  </span>
                )}
              </a>
              <button
                type="button"
                onClick={copyCapacitorConfig}
                className="w-full py-2 rounded-lg border border-indigo-600 text-indigo-600 dark:text-indigo-400 font-bold text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition"
              >
                📋 نسخ إعدادات capacitor.config.ts
              </button>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="font-extrabold text-sm text-amber-600">
              3. تطبيق React Native (Expo SQLite)
            </div>
            <p className="text-slate-500 leading-relaxed">
              بنية Local-First بقاعدة بيانات SQLite مدمجة داخل الهاتف للمحاسبين الميدانيين مع مزامنة تلقائية مع Supabase PostgreSQL.
            </p>
            <button
              onClick={() => onSwitchTab("prompt")}
              className="w-full py-2 rounded-lg border border-amber-600 text-amber-700 font-bold"
            >
              🤖 عرض أوامر البناء في وكيل البرمجة
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
          <div
            className="p-4 rounded-xl bg-slate-950 text-emerald-400 font-mono text-xs space-y-2 overflow-x-auto"
            dir="ltr"
          >
            <div className="text-slate-400 font-sans font-bold">
              # خطوات استخراج ملف APK للأندرويد و IPA للآيفون عبر Capacitor:
            </div>
            <div>npm run build:mobile</div>
            <div>npx cap sync</div>
            <div>npx cap open android</div>
            <div>npx cap open ios</div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
            <h4 className="font-extrabold text-sm">مزايا واجهة الجوال المدمجة في هذه النسخة:</h4>
            <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
              <li>
                ✅ <strong>شريط تنقل سفلي ثابت (Bottom App Bar):</strong> وصول بيد واحدة لأهم 5 أقسام رئيسية.
              </li>
              <li>
                ✅ <strong>زر الإدخال السريع العائم (+ FAB):</strong> تسجيل عملية بيع أو مصروف وقود أو دفعة عميل في 5 ثوانٍ من المزرعة.
              </li>
              <li>
                ✅ <strong>توافق اللمس والشاشات الصغيرة:</strong> أزرار وحقول مكبرة (44px+) ومحاكي شاشة هاتف ذكي مدمج (412px).
              </li>
              <li>
                ✅ <strong>مشاركة الفواتير عبر الإشعارات و QR:</strong> إرسال السند مباشرة للعميل على الجوال.
              </li>
            </ul>
          </div>
        </div>

        {/* IndexedDB Offline Sync Queue & Conflict Resolution Inspector */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-extrabold text-sm">
                طابور المزامنة الميدانية والعمل دون اتصال (Sync &amp; Offline Queue)
              </h4>
              <p className="text-slate-500">
                الحالة: {offlineMode ? "🟠 وضع عدم الاتصال (تخزين محلي)" : "🟢 متصل بالخادم"} — العمليات المعلقة: {offlineQueueCount}
                {syncMeta && (
                  <span className="font-mono ms-2">
                    • Cursor #{syncMeta.cursor} • {syncMeta.syncMode}
                    {syncMeta.lastSyncAt ? ` • آخر مزامنة: ${syncMeta.lastSyncAt.slice(0, 19).replace("T", " ")}` : ""}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={onSyncQueue}
              className="px-3.5 py-2 rounded-xl accent-bg font-bold inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>مزامنة الآن ({offlineQueueCount})</span>
            </button>
          </div>
          {conflicts.length > 0 && (
            <div className="p-3 rounded-xl border-2 border-rose-400/70 bg-rose-50/70 dark:bg-rose-950/30 space-y-2.5">
              <div className="font-black text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>تعارضات مزامنة بانتظار المراجعة (CONFLICT_PENDING: {conflicts.length})</span>
              </div>
              {conflicts.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black">
                      {c.entityType} ({c.entityId})
                    </span>
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 font-mono text-[10px] font-bold">
                      {c.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-rose-700 dark:text-rose-300">{c.reason}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-x-auto">
                      <div className="font-sans font-bold text-slate-500 mb-1">بيانات الجهاز (Client):</div>
                      <pre className="whitespace-pre-wrap break-all">{JSON.stringify(c.clientPayload, null, 2)}</pre>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-x-auto">
                      <div className="font-sans font-bold text-slate-500 mb-1">حالة الخادم (Server):</div>
                      <pre className="whitespace-pre-wrap break-all">{JSON.stringify(c.serverSnapshot, null, 2)}</pre>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      disabled={resolvingConflictId === c.id}
                      onClick={() => void handleResolveConflict(c.id, "KEEP_SERVER")}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      <span>اعتماد نسخة الخادم (Keep Server)</span>
                    </button>
                    <button
                      type="button"
                      disabled={resolvingConflictId === c.id}
                      onClick={() => void handleResolveConflict(c.id, "APPLY_CLIENT")}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white font-bold"
                    >
                      <span>تطبيق تعديل الجهاز (Apply Client)</span>
                    </button>
                    <button
                      type="button"
                      disabled={resolvingConflictId === c.id}
                      onClick={() => void handleResolveConflict(c.id, "DISMISS")}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-bold"
                    >
                      <span>تجاهل (Dismiss)</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {queueItems.length > 0 ? (
            <div className="space-y-1.5">
              {queueItems.map((item, idx) => (
                <div
                  key={item.id ?? idx}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <div>
                    <span className="font-bold">{item.label}</span>
                    <span className="text-slate-400 font-mono text-[10px] mr-2">
                      {item.method} {item.endpoint}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {item.createdAt.slice(0, 19).replace("T", " ")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500">
              لا توجد عمليات معلقة في IndexedDB — جميع البيانات متزامنة مع قاعدة البيانات.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}


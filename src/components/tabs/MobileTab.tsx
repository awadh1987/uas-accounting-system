"use client";

import { useEffect, useState } from "react";
import { getOfflineQueue, type OfflineMutationItem } from "@/lib/offlineDb";
import type { TabId } from "@/types/uas";

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

  useEffect(() => {
    let active = true;
    getOfflineQueue().then((items) => {
      if (active) setQueueItems(items);
    });
    return () => {
      active = false;
    };
  }, [offlineQueueCount, offlineMode]);
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

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
            <div className="font-extrabold text-sm text-indigo-600">
              2. حزمة أندرويد و iOS عبر Capacitor
            </div>
            <p className="text-slate-500 leading-relaxed">
              تحويل نفس واجهة النظام إلى تطبيق أصلي (Native APK / AAB &amp; iOS IPA) مع وصول مباشر للكاميرا (مسح QR)، والطباعة الحرارية Bluetooth.
            </p>
            <button
              onClick={copyCapacitorConfig}
              className="w-full py-2 rounded-lg border border-indigo-600 text-indigo-600 font-bold"
            >
              📋 نسخ إعدادات capacitor.config.ts
            </button>
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
                ✅ <strong>مشاركة الفواتير عبر واتساب و QR:</strong> إرسال السند مباشرة لتطبيق واتساب على الجوال.
              </li>
            </ul>
          </div>
        </div>

        {/* IndexedDB Offline Sync Queue Inspector */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-extrabold text-sm">
                طابور المزامنة الميدانية (IndexedDB Offline Queue)
              </h4>
              <p className="text-slate-500">
                الحالة: {offlineMode ? "🟠 وضع عدم الاتصال (تخزين محلي)" : "🟢 متصل بالخادم"} — العمليات المعلقة: {offlineQueueCount}
              </p>
            </div>
            <button
              onClick={onSyncQueue}
              className="px-3.5 py-2 rounded-xl accent-bg font-bold"
            >
              🔄 مزامنة العمليات المعلقة ({offlineQueueCount})
            </button>
          </div>
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


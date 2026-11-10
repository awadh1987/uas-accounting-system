"use client";

import { getDict } from "@/lib/i18n";
import type { LanguageCode, TabId } from "@/types/uas";

interface MobileBottomNavProps {
  activeTab: TabId;
  lang: LanguageCode;
  quickSheetOpen: boolean;
  onSwitchTab: (tab: TabId) => void;
  onOpenQuickSheet: () => void;
  onCloseQuickSheet: () => void;
  onQuickJump: (tab: TabId, targetElementId: string) => void;
}

export function MobileBottomNav({
  activeTab,
  lang,
  quickSheetOpen,
  onSwitchTab,
  onOpenQuickSheet,
  onCloseQuickSheet,
  onQuickJump,
}: MobileBottomNavProps) {
  const dict = getDict(lang);

  const navClass = (tab: TabId) =>
    `flex flex-col items-center py-1 rounded-xl min-h-[44px] justify-center ${
      activeTab === tab ? "text-emerald-600 font-extrabold" : "text-slate-500"
    }`;

  return (
    <>
      {/* Mobile Quick-Action Bottom Sheet Modal */}
      {quickSheetOpen && (
        <div
          id="mobileQuickSheet"
          className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 no-print"
        >
          <div className="card-surface rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm">
                  ⚡ إدخال ميداني سريع (تطبيق الجوال)
                </h3>
                <p className="text-[11px] text-slate-500">
                  اختر العملية للانتقال المباشر وتعبئة النموذج
                </p>
              </div>
              <button
                onClick={onCloseQuickSheet}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg px-2"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <button
                onClick={() => onQuickJump("sales", "saleCustomerInput")}
                className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/60 dark:bg-slate-800 text-right space-y-1 hover:border-emerald-500"
              >
                <div className="text-lg">💰</div>
                <div className="font-extrabold">عملية بيع جديدة</div>
                <div className="text-[10px] text-slate-500">علاقيات + سند قبض</div>
              </button>
              <button
                onClick={() => onQuickJump("treasury", "instAmountInput")}
                className="p-3.5 rounded-2xl border border-indigo-200 bg-indigo-50/60 dark:bg-slate-800 text-right space-y-1 hover:border-indigo-500"
              >
                <div className="text-lg">🏦</div>
                <div className="font-extrabold">تحصيل دفعة / سند</div>
                <div className="text-[10px] text-slate-500">صندوق / كريمي / جوالي</div>
              </button>
              <button
                onClick={() => onQuickJump("expenses", "expSubTypeInput")}
                className="p-3.5 rounded-2xl border border-amber-200 bg-amber-50/60 dark:bg-slate-800 text-right space-y-1 hover:border-amber-500"
              >
                <div className="text-lg">⛽</div>
                <div className="font-extrabold">مصروف تشغيلي</div>
                <div className="text-[10px] text-slate-500">وقود / وجبات / نقل</div>
              </button>
              <button
                onClick={() => onQuickJump("workers", "wrkNameInput")}
                className="p-3.5 rounded-2xl border border-purple-200 bg-purple-50/60 dark:bg-slate-800 text-right space-y-1 hover:border-purple-500"
              >
                <div className="text-lg">👷</div>
                <div className="font-extrabold">تسجيل أجر عامل</div>
                <div className="text-[10px] text-slate-500">أيام عمل + صرف</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Mobile Bottom Navigation Bar + Quick-Action FAB */}
      <div
        id="mobileBottomNav"
        className="fixed bottom-0 inset-x-0 z-40 card-surface border-t border-slate-200 dark:border-slate-700 px-2 py-1.5 shadow-2xl no-print"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-md mx-auto grid grid-cols-5 items-center text-center text-[11px] font-bold">
          <button onClick={() => onSwitchTab("dashboard")} className={navClass("dashboard")}>
            <span className="text-base leading-none">📊</span>
            <span className="mt-0.5">{dict.mNavHome}</span>
          </button>
          <button onClick={() => onSwitchTab("sales")} className={navClass("sales")}>
            <span className="text-base leading-none">💰</span>
            <span className="mt-0.5">{dict.mNavSales}</span>
          </button>
          <div className="flex justify-center -mt-5">
            <button
              onClick={onOpenQuickSheet}
              id="mobileQuickFab"
              className="w-12 h-12 rounded-full accent-bg shadow-lg flex items-center justify-center text-xl font-extrabold border-4 border-white dark:border-slate-900"
              aria-label="Quick Action"
            >
              +
            </button>
          </div>
          <button onClick={() => onSwitchTab("treasury")} className={navClass("treasury")}>
            <span className="text-base leading-none">🏦</span>
            <span className="mt-0.5">{dict.mNavTreasury}</span>
          </button>
          <button onClick={() => onSwitchTab("mobile")} className={navClass("mobile")}>
            <span className="text-base leading-none">📱</span>
            <span className="mt-0.5">{dict.mNavMobile}</span>
          </button>
        </div>
      </div>
    </>
  );
}


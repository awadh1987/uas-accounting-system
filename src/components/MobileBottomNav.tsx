"use client";

import { BarChart3, Home, Landmark, Menu, Plus, ShoppingBag, X } from "lucide-react";
import { getDict } from "@/lib/i18n";
import { canAccessModule, isReadOnly } from "@/lib/permissions";
import type { LanguageCode, TabId, UasUser } from "@/types/uas";

interface MobileBottomNavProps {
  activeTab: TabId;
  lang: LanguageCode;
  quickSheetOpen: boolean;
  currentUser: UasUser;
  mobileSimulatorActive?: boolean;
  onSwitchTab: (tab: TabId) => void;
  onOpenQuickSheet: () => void;
  onCloseQuickSheet: () => void;
  onQuickJump: (tab: TabId, targetElementId: string) => void;
  onOpenMobileSidebar: () => void;
}

export function MobileBottomNav({
  activeTab,
  lang,
  quickSheetOpen,
  currentUser,
  mobileSimulatorActive = false,
  onSwitchTab,
  onOpenQuickSheet,
  onCloseQuickSheet,
  onQuickJump,
  onOpenMobileSidebar,
}: MobileBottomNavProps) {
  const dict = getDict(lang);
  const isAr = lang === "ar";
  const readOnly = isReadOnly(currentUser);

  const isCommercial = ["commercial", "procurement", "sales", "customers", "inventory"].includes(activeTab);
  const isTreasury = ["accounting", "coa", "ledger", "treasury"].includes(activeTab);

  const navClass = (active: boolean) =>
    `flex flex-col items-center py-1 rounded-xl min-h-[44px] justify-center transition ${
      active ? "text-emerald-600 font-extrabold" : "text-slate-500"
    }`;

  return (
    <>
      {/* Mobile Quick-Action Bottom Sheet Modal */}
      {quickSheetOpen && (
        <div
          id="mobileQuickSheet"
          className="fixed inset-0 bg-slate-900/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 no-print"
          onClick={onCloseQuickSheet}
        >
          <div
            className="card-surface rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2.5">
              <div>
                <h3 className="font-extrabold text-sm">
                  {isAr
                    ? "⚡ إدخال ميداني ومحاسبي سريع"
                    : "⚡ Quick Field & Accounting Entry"}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {readOnly
                    ? isAr
                      ? "وضع المراجعة (للقراءة فقط) — تصفح الأقسام المتاحة"
                      : "Read-Only Auditor Mode — Navigate modules"
                    : isAr
                    ? "اختر العملية للانتقال المباشر وتسجيل السند أو القيد المزدوج"
                    : "Jump straight to record a voucher or double-entry journal"}
                </p>
              </div>
              <button
                type="button"
                onClick={onCloseQuickSheet}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              {canAccessModule(currentUser, "sales") && (
                <button
                  type="button"
                  onClick={() => onQuickJump("sales", "saleCustomerInput")}
                  className="p-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 dark:bg-slate-800 text-start space-y-1 hover:border-emerald-500"
                >
                  <div className="text-lg">💰</div>
                  <div className="font-extrabold">{isAr ? "عملية بيع جديدة" : "New Sale"}</div>
                  <div className="text-[10px] text-slate-500">{isAr ? "علاقيات + سند قبض" : "Bundles + Receipt"}</div>
                </button>
              )}
              {canAccessModule(currentUser, "treasury") && (
                <button
                  type="button"
                  onClick={() => onQuickJump("treasury", "instAmountInput")}
                  className="p-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 dark:bg-slate-800 text-start space-y-1 hover:border-indigo-500"
                >
                  <div className="text-lg">🏦</div>
                  <div className="font-extrabold">{isAr ? "تحصيل دفعة / سند" : "Installment Voucher"}</div>
                  <div className="text-[10px] text-slate-500">{isAr ? "صندوق / كريمي / جوالي" : "Vault / Bank / Wallet"}</div>
                </button>
              )}
              {canAccessModule(currentUser, "expenses") && (
                <button
                  type="button"
                  onClick={() => onQuickJump("expenses", "expSubTypeInput")}
                  className="p-3 rounded-2xl border border-amber-200 bg-amber-50/60 dark:bg-slate-800 text-start space-y-1 hover:border-amber-500"
                >
                  <div className="text-lg">⛽</div>
                  <div className="font-extrabold">{isAr ? "مصروف تشغيلي" : "Operating Expense"}</div>
                  <div className="text-[10px] text-slate-500">{isAr ? "وقود / وجبات / نقل" : "Fuel / Meals / Transport"}</div>
                </button>
              )}
              {canAccessModule(currentUser, "workers") && (
                <button
                  type="button"
                  onClick={() => onQuickJump("workers", "wrkNameInput")}
                  className="p-3 rounded-2xl border border-purple-200 bg-purple-50/60 dark:bg-slate-800 text-start space-y-1 hover:border-purple-500"
                >
                  <div className="text-lg">👷</div>
                  <div className="font-extrabold">{isAr ? "تسجيل أجر عامل" : "Worker Wage"}</div>
                  <div className="text-[10px] text-slate-500">{isAr ? "أيام عمل + قيد استحقاق" : "Attendance + Accrual"}</div>
                </button>
              )}
              {canAccessModule(currentUser, "procurement") && (
                <button
                  type="button"
                  onClick={() => {
                    onCloseQuickSheet();
                    onSwitchTab("procurement");
                  }}
                  className="p-3 rounded-2xl border border-cyan-200 bg-cyan-50/60 dark:bg-slate-800 text-start space-y-1 hover:border-cyan-500"
                >
                  <div className="text-lg">🛒</div>
                  <div className="font-extrabold">{isAr ? "أمر شراء / فاتورة مورد" : "Purchase Order / Bill"}</div>
                  <div className="text-[10px] text-slate-500">PO → GRN → Vendor Bill</div>
                </button>
              )}
              {canAccessModule(currentUser, "ledger") && (
                <button
                  type="button"
                  onClick={() => {
                    onCloseQuickSheet();
                    onSwitchTab("ledger");
                  }}
                  className="p-3 rounded-2xl border border-rose-200 bg-rose-50/60 dark:bg-slate-800 text-start space-y-1 hover:border-rose-500"
                >
                  <div className="text-lg">📒</div>
                  <div className="font-extrabold">{isAr ? "قيد يومية مزدوج" : "Journal Entry"}</div>
                  <div className="text-[10px] text-slate-500">{isAr ? "الأستاذ العام (T5 COA)" : "General Ledger (T5 COA)"}</div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fixed Mobile Bottom Navigation Bar + Quick-Action FAB */}
      <div
        id="mobileBottomNav"
        className={`${
          mobileSimulatorActive ? "block" : "md:hidden"
        } fixed bottom-0 inset-x-0 z-40 card-surface border-t border-slate-200 dark:border-slate-700 px-2 py-1.5 shadow-2xl no-print`}
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-md mx-auto grid grid-cols-5 items-center text-center text-[11px] font-bold">
          <button type="button" onClick={() => onSwitchTab("dashboard")} className={navClass(activeTab === "dashboard")}>
            <Home className="w-4 h-4" />
            <span className="mt-0.5">{dict.mNavHome}</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onSwitchTab(
                canAccessModule(currentUser, "procurement")
                  ? "procurement"
                  : canAccessModule(currentUser, "sales")
                  ? "sales"
                  : "dashboard"
              )
            }
            className={navClass(isCommercial)}
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="mt-0.5">{isAr ? "التجارة" : "Commerce"}</span>
          </button>
          <div className="flex justify-center -mt-5">
            <button
              type="button"
              onClick={onOpenQuickSheet}
              id="mobileQuickFab"
              className="w-12 h-12 rounded-full accent-bg shadow-lg flex items-center justify-center border-4 border-white dark:border-slate-900"
              aria-label="Quick Action"
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              onSwitchTab(
                canAccessModule(currentUser, "treasury")
                  ? "treasury"
                  : canAccessModule(currentUser, "reports")
                  ? "reports"
                  : "dashboard"
              )
            }
            className={navClass(isTreasury || activeTab === "reports")}
          >
            {canAccessModule(currentUser, "treasury") ? (
              <>
                <Landmark className="w-4 h-4" />
                <span className="mt-0.5">{dict.mNavTreasury}</span>
              </>
            ) : (
              <>
                <BarChart3 className="w-4 h-4" />
                <span className="mt-0.5">{isAr ? "التقارير" : "Reports"}</span>
              </>
            )}
          </button>
          <button type="button" onClick={onOpenMobileSidebar} className={navClass(false)}>
            <Menu className="w-4 h-4" />
            <span className="mt-0.5">{isAr ? "القائمة" : "Menu"}</span>
          </button>
        </div>
      </div>
    </>
  );
}

"use client";

import type { CurrencyCode } from "@/lib/formulas";
import { getDict } from "@/lib/i18n";
import type { LanguageCode, TabId, ThemeName, UasProject, UasUser } from "@/types/uas";
import { SvgAvatar } from "./SvgAvatar";

interface HeaderNavProps {
  orgName: string;
  logoText: string;
  lang: LanguageCode;
  theme: ThemeName;
  currency: CurrencyCode;
  offlineMode: boolean;
  offlineQueueCount: number;
  mobileSimulatorActive: boolean;
  activeTab: TabId;
  projects: UasProject[];
  selectedProjectId: string;
  selectedHarvest: string;
  availableHarvests: string[];
  currentUser: UasUser;
  onProjectChange: (pid: string) => void;
  onHarvestChange: (harvest: string) => void;
  onCurrencyChange: (cur: CurrencyCode) => void;
  onToggleOffline: () => void;
  onSyncQueue: () => void;
  onToggleMobileSim: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onToggleLanguage: () => void;
  onOpenLogin: () => void;
  onOpenLanding?: () => void;
  onSwitchTab: (tab: TabId) => void;
}

export function HeaderNav({
  orgName,
  logoText,
  lang,
  theme,
  currency,
  offlineMode,
  offlineQueueCount,
  mobileSimulatorActive,
  activeTab,
  projects,
  selectedProjectId,
  selectedHarvest,
  availableHarvests,
  currentUser,
  onProjectChange,
  onHarvestChange,
  onCurrencyChange,
  onToggleOffline,
  onSyncQueue,
  onToggleMobileSim,
  onThemeChange,
  onToggleLanguage,
  onOpenLogin,
  onOpenLanding,
  onSwitchTab,
}: HeaderNavProps) {
  const dict = getDict(lang);

  const navItems: Array<{ id: TabId; icon: string; label: string }> = [
    { id: "dashboard", icon: "📊", label: dict.navDashboard },
    { id: "coa", icon: "🌳", label: dict.navCoa },
    { id: "ledger", icon: "📒", label: dict.navLedger },
    { id: "procurement", icon: "🛒", label: dict.navProcurement },
    { id: "reports", icon: "📈", label: dict.navReports },
    { id: "projects", icon: "🌱", label: dict.navProjects },
    { id: "expenses", icon: "⛽", label: dict.navExpenses },
    { id: "workers", icon: "👷", label: dict.navWorkers },
    { id: "sales", icon: "💰", label: dict.navSales },
    { id: "customers", icon: "🧾", label: dict.navCustomers },
    { id: "treasury", icon: "🏦", label: dict.navTreasury },
    { id: "inventory", icon: "📦", label: dict.navInventory },
    { id: "audit", icon: "🛡️", label: dict.navAudit },
    { id: "mobile", icon: "📱", label: dict.navMobile },
    { id: "system", icon: "⚙️", label: dict.navSystem },
    { id: "prompt", icon: "🤖", label: dict.navPrompt },
  ];

  return (
    <header className="card-surface sticky top-0 z-30 px-4 py-3 shadow-sm no-print">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Logo & System Name */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl accent-bg flex items-center justify-center font-extrabold text-lg shadow-sm shrink-0">
            {logoText || "UAS"}
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-extrabold leading-tight">
              {orgName}
            </h1>
            <p className="text-xs text-slate-500">{dict.appSubtitle}</p>
          </div>
        </div>

        {/* Active Project & Harvest Selector + System Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-500">
              {dict.activeProjectLbl}
            </span>
            <select
              value={selectedProjectId}
              onChange={(e) => onProjectChange(e.target.value)}
              className="bg-transparent text-xs font-bold focus:outline-none"
            >
              <option value="ALL">{dict.allProjects}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <span className="text-xs font-semibold text-slate-500">
              {dict.activeHarvestLbl}
            </span>
            <select
              value={selectedHarvest}
              onChange={(e) => onHarvestChange(e.target.value)}
              className="bg-transparent text-xs font-bold focus:outline-none"
            >
              <option value="ALL">{dict.allHarvests}</option>
              {availableHarvests.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>

          {/* Multi-Currency Selector */}
          <select
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value as CurrencyCode)}
            className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 text-xs font-bold"
          >
            <option value="YER">🇾🇪 ريال يمني (YER)</option>
            <option value="SAR">🇸🇦 ريال سعودي (SAR)</option>
            <option value="USD">🇺🇸 دولار أمريكي (USD)</option>
          </select>

          {/* Offline PWA & Cloud Sync Controls */}
          <button
            onClick={onToggleOffline}
            className={
              offlineMode
                ? "px-2.5 py-1.5 rounded-xl border border-amber-500 bg-amber-50 text-amber-800 text-xs font-bold"
                : "px-2.5 py-1.5 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 text-xs font-bold"
            }
          >
            {offlineMode ? dict.offlineBadge : dict.onlineBadge}
          </button>

          <button
            onClick={onSyncQueue}
            className="px-2.5 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-bold"
          >
            {dict.syncBtn} (<span>{offlineQueueCount}</span>)
          </button>

          <button
            onClick={onToggleMobileSim}
            className="px-2.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 text-xs font-bold"
          >
            {mobileSimulatorActive ? dict.desktopSimBtn : dict.mobileSimBtn}
          </button>

          {/* Theme Switcher */}
          <select
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as ThemeName)}
            className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 text-xs font-semibold"
          >
            <option value="emerald">🌿 الثيم الأخضر (Emerald)</option>
            <option value="dark">🌙 الوضع الداكن (Dark)</option>
            <option value="royal">🏛️ الثيم الملكي (Royal)</option>
          </select>

          {/* Language Switcher */}
          <button
            onClick={onToggleLanguage}
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            English / العربية
          </button>

          {/* Current User Pill */}
          <div className="flex items-center gap-2 pl-2 border-r border-slate-200 pr-2">
            <SvgAvatar char={currentUser.avatarChar} size={32} />
            <div className="hidden sm:block text-xs leading-tight">
              <div className="font-bold">{currentUser.name}</div>
              <div className="text-[10px] text-slate-500">{currentUser.role}</div>
            </div>
            <button
              onClick={onOpenLogin}
              className="text-xs px-2 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold"
            >
              {dict.switchUserBtn}
            </button>
            {onOpenLanding && (
              <button
                onClick={onOpenLanding}
                className="text-xs px-2 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold"
                title="العودة للواجهة التعريفية والتحقق العام"
              >
                🏛️
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Navigation List (12 Tabs) */}
      <nav className="max-w-7xl mx-auto mt-3 pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-1.5 overflow-x-auto pb-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSwitchTab(item.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              activeTab === item.id ? "accent-bg" : "hover:bg-slate-200/60"
            }`}
          >
            {item.icon} <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}


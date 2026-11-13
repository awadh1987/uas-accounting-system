"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Globe2,
  Home,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Smartphone,
  User,
  UserCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { SvgAvatar } from "@/components/SvgAvatar";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { getBreadcrumb, resolveGroupForTab } from "@/lib/erpNavigation";
import type { CurrencyCode } from "@/lib/formulas";
import { getDict } from "@/lib/i18n";
import { getRoleMeta, isReadOnly } from "@/lib/permissions";
import type {
  LanguageCode,
  TabId,
  ThemeName,
  UasEnterpriseProfile,
  UasProject,
  UasUser,
} from "@/types/uas";

interface TopCommandBarProps {
  lang: LanguageCode;
  theme: ThemeName;
  currency: CurrencyCode;
  logoText?: string;
  enterpriseProfile?: UasEnterpriseProfile | null;
  offlineMode: boolean;
  offlineQueueCount: number;
  mobileSimulatorActive: boolean;
  sidebarCollapsed: boolean;
  activeTab: TabId;
  projects: UasProject[];
  selectedProjectId: string;
  selectedSubProjectId?: string;
  availableSubProjects?: Array<{ id: string; code?: string; nameAr: string; nameEn?: string }>;
  selectedHarvest: string;
  availableHarvests: string[];
  currentUser: UasUser;
  onToggleSidebarCollapse: () => void;
  onOpenMobileSidebar: () => void;
  onOpenSearch: () => void;
  onProjectChange: (pid: string) => void;
  onSubProjectChange?: (subId: string) => void;
  onHarvestChange: (harvest: string) => void;
  onCurrencyChange: (cur: CurrencyCode) => void;
  onToggleOffline: () => void;
  onSyncQueue: () => void;
  onToggleMobileSim: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onToggleLanguage: () => void;
  onOpenLogin: () => void;
  onOpenLanding: () => void;
  onOpenProfileDrawer?: () => void;
}

export function TopCommandBar({
  lang,
  theme,
  currency,
  logoText,
  enterpriseProfile,
  offlineMode,
  offlineQueueCount,
  mobileSimulatorActive,
  sidebarCollapsed,
  activeTab,
  projects,
  selectedProjectId,
  selectedSubProjectId = "ALL",
  availableSubProjects = [],
  selectedHarvest,
  availableHarvests,
  currentUser,
  onToggleSidebarCollapse,
  onOpenMobileSidebar,
  onOpenSearch,
  onProjectChange,
  onSubProjectChange,
  onHarvestChange,
  onCurrencyChange,
  onToggleOffline,
  onSyncQueue,
  onToggleMobileSim,
  onThemeChange,
  onToggleLanguage,
  onOpenLogin,
  onOpenLanding,
  onOpenProfileDrawer,
}: TopCommandBarProps) {
  const isAr = lang === "ar";
  const dict = getDict(lang);
  const breadcrumb = getBreadcrumb(activeTab, lang);
  const activeGroup = resolveGroupForTab(activeTab);
  const activeSub = activeGroup.subTabs.find((s) => s.id === activeTab);
  const domainNamespace = activeSub?.subdomain || activeGroup.domainPath;
  const roleMeta = getRoleMeta(currentUser);
  const readOnly = isReadOnly(currentUser);
  const [profileOpen, setProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="card-surface sticky top-0 z-20 h-[60px] px-3 sm:px-5 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2 no-print">
      {/* Leading: Sidebar Collapse + Mobile Drawer + Dynamic Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Mobile / Simulator Hamburger */}
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Open navigation menu"
          className={`${
            mobileSimulatorActive ? "inline-flex" : "inline-flex md:hidden"
          } p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0`}
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Desktop Sidebar Collapse Toggle */}
        {!mobileSimulatorActive && (
          <button
            type="button"
            onClick={onToggleSidebarCollapse}
            title={isAr ? "طي / توسيع القائمة الجانبية" : "Toggle Sidebar"}
            className="hidden md:inline-flex p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Mobile Dual Logo Badge */}
        <div className={mobileSimulatorActive ? "flex items-center" : "md:hidden flex items-center"}>
          <DualLogoBadge profile={enterpriseProfile} logoText={logoText} size="sm" iconOnly />
        </div>

        {/* Dynamic Breadcrumb Trail + Domain Namespace */}
        <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-xs min-w-0">
          <span className="font-extrabold truncate max-w-[150px] lg:max-w-[200px]">
            {breadcrumb.groupLabel}
          </span>
          {breadcrumb.subLabel && (
            <>
              <span className="text-slate-400">/</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate max-w-[160px]">
                {breadcrumb.subLabel}
              </span>
            </>
          )}
          <span className="hidden lg:inline-block px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-500">
            {domainNamespace}
          </span>
        </nav>
      </div>

      {/* Center / Trailing Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
        {/* Global Project & Harvest Filter Pills */}
        {!mobileSimulatorActive && (
          <div className="hidden xl:flex items-center gap-1.5">
            <select
              aria-label={dict.activeProjectLbl}
              value={selectedProjectId}
              onChange={(e) => onProjectChange(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1.5 text-[11px] font-bold focus:outline-none max-w-[175px]"
            >
              <option value="ALL">{dict.allProjects}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Cascading Sub-Project Filter */}
            <select
              aria-label={isAr ? "القطاع الفرعي" : "Sub-Project"}
              value={selectedSubProjectId}
              onChange={(e) => onSubProjectChange?.(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1.5 text-[11px] font-bold focus:outline-none max-w-[160px]"
            >
              <option value="ALL">{isAr ? "كل القطاعات الفرعية" : "All Sub-Projects"}</option>
              {availableSubProjects.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.code ? `${sp.code} - ${sp.nameAr}` : sp.nameAr}
                </option>
              ))}
            </select>

            <select
              aria-label={dict.activeHarvestLbl}
              value={selectedHarvest}
              onChange={(e) => onHarvestChange(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1.5 text-[11px] font-bold focus:outline-none max-w-[140px]"
            >
              <option value="ALL">{dict.allHarvests}</option>
              {availableHarvests.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Ctrl+K Quick Search Trigger */}
        <button
          type="button"
          onClick={onOpenSearch}
          title="Ctrl+K / ⌘K"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/70 hover:border-emerald-500 text-xs text-slate-500 transition shrink-0"
        >
          <Search className="w-3.5 h-3.5 text-emerald-600" />
          <span className="hidden lg:inline text-[11px] font-semibold">
            {isAr ? "بحث..." : "Search..."}
          </span>
          <kbd className="hidden md:inline-block px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-mono">
            Ctrl+K
          </kbd>
        </button>

        {/* Currency Switcher */}
        <select
          aria-label="Currency"
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value as CurrencyCode)}
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1.5 text-[11px] font-extrabold shrink-0"
        >
          <option value="YER">YER</option>
          <option value="SAR">SAR</option>
          <option value="USD">USD</option>
        </select>

        {/* Theme Switcher */}
        {!mobileSimulatorActive && (
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as ThemeName)}
            className="hidden sm:block rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1.5 text-[11px] font-bold shrink-0"
          >
            <option value="emerald">🌿 Emerald</option>
            <option value="royal">🏛️ Royal</option>
            <option value="dark">🌙 Dark</option>
          </select>
        )}

        {/* Offline / Sync Pill */}
        <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
          <button
            type="button"
            onClick={onToggleOffline}
            title={offlineMode ? dict.offlineBadge : dict.onlineBadge}
            className={`px-2 py-1.5 text-[11px] font-bold inline-flex items-center gap-1 ${
              offlineMode
                ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                : "text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {offlineMode ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            <span className="hidden lg:inline">
              {offlineMode ? (isAr ? "أوفلاين" : "Offline") : isAr ? "متصل" : "Online"}
            </span>
          </button>
          <button
            type="button"
            onClick={onSyncQueue}
            title={dict.syncBtn}
            className="px-2 py-1.5 text-[11px] font-extrabold bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 inline-flex items-center gap-1 border-s border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="tabular-nums">{offlineQueueCount}</span>
          </button>
        </div>

        {/* Language Toggle */}
        <button
          type="button"
          onClick={onToggleLanguage}
          className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-extrabold hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 shrink-0"
        >
          <Globe2 className="w-3.5 h-3.5" />
          <span>{isAr ? "EN" : "عربي"}</span>
        </button>

        {/* User Profile Dropdown */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((prev) => !prev)}
            className="flex items-center gap-2 px-2 py-1 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <SvgAvatar char={currentUser.avatarChar} size={28} />
            <div className="hidden md:block text-start leading-tight max-w-[125px]">
              <div className="text-[11px] font-extrabold truncate">
                {currentUser.displayName || currentUser.name}
              </div>
              <div className="text-[9px] text-slate-500 truncate">
                {isAr ? roleMeta.labelAr : roleMeta.shortEn}
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {profileOpen && (
            <div
              className={`absolute ${
                isAr ? "left-0" : "right-0"
              } mt-2 w-64 rounded-2xl card-surface shadow-2xl border border-slate-200 dark:border-slate-700 p-2 z-50 space-y-1`}
            >
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 space-y-1">
                <div className="text-xs font-black truncate">
                  {currentUser.displayName || currentUser.fullName || currentUser.name}
                </div>
                <div className="text-[11px] text-slate-500 font-mono truncate">
                  {currentUser.email}
                </div>
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${roleMeta.badgeClass}`}>
                    {isAr ? roleMeta.labelAr : roleMeta.labelEn}
                  </span>
                  {readOnly && (
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                      {isAr ? "قراءة فقط" : "Read-Only"}
                    </span>
                  )}
                  {currentUser.mustChangePassword && (
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-bold">
                      {isAr ? "يلزم تغيير كلمة المرور" : "Change Pass Required"}
                    </span>
                  )}
                </div>
              </div>

              {/* Self-Service Profile & Preferences Trigger */}
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  onOpenProfileDrawer?.();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 transition"
              >
                <User className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-start leading-tight flex-1">
                  <div>{isAr ? "الملف الشخصي وتفضيلات العمل" : "Profile & Preferences"}</div>
                  <div className="text-[10px] text-emerald-600/70 font-normal">
                    {isAr ? "الاسم، الهاتف، كلمة المرور، المظهر" : "Name, Phone, Pass, Theme"}
                  </div>
                </div>
              </button>

              {/* Project Filter inside dropdown for narrow viewports */}
              <div className="xl:hidden px-2 py-1.5 space-y-1.5 border-b border-slate-100 dark:border-slate-800">
                <select
                  value={selectedProjectId}
                  onChange={(e) => onProjectChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1 text-[11px] font-bold"
                >
                  <option value="ALL">{dict.allProjects}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={isAr ? "القطاع الفرعي" : "Sub-Project"}
                  value={selectedSubProjectId}
                  onChange={(e) => onSubProjectChange?.(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1 text-[11px] font-bold"
                >
                  <option value="ALL">{isAr ? "كل القطاعات الفرعية" : "All Sub-Projects"}</option>
                  {availableSubProjects.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.code ? `${sp.code} - ${sp.nameAr}` : sp.nameAr}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedHarvest}
                  onChange={(e) => onHarvestChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1 text-[11px] font-bold"
                >
                  <option value="ALL">{dict.allHarvests}</option>
                  {availableHarvests.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  onToggleMobileSim();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <Smartphone className="w-4 h-4 text-emerald-600" />
                <span>
                  {mobileSimulatorActive
                    ? isAr
                      ? "العودة لعرض سطح المكتب"
                      : "Exit Mobile Frame"
                    : isAr
                    ? "محاكي الجوال (412px)"
                    : "Mobile Frame (412px)"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  onOpenLogin();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <UserCheck className="w-4 h-4 text-indigo-600" />
                <span>{isAr ? "تبديل المستخدم / الأدوار" : "Switch User / Role"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  onOpenLanding();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
              >
                <LogOut className="w-4 h-4" />
                <span>
                  <Home className="w-3.5 h-3.5 inline me-1" />
                  {isAr ? "الصفحة الرئيسية العامة" : "Public Landing Page"}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


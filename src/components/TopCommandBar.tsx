"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Bot,
  ChevronDown,
  FileClock,
  Globe2,
  Home,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
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
  onOpenDraftsCenter?: () => void;
  draftsCount?: number;
  onOpenApprovalsCenter?: () => void;
  pendingApprovalsCount?: number;
  onOpenNotifications?: () => void;
  unreadNotificationsCount?: number;
  transportBadge?: string;
  pendingConflictsCount?: number;
  onLogout?: () => void;
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
  onOpenDraftsCenter,
  draftsCount = 0,
  onOpenApprovalsCenter,
  pendingApprovalsCount = 0,
  onOpenNotifications,
  unreadNotificationsCount = 0,
  transportBadge,
  pendingConflictsCount = 0,
  onLogout,
}: TopCommandBarProps) {
  const isAr = lang === "ar";
  const dict = getDict(lang);
  const breadcrumb = getBreadcrumb(activeTab, lang);
  const activeGroup = resolveGroupForTab(activeTab);
  const activeSub = activeGroup.subTabs.find((s) => s.id === activeTab);
  const roleMeta = getRoleMeta(currentUser);
  const readOnly = isReadOnly(currentUser);
  const [profileOpen, setProfileOpen] = useState(false);
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const utilitiesRef = useRef<HTMLDivElement | null>(null);

  const localizedModuleBadge = useMemo(() => {
    const map: Record<string, { ar: string; en: string }> = {
      dashboard: { ar: "لوحة المؤشرات", en: "Executive Dashboard" },
      sales: { ar: "المبيعات والعملاء", en: "Sales & Clients" },
      customers: { ar: "دليل العملاء وكشوفات الحساب", en: "Clients & Ledgers" },
      procurement: { ar: "المشتريات والتوريدات", en: "Procurement & Vendors" },
      expenses: { ar: "المصروفات التشغيلية", en: "Operational Expenses" },
      workers: { ar: "العمال والأجور والعهد", en: "Labor & Payroll" },
      ledger: { ar: "الأستاذ العام وميزان المراجعة", en: "General Ledger" },
      coa: { ar: "دليل الحسابات الشجري", en: "Chart of Accounts" },
      reports: { ar: "التقارير المالية والختامية", en: "Financial Reports" },
      inventory: { ar: "إدارة المخزون والمستودعات", en: "Multi-Unit Inventory" },
      projects: { ar: "إدارة المشاريع والقطاعات", en: "Projects & Operations" },
      system: { ar: "إعدادات النظام والترخيص", en: "System & Governance" },
      audit: { ar: "سجل الرقابة وإقفال الفترات", en: "Audit & Period Lock" },
    };
    const item = map[activeTab];
    if (item) return isAr ? item.ar : item.en;
    return activeSub
      ? isAr
        ? activeSub.labelAr
        : activeSub.labelEn
      : isAr
      ? activeGroup.labelAr
      : activeGroup.labelEn;
  }, [activeTab, activeSub, activeGroup, isAr]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setProfileOpen(false);
      }
      if (utilitiesRef.current && !utilitiesRef.current.contains(target)) {
        setUtilitiesOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProfileOpen(false);
        setUtilitiesOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const utilityBadgeCount =
    pendingApprovalsCount + draftsCount + offlineQueueCount + pendingConflictsCount;

  return (
    <header
      data-testid="top-command-bar"
      className="card-surface sticky top-0 z-20 h-[60px] px-3 sm:px-4 lg:px-5 border-b border-slate-200 dark:border-slate-700/80 flex items-center justify-between gap-2 sm:gap-3 no-print"
    >
      {/* Leading: Sidebar Collapse + Mobile Drawer + Dynamic Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
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

        {/* Main Navigation Brand Logo & Title (visible when sidebar is collapsed or on mobile) */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            className={
              mobileSimulatorActive || sidebarCollapsed
                ? "flex items-center gap-2"
                : "md:hidden flex items-center"
            }
          >
            <DualLogoBadge profile={enterpriseProfile} logoText={logoText} size="sm" iconOnly />
            {sidebarCollapsed && !mobileSimulatorActive && (
              <span className="hidden md:inline-flex items-center font-black text-xs tracking-tight text-slate-900 dark:text-white truncate max-w-[150px]">
                {isAr
                  ? enterpriseProfile?.legalNameAr?.trim() || "النظام المحاسبي الموحد"
                  : enterpriseProfile?.legalNameEn?.trim() || "UAS Accounting System"}
              </span>
            )}
          </div>
        </div>

        {/* Dynamic Breadcrumb Trail (truncates cleanly without crowding right-side controls) */}
        <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-1.5 text-xs min-w-0 flex-1">
          <span className="font-extrabold truncate max-w-[130px] lg:max-w-[170px] 2xl:max-w-[210px]">
            <bdi dir="auto">{breadcrumb.groupLabel}</bdi>
          </span>
          {breadcrumb.subLabel && (
            <>
              <span className="text-slate-400 shrink-0">/</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate max-w-[130px] lg:max-w-[170px]">
                <bdi dir="auto">{breadcrumb.subLabel}</bdi>
              </span>
            </>
          )}
          <span className="hidden 2xl:inline-block shrink-0 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-800/40 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
            <bdi dir="auto">{localizedModuleBadge}</bdi>
          </span>
        </nav>
      </div>

      {/* Trailing: Primary Controls + Workspace Utilities Popover + User Session Menu */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Global Project Filter Pill (Desktop >= xl) */}
        {!mobileSimulatorActive && (
          <div className="hidden xl:flex items-center shrink-0">
            <select
              aria-label={dict.activeProjectLbl}
              value={selectedProjectId}
              onChange={(e) => onProjectChange(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2.5 py-1.5 text-[11px] font-bold focus:outline-none max-w-[140px] 2xl:max-w-[175px] truncate"
            >
              <option value="ALL">{dict.allProjects}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Ctrl+K Quick Search Trigger */}
        <button
          type="button"
          data-testid="topbar-search-btn"
          onClick={onOpenSearch}
          title="Ctrl+K / ⌘K"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/70 hover:border-emerald-500 text-xs text-slate-700 dark:text-slate-200 transition shrink-0"
        >
          <Search className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="hidden sm:inline text-[11px] font-bold">
            {isAr ? "بحث" : "Search"}
          </span>
          <kbd className="hidden 2xl:inline-block px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-mono">
            Ctrl+K
          </kbd>
        </button>

        {/* AI Copilot Quick Launch Button */}
        <button
          type="button"
          data-testid="topbar-ai-copilot-btn"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("uas:toggle-copilot"));
            }
          }}
          title={
            isAr
              ? "فتح المساعد المحاسبي الذكي ودليل المستخدم"
              : "Open UAS AI Copilot & User Manual"
          }
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/80 text-emerald-800 dark:text-emerald-300 text-xs font-extrabold transition shrink-0"
        >
          <Bot className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="hidden lg:inline text-[11px]">
            {isAr ? "المساعد الذكي" : "AI Copilot"}
          </span>
        </button>

        {/* Notification Center Bell */}
        {onOpenNotifications && (
          <button
            type="button"
            data-testid="topbar-notifications-btn"
            onClick={onOpenNotifications}
            title={isAr ? "مركز الإشعارات والتنبيهات" : "Notification Center"}
            className="relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/70 hover:border-emerald-500 text-xs font-bold transition shrink-0"
          >
            <Bell className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            {unreadNotificationsCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black tabular-nums leading-none">
                {unreadNotificationsCount}
              </span>
            )}
          </button>
        )}

        {/* Workspace Utilities & Status Menu (Approvals, Drafts, Sync/Offline, Currency, Theme, Lang) */}
        <div className="relative shrink-0" ref={utilitiesRef}>
          <button
            type="button"
            data-testid="topbar-utilities-btn"
            aria-expanded={utilitiesOpen}
            aria-haspopup="menu"
            onClick={() => {
              setProfileOpen(false);
              setUtilitiesOpen((prev) => !prev);
            }}
            title={isAr ? "الأدوات، الحالة، الاعتمادات والمزامنة" : "Workspace Utilities, Status & Sync"}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-extrabold transition ${
              offlineMode || pendingConflictsCount > 0
                ? "border-amber-400/70 bg-amber-50/80 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
                : "border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/70 hover:border-emerald-500 text-slate-700 dark:text-slate-200"
            }`}
          >
            {offlineMode ? (
              <WifiOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            )}
            <span className="hidden lg:inline">
              {offlineMode ? (isAr ? "أوفلاين" : "Offline") : isAr ? "الأدوات" : "Workspace"}
            </span>
            {utilityBadgeCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-black tabular-nums leading-none">
                {utilityBadgeCount}
              </span>
            )}
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {utilitiesOpen && (
            <div
              data-testid="topbar-utilities-popover"
              role="menu"
              className={`absolute ${
                isAr ? "left-0" : "right-0"
              } mt-2 w-80 max-w-[92vw] rounded-2xl card-surface shadow-2xl border border-slate-200 dark:border-slate-700 p-3 z-50 space-y-3`}
            >
              {/* Status & Sync Section */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">
                  {isAr ? "حالة الاتصال والمزامنة" : "Connectivity & Sync"}
                </div>
                <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <button
                    type="button"
                    onClick={onToggleOffline}
                    title={transportBadge || (offlineMode ? dict.offlineBadge : dict.onlineBadge)}
                    className={`flex-1 px-2.5 py-2 text-[11px] font-bold inline-flex items-center justify-center gap-1.5 ${
                      offlineMode
                        ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                        : "text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    {offlineMode ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
                    <span>
                      {transportBadge || (offlineMode ? (isAr ? "أوفلاين" : "Offline") : isAr ? "متصل" : "Online")}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid="topbar-sync-now-btn"
                    onClick={onSyncQueue}
                    title={isAr ? "مزامنة الآن (Sync Now)" : "Sync Now"}
                    className="flex-1 px-2.5 py-2 text-[11px] font-extrabold bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 inline-flex items-center justify-center gap-1.5 border-s border-slate-200 dark:border-slate-700"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{isAr ? "مزامنة الآن" : "Sync Now"}</span>
                    <span className="tabular-nums font-black">{offlineQueueCount}</span>
                    {pendingConflictsCount > 0 && (
                      <span className="px-1 rounded bg-rose-600 text-white text-[9px] font-black">
                        !{pendingConflictsCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Workflows: Approvals & Shared Drafts */}
              {(onOpenApprovalsCenter || onOpenDraftsCenter) && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">
                    {isAr ? "الاعتمادات والمسودات" : "Approvals & Drafts"}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {onOpenApprovalsCenter && (
                      <button
                        type="button"
                        data-testid="topbar-approvals-btn"
                        onClick={() => {
                          setUtilitiesOpen(false);
                          onOpenApprovalsCenter();
                        }}
                        className="px-2.5 py-2 rounded-xl border border-indigo-400/50 bg-indigo-50/60 dark:bg-indigo-950/30 hover:bg-indigo-100/80 text-indigo-800 dark:text-indigo-200 text-[11px] font-extrabold flex items-center justify-between gap-1 transition"
                      >
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{isAr ? "الاعتمادات" : "Approvals"}</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-black tabular-nums leading-none">
                          {pendingApprovalsCount}
                        </span>
                      </button>
                    )}

                    {onOpenDraftsCenter && (
                      <button
                        type="button"
                        data-testid="topbar-drafts-btn"
                        onClick={() => {
                          setUtilitiesOpen(false);
                          onOpenDraftsCenter();
                        }}
                        className="px-2.5 py-2 rounded-xl border border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-100/80 text-amber-800 dark:text-amber-200 text-[11px] font-extrabold flex items-center justify-between gap-1 transition"
                      >
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <FileClock className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{isAr ? "المسودات" : "Drafts"}</span>
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-black tabular-nums leading-none">
                          {draftsCount}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Display Controls: Currency, Theme, Language, Mobile Frame */}
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">
                  {isAr ? "العملة والمظهر واللغة" : "Currency, Theme & Language"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Currency"
                    value={currency}
                    onChange={(e) => onCurrencyChange(e.target.value as CurrencyCode)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-[11px] font-extrabold"
                  >
                    <option value="YER">YER</option>
                    <option value="SAR">SAR</option>
                    <option value="USD">USD</option>
                  </select>

                  <select
                    aria-label="Theme"
                    value={theme}
                    onChange={(e) => onThemeChange(e.target.value as ThemeName)}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-[11px] font-bold"
                  >
                    <option value="emerald">🌿 Emerald</option>
                    <option value="royal">🏛️ Royal</option>
                    <option value="dark">🌙 Dark</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="topbar-lang-toggle-btn"
                    onClick={onToggleLanguage}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-extrabold hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
                  >
                    <Globe2 className="w-3.5 h-3.5" />
                    <span>{isAr ? "English (LTR)" : "العربية (RTL)"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setUtilitiesOpen(false);
                      onToggleMobileSim();
                    }}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1.5"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{mobileSimulatorActive ? (isAr ? "سطح المكتب" : "Desktop") : isAr ? "عرض الجوال" : "Mobile View"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            type="button"
            data-testid="topbar-user-menu-btn"
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            onClick={() => {
              setUtilitiesOpen(false);
              setProfileOpen((prev) => !prev);
            }}
            className="flex items-center gap-2 px-2 py-1 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <SvgAvatar
              char={currentUser.avatarChar}
              avatarUrl={currentUser.avatarUrl}
              color={currentUser.avatarColor}
              size={28}
              alt={currentUser.displayName || currentUser.name}
            />
            <div className="hidden md:block text-start leading-tight max-w-[115px]">
              <div className="text-[11px] font-extrabold truncate">
                {currentUser.displayName || currentUser.name}
              </div>
              <div className="text-[9px] text-slate-500 truncate">
                {isAr ? roleMeta.labelAr : roleMeta.shortEn}
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {profileOpen && (
            <div
              role="menu"
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

              {/* Project Filter inside dropdown for narrow viewports (< xl) */}
              <div className="xl:hidden px-2 py-1.5 space-y-1.5 border-y border-slate-100 dark:border-slate-800">
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
                className="w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <Home className="w-4 h-4 text-slate-500" />
                <span>{isAr ? "الصفحة الرئيسية العامة" : "Public Landing Page"}</span>
              </button>

              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    onLogout();
                  }}
                  className="w-full px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-800/60 transition"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>{isAr ? "تسجيل الخروج" : "Logout"}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

"use client";

import React from "react";
import {
  BarChart3,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Sprout,
  X,
} from "lucide-react";
import { SvgAvatar } from "@/components/SvgAvatar";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { ERP_GROUPS, resolveGroupForTab } from "@/lib/erpNavigation";
import { canAccessModule, getRoleMeta, isReadOnly } from "@/lib/permissions";
import type { ErpGroupId, LanguageCode, TabId, UasEnterpriseProfile, UasUser } from "@/types/uas";

interface SidebarNavProps {
  orgName: string;
  logoText: string;
  enterpriseProfile?: UasEnterpriseProfile | null;
  lang: LanguageCode;
  activeTab: TabId;
  collapsed: boolean;
  mobileOpen: boolean;
  mobileSimulatorActive: boolean;
  currentUser: UasUser;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onSelectGroup: (groupId: ErpGroupId, defaultTab: TabId) => void;
  onSelectSubTab: (tab: TabId) => void;
  onOpenLogin: () => void;
  onLogout?: () => void;
}

const GROUP_ICONS: Record<ErpGroupId, React.ComponentType<{ className?: string }>> = {
  public: LayoutDashboard,
  projects: Sprout,
  commercial: ShoppingBag,
  operations: Briefcase,
  finance: Landmark,
  intelligence: BarChart3,
  admin: Settings2,
};

export function SidebarNav({
  orgName: _orgName,
  logoText,
  enterpriseProfile,
  lang,
  activeTab,
  collapsed,
  mobileOpen,
  mobileSimulatorActive,
  currentUser,
  onToggleCollapse,
  onCloseMobile,
  onSelectGroup,
  onSelectSubTab,
  onOpenLogin,
  onLogout,
}: SidebarNavProps) {
  const isAr = lang === "ar";
  const activeGroup = resolveGroupForTab(activeTab);
  const roleMeta = getRoleMeta(currentUser);
  const readOnly = isReadOnly(currentUser);

  const visibleGroups = ERP_GROUPS.filter((g) => canAccessModule(currentUser, g.id));
  const CollapseIcon = isAr
    ? collapsed
      ? ChevronLeft
      : ChevronRight
    : collapsed
    ? ChevronRight
    : ChevronLeft;

  const sidePositionClass = isAr ? "right-0 border-l" : "left-0 border-r";

  const sidebarContent = (isMobileDrawer: boolean) => {
    const isIconRail = !isMobileDrawer && collapsed;
    return (
      <div className="flex flex-col h-full select-none">
        {/* Brand Header */}
        <div
          className={`h-[60px] px-3.5 border-b border-slate-200 dark:border-slate-700/80 flex items-center ${
            isIconRail ? "justify-center" : "justify-between"
          } gap-2 shrink-0`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <DualLogoBadge
              profile={enterpriseProfile}
              logoText={logoText}
              size="md"
              iconOnly={isIconRail}
            />
            {!isIconRail && (
              <div className="min-w-0">
                <div className="text-xs font-black truncate leading-tight">
                  {(lang === "ar"
                    ? enterpriseProfile?.legalNameAr?.trim() || "اسم المنشأة"
                    : enterpriseProfile?.legalNameEn?.trim() || "Enterprise Name")}
                </div>
                <div className="text-[10px] text-slate-500 font-semibold flex items-center gap-1 mt-0.5">
                  <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span className="truncate font-mono">{activeGroup.domainPath}</span>
                </div>
              </div>
            )}
          </div>

          {isMobileDrawer ? (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation"
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            !isIconRail && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title={isAr ? "طي القائمة الجانبية" : "Collapse sidebar"}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <CollapseIcon className="w-4 h-4" />
              </button>
            )
          )}
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1.5">
          {visibleGroups.map((group) => {
            const Icon = GROUP_ICONS[group.id];
            const isActiveGroup = activeGroup.id === group.id;
            const accessibleSubs = group.subTabs.filter((s) =>
              canAccessModule(currentUser, s.id)
            );
            const targetDefaultTab = accessibleSubs[0]?.id || group.defaultTab;
            const label = isAr ? group.labelAr : group.labelEn;

            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  title={isIconRail ? label : undefined}
                  onClick={() => {
                    onSelectGroup(group.id, targetDefaultTab);
                    if (isMobileDrawer) onCloseMobile();
                  }}
                  className={`group relative w-full flex items-center ${
                    isIconRail ? "justify-center px-2" : "justify-start px-3"
                  } py-2.5 rounded-xl text-xs font-extrabold transition ${
                    isActiveGroup
                      ? "accent-bg shadow-sm"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {!isIconRail && <span className="ms-2.5 truncate">{label}</span>}

                  {/* Floating Tooltip in 72px Collapsed Rail */}
                  {isIconRail && (
                    <span
                      className={`pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute ${
                        isAr ? "right-full mr-3" : "left-full ml-3"
                      } z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold whitespace-nowrap shadow-lg`}
                    >
                      {label}
                    </span>
                  )}
                </button>

                {/* Expanded Sub-Items */}
                {!isIconRail && isActiveGroup && accessibleSubs.length > 0 && (
                  <div className="ms-4 ps-3 border-s-2 border-emerald-500/30 space-y-1 py-0.5">
                    {accessibleSubs.map((sub) => {
                      const isSubActive =
                        activeTab === sub.id ||
                        (sub.id === "sales" && activeTab === "customers");
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            onSelectSubTab(sub.id);
                            if (isMobileDrawer) onCloseMobile();
                          }}
                          className={`w-full text-start px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition ${
                            isSubActive
                              ? "accent-badge font-extrabold"
                              : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
                          }`}
                        >
                          {isAr ? sub.labelAr : sub.labelEn}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer: Active User & Role Card */}
        <div className="p-2.5 border-t border-slate-200 dark:border-slate-700/80 shrink-0 space-y-2">
          {isIconRail ? (
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenLogin}
                title={`${currentUser.name} — ${isAr ? roleMeta.labelAr : roleMeta.shortEn}`}
                className="w-full flex justify-center py-1"
              >
                <SvgAvatar char={currentUser.avatarChar} size={36} />
              </button>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  title={isAr ? "تسجيل الخروج" : "Logout"}
                  aria-label={isAr ? "تسجيل الخروج" : "Logout"}
                  className="p-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-800/60 transition"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70 space-y-2">
              <div className="flex items-center gap-2.5">
                <SvgAvatar char={currentUser.avatarChar} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-extrabold truncate">{currentUser.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {currentUser.department || roleMeta.departmentAr}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold truncate ${roleMeta.badgeClass}`}>
                  {isAr ? roleMeta.labelAr : roleMeta.shortEn}
                </span>
                {readOnly && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-extrabold shrink-0">
                    {isAr ? "قراءة فقط" : "Read-Only"}
                  </span>
                )}
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    if (isMobileDrawer) onCloseMobile();
                    onLogout();
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1.5 text-rose-600 dark:text-rose-400 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-950/50 border border-rose-200/70 dark:border-rose-800/50 transition"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span>{isAr ? "تسجيل الخروج" : "Logout"}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Fixed Collapsible Sidebar (hidden in mobile simulator or < md) */}
      {!mobileSimulatorActive && (
        <aside
          className={`hidden md:flex flex-col fixed top-0 bottom-0 ${sidePositionClass} border-slate-200 dark:border-slate-700/80 card-surface z-30 transition-all duration-200 no-print ${
            collapsed ? "w-[72px]" : "w-[264px]"
          }`}
        >
          {sidebarContent(false)}
        </aside>
      )}

      {/* Mobile / Simulator Slide-Over Sidebar Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex no-print"
          onClick={onCloseMobile}
        >
          <aside
            className={`fixed top-0 bottom-0 ${sidePositionClass} w-[280px] max-w-[85vw] card-surface border-slate-200 dark:border-slate-700 shadow-2xl z-50`}
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}


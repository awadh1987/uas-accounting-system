"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Lock, Receipt, Users } from "lucide-react";
import { CoaTreeTab } from "@/components/CoaTreeTab";
import { CommandSearchModal } from "@/components/CommandSearchModal";
import { FinancialReportsTab } from "@/components/FinancialReportsTab";
import { GeneralLedgerTab } from "@/components/GeneralLedgerTab";
import { LandingPage } from "@/components/LandingPage";
import { LoginView } from "@/components/LoginView";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { ProcurementTab } from "@/components/ProcurementTab";
import { ProjectsManagerTab } from "@/components/ProjectsManagerTab";
import { SidebarNav } from "@/components/SidebarNav";
import { TopCommandBar } from "@/components/TopCommandBar";
import { UserProfileDrawer } from "@/components/UserProfileDrawer";
import { VoucherModal } from "@/components/VoucherModal";
import { AuditTab } from "@/components/tabs/AuditTab";
import { CustomersTab } from "@/components/tabs/CustomersTab";
import { DashboardTab } from "@/components/tabs/DashboardTab";
import { ExpensesTab } from "@/components/tabs/ExpensesTab";
import { InventoryTab } from "@/components/tabs/InventoryTab";
import { MobileTab } from "@/components/tabs/MobileTab";
import { PromptTab } from "@/components/tabs/PromptTab";
import { SalesTab } from "@/components/tabs/SalesTab";
import { SystemTab } from "@/components/tabs/SystemTab";
import { TreasuryTab } from "@/components/tabs/TreasuryTab";
import { WorkersTab } from "@/components/tabs/WorkersTab";
import {
  executeMutation,
  fetchBootstrapState,
  syncQueuedOfflineMutations,
} from "@/lib/apiClient";
import { resolveEffectiveTab, resolveGroupForTab } from "@/lib/erpNavigation";
import { exportFullWorkbookToExcel } from "@/lib/excelExport";
import { fmtNum, type CurrencyCode } from "@/lib/formulas";
import { getDict } from "@/lib/i18n";
import {
  canAccessModule,
  canApprove,
  canEdit,
  canEditDate,
  canLockPeriod,
  canManageLandingCms,
  canManageTreasury,
  canManageUsers,
  canPostLedger,
  filterAssignedProjects,
  getAccessibleTabs,
  getRoleMeta,
  isReadOnly,
} from "@/lib/permissions";
import { INITIAL_FALLBACK_STATE } from "@/lib/seedFallback";
import type {
  LanguageCode,
  TabId,
  ThemeName,
  UasBootstrapState,
  UasEnterpriseProfile,
  UasInstallmentVoucher,
  UasSaleTransaction,
  UasUser,
  UasWorkerWage,
  VoucherModalPayload,
} from "@/types/uas";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function UasAppShell() {
  const [state, setState] = useState<UasBootstrapState>(INITIAL_FALLBACK_STATE);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"landing" | "login" | "erp">("landing");
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [salesViewMode, setSalesViewMode] = useState<"sales" | "customers">("sales");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [lang, setLang] = useState<LanguageCode>("ar");
  const [theme, setTheme] = useState<ThemeName>("emerald");
  const [currency, setCurrency] = useState<CurrencyCode>("YER");
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [mobileSimulatorActive, setMobileSimulatorActive] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState("ALL");
  const [selectedSubProjectId, setSelectedSubProjectId] = useState("ALL");
  const [selectedHarvest, setSelectedHarvest] = useState("ALL");

  const [currentUser, setCurrentUser] = useState<UasUser>(INITIAL_FALLBACK_STATE.users[0]);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [quickSheetOpen, setQuickSheetOpen] = useState(false);
  const [voucherModal, setVoucherModal] = useState<VoucherModalPayload | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  // Initial database bootstrap + offline IndexedDB cache fallback
  useEffect(() => {
    let active = true;
    (async () => {
      const res = await fetchBootstrapState();
      if (!active) return;
      setState(res.state);
      setLang(res.state.settings.defaultLang);
      setTheme(res.state.settings.defaultTheme);
      setCurrency(res.state.settings.defaultCurrency);
      setOfflineQueueCount(res.queueCount);
      if (res.state.users.length > 0) {
        setCurrentUser(res.state.users[0]);
      }
      if (res.fromOfflineCache) {
        setOfflineMode(true);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Register Service Worker & PWA install prompt listener + online listener
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration skipped:", err);
      });
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    const handleOffline = () => {
      setOfflineMode(true);
      showToast("🟠 انقطع الاتصال: تم التحويل إلى الوضع الميداني بدون إنترنت (IndexedDB)");
    };
    const handleOnline = () => {
      setOfflineMode(false);
      showToast("🟢 عاد الاتصال بالشبكة — يمكنك مزامنة العمليات الميدانية");
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [showToast]);

  // Sync HTML dir/lang & Body theme/simulator classes
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    document.body.classList.remove("theme-dark", "theme-royal");
    if (theme === "dark") document.body.classList.add("theme-dark");
    if (theme === "royal") document.body.classList.add("theme-royal");
  }, [theme]);

  useEffect(() => {
    document.body.classList.toggle("mobile-simulator-active", mobileSimulatorActive);
  }, [mobileSimulatorActive]);

  // Global Ctrl+K / Cmd+K Quick Search shortcut in ERP view
  useEffect(() => {
    if (viewMode !== "erp") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewMode]);

  const userReadOnly = isReadOnly(currentUser);
  const userCanApprove = canApprove(currentUser);
  const userCanPost = canPostLedger(currentUser);
  const userCanLock = canLockPeriod(currentUser);
  const userCanManageUsers = canManageUsers(currentUser);
  const userCanManageTreasury = canManageTreasury(currentUser);
  const userCanEditDate = canEditDate(currentUser);
  const roleMeta = getRoleMeta(currentUser);
  const dict = getDict(lang);

  const scopedProjects = useMemo(
    () => filterAssignedProjects(currentUser, state.projects),
    [currentUser, state.projects]
  );

  const scopedProjectIdSet = useMemo(
    () => new Set(scopedProjects.map((p) => p.id)),
    [scopedProjects]
  );

  const availableSubProjects = useMemo(() => {
    if (selectedProjectId === "ALL") {
      return scopedProjects.flatMap((p) => p.subProjects || []);
    }
    const proj = scopedProjects.find((p) => p.id === selectedProjectId);
    return proj ? proj.subProjects || [] : [];
  }, [scopedProjects, selectedProjectId]);

  const availableHarvests = useMemo(() => {
    if (selectedProjectId === "ALL") {
      const set = new Set<string>();
      scopedProjects.forEach((p) => (p.harvests || []).forEach((h) => set.add(h)));
      return Array.from(set);
    }
    const proj = scopedProjects.find((p) => p.id === selectedProjectId);
    return proj ? proj.harvests : [];
  }, [scopedProjects, selectedProjectId]);

  const filterList = useCallback(
    <T extends { projectId: string; harvest: string; subProjectId?: string | null }>(
      list: T[]
    ): T[] =>
      list.filter((item) => {
        if (!scopedProjectIdSet.has(item.projectId)) return false;
        const matchProj =
          selectedProjectId === "ALL" || item.projectId === selectedProjectId;
        const matchSubProj =
          selectedSubProjectId === "ALL" || item.subProjectId === selectedSubProjectId;
        const matchHarv =
          selectedHarvest === "ALL" || item.harvest === selectedHarvest;
        return matchProj && matchSubProj && matchHarv;
      }),
    [scopedProjectIdSet, selectedProjectId, selectedSubProjectId, selectedHarvest]
  );

  const filteredSales = useMemo(() => filterList(state.sales), [filterList, state.sales]);
  const filteredExpenses = useMemo(
    () => filterList(state.expenses),
    [filterList, state.expenses]
  );
  const filteredWorkers = useMemo(
    () => filterList(state.workers),
    [filterList, state.workers]
  );
  const filteredInventoryBatches = useMemo(
    () =>
      state.inventoryBatches.filter((b) => {
        if (!scopedProjectIdSet.has(b.projectId)) return false;
        const matchProj =
          selectedProjectId === "ALL" || b.projectId === selectedProjectId;
        const matchSubProj =
          selectedSubProjectId === "ALL" || b.subProjectId === selectedSubProjectId;
        const matchHarv =
          selectedHarvest === "ALL" || b.harvest === selectedHarvest;
        return matchProj && matchSubProj && matchHarv;
      }),
    [scopedProjectIdSet, selectedProjectId, selectedSubProjectId, selectedHarvest, state.inventoryBatches]
  );

  async function runMutation(
    endpoint: string,
    method: "POST" | "PATCH" | "DELETE",
    payload: Record<string, unknown>,
    label: string,
    successToast: string
  ): Promise<boolean> {
    const res = await executeMutation({
      endpoint,
      method,
      payload,
      label,
      currentState: state,
      currentUser,
      offlineMode,
    });
    setOfflineQueueCount(res.queueCount);
    if (res.error) {
      showToast(res.error);
      return false;
    }
    setState(res.state);
    showToast(
      res.queuedOffline
        ? `${successToast} (تم الحفظ في قائمة المزامنة المحلية #${res.queueCount})`
        : successToast
    );
    return true;
  }

  const refreshFromServer = useCallback(async () => {
    const res = await fetchBootstrapState();
    setState(res.state);
    setOfflineQueueCount(res.queueCount);
  }, []);

  async function handleSyncQueue() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast("لا يوجد اتصال بالإنترنت حالياً لتنفيذ المزامنة");
      return;
    }
    const res = await syncQueuedOfflineMutations(currentUser);
    setState(res.state);
    setOfflineQueueCount(res.remainingQueue);
    setOfflineMode(false);
    showToast(`✅ تمت المزامنة السحابية بنجاح (${res.syncedCount} عمليات)`);
  }

  function handleProjectFilterChange(pid: string) {
    setSelectedProjectId(pid);
    setSelectedSubProjectId("ALL");
    setSelectedHarvest("ALL");
  }

  function handleSubProjectFilterChange(subId: string) {
    setSelectedSubProjectId(subId);
  }

  function openSaleVoucher(s: UasSaleTransaction) {
    const proj = state.projects.find((p) => p.id === s.projectId);
    const projName = proj ? proj.name : "";
    setVoucherModal({
      kind: "sale",
      title: `سند دائن / مدين وفاتورة مبيعات — رقم السند: ${s.voucherNo}`,
      voucherNo: s.voucherNo,
      date: s.date,
      partyLabel: "اسم العميل",
      partyName: s.customer,
      phone: s.phone,
      projectHarvest: `${projName} (${s.harvest})`,
      detailLineLabel: "النوع والعلاقيات",
      detailLineValue: `${s.grade} — ${fmtNum(s.bundles)} × ${fmtNum(s.price)} ريال (${s.batch})`,
      totalAmount: s.total,
      creditAmount: s.credit,
      debitAmount: s.debit,
      notes: s.notes,
      qrPayload: `VOUCHER:${s.voucherNo}|CUST:${s.customer}|TOTAL:${s.total}|CREDIT:${s.credit}|DEBIT:${s.debit}`,
      whatsappText: `النظام المحاسبي الموحد (UAS)\nسند دائن/مدين رقم: ${s.voucherNo}\nالعميل: ${s.customer}\nالمشروع: ${projName} (${s.harvest})\nالإجمالي: ${fmtNum(s.total)} ريال\nالمقبوض (دائن): ${fmtNum(s.credit)} ريال\nالمتبقي (مدين): ${fmtNum(s.debit)} ريال`,
    });
  }

  function openWorkerVoucher(w: UasWorkerWage) {
    const proj = state.projects.find((p) => p.id === w.projectId);
    const projName = proj ? proj.name : "";
    setVoucherModal({
      kind: "worker",
      title: `سند صرف واستحقاق أجور عامل — ${w.name}`,
      voucherNo: `WRK-${w.id}`,
      date: w.date,
      partyLabel: "اسم العامل",
      partyName: w.name,
      phone: "783118231",
      projectHarvest: `${projName} — ${w.harvest}`,
      detailLineLabel: "الأجر اليومي × الأيام",
      detailLineValue: `${fmtNum(w.dailyWage)} × ${fmtNum(w.days)} يوم`,
      totalAmount: w.total,
      creditAmount: w.credit,
      debitAmount: w.debit,
      notes: w.notes,
      qrPayload: `WORKER:${w.name}|DAYS:${w.days}|TOTAL:${w.total}|CREDIT:${w.credit}|DEBIT:${w.debit}`,
      whatsappText: `النظام المحاسبي الموحد (UAS)\nسند استحقاق وصرف أجور عامل: ${w.name}\nالمشروع: ${projName} (${w.harvest})\nالإجمالي: ${fmtNum(w.total)} ريال\nالمسلم (دائن): ${fmtNum(w.credit)} ريال\nالمتبقي (مدين): ${fmtNum(w.debit)} ريال`,
    });
  }

  function openInstallmentModal(inst: UasInstallmentVoucher) {
    const treas = state.treasuryAccounts.find((t) => t.id === inst.treasuryId);
    const typeTitle =
      inst.type === "CUSTOMER_RECEIPT"
        ? "سند قبض دفعة من عميل"
        : "سند صرف دفعة لعامل";
    setVoucherModal({
      kind: "installment",
      title: `${typeTitle} — رقم السند: ${inst.voucherNo}`,
      voucherNo: inst.voucherNo,
      date: inst.date,
      partyLabel: "الطرف المستفيد / الدافع",
      partyName: inst.targetName,
      phone: inst.phone || "783118231",
      projectHarvest: inst.voucherNo,
      detailLineLabel: "البيان",
      detailLineValue: inst.notes || "—",
      treasuryName: treas ? treas.name : "",
      singleAmountYER: inst.amount,
      qrPayload: `INST:${inst.voucherNo}|PARTY:${inst.targetName}|AMT:${inst.amount}|DATE:${inst.date}`,
      whatsappText: `النظام المحاسبي الموحد (UAS)\n${typeTitle}: ${inst.voucherNo}\nالاسم: ${inst.targetName}\nالمبلغ: ${fmtNum(inst.amount)} ريال\nالخزينة/البنك: ${treas ? treas.name : ""}\nالتاريخ: ${inst.date}`,
    });
  }

  async function handleSendWhatsApp(voucher: VoucherModalPayload) {
    const cleanPhone = String(voucher.phone || "783118231").replace(/[^0-9]/g, "");
    const fullPhone = cleanPhone.startsWith("967") ? cleanPhone : `967${cleanPhone}`;
    const url = `https://wa.me/${fullPhone}?text=${encodeURIComponent(voucher.whatsappText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    await runMutation(
      "/api/audit/log",
      "POST",
      {
        action: "إرسال سند عبر واتساب",
        details: `إلى الرقم ${fullPhone} (${voucher.voucherNo})`,
      },
      "WhatsApp dispatch",
      "تم فتح واتساب لإرسال السند للعميل/العامل"
    );
  }

  const navigateToTab = useCallback(
    (nextTab: TabId) => {
      if (nextTab === "customers") {
        if (!canAccessModule(currentUser, "customers")) {
          const fallback = getAccessibleTabs(currentUser)[0] || "dashboard";
          setActiveTab(fallback);
          showToast(
            lang === "ar"
              ? "ليست لديك صلاحية للوصول إلى هذا القسم"
              : "You do not have permission to access this module"
          );
          return;
        }
        setSalesViewMode("customers");
        setActiveTab("customers");
        return;
      }

      const resolved = resolveEffectiveTab(nextTab, currentUser);
      if (!canAccessModule(currentUser, resolved)) {
        const fallback = getAccessibleTabs(currentUser)[0] || "dashboard";
        setActiveTab(fallback);
        showToast(
          lang === "ar"
            ? "ليست لديك صلاحية للوصول إلى هذا القسم"
            : "You do not have permission to access this module"
        );
        return;
      }
      if (resolved === "sales") {
        setSalesViewMode("sales");
      }
      setActiveTab(resolved);
    },
    [currentUser, lang, showToast]
  );

  function handleQuickJump(tab: TabId, targetId: string) {
    setQuickSheetOpen(false);
    navigateToTab(tab);
    setTimeout(() => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
    }, 150);
  }

  function handleLoginUser(u: UasUser) {
    setCurrentUser(u);
    const allowedProjects = filterAssignedProjects(u, state.projects);
    if (
      selectedProjectId !== "ALL" &&
      !allowedProjects.some((p) => p.id === selectedProjectId)
    ) {
      setSelectedProjectId("ALL");
      setSelectedHarvest("ALL");
    }
    if (!canAccessModule(u, activeTab)) {
      const fallback = getAccessibleTabs(u)[0] || "dashboard";
      setActiveTab(fallback);
    }
    setViewMode("erp");
    const uRoleMeta = getRoleMeta(u);
    showToast(
      lang === "ar"
        ? `تم تسجيل الدخول بحساب: ${u.name} (${uRoleMeta.labelAr})`
        : `Signed in as ${u.name} (${uRoleMeta.labelEn})`
    );
  }

  async function handleTriggerPwaInstall() {
    if (deferredInstallPrompt) {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      setDeferredInstallPrompt(null);
      if (choice.outcome === "accepted") {
        showToast("✅ تم تثبيت تطبيق UAS على جهازك بنجاح");
        return;
      }
    }
    showToast(
      '📲 لتثبيت التطبيق على الجوال: افتح قائمة المتصفح واختر "الإضافة إلى الشاشة الرئيسية / Install App"'
    );
  }

  const activeGroup = resolveGroupForTab(activeTab);
  const visibleSubTabs = activeGroup.subTabs.filter((sub) =>
    canAccessModule(currentUser, sub.id)
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Notification Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] no-print">
          <div className="px-5 py-3 rounded-xl shadow-lg bg-emerald-700 text-white text-sm font-semibold flex items-center gap-2">
            <span>{toastMsg}</span>
          </div>
        </div>
      )}

      <VoucherModal
        voucher={voucherModal}
        lang={lang}
        currency={currency}
        exchangeRates={state.exchangeRates}
        logoText={state.settings.logoText}
        onClose={() => setVoucherModal(null)}
        onSendWhatsApp={handleSendWhatsApp}
      />

      <CommandSearchModal
        open={searchModalOpen && viewMode === "erp"}
        onClose={() => setSearchModalOpen(false)}
        state={state}
        lang={lang}
        currentUser={currentUser}
        onNavigate={(tab) => navigateToTab(tab)}
        onSelectProject={(pid) => {
          handleProjectFilterChange(pid);
          navigateToTab("projects");
        }}
      />

      {viewMode === "landing" ? (
        <LandingPage
          state={state}
          lang={lang}
          currentUser={currentUser}
          onEnterErp={(tab) => {
            if (tab) navigateToTab(tab);
            setViewMode("erp");
          }}
          onOpenLogin={() => setViewMode("login")}
          onToggleLang={() => setLang((prev) => (prev === "ar" ? "en" : "ar"))}
        />
      ) : viewMode === "login" ? (
        <LoginView
          users={state.users}
          logoText={state.settings.logoText}
          enterpriseProfile={state.enterpriseProfile}
          lang={lang}
          theme={theme}
          currentUserId={currentUser.id}
          offlineMode={offlineMode}
          onBackToLanding={() => setViewMode("landing")}
          onToggleLang={() => setLang((prev) => (prev === "ar" ? "en" : "ar"))}
          onLoginSuccess={(u) => handleLoginUser(u)}
          onToast={showToast}
        />
      ) : (
        <div id="erpAppFrame" className="min-h-screen flex flex-col bg-slate-50/50 dark:bg-slate-950/30">
          <SidebarNav
            orgName={state.settings.orgName}
            logoText={state.settings.logoText}
            enterpriseProfile={state.enterpriseProfile}
            lang={lang}
            activeTab={activeTab}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            mobileSimulatorActive={mobileSimulatorActive}
            currentUser={currentUser}
            onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            onSelectGroup={(_groupId, defaultTab) => navigateToTab(defaultTab)}
            onSelectSubTab={(tab) => navigateToTab(tab)}
            onOpenLogin={() => setViewMode("login")}
          />

          <div
            className={`flex-1 min-w-0 flex flex-col transition-all duration-200 ${
              !mobileSimulatorActive
                ? sidebarCollapsed
                  ? "md:ps-[72px]"
                  : "md:ps-[264px]"
                : ""
            }`}
          >
            <TopCommandBar
              lang={lang}
              theme={theme}
              currency={currency}
              logoText={state.settings.logoText}
              enterpriseProfile={state.enterpriseProfile}
              offlineMode={offlineMode}
              offlineQueueCount={offlineQueueCount}
              mobileSimulatorActive={mobileSimulatorActive}
              sidebarCollapsed={sidebarCollapsed}
              activeTab={activeTab}
              projects={scopedProjects}
              selectedProjectId={selectedProjectId}
              selectedSubProjectId={selectedSubProjectId}
              availableSubProjects={availableSubProjects}
              selectedHarvest={selectedHarvest}
              availableHarvests={availableHarvests}
              currentUser={currentUser}
              onToggleSidebarCollapse={() => setSidebarCollapsed((c) => !c)}
              onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
              onOpenSearch={() => setSearchModalOpen(true)}
              onProjectChange={handleProjectFilterChange}
              onSubProjectChange={handleSubProjectFilterChange}
              onHarvestChange={setSelectedHarvest}
              onCurrencyChange={(c) => {
                setCurrency(c);
                showToast(`تم تغيير عملة العرض إلى: ${c}`);
              }}
              onToggleOffline={() => {
                const next = !offlineMode;
                setOfflineMode(next);
                showToast(
                  next
                    ? "تم تفعيل وضع العمل الميداني بدون إنترنت (تخزين محلي IndexedDB)"
                    : "تم الاتصال بالشبكة"
                );
              }}
              onSyncQueue={handleSyncQueue}
              onToggleMobileSim={() => {
                const next = !mobileSimulatorActive;
                setMobileSimulatorActive(next);
                showToast(
                  next
                    ? "📱 تم تفعيل محاكي تطبيق الجوال (عرض الهاتف 412px)"
                    : "🖥️ تم العودة لعرض الشاشة الكاملة"
                );
              }}
              onThemeChange={(t) => {
                setTheme(t);
                runMutation(
                  "/api/system/settings",
                  "PATCH",
                  { defaultTheme: t },
                  "Theme change",
                  `تم تغيير المظهر إلى: ${t}`
                );
              }}
              onToggleLanguage={() => {
                const next = lang === "ar" ? "en" : "ar";
                setLang(next);
                runMutation(
                  "/api/system/settings",
                  "PATCH",
                  { defaultLang: next },
                  "Language change",
                  next === "ar" ? "تم التبديل إلى اللغة العربية" : "Switched to English"
                );
              }}
              onOpenLogin={() => setViewMode("login")}
              onOpenLanding={() => setViewMode("landing")}
              onOpenProfileDrawer={() => setProfileDrawerOpen(true)}
            />

            <main className="max-w-7xl w-full mx-auto flex-1 p-4 md:p-6 pb-24 md:pb-8 space-y-5">
              {loading && (
                <div className="card-surface rounded-2xl p-3 text-xs text-center text-slate-500">
                  جاري تحميل البيانات المحاسبية...
                </div>
              )}

              {/* Read-Only Guard Banner for External Auditors */}
              {userReadOnly && (
                <div className="rounded-2xl border border-amber-300 dark:border-amber-700/50 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-2 font-bold">
                    <Eye className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>{dict.readOnlyBanner}</span>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-200/70 dark:bg-amber-900/50 font-extrabold text-[11px]">
                    <Lock className="w-3 h-3" />
                    {roleMeta.labelAr}
                  </span>
                </div>
              )}

              {/* Unified Hub Sub-Tab Bar */}
              {visibleSubTabs.length > 0 && (
                <div className="card-surface rounded-2xl p-2 flex flex-wrap items-center justify-between gap-2 no-print">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {visibleSubTabs.map((sub) => {
                      const isSubActive =
                        activeTab === sub.id ||
                        (sub.id === "sales" && activeTab === "customers");
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => navigateToTab(sub.id)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition ${
                            isSubActive
                              ? "accent-bg shadow-sm"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          {lang === "ar" ? sub.labelAr : sub.labelEn}
                        </button>
                      );
                    })}
                  </div>

                  {/* Inner toggle inside Commercial -> Sales & Clients */}
                  {(activeTab === "sales" || activeTab === "customers") && (
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => {
                          setSalesViewMode("sales");
                          setActiveTab("sales");
                        }}
                        className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                          salesViewMode === "sales" && activeTab !== "customers"
                            ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm"
                            : "text-slate-500"
                        }`}
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        <span>{lang === "ar" ? "فواتير المبيعات" : "Sales Invoices"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSalesViewMode("customers");
                          setActiveTab("customers");
                        }}
                        className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${
                          salesViewMode === "customers" || activeTab === "customers"
                            ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm"
                            : "text-slate-500"
                        }`}
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>{lang === "ar" ? "كشوفات العملاء" : "Client Ledgers"}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "dashboard" && (
                <DashboardTab
                  state={state}
                  lang={lang}
                  currency={currency}
                  selectedProjectId={selectedProjectId}
                  selectedSubProjectId={selectedSubProjectId}
                  filteredSales={filteredSales}
                  filteredExpenses={filteredExpenses}
                  filteredWorkers={filteredWorkers}
                  onExportExcel={() => {
                    exportFullWorkbookToExcel(state);
                    showToast("تم تصدير ملف Excel بنجاح");
                  }}
                  onSwitchTab={navigateToTab}
                  onToast={showToast}
                />
              )}

              {activeTab === "coa" && (
                <CoaTreeTab
                  selectedProjectId={selectedProjectId}
                  readOnly={userReadOnly}
                  canEdit={userCanPost}
                  onToast={showToast}
                />
              )}

              {activeTab === "ledger" && (
                <GeneralLedgerTab
                  projects={scopedProjects}
                  currentUser={currentUser}
                  exchangeRates={state.exchangeRates}
                  selectedProjectId={selectedProjectId}
                  selectedSubProjectId={selectedSubProjectId}
                  readOnly={userReadOnly}
                  canPost={userCanPost}
                  canEditDate={userCanEditDate}
                  onToast={showToast}
                />
              )}

              {activeTab === "procurement" && (
                <ProcurementTab
                  projects={scopedProjects}
                  treasuryAccounts={state.treasuryAccounts}
                  currentUser={currentUser}
                  selectedProjectId={selectedProjectId}
                  selectedSubProjectId={selectedSubProjectId}
                  readOnly={userReadOnly}
                  canApprove={userCanApprove}
                  canEditRecords={canEdit(currentUser, "procurement")}
                  canEditDate={userCanEditDate}
                  onOpenVoucher={setVoucherModal}
                  onRefreshState={refreshFromServer}
                  onToast={showToast}
                />
              )}

              {activeTab === "reports" && (
                <FinancialReportsTab
                  projects={scopedProjects}
                  selectedProjectId={selectedProjectId}
                  selectedSubProjectId={selectedSubProjectId}
                  onToast={showToast}
                />
              )}

              {activeTab === "projects" && (
                <ProjectsManagerTab
                  projects={scopedProjects}
                  treasuryAccounts={state.treasuryAccounts}
                  currentUser={currentUser}
                  lang={lang}
                  readOnly={userReadOnly}
                  canLock={userCanLock}
                  canApprove={userCanApprove}
                  canEditRecords={canEdit(currentUser, "projects")}
                  canEditDate={userCanEditDate}
                  onAddProject={(payload) =>
                    runMutation(
                      "/api/projects",
                      "POST",
                      payload,
                      `مشروع: ${payload.name}`,
                      `تمت إضافة المشروع بنجاح: ${payload.name}`
                    )
                  }
                  onAddHarvest={(payload) =>
                    runMutation(
                      "/api/projects/harvests",
                      "POST",
                      payload,
                      `قطفة: ${payload.name}`,
                      "تمت إضافة القطفة/المرشة بنجاح"
                    )
                  }
                  onTogglePeriodLock={async (key) => {
                    const nextLocked = !state.lockedPeriods[key];
                    await runMutation(
                      "/api/audit/lock",
                      "POST",
                      { key },
                      `قفل فترة ${key}`,
                      nextLocked
                        ? "🔒 تم إغلاق القطفة محاسبياً ومنع التعديل المباشر"
                        : "🔓 تم فتح القطفة للتعديل"
                    );
                  }}
                  onRefreshState={refreshFromServer}
                  onToast={showToast}
                />
              )}

              {activeTab === "expenses" && (
                <ExpensesTab
                  projects={scopedProjects}
                  expenses={filteredExpenses}
                  readOnly={userReadOnly}
                  canEditRecords={canEdit(currentUser, "expenses")}
                  canEditDate={userCanEditDate}
                  onAddExpense={(payload) =>
                    runMutation(
                      "/api/expenses",
                      "POST",
                      payload,
                      `مصروف: ${payload.category}`,
                      "تمت إضافة المصروف التشغيلي بنجاح"
                    )
                  }
                  onEditExpense={(id, payload) =>
                    runMutation(
                      `/api/expenses/${id}`,
                      "PATCH",
                      payload,
                      `تعديل مصروف: ${payload.category}`,
                      "تم تعديل المصروف التشغيلي بنجاح"
                    )
                  }
                  onDeleteExpense={async (id) => {
                    await runMutation(
                      `/api/expenses/${id}`,
                      "DELETE",
                      {},
                      `حذف مصروف ${id}`,
                      "تم حذف المصروف"
                    );
                  }}
                />
              )}

              {activeTab === "workers" && (
                <WorkersTab
                  projects={scopedProjects}
                  workers={filteredWorkers}
                  allWorkers={state.workers}
                  readOnly={userReadOnly}
                  canEditRecords={canEdit(currentUser, "workers")}
                  canEditDate={userCanEditDate}
                  onAddWorker={(payload) =>
                    runMutation(
                      "/api/workers",
                      "POST",
                      payload,
                      `أجر عامل: ${payload.name}`,
                      `تمت إضافة سجل العامل: ${payload.name}`
                    )
                  }
                  onEditWorker={(id, payload) =>
                    runMutation(
                      `/api/workers/${id}`,
                      "PATCH",
                      payload,
                      `تعديل سجل عامل: ${payload.name}`,
                      "تم تعديل سجل أجر العامل بنجاح"
                    )
                  }
                  onDeleteWorker={async (id) => {
                    await runMutation(
                      `/api/workers/${id}`,
                      "DELETE",
                      {},
                      `حذف سجل عامل ${id}`,
                      "تم حذف سجل العامل"
                    );
                  }}
                  onOpenWorkerVoucher={openWorkerVoucher}
                  onExportWorkerExcel={(workerFilter) => {
                    exportFullWorkbookToExcel(state, { workerFilter });
                    showToast("تم تصدير كشف حساب العمال إلى Excel بنجاح");
                  }}
                  onToast={showToast}
                />
              )}

              {activeTab === "sales" && (
                <SalesTab
                  projects={scopedProjects}
                  sales={filteredSales}
                  treasuryAccounts={state.treasuryAccounts}
                  currentUser={currentUser}
                  readOnly={userReadOnly}
                  canEditRecords={canEdit(currentUser, "sales")}
                  canEditDate={userCanEditDate}
                  onAddSale={(payload) =>
                    runMutation(
                      "/api/sales",
                      "POST",
                      payload,
                      `عملية بيع: ${payload.customer}`,
                      `تم حفظ عملية البيع للعميل: ${payload.customer}`
                    )
                  }
                  onEditSale={(id, payload) =>
                    runMutation(
                      `/api/sales/${id}`,
                      "PATCH",
                      payload,
                      `تعديل بيع: ${payload.customer}`,
                      "تم تعديل عملية البيع بنجاح"
                    )
                  }
                  onDeleteSale={async (id) => {
                    await runMutation(
                      `/api/sales/${id}`,
                      "DELETE",
                      {},
                      `حذف بيع ${id}`,
                      "تم حذف عملية البيع"
                    );
                  }}
                  onOpenSaleVoucher={openSaleVoucher}
                  onToast={showToast}
                />
              )}

              {activeTab === "customers" && (
                <CustomersTab
                  projects={scopedProjects}
                  sales={filteredSales}
                  allSales={state.sales}
                  currentUser={currentUser}
                  readOnly={userReadOnly}
                  canEditRecords={canEdit(currentUser, "customers")}
                  onOpenSaleVoucher={openSaleVoucher}
                  onExportCustomerExcel={(customerFilter) => {
                    exportFullWorkbookToExcel(state, { customerFilter });
                    showToast("تم تصدير كشف العملاء إلى Excel بنجاح");
                  }}
                  onToast={showToast}
                />
              )}

              {activeTab === "system" && (
                <SystemTab
                  settings={state.settings}
                  enterpriseProfile={state.enterpriseProfile}
                  lang={lang}
                  theme={theme}
                  currentUser={currentUser}
                  users={state.users}
                  projects={state.projects}
                  onRefreshState={refreshFromServer}
                  readOnly={userReadOnly}
                  canManageUsers={userCanManageUsers}
                  canManageCms={canManageLandingCms(currentUser)}
                  onSaveBranding={async (orgName, logoText) => {
                    await runMutation(
                      "/api/system/settings",
                      "PATCH",
                      { orgName, logoText },
                      "إعدادات النظام",
                      "تم حفظ شعار وإعدادات النظام"
                    );
                  }}
                  onSaveEnterpriseBranding={async (payload: Partial<UasEnterpriseProfile>) => {
                    try {
                      const res = await fetch("/api/system/branding", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ...payload,
                          actor: {
                            userId: currentUser.id,
                            userDisplay: currentUser.name,
                            userRole: currentUser.role,
                          },
                        }),
                      });
                      const data = (await res.json()) as {
                        error?: string;
                        state?: UasBootstrapState;
                        enterpriseProfile?: UasEnterpriseProfile;
                      };
                      if (!res.ok) {
                        showToast(data.error || "تعذر حفظ الهوية المؤسسية");
                        return;
                      }
                      if (data.state) {
                        setState(data.state);
                      } else if (data.enterpriseProfile) {
                        setState((prev) => ({
                          ...prev,
                          enterpriseProfile: data.enterpriseProfile,
                        }));
                      }
                      showToast(
                        lang === "ar"
                          ? "✅ تم حفظ الهوية المؤسسية والشعار ومحتوى الصفحة الرئيسية"
                          : "✅ Enterprise branding & Landing CMS saved"
                      );
                    } catch {
                      showToast(
                        lang === "ar"
                          ? "تعذر الاتصال بالخادم لحفظ الهوية المؤسسية"
                          : "Network error while saving branding"
                      );
                    }
                  }}
                  onChangeLang={(next) => {
                    setLang(next);
                    runMutation(
                      "/api/system/settings",
                      "PATCH",
                      { defaultLang: next },
                      "Language change",
                      next === "ar" ? "تم التبديل إلى اللغة العربية" : "Switched to English"
                    );
                  }}
                  onChangeTheme={(next) => {
                    setTheme(next);
                    runMutation(
                      "/api/system/settings",
                      "PATCH",
                      { defaultTheme: next },
                      "Theme change",
                      `تم تغيير المظهر إلى: ${next}`
                    );
                  }}
                  onUpdateProfile={async (payload) => {
                    const ok = await runMutation(
                      `/api/users/${payload.userId}`,
                      "PATCH",
                      {
                        name: payload.name,
                        avatarChar: payload.avatarChar,
                        ...(payload.newPassword ? { newPassword: payload.newPassword } : {}),
                      },
                      "تحديث الملف الشخصي",
                      "تم تحديث الملف الشخصي وإعادة تعيين كلمة المرور بنجاح"
                    );
                    if (ok) {
                      setCurrentUser((prev) => ({
                        ...prev,
                        name: payload.name || prev.name,
                        avatarChar: payload.avatarChar || prev.avatarChar,
                      }));
                    }
                  }}
                  onAddUser={(payload) =>
                    runMutation(
                      "/api/users",
                      "POST",
                      payload,
                      `مستخدم: ${payload.name}`,
                      "تمت إضافة المستخدم بنجاح"
                    )
                  }
                  onToggleUserStatus={async (uid) => {
                    await runMutation(
                      `/api/users/${uid}`,
                      "PATCH",
                      { toggleActive: true },
                      `تغيير حالة مستخدم ${uid}`,
                      "تم تحديث حالة المستخدم"
                    );
                  }}
                  onOpenLogin={() => setViewMode("login")}
                  onToast={showToast}
                />
              )}

              {activeTab === "treasury" && (
                <TreasuryTab
                  currency={currency}
                  exchangeRates={state.exchangeRates}
                  treasuryAccounts={state.treasuryAccounts}
                  installments={state.installments}
                  sales={state.sales}
                  workers={state.workers}
                  currentUser={currentUser}
                  readOnly={userReadOnly}
                  canManageTreasury={userCanManageTreasury}
                  canEditDate={userCanEditDate}
                  onAddInstallment={(payload) =>
                    runMutation(
                      "/api/installments",
                      "POST",
                      payload,
                      `سند ${payload.voucherNo}`,
                      `تم حفظ السند ${payload.voucherNo} وتحديث الرصيد بنجاح`
                    )
                  }
                  onRefreshState={refreshFromServer}
                  onOpenInstallmentModal={openInstallmentModal}
                  onExportExcel={() => {
                    exportFullWorkbookToExcel(state);
                    showToast("تم تصدير ملف Excel بنجاح");
                  }}
                  onToast={showToast}
                />
              )}

              {activeTab === "inventory" && (
                <InventoryTab
                  projects={scopedProjects}
                  inventoryBatches={filteredInventoryBatches}
                  sales={state.sales}
                  readOnly={userReadOnly}
                  canEditRecords={canEdit(currentUser, "inventory")}
                  onAddInventoryBatch={(payload) =>
                    runMutation(
                      "/api/inventory",
                      "POST",
                      payload,
                      `مخزون ${payload.harvest}`,
                      "تم تسجيل دفعة الحصاد في المخزون بنجاح"
                    )
                  }
                  onEditInventoryBatch={(payload) =>
                    runMutation(
                      "/api/inventory",
                      "PATCH",
                      payload,
                      `تعديل مخزون ${payload.harvest}`,
                      "تم تعديل دفعة الحصاد والمخزون بنجاح"
                    )
                  }
                />
              )}

              {activeTab === "audit" && (
                <AuditTab
                  projects={scopedProjects}
                  lockedPeriods={state.lockedPeriods}
                  auditLogs={state.auditLogs}
                  readOnly={userReadOnly}
                  canLock={userCanLock}
                  canPost={userCanPost}
                  onTogglePeriodLock={async (key) => {
                    const nextLocked = !state.lockedPeriods[key];
                    await runMutation(
                      "/api/audit/lock",
                      "POST",
                      { key },
                      `قفل فترة ${key}`,
                      nextLocked
                        ? "🔒 تم إغلاق القطفة محاسبياً ومنع التعديل المباشر"
                        : "🔓 تم فتح القطفة للتعديل"
                    );
                  }}
                  onPostAdjustment={(payload) =>
                    runMutation(
                      "/api/audit/adjustments",
                      "POST",
                      payload,
                      "قيد تسوية",
                      "تم ترحيل قيد التسوية وتوثيقه في سجل الرقابة"
                    )
                  }
                  onExportExcel={() => {
                    exportFullWorkbookToExcel(state);
                    showToast("تم تصدير ملف Excel بنجاح");
                  }}
                  onToast={showToast}
                />
              )}

              {activeTab === "mobile" && (
                <MobileTab
                  canInstallPwa={Boolean(deferredInstallPrompt)}
                  offlineMode={offlineMode}
                  offlineQueueCount={offlineQueueCount}
                  onToggleMobileSim={() => {
                    const next = !mobileSimulatorActive;
                    setMobileSimulatorActive(next);
                    showToast(
                      next
                        ? "📱 تم تفعيل محاكي تطبيق الجوال (عرض الهاتف 412px)"
                        : "🖥️ تم العودة لعرض الشاشة الكاملة"
                    );
                  }}
                  onOpenQuickSheet={() => setQuickSheetOpen(true)}
                  onTriggerPwaInstall={handleTriggerPwaInstall}
                  onSyncQueue={handleSyncQueue}
                  onSwitchTab={navigateToTab}
                  onToast={showToast}
                />
              )}

              {activeTab === "prompt" && <PromptTab onToast={showToast} />}
            </main>
          </div>

          <MobileBottomNav
            activeTab={activeTab}
            lang={lang}
            quickSheetOpen={quickSheetOpen}
            currentUser={currentUser}
            mobileSimulatorActive={mobileSimulatorActive}
            onSwitchTab={navigateToTab}
            onOpenQuickSheet={() => setQuickSheetOpen(true)}
            onCloseQuickSheet={() => setQuickSheetOpen(false)}
            onQuickJump={handleQuickJump}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          />

          <UserProfileDrawer
            open={profileDrawerOpen}
            onClose={() => setProfileDrawerOpen(false)}
            currentUser={currentUser}
            lang={lang}
            theme={theme}
            currency={currency}
            projects={state.projects}
            onUserUpdated={(updatedUser) => {
              setCurrentUser(updatedUser);
              setState((prev) => ({
                ...prev,
                users: prev.users.map((u) => (u.id === updatedUser.id ? updatedUser : u)),
              }));
            }}
            onChangeLang={(next) => {
              setLang(next);
              runMutation(
                "/api/system/settings",
                "PATCH",
                { defaultLang: next },
                "Language change",
                next === "ar" ? "تم التبديل إلى اللغة العربية" : "Switched to English"
              );
            }}
            onChangeTheme={(next) => {
              setTheme(next);
              runMutation(
                "/api/system/settings",
                "PATCH",
                { defaultTheme: next },
                "Theme change",
                `تم تغيير المظهر إلى: ${next}`
              );
            }}
            onChangeCurrency={(next) => {
              setCurrency(next);
              showToast(`تم تغيير عملة العرض إلى: ${next}`);
            }}
            onToast={showToast}
          />
        </div>
      )}
    </div>
  );
}


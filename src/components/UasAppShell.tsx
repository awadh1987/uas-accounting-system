"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CoaTreeTab } from "@/components/CoaTreeTab";
import { FinancialReportsTab } from "@/components/FinancialReportsTab";
import { GeneralLedgerTab } from "@/components/GeneralLedgerTab";
import { HeaderNav } from "@/components/HeaderNav";
import { LandingPage } from "@/components/LandingPage";
import { LoginModal } from "@/components/LoginModal";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { ProcurementTab } from "@/components/ProcurementTab";
import { ProjectsManagerTab } from "@/components/ProjectsManagerTab";
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
import { exportFullWorkbookToExcel } from "@/lib/excelExport";
import { fmtNum, type CurrencyCode } from "@/lib/formulas";
import { INITIAL_FALLBACK_STATE } from "@/lib/seedFallback";
import type {
  LanguageCode,
  TabId,
  ThemeName,
  UasBootstrapState,
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
  const [viewMode, setViewMode] = useState<"landing" | "erp">("landing");
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [lang, setLang] = useState<LanguageCode>("ar");
  const [theme, setTheme] = useState<ThemeName>("emerald");
  const [currency, setCurrency] = useState<CurrencyCode>("YER");
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [mobileSimulatorActive, setMobileSimulatorActive] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState("ALL");
  const [selectedHarvest, setSelectedHarvest] = useState("ALL");

  const [currentUser, setCurrentUser] = useState<UasUser>(INITIAL_FALLBACK_STATE.users[0]);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
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

  const availableHarvests = useMemo(() => {
    if (selectedProjectId === "ALL") {
      const set = new Set<string>();
      state.projects.forEach((p) => (p.harvests || []).forEach((h) => set.add(h)));
      return Array.from(set);
    }
    const proj = state.projects.find((p) => p.id === selectedProjectId);
    return proj ? proj.harvests : [];
  }, [state.projects, selectedProjectId]);

  const filterList = useCallback(
    <T extends { projectId: string; harvest: string }>(list: T[]): T[] =>
      list.filter((item) => {
        const matchProj =
          selectedProjectId === "ALL" || item.projectId === selectedProjectId;
        const matchHarv =
          selectedHarvest === "ALL" || item.harvest === selectedHarvest;
        return matchProj && matchHarv;
      }),
    [selectedProjectId, selectedHarvest]
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
    setSelectedHarvest("ALL");
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

  function handleQuickJump(tab: TabId, targetId: string) {
    setQuickSheetOpen(false);
    setActiveTab(tab);
    setTimeout(() => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
    }, 120);
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

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Notification Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 no-print">
          <div className="px-5 py-3 rounded-xl shadow-lg bg-emerald-700 text-white text-sm font-semibold flex items-center gap-2">
            <span>{toastMsg}</span>
          </div>
        </div>
      )}

      <LoginModal
        open={loginModalOpen}
        users={state.users}
        logoText={state.settings.logoText}
        currentUserId={currentUser.id}
        offlineMode={offlineMode}
        onClose={() => setLoginModalOpen(false)}
        onLoginSuccess={(u) => {
          setCurrentUser(u);
          setViewMode("erp");
          showToast(`تم تسجيل الدخول بحساب: ${u.name}`);
        }}
        onToast={showToast}
      />

      <VoucherModal
        voucher={voucherModal}
        lang={lang}
        currency={currency}
        exchangeRates={state.exchangeRates}
        logoText={state.settings.logoText}
        onClose={() => setVoucherModal(null)}
        onSendWhatsApp={handleSendWhatsApp}
      />

      {viewMode === "landing" ? (
        <LandingPage
          state={state}
          lang={lang}
          currentUser={currentUser}
          onEnterErp={(tab) => {
            if (tab) setActiveTab(tab);
            setViewMode("erp");
          }}
          onOpenLogin={() => setLoginModalOpen(true)}
          onToggleLang={() => setLang((prev) => (prev === "ar" ? "en" : "ar"))}
        />
      ) : (
        <>
          <HeaderNav
            orgName={state.settings.orgName}
            logoText={state.settings.logoText}
            lang={lang}
            theme={theme}
            currency={currency}
            offlineMode={offlineMode}
            offlineQueueCount={offlineQueueCount}
            mobileSimulatorActive={mobileSimulatorActive}
            activeTab={activeTab}
            projects={state.projects}
            selectedProjectId={selectedProjectId}
            selectedHarvest={selectedHarvest}
            availableHarvests={availableHarvests}
            currentUser={currentUser}
            onProjectChange={handleProjectFilterChange}
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
            onOpenLogin={() => setLoginModalOpen(true)}
            onOpenLanding={() => setViewMode("landing")}
            onSwitchTab={setActiveTab}
          />

          <main className="max-w-7xl w-full mx-auto flex-1 p-4 space-y-6">
            {loading && (
              <div className="card-surface rounded-2xl p-3 text-xs text-center text-slate-500">
                جاري تحميل البيانات المحاسبية...
              </div>
            )}

            {activeTab === "dashboard" && (
              <DashboardTab
                state={state}
                lang={lang}
                currency={currency}
                selectedProjectId={selectedProjectId}
                filteredSales={filteredSales}
                filteredExpenses={filteredExpenses}
                filteredWorkers={filteredWorkers}
                onExportExcel={() => {
                  exportFullWorkbookToExcel(state);
                  showToast("تم تصدير ملف Excel بنجاح");
                }}
                onSwitchTab={setActiveTab}
                onToast={showToast}
              />
            )}

            {activeTab === "coa" && (
              <CoaTreeTab selectedProjectId={selectedProjectId} onToast={showToast} />
            )}

            {activeTab === "ledger" && (
              <GeneralLedgerTab
                projects={state.projects}
                currentUser={currentUser}
                exchangeRates={state.exchangeRates}
                selectedProjectId={selectedProjectId}
                onToast={showToast}
              />
            )}

            {activeTab === "procurement" && (
              <ProcurementTab
                projects={state.projects}
                treasuryAccounts={state.treasuryAccounts}
                currentUser={currentUser}
                selectedProjectId={selectedProjectId}
                onOpenVoucher={setVoucherModal}
                onRefreshState={refreshFromServer}
                onToast={showToast}
              />
            )}

            {activeTab === "reports" && (
              <FinancialReportsTab
                projects={state.projects}
                selectedProjectId={selectedProjectId}
                onToast={showToast}
              />
            )}

            {activeTab === "projects" && (
              <ProjectsManagerTab
                projects={state.projects}
                lang={lang}
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
            projects={state.projects}
            expenses={filteredExpenses}
            onAddExpense={(payload) =>
              runMutation(
                "/api/expenses",
                "POST",
                payload,
                `مصروف: ${payload.category}`,
                "تمت إضافة المصروف التشغيلي بنجاح"
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
            projects={state.projects}
            workers={filteredWorkers}
            allWorkers={state.workers}
            onAddWorker={(payload) =>
              runMutation(
                "/api/workers",
                "POST",
                payload,
                `أجر عامل: ${payload.name}`,
                `تمت إضافة سجل العامل: ${payload.name}`
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
            projects={state.projects}
            sales={filteredSales}
            onAddSale={(payload) =>
              runMutation(
                "/api/sales",
                "POST",
                payload,
                `عملية بيع: ${payload.customer}`,
                `تم حفظ عملية البيع للعميل: ${payload.customer}`
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
            projects={state.projects}
            sales={filteredSales}
            allSales={state.sales}
            onOpenSaleVoucher={openSaleVoucher}
            onExportCustomerExcel={(customerFilter) => {
              exportFullWorkbookToExcel(state, { customerFilter });
              showToast("تم تصدير كشف العملاء إلى Excel بنجاح");
            }}
          />
        )}

        {activeTab === "system" && (
          <SystemTab
            settings={state.settings}
            lang={lang}
            theme={theme}
            currentUser={currentUser}
            users={state.users}
            onSaveBranding={async (orgName, logoText) => {
              await runMutation(
                "/api/system/settings",
                "PATCH",
                { orgName, logoText },
                "إعدادات النظام",
                "تم حفظ شعار وإعدادات النظام"
              );
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
            onOpenLogin={() => setLoginModalOpen(true)}
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
            onAddInstallment={(payload) =>
              runMutation(
                "/api/installments",
                "POST",
                payload,
                `سند ${payload.voucherNo}`,
                `تم حفظ السند ${payload.voucherNo} وتحديث الرصيد بنجاح`
              )
            }
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
            projects={state.projects}
            inventoryBatches={state.inventoryBatches}
            sales={state.sales}
            onAddInventoryBatch={(payload) =>
              runMutation(
                "/api/inventory",
                "POST",
                payload,
                `مخزون ${payload.harvest}`,
                "تم تسجيل دفعة الحصاد في المخزون بنجاح"
              )
            }
          />
        )}

        {activeTab === "audit" && (
          <AuditTab
            projects={state.projects}
            lockedPeriods={state.lockedPeriods}
            auditLogs={state.auditLogs}
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
            onSwitchTab={setActiveTab}
            onToast={showToast}
          />
        )}

        {activeTab === "prompt" && <PromptTab onToast={showToast} />}
      </main>

          <MobileBottomNav
            activeTab={activeTab}
            lang={lang}
            quickSheetOpen={quickSheetOpen}
            onSwitchTab={setActiveTab}
            onOpenQuickSheet={() => setQuickSheetOpen(true)}
            onCloseQuickSheet={() => setQuickSheetOpen(false)}
            onQuickJump={handleQuickJump}
          />
        </>
      )}
    </div>
  );
}


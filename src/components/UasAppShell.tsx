"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Globe, Lock, Receipt, Users } from "lucide-react";
import { CoaTreeTab } from "@/components/CoaTreeTab";
import { CommercialSectorWorkspace } from "@/components/CommercialSectorWorkspace";
import { CommandSearchModal } from "@/components/CommandSearchModal";
import { FinancialReportsTab } from "@/components/FinancialReportsTab";
import { ForcePasswordChangeModal } from "@/components/ForcePasswordChangeModal";
import { GeneralLedgerTab } from "@/components/GeneralLedgerTab";
import { LandingPage } from "@/components/LandingPage";
import { LicenseActivationModal, type LicenseStatusData } from "@/components/LicenseActivationModal";
import { LoginView } from "@/components/LoginView";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { ProcurementTab } from "@/components/ProcurementTab";
import { ProjectsManagerTab } from "@/components/ProjectsManagerTab";
import { SidebarNav } from "@/components/SidebarNav";
import { TopCommandBar } from "@/components/TopCommandBar";
import { SharedDraftsCenterDrawer } from "@/components/SharedDraftsCenterDrawer";
import { ApprovalsCenter, APPROVALS_CHANGED_EVENT } from "@/components/ApprovalsCenter";
import { DRAFTS_CHANGED_EVENT } from "@/hooks/useFormDraft";
import { UasAiCopilot } from "@/components/UasAiCopilot";
import { UserProfileDrawer } from "@/components/UserProfileDrawer";
import { NotificationCenterDrawer } from "@/components/NotificationCenterDrawer";
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
import { TabErrorBoundary } from "@/components/TabErrorBoundary";
import { ClientPortalApp } from "@/components/client-portal/ClientPortalApp";
import { resolveCanonicalPortalPath } from "@/lib/clientPortal/portalRoutes";
import {
  resolveCanonicalWorkspacePath,
  resolveWorkspaceRouteSection,
} from "@/lib/tenant/workspaceRoutes";
import {
  executeMutation,
  fetchBootstrapState,
  getApiBaseUrl,
  getStoredRuntimeMode,
  installGlobalApiFetchInterceptor,
  isNativeAndroid,
  resolveApiBaseUrl,
  safeFetchJson,
  setStoredLicenseKeyId,
  setStoredSessionToken,
  setStoredTenantId,
  setStoredTenantSlug,
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
import { isInstalledClientApp } from "@/lib/runtimePlatform";
import {
  buildOfflineClientLicenseStatus,
  detectClientPlatform,
  getClientDeviceHwid,
  recordOfflineLicenseGovernance,
} from "@/lib/licensing";
import { openExternalOrWhatsApp } from "@/lib/nativeBridge";
import { INITIAL_FALLBACK_STATE } from "@/lib/seedFallback";
import { performManualSyncNow, startAutoSyncController } from "@/lib/sync/clientSyncManager";
import { resolveTransportTarget } from "@/lib/transportResolver";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";
import { resolveEffectiveBrandInfo } from "@/lib/branding";
import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  normalizeThemePreset,
  readStoredThemePreset,
} from "@/lib/themeEngine";
import { setActivePrintEnterpriseProfile } from "@/lib/print/uasDocumentPrinter";
import { resolveExportSignature, setActiveClientExportActor } from "@/lib/uiFormatters";
import {
  ensureNotificationChannelsAndPermission,
  flushQueuedNotifications,
} from "@/lib/notifications/clientNotificationBridge";
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
  const [viewMode, setViewMode] = useState<"landing" | "login" | "erp" | "client_portal">(() => {
    if (typeof window !== "undefined") {
      try {
        const sp = new URLSearchParams(window.location.search);
        if (sp.get("portal") === "client") return "client_portal";
      } catch {
        // ignore
      }
    }
    return isInstalledClientApp() ? "login" : "landing";
  });
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [salesViewMode, setSalesViewMode] = useState<"sales" | "customers">("sales");
  const [clientPortalInitialTab, setClientPortalInitialTab] = useState<"login" | "register">(() => {
    if (typeof window !== "undefined") {
      try {
        if (new URLSearchParams(window.location.search).get("tab") === "register") {
          return "register";
        }
      } catch {
        // ignore
      }
    }
    return "login";
  });
  const [clientPortalInitialSection, setClientPortalInitialSection] = useState<
    "catalog" | "new_request" | "requests" | "statement" | "profile"
  >(() => {
    if (typeof window !== "undefined") {
      try {
        const sec = (
          new URLSearchParams(window.location.search).get("section") ||
          new URLSearchParams(window.location.search).get("portalTab") ||
          ""
        ).trim();
        if (
          sec === "catalog" ||
          sec === "new_request" ||
          sec === "requests" ||
          sec === "statement" ||
          sec === "profile"
        ) {
          return sec;
        }
      } catch {
        // ignore
      }
    }
    return "new_request";
  });
  const [customersInitialSection, setCustomersInitialSection] = useState<
    "cards" | "ledger" | "both" | "portal" | "whatsapp"
  >("cards");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [lang, setLang] = useState<LanguageCode>("ar");
  const [theme, setTheme] = useState<ThemeName>(() =>
    readStoredThemePreset(THEME_STORAGE_KEY, "emerald")
  );
  const [currency, setCurrency] = useState<CurrencyCode>("YER");
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [mobileSimulatorActive, setMobileSimulatorActive] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState("ALL");
  const [selectedSubProjectId, setSelectedSubProjectId] = useState("ALL");
  const [selectedHarvest, setSelectedHarvest] = useState("ALL");
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<UasUser | null>(null);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [draftsDrawerOpen, setDraftsDrawerOpen] = useState(false);
  const [draftsCount, setDraftsCount] = useState(0);
  const [approvalsDrawerOpen, setApprovalsDrawerOpen] = useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [pendingConflictsCount, setPendingConflictsCount] = useState(0);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatusData | null>(null);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [quickSheetOpen, setQuickSheetOpen] = useState(false);
  const [activeTradingSector, setActiveTradingSector] = useState<"HARVEST" | "COMMERCIAL">("HARVEST");
  const [voucherModal, setVoucherModal] = useState<VoucherModalPayload | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  const hydratedRef = useRef(false);
  const preferHarvestPathRef = useRef(false);

  useEffect(() => {
    if (!currentUser) return;
    const refreshDraftCount = () => {
      fetch(`/api/drafts?userId=${encodeURIComponent(currentUser.id)}&userRole=${encodeURIComponent(currentUser.role)}`, {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : { activeCount: 0 }))
        .then((d: { activeCount?: number; drafts?: unknown[] }) =>
          setDraftsCount(d.activeCount ?? d.drafts?.length ?? 0)
        )
        .catch(() => undefined);
    };
    refreshDraftCount();
    window.addEventListener(DRAFTS_CHANGED_EVENT, refreshDraftCount);
    const refreshApprovalsCount = () => {
      fetch("/api/approvals?status=PENDING", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { pendingCount: 0 }))
        .then((d: { pendingCount?: number; requests?: unknown[] }) =>
          setPendingApprovalsCount(d.pendingCount ?? d.requests?.length ?? 0)
        )
        .catch(() => undefined);
    };
    refreshApprovalsCount();
    window.addEventListener(APPROVALS_CHANGED_EVENT, refreshApprovalsCount);

    const refreshNotificationsCount = () => {
      safeFetchJson<{ unreadCount?: number }>(
        `/api/notifications?unreadOnly=true&userId=${encodeURIComponent(currentUser.id)}`,
        { cache: "no-store" }
      )
        .then((res) => {
          if (res.ok && typeof res.data?.unreadCount === "number") {
            setUnreadNotificationsCount(res.data.unreadCount);
          }
        })
        .catch(() => undefined);
    };
    refreshNotificationsCount();
    void ensureNotificationChannelsAndPermission().then(() => {
      flushQueuedNotifications();
    });

    const stopAutoSync = startAutoSyncController({
      currentUser,
      enabled: state.settings.autoSyncEnabled !== false,
      intervalSec: state.settings.autoSyncIntervalSec || 60,
      onSyncCompleteAction: (syncRes) => {
        setState(syncRes.state);
        setOfflineQueueCount(syncRes.remainingQueue);
        setPendingConflictsCount(syncRes.conflictCount);
        refreshNotificationsCount();
      },
    });

    return () => {
      window.removeEventListener(DRAFTS_CHANGED_EVENT, refreshDraftCount);
      window.removeEventListener(APPROVALS_CHANGED_EVENT, refreshApprovalsCount);
      stopAutoSync();
    };
  }, [currentUser, state.settings.autoSyncEnabled, state.settings.autoSyncIntervalSec]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRevoked = () => {
      setCurrentUser(null);
      setViewMode("login");
      showToast(
        lang === "ar"
          ? "⛔ تم إلغاء صلاحية هذا الجهاز من قبل مسؤول المنشأة — يرجى التواصل مع الإدارة."
          : "⛔ This device has been revoked by your tenant administrator."
      );
    };
    window.addEventListener("uas:device-revoked", handleRevoked);
    return () => window.removeEventListener("uas:device-revoked", handleRevoked);
  }, [lang, showToast]);

  const checkLicensingStatus = useCallback(async () => {
    const onAndroid = isNativeAndroid();
    const base = resolveApiBaseUrl();

    // On Android APK, evaluate local persisted license first so offline `.uas` / `UASKEY-...` activations
    // and selected Cloud/LAN modes remain authoritative without hitting https://localhost/api/* HTML fallback.
    if (onAndroid) {
      try {
        const offlineStatus = (await buildOfflineClientLicenseStatus()) as LicenseStatusData;
        if (offlineStatus.license_id) {
          setStoredLicenseKeyId(offlineStatus.license_id);
        }
        if (offlineStatus.is_valid || !base) {
          setLicenseStatus(offlineStatus);
          return;
        }
      } catch {
        // continue to remote check
      }
    }

    try {
      const res = await safeFetchJson<LicenseStatusData>(`${base}/api/licensing/status`);
      if (res.ok && !res.isHtmlFallback && res.data) {
        if (res.data.license_id) {
          setStoredLicenseKeyId(res.data.license_id);
        }
        recordOfflineLicenseGovernance({
          licenseId: res.data.license_id,
          status: res.data.license_status,
          reason: res.data.error,
        });
        const merged: LicenseStatusData = onAndroid
          ? { ...res.data, active_mode: getStoredRuntimeMode() }
          : res.data;
        setLicenseStatus(merged);
        return;
      }
    } catch {
      // Fall through to offline client license evaluator
    }
    try {
      const offlineStatus = (await buildOfflineClientLicenseStatus()) as LicenseStatusData;
      if (offlineStatus.license_id) {
        setStoredLicenseKeyId(offlineStatus.license_id);
      }
      setLicenseStatus(offlineStatus);
    } catch {
      // ignore
    }
  }, []);

  const isLicenseModalOpen =
    licenseModalOpen ||
    (viewMode === "erp" && Boolean(currentUser) && Boolean(licenseStatus && !licenseStatus.is_valid));

  useEffect(() => {
    if (!toastMsg) return;
    const duration =
      toastMsg.includes("💡") || toastMsg.includes("\n") || toastMsg.length > 50
        ? 6500
        : 3500;
    const timer = setTimeout(() => setToastMsg(null), duration);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  // Initial database bootstrap + restore session, user & tab across refreshes
  useEffect(() => {
    installGlobalApiFetchInterceptor();
    const isClientApp = isInstalledClientApp();
    if (typeof window !== "undefined" && !isClientApp) {
      const hostSlug = extractSubdomainSlugFromHost(window.location.host);
      let querySlug = "";
      try {
        querySlug = (new URLSearchParams(window.location.search).get("slug") || "").trim().toLowerCase();
      } catch {
        querySlug = "";
      }
      setStoredTenantId(hostSlug || (querySlug && querySlug !== "default" ? querySlug : "default"));
    }
    void Promise.resolve().then(() => checkLicensingStatus());
    let active = true;
    (async () => {
      const res = await fetchBootstrapState();
      if (!active) return;
      setState(res.state);
      if (res.state.enterpriseProfile?.tenantSlug) {
        setStoredTenantSlug(res.state.enterpriseProfile.tenantSlug);
      }
      setLang(res.state.settings.defaultLang);
      setTheme((prev) => {
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(THEME_STORAGE_KEY) : null;
        return normalizeThemePreset(stored || res.state.settings.defaultTheme || prev);
      });
      setCurrency(res.state.settings.defaultCurrency);
      setOfflineQueueCount(res.queueCount);

      let savedUserId: string | null = null;
      let savedViewMode: string | null = null;
      let targetTab: TabId | null = null;
      let targetSubTab: string | null = null;
      let targetSalesView: "sales" | "customers" = "sales";

      if (typeof window !== "undefined") {
        savedUserId = window.localStorage.getItem("uas_user");
        savedViewMode = window.localStorage.getItem("uas_view_mode");

        const rawHash = window.location.hash.replace(/^#\/?/, "");
        if (rawHash) {
          const parts = rawHash.split("/");
          if (parts[0]) {
            targetTab = parts[0] as TabId;
            targetSubTab = parts[1] || null;
          }
        }
        const pathRoute = resolveWorkspaceRouteSection(window.location.pathname, window.location.search);
        if (pathRoute) {
          targetTab = pathRoute.tab;
          if (pathRoute.sector) {
            setActiveTradingSector(pathRoute.sector);
          }
          if (pathRoute.customersSection) {
            setCustomersInitialSection(pathRoute.customersSection);
          }
          if (pathRoute.salesViewMode === "customers" || pathRoute.tab === "customers") {
            targetSalesView = "customers";
          } else if (pathRoute.salesViewMode === "sales" || pathRoute.tab === "sales") {
            targetSalesView = "sales";
          }
          if (window.location.pathname.replace(/\/+$/, "") === "/harvest") {
            preferHarvestPathRef.current = true;
          }
        }
        if (!targetTab) {
          const storedTab = window.sessionStorage.getItem("uas_active_tab");
          if (storedTab) targetTab = storedTab as TabId;
        }

        if (!pathRoute) {
          const storedSalesView = window.sessionStorage.getItem("uas_sales_view_mode");
          if (storedSalesView === "customers" || targetTab === "customers") {
            targetSalesView = "customers";
          }
        }
      }

      const matchedUser =
        (res.state.sessionUser &&
          res.state.sessionUser.active &&
          (res.state.sessionUser.isActive ?? true)
          ? res.state.sessionUser
          : null) ||
        (savedUserId
          ? res.state.users.find(
            (u) => u.id === savedUserId && u.active && (u.isActive ?? true)
          )
          : null);

      if (matchedUser) {
        setCurrentUser(matchedUser);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("uas_user", matchedUser.id);
        }

        const finalViewMode =
          savedViewMode === "landing" || savedViewMode === "login" ? savedViewMode : "erp";
        setViewMode(finalViewMode);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("uas_view_mode", finalViewMode);
        }

        const finalTab = targetTab || (matchedUser.defaultModule as TabId) || "dashboard";
        if (finalTab === "commercial") {
          if (canAccessModule(matchedUser, "commercial")) {
            setActiveTradingSector("COMMERCIAL");
            setActiveTab("commercial");
          } else {
            const fallback = getAccessibleTabs(matchedUser)[0] || "dashboard";
            setActiveTradingSector("HARVEST");
            setActiveTab(fallback);
          }
        } else if (finalTab === "customers") {
          setActiveTradingSector("HARVEST");
          if (canAccessModule(matchedUser, "customers")) {
            setActiveTab("customers");
            setSalesViewMode("customers");
          } else {
            const fallback = getAccessibleTabs(matchedUser)[0] || "dashboard";
            setActiveTab(fallback);
          }
        } else {
          setActiveTradingSector("HARVEST");
          const resolved = resolveEffectiveTab(finalTab, matchedUser);
          if (canAccessModule(matchedUser, resolved)) {
            setActiveTab(resolved);
            if (resolved === "sales") {
              setSalesViewMode(targetSalesView);
            }
          } else {
            const fallback = getAccessibleTabs(matchedUser)[0] || "dashboard";
            setActiveTab(fallback);
          }
        }

        if (targetTab === "system" && targetSubTab) {
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("uas_system_subtab", targetSubTab);
          }
        }
      } else {
        setCurrentUser(null);
        const rawHash = typeof window !== "undefined" ? window.location.hash.replace(/^#\/?/, "") : "";
        const unauthView =
          isClientApp || savedViewMode === "login" || rawHash === "login" ? "login" : "landing";
        setViewMode(unauthView);
        if (typeof window !== "undefined") {
          if (unauthView === "login" && !isClientApp) {
            if (window.location.hash !== "#/login") {
              window.location.hash = "#/login";
            }
          } else if (unauthView === "landing") {
            if (window.location.hash) {
              if (typeof window.history.replaceState === "function") {
                window.history.replaceState(null, "", window.location.pathname + window.location.search);
              } else {
                window.location.hash = "";
              }
            }
          }
        }
      }

      if (res.fromOfflineCache) {
        setOfflineMode(true);
      }
      setLoading(false);
      hydratedRef.current = true;
    })();
    return () => {
      active = false;
    };
  }, [checkLicensingStatus]);

  // Sync viewMode to localStorage after initial hydration
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("uas_view_mode", viewMode);
    }
  }, [viewMode]);

  // Synchronize activeTab, salesViewMode, hash and clean subdomain paths across tab/sector changes
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (typeof window === "undefined") return;

    window.sessionStorage.setItem("uas_active_tab", activeTab);
    window.sessionStorage.setItem("uas_sales_view_mode", salesViewMode);

    const canSyncCleanPath =
      /^https?:$/i.test(window.location.protocol) && !isInstalledClientApp();

    if (viewMode === "erp") {
      let expectedHash = `#/${activeTab}`;
      if (activeTab === "system") {
        const currentSub = window.sessionStorage.getItem("uas_system_subtab") || "branding";
        expectedHash = `#/system/${currentSub}`;
      } else if (activeTab === "customers") {
        expectedHash = "#/customers";
      } else if (activeTradingSector === "COMMERCIAL") {
        expectedHash = "#/commercial";
      }
      if (canSyncCleanPath && typeof window.history.replaceState === "function") {
        const currentClean = window.location.pathname.replace(/\/+$/, "") || "/";
        const targetPath = resolveCanonicalWorkspacePath({
          activeTab,
          activeTradingSector,
          customersInitialSection,
          salesViewMode,
          preferHarvestPath: preferHarvestPathRef.current,
          currentPath: currentClean,
        });
        if (currentClean !== targetPath || window.location.hash !== expectedHash) {
          try {
            window.history.replaceState(
              null,
              "",
              `${targetPath}${window.location.search}${expectedHash}`
            );
          } catch {
            if (window.location.hash !== expectedHash) {
              window.location.hash = expectedHash;
            }
          }
        }
      } else if (window.location.hash !== expectedHash) {
        window.location.hash = expectedHash;
      }
    } else if (viewMode === "client_portal") {
      if (canSyncCleanPath && typeof window.history.replaceState === "function") {
        const targetPortalPath = resolveCanonicalPortalPath({
          portalTab: clientPortalInitialSection || "new_request",
          activeSector: "HARVEST",
        });
        const currentClean = window.location.pathname.replace(/\/+$/, "") || "/";
        const targetClean = targetPortalPath.replace(/\/+$/, "") || "/";
        if (currentClean !== targetClean || window.location.hash) {
          try {
            window.history.replaceState(null, "", `${targetPortalPath}${window.location.search}`);
          } catch {
            // ignore
          }
        }
      }
    } else if (viewMode === "login") {
      if (window.location.hash !== "#/login") {
        window.location.hash = "#/login";
      }
    } else if (viewMode === "landing") {
      if (window.location.hash && window.location.hash !== "#/") {
        if (typeof window.history.replaceState === "function") {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        } else {
          window.location.hash = "";
        }
      }
    }
  }, [
    activeTab,
    activeTradingSector,
    customersInitialSection,
    salesViewMode,
    viewMode,
    clientPortalInitialSection,
  ]);

  // Listen to browser hash navigation
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleHashChange = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, "");
      if (viewMode !== "erp" || !currentUser) {
        if (rawHash === "login") {
          setViewMode("login");
        } else if (!rawHash) {
          setViewMode("landing");
        } else {
          // Clean up internal module hashes when unauthenticated
          if (typeof window.history.replaceState === "function") {
            window.history.replaceState(null, "", window.location.pathname + window.location.search);
          } else {
            window.location.hash = "";
          }
          setViewMode("landing");
        }
        return;
      }
      if (!rawHash) return;
      const [hTab, hSub] = rawHash.split("/");
      if (hTab === "commercial") {
        if (canAccessModule(currentUser, "commercial")) {
          preferHarvestPathRef.current = false;
          setActiveTradingSector("COMMERCIAL");
          setActiveTab("commercial");
        }
        return;
      }
      if (hTab === "customers") {
        if (canAccessModule(currentUser, "customers")) {
          preferHarvestPathRef.current = false;
          setActiveTradingSector("HARVEST");
          setActiveTab("customers");
          setSalesViewMode("customers");
        }
        return;
      }
      const validTabs: TabId[] = [
        "dashboard",
        "commercial",
        "operations",
        "finance",
        "accounting",
        "coa",
        "ledger",
        "procurement",
        "reports",
        "projects",
        "expenses",
        "workers",
        "sales",
        "customers",
        "system",
        "treasury",
        "inventory",
        "audit",
        "mobile",
        "prompt",
      ];
      if (validTabs.includes(hTab as TabId)) {
        const resolved = resolveEffectiveTab(hTab as TabId, currentUser);
        if (canAccessModule(currentUser, resolved)) {
          if (hTab !== "dashboard") {
            preferHarvestPathRef.current = false;
          }
          setActiveTradingSector("HARVEST");
          setActiveTab(resolved);
          if (resolved === "sales") {
            setSalesViewMode("sales");
          }
          if (hTab === "system" && hSub) {
            window.sessionStorage.setItem("uas_system_subtab", hSub);
          }
        }
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [currentUser, viewMode]);

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

  // Sync strictly English-only browser tab <title> and dynamic tenant/UAS favicon & apple-touch-icon
  useEffect(() => {
    setActivePrintEnterpriseProfile(state.enterpriseProfile);
    if (typeof window === "undefined") {
      setActiveClientExportActor(null);
      return;
    }
    const hostSlug = extractSubdomainSlugFromHost(window.location.host);
    const effectiveSlug = hostSlug || state.enterpriseProfile?.tenantSlug || "default";
    if (currentUser) {
      const resolved = resolveExportSignature({
        user: currentUser,
        tenantSlug: effectiveSlug,
        tenantName: state.enterpriseProfile?.legalNameAr,
      });
      setActiveClientExportActor({
        username: resolved.username,
        displayName: resolved.displayName,
        titleAr: resolved.titleAr,
        titleEn: resolved.titleEn,
        tenantSlug: resolved.tenantSlug,
        tenantName: resolved.tenantName,
      });
      try {
        window.localStorage.setItem("uas_current_username", resolved.username);
      } catch {
        // ignore storage errors
      }
    } else {
      setActiveClientExportActor(null);
    }
    if (typeof document === "undefined") return;
    const brand = resolveEffectiveBrandInfo(
      state.enterpriseProfile,
      effectiveSlug === "default" ? null : effectiveSlug
    );

    document.title = brand.tabTitleEn;

    const head = document.head;
    if (!head) return;

    const existingIcons = head.querySelectorAll(
      "link[rel~='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']"
    );
    existingIcons.forEach((el) => el.parentNode?.removeChild(el));

    const appendIconLink = (rel: string, href: string, type?: string) => {
      const link = document.createElement("link");
      link.rel = rel;
      link.href = href;
      if (type) link.type = type;
      head.appendChild(link);
    };

    if (brand.hasCustomBrand) {
      appendIconLink("icon", brand.effectiveFaviconUrl);
      appendIconLink("shortcut icon", brand.effectiveFaviconUrl);
      appendIconLink("apple-touch-icon", brand.effectiveFaviconUrl);
    } else {
      appendIconLink("icon", "/favicon.ico");
      appendIconLink("icon", "/favicon-32x32.png", "image/png");
      appendIconLink("shortcut icon", "/favicon-32x32.png", "image/png");
      appendIconLink("apple-touch-icon", "/apple-touch-icon.png", "image/png");
    }
  }, [state.enterpriseProfile, lang, viewMode, currentUser]);

  useEffect(() => {
    const brandColor = state.enterpriseProfile?.brandColor;
    applyThemeToDocument(theme, brandColor, THEME_STORAGE_KEY);
    if (theme !== "system" || typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeToDocument("system", brandColor, THEME_STORAGE_KEY);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme, state.enterpriseProfile?.brandColor]);

  useEffect(() => {
    document.body.classList.toggle("mobile-simulator-active", mobileSimulatorActive);
  }, [mobileSimulatorActive]);

  // Global Ctrl+K / Cmd+K Quick Search shortcut in ERP view
  useEffect(() => {
    if (viewMode !== "erp" || currentUser?.mustChangePassword) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewMode, currentUser?.mustChangePassword]);

  const activeUser = currentUser ?? INITIAL_FALLBACK_STATE.users[0];
  const userReadOnly = isReadOnly(activeUser);
  const userCanApprove = canApprove(activeUser);
  const userCanPost = canPostLedger(activeUser);
  const userCanLock = canLockPeriod(activeUser);
  const userCanManageUsers = canManageUsers(activeUser);
  const userCanManageTreasury = canManageTreasury(activeUser);
  const userCanEditDate = canEditDate(activeUser);
  const roleMeta = getRoleMeta(activeUser);
  const dict = getDict(lang);

  const scopedProjects = useMemo(
    () => filterAssignedProjects(activeUser, state.projects),
    [activeUser, state.projects]
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
      currentUser: activeUser,
      offlineMode,
    });
    setOfflineQueueCount(res.queueCount);
    if (res.error) {
      showToast(res.error);
      if (
        res.error.includes("ترخيص") ||
        res.error.includes("ساعة") ||
        res.error.includes("License") ||
        res.error.includes("clock") ||
        res.error.includes("أجهزة") ||
        res.error.includes("seats")
      ) {
        checkLicensingStatus();
        setLicenseModalOpen(true);
      }
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
    setCurrentUser((prev) => {
      if (res.state.sessionUser) {
        return res.state.sessionUser;
      }
      if (!prev) return prev;
      return res.state.users.find((u) => u.id === prev.id) || prev;
    });
  }, []);

  async function handleSyncQueue() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      showToast("لا يوجد اتصال بالإنترنت حالياً لتنفيذ المزامنة");
      return;
    }
    const res = await performManualSyncNow(activeUser);
    setState(res.state);
    setOfflineQueueCount(res.remainingQueue);
    setPendingConflictsCount(res.conflictCount);
    setOfflineMode(false);
    flushQueuedNotifications();
    if (res.conflictCount > 0) {
      showToast(
        lang === "ar"
          ? `⚠️ تمت المزامنة (${res.syncedCount} عملية) مع وجود ${res.conflictCount} تعارض بانتظار المراجعة`
          : `⚠️ Synced ${res.syncedCount} item(s), ${res.conflictCount} conflict(s) pending resolution`
      );
    } else {
      showToast(
        lang === "ar"
          ? `✅ تمت المزامنة بنجاح (${res.syncedCount} عملية، المؤشر #${res.latestCursor})`
          : `✅ Synced successfully (${res.syncedCount} item(s), cursor #${res.latestCursor})`
      );
    }
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
      phone: state.enterpriseProfile?.phone || "",
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
      phone: inst.phone || state.enterpriseProfile?.phone || "",
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
    const rawPhone = String(
      voucher.phone ||
      state.enterpriseProfile?.contactWhatsApp ||
      state.enterpriseProfile?.contactPhone ||
      state.enterpriseProfile?.phone ||
      ""
    ).trim();
    if (!rawPhone.replace(/[^0-9]/g, "")) {
      showToast(
        lang === "ar"
          ? "يرجى تحديد رقم الهاتف لإرسال إشعار السند"
          : "Please specify a phone number to send voucher notification"
      );
      return;
    }
    const launched = openExternalOrWhatsApp({
      phone: rawPhone,
      text: voucher.whatsappText,
    });
    await runMutation(
      "/api/audit/log",
      "POST",
      {
        action: "إرسال إشعار السند",
        details: `إلى الرابط ${launched.url} (${voucher.voucherNo})`,
      },
      "Notification dispatch",
      "تم فتح رابط الإشعار لإرسال السند للعميل/العامل"
    );
  }

  const navigateToTab = useCallback(
    (nextTab: TabId) => {
      if (currentUser?.mustChangePassword) {
        return;
      }
      if (nextTab === "commercial") {
        if (!canAccessModule(activeUser, "commercial")) {
          const fallback = getAccessibleTabs(activeUser)[0] || "dashboard";
          setActiveTradingSector("HARVEST");
          setActiveTab(fallback);
          showToast(
            lang === "ar"
              ? "ليست لديك صلاحية للوصول إلى هذا القسم"
              : "You do not have permission to access this module"
          );
          return;
        }
        preferHarvestPathRef.current = false;
        setActiveTradingSector("COMMERCIAL");
        setActiveTab("commercial");
        return;
      }
      setActiveTradingSector("HARVEST");
      if (nextTab !== "dashboard") {
        preferHarvestPathRef.current = false;
      }
      if (nextTab === "customers") {
        if (!canAccessModule(activeUser, "customers")) {
          const fallback = getAccessibleTabs(activeUser)[0] || "dashboard";
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

      const resolved = resolveEffectiveTab(nextTab, activeUser);
      if (!canAccessModule(activeUser, resolved)) {
        const fallback = getAccessibleTabs(activeUser)[0] || "dashboard";
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
    [activeUser, currentUser?.mustChangePassword, lang, showToast]
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
    setState((prev) => {
      const exists = prev.users.some((item) => item.id === u.id);
      return {
        ...prev,
        users: exists ? prev.users.map((item) => (item.id === u.id ? u : item)) : [...prev.users, u],
      };
    });
    const userTenant = (u as UasUser & { tenantId?: string }).tenantId;
    if (userTenant) {
      setStoredTenantId(userTenant);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem("uas_user", u.id);
      window.localStorage.setItem("uas_view_mode", "erp");
    }
    if (u.mustChangePassword) {
      setPendingProjectId(null);
      setViewMode("erp");
      showToast(
        lang === "ar"
          ? "🔒 يلزم تعيين كلمة مرور جديدة قبل المتابعة إلى مساحة العمل"
          : "🔒 Please set a new password before entering the workspace"
      );
      return;
    }
    // Bind or refresh this user's device seat (7 users × [1 Windows + 1 Android])
    if (u.email) {
      fetch("/api/licensing/seats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-uas-user-id": u.id,
          "x-uas-role": String(u.role),
        },
        body: JSON.stringify({
          userEmail: u.email,
          platform: detectClientPlatform(),
          deviceId: getClientDeviceHwid(),
        }),
      })
        .then(async (res) => {
          if (!res.ok && (res.status === 403 || res.status === 409)) {
            const data = await res.json().catch(() => ({}));
            if (data?.error) showToast(String(data.error));
            setLicenseModalOpen(true);
          }
          checkLicensingStatus();
        })
        .catch(() => {
          // Offline mode fallback
        });
    }
    const allowedProjects = filterAssignedProjects(u, state.projects);

    if (pendingProjectId) {
      const targetId = pendingProjectId;
      setPendingProjectId(null); // Clear pending

      const targetProj = allowedProjects.find((p) => p.id === targetId);
      if (targetProj) {
        handleProjectFilterChange(targetId);
        navigateToTab("projects");
        setViewMode("erp");
        const uRoleMeta = getRoleMeta(u);
        showToast(
          lang === "ar"
            ? `تم تسجيل الدخول وتفعيل جذر المشروع: ${targetProj.nameAr || targetProj.name} (${uRoleMeta.labelAr})`
            : `Signed in as ${u.name} — Activated project: ${targetProj.nameEn || targetProj.name}`
        );
        return;
      } else {
        showToast(
          lang === "ar"
            ? "تم تسجيل الدخول بنجاح، ولكن ليس لديك صلاحية للوصول إلى المشروع المطلوب."
            : "Signed in, but access to requested project is restricted for your role."
        );
      }
    }

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

  async function handleLogout() {
    setPendingProjectId(null);
    const actorId = currentUser?.id;
    const actorRole = currentUser?.role;
    try {
      const apiBase = getApiBaseUrl();
      await fetch(`${apiBase}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorId, actorRole }),
      });
    } catch (err) {
      console.warn("Logout request failed (continuing local cleanup):", err);
    }

    if (typeof window !== "undefined") {
      const authKeys = [
        "uas_remembered_identifier",
        "uas_session",
        "uas_session_token",
        "uas_token",
        "uas_auth",
        "uas_user",
        "uas_view_mode",
        "uas_active_tab",
        "uas_sales_view_mode",
        "uas_system_subtab",
      ];
      for (const key of authKeys) {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
      }
    }

    setProfileDrawerOpen(false);
    setMobileSidebarOpen(false);
    setQuickSheetOpen(false);
    setSearchModalOpen(false);
    setVoucherModal(null);
    setCurrentUser(null);
    setViewMode("login");
    showToast("تم تسجيل الخروج بنجاح / Logged out successfully");
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
    canAccessModule(activeUser, sub.id)
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Notification Toast */}
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] no-print max-w-lg w-[90vw] pointer-events-none">
          <div
            className={`px-5 py-3 rounded-xl shadow-xl text-white text-sm font-semibold flex items-start gap-2 whitespace-pre-line pointer-events-auto transition-all ${toastMsg.includes("⛔") ||
              toastMsg.includes("❌") ||
              toastMsg.includes("تعذر") ||
              toastMsg.includes("فشل") ||
              toastMsg.includes("خطأ") ||
              toastMsg.toLowerCase().includes("failed") ||
              toastMsg.toLowerCase().includes("error")
              ? "bg-rose-700 border border-rose-500/50 shadow-rose-900/40"
              : toastMsg.includes("⚠️") ||
                toastMsg.includes("💡") ||
                toastMsg.includes("🟠") ||
                toastMsg.toLowerCase().includes("warn")
                ? "bg-amber-700 border border-amber-500/50 shadow-amber-900/40"
                : "bg-emerald-700 border border-emerald-500/50 shadow-emerald-900/40"
              }`}
          >
            <span className="flex-1 leading-relaxed">{toastMsg}</span>
          </div>
        </div>
      )}

      <VoucherModal
        voucher={voucherModal}
        lang={lang}
        currency={currency}
        exchangeRates={state.exchangeRates}
        logoText={state.settings.logoText}
        enterpriseProfile={state.enterpriseProfile}
        onClose={() => setVoucherModal(null)}
        onSendWhatsApp={handleSendWhatsApp}
      />

      <CommandSearchModal
        open={searchModalOpen && viewMode === "erp" && Boolean(currentUser) && !currentUser?.mustChangePassword}
        onClose={() => setSearchModalOpen(false)}
        state={state}
        lang={lang}
        currentUser={activeUser}
        onNavigate={(tab) => navigateToTab(tab)}
        onSelectProject={(pid) => {
          handleProjectFilterChange(pid);
          navigateToTab("projects");
        }}
      />

      {viewMode === "client_portal" ? (
        <ClientPortalApp
          initialAuthTab={clientPortalInitialTab}
          initialPortalSection={clientPortalInitialSection}
          onBackHomeAction={() => setViewMode("landing")}
        />
      ) : viewMode === "landing" ? (
        <LandingPage
          state={state}
          lang={lang}
          theme={theme}
          currentUser={currentUser}
          onChangeTheme={(nextTheme) => setTheme(nextTheme)}
          onEnterErp={(tab) => {
            if (!currentUser) {
              setViewMode("login");
              return;
            }
            if (tab) navigateToTab(tab);
            setViewMode("erp");
          }}
          onOpenLogin={() => setViewMode("login")}
          onOpenClientPortal={(tab = "login", section = "new_request") => {
            setClientPortalInitialTab(tab);
            setClientPortalInitialSection(section);
            setViewMode("client_portal");
          }}
          onToggleLang={() => setLang((prev) => (prev === "ar" ? "en" : "ar"))}
          onSelectProjectCard={(projectId) => {
            if (currentUser) {
              const allowedProjects = filterAssignedProjects(currentUser, state.projects);
              const targetProj = allowedProjects.find((p) => p.id === projectId);
              if (!targetProj) {
                showToast(
                  lang === "ar"
                    ? "عذراً: ليس لديك صلاحية للوصول إلى هذا المشروع."
                    : "Access denied: You do not have permission to access this project."
                );
                return;
              }
              handleProjectFilterChange(projectId);
              navigateToTab("projects");
              setViewMode("erp");
              showToast(
                lang === "ar"
                  ? `تم تفعيل جذر المشروع: ${targetProj.nameAr || targetProj.name}`
                  : `Activated project root: ${targetProj.nameEn || targetProj.name}`
              );
              return;
            }

            setPendingProjectId(projectId);
            setViewMode("login");
          }}
        />
      ) : viewMode === "login" || !currentUser ? (
        <LoginView
          users={state.users}
          logoText={state.settings.logoText}
          enterpriseProfile={state.enterpriseProfile}
          lang={lang}
          theme={theme}
          currentUserId={currentUser?.id ?? ""}
          offlineMode={offlineMode}
          onBackToLanding={() => {
            setPendingProjectId(null);
            setViewMode("landing");
          }}
          onOpenClientPortal={(tab = "login") => {
            setClientPortalInitialTab(tab);
            setClientPortalInitialSection("new_request");
            setViewMode("client_portal");
          }}
          onToggleLang={() => setLang((prev) => (prev === "ar" ? "en" : "ar"))}
          licenseStatus={licenseStatus}
          onOpenLicenseModal={() => setLicenseModalOpen(true)}
          onLoginSuccess={(u) => handleLoginUser(u)}
          onToast={showToast}
        />
      ) : currentUser.mustChangePassword ? (
        <ForcePasswordChangeModal
          currentUser={currentUser}
          lang={lang}
          logoText={state.settings.logoText}
          enterpriseProfile={state.enterpriseProfile}
          onPasswordChanged={async (updatedUser) => {
            setCurrentUser(updatedUser);
            setState((prev) => ({
              ...prev,
              users: prev.users.map((item) => (item.id === updatedUser.id ? updatedUser : item)),
            }));
            await refreshFromServer();
            void checkLicensingStatus();
          }}
          onLogout={handleLogout}
          onToast={showToast}
        />
      ) : (
        <div id="erpAppFrame" className="min-h-screen flex flex-col overflow-x-clip bg-slate-50/50 dark:bg-slate-950/30">
          <SidebarNav
            orgName={state.settings.orgName}
            logoText={state.settings.logoText}
            enterpriseProfile={state.enterpriseProfile}
            lang={lang}
            activeTab={activeTab}
            activeTradingSector={activeTradingSector}
            customersSection={customersInitialSection}
            salesViewMode={salesViewMode}
            collapsed={sidebarCollapsed}
            mobileOpen={mobileSidebarOpen}
            mobileSimulatorActive={mobileSimulatorActive}
            currentUser={currentUser}
            onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            onSelectGroup={(_groupId, defaultTab) => navigateToTab(defaultTab)}
            onSelectSubTab={(tab) => navigateToTab(tab)}
            onSelectClientPortal={() => {
              preferHarvestPathRef.current = false;
              setCustomersInitialSection("portal");
              setSalesViewMode("customers");
              navigateToTab("customers");
            }}
            onSelectClientLedgers={() => {
              preferHarvestPathRef.current = false;
              setCustomersInitialSection("cards");
              setSalesViewMode("customers");
              navigateToTab("customers");
            }}
            onSelectSalesInvoices={() => {
              preferHarvestPathRef.current = false;
              setSalesViewMode("sales");
              navigateToTab("sales");
            }}
            onSelectSector={(sector) => {
              if (sector === "COMMERCIAL") {
                navigateToTab("commercial");
              } else {
                preferHarvestPathRef.current = true;
                setActiveTradingSector("HARVEST");
                navigateToTab("dashboard");
              }
            }}
            onOpenLogin={() => setViewMode("login")}
            onLogout={handleLogout}
          />

          <div
            className={`flex-1 min-w-0 flex flex-col transition-all duration-200 ${!mobileSimulatorActive
              ? sidebarCollapsed
                ? "md:ps-[72px]"
                : "md:ps-[264px]"
              : ""
              }`}
          >
            <SharedDraftsCenterDrawer
              open={draftsDrawerOpen}
              onClose={() => setDraftsDrawerOpen(false)}
              currentUser={currentUser}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onToast={showToast}
            />
            <ApprovalsCenter
              open={approvalsDrawerOpen}
              onClose={() => setApprovalsDrawerOpen(false)}
              currentUser={currentUser}
              onToast={showToast}
            />
            <NotificationCenterDrawer
              open={notificationsDrawerOpen}
              onClose={() => setNotificationsDrawerOpen(false)}
              lang={lang}
              currentUser={currentUser}
              onUnreadCountChange={setUnreadNotificationsCount}
              onNavigateTab={(tab) => navigateToTab(tab)}
              onToast={showToast}
            />
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
              onOpenDraftsCenter={() => setDraftsDrawerOpen(true)}
              draftsCount={draftsCount}
              onOpenApprovalsCenter={() => setApprovalsDrawerOpen(true)}
              pendingApprovalsCount={pendingApprovalsCount}
              onOpenNotifications={() => setNotificationsDrawerOpen(true)}
              unreadNotificationsCount={unreadNotificationsCount}
              transportBadge={
                lang === "ar"
                  ? resolveTransportTarget({ offlineMode }).badgeLabelAr
                  : resolveTransportTarget({ offlineMode }).badgeLabelEn
              }
              pendingConflictsCount={pendingConflictsCount}
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
              onLogout={handleLogout}
            />

            <main className="max-w-7xl w-full min-w-0 overflow-x-clip mx-auto flex-1 px-3 sm:px-4 md:px-6 pt-2 sm:pt-2.5 md:pt-3 pb-6 md:pb-8 space-y-3 sm:space-y-4">
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

              {activeTab === "commercial" ? (
                <CommercialSectorWorkspace
                  onRefreshState={refreshFromServer}
                  onToast={showToast}
                  onSwitchToHarvestSector={() => {
                    preferHarvestPathRef.current = true;
                    setActiveTradingSector("HARVEST");
                    navigateToTab("dashboard");
                  }}
                />
              ) : (
                <>
                  {/* Unified Hub Sub-Tab Bar */}
                  {visibleSubTabs.length > 0 && (
                    <div className="card-surface rounded-2xl p-2 flex flex-col md:flex-row md:flex-wrap md:items-center md:justify-between gap-2 no-print">
                      {/* Mobile / Narrow Viewport Accessible Sub-Tab Dropdown */}
                      <div className="md:hidden w-full">
                        <select
                          data-testid="app-subtabs-select"
                          aria-label={lang === "ar" ? "القسم الفرعي" : "Module Section"}
                          value={
                            visibleSubTabs.some(
                              (sub) => sub.id === activeTab || (sub.id === "sales" && activeTab === "customers")
                            )
                              ? activeTab === "customers"
                                ? "sales"
                                : activeTab
                              : visibleSubTabs[0]?.id ?? ""
                          }
                          onChange={(e) => navigateToTab(e.target.value as TabId)}
                          className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-extrabold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        >
                          {visibleSubTabs.map((sub) => (
                            <option key={sub.id} value={sub.id}>
                              {lang === "ar" ? sub.labelAr : sub.labelEn}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Desktop Horizontal Sub-Tab Bar */}
                      <div className="hidden md:flex flex-wrap items-center gap-1.5">
                        {visibleSubTabs.map((sub) => {
                          const isSubActive =
                            activeTab === sub.id ||
                            (sub.id === "sales" && activeTab === "customers");
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => navigateToTab(sub.id)}
                              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition ${isSubActive
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
                        <>
                          <div className="md:hidden w-full">
                            <select
                              data-testid="sales-view-mode-select"
                              aria-label={lang === "ar" ? "عرض المبيعات" : "Sales View Mode"}
                              value={
                                activeTab === "customers" && customersInitialSection === "portal"
                                  ? "portal"
                                  : salesViewMode === "customers" || activeTab === "customers"
                                    ? "customers"
                                    : "sales"
                              }
                              onChange={(e) => {
                                const next = e.target.value as "sales" | "customers" | "portal";
                                if (next === "portal") {
                                  setCustomersInitialSection("portal");
                                  setSalesViewMode("customers");
                                  setActiveTab("customers");
                                  return;
                                }
                                if (next === "customers") {
                                  setCustomersInitialSection("cards");
                                }
                                setSalesViewMode(next);
                                setActiveTab(next);
                              }}
                              className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                            >
                              <option value="sales">
                                {lang === "ar" ? "🧾 فواتير المبيعات" : "🧾 Sales Invoices"}
                              </option>
                              <option value="customers">
                                {lang === "ar" ? "👥 حسابات العملاء" : "👥 Client Ledgers"}
                              </option>
                              <option value="portal">
                                {lang === "ar" ? "🌐 بوابة العملاء" : "🌐 Client Portal"}
                              </option>
                            </select>
                          </div>
                          <div className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl text-[11px] font-bold">
                            <button
                              type="button"
                              onClick={() => {
                                setSalesViewMode("sales");
                                setActiveTab("sales");
                              }}
                              className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${salesViewMode === "sales" && activeTab !== "customers"
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
                                setCustomersInitialSection("cards");
                                setSalesViewMode("customers");
                                setActiveTab("customers");
                              }}
                              className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${(salesViewMode === "customers" || activeTab === "customers") &&
                                customersInitialSection !== "portal"
                                ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm"
                                : "text-slate-500"
                                }`}
                            >
                              <Users className="w-3.5 h-3.5" />
                              <span>{lang === "ar" ? "حسابات العملاء" : "Client Ledgers"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomersInitialSection("portal");
                                setSalesViewMode("customers");
                                setActiveTab("customers");
                              }}
                              className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition ${activeTab === "customers" && customersInitialSection === "portal"
                                ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm"
                                : "text-slate-500"
                                }`}
                            >
                              <Globe className="w-3.5 h-3.5" />
                              <span>{lang === "ar" ? "بوابة العملاء" : "Client Portal"}</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Active Tab Screen rendering wrapped in TabErrorBoundary */}
                  <TabErrorBoundary
                    tab={activeTab}
                    lang={lang}
                    onNavigateHome={() => navigateToTab("dashboard")}
                  >
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
                        onRefreshState={refreshFromServer}
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
                        enterpriseProfile={state.enterpriseProfile}
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
                        enterpriseProfile={state.enterpriseProfile}
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
                        onRefreshState={refreshFromServer}
                        onToast={showToast}
                      />
                    )}

                    {activeTab === "workers" && (
                      <WorkersTab
                        projects={scopedProjects}
                        workers={filteredWorkers}
                        allWorkers={state.workers}
                        treasuryAccounts={state.treasuryAccounts}
                        currentUser={currentUser}
                        enterpriseProfile={state.enterpriseProfile}
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
                        onRefreshState={refreshFromServer}
                        onToast={showToast}
                      />
                    )}

                    {activeTab === "sales" && (
                      <SalesTab
                        projects={scopedProjects}
                        sales={filteredSales}
                        inventoryBatches={state.inventoryBatches}
                        treasuryAccounts={state.treasuryAccounts}
                        currentUser={currentUser}
                        enterpriseProfile={state.enterpriseProfile}
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
                        onOpenClientPortalAdmin={() => {
                          setCustomersInitialSection("portal");
                          setSalesViewMode("customers");
                          setActiveTab("customers");
                        }}
                        onRefreshState={refreshFromServer}
                        onToast={showToast}
                      />
                    )}

                    {activeTab === "customers" && (
                      <CustomersTab
                        projects={scopedProjects}
                        sales={filteredSales}
                        allSales={state.sales}
                        currentUser={currentUser}
                        enterpriseProfile={state.enterpriseProfile}
                        initialSection={customersInitialSection}
                        readOnly={userReadOnly}
                        canEditRecords={canEdit(currentUser, "customers")}
                        onOpenSaleVoucher={openSaleVoucher}
                        onExportCustomerExcel={(customerFilter) => {
                          exportFullWorkbookToExcel(state, { customerFilter });
                          showToast("تم تصدير كشف العملاء إلى Excel بنجاح");
                        }}
                        onRefreshState={refreshFromServer}
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
                        offlineQueueCount={offlineQueueCount}
                        onRefreshState={refreshFromServer}
                        readOnly={userReadOnly}
                        canManageUsers={userCanManageUsers}
                        canManageCms={canManageLandingCms(currentUser)}
                        onSaveBranding={async (orgName, logoText, extra) => {
                          await runMutation(
                            "/api/system/settings",
                            "PATCH",
                            { orgName, logoText, ...(extra || {}) },
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
                            setCurrentUser((prev) =>
                              prev
                                ? {
                                  ...prev,
                                  name: payload.name || prev.name,
                                  avatarChar: payload.avatarChar || prev.avatarChar,
                                }
                                : prev
                            );
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
                        onRefreshState={refreshFromServer}
                        onToast={showToast}
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
                  </TabErrorBoundary>
                </>
              )}
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
            onLogout={handleLogout}
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
              if (typeof window !== "undefined") {
                window.localStorage.setItem("uas_user", updatedUser.id);
              }
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
            onLogout={handleLogout}
          />
        </div>
      )}

      <LicenseActivationModal
        open={isLicenseModalOpen}
        statusData={licenseStatus}
        lang={lang}
        currentUser={currentUser}
        enterpriseProfile={state.enterpriseProfile}
        onClose={() => setLicenseModalOpen(false)}
        onRefreshStatus={() => {
          checkLicensingStatus();
          refreshFromServer();
        }}
        onAutoLogin={(autoUser, token) => {
          if (token) {
            setStoredSessionToken(token);
          }
          handleLoginUser(autoUser);
          setLicenseModalOpen(false);
          void checkLicensingStatus();
          void refreshFromServer();
        }}
        onToast={showToast}
      />

      {!currentUser?.mustChangePassword && (
        <UasAiCopilot
          lang={lang}
          currentUser={currentUser}
          state={state}
          licenseStatus={licenseStatus}
          offlineMode={offlineMode}
          workspaceContext={{
            activeTab,
            selectedProjectId: selectedProjectId === "ALL" ? null : selectedProjectId,
            selectedSubProjectId: selectedSubProjectId === "ALL" ? null : selectedSubProjectId,
            selectedHarvest: selectedHarvest === "ALL" ? null : selectedHarvest,
            tenantSlug: state.enterpriseProfile?.tenantSlug ?? null,
            runtimeMode: getStoredRuntimeMode(),
            offlineQueueCount,
            pendingConflictsCount,
            isOffline: offlineMode,
            currency,
          }}
          onNavigateTab={(tab) => {
            if (currentUser && viewMode !== "erp") {
              setViewMode("erp");
            }
            navigateToTab(tab);
          }}
          onOpenLicenseModal={() => setLicenseModalOpen(true)}
          onRefreshState={refreshFromServer}
          onApplyState={(nextState, qCount) => {
            setState(nextState);
            setOfflineQueueCount(qCount);
          }}
          onToast={showToast}
        />
      )}
    </div>
  );
}


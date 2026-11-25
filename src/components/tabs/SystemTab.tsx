"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { SvgAvatar } from "@/components/SvgAvatar";
import {
  DualLogoBadge,
  ENTERPRISE_LOGO_PRESETS,
  UAS_LOGO_PRESETS,
  renderEnterprisePresetSvg,
  renderUasPresetSvg,
} from "@/components/DualLogoBadge";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Lock,
  Palette,
  Globe,
  Upload,
  Sparkles,
  Save,
  Eye,
  KeyRound,
  Shield,
  Sliders,
  RefreshCw,
  Copy,
  Check,
  Download,
  Smartphone,
  UserCheck,
  Wifi,
  X,
  Database,
  AlertTriangle,
  Archive,
  FileText,
  MessageSquare,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  getApiBaseUrl,
  setApiBaseUrl,
  resetApiBaseUrl,
  safeFetchJson,
  sanitizeHeaderValue,
  setStoredSessionToken,
  getStoredTenantId,
  getStoredTenantSlug,
  getStoredServerUrls,
  setStoredLanUrl,
  setStoredRuntimeMode,
  isNativeAndroid,
} from "@/lib/apiClient";
import {
  detectReachableLanEndpoint,
  evaluateConnectionOriginSwitch,
  isHttpsToHttpMixedContent,
  isPrivateLanOrigin,
  probeTenantEndpoint,
  resolveActiveWorkspaceSlug,
  resolveTenantCloudUrl,
} from "@/lib/serverConnection";
import { getOfflineQueueCount } from "@/lib/offlineDb";
import {
  DEFAULT_TAGLINE_AR,
  DEFAULT_TAGLINE_EN,
  resolveEffectiveBrandInfo,
} from "@/lib/branding";
import { exportOrShareBinaryFile } from "@/lib/nativeBridge";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { AccountingSettingsPanel } from "@/components/AccountingSettingsPanel";
import { ApprovalRulesMatrixPanel } from "@/components/ApprovalRulesMatrixPanel";
import { TenantAdminConfigPanel } from "@/components/TenantAdminConfigPanel";
import { TenantDevicesPanel } from "@/components/TenantDevicesPanel";
import { TenantClientPortalAdminPanel } from "@/components/portal-admin/TenantClientPortalAdminPanel";
import { PhoneContactInput } from "@/components/PhoneContactInput";
import { isPlatformAdminSurfaceEnabled } from "@/lib/buildTarget";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";

const SuperadminLicenseGeneratorPanel =
  process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN === "0"
    ? null
    : dynamic(
      () =>
        import("@/components/SuperadminLicenseGeneratorPanel").then(
          (m) => m.SuperadminLicenseGeneratorPanel
        ),
      { ssr: false }
    );

const PlatformControlPanel =
  process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN === "0"
    ? null
    : dynamic(
      () =>
        import("@/components/PlatformControlPanel").then(
          (m) => m.PlatformControlPanel
        ),
      { ssr: false }
    );
import {
  ALL_USER_ROLES,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_DEFINITIONS,
  canApprove,
  canEdit,
  canLockPeriod,
  canPostLedger,
  getAccessibleGroups,
  getRoleMeta,
  isReadOnly as checkIsReadOnly,
  normalizeRole,
  type GranularActionPermissions,
} from "@/lib/permissions";
import type {
  ErpGroupId,
  LanguageCode,
  ThemeName,
  UasEnterpriseProfile,
  UasProject,
  UasSystemSettings,
  UasUser,
} from "@/types/uas";
import type {
  ResetScopeType,
  ResetSectionModule,
  ResetUnitType,
  FactoryCoaMode,
} from "@/lib/scopedResetEngine";

const ERP_DOMAINS: { id: ErpGroupId; labelAr: string; labelEn: string; descAr: string }[] = [
  {
    id: "public",
    labelAr: "البوابة العامة والمؤشرات",
    labelEn: "Public Portal & KPIs",
    descAr: "لوحة المعلومات العامة وصفحة الترحيب",
  },
  {
    id: "projects",
    labelAr: "المشاريع والمواسم الزراعية",
    labelEn: "Projects & Harvests",
    descAr: "المشاريع والمواسم والقطفات والمشاريع الفرعية",
  },
  {
    id: "commercial",
    labelAr: "المشتريات والمبيعات والمخزون",
    labelEn: "Commercial & Supply Chain",
    descAr: "المشتريات، المبيعات المتعددة، العملاء، والمخازن",
  },
  {
    id: "operations",
    labelAr: "المصروفات التشغيلية والعمالة",
    labelEn: "Operations & Labor",
    descAr: "مصاريف التشغيل والمحروقات وأجور العمالة",
  },
  {
    id: "finance",
    labelAr: "الخزينة والأستاذ العام والحسابات",
    labelEn: "Finance & General Ledger",
    descAr: "الصناديق والبنوك، شجرة الحسابات الستة، والقيود",
  },
  {
    id: "intelligence",
    labelAr: "التقارير وسجل التدقيق",
    labelEn: "Intelligence & Audit",
    descAr: "القوائم المالية التحليلية وسجل التدقيق المؤسسي",
  },
  {
    id: "admin",
    labelAr: "إدارة النظام والمستخدمين",
    labelEn: "System Admin & Users",
    descAr: "إعدادات النظام، الهوية المؤسسية، والتحكم بالصلاحيات",
  },
];

const ACTION_PERM_DEFINITIONS: {
  key: keyof GranularActionPermissions;
  labelAr: string;
  labelEn: string;
  descAr: string;
}[] = [
    {
      key: "canCreate",
      labelAr: "إنشاء القيود والمعاملات",
      labelEn: "Create Transactions",
      descAr: "إدخال فواتير وسندات ومصروفات جديدة",
    },
    {
      key: "canEdit",
      labelAr: "تعديل المعاملات غير المقفلة",
      labelEn: "Edit Transactions",
      descAr: "تعديل القيود والفواتير المفتوحة قبل اعتمادها",
    },
    {
      key: "canEditDate",
      labelAr: "تعديل التواريخ بأثر رجعي",
      labelEn: "Edit Transaction Dates",
      descAr: "تغيير تاريخ المعاملات وسندات الصرف والقبض",
    },
    {
      key: "canDeleteVoid",
      labelAr: "حذف وإلغاء القيود",
      labelEn: "Delete / Void Vouchers",
      descAr: "إلغاء أو حذف المعاملات والسندات المفتوحة",
    },
    {
      key: "canApprove",
      labelAr: "الاعتماد المالي والتشغيلي",
      labelEn: "Financial Approval",
      descAr: "اعتماد أوامر الشراء وفواتير الموردين والرواتب",
    },
    {
      key: "canPostLedger",
      labelAr: "الترحيل للأستاذ العام (GL)",
      labelEn: "Post to General Ledger",
      descAr: "ترحيل السندات المعتمدة ودفتر اليومية",
    },
    {
      key: "canLockPeriod",
      labelAr: "إقفال القطفات والدورات",
      labelEn: "Lock Periods & Cycles",
      descAr: "تجميد الفترات المحاسبية وإقفال القطفات",
    },
    {
      key: "canManageTreasury",
      labelAr: "إدارة الخزينة والتحويلات",
      labelEn: "Manage Treasury",
      descAr: "تحويل الأموال بين الصناديق والحسابات البنكية",
    },
    {
      key: "canManageLandingCms",
      labelAr: "إدارة الهوية والصفحة العامة",
      labelEn: "Manage CMS & Branding",
      descAr: "تخصيص الشعار ومحتوى البوابة العامة",
    },
    {
      key: "canManageUsers",
      labelAr: "إدارة المستخدمين والأمان",
      labelEn: "Manage Users & Security",
      descAr: "إضافة المستخدمين، ضبط الصلاحيات، وإعادة تعيين كلمات المرور",
    },
    {
      key: "canCloseFiscalYear",
      labelAr: "إقفال السنة المالية وترحيل الأرصدة (accounting.close_year)",
      labelEn: "Close Fiscal Year & Rollover",
      descAr: "صلاحية ترحيل أرباح العام وإقفال السنة المحاسبية المنتهية",
    },
    {
      key: "canFxRevalue",
      labelAr: "إعادة تقييم فروق العملات (accounting.fx_revalue)",
      labelEn: "Foreign Currency Revaluation",
      descAr: "احتساب وترحيل قيود فروق تقييم العملات الأجنبية غير المحققة",
    },
    {
      key: "canDecideApprovals",
      labelAr: "اتخاذ قرارات الاعتماد (approvals.decide)",
      labelEn: "Decide Approval Requests",
      descAr: "اعتماد أو رفض المعاملات المالية وأوامر الصرف والشراء",
    },
    {
      key: "canConfigureApprovals",
      labelAr: "تهيئة مسارات وقواعد الاعتماد (approvals.configure)",
      labelEn: "Configure Approval Rules",
      descAr: "تحديد السقوف المالية وشروط طلب الاعتماد المسبق",
    },
    {
      key: "canManageAllDrafts",
      labelAr: "إدارة كافة مسودات العمل (drafts.manage_all)",
      labelEn: "Manage All Workspace Drafts",
      descAr: "الاطلاع على مسودات العمل المشتركة والخاصة وحذفها وترقيتها",
    },
    {
      key: "canCustomUom",
      labelAr: "إضافة وحدات قياس مخصصة (inventory.custom_uom)",
      labelEn: "Create Custom Units of Measure",
      descAr: "إدخال وحدات قياس ومعاملات تحويل ديناميكية مخصصة",
    },
    {
      key: "canArchiveDeleteRecords",
      labelAr: "أرشفة وحذف السجلات الأساسية (records.archive_delete)",
      labelEn: "Archive / Safe-Delete Master Records",
      descAr: "أرشفة أو حذف العملاء والموردين والعمال والأصناف والمراكز",
    },
    {
      key: "canExecuteGateway",
      labelAr: "تنفيذ التحويلات البنكية والمحافظ (treasury.execute_gateway)",
      labelEn: "Execute Bank & E-Wallet Gateway Payouts",
      descAr: "صلاحية إرسال مبالغ الدفعات إلكترونياً للبنوك والمحافظ الرقمية",
    },
  ];

interface SystemTabProps {
  settings: UasSystemSettings;
  enterpriseProfile?: UasEnterpriseProfile | null;
  lang: LanguageCode;
  theme: ThemeName;
  currentUser: UasUser;
  users: UasUser[];
  projects?: UasProject[];
  offlineQueueCount?: number;
  readOnly?: boolean;
  canManageUsers?: boolean;
  canManageCms?: boolean;
  onSaveBranding: (
    orgName: string,
    logoText: string,
    extra?: { diskAlertThresholdPercent?: number }
  ) => Promise<void>;
  onSaveEnterpriseBranding?: (payload: Partial<UasEnterpriseProfile>) => Promise<void>;
  onChangeLang: (lang: LanguageCode) => void;
  onChangeTheme: (theme: ThemeName) => void;
  onUpdateProfile: (payload: {
    userId: string;
    name: string;
    avatarChar: string;
    newPassword?: string;
  }) => Promise<void>;
  onAddUser: (payload: { name: string; email: string; role: string }) => Promise<boolean>;
  onToggleUserStatus: (uid: string) => Promise<void>;
  onRefreshState?: () => Promise<void>;
  onOpenLogin: () => void;
  onToast: (msg: string) => void;
}

const DEFAULT_PROFILE_DRAFT: Partial<UasEnterpriseProfile> = {
  legalNameAr: "اسم المنشأة",
  legalNameEn: "Enterprise Name",
  brandColor: "#059669",
  faviconUrl: "",
  taglineAr: "",
  taglineEn: "",
  showUasLogo: true,
  uasLogoStyle: "official-brand",
  uasLogoCustomUrl: "",
  showEnterpriseLogo: false,
  enterpriseLogoStyle: "agri-leaf",
  enterpriseLogoCustomUrl: "",
  heroBadgeAr: "النظام المحاسبي الموحد • معيار 5 مستويات GL",
  heroBadgeEn: "Enterprise Unified Accounting System • 5-Tier Double-Entry GL",
  heroTitleAr: "إدارة مالية ومحاسبية متكاملة للمشاريع وسلاسل الإمداد",
  heroTitleEn: "Unified Double-Entry ERP for Projects, Treasury & Supply Chains",
  heroSubtitleAr:
    "تكامل تام بين المشتريات، المبيعات، الخزينة متعددة العملات، والأستاذ العام بتدقيق لحظي.",
  heroSubtitleEn:
    "End-to-end integration across procurement, sales, multi-currency treasury, and automated double-entry GL.",
  aboutMissionAr:
    "منصة محاسبية مؤسسية مصممة لإدارة دورات الإنتاج والمشاريع الاستثمارية بشفافية مالية ورقابة مزدوجة.",
  aboutMissionEn:
    "Enterprise ERP built for production cycles and capital projects with strict auditability.",
  ctaPrimaryTextAr: "دخول لوحة التحكم ERP",
  ctaPrimaryTextEn: "Launch ERP Workspace",
  contactPhone: "",
  contactWhatsApp: "",
  contactAddress: "",
  showPublicMetrics: true,
  showPublicVerify: true,
};

export function SystemTab({
  settings,
  enterpriseProfile,
  lang,
  theme,
  currentUser,
  users,
  projects = [],
  offlineQueueCount = 0,
  readOnly = false,
  canManageUsers = true,
  canManageCms = false,
  onSaveBranding,
  onSaveEnterpriseBranding,
  onChangeLang,
  onChangeTheme,
  onUpdateProfile,
  onAddUser,
  onToggleUserStatus,
  onRefreshState,
  onOpenLogin,
  onToast,
}: SystemTabProps) {
  const isAr = lang === "ar";
  const isRootPlatformHost =
    typeof window === "undefined" || !extractSubdomainSlugFromHost(window.location.host);
  const platformAdminEnabled = isPlatformAdminSurfaceEnabled();
  const isPlatformSuperadmin =
    platformAdminEnabled &&
    isRootPlatformHost &&
    (currentUser.email || "").trim().toLowerCase() === "admin@qat.world";

  const [activeSubTab, setActiveSubTab] = useState<
    | "branding"
    | "users"
    | "accounting"
    | "tenant-config"
    | "client-portal"
    | "devices"
    | "security"
    | "superadmin-licenses"
    | "control-panel"
  >("branding");

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const isValidSubTab = (
      s: string | null | undefined
    ): s is
      | "branding"
      | "users"
      | "accounting"
      | "tenant-config"
      | "client-portal"
      | "devices"
      | "security"
      | "superadmin-licenses"
      | "control-panel" =>
      s === "branding" ||
      s === "users" ||
      s === "accounting" ||
      s === "tenant-config" ||
      s === "client-portal" ||
      s === "devices" ||
      s === "security" ||
      ((s === "superadmin-licenses" || s === "control-panel") && isPlatformSuperadmin);

    const readInitialSubTab = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, "");
      const [hTab, hSub] = rawHash.split("/");
      if (hTab === "system" && isValidSubTab(hSub)) {
        setActiveSubTab(hSub);
        window.sessionStorage.setItem("uas_system_subtab", hSub);
        return;
      }
      const saved = window.sessionStorage.getItem("uas_system_subtab");
      if (isValidSubTab(saved)) {
        setActiveSubTab(saved);
        if (hTab === "system") {
          window.location.hash = `#/system/${saved}`;
        }
      }
    };

    readInitialSubTab();

    const handleHash = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, "");
      const [hTab, hSub] = rawHash.split("/");
      if (hTab === "system" && isValidSubTab(hSub)) {
        setActiveSubTab(hSub);
        window.sessionStorage.setItem("uas_system_subtab", hSub);
      }
    };

    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [isPlatformSuperadmin]);

  function handleSelectSubTab(
    subTab:
      | "branding"
      | "users"
      | "accounting"
      | "tenant-config"
      | "client-portal"
      | "devices"
      | "security"
      | "superadmin-licenses"
      | "control-panel"
  ) {
    setActiveSubTab(subTab);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("uas_system_subtab", subTab);
      window.location.hash = `#/system/${subTab}`;
    }
  }

  const [orgNameDraft, setOrgNameDraft] = useState<string | null>(null);
  const [logoTextDraft, setLogoTextDraft] = useState<string | null>(null);
  const [diskThresholdDraft, setDiskThresholdDraft] = useState<number | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState<string | null>(null);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showArchivedUsers, setShowArchivedUsers] = useState(false);
  const [userLifecycleBusyId, setUserLifecycleBusyId] = useState<string | null>(null);

  async function handleArchiveOrRestoreUser(user: UasUser, action: "archive" | "restore") {
    if (user.id === currentUser.id) return;
    const confirmText =
      action === "archive"
        ? isAr
          ? `هل تريد أرشفة المستخدم "${user.name}" وإلغاء ربط أجهزته من الترخيص؟`
          : `Archive user "${user.name}" and release their bound license seats?`
        : isAr
          ? `هل تريد استعادة المستخدم المؤرشف "${user.name}" وتفعيل حسابه؟`
          : `Restore archived user "${user.name}"?`;
    if (typeof window !== "undefined" && !window.confirm(confirmText)) return;

    setUserLifecycleBusyId(user.id);
    try {
      const res = await safeFetchJson<{ success?: boolean; message?: string; error?: string }>(
        `/api/users/${encodeURIComponent(user.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-uas-user-id": currentUser.id,
            "x-uas-role": String(currentUser.role),
            "x-uas-user-display": sanitizeHeaderValue(`${currentUser.name} (${currentUser.role})`),
          },
          body: JSON.stringify({
            action,
            actor: {
              userId: currentUser.id,
              userRole: currentUser.role,
              userDisplay: `${currentUser.name} (${currentUser.role})`,
            },
          }),
        }
      );
      if (!res.ok || !res.data?.success) {
        onToast(res.data?.error || (isAr ? "تعذر تحديث حالة أرشفة المستخدم" : "Failed to update user archive status"));
        return;
      }
      onToast(
        res.data.message ||
        (action === "archive"
          ? "تمت أرشفة المستخدم وتحرير مقعد الترخيص بنجاح"
          : "تمت استعادة المستخدم بنجاح")
      );
      onRefreshState?.();
    } finally {
      setUserLifecycleBusyId(null);
    }
  }

  async function handleDeleteUser(user: UasUser) {
    if (user.id === currentUser.id) {
      onToast(isAr ? "لا يمكنك حذف حسابك الحالي أثناء تسجيل الدخول به" : "You cannot delete your own active account");
      return;
    }
    const confirmText = isAr
      ? `هل تريد حذف المستخدم "${user.name}"؟\nسيتم الحذف النهائي إذا لم توجد سجلات محاسبية أو تدقيقية مرتبطة به، أو أرشفته تلقائياً مع تحرير مقعد الترخيص إذا وُجدت سجلات مرتبطة.`
      : `Delete user "${user.name}"? Users with no linked records are permanently deleted; users with accounting/audit records are automatically archived and their license seat is released.`;
    if (typeof window !== "undefined" && !window.confirm(confirmText)) return;

    const activeTenantId = getStoredTenantId() || (currentUser as { tenantId?: string })?.tenantId || "default";
    setUserLifecycleBusyId(user.id);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        deleted?: boolean;
        archived?: boolean;
        guardReason?: string;
        guidance?: string;
        message?: string;
        error?: string;
      }>(`/api/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-uas-tenant-id": activeTenantId,
          "x-uas-user-id": currentUser.id,
          "x-uas-role": String(currentUser.role),
          "x-uas-user-display": sanitizeHeaderValue(`${currentUser.name} (${currentUser.role})`),
        },
        body: JSON.stringify({
          targetUserId: user.id,
          targetUserEmail: user.email,
          tenantId: activeTenantId,
          actor: {
            userId: currentUser.id,
            userRole: currentUser.role,
            userDisplay: `${currentUser.name} (${currentUser.role})`,
            userEmail: currentUser.email,
          },
        }),
      });

      if (!res.ok || !res.data?.success) {
        const errorDetail =
          res.data?.error ||
          res.data?.message ||
          res.error ||
          (isAr ? "تعذر حذف المستخدم" : "Failed to delete user");

        const guardReason = res.data?.guardReason;
        const guidanceMsg =
          res.data?.guidance ||
          (guardReason === "LAST_ADMIN"
            ? (isAr
              ? "لا يمكن حذف أو أرشفة المشرف العام الوحيد المتبقي في المنشأة لضمان استمرارية إدارة النظام. يرجى إنشاء أو ترقية مشرف بديل أولاً، أو استخدام خيار الإيقاف المؤقت (إيقاف)."
              : "Cannot delete the last active SUPER_ADMIN. Designate a replacement admin first, or use Suspend.")
            : guardReason === "SELF_DELETION"
              ? (isAr
                ? "لا يمكن حذف الحساب المسجل به حالياً. يمكنك استخدام خيار إيقاف الحساب (إيقاف) أو تسليم الصلاحيات لمشرف آخر أولاً."
                : "Cannot delete your own active account. Use Suspend or transfer ownership.")
              : guardReason === "LINKED_RECORDS"
                ? (isAr
                  ? "توجد قيود أو سجلات محاسبية مرتبطة بهذا المستخدم. تم الاحتفاظ بالبيانات لحماية الدفاتر المحاسبية، يمكنك استخدام خيار الإيقاف أو الأرشفة."
                  : "Accounting/audit records exist for this user. Use Suspend or Archive to maintain audit integrity.")
                : "");

        const formatted = guidanceMsg && !errorDetail.includes(guidanceMsg)
          ? `⛔ ${errorDetail}\n💡 ${guidanceMsg}`
          : `⛔ ${errorDetail}`;

        onToast(formatted);
        return;
      }

      const successMsg =
        res.data.message ||
        (res.data.archived
          ? (isAr ? `تمت أرشفة المستخدم (${user.name}) بنجاح وتحرير مقعد الترخيص` : `User archived successfully`)
          : (isAr ? `تم حذف المستخدم (${user.name}) نهائياً وتحرير مقعد الترخيص` : `User removed successfully`));

      const guidanceSuffix = res.data.guidance ? `\n💡 ${res.data.guidance}` : "";
      onToast(`✅ ${successMsg}${guidanceSuffix}`);
      onRefreshState?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onToast(`⛔ ${isAr ? "تعذر حذف المستخدم" : "Failed to delete user"}: ${msg}`);
    } finally {
      setUserLifecycleBusyId(null);
    }
  }

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
  const activeTenantSlug = resolveActiveWorkspaceSlug({
    currentOriginOrHost: typeof window !== "undefined" ? window.location.host : undefined,
    profileTenantSlug: enterpriseProfile?.tenantSlug,
    storedTenantId:
      typeof window !== "undefined" ? getStoredTenantSlug() || getStoredTenantId() : null,
  });
  const defaultTenantCloudUrl = resolveTenantCloudUrl(activeTenantSlug, currentOrigin);

  const [serverUrlDraft, setServerUrlDraft] = useState(() => getApiBaseUrl());
  const [lanUrlDraft, setLanUrlDraft] = useState(() => getStoredServerUrls().lanUrl);
  const [testingServer, setTestingServer] = useState(false);
  const [detectingLan, setDetectingLan] = useState(false);
  const [lanAutoDetectStatus, setLanAutoDetectStatus] = useState<string | null>(null);
  const [connectionProbeWarning, setConnectionProbeWarning] = useState<string | null>(null);
  const [driftConfirmState, setDriftConfirmState] = useState<{
    open: boolean;
    targetUrl: string;
    warningAr: string;
    warningEn: string;
    resolvedTenantSlug?: string | null;
    offlineQueueCount: number;
  } | null>(null);
  const lanInputRef = React.useRef<HTMLInputElement | null>(null);

  const runAutoLanDetection = React.useCallback(
    async (opts?: { silent?: boolean; forceFocusOnEmpty?: boolean }) => {
      setDetectingLan(true);
      try {
        let serverLanIps: string[] = [];
        try {
          const runtimeRes = await safeFetchJson<{ lanIps?: string[]; lanUrl?: string }>(
            "/api/system/runtime",
            { cache: "no-store" }
          );
          if (runtimeRes.ok && Array.isArray(runtimeRes.data?.lanIps)) {
            serverLanIps = runtimeRes.data.lanIps;
          }
        } catch {
          // Optional server runtime hint unavailable (e.g. offline/mobile)
        }

        const detected = await detectReachableLanEndpoint({
          currentOrigin,
          savedLanUrl: lanUrlDraft || getStoredServerUrls().lanUrl,
          serverLanIps,
          expectedTenantSlug: activeTenantSlug,
          timeoutMs: 1500,
        });

        if (detected.detectedUrl) {
          setLanUrlDraft(detected.detectedUrl);
          setStoredLanUrl(detected.detectedUrl);
          const tenantTag = detected.probe?.tenantSlug || "default";
          setLanAutoDetectStatus(
            isAr
              ? `تم اكتشاف خادم شبكة محلي متاح (${detected.detectedUrl}) — النطاق: ${tenantTag}`
              : `Detected reachable LAN endpoint (${detected.detectedUrl}) — workspace: ${tenantTag}`
          );
          if (!opts?.silent) {
            onToast(
              isAr
                ? `✅ تم اكتشاف عنوان الشبكة المحلية تلقائياً: ${detected.detectedUrl}`
                : `✅ Auto-detected Office LAN endpoint: ${detected.detectedUrl}`
            );
          }
        } else {
          setLanAutoDetectStatus(
            isAr
              ? "لم يتم العثور على خادم LAN محلي مستجيب تلقائياً — يمكنك كتابة عنوان الشبكة يدوياً."
              : "No reachable local LAN server auto-detected — enter your Office LAN URL manually."
          );
          if (!opts?.silent) {
            onToast(
              isAr
                ? "ℹ️ لم يُكتشف خادم شبكة محلي متاح تلقائياً؛ أدخل عنوان LAN يدوياً."
                : "ℹ️ No LAN server auto-detected; please enter the LAN address manually."
            );
          }
          if (opts?.forceFocusOnEmpty) {
            lanInputRef.current?.focus();
          }
        }
      } finally {
        setDetectingLan(false);
      }
    },
    [activeTenantSlug, currentOrigin, isAr, lanUrlDraft, onToast]
  );

  useEffect(() => {
    if (activeSubTab !== "security") return;
    if (lanUrlDraft.trim()) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void runAutoLanDetection({ silent: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeSubTab, lanUrlDraft, runAutoLanDetection]);

  function handleLanUrlChange(nextVal: string) {
    setLanUrlDraft(nextVal);
    setStoredLanUrl(nextVal);
  }

  async function handleResetDefaultOrigin() {
    const restoredOrigin = resetApiBaseUrl({
      tenantSlug: activeTenantSlug,
      currentOrigin,
    });
    if (isNativeAndroid()) {
      setStoredRuntimeMode("cloud", restoredOrigin, undefined, {
        tenantSlug: activeTenantSlug,
        currentOrigin,
      });
    }
    setServerUrlDraft(restoredOrigin);
    setConnectionProbeWarning(null);
    onToast(
      isAr
        ? `✅ تمت استعادة الأصل الافتراضي للمنشأة: ${restoredOrigin}`
        : `✅ Restored default tenant origin: ${restoredOrigin}`
    );
  }

  async function handleSaveServerUrl(
    targetUrl: string,
    opts?: { bypassDriftConfirm?: boolean; markAsLan?: boolean }
  ) {
    const cleaned = targetUrl.trim().replace(/\/+$/, "");
    if (!cleaned) {
      await handleResetDefaultOrigin();
      return;
    }

    const liveQueueCount = Math.max(offlineQueueCount, await getOfflineQueueCount());
    const initialSwitchEval = evaluateConnectionOriginSwitch({
      activeTenantSlug,
      targetUrl: cleaned,
      currentOrigin,
      offlineQueueCount: liveQueueCount,
    });

    if (initialSwitchEval.requiresConfirmation && !opts?.bypassDriftConfirm) {
      setDriftConfirmState({
        open: true,
        targetUrl: cleaned,
        warningAr: initialSwitchEval.messageAr,
        warningEn: initialSwitchEval.messageEn,
        resolvedTenantSlug: initialSwitchEval.targetTenantSlug,
        offlineQueueCount: liveQueueCount,
      });
      return;
    }

    if (isHttpsToHttpMixedContent(cleaned)) {
      if (opts?.markAsLan || isPrivateLanOrigin(cleaned)) {
        setLanUrlDraft(cleaned);
        setStoredLanUrl(cleaned);
      }
      setServerUrlDraft(cleaned);
      setApiBaseUrl(cleaned);
      setConnectionProbeWarning(null);
      onToast(
        isAr
          ? `ℹ️ تم حفظ عنوان خادم الشبكة المحلية (${cleaned}) بنجاح. سيتصل تلقائياً عند فتح تطبيق أندرويد أو تطبيق سطح المكتب (تقييد المتصفح يمنع فحص HTTP من موقع HTTPS).`
          : `ℹ️ Office LAN URL (${cleaned}) saved. Desktop and Android apps will connect directly (direct HTTP probe from HTTPS browser is restricted).`
      );
      return;
    }

    setTestingServer(true);
    try {
      const probe = await probeTenantEndpoint(cleaned, { timeoutMs: 3500 });
      const resolvedSwitchEval = evaluateConnectionOriginSwitch({
        activeTenantSlug,
        targetUrl: cleaned,
        currentOrigin,
        offlineQueueCount: liveQueueCount,
        targetResolvedTenantSlug: probe.ok ? probe.tenantSlug : undefined,
        targetIsTenantWorkspace: probe.ok ? probe.isTenantWorkspace : undefined,
      });

      if (resolvedSwitchEval.requiresConfirmation && !opts?.bypassDriftConfirm) {
        setDriftConfirmState({
          open: true,
          targetUrl: cleaned,
          warningAr: resolvedSwitchEval.messageAr,
          warningEn: resolvedSwitchEval.messageEn,
          resolvedTenantSlug: probe.tenantSlug,
          offlineQueueCount: liveQueueCount,
        });
        return;
      }

      setServerUrlDraft(cleaned);
      setApiBaseUrl(cleaned);
      if (opts?.markAsLan || isPrivateLanOrigin(cleaned)) {
        setLanUrlDraft(cleaned);
        setStoredLanUrl(cleaned);
      }

      if (probe.ok) {
        if (resolvedSwitchEval.hasWarning) {
          const warnMsg = isAr ? resolvedSwitchEval.messageAr : resolvedSwitchEval.messageEn;
          setConnectionProbeWarning(warnMsg);
          onToast(`⚠️ ${warnMsg}`);
        } else {
          setConnectionProbeWarning(null);
          const resolvedLabel = probe.tenantSlug ? `${probe.tenantSlug}.qat.world` : "qat.world";
          onToast(
            isAr
              ? `✅ تم الاتصال والتحقق من المنشأة بنجاح: ${cleaned} (${resolvedLabel})`
              : `✅ Connected & verified workspace (${resolvedLabel}): ${cleaned}`
          );
        }
      } else {
        setConnectionProbeWarning(
          isAr
            ? `تعذر التحقق من /api/public/tenant على ${cleaned} (${probe.error || `HTTP ${probe.status}`})`
            : `Unable to verify /api/public/tenant at ${cleaned} (${probe.error || `HTTP ${probe.status}`})`
        );
        onToast(
          probe.error === "TIMEOUT"
            ? isAr
              ? `⚠️ لم يستجب الخادم خلال 3.5 ثوانٍ (${cleaned})`
              : `⚠️ Server timed out (${cleaned})`
            : isAr
              ? `⚠️ تم حفظ العنوان (${cleaned}) — تعذر الوصول إلى الخادم حالياً`
              : `⚠️ Saved (${cleaned}) — unable to reach server right now`
        );
      }
    } finally {
      setTestingServer(false);
    }
  }

  const [copiedApkLink, setCopiedApkLink] = useState(false);

  // Backup & Disaster Recovery States
  interface AutoBackupItem {
    filename: string;
    sizeFormatted: string;
    createdAt: string;
    type: "auto" | "pre-restore" | "manual";
    engine?: "postgresql" | "sqlite" | "portable";
    tenantSlug?: string;
  }
  interface BackupHealthSummary {
    tenantSlug: string;
    engine: "postgresql" | "sqlite";
    lastScheduledBackupAt: string | null;
    lastScheduledStatus: string | null;
    lastBackupFilename: string | null;
    lastBackupError: string | null;
    retentionPolicy: { daily: number; weekly: number; monthly: number; preRestore: number };
    diskUsagePercent: number;
    diskAlertThresholdPercent: number;
    diskWarningExceeded: boolean;
    diskTotalFormatted: string;
    diskUsedFormatted: string;
    diskAvailFormatted: string;
    tenantBackupsFormatted: string;
    attachmentsFormatted: string;
    attachmentsCount: number;
  }
  const [localBackups, setLocalBackups] = useState<AutoBackupItem[]>([]);
  const [backupHealth, setBackupHealth] = useState<BackupHealthSummary | null>(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [deletingBackupName, setDeletingBackupName] = useState<string | null>(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [confirmRestoreModal, setConfirmRestoreModal] = useState<{
    open: boolean;
    localSnapshotName?: string;
    file?: File | null;
  }>({ open: false });

  // Scoped Reset & Factory Format States
  const [resetScope, setResetScope] = useState<ResetScopeType>("section");
  const [resetSectionModule, setResetSectionModule] = useState<ResetSectionModule>("sales");
  const [resetUnitType, setResetUnitType] = useState<ResetUnitType>("project");
  const [resetUnitId, setResetUnitId] = useState<string>("");
  const [resetCoaMode, setResetCoaMode] = useState<FactoryCoaMode>("starter_template");
  const [resetConfirmationInput, setResetConfirmationInput] = useState<string>("");
  const [executingReset, setExecutingReset] = useState<boolean>(false);

  const expectedConfirmationPhrase =
    resetScope === "section"
      ? `RESET_SECTION_${resetSectionModule.toUpperCase()}`
      : resetScope === "unit"
        ? "RESET_UNIT"
        : "FACTORY_RESET";

  const handleExecuteScopedReset = async () => {
    if (currentUser.role !== "SUPER_ADMIN") {
      onToast(isAr ? "صلاحية المشرف العام مطلوبة" : "SUPER_ADMIN role required");
      return;
    }

    setExecutingReset(true);
    try {
      const baseUrl = getApiBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/system/reset` : "/api/system/reset";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-uas-role": currentUser.role,
          "x-uas-user-id": currentUser.id,
        },
        body: JSON.stringify({
          scope: resetScope,
          sectionModule: resetSectionModule,
          unitType: resetUnitType,
          unitId: resetUnitId,
          coaMode: resetCoaMode,
          confirmationPhrase: resetConfirmationInput,
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Reset failed");
      }

      onToast(isAr ? data.result.summaryAr : data.result.summaryEn);
      setResetConfirmationInput("");
      await fetchBackups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onToast(msg);
    } finally {
      setExecutingReset(false);
    }
  };

  const fetchBackups = React.useCallback(async () => {
    if (currentUser.role !== "SUPER_ADMIN" && !canManageUsers) return;
    setLoadingBackups(true);
    try {
      const baseUrl = getApiBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/system/backups` : "/api/system/backups";
      const res = await fetch(endpoint, {
        headers: {
          "x-uas-role": currentUser.role,
          "x-uas-user-id": currentUser.id,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.backups)) {
          setLocalBackups(data.backups);
        }
        if (data.health && typeof data.health === "object") {
          setBackupHealth(data.health as BackupHealthSummary);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch backups:", err);
    } finally {
      setLoadingBackups(false);
    }
  }, [currentUser.role, currentUser.id, canManageUsers]);

  useEffect(() => {
    if (activeSubTab === "security" && (currentUser.role === "SUPER_ADMIN" || canManageUsers)) {
      void Promise.resolve().then(() => fetchBackups());
    }
  }, [activeSubTab, currentUser.role, canManageUsers, fetchBackups]);

  async function handleDownloadBackup() {
    setDownloadingBackup(true);
    try {
      const baseUrl = getApiBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/system/backup` : "/api/system/backup";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-uas-role": currentUser.role,
          "x-uas-user-id": currentUser.id,
        },
        body: JSON.stringify({
          persist: true,
          actor: {
            userId: currentUser.id,
            userRole: currentUser.role,
            userDisplay: currentUser.displayName || currentUser.name,
          },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const contentDisp = res.headers.get("content-disposition") || "";
      const filenameMatch = contentDisp.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch ? filenameMatch[1] : `UAS-Backup-${new Date().toISOString().slice(0, 10)}.uasbak`;

      const blob = await res.blob();
      const arrayBuf = await blob.arrayBuffer();

      await exportOrShareBinaryFile({
        filename,
        mimeType: "application/json",
        data: arrayBuf,
        title: isAr ? "نسخة احتياطية لنظام UAS" : "UAS Accounting Backup",
      });

      onToast(isAr ? "✅ تم تحميل وحفظ النسخة الاحتياطية بنجاح" : "✅ Backup file exported successfully");
      await fetchBackups();
    } catch (err) {
      onToast(
        isAr
          ? `❌ فشل تحميل النسخة الاحتياطية: ${(err as Error).message}`
          : `❌ Backup download failed: ${(err as Error).message}`
      );
    } finally {
      setDownloadingBackup(false);
    }
  }

  async function handleDownloadSnapshotFile(filename: string) {
    try {
      const baseUrl = getApiBaseUrl();
      const endpoint = baseUrl
        ? `${baseUrl}/api/system/backups/${encodeURIComponent(filename)}`
        : `/api/system/backups/${encodeURIComponent(filename)}`;
      const res = await fetch(endpoint, {
        headers: {
          "x-uas-role": currentUser.role,
          "x-uas-user-id": currentUser.id,
        },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const arrayBuf = await blob.arrayBuffer();
      await exportOrShareBinaryFile({
        filename,
        mimeType: filename.endsWith(".db") ? "application/x-sqlite3" : "application/json",
        data: arrayBuf,
        title: isAr ? `تحميل النسخة: ${filename}` : `Download ${filename}`,
      });
      onToast(isAr ? `✅ تم تحميل ${filename}` : `✅ Downloaded ${filename}`);
    } catch (err) {
      onToast(
        isAr
          ? `❌ تعذر تحميل النسخة: ${(err as Error).message}`
          : `❌ Failed to download snapshot: ${(err as Error).message}`
      );
    }
  }

  async function handleDeleteSnapshot(filename: string) {
    if (readOnly) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        isAr
          ? `هل تريد حذف النسخة الاحتياطية "${filename}" نهائياً؟`
          : `Permanently delete snapshot "${filename}"?`
      );
      if (!ok) return;
    }
    setDeletingBackupName(filename);
    try {
      const res = await safeFetchJson<{ ok?: boolean; error?: string }>(
        `/api/system/backups/${encodeURIComponent(filename)}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-uas-role": currentUser.role,
            "x-uas-user-id": currentUser.id,
          },
          body: JSON.stringify({
            actor: {
              userId: currentUser.id,
              userRole: currentUser.role,
              userDisplay: currentUser.displayName || currentUser.name,
            },
          }),
        }
      );
      if (!res.ok || !res.data?.ok) {
        onToast(res.data?.error || (isAr ? "تعذر حذف النسخة الاحتياطية" : "Failed to delete snapshot"));
        return;
      }
      onToast(isAr ? `✅ تم حذف النسخة ${filename}` : `✅ Deleted snapshot ${filename}`);
      await fetchBackups();
    } finally {
      setDeletingBackupName(null);
    }
  }

  async function handleExecuteRestore(localSnapshotName?: string, fileToRestore?: File | null) {
    setRestoringBackup(true);
    try {
      const baseUrl = getApiBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/system/restore` : "/api/system/restore";

      let res: Response;
      if (fileToRestore) {
        const formData = new FormData();
        formData.append("file", fileToRestore);
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "x-uas-role": currentUser.role,
            "x-uas-user-id": currentUser.id,
          },
          body: formData,
        });
      } else if (localSnapshotName) {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-uas-role": currentUser.role,
            "x-uas-user-id": currentUser.id,
          },
          body: JSON.stringify({
            localSnapshotName,
            actor: {
              userId: currentUser.id,
              userRole: currentUser.role,
              userDisplay: currentUser.displayName || currentUser.name,
            },
          }),
        });
      } else {
        throw new Error(isAr ? "لم يتم تحديد أي ملف للاستعادة" : "No restore file or snapshot specified");
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (isAr ? "فشلت عملية الاستعادة" : "Restore failed"));
      }

      setConfirmRestoreModal({ open: false });
      onToast(
        isAr
          ? `✅ تمت استعادة قاعدة البيانات بنجاح! تم إنشاء نسخة أمان سابقة: ${data.preRestoreSnapshot}`
          : `✅ Database restored successfully! Safety pre-restore snapshot: ${data.preRestoreSnapshot}`
      );
      await fetchBackups();
      if (onRefreshState) {
        await onRefreshState();
      }
    } catch (err) {
      onToast(
        isAr
          ? `❌ فشلت استعادة النسخة الاحتياطية: ${(err as Error).message}`
          : `❌ Restore failed: ${(err as Error).message}`
      );
    } finally {
      setRestoringBackup(false);
    }
  }

  async function handleCopyApkLink() {
    const url = "https://qat.world/downloads/UAS-Mobile-Release-qat.world.apk";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopiedApkLink(true);
        onToast(
          isAr
            ? "✅ تم نسخ رابط تحميل تطبيق الأندرويد (APK)"
            : "✅ APK download link copied to clipboard"
        );
        setTimeout(() => setCopiedApkLink(false), 2500);
      }
    } catch {
      onToast(url);
    }
  }

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<string>("FIELD_ACCOUNTANT");

  const [cmsOverrides, setCmsOverrides] = useState<Partial<UasEnterpriseProfile> | null>(null);
  const [savingCms, setSavingCms] = useState(false);

  // User Permissions Drawer State
  const [permDrawerUser, setPermDrawerUser] = useState<UasUser | null>(null);
  const [permUseCustom, setPermUseCustom] = useState(false);
  const [permAllowedGroups, setPermAllowedGroups] = useState<ErpGroupId[]>([]);
  const [permActions, setPermActions] = useState<GranularActionPermissions>({
    canCreate: false,
    canEdit: false,
    canEditDate: false,
    canDeleteVoid: false,
    canApprove: false,
    canPostLedger: false,
    canLockPeriod: false,
    canManageTreasury: false,
    canManageLandingCms: false,
    canManageUsers: false,
    canCloseFiscalYear: false,
    canFxRevalue: false,
    canDecideApprovals: false,
    canConfigureApprovals: false,
    canManageAllDrafts: false,
    canCustomUom: false,
    canArchiveDeleteRecords: false,
    canExecuteGateway: false,
  });
  const [permAssignedProjects, setPermAssignedProjects] = useState<string[]>([]);
  const [permIsActive, setPermIsActive] = useState(true);
  const [savingPerms, setSavingPerms] = useState(false);

  // Admin Password Reset Modal State
  const [resetModalUser, setResetModalUser] = useState<UasUser | null>(null);
  const [resetNewPass, setResetNewPass] = useState("");
  const [resetMustChange, setResetMustChange] = useState(true);
  const [resetCopied, setResetCopied] = useState(false);
  const [resettingPass, setResettingPass] = useState(false);
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!resetModalUser) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setResetModalUser(null);
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [resetModalUser]);

  function openPermissionsDrawer(u: UasUser) {
    setPermDrawerUser(u);
    const useCustom = Boolean(u.useCustomPermissions);
    setPermUseCustom(useCustom);

    const normRole = normalizeRole(u.role);
    const roleDefaults = ROLE_DEFAULT_PERMISSIONS[normRole] || ROLE_DEFAULT_PERMISSIONS.FIELD_ACCOUNTANT;
    const defaultGroups = getAccessibleGroups(normRole);

    if (useCustom && u.customOverrides) {
      setPermAllowedGroups(u.customOverrides.allowedGroups || defaultGroups);
      setPermActions({
        canCreate: u.customOverrides.canCreate ?? roleDefaults.canCreate,
        canEdit: u.customOverrides.canEdit ?? roleDefaults.canEdit,
        canEditDate: u.customOverrides.canEditDate ?? roleDefaults.canEditDate,
        canDeleteVoid: u.customOverrides.canDeleteVoid ?? roleDefaults.canDeleteVoid,
        canApprove: u.customOverrides.canApprove ?? roleDefaults.canApprove,
        canPostLedger: u.customOverrides.canPostLedger ?? roleDefaults.canPostLedger,
        canLockPeriod: u.customOverrides.canLockPeriod ?? roleDefaults.canLockPeriod,
        canManageTreasury: u.customOverrides.canManageTreasury ?? roleDefaults.canManageTreasury,
        canManageLandingCms: u.customOverrides.canManageLandingCms ?? roleDefaults.canManageLandingCms,
        canManageUsers: u.customOverrides.canManageUsers ?? roleDefaults.canManageUsers,
        canCloseFiscalYear: u.customOverrides.canCloseFiscalYear ?? roleDefaults.canCloseFiscalYear,
        canFxRevalue: u.customOverrides.canFxRevalue ?? roleDefaults.canFxRevalue,
        canDecideApprovals: u.customOverrides.canDecideApprovals ?? roleDefaults.canDecideApprovals,
        canConfigureApprovals: u.customOverrides.canConfigureApprovals ?? roleDefaults.canConfigureApprovals,
        canManageAllDrafts: u.customOverrides.canManageAllDrafts ?? roleDefaults.canManageAllDrafts,
        canCustomUom: u.customOverrides.canCustomUom ?? roleDefaults.canCustomUom,
        canArchiveDeleteRecords: u.customOverrides.canArchiveDeleteRecords ?? roleDefaults.canArchiveDeleteRecords,
        canExecuteGateway: u.customOverrides.canExecuteGateway ?? roleDefaults.canExecuteGateway,
      });
    } else {
      setPermAllowedGroups([...defaultGroups]);
      setPermActions({ ...roleDefaults });
    }

    setPermAssignedProjects(u.assignedProjects ? [...u.assignedProjects] : []);
    setPermIsActive(u.active && (u.isActive ?? true));
  }

  function handleResetToRoleDefaults() {
    if (!permDrawerUser) return;
    const normRole = normalizeRole(permDrawerUser.role);
    const roleDefaults = ROLE_DEFAULT_PERMISSIONS[normRole] || ROLE_DEFAULT_PERMISSIONS.FIELD_ACCOUNTANT;
    const defaultGroups = getAccessibleGroups(normRole);

    setPermAllowedGroups([...defaultGroups]);
    setPermActions({ ...roleDefaults });
    onToast(isAr ? "تم استعادة الصلاحيات الافتراضية للدور الوظيفي" : "Restored role default permissions");
  }

  async function handleSavePermissions(e: React.FormEvent) {
    e.preventDefault();
    if (!permDrawerUser) return;
    setSavingPerms(true);
    try {
      const res = await fetch(`/api/users/${permDrawerUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          useCustomPermissions: permUseCustom,
          customAllowedGroups: permAllowedGroups,
          customPermissionsJson: JSON.stringify(permActions),
          assignedProjects: permAssignedProjects,
          isActive: permIsActive,
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update permissions");
      }

      onToast(
        isAr
          ? `تم تحديث صلاحيات وأمان المستخدم (${permDrawerUser.name}) بنجاح`
          : `Updated permissions for ${permDrawerUser.name}`
      );
      setPermDrawerUser(null);
      if (onRefreshState) {
        await onRefreshState();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onToast(msg);
    } finally {
      setSavingPerms(false);
    }
  }

  function generateRandomPass() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let randomPart = "";
    for (let i = 0; i < 4; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const num = Math.floor(1000 + Math.random() * 9000);
    return `UAS-${num}-${randomPart}!`;
  }

  function openResetPasswordModal(u: UasUser) {
    setResetModalUser(u);
    setResetNewPass(generateRandomPass());
    setResetMustChange(true);
    setResetCopied(false);
    setResetErrorMsg(null);
  }

  async function copyPassword() {
    if (!resetNewPass) return;
    try {
      await navigator.clipboard.writeText(resetNewPass);
      setResetCopied(true);
      setTimeout(() => setResetCopied(false), 2000);
      onToast(isAr ? "تم نسخ كلمة المرور إلى الحافظة" : "Password copied to clipboard");
    } catch {
      onToast(isAr ? "تعذر النسخ التلقائي" : "Could not copy");
    }
  }

  async function handleExecutePasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetModalUser || !resetNewPass) return;
    setResetErrorMsg(null);
    if (resetNewPass.trim().length < 6) {
      const shortMsg = isAr
        ? "يجب أن تتكون كلمة المرور الجديدة من 6 أحرف/أرقام على الأقل"
        : "Password must be at least 6 characters";
      setResetErrorMsg(shortMsg);
      onToast(shortMsg);
      return;
    }
    setResettingPass(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        message?: string;
        error?: string;
        sessionToken?: string;
      }>(`/api/users/${encodeURIComponent(resetModalUser.id)}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-uas-user-id": currentUser.id,
          "x-uas-role": String(currentUser.role),
          "x-uas-user-display": sanitizeHeaderValue(`${currentUser.name} (${currentUser.role})`),
        },
        body: JSON.stringify({
          newPassword: resetNewPass.trim(),
          mustChangePassword: resetMustChange,
          targetUserId: resetModalUser.id,
          targetUserEmail: resetModalUser.email,
          actor: {
            userId: currentUser.id,
            userDisplay: `${currentUser.name} (${currentUser.role})`,
            userRole: currentUser.role,
          },
        }),
      });

      if (!res.ok || !res.data?.success) {
        throw new Error(
          res.data?.error ||
          res.data?.message ||
          res.error ||
          (isAr ? "تعذر إعادة تعيين كلمة المرور" : "Failed to reset password")
        );
      }

      if (res.data.sessionToken) {
        setStoredSessionToken(res.data.sessionToken);
      }

      onToast(
        res.data.message ||
        (isAr
          ? `تمت إعادة تعيين كلمة المرور للمستخدم (${resetModalUser.name}) بنجاح`
          : `Password reset successfully for ${resetModalUser.name}`)
      );
      setResetModalUser(null);
      setResetNewPass("");
      setResetErrorMsg(null);
      if (onRefreshState) {
        await onRefreshState();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResetErrorMsg(msg);
      onToast(msg);
    } finally {
      setResettingPass(false);
    }
  }

  const cmsDraft: Partial<UasEnterpriseProfile> = {
    ...DEFAULT_PROFILE_DRAFT,
    ...(enterpriseProfile || {}),
    ...(cmsOverrides || {}),
  };

  function updateCmsDraft(
    updater: (prev: Partial<UasEnterpriseProfile>) => Partial<UasEnterpriseProfile>
  ) {
    setCmsOverrides((prevOverrides) =>
      updater({
        ...DEFAULT_PROFILE_DRAFT,
        ...(enterpriseProfile || {}),
        ...(prevOverrides || {}),
      })
    );
  }

  const orgName = orgNameDraft ?? settings.orgName;
  const logoText = logoTextDraft ?? settings.logoText;
  const profileName = profileNameDraft ?? currentUser.name;
  const profileAvatarChar = profileAvatarDraft ?? currentUser.avatarChar;

  async function handleLogoFileUpload(
    field: "uasLogoCustomUrl" | "enterpriseLogoCustomUrl" | "faviconUrl",
    styleField: "uasLogoStyle" | "enterpriseLogoStyle" | null,
    file?: File
  ) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      onToast(isAr ? "حجم الملف يجب أن لا يتجاوز 1 ميجابايت" : "Image file must be <= 1 MB");
      return;
    }

    if (field === "enterpriseLogoCustomUrl" || field === "faviconUrl") {
      const kind = field === "faviconUrl" ? "favicon" : "logo";
      const formData = new FormData();
      formData.append("kind", kind);
      formData.append("file", file);
      formData.append(
        "actor",
        JSON.stringify({
          userId: currentUser.id,
          userDisplay: `${currentUser.name} (${currentUser.role})`,
          userRole: currentUser.role,
        })
      );
      try {
        const res = await fetch("/api/system/branding/upload", {
          method: "POST",
          headers: {
            "x-uas-user-id": currentUser.id,
            "x-uas-role": String(currentUser.role),
            "x-uas-user-display": sanitizeHeaderValue(`${currentUser.name} (${currentUser.role})`),
          },
          body: formData,
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          assetUrl?: string;
          error?: string;
        };
        if (!res.ok || !data.success || !data.assetUrl) {
          onToast(data.error || (isAr ? "تعذر رفع الملف" : "Failed to upload brand asset"));
          return;
        }
        updateCmsDraft((prev) => ({
          ...prev,
          [field]: data.assetUrl,
          ...(kind === "logo"
            ? {
              logoUrl: data.assetUrl,
              enterpriseLogoStyle: "custom",
              showEnterpriseLogo: true,
            }
            : {}),
        }));
        onToast(
          kind === "favicon"
            ? isAr
              ? "✅ تم رفع أيقونة المتصفح (Favicon) المخصصة للمنشأة"
              : "✅ Custom tenant favicon uploaded"
            : isAr
              ? "✅ تم رفع شعار المنشأة المخصص وتحديث أيقونة التبويب"
              : "✅ Custom enterprise logo uploaded & browser tab icon updated"
        );
        await onRefreshState?.();
        return;
      } catch {
        onToast(isAr ? "تعذر الاتصال بالخادم لرفع الملف" : "Network error uploading asset");
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) {
        updateCmsDraft((prev) => ({
          ...prev,
          [field]: result,
          ...(styleField ? { [styleField]: "custom" } : {}),
        }));
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleResetDefaultBrand() {
    if (!onSaveEnterpriseBranding) return;
    setSavingCms(true);
    try {
      await onSaveEnterpriseBranding({
        resetToDefaultBrand: true,
      } as Partial<UasEnterpriseProfile> & { resetToDefaultBrand?: boolean });
      setCmsOverrides(null);
      await onRefreshState?.();
    } finally {
      setSavingCms(false);
    }
  }

  async function handleSaveCmsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onSaveEnterpriseBranding) return;
    setSavingCms(true);
    try {
      await onSaveEnterpriseBranding(cmsDraft);
      setCmsOverrides(null);
    } finally {
      setSavingCms(false);
    }
  }

  async function handleAddUserSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newUserName.trim()) {
      onToast("يرجى إدخال اسم المستخدم");
      return;
    }
    const ok = await onAddUser({
      name: newUserName.trim(),
      email: newUserEmail.trim() || "user@uas-ye.com",
      role: newUserRole,
    });
    if (ok) {
      setNewUserName("");
      setNewUserEmail("");
    }
  }

  return (
    <section className="space-y-6">
      {/* Admin Sub-Tabs Navigation */}
      <div className="border-b border-slate-200 dark:border-slate-700/80 pb-3 no-print">
        {/* Mobile / Narrow Viewport Accessible Admin Dropdown */}
        <div className="md:hidden">
          <select
            data-testid="system-subtab-select"
            aria-label={isAr ? "قسم إدارة النظام" : "System Administration Section"}
            value={activeSubTab}
            onChange={(e) => handleSelectSubTab(e.target.value as typeof activeSubTab)}
            className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-extrabold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <option value="branding">
              {isAr ? "الهوية المؤسسية وإدارة الصفحة (Branding & CMS)" : "Branding & Landing CMS"}
            </option>
            <option value="users">
              {isAr ? "المستخدمين وحوكمة الصلاحيات (Users & RBAC)" : "Users & RBAC Matrix"}
            </option>
            <option value="accounting">
              {isAr ? "الإعدادات المحاسبية والتشغيلية (Accounting Settings)" : "Accounting & Operational Settings"}
            </option>
            <option value="tenant-config">
              {isAr ? "إعدادات مساحة المنشأة (Tenant Config)" : "Tenant Admin Config"}
            </option>
            <option value="client-portal">
              {isAr ? "بوابة العملاء وإعدادات واتساب" : "Client Portal & WhatsApp Settings"}
            </option>
            <option value="devices">
              {isAr ? "أجهزة المنشأة والمزامنة (Devices)" : "Tenant Devices Control"}
            </option>
            <option value="security">
              {isAr ? "إعدادات النظام والأمان والربط (Settings & Connectivity)" : "System Settings & Connectivity"}
            </option>
            {isPlatformSuperadmin && (
              <>
                <option value="superadmin-licenses">
                  {isAr ? "مولد التراخيص والمنشآت (Superadmin)" : "Superadmin License Generator"}
                </option>
                <option value="control-panel">
                  {isAr ? "لوحة تحكم المنصة (الحوكمة الكاملة)" : "Platform Control Panel"}
                </option>
              </>
            )}
          </select>
        </div>

        {/* Desktop Admin Sub-Tab Strip */}
        <div className="hidden md:flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleSelectSubTab("branding")}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "branding"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
          >
            <Palette className="w-4 h-4" />
            <span>{isAr ? "الهوية المؤسسية وإدارة الصفحة (Branding & CMS)" : "Branding & Landing CMS"}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectSubTab("users")}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "users"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
          >
            <Shield className="w-4 h-4" />
            <span>{isAr ? "المستخدمين وحوكمة الصلاحيات (Users & RBAC)" : "Users & RBAC Matrix"}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectSubTab("accounting")}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "accounting"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
          >
            <FileText className="w-4 h-4" />
            <span>{isAr ? "الإعدادات المحاسبية والتشغيلية (Accounting Settings)" : "Accounting & Operational Settings"}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectSubTab("tenant-config")}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "tenant-config"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
          >
            <Globe className="w-4 h-4" />
            <span>{isAr ? "إعدادات مساحة المنشأة (Tenant Config)" : "Tenant Admin Config"}</span>
          </button>
          <button
            type="button"
            data-testid="system-subtab-client-portal"
            onClick={() => handleSelectSubTab("client-portal")}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "client-portal"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>{isAr ? "بوابة العملاء وإعدادات واتساب" : "Client Portal & WhatsApp"}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectSubTab("devices")}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "devices"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>{isAr ? "أجهزة المنشأة والمزامنة (Devices)" : "Tenant Devices Control"}</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectSubTab("security")}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "security"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
              }`}
          >
            <Sliders className="w-4 h-4" />
            <span>{isAr ? "إعدادات النظام والأمان والربط (Settings & Connectivity)" : "System Settings & Connectivity"}</span>
          </button>
          {isPlatformSuperadmin && (
            <>
              <button
                type="button"
                onClick={() => handleSelectSubTab("superadmin-licenses")}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "superadmin-licenses"
                  ? "accent-bg shadow-sm"
                  : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                  }`}
              >
                <KeyRound className="w-4 h-4" />
                <span>
                  {isAr
                    ? "مولد التراخيص والمنشآت (Superadmin)"
                    : "Superadmin License Generator"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectSubTab("control-panel")}
                className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${activeSubTab === "control-panel"
                  ? "accent-bg shadow-sm"
                  : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30"
                  }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {isAr
                    ? "لوحة تحكم المنصة (الحوكمة الكاملة)"
                    : "Platform Control Panel"}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {isPlatformSuperadmin && activeSubTab === "superadmin-licenses" && SuperadminLicenseGeneratorPanel && (
        <SuperadminLicenseGeneratorPanel
          lang={lang}
          onToast={onToast}
          showStandaloneLink
        />
      )}

      {isPlatformSuperadmin && activeSubTab === "control-panel" && PlatformControlPanel && (
        <PlatformControlPanel
          lang={lang}
          onToast={onToast}
          showStandaloneLinks
        />
      )}

      {activeSubTab === "tenant-config" && (
        <TenantAdminConfigPanel
          lang={lang}
          currentUser={currentUser}
          readOnly={readOnly || (!canManageUsers && !canManageCms)}
          onRefreshState={onRefreshState}
          onToast={onToast}
        />
      )}

      {activeSubTab === "client-portal" && (
        <TenantClientPortalAdminPanel
          initialSection="settings"
          canManageSettings={Boolean(
            !readOnly &&
              (canManageUsers ||
                canManageCms ||
                canEdit(currentUser, "system") ||
                currentUser.role === "SUPER_ADMIN" ||
                currentUser.role === "CHIEF_ACCOUNTANT")
          )}
          onRefreshState={async () => {
            await onRefreshState?.();
          }}
          onToast={onToast}
        />
      )}

      {activeSubTab === "devices" && (
        <TenantDevicesPanel
          lang={lang}
          currentUser={currentUser}
          readOnly={readOnly || !canManageUsers}
          onToast={onToast}
        />
      )}

      {activeSubTab === "accounting" && (
        <div className="space-y-5">
          <div className="card-surface rounded-2xl p-5">
            <AccountingSettingsPanel
              lang={lang}
              readOnly={readOnly || !canManageUsers}
              onToast={onToast}
            />
          </div>
          <ApprovalRulesMatrixPanel
            readOnly={readOnly || !canManageUsers}
            onToast={onToast}
          />
        </div>
      )}

      {activeSubTab === "security" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card-surface rounded-2xl p-5 space-y-4 text-xs">
            <h3 className="text-sm font-extrabold border-b pb-2">
              إعدادات النظام والشعار (System Settings &amp; Logo)
            </h3>
            <div>
              <label className="block font-semibold mb-1">اسم النظام / المؤسسة</label>
              <input
                value={orgName}
                onChange={(e) => setOrgNameDraft(e.target.value)}
                type="text"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">رمز الشعار (System Logo Text)</label>
              <input
                value={logoText}
                onChange={(e) => setLogoTextDraft(e.target.value)}
                type="text"
                maxLength={5}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">لغة النظام (Language)</label>
                <select
                  value={lang}
                  onChange={(e) => onChangeLang(e.target.value as LanguageCode)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  <option value="ar">العربية (Arabic RTL)</option>
                  <option value="en">English (LTR)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">مظهر النظام (Themes)</label>
                <select
                  value={theme}
                  onChange={(e) => onChangeTheme(e.target.value as ThemeName)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  <option value="emerald">الأخضر الزراعي (Emerald)</option>
                  <option value="dark">الوضع الداكن (Dark)</option>
                  <option value="royal">الأزرق الملكي (Royal)</option>
                </select>
              </div>
            </div>
            <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
              <label className="block font-semibold mb-1">
                {isAr
                  ? "حد تنبيه امتلاء القرص (%) / Disk Alert Threshold (%)"
                  : "Disk Alert Threshold (%) / حد تنبيه امتلاء القرص"}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={50}
                  max={95}
                  step={1}
                  data-testid="disk-alert-threshold-input"
                  value={
                    diskThresholdDraft ??
                    (typeof settings.diskAlertThresholdPercent === "number"
                      ? settings.diskAlertThresholdPercent
                      : 80)
                  }
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    setDiskThresholdDraft(Number.isFinite(num) ? num : 80);
                  }}
                  className="w-28 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono font-bold"
                />
                <span className="text-[11px] text-slate-500">
                  {isAr
                    ? "% (النطاق: 50%–95%، الافتراضي: 80%)"
                    : "% (Range: 50%–95%, default: 80%)"}
                </span>
              </div>
            </div>
            <button
              onClick={async () => {
                const rawThreshold =
                  diskThresholdDraft ??
                  (typeof settings.diskAlertThresholdPercent === "number"
                    ? settings.diskAlertThresholdPercent
                    : 80);
                const clampedThreshold = Math.min(95, Math.max(50, Math.round(rawThreshold)));
                await onSaveBranding(orgName, logoText, {
                  diskAlertThresholdPercent: clampedThreshold,
                });
                setOrgNameDraft(null);
                setLogoTextDraft(null);
                setDiskThresholdDraft(null);
                await fetchBackups();
              }}
              disabled={readOnly || !canManageUsers}
              className="w-full py-2.5 rounded-xl accent-bg font-bold disabled:opacity-50"
            >
              {isAr ? "حفظ إعدادات النظام" : "Save System Settings"}
            </button>
          </div>

          {/* Current User Profile & Password Reset */}
          <div className="card-surface rounded-2xl p-5 space-y-4 text-xs">
            <h4 className="font-extrabold text-sm border-b pb-2">
              الملف الشخصي وإعادة تعيين كلمة المرور (User Profile &amp; Password Reset)
            </h4>
            <div>
              <label className="block font-semibold mb-1">الاسم الكامل (User Information)</label>
              <input
                value={profileName}
                onChange={(e) => setProfileNameDraft(e.target.value)}
                type="text"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">
                الحرف الرمزي للصورة (Profile Picture Avatar)
              </label>
              <input
                value={profileAvatarChar}
                onChange={(e) => setProfileAvatarDraft(e.target.value)}
                type="text"
                maxLength={2}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">
                كلمة المرور الجديدة (Password Reset)
              </label>
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                type="password"
                placeholder="أدخل كلمة المرور الجديدة..."
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <button
              onClick={async () => {
                await onUpdateProfile({
                  userId: currentUser.id,
                  name: profileName,
                  avatarChar: profileAvatarChar,
                  newPassword: newPassword || undefined,
                });
                setProfileNameDraft(null);
                setProfileAvatarDraft(null);
                setNewPassword("");
              }}
              disabled={readOnly}
              className="w-full py-2 rounded-xl border border-emerald-600 text-emerald-600 font-bold disabled:opacity-50"
            >
              تحديث الملف الشخصي وكلمة المرور
            </button>
          </div>

          {/* Office LAN & Cloud Server Connection (LAN & Mobile APK) — Restricted to Administrators */}
          {(canManageUsers || currentUser.role === "SUPER_ADMIN") && (
            <div className="card-surface rounded-2xl p-5 space-y-4 text-xs lg:col-span-2 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <Wifi className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm">
                      {isAr
                        ? "إعدادات الاتصال بالخادم والشبكة المحلية (Office LAN & Cloud Connection)"
                        : "Office LAN / Cloud Server Connection (API Base URL)"}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isAr
                        ? "تكوين عنوان الخادم للشبكة المحلية (LAN & Wi-Fi) والسحابة وتطبيقات الأندرويد (Mobile APK)"
                        : "Configure server endpoint for Office LAN Wi-Fi, Cloud deployment, and Android APK synchronization"}
                    </p>
                  </div>
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">
                  <span className="text-slate-500">{isAr ? "الخادم النشط:" : "Active Endpoint:"}</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {serverUrlDraft || defaultTenantCloudUrl}
                  </span>
                </div>
              </div>

              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs">
                {isAr
                  ? `عند تشغيل النظام داخل شبكة المكتب المحلية (Office Wi-Fi) أو ربط تطبيق الأندرويد أو أجهزة الكاشير والمحاسبين، أدخل عنوان الخادم المخصص أو استخدم السحابة الإنتاجية للمنشأة (${defaultTenantCloudUrl}).`
                  : `When operating inside the office local network or connecting Android APK tablets and remote workstations, enter your custom server address or connect to your workspace cloud (${defaultTenantCloudUrl}).`}
              </p>

              <div className="flex flex-wrap gap-2.5" dir="ltr">
                <input
                  type="url"
                  value={serverUrlDraft}
                  onChange={(e) => setServerUrlDraft(e.target.value)}
                  placeholder={defaultTenantCloudUrl}
                  className="flex-1 min-w-[240px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 py-2.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <button
                  type="button"
                  disabled={testingServer || readOnly}
                  onClick={() => void handleSaveServerUrl(serverUrlDraft)}
                  className="px-4 py-2.5 rounded-xl accent-bg font-extrabold flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>
                    {testingServer
                      ? isAr
                        ? "جاري التحقق والاتصال..."
                        : "Verifying connection..."
                      : isAr
                        ? "حفظ واختبار الاتصال"
                        : "Save & Test Connection"}
                  </span>
                </button>
              </div>

              {/* Editable & Auto-Detecting Office LAN Endpoint (Starts Empty) */}
              <div className="p-3.5 rounded-2xl bg-slate-50/80 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>
                      {isAr
                        ? "عنوان خادم الشبكة المحلية (Office LAN — قابل للتعديل والاكتشاف التلقائي):"
                        : "Office LAN Server URL (Editable & Auto-Detect):"}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={detectingLan}
                    onClick={() => void runAutoLanDetection({ silent: false })}
                    className="px-2.5 py-1 rounded-lg border border-indigo-500/40 bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 hover:border-indigo-500 font-bold text-[11px] inline-flex items-center gap-1 transition disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${detectingLan ? "animate-spin" : ""}`} />
                    <span>{isAr ? "اكتشاف الشبكة تلقائياً" : "Auto-Detect LAN"}</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-2" dir="ltr">
                  <input
                    ref={lanInputRef}
                    data-testid="editable-lan-url-input"
                    type="url"
                    value={lanUrlDraft}
                    onChange={(e) => handleLanUrlChange(e.target.value)}
                    placeholder={
                      isAr
                        ? "اتركه فارغاً أو أدخل عنوان LAN (مثلاً http://<lan-ip>:3000)"
                        : "Empty by default — enter Office LAN URL if applicable"
                    }
                    className="flex-1 min-w-[220px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <button
                    type="button"
                    disabled={testingServer || readOnly || !lanUrlDraft.trim()}
                    onClick={() => void handleSaveServerUrl(lanUrlDraft, { markAsLan: true })}
                    className="px-3.5 py-2 rounded-xl border border-indigo-500/40 bg-indigo-600 text-white font-bold text-[11px] hover:bg-indigo-700 disabled:opacity-40 transition"
                  >
                    {isAr ? "اتصال بالـ LAN" : "Connect LAN"}
                  </button>
                </div>

                {lanAutoDetectStatus && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {lanAutoDetectStatus}
                  </p>
                )}
              </div>

              {connectionProbeWarning && (
                <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-[11px] font-bold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{connectionProbeWarning}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-500">
                  {isAr ? "الإعدادات السريعة الجاهزة:" : "Quick Presets:"}
                </span>
                <button
                  type="button"
                  data-testid="cloud-preset-button"
                  onClick={() => void handleSaveServerUrl(defaultTenantCloudUrl)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-mono text-[11px] hover:border-emerald-500 hover:text-emerald-600 transition flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Cloud: {defaultTenantCloudUrl}</span>
                </button>
                <button
                  type="button"
                  data-testid="lan-preset-button"
                  onClick={() => {
                    if (lanUrlDraft.trim()) {
                      void handleSaveServerUrl(lanUrlDraft, { markAsLan: true });
                    } else {
                      void runAutoLanDetection({ silent: false, forceFocusOnEmpty: true });
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-mono text-[11px] hover:border-indigo-500 hover:text-indigo-600 transition flex items-center gap-1.5"
                >
                  <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                  <span>
                    {lanUrlDraft.trim()
                      ? `LAN: ${lanUrlDraft.trim()}`
                      : isAr
                        ? "LAN: غير محدد (اكتشاف/تعديل)"
                        : "LAN: Empty (Detect / Edit)"}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="reset-default-origin-button"
                  onClick={() => void handleResetDefaultOrigin()}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-[11px] hover:border-rose-500 hover:text-rose-600 transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                  <span>{isAr ? "استعادة الأصل الافتراضي للمنشأة" : "Reset Default Origin"}</span>
                </button>
              </div>

              {/* Staff Mobile App Distribution Row */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900/40 p-3 rounded-2xl">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-extrabold text-xs text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span>{isAr ? "توزيع تطبيق الجوال للموظفين (Android APK)" : "Staff Mobile App Distribution (Android APK)"}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white font-mono">v2.0</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono" dir="ltr">
                      https://qat.world/downloads/UAS-Mobile-Release-qat.world.apk
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href="https://qat.world/downloads/UAS-Setup-Win64.exe"
                    download="UAS-Setup-Win64.exe"
                    className="px-3 py-1.5 rounded-xl border border-indigo-500/40 bg-indigo-50/60 dark:bg-indigo-950/30 font-bold text-xs flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 hover:border-indigo-500 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isAr ? "ويندوز (.exe)" : "Windows (.exe)"}</span>
                  </a>

                  <a
                    href="https://qat.world/downloads/UAS-Mobile-Release-qat.world.apk"
                    download="UAS-Mobile-Release-qat.world.apk"
                    className="px-3 py-1.5 rounded-xl accent-bg font-extrabold text-xs flex items-center gap-1.5 shadow-xs hover:opacity-95 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isAr ? "تحميل APK" : "Download APK"}</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => void handleCopyApkLink()}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-xs hover:border-emerald-500 flex items-center gap-1.5 transition text-slate-700 dark:text-slate-200"
                  >
                    {copiedApkLink ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-600">{isAr ? "تم النسخ!" : "Copied!"}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>{isAr ? "نسخ الرابط" : "Copy Link"}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Backup & Disaster Recovery Card (Restricted to Administrators) */}
          {(canManageUsers || currentUser.role === "SUPER_ADMIN") && (
            <div className="card-surface rounded-2xl p-5 space-y-4 text-xs lg:col-span-2 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm">
                      {isAr
                        ? "النسخ الاحتياطي واستعادة البيانات (Backup & Disaster Recovery)"
                        : "Database Backup & Disaster Recovery"}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isAr
                        ? "تصدير حزم آمنة (.uasbak)، الاستعادة مع فحص السلامة وتطابق المنشأة، والنسخ التلقائي اليومي"
                        : "Encrypted export (.uasbak), verified restore with company lock, and daily rolling snapshots"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadBackup}
                    disabled={downloadingBackup}
                    className="px-4 py-2 rounded-xl accent-bg font-extrabold flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition"
                  >
                    {downloadingBackup ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {downloadingBackup
                        ? isAr
                          ? "جاري التصدير..."
                          : "Exporting..."
                        : isAr
                          ? "تحميل نسخة احتياطية الآن (.uasbak)"
                          : "Download Backup (.uasbak)"}
                    </span>
                  </button>

                  <label className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-500 font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition">
                    <Upload className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{isAr ? "استعادة من ملف" : "Restore from File"}</span>
                    <input
                      type="file"
                      accept=".uasbak,.db,.dump,.json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setConfirmRestoreModal({ open: true, file });
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Informational Note */}
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs">
                {isAr
                  ? "يضمن نظام UAS استمرارية الأعمال وحماية البيانات المالية عبر أخذ نسخ احتياطية ذرية مشفرة. عند استعادة أي نسخة، يتحقق النظام تلقائياً من سلامة قاعدة البيانات وتطابق اسم المنشأة المرخصة، ويحتفظ بنسخة أمان فورية قبل أي تعديل."
                  : "UAS ensures business continuity through atomic consistent snapshots. Before any restore executes, the system verifies SQLite integrity and company lock, and automatically creates a safety pre-restore backup."}
              </p>

              {/* Storage, Retention & Alert Health Summary */}
              {backupHealth && (
                <div
                  data-testid="backup-health-summary-card"
                  className="rounded-xl p-3.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-bold text-[11px]">
                        {isAr ? "المحرك:" : "Engine:"}{" "}
                        {backupHealth.engine === "postgresql" ? "PostgreSQL" : "SQLite"}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${backupHealth.lastScheduledStatus === "FAILED"
                          ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          }`}
                      >
                        {isAr ? "النسخ المجدول:" : "Scheduled:"}{" "}
                        {backupHealth.lastScheduledStatus || (isAr ? "قيد الانتظار" : "Pending")}
                        {backupHealth.lastScheduledBackupAt
                          ? ` • ${new Date(backupHealth.lastScheduledBackupAt).toLocaleString(
                            isAr ? "ar-EG" : "en-US",
                            { dateStyle: "short", timeStyle: "short" }
                          )}`
                          : ""}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold text-[11px] inline-flex items-center gap-1 ${backupHealth.diskWarningExceeded
                          ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30"
                          : "bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                      >
                        {backupHealth.diskWarningExceeded && (
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                        )}
                        <span>
                          {isAr ? "القرص:" : "Disk:"} {backupHealth.diskUsagePercent}% /{" "}
                          {isAr ? "الحد:" : "Threshold:"} {backupHealth.diskAlertThresholdPercent}%
                          {backupHealth.diskWarningExceeded
                            ? isAr
                              ? " (تجاوز الحد!)"
                              : " (Threshold Exceeded!)"
                            : ""}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                      <div className="text-slate-400">
                        {isAr ? "سياسة الاحتفاظ (GFS):" : "GFS Retention Policy:"}
                      </div>
                      <div className="font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                        {isAr
                          ? `${backupHealth.retentionPolicy.daily} يومي / ${backupHealth.retentionPolicy.weekly} أسبوعي / ${backupHealth.retentionPolicy.monthly} شهري (${backupHealth.retentionPolicy.preRestore} أمان)`
                          : `${backupHealth.retentionPolicy.daily} daily / ${backupHealth.retentionPolicy.weekly} weekly / ${backupHealth.retentionPolicy.monthly} monthly (${backupHealth.retentionPolicy.preRestore} safety)`}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                      <div className="text-slate-400">
                        {isAr ? "حجم نسخ المنشأة / المرفقات:" : "Tenant Backups / Attachments:"}
                      </div>
                      <div className="font-mono font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                        {backupHealth.tenantBackupsFormatted} • {backupHealth.attachmentsFormatted}{" "}
                        ({backupHealth.attachmentsCount})
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                      <div className="text-slate-400">
                        {isAr ? "مساحة الخادم المتاحة:" : "Server Disk Free / Total:"}
                      </div>
                      <div className="font-mono font-bold text-slate-700 dark:text-slate-200 mt-0.5">
                        {backupHealth.diskAvailFormatted} / {backupHealth.diskTotalFormatted}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Local Rolling Backups Table */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Archive className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-extrabold text-xs text-slate-800 dark:text-slate-200">
                      {isAr ? "النسخ الاحتياطية على الخادم (Server & GFS Snapshots):" : "Server & GFS Snapshots:"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={fetchBackups}
                    disabled={loadingBackups}
                    className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                    title={isAr ? "تحديث القائمة" : "Refresh"}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingBackups ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {loadingBackups ? (
                  <div className="p-4 text-center text-slate-400 font-bold">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-emerald-600" />
                    <span>{isAr ? "جاري فحص النسخ الاحتياطية..." : "Loading backups..."}</span>
                  </div>
                ) : localBackups.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-center text-slate-400">
                    {isAr
                      ? "لا توجد نسخ احتياطية مسجلة حالياً على الخادم (يتم إنشاؤها تلقائياً يومياً)"
                      : "No local rolling snapshots found (created automatically once per 24 hours)"}
                  </div>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                    <table className="w-full text-start text-xs font-medium min-w-[540px]">
                      <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <tr>
                          <th className="py-2 px-3 text-start">{isAr ? "اسم الملف" : "Filename"}</th>
                          <th className="py-2 px-3 text-start">{isAr ? "النوع" : "Type"}</th>
                          <th className="py-2 px-3 text-start">{isAr ? "الحجم" : "Size"}</th>
                          <th className="py-2 px-3 text-start">{isAr ? "تاريخ الإنشاء" : "Created At"}</th>
                          <th className="py-2 px-3 text-end">{isAr ? "الإجراءات" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {localBackups.map((b) => (
                          <tr key={b.filename} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition">
                            <td className="py-2 px-3 font-mono font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span className="truncate max-w-[210px]">{b.filename}</span>
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex flex-wrap items-center gap-1">
                                {b.type === "auto" ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                                    {isAr ? "تلقائي يومي" : "Daily Auto"}
                                  </span>
                                ) : b.type === "pre-restore" ? (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
                                    {isAr ? "أمان قبل الاستعادة" : "Pre-Restore"}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    {isAr ? "يدوي" : "Manual"}
                                  </span>
                                )}
                                {b.engine && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-500">
                                    {b.engine === "postgresql" ? "PG" : b.engine === "sqlite" ? "SQLite" : "V2"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-500">{b.sizeFormatted}</td>
                            <td className="py-2 px-3 font-mono text-slate-500">
                              {new Date(b.createdAt).toLocaleString(isAr ? "ar-EG" : "en-US", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </td>
                            <td className="py-2 px-3 text-end">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadSnapshotFile(b.filename)}
                                  className="px-2 py-1 rounded-lg border border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white font-bold text-[11px] inline-flex items-center gap-1 transition"
                                  title={isAr ? "تحميل" : "Download"}
                                >
                                  <Download className="w-3 h-3" />
                                  <span className="hidden sm:inline">{isAr ? "تحميل" : "Download"}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmRestoreModal({
                                      open: true,
                                      localSnapshotName: b.filename,
                                    })
                                  }
                                  disabled={restoringBackup}
                                  className="px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500 hover:text-white font-bold text-[11px] transition"
                                >
                                  {isAr ? "استعادة" : "Restore"}
                                </button>
                                {!readOnly && (
                                  <button
                                    type="button"
                                    disabled={deletingBackupName === b.filename}
                                    onClick={() => void handleDeleteSnapshot(b.filename)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition disabled:opacity-40"
                                    title={isAr ? "حذف النسخة" : "Delete Snapshot"}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scoped Reset & Factory Format Panel */}
          {currentUser.role === "SUPER_ADMIN" && (
            <div className="card-surface rounded-2xl p-5 space-y-4 border border-rose-500/30">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-rose-700 dark:text-rose-400">
                      {isAr
                        ? "إعادة الضبط الموجه والتهيئة المصنعية (Scoped Reset & Factory Format)"
                        : "Scoped Reset & Factory Format"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {isAr
                        ? "تصفير منظم للعمليات بحسب القسم، المشروع، أو تهيئة مصنعية شاملة مع حفظ نسخة أمان وصيانة التراخيص"
                        : "Controlled reset by module, project unit, or full factory zeroing with automated safety backup"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Scope Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-bold">
                <button
                  type="button"
                  data-testid="reset-scope-section"
                  onClick={() => setResetScope("section")}
                  className={`p-3 rounded-xl border text-start transition ${resetScope === "section"
                    ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                >
                  <div className="font-extrabold">{isAr ? "1. إعادة ضبط بحسب القسم / الموديول" : "1. By Section / Module"}</div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    {isAr ? "تصفير المبيعات، المشتريات، المخزون، أو الخزينة فقط" : "Reset sales, procurement, inventory, or treasury"}
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="reset-scope-unit"
                  onClick={() => setResetScope("unit")}
                  className={`p-3 rounded-xl border text-start transition ${resetScope === "unit"
                    ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                >
                  <div className="font-extrabold">{isAr ? "2. إعادة ضبط بحسب المشروع / الوحدة" : "2. By Project / Unit"}</div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    {isAr ? "تصفير حركات مشروع أو مركز تكلفة مع بقاء الوحدات الأخرى" : "Clear single project or cost-center records"}
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="reset-scope-factory"
                  onClick={() => setResetScope("factory")}
                  className={`p-3 rounded-xl border text-start transition ${resetScope === "factory"
                    ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                >
                  <div className="font-extrabold">{isAr ? "3. تهيئة مصنعية شاملة (Factory)" : "3. Full Factory Format"}</div>
                  <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                    {isAr ? "تصفير كافة العمليات وبدء دورة جديدة مع صيانة التراخيص" : "Zero all transactions, preserving licenses"}
                  </div>
                </button>
              </div>

              {/* Sub-options */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                {resetScope === "section" && (
                  <div>
                    <label className="block text-slate-500 mb-1 font-bold">
                      {isAr ? "حدد القسم المراد تصفيره:" : "Select Target Module:"}
                    </label>
                    <select
                      value={resetSectionModule}
                      onChange={(e) => setResetSectionModule(e.target.value as ResetSectionModule)}
                      className="w-full sm:w-80 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold"
                    >
                      <option value="sales">{isAr ? "قسم المبيعات والعملاء (Sales & Receivables)" : "Sales & Receivables"}</option>
                      <option value="procurement">{isAr ? "قسم المشتريات والموردين (Procurement & Payables)" : "Procurement & Payables"}</option>
                      <option value="inventory">{isAr ? "قسم المخزون والأصناف (Inventory & Stock)" : "Inventory & Stock"}</option>
                      <option value="treasury">{isAr ? "قسم الخزينة والبنوك (Treasury & Cash/Bank)" : "Treasury & Cash/Bank"}</option>
                      <option value="expenses_wages">{isAr ? "قسم المصروفات وأجور العمال (Expenses & Wages)" : "Expenses & Wages"}</option>
                    </select>
                  </div>
                )}

                {resetScope === "unit" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-500 mb-1 font-bold">
                        {isAr ? "نوع الوحدة:" : "Unit Type:"}
                      </label>
                      <select
                        value={resetUnitType}
                        onChange={(e) => setResetUnitType(e.target.value as ResetUnitType)}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold"
                      >
                        <option value="project">{isAr ? "مشروع استثماري / زراعي" : "Project"}</option>
                        <option value="costCenter">{isAr ? "مركز تكلفة / نشاط" : "Cost Center"}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1 font-bold">
                        {isAr ? "معرف / اسم الوحدة:" : "Target Unit ID:"}
                      </label>
                      <input
                        type="text"
                        value={resetUnitId}
                        onChange={(e) => setResetUnitId(e.target.value)}
                        placeholder={isAr ? "أدخل معرف المشروع أو المركز..." : "Enter Project / Cost Center ID..."}
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
                      />
                    </div>
                  </div>
                )}

                {resetScope === "factory" && (
                  <div>
                    <label className="block text-slate-500 mb-1 font-bold">
                      {isAr ? "تهيئة شجرة الحسابات (COA Configuration):" : "Chart of Accounts Initial State:"}
                    </label>
                    <select
                      value={resetCoaMode}
                      onChange={(e) => setResetCoaMode(e.target.value as FactoryCoaMode)}
                      className="w-full sm:w-80 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold"
                    >
                      <option value="starter_template">{isAr ? "إعادة بناء دليل الحسابات القياسي من 6 مستويات (موصى به)" : "Standard 6-Gen COA Template (Recommended)"}</option>
                      <option value="blank_coa">{isAr ? "دليل حسابات فارغ لتسجيل الأرصدة الافتتاحية المخصصة (Blank COA)" : "Blank COA for Opening Balances"}</option>
                    </select>
                  </div>
                )}

                {/* Safety & Confirmation Box */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>
                      {isAr
                        ? `للتأكيد، اكتب في الحقل: "${expectedConfirmationPhrase}"`
                        : `To confirm, enter: "${expectedConfirmationPhrase}"`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      data-testid="reset-confirmation-input"
                      value={resetConfirmationInput}
                      onChange={(e) => setResetConfirmationInput(e.target.value)}
                      placeholder={isAr ? "اكتب عبارة التأكيد هنا..." : "Type confirmation phrase here..."}
                      className="flex-1 max-w-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-mono text-xs uppercase"
                    />
                    <button
                      type="button"
                      data-testid="execute-scoped-reset-btn"
                      onClick={handleExecuteScopedReset}
                      disabled={executingReset || !resetConfirmationInput.trim()}
                      className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow disabled:opacity-50 inline-flex items-center gap-1.5 transition"
                    >
                      {executingReset && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                      <span>{executingReset ? (isAr ? "جاري التصفير..." : "Resetting...") : (isAr ? "تنفيذ إعادة الضبط مع نسخة أمان" : "Execute Scoped Reset")}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subdomain / Tenant Origin Drift Confirmation Modal */}
      {driftConfirmState?.open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[85] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 no-print"
            onClick={() => setDriftConfirmState(null)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="card-surface rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-amber-300 dark:border-amber-700 space-y-4 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                      {isAr
                        ? "تحذير تغيير النطاق أو الخادم (Subdomain Drift Guard)"
                        : "Subdomain Drift & Origin Switch Warning"}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {isAr
                        ? "تأكيد تغيير أصل الاتصال عن نطاق المنشأة النشط"
                        : "Confirm switching away from active workspace origin"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDriftConfirmState(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-2 leading-relaxed">
                <p className="font-bold">{driftConfirmState.warningAr}</p>
                <p className="text-[11px] opacity-90">{driftConfirmState.warningEn}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 space-y-1 font-mono text-[11px]">
                <div>
                  <span className="text-slate-500">{isAr ? "النطاق الافتراضي للمنشأة:" : "Workspace Cloud:"} </span>
                  <span className="font-bold text-emerald-600">{defaultTenantCloudUrl}</span>
                </div>
                <div>
                  <span className="text-slate-500">{isAr ? "العنوان المطلوب:" : "Target URL:"} </span>
                  <span className="font-bold text-amber-700 dark:text-amber-300">{driftConfirmState.targetUrl}</span>
                </div>
                {driftConfirmState.offlineQueueCount > 0 && (
                  <div className="text-rose-600 font-bold">
                    {isAr
                      ? `العمليات المحلية غير المزامنة: ${driftConfirmState.offlineQueueCount}`
                      : `Pending un-synced offline queue items: ${driftConfirmState.offlineQueueCount}`}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDriftConfirmState(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  {isAr ? "إلغاء والبقاء في نطاق المنشأة" : "Cancel & Keep Workspace Origin"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = driftConfirmState.targetUrl;
                    setDriftConfirmState(null);
                    void handleSaveServerUrl(target, { bypassDriftConfirm: true });
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold shadow-sm transition"
                >
                  {isAr ? "تأكيد تغيير الاتصال" : "Confirm Origin Switch"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Restore Confirmation Modal */}
      {confirmRestoreModal.open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 no-print"
            onClick={() => {
              if (!restoringBackup) setConfirmRestoreModal({ open: false });
            }}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="card-surface rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                      {isAr ? "تأكيد استعادة قاعدة البيانات" : "Confirm Database Restore"}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {isAr ? "إجراء إداري حساس يستبدل البيانات الحالية" : "Critical action replacing active data"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmRestoreModal({ open: false })}
                  disabled={restoringBackup}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-2 leading-relaxed">
                <div className="font-extrabold text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{isAr ? "تحذير استبدال البيانات:" : "Data Replacement Warning:"}</span>
                </div>
                <p>
                  {isAr
                    ? "سيؤدي تنفيذ هذا الإجراء إلى استبدال قاعدة البيانات الحالية بالكامل بالنسخة المحددة. سيقوم النظام تلقائياً بإنشاء نسخة أمان احتياطية قبل الاستبدال (Pre-Restore Snapshot)."
                    : "Executing this action will completely replace active database records with the selected snapshot. A safety pre-restore backup will be created automatically before proceeding."}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                <span className="text-slate-500">{isAr ? "الملف المحدد:" : "Target Snapshot:"} </span>
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {confirmRestoreModal.file
                    ? confirmRestoreModal.file.name
                    : confirmRestoreModal.localSnapshotName}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmRestoreModal({ open: false })}
                  disabled={restoringBackup}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  {isAr ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleExecuteRestore(
                      confirmRestoreModal.localSnapshotName,
                      confirmRestoreModal.file
                    )
                  }
                  disabled={restoringBackup}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold shadow-sm disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {restoringBackup && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{restoringBackup ? (isAr ? "جاري الاستعادة..." : "Restoring...") : isAr ? "تأكيد الاستعادة الآن" : "Confirm Restore"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {activeSubTab === "users" && (
        <div className="space-y-6">
          {/* Users Control Panel & Roles */}
          <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div>
                <h3 className="text-sm font-extrabold">
                  لوحة تحكم المستخدمين والصلاحيات (Users Control Panel &amp; Roles)
                </h3>
                <p className="text-xs text-slate-500">
                  إدارة حسابات المستخدمين، الأدوار الوظيفية، حالة الحساب، وتسجيل الدخول/الخروج
                </p>
              </div>
              <button
                onClick={onOpenLogin}
                className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
              >
                🔐 تبديل المستخدم (Log in / Log out)
              </button>
            </div>

            {!readOnly && canManageUsers ? (
              <form
                onSubmit={handleAddUserSubmit}
                className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl"
              >
                <input
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  type="text"
                  placeholder="اسم المستخدم الجديد"
                  className="rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5"
                />
                <input
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  type="email"
                  placeholder="البريد أو المعرف"
                  className="rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5"
                />
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5"
                >
                  {ALL_USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_DEFINITIONS[r].labelAr} ({ROLE_DEFINITIONS[r].shortEn})
                    </option>
                  ))}
                </select>
                <button type="submit" className="rounded-lg accent-bg font-bold py-1.5 px-3">
                  + إضافة مستخدم
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300 font-semibold">
                <Lock className="w-4 h-4 shrink-0" />
                <span>إدارة المستخدمين وتعديل الإعدادات مقتصرة على مدير النظام العام (SUPER_ADMIN).</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {isAr
                  ? `إجمالي المستخدمين المعروضين: ${users.filter((u) => (showArchivedUsers ? true : !u.archivedAt)).length} (المؤرشفون: ${users.filter((u) => Boolean(u.archivedAt)).length})`
                  : `Visible Users: ${users.filter((u) => (showArchivedUsers ? true : !u.archivedAt)).length} (Archived: ${users.filter((u) => Boolean(u.archivedAt)).length})`}
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs font-bold cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showArchivedUsers}
                  onChange={(e) => setShowArchivedUsers(e.target.checked)}
                  className="rounded border-slate-400 text-emerald-600 focus:ring-emerald-500"
                />
                <Archive className="w-3.5 h-3.5 text-slate-500" />
                <span>{isAr ? "إظهار المؤرشفين" : "Show Archived"}</span>
              </label>
            </div>

            <table className="w-full text-xs text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                  <th className="p-2.5">المستخدم</th>
                  <th className="p-2.5">الدور المؤسسي</th>
                  <th className="p-2.5">نظام الصلاحيات</th>
                  <th className="p-2.5">نطاق المشاريع</th>
                  <th className="p-2.5">الحالة</th>
                  <th className="p-2.5 text-center">إجراءات الأمان والتحكم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {users
                  .filter((u) => (showArchivedUsers ? true : !u.archivedAt))
                  .map((u) => {
                    const roleMeta = getRoleMeta(u.role);
                    const isArchived = Boolean(u.archivedAt);
                    const isUserActive = !isArchived && u.active && (u.isActive ?? true);
                    const hasCustom = Boolean(u.useCustomPermissions);
                    const isSelf = u.id === currentUser.id;
                    const isBusy = userLifecycleBusyId === u.id;

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="p-2.5">
                          <div className="flex items-center gap-2.5">
                            <SvgAvatar
                              char={u.avatarChar}
                              avatarUrl={u.avatarUrl}
                              color={u.avatarColor}
                              size={32}
                              alt={u.displayName || u.name}
                            />
                            <div>
                              <div className="font-bold flex items-center gap-1.5">
                                <span>{u.displayName ? `${u.displayName} (${u.name})` : u.name}</span>
                                {u.id === currentUser.id && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-extrabold">
                                    أنت
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                                <span>{u.email}</span>
                                {u.phone && <span>• {u.phone}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-col gap-1">
                            <span className={`px-2 py-0.5 rounded-lg font-bold inline-block w-fit ${roleMeta.badgeClass}`}>
                              {roleMeta.labelAr}
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium">
                              {u.department || roleMeta.departmentAr}
                            </span>
                          </div>
                        </td>
                        <td className="p-2.5">
                          {hasCustom ? (
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 inline-flex items-center gap-1">
                              <Sliders className="w-3 h-3" />
                              <span>صلاحيات مخصصة</span>
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 inline-flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              <span>دور افتراضي</span>
                            </span>
                          )}
                        </td>
                        <td className="p-2.5">
                          <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                            {u.assignedProjects?.length
                              ? `${u.assignedProjects.length} مشاريع مسندة`
                              : "جميع المشاريع (غير مقيد)"}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${isArchived
                                ? "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                : isUserActive
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                                  : "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                                }`}
                            >
                              {isArchived
                                ? "مؤرشف (Archived)"
                                : isUserActive
                                  ? "نشط (Active)"
                                  : "موقوف (Suspended)"}
                            </span>
                            {u.mustChangePassword && (
                              <span className="text-[9px] font-extrabold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-1 py-0.5 rounded">
                                مطلوب تغيير المرور
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5">
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openPermissionsDrawer(u)}
                              disabled={readOnly || !canManageUsers}
                              title="إدارة الصلاحيات والمحددات"
                              className="px-2 py-1 rounded-lg border border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-xs font-bold inline-flex items-center gap-1 transition disabled:opacity-40"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                              <span>الصلاحيات</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openResetPasswordModal(u)}
                              disabled={readOnly || !canManageUsers}
                              title="إعادة تعيين كلمة المرور"
                              className="px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-bold inline-flex items-center gap-1 transition disabled:opacity-40"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>كلمة المرور</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onToggleUserStatus(u.id)}
                              disabled={readOnly || !canManageUsers || isSelf || isArchived}
                              title={isUserActive ? "إيقاف الحساب" : "تفعيل الحساب"}
                              className={`px-2 py-1 rounded-lg border text-xs font-bold inline-flex items-center gap-1 transition disabled:opacity-40 ${isUserActive
                                ? "border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                : "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                }`}
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>{isUserActive ? "إيقاف" : "تفعيل"}</span>
                            </button>

                            {!isSelf && (
                              <button
                                type="button"
                                onClick={() => handleArchiveOrRestoreUser(u, isArchived ? "restore" : "archive")}
                                disabled={readOnly || !canManageUsers || isBusy}
                                title={isArchived ? "استعادة الحساب المؤرشف" : "أرشفة الحساب وتحرير مقعد الترخيص"}
                                className={`px-2 py-1 rounded-lg border text-xs font-bold inline-flex items-center gap-1 transition disabled:opacity-40 ${isArchived
                                  ? "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                  : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  }`}
                              >
                                {isArchived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                <span>{isArchived ? "استعادة" : "أرشفة"}</span>
                              </button>
                            )}

                            {!isSelf && (
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u)}
                                disabled={readOnly || !canManageUsers || isBusy}
                                title="حذف المستخدم (أو أرشفة تلقائية في حال وجود قيود محاسبية)"
                                className="px-2 py-1 rounded-lg border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-bold inline-flex items-center gap-1 transition disabled:opacity-40"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>حذف</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* 7-Role RBAC Matrix Card */}
          <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
            <div className="flex items-center justify-between gap-2 border-b pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl accent-badge flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold">
                    مصفوفة الصلاحيات المؤسسية للأدوار السبعة (7-Role RBAC Matrix)
                  </h3>
                  <p className="text-xs text-slate-500">
                    توزيع الصلاحيات التشغيلية والاعتماد والترحيل المحاسبي وحالة القراءة فقط
                  </p>
                </div>
              </div>
            </div>

            <table className="w-full text-xs text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                  <th className="p-2.5">الدور الوظيفي</th>
                  <th className="p-2.5">الإدارة / القسم</th>
                  <th className="p-2.5 text-center">الاعتماد المالي</th>
                  <th className="p-2.5 text-center">الترحيل للـ GL</th>
                  <th className="p-2.5 text-center">إقفال القطفات</th>
                  <th className="p-2.5 text-center">قراءة فقط</th>
                  <th className="p-2.5">الوحدات المصرح بها</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {ALL_USER_ROLES.map((roleKey) => {
                  const def = ROLE_DEFINITIONS[roleKey];
                  const groups = getAccessibleGroups(roleKey);
                  const approve = canApprove(roleKey);
                  const post = canPostLedger(roleKey);
                  const lock = canLockPeriod(roleKey);
                  const ro = checkIsReadOnly(roleKey);
                  const isCurrent = getRoleMeta(currentUser.role).role === roleKey;
                  return (
                    <tr key={roleKey} className={isCurrent ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""}>
                      <td className="p-2.5">
                        <span className={`px-2 py-0.5 rounded-lg font-bold inline-block ${def.badgeClass}`}>
                          {def.labelAr}
                        </span>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">{roleKey}</div>
                      </td>
                      <td className="p-2.5 text-slate-600 dark:text-slate-300">{def.departmentAr}</td>
                      <td className="p-2.5 text-center">
                        {approve ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />
                        ) : (
                          <XCircle className="w-4 h-4 text-slate-300 inline" />
                        )}
                      </td>
                      <td className="p-2.5 text-center">
                        {post ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />
                        ) : (
                          <XCircle className="w-4 h-4 text-slate-300 inline" />
                        )}
                      </td>
                      <td className="p-2.5 text-center">
                        {lock ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />
                        ) : (
                          <XCircle className="w-4 h-4 text-slate-300 inline" />
                        )}
                      </td>
                      <td className="p-2.5 text-center">
                        {ro ? (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                            Read-Only
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-2.5 font-mono text-[11px] text-slate-500">
                        {groups.join(" • ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dual Logo Generator & Landing Page CMS Studio */}
      {activeSubTab === "branding" && (
        <form
          onSubmit={handleSaveCmsSubmit}
          className="card-surface rounded-2xl p-5 space-y-6 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl accent-badge flex items-center justify-center">
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold">
                  {isAr
                    ? "استوديو الهوية المؤسسية والشعار المزدوج وإدارة الصفحة الرئيسية (Branding & Landing CMS)"
                    : "Enterprise Dual Logo Generator & Public Landing CMS"}
                </h3>
                <p className="text-xs text-slate-500">
                  {isAr
                    ? "تخصيص شعار النظام وشعار المؤسسة (SVG أو رفع صورة) والتحكم بمحتوى البوابة العامة"
                    : "Customize dual SVG/image logos, brand theme color, and bilingual public landing portal content"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 flex items-center gap-3">
                <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  {isAr ? "معاينة حية:" : "Live Preview:"}
                </span>
                <DualLogoBadge
                  profile={cmsDraft as UasEnterpriseProfile}
                  logoText={logoText}
                  size="md"
                />
              </div>
              <button
                type="button"
                disabled={readOnly || !canManageCms || savingCms}
                onClick={() => void handleResetDefaultBrand()}
                className="px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                title={
                  isAr
                    ? "إزالة الشعار والأيقونة والشعار الفرعي المخصص والعودة إلى هوية UAS الافتراضية"
                    : "Remove custom logo/favicon/tagline and restore default UAS branding"
                }
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isAr ? "استعادة هوية UAS" : "Reset to UAS"}</span>
              </button>
              <button
                type="submit"
                disabled={readOnly || !canManageCms || savingCms}
                className="px-4 py-2.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>
                  {savingCms
                    ? isAr
                      ? "جاري الحفظ..."
                      : "Saving..."
                    : isAr
                      ? "حفظ الهوية والصفحة الرئيسية"
                      : "Save Branding & CMS"}
                </span>
              </button>
            </div>
          </div>

          {!canManageCms && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300 font-semibold">
              <Lock className="w-4 h-4 shrink-0" />
              <span>
                {isAr
                  ? "تعديل الهوية المؤسسية ومحتوى الصفحة الرئيسية متاح لمدير النظام العام (SUPER_ADMIN) فقط."
                  : "Branding & Landing CMS customization is restricted to SUPER_ADMIN."}
              </span>
            </div>
          )}

          {/* Dual Logo Generator Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* UAS System Logo Slot */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/30">
              <div className="flex items-center justify-between">
                <div className="font-extrabold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>{isAr ? "شعار النظام الموحد (UAS Logo)" : "UAS System Logo"}</span>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer font-bold">
                  <input
                    type="checkbox"
                    checked={cmsDraft.showUasLogo ?? true}
                    disabled={readOnly || !canManageCms}
                    onChange={(e) =>
                      updateCmsDraft((prev) => ({ ...prev, showUasLogo: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                  />
                  <span>{isAr ? "إظهار الشعار" : "Show Logo"}</span>
                </label>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {UAS_LOGO_PRESETS.map((preset) => {
                  const active = (cmsDraft.uasLogoStyle || "emerald-shield") === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={readOnly || !canManageCms}
                      onClick={() =>
                        updateCmsDraft((prev) => ({
                          ...prev,
                          uasLogoStyle: preset.id,
                        }))
                      }
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition ${active
                        ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                        : "border-slate-200 dark:border-slate-700 hover:border-emerald-400"
                        }`}
                    >
                      <div className="w-8 h-8 rounded-lg accent-bg flex items-center justify-center text-white">
                        {renderUasPresetSvg(preset.id, "w-5 h-5", logoText)}
                      </div>
                      <span className="text-[10px] font-bold text-center leading-tight line-clamp-1">
                        {isAr ? preset.labelAr : preset.labelEn}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="text"
                  value={cmsDraft.uasLogoCustomUrl ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) =>
                    updateCmsDraft((prev) => ({
                      ...prev,
                      uasLogoCustomUrl: e.target.value,
                      uasLogoStyle: e.target.value.trim() ? "custom" : prev.uasLogoStyle || "emerald-shield",
                    }))
                  }
                  placeholder={isAr ? "رابط صورة أو SVG مخصص (اختياري)..." : "Custom image/SVG URL (optional)..."}
                  className="flex-1 min-w-[180px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
                />
                <label className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isAr ? "رفع صورة" : "Upload"}</span>
                  <input
                    type="file"
                    accept="image/*,.svg"
                    disabled={readOnly || !canManageCms}
                    className="hidden"
                    onChange={(e) =>
                      handleLogoFileUpload("uasLogoCustomUrl", "uasLogoStyle", e.target.files?.[0])
                    }
                  />
                </label>
              </div>
            </div>

            {/* Enterprise Custom Logo Slot */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/30">
              <div className="flex items-center justify-between">
                <div className="font-extrabold flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  <span>{isAr ? "شعار المؤسسة المخصص (Enterprise Logo)" : "Enterprise Custom Logo"}</span>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer font-bold">
                  <input
                    type="checkbox"
                    checked={cmsDraft.showEnterpriseLogo ?? false}
                    disabled={readOnly || !canManageCms}
                    onChange={(e) =>
                      updateCmsDraft((prev) => ({ ...prev, showEnterpriseLogo: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                  />
                  <span>{isAr ? "إظهار الشعار" : "Show Logo"}</span>
                </label>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {ENTERPRISE_LOGO_PRESETS.map((preset) => {
                  const active = (cmsDraft.enterpriseLogoStyle || "agri-leaf") === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={readOnly || !canManageCms}
                      onClick={() =>
                        updateCmsDraft((prev) => ({
                          ...prev,
                          enterpriseLogoStyle: preset.id,
                        }))
                      }
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition ${active
                        ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300"
                        : "border-slate-200 dark:border-slate-700 hover:border-indigo-400"
                        }`}
                    >
                      <div
                        className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center"
                        style={{ color: cmsDraft.brandColor || "#059669" }}
                      >
                        {renderEnterprisePresetSvg(preset.id, "w-5 h-5")}
                      </div>
                      <span className="text-[10px] font-bold text-center leading-tight line-clamp-1">
                        {isAr ? preset.labelAr : preset.labelEn}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <input
                  type="text"
                  value={cmsDraft.enterpriseLogoCustomUrl ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) =>
                    updateCmsDraft((prev) => ({
                      ...prev,
                      enterpriseLogoCustomUrl: e.target.value,
                      enterpriseLogoStyle: e.target.value.trim() ? "custom" : prev.enterpriseLogoStyle || "agri-leaf",
                    }))
                  }
                  placeholder={isAr ? "رابط شعار المؤسسة أو رفع ملف..." : "Enterprise image/SVG URL..."}
                  className="flex-1 min-w-[180px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
                />
                <label className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isAr ? "رفع صورة" : "Upload"}</span>
                  <input
                    type="file"
                    accept="image/*,.svg"
                    disabled={readOnly || !canManageCms}
                    className="hidden"
                    onChange={(e) =>
                      void handleLogoFileUpload(
                        "enterpriseLogoCustomUrl",
                        "enterpriseLogoStyle",
                        e.target.files?.[0]
                      )
                    }
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Browser Tab Favicon & Editable Brand Subtitle/Tagline */}
          {(() => {
            const previewBrand = resolveEffectiveBrandInfo(cmsDraft as UasEnterpriseProfile);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/30">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-extrabold flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewBrand.effectiveFaviconUrl}
                        alt="Browser Tab Icon"
                        className="w-5 h-5 rounded object-contain border border-slate-200 dark:border-slate-700 bg-white p-0.5"
                      />
                      <span>
                        {isAr
                          ? "أيقونة تبويب المتصفح (Favicon) وعنوان التبويب"
                          : "Browser Tab Icon (Favicon) & Tab Title"}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-[10px] font-mono" dir="ltr">
                      {previewBrand.tabTitleEn}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {previewBrand.hasCustomFavicon
                      ? isAr
                        ? "أيقونة Favicon مخصصة نشطة حالياً لتبويب المتصفح."
                        : "Dedicated custom favicon is active for browser tabs."
                      : previewBrand.derivedFaviconFromLogo
                        ? isAr
                          ? "يتم اشتقاق أيقونة تبويب المتصفح تلقائياً من شعار المؤسسة المخصص."
                          : "Browser tab favicon is automatically derived from your custom enterprise logo."
                        : isAr
                          ? "يتم استخدام أيقونة UAS الافتراضية حتى يتم رفع شعار أو أيقونة مخصصة."
                          : "Using default UAS favicon until a custom logo or favicon is uploaded."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={cmsDraft.faviconUrl ?? ""}
                      disabled={readOnly || !canManageCms}
                      onChange={(e) =>
                        updateCmsDraft((prev) => ({
                          ...prev,
                          faviconUrl: e.target.value,
                        }))
                      }
                      placeholder={
                        isAr
                          ? "رابط أيقونة مخصصة (اختياري — يُشتق من الشعار تلقائياً)..."
                          : "Custom favicon URL (optional — auto-derived from logo)..."
                      }
                      className="flex-1 min-w-[180px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
                    />
                    <label className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isAr ? "رفع أيقونة" : "Upload Icon"}</span>
                      <input
                        type="file"
                        accept="image/*,.ico,.svg"
                        disabled={readOnly || !canManageCms}
                        className="hidden"
                        onChange={(e) =>
                          void handleLogoFileUpload("faviconUrl", null, e.target.files?.[0])
                        }
                      />
                    </label>
                    {cmsDraft.faviconUrl && (
                      <button
                        type="button"
                        disabled={readOnly || !canManageCms}
                        onClick={() => updateCmsDraft((prev) => ({ ...prev, faviconUrl: null }))}
                        className="px-2.5 py-1.5 rounded-xl border border-rose-300 text-rose-600 font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30"
                      >
                        {isAr ? "مسح" : "Clear"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/30">
                  <div className="font-extrabold">
                    {isAr
                      ? "الوصف التعريفي أسفل اسم المنشأة (Editable Tagline)"
                      : "Editable Brand Subtitle / Tagline"}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold mb-1">
                        {isAr ? "الشعار اللفظي / الوصف (عربي)" : "Tagline (Arabic)"}
                      </label>
                      <input
                        type="text"
                        value={cmsDraft.taglineAr ?? ""}
                        disabled={readOnly || !canManageCms}
                        onChange={(e) =>
                          updateCmsDraft((p) => ({ ...p, taglineAr: e.target.value }))
                        }
                        placeholder={DEFAULT_TAGLINE_AR}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">
                        {isAr ? "الشعار اللفظي / الوصف (إنجليزي)" : "Tagline (English)"}
                      </label>
                      <input
                        type="text"
                        value={cmsDraft.taglineEn ?? ""}
                        disabled={readOnly || !canManageCms}
                        onChange={(e) =>
                          updateCmsDraft((p) => ({ ...p, taglineEn: e.target.value }))
                        }
                        placeholder={DEFAULT_TAGLINE_EN}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Legal Identity & Theme Color */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "الاسم القانوني للمؤسسة (عربي)" : "Legal Name (AR)"}
              </label>
              <input
                type="text"
                value={cmsDraft.legalNameAr ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(e) => updateCmsDraft((p) => ({ ...p, legalNameAr: e.target.value }))}
                placeholder={isAr ? "اسم المنشأة" : "Enterprise Name"}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "الاسم القانوني (English)" : "Legal Name (EN)"}
              </label>
              <input
                type="text"
                value={cmsDraft.legalNameEn ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(e) => updateCmsDraft((p) => ({ ...p, legalNameEn: e.target.value }))}
                placeholder="Enterprise Legal Name"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "الرقم الضريبي (Tax ID)" : "Tax Number"}
              </label>
              <input
                type="text"
                value={cmsDraft.taxNumber ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(e) => updateCmsDraft((p) => ({ ...p, taxNumber: e.target.value }))}
                placeholder={isAr ? "مثال: 300xxxxxxxxx" : "e.g. 300xxxxxxxxx"}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "السجل التجاري (Commercial Reg)" : "Commercial Reg"}
              </label>
              <input
                type="text"
                value={cmsDraft.commercialReg ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(e) => updateCmsDraft((p) => ({ ...p, commercialReg: e.target.value }))}
                placeholder="CR-0000"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "البريد الإلكتروني الرسمي" : "Official Email"}
              </label>
              <input
                type="email"
                value={cmsDraft.email ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(e) => updateCmsDraft((p) => ({ ...p, email: e.target.value }))}
                placeholder="finance@enterprise.com"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "العنوان الرسمي المسجل" : "Registered Address"}
              </label>
              <input
                type="text"
                value={cmsDraft.address ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(e) => updateCmsDraft((p) => ({ ...p, address: e.target.value }))}
                placeholder={isAr ? "المدينة - الدولة" : "City - Country"}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "لون الهوية الرئيسي" : "Brand Accent Color"}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={cmsDraft.brandColor || "#059669"}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, brandColor: e.target.value }))}
                  className="w-10 h-9 rounded-lg border border-slate-300 bg-transparent p-0.5 cursor-pointer"
                />
                <input
                  type="text"
                  value={cmsDraft.brandColor || "#059669"}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, brandColor: e.target.value }))}
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2 font-mono"
                />
              </div>
            </div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="inline-flex items-center gap-2 cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={cmsDraft.showPublicMetrics ?? true}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, showPublicMetrics: e.target.checked }))}
                  className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                />
                <span>{isAr ? "عرض المؤشرات العامة للزوار" : "Show Public KPIs"}</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={cmsDraft.showPublicVerify ?? true}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, showPublicVerify: e.target.checked }))}
                  className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                />
                <span>{isAr ? "عرض بوابة التحقق والباركود" : "Show QR Verify Portal"}</span>
              </label>
            </div>
          </div>

          {/* Landing Page CMS Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-700">
            <div className="space-y-3">
              <h4 className="font-extrabold text-emerald-700 dark:text-emerald-400">
                {isAr ? "المحتوى العربي للصفحة الرئيسية (AR CMS)" : "Arabic Landing CMS"}
              </h4>
              <div>
                <label className="block font-bold mb-1">{isAr ? "شارة الهيرو (عربي)" : "Hero Badge (AR)"}</label>
                <input
                  type="text"
                  value={cmsDraft.heroBadgeAr ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, heroBadgeAr: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "العنوان الرئيسي (عربي)" : "Hero Title (AR)"}</label>
                <input
                  type="text"
                  value={cmsDraft.heroTitleAr ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, heroTitleAr: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "الوصف المختصر (عربي)" : "Hero Subtitle (AR)"}</label>
                <textarea
                  rows={2}
                  value={cmsDraft.heroSubtitleAr ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, heroSubtitleAr: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "عن المؤسسة والرسالة (عربي)" : "About / Mission (AR)"}</label>
                <textarea
                  rows={2}
                  value={cmsDraft.aboutMissionAr ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, aboutMissionAr: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "نص زر الدخول الرئيسي (عربي)" : "Primary CTA Text (AR)"}</label>
                <input
                  type="text"
                  value={cmsDraft.ctaPrimaryTextAr ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, ctaPrimaryTextAr: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-extrabold text-indigo-700 dark:text-indigo-400">
                {isAr ? "المحتوى الإنجليزي والتواصل (EN & Contact CMS)" : "English & Contact CMS"}
              </h4>
              <div>
                <label className="block font-bold mb-1">{isAr ? "شارة الهيرو (EN)" : "Hero Badge (EN)"}</label>
                <input
                  type="text"
                  value={cmsDraft.heroBadgeEn ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, heroBadgeEn: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "العنوان الرئيسي (EN)" : "Hero Title (EN)"}</label>
                <input
                  type="text"
                  value={cmsDraft.heroTitleEn ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, heroTitleEn: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "الوصف المختصر (EN)" : "Hero Subtitle (EN)"}</label>
                <textarea
                  rows={2}
                  value={cmsDraft.heroSubtitleEn ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, heroSubtitleEn: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "عن المؤسسة والرسالة (EN)" : "About / Mission (EN)"}</label>
                <textarea
                  rows={2}
                  value={cmsDraft.aboutMissionEn ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, aboutMissionEn: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">{isAr ? "نص زر الدخول الرئيسي (EN)" : "Primary CTA Text (EN)"}</label>
                <input
                  type="text"
                  value={cmsDraft.ctaPrimaryTextEn ?? ""}
                  disabled={readOnly || !canManageCms}
                  onChange={(e) => updateCmsDraft((p) => ({ ...p, ctaPrimaryTextEn: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>
            </div>
          </div>

          {/* Public Contact Channels */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
            <div>
              <label className="block font-bold mb-1">{isAr ? "هاتف التواصل العام" : "Contact Phone"}</label>
              <PhoneContactInput
                isAr={isAr}
                value={cmsDraft.contactPhone ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(val) => updateCmsDraft((p) => ({ ...p, contactPhone: val }))}
                placeholder="+967 1 000 000"
                inputClassName="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{isAr ? "رقم واتساب التواصل" : "WhatsApp Number"}</label>
              <PhoneContactInput
                isAr={isAr}
                format="whatsapp_digits"
                value={cmsDraft.contactWhatsApp ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(val) => updateCmsDraft((p) => ({ ...p, contactWhatsApp: val }))}
                placeholder="967770000000"
                inputClassName="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{isAr ? "العنوان العام (المقر)" : "Public Office Address"}</label>
              <input
                type="text"
                value={cmsDraft.contactAddress ?? ""}
                disabled={readOnly || !canManageCms}
                onChange={(e) => updateCmsDraft((p) => ({ ...p, contactAddress: e.target.value }))}
                placeholder={isAr ? "المدينة - الدولة" : "City - Country"}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>
        </form>
      )}

      {/* Dynamic RBAC Permissions SlideOverDrawer */}
      <SlideOverDrawer
        open={permDrawerUser !== null}
        onClose={() => setPermDrawerUser(null)}
        title={
          permDrawerUser
            ? `إدارة صلاحيات: ${permDrawerUser.displayName || permDrawerUser.name}`
            : "إدارة الصلاحيات"
        }
        subtitle={
          permDrawerUser
            ? `${ROLE_DEFINITIONS[normalizeRole(permDrawerUser.role)].labelAr} • ${permDrawerUser.email}`
            : ""
        }
        size="xl"
      >
        {permDrawerUser && (
          <form onSubmit={handleSavePermissions} className="space-y-6 text-xs p-1">
            {/* User Banner */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SvgAvatar
                  char={permDrawerUser.avatarChar}
                  avatarUrl={permDrawerUser.avatarUrl}
                  color={permDrawerUser.avatarColor}
                  size={40}
                  alt={permDrawerUser.displayName || permDrawerUser.name}
                />
                <div>
                  <div className="font-extrabold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>{permDrawerUser.displayName || permDrawerUser.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-lg font-bold ${ROLE_DEFINITIONS[normalizeRole(permDrawerUser.role)].badgeClass
                        }`}
                    >
                      {ROLE_DEFINITIONS[normalizeRole(permDrawerUser.role)].labelAr}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    {permDrawerUser.email} {permDrawerUser.phone && `• ${permDrawerUser.phone}`}
                  </div>
                </div>
              </div>
              <div className="text-left font-mono text-[10px] text-slate-400">
                <div>ID: {permDrawerUser.id.substring(0, 8)}...</div>
                <div>{permDrawerUser.department || ROLE_DEFINITIONS[normalizeRole(permDrawerUser.role)].departmentAr}</div>
              </div>
            </div>

            {/* Mode Selector */}
            <div className="space-y-2">
              <label className="font-extrabold text-xs block text-slate-700 dark:text-slate-300">
                نمط احتساب الصلاحيات (Permission Calculation Mode):
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPermUseCustom(false)}
                  className={`p-3 rounded-xl border text-right transition ${!permUseCustom
                    ? "border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-600 dark:text-slate-400"
                    }`}
                >
                  <div className="font-extrabold flex items-center gap-1.5 mb-1">
                    <Shield className="w-4 h-4 text-emerald-600" />
                    <span>صلاحيات الدور الافتراضية</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    يرث المستخدم جميع صلاحيات دوره ({ROLE_DEFINITIONS[normalizeRole(permDrawerUser.role)].labelAr}) تلقائياً.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPermUseCustom(true)}
                  className={`p-3 rounded-xl border text-right transition ${permUseCustom
                    ? "border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 ring-2 ring-purple-500/20"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 text-slate-600 dark:text-slate-400"
                    }`}
                >
                  <div className="font-extrabold flex items-center gap-1.5 mb-1">
                    <Sliders className="w-4 h-4 text-purple-600" />
                    <span>صلاحيات مخصصة للمستخدم</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    تجاوز صلاحيات الدور ومنح/سحب وصول مخصص لأي قسم أو صلاحية مستقلة.
                  </p>
                </button>
              </div>
            </div>

            {/* Custom Mode Configuration */}
            {permUseCustom ? (
              <div className="space-y-5 pt-2 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="font-extrabold text-xs text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                    <Sliders className="w-4 h-4" />
                    <span>تخصيص الصلاحيات والأقسام التفصيلية</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetToRoleDefaults}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-[11px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3 text-slate-500" />
                    <span>استعادة الافتراضي للدور</span>
                  </button>
                </div>

                {/* Domain Access */}
                <div className="space-y-2">
                  <label className="font-extrabold text-xs block text-slate-800 dark:text-slate-200">
                    ١. الأقسام والمجالات المصرح بالدخول إليها (Domain Access):
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ERP_DOMAINS.map((domain) => {
                      const isAllowed = permAllowedGroups.includes(domain.id);
                      return (
                        <label
                          key={domain.id}
                          className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${isAllowed
                            ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-950 dark:text-emerald-200"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                            }`}
                        >
                          <input
                            type="checkbox"
                            checked={isAllowed}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setPermAllowedGroups((prev) => [...prev, domain.id]);
                              } else {
                                setPermAllowedGroups((prev) => prev.filter((id) => id !== domain.id));
                              }
                            }}
                            className="rounded border-slate-300 text-emerald-600 w-4 h-4 mt-0.5"
                          />
                          <div>
                            <div className="font-bold text-xs">{domain.labelAr}</div>
                            <div className="text-[10px] text-slate-400 font-medium leading-tight mt-0.5">
                              {domain.descAr}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Granular Action Rights */}
                <div className="space-y-2">
                  <label className="font-extrabold text-xs block text-slate-800 dark:text-slate-200">
                    ٢. حقوق العمليات التفصيلية (Granular Action Rights):
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ACTION_PERM_DEFINITIONS.map((perm) => {
                      const isChecked = Boolean(permActions[perm.key]);
                      return (
                        <label
                          key={perm.key}
                          className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${isChecked
                            ? "border-purple-500 bg-purple-50/50 dark:bg-purple-950/20 text-purple-950 dark:text-purple-200"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                            }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setPermActions((prev) => ({
                                ...prev,
                                [perm.key]: checked,
                              }));
                            }}
                            className="rounded border-slate-300 text-purple-600 w-4 h-4 mt-0.5"
                          />
                          <div>
                            <div className="font-bold text-xs">{perm.labelAr}</div>
                            <div className="text-[10px] text-slate-400 font-medium leading-tight mt-0.5">
                              {perm.descAr}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 text-slate-600 dark:text-slate-400 space-y-2">
                <div className="font-bold text-xs flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>الصلاحيات الافتراضية النشطة لهذا الدور:</span>
                </div>
                <div className="text-[11px] leading-relaxed">
                  الأقسام المصرح بها: <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{getAccessibleGroups(normalizeRole(permDrawerUser.role)).join(" • ")}</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  للتحكم الدقيق وتعديل أي من هذه الصلاحيات، اختر خيار &ldquo;صلاحيات مخصصة للمستخدم&rdquo; أعلاه.
                </p>
              </div>
            )}

            {/* Project Scope Assignment */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <label className="font-extrabold text-xs text-slate-800 dark:text-slate-200">
                  ٣. نطاق المشاريع المسندة (Project Scope):
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPermAssignedProjects([])}
                    className={`px-2 py-0.5 rounded font-bold transition ${permAssignedProjects.length === 0
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "text-slate-500 hover:underline"
                      }`}
                  >
                    جميع المشاريع (غير مقيد)
                  </button>
                  {projects.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPermAssignedProjects(projects.map((p) => p.id))}
                      className="text-slate-500 hover:underline text-[11px]"
                    >
                      تحديد الكل
                    </button>
                  )}
                </div>
              </div>

              {projects.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
                  {projects.map((p) => {
                    const checked = permAssignedProjects.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-2 cursor-pointer transition ${checked
                          ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200"
                          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300"
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPermAssignedProjects((prev) => [...prev, p.id]);
                            } else {
                              setPermAssignedProjects((prev) => prev.filter((id) => id !== p.id));
                            }
                          }}
                          className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                        />
                        <span className="font-bold truncate">{p.name}</span>
                        {p.code && <span className="text-[10px] font-mono text-slate-400">({p.code})</span>}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-400 p-2">لا توجد مشاريع مسجلة حالياً</div>
              )}
            </div>

            {/* Account Status */}
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between">
              <div>
                <div className="font-bold text-xs text-slate-900 dark:text-slate-100">
                  حالة تفعيل الحساب (Account Activation)
                </div>
                <div className="text-[11px] text-slate-500">
                  تعطيل الحساب يمنع المستخدم من تسجيل الدخول فوراً
                </div>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={permIsActive}
                  onChange={(e) => setPermIsActive(e.target.checked)}
                  disabled={permDrawerUser.id === currentUser.id}
                  className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                />
                <span className={permIsActive ? "text-emerald-700 font-extrabold" : "text-rose-600 font-extrabold"}>
                  {permIsActive ? "مفعّل (Active)" : "موقوف (Suspended)"}
                </span>
              </label>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setPermDrawerUser(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingPerms}
                className="px-5 py-2 rounded-xl accent-bg font-extrabold shadow-sm disabled:opacity-50 inline-flex items-center gap-2"
              >
                {savingPerms && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{savingPerms ? "جاري الحفظ..." : "حفظ التعديلات"}</span>
              </button>
            </div>
          </form>
        )}
      </SlideOverDrawer>

      {/* Admin Password Reset Modal */}
      {resetModalUser &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 no-print"
            onClick={(e) => {
              e.stopPropagation();
              setResetModalUser(null);
            }}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="relative z-[80] card-surface rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                      إعادة تعيين كلمة المرور
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      تعيين كلمة مرور جديدة للمستخدم من قبل الإدارة
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Target User Info */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-3">
                <SvgAvatar
                  char={resetModalUser.avatarChar}
                  avatarUrl={resetModalUser.avatarUrl}
                  color={resetModalUser.avatarColor}
                  size={36}
                  alt={resetModalUser.displayName || resetModalUser.name}
                />
                <div>
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    {resetModalUser.displayName || resetModalUser.name}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {resetModalUser.email} • {ROLE_DEFINITIONS[normalizeRole(resetModalUser.role)].labelAr}
                  </div>
                </div>
              </div>

              <form onSubmit={handleExecutePasswordReset} className="space-y-4">
                {resetErrorMsg && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold text-xs flex items-start gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{resetErrorMsg}</span>
                  </div>
                )}
                <div>
                  <label className="block font-extrabold text-xs mb-1.5 text-slate-700 dark:text-slate-300">
                    كلمة المرور الجديدة (New Password):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={resetNewPass}
                      onChange={(e) => {
                        setResetNewPass(e.target.value);
                        setResetErrorMsg(null);
                      }}
                      required
                      placeholder="أدخل كلمة مرور قوية..."
                      className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-2 font-mono text-xs font-bold"
                    />
                    <button
                      type="button"
                      onClick={copyPassword}
                      title="نسخ إلى الحافظة"
                      className="px-2.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold inline-flex items-center gap-1 transition"
                    >
                      {resetCopied ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Copy className="w-4 h-4 text-slate-500" />
                      )}
                      <span>{resetCopied ? "تم النسخ" : "نسخ"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setResetNewPass(generateRandomPass())}
                      title="توليد كلمة مرور عشوائية"
                      className="px-2.5 py-2 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 font-bold inline-flex items-center gap-1 transition"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>توليد</span>
                    </button>
                  </div>
                </div>

                {/* Force Password Change Checkbox */}
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetMustChange}
                    onChange={(e) => setResetMustChange(e.target.checked)}
                    className="rounded border-amber-400 text-amber-600 w-4 h-4 mt-0.5"
                  />
                  <div>
                    <div className="font-extrabold text-xs text-amber-900 dark:text-amber-200">
                      إلزام المستخدم بتغيير كلمة المرور فور تسجيل الدخول القادم
                    </div>
                    <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                      يُنصح بإبقائها مفعلة لتأكيد خصوصية الحساب عند تسليم كلمة المرور المؤقتة
                    </div>
                  </div>
                </label>

                {/* Modal Actions */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetModalUser(null)}
                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={resettingPass || !resetNewPass.trim()}
                    className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold shadow-sm disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {resettingPass && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{resettingPass ? "جاري التعيين..." : "تأكيد التعيين"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}


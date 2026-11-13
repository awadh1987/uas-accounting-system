"use client";

import React, { useState } from "react";
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
  UserCheck,
  Wifi,
  X,
} from "lucide-react";
import { getApiBaseUrl, setApiBaseUrl, resetApiBaseUrl } from "@/lib/apiClient";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import {
  ALL_USER_ROLES,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_DEFINITIONS,
  canApprove,
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
];

interface SystemTabProps {
  settings: UasSystemSettings;
  enterpriseProfile?: UasEnterpriseProfile | null;
  lang: LanguageCode;
  theme: ThemeName;
  currentUser: UasUser;
  users: UasUser[];
  projects?: UasProject[];
  readOnly?: boolean;
  canManageUsers?: boolean;
  canManageCms?: boolean;
  onSaveBranding: (orgName: string, logoText: string) => Promise<void>;
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
  showUasLogo: true,
  uasLogoStyle: "emerald-shield",
  uasLogoCustomUrl: "",
  showEnterpriseLogo: true,
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
  const [activeSubTab, setActiveSubTab] = useState<"branding" | "users" | "security">("branding");

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const readInitialSubTab = () => {
      const rawHash = window.location.hash.replace(/^#\/?/, "");
      const [hTab, hSub] = rawHash.split("/");
      if (hTab === "system" && (hSub === "branding" || hSub === "users" || hSub === "security")) {
        setActiveSubTab(hSub);
        window.sessionStorage.setItem("uas_system_subtab", hSub);
        return;
      }
      const saved = window.sessionStorage.getItem("uas_system_subtab");
      if (saved === "branding" || saved === "users" || saved === "security") {
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
      if (hTab === "system" && (hSub === "branding" || hSub === "users" || hSub === "security")) {
        setActiveSubTab(hSub);
        window.sessionStorage.setItem("uas_system_subtab", hSub);
      }
    };

    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  function handleSelectSubTab(subTab: "branding" | "users" | "security") {
    setActiveSubTab(subTab);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("uas_system_subtab", subTab);
      window.location.hash = `#/system/${subTab}`;
    }
  }

  const [orgNameDraft, setOrgNameDraft] = useState<string | null>(null);
  const [logoTextDraft, setLogoTextDraft] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState<string | null>(null);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [serverUrlDraft, setServerUrlDraft] = useState(() => getApiBaseUrl());
  const [testingServer, setTestingServer] = useState(false);

  async function handleSaveServerUrl(targetUrl: string) {
    const cleaned = targetUrl.trim().replace(/\/+$/, "");
    setServerUrlDraft(cleaned);
    setApiBaseUrl(cleaned);
    if (!cleaned) {
      resetApiBaseUrl();
      onToast(
        isAr
          ? "تمت استعادة الاتصال بالخادم المحلي الافتراضي"
          : "Restored default local server connection"
      );
      return;
    }
    setTestingServer(true);
    try {
      const res = await fetch(`${cleaned}/api/bootstrap`, { cache: "no-store" });
      if (res.ok) {
        onToast(
          isAr
            ? `✅ تم الاتصال بالخادم بنجاح: ${cleaned}`
            : `✅ Connected to server: ${cleaned}`
        );
      } else {
        onToast(
          isAr
            ? `⚠️ تم حفظ العنوان (${cleaned}) لكن الخادم أعاد رمز ${res.status}`
            : `⚠️ Saved (${cleaned}) but server returned ${res.status}`
        );
      }
    } catch {
      onToast(
        isAr
          ? `⚠️ تم حفظ العنوان (${cleaned}) — تأكد من تشغيل خادم الشبكة المحلية على الكمبيوتر`
          : `⚠️ Saved (${cleaned}) — verify the Office LAN server is running`
      );
    } finally {
      setTestingServer(false);
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
    setResettingPass(true);
    try {
      const res = await fetch(`/api/users/${resetModalUser.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPassword: resetNewPass,
          mustChangePassword: resetMustChange,
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }
      onToast(
        isAr
          ? `تمت إعادة تعيين كلمة المرور للمستخدم (${resetModalUser.name}) بنجاح`
          : `Password reset successfully for ${resetModalUser.name}`
      );
      setResetModalUser(null);
      setResetNewPass("");
      if (onRefreshState) {
        await onRefreshState();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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

  function handleLogoFileUpload(
    field: "uasLogoCustomUrl" | "enterpriseLogoCustomUrl",
    styleField: "uasLogoStyle" | "enterpriseLogoStyle",
    file?: File
  ) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      onToast(isAr ? "حجم الشعار يجب أن لا يتجاوز 512 كيلوبايت" : "Logo file must be <= 512 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) {
        updateCmsDraft((prev) => ({
          ...prev,
          [field]: result,
          [styleField]: "custom",
        }));
      }
    };
    reader.readAsDataURL(file);
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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-700/80 pb-3 no-print">
        <button
          type="button"
          onClick={() => handleSelectSubTab("branding")}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${
            activeSubTab === "branding"
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
          className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${
            activeSubTab === "users"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>{isAr ? "المستخدمين وحوكمة الصلاحيات (Users & RBAC)" : "Users & RBAC Matrix"}</span>
        </button>
        <button
          type="button"
          onClick={() => handleSelectSubTab("security")}
          className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${
            activeSubTab === "security"
              ? "accent-bg shadow-sm"
              : "card-surface hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>{isAr ? "إعدادات النظام والأمان والربط (Settings & Connectivity)" : "System Settings & Connectivity"}</span>
        </button>
      </div>

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
            <button
              onClick={async () => {
                await onSaveBranding(orgName, logoText);
                setOrgNameDraft(null);
                setLogoTextDraft(null);
              }}
              disabled={readOnly || !canManageUsers}
              className="w-full py-2.5 rounded-xl accent-bg font-bold disabled:opacity-50"
            >
              حفظ إعدادات النظام
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
                    {serverUrlDraft || (isAr ? "محلي افتراضي (Same-Origin)" : "Default Origin")}
                  </span>
                </div>
              </div>

              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs">
                {isAr
                  ? "عند تشغيل النظام داخل شبكة المكتب المحلية (Office Wi-Fi) أو ربط تطبيق الأندرويد أو أجهزة الكاشير والمحاسبين، أدخل عنوان الخادم المخصص أو اختر السحابة الإنتاجية (https://qat.world)."
                  : "When operating inside the office local network or connecting Android APK tablets and remote workstations, configure your custom server address or connect to production cloud (https://qat.world)."}
              </p>

              <div className="flex flex-wrap gap-2.5" dir="ltr">
                <input
                  type="url"
                  value={serverUrlDraft}
                  onChange={(e) => setServerUrlDraft(e.target.value)}
                  placeholder="https://qat.world or http://192.168.1.100:3000"
                  className="flex-1 min-w-[260px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 py-2.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
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

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-500">
                  {isAr ? "الإعدادات السريعة الجاهزة:" : "Quick Presets:"}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSaveServerUrl("https://qat.world")}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-mono text-[11px] hover:border-emerald-500 hover:text-emerald-600 transition flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Cloud: https://qat.world</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveServerUrl("http://192.168.1.100:3000")}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-mono text-[11px] hover:border-emerald-500 hover:text-emerald-600 transition flex items-center gap-1.5"
                >
                  <Wifi className="w-3.5 h-3.5 text-indigo-600" />
                  <span>LAN: http://192.168.1.100:3000</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveServerUrl("")}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-[11px] hover:border-rose-500 hover:text-rose-600 transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                  <span>{isAr ? "استعادة المحلي الافتراضي" : "Reset Default Origin"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
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
              {users.map((u) => {
                const roleMeta = getRoleMeta(u.role);
                const isUserActive = u.active && (u.isActive ?? true);
                const hasCustom = Boolean(u.useCustomPermissions);

                return (
                  <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="p-2.5">
                      <div className="flex items-center gap-2.5">
                        <SvgAvatar char={u.avatarChar} size={32} />
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
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            isUserActive
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300"
                          }`}
                        >
                          {isUserActive ? "نشط (Active)" : "موقوف (Suspended)"}
                        </span>
                        {u.mustChangePassword && (
                          <span className="text-[9px] font-extrabold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-1 py-0.5 rounded">
                            مطلوب تغيير المرور
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center justify-center gap-1.5">
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
                          disabled={readOnly || !canManageUsers || u.id === currentUser.id}
                          title={isUserActive ? "إيقاف الحساب" : "تفعيل الحساب"}
                          className={`px-2 py-1 rounded-lg border text-xs font-bold inline-flex items-center gap-1 transition disabled:opacity-40 ${
                            isUserActive
                              ? "border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              : "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          }`}
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>{isUserActive ? "إيقاف" : "تفعيل"}</span>
                        </button>
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
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                      active
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
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1.5 transition ${
                      active
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
                    handleLogoFileUpload(
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
            <input
              type="text"
              value={cmsDraft.contactPhone ?? ""}
              disabled={readOnly || !canManageCms}
              onChange={(e) => updateCmsDraft((p) => ({ ...p, contactPhone: e.target.value }))}
              placeholder="+967 1 000 000"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">{isAr ? "رقم واتساب التواصل" : "WhatsApp Number"}</label>
            <input
              type="text"
              value={cmsDraft.contactWhatsApp ?? ""}
              disabled={readOnly || !canManageCms}
              onChange={(e) => updateCmsDraft((p) => ({ ...p, contactWhatsApp: e.target.value }))}
              placeholder="967770000000"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
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
                <SvgAvatar char={permDrawerUser.avatarChar} size={40} />
                <div>
                  <div className="font-extrabold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>{permDrawerUser.displayName || permDrawerUser.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-lg font-bold ${
                        ROLE_DEFINITIONS[normalizeRole(permDrawerUser.role)].badgeClass
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
                  className={`p-3 rounded-xl border text-right transition ${
                    !permUseCustom
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
                  className={`p-3 rounded-xl border text-right transition ${
                    permUseCustom
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
                          className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                            isAllowed
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
                          className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition ${
                            isChecked
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
                    className={`px-2 py-0.5 rounded font-bold transition ${
                      permAssignedProjects.length === 0
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
                        className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-2 cursor-pointer transition ${
                          checked
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
      {resetModalUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card-surface rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4 text-xs">
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
              <SvgAvatar char={resetModalUser.avatarChar} size={36} />
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
              <div>
                <label className="block font-extrabold text-xs mb-1.5 text-slate-700 dark:text-slate-300">
                  كلمة المرور الجديدة (New Password):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={resetNewPass}
                    onChange={(e) => setResetNewPass(e.target.value)}
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
        </div>
      )}
    </section>
  );
}


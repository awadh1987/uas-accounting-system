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
} from "lucide-react";
import {
  ALL_USER_ROLES,
  ROLE_DEFINITIONS,
  canApprove,
  canLockPeriod,
  canPostLedger,
  getAccessibleGroups,
  getRoleMeta,
  isReadOnly as checkIsReadOnly,
} from "@/lib/permissions";
import type {
  LanguageCode,
  ThemeName,
  UasEnterpriseProfile,
  UasSystemSettings,
  UasUser,
} from "@/types/uas";

interface SystemTabProps {
  settings: UasSystemSettings;
  enterpriseProfile?: UasEnterpriseProfile | null;
  lang: LanguageCode;
  theme: ThemeName;
  currentUser: UasUser;
  users: UasUser[];
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
  onOpenLogin: () => void;
  onToast: (msg: string) => void;
}

const DEFAULT_PROFILE_DRAFT: Partial<UasEnterpriseProfile> = {
  legalNameAr: "المؤسسة الزراعية الموحدة للاستثمار",
  legalNameEn: "Unified Agricultural Investment Enterprise",
  brandColor: "#059669",
  showUasLogo: true,
  uasLogoStyle: "emerald-shield",
  uasLogoCustomUrl: "",
  showEnterpriseLogo: true,
  enterpriseLogoStyle: "agri-leaf",
  enterpriseLogoCustomUrl: "",
  heroBadgeAr: "النظام المحاسبي الموحد المتكامل • معيار 5 مستويات GL",
  heroBadgeEn: "Enterprise Unified Accounting System • 5-Tier Double-Entry GL",
  heroTitleAr: "إدارة مالية ومحاسبية متكاملة للمشاريع وسلاسل الإمداد الزراعية",
  heroTitleEn: "Unified Double-Entry ERP for Projects, Treasury & Supply Chains",
  heroSubtitleAr:
    "تكامل تام بين المشتريات، المبيعات، الخزينة متعددة العملات، والأستاذ العام بتدقيق لحظي.",
  heroSubtitleEn:
    "End-to-end integration across procurement, harvest sales, multi-currency treasury, and automated double-entry GL.",
  aboutMissionAr:
    "منصة محاسبية مؤسسية مصممة لإدارة دورات الإنتاج الزراعي والمشاريع الاستثمارية بشفافية مالية ورقابة مزدوجة.",
  aboutMissionEn:
    "Enterprise ERP built for agricultural production cycles and capital projects with strict auditability.",
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
  onOpenLogin,
  onToast,
}: SystemTabProps) {
  const isAr = lang === "ar";
  const [orgNameDraft, setOrgNameDraft] = useState<string | null>(null);
  const [logoTextDraft, setLogoTextDraft] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState<string | null>(null);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<string>("FIELD_ACCOUNTANT");

  const [cmsOverrides, setCmsOverrides] = useState<Partial<UasEnterpriseProfile> | null>(null);
  const [savingCms, setSavingCms] = useState(false);

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

          {/* Current User Profile & Password Reset */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
            <h4 className="font-extrabold text-sm">
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
        </div>

        {/* Users Control Panel & Roles */}
        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
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
                <th className="p-2.5">الصورة</th>
                <th className="p-2.5">اسم المستخدم</th>
                <th className="p-2.5">القسم / المعرف</th>
                <th className="p-2.5">الدور والصلاحية (User Role)</th>
                <th className="p-2.5">الحالة</th>
                <th className="p-2.5">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {users.map((u) => {
                const roleMeta = getRoleMeta(u.role);
                return (
                  <tr key={u.id}>
                    <td className="p-2.5">
                      <SvgAvatar char={u.avatarChar} size={32} />
                    </td>
                    <td className="p-2.5">
                      <div className="font-bold">{u.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {u.assignedProjects?.length ? `${u.assignedProjects.length} مشاريع مسندة` : "جميع المشاريع"}
                      </div>
                    </td>
                    <td className="p-2.5">
                      <div className="text-slate-600 dark:text-slate-300 font-semibold">
                        {u.department || roleMeta.departmentAr}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                    </td>
                    <td className="p-2.5">
                      <span className={`px-2.5 py-1 rounded-lg font-bold inline-block ${roleMeta.badgeClass}`}>
                        {roleMeta.labelAr}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          u.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {u.active ? "نشط (Active)" : "موقوف (Suspended)"}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <button
                        onClick={() => onToggleUserStatus(u.id)}
                        disabled={readOnly || !canManageUsers}
                        className="text-xs font-bold text-indigo-600 hover:underline disabled:opacity-40"
                      >
                        تغيير الحالة
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dual Logo Generator & Landing Page CMS Studio */}
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
              placeholder={isAr ? "صنعاء - الجمهورية اليمنية" : "Sana'a, Republic of Yemen"}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>
        </div>
      </form>

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
    </section>
  );
}


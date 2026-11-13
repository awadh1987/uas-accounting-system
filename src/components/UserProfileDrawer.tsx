"use client";

import React, { useState } from "react";
import {
  Briefcase,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Paintbrush,
  Save,
  Shield,
  ShieldAlert,
  User,
  XCircle,
} from "lucide-react";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { SvgAvatar } from "@/components/SvgAvatar";
import {
  canApprove,
  canCreate,
  canDeleteVoid,
  canEdit,
  canEditDate,
  canLockPeriod,
  canManageLandingCms,
  canManageTreasury,
  canManageUsers,
  canPostLedger,
  getAccessibleGroups,
  getRoleMeta,
} from "@/lib/permissions";
import type { CurrencyCode } from "@/lib/formulas";
import type {
  LanguageCode,
  TabId,
  ThemeName,
  UasProject,
  UasUser,
} from "@/types/uas";

interface UserProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  currentUser: UasUser;
  lang: LanguageCode;
  theme: ThemeName;
  currency: CurrencyCode;
  projects?: UasProject[];
  onUserUpdated?: (user: UasUser) => void;
  onChangeLang?: (lang: LanguageCode) => void;
  onChangeTheme?: (theme: ThemeName) => void;
  onChangeCurrency?: (curr: CurrencyCode) => void;
  onToast: (msg: string) => void;
  onLogout?: () => void;
}

const AVATAR_COLOR_PALETTE = [
  "#059669", // Emerald
  "#4f46e5", // Indigo
  "#2563eb", // Blue
  "#0891b2", // Cyan
  "#d97706", // Amber
  "#dc2626", // Rose
  "#9333ea", // Purple
  "#475569", // Slate
];

const MODULE_OPTIONS: Array<{ id: TabId; labelAr: string; labelEn: string }> = [
  { id: "dashboard", labelAr: "لوحة التحكم الرئيسية", labelEn: "Executive Dashboard" },
  { id: "commercial", labelAr: "المبيعات والمشتريات والعملاء", labelEn: "Commercial & Sales" },
  { id: "operations", labelAr: "العمليات والمصروفات والعمال", labelEn: "Operations & Farm Expenses" },
  { id: "finance", labelAr: "المالية والأستاذ العام والخزينة", labelEn: "Finance & General Ledger" },
  { id: "projects", labelAr: "إدارة المشاريع والقطفات", labelEn: "Projects & Harvest Cycles" },
  { id: "reports", labelAr: "التقارير والقوائم المالية", labelEn: "Financial Reports & P&L" },
  { id: "system", labelAr: "إدارة النظام والأمان", labelEn: "System Admin & Security" },
];

export function UserProfileDrawer(props: UserProfileDrawerProps) {
  if (!props.open) return null;
  return <UserProfileDrawerContent key={props.currentUser.id} {...props} />;
}

function UserProfileDrawerContent({
  open,
  onClose,
  currentUser,
  lang,
  projects = [],
  onUserUpdated,
  onChangeLang,
  onChangeTheme,
  onChangeCurrency,
  onToast,
  onLogout,
}: UserProfileDrawerProps) {
  const isAr = lang === "ar";
  const roleMeta = getRoleMeta(currentUser);
  const [activeSubTab, setActiveSubTab] = useState<"profile" | "preferences" | "security" | "access">("profile");

  // Profile tab state
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [phone, setPhone] = useState(currentUser.phone || "");
  const [email, setEmail] = useState(currentUser.email || "");
  const [avatarColor, setAvatarColor] = useState(currentUser.avatarColor || "#059669");
  const [avatarChar, setAvatarChar] = useState(currentUser.avatarChar || "م");
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Preferences tab state
  const [prefLang, setPrefLang] = useState<LanguageCode>((currentUser.preferredLang as LanguageCode) || lang);
  const [prefCurrency, setPrefCurrency] = useState<CurrencyCode>((currentUser.preferredCurrency as CurrencyCode) || "YER");
  const [prefTheme, setPrefTheme] = useState<ThemeName>((currentUser.preferredTheme as ThemeName) || "emerald");
  const [prefDefaultModule, setPrefDefaultModule] = useState(currentUser.defaultModule || "dashboard");

  // Security tab state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Handle Profile + Preferences Update
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch("/api/users/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          avatarColor,
          avatarChar: avatarChar.trim() || currentUser.name.slice(0, 1),
          avatarUrl: avatarUrl.trim() || undefined,
          preferredLang: prefLang,
          preferredCurrency: prefCurrency,
          preferredTheme: prefTheme,
          defaultModule: prefDefaultModule,
          actor: {
            userId: currentUser.id,
            userDisplay: displayName.trim() || currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });

      const data = (await res.json()) as { error?: string; user?: UasUser };
      if (!res.ok || !data.user) {
        onToast(data.error || (isAr ? "تعذر حفظ البيانات" : "Failed to save profile"));
        return;
      }

      onToast(isAr ? "✅ تم حفظ الملف الشخصي وتفضيلات مساحة العمل بنجاح" : "✅ Profile and preferences saved successfully");
      onUserUpdated?.(data.user);
      if (prefLang !== lang && onChangeLang) onChangeLang(prefLang);
      if (onChangeTheme) onChangeTheme(prefTheme);
      if (onChangeCurrency) onChangeCurrency(prefCurrency);
    } catch {
      onToast(isAr ? "خطأ في الاتصال بالخادم" : "Network error");
    } finally {
      setSavingProfile(false);
    }
  }

  // Handle Password Change
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPassword) {
      onToast(isAr ? "يرجى إدخال كلمة المرور الحالية" : "Please enter your current password");
      return;
    }
    if (newPassword.length < 6) {
      onToast(isAr ? "يجب ألا تقل كلمة المرور الجديدة عن 6 أحرف/أرقام" : "Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      onToast(isAr ? "كلمة المرور الجديدة وتأكيدها غير متطابقين" : "New passwords do not match");
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch("/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.displayName || currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });

      const data = (await res.json()) as { error?: string; success?: boolean; message?: string };
      if (!res.ok) {
        onToast(data.error || (isAr ? "تعذر تغيير كلمة المرور" : "Failed to change password"));
        return;
      }

      onToast(isAr ? "✅ تم تغيير كلمة المرور بنجاح" : "✅ Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onUserUpdated?.({
        ...currentUser,
        mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString(),
      });
    } catch {
      onToast(isAr ? "خطأ في الاتصال بالخادم" : "Network error");
    } finally {
      setChangingPassword(false);
    }
  }

  // Resolve active permissions summary for "My Access & Scope" tab
  const accessibleGroups = getAccessibleGroups(currentUser);

  // Group label dictionary
  const GROUP_LABELS: Record<string, { ar: string; en: string }> = {
    public: { ar: "العامة (الرئيسية)", en: "Public" },
    projects: { ar: "المشاريع والقطفات", en: "Projects" },
    commercial: { ar: "التجاري (مبيعات ومشتريات)", en: "Commercial" },
    operations: { ar: "العمليات والمصروفات والعمال", en: "Operations" },
    finance: { ar: "المالية والأستاذ العام والخزينة", en: "Finance" },
    intelligence: { ar: "الذكاء المالي والتقارير", en: "Intelligence" },
    admin: { ar: "إدارة النظام والأمان", en: "Admin" },
  };

  const ACTION_CAPABILITIES = [
    { labelAr: "إضافة قيود وسجلات جديدة", labelEn: "Create Records", active: canCreate(currentUser) },
    { labelAr: "تعديل العمليات والسجلات القائمة", labelEn: "Edit Records", active: canEdit(currentUser) },
    { labelAr: "تعديل تواريخ الحركات المحاسبية", labelEn: "Edit Transaction Dates", active: canEditDate(currentUser) },
    { labelAr: "حذف أو عكس القيود والسندات", labelEn: "Void / Delete Records", active: canDeleteVoid(currentUser) },
    { labelAr: "الاعتماد المالي لأوامر الشراء", labelEn: "Financial Approval", active: canApprove(currentUser) },
    { labelAr: "ترحيل قيود اليومية العامة (GL)", labelEn: "Post General Ledger", active: canPostLedger(currentUser) },
    { labelAr: "إدارة الخزائن والحسابات البنكية", labelEn: "Manage Treasury & Banks", active: canManageTreasury(currentUser) },
    { labelAr: "إقفال وفتح الفترات والقطفات", labelEn: "Lock & Unlock Periods", active: canLockPeriod(currentUser) },
    { labelAr: "إدارة الهوية وبوابة CMS", labelEn: "Manage Landing CMS", active: canManageLandingCms(currentUser) },
    { labelAr: "إدارة المستخدمين والصلاحيات", labelEn: "Manage Users & Security", active: canManageUsers(currentUser) },
  ];

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      title={isAr ? "الملف الشخصي وإعدادات مساحة العمل" : "User Profile & Workspace Preferences"}
      subtitle={
        isAr
          ? `${currentUser.displayName || currentUser.name} (${roleMeta.labelAr})`
          : `${currentUser.displayName || currentUser.name} (${roleMeta.labelEn})`
      }
      size="lg"
      lang={lang}
      footer={
        onLogout ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500">
              {isAr ? "إنهاء الجلسة الحالية بأمان" : "End current session securely"}
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 border border-rose-200 dark:border-rose-800/60 transition"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>{isAr ? "تسجيل الخروج من الحساب" : "Sign Out"}</span>
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5 text-xs">
        {/* Must change password warning banner */}
        {currentUser.mustChangePassword && (
          <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-3 text-amber-800 dark:text-amber-200">
            <ShieldAlert className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <div className="font-extrabold text-xs">
                {isAr ? "يلزم تحديث كلمة المرور للحساب" : "Mandatory Password Update Required"}
              </div>
              <p className="text-[11px] leading-relaxed">
                {isAr
                  ? "طلب مدير النظام إعادة تعيين كلمة المرور الخاصة بك. يرجى التوجه لتبويب 'الأمان وكلمة المرور' وتعيين كلمة مرور جديدة آمنة."
                  : "An administrator has requested that you update your password. Please navigate to the Security tab to choose a new password."}
              </p>
            </div>
          </div>
        )}

        {/* User Identity Header Card */}
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/60 dark:to-slate-800/40 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className="relative p-1 rounded-2xl border-2 shadow-xs shrink-0"
              style={{ borderColor: avatarColor }}
            >
              <SvgAvatar char={avatarChar} size={48} />
              <div
                className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 shadow-xs"
                style={{ backgroundColor: avatarColor }}
                title="Avatar Theme Color"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-black text-slate-900 dark:text-slate-100">
                  {displayName || currentUser.name}
                </span>
                {displayName && displayName !== currentUser.name && (
                  <span className="text-[11px] text-slate-400">({currentUser.name})</span>
                )}
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${roleMeta.badgeClass}`}>
                  {isAr ? roleMeta.labelAr : roleMeta.labelEn}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate">{email || currentUser.email}</div>
              <div className="text-[10px] text-slate-400">
                {currentUser.department || roleMeta.departmentAr}
              </div>
            </div>
          </div>

          <div className="text-end text-[10px] text-slate-400 font-mono space-y-1 shrink-0 hidden sm:block">
            {currentUser.lastLoginAt && (
              <div>
                <span className="text-slate-500">{isAr ? "آخر دخول: " : "Last Login: "}</span>
                {new Date(currentUser.lastLoginAt).toLocaleDateString(isAr ? "ar-YE" : "en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}
            <div className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
              {currentUser.useCustomPermissions
                ? isAr
                  ? "صلاحيات مخصصة"
                  : "Custom RBAC"
                : isAr
                ? "صلاحيات الدور الافتراضية"
                : "Role Default"}
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80">
          <button
            type="button"
            onClick={() => setActiveSubTab("profile")}
            className={`flex-1 py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
              activeSubTab === "profile"
                ? "bg-white dark:bg-slate-900 shadow-xs text-emerald-600 dark:text-emerald-400"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>{isAr ? "الملف والتواصل" : "Profile & Contact"}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("preferences")}
            className={`flex-1 py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
              activeSubTab === "preferences"
                ? "bg-white dark:bg-slate-900 shadow-xs text-emerald-600 dark:text-emerald-400"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Paintbrush className="w-3.5 h-3.5" />
            <span>{isAr ? "تفضيلات العمل" : "Preferences"}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("security")}
            className={`flex-1 py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
              activeSubTab === "security"
                ? "bg-white dark:bg-slate-900 shadow-xs text-emerald-600 dark:text-emerald-400"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{isAr ? "الأمان وكلمة المرور" : "Security"}</span>
            {currentUser.mustChangePassword && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("access")}
            className={`flex-1 py-2 rounded-xl font-bold transition flex items-center justify-center gap-1.5 ${
              activeSubTab === "access"
                ? "bg-white dark:bg-slate-900 shadow-xs text-emerald-600 dark:text-emerald-400"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>{isAr ? "صلاحياتي ونطاقي" : "My Access & Scope"}</span>
          </button>
        </div>

        {/* TAB 1: Profile & Contact */}
        {activeSubTab === "profile" && (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  {isAr ? "الاسم الشخصي للعرض (اختياري)" : "Personal Display Name (Optional)"}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={isAr ? "اتركه فارغاً للاكتفاء بلقب الدور الوظيفي" : "Leave blank to display official role title only"}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  {isAr
                    ? "إذا تُرك فارغاً، يعرض النظام المسمى الرسمي للدور (مثل: مدير النظام العام)"
                    : "Defaults to role title if unset"}
                </span>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  {isAr ? "رقم الهاتف المحمول" : "Mobile Phone"}
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={isAr ? "رقم الهاتف" : "Phone number"}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono font-semibold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  {isAr ? "البريد الإلكتروني" : "Email Address"}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono font-semibold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  {isAr ? "حرف الأفاتار التعبيري" : "Avatar Character"}
                </label>
                <input
                  type="text"
                  maxLength={2}
                  value={avatarChar}
                  onChange={(e) => setAvatarChar(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs text-center font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Avatar Color Picker */}
            <div>
              <label className="block font-bold mb-1.5 text-slate-700 dark:text-slate-300">
                {isAr ? "لون الأفاتار المميز" : "Avatar Accent Color"}
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {AVATAR_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAvatarColor(c)}
                    className="w-7 h-7 rounded-full border-2 transition flex items-center justify-center"
                    style={{
                      backgroundColor: c,
                      borderColor: avatarColor === c ? "#0f172a" : "transparent",
                      boxShadow: avatarColor === c ? "0 0 0 2px white, 0 0 0 4px " + c : "none",
                    }}
                  >
                    {avatarColor === c && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                ))}
                <input
                  type="color"
                  value={avatarColor}
                  onChange={(e) => setAvatarColor(e.target.value)}
                  className="w-8 h-8 rounded-full cursor-pointer border-0 bg-transparent"
                  title={isAr ? "اختر لون مخصص" : "Choose custom color"}
                />
              </div>
            </div>

            {/* Avatar Photo / URL */}
            <div>
              <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                {isAr ? "رابط الصورة الشخصية (اختياري)" : "Avatar Photo URL (Optional)"}
              </label>
              <input
                type="text"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://... أو مسار صورة"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Role & Department (Official System Info) */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5" />
                <span>{isAr ? "بيانات الدور الوظيفي المؤسسي (معتمدة رسمياً)" : "Official Role & Department"}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 text-[10px] block">{isAr ? "المسمى الوظيفي:" : "Role Title:"}</span>
                  <span className="font-extrabold text-slate-800 dark:text-slate-200">
                    {isAr ? roleMeta.labelAr : roleMeta.labelEn}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">{isAr ? "القسم الإداري:" : "Department:"}</span>
                  <span className="font-extrabold text-slate-800 dark:text-slate-200">
                    {currentUser.department || roleMeta.departmentAr}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-5 py-2.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingProfile ? (isAr ? "جاري الحفظ..." : "Saving...") : isAr ? "حفظ التعديلات" : "Save Changes"}</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: Workspace Preferences */}
        {activeSubTab === "preferences" && (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isAr ? "اللغة المفضلة للواجهة" : "Preferred Language"}</span>
                </label>
                <select
                  value={prefLang}
                  onChange={(e) => setPrefLang(e.target.value as LanguageCode)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold"
                >
                  <option value="ar">العربية (Arabic - Default)</option>
                  <option value="en">English (الإنجليزية)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Paintbrush className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isAr ? "سمة المظهر واللون (Theme)" : "Display Theme"}</span>
                </label>
                <select
                  value={prefTheme}
                  onChange={(e) => setPrefTheme(e.target.value as ThemeName)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold"
                >
                  <option value="emerald">🌿 الزمردي الزراعي (Emerald)</option>
                  <option value="royal">🏛️ الملكي الكلاسيكي (Royal)</option>
                  <option value="dark">🌙 الوضع الليلي (Dark)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span>💰</span>
                  <span>{isAr ? "العملة الافتراضية للقوائم" : "Default Display Currency"}</span>
                </label>
                <select
                  value={prefCurrency}
                  onChange={(e) => setPrefCurrency(e.target.value as CurrencyCode)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold font-mono"
                >
                  <option value="YER">YER — الريال اليمني (العملة الأساسية)</option>
                  <option value="SAR">SAR — الريال السعودي</option>
                  <option value="USD">USD — الدولار الأمريكي</option>
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <LayoutDashboard className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isAr ? "القسم الافتراضي عند فتح النظام" : "Default Home Module"}</span>
                </label>
                <select
                  value={prefDefaultModule}
                  onChange={(e) => setPrefDefaultModule(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold"
                >
                  {MODULE_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {isAr ? m.labelAr : m.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-5 py-2.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingProfile ? (isAr ? "جاري الحفظ..." : "Saving...") : isAr ? "حفظ التفضيلات" : "Save Preferences"}</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 3: Security & Password */}
        {activeSubTab === "security" && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>{isAr ? "سجل أمان الحساب وتسجيل الدخول" : "Account Security Timestamps"}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                <div>
                  <span className="text-slate-400">{isAr ? "آخر تسجيل دخول: " : "Last Login: "}</span>
                  <span className="font-mono font-bold">
                    {currentUser.lastLoginAt
                      ? new Date(currentUser.lastLoginAt).toLocaleString(isAr ? "ar-YE" : "en-US")
                      : isAr ? "لا يوجد تسجيل سابق" : "None recorded"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">{isAr ? "آخر تغيير لكلمة المرور: " : "Password Last Updated: "}</span>
                  <span className="font-mono font-bold">
                    {currentUser.passwordUpdatedAt
                      ? new Date(currentUser.passwordUpdatedAt).toLocaleString(isAr ? "ar-YE" : "en-US")
                      : isAr ? "كلمة المرور الافتراضية" : "Initial Seed Password"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  {isAr ? "كلمة المرور الحالية" : "Current Password"}
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPass ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 pe-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrentPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    {isAr ? "كلمة المرور الجديدة" : "New Password"}
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPass ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 pe-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPass(!showNewPass)}
                      className="absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showNewPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    {isAr ? "6 خانات على الأقل" : "Min 6 characters"}
                  </span>
                </div>

                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    {isAr ? "تأكيد كلمة المرور الجديدة" : "Confirm New Password"}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500"
                  />
                  {newPassword && confirmPassword && newPassword !== confirmPassword && (
                    <span className="text-[10px] text-rose-500 mt-0.5 block">
                      {isAr ? "كلمات المرور غير متطابقة" : "Passwords do not match"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={changingPassword}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold inline-flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4" />
                <span>{changingPassword ? (isAr ? "جاري التحديث..." : "Updating...") : isAr ? "تغيير كلمة المرور" : "Update Password"}</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 4: My Access & Scope */}
        {activeSubTab === "access" && (
          <div className="space-y-4">
            {/* RBAC Mode Pill */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-extrabold text-xs">
                  {currentUser.useCustomPermissions
                    ? isAr
                      ? "صلاحيات مخصصة للمستخدم (Custom Per-User Access)"
                      : "Custom User Overrides Active"
                    : isAr
                    ? "صلاحيات الدور الافتراضية (System Role Defaults)"
                    : "System Role Defaults Active"}
                </div>
                <div className="text-[11px] text-slate-500">
                  {currentUser.useCustomPermissions
                    ? isAr
                      ? "تم تخصيص الأقسام والصلاحيات بشكل فردي لحسابك بواسطة مدير النظام"
                      : "Sections and actions custom granted by SUPER_ADMIN"
                    : isAr
                    ? `تتبع الصلاحيات المعيارية لدور ${roleMeta.labelAr}`
                    : `Inheriting standard permissions for ${roleMeta.labelEn}`}
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                  currentUser.useCustomPermissions
                    ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                }`}
              >
                {currentUser.useCustomPermissions ? "Custom" : "Standard"}
              </span>
            </div>

            {/* Allowed Sections / Groups */}
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                {isAr ? "الأقسام والمجالات المصرح بالوصول إليها:" : "Authorized Functional Domains:"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {accessibleGroups.map((grp) => (
                  <span
                    key={grp}
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>{isAr ? GROUP_LABELS[grp]?.ar || grp : GROUP_LABELS[grp]?.en || grp}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Action Capabilities Grid */}
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                {isAr ? "حقوق وإمكانيات الإجراءات الفعلية (Action Rights):" : "Effective Action Permissions:"}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ACTION_CAPABILITIES.map((cap, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-xl border flex items-center justify-between text-[11px] ${
                      cap.active
                        ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200"
                        : "bg-slate-50 dark:bg-slate-900/30 border-slate-200/60 dark:border-slate-800/40 text-slate-400 opacity-60"
                    }`}
                  >
                    <span className="font-semibold">{isAr ? cap.labelAr : cap.labelEn}</span>
                    {cap.active ? (
                      <span className="text-emerald-600 font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>{isAr ? "مفعل" : "Granted"}</span>
                      </span>
                    ) : (
                      <span className="text-rose-500 font-bold flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{isAr ? "معطل" : "Restricted"}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Assigned Project Scope */}
            <div className="space-y-1.5">
              <div className="font-bold text-slate-700 dark:text-slate-300 text-xs">
                {isAr ? "نطاق المشاريع المسندة:" : "Assigned Projects Scope:"}
              </div>
              {currentUser.assignedProjects && currentUser.assignedProjects.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {currentUser.assignedProjects.map((pid) => {
                    const p = projects.find((proj) => proj.id === pid);
                    return (
                      <span
                        key={pid}
                        className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold"
                      >
                        📂 {p ? p.name : pid}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-semibold">
                  🌐 {isAr ? "صلاحية شاملة على جميع المشاريع المؤسسية" : "Full access across all enterprise projects"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SlideOverDrawer>
  );
}

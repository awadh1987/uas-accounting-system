"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Globe2,
  HardDrive,
  KeyRound,
  Lock,
  Monitor,
  Network,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { resolveEffectiveTagline } from "@/lib/branding";
import { isInstalledClientApp } from "@/lib/runtimePlatform";
import {
  getApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl,
  setStoredSessionToken,
  setStoredTenantId,
} from "@/lib/apiClient";
import { extractSubdomainSlugFromHost } from "@/lib/tenant/tenantSlug";
import type { LicenseStatusData } from "@/components/LicenseActivationModal";
import type { LanguageCode, ThemeName, UasEnterpriseProfile, UasUser } from "@/types/uas";

interface LoginViewProps {
  users: UasUser[];
  logoText: string;
  enterpriseProfile?: UasEnterpriseProfile;
  lang: LanguageCode;
  theme: ThemeName;
  currentUserId: string;
  offlineMode: boolean;
  licenseStatus?: LicenseStatusData | null;
  onOpenLicenseModal?: () => void;
  onBackToLanding: () => void;
  onToggleLang: () => void;
  onLoginSuccess: (user: UasUser, rememberDevice: boolean) => void;
  onToast: (msg: string) => void;
}

const REMEMBER_KEY = "uas_remembered_identifier";

export function LoginView({
  users,
  logoText,
  enterpriseProfile,
  lang,
  theme: _theme,
  currentUserId: _currentUserId,
  offlineMode,
  licenseStatus,
  onOpenLicenseModal,
  onBackToLanding,
  onToggleLang,
  onLoginSuccess,
  onToast,
}: LoginViewProps) {
  const isAr = lang === "ar";
  const [isInstalledApp, setIsInstalledApp] = useState(true);
  const activeUsers = users.filter((u) => u.active);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) setIsInstalledApp(isInstalledClientApp());
    });
    return () => {
      active = false;
    };
  }, []);

  const [identifier, setIdentifier] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) return saved;
    }
    return "";
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Server Connection Switcher (LAN / Cloud)
  const [serverDrawerOpen, setServerDrawerOpen] = useState(false);
  const [customServerUrl, setCustomServerUrl] = useState(() => getApiBaseUrl());
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "ok" | "fail">("idle");

  // Admin Password Recovery Modal
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryCompanyName, setRecoveryCompanyName] = useState(
    enterpriseProfile?.legalNameAr || enterpriseProfile?.legalNameEn || ""
  );
  const [recoveryKeyOrJson, setRecoveryKeyOrJson] = useState("");
  const [recoveryFileName, setRecoveryFileName] = useState("");
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [recoverySubmitting, setRecoverySubmitting] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoverySuccess, setRecoverySuccess] = useState<string | null>(null);

  async function handleRecoverAdminPassword(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryError(null);
    setRecoverySuccess(null);

    if (!recoveryCompanyName.trim()) {
      setRecoveryError(isAr ? "يرجى إدخال اسم المنشأة المرخصة" : "Please enter the licensed company name");
      return;
    }

    if (!recoveryKeyOrJson.trim()) {
      setRecoveryError(
        isAr
          ? "يرجى رفع ملف الترخيص الرقمي (license.uas) أو إدخال رمز المفتاح (UASKEY-...)"
          : "Please upload license.uas file or enter UASKEY serial token"
      );
      return;
    }

    if (recoveryNewPassword.length < 6) {
      setRecoveryError(
        isAr ? "كلمة المرور يجب أن تتكون من 6 أحرف على الأقل" : "Password must be at least 6 characters"
      );
      return;
    }

    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setRecoveryError(isAr ? "كلمتا المرور غير متطابقتين" : "Passwords do not match");
      return;
    }

    setRecoverySubmitting(true);
    try {
      const baseUrl = getApiBaseUrl();
      const endpoint = baseUrl ? `${baseUrl}/api/auth/recover-admin` : "/api/auth/recover-admin";

      const licensePayload: Record<string, unknown> = {};
      const trimmedKey = recoveryKeyOrJson.trim();
      if (trimmedKey.startsWith("UASKEY-")) {
        licensePayload.activationKey = trimmedKey;
      } else {
        try {
          const parsed = JSON.parse(trimmedKey);
          licensePayload.licenseFileContent = parsed;
        } catch {
          licensePayload.activationKey = trimmedKey;
        }
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: recoveryCompanyName.trim(),
          newPassword: recoveryNewPassword,
          ...licensePayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRecoveryError(data.error || (isAr ? "فشلت عملية الاستعادة" : "Recovery failed"));
        return;
      }

      setRecoverySuccess(
        data.message ||
          (isAr
            ? "تمت استعادة كلمة مرور مدير النظام بنجاح! يمكنك الآن تسجيل الدخول."
            : "Admin password successfully reset! You can now sign in.")
      );
      if (data.username) {
        setIdentifier(data.username);
      }
      onToast(isAr ? "تم إعادة تعيين كلمة مرور مدير النظام بنجاح" : "Admin password recovered successfully");
    } catch (err) {
      setRecoveryError((err as Error).message);
    } finally {
      setRecoverySubmitting(false);
    }
  }

  const BackArrow = isAr ? ArrowRight : ArrowLeft;

  async function testServerConnection(urlToTest: string) {
    const clean = urlToTest.trim().replace(/\/+$/, "");
    setTestingConnection(true);
    setConnectionStatus("idle");
    try {
      const testEndpoint = clean ? `${clean}/api/public/verify` : "/api/public/verify";
      const res = await fetch(testEndpoint, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        setConnectionStatus("ok");
        onToast(isAr ? "تم الاتصال بالخادم بنجاح!" : "Connected to server successfully!");
      } else {
        setConnectionStatus("fail");
        onToast(isAr ? `فشل الاتصال: HTTP ${res.status}` : `Connection failed: HTTP ${res.status}`);
      }
    } catch {
      setConnectionStatus("fail");
      onToast(isAr ? "تعذر الوصول إلى عنوان الخادم" : "Server unreachable");
    } finally {
      setTestingConnection(false);
    }
  }

  function handleApplyServerUrl(urlToApply: string) {
    const clean = urlToApply.trim().replace(/\/+$/, "");
    if (!clean) {
      resetApiBaseUrl();
      setCustomServerUrl("");
      onToast(isAr ? "تم استعادة العنوان الافتراضي" : "Reset to default endpoint");
    } else {
      setApiBaseUrl(clean);
      setCustomServerUrl(clean);
      onToast(isAr ? `تم حفظ عنوان الخادم: ${clean}` : `Server endpoint set: ${clean}`);
    }
  }

  async function authenticate(params: { identifierInput: string; passInput: string }) {
    setErrorMsg(null);
    const localMatch = activeUsers.find(
      (u) =>
        u.email.toLowerCase() === params.identifierInput.trim().toLowerCase() ||
        (u.username || "").toLowerCase() === params.identifierInput.trim().toLowerCase()
    );

    if (offlineMode || (typeof navigator !== "undefined" && !navigator.onLine)) {
      if (!localMatch) {
        setErrorMsg(
          isAr
            ? "لم يتم العثور على الحساب في ذاكرة الجهاز المحلية (وضع عدم الاتصال)"
            : "Account not found in local offline cache"
        );
        return;
      }
      if (typeof window !== "undefined") {
        const localTenant = (localMatch as UasUser & { tenantId?: string })?.tenantId;
        if (localTenant) {
          setStoredTenantId(localTenant);
        }
        if (rememberDevice) window.localStorage.setItem(REMEMBER_KEY, localMatch.email);
        else window.localStorage.removeItem(REMEMBER_KEY);
      }
      onLoginSuccess(localMatch, rememberDevice);
      return;
    }

    setSubmitting(true);
    try {
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: params.identifierInput,
          password: params.passInput,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        user?: UasUser;
        sessionToken?: string;
        mustChangePassword?: boolean;
        error?: string;
        tenantId?: string;
      };
      if (!res.ok || !data.user) {
        if ((res.status === 404 || res.status === 405) && !data.error && localMatch) {
          throw new Error("STATIC_EXPORT_OFFLINE_LOGIN");
        }
        const msg =
          data.error ||
          (isAr ? "بيانات الدخول غير صحيحة، يرجى التحقق والمحاولة مجدداً" : "Invalid credentials");
        setErrorMsg(msg);
        onToast(msg);
        return;
      }
      const loggedInUser: UasUser = {
        ...data.user,
        mustChangePassword: Boolean(data.mustChangePassword ?? data.user.mustChangePassword),
      };
      if (typeof window !== "undefined") {
        if (data.sessionToken) {
          setStoredSessionToken(data.sessionToken);
        }
        if (data.tenantId) {
          setStoredTenantId(data.tenantId);
        } else {
          const userTenant = (loggedInUser as UasUser & { tenantId?: string })?.tenantId;
          if (userTenant) {
            setStoredTenantId(userTenant);
          }
        }
        if (rememberDevice) window.localStorage.setItem(REMEMBER_KEY, loggedInUser.email);
        else window.localStorage.removeItem(REMEMBER_KEY);
      }
      onLoginSuccess(loggedInUser, rememberDevice);
    } catch {
      if (localMatch) {
        onLoginSuccess(localMatch, rememberDevice);
      } else {
        setErrorMsg(
          isAr
            ? "تعذر الاتصال بخادم المصادقة، تأكد من اتصال الشبكة أو عنوان الخادم"
            : "Unable to reach authentication server. Check network connection or server endpoint."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setErrorMsg(
        isAr
          ? "يرجى إدخال البريد الإلكتروني أو اسم المستخدم وكلمة المرور"
          : "Please enter your email or username and password"
      );
      return;
    }
    await authenticate({ identifierInput: identifier.trim(), passInput: password });
  }

  const legalName = isAr
    ? enterpriseProfile?.legalNameAr?.trim() || "منظومة تخطيط الموارد المحاسبية"
    : enterpriseProfile?.legalNameEn?.trim() || "Enterprise Resource Planning";
  const tagline = resolveEffectiveTagline(enterpriseProfile, lang);
  const hostSlug =
    typeof window !== "undefined" ? extractSubdomainSlugFromHost(window.location.host) : null;
  const tenantSlug = hostSlug || enterpriseProfile?.tenantSlug || null;
  const tenantUrl = tenantSlug && tenantSlug !== "default" ? `https://${tenantSlug}.qat.world` : null;
  const welcomeNotice = isAr
    ? enterpriseProfile?.welcomeNoticeAr
    : enterpriseProfile?.welcomeNoticeEn;

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-4 sm:p-6 lg:p-8">
      {/* Subtle Top Navigation */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
        <button
          type="button"
          onClick={onBackToLanding}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition"
        >
          <BackArrow className="w-4 h-4" />
          <span>{isAr ? "العودة للرئيسية" : "Back to Home"}</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition"
          >
            <Globe2 className="w-4 h-4" />
            <span>{isAr ? "English" : "العربية"}</span>
          </button>
        </div>
      </header>

      {/* Centered Enterprise Authentication Card */}
      <main className="w-full flex items-center justify-center my-auto py-6">
        <div className="w-full max-w-md mx-auto">
          <div className="card-surface rounded-3xl p-7 sm:p-9 shadow-xl border border-slate-200 dark:border-slate-800 space-y-6">
            {/* Enterprise Identity Header */}
            <div className="text-center space-y-3">
              <div className="flex justify-center">
                <DualLogoBadge
                  profile={enterpriseProfile}
                  logoText={logoText}
                  size="lg"
                />
              </div>
              <div className="space-y-1">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight pt-1">
                  {legalName}
                </h1>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {tagline}
                </p>
                {tenantUrl && (
                  <div className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300" dir="ltr">
                    {tenantUrl}
                  </div>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isAr
                    ? "تسجيل الدخول إلى بوابة النظام المحاسبي"
                    : "Sign in to your accounting workspace"}
                </p>
                {welcomeNotice && (
                  <div className="mt-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-emerald-800 dark:text-emerald-200">
                    {welcomeNotice}
                  </div>
                )}
              </div>

              {offlineMode && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-bold">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>{isAr ? "وضع العمل دون اتصال (Offline Mode)" : "Offline Mode Active"}</span>
                </div>
              )}
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-300 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 px-4 py-3 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center gap-2.5"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Authentication Form */}
            {onOpenLicenseModal && (
              <button
                type="button"
                onClick={onOpenLicenseModal}
                className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition ${
                  licenseStatus && !licenseStatus.is_valid
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                    : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {licenseStatus && !licenseStatus.is_valid
                    ? (isAr ? "تفعيل الترخيص — أدخل مفتاح التفعيل أو ملف license.uas" : "Activate License — Enter Key or Upload license.uas")
                    : (isAr ? "حالة الترخيص والتفعيل (Ed25519)" : "License & Activation Status")}
                </span>
              </button>
            )}
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="loginIdentifierInput"
                  className="block text-xs font-extrabold mb-1.5 text-slate-700 dark:text-slate-300"
                >
                  {isAr ? "البريد الإلكتروني أو اسم المستخدم" : "Email or Username"}
                </label>
                <input
                  id="loginIdentifierInput"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="username"
                  required
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition"
                />
              </div>

              <div>
                <label
                  htmlFor="loginPasswordInput"
                  className="block text-xs font-extrabold mb-1.5 text-slate-700 dark:text-slate-300"
                >
                  {isAr ? "كلمة المرور" : "Password"}
                </label>
                <div className="relative">
                  <input
                    id="loginPasswordInput"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3.5 py-2.5 pe-11 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 end-0 px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  />
                  <span>{isAr ? "تذكر هذا الجهاز" : "Remember this device"}</span>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setRecoveryError(null);
                    setRecoverySuccess(null);
                    setShowRecoveryModal(true);
                  }}
                  className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline transition"
                >
                  {isAr ? "نسيت كلمة مرور مدير النظام؟" : "Forgot Admin Password?"}
                </button>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl accent-bg font-extrabold text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-60 transition"
              >
                {submitting ? (
                  <span>{isAr ? "جاري التحقق والدخول..." : "Signing in..."}</span>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>{isAr ? "تسجيل الدخول" : "Sign In"}</span>
                  </>
                )}
              </button>
            </form>

            {/* Collapsible Server Connection Selector (LAN / Cloud Switcher) */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setServerDrawerOpen((prev) => !prev)}
                className="w-full flex items-center justify-between py-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
              >
                <div className="flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-emerald-600" />
                  <span>
                    {isAr
                      ? "وضع الاتصال بالخادم (LAN / Cloud)"
                      : "Server Connection (LAN / Cloud)"}
                  </span>
                </div>
                {serverDrawerOpen ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {serverDrawerOpen && (
                <div className="mt-3 p-3.5 rounded-2xl bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleApplyServerUrl("")}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition flex items-center gap-1 ${
                        !customServerUrl
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      <HardDrive className="w-3 h-3" />
                      <span>{isAr ? "افتراضي / محلي" : "Default / Local"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApplyServerUrl("https://qat.world")}
                      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition flex items-center gap-1 ${
                        customServerUrl === "https://qat.world"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      <Globe2 className="w-3 h-3" />
                      <span>qat.world (Cloud)</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500">
                      {isAr
                        ? "عنوان خادم المكتب بالشبكة المحلية (LAN IP) أو دومين السحابة:"
                        : "Office LAN IP (e.g. http://192.168.1.50:3000) or Cloud URL:"}
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={customServerUrl}
                        onChange={(e) => setCustomServerUrl(e.target.value)}
                        placeholder="http://192.168.1.x:3000"
                        className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => testServerConnection(customServerUrl)}
                        disabled={testingConnection}
                        className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 text-[11px] font-bold transition flex items-center gap-1 shrink-0"
                      >
                        <RefreshCw className={`w-3 h-3 ${testingConnection ? "animate-spin" : ""}`} />
                        <span>{isAr ? "فحص" : "Test"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyServerUrl(customServerUrl)}
                        className="px-2.5 py-1.5 rounded-xl accent-bg text-[11px] font-bold shrink-0"
                      >
                        <span>{isAr ? "حفظ" : "Save"}</span>
                      </button>
                    </div>
                  </div>

                  {connectionStatus === "ok" && (
                    <div className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{isAr ? "تم الاتصال بنجاح بالخادم" : "Server connection verified"}</span>
                    </div>
                  )}
                  {connectionStatus === "fail" && (
                    <div className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>{isAr ? "تعذر الاتصال بالخادم، تأكد من عنوان IP" : "Connection failed. Check LAN IP"}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="pt-1 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
              <Lock className="w-3 h-3 text-emerald-600" />
              <span>{isAr ? "اتصال مشفر وآمن بمعايير المؤسسات" : "Encrypted Enterprise-Grade Authentication"}</span>
            </div>

            {/* Direct Commercial Downloads: Windows Desktop / LAN + Android Mobile App (Web Portal Only) */}
            {!isInstalledApp && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="text-center text-[11px] font-bold text-slate-400">
                {isAr ? "التحميل المباشر للأنظمة الميدانية والمكتبية:" : "Direct System Downloads:"}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <a
                  href="/downloads/UAS-Setup-Win64.exe"
                  download="UAS-Setup-Win64.exe"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-500/40 hover:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-xs font-bold transition shadow-xs"
                >
                  <Monitor className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span className="truncate">{isAr ? "ويندوز (Desktop / LAN)" : "Windows (Win64 .exe)"}</span>
                </a>

                <a
                  href="/downloads/UAS-Mobile-Release-qat.world.apk"
                  download="UAS-Mobile-Release-qat.world.apk"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-500/40 hover:border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition shadow-xs"
                >
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">{isAr ? "تطبيق أندرويد (APK)" : "Android (Mobile APK)"}</span>
                </a>
              </div>
            </div>
            )}
          </div>
        </div>
      </main>

      {/* Corporate Metadata Footer */}
      <footer className="max-w-5xl w-full mx-auto py-3 text-center text-[11px] text-slate-400 space-y-1">
        <p>
          {[
            enterpriseProfile?.commercialReg
              ? `${isAr ? "سجل تجاري:" : "CR:"} ${enterpriseProfile.commercialReg}`
              : null,
            enterpriseProfile?.taxNumber
              ? `${isAr ? "الرقم الضريبي:" : "Tax ID:"} ${enterpriseProfile.taxNumber}`
              : null,
          ]
            .filter(Boolean)
            .join(" • ")}
        </p>
        <p>© 2026 {legalName} — Unified Accounting System (UAS ERP)</p>
      </footer>

      {/* Admin Password Recovery Modal */}
      {showRecoveryModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            if (!recoverySubmitting) setShowRecoveryModal(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card-surface rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                    {isAr ? "استعادة كلمة مرور مدير النظام العام" : "SUPER_ADMIN Password Recovery"}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isAr
                      ? "إثبات الملكية عبر الترخيص الرقمي واسم المنشأة"
                      : "Cryptographic Proof of License Ownership & Company Match"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRecoveryModal(false)}
                disabled={recoverySubmitting}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {recoverySuccess ? (
              <div className="space-y-4 py-2">
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 space-y-2">
                  <div className="flex items-center gap-2 font-extrabold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>{isAr ? "نجحت عملية الاستعادة!" : "Recovery Successful!"}</span>
                  </div>
                  <p className="text-xs leading-relaxed">{recoverySuccess}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowRecoveryModal(false);
                    setPassword("");
                  }}
                  className="w-full py-2.5 rounded-xl accent-bg font-extrabold text-xs shadow-sm transition"
                >
                  {isAr ? "الانتقال لتسجيل الدخول الآن" : "Proceed to Sign In"}
                </button>
              </div>
            ) : (
              <form onSubmit={handleRecoverAdminPassword} className="space-y-3.5">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                  {isAr
                    ? "لضمان أعلى معايير الأمان المالي، يتطلب إعادة تعيين كلمة مرور مدير النظام تقديم إثبات تشفيري بملكية ترخيص المنشأة (ملف license.uas أو رمز UASKEY) مع إدخال اسم المنشأة المعتمد."
                    : "To maintain enterprise accounting security, resetting the SUPER_ADMIN password requires cryptographic proof of license ownership (license.uas or UASKEY token) matching the company name."}
                </div>

                {recoveryError && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span className="text-xs font-semibold leading-relaxed">{recoveryError}</span>
                  </div>
                )}

                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    {isAr ? "اسم المنشأة المرخصة (Company Name):" : "Licensed Company Name:"}
                  </label>
                  <input
                    type="text"
                    value={recoveryCompanyName}
                    onChange={(e) => setRecoveryCompanyName(e.target.value)}
                    required
                    placeholder={isAr ? "مثال: مؤسسة القات للإنتاج الزراعي" : "e.g. UAS Enterprise Co"}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    {isAr ? "ملف الترخيص (license.uas) أو رمز التفعيل (UASKEY-...):" : "License File (license.uas) or UASKEY Token:"}
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50/40 dark:bg-slate-900/40 cursor-pointer transition">
                      <Upload className="w-4 h-4 text-emerald-600" />
                      <span className="font-bold text-xs text-slate-600 dark:text-slate-300">
                        {recoveryFileName ? recoveryFileName : isAr ? "رفع ملف license.uas" : "Upload license.uas"}
                      </span>
                      <input
                        type="file"
                        accept=".uas,.json"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setRecoveryFileName(file.name);
                            const text = await file.text();
                            setRecoveryKeyOrJson(text);
                          }
                        }}
                      />
                    </label>

                    <div className="relative">
                      <textarea
                        value={recoveryKeyOrJson}
                        onChange={(e) => setRecoveryKeyOrJson(e.target.value)}
                        placeholder="UASKEY-..."
                        rows={2}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 p-2.5 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                      {isAr ? "كلمة المرور الجديدة:" : "New Password:"}
                    </label>
                    <input
                      type="password"
                      value={recoveryNewPassword}
                      onChange={(e) => setRecoveryNewPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                      {isAr ? "تأكيد كلمة المرور:" : "Confirm Password:"}
                    </label>
                    <input
                      type="password"
                      value={recoveryConfirmPassword}
                      onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={recoverySubmitting}
                    onClick={() => setShowRecoveryModal(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  >
                    {isAr ? "إلغاء" : "Cancel"}
                  </button>
                  <button
                    type="submit"
                    disabled={recoverySubmitting}
                    className="px-5 py-2 rounded-xl accent-bg font-extrabold flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition"
                  >
                    {recoverySubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{recoverySubmitting ? (isAr ? "جاري التحقق والتعيين..." : "Verifying...") : isAr ? "استعادة وتعيين كلمة المرور" : "Recover & Reset"}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Lock,
  WifiOff,
} from "lucide-react";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { getApiBaseUrl } from "@/lib/apiClient";
import type { LanguageCode, ThemeName, UasEnterpriseProfile, UasUser } from "@/types/uas";

interface LoginViewProps {
  users: UasUser[];
  logoText: string;
  enterpriseProfile?: UasEnterpriseProfile;
  lang: LanguageCode;
  theme: ThemeName;
  currentUserId: string;
  offlineMode: boolean;
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
  currentUserId,
  offlineMode,
  onBackToLanding,
  onToggleLang,
  onLoginSuccess,
  onToast,
}: LoginViewProps) {
  const isAr = lang === "ar";
  const activeUsers = users.filter((u) => u.active);
  const currentUser = activeUsers.find((u) => u.id === currentUserId) || activeUsers[0];

  const [identifier, setIdentifier] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) return saved;
    }
    return currentUser?.email || "admin@uas-ye.com";
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const BackArrow = isAr ? ArrowRight : ArrowLeft;

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
      const data = (await res.json().catch(() => ({}))) as { user?: UasUser; error?: string };
      if (!res.ok || !data.user) {
        const msg =
          data.error ||
          (isAr ? "بيانات الدخول غير صحيحة، يرجى التحقق والمحاولة مجدداً" : "Invalid credentials");
        setErrorMsg(msg);
        onToast(msg);
        return;
      }
      if (typeof window !== "undefined") {
        if (rememberDevice) window.localStorage.setItem(REMEMBER_KEY, data.user.email);
        else window.localStorage.removeItem(REMEMBER_KEY);
      }
      onLoginSuccess(data.user, rememberDevice);
    } catch {
      if (localMatch) {
        onLoginSuccess(localMatch, rememberDevice);
      } else {
        setErrorMsg(
          isAr
            ? "تعذر الاتصال بخادم المصادقة، تأكد من اتصال الشبكة"
            : "Unable to reach authentication server"
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

        <button
          type="button"
          onClick={onToggleLang}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition"
        >
          <Globe2 className="w-4 h-4" />
          <span>{isAr ? "English" : "العربية"}</span>
        </button>
      </header>

      {/* Centered Enterprise Authentication Card */}
      <main className="w-full flex items-center justify-center my-auto py-8">
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
                <h1 className="text-xl sm:text-2xl font-black tracking-tight">
                  {legalName}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isAr
                    ? "تسجيل الدخول إلى منظومة الحسابات الموحدة (UAS ERP)"
                    : "Sign in to Unified Accounting System (UAS ERP)"}
                </p>
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
                  placeholder="admin@uas-ye.com"
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

            <div className="pt-2 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
              <Lock className="w-3 h-3 text-emerald-600" />
              <span>{isAr ? "اتصال مشفر وآمن بمعايير المؤسسات" : "Encrypted Enterprise-Grade Authentication"}</span>
            </div>
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
    </div>
  );
}

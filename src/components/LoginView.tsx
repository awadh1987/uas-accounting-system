"use client";

import React, { useState } from "react";
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
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { SvgAvatar } from "@/components/SvgAvatar";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { getRoleMeta, normalizeRole } from "@/lib/permissions";
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
  theme,
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
  const [password, setPassword] = useState("123456");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(true);
  const [demoDrawerOpen, setDemoDrawerOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const brandGradient =
    theme === "royal"
      ? "from-indigo-950 via-indigo-800 to-violet-700"
      : theme === "dark"
      ? "from-slate-950 via-slate-900 to-emerald-950"
      : "from-emerald-950 via-emerald-800 to-teal-700";

  async function authenticate(params: { userId?: string; identifierInput?: string; passInput: string }) {
    setErrorMsg(null);
    const localMatch = params.userId
      ? activeUsers.find((u) => u.id === params.userId)
      : activeUsers.find(
          (u) =>
            u.email.toLowerCase() === (params.identifierInput || "").trim().toLowerCase() ||
            (u.username || "").toLowerCase() === (params.identifierInput || "").trim().toLowerCase()
        );

    if (offlineMode || (typeof navigator !== "undefined" && !navigator.onLine)) {
      if (!localMatch) {
        setErrorMsg(
          isAr
            ? "لم يتم العثور على الحساب في ذاكرة الجهاز المحلية (Offline)"
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
      const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          params.userId
            ? { userId: params.userId, password: params.passInput }
            : { identifier: params.identifierInput, password: params.passInput }
        ),
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
            ? "تعذر الاتصال بخادم المصادقة، تأكد من الشبكة أو استخدم وضع التبديل المحلي"
            : "Unable to reach auth server"
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

  async function handleQuickRoleSignIn(u: UasUser) {
    setIdentifier(u.email);
    setPassword("123456");
    await authenticate({ userId: u.id, passInput: "123456" });
  }

  const BackArrow = isAr ? ArrowRight : ArrowLeft;

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[var(--bg-primary)]">
      {/* Brand & Trust Panel (50% width on desktop) */}
      <div
        className={`lg:w-1/2 relative overflow-hidden bg-gradient-to-br ${brandGradient} text-white p-6 sm:p-10 lg:p-14 flex flex-col justify-between min-h-[340px] lg:min-h-screen`}
      >
        {/* Decorative subtle grid/glow */}
        <div
          className="pointer-events-none absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.45) 0, transparent 45%), radial-gradient(circle at 80% 75%, rgba(16,185,129,0.45) 0, transparent 50%)",
          }}
        />

        {/* Top Bar inside Brand Panel */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 text-xs font-bold transition"
          >
            <BackArrow className="w-4 h-4" />
            <span>{isAr ? "العودة للصفحة الرئيسية العامة" : "Back to Public Landing Page"}</span>
          </button>

          <button
            type="button"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold transition"
          >
            <Globe2 className="w-3.5 h-3.5" />
            <span>{isAr ? "English" : "العربية"}</span>
          </button>
        </div>

        {/* Center Enterprise Identity & Trust Indicators */}
        <div className="relative z-10 my-8 lg:my-0 space-y-6 max-w-xl">
          <div className="flex items-center gap-4">
            <DualLogoBadge
              profile={enterpriseProfile}
              logoText={logoText}
              size="lg"
              onDark
            />
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-bold mb-1.5">
                {offlineMode ? (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-300" />
                    <span>{isAr ? "وضع الميدان المحلي (Offline PWA)" : "Offline Field PWA Mode"}</span>
                  </>
                ) : (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-300" />
                    <span>{isAr ? "النظام متصل ومتزامن لحظياً" : "Live System Online & Synced"}</span>
                  </>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-black leading-tight">
                {isAr
                  ? enterpriseProfile?.legalNameAr || "المؤسسة الزراعية الموحدة للاستثمار"
                  : enterpriseProfile?.legalNameEn || "Unified Agricultural Investment Enterprise"}
              </h1>
            </div>
          </div>

          <p className="text-sm sm:text-base text-white/85 leading-relaxed">
            {isAr
              ? "منصة النظام المحاسبي الموحد (UAS Enterprise ERP) — حوكمة مالية متكاملة بصلاحيات 7 أدوار وظيفية، شجرة حسابات خماسية المستويات، ومراقبة فورية لتكاليف المشاريع والقطفات."
              : "Unified Accounting System (UAS Enterprise ERP) — 7-role RBAC governance, 5-tier Chart of Accounts, multi-currency treasury, and real-time project & harvest cost control."}
          </p>

          {/* Integrity Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-4 space-y-1">
              <div className="flex items-center gap-2 text-emerald-200 text-xs font-extrabold">
                <ShieldCheck className="w-4 h-4" />
                <span>{isAr ? "سلامة القيد المزدوج" : "Double-Entry Ledger Integrity"}</span>
              </div>
              <div className="text-lg font-black font-mono tracking-tight">Σ DR = Σ CR (100%)</div>
              <p className="text-[11px] text-white/75">
                {isAr
                  ? "ترحيل ذري على المستوى الخامس فقط مع سجل تدقيق SHA-256"
                  : "Atomic Tier-5 posting with immutable SHA-256 audit trail"}
              </p>
            </div>

            <div className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-4 space-y-1">
              <div className="flex items-center gap-2 text-cyan-200 text-xs font-extrabold">
                <CheckCircle2 className="w-4 h-4" />
                <span>{isAr ? "حوكمة الصلاحيات (RBAC)" : "Enterprise RBAC Matrix"}</span>
              </div>
              <div className="text-lg font-black">
                {isAr ? "7 أدوار تخصصية" : "7 Specialized Roles"}
              </div>
              <p className="text-[11px] text-white/75">
                {isAr
                  ? "عزل مهام المشتريات والمبيعات والميدان والرقابة الخارجية"
                  : "Segregation of duties across procurement, sales, field, and audit"}
              </p>
            </div>
          </div>
        </div>

        {/* Footer Metadata */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/70 border-t border-white/15 pt-4">
          <span>
            {enterpriseProfile?.commercialReg || "CR-YE-2026-8841"} •{" "}
            {isAr ? "الرقم الضريبي:" : "Tax ID:"} {enterpriseProfile?.taxNumber || "30049811200003"}
          </span>
          <span>Unified Accounting System v2.0</span>
        </div>
      </div>

      {/* Auth Form Panel (50% width on desktop) */}
      <div className="lg:w-1/2 flex items-center justify-center p-5 sm:p-8 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-lg space-y-6">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full accent-badge text-[11px] font-extrabold">
              <Lock className="w-3.5 h-3.5" />
              <span>{isAr ? "بوابة الدخول الآمن للموظفين" : "Enterprise Staff Authentication"}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black">
              {isAr ? "تسجيل الدخول إلى النظام" : "Sign in to UAS ERP"}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              {isAr
                ? "أدخل البريد الإلكتروني أو اسم المستخدم وكلمة المرور، أو استخدم محوّل الأدوار التجريبي بالأسفل."
                : "Enter your work email or username and password, or use the Quick Role Demo Switcher below."}
            </p>
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

          <form onSubmit={handleFormSubmit} className="card-surface rounded-3xl p-6 shadow-sm space-y-4">
            <div>
              <label
                htmlFor="loginIdentifierInput"
                className="block text-xs font-extrabold mb-1.5"
              >
                {isAr ? "البريد الإلكتروني أو اسم المستخدم" : "Email or Username"}
              </label>
              <input
                id="loginIdentifierInput"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin@uas-ye.com / admin"
                autoComplete="username"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>

            <div>
              <label htmlFor="loginPasswordInput" className="block text-xs font-extrabold mb-1.5">
                {isAr ? "كلمة المرور" : "Password"}
              </label>
              <div className="relative">
                <input
                  id="loginPasswordInput"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent px-3.5 py-2.5 pe-11 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 end-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none font-semibold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <span>{isAr ? "تذكر هذا الجهاز" : "Remember device"}</span>
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {isAr ? "كلمة المرور الافتراضية: 123456" : "Default PIN: 123456"}
              </span>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl accent-bg font-extrabold text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-60 transition"
            >
              <KeyRound className="w-4 h-4" />
              <span>
                {submitting
                  ? isAr
                    ? "جاري التحقق والدخول..."
                    : "Signing in..."
                  : isAr
                  ? "تسجيل الدخول إلى لوحة التحكم"
                  : "Sign In to ERP"}
              </span>
            </button>
          </form>

          {/* Collapsible Quick Role Demo Switcher Drawer */}
          <div className="card-surface rounded-3xl overflow-hidden shadow-sm">
            <button
              type="button"
              onClick={() => setDemoDrawerOpen((prev) => !prev)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-extrabold bg-slate-50/80 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>
                  {isAr
                    ? "محوّل الأدوار التجريبي السريع (دخول بنقرة واحدة — 7 أدوار)"
                    : "Quick Role Demo Switcher (1-Click Sign-In — 7 Roles)"}
                </span>
              </span>
              {demoDrawerOpen ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {demoDrawerOpen && (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {activeUsers.map((u) => {
                  const meta = getRoleMeta(normalizeRole(u.role));
                  const isCurrent = u.id === currentUserId;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleQuickRoleSignIn(u)}
                      className={`group p-3 rounded-2xl border text-start transition flex items-start gap-3 hover:border-emerald-500 hover:shadow-sm ${
                        isCurrent
                          ? "border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20"
                          : "border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      <SvgAvatar char={u.avatarChar} size={36} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-extrabold text-xs truncate">{u.name}</span>
                          <UserCheck className="w-3.5 h-3.5 text-emerald-600 opacity-0 group-hover:opacity-100 transition shrink-0" />
                        </div>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${meta.badgeClass}`}
                        >
                          {isAr ? meta.labelAr : meta.shortEn}
                        </span>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {u.email}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Globe,
  Loader2,
  Lock,
  LogIn,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  safeFetchJson,
  setStoredSessionToken,
  setStoredTenantId,
} from "@/lib/apiClient";
import { SuperadminLicenseGeneratorPanel } from "@/components/SuperadminLicenseGeneratorPanel";

export default function SuperadminLicensesPage() {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";

  const [authState, setAuthState] = useState<
    "checking" | "authorized" | "unauthenticated" | "forbidden"
  >("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [actorEmail, setActorEmail] = useState<string>("");

  const [loginId, setLoginId] = useState("admin@qat.world");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const verifySession = useCallback(async () => {
    setAuthState("checking");
    setAuthError(null);
    const res = await safeFetchJson<{
      success?: boolean;
      actor?: { email?: string };
      error?: string;
    }>("/api/superadmin/licenses", {
      cache: "no-store",
      credentials: "include",
    });

    if (res.ok && res.data?.success) {
      setActorEmail(res.data.actor?.email || "admin@qat.world");
      setAuthState("authorized");
      return;
    }

    if (res.status === 401) {
      setAuthState("unauthenticated");
      return;
    }

    setAuthError(res.data?.error || (isAr ? "غير مصرح بالوصول" : "Access denied"));
    setAuthState("forbidden");
  }, [isAr]);

  useEffect(() => {
    void verifySession();
  }, [verifySession]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      setStoredTenantId("default");
      const res = await safeFetchJson<{
        sessionToken?: string;
        user?: { email?: string };
        error?: string;
      }>("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-uas-tenant-id": "default",
        },
        body: JSON.stringify({
          identifier: loginId.trim(),
          password: loginPassword,
        }),
      });

      if (!res.ok || !res.data?.sessionToken) {
        setLoginError(
          res.data?.error ||
            (isAr ? "بيانات الدخول غير صحيحة" : "Invalid credentials")
        );
        return;
      }

      setStoredSessionToken(res.data.sessionToken);
      setLoginPassword("");
      await verifySession();
    } finally {
      setLoginBusy(false);
    }
  }

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
    >
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-black text-sm sm:text-base truncate">
                {isAr ? "إدارة تراخيص المنصة (UAS)" : "UAS Superadmin Licenses"}
              </h1>
              <p className="text-[11px] text-slate-500 truncate" dir="ltr">
                {actorEmail || "qat.world"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setLang(isAr ? "en" : "ar")}
              className="min-h-[38px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{isAr ? "EN" : "عربي"}</span>
            </button>
            <Link
              href="/"
              className="min-h-[38px] px-3 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-800"
            >
              <ArrowRight className={`w-3.5 h-3.5 ${isAr ? "" : "rotate-180"}`} />
              <span>{isAr ? "النظام" : "ERP"}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-6 py-5 sm:py-8">
        {authState === "checking" && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <span>
              {isAr
                ? "جاري التحقق من صلاحيات مالك المنصة..."
                : "Verifying platform superadmin session..."}
            </span>
          </div>
        )}

        {authState === "unauthenticated" && (
          <div className="max-w-md mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2.5 text-emerald-700 dark:text-emerald-300 font-black text-base">
              <Lock className="w-5 h-5 shrink-0" />
              <span>
                {isAr ? "تسجيل دخول مالك المنصة" : "Platform Owner Sign In"}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isAr
                ? "سجّل الدخول بحساب مالك المنصة (admin@qat.world) للوصول إلى مولد التراخيص وتجهيز المنشآت."
                : "Sign in as the platform owner (admin@qat.world) to issue tenant licenses."}
            </p>
            <form onSubmit={handleLogin} className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">
                  {isAr ? "البريد الإلكتروني أو اسم المستخدم" : "Email or Username"}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">
                  {isAr ? "كلمة المرور" : "Password"}
                </label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
                />
              </div>
              {loginError && (
                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 p-2.5 text-xs text-rose-700 dark:text-rose-300">
                  {loginError}
                </div>
              )}
              <button
                type="submit"
                disabled={loginBusy}
                className="w-full min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loginBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                <span>{isAr ? "دخول" : "Sign In"}</span>
              </button>
            </form>
          </div>
        )}

        {authState === "forbidden" && (
          <div className="max-w-lg mx-auto rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-6 text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-rose-600 mx-auto" />
            <h2 className="font-black text-base text-rose-800 dark:text-rose-200">
              {isAr ? "الوصول محصور بمالك المنصة" : "Superadmin Access Restricted"}
            </h2>
            <p className="text-xs text-rose-700 dark:text-rose-300">{authError}</p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center justify-center min-h-[42px] px-4 rounded-xl bg-slate-900 text-white text-xs font-bold"
              >
                {isAr ? "العودة للصفحة الرئيسية" : "Return Home"}
              </Link>
            </div>
          </div>
        )}

        {authState === "authorized" && (
          <SuperadminLicenseGeneratorPanel
            lang={lang}
            onToast={showToast}
            showStandaloneLink={false}
          />
        )}
      </main>

      {toast && (
        <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:end-6 z-50 max-w-md rounded-xl bg-slate-900 text-white px-4 py-3 text-xs font-bold shadow-xl border border-slate-700">
          {toast}
        </div>
      )}
    </div>
  );
}

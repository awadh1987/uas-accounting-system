"use client";

import React, { useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Lock, LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { DualLogoBadge } from "@/components/DualLogoBadge";
import { safeFetchJson, setStoredSessionToken } from "@/lib/apiClient";
import { getRoleMeta } from "@/lib/permissions";
import type { LanguageCode, UasEnterpriseProfile, UasUser } from "@/types/uas";

interface ForcePasswordChangeModalProps {
  currentUser: UasUser;
  lang: LanguageCode;
  logoText: string;
  enterpriseProfile?: UasEnterpriseProfile;
  onPasswordChanged: (updatedUser: UasUser) => Promise<void> | void;
  onLogout: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

export function ForcePasswordChangeModal({
  currentUser,
  lang,
  logoText,
  enterpriseProfile,
  onPasswordChanged,
  onLogout,
  onToast,
}: ForcePasswordChangeModalProps) {
  const isAr = lang === "ar";
  const roleMeta = getRoleMeta(currentUser);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!currentPassword) {
      setErrorMsg(isAr ? "يرجى إدخال كلمة المرور المؤقتة / الحالية" : "Please enter your current/temporary password");
      return;
    }
    if (newPassword.trim().length < 6) {
      setErrorMsg(isAr ? "يجب أن تتكون كلمة المرور الجديدة من 6 أحرف أو أرقام على الأقل" : "New password must be at least 6 characters");
      return;
    }
    if (newPassword.trim() === currentPassword) {
      setErrorMsg(
        isAr
          ? "يجب أن تختلف كلمة المرور الجديدة عن كلمة المرور المؤقتة الحالية"
          : "New password must differ from your temporary password"
      );
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      setErrorMsg(isAr ? "كلمة المرور الجديدة وتأكيدها غير متطابقين" : "New password and confirmation do not match");
      return;
    }

    setSubmitting(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        message?: string;
        error?: string;
        mustChangePassword?: boolean;
        passwordUpdatedAt?: string;
        sessionToken?: string;
        user?: UasUser;
      }>("/api/users/me/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-uas-user-id": currentUser.id,
          "x-uas-role": String(currentUser.role),
        },
        body: JSON.stringify({
          currentPassword,
          newPassword: newPassword.trim(),
          confirmPassword: confirmPassword.trim(),
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.displayName || currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });

      if (!res.ok || !res.data?.success) {
        const msg =
          res.data?.error ||
          res.data?.message ||
          res.error ||
          (isAr ? "تعذر تحديث كلمة المرور" : "Failed to update password");
        setErrorMsg(msg);
        onToast(msg);
        return;
      }

      if (res.data.sessionToken) {
        setStoredSessionToken(res.data.sessionToken);
      }

      const updatedUser: UasUser = res.data.user
        ? { ...res.data.user, mustChangePassword: false }
        : {
            ...currentUser,
            mustChangePassword: false,
            passwordUpdatedAt: res.data.passwordUpdatedAt || new Date().toISOString(),
          };

      onToast(
        res.data.message ||
          (isAr ? "✅ تم تحديث كلمة المرور بنجاح — مرحباً بك في النظام" : "✅ Password updated successfully")
      );
      await onPasswordChanged(updatedUser);
    } catch (err) {
      const msg = err instanceof Error ? err.message : isAr ? "تعذر الاتصال بالخادم" : "Network error";
      setErrorMsg(msg);
      onToast(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-testid="force-password-change-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-password-title"
      className="min-h-screen w-full flex items-center justify-center bg-slate-950/95 backdrop-blur-md p-4"
    >
      <div className="card-surface w-full max-w-md rounded-3xl p-6 sm:p-8 shadow-2xl border border-amber-300/60 dark:border-amber-700/50 space-y-5 text-xs">
        <div className="flex flex-col items-center text-center space-y-3">
          <DualLogoBadge profile={enterpriseProfile} logoText={logoText} size="md" />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-extrabold text-[11px]">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{isAr ? "إجراء أمني إلزامي" : "Mandatory Security Step"}</span>
          </div>
          <h1 id="force-password-title" className="text-lg font-black text-slate-900 dark:text-slate-100">
            {isAr ? "تعيين كلمة مرور جديدة قبل المتابعة" : "Set a New Password to Continue"}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {isAr
              ? "قامت الإدارة بإعادة تعيين كلمة مرورك مع إلزام التغيير فور تسجيل الدخول. لا يمكن فتح وحدات النظام قبل تعيين كلمة مرور خاصة بك."
              : "Your administrator requires you to change your temporary password before accessing the accounting workspace."}
          </p>
        </div>

        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
          <div>
            <div className="font-extrabold text-slate-900 dark:text-slate-100">
              {currentUser.displayName || currentUser.name}
            </div>
            <div className="text-[11px] font-mono text-slate-500">{currentUser.email}</div>
          </div>
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${roleMeta.badgeClass}`}>
            {isAr ? roleMeta.labelAr : roleMeta.labelEn}
          </span>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="forceCurrentPass" className="block font-extrabold mb-1 text-slate-700 dark:text-slate-300">
              {isAr ? "كلمة المرور المؤقتة / الحالية" : "Current / Temporary Password"}
            </label>
            <div className="relative">
              <input
                id="forceCurrentPass"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setErrorMsg(null);
                }}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 py-2.5 pe-10 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label="Toggle current password visibility"
                className="absolute inset-y-0 end-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="forceNewPass" className="block font-extrabold mb-1 text-slate-700 dark:text-slate-300">
              {isAr ? "كلمة المرور الجديدة (6 خانات على الأقل)" : "New Password (min 6 characters)"}
            </label>
            <div className="relative">
              <input
                id="forceNewPass"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setErrorMsg(null);
                }}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 py-2.5 pe-10 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label="Toggle new password visibility"
                className="absolute inset-y-0 end-0 px-3 flex items-center text-slate-400 hover:text-slate-600"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="forceConfirmPass" className="block font-extrabold mb-1 text-slate-700 dark:text-slate-300">
              {isAr ? "تأكيد كلمة المرور الجديدة" : "Confirm New Password"}
            </label>
            <input
              id="forceConfirmPass"
              type={showNew ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrorMsg(null);
              }}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 py-2.5 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            {confirmPassword && (
              <div
                className={`mt-1 text-[11px] font-bold flex items-center gap-1 ${
                  newPassword.trim() === confirmPassword.trim() ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {newPassword.trim() === confirmPassword.trim()
                    ? isAr
                      ? "كلمتا المرور متطابقتان"
                      : "Passwords match"
                    : isAr
                    ? "كلمتا المرور غير متطابقتين"
                    : "Passwords do not match"}
                </span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl accent-bg font-extrabold text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-60 transition"
          >
            {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            <span>
              {submitting
                ? isAr
                  ? "جاري تحديث كلمة المرور..."
                  : "Updating password..."
                : isAr
                ? "حفظ كلمة المرور والدخول للنظام"
                : "Save Password & Enter Workspace"}
            </span>
          </button>
        </form>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px]">
          <span className="text-slate-400 inline-flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-amber-500" />
            <span>{isAr ? "لا يمكن تخطي هذه الخطوة" : "Cannot be dismissed"}</span>
          </span>
          <button
            type="button"
            onClick={() => void onLogout()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 font-bold hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{isAr ? "تسجيل الخروج" : "Sign Out"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

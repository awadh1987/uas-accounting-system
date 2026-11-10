"use client";

import React, { useState } from "react";
import type { UasUser } from "@/types/uas";

interface LoginModalProps {
  open: boolean;
  users: UasUser[];
  logoText: string;
  currentUserId: string;
  onClose: () => void;
  onLoginSuccess: (user: UasUser) => void;
  onToast: (msg: string) => void;
  offlineMode: boolean;
}

export function LoginModal({
  open,
  users,
  logoText,
  currentUserId,
  onClose,
  onLoginSuccess,
  onToast,
  offlineMode,
}: LoginModalProps) {
  const activeUsers = users.filter((u) => u.active);
  const [selectedUserId, setSelectedUserId] = useState(
    currentUserId || activeUsers[0]?.id || ""
  );
  const [password, setPassword] = useState("123456");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetId = selectedUserId || activeUsers[0]?.id;
    const localUser = users.find((u) => u.id === targetId);
    if (!localUser) return;

    if (offlineMode || (typeof navigator !== "undefined" && !navigator.onLine)) {
      onLoginSuccess(localUser);
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: targetId, password }),
      });
      const data = (await res.json()) as { user?: UasUser; error?: string };
      if (!res.ok || !data.user) {
        onToast(data.error || "كلمة المرور غير صحيحة");
        return;
      }
      onLoginSuccess(data.user);
      onClose();
    } catch {
      onLoginSuccess(localUser);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print">
      <form
        onSubmit={handleSubmit}
        className="card-surface rounded-2xl max-w-md w-full p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl accent-bg flex items-center justify-center font-bold text-xl">
              {logoText || "UAS"}
            </div>
            <div>
              <h2 className="text-lg font-bold">تسجيل الدخول للنظام المحاسبي الموحد</h2>
              <p className="text-xs text-slate-500">Unified Accounting System (UAS)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold text-lg px-2"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1">
              اختر المستخدم / Select User
            </label>
            <select
              value={selectedUserId || activeUsers[0]?.id || ""}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm"
            >
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">
              كلمة المرور / Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-xl accent-bg font-bold text-sm shadow disabled:opacity-60"
          >
            {submitting ? "جاري التحقق..." : "دخول / Sign In"}
          </button>
        </div>
      </form>
    </div>
  );
}


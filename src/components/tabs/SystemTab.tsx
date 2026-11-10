"use client";

import React, { useState } from "react";
import { SvgAvatar } from "@/components/SvgAvatar";
import type { LanguageCode, ThemeName, UasSystemSettings, UasUser } from "@/types/uas";

interface SystemTabProps {
  settings: UasSystemSettings;
  lang: LanguageCode;
  theme: ThemeName;
  currentUser: UasUser;
  users: UasUser[];
  onSaveBranding: (orgName: string, logoText: string) => Promise<void>;
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

export function SystemTab({
  settings,
  lang,
  theme,
  currentUser,
  users,
  onSaveBranding,
  onChangeLang,
  onChangeTheme,
  onUpdateProfile,
  onAddUser,
  onToggleUserStatus,
  onOpenLogin,
  onToast,
}: SystemTabProps) {
  const [orgNameDraft, setOrgNameDraft] = useState<string | null>(null);
  const [logoTextDraft, setLogoTextDraft] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState<string | null>(null);
  const [profileAvatarDraft, setProfileAvatarDraft] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("مدير النظام (Admin)");

  const orgName = orgNameDraft ?? settings.orgName;
  const logoText = logoTextDraft ?? settings.logoText;
  const profileName = profileNameDraft ?? currentUser.name;
  const profileAvatarChar = profileAvatarDraft ?? currentUser.avatarChar;

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
            className="w-full py-2.5 rounded-xl accent-bg font-bold"
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
              className="w-full py-2 rounded-xl border border-emerald-600 text-emerald-600 font-bold"
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
              <option value="مدير النظام (Admin)">مدير النظام (Admin)</option>
              <option value="محاسب رئيسي (Accountant)">محاسب رئيسي (Accountant)</option>
              <option value="مدير مشاريع (Project Manager)">مدير مشاريع (Project Manager)</option>
              <option value="مدقق حسابات (Auditor)">مدقق حسابات (Auditor)</option>
            </select>
            <button type="submit" className="rounded-lg accent-bg font-bold py-1.5 px-3">
              + إضافة مستخدم
            </button>
          </form>

          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">الصورة</th>
                <th className="p-2.5">اسم المستخدم</th>
                <th className="p-2.5">المعرف / البريد</th>
                <th className="p-2.5">الدور والصلاحية (User Role)</th>
                <th className="p-2.5">الحالة</th>
                <th className="p-2.5">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="p-2.5">
                    <SvgAvatar char={u.avatarChar} size={32} />
                  </td>
                  <td className="p-2.5 font-bold">{u.name}</td>
                  <td className="p-2.5 text-slate-500">{u.email}</td>
                  <td className="p-2.5">
                    <span className="accent-badge px-2 py-0.5 rounded font-semibold">
                      {u.role}
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
                      className="text-xs font-bold text-indigo-600 hover:underline"
                    >
                      تغيير الحالة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


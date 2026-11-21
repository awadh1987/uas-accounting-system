"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  Globe2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
} from "lucide-react";
import { safeFetchJson } from "@/lib/apiClient";
import type { UasTenantAdminConfig, UasUser } from "@/types/uas";

interface TenantAdminConfigPanelProps {
  lang: "ar" | "en";
  currentUser: UasUser;
  readOnly?: boolean;
  onRefreshState?: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

export function TenantAdminConfigPanel({
  lang,
  currentUser,
  readOnly = false,
  onRefreshState,
  onToast,
}: TenantAdminConfigPanelProps) {
  const isAr = lang === "ar";
  const [config, setConfig] = useState<UasTenantAdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await safeFetchJson<{ success?: boolean; config?: UasTenantAdminConfig }>(
        "/api/tenant/config",
        { cache: "no-store" }
      );
      if (res.ok && res.data?.config) {
        setConfig(res.data.config);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!config || readOnly) return;
    setSaving(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        config?: UasTenantAdminConfig;
        error?: string;
      }>("/api/tenant/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-uas-user-id": currentUser.id,
          "x-uas-role": String(currentUser.role),
          "x-uas-user-display": `${currentUser.name} (${currentUser.role})`,
        },
        body: JSON.stringify({
          ...config,
          actor: {
            userId: currentUser.id,
            userDisplay: `${currentUser.name} (${currentUser.role})`,
            userRole: currentUser.role,
          },
        }),
      });
      if (!res.ok || !res.data?.success) {
        onToast(
          res.data?.error ||
            (isAr ? "تعذر حفظ إعدادات مساحة المنشأة" : "Failed to save tenant configuration")
        );
        return;
      }
      if (res.data.config) setConfig(res.data.config);
      onToast(
        isAr
          ? "✅ تم حفظ إعدادات مساحة المنشأة والنطاق الفرعي بنجاح"
          : "✅ Tenant workspace configuration saved successfully"
      );
      await onRefreshState?.();
    } finally {
      setSaving(false);
    }
  }

  if (loading && !config) {
    return (
      <div className="card-surface rounded-2xl p-6 text-xs text-slate-500">
        {isAr ? "جاري تحميل إعدادات إدارة المنشأة..." : "Loading tenant workspace configuration..."}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="card-surface rounded-2xl p-6 text-xs text-rose-600">
        {isAr ? "تعذر تحميل إعدادات المنشأة." : "Unable to load tenant configuration."}
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 text-xs">
      {/* Subdomain Workspace Banner */}
      <div className="card-surface rounded-2xl p-5 border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-black text-sm text-emerald-800 dark:text-emerald-300">
            <Building2 className="w-4 h-4" />
            <span>
              {isAr
                ? "استوديو إعدادات مساحة المنشأة المستقلة (Tenant Admin Config)"
                : "Tenant Workspace Configuration Studio"}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            {isAr
              ? "كافة الإعدادات أدناه معزولة تماماً ومقتصرة على نطاق هذه المنشأة دون أي تأثير على المنشآت الأخرى."
              : "All branding, localization, approval, and sync rules below are strictly scoped to this tenant workspace."}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-emerald-300 dark:border-emerald-800">
          <Globe2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="font-mono text-[11px] font-bold" dir="ltr">
            {config.tenantUrl}
          </div>
          <button
            type="button"
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(config.tenantUrl).catch(() => {});
              }
              setCopiedUrl(true);
              setTimeout(() => setCopiedUrl(false), 1800);
            }}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            title={isAr ? "نسخ رابط المنشأة" : "Copy Tenant URL"}
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Branding & Portal Landing */}
        <div className="card-surface rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 font-black text-sm border-b border-slate-200 dark:border-slate-700 pb-2">
            <Globe2 className="w-4 h-4 text-emerald-600" />
            <span>
              {isAr
                ? "بوابة الدخول والترحيب المخصصة للمنشأة"
                : "Branded Tenant Landing & Portal Notice"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "اسم المنشأة (عربي)" : "Legal Name (Arabic)"}
              </label>
              <input
                type="text"
                value={config.legalNameAr}
                onChange={(e) => setConfig({ ...config, legalNameAr: e.target.value })}
                disabled={readOnly}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "اسم المنشأة (إنجليزي)" : "Legal Name (English)"}
              </label>
              <input
                type="text"
                value={config.legalNameEn}
                onChange={(e) => setConfig({ ...config, legalNameEn: e.target.value })}
                disabled={readOnly}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "لون الهوية" : "Brand Accent Color"}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={config.brandColor || "#059669"}
                  onChange={(e) => setConfig({ ...config, brandColor: e.target.value })}
                  disabled={readOnly}
                  className="h-9 w-12 rounded-lg border border-slate-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={config.brandColor}
                  onChange={(e) => setConfig({ ...config, brandColor: e.target.value })}
                  disabled={readOnly}
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "بريد الدعم الفني للمنشأة" : "Support Email"}
              </label>
              <input
                type="email"
                value={config.supportEmail}
                onChange={(e) => setConfig({ ...config, supportEmail: e.target.value })}
                disabled={readOnly}
                placeholder="support@company.qat.world"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">
              {isAr ? "إشعار الترحيب / الامتثال على صفحة الدخول (عربي)" : "Welcome / Compliance Notice (Arabic)"}
            </label>
            <textarea
              rows={2}
              value={config.welcomeNoticeAr}
              onChange={(e) => setConfig({ ...config, welcomeNoticeAr: e.target.value })}
              disabled={readOnly}
              placeholder={isAr ? "مثال: بوابة الموظفين المعتمدة — جميع العمليات مسجلة في سجل التدقيق..." : ""}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>

          <div>
            <label className="block font-bold mb-1">
              {isAr ? "إشعار الترحيب / الامتثال (إنجليزي)" : "Welcome / Compliance Notice (English)"}
            </label>
            <textarea
              rows={2}
              value={config.welcomeNoticeEn}
              onChange={(e) => setConfig({ ...config, welcomeNoticeEn: e.target.value })}
              disabled={readOnly}
              placeholder="Authorized personnel portal — all ledger entries are audit-logged."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">{isAr ? "هاتف التواصل" : "Contact Phone"}</label>
              <input
                type="text"
                value={config.contactPhone}
                onChange={(e) => setConfig({ ...config, contactPhone: e.target.value })}
                disabled={readOnly}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{isAr ? "واتساب الدعم" : "WhatsApp"}</label>
              <input
                type="text"
                value={config.contactWhatsApp}
                onChange={(e) => setConfig({ ...config, contactWhatsApp: e.target.value })}
                disabled={readOnly}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={config.showPublicVerify}
                onChange={(e) => setConfig({ ...config, showPublicVerify: e.target.checked })}
                disabled={readOnly}
              />
              <span>{isAr ? "إظهار التحقق العام QR" : "Show Public QR Verification"}</span>
            </label>
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={config.showPublicMetrics}
                onChange={(e) => setConfig({ ...config, showPublicMetrics: e.target.checked })}
                disabled={readOnly}
              />
              <span>{isAr ? "إظهار مؤشرات البوابة العامة" : "Show Public Portal Metrics"}</span>
            </label>
          </div>
        </div>

        {/* Fiscal, Approval & Sync/Device Policies */}
        <div className="card-surface rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 font-black text-sm border-b border-slate-200 dark:border-slate-700 pb-2">
            <Sliders className="w-4 h-4 text-indigo-600" />
            <span>
              {isAr
                ? "قواعد التشغيل والمزامنة وحوكمة الأجهزة"
                : "Fiscal, Approval, Sync & Device Policies"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">{isAr ? "اللغة الافتراضية" : "Default Language"}</label>
              <select
                value={config.defaultLang}
                onChange={(e) =>
                  setConfig({ ...config, defaultLang: e.target.value === "en" ? "en" : "ar" })
                }
                disabled={readOnly}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              >
                <option value="ar">العربية (RTL)</option>
                <option value="en">English (LTR)</option>
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">{isAr ? "العملة الأساسية" : "Base Currency"}</label>
              <select
                value={config.defaultCurrency}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    defaultCurrency: e.target.value as UasTenantAdminConfig["defaultCurrency"],
                  })
                }
                disabled={readOnly}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              >
                <option value="YER">YER</option>
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "تاريخ قفل الفترة المحاسبية" : "Period Lock Date"}
              </label>
              <input
                type="date"
                value={config.periodLockDate || ""}
                onChange={(e) => setConfig({ ...config, periodLockDate: e.target.value || null })}
                disabled={readOnly}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.requireApprovalWorkflow}
                  onChange={(e) =>
                    setConfig({ ...config, requireApprovalWorkflow: e.target.checked })
                  }
                  disabled={readOnly}
                />
                <span>
                  {isAr ? "إلزام مسار الاعتماد المسبق" : "Require Approval Workflow"}
                </span>
              </label>
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-3">
            <div className="font-extrabold text-indigo-800 dark:text-indigo-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isAr ? "سياسات المزامنة والأجهزة الطرفية" : "Sync & Device Governance Policies"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold mb-1">
                  {isAr ? "نمط المزامنة الافتراضي للأجهزة" : "Default Device Sync Mode"}
                </label>
                <select
                  value={config.defaultDeviceSyncMode}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      defaultDeviceSyncMode: e.target.value === "MANUAL" ? "MANUAL" : "AUTO",
                    })
                  }
                  disabled={readOnly}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                >
                  <option value="AUTO">{isAr ? "تلقائي + يدوي (AUTO)" : "Automatic + Manual (AUTO)"}</option>
                  <option value="MANUAL">{isAr ? "يدوي فقط (MANUAL)" : "Manual Only (MANUAL)"}</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">
                  {isAr ? "فترة المزامنة التلقائية (ثانية)" : "Auto-Sync Interval (sec)"}
                </label>
                <input
                  type="number"
                  min={15}
                  max={3600}
                  value={config.autoSyncIntervalSec}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      autoSyncIntervalSec: Math.max(15, Number(e.target.value) || 60),
                    })
                  }
                  disabled={readOnly}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-1">
              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoSyncEnabled}
                  onChange={(e) => setConfig({ ...config, autoSyncEnabled: e.target.checked })}
                  disabled={readOnly}
                />
                <span>{isAr ? "تفعيل المزامنة التلقائية بالخلفية" : "Enable Background Auto-Sync"}</span>
              </label>

              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.requireDeviceApproval}
                  onChange={(e) =>
                    setConfig({ ...config, requireDeviceApproval: e.target.checked })
                  }
                  disabled={readOnly}
                />
                <span>
                  {isAr ? "اشتراط اعتماد المشرف للأجهزة الجديدة" : "Require Admin Approval for New Devices"}
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void loadConfig()}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isAr ? "تحديث" : "Reload"}</span>
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-xl accent-bg font-black shadow inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            <span>
              {saving
                ? isAr
                  ? "جاري الحفظ..."
                  : "Saving..."
                : isAr
                ? "حفظ إعدادات مساحة المنشأة"
                : "Save Tenant Config"}
            </span>
          </button>
        </div>
      )}
    </form>
  );
}

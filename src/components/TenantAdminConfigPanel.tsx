"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  Globe2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sliders,
  Upload,
} from "lucide-react";
import { safeFetchJson, sanitizeHeaderValue } from "@/lib/apiClient";
import {
  DEFAULT_TAGLINE_AR,
  DEFAULT_TAGLINE_EN,
  resolveEffectiveBrandInfo,
} from "@/lib/branding";
import { PhoneContactInput } from "@/components/PhoneContactInput";
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
    let active = true;
    safeFetchJson<{ success?: boolean; config?: UasTenantAdminConfig }>("/api/tenant/config", {
      cache: "no-store",
    })
      .then((res) => {
        if (active && res.ok && res.data?.config) {
          setConfig(res.data.config);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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
          "x-uas-user-display": sanitizeHeaderValue(`${currentUser.name} (${currentUser.role})`),
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

  async function handleUploadAsset(kind: "logo" | "favicon", file?: File) {
    if (!file || !config || readOnly) return;
    if (file.size > 1024 * 1024) {
      onToast(isAr ? "حجم الملف يجب أن لا يتجاوز 1 ميجابايت" : "File must be <= 1 MB");
      return;
    }
    const formData = new FormData();
    formData.append("kind", kind);
    formData.append("file", file);
    formData.append(
      "actor",
      JSON.stringify({
        userId: currentUser.id,
        userDisplay: `${currentUser.name} (${currentUser.role})`,
        userRole: currentUser.role,
      })
    );
    setSaving(true);
    try {
      const res = await fetch("/api/system/branding/upload", {
        method: "POST",
        headers: {
          "x-uas-user-id": currentUser.id,
          "x-uas-role": String(currentUser.role),
          "x-uas-user-display": sanitizeHeaderValue(`${currentUser.name} (${currentUser.role})`),
        },
        body: formData,
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        assetUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.success || !data.assetUrl) {
        onToast(data.error || (isAr ? "تعذر رفع الملف" : "Upload failed"));
        return;
      }
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              ...(kind === "logo" ? { logoUrl: data.assetUrl } : { faviconUrl: data.assetUrl }),
            }
          : prev
      );
      onToast(
        kind === "favicon"
          ? isAr
            ? "✅ تم تحديث أيقونة التبويب (Favicon) بنجاح"
            : "✅ Tenant favicon updated"
          : isAr
          ? "✅ تم تحديث شعار المنشأة بنجاح"
          : "✅ Tenant logo updated"
      );
      await onRefreshState?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDefaultBranding() {
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
          "x-uas-user-display": sanitizeHeaderValue(`${currentUser.name} (${currentUser.role})`),
        },
        body: JSON.stringify({
          resetToDefaultBrand: true,
          actor: {
            userId: currentUser.id,
            userDisplay: `${currentUser.name} (${currentUser.role})`,
            userRole: currentUser.role,
          },
        }),
      });
      if (res.ok && res.data?.config) {
        setConfig(res.data.config);
        onToast(
          isAr
            ? "✅ تمت استعادة هوية UAS الافتراضية"
            : "✅ Restored default UAS branding"
        );
        await onRefreshState?.();
      }
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
                {isAr ? "الوصف التعريفي أسفل الاسم (عربي)" : "Brand Subtitle / Tagline (Arabic)"}
              </label>
              <input
                type="text"
                value={config.taglineAr ?? ""}
                onChange={(e) => setConfig({ ...config, taglineAr: e.target.value })}
                disabled={readOnly}
                placeholder={DEFAULT_TAGLINE_AR}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">
                {isAr ? "الوصف التعريفي أسفل الاسم (إنجليزي)" : "Brand Subtitle / Tagline (English)"}
              </label>
              <input
                type="text"
                value={config.taglineEn ?? ""}
                onChange={(e) => setConfig({ ...config, taglineEn: e.target.value })}
                disabled={readOnly}
                placeholder={DEFAULT_TAGLINE_EN}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          {(() => {
            const brandPreview = resolveEffectiveBrandInfo(
              {
                legalNameAr: config.legalNameAr,
                legalNameEn: config.legalNameEn,
                logoUrl: config.logoUrl,
                faviconUrl: config.faviconUrl,
                tenantSlug: config.slug,
              },
              config.slug
            );
            return (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={brandPreview.effectiveLogoUrl}
                      alt="Tenant Logo"
                      className="w-7 h-7 rounded-lg object-contain bg-white border border-slate-200 p-0.5"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={brandPreview.effectiveFaviconUrl}
                      alt="Tenant Favicon"
                      className="w-5 h-5 rounded object-contain bg-white border border-slate-200 p-0.5"
                    />
                    <span className="text-[11px] font-mono text-slate-500" dir="ltr">
                      {brandPreview.tabTitleEn}
                    </span>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => void handleResetDefaultBranding()}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold inline-flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{isAr ? "استعادة UAS" : "Reset UAS"}</span>
                    </button>
                  )}
                </div>
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    <label className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isAr ? "رفع شعار المنشأة" : "Upload Logo"}</span>
                      <input
                        type="file"
                        accept="image/*,.svg"
                        className="hidden"
                        onChange={(e) => void handleUploadAsset("logo", e.target.files?.[0])}
                      />
                    </label>
                    <label className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isAr ? "رفع أيقونة التبويب (Favicon)" : "Upload Favicon"}</span>
                      <input
                        type="file"
                        accept="image/*,.ico,.svg"
                        className="hidden"
                        onChange={(e) => void handleUploadAsset("favicon", e.target.files?.[0])}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })()}

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">{isAr ? "هاتف التواصل" : "Contact Phone"}</label>
              <PhoneContactInput
                isAr={isAr}
                value={config.contactPhone}
                onChange={(val) => setConfig({ ...config, contactPhone: val })}
                disabled={readOnly}
                placeholder="+967 770 000 000"
                inputClassName="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">{isAr ? "واتساب الدعم" : "WhatsApp"}</label>
              <PhoneContactInput
                isAr={isAr}
                format="whatsapp_digits"
                value={config.contactWhatsApp}
                onChange={(val) => setConfig({ ...config, contactWhatsApp: val })}
                disabled={readOnly}
                placeholder="967770000000"
                inputClassName="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono text-right"
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

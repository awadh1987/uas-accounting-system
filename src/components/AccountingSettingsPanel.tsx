"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Calendar, FileText, Lock, RefreshCw, Save, Settings2 } from "lucide-react";
import { safeFetchJson } from "@/lib/apiClient";
import {
  DEFAULT_ACCOUNTING_SETTINGS,
  type AccountingSettingsConfig,
  type ControlAccountsMap,
  type DocumentSequenceKey,
} from "@/lib/accountingSettings";

interface AccountingSettingsPanelProps {
  lang?: "ar" | "en";
  readOnly?: boolean;
  onToast: (msg: string) => void;
}

const CONTROL_ACCOUNT_LABELS: Array<{ key: keyof ControlAccountsMap; labelAr: string; labelEn: string }> = [
  { key: "cashAccount", labelAr: "حساب الصندوق الافتراضي", labelEn: "Default Cash Account" },
  { key: "arAccount", labelAr: "حساب الذمم المدينة (العملاء)", labelEn: "Accounts Receivable (AR)" },
  { key: "apAccount", labelAr: "حساب الذمم الدائنة (الموردون)", labelEn: "Accounts Payable (AP)" },
  { key: "salesAccount", labelAr: "حساب إيرادات المبيعات", labelEn: "Sales Revenue Account" },
  { key: "salesReturnsAccount", labelAr: "حساب مردودات المبيعات", labelEn: "Sales Returns Account" },
  { key: "cogsAccount", labelAr: "حساب تكلفة البضاعة المباعة (COGS)", labelEn: "Cost of Goods Sold (COGS)" },
  { key: "inventoryAssetAccount", labelAr: "حساب أصل المخزون", labelEn: "Inventory Asset Account" },
  { key: "inventoryShrinkageAccount", labelAr: "حساب العجز والتالف المخزني", labelEn: "Inventory Shrinkage Account" },
  { key: "realizedFxGainAccount", labelAr: "أرباح فروق عملة محققة", labelEn: "Realized FX Gain Account" },
  { key: "realizedFxLossAccount", labelAr: "خسائر فروق عملة محققة", labelEn: "Realized FX Loss Account" },
  { key: "unrealizedFxGainAccount", labelAr: "أرباح فروق عملة غير محققة", labelEn: "Unrealized FX Gain Account" },
  { key: "unrealizedFxLossAccount", labelAr: "خسائر فروق عملة غير محققة", labelEn: "Unrealized FX Loss Account" },
  { key: "fxRoundingAccount", labelAr: "حساب فروق التقريب", labelEn: "FX Rounding Account" },
  { key: "taxPayableAccount", labelAr: "ضريبة القيمة المضافة المستحقة", labelEn: "Tax Payable Account" },
  { key: "taxReceivableAccount", labelAr: "ضريبة المدخلات القابلة للاسترداد", labelEn: "Tax Receivable Account" },
  { key: "retainedEarningsAccount", labelAr: "حساب الأرباح المبقاة", labelEn: "Retained Earnings Account" },
];

const SEQUENCE_KEYS: Array<{ key: DocumentSequenceKey; labelAr: string; labelEn: string }> = [
  { key: "JV", labelAr: "القيود اليومية (JV)", labelEn: "Journal Vouchers (JV)" },
  { key: "RV", labelAr: "سندات القبض (RV)", labelEn: "Receipt Vouchers (RV)" },
  { key: "PV", labelAr: "سندات الصرف (PV)", labelEn: "Payment Vouchers (PV)" },
  { key: "INV", labelAr: "فواتير المبيعات (INV)", labelEn: "Sales Invoices (INV)" },
  { key: "BILL", labelAr: "فواتير المشتريات (BILL)", labelEn: "Vendor Bills (BILL)" },
  { key: "TRN", labelAr: "تحويلات الخزينة/المخازن (TRN)", labelEn: "Transfers (TRN)" },
];

export function AccountingSettingsPanel({
  lang = "ar",
  readOnly = false,
  onToast,
}: AccountingSettingsPanelProps) {
  const isAr = lang === "ar";
  const [config, setConfig] = useState<AccountingSettingsConfig>(
    structuredClone(DEFAULT_ACCOUNTING_SETTINGS)
  );
  const [customPrintLayout, setCustomPrintLayout] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await safeFetchJson<{ settings?: AccountingSettingsConfig }>("/api/system/settings");
      if (res.ok && res.data?.settings) {
        const s = res.data.settings;
        setConfig({
          ...DEFAULT_ACCOUNTING_SETTINGS,
          ...s,
          controlAccounts: { ...DEFAULT_ACCOUNTING_SETTINGS.controlAccounts, ...(s.controlAccounts || {}) },
          documentSequences: { ...DEFAULT_ACCOUNTING_SETTINGS.documentSequences, ...(s.documentSequences || {}) },
        });
        if (s.printLayout && !["A4", "80MM"].includes(s.printLayout)) {
          setCustomPrintLayout(s.printLayout);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const effectivePrint =
        config.printLayout === "OTHER"
          ? customPrintLayout.trim() || "A4"
          : config.printLayout;

      const res = await safeFetchJson<{ success?: boolean; settings?: AccountingSettingsConfig; error?: string }>(
        "/api/system/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...config,
            printLayout: effectivePrint,
          }),
        }
      );
      if (!res.ok || !res.data?.success) {
        onToast(res.data?.error || (isAr ? "تعذر حفظ الإعدادات المحاسبية" : "Failed to save accounting settings"));
        return;
      }
      onToast(
        isAr
          ? "تم حفظ الإعدادات المحاسبية والتشغيلية بنجاح"
          : "Accounting & operational settings saved successfully"
      );
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  const isStandardPrint = config.printLayout === "A4" || config.printLayout === "80MM";

  return (
    <form onSubmit={handleSave} className="space-y-5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Settings2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black">
              {isAr ? "الإعدادات المحاسبية والتشغيلية" : "Accounting & Operational Settings"}
            </h3>
            <p className="text-[11px] text-slate-500">
              {isAr
                ? "السنة المالية، تاريخ إقفال الفترة، الحسابات الرقابية، تسلسل المستندات وسياسات المخزون والطباعة"
                : "Fiscal year, period lock date, GL control accounts, document sequences, costing & print policies"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadSettings}
            disabled={loading}
            className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{isAr ? "تحديث" : "Reload"}</span>
          </button>
          {!readOnly && (
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl accent-bg font-black inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? (isAr ? "جاري الحفظ..." : "Saving...") : isAr ? "حفظ الإعدادات" : "Save Settings"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Section 1: Fiscal Year, Period Lock Date & Operational Policies */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 space-y-3">
        <div className="font-extrabold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
          <Calendar className="w-4 h-4 text-emerald-600" />
          <span>{isAr ? "السنة المالية وإقفال الفترة والسياسات التشغيلية" : "Fiscal Year, Period Lock & Operational Policies"}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="font-bold text-slate-600 dark:text-slate-300">
              {isAr ? "بداية السنة المالية" : "Fiscal Year Start"}
            </span>
            <input
              type="date"
              value={config.fiscalYearStart}
              onChange={(e) => setConfig({ ...config, fiscalYearStart: e.target.value })}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono"
            />
          </label>
          <label className="space-y-1">
            <span className="font-bold text-slate-600 dark:text-slate-300">
              {isAr ? "نهاية السنة المالية" : "Fiscal Year End"}
            </span>
            <input
              type="date"
              value={config.fiscalYearEnd}
              onChange={(e) => setConfig({ ...config, fiscalYearEnd: e.target.value })}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono"
            />
          </label>
          <label className="space-y-1">
            <span className="font-bold text-rose-700 dark:text-rose-400 inline-flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              <span>{isAr ? "تاريخ إقفال الفترة المحاسبية" : "Period Lock Date"}</span>
            </span>
            <input
              type="date"
              value={config.periodLockDate || ""}
              onChange={(e) => setConfig({ ...config, periodLockDate: e.target.value || null })}
              className="w-full rounded-xl border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 px-3 py-2 font-mono"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
          <label className="space-y-1">
            <span className="font-bold text-slate-600 dark:text-slate-300">
              {isAr ? "طريقة تسعير المخزون" : "Inventory Costing Method"}
            </span>
            <select
              value={config.costingMethod}
              onChange={(e) =>
                setConfig({
                  ...config,
                  costingMethod: e.target.value === "FIFO" ? "FIFO" : "WEIGHTED_AVERAGE",
                })
              }
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
            >
              <option value="WEIGHTED_AVERAGE">{isAr ? "المتوسط المرجح (Weighted Average)" : "Weighted Average"}</option>
              <option value="FIFO">{isAr ? "الوارد أولاً صادر أولاً (FIFO)" : "FIFO"}</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-600 dark:text-slate-300">
              {isAr ? "سياسة الرصيد المخزني السالب" : "Negative Stock Policy"}
            </span>
            <select
              value={config.negativeStockPolicy}
              onChange={(e) =>
                setConfig({
                  ...config,
                  negativeStockPolicy: e.target.value === "WARN" ? "WARN" : "BLOCK",
                })
              }
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
            >
              <option value="BLOCK">{isAr ? "منع الصرف بالسالب (BLOCK)" : "Block Negative Stock"}</option>
              <option value="WARN">{isAr ? "السماح مع تحذير (WARN)" : "Warn & Allow"}</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="font-bold text-slate-600 dark:text-slate-300">
              {isAr ? "تنسيق الطباعة الافتراضي" : "Default Print Format"}
            </span>
            <select
              value={isStandardPrint ? config.printLayout : "OTHER"}
              onChange={(e) => setConfig({ ...config, printLayout: e.target.value })}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
            >
              <option value="A4">{isAr ? "ورق رسمي A4" : "A4 Standard"}</option>
              <option value="80MM">{isAr ? "طابعة حرارية 80mm" : "80mm Thermal POS"}</option>
              <option value="OTHER">{isAr ? "أخرى / مخصص (Other)" : "Other / Custom"}</option>
            </select>
            {(!isStandardPrint || config.printLayout === "OTHER") && (
              <input
                type="text"
                value={customPrintLayout}
                onChange={(e) => setCustomPrintLayout(e.target.value)}
                placeholder={isAr ? "مثلاً: A5 أو 58mm" : "e.g. A5 or 58mm"}
                className="w-full mt-1 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
              />
            )}
          </label>

          <label className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer self-end">
            <input
              type="checkbox"
              checked={config.requireApprovalWorkflow}
              onChange={(e) => setConfig({ ...config, requireApprovalWorkflow: e.target.checked })}
              className="rounded border-slate-400 text-emerald-600"
            />
            <span className="font-bold">
              {isAr ? "تفعيل مسار اعتماد القيود (Draft → Posted)" : "Require Approval Workflow (Draft → Posted)"}
            </span>
          </label>
        </div>
      </div>

      {/* Section 2: Document Auto-Numbering Sequences */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 space-y-3">
        <div className="font-extrabold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
          <FileText className="w-4 h-4 text-indigo-600" />
          <span>{isAr ? "تسلسل الترقيم التلقائي للمستندات" : "Document Auto-Numbering Sequences"}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {SEQUENCE_KEYS.map(({ key, labelAr, labelEn }) => {
            const seq = config.documentSequences[key];
            return (
              <div
                key={key}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2"
              >
                <div className="font-bold">{isAr ? labelAr : labelEn}</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={seq.prefix}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        documentSequences: {
                          ...config.documentSequences,
                          [key]: { ...seq, prefix: e.target.value },
                        },
                      })
                    }
                    className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono font-bold"
                    placeholder="Prefix"
                  />
                  <input
                    type="number"
                    min="1"
                    value={seq.nextNumber}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        documentSequences: {
                          ...config.documentSequences,
                          [key]: { ...seq, nextNumber: Math.max(1, Number(e.target.value) || 1) },
                        },
                      })
                    }
                    className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
                    placeholder="Next #"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Default GL Control Accounts Mapping */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 space-y-3">
        <div className="font-extrabold text-slate-700 dark:text-slate-200">
          {isAr ? "ربط الحسابات الرقابية الافتراضية في الدليل المحاسبي (GL Control Accounts)" : "Default GL Control Accounts Mapping"}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {CONTROL_ACCOUNT_LABELS.map(({ key, labelAr, labelEn }) => (
            <label key={key} className="space-y-1">
              <span className="font-bold text-[11px] text-slate-600 dark:text-slate-300">
                {isAr ? labelAr : labelEn}
              </span>
              <input
                type="text"
                value={config.controlAccounts[key] || ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    controlAccounts: {
                      ...config.controlAccounts,
                      [key]: e.target.value.trim(),
                    },
                  })
                }
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono font-bold"
              />
            </label>
          ))}
        </div>
      </div>
    </form>
  );
}

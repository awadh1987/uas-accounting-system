"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Coins, Plus, RefreshCw, Scale, CheckCircle2, ArrowRightLeft } from "lucide-react";
import { safeFetchJson } from "@/lib/apiClient";
import { fmtNum } from "@/lib/formulas";

interface CurrencyItem {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  symbol: string;
  decimalPlaces: number;
  isBaseCurrency: boolean;
  isCustom: boolean;
  isActive: boolean;
  latestRate: {
    buyRate: number;
    sellRate: number;
    midRate: number;
    rateDate: string;
  };
}

interface FxRevalRow {
  accountCode: string;
  accountNameAr: string;
  currencyCode: string;
  foreignBalance: number;
  bookedBaseBalance: number;
  spotRate: number;
  revaluedBaseBalance: number;
  unrealizedGain: number;
  unrealizedLoss: number;
}

interface FxRevalPreview {
  asOfDate?: string;
  rows: FxRevalRow[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netImpact: number;
}

interface MultiCurrencyFxPanelProps {
  lang?: "ar" | "en";
  readOnly?: boolean;
  onToast: (msg: string) => void;
}

export function MultiCurrencyFxPanel({
  lang = "ar",
  readOnly = false,
  onToast,
}: MultiCurrencyFxPanelProps) {
  const isAr = lang === "ar";
  const [currencies, setCurrencies] = useState<CurrencyItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Add / Custom Currency ("Other / Custom Currency") form state
  const [selectedPreset, setSelectedPreset] = useState<string>("USD");
  const [customCode, setCustomCode] = useState("");
  const [customNameAr, setCustomNameAr] = useState("");
  const [customNameEn, setCustomNameEn] = useState("");
  const [customSymbol, setCustomSymbol] = useState("");
  const [customDecimals, setCustomDecimals] = useState("2");
  const [buyRateInput, setBuyRateInput] = useState("");
  const [midRateInput, setMidRateInput] = useState("");
  const [sellRateInput, setSellRateInput] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  // Period-End Unrealized FX Revaluation
  const [revalPreview, setRevalPreview] = useState<FxRevalPreview | null>(null);
  const [loadingReval, setLoadingReval] = useState(false);
  const [postingReval, setPostingReval] = useState(false);

  const loadCurrencies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await safeFetchJson<{ currencies?: CurrencyItem[] }>("/api/accounting/currencies");
      if (res.ok && res.data?.currencies) {
        setCurrencies(res.data.currencies);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRevaluationPreview = useCallback(async () => {
    setLoadingReval(true);
    try {
      const res = await safeFetchJson<FxRevalPreview>("/api/accounting/fx-revaluation");
      if (res.ok && res.data) {
        setRevalPreview(res.data);
      }
    } finally {
      setLoadingReval(false);
    }
  }, []);

  useEffect(() => {
    loadCurrencies();
    loadRevaluationPreview();
  }, [loadCurrencies, loadRevaluationPreview]);

  async function handleSaveCurrencyOrRate(e: React.FormEvent) {
    e.preventDefault();
    setSavingRate(true);
    try {
      const isOther = selectedPreset === "OTHER";
      const code = (isOther ? customCode : selectedPreset).trim().toUpperCase();
      const midRate = Number(midRateInput || buyRateInput || sellRateInput);
      if (!code || !Number.isFinite(midRate) || midRate <= 0) {
        onToast(isAr ? "يرجى إدخال رمز العملة وسعر صرف صحيح (> 0)" : "Enter a valid currency code and rate (> 0)");
        return;
      }

      if (isOther) {
        const res = await safeFetchJson<{ success?: boolean; error?: string }>("/api/accounting/currencies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            nameAr: customNameAr.trim() || code,
            nameEn: customNameEn.trim() || customNameAr.trim() || code,
            symbol: customSymbol.trim() || code,
            decimalPlaces: Number(customDecimals) || 2,
            isCustom: true,
            buyRate: Number(buyRateInput || midRate),
            sellRate: Number(sellRateInput || midRate),
            midRate,
          }),
        });
        if (!res.ok || !res.data?.success) {
          onToast(res.data?.error || (isAr ? "تعذر إضافة العملة المخصصة" : "Failed to add custom currency"));
          return;
        }
        onToast(isAr ? `تمت إضافة العملة المخصصة (${code}) بنجاح` : `Custom currency (${code}) added`);
        setCustomCode("");
        setCustomNameAr("");
        setCustomNameEn("");
        setCustomSymbol("");
      } else {
        const res = await safeFetchJson<{ success?: boolean; error?: string }>("/api/accounting/exchange-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currencyCode: code,
            buyRate: Number(buyRateInput || midRate),
            sellRate: Number(sellRateInput || midRate),
            midRate,
          }),
        });
        if (!res.ok || !res.data?.success) {
          onToast(res.data?.error || (isAr ? "تعذر تحديث سعر الصرف" : "Failed to update exchange rate"));
          return;
        }
        onToast(isAr ? `تم تحديث سعر الصرف (${code} = ${midRate})` : `Updated rate (${code} = ${midRate})`);
      }

      setBuyRateInput("");
      setMidRateInput("");
      setSellRateInput("");
      await loadCurrencies();
      await loadRevaluationPreview();
    } finally {
      setSavingRate(false);
    }
  }

  async function handlePostRevaluation() {
    setPostingReval(true);
    try {
      const res = await safeFetchJson<{ success?: boolean; posted?: boolean; entryNumber?: string; message?: string; error?: string }>(
        "/api/accounting/fx-revaluation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: new Date().toISOString().slice(0, 10) }),
        }
      );
      if (!res.ok || !res.data?.success) {
        onToast(res.data?.error || (isAr ? "تعذر ترحيل قيد إعادة التقييم" : "Failed to post FX revaluation"));
        return;
      }
      onToast(
        res.data.posted
          ? isAr
            ? `تم ترحيل قيد إعادة التقييم المتوازن (${res.data.entryNumber})`
            : `Posted balanced FX revaluation journal (${res.data.entryNumber})`
          : res.data.message || (isAr ? "لا توجد فروق إعادة تقييم" : "No FX differences to post")
      );
      await loadRevaluationPreview();
    } finally {
      setPostingReval(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Currency & Daily Exchange Rate Manager */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">
                {isAr ? "إدارة العملات وأسعار الصرف اليومية" : "Currencies & Daily Exchange Rates"}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr
                  ? "العملات القياسية (YER / SAR / USD / AED / OMR) مع إمكانية إضافة أي عملة مخصصة"
                  : "Standard currencies (YER / SAR / USD / AED / OMR) + custom currencies via Other"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              loadCurrencies();
              loadRevaluationPreview();
            }}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{isAr ? "تحديث" : "Refresh"}</span>
          </button>
        </div>

        {/* Active Currencies Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {currencies.map((c) => (
            <div
              key={c.code}
              className={`p-3 rounded-xl border text-xs space-y-1 ${
                c.isBaseCurrency
                  ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20"
                  : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-black text-sm">{c.code}</span>
                {c.isBaseCurrency ? (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                    {isAr ? "عملة الأساس" : "BASE"}
                  </span>
                ) : c.isCustom ? (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-[10px] font-bold">
                    {isAr ? "مخصصة" : "CUSTOM"}
                  </span>
                ) : null}
              </div>
              <div className="font-bold text-slate-700 dark:text-slate-200">
                {c.nameAr} {c.symbol ? `(${c.symbol})` : ""}
              </div>
              <div className="text-[11px] font-mono text-slate-500 flex items-center justify-between pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                <span>{isAr ? "الوسط:" : "Mid:"}</span>
                <span className="font-black text-slate-800 dark:text-slate-100">
                  {fmtNum(c.latestRate?.midRate ?? 1)}
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                <span>{isAr ? `شراء: ${c.latestRate?.buyRate ?? 1}` : `Buy: ${c.latestRate?.buyRate ?? 1}`}</span>
                <span>{isAr ? `بيع: ${c.latestRate?.sellRate ?? 1}` : `Sell: ${c.latestRate?.sellRate ?? 1}`}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Update Rate OR Add Custom Currency Form */}
        {!readOnly && (
          <form
            onSubmit={handleSaveCurrencyOrRate}
            className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3 text-xs"
          >
            <div className="font-bold flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
              <ArrowRightLeft className="w-4 h-4 text-amber-600" />
              <span>
                {isAr
                  ? "تحديث سعر الصرف اليومي أو إضافة عملة أخرى مخصصة"
                  : "Update Daily Exchange Rate or Add Custom Currency"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
              >
                {currencies
                  .filter((c) => !c.isBaseCurrency)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.nameAr}
                    </option>
                  ))}
                <option value="OTHER">
                  {isAr ? "➕ عملة أخرى مخصصة (Other / Custom)" : "➕ Other / Custom Currency"}
                </option>
              </select>

              <input
                type="number"
                step="any"
                min="0"
                value={buyRateInput}
                onChange={(e) => setBuyRateInput(e.target.value)}
                placeholder={isAr ? "سعر الشراء (Buy)" : "Buy Rate"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono"
              />
              <input
                type="number"
                step="any"
                min="0"
                required
                value={midRateInput}
                onChange={(e) => setMidRateInput(e.target.value)}
                placeholder={isAr ? "السعر الوسطي (Mid) *" : "Mid Rate *"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono font-bold"
              />
              <input
                type="number"
                step="any"
                min="0"
                value={sellRateInput}
                onChange={(e) => setSellRateInput(e.target.value)}
                placeholder={isAr ? "سعر البيع (Sell)" : "Sell Rate"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono"
              />
              <button
                type="submit"
                disabled={savingRate}
                className="rounded-lg accent-bg font-black py-2 px-3 inline-flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {selectedPreset === "OTHER"
                    ? isAr
                      ? "إضافة العملة"
                      : "Add Currency"
                    : isAr
                    ? "حفظ السعر"
                    : "Save Rate"}
                </span>
              </button>
            </div>

            {selectedPreset === "OTHER" && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <input
                  type="text"
                  required
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                  placeholder={isAr ? "رمز العملة (مثلاً EUR, EGP) *" : "Currency Code (e.g. EUR) *"}
                  className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono font-bold uppercase"
                />
                <input
                  type="text"
                  required
                  value={customNameAr}
                  onChange={(e) => setCustomNameAr(e.target.value)}
                  placeholder={isAr ? "الاسم بالعربية (مثلاً يورو) *" : "Arabic Name *"}
                  className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-2"
                />
                <input
                  type="text"
                  value={customNameEn}
                  onChange={(e) => setCustomNameEn(e.target.value)}
                  placeholder={isAr ? "الاسم بالإنجليزية (Euro)" : "English Name"}
                  className="rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-2"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customSymbol}
                    onChange={(e) => setCustomSymbol(e.target.value)}
                    placeholder={isAr ? "الرمز (€)" : "Symbol (€)"}
                    className="w-1/2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                  />
                  <input
                    type="number"
                    min="0"
                    max="4"
                    value={customDecimals}
                    onChange={(e) => setCustomDecimals(e.target.value)}
                    placeholder={isAr ? "منازل عشرية" : "Decimals"}
                    className="w-1/2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono"
                  />
                </div>
              </div>
            )}
          </form>
        )}
      </div>

      {/* Period-End Unrealized FX Revaluation Panel */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">
                {isAr
                  ? "إعادة تقييم العملات الأجنبية نهاية الفترة (Unrealized FX Revaluation)"
                  : "Period-End Unrealized FX Revaluation"}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr
                  ? "معاينة الأرصدة المفتوحة بالعملات الأجنبية وترحيل قيد فروق التقييم المتوازن بضغطة واحدة"
                  : "Preview open foreign-currency balances at spot rates and post balanced revaluation journal"}
              </p>
            </div>
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={handlePostRevaluation}
              disabled={postingReval || loadingReval || !revalPreview?.rows?.length}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black inline-flex items-center gap-1.5 disabled:opacity-40 transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isAr ? "ترحيل قيد إعادة التقييم" : "Post Revaluation Journal"}</span>
            </button>
          )}
        </div>

        {revalPreview && revalPreview.rows.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-bold">
                  {isAr ? "أرباح غير محققة" : "Unrealized Gain"}
                </div>
                <div className="text-base font-black font-mono text-emerald-700 dark:text-emerald-300">
                  {fmtNum(revalPreview.totalUnrealizedGain)} YER
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
                <div className="text-[11px] text-rose-700 dark:text-rose-300 font-bold">
                  {isAr ? "خسائر غير محققة" : "Unrealized Loss"}
                </div>
                <div className="text-base font-black font-mono text-rose-700 dark:text-rose-300">
                  {fmtNum(revalPreview.totalUnrealizedLoss)} YER
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-600 dark:text-slate-300 font-bold">
                  {isAr ? "صافي الأثر" : "Net FX Impact"}
                </div>
                <div className="text-base font-black font-mono">
                  {fmtNum(revalPreview.netImpact)} YER
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <th className="p-2">{isAr ? "الحساب" : "Account"}</th>
                    <th className="p-2">{isAr ? "العملة" : "Currency"}</th>
                    <th className="p-2">{isAr ? "الرصيد الأجنبي" : "Foreign Bal."}</th>
                    <th className="p-2">{isAr ? "الرصيد الدفتري" : "Booked YER"}</th>
                    <th className="p-2">{isAr ? "سعر الإقفال" : "Spot Rate"}</th>
                    <th className="p-2">{isAr ? "القيمة المعاد تقييمها" : "Revalued YER"}</th>
                    <th className="p-2">{isAr ? "ربح / خسارة" : "Gain / Loss"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {revalPreview.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2 font-bold">
                        <span className="font-mono text-slate-400 me-1">{r.accountCode}</span>
                        {r.accountNameAr}
                      </td>
                      <td className="p-2 font-mono font-bold">{r.currencyCode}</td>
                      <td className="p-2 font-mono">{fmtNum(r.foreignBalance)}</td>
                      <td className="p-2 font-mono">{fmtNum(r.bookedBaseBalance)}</td>
                      <td className="p-2 font-mono">{fmtNum(r.spotRate)}</td>
                      <td className="p-2 font-mono font-bold">{fmtNum(r.revaluedBaseBalance)}</td>
                      <td className="p-2 font-mono font-bold">
                        {r.unrealizedGain > 0 ? (
                          <span className="text-emerald-600">+{fmtNum(r.unrealizedGain)}</span>
                        ) : (
                          <span className="text-rose-600">-{fmtNum(r.unrealizedLoss)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs text-slate-500">
            {isAr
              ? "لا توجد حالياً أرصدة مفتوحة بعملات أجنبية تتطلب إعادة تقييم."
              : "No open foreign-currency monetary balances currently require revaluation."}
          </div>
        )}
      </div>
    </div>
  );
}

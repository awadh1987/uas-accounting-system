"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  Lock,
  Plus,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { FiscalYearPrecheckResult } from "@/lib/fiscalYearClosingEngine";

interface FiscalYearRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  startDate: string;
  endDate: string;
  status: string;
  netProfitLossBase?: number | string | null;
  closedAt?: string | null;
}

interface FiscalYearClosingModalProps {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
  onToast: (msg: string) => void;
  actor?: { userId?: string; userDisplay?: string; userRole?: string };
}

export function FiscalYearClosingModal({
  open,
  onClose,
  onCompleted,
  onToast,
  actor,
}: FiscalYearClosingModalProps) {
  const [years, setYears] = useState<FiscalYearRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [precheck, setPrecheck] = useState<FiscalYearPrecheckResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState("FY-2027");
  const [newNameAr, setNewNameAr] = useState("السنة المالية 2027");
  const [newStart, setNewStart] = useState("2027-01-01");
  const [newEnd, setNewEnd] = useState("2027-12-31");

  const runPrecheck = useCallback(async (fyId: string) => {
    if (!fyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/fiscal-years/${encodeURIComponent(fyId)}/precheck`, {
        method: "POST",
      });
      const data = (await res.json()) as { precheck?: FiscalYearPrecheckResult; error?: string };
      if (!res.ok || !data.precheck) {
        onToast(data.error || "تعذر فحص جاهزية إقفال السنة المالية");
        setPrecheck(null);
        return;
      }
      setPrecheck(data.precheck);
    } catch {
      onToast("تعذر الاتصال بالخادم لفحص السنة المالية");
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  const loadYears = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounting/fiscal-years", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { fiscalYears?: FiscalYearRow[] };
      const list = data.fiscalYears || [];
      setYears(list);
      const preferred = list.find((y) => y.status === "OPEN") || list[0];
      if (preferred) {
        setSelectedId(preferred.id);
        await runPrecheck(preferred.id);
      }
    } finally {
      setLoading(false);
    }
  }, [runPrecheck]);

  useEffect(() => {
    if (open) {
      setStep(1);
      void loadYears();
    }
  }, [open, loadYears]);

  async function handleCreateYear() {
    if (!newCode.trim() || !newNameAr.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/accounting/fiscal-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newCode.trim(),
          nameAr: newNameAr.trim(),
          nameEn: newCode.trim(),
          startDate: newStart,
          endDate: newEnd,
          actor,
        }),
      });
      const data = (await res.json()) as { fiscalYear?: FiscalYearRow; error?: string };
      if (!res.ok || !data.fiscalYear) {
        onToast(data.error || "تعذر إنشاء السنة المالية");
        return;
      }
      onToast(`✅ تم إنشاء السنة المالية ${data.fiscalYear.code}`);
      setShowCreate(false);
      await loadYears();
    } finally {
      setLoading(false);
    }
  }

  async function handleExecuteClose() {
    if (!selectedId || !precheck?.canClose) return;
    setExecuting(true);
    try {
      const res = await fetch(
        `/api/accounting/fiscal-years/${encodeURIComponent(selectedId)}/close-and-rollover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actor }),
        }
      );
      const data = (await res.json()) as {
        success?: boolean;
        closedFiscalYear?: FiscalYearRow;
        nextFiscalYear?: FiscalYearRow;
        error?: string;
      };
      if (!res.ok || !data.success) {
        onToast(data.error || "تعذر إقفال السنة المالية");
        return;
      }
      onToast(
        `✅ تم إقفال ${data.closedFiscalYear?.code || ""} بنجاح وترحيل الأرصدة الافتتاحية إلى ${data.nextFiscalYear?.code || "السنة الجديدة"}`
      );
      onCompleted?.();
      onClose();
    } catch {
      onToast("تعذر الاتصال بالخادم لتنفيذ الإقفال");
    } finally {
      setExecuting(false);
    }
  }

  if (!open) return null;

  const selectedYear = years.find((y) => y.id === selectedId);

  return (
    <div className="fixed inset-0 z-[85] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 flex items-center justify-center">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black">معالج إقفال السنة المالية وترحيل الأرصدة الافتتاحية</h3>
              <p className="text-[11px] text-slate-500">
                Fiscal Year-End Closing &amp; Opening Balance Rollover Wizard
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Fiscal Year Selector Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <label className="font-bold shrink-0">السنة المالية:</label>
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setStep(1);
                void runPrecheck(e.target.value);
              }}
              className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-bold"
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.code} — {y.nameAr} ({y.status === "CLOSED" ? "مقفلة 🔒" : "مفتوحة ✅"})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runPrecheck(selectedId)}
              disabled={loading || !selectedId}
              className="p-2 rounded-xl border border-slate-300 dark:border-slate-700"
              title="إعادة الفحص"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="px-3 py-2 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>سنة مالية جديدة</span>
          </button>
        </div>

        {showCreate && (
          <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="FY-2027" className="rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5 font-mono" />
            <input value={newNameAr} onChange={(e) => setNewNameAr(e.target.value)} placeholder="السنة المالية 2027" className="rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5" />
            <input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5" />
            <div className="flex gap-1.5">
              <input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className="flex-1 rounded-lg border border-slate-300 bg-transparent px-2 py-1.5" />
              <button type="button" onClick={() => void handleCreateYear()} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold">
                حفظ
              </button>
            </div>
          </div>
        )}

        {/* Stepper */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { num: 1 as const, label: "1. فحص جاهزية الإقفال" },
            { num: 2 as const, label: "2. معاينة إقفال الأرباح والخسائر" },
            { num: 3 as const, label: "3. معاينة وتأكيد الترحيل للسنة الجديدة" },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num)}
              className={`px-3 py-2 rounded-xl font-extrabold border text-center transition ${
                step === s.num
                  ? "accent-bg border-transparent"
                  : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="py-10 text-center text-xs text-slate-500">جاري فحص أرصدة ومستندات السنة المالية...</div>
        )}

        {/* STEP 1: Pre-Close Audit Checklist */}
        {!loading && precheck && step === 1 && (
          <div className="space-y-3 text-xs">
            {selectedYear?.status === "CLOSED" && (
              <div className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-center gap-2 text-amber-800 dark:text-amber-200 font-bold">
                <Lock className="w-4 h-4 shrink-0" />
                <span>هذه السنة المالية مقفلة نهائياً ولا يمكن إعادة إقفالها.</span>
              </div>
            )}

            {precheck.checks.map((c) => (
              <div
                key={c.key}
                className={`rounded-xl border p-3.5 flex items-start justify-between gap-3 ${
                  c.passed
                    ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20"
                    : "border-rose-300 bg-rose-50/60 dark:bg-rose-950/20"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {c.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-extrabold text-sm">{c.titleAr}</div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">{c.detailsAr}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{c.detailsEn}</div>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                    c.passed ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                  }`}
                >
                  {c.passed ? "اجتاز ✔" : "يتطلب معالجة ✖"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* STEP 2: P&L Closing Summary Preview */}
        {!loading && precheck && step === 2 && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 p-4 bg-emerald-50/40 dark:bg-emerald-950/20">
                <div className="text-[11px] text-slate-500 font-bold">إجمالي الإيرادات (4xxxx)</div>
                <div className="text-lg font-black text-emerald-700 dark:text-emerald-300 tabular-nums mt-1">
                  {fmtNum(precheck.pnlPreview.totalRevenueBase)} YER
                </div>
              </div>
              <div className="rounded-xl border border-rose-200 dark:border-rose-800 p-4 bg-rose-50/40 dark:bg-rose-950/20">
                <div className="text-[11px] text-slate-500 font-bold">إجمالي المصروفات (5xxxx)</div>
                <div className="text-lg font-black text-rose-700 dark:text-rose-300 tabular-nums mt-1">
                  {fmtNum(precheck.pnlPreview.totalExpensesBase)} YER
                </div>
              </div>
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 p-4 bg-indigo-50/40 dark:bg-indigo-950/20">
                <div className="text-[11px] text-slate-500 font-bold">
                  {precheck.pnlPreview.netProfitLossBase >= 0 ? "صافي الربح المرحّل" : "صافي الخسارة المرحّلة"}
                </div>
                <div className="text-lg font-black text-indigo-700 dark:text-indigo-300 tabular-nums mt-1">
                  {fmtNum(precheck.pnlPreview.netProfitLossBase)} YER
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5">
              <div className="font-extrabold">حساب الأرباح المحتجزة المستهدف (Retained Earnings Target):</div>
              <div className="font-mono text-emerald-700 dark:text-emerald-300 font-bold">
                {precheck.pnlPreview.retainedEarningsAccountCode} — {precheck.pnlPreview.retainedEarningsAccountNameAr}
              </div>
              <div className="text-[11px] text-slate-500">
                سيتم توليد قيد إقفال آلي متوازن من نوع YEAR_END_CLOSING بعدد ({precheck.pnlPreview.closingLineCount}) سطر مع الحفاظ على تفصيل مراكز التكلفة.
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: New Year Opening Balances Preview & Confirm */}
        {!loading && precheck && step === 3 && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20 p-3.5">
              <div className="font-black text-sm text-sky-900 dark:text-sky-200">
                السنة المالية الجديدة: {precheck.openingPreview.nextFiscalYearCode} ({precheck.openingPreview.nextStartDate} ← {precheck.openingPreview.nextEndDate})
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                سيتم ترحيل أرصدة الميزانية العمومية وكافة الحسابات الفرعية من الجيل السادس (العملاء، الموردين، العمال، الصناديق والبنوك، المخازن، المشاريع) بالعملة الأساسية والأجنبية.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-[11px] text-slate-500 font-bold">إجمالي الأصول (1xxxx)</div>
                <div className="text-base font-black tabular-nums mt-1">{fmtNum(precheck.openingPreview.totalAssetsBase)} YER</div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-[11px] text-slate-500 font-bold">إجمالي الالتزامات (2xxxx)</div>
                <div className="text-base font-black tabular-nums mt-1">{fmtNum(precheck.openingPreview.totalLiabilitiesBase)} YER</div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                <div className="text-[11px] text-slate-500 font-bold">حقوق الملكية شاملة الأرباح (3xxxx)</div>
                <div className="text-base font-black tabular-nums mt-1">{fmtNum(precheck.openingPreview.totalEquityBase)} YER</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[10px] text-slate-500">أسطر القيد الافتتاحي</div>
                <div className="text-sm font-black">{precheck.openingPreview.balanceSheetLineCount}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[10px] text-slate-500">حسابات الجيل السادس</div>
                <div className="text-sm font-black">{precheck.openingPreview.gen6SubLedgerCount}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[10px] text-slate-500">العملات الأجنبية</div>
                <div className="text-sm font-black">
                  {precheck.openingPreview.fxCurrencies.length > 0 ? precheck.openingPreview.fxCurrencies.join(", ") : "YER فقط"}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-[10px] text-slate-500">أرصدة المخزون المرحلة</div>
                <div className="text-sm font-black">{precheck.openingPreview.stockBalanceCount}</div>
              </div>
            </div>

            {!precheck.canClose && (
              <div className="rounded-xl border border-rose-400 bg-rose-50 dark:bg-rose-950/30 p-3 flex items-center gap-2 text-rose-700 dark:text-rose-300 font-bold">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>لا يمكن تنفيذ الإقفال قبل استيفاء كافة بنود الفحص في الخطوة 1.</span>
              </div>
            )}

            <button
              type="button"
              disabled={executing || !precheck.canClose}
              onClick={() => void handleExecuteClose()}
              className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-sm shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>
                {executing
                  ? "جاري تنفيذ الإقفال وترحيل الأرصدة..."
                  : "إقفال السنة المالية وترحيل الأرصدة الافتتاحية للسنة الجديدة"}
              </span>
            </button>
          </div>
        )}

        {/* Footer Nav */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : 1))}
            className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold flex items-center gap-1 disabled:opacity-40"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>السابق</span>
          </button>
          {step < 3 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : 3))}
              className="px-4 py-2 rounded-xl accent-bg font-extrabold flex items-center gap-1"
            >
              <span>التالي</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

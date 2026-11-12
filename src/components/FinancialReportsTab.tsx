"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { BarChart3, CheckCircle2, FileSpreadsheet, Printer, Scale, AlertTriangle } from "lucide-react";
import { exportFinancialStatementsToExcel } from "@/lib/excelExport";
import { fmtNum } from "@/lib/formulas";
import type { UasProject } from "@/types/uas";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

interface TrialBalanceRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  type: string;
  totalDebit: number;
  totalCredit: number;
  netDebit: number;
  netCredit: number;
}

interface ProjectBreakdownRow {
  projectId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  budgetTotal: number;
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  actualCost: number;
  netProfit: number;
  variance: number;
  utilizationPct: number;
  isOverBudget: boolean;
}

interface SubProjectBreakdownRow {
  subProjectId: string;
  projectId: string;
  projectCode?: string;
  projectNameAr?: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  budgetTotal: number;
  budget: number;
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  actualCost: number;
  netProfit: number;
  variance: number;
  utilizationPct: number;
  isOverBudget: boolean;
  status?: string;
}

interface TrialBalancePayload {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  difference: number;
  isBalanced: boolean;
}

interface IncomeStatementPayload {
  revenueLines: Array<{ code: string; nameAr: string; balance: number }>;
  cogsLines: Array<{ code: string; nameAr: string; balance: number }>;
  operatingExpenseLines: Array<{ code: string; nameAr: string; balance: number }>;
  adminExpenseLines: Array<{ code: string; nameAr: string; balance: number }>;
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  totalAdminExpenses: number;
  totalExpenses: number;
  netProfit: number;
  projectBreakdown: ProjectBreakdownRow[];
  subProjectBreakdown?: SubProjectBreakdownRow[];
}

interface BalanceSheetPayload {
  assetLines: Array<{ code: string; nameAr: string; balance: number }>;
  liabilityLines: Array<{ code: string; nameAr: string; balance: number }>;
  equityLines: Array<{ code: string; nameAr: string; balance: number }>;
  currentYearNetProfit: number;
  totalAssets: number;
  totalLiabilities: number;
  contributedEquity: number;
  totalEquity: number;
  liabilitiesPlusEquity: number;
  isBalanced: boolean;
}

interface FinancialReportsTabProps {
  projects: UasProject[];
  selectedProjectId: string;
  selectedSubProjectId?: string;
  onToast: (msg: string) => void;
}

export function FinancialReportsTab({
  projects,
  selectedProjectId,
  selectedSubProjectId = "ALL",
  onToast,
}: FinancialReportsTabProps) {
  const [reportTab, setReportTab] = useState<"tb" | "pl" | "bs" | "budget">("tb");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [projectIdOverride, setProjectIdOverride] = useState<string | null>(null);
  const [subProjectIdOverride, setSubProjectIdOverride] = useState<string | null>(null);

  const localProjectId = projectIdOverride ?? selectedProjectId ?? "ALL";
  const localSubProjectId = subProjectIdOverride ?? selectedSubProjectId ?? "ALL";
  const [coaLevel, setCoaLevel] = useState(6);

  const [tb, setTb] = useState<TrialBalancePayload | null>(null);
  const [pl, setPl] = useState<IncomeStatementPayload | null>(null);
  const [bs, setBs] = useState<BalanceSheetPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const availableSubProjects = useMemo(() => {
    if (!localProjectId || localProjectId === "ALL") {
      return projects.flatMap((p) => p.subProjects || []);
    }
    const current = projects.find((p) => p.id === localProjectId);
    return current?.subProjects || [];
  }, [projects, localProjectId]);

  useEffect(() => {
    let active = true;
    const qs = new URLSearchParams();
    if (fromDate) qs.set("fromDate", fromDate);
    if (toDate) qs.set("toDate", toDate);
    if (localProjectId && localProjectId !== "ALL") qs.set("projectId", localProjectId);
    if (localSubProjectId && localSubProjectId !== "ALL") qs.set("subProjectId", localSubProjectId);
    qs.set("level", String(coaLevel));

    Promise.all([
      fetch(`/api/accounting/reports/trial-balance?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/income-statement?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/balance-sheet?${qs.toString()}`, { cache: "no-store" }),
    ])
      .then(async ([tbRes, plRes, bsRes]) => {
        if (!active) return;
        if (tbRes.ok) setTb((await tbRes.json()) as TrialBalancePayload);
        if (plRes.ok) setPl((await plRes.json()) as IncomeStatementPayload);
        if (bsRes.ok) setBs((await bsRes.json()) as BalanceSheetPayload);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        onToast("تعذر توليد القوائم المالية");
      });

    return () => {
      active = false;
    };
  }, [fromDate, toDate, localProjectId, localSubProjectId, coaLevel, onToast]);

  function handleExportExcel() {
    if (!tb || !pl || !bs) return;
    exportFinancialStatementsToExcel({
      trialBalance: tb,
      incomeStatement: pl,
      balanceSheet: bs,
    });
    onToast("✅ تم تصدير القوائم المالية الثلاث إلى Excel بصيغة RTL ومعادلات SUM");
  }

  const budgetChartData = pl
    ? {
        labels: pl.projectBreakdown.map((p) => p.nameAr),
        datasets: [
          {
            label: "الموازنة (Budget)",
            data: pl.projectBreakdown.map((p) => p.budgetTotal),
            backgroundColor: "#94a3b8",
            borderRadius: 6,
          },
          {
            label: "التكاليف الفعلية (Actual)",
            data: pl.projectBreakdown.map((p) => p.actualCost),
            backgroundColor: "#f59e0b",
            borderRadius: 6,
          },
          {
            label: "الإيرادات (Revenue)",
            data: pl.projectBreakdown.map((p) => p.revenue),
            backgroundColor: "#10b981",
            borderRadius: 6,
          },
        ],
      }
    : null;

  return (
    <section className="space-y-5">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">
                القوائم المالية الفورية وموازنة المشاريع (Financial Statements)
              </h2>
              <p className="text-xs text-slate-500">
                مستخرجة لحظياً من قيود الأستاذ العام المرحلة فقط (Posted JournalEntryLines).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 no-print">
            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2 rounded-xl accent-bg text-xs font-extrabold flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel (RTL + Formulas)</span>
            </button>
            <button
              onClick={() => window.print()}
              className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة PDF</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs no-print">
          <select
            value={localProjectId}
            onChange={(e) => {
              setProjectIdOverride(e.target.value);
              setSubProjectIdOverride("ALL");
            }}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-bold"
          >
            <option value="ALL">كافة المشاريع (قوائم موحدة)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={localSubProjectId}
            onChange={(e) => setSubProjectIdOverride(e.target.value)}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-bold"
          >
            <option value="ALL">كافة القطاعات الفرعية</option>
            {availableSubProjects.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.code} - {sp.nameAr}
              </option>
            ))}
          </select>
          <select
            value={coaLevel}
            onChange={(e) => setCoaLevel(Number(e.target.value))}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-bold"
          >
            <option value={6}>عرض حتى الجيل 6 (حسابات الترحيل التشغيلية)</option>
            <option value={5}>عرض حتى الجيل 5 (الحسابات التحليلية)</option>
            <option value={4}>عرض حتى الجيل 4 (الحسابات الرقابية)</option>
            <option value={3}>عرض حتى الجيل 3 (الحسابات العامة الفرعية)</option>
            <option value={2}>عرض حتى الجيل 2 (الحسابات العامة الرئيسية)</option>
            <option value={1}>عرض الجيل 1 فقط (الحسابات الرئيسية)</option>
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
        </div>

        {/* Sub-Report Switcher */}
        <div className="flex flex-wrap gap-2 text-xs no-print">
          {[
            { id: "tb" as const, label: "ميزان المراجعة (Trial Balance)" },
            { id: "pl" as const, label: "قائمة الدخل (Profit & Loss)" },
            { id: "bs" as const, label: "الميزانية العمومية (Balance Sheet)" },
            { id: "budget" as const, label: "الموازنة مقابل الفعلي (Budget Variance)" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setReportTab(t.id)}
              className={`px-3.5 py-2 rounded-xl font-extrabold ${
                reportTab === t.id ? "accent-bg" : "border border-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <div className="py-10 text-center text-xs text-slate-500">جاري احتساب القوائم المالية...</div>}

        {/* 1. TRIAL BALANCE */}
        {!loading && reportTab === "tb" && tb && (
          <div className="space-y-3">
            <div
              className={`p-3 rounded-xl border text-xs font-extrabold flex items-center justify-between ${
                tb.isBalanced ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {tb.isBalanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>
                  {tb.isBalanced
                    ? "ميزان المراجعة متزن تماماً (Σ إجمالي المدين = Σ إجمالي الدائن)"
                    : "تنبيه: يوجد فرق في ميزان المراجعة"}
                </span>
              </span>
              <span className="font-mono">
                DR: {fmtNum(tb.totalDebits)} | CR: {fmtNum(tb.totalCredits)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="py-2">رقم الحساب</th>
                    <th className="py-2">اسم الحساب</th>
                    <th className="py-2">المستوى</th>
                    <th className="py-2">حركة مدين</th>
                    <th className="py-2">حركة دائن</th>
                    <th className="py-2">رصيد مدين</th>
                    <th className="py-2">رصيد دائن</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tb.rows.map((r) => (
                    <tr key={r.id} className={r.level <= 2 ? "font-extrabold bg-slate-50/70 dark:bg-slate-800/50" : ""}>
                      <td className="py-2 font-mono">{r.code}</td>
                      <td className="py-2" style={{ paddingInlineStart: `${(r.level - 1) * 12}px` }}>
                        {r.nameAr}
                      </td>
                      <td className="py-2">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold">
                          الجيل {r.level}
                        </span>
                      </td>
                      <td className="py-2 font-mono">{fmtNum(r.totalDebit)}</td>
                      <td className="py-2 font-mono">{fmtNum(r.totalCredit)}</td>
                      <td className="py-2 font-mono text-emerald-700 font-bold">
                        {r.netDebit > 0 ? fmtNum(r.netDebit) : "—"}
                      </td>
                      <td className="py-2 font-mono text-indigo-700 font-bold">
                        {r.netCredit > 0 ? fmtNum(r.netCredit) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. PROFIT & LOSS */}
        {!loading && reportTab === "pl" && pl && (
          <div className="space-y-5 text-xs">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">إجمالي الإيرادات</div>
                <div className="text-lg font-black text-emerald-600">{fmtNum(pl.totalRevenue)} YER</div>
              </div>
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">تكلفة الإنتاج والعمالة (COGS)</div>
                <div className="text-lg font-black text-amber-600">{fmtNum(pl.totalCogs)} YER</div>
              </div>
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">المصروفات التشغيلية والإدارية</div>
                <div className="text-lg font-black text-rose-600">
                  {fmtNum(pl.totalOperatingExpenses + pl.totalAdminExpenses)} YER
                </div>
              </div>
              <div className="p-4 rounded-xl border space-y-1 bg-emerald-50/40 dark:bg-emerald-950/20">
                <div className="text-slate-500 font-bold">صافي الربح التشغيلي</div>
                <div className={`text-lg font-black ${pl.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {fmtNum(pl.netProfit)} YER
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-4 rounded-2xl border space-y-2">
                <h4 className="font-extrabold text-sm border-b pb-2 text-emerald-700">بنود الإيرادات (Revenue)</h4>
                {pl.revenueLines.map((l) => (
                  <div key={l.code} className="flex justify-between py-1 border-b border-dashed">
                    <span>
                      <strong className="font-mono">{l.code}</strong> {l.nameAr}
                    </span>
                    <span className="font-bold">{fmtNum(l.balance)} YER</span>
                  </div>
                ))}
              </div>
              <div className="p-4 rounded-2xl border space-y-2">
                <h4 className="font-extrabold text-sm border-b pb-2 text-rose-700">بنود التكاليف والمصروفات (Costs &amp; Expenses)</h4>
                {[...pl.cogsLines, ...pl.operatingExpenseLines, ...pl.adminExpenseLines].map((l) => (
                  <div key={l.code} className="flex justify-between py-1 border-b border-dashed">
                    <span>
                      <strong className="font-mono">{l.code}</strong> {l.nameAr}
                    </span>
                    <span className="font-bold">{fmtNum(l.balance)} YER</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3. BALANCE SHEET */}
        {!loading && reportTab === "bs" && bs && (
          <div className="space-y-4 text-xs">
            <div
              className={`p-3 rounded-xl border font-extrabold flex items-center justify-between ${
                bs.isBalanced ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Scale className="w-4 h-4" />
                <span>
                  {bs.isBalanced
                    ? "المعادلة المحاسبية متحققة: الأصول = الالتزامات + حقوق الملكية"
                    : "تنبيه: اختلال في معادلة الميزانية"}
                </span>
              </span>
              <span className="font-mono">
                Assets: {fmtNum(bs.totalAssets)} = L+E: {fmtNum(bs.liabilitiesPlusEquity)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-4 rounded-2xl border space-y-2">
                <h4 className="font-extrabold text-sm border-b pb-2 text-emerald-700">
                  الأصول (Assets) — الإجمالي: {fmtNum(bs.totalAssets)} YER
                </h4>
                {bs.assetLines.map((a) => (
                  <div key={a.code} className="flex justify-between py-1 border-b border-dashed">
                    <span>
                      <strong className="font-mono">{a.code}</strong> {a.nameAr}
                    </span>
                    <span className="font-bold">{fmtNum(a.balance)} YER</span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl border space-y-3">
                <div className="space-y-2">
                  <h4 className="font-extrabold text-sm border-b pb-2 text-amber-700">
                    الالتزامات (Liabilities) — {fmtNum(bs.totalLiabilities)} YER
                  </h4>
                  {bs.liabilityLines.map((l) => (
                    <div key={l.code} className="flex justify-between py-1 border-b border-dashed">
                      <span>
                        <strong className="font-mono">{l.code}</strong> {l.nameAr}
                      </span>
                      <span className="font-bold">{fmtNum(l.balance)} YER</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 pt-2">
                  <h4 className="font-extrabold text-sm border-b pb-2 text-indigo-700">
                    حقوق الملكية (Equity) — {fmtNum(bs.totalEquity)} YER
                  </h4>
                  {bs.equityLines.map((eq) => (
                    <div key={eq.code} className="flex justify-between py-1 border-b border-dashed">
                      <span>
                        <strong className="font-mono">{eq.code}</strong> {eq.nameAr}
                      </span>
                      <span className="font-bold">{fmtNum(eq.balance)} YER</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 border-b border-dashed text-emerald-700 font-bold">
                    <span>
                      <strong className="font-mono">313101</strong> صافي نتيجة العام المالي الجاري
                    </span>
                    <span>{fmtNum(bs.currentYearNetProfit)} YER</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. BUDGET VS ACTUAL */}
        {!loading && reportTab === "budget" && pl && (
          <div className="space-y-5 text-xs">
            {budgetChartData && (
              <div className="h-72 p-3 rounded-2xl border">
                <Bar data={budgetChartData} options={{ responsive: true, maintainAspectRatio: false }} />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="py-2">الرمز</th>
                    <th className="py-2">المشروع</th>
                    <th className="py-2">الموازنة التقديرية</th>
                    <th className="py-2">التكاليف الفعلية</th>
                    <th className="py-2">الانحراف (Variance)</th>
                    <th className="py-2">نسبة الاستهلاك</th>
                    <th className="py-2">الإيرادات</th>
                    <th className="py-2">صافي الربح</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pl.projectBreakdown.map((p) => (
                    <tr key={p.projectId}>
                      <td className="py-2.5 font-mono font-bold">{p.code}</td>
                      <td className="py-2.5 font-extrabold">{p.nameAr}</td>
                      <td className="py-2.5 font-mono">{fmtNum(p.budgetTotal)}</td>
                      <td className="py-2.5 font-mono text-amber-700 font-bold">{fmtNum(p.actualCost)}</td>
                      <td className={`py-2.5 font-mono font-bold ${p.isOverBudget ? "text-rose-600" : "text-emerald-600"}`}>
                        {fmtNum(p.variance)}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold ${
                            p.isOverBudget ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {p.utilizationPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2.5 font-mono text-emerald-700 font-bold">{fmtNum(p.revenue)}</td>
                      <td className="py-2.5 font-mono font-extrabold">{fmtNum(p.netProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Sub-Projects / Cost Centers Breakdown */}
            {pl.subProjectBreakdown && pl.subProjectBreakdown.length > 0 && (
              <div className="pt-6 border-t border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-black text-slate-800">
                    تحليل القطاعات والمشاريع الفرعية ومراكز التكلفة (Sub-Projects & Cost Centers)
                  </h4>
                  <span className="text-xs text-slate-500 font-mono">
                    {pl.subProjectBreakdown.length} قطاعات فرعية
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-right border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3">رمز القطاع</th>
                        <th className="py-2.5 px-3">القطاع الفرعي</th>
                        <th className="py-2.5 px-3">المشروع الأب</th>
                        <th className="py-2.5 px-3">الموازنة التقديرية</th>
                        <th className="py-2.5 px-3">المصروف الفعلي</th>
                        <th className="py-2.5 px-3">الانحراف (Variance)</th>
                        <th className="py-2.5 px-3">نسبة الاستهلاك</th>
                        <th className="py-2.5 px-3">الإيرادات</th>
                        <th className="py-2.5 px-3">صافي الربح</th>
                        <th className="py-2.5 px-3">هامش الربح %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pl.subProjectBreakdown.map((sp) => {
                        const budget = sp.budgetTotal ?? sp.budget ?? 0;
                        const marginPct =
                          sp.revenue > 0 ? (sp.netProfit / sp.revenue) * 100 : 0;
                        return (
                          <tr key={sp.subProjectId} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-3 font-mono font-bold text-sky-700">{sp.code}</td>
                            <td className="py-2.5 px-3 font-bold text-slate-900">{sp.nameAr}</td>
                            <td className="py-2.5 px-3 text-slate-600">
                              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded ml-1">
                                {sp.projectCode}
                              </span>
                              {sp.projectNameAr}
                            </td>
                            <td className="py-2.5 px-3 font-mono">{fmtNum(budget)}</td>
                            <td className="py-2.5 px-3 font-mono text-amber-700 font-bold">{fmtNum(sp.actualCost)}</td>
                            <td className={`py-2.5 px-3 font-mono font-bold ${sp.isOverBudget ? "text-rose-600" : "text-emerald-600"}`}>
                              {fmtNum(sp.variance)}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                                  sp.isOverBudget ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {sp.utilizationPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-emerald-700 font-bold">{fmtNum(sp.revenue)}</td>
                            <td className={`py-2.5 px-3 font-mono font-extrabold ${sp.netProfit >= 0 ? "text-slate-900" : "text-rose-600"}`}>
                              {fmtNum(sp.netProfit)}
                            </td>
                            <td className={`py-2.5 px-3 font-mono font-bold text-xs ${marginPct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                              {marginPct.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}


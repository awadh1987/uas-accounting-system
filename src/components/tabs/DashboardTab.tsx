"use client";

import { useMemo, useState } from "react";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import { computeNetOperatingProfit, fmtNum, formatCurrencyVal, type CurrencyCode } from "@/lib/formulas";
import { getDict } from "@/lib/i18n";
import type {
  LanguageCode,
  TabId,
  UasBootstrapState,
  UasOperatingExpense,
  UasSaleTransaction,
  UasWorkerWage,
} from "@/types/uas";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

interface DashboardTabProps {
  state: UasBootstrapState;
  lang: LanguageCode;
  currency: CurrencyCode;
  selectedProjectId: string;
  selectedSubProjectId?: string;
  filteredSales: UasSaleTransaction[];
  filteredExpenses: UasOperatingExpense[];
  filteredWorkers: UasWorkerWage[];
  onExportExcel: () => void;
  onSwitchTab: (tab: TabId) => void;
  onToast: (msg: string) => void;
}

export function DashboardTab({
  state,
  lang,
  currency,
  selectedProjectId,
  selectedSubProjectId = "ALL",
  filteredSales,
  filteredExpenses,
  filteredWorkers,
  onExportExcel,
  onSwitchTab,
  onToast,
}: DashboardTabProps) {
  const dict = getDict(lang);
  const [searchVal, setSearchVal] = useState("");

  const formatAmt = (amountYER: number) =>
    currency === "YER"
      ? `${fmtNum(amountYER)} ريال`
      : formatCurrencyVal(amountYER, currency, state.exchangeRates);

  const selectedSubProject = useMemo(() => {
    if (!selectedSubProjectId || selectedSubProjectId === "ALL") return null;
    for (const p of state.projects) {
      const sp = p.subProjects?.find((s) => s.id === selectedSubProjectId);
      if (sp) return sp;
    }
    return null;
  }, [state.projects, selectedSubProjectId]);

  const filteredProjects = useMemo(
    () =>
      selectedProjectId === "ALL"
        ? state.projects
        : state.projects.filter((p) => p.id === selectedProjectId),
    [state.projects, selectedProjectId]
  );

  const totalProjVal = selectedSubProject
    ? Number(selectedSubProject.budget) || 0
    : filteredProjects.reduce((acc, p) => acc + (Number(p.estimatedValue) || 0), 0);
  const totalSales = filteredSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0);
  const totalSalesCredit = filteredSales.reduce((acc, s) => acc + (Number(s.credit) || 0), 0);
  const totalSalesDebit = filteredSales.reduce((acc, s) => acc + (Number(s.debit) || 0), 0);

  const totalOpExp = filteredExpenses.reduce((acc, e) => acc + (Number(e.total) || 0), 0);
  const totalWrkWages = filteredWorkers.reduce((acc, w) => acc + (Number(w.total) || 0), 0);
  const totalWrkCredit = filteredWorkers.reduce((acc, w) => acc + (Number(w.credit) || 0), 0);
  const totalWrkDebit = filteredWorkers.reduce((acc, w) => acc + (Number(w.debit) || 0), 0);

  const netProfit = computeNetOperatingProfit(totalSales, totalOpExp, totalWrkWages);

  const barData = useMemo(() => {
    const labels = state.projects.map((p) => p.name);
    const salesData = state.projects.map((p) =>
      state.sales
        .filter((s) => s.projectId === p.id)
        .reduce((a, b) => a + Number(b.total), 0)
    );
    const costData = state.projects.map((p) => {
      const e = state.expenses
        .filter((x) => x.projectId === p.id)
        .reduce((a, b) => a + Number(b.total), 0);
      const w = state.workers
        .filter((x) => x.projectId === p.id)
        .reduce((a, b) => a + Number(b.total), 0);
      return e + w;
    });
    const profitData = labels.map((_, i) => salesData[i] - costData[i]);

    return {
      labels,
      datasets: [
        { label: "المبيعات (Sales)", data: salesData, backgroundColor: "#10b981", borderRadius: 6 },
        { label: "المصروفات والأجور (Costs)", data: costData, backgroundColor: "#f59e0b", borderRadius: 6 },
        { label: "صافي الربح (Net Profit)", data: profitData, backgroundColor: "#3b82f6", borderRadius: 6 },
      ],
    };
  }, [state.projects, state.sales, state.expenses, state.workers]);

  const doughnutData = useMemo(() => {
    const cats = ["وقود/محروقات", "وجبات غذائية", "مواد غذائية", "أجور نقل", "أخرى"];
    const catSums = cats.map((c) =>
      state.expenses
        .filter((e) => e.category === c)
        .reduce((a, b) => a + Number(b.total), 0)
    );
    const totalWages = state.workers.reduce((a, b) => a + Number(b.total), 0);
    return {
      labels: [...cats, "أجور العمال"],
      datasets: [
        {
          data: [...catSums, totalWages],
          backgroundColor: ["#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#64748b", "#4f46e5"],
        },
      ],
    };
  }, [state.expenses, state.workers]);

  function runReportAction(num: number) {
    if (num === 1 || num === 2 || num === 3) {
      onSwitchTab("dashboard");
      onToast("تم عرض ملخص المشاريع والربح والخسارة - جاهز للتصدير");
    } else if (num === 4) {
      document.getElementById("chartsSection")?.scrollIntoView({ behavior: "smooth" });
    } else if (num === 5) {
      onSwitchTab("sales");
      onToast("تم فتح التقارير التفصيلية للمبيعات والسندات");
    } else if (num === 6) {
      onExportExcel();
    } else if (num === 7) {
      onSwitchTab("customers");
      onToast("تم فتح كشف وفواتير العملاء");
    } else if (num === 8) {
      onSwitchTab("workers");
      onToast("تم فتح كشف حساب وأجور العمال");
    }
  }

  const reportItems = [
    { num: 1, label: "إجمالي قيمة المشروع لكل قطفة", badge: "فرز/تصدير" },
    { num: 2, label: "تقرير الربح والخسارة (P&L)", badge: "فرز/تصدير" },
    { num: 3, label: "ملخصات شاملة جميع المشاريع", badge: "فرز/تصدير" },
    { num: 4, label: "الرسوم البيانية التحليلية", badge: "عرض" },
    { num: 5, label: "تقارير تفصيلية للعمليات", badge: "فرز/تصدير" },
    { num: 6, label: "تصدير شامل إلى Excel و PDF", badge: "تصدير" },
    { num: 7, label: "فرز العملاء وتصدير التقارير", badge: "عملاء" },
    { num: 8, label: "فرز العمال وتصدير التقارير", badge: "عمال" },
  ];

  const searchedProjects = state.projects.filter((p) => {
    const q = searchVal.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.notes.toLowerCase().includes(q) ||
      p.harvests.some((h) => h.toLowerCase().includes(q))
    );
  });

  return (
    <section className="space-y-6">
      {/* Top Action & Export Bar */}
      <div className="card-surface rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold">{dict.dashTitle}</h2>
          <p className="text-xs text-slate-500">{dict.dashSubtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            onClick={onExportExcel}
            className="px-3.5 py-2 rounded-xl accent-bg text-xs font-bold shadow-sm flex items-center gap-1.5"
          >
            📥 <span>{dict.btnExportExcel}</span>
          </button>
          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5"
          >
            🖨️ <span>{dict.btnExportPDF}</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="card-surface rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 font-semibold">{dict.kpiProjectValue}</div>
          <div className="text-xl font-extrabold mt-1">{formatAmt(totalProjVal)}</div>
          <div className="text-[11px] text-emerald-600 mt-1 font-medium">
            {filteredProjects.length} مشاريع نشطة
          </div>
        </div>
        <div className="card-surface rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 font-semibold">{dict.kpiTotalSales}</div>
          <div className="text-xl font-extrabold mt-1 text-emerald-600">
            {formatAmt(totalSales)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            دائن (مقبوض): {fmtNum(totalSalesCredit)} | مدين: {fmtNum(totalSalesDebit)}
          </div>
        </div>
        <div className="card-surface rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 font-semibold">{dict.kpiOperatingExp}</div>
          <div className="text-xl font-extrabold mt-1 text-amber-600">
            {formatAmt(totalOpExp)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">{dict.kpiOpExpSub}</div>
        </div>
        <div className="card-surface rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 font-semibold">{dict.kpiWorkerWages}</div>
          <div className="text-xl font-extrabold mt-1 text-indigo-600">
            {formatAmt(totalWrkWages)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            مدفوع (دائن): {fmtNum(totalWrkCredit)} | متبقي (مدين): {fmtNum(totalWrkDebit)}
          </div>
        </div>
        <div className="card-surface rounded-2xl p-4 shadow-sm">
          <div className="text-xs text-slate-500 font-semibold">{dict.kpiNetProfit}</div>
          <div
            className={`text-xl font-extrabold mt-1 ${
              netProfit >= 0 ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {formatAmt(netProfit)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            الإيرادات - (المصروفات + الأجور)
          </div>
        </div>
      </div>

      {/* 8 Report Quick-Filter & Export Hub */}
      <div className="card-surface rounded-2xl p-4">
        <h3 className="text-sm font-bold mb-3">{dict.eightReportsHeading}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          {reportItems.map((item) => (
            <button
              key={item.num}
              onClick={() => runReportAction(item.num)}
              className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-right flex items-center justify-between gap-2 transition"
            >
              <span>
                <strong>{item.num}.</strong> {item.label}
              </span>
              <span className="accent-badge px-2 py-0.5 rounded font-bold shrink-0">
                {item.badge}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Charts Row */}
      <div id="chartsSection" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card-surface rounded-2xl p-4">
          <h3 className="text-sm font-bold mb-2">{dict.chartProjectTitle}</h3>
          <div className="relative h-72">
            <Bar
              data={barData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
              }}
            />
          </div>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <h3 className="text-sm font-bold mb-2">{dict.chartExpenseTitle}</h3>
          <div className="relative h-72">
            <Doughnut
              data={doughnutData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
              }}
            />
          </div>
        </div>
      </div>

      {/* Comprehensive Projects & Harvests Profit/Loss Table */}
      <div className="card-surface rounded-2xl p-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold">{dict.projSummaryTableTitle}</h3>
          <input
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            type="text"
            placeholder="ابحث باسم المشروع أو القطفة..."
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-1.5 text-xs"
          />
        </div>
        <table className="w-full text-xs text-right border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
              <th className="p-2.5">المشروع</th>
              <th className="p-2.5">النوع</th>
              <th className="p-2.5">قيمة المشروع التقديرية</th>
              <th className="p-2.5">عدد القطفات</th>
              <th className="p-2.5">إجمالي المبيعات</th>
              <th className="p-2.5">المقبوض (دائن)</th>
              <th className="p-2.5">ديون العملاء (مدين)</th>
              <th className="p-2.5">المصروفات التشغيلية</th>
              <th className="p-2.5">أجور العمال</th>
              <th className="p-2.5">صافي الربح / الخسارة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {searchedProjects.map((p) => {
              const pSales = state.sales.filter((s) => s.projectId === p.id);
              const pExp = state.expenses.filter((e) => e.projectId === p.id);
              const pWrk = state.workers.filter((w) => w.projectId === p.id);

              const sTotal = pSales.reduce((a, b) => a + Number(b.total), 0);
              const sCred = pSales.reduce((a, b) => a + Number(b.credit), 0);
              const sDeb = pSales.reduce((a, b) => a + Number(b.debit), 0);
              const eTotal = pExp.reduce((a, b) => a + Number(b.total), 0);
              const wTotal = pWrk.reduce((a, b) => a + Number(b.total), 0);
              const pNet = computeNetOperatingProfit(sTotal, eTotal, wTotal);

              return (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="p-2.5 font-bold">{p.name}</td>
                  <td className="p-2.5">
                    <span className="accent-badge px-2 py-0.5 rounded text-[11px] font-semibold">
                      {p.type}
                    </span>
                  </td>
                  <td className="p-2.5 font-semibold">{fmtNum(p.estimatedValue)}</td>
                  <td className="p-2.5">
                    {(p.harvests || []).length} ({(p.harvests || []).join("، ")})
                  </td>
                  <td className="p-2.5 font-bold text-emerald-600">{fmtNum(sTotal)}</td>
                  <td className="p-2.5">{fmtNum(sCred)}</td>
                  <td className="p-2.5 text-rose-600 font-semibold">{fmtNum(sDeb)}</td>
                  <td className="p-2.5 text-amber-600">{fmtNum(eTotal)}</td>
                  <td className="p-2.5 text-indigo-600">{fmtNum(wTotal)}</td>
                  <td
                    className={`p-2.5 font-extrabold ${
                      pNet >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {fmtNum(pNet)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sub-Projects / Cost Centers Profitability & Budget Utilization */}
      <div className="card-surface rounded-2xl p-4 overflow-x-auto space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              <span>تحليل ربحية القطاعات الفرعية ومراكز التكلفة (Sub-Projects & Cost Centers)</span>
              <span className="accent-badge px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                IFRS Multi-Dimensional
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              متابعة الموازنة، المصروفات الفعلية، الإيرادات المباشرة، وهامش الربحية لكل قطاع فرعي
            </p>
          </div>
          <button
            onClick={() => onSwitchTab("projects")}
            className="text-xs font-bold text-sky-600 hover:underline"
          >
            إدارة القطاعات الفرعية ←
          </button>
        </div>

        {state.projects.every((p) => !p.subProjects || p.subProjects.length === 0) ? (
          <div className="text-center py-6 text-xs text-slate-500">
            لم يتم إنشاء قطاعات فرعية بعد. يمكنك إضافة قطاعات من تبويب المشاريع لمتابعة مراكز التكلفة التحليلية.
          </div>
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
                <th className="p-2.5">رمز القطاع</th>
                <th className="p-2.5">اسم القطاع الفرعي</th>
                <th className="p-2.5">المشروع الأب</th>
                <th className="p-2.5">الموازنة التقديرية</th>
                <th className="p-2.5">المصروف الفعلي</th>
                <th className="p-2.5">نسبة الاستهلاك</th>
                <th className="p-2.5">الإيرادات المحققة</th>
                <th className="p-2.5">صافي الربح / الخسارة</th>
                <th className="p-2.5">الهامش %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {state.projects.flatMap((p) =>
                (p.subProjects || []).map((sp) => {
                  const spExp = state.expenses
                    .filter((e) => e.subProjectId === sp.id)
                    .reduce((a, b) => a + Number(b.total), 0);
                  const spWrk = state.workers
                    .filter((w) => w.subProjectId === sp.id)
                    .reduce((a, b) => a + Number(b.total), 0);
                  const spSales = state.sales
                    .filter((s) => s.subProjectId === sp.id)
                    .reduce((a, b) => a + Number(b.total), 0);
                  const actualCost = spExp + spWrk;
                  const profit = spSales - actualCost;
                  const budget = Number(sp.budget) || 0;
                  const utilPct = budget > 0 ? (actualCost / budget) * 100 : 0;
                  const marginPct = spSales > 0 ? (profit / spSales) * 100 : 0;
                  const isOver = budget > 0 && actualCost > budget;

                  return (
                    <tr key={sp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-2.5 font-mono font-bold text-sky-700 dark:text-sky-300">{sp.code}</td>
                      <td className="p-2.5 font-bold">{sp.nameAr}</td>
                      <td className="p-2.5 text-slate-600 dark:text-slate-400">{p.name}</td>
                      <td className="p-2.5 font-mono">{fmtNum(budget)}</td>
                      <td className="p-2.5 font-mono text-amber-700 dark:text-amber-400 font-bold">
                        {fmtNum(actualCost)}
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            isOver ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {utilPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-2.5 font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                        {fmtNum(spSales)}
                      </td>
                      <td
                        className={`p-2.5 font-mono font-extrabold ${
                          profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {fmtNum(profit)}
                      </td>
                      <td
                        className={`p-2.5 font-mono font-bold ${
                          marginPct >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600"
                        }`}
                      >
                        {marginPct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}


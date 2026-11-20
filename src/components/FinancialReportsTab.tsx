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
import {
  printUasDocument,
  resolveLetterheadFromProfile,
} from "@/lib/print/uasDocumentPrinter";
import type { UasEnterpriseProfile, UasProject } from "@/types/uas";

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

interface CostCenterReportRow {
  costCenterId: string | null;
  code: string;
  nameAr: string;
  nameEn: string;
  revenue: number;
  expense: number;
  net: number;
}

interface CostCenterReportPayload {
  rows: CostCenterReportRow[];
  totals: { revenue: number; expense: number; net: number };
}

interface FinancialReportsTabProps {
  projects: UasProject[];
  selectedProjectId: string;
  selectedSubProjectId?: string;
  enterpriseProfile?: UasEnterpriseProfile | null;
  onToast: (msg: string) => void;
}

export function FinancialReportsTab({
  projects,
  selectedProjectId,
  selectedSubProjectId = "ALL",
  enterpriseProfile,
  onToast,
}: FinancialReportsTabProps) {
  const [reportTab, setReportTab] = useState<"tb" | "pl" | "bs" | "budget" | "cc">("tb");
  const [costCenterFilter, setCostCenterFilter] = useState("ALL");
  const [costCenterList, setCostCenterList] = useState<Array<{ id: string; code: string; nameAr: string; generation: number }>>([]);
  const [ccReport, setCcReport] = useState<CostCenterReportPayload | null>(null);
  const [currencyDisplayMode, setCurrencyDisplayMode] = useState<"BASE_YER" | "TX_CURRENCY">("BASE_YER");
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
    if (costCenterFilter && costCenterFilter !== "ALL") qs.set("costCenterId", costCenterFilter);
    qs.set("level", String(coaLevel));

    Promise.all([
      fetch(`/api/accounting/reports/trial-balance?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/income-statement?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/balance-sheet?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/cost-centers?${qs.toString()}`, { cache: "no-store" }),
    ])
      .then(async ([tbRes, plRes, bsRes, ccRes]) => {
        if (!active) return;
        if (tbRes.ok) setTb((await tbRes.json()) as TrialBalancePayload);
        if (plRes.ok) setPl((await plRes.json()) as IncomeStatementPayload);
        if (bsRes.ok) setBs((await bsRes.json()) as BalanceSheetPayload);
        if (ccRes.ok) setCcReport((await ccRes.json()) as CostCenterReportPayload);
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
  }, [fromDate, toDate, localProjectId, localSubProjectId, costCenterFilter, coaLevel, onToast]);

  useEffect(() => {
    fetch("/api/accounting/cost-centers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { costCenters: [] }))
      .then((d: { costCenters?: Array<{ id: string; code: string; nameAr: string; generation: number }> }) =>
        setCostCenterList(d.costCenters || [])
      )
      .catch(() => setCostCenterList([]));
  }, []);

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
      {/* Printable Enterprise Header */}
      <div className="hidden print:flex flex-col items-center justify-center border-b pb-4 mb-4 text-center">
        <h1 className="text-xl font-black">
          {enterpriseProfile?.legalNameAr || "اسم المنشأة"}
        </h1>
        {enterpriseProfile?.legalNameEn && (
          <div className="text-xs font-semibold text-slate-600">
            {enterpriseProfile.legalNameEn}
          </div>
        )}
        <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
          {enterpriseProfile?.taxNumber && (
            <span>الرقم الضريبي: {enterpriseProfile.taxNumber}</span>
          )}
          {enterpriseProfile?.commercialReg && (
            <span>السجل التجاري: {enterpriseProfile.commercialReg}</span>
          )}
        </div>
      </div>

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

          <div className="flex flex-wrap gap-2 no-print items-center">
            <div className="inline-flex rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setCurrencyDisplayMode("BASE_YER")}
                className={`px-2.5 py-1.5 transition ${
                  currencyDisplayMode === "BASE_YER"
                    ? "accent-bg"
                    : "bg-transparent text-slate-600 dark:text-slate-300"
                }`}
              >
                عملة الأساس (YER)
              </button>
              <button
                type="button"
                onClick={() => setCurrencyDisplayMode("TX_CURRENCY")}
                className={`px-2.5 py-1.5 transition ${
                  currencyDisplayMode === "TX_CURRENCY"
                    ? "accent-bg"
                    : "bg-transparent text-slate-600 dark:text-slate-300"
                }`}
              >
                عملة المعاملة (FX)
              </button>
            </div>
            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2 rounded-xl accent-bg text-xs font-extrabold flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>تصدير Excel (RTL + Formulas)</span>
            </button>
            <button
              onClick={() => {
                const letterhead = resolveLetterheadFromProfile(enterpriseProfile);
                const selectedCc = costCenterList.find((c) => c.id === costCenterFilter);
                const ccLabel = selectedCc ? `${selectedCc.code} • ${selectedCc.nameAr}` : undefined;
                if (reportTab === "cc" && ccReport) {
                  void printUasDocument({
                    titleAr: "تقرير أرباح وخسائر مراكز التكلفة",
                    titleEn: "Cost Center Profit & Loss Report",
                    documentNumber: `RPT-CC-${new Date().toISOString().slice(0, 10)}`,
                    costCenter: ccLabel,
                    currency: "YER",
                    status: "POSTED",
                    format: "A4_PORTRAIT",
                    letterhead,
                    summaryCards: [
                      { labelAr: "إجمالي الإيرادات", labelEn: "Revenue", value: `${fmtNum(ccReport.totals.revenue)} YER`, tone: "emerald" },
                      { labelAr: "إجمالي المصروفات", labelEn: "Expenses", value: `${fmtNum(ccReport.totals.expense)} YER`, tone: "rose" },
                      { labelAr: "صافي النتيجة", labelEn: "Net Profit", value: `${fmtNum(ccReport.totals.net)} YER`, tone: ccReport.totals.net >= 0 ? "indigo" : "rose" },
                    ],
                    tables: [
                      {
                        headingAr: "تفصيل مراكز التكلفة",
                        headingEn: "Cost Center Breakdown",
                        columns: [
                          { key: "code", labelAr: "الرمز", labelEn: "Code" },
                          { key: "nameAr", labelAr: "مركز التكلفة", labelEn: "Cost Center" },
                          { key: "revenue", labelAr: "الإيرادات", labelEn: "Revenue", numeric: true },
                          { key: "expense", labelAr: "المصروفات", labelEn: "Expenses", numeric: true },
                          { key: "net", labelAr: "الصافي", labelEn: "Net", numeric: true },
                        ],
                        rows: ccReport.rows.map((r) => ({
                          code: r.code,
                          nameAr: r.nameAr,
                          revenue: fmtNum(r.revenue),
                          expense: fmtNum(r.expense),
                          net: fmtNum(r.net),
                        })),
                        totalsRow: {
                          code: "الإجمالي",
                          revenue: fmtNum(ccReport.totals.revenue),
                          expense: fmtNum(ccReport.totals.expense),
                          net: fmtNum(ccReport.totals.net),
                        },
                      },
                    ],
                  });
                } else if (reportTab === "pl" && pl) {
                  void printUasDocument({
                    titleAr: "قائمة الدخل (الأرباح والخسائر)",
                    titleEn: "Income Statement (Profit & Loss)",
                    documentNumber: `RPT-PL-${new Date().toISOString().slice(0, 10)}`,
                    costCenter: ccLabel,
                    currency: "YER",
                    status: "POSTED",
                    format: "A4_PORTRAIT",
                    letterhead,
                    summaryCards: [
                      { labelAr: "إجمالي الإيرادات", labelEn: "Total Revenue", value: `${fmtNum(pl.totalRevenue)} YER`, tone: "emerald" },
                      { labelAr: "إجمالي المصروفات", labelEn: "Total Expenses", value: `${fmtNum(pl.totalExpenses)} YER`, tone: "rose" },
                      { labelAr: "صافي الربح / الخسارة", labelEn: "Net Income", value: `${fmtNum(pl.netProfit)} YER`, tone: pl.netProfit >= 0 ? "indigo" : "rose" },
                    ],
                    tables: [
                      {
                        headingAr: "الإيرادات",
                        headingEn: "Revenues",
                        columns: [
                          { key: "code", labelAr: "الرمز", labelEn: "Code" },
                          { key: "nameAr", labelAr: "الحساب", labelEn: "Account" },
                          { key: "balance", labelAr: "الرصيد", labelEn: "Amount", numeric: true },
                        ],
                        rows: pl.revenueLines.map((l) => ({ code: l.code, nameAr: l.nameAr, balance: fmtNum(l.balance) })),
                        totalsRow: { code: "إجمالي الإيرادات", balance: fmtNum(pl.totalRevenue) },
                      },
                      {
                        headingAr: "التكاليف والمصروفات",
                        headingEn: "COGS & Expenses",
                        columns: [
                          { key: "code", labelAr: "الرمز", labelEn: "Code" },
                          { key: "nameAr", labelAr: "الحساب", labelEn: "Account" },
                          { key: "balance", labelAr: "الرصيد", labelEn: "Amount", numeric: true },
                        ],
                        rows: [...pl.cogsLines, ...pl.operatingExpenseLines, ...pl.adminExpenseLines].map((l) => ({
                          code: l.code,
                          nameAr: l.nameAr,
                          balance: fmtNum(l.balance),
                        })),
                        totalsRow: { code: "إجمالي المصروفات", balance: fmtNum(pl.totalExpenses) },
                      },
                    ],
                  });
                } else if (reportTab === "bs" && bs) {
                  void printUasDocument({
                    titleAr: "الميزانية العمومية (قائمة المركز المالي)",
                    titleEn: "Balance Sheet",
                    documentNumber: `RPT-BS-${new Date().toISOString().slice(0, 10)}`,
                    costCenter: ccLabel,
                    currency: "YER",
                    status: "POSTED",
                    format: "A4_PORTRAIT",
                    letterhead,
                    summaryCards: [
                      { labelAr: "إجمالي الأصول", labelEn: "Total Assets", value: `${fmtNum(bs.totalAssets)} YER`, tone: "emerald" },
                      { labelAr: "إجمالي الالتزامات", labelEn: "Total Liabilities", value: `${fmtNum(bs.totalLiabilities)} YER`, tone: "amber" },
                      { labelAr: "حقوق الملكية", labelEn: "Total Equity", value: `${fmtNum(bs.totalEquity)} YER`, tone: "indigo" },
                    ],
                    tables: [
                      {
                        headingAr: "الأصول",
                        headingEn: "Assets",
                        columns: [
                          { key: "code", labelAr: "الرمز", labelEn: "Code" },
                          { key: "nameAr", labelAr: "الحساب", labelEn: "Account" },
                          { key: "balance", labelAr: "الرصيد", labelEn: "Balance", numeric: true },
                        ],
                        rows: bs.assetLines.map((l) => ({ code: l.code, nameAr: l.nameAr, balance: fmtNum(l.balance) })),
                        totalsRow: { code: "إجمالي الأصول", balance: fmtNum(bs.totalAssets) },
                      },
                      {
                        headingAr: "الالتزامات وحقوق الملكية",
                        headingEn: "Liabilities & Equity",
                        columns: [
                          { key: "code", labelAr: "الرمز", labelEn: "Code" },
                          { key: "nameAr", labelAr: "الحساب", labelEn: "Account" },
                          { key: "balance", labelAr: "الرصيد", labelEn: "Balance", numeric: true },
                        ],
                        rows: [...bs.liabilityLines, ...bs.equityLines].map((l) => ({
                          code: l.code,
                          nameAr: l.nameAr,
                          balance: fmtNum(l.balance),
                        })),
                        totalsRow: { code: "إجمالي الالتزامات وحقوق الملكية", balance: fmtNum(bs.liabilitiesPlusEquity) },
                      },
                    ],
                  });
                } else if (tb) {
                  void printUasDocument({
                    titleAr: "ميزان المراجعة العام",
                    titleEn: "General Trial Balance",
                    documentNumber: `RPT-TB-${new Date().toISOString().slice(0, 10)}`,
                    costCenter: ccLabel,
                    currency: "YER",
                    status: "POSTED",
                    format: "A4_LANDSCAPE",
                    letterhead,
                    summaryCards: [
                      { labelAr: "إجمالي المدين", labelEn: "Total Debits", value: `${fmtNum(tb.totalDebits)} YER`, tone: "emerald" },
                      { labelAr: "إجمالي الدائن", labelEn: "Total Credits", value: `${fmtNum(tb.totalCredits)} YER`, tone: "indigo" },
                      { labelAr: "الحالة", labelEn: "Status", value: tb.isBalanced ? "متوازن ✔" : `فرق ${fmtNum(tb.difference)}`, tone: tb.isBalanced ? "emerald" : "rose" },
                    ],
                    tables: [
                      {
                        headingAr: "أرصدة الحسابات",
                        headingEn: "Account Balances",
                        columns: [
                          { key: "code", labelAr: "الرمز", labelEn: "Code" },
                          { key: "nameAr", labelAr: "اسم الحساب", labelEn: "Account" },
                          { key: "level", labelAr: "الجيل", labelEn: "Gen", align: "center" },
                          { key: "totalDebit", labelAr: "مدين", labelEn: "Debit", numeric: true },
                          { key: "totalCredit", labelAr: "دائن", labelEn: "Credit", numeric: true },
                          { key: "netDebit", labelAr: "رصيد مدين", labelEn: "Net DR", numeric: true },
                          { key: "netCredit", labelAr: "رصيد دائن", labelEn: "Net CR", numeric: true },
                        ],
                        rows: tb.rows.map((r) => ({
                          code: r.code,
                          nameAr: r.nameAr,
                          level: `G${r.level}`,
                          totalDebit: fmtNum(r.totalDebit),
                          totalCredit: fmtNum(r.totalCredit),
                          netDebit: fmtNum(r.netDebit),
                          netCredit: fmtNum(r.netCredit),
                        })),
                        totalsRow: {
                          code: "الإجمالي",
                          totalDebit: fmtNum(tb.totalDebits),
                          totalCredit: fmtNum(tb.totalCredits),
                        },
                      },
                    ],
                  });
                }
              }}
              className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة PDF</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 text-xs no-print">
          <select
            value={costCenterFilter}
            onChange={(e) => setCostCenterFilter(e.target.value)}
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ALL">كافة مراكز التكلفة / All Cost Centers</option>
            {costCenterList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} • {c.nameAr}
              </option>
            ))}
          </select>
          <select
            value={localProjectId}
            onChange={(e) => {
              setProjectIdOverride(e.target.value);
              setSubProjectIdOverride("ALL");
            }}
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            dir="ltr"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            type="date"
            dir="ltr"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Sub-Report Switcher */}
        <div className="flex flex-wrap gap-2 text-xs no-print">
          {[
            { id: "tb" as const, label: "ميزان المراجعة (Trial Balance)" },
            { id: "pl" as const, label: "قائمة الدخل (Profit & Loss)" },
            { id: "bs" as const, label: "الميزانية العمومية (Balance Sheet)" },
            { id: "budget" as const, label: "الموازنة مقابل الفعلي (Budget Variance)" },
            { id: "cc" as const, label: "تقرير مراكز التكلفة (Cost Center P&L)" },
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

        {/* 5. COST CENTER P&L (تقرير مراكز التكلفة) */}
        {!loading && reportTab === "cc" && ccReport && (
          <div className="space-y-3" dir="rtl">
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800 font-extrabold">
                  <tr>
                    <th className="px-3 py-2">الرمز / Code</th>
                    <th className="px-3 py-2">مركز التكلفة / Cost Center</th>
                    <th className="px-3 py-2">الإيرادات / Revenue</th>
                    <th className="px-3 py-2">المصروفات / Expenses</th>
                    <th className="px-3 py-2">صافي الربح / Net</th>
                  </tr>
                </thead>
                <tbody>
                  {ccReport.rows.map((r) => (
                    <tr key={r.costCenterId ?? "none"} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-mono">{r.code}</td>
                      <td className="px-3 py-2 font-bold"><bdi>{r.nameAr}</bdi> <span className="text-slate-500">(<bdi>{r.nameEn}</bdi>)</span></td>
                      <td className="px-3 py-2 tabular-nums"><bdi dir="ltr">{fmtNum(r.revenue)}</bdi></td>
                      <td className="px-3 py-2 tabular-nums"><bdi dir="ltr">{fmtNum(r.expense)}</bdi></td>
                      <td className={`px-3 py-2 tabular-nums font-extrabold ${r.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}><bdi dir="ltr">{fmtNum(r.net)}</bdi></td>
                    </tr>
                  ))}
                  {ccReport.rows.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">لا توجد حركات على مراكز التكلفة / No cost-center activity</td></tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-slate-900 font-black">
                  <tr>
                    <td className="px-3 py-2" colSpan={2}>الإجمالي / Total</td>
                    <td className="px-3 py-2 tabular-nums"><bdi dir="ltr">{fmtNum(ccReport.totals.revenue)}</bdi></td>
                    <td className="px-3 py-2 tabular-nums"><bdi dir="ltr">{fmtNum(ccReport.totals.expense)}</bdi></td>
                    <td className="px-3 py-2 tabular-nums"><bdi dir="ltr">{fmtNum(ccReport.totals.net)}</bdi></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

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
                DR: <bdi dir="ltr">{fmtNum(tb.totalDebits)}</bdi> | CR: <bdi dir="ltr">{fmtNum(tb.totalCredits)}</bdi>
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
                      <td className="py-2 font-mono"><bdi dir="ltr">{fmtNum(r.totalDebit)}</bdi></td>
                      <td className="py-2 font-mono"><bdi dir="ltr">{fmtNum(r.totalCredit)}</bdi></td>
                      <td className="py-2 font-mono text-emerald-700 font-bold">
                        {r.netDebit > 0 ? <bdi dir="ltr">{fmtNum(r.netDebit)}</bdi> : "—"}
                      </td>
                      <td className="py-2 font-mono text-indigo-700 font-bold">
                        {r.netCredit > 0 ? <bdi dir="ltr">{fmtNum(r.netCredit)}</bdi> : "—"}
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
                <div className="text-lg font-black text-emerald-600"><bdi dir="ltr">{fmtNum(pl.totalRevenue)} YER</bdi></div>
              </div>
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">تكلفة الإنتاج والعمالة (COGS)</div>
                <div className="text-lg font-black text-amber-600"><bdi dir="ltr">{fmtNum(pl.totalCogs)} YER</bdi></div>
              </div>
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">المصروفات التشغيلية والإدارية</div>
                <div className="text-lg font-black text-rose-600">
                  <bdi dir="ltr">{fmtNum(pl.totalOperatingExpenses + pl.totalAdminExpenses)} YER</bdi>
                </div>
              </div>
              <div className="p-4 rounded-xl border space-y-1 bg-emerald-50/40 dark:bg-emerald-950/20">
                <div className="text-slate-500 font-bold">صافي الربح التشغيلي</div>
                <div className={`text-lg font-black ${pl.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  <bdi dir="ltr">{fmtNum(pl.netProfit)} YER</bdi>
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
                    <span className="font-bold"><bdi dir="ltr">{fmtNum(l.balance)} YER</bdi></span>
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
                    <span className="font-bold"><bdi dir="ltr">{fmtNum(l.balance)} YER</bdi></span>
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
                Assets: <bdi dir="ltr">{fmtNum(bs.totalAssets)}</bdi> = L+E: <bdi dir="ltr">{fmtNum(bs.liabilitiesPlusEquity)}</bdi>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-4 rounded-2xl border space-y-2">
                <h4 className="font-extrabold text-sm border-b pb-2 text-emerald-700">
                  الأصول (Assets) — الإجمالي: <bdi dir="ltr">{fmtNum(bs.totalAssets)} YER</bdi>
                </h4>
                {bs.assetLines.map((a) => (
                  <div key={a.code} className="flex justify-between py-1 border-b border-dashed">
                    <span>
                      <strong className="font-mono">{a.code}</strong> {a.nameAr}
                    </span>
                    <span className="font-bold"><bdi dir="ltr">{fmtNum(a.balance)} YER</bdi></span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-2xl border space-y-3">
                <div className="space-y-2">
                  <h4 className="font-extrabold text-sm border-b pb-2 text-amber-700">
                    الالتزامات (Liabilities) — <bdi dir="ltr">{fmtNum(bs.totalLiabilities)} YER</bdi>
                  </h4>
                  {bs.liabilityLines.map((l) => (
                    <div key={l.code} className="flex justify-between py-1 border-b border-dashed">
                      <span>
                        <strong className="font-mono">{l.code}</strong> {l.nameAr}
                      </span>
                      <span className="font-bold"><bdi dir="ltr">{fmtNum(l.balance)} YER</bdi></span>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 pt-2">
                  <h4 className="font-extrabold text-sm border-b pb-2 text-indigo-700">
                    حقوق الملكية (Equity) — <bdi dir="ltr">{fmtNum(bs.totalEquity)} YER</bdi>
                  </h4>
                  {bs.equityLines.map((eq) => (
                    <div key={eq.code} className="flex justify-between py-1 border-b border-dashed">
                      <span>
                        <strong className="font-mono">{eq.code}</strong> {eq.nameAr}
                      </span>
                      <span className="font-bold"><bdi dir="ltr">{fmtNum(eq.balance)} YER</bdi></span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 border-b border-dashed text-emerald-700 font-bold">
                    <span>
                      <strong className="font-mono">313101</strong> صافي نتيجة العام المالي الجاري
                    </span>
                    <span><bdi dir="ltr">{fmtNum(bs.currentYearNetProfit)} YER</bdi></span>
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
                      <td className="py-2.5 font-mono"><bdi dir="ltr">{fmtNum(p.budgetTotal)}</bdi></td>
                      <td className="py-2.5 font-mono text-amber-700 font-bold"><bdi dir="ltr">{fmtNum(p.actualCost)}</bdi></td>
                      <td className={`py-2.5 font-mono font-bold ${p.isOverBudget ? "text-rose-600" : "text-emerald-600"}`}>
                        <bdi dir="ltr">{fmtNum(p.variance)}</bdi>
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold ${
                            p.isOverBudget ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          <bdi dir="ltr">{p.utilizationPct.toFixed(1)}%</bdi>
                        </span>
                      </td>
                      <td className="py-2.5 font-mono text-emerald-700 font-bold"><bdi dir="ltr">{fmtNum(p.revenue)}</bdi></td>
                      <td className="py-2.5 font-mono font-extrabold"><bdi dir="ltr">{fmtNum(p.netProfit)}</bdi></td>
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
                            <td className="py-2.5 px-3 font-mono"><bdi dir="ltr">{fmtNum(budget)}</bdi></td>
                            <td className="py-2.5 px-3 font-mono text-amber-700 font-bold"><bdi dir="ltr">{fmtNum(sp.actualCost)}</bdi></td>
                            <td className={`py-2.5 px-3 font-mono font-bold ${sp.isOverBudget ? "text-rose-600" : "text-emerald-600"}`}>
                              <bdi dir="ltr">{fmtNum(sp.variance)}</bdi>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                                  sp.isOverBudget ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                <bdi dir="ltr">{sp.utilizationPct.toFixed(1)}%</bdi>
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-emerald-700 font-bold"><bdi dir="ltr">{fmtNum(sp.revenue)}</bdi></td>
                            <td className={`py-2.5 px-3 font-mono font-extrabold ${sp.netProfit >= 0 ? "text-slate-900" : "text-rose-600"}`}>
                              <bdi dir="ltr">{fmtNum(sp.netProfit)}</bdi>
                            </td>
                            <td className={`py-2.5 px-3 font-mono font-bold text-xs ${marginPct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                              <bdi dir="ltr">{marginPct.toFixed(1)}%</bdi>
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


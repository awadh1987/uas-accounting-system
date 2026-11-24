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
import { BarChart3, CheckCircle2, FileSpreadsheet, Printer, RefreshCw, Scale, AlertTriangle, X, Eye } from "lucide-react";
import { exportFinancialStatementsToExcel } from "@/lib/excelExport";
import { fmtNum } from "@/lib/formulas";
import { UasDateInput } from "@/components/UasDateInput";
import { formatRefreshTimestamp } from "@/lib/uiFormatters";
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
  comparative?: Omit<IncomeStatementPayload, "comparative"> | null;
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
  comparative?: Omit<BalanceSheetPayload, "comparative"> | null;
}

interface CashFlowPayload {
  indirectMethod: {
    netProfit: number;
    adjustments: { changeInReceivables: number; changeInInventory: number; changeInPayables: number };
    operatingCashFlow: number;
    investingCashFlow: number;
    financingCashFlow: number;
    netChangeInCash: number;
  };
  directMethod: {
    cashReceiptsFromCustomers: number;
    cashPaidToSuppliersAndExpenses: number;
    cashPaidToEmployees: number;
    operatingCashFlow: number;
    investingCashFlow: number;
    financingCashFlow: number;
  };
  reconciliation: { openingCashBalance: number; closingCashBalance: number; actualCashChange: number };
  comparative?: Omit<CashFlowPayload, "comparative"> | null;
}

interface ChangesInEquityPayload {
  openingEquity: number;
  capitalAndReserveMovements: number;
  netProfitForPeriod: number;
  closingEquity: number;
  equityBreakdown: Array<{ code: string; nameAr: string; balance: number }>;
}

interface AgingPayload {
  type: "AR" | "AP";
  asOfDate: string;
  rows: Array<{
    partyId: string;
    partyCode: string;
    partyName: string;
    current: number;
    days1_30: number;
    days31_60: number;
    days61_90: number;
    days90Plus: number;
    totalOpen: number;
    documentsCount: number;
  }>;
  totals: { current: number; days1_30: number; days31_60: number; days61_90: number; days90Plus: number; totalOpen: number };
}

interface StatementPayload {
  entityType: "CUSTOMER" | "VENDOR" | "ACCOUNT";
  code: string;
  titleAr: string;
  openingBalance: number;
  closingBalance: number;
  rows: Array<{
    lineId: string;
    entryNumber: string;
    date: string;
    reference?: string | null;
    sourceType?: string | null;
    memo?: string | null;
    debitBase: number;
    creditBase: number;
    runningBalance: number;
  }>;
}

interface TaxSummaryPayload {
  taxableSalesBase: number;
  taxablePurchasesBase: number;
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  whtPayable: number;
  comparative?: Omit<TaxSummaryPayload, "comparative"> | null;
}

interface FinancialRatiosPayload {
  liquidity: { currentAssets: number; currentLiabilities: number; currentRatio: number; quickRatio: number };
  profitability: { grossMarginPct: number; netMarginPct: number; returnOnAssetsPct: number };
  leverage: { debtToEquity: number };
  efficiency: { arDaysDso: number; apDaysDpo: number };
}

interface DrilldownLine {
  lineId: string;
  entryNumber: string;
  date: string;
  reference?: string | null;
  narrationAr: string;
  sourceType?: string | null;
  accountCode: string;
  accountNameAr: string;
  costCenterCode?: string | null;
  debitBase: number;
  creditBase: number;
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
  const [reportTab, setReportTab] = useState<
    "tb" | "pl" | "bs" | "cf" | "equity" | "aging" | "statements" | "tax" | "ratios" | "budget" | "cc"
  >("tb");
  const [costCenterFilter, setCostCenterFilter] = useState("ALL");
  const [costCenterList, setCostCenterList] = useState<Array<{ id: string; code: string; nameAr: string; generation: number }>>([]);
  const [ccReport, setCcReport] = useState<CostCenterReportPayload | null>(null);
  const [currencyDisplayMode, setCurrencyDisplayMode] = useState<"BASE_YER" | "TX_CURRENCY">("BASE_YER");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareFromDate, setCompareFromDate] = useState("");
  const [compareToDate, setCompareToDate] = useState("");
  const [projectIdOverride, setProjectIdOverride] = useState<string | null>(null);
  const [subProjectIdOverride, setSubProjectIdOverride] = useState<string | null>(null);

  const localProjectId = projectIdOverride ?? selectedProjectId ?? "ALL";
  const localSubProjectId = subProjectIdOverride ?? selectedSubProjectId ?? "ALL";
  const [coaLevel, setCoaLevel] = useState(6);

  const [tb, setTb] = useState<TrialBalancePayload | null>(null);
  const [pl, setPl] = useState<IncomeStatementPayload | null>(null);
  const [bs, setBs] = useState<BalanceSheetPayload | null>(null);
  const [cf, setCf] = useState<CashFlowPayload | null>(null);
  const [equityStmt, setEquityStmt] = useState<ChangesInEquityPayload | null>(null);
  const [agingType, setAgingType] = useState<"AR" | "AP">("AR");
  const [agingReport, setAgingReport] = useState<AgingPayload | null>(null);
  const [stmtType, setStmtType] = useState<"CUSTOMER" | "VENDOR" | "ACCOUNT">("CUSTOMER");
  const [stmtEntityId, setStmtEntityId] = useState("");
  const [stmtOptions, setStmtOptions] = useState<{
    customers: Array<{ id: string; code: string; nameAr: string }>;
    vendors: Array<{ id: string; code: string; nameAr: string }>;
    accounts: Array<{ id: string; code: string; nameAr: string }>;
  }>({ customers: [], vendors: [], accounts: [] });
  const [statement, setStatement] = useState<StatementPayload | null>(null);
  const [taxSummary, setTaxSummary] = useState<TaxSummaryPayload | null>(null);
  const [ratios, setRatios] = useState<FinancialRatiosPayload | null>(null);
  const [drilldownTitle, setDrilldownTitle] = useState<string | null>(null);
  const [drilldownLines, setDrilldownLines] = useState<DrilldownLine[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

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
    if (compareEnabled && compareFromDate) qs.set("compareFromDate", compareFromDate);
    if (compareEnabled && compareToDate) qs.set("compareToDate", compareToDate);
    qs.set("level", String(coaLevel));

    Promise.all([
      fetch(`/api/accounting/reports/trial-balance?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/income-statement?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/balance-sheet?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/cost-centers?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/cash-flow?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/changes-in-equity?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/aging?type=${agingType}&${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/tax-summary?${qs.toString()}`, { cache: "no-store" }),
      fetch(`/api/accounting/reports/ratios?${qs.toString()}`, { cache: "no-store" }),
    ])
      .then(async ([tbRes, plRes, bsRes, ccRes, cfRes, eqRes, agRes, taxRes, ratRes]) => {
        if (!active) return;
        if (tbRes.ok) setTb((await tbRes.json()) as TrialBalancePayload);
        if (plRes.ok) setPl((await plRes.json()) as IncomeStatementPayload);
        if (bsRes.ok) setBs((await bsRes.json()) as BalanceSheetPayload);
        if (ccRes.ok) setCcReport((await ccRes.json()) as CostCenterReportPayload);
        if (cfRes.ok) setCf((await cfRes.json()) as CashFlowPayload);
        if (eqRes.ok) setEquityStmt((await eqRes.json()) as ChangesInEquityPayload);
        if (agRes.ok) setAgingReport((await agRes.json()) as AgingPayload);
        if (taxRes.ok) setTaxSummary((await taxRes.json()) as TaxSummaryPayload);
        if (ratRes.ok) setRatios((await ratRes.json()) as FinancialRatiosPayload);
        setLastRefreshedAt(new Date().toISOString());
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
  }, [
    fromDate,
    toDate,
    compareEnabled,
    compareFromDate,
    compareToDate,
    localProjectId,
    localSubProjectId,
    costCenterFilter,
    coaLevel,
    agingType,
    refreshTick,
    onToast,
  ]);

  useEffect(() => {
    fetch("/api/accounting/reports/statements", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStmtOptions({ customers: d.customers || [], vendors: d.vendors || [], accounts: d.accounts || [] });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!stmtEntityId) return;
    let active = true;
    const qs = new URLSearchParams({ entityType: stmtType, entityId: stmtEntityId });
    if (fromDate) qs.set("fromDate", fromDate);
    if (toDate) qs.set("toDate", toDate);
    fetch(`/api/accounting/reports/statements?${qs.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active) setStatement(d);
      })
      .catch(() => {
        if (active) setStatement(null);
      });
    return () => {
      active = false;
    };
  }, [stmtType, stmtEntityId, fromDate, toDate]);

  async function openAccountDrilldown(accountCode: string, accountNameAr: string) {
    setDrilldownTitle(`${accountCode} — ${accountNameAr}`);
    setDrilldownLoading(true);
    setDrilldownLines([]);
    try {
      const qs = new URLSearchParams({ accountCode });
      if (fromDate) qs.set("fromDate", fromDate);
      if (toDate) qs.set("toDate", toDate);
      if (localProjectId && localProjectId !== "ALL") qs.set("projectId", localProjectId);
      if (localSubProjectId && localSubProjectId !== "ALL") qs.set("subProjectId", localSubProjectId);
      if (costCenterFilter && costCenterFilter !== "ALL") qs.set("costCenterId", costCenterFilter);
      const res = await fetch(`/api/accounting/reports/drilldown?${qs.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { lines?: DrilldownLine[] };
        setDrilldownLines(d.lines || []);
      }
    } finally {
      setDrilldownLoading(false);
    }
  }

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
            <div className="md:hidden w-full sm:w-auto">
              <select
                data-testid="financial-currency-mode-select"
                aria-label="وضع عرض العملة"
                value={currencyDisplayMode}
                onChange={(e) => setCurrencyDisplayMode(e.target.value as "BASE_YER" | "TX_CURRENCY")}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <option value="BASE_YER">عملة الأساس (YER)</option>
                <option value="TX_CURRENCY">عملة المعاملة (FX)</option>
              </select>
            </div>
            <div className="hidden md:inline-flex rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden text-[11px] font-bold">
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
            {lastRefreshedAt && (
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                {formatRefreshTimestamp(lastRefreshedAt)}
              </span>
            )}
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setRefreshTick((t) => t + 1);
                onToast("✅ جاري تحديث القوائم والتقارير المالية...");
              }}
              className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>تحديث</span>
            </button>
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
          <UasDateInput
            value={fromDate}
            onChange={setFromDate}
            placeholder="من: يوم / شهر / سنة"
            ariaLabel="من تاريخ"
          />
          <UasDateInput
            value={toDate}
            onChange={setToDate}
            placeholder="إلى: يوم / شهر / سنة"
            ariaLabel="إلى تاريخ"
          />
        </div>

        {/* Comparative Period Bar */}
        <div className="flex flex-wrap items-center gap-3 text-xs no-print">
          <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) => setCompareEnabled(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span>مقارنة بفترة سابقة (Comparative Period)</span>
          </label>
          {compareEnabled && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">من:</span>
              <UasDateInput
                value={compareFromDate}
                onChange={setCompareFromDate}
                placeholder="من: يوم / شهر / سنة"
                ariaLabel="بداية الفترة المقارنة"
              />
              <span className="text-slate-500">إلى:</span>
              <UasDateInput
                value={compareToDate}
                onChange={setCompareToDate}
                placeholder="إلى: يوم / شهر / سنة"
                ariaLabel="نهاية الفترة المقارنة"
              />
            </div>
          )}
        </div>

        {/* Sub-Report Switcher */}
        <div className="no-print">
          <div className="md:hidden">
            <select
              data-testid="financial-report-tab-select"
              aria-label="اختر التقرير المالي"
              value={reportTab}
              onChange={(e) => setReportTab(e.target.value as typeof reportTab)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-extrabold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <option value="tb">ميزان المراجعة (Trial Balance)</option>
              <option value="pl">قائمة الدخل (Profit &amp; Loss)</option>
              <option value="bs">الميزانية العمومية (Balance Sheet)</option>
              <option value="cf">التدفقات النقدية (Cash Flow IAS 7)</option>
              <option value="equity">التغيرات في حقوق الملكية</option>
              <option value="aging">أعمار الذمم (AR/AP Aging)</option>
              <option value="statements">كشوف الحسابات التفصيلية</option>
              <option value="tax">ملخص الضرائب (VAT / WHT)</option>
              <option value="ratios">المؤشرات والنسب المالية</option>
              <option value="budget">الموازنة مقابل الفعلي (Budget Variance)</option>
              <option value="cc">تقرير مراكز التكلفة (Cost Center P&amp;L)</option>
            </select>
          </div>
          <div className="hidden md:flex flex-wrap gap-2 text-xs">
            {[
              { id: "tb" as const, label: "ميزان المراجعة (Trial Balance)" },
              { id: "pl" as const, label: "قائمة الدخل (Profit & Loss)" },
              { id: "bs" as const, label: "الميزانية العمومية (Balance Sheet)" },
              { id: "cf" as const, label: "التدفقات النقدية (Cash Flow IAS 7)" },
              { id: "equity" as const, label: "التغيرات في حقوق الملكية" },
              { id: "aging" as const, label: "أعمار الذمم (AR/AP Aging)" },
              { id: "statements" as const, label: "كشوف الحسابات التفصيلية" },
              { id: "tax" as const, label: "ملخص الضرائب (VAT / WHT)" },
              { id: "ratios" as const, label: "المؤشرات والنسب المالية" },
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
                    <tr
                      key={r.id}
                      onClick={() => void openAccountDrilldown(r.code, r.nameAr)}
                      className={`cursor-pointer hover:bg-emerald-50/50 dark:hover:bg-slate-800/70 transition-colors ${
                        r.level <= 2 ? "font-extrabold bg-slate-50/70 dark:bg-slate-800/50" : ""
                      }`}
                    >
                      <td className="py-2 font-mono text-sky-700 underline decoration-dotted">{r.code}</td>
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
                <h4 className="font-extrabold text-sm border-b pb-2 text-emerald-700 flex justify-between">
                  <span>بنود الإيرادات (Revenue)</span>
                  {pl.comparative && <span className="text-[11px] text-slate-500">مقابل المقارنة</span>}
                </h4>
                {pl.revenueLines.map((l) => {
                  const cmp = pl.comparative?.revenueLines.find((c) => c.code === l.code)?.balance ?? 0;
                  return (
                    <div
                      key={l.code}
                      onClick={() => void openAccountDrilldown(l.code, l.nameAr)}
                      className="flex justify-between py-1 border-b border-dashed cursor-pointer hover:bg-emerald-50/40"
                    >
                      <span>
                        <strong className="font-mono text-sky-700 underline decoration-dotted">{l.code}</strong> {l.nameAr}
                      </span>
                      <span className="font-bold">
                        <bdi dir="ltr">{fmtNum(l.balance)} YER</bdi>
                        {pl.comparative && <span className="text-[11px] text-slate-500 mr-2">(<bdi dir="ltr">{fmtNum(cmp)}</bdi>)</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="p-4 rounded-2xl border space-y-2">
                <h4 className="font-extrabold text-sm border-b pb-2 text-rose-700 flex justify-between">
                  <span>بنود التكاليف والمصروفات (Costs &amp; Expenses)</span>
                  {pl.comparative && <span className="text-[11px] text-slate-500">مقابل المقارنة</span>}
                </h4>
                {[...pl.cogsLines, ...pl.operatingExpenseLines, ...pl.adminExpenseLines].map((l) => {
                  const cmpLines = pl.comparative
                    ? [...pl.comparative.cogsLines, ...pl.comparative.operatingExpenseLines, ...pl.comparative.adminExpenseLines]
                    : [];
                  const cmp = cmpLines.find((c) => c.code === l.code)?.balance ?? 0;
                  return (
                    <div
                      key={l.code}
                      onClick={() => void openAccountDrilldown(l.code, l.nameAr)}
                      className="flex justify-between py-1 border-b border-dashed cursor-pointer hover:bg-rose-50/40"
                    >
                      <span>
                        <strong className="font-mono text-sky-700 underline decoration-dotted">{l.code}</strong> {l.nameAr}
                      </span>
                      <span className="font-bold">
                        <bdi dir="ltr">{fmtNum(l.balance)} YER</bdi>
                        {pl.comparative && <span className="text-[11px] text-slate-500 mr-2">(<bdi dir="ltr">{fmtNum(cmp)}</bdi>)</span>}
                      </span>
                    </div>
                  );
                })}
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
                {bs.assetLines.map((a) => {
                  const cmp = bs.comparative?.assetLines.find((c) => c.code === a.code)?.balance ?? 0;
                  return (
                    <div
                      key={a.code}
                      onClick={() => void openAccountDrilldown(a.code, a.nameAr)}
                      className="flex justify-between py-1 border-b border-dashed cursor-pointer hover:bg-emerald-50/40"
                    >
                      <span>
                        <strong className="font-mono text-sky-700 underline decoration-dotted">{a.code}</strong> {a.nameAr}
                      </span>
                      <span className="font-bold">
                        <bdi dir="ltr">{fmtNum(a.balance)} YER</bdi>
                        {bs.comparative && <span className="text-[11px] text-slate-500 mr-2">(<bdi dir="ltr">{fmtNum(cmp)}</bdi>)</span>}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 rounded-2xl border space-y-3">
                <div className="space-y-2">
                  <h4 className="font-extrabold text-sm border-b pb-2 text-amber-700">
                    الالتزامات (Liabilities) — <bdi dir="ltr">{fmtNum(bs.totalLiabilities)} YER</bdi>
                  </h4>
                  {bs.liabilityLines.map((l) => (
                    <div
                      key={l.code}
                      onClick={() => void openAccountDrilldown(l.code, l.nameAr)}
                      className="flex justify-between py-1 border-b border-dashed cursor-pointer hover:bg-amber-50/40"
                    >
                      <span>
                        <strong className="font-mono text-sky-700 underline decoration-dotted">{l.code}</strong> {l.nameAr}
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
                    <div
                      key={eq.code}
                      onClick={() => void openAccountDrilldown(eq.code, eq.nameAr)}
                      className="flex justify-between py-1 border-b border-dashed cursor-pointer hover:bg-indigo-50/40"
                    >
                      <span>
                        <strong className="font-mono text-sky-700 underline decoration-dotted">{eq.code}</strong> {eq.nameAr}
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

        {/* 6. CASH FLOW STATEMENT (IAS 7) */}
        {!loading && reportTab === "cf" && cf && (
          <div className="space-y-4 text-xs" dir="rtl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">التدفق التشغيلي (غير مباشر)</div>
                <div className="text-lg font-black text-emerald-700"><bdi dir="ltr">{fmtNum(cf.indirectMethod.operatingCashFlow)} YER</bdi></div>
              </div>
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">الرصيد النقدي الافتتاحي → الختامي</div>
                <div className="text-sm font-black"><bdi dir="ltr">{fmtNum(cf.reconciliation.openingCashBalance)} → {fmtNum(cf.reconciliation.closingCashBalance)} YER</bdi></div>
              </div>
              <div className="p-4 rounded-xl border space-y-1">
                <div className="text-slate-500 font-bold">صافي التغير النقدي</div>
                <div className="text-lg font-black text-sky-700"><bdi dir="ltr">{fmtNum(cf.indirectMethod.netChangeInCash)} YER</bdi></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl border space-y-2">
                <h4 className="font-extrabold border-b pb-2">الطريقة غير المباشرة (Indirect Method)</h4>
                <div className="flex justify-between py-1"><span>صافي الربح</span><strong className="font-mono"><bdi dir="ltr">{fmtNum(cf.indirectMethod.netProfit)}</bdi></strong></div>
                <div className="flex justify-between py-1"><span>التغير في المدينين والأرصدة المدينة</span><strong className="font-mono"><bdi dir="ltr">{fmtNum(cf.indirectMethod.adjustments.changeInReceivables)}</bdi></strong></div>
                <div className="flex justify-between py-1"><span>التغير في المخزون</span><strong className="font-mono"><bdi dir="ltr">{fmtNum(cf.indirectMethod.adjustments.changeInInventory)}</bdi></strong></div>
                <div className="flex justify-between py-1"><span>التغير في الدائنين</span><strong className="font-mono"><bdi dir="ltr">{fmtNum(cf.indirectMethod.adjustments.changeInPayables)}</bdi></strong></div>
                <div className="flex justify-between py-1 border-t font-bold"><span>الأنشطة الاستثمارية</span><span className="font-mono"><bdi dir="ltr">{fmtNum(cf.indirectMethod.investingCashFlow)}</bdi></span></div>
                <div className="flex justify-between py-1"><span>الأنشطة التمويلية</span><span className="font-mono"><bdi dir="ltr">{fmtNum(cf.indirectMethod.financingCashFlow)}</bdi></span></div>
              </div>
              <div className="p-4 rounded-2xl border space-y-2">
                <h4 className="font-extrabold border-b pb-2">الطريقة المباشرة (Direct Method)</h4>
                <div className="flex justify-between py-1"><span>متحصلات نقدية من العملاء</span><strong className="font-mono text-emerald-700"><bdi dir="ltr">{fmtNum(cf.directMethod.cashReceiptsFromCustomers)}</bdi></strong></div>
                <div className="flex justify-between py-1"><span>مدفوعات للموردين والمصروفات</span><strong className="font-mono text-rose-700"><bdi dir="ltr">{fmtNum(cf.directMethod.cashPaidToSuppliersAndExpenses)}</bdi></strong></div>
                <div className="flex justify-between py-1"><span>مدفوعات لأجور العمالة</span><strong className="font-mono text-rose-700"><bdi dir="ltr">{fmtNum(cf.directMethod.cashPaidToEmployees)}</bdi></strong></div>
                <div className="flex justify-between py-1 border-t font-black"><span>صافي النقد التشغيلي المباشر</span><span className="font-mono"><bdi dir="ltr">{fmtNum(cf.directMethod.operatingCashFlow)}</bdi></span></div>
              </div>
            </div>
          </div>
        )}

        {/* 7. STATEMENT OF CHANGES IN EQUITY */}
        {!loading && reportTab === "equity" && equityStmt && (
          <div className="p-4 rounded-2xl border space-y-2 text-xs" dir="rtl">
            <h4 className="font-extrabold text-sm border-b pb-2">قائمة التغيرات في حقوق الملكية (Statement of Changes in Equity)</h4>
            <div className="flex justify-between py-1.5"><span>رصيد حقوق الملكية في بداية الفترة</span><strong className="font-mono"><bdi dir="ltr">{fmtNum(equityStmt.openingEquity)} YER</bdi></strong></div>
            <div className="flex justify-between py-1.5"><span>إضافات / حركات رأس المال والاحتياطيات</span><strong className="font-mono"><bdi dir="ltr">{fmtNum(equityStmt.capitalAndReserveMovements)} YER</bdi></strong></div>
            <div className="flex justify-between py-1.5"><span>صافي ربح (خسارة) الفترة</span><strong className="font-mono text-emerald-700"><bdi dir="ltr">{fmtNum(equityStmt.netProfitForPeriod)} YER</bdi></strong></div>
            <div className="flex justify-between py-2 border-t font-black text-sm"><span>إجمالي حقوق الملكية في نهاية الفترة</span><span className="font-mono"><bdi dir="ltr">{fmtNum(equityStmt.closingEquity)} YER</bdi></span></div>
          </div>
        )}

        {/* 8. AR / AP AGING REPORT */}
        {!loading && reportTab === "aging" && agingReport && (
          <div className="space-y-3 text-xs" dir="rtl">
            <div className="flex gap-2">
              <button onClick={() => setAgingType("AR")} className={`px-3 py-1.5 rounded-xl font-bold ${agingType === "AR" ? "accent-bg" : "border border-slate-300"}`}>أعمار ذمم العملاء (AR)</button>
              <button onClick={() => setAgingType("AP")} className={`px-3 py-1.5 rounded-xl font-bold ${agingType === "AP" ? "accent-bg" : "border border-slate-300"}`}>أعمار ذمم الموردين (AP)</button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-right">
                <thead className="bg-slate-50 font-extrabold border-b">
                  <tr>
                    <th className="p-2.5">الطرف</th>
                    <th className="p-2.5">جاري (Current)</th>
                    <th className="p-2.5">1-30 يوم</th>
                    <th className="p-2.5">31-60 يوم</th>
                    <th className="p-2.5">61-90 يوم</th>
                    <th className="p-2.5">+90 يوم</th>
                    <th className="p-2.5">الإجمالي المفتوح</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {agingReport.rows.map((r) => (
                    <tr key={r.partyId}>
                      <td className="p-2.5 font-bold">{r.partyCode} • {r.partyName}</td>
                      <td className="p-2.5 font-mono"><bdi dir="ltr">{fmtNum(r.current)}</bdi></td>
                      <td className="p-2.5 font-mono"><bdi dir="ltr">{fmtNum(r.days1_30)}</bdi></td>
                      <td className="p-2.5 font-mono"><bdi dir="ltr">{fmtNum(r.days31_60)}</bdi></td>
                      <td className="p-2.5 font-mono"><bdi dir="ltr">{fmtNum(r.days61_90)}</bdi></td>
                      <td className="p-2.5 font-mono text-rose-700 font-bold"><bdi dir="ltr">{fmtNum(r.days90Plus)}</bdi></td>
                      <td className="p-2.5 font-mono font-black"><bdi dir="ltr">{fmtNum(r.totalOpen)}</bdi></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 9. CUSTOMER / VENDOR / ACCOUNT STATEMENTS */}
        {!loading && reportTab === "statements" && (
          <div className="space-y-3 text-xs" dir="rtl">
            <div className="flex flex-wrap gap-2">
              <select value={stmtType} onChange={(e) => { setStmtType(e.target.value as "CUSTOMER" | "VENDOR" | "ACCOUNT"); setStmtEntityId(""); setStatement(null); }} className="rounded-xl border px-3 py-2 font-bold">
                <option value="CUSTOMER">كشف حساب عميل (Customer)</option>
                <option value="VENDOR">كشف حساب مورد (Vendor)</option>
                <option value="ACCOUNT">كشف حساب أستاذ عام (GL Account)</option>
              </select>
              <select value={stmtEntityId} onChange={(e) => { const nextId = e.target.value; setStmtEntityId(nextId); if (!nextId) setStatement(null); }} className="rounded-xl border px-3 py-2 font-bold min-w-[220px]">
                <option value="">-- اختر الحساب --</option>
                {(stmtType === "CUSTOMER" ? stmtOptions.customers : stmtType === "VENDOR" ? stmtOptions.vendors : stmtOptions.accounts).map((o) => (
                  <option key={o.id} value={o.id}>{o.code} • {o.nameAr}</option>
                ))}
              </select>
            </div>
            {stmtEntityId && statement && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex justify-between font-bold">
                  <span>{statement.code} — {statement.titleAr}</span>
                  <span>الرصيد الافتتاحي: <bdi dir="ltr">{fmtNum(statement.openingBalance)}</bdi> | الختامي: <bdi dir="ltr">{fmtNum(statement.closingBalance)} YER</bdi></span>
                </div>
                <table className="w-full text-right">
                  <thead className="bg-slate-50 border-b font-extrabold">
                    <tr><th className="p-2">التاريخ</th><th className="p-2">القيد</th><th className="p-2">البيان</th><th className="p-2">مدين</th><th className="p-2">دائن</th><th className="p-2">الرصيد التراكمي</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {statement.rows.map((r) => (
                      <tr key={r.lineId}>
                        <td className="p-2 font-mono">{r.date.slice(0, 10)}</td>
                        <td className="p-2 font-mono">{r.entryNumber}</td>
                        <td className="p-2">{r.memo}</td>
                        <td className="p-2 font-mono text-emerald-700"><bdi dir="ltr">{fmtNum(r.debitBase)}</bdi></td>
                        <td className="p-2 font-mono text-rose-700"><bdi dir="ltr">{fmtNum(r.creditBase)}</bdi></td>
                        <td className="p-2 font-mono font-black"><bdi dir="ltr">{fmtNum(r.runningBalance)}</bdi></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 10. TAX SUMMARY (VAT & WHT) */}
        {!loading && reportTab === "tax" && taxSummary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs" dir="rtl">
            <div className="p-4 rounded-xl border space-y-1">
              <div className="text-slate-500 font-bold">ضريبة المخرجات المستحقة (Output VAT 214101)</div>
              <div className="text-lg font-black text-rose-700"><bdi dir="ltr">{fmtNum(taxSummary.outputVat)} YER</bdi></div>
            </div>
            <div className="p-4 rounded-xl border space-y-1">
              <div className="text-slate-500 font-bold">ضريبة المدخلات القابلة للخصم (Input VAT 114301)</div>
              <div className="text-lg font-black text-emerald-700"><bdi dir="ltr">{fmtNum(taxSummary.inputVat)} YER</bdi></div>
            </div>
            <div className="p-4 rounded-xl border space-y-1">
              <div className="text-slate-500 font-bold">صافي الضريبة واجبة السداد | ضريبة الاستقطاع (214201)</div>
              <div className="text-lg font-black text-indigo-700"><bdi dir="ltr">{fmtNum(taxSummary.netVatPayable)} | WHT: {fmtNum(taxSummary.whtPayable)} YER</bdi></div>
            </div>
          </div>
        )}

        {/* 11. FINANCIAL RATIOS */}
        {!loading && reportTab === "ratios" && ratios && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs" dir="rtl">
            <div className="p-4 rounded-xl border"><div className="text-slate-500 font-bold">نسبة التداول (Current Ratio)</div><div className="text-lg font-black">{ratios.liquidity.currentRatio.toFixed(2)}x</div></div>
            <div className="p-4 rounded-xl border"><div className="text-slate-500 font-bold">السيولة السريعة (Quick Ratio)</div><div className="text-lg font-black">{ratios.liquidity.quickRatio.toFixed(2)}x</div></div>
            <div className="p-4 rounded-xl border"><div className="text-slate-500 font-bold">هامش الربح الإجمالي / الصافي</div><div className="text-lg font-black text-emerald-700">{ratios.profitability.grossMarginPct.toFixed(1)}% / {ratios.profitability.netMarginPct.toFixed(1)}%</div></div>
            <div className="p-4 rounded-xl border"><div className="text-slate-500 font-bold">أيام التحصيل DSO / السداد DPO</div><div className="text-lg font-black">{ratios.efficiency.arDaysDso.toFixed(0)} / {ratios.efficiency.apDaysDpo.toFixed(0)} يوم</div></div>
          </div>
        )}
      </div>

      {/* GL Account & Voucher Drill-Down Modal */}
      {drilldownTitle && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir="rtl">
          <div className="card-surface bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl border">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2 font-extrabold text-sm">
                <Eye className="w-4 h-4 text-emerald-600" />
                <span>تحليل حركات الحساب (Drill-Down): {drilldownTitle}</span>
              </div>
              <button onClick={() => setDrilldownTitle(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-xs">
              {drilldownLoading ? (
                <div className="py-8 text-center text-slate-500">جاري تحميل حركات الأستاذ العام...</div>
              ) : drilldownLines.length === 0 ? (
                <div className="py-8 text-center text-slate-500">لا توجد قيود مرحلة ضمن النطاق المحدد.</div>
              ) : (
                <table className="w-full text-right border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800 border-b font-extrabold">
                    <tr>
                      <th className="p-2">التاريخ</th>
                      <th className="p-2">رقم القيد</th>
                      <th className="p-2">المرجع / المصدر</th>
                      <th className="p-2">البيان</th>
                      <th className="p-2">مدين (YER)</th>
                      <th className="p-2">دائن (YER)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {drilldownLines.map((l) => (
                      <tr key={l.lineId}>
                        <td className="p-2 font-mono">{l.date.slice(0, 10)}</td>
                        <td className="p-2 font-mono font-bold">{l.entryNumber}</td>
                        <td className="p-2 font-mono text-[11px]">{l.reference || l.sourceType || "—"}</td>
                        <td className="p-2">{l.narrationAr}</td>
                        <td className="p-2 font-mono text-emerald-700 font-bold"><bdi dir="ltr">{fmtNum(l.debitBase)}</bdi></td>
                        <td className="p-2 font-mono text-rose-700 font-bold"><bdi dir="ltr">{fmtNum(l.creditBase)}</bdi></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}


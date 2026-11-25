"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  Package,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
import { CostCenterSelector } from "@/components/CostCenterSelector";
import { SaveDraftButton } from "@/components/SaveDraftButton";
import { SelectWithOther } from "@/components/SelectWithOther";
import { ActionOverflowMenu } from "@/components/ActionOverflowMenu";
import { TenantClientPortalAdminPanel } from "@/components/portal-admin/TenantClientPortalAdminPanel";
import { UasDateInput } from "@/components/UasDateInput";
import { PhoneContactInput } from "@/components/PhoneContactInput";
import {
  AccountingDirectionSelector,
  type CustomAccountPayload,
  type AccountingDirectionValue,
} from "@/components/AccountingDirectionSelector";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import { evaluateSaleAgainstHarvestStock } from "@/lib/harvestReconciliation";
import { formatIsoToDmy, formatRefreshTimestamp } from "@/lib/uiFormatters";
import { filterOutSyntheticTestRecords, isSyntheticTestRecord } from "@/lib/testRecordHygiene";
import {
  printUasDocument,
  resolveLetterheadFromProfile,
} from "@/lib/print/uasDocumentPrinter";
import type {
  UasEnterpriseProfile,
  UasInventoryBatch,
  UasProject,
  UasSaleTransaction,
  UasTreasuryAccount,
  UasUser,
} from "@/types/uas";

interface QuickCustomerOption {
  id: string;
  code: string;
  nameAr: string;
  phone: string;
}

export type SalePayload = {
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  batch: string;
  dailyBatchLabel?: string;
  sequenceNumber?: string;
  salesOfficerId?: string;
  salesOfficerTitle?: string;
  revenueAccountCode?: string;
  treasuryAccountId?: string;
  customAccount?: CustomAccountPayload;
  grade: string;
  customer: string;
  phone: string;
  bundles: number;
  price: number;
  credit: number;
  date: string;
  voucherNo: string;
  notes: string;
  costCenterId?: string | null;
  allowNegativeStock?: boolean;
};

interface SalesTabProps {
  projects: UasProject[];
  sales: UasSaleTransaction[];
  inventoryBatches?: UasInventoryBatch[];
  treasuryAccounts?: UasTreasuryAccount[];
  currentUser?: UasUser;
  enterpriseProfile?: UasEnterpriseProfile | null;
  readOnly?: boolean;
  canEditRecords?: boolean;
  canEditDate?: boolean;
  onAddSale: (payload: SalePayload) => Promise<boolean>;
  onEditSale?: (id: string, payload: SalePayload) => Promise<boolean>;
  onDeleteSale: (id: string) => Promise<void>;
  onOpenSaleVoucher: (s: UasSaleTransaction) => void;
  onOpenClientPortalAdmin?: () => void;
  onRefreshState?: () => Promise<void>;
  onToast: (msg: string) => void;
}

const PRESET_GRADES = [
  "رقم 1",
  "رقم 2",
  "رقم 3",
  "روس",
  "بزغة",
  "ميكس (رقم 1/2/3)",
  "أخرى (تحديد مخصص)",
];

export function SalesTab({
  projects,
  sales,
  inventoryBatches = [],
  treasuryAccounts = [],
  currentUser,
  enterpriseProfile,
  readOnly = false,
  canEditRecords = false,
  canEditDate = false,
  onAddSale,
  onEditSale,
  onDeleteSale,
  onOpenSaleVoucher,
  onOpenClientPortalAdmin,
  onRefreshState,
  onToast,
}: SalesTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "");
  const [subProjectId, setSubProjectId] = useState<string>("");

  // Concurrent Multi-Officer Sales Fields
  const [sequenceNumber, setSequenceNumber] = useState("");
  const [dailyBatchLabel, setDailyBatchLabel] = useState("");
  const [batch, setBatch] = useState("");
  const [salesOfficerId, setSalesOfficerId] = useState(currentUser?.id || "");
  const [salesOfficerTitle, setSalesOfficerTitle] = useState(
    currentUser?.name
      ? `${currentUser.name} (${currentUser.role || "مسؤول"})`
      : "مسؤول المبيعات"
  );
  const [revenueAccountCode, setRevenueAccountCode] = useState("411101");
  const [customRevenueAccount, setCustomRevenueAccount] = useState<CustomAccountPayload | undefined>();
  const [treasuryAccountId, setTreasuryAccountId] = useState(treasuryAccounts[0]?.id || "t1");

  // Dynamic Grade
  const [selectedGradePreset, setSelectedGradePreset] = useState("رقم 1");
  const [customGradeText, setCustomGradeText] = useState("");

  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [bundles, setBundles] = useState("");
  const [price, setPrice] = useState("");
  const [credit, setCredit] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [voucherNo, setVoucherNo] = useState("");
  const [notes, setNotes] = useState("");
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);

  const canOverrideStock =
    currentUser?.role === "SUPER_ADMIN" || currentUser?.role === "CHIEF_ACCOUNTANT";

  const activeGradeForCheck =
    selectedGradePreset === "أخرى (تحديد مخصص)"
      ? customGradeText.trim() || "درجة مخصصة"
      : selectedGradePreset;

  const [costCenterId, setCostCenterId] = useState("");
  const [salesSubView, setSalesSubView] = useState<"sales" | "portal">("sales");

  // Filters
  const [filterProject, setFilterProject] = useState("ALL");
  const [filterSubProject, setFilterSubProject] = useState("ALL");
  const [filterOfficer, setFilterOfficer] = useState("ALL");
  const [filterDate, setFilterDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [hideTestRecords, setHideTestRecords] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clientOptions, setClientOptions] = useState<QuickCustomerOption[]>([]);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [portalDraftOrders, setPortalDraftOrders] = useState<
    Array<{
      id: string;
      draftNumber: string;
      titleAr: string;
      status: string;
      totalAmount: number;
      payload: {
        portalRequestId?: string;
        requestNumber?: string;
        customerId?: string;
        customer?: string;
        customerAccountCode?: string;
        phone?: string;
        projectId?: string;
        subProjectId?: string | null;
        harvest?: string;
        pickupLocation?: string;
        grade?: string;
        bundles?: number;
        price?: number;
        amount?: number;
        credit?: number;
        debitReceivable?: number;
        treasuryAccountId?: string | null;
        date?: string;
        notes?: string;
        lines?: Array<{
          itemTitle: string;
          qty: number;
          unitLabel: string;
          unitPrice: number;
          lineTotal: number;
        }>;
      };
    }>
  >([]);
  const [handingOverDraftId, setHandingOverDraftId] = useState<string | null>(null);

  const liveStockCheck = useMemo(() => {
    const pid = activeProj?.id || projectId;
    const harv =
      activeProj?.harvests.includes(harvest) ? harvest : activeProj?.harvests[0] || "القطفة الأولى";
    return evaluateSaleAgainstHarvestStock({
      batches: inventoryBatches,
      sales,
      projectId: pid,
      subProjectId: subProjectId || undefined,
      harvest: harv,
      grade: activeGradeForCheck,
      requestedBundles: Number(bundles) || 0,
      excludeSaleId: editingId || undefined,
    });
  }, [
    inventoryBatches,
    sales,
    activeProj,
    projectId,
    subProjectId,
    harvest,
    activeGradeForCheck,
    bundles,
    editingId,
  ]);

  useEffect(() => {
    let active = true;
    fetch("/api/sales/customers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { customers?: QuickCustomerOption[] } | null) => {
        if (active && data?.customers) setClientOptions(data.customers);
      })
      .catch(() => null);

    fetch("/api/drafts?module=SALES&status=ACTIVE_DRAFT", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { drafts?: typeof portalDraftOrders } | null) => {
        if (active && Array.isArray(data?.drafts)) {
          setPortalDraftOrders(data.drafts.filter((d) => Boolean(d.payload?.portalRequestId)));
        }
      })
      .catch(() => null);

    return () => {
      active = false;
    };
  }, [sales]);

  const preview = computeSaleTotals(Number(bundles), Number(price), Number(credit));

  // Available Officers for filtering
  const officerOptions = useMemo(() => {
    const set = new Set<string>();
    sales.forEach((s) => {
      if (s.salesOfficerTitle) set.add(s.salesOfficerTitle);
    });
    return Array.from(set);
  }, [sales]);

  function handleProjChange(nextPid: string) {
    setProjectId(nextPid);
    setSubProjectId("");
    const p = projects.find((x) => x.id === nextPid);
    if (p && p.harvests.length > 0) setHarvest(p.harvests[0]);
  }

  function openCreateDrawer() {
    setEditingId(null);
    const defProj = projects[0];
    setProjectId(defProj?.id || "");
    setSubProjectId("");
    setHarvest(defProj?.harvests[0] || "");

    const year = new Date().getFullYear();
    const nextSeq = `SO-${year}-${String(sales.length + 1).padStart(4, "0")}`;
    setSequenceNumber(nextSeq);
    setDailyBatchLabel("");
    setBatch(nextSeq);

    const defaultTitle = currentUser?.name
      ? `${currentUser.name} (${currentUser.role || "مسؤول"})`
      : "مسؤول المبيعات";
    setSalesOfficerId(currentUser?.id || "");
    setSalesOfficerTitle(defaultTitle);

    setRevenueAccountCode("411101");
    setCustomRevenueAccount(undefined);
    setTreasuryAccountId(treasuryAccounts[0]?.id || "t1");

    setSelectedGradePreset("رقم 1");
    setCustomGradeText("");
    setCustomer("");
    setPhone("");
    setBundles("");
    setPrice("");
    setCredit("");
    setDate(new Date().toISOString().slice(0, 10));
    setVoucherNo(`RV-${Math.floor(100 + Math.random() * 900)}`);
    setNotes("");
    setDrawerOpen(true);
  }

  function openEditDrawer(s: UasSaleTransaction) {
    setEditingId(s.id);
    setProjectId(s.projectId);
    setSubProjectId(s.subProjectId || "");
    setHarvest(s.harvest);
    setSequenceNumber(s.sequenceNumber || s.batch);
    setDailyBatchLabel(s.dailyBatchLabel || s.batch);
    setBatch(s.batch);
    setSalesOfficerId(s.salesOfficerId || currentUser?.id || "");
    setSalesOfficerTitle(s.salesOfficerTitle || currentUser?.name || "مسؤول المبيعات");
    setRevenueAccountCode(s.revenueAccountCode || "411101");
    setCustomRevenueAccount(undefined);
    setTreasuryAccountId(s.treasuryAccountId || treasuryAccounts[0]?.id || "t1");

    if (PRESET_GRADES.includes(s.grade)) {
      setSelectedGradePreset(s.grade);
      setCustomGradeText("");
    } else {
      setSelectedGradePreset("أخرى (تحديد مخصص)");
      setCustomGradeText(s.grade);
    }

    setCustomer(s.customer);
    setPhone(s.phone || "");
    setBundles(String(s.bundles));
    setPrice(String(s.price));
    setCredit(String(s.credit));
    setDate(s.date.slice(0, 10));
    setVoucherNo(s.voucherNo || "");
    setNotes(s.notes || "");
    setDrawerOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer.trim()) {
      onToast("يرجى إدخال اسم العميل");
      return;
    }
    const pid = activeProj?.id || projectId;
    const harv =
      activeProj?.harvests.includes(harvest) ? harvest : activeProj?.harvests[0] || "القطفة الأولى";

    // Non-blocking Duplicate Entry Warning (same party, project, and amount)
    if (!editingId) {
      const saleTotal = (Number(bundles) || 0) * (Number(price) || 0);
      const isDuplicate = sales.some(
        (s) =>
          s.projectId === pid &&
          s.customer.trim().toLowerCase() === customer.trim().toLowerCase() &&
          Math.abs(Number(s.total) - saleTotal) < 0.01
      );
      if (isDuplicate) {
        const proceed = window.confirm(
          `⚠️ تنبيه بوجود عملية مبيعات مماثلة:\nتم العثور على عملية سابقة مسجلة لنفس العميل (${customer.trim()}) في هذا المشروع بنفس المبلغ (${saleTotal.toLocaleString()} ريال).\n\nهل ترغب في المتابعة وتأكيد تسجيل العملية؟`
        );
        if (!proceed) return;
      }
    }

    const finalGrade =
      selectedGradePreset === "أخرى (تحديد مخصص)"
        ? customGradeText.trim() || "درجة مخصصة"
        : selectedGradePreset;

    const payload: SalePayload = {
      projectId: pid,
      subProjectId: subProjectId || undefined,
      harvest: harv,
      batch: sequenceNumber.trim() || batch,
      dailyBatchLabel: dailyBatchLabel.trim() || "وردية مفتوحة",
      sequenceNumber: sequenceNumber.trim() || undefined,
      salesOfficerId: salesOfficerId || undefined,
      salesOfficerTitle: salesOfficerTitle.trim() || undefined,
      revenueAccountCode: revenueAccountCode || "411101",
      treasuryAccountId: treasuryAccountId || undefined,
      customAccount: customRevenueAccount,
      grade: finalGrade,
      customer: customer.trim(),
      phone: phone.trim(),
      bundles: Number(bundles) || 0,
      price: Number(price) || 0,
      credit: Number(credit) || 0,
      date: date || new Date().toISOString().slice(0, 10),
      voucherNo: voucherNo.trim() || `RV-${Math.floor(100 + Math.random() * 900)}`,
      notes: notes.trim(),
      costCenterId: costCenterId || undefined,
      allowNegativeStock: allowNegativeStock || undefined,
    };

    const ok =
      editingId && onEditSale
        ? await onEditSale(editingId, payload)
        : await onAddSale(payload);

    if (ok) {
      setEditingId(null);
      setCustomer("");
      setNotes("");
      setCostCenterId("");
      setAllowNegativeStock(false);
      setDrawerOpen(false);
    }
  }

  // Filtered Sales Logic
  const filteredRawSales = useMemo(() => {
    return sales.filter((s) => {
      if (filterProject !== "ALL" && s.projectId !== filterProject) return false;
      if (filterSubProject !== "ALL" && s.subProjectId !== filterSubProject) return false;
      if (filterOfficer !== "ALL" && s.salesOfficerTitle !== filterOfficer) return false;
      if (filterDate && !s.date.startsWith(filterDate)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchSeq = (s.sequenceNumber || "").toLowerCase().includes(q);
        const matchCust = s.customer.toLowerCase().includes(q);
        const matchPhone = (s.phone || "").toLowerCase().includes(q);
        const matchBatch = (s.batch || "").toLowerCase().includes(q);
        const matchVoucher = (s.voucherNo || "").toLowerCase().includes(q);
        if (!matchSeq && !matchCust && !matchPhone && !matchBatch && !matchVoucher) return false;
      }
      return true;
    });
  }, [sales, filterProject, filterSubProject, filterOfficer, filterDate, searchQuery]);

  const { visible: visibleSales, hiddenCount: hiddenTestSalesCount } = useMemo(
    () => filterOutSyntheticTestRecords(filteredRawSales, hideTestRecords),
    [filteredRawSales, hideTestRecords]
  );

  const hasActiveFilters =
    filterProject !== "ALL" ||
    filterSubProject !== "ALL" ||
    filterOfficer !== "ALL" ||
    Boolean(filterDate) ||
    Boolean(searchQuery.trim()) ||
    hideTestRecords;

  const resetAllFilters = () => {
    setFilterProject("ALL");
    setFilterSubProject("ALL");
    setFilterOfficer("ALL");
    setFilterDate("");
    setSearchQuery("");
    setHideTestRecords(false);
  };

  const handleRefresh = async () => {
    if (!onRefreshState) return;
    setRefreshing(true);
    try {
      await onRefreshState();
      setLastRefreshedAt(new Date().toISOString());
      onToast("✅ تم تحديث سجل المبيعات والتحصيل من الخادم");
    } catch {
      onToast("تعذر تحديث سجل المبيعات");
    } finally {
      setRefreshing(false);
    }
  };

  // Shift & Daily KPI aggregates
  const sumBundles = visibleSales.reduce((a, b) => a + Number(b.bundles), 0);
  const sumTotal = visibleSales.reduce((a, b) => a + Number(b.total), 0);
  const sumCredit = visibleSales.reduce((a, b) => a + Number(b.credit), 0);
  const sumDebit = visibleSales.reduce((a, b) => a + Number(b.debit), 0);

  const activeShiftOfficers = useMemo(() => {
    const list: string[] = [];
    visibleSales.forEach((s) => {
      const name = s.salesOfficerTitle || "مسؤول المبيعات";
      if (!list.includes(name)) list.push(name);
    });
    return list;
  }, [visibleSales]);

  return (
    <section className="space-y-6">
      {/* Prominent In-Place Client Portal & Sales Switch inside Sales */}
      <div className="card-surface rounded-2xl p-2 flex flex-wrap items-center justify-between gap-2 border border-slate-200 dark:border-slate-800 no-print">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-extrabold">
          <button
            type="button"
            data-testid="sales-subview-sales"
            onClick={() => setSalesSubView("sales")}
            className={`px-3.5 py-2 rounded-xl transition inline-flex items-center gap-1.5 ${
              salesSubView === "sales"
                ? "accent-bg shadow-sm"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>سجل المبيعات والفواتير</span>
          </button>
          <button
            type="button"
            data-testid="sales-subview-portal"
            onClick={() => setSalesSubView("portal")}
            className={`px-3.5 py-2 rounded-xl transition inline-flex items-center gap-1.5 ${
              salesSubView === "portal"
                ? "accent-bg shadow-sm"
                : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>بوابة العملاء والطلبات ونشر الأسعار</span>
          </button>
        </div>
        {onOpenClientPortalAdmin && salesSubView === "portal" && (
          <button
            type="button"
            onClick={onOpenClientPortalAdmin}
            className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-[11px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            فتح كشوفات وحسابات العملاء
          </button>
        )}
      </div>

      {salesSubView === "portal" ? (
        <div data-testid="sales-embedded-client-portal" className="card-surface rounded-2xl p-5 border border-slate-200 dark:border-slate-800">
          <TenantClientPortalAdminPanel
            initialSection="requests"
            canManageSettings={canEditRecords}
            staffSignature={currentUser?.name ? `${currentUser.username || currentUser.name}${currentUser.department || currentUser.role ? ` (${currentUser.department || currentUser.role})` : ""}` : undefined}
            onRefreshState={onRefreshState}
            onToast={onToast}
          />
        </div>
      ) : (
        <>
      {/* 1. Daily Sales Multi-Officer KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* KPI 1: Total Sales Volume */}
        <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-sky-600" />
              <span>إجمالي حجم المبيعات</span>
            </div>
            <div className="text-xl font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
              {fmtNum(sumTotal)} <span className="text-xs font-normal text-slate-500">ريال</span>
            </div>
            <div className="text-[11px] font-semibold text-sky-600 mt-0.5">
              {fmtNum(sumBundles)} وحدة قياس مباعة ({visibleSales.length} عملية)
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 flex items-center justify-center font-bold">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 2: Cash Collections */}
        <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-600" />
              <span>المقبوضات النقدية</span>
            </div>
            <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
              {fmtNum(sumCredit)} <span className="text-xs font-normal text-slate-500">ريال</span>
            </div>
            <div className="text-[11px] font-semibold text-slate-400 mt-0.5">
              توريد فوري إلى الخزائن والبنوك
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center font-bold">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 3: Receivables / Credit Due */}
        <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-rose-600" />
              <span>ديون العملاء الآجلة</span>
            </div>
            <div className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1 tabular-nums">
              {fmtNum(sumDebit)} <span className="text-xs font-normal text-slate-500">ريال</span>
            </div>
            <div className="text-[11px] font-semibold text-rose-500 mt-0.5">
              ذمم مدينة مرحلة إلى حسابات العملاء
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center font-bold">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 4: Active Shift Officers */}
        <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div className="min-w-0 pr-1">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <span>مسؤولو المبيعات النشطون بالوردية</span>
            </div>
            <div className="text-xl font-black text-indigo-600 dark:text-indigo-400 mt-1 tabular-nums">
              {activeShiftOfficers.length}{" "}
              <span className="text-xs font-normal text-slate-500">مسؤولين</span>
            </div>
            <div className="text-[11px] text-slate-500 truncate mt-0.5">
              {activeShiftOfficers.slice(0, 2).join("، ") || "لا توجد عمليات"}
              {activeShiftOfficers.length > 2 ? ` (+${activeShiftOfficers.length - 2})` : ""}
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 flex items-center justify-center font-bold shrink-0">
            <Users className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Linked Approved Client Portal Orders Ready for Sales Cycle Completion */}
      {portalDraftOrders.length > 0 && !readOnly && (
        <div className="card-surface rounded-2xl p-4 border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-black text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>أوامر بيع بوابة العملاء المعتمدة ({portalDraftOrders.length})</span>
            </div>
            <span className="text-[11px] text-slate-500">
              جاهزة للتحميل في نموذج المبيعات أو إتمام التسليم والترحيل المباشر
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {portalDraftOrders.map((d) => (
              <div
                key={d.id}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-black px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      <bdi dir="ltr">{d.payload.requestNumber || d.draftNumber}</bdi>
                    </span>
                    <span className="font-black">{d.payload.customer || d.titleAr}</span>
                    {d.payload.customerAccountCode && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200">
                        COA {d.payload.customerAccountCode}
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-black text-emerald-700 dark:text-emerald-300">
                    {fmtNum(d.totalAmount)} ريال
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 flex flex-wrap gap-3">
                  <span>استلام من: <strong>{d.payload.pickupLocation || "السوق"}</strong></span>
                  <span>دائن (مقبوض): <strong className="text-emerald-600">{fmtNum(d.payload.credit || 0)} ريال</strong></span>
                  <span>مدين (متبقي): <strong className="text-rose-600">{fmtNum(d.payload.debitReceivable || 0)} ريال</strong></span>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (d.payload.projectId) setProjectId(d.payload.projectId);
                      setCustomer(d.payload.customer || "");
                      setPhone(d.payload.phone || "");
                      if (d.payload.grade) {
                        setSelectedGradePreset("أخرى (تحديد مخصص)");
                        setCustomGradeText(d.payload.grade);
                      }
                      setBundles(String(d.payload.bundles || 1));
                      setPrice(String(d.payload.price || 0));
                      setCredit(String(d.payload.credit || 0));
                      setNotes(d.payload.notes || "");
                      setEditingId(null);
                      setDrawerOpen(true);
                    }}
                    className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    تحميل في نموذج البيع
                  </button>
                  {d.payload.portalRequestId && (
                    <button
                      type="button"
                      disabled={handingOverDraftId === d.id}
                      onClick={async () => {
                        setHandingOverDraftId(d.id);
                        try {
                          const res = await fetch("/api/portal-admin/requests", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              requestId: d.payload.portalRequestId,
                              action: "HANDOVER",
                              projectId: d.payload.projectId || projectId,
                              treasuryId: d.payload.treasuryAccountId || treasuryAccountId,
                              immediatePaidAmount: Number(d.payload.credit || 0),
                            }),
                          });
                          const out = (await res.json()) as { message?: string; error?: string };
                          if (!res.ok) {
                            onToast(out.error || "تعذر إتمام التسليم");
                            return;
                          }
                          onToast(out.message || "✅ تم إتمام التسليم وترحيل عملية البيع");
                          setPortalDraftOrders((prev) => prev.filter((x) => x.id !== d.id));
                          await onRefreshState?.();
                        } finally {
                          setHandingOverDraftId(null);
                        }
                      }}
                      className="px-3 py-1 rounded-lg accent-bg font-extrabold disabled:opacity-50"
                    >
                      {handingOverDraftId === d.id ? "جاري الترحيل..." : "إتمام التسليم (تم الاستلام + فاتورة)"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SlideOver Drawer for Add / Edit Concurrent Sale */}
      <SlideOverDrawer
        open={drawerOpen && !readOnly}
        onClose={() => {
          setEditingId(null);
          setDrawerOpen(false);
        }}
        title={
          editingId
            ? `تعديل عملية البيع (${sequenceNumber || batch})`
            : "تسجيل عملية بيع فورية متعددة المسؤولين (Concurrent Sale)"
        }
        subtitle="دعم العمليات المفتوحة، الترقيم التسلسلي الآلي، واختيار الحساب الإيرادي والخزينة"
      >
        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* Multi-Officer Shift & Sequence Banner */}
          <div className="p-3 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-sky-600" />
                <span>بيانات الوردية ومسؤول التحصيل</span>
              </span>
              <span className="font-mono text-[11px] bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded-lg border border-sky-300 dark:border-sky-700 font-bold">
                {sequenceNumber || "SO-AUTO"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">اسم/صفة مسؤول البيع</label>
                <input
                  type="text"
                  value={salesOfficerTitle}
                  onChange={(e) => setSalesOfficerTitle(e.target.value)}
                  placeholder="مثال: أحمد عوض (مسؤول مبيعات)"
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">مسمى الوردية / الحوش</label>
                <input
                  type="text"
                  value={dailyBatchLabel}
                  onChange={(e) => {
                    setDailyBatchLabel(e.target.value);
                    if (!sequenceNumber) setBatch(e.target.value);
                  }}
                  placeholder="مثال: وردية الصباح - حوش 1"
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                />
              </div>
            </div>
          </div>

          {/* Project & Sub-Project */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">المشروع الزراعي</label>
              <select
                value={activeProj?.id || ""}
                onChange={(e) => handleProjChange(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2 font-bold"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold">
                  <bdi dir="auto">القطاع الفرعي (Sub-Project)</bdi>
                </label>
                <span className="text-[10px] text-slate-400">مركز تكلفة</span>
              </div>
              <select
                value={subProjectId}
                onChange={(e) => setSubProjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              >
                <option value="">-- بدون قطاع (المشروع العام) --</option>
                {(activeProj?.subProjects || []).map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Harvest & Dynamic Grade */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">القطفة / المرشة</label>
              <SelectWithOther
                value={harvest}
                onChange={setHarvest}
                options={activeProj?.harvests || []}
                otherOptionLabel="قطفة / مرشة مخصصة"
                customPlaceholder="أدخل اسم القطفة أو المرشة المخصصة..."
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">نوع المحصول / الدرجة</label>
              <SelectWithOther
                value={
                  selectedGradePreset === "أخرى (تحديد مخصص)"
                    ? customGradeText || "__other__"
                    : selectedGradePreset
                }
                onChange={(val) => {
                  if (["رقم 1", "رقم 2", "رقم 3", "روس", "بزغة", "ميكس (رقم 1/2/3)"].includes(val)) {
                    setSelectedGradePreset(val);
                    setCustomGradeText("");
                  } else {
                    setSelectedGradePreset("أخرى (تحديد مخصص)");
                    setCustomGradeText(val === "__other__" ? "" : val);
                  }
                }}
                options={[
                  "رقم 1",
                  "رقم 2",
                  "رقم 3",
                  "روس",
                  "بزغة",
                  "ميكس (رقم 1/2/3)",
                ]}
                otherOptionLabel="تحديد درجة مخصصة"
                customPlaceholder="مثال: نخب أول قطفة صيفية، أو درجة دائرية خاصة..."
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2 font-bold"
              />
            </div>
          </div>

          {/* Customer Selection & Quick Creator */}
          <div className="space-y-2">
            {clientOptions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold">اختيار عميل مسجل (شجرة الذمم)</label>
                  <button
                    type="button"
                    onClick={() => setQuickClientOpen(true)}
                    className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    <Plus className="w-3 h-3" />
                    <span>عميل جديد</span>
                  </button>
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    const selected = clientOptions.find((c) => c.id === e.target.value);
                    if (selected) {
                      setCustomer(selected.nameAr);
                      setPhone(selected.phone || "777000000");
                    }
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-1.5"
                >
                  <option value="">— اختر عميلاً مسجلاً لتعبئة بياناته آلياً —</option>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.nameAr} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold">اسم العميل</label>
                  {clientOptions.length === 0 && (
                    <button
                      type="button"
                      onClick={() => setQuickClientOpen(true)}
                      className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" />
                      <span>عميل جديد</span>
                    </button>
                  )}
                </div>
                <input
                  id="saleCustomerInput"
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  type="text"
                  placeholder="مثال: عميل جملة أو منفذ بيع"
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">رقم هاتف العميل</label>
                <PhoneContactInput
                  testId="sales-customer-phone"
                  value={phone}
                  onChange={setPhone}
                  onContactSelected={(c) => {
                    if (!customer.trim() && c.name) setCustomer(c.name);
                  }}
                  fallbackContacts={clientOptions.map((c) => ({
                    id: c.id,
                    name: c.nameAr,
                    phone: c.phone,
                    subtitle: c.code,
                  }))}
                  placeholder="777000000"
                  inputClassName="flex-1 min-w-0 rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-mono text-right"
                />
              </div>
            </div>
          </div>

          <QuickMasterCreateModal
            open={quickClientOpen}
            mode="customer"
            currentUser={currentUser}
            onClose={() => setQuickClientOpen(false)}
            onCreatedCustomer={(created) => {
              setClientOptions((prev) => [...prev, created]);
              setCustomer(created.nameAr);
              setPhone(created.phone || "777000000");
            }}
            onToast={onToast}
          />

          {/* Pricing & Quantities */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">الكمية المباعة (وحدات القياس)</label>
              <input
                value={bundles}
                onChange={(e) => setBundles(e.target.value)}
                type="number"
                inputMode="numeric"
                min={1}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-bold tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">سعر الوحدة</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-bold tabular-nums"
              />
            </div>
          </div>

          {liveStockCheck.hasTrackedBatches && (
            <div
              className={`rounded-xl border p-2.5 text-[11px] space-y-1.5 ${!liveStockCheck.withinStock && (Number(bundles) || 0) > 0
                ? "bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200"
                : "bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
                }`}
            >
              <div className="font-bold flex items-center justify-between gap-2 flex-wrap">
                <span>المتاح بمخزون الحصاد لهذه القطفة والدرجة:</span>
                <bdi dir="ltr" className="font-mono font-black">
                  {fmtNum(liveStockCheck.availableBundles)} علاقية
                </bdi>
              </div>
              {!liveStockCheck.withinStock && (Number(bundles) || 0) > 0 && (
                <>
                  <div className="font-semibold">
                    ⚠️ الكمية المطلوبة تتجاوز الرصيد المتاح بعجز {fmtNum(liveStockCheck.shortageBundles)} علاقية.
                  </div>
                  {canOverrideStock && (
                    <label className="flex items-center gap-2 pt-1 font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowNegativeStock}
                        onChange={(e) => setAllowNegativeStock(e.target.checked)}
                        className="rounded border-rose-400"
                      />
                      <span>اعتماد التجاوز المحاسبي والبيع على المكشوف (تسجيل بالرقابة)</span>
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {/* Total, Credit (Cash), Debit (Receivable) */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-semibold mb-1">الإجمالي (=P*Q)</label>
              <input
                value={fmtNum(preview.totalAmount)}
                type="text"
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">دائن (مقبوض نقد/بنك)</label>
              <input
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-full rounded-xl border border-emerald-300 bg-emerald-50/30 dark:bg-emerald-950/20 px-2.5 py-2 font-black text-emerald-700 dark:text-emerald-300 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">مدين (متبقي آجل)</label>
              <input
                value={fmtNum(preview.debitReceivable)}
                type="text"
                readOnly
                className="w-full rounded-xl border border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 px-2.5 py-2 font-black text-rose-600 tabular-nums"
              />
            </div>
          </div>

          {/* Accounting Direction Selector for Revenue */}
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <AccountingDirectionSelector
              label="توجيه حساب الإيراد (Revenue Direction)"
              allowedTypes={["REVENUE"]}
              defaultParentCode="411100"
              value={{
                accountCode: revenueAccountCode,
                isCustom: Boolean(customRevenueAccount),
                customAccount: customRevenueAccount,
              }}
              onChange={(val: AccountingDirectionValue) => {
                if (val.isCustom) {
                  setCustomRevenueAccount(val.customAccount);
                  setRevenueAccountCode(val.accountCode || val.customAccount?.code || "411101");
                } else {
                  setCustomRevenueAccount(undefined);
                  setRevenueAccountCode(val.accountCode || "411101");
                }
              }}
            />
          </div>

          {/* Treasury / Cash Destination Account */}
          {Number(credit) > 0 && (
            <div>
              <label className="block font-semibold mb-1">
                الخزينة / الحساب البنكي المودع به (حساب التحصيل)
              </label>
              <select
                value={treasuryAccountId}
                onChange={(e) => setTreasuryAccountId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-bold"
              >
                {treasuryAccounts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (رصيد: {fmtNum(t.balance)} YER)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date & Voucher No */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">
                تاريخ عملية البيع{" "}
                {editingId && !canEditDate && (
                  <span className="text-[10px] text-amber-600">(مقفل حسب الصلاحية)</span>
                )}
              </label>
              <UasDateInput
                value={date}
                onChange={setDate}
                disabled={Boolean(editingId) && !canEditDate}
                allowClear={false}
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">رقم سند القبض</label>
              <input
                value={voucherNo}
                onChange={(e) => setVoucherNo(e.target.value)}
                type="text"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold mb-1">ملاحظات</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              type="text"
              placeholder="ملاحظات البيع، موقع التسليم، أو اتفاقيات السداد"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>

          <CostCenterSelector value={costCenterId} onChange={setCostCenterId} />
          <SaveDraftButton
            module="SALES"
            formType="SALES_INVOICE"
            entityId={editingId}
            getTitleAr={() => `مسودة بيع — ${customer.trim() || "عميل"}`}
            getPayload={() => ({ projectId, subProjectId, harvest, customer, phone, grade: selectedGradePreset === "أخرى (تحديد مخصص)" ? customGradeText.trim() || "درجة مخصصة" : selectedGradePreset, bundles: Number(bundles) || 0, price: Number(price) || 0, credit: Number(credit) || 0, date, voucherNo, notes, costCenterId: costCenterId || null })}
            getTotalAmount={() => (Number(bundles) || 0) * (Number(price) || 0)}
            actor={currentUser ? { userId: currentUser.id, userDisplay: currentUser.name, userRole: currentUser.role } : undefined}
            onToast={onToast}
            className="w-full"
          />
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl accent-bg font-extrabold shadow-sm flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>{editingId ? "حفظ تعديلات عملية البيع" : "ترحيل عملية البيع وإصدار السند فوراً"}</span>
          </button>
        </form>
      </SlideOverDrawer>

      {/* Main Full-Width Sales Ledger Table & Filter Bar */}
      <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold">سجل العمليات المفتوحة وإيرادات البيع اليومية</h3>
            <p className="text-xs text-slate-500">
              عمليات بيع غير مقيدة بعدد، سندات قبض نقدية/آجلة، وترحيل محاسبي لجميع أجيال الدليل
            </p>
            {lastRefreshedAt && (
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                {formatRefreshTimestamp(lastRefreshedAt)}
              </div>
            )}
          </div>
          <div className="w-full sm:w-auto no-print">
            {/* Mobile Compact Sales Toolbar Dropdown */}
            <div className="md:hidden w-full flex items-center gap-2">
              {!readOnly && (
                <button
                  type="button"
                  onClick={openCreateDrawer}
                  className="flex-1 min-h-[42px] px-3.5 py-2 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>عملية بيع جديدة</span>
                </button>
              )}
              {onRefreshState && (
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                  aria-label="تحديث"
                  className="min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              )}
              <select
                data-testid="sales-actions-select"
                aria-label="خيارات سجل المبيعات"
                value=""
                onChange={(e) => {
                  const act = e.target.value;
                  if (act === "refresh") {
                    void handleRefresh();
                    return;
                  }
                  if (act === "reset_filters") {
                    resetAllFilters();
                    return;
                  }
                  if (act === "client_portal" && onOpenClientPortalAdmin) {
                    onOpenClientPortalAdmin();
                    return;
                  }
                  if (act === "toggle_test") {
                    setHideTestRecords((prev) => !prev);
                    return;
                  }
                  if (act === "export_pdf") {
                    void printUasDocument({
                      titleAr: "تقرير سجل المبيعات والإيرادات اليومية",
                      titleEn: "Sales Ledger & Daily Revenue Report",
                      documentNumber: `RPT-SALES-${new Date().toISOString().slice(0, 10)}`,
                      currency: "YER",
                      status: "POSTED",
                      format: "A4_LANDSCAPE",
                      letterhead: resolveLetterheadFromProfile(enterpriseProfile),
                      summaryCards: [
                        { labelAr: "إجمالي المبيعات", labelEn: "Total Sales", value: `${fmtNum(sumTotal)} ريال`, tone: "indigo" },
                        { labelAr: "التحصيل النقدي", labelEn: "Cash Collected", value: `${fmtNum(sumCredit)} ريال`, tone: "emerald" },
                        { labelAr: "المتبقي الآجل", labelEn: "Receivable", value: `${fmtNum(sumDebit)} ريال`, tone: "rose" },
                        { labelAr: "إجمالي الكمية (الوحدات)", labelEn: "Total Quantity", value: `${fmtNum(sumBundles)} (${visibleSales.length})`, tone: "amber" },
                      ],
                      tables: [
                        {
                          headingAr: "تفاصيل عمليات البيع",
                          headingEn: "Sales Transactions",
                          columns: [
                            { key: "date", labelAr: "التاريخ", labelEn: "Date" },
                            { key: "voucherNo", labelAr: "رقم السند", labelEn: "Voucher" },
                            { key: "customer", labelAr: "العميل", labelEn: "Customer" },
                            { key: "grade", labelAr: "الصنف", labelEn: "Grade" },
                            { key: "bundles", labelAr: "الكمية / الوحدة", labelEn: "Qty / UoM", numeric: true },
                            { key: "price", labelAr: "السعر", labelEn: "Price", numeric: true },
                            { key: "total", labelAr: "الإجمالي", labelEn: "Total", numeric: true },
                            { key: "credit", labelAr: "المدفوع", labelEn: "Paid", numeric: true },
                            { key: "debit", labelAr: "المتبقي", labelEn: "Due", numeric: true },
                          ],
                          rows: visibleSales.map((s) => ({
                            date: formatIsoToDmy(s.date.slice(0, 10)),
                            voucherNo: s.voucherNo || s.sequenceNumber || "—",
                            customer: s.customer,
                            grade: s.grade,
                            bundles: fmtNum(s.bundles),
                            price: fmtNum(s.price),
                            total: fmtNum(s.total),
                            credit: fmtNum(s.credit),
                            debit: fmtNum(s.debit),
                          })),
                          totalsRow: {
                            date: "الإجمالي",
                            bundles: fmtNum(sumBundles),
                            total: fmtNum(sumTotal),
                            credit: fmtNum(sumCredit),
                            debit: fmtNum(sumDebit),
                          },
                        },
                      ],
                    });
                  }
                }}
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-100"
              >
                <option value="">⋮ خيارات</option>
                <option value="export_pdf">تصدير تقرير PDF</option>
                {onOpenClientPortalAdmin && (
                  <option value="client_portal">إدارة بوابة العملاء والطلبات</option>
                )}
                {onRefreshState && <option value="refresh">تحديث السجل</option>}
                <option value="toggle_test">
                  {hideTestRecords
                    ? `إظهار السجلات التجريبية (${hiddenTestSalesCount})`
                    : `إخفاء السجلات التجريبية (${hiddenTestSalesCount})`}
                </option>
                <option value="reset_filters">إعادة ضبط الفلاتر</option>
              </select>
            </div>

            <div className="hidden md:flex flex-wrap items-center gap-2">
              {onRefreshState && (
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                  title="تحديث سجل المبيعات من الخادم"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  <span>تحديث</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void printUasDocument({
                    titleAr: "تقرير سجل المبيعات والإيرادات اليومية",
                    titleEn: "Sales Ledger & Daily Revenue Report",
                    documentNumber: `RPT-SALES-${new Date().toISOString().slice(0, 10)}`,
                    currency: "YER",
                    status: "POSTED",
                    format: "A4_LANDSCAPE",
                    letterhead: resolveLetterheadFromProfile(enterpriseProfile),
                    summaryCards: [
                      { labelAr: "إجمالي المبيعات", labelEn: "Total Sales", value: `${fmtNum(sumTotal)} ريال`, tone: "indigo" },
                      { labelAr: "التحصيل النقدي", labelEn: "Cash Collected", value: `${fmtNum(sumCredit)} ريال`, tone: "emerald" },
                      { labelAr: "المتبقي الآجل", labelEn: "Receivable", value: `${fmtNum(sumDebit)} ريال`, tone: "rose" },
                      { labelAr: "إجمالي الكمية (الوحدات)", labelEn: "Total Quantity", value: `${fmtNum(sumBundles)} (${visibleSales.length})`, tone: "amber" },
                    ],
                    tables: [
                      {
                        headingAr: "تفاصيل عمليات البيع",
                        headingEn: "Sales Transactions",
                        columns: [
                          { key: "date", labelAr: "التاريخ", labelEn: "Date" },
                          { key: "voucherNo", labelAr: "رقم السند", labelEn: "Voucher" },
                          { key: "customer", labelAr: "العميل", labelEn: "Customer" },
                          { key: "grade", labelAr: "الصنف", labelEn: "Grade" },
                          { key: "bundles", labelAr: "الكمية / الوحدة", labelEn: "Qty / UoM", numeric: true },
                          { key: "price", labelAr: "السعر", labelEn: "Price", numeric: true },
                          { key: "total", labelAr: "الإجمالي", labelEn: "Total", numeric: true },
                          { key: "credit", labelAr: "المدفوع", labelEn: "Paid", numeric: true },
                          { key: "debit", labelAr: "المتبقي", labelEn: "Due", numeric: true },
                        ],
                        rows: visibleSales.map((s) => ({
                          date: formatIsoToDmy(s.date.slice(0, 10)),
                          voucherNo: s.voucherNo || s.sequenceNumber || "—",
                          customer: s.customer,
                          grade: s.grade,
                          bundles: fmtNum(s.bundles),
                          price: fmtNum(s.price),
                          total: fmtNum(s.total),
                          credit: fmtNum(s.credit),
                          debit: fmtNum(s.debit),
                        })),
                        totalsRow: {
                          date: "الإجمالي",
                          bundles: fmtNum(sumBundles),
                          total: fmtNum(sumTotal),
                          credit: fmtNum(sumCredit),
                          debit: fmtNum(sumDebit),
                        },
                      },
                    ],
                  })
                }
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>تقرير PDF</span>
              </button>
              {onOpenClientPortalAdmin && (
                <button
                  type="button"
                  data-testid="sales-open-portal-admin"
                  onClick={() => setSalesSubView("portal")}
                  className="px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold inline-flex items-center gap-1 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>بوابة العملاء والطلبات</span>
                </button>
              )}
              <ActionOverflowMenu
                testId="sales-toolbar-overflow"
                label="خيارات المبيعات"
                size="sm"
                items={[
                  {
                    id: "toggle-test",
                    label: hideTestRecords
                      ? `إظهار السجلات التجريبية (${hiddenTestSalesCount})`
                      : `إخفاء السجلات التجريبية (${hiddenTestSalesCount})`,
                    hidden: hiddenTestSalesCount === 0 && !hideTestRecords,
                    onClick: () => setHideTestRecords((prev) => !prev),
                  },
                  {
                    id: "reset-filters",
                    label: "إعادة ضبط الفلاتر",
                    icon: <RotateCcw className="w-3.5 h-3.5" />,
                    hidden: !hasActiveFilters,
                    onClick: resetAllFilters,
                  },
                ]}
              />
              {!readOnly && (
                <button
                  type="button"
                  onClick={openCreateDrawer}
                  className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>عملية بيع جديدة</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Multi-Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs no-print border-t border-b border-slate-200 dark:border-slate-800 py-3 items-center">
          {/* Project Filter */}
          <select
            value={filterProject}
            onChange={(e) => {
              setFilterProject(e.target.value);
              setFilterSubProject("ALL");
            }}
            className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-bold"
          >
            <option value="ALL">كافة المشاريع</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Sub-Project Filter */}
          <select
            value={filterSubProject}
            onChange={(e) => setFilterSubProject(e.target.value)}
            className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-semibold"
          >
            <option value="ALL">كافة القطاعات الفرعية</option>
            {projects
              .flatMap((p) => (filterProject === "ALL" || p.id === filterProject ? p.subProjects || [] : []))
              .map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                </option>
              ))}
          </select>

          {/* Sales Officer Filter */}
          <select
            value={filterOfficer}
            onChange={(e) => setFilterOfficer(e.target.value)}
            className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-semibold"
          >
            <option value="ALL">كافة مسؤولي المبيعات</option>
            {officerOptions.map((off) => (
              <option key={off} value={off}>
                {off}
              </option>
            ))}
          </select>

          {/* Date Filter (dd / mm / yyyy) */}
          <UasDateInput
            value={filterDate}
            onChange={setFilterDate}
            placeholder="تصفية: يوم / شهر / سنة"
            ariaLabel="تصفية المبيعات بالتاريخ"
            inputClassName="min-h-[36px]"
          />

          {/* Free Text Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute right-2.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالرقم أو العميل أو السند..."
              className="w-full min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent pr-8 pl-2 py-1.5 text-xs"
            />
          </div>
        </div>

        {visibleSales.length === 0 ? (
          <EmptyState
            title="لا توجد عمليات بيع مسجلة ضمن هذه المعايير"
            description={
              hasActiveFilters
                ? "هناك فلاتر نشطة حالياً قد تخفي السجلات. يمكنك إعادة ضبط الفلاتر أو تسجيل عملية بيع جديدة."
                : "ابدأ بتسجيل أول عملية بيع لمتابعة المبيعات النقدية والآجلة وكشوفات العملاء."
            }
            actionLabel={
              hasActiveFilters
                ? "إعادة ضبط الفلاتر"
                : !readOnly
                  ? "عملية بيع جديدة"
                  : undefined
            }
            onAction={
              hasActiveFilters
                ? resetAllFilters
                : !readOnly
                  ? openCreateDrawer
                  : undefined
            }
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300">
                <th className="p-2.5">رقم العملية / التسلسل</th>
                <th className="p-2.5">المسؤول / الوردية</th>
                <th className="p-2.5">اسم العميل والهاتف</th>
                <th className="p-2.5">الدرجة</th>
                <th className="p-2.5">الكمية / الوحدة</th>
                <th className="p-2.5">السعر</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">دائن (مقبوض)</th>
                <th className="p-2.5">مدين (متبقي)</th>
                <th className="p-2.5">التاريخ / السند / الخزينة</th>
                <th className="p-2.5 no-print">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleSales.map((s) => {
                const proj = projects.find((p) => p.id === s.projectId);
                const sp = proj?.subProjects?.find((x) => x.id === s.subProjectId);
                const displaySeq = s.sequenceNumber || s.batch;
                return (
                  <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                    <td className="p-2.5">
                      <div className="font-mono font-black text-sky-700 dark:text-sky-300">
                        {displaySeq}
                      </div>
                      <div className="text-[11px] text-slate-500 font-semibold">
                        {proj ? proj.name : ""} ({s.harvest})
                      </div>
                      {sp && (
                        <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                        </span>
                      )}
                    </td>
                    <td className="p-2.5">
                      <span className="inline-flex items-center gap-1 font-bold text-slate-800 dark:text-slate-200">
                        <Users className="w-3 h-3 text-indigo-500" />
                        <span>{s.salesOfficerTitle || "مسؤول المبيعات"}</span>
                      </span>
                      {s.dailyBatchLabel && s.dailyBatchLabel !== displaySeq && (
                        <div className="text-[10px] text-slate-500">{s.dailyBatchLabel}</div>
                      )}
                    </td>
                    <td className="p-2.5">
                      <div className="font-extrabold text-slate-900 dark:text-slate-100">{s.customer}</div>
                      <div className="text-[11px] text-slate-500 font-mono">📞 {s.phone}</div>
                    </td>
                    <td className="p-2.5">
                      <span className="accent-badge px-2 py-0.5 rounded text-[11px] font-bold">
                        {s.grade}
                      </span>
                    </td>
                    <td className="p-2.5 font-bold tabular-nums">{fmtNum(s.bundles)}</td>
                    <td className="p-2.5 tabular-nums font-mono">{fmtNum(s.price)}</td>
                    <td className="p-2.5 font-black tabular-nums">{fmtNum(s.total)}</td>
                    <td className="p-2.5 text-emerald-600 font-extrabold tabular-nums">{fmtNum(s.credit)}</td>
                    <td className="p-2.5 text-rose-600 font-extrabold tabular-nums">{fmtNum(s.debit)}</td>
                    <td className="p-2.5">
                      <div className="font-mono text-slate-700 dark:text-slate-300">
                        <bdi dir="ltr">{formatIsoToDmy(s.date.slice(0, 10))}</bdi>
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1 flex-wrap">
                        <span>سند: {s.voucherNo}</span>
                        {isSyntheticTestRecord(s) && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            تجريبي
                          </span>
                        )}
                      </div>
                      {s.treasuryName && (
                        <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                          🏦 {s.treasuryName}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 no-print">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenSaleVoucher(s)}
                          className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-extrabold shadow-sm"
                        >
                          سند QR
                        </button>
                        {!readOnly && (
                          <ActionOverflowMenu
                            size="xs"
                            align="end"
                            label="خيارات عملية البيع"
                            items={[
                              {
                                id: "edit",
                                label: "تعديل العملية",
                                icon: <Pencil className="w-3.5 h-3.5" />,
                                hidden: !(canEditRecords && onEditSale),
                                onClick: () => openEditDrawer(s),
                              },
                              {
                                id: "delete",
                                label: "حذف العملية",
                                icon: <Trash2 className="w-3.5 h-3.5" />,
                                tone: "danger",
                                confirmTitle: "حذف عملية البيع",
                                confirmMessage: `هل أنت متأكد من حذف عملية البيع (${s.voucherNo}) للعميل ${s.customer} بمبلغ ${fmtNum(s.total)} ريال؟`,
                                onClick: () => onDeleteSale(s.id),
                              },
                            ]}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-black bg-slate-100 dark:bg-slate-800/60 tabular-nums border-t-2 border-slate-300 dark:border-slate-700">
              <tr>
                <td colSpan={4} className="p-2.5 text-slate-800 dark:text-slate-200">
                  الإجمالي الكلي للعمليات المعروضة ({visibleSales.length} عملية)
                </td>
                <td className="p-2.5 text-sky-700 dark:text-sky-300">{fmtNum(sumBundles)}</td>
                <td className="p-2.5">—</td>
                <td className="p-2.5 text-slate-900 dark:text-slate-100">{fmtNum(sumTotal)} ريال</td>
                <td className="p-2.5 text-emerald-600">{fmtNum(sumCredit)} ريال</td>
                <td className="p-2.5 text-rose-600">{fmtNum(sumDebit)} ريال</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
        </>
      )}
    </section>
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  Package,
  Pencil,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
import {
  AccountingDirectionSelector,
  type CustomAccountPayload,
  type AccountingDirectionValue,
} from "@/components/AccountingDirectionSelector";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import type {
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
};

interface SalesTabProps {
  projects: UasProject[];
  sales: UasSaleTransaction[];
  treasuryAccounts?: UasTreasuryAccount[];
  currentUser?: UasUser;
  readOnly?: boolean;
  canEditRecords?: boolean;
  canEditDate?: boolean;
  onAddSale: (payload: SalePayload) => Promise<boolean>;
  onEditSale?: (id: string, payload: SalePayload) => Promise<boolean>;
  onDeleteSale: (id: string) => Promise<void>;
  onOpenSaleVoucher: (s: UasSaleTransaction) => void;
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
  treasuryAccounts = [],
  currentUser,
  readOnly = false,
  canEditRecords = false,
  canEditDate = false,
  onAddSale,
  onEditSale,
  onDeleteSale,
  onOpenSaleVoucher,
  onToast,
}: SalesTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
  const [subProjectId, setSubProjectId] = useState<string>("");

  // Concurrent Multi-Officer Sales Fields
  const [sequenceNumber, setSequenceNumber] = useState("");
  const [dailyBatchLabel, setDailyBatchLabel] = useState("وردية الصباح");
  const [batch, setBatch] = useState("عملية بيع");
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
  const [phone, setPhone] = useState("783118231");
  const [bundles, setBundles] = useState("100");
  const [price, setPrice] = useState("2000");
  const [credit, setCredit] = useState("50000");
  const [date, setDate] = useState("2026-11-10");
  const [voucherNo, setVoucherNo] = useState("RV-101");
  const [notes, setNotes] = useState("");

  // Filters
  const [filterProject, setFilterProject] = useState("ALL");
  const [filterSubProject, setFilterSubProject] = useState("ALL");
  const [filterOfficer, setFilterOfficer] = useState("ALL");
  const [filterDate, setFilterDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clientOptions, setClientOptions] = useState<QuickCustomerOption[]>([]);
  const [quickClientOpen, setQuickClientOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/sales/customers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { customers?: QuickCustomerOption[] } | null) => {
        if (active && data?.customers) setClientOptions(data.customers);
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
    setHarvest(defProj?.harvests[0] || "القطفة الأولى");

    const year = new Date().getFullYear();
    const nextSeq = `SO-${year}-${String(sales.length + 1).padStart(4, "0")}`;
    setSequenceNumber(nextSeq);
    setDailyBatchLabel("وردية الصباح");
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
    setPhone("783118231");
    setBundles("100");
    setPrice("2000");
    setCredit("50000");
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
    setPhone(s.phone || "783118231");
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
      phone: phone.trim() || "783118231",
      bundles: Number(bundles) || 0,
      price: Number(price) || 0,
      credit: Number(credit) || 0,
      date: date || new Date().toISOString().slice(0, 10),
      voucherNo: voucherNo.trim() || `RV-${Math.floor(100 + Math.random() * 900)}`,
      notes: notes.trim(),
    };

    const ok =
      editingId && onEditSale
        ? await onEditSale(editingId, payload)
        : await onAddSale(payload);

    if (ok) {
      setEditingId(null);
      setCustomer("");
      setNotes("");
      setDrawerOpen(false);
    }
  }

  // Filtered Sales Logic
  const visibleSales = useMemo(() => {
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
      {/* 1. Daily Sales Multi-Officer KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* KPI 1: Total Sales Volume */}
        <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-sky-600" />
              <span>إجمالي حجم المبيعات (Sales Volume)</span>
            </div>
            <div className="text-xl font-black text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
              {fmtNum(sumTotal)} <span className="text-xs font-normal text-slate-500">ريال</span>
            </div>
            <div className="text-[11px] font-semibold text-sky-600 mt-0.5">
              {fmtNum(sumBundles)} علاقية مباعة ({visibleSales.length} عملية)
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 flex items-center justify-center font-bold">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 2: Cash Collections */}
        <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-emerald-600" />
              <span>المقبوضات النقدية (Cash Collections)</span>
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
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-rose-600" />
              <span>ديون العملاء الآجلة (Credit Due)</span>
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
                <label className="block font-semibold">القطاع الفرعي (Sub-Project)</label>
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
              <select
                value={
                  activeProj?.harvests.includes(harvest)
                    ? harvest
                    : activeProj?.harvests[0] || ""
                }
                onChange={(e) => setHarvest(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              >
                {(activeProj?.harvests || []).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">نوع المحصول / الدرجة</label>
              <select
                value={selectedGradePreset}
                onChange={(e) => setSelectedGradePreset(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2 font-bold"
              >
                {PRESET_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedGradePreset === "أخرى (تحديد مخصص)" && (
            <div className="p-2.5 rounded-xl border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
              <label className="block font-bold text-amber-800 dark:text-amber-300 mb-1">
                تسمية الدرجة / نوع المحصول المخصص
              </label>
              <input
                type="text"
                value={customGradeText}
                onChange={(e) => setCustomGradeText(e.target.value)}
                placeholder="مثال: نخب أول قطفة صيفية، أو درجة دائرية خاصة"
                className="w-full rounded-xl border border-amber-300 bg-white dark:bg-slate-900 px-3 py-1.5"
              />
            </div>
          )}

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
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="text"
                  inputMode="tel"
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-mono"
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
              <label className="block font-semibold mb-1">عدد العلاقيات</label>
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
              <label className="block font-semibold mb-1">السعر (للعلاقية)</label>
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
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                disabled={Boolean(editingId) && !canEditDate}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2 disabled:opacity-50 font-mono"
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
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold inline-flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>تقرير PDF</span>
            </button>
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

        {/* Dynamic Multi-Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5 text-xs no-print border-t border-b border-slate-200 dark:border-slate-800 py-3">
          {/* Project Filter */}
          <select
            value={filterProject}
            onChange={(e) => {
              setFilterProject(e.target.value);
              setFilterSubProject("ALL");
            }}
            className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 font-bold"
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
            className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 font-semibold"
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
            className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 font-semibold"
          >
            <option value="ALL">كافة مسؤولي المبيعات</option>
            {officerOptions.map((off) => (
              <option key={off} value={off}>
                {off}
              </option>
            ))}
          </select>

          {/* Date Filter */}
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 font-mono"
          />

          {/* Free Text Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute right-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالرقم أو العميل أو السند..."
              className="w-full rounded-xl border border-slate-300 bg-transparent pr-8 pl-2 py-1.5 text-xs"
            />
          </div>
        </div>

        {visibleSales.length === 0 ? (
          <EmptyState
            title="لا توجد عمليات بيع مسجلة ضمن هذه المعايير"
            description="اضغط على 'عملية بيع جديدة' أو قم بإلغاء بعض عوامل التصفية لعرض السجلات."
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300">
                <th className="p-2.5">رقم العملية / التسلسل</th>
                <th className="p-2.5">المسؤول / الوردية</th>
                <th className="p-2.5">اسم العميل والهاتف</th>
                <th className="p-2.5">الدرجة</th>
                <th className="p-2.5">العلاقيات</th>
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
                      <div className="font-mono text-slate-700 dark:text-slate-300">{s.date.slice(0, 10)}</div>
                      <div className="text-[11px] text-slate-500 font-mono">سند: {s.voucherNo}</div>
                      {s.treasuryName && (
                        <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                          🏦 {s.treasuryName}
                        </div>
                      )}
                    </td>
                    <td className="p-2.5 no-print">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenSaleVoucher(s)}
                          className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-extrabold shadow-sm"
                        >
                          سند QR
                        </button>
                        {!readOnly && canEditRecords && onEditSale && (
                          <button
                            type="button"
                            onClick={() => openEditDrawer(s)}
                            className="inline-flex items-center gap-1 text-indigo-600 hover:underline text-[11px] font-bold"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>تعديل</span>
                          </button>
                        )}
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => onDeleteSale(s.id)}
                            className="text-rose-600 hover:underline text-[11px] font-bold"
                          >
                            حذف
                          </button>
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
    </section>
  );
}

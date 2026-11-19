"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Users } from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import { printUasDocument } from "@/lib/print/uasDocumentPrinter";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
import { CostCenterSelector } from "@/components/CostCenterSelector";
import { SaveDraftButton } from "@/components/SaveDraftButton";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import type { UasProject, UasSaleTransaction, UasUser } from "@/types/uas";

interface CustomerMasterItem {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  nameEn?: string | null;
  phone: string;
  address?: string | null;
  creditLimit: number;
  account?: { id: string; code: string; nameAr: string } | null;
  invoiceCount: number;
  saleCount: number;
  totalInvoiced: number;
  totalCollected: number;
  totalReceivable: number;
  isActive?: boolean;
  archivedAt?: string | null;
}

interface CustomersTabProps {
  projects: UasProject[];
  sales: UasSaleTransaction[];
  allSales: UasSaleTransaction[];
  currentUser?: UasUser;
  readOnly?: boolean;
  canEditRecords?: boolean;
  onOpenSaleVoucher: (s: UasSaleTransaction) => void;
  onExportCustomerExcel: (customerFilter: string) => void;
  onToast?: (msg: string) => void;
}

export function CustomersTab({
  projects,
  sales,
  allSales,
  currentUser,
  readOnly = false,
  canEditRecords = true,
  onOpenSaleVoucher,
  onExportCustomerExcel,
  onToast,
}: CustomersTabProps) {
  const [selectedCustomer, setSelectedCustomer] = useState("ALL");
  const [customers, setCustomers] = useState<CustomerMasterItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Edit Client drawer state
  const [editingCustomer, setEditingCustomer] = useState<CustomerMasterItem | null>(null);
  const [editNameAr, setEditNameAr] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCreditLimit, setEditCreditLimit] = useState("0");
  const [editCostCenterId, setEditCostCenterId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/customers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { customers?: CustomerMasterItem[] };
      if (data.customers) setCustomers(data.customers);
    } catch {
      // keep fallback from sales
    }
  }, []);

  const handleArchiveCustomer = useCallback(
    async (c: CustomerMasterItem) => {
      if (!confirm(`هل أنت متأكد من أرشفة العميل (${c.nameAr})؟`)) return;
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Customer", id: c.id, action: "ARCHIVE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast?.(data.message || "تمت أرشفة العميل بنجاح");
        await loadCustomers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر أرشفة العميل";
        onToast?.(msg);
      }
    },
    [loadCustomers, onToast]
  );

  const handleRestoreCustomer = useCallback(
    async (c: CustomerMasterItem) => {
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Customer", id: c.id, action: "RESTORE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast?.(data.message || "تمت استعادة العميل بنجاح");
        await loadCustomers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر استعادة العميل";
        onToast?.(msg);
      }
    },
    [loadCustomers, onToast]
  );

  const handleDeleteCustomer = useCallback(
    async (c: CustomerMasterItem) => {
      if (
        !confirm(
          `هل أنت متأكد من حذف العميل (${c.nameAr})؟ في حال وجود حركات مرتبطة سيتم أرشفته آلياً حفاظاً على التاريخ المالي.`
        )
      )
        return;
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Customer", id: c.id, action: "SAFE_DELETE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast?.(data.message || "تمت العملية بنجاح");
        await loadCustomers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر حذف العميل";
        onToast?.(msg);
      }
    },
    [loadCustomers, onToast]
  );

  useEffect(() => {
    let active = true;
    fetch("/api/sales/customers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { customers?: CustomerMasterItem[] } | null) => {
        if (active && data?.customers) setCustomers(data.customers);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [allSales]);

  const customerNames = useMemo(
    () =>
      Array.from(
        new Set([...customers.map((c) => c.nameAr), ...allSales.map((s) => s.customer)])
      ),
    [customers, allSales]
  );

  const visibleCustomers = customerNames.filter(
    (c) => selectedCustomer === "ALL" || c === selectedCustomer
  );

  const visibleRows = sales.filter(
    (s) => selectedCustomer === "ALL" || s.customer === selectedCustomer
  );

  function openEditDrawer(c: CustomerMasterItem) {
    setEditingCustomer(c);
    setEditNameAr(c.nameAr);
    setEditNameEn(c.nameEn || "");
    setEditPhone(c.phone);
    setEditAddress(c.address || "");
    setEditCreditLimit(String(c.creditLimit || 0));
    setEditCostCenterId((c as unknown as { costCenterId?: string }).costCenterId || "");
  }

  async function handleSaveCustomerEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCustomer || !editNameAr.trim()) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/sales/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingCustomer.id,
          nameAr: editNameAr.trim(),
          nameEn: editNameEn.trim() || undefined,
          phone: editPhone.trim() || undefined,
          address: editAddress.trim() || null,
          creditLimit: Number(editCreditLimit) || 0,
          costCenterId: editCostCenterId || null,
          actor: currentUser
            ? { userId: currentUser.id, userDisplay: currentUser.name, userRole: currentUser.role }
            : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        onToast?.(data.error || "تعذر تعديل بيانات العميل");
        return;
      }
      onToast?.("✅ تم تحديث ملف العميل وحسابه في الشجرة");
      setEditingCustomer(null);
      await loadCustomers();
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <section className="space-y-6">
      <QuickMasterCreateModal
        open={createOpen}
        mode="customer"
        currentUser={currentUser}
        onClose={() => setCreateOpen(false)}
        onCreatedCustomer={() => {
          void loadCustomers();
        }}
        onToast={(msg) => onToast?.(msg)}
      />

      <SlideOverDrawer
        open={Boolean(editingCustomer) && !readOnly && canEditRecords}
        onClose={() => setEditingCustomer(null)}
        title="تعديل بيانات العميل"
        subtitle="تحديث الاسم والهاتف والعنوان والحد الائتماني وحساب الأستاذ الفرعي (1131xx)"
      >
        <form onSubmit={handleSaveCustomerEdit} className="space-y-3 text-xs">
          <div>
            <label className="block font-bold mb-1">اسم العميل (عربي) *</label>
            <input
              type="text"
              required
              value={editNameAr}
              onChange={(e) => setEditNameAr(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Client Name (English)</label>
            <input
              type="text"
              value={editNameEn}
              onChange={(e) => setEditNameEn(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">رقم الهاتف</label>
              <input
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الحد الائتماني (YER)</label>
              <input
                type="number"
                min={0}
                value={editCreditLimit}
                onChange={(e) => setEditCreditLimit(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="block font-bold mb-1">العنوان</label>
            <input
              type="text"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <CostCenterSelector value={editCostCenterId} onChange={setEditCostCenterId} />
          <SaveDraftButton
            module="SALES"
            formType="CUSTOMER"
            entityId={editingCustomer?.id || null}
            getTitleAr={() => `مسودة تعديل عميل: ${editNameAr.trim()}`}
            getPayload={() => ({ id: editingCustomer?.id, nameAr: editNameAr, nameEn: editNameEn, phone: editPhone, address: editAddress, creditLimit: Number(editCreditLimit) || 0, costCenterId: editCostCenterId || null })}
            actor={currentUser ? { userId: currentUser.id, userDisplay: currentUser.name, userRole: currentUser.role } : undefined}
            onToast={onToast}
            className="w-full"
          />
          <button
            type="submit"
            disabled={savingEdit}
            className="w-full py-2.5 rounded-xl accent-bg font-extrabold"
          >
            {savingEdit ? "جاري الحفظ..." : "حفظ تعديلات العميل"}
          </button>
        </form>
      </SlideOverDrawer>

      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold">
              <bdi dir="auto">دليل العملاء وفواتير وكشوفات الحساب (Clients Directory & Statements)</bdi>
            </h3>
            <p className="text-xs text-slate-500">
              <bdi dir="auto">إنشاء وتعديل ملفات العملاء وحسابات الأستاذ العام (COA 112190xxx)، مراكز التكلفة، وتصدير الكشوفات</bdi>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="rounded-xl border border-slate-300 bg-transparent px-3 py-1.5 text-xs font-bold"
            >
              <option value="ALL">جميع العملاء (All Customers)</option>
              {customerNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
                showArchived
                  ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200"
                  : "border-slate-300 text-slate-600 dark:text-slate-300"
              }`}
            >
              {showArchived ? "إخفاء المؤرشفين" : "إظهار المؤرشفين"}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة عميل جديد</span>
              </button>
            )}
            <button
              onClick={() => onExportCustomerExcel(selectedCustomer)}
              className="px-3.5 py-1.5 rounded-xl border border-emerald-600/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold"
            >
              تصدير كشف العملاء Excel
            </button>
            <button
              onClick={() => {
                const totSales = visibleRows.reduce((s, r) => s + Number(r.total), 0);
                const totPaid = visibleRows.reduce((s, r) => s + Number(r.credit), 0);
                const totDue = visibleRows.reduce((s, r) => s + Number(r.debit), 0);
                void printUasDocument({
                  titleAr: "كشف حساب وفواتير العملاء",
                  titleEn: "Customer Account Statement",
                  documentNumber: `RPT-CUST-${new Date().toISOString().slice(0, 10)}`,
                  currency: "YER",
                  status: "POSTED",
                  format: "A4_PORTRAIT",
                  metadata: [
                    {
                      labelAr: "العميل",
                      labelEn: "Customer",
                      value: selectedCustomer === "ALL" ? "جميع العملاء / All Customers" : selectedCustomer,
                    },
                  ],
                  summaryCards: [
                    { labelAr: "إجمالي المبيعات", labelEn: "Total Billed", value: `${fmtNum(totSales)} YER`, tone: "indigo" },
                    { labelAr: "المقبوض (دائن)", labelEn: "Collected", value: `${fmtNum(totPaid)} YER`, tone: "emerald" },
                    { labelAr: "الرصيد المستحق (مدين)", labelEn: "Receivable", value: `${fmtNum(totDue)} YER`, tone: "rose" },
                  ],
                  tables: [
                    {
                      headingAr: "حركات وفواتير العميل",
                      headingEn: "Statement Lines",
                      columns: [
                        { key: "date", labelAr: "التاريخ", labelEn: "Date" },
                        { key: "voucherNo", labelAr: "السند", labelEn: "Voucher" },
                        { key: "customer", labelAr: "العميل", labelEn: "Customer" },
                        { key: "total", labelAr: "الإجمالي", labelEn: "Total", numeric: true },
                        { key: "credit", labelAr: "المدفوع", labelEn: "Paid", numeric: true },
                        { key: "debit", labelAr: "المتبقي", labelEn: "Balance", numeric: true },
                      ],
                      rows: visibleRows.map((r) => ({
                        date: r.date,
                        voucherNo: r.voucherNo || "—",
                        customer: r.customer,
                        total: fmtNum(r.total),
                        credit: fmtNum(r.credit),
                        debit: fmtNum(r.debit),
                      })),
                      totalsRow: {
                        date: "الإجمالي",
                        total: fmtNum(totSales),
                        credit: fmtNum(totPaid),
                        debit: fmtNum(totDue),
                      },
                    },
                  ],
                });
              }}
              className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
            >
              طباعة الفاتورة / الكشف PDF
            </button>
          </div>
        </div>

        {/* Single Unified Customer Cards Grid */}
        <div className="space-y-2">
          <div className="text-xs font-extrabold text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-emerald-600" />
              <span>بطاقات العملاء الموحدة وملفات الأستاذ العام ({customerNames.length})</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {visibleCustomers.map((cName) => {
                const master = customers.find((m) => m.nameAr === cName || m.name === cName);
                const rows = allSales.filter((s) => s.customer === cName);
                const isArchived = master ? master.isActive === false || Boolean(master.archivedAt) : false;

                if (!showArchived && isArchived) return null;

                const phone = master?.phone || rows[0]?.phone || "—";
                const code = master?.code || "CUST-000";
                const glAccountCode = master?.account?.code || "112190xxx";
                const creditLimit = master?.creditLimit || 0;
                const costCenterBadge = (master as any)?.costCenter?.nameAr || ((master as any)?.costCenterId ? "مركز تكلفة" : null);

                const bundles = rows.reduce((a, b) => a + Number(b.bundles || 0), 0);
                const total = master ? master.totalInvoiced : rows.reduce((a, b) => a + Number(b.total || 0), 0);
                const credit = master ? master.totalCollected : rows.reduce((a, b) => a + Number(b.credit || 0), 0);
                const debit = master ? master.totalReceivable : rows.reduce((a, b) => a + Number(b.debit || 0), 0);

                return (
                  <div
                    key={cName}
                    className={`p-4 rounded-2xl border text-xs space-y-3 transition shadow-sm ${
                      isArchived
                        ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    }`}
                  >
                    {/* Top: Code + COA + CostCenter + Actions */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {code}
                        </span>
                        <span className="font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300/40">
                          COA {glAccountCode}
                        </span>
                        {costCenterBadge && (
                          <span className="font-bold text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50">
                            {costCenterBadge}
                          </span>
                        )}
                        {isArchived && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100 text-[10px] font-black">
                            مؤرشف
                          </span>
                        )}
                      </div>

                      {/* Actions: Edit / Archive / Delete */}
                      {!readOnly && canEditRecords && master && (
                        <div className="flex items-center gap-2 no-print">
                          <button
                            type="button"
                            onClick={() => openEditDrawer(master)}
                            className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-bold inline-flex items-center gap-0.5"
                            title="تعديل بيانات العميل"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>تعديل</span>
                          </button>
                          {isArchived ? (
                            <button
                              type="button"
                              onClick={() => handleRestoreCustomer(master)}
                              className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-bold"
                              title="استعادة العميل"
                            >
                              استعادة
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleArchiveCustomer(master)}
                              className="text-amber-600 hover:text-amber-700 dark:text-amber-400 font-bold"
                              title="أرشفة العميل"
                            >
                              أرشفة
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomer(master)}
                            className="text-rose-600 hover:text-rose-700 dark:text-rose-400 font-bold"
                            title="حذف العميل"
                          >
                            حذف
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Middle: Customer Name, Phone, Credit Limit */}
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h4 className="font-black text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-emerald-600" />
                          <bdi dir="auto">{cName}</bdi>
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          <span>هاتف: {phone}</span>
                          {rows.length > 0 && <span> • العمليات: {rows.length}</span>}
                        </p>
                      </div>
                      <div className="text-end">
                        <div className="text-[10px] text-slate-500">الحد الائتماني</div>
                        <div className="font-extrabold text-xs text-slate-700 dark:text-slate-300">
                          {fmtNum(creditLimit)} YER
                        </div>
                      </div>
                    </div>

                    {/* Bottom: Financial Metrics */}
                    <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs">
                      <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded-xl text-center">
                        <div className="text-[10px] text-slate-500">إجمالي الفواتير</div>
                        <div className="font-black text-slate-900 dark:text-slate-100 text-xs mt-0.5">
                          {fmtNum(total)} ريال
                        </div>
                        {bundles > 0 && (
                          <div className="text-[9px] text-slate-400 mt-0.5">
                            {fmtNum(bundles)} وحدة قياس
                          </div>
                        )}
                      </div>
                      <div className="bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded-xl text-center">
                        <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">دائن (مسدد)</div>
                        <div className="font-black text-emerald-700 dark:text-emerald-400 text-xs mt-0.5">
                          {fmtNum(credit)} ريال
                        </div>
                      </div>
                      <div className="bg-rose-50 dark:bg-rose-950/30 p-2 rounded-xl text-center">
                        <div className="text-[10px] text-rose-700 dark:text-rose-400 font-bold">مدين (متبقي)</div>
                        <div className="font-black text-rose-700 dark:text-rose-400 text-xs mt-0.5">
                          {fmtNum(debit)} ريال
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">اسم العميل</th>
                <th className="p-2.5">رقم الهاتف</th>
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">عملية البيع</th>
                <th className="p-2.5">النوع</th>
                <th className="p-2.5">الكمية / وحدة القياس</th>
                <th className="p-2.5">السعر</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">دائن (مدفوع)</th>
                <th className="p-2.5">مدين (متبقي)</th>
                <th className="p-2.5 no-print">إصدار فاتورة / سند</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleRows.map((s) => {
                const proj = projects.find((p) => p.id === s.projectId);
                return (
                  <tr key={s.id}>
                    <td className="p-2.5 font-bold">{s.customer}</td>
                    <td className="p-2.5">{s.phone}</td>
                    <td className="p-2.5">
                      {proj ? proj.name : ""} — {s.harvest}
                    </td>
                    <td className="p-2.5">{s.batch}</td>
                    <td className="p-2.5">{s.grade}</td>
                    <td className="p-2.5 font-bold">{fmtNum(s.bundles)}</td>
                    <td className="p-2.5">{fmtNum(s.price)}</td>
                    <td className="p-2.5 font-extrabold">{fmtNum(s.total)}</td>
                    <td className="p-2.5 text-emerald-600 font-bold">{fmtNum(s.credit)}</td>
                    <td className="p-2.5 text-rose-600 font-bold">{fmtNum(s.debit)}</td>
                    <td className="p-2.5 no-print">
                      <button
                        onClick={() => onOpenSaleVoucher(s)}
                        className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-bold"
                      >
                        فاتورة / سند
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Users } from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
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

  // Edit Client drawer state
  const [editingCustomer, setEditingCustomer] = useState<CustomerMasterItem | null>(null);
  const [editNameAr, setEditNameAr] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCreditLimit, setEditCreditLimit] = useState("0");
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
          phone: editPhone.trim() || "777000000",
          address: editAddress.trim() || null,
          creditLimit: Number(editCreditLimit) || 0,
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
              دليل العملاء وفواتير وكشوفات الحساب (Clients Directory &amp; Statements)
            </h3>
            <p className="text-xs text-slate-500">
              إنشاء وتعديل ملفات العملاء (1131xx)، فرز الأرصدة، وتصدير الكشوفات إلى Excel و PDF
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
              onClick={() => window.print()}
              className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
            >
              طباعة الفاتورة / الكشف PDF
            </button>
          </div>
        </div>

        {/* Dedicated Master Clients Strip */}
        {customers.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-extrabold text-slate-500 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-emerald-600" />
              <span>ملفات العملاء المربوطة بدليل الحسابات ({customers.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {customers
                .filter((c) => selectedCustomer === "ALL" || c.nameAr === selectedCustomer)
                .map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                        {c.code} • COA {c.account?.code || "1131xx"}
                      </span>
                      {!readOnly && canEditRecords && (
                        <button
                          type="button"
                          onClick={() => openEditDrawer(c)}
                          className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-0.5 no-print"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                      )}
                    </div>
                    <div className="font-extrabold text-sm">{c.nameAr}</div>
                    <div className="text-[11px] text-slate-500 flex justify-between">
                      <span>{c.phone}</span>
                      <span>الحد الائتماني: {fmtNum(c.creditLimit)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleCustomers.map((cName) => {
            const rows = allSales.filter((s) => s.customer === cName);
            const master = customers.find((m) => m.nameAr === cName);
            const phone = rows[0]?.phone || master?.phone || "—";
            const bundles = rows.reduce((a, b) => a + Number(b.bundles), 0);
            const total = rows.reduce((a, b) => a + Number(b.total), 0);
            const credit = rows.reduce((a, b) => a + Number(b.credit), 0);
            const debit = rows.reduce((a, b) => a + Number(b.debit), 0);

            return (
              <div
                key={cName}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-extrabold text-sm">👤 {cName}</h4>
                    <p className="text-xs text-slate-500">
                      رقم الهاتف: {phone} | عدد العمليات: {rows.length}
                    </p>
                  </div>
                  <span className="accent-badge px-2.5 py-1 rounded-lg text-xs font-bold">
                    {fmtNum(bundles)} علاقية
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                  <div>
                    <div className="text-slate-500">إجمالي الفواتير</div>
                    <div className="font-extrabold">{fmtNum(total)} ريال</div>
                  </div>
                  <div>
                    <div className="text-slate-500">دائن (مسدد)</div>
                    <div className="font-extrabold text-emerald-600">{fmtNum(credit)} ريال</div>
                  </div>
                  <div>
                    <div className="text-slate-500">مدين (متبقي عليه)</div>
                    <div className="font-extrabold text-rose-600">{fmtNum(debit)} ريال</div>
                  </div>
                </div>
              </div>
            );
          })}
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
                <th className="p-2.5">عدد العلاقيات</th>
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

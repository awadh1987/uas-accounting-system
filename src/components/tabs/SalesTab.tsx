"use client";

import React, { useEffect, useState } from "react";
import { Pencil, Plus, Printer } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import type { UasProject, UasSaleTransaction, UasUser } from "@/types/uas";

interface QuickCustomerOption {
  id: string;
  code: string;
  nameAr: string;
  phone: string;
}

type SalePayload = {
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  batch: string;
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

export function SalesTab({
  projects,
  sales,
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
  const [batch, setBatch] = useState("عملية بيع 1");
  const [grade, setGrade] = useState("رقم 1/رقم 2/رقم 3/ روس/بزغة");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("783118231");
  const [bundles, setBundles] = useState("100");
  const [price, setPrice] = useState("2000");
  const [credit, setCredit] = useState("50000");
  const [date, setDate] = useState("2026-11-10");
  const [voucherNo, setVoucherNo] = useState("RV-101");
  const [notes, setNotes] = useState("");
  const [filterBatch, setFilterBatch] = useState("ALL");
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
    setBatch("عملية بيع 1");
    setGrade("رقم 1/رقم 2/رقم 3/ روس/بزغة");
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
    setBatch(s.batch);
    setGrade(s.grade);
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
    const payload: SalePayload = {
      projectId: pid,
      subProjectId: subProjectId || undefined,
      harvest: harv,
      batch,
      grade,
      customer: customer.trim(),
      phone: phone.trim() || "783118231",
      bundles: Number(bundles) || 0,
      price: Number(price) || 0,
      credit: Number(credit) || 0,
      date: date || "2026-11-10",
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

  const visibleSales = sales.filter(
    (s) => filterBatch === "ALL" || s.batch === filterBatch
  );
  const sumBundles = visibleSales.reduce((a, b) => a + Number(b.bundles), 0);
  const sumTotal = visibleSales.reduce((a, b) => a + Number(b.total), 0);
  const sumCredit = visibleSales.reduce((a, b) => a + Number(b.credit), 0);
  const sumDebit = visibleSales.reduce((a, b) => a + Number(b.debit), 0);

  return (
    <section className="space-y-6">
      <SlideOverDrawer
        open={drawerOpen && !readOnly}
        onClose={() => {
          setEditingId(null);
          setDrawerOpen(false);
        }}
        title={editingId ? "تعديل عملية البيع وسند القبض" : "إضافة عملية بيع جديدة وإصدار سند"}
        subtitle="تسجيل بيع العلاقيات وحساب الإجمالي والدائن والمدين تلقائياً"
      >
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">المشروع</label>
              <select
                value={activeProj?.id || ""}
                onChange={(e) => handleProjChange(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
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
                <label className="block font-semibold">القطاع الفرعي</label>
                <span className="text-[10px] text-slate-400">اختياري</span>
              </div>
              <select
                value={subProjectId}
                onChange={(e) => setSubProjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              >
                <option value="">-- بدون قطاع --</option>
                {(activeProj?.subProjects || []).map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">رقم عملية البيع</label>
              <select
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              >
                <option value="عملية بيع 1">عملية بيع 1</option>
                <option value="عملية بيع 2">عملية بيع 2</option>
                <option value="عملية بيع 3">عملية بيع 3</option>
                <option value="عملية بيع 4">عملية بيع 4</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">النوع (الدرجة)</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              >
                <option value="رقم 1/رقم 2/رقم 3/ روس/بزغة">
                  رقم 1/رقم 2/رقم 3/ روس/بزغة
                </option>
                <option value="رقم 1">رقم 1</option>
                <option value="رقم 2">رقم 2</option>
                <option value="رقم 3">رقم 3</option>
                <option value="روس">روس</option>
                <option value="بزغة">بزغة</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            {clientOptions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold">اختيار من دليل العملاء (اختياري)</label>
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
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">رقم هاتف العميل</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="text"
                  inputMode="tel"
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">عدد العلاقيات</label>
              <input
                value={bundles}
                onChange={(e) => setBundles(e.target.value)}
                type="number"
                inputMode="numeric"
                min={1}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
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
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
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
              <label className="block font-semibold mb-1">دائن (مقبوض)</label>
              <input
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">مدين (=R-S)</label>
              <input
                value={fmtNum(preview.debitReceivable)}
                type="text"
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold text-rose-600 tabular-nums"
              />
            </div>
          </div>
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
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">رقم سند القبض</label>
              <input
                value={voucherNo}
                onChange={(e) => setVoucherNo(e.target.value)}
                type="text"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">ملاحظات</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              type="text"
              placeholder="ملاحظات البيع"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            {editingId ? "حفظ تعديلات عملية البيع" : "+ حفظ عملية البيع وإصدار سند"}
          </button>
        </form>
      </SlideOverDrawer>

      {/* Full-Width Sales Ledger Table */}
      <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold">سجل المبيعات والإيرادات وسندات القبض</h3>
            <p className="text-xs text-slate-500">
              إصدار سند دائن/مدين وإصدار تقرير PDF لكل عملية بيع
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <select
              value={filterBatch}
              onChange={(e) => setFilterBatch(e.target.value)}
              className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 text-xs font-semibold"
            >
              <option value="ALL">جميع عمليات البيع</option>
              <option value="عملية بيع 1">عملية بيع 1</option>
              <option value="عملية بيع 2">عملية بيع 2</option>
              <option value="عملية بيع 3">عملية بيع 3</option>
              <option value="عملية بيع 4">عملية بيع 4</option>
            </select>
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold inline-flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>تقرير PDF</span>
            </button>
            {!readOnly && (
              <button
                id="saleCustomerInput"
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

        {visibleSales.length === 0 ? (
          <EmptyState
            title="لا توجد عمليات بيع مسجلة ضمن هذا النطاق"
            description="أضف عملية بيع جديدة أو غيّر مرشح المشروع والقطفة."
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/90">
                <th className="p-2.5">العملية / المشروع</th>
                <th className="p-2.5">اسم العميل والهاتف</th>
                <th className="p-2.5">النوع</th>
                <th className="p-2.5">العلاقيات</th>
                <th className="p-2.5">السعر</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">دائن (مقبوض)</th>
                <th className="p-2.5">مدين (متبقي)</th>
                <th className="p-2.5">التاريخ / السند</th>
                <th className="p-2.5 no-print">سند دائن/مدين</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleSales.map((s) => {
                const proj = projects.find((p) => p.id === s.projectId);
                return (
                  <tr key={s.id}>
                    <td className="p-2.5">
                      <div className="font-bold">{s.batch}</div>
                      <div className="text-[11px] text-slate-500">
                        {proj ? proj.name : ""} ({s.harvest})
                      </div>
                      {s.subProjectId && (() => {
                        const sp = proj?.subProjects?.find((x) => x.id === s.subProjectId);
                        return sp ? (
                          <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="p-2.5">
                      <div className="font-extrabold">{s.customer}</div>
                      <div className="text-[11px] text-slate-500">📞 {s.phone}</div>
                    </td>
                    <td className="p-2.5">
                      <span className="accent-badge px-2 py-0.5 rounded text-[11px] font-semibold">
                        {s.grade}
                      </span>
                    </td>
                    <td className="p-2.5 font-bold tabular-nums">{fmtNum(s.bundles)}</td>
                    <td className="p-2.5 tabular-nums">{fmtNum(s.price)}</td>
                    <td className="p-2.5 font-extrabold tabular-nums">{fmtNum(s.total)}</td>
                    <td className="p-2.5 text-emerald-600 font-bold tabular-nums">{fmtNum(s.credit)}</td>
                    <td className="p-2.5 text-rose-600 font-bold tabular-nums">{fmtNum(s.debit)}</td>
                    <td className="p-2.5">
                      <div className="font-mono">{s.date}</div>
                      <div className="text-[11px] text-slate-500">سند: {s.voucherNo}</div>
                    </td>
                    <td className="p-2.5 no-print">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenSaleVoucher(s)}
                          className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-bold"
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
            <tfoot className="font-extrabold bg-slate-50 dark:bg-slate-800/40 tabular-nums">
              <tr>
                <td colSpan={3} className="p-2.5">
                  الإجمالي الكلي للمبيعات
                </td>
                <td className="p-2.5">{fmtNum(sumBundles)} علاقية</td>
                <td className="p-2.5">—</td>
                <td className="p-2.5">{fmtNum(sumTotal)} ريال</td>
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


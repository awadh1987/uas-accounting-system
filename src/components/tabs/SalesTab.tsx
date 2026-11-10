"use client";

import React, { useState } from "react";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import type { UasProject, UasSaleTransaction } from "@/types/uas";

interface SalesTabProps {
  projects: UasProject[];
  sales: UasSaleTransaction[];
  onAddSale: (payload: {
    projectId: string;
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
  }) => Promise<boolean>;
  onDeleteSale: (id: string) => Promise<void>;
  onOpenSaleVoucher: (s: UasSaleTransaction) => void;
  onToast: (msg: string) => void;
}

export function SalesTab({
  projects,
  sales,
  onAddSale,
  onDeleteSale,
  onOpenSaleVoucher,
  onToast,
}: SalesTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
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

  const preview = computeSaleTotals(Number(bundles), Number(price), Number(credit));

  function handleProjChange(nextPid: string) {
    setProjectId(nextPid);
    const p = projects.find((x) => x.id === nextPid);
    if (p && p.harvests.length > 0) setHarvest(p.harvests[0]);
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
    const ok = await onAddSale({
      projectId: pid,
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
    });
    if (ok) {
      setCustomer("");
      setNotes("");
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="card-surface rounded-2xl p-5 space-y-3 text-xs">
          <h3 className="text-sm font-extrabold border-b pb-2">إضافة عملية بيع جديدة</h3>
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
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">اسم العميل</label>
              <input
                id="saleCustomerInput"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                type="text"
                placeholder="مثال: فواز الجابري"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold text-rose-600"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">تاريخ عملية البيع</label>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2.5 py-2"
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
            + حفظ عملية البيع وإصدار سند
          </button>
        </form>

        {/* Sales Ledger Table */}
        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold">سجل المبيعات والإيرادات وسندات القبض</h3>
              <p className="text-xs text-slate-500">
                إصدار سند دائن/مدين وإصدار تقرير PDF لكل عملية بيع
              </p>
            </div>
            <div className="flex items-center gap-2 no-print">
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
                className="px-3 py-1.5 rounded-xl accent-bg text-xs font-bold"
              >
                إصدار تقرير PDF
              </button>
            </div>
          </div>
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2">العملية / المشروع</th>
                <th className="p-2">اسم العميل والهاتف</th>
                <th className="p-2">النوع</th>
                <th className="p-2">العلاقيات</th>
                <th className="p-2">السعر</th>
                <th className="p-2">الإجمالي</th>
                <th className="p-2">دائن (مقبوض)</th>
                <th className="p-2">مدين (متبقي)</th>
                <th className="p-2">التاريخ / السند</th>
                <th className="p-2 no-print">سند دائن/مدين</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleSales.map((s) => {
                const proj = projects.find((p) => p.id === s.projectId);
                return (
                  <tr key={s.id}>
                    <td className="p-2">
                      <div className="font-bold">{s.batch}</div>
                      <div className="text-[11px] text-slate-500">
                        {proj ? proj.name : ""} ({s.harvest})
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="font-extrabold">{s.customer}</div>
                      <div className="text-[11px] text-slate-500">📞 {s.phone}</div>
                    </td>
                    <td className="p-2">
                      <span className="accent-badge px-2 py-0.5 rounded text-[11px] font-semibold">
                        {s.grade}
                      </span>
                    </td>
                    <td className="p-2 font-bold">{fmtNum(s.bundles)}</td>
                    <td className="p-2">{fmtNum(s.price)}</td>
                    <td className="p-2 font-extrabold">{fmtNum(s.total)}</td>
                    <td className="p-2 text-emerald-600 font-bold">{fmtNum(s.credit)}</td>
                    <td className="p-2 text-rose-600 font-bold">{fmtNum(s.debit)}</td>
                    <td className="p-2">
                      <div>{s.date}</div>
                      <div className="text-[11px] text-slate-500">سند: {s.voucherNo}</div>
                    </td>
                    <td className="p-2 no-print space-x-1 space-x-reverse">
                      <button
                        onClick={() => onOpenSaleVoucher(s)}
                        className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-bold"
                      >
                        إصدار سند دائن/مدين
                      </button>
                      <button
                        onClick={() => onDeleteSale(s.id)}
                        className="text-rose-600 hover:underline text-[11px] font-bold"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-extrabold bg-slate-50 dark:bg-slate-800/40">
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
        </div>
      </div>
    </section>
  );
}


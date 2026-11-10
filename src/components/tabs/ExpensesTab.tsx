"use client";

import React, { useState } from "react";
import { computeOperatingExpenseTotal, fmtNum } from "@/lib/formulas";
import type { UasOperatingExpense, UasProject } from "@/types/uas";

interface ExpensesTabProps {
  projects: UasProject[];
  expenses: UasOperatingExpense[];
  onAddExpense: (payload: {
    projectId: string;
    harvest: string;
    category: string;
    subType: string;
    qty: number;
    unitPrice: number;
    date: string;
    notes: string;
  }) => Promise<boolean>;
  onDeleteExpense: (id: string) => Promise<void>;
}

const CATEGORY_META: Record<
  string,
  { qtyLabel: string; priceLabel: string; placeholder: string }
> = {
  "وقود/محروقات": {
    qtyLabel: "اللتر (Liters)",
    priceLabel: "قيمة اللتر",
    placeholder: "ديزل / بترول مضخات",
  },
  "وجبات غذائية": {
    qtyLabel: "العدد",
    priceLabel: "قيمة بالريال",
    placeholder: "فطور / غداء / أخرى",
  },
  "مواد غذائية": {
    qtyLabel: "العدد",
    priceLabel: "قيمة بالريال",
    placeholder: "ماء / أكياس فارغة / بسكويت / عصير / أخرى",
  },
  "أجور نقل": {
    qtyLabel: "عدد النقلات",
    priceLabel: "القيمة",
    placeholder: "نقل عمال من/إلى",
  },
  أخرى: {
    qtyLabel: "الكمية",
    priceLabel: "القيمة",
    placeholder: "بيان المصروف",
  },
};

export function ExpensesTab({
  projects,
  expenses,
  onAddExpense,
  onDeleteExpense,
}: ExpensesTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
  const [category, setCategory] = useState("وقود/محروقات");
  const [subType, setSubType] = useState("");
  const [qty, setQty] = useState("20");
  const [unitPrice, setUnitPrice] = useState("1200");
  const [date, setDate] = useState("2026-11-10");
  const [notes, setNotes] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");

  const meta = CATEGORY_META[category] || CATEGORY_META["أخرى"];
  const previewTotal = computeOperatingExpenseTotal(Number(qty), Number(unitPrice));

  function handleProjChange(nextPid: string) {
    setProjectId(nextPid);
    const p = projects.find((x) => x.id === nextPid);
    if (p && p.harvests.length > 0) setHarvest(p.harvests[0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pid = activeProj?.id || projectId;
    const harv =
      activeProj?.harvests.includes(harvest) ? harvest : activeProj?.harvests[0] || "القطفة الأولى";
    const ok = await onAddExpense({
      projectId: pid,
      harvest: harv,
      category,
      subType: subType.trim() || category,
      qty: Number(qty) || 1,
      unitPrice: Number(unitPrice) || 0,
      date: date || "2026-11-10",
      notes: notes.trim(),
    });
    if (ok) {
      setSubType("");
      setNotes("");
    }
  }

  const visibleExpenses = expenses.filter(
    (e) => filterCat === "ALL" || e.category === filterCat
  );
  const sumTotal = visibleExpenses.reduce((a, b) => a + Number(b.total), 0);

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="card-surface rounded-2xl p-5 space-y-3 text-xs">
          <h3 className="text-sm font-extrabold border-b pb-2">إضافة مصروفات تشغيلية</h3>
          <div>
            <label className="block font-semibold mb-1">المشروع</label>
            <select
              value={activeProj?.id || ""}
              onChange={(e) => handleProjChange(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
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
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              {(activeProj?.harvests || []).map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">نوع المصروف التشغيلي</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="وقود/محروقات">وقود/محروقات (لتر × قيمة اللتر)</option>
              <option value="وجبات غذائية">وجبات غذائية (فطور/غداء/أخرى)</option>
              <option value="مواد غذائية">مواد غذائية (ماء/أكياس فارغة/بسكويت/عصير/أخرى)</option>
              <option value="أجور نقل">أجور نقل (نقل عمال من/إلى)</option>
              <option value="أخرى">أخرى (مصروفات عامة)</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">البيان / التفصيل</label>
            <input
              id="expSubTypeInput"
              value={subType}
              onChange={(e) => setSubType(e.target.value)}
              type="text"
              placeholder={meta.placeholder}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-semibold mb-1">{meta.qtyLabel}</label>
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                type="number"
                inputMode="numeric"
                min={1}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">{meta.priceLabel}</label>
              <input
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">الإجمالي</label>
              <input
                value={fmtNum(previewTotal)}
                type="text"
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-bold"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">التاريخ</label>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">ملاحظات</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                type="text"
                placeholder="ملاحظات إضافية"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            + إضافة المصروف التشغيلي
          </button>
        </form>

        {/* Operating Expenses Table */}
        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold">سجل المصروفات التشغيلية</h3>
              <p className="text-xs text-slate-500">
                وقود/محروقات، وجبات غذائية، مواد غذائية، أجور نقل، وأخرى
              </p>
            </div>
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 text-xs"
            >
              <option value="ALL">كل الفئات</option>
              <option value="وقود/محروقات">وقود/محروقات</option>
              <option value="وجبات غذائية">وجبات غذائية</option>
              <option value="مواد غذائية">مواد غذائية</option>
              <option value="أجور نقل">أجور نقل</option>
              <option value="أخرى">أخرى</option>
            </select>
          </div>
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">البند</th>
                <th className="p-2.5">البيان</th>
                <th className="p-2.5">الكمية/اللتر</th>
                <th className="p-2.5">السعر</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">التاريخ</th>
                <th className="p-2.5">ملاحظات</th>
                <th className="p-2.5 no-print">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleExpenses.map((e) => {
                const proj = projects.find((p) => p.id === e.projectId);
                return (
                  <tr key={e.id}>
                    <td className="p-2.5 font-semibold">
                      {proj ? proj.name : ""} — {e.harvest}
                    </td>
                    <td className="p-2.5">
                      <span className="accent-badge px-2 py-0.5 rounded font-semibold">
                        {e.category}
                      </span>
                    </td>
                    <td className="p-2.5">{e.subType}</td>
                    <td className="p-2.5">{fmtNum(e.qty)}</td>
                    <td className="p-2.5">{fmtNum(e.unitPrice)}</td>
                    <td className="p-2.5 font-bold text-amber-600">{fmtNum(e.total)}</td>
                    <td className="p-2.5">{e.date}</td>
                    <td className="p-2.5 text-slate-500">{e.notes || "—"}</td>
                    <td className="p-2.5 no-print">
                      <button
                        onClick={() => onDeleteExpense(e.id)}
                        className="text-rose-600 hover:underline font-bold"
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
                <td colSpan={5} className="p-2.5">
                  الإجمالي الكلي للمصروفات التشغيلية
                </td>
                <td className="p-2.5 text-amber-600">{fmtNum(sumTotal)} ريال</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}


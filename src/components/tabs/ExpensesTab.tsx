"use client";

import React, { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { computeOperatingExpenseTotal, fmtNum } from "@/lib/formulas";
import type { UasOperatingExpense, UasProject } from "@/types/uas";

type ExpensePayload = {
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  category: string;
  subType: string;
  qty: number;
  unitPrice: number;
  date: string;
  notes: string;
};

interface ExpensesTabProps {
  projects: UasProject[];
  expenses: UasOperatingExpense[];
  readOnly?: boolean;
  canEditRecords?: boolean;
  canEditDate?: boolean;
  onAddExpense: (payload: ExpensePayload) => Promise<boolean>;
  onEditExpense?: (id: string, payload: ExpensePayload) => Promise<boolean>;
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
  readOnly = false,
  canEditRecords = false,
  canEditDate = false,
  onAddExpense,
  onEditExpense,
  onDeleteExpense,
}: ExpensesTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
  const [subProjectId, setSubProjectId] = useState<string>("");
  const [category, setCategory] = useState("وقود/محروقات");
  const [subType, setSubType] = useState("");
  const [qty, setQty] = useState("20");
  const [unitPrice, setUnitPrice] = useState("1200");
  const [date, setDate] = useState("2026-11-10");
  const [notes, setNotes] = useState("");
  const [filterCat, setFilterCat] = useState("ALL");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const meta = CATEGORY_META[category] || CATEGORY_META["أخرى"];
  const previewTotal = computeOperatingExpenseTotal(Number(qty), Number(unitPrice));

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
    setCategory("وقود/محروقات");
    setSubType("");
    setQty("20");
    setUnitPrice("1200");
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setDrawerOpen(true);
  }

  function openEditDrawer(e: UasOperatingExpense) {
    setEditingId(e.id);
    setProjectId(e.projectId);
    setSubProjectId(e.subProjectId || "");
    setHarvest(e.harvest);
    setCategory(e.category);
    setSubType(e.subType);
    setQty(String(e.qty));
    setUnitPrice(String(e.unitPrice));
    setDate(e.date.slice(0, 10));
    setNotes(e.notes || "");
    setDrawerOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pid = activeProj?.id || projectId;
    const harv =
      activeProj?.harvests.includes(harvest) ? harvest : activeProj?.harvests[0] || "القطفة الأولى";
    const payload: ExpensePayload = {
      projectId: pid,
      subProjectId: subProjectId || undefined,
      harvest: harv,
      category,
      subType: subType.trim() || category,
      qty: Number(qty) || 1,
      unitPrice: Number(unitPrice) || 0,
      date: date || "2026-11-10",
      notes: notes.trim(),
    };
    const ok =
      editingId && onEditExpense
        ? await onEditExpense(editingId, payload)
        : await onAddExpense(payload);
    if (ok) {
      setEditingId(null);
      setSubType("");
      setNotes("");
      setDrawerOpen(false);
    }
  }

  const visibleExpenses = expenses.filter(
    (e) => filterCat === "ALL" || e.category === filterCat
  );
  const sumTotal = visibleExpenses.reduce((a, b) => a + Number(b.total), 0);

  return (
    <section className="space-y-6">
      <SlideOverDrawer
        open={drawerOpen && !readOnly}
        onClose={() => {
          setEditingId(null);
          setDrawerOpen(false);
        }}
        title={editingId ? "تعديل مصروف تشغيلي" : "إضافة مصروف تشغيلي جديد"}
        subtitle="الوقود، الوجبات، المواد الغذائية، أجور النقل، والصيانة"
      >
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
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
            <div className="flex items-center justify-between mb-1">
              <label className="block font-semibold">القطاع / المشروع الفرعي (Cost Center)</label>
              <span className="text-[10px] text-slate-400">اختياري</span>
            </div>
            <select
              value={subProjectId}
              onChange={(e) => setSubProjectId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="">-- بدون تحديد قطاع فرعي --</option>
              {(activeProj?.subProjects || []).map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
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
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-3 py-2 font-bold tabular-nums"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">
                التاريخ{" "}
                {editingId && !canEditDate && (
                  <span className="text-[10px] text-amber-600">(مقفل حسب الصلاحية)</span>
                )}
              </label>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                disabled={Boolean(editingId) && !canEditDate}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-50"
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
            {editingId ? "حفظ تعديلات المصروف التشغيلي" : "+ إضافة المصروف التشغيلي"}
          </button>
        </form>
      </SlideOverDrawer>

      {/* Full-width Operating Expenses Table */}
      <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold">سجل المصروفات التشغيلية</h3>
            <p className="text-xs text-slate-500">
              وقود/محروقات، وجبات غذائية، مواد غذائية، أجور نقل، وأخرى
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="rounded-xl border border-slate-300 bg-transparent px-2.5 py-1.5 text-xs font-semibold"
            >
              <option value="ALL">كل الفئات</option>
              <option value="وقود/محروقات">وقود/محروقات</option>
              <option value="وجبات غذائية">وجبات غذائية</option>
              <option value="مواد غذائية">مواد غذائية</option>
              <option value="أجور نقل">أجور نقل</option>
              <option value="أخرى">أخرى</option>
            </select>
            {!readOnly && (
              <button
                id="expSubTypeInput"
                type="button"
                onClick={openCreateDrawer}
                className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة مصروف</span>
              </button>
            )}
          </div>
        </div>

        {visibleExpenses.length === 0 ? (
          <EmptyState
            title="لا توجد مصروفات تشغيلية مسجلة"
            description="اضغط على (إضافة مصروف) لتسجيل المصروفات الميدانية وربطها بالمشروع والقطفة."
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/90">
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">البند</th>
                <th className="p-2.5">البيان</th>
                <th className="p-2.5">الكمية/اللتر</th>
                <th className="p-2.5">السعر</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">التاريخ</th>
                <th className="p-2.5">ملاحظات</th>
                {!readOnly && <th className="p-2.5 no-print">إجراء</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleExpenses.map((e) => {
                const proj = projects.find((p) => p.id === e.projectId);
                return (
                  <tr key={e.id}>
                    <td className="p-2.5 font-semibold">
                      <div>{proj ? proj.name : ""} — {e.harvest}</div>
                      {e.subProjectId && (() => {
                        const sp = proj?.subProjects?.find((s) => s.id === e.subProjectId);
                        return sp ? (
                          <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="p-2.5">
                      <span className="accent-badge px-2 py-0.5 rounded font-semibold">
                        {e.category}
                      </span>
                    </td>
                    <td className="p-2.5">{e.subType}</td>
                    <td className="p-2.5 tabular-nums">{fmtNum(e.qty)}</td>
                    <td className="p-2.5 tabular-nums">{fmtNum(e.unitPrice)}</td>
                    <td className="p-2.5 font-bold text-amber-600 tabular-nums">{fmtNum(e.total)}</td>
                    <td className="p-2.5 font-mono">{e.date}</td>
                    <td className="p-2.5 text-slate-500">{e.notes || "—"}</td>
                    {!readOnly && (
                      <td className="p-2.5 no-print">
                        <div className="flex items-center gap-2">
                          {canEditRecords && onEditExpense && (
                            <button
                              type="button"
                              onClick={() => openEditDrawer(e)}
                              className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-bold"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>تعديل</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteExpense(e.id)}
                            className="text-rose-600 hover:underline font-bold"
                          >
                            حذف
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-extrabold bg-slate-50 dark:bg-slate-800/40 tabular-nums">
              <tr>
                <td colSpan={5} className="p-2.5">
                  الإجمالي الكلي للمصروفات التشغيلية
                </td>
                <td className="p-2.5 text-amber-600">{fmtNum(sumTotal)} ريال</td>
                <td colSpan={readOnly ? 2 : 3} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}


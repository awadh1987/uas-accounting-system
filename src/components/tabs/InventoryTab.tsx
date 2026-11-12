"use client";

import React, { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { computeRemainingStock, fmtNum } from "@/lib/formulas";
import type { UasInventoryBatch, UasProject, UasSaleTransaction } from "@/types/uas";

type InventoryPayload = {
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  grade: string;
  harvestedBundles: number;
  shrinkageBundles: number;
  notes: string;
};

interface InventoryTabProps {
  projects: UasProject[];
  inventoryBatches: UasInventoryBatch[];
  sales: UasSaleTransaction[];
  readOnly?: boolean;
  canEditRecords?: boolean;
  onAddInventoryBatch: (payload: InventoryPayload) => Promise<boolean>;
  onEditInventoryBatch?: (payload: InventoryPayload & { id: string }) => Promise<boolean>;
}

export function InventoryTab({
  projects,
  inventoryBatches,
  sales,
  readOnly = false,
  canEditRecords = false,
  onAddInventoryBatch,
  onEditInventoryBatch,
}: InventoryTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
  const [subProjectId, setSubProjectId] = useState<string>("");
  const [grade, setGrade] = useState("رقم 1/رقم 2/رقم 3/ روس/بزغة");
  const [harvestedBundles, setHarvestedBundles] = useState("250");
  const [shrinkageBundles, setShrinkageBundles] = useState("5");
  const [notes, setNotes] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
    setGrade("رقم 1/رقم 2/رقم 3/ روس/بزغة");
    setHarvestedBundles("250");
    setShrinkageBundles("5");
    setNotes("");
    setDrawerOpen(true);
  }

  function openEditDrawer(b: UasInventoryBatch) {
    setEditingId(b.id);
    setProjectId(b.projectId);
    setSubProjectId(b.subProjectId || "");
    setHarvest(b.harvest);
    setGrade(b.grade);
    setHarvestedBundles(String(b.harvestedBundles));
    setShrinkageBundles(String(b.shrinkageBundles));
    setNotes(b.notes || "");
    setDrawerOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pid = activeProj?.id || projectId;
    const harv =
      activeProj?.harvests.includes(harvest) ? harvest : activeProj?.harvests[0] || "القطفة الأولى";
    const payload: InventoryPayload = {
      projectId: pid,
      subProjectId: subProjectId || undefined,
      harvest: harv,
      grade,
      harvestedBundles: Number(harvestedBundles) || 0,
      shrinkageBundles: Number(shrinkageBundles) || 0,
      notes: notes.trim(),
    };
    const ok =
      editingId && onEditInventoryBatch
        ? await onEditInventoryBatch({ id: editingId, ...payload })
        : await onAddInventoryBatch(payload);
    if (ok) {
      setEditingId(null);
      setNotes("");
      setDrawerOpen(false);
    }
  }

  return (
    <section className="space-y-6">
      <SlideOverDrawer
        open={drawerOpen && !readOnly}
        onClose={() => {
          setEditingId(null);
          setDrawerOpen(false);
        }}
        title={editingId ? "تعديل دفعة حصاد / مخزون القطفة" : "تسجيل حصاد / مخزون علاقيات القطفة"}
        subtitle="تسجيل كميات الحصاد والفرز والفاقد لكل درجة"
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
            <label className="block font-semibold mb-1">الدرجة / النوع</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="رقم 1/رقم 2/رقم 3/ روس/بزغة">
                رقم 1/رقم 2/رقم 3/ روس/بزغة (مختلط)
              </option>
              <option value="رقم 1">رقم 1 (ممتاز)</option>
              <option value="رقم 2">رقم 2 (درجة ثانية)</option>
              <option value="رقم 3">رقم 3 (درجة ثالثة)</option>
              <option value="روس">روس</option>
              <option value="بزغة">بزغة</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">العلاقيات المقطوفة</label>
              <input
                value={harvestedBundles}
                onChange={(e) => setHarvestedBundles(e.target.value)}
                type="number"
                inputMode="numeric"
                min={1}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">الفاقد / التالف</label>
              <input
                value={shrinkageBundles}
                onChange={(e) => setShrinkageBundles(e.target.value)}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">ملاحظات الفرز</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              type="text"
              placeholder="فرز القطفة الصباحية"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            {editingId ? "حفظ تعديلات دفعة الحصاد" : "+ تسجيل دفعة الحصاد في المخزون"}
          </button>
        </form>
      </SlideOverDrawer>

      <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold">
              مطابقة مخزون العلاقيات (المقطوف مقابل المباع والفاقد والمتبقي)
            </h3>
            <p className="text-xs text-slate-500">
              رقابة دقيقة على كميات العلاقيات لكل قطفة ولكل درجة لمنع العجز أو الفاقد غير المبرر
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={openCreateDrawer}
              className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm no-print"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>تسجيل دفعة حصاد</span>
            </button>
          )}
        </div>

        {inventoryBatches.length === 0 ? (
          <EmptyState
            title="لا توجد دفعات حصاد مسجلة في المخزون"
            description="أضف دفعة حصاد جديدة لبدء مطابقة الإنتاج مع المبيعات والفاقد."
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/90">
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">الدرجة (النوع)</th>
                <th className="p-2.5">المقطوف (إنتاج)</th>
                <th className="p-2.5">المباع للعملاء</th>
                <th className="p-2.5">الفاقد / التالف</th>
                <th className="p-2.5">المتبقي بالمخزون</th>
                <th className="p-2.5">حالة المطابقة</th>
                {!readOnly && canEditRecords && onEditInventoryBatch && (
                  <th className="p-2.5 no-print">إجراء</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {inventoryBatches.map((b) => {
                const proj = projects.find((p) => p.id === b.projectId);
                const soldBundles = sales
                  .filter(
                    (s) =>
                      s.projectId === b.projectId &&
                      s.harvest === b.harvest &&
                      s.grade === b.grade
                  )
                  .reduce((acc, s) => acc + (Number(s.bundles) || 0), 0);
                const remaining = computeRemainingStock(
                  b.harvestedBundles,
                  soldBundles,
                  b.shrinkageBundles
                );

                return (
                  <tr key={b.id}>
                    <td className="p-2.5 font-bold">
                      <div>{proj ? proj.name : ""} — {b.harvest}</div>
                      {b.subProjectId && (() => {
                        const sp = proj?.subProjects?.find((x) => x.id === b.subProjectId);
                        return sp ? (
                          <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="p-2.5">
                      <span className="accent-badge px-2 py-0.5 rounded font-semibold">
                        {b.grade}
                      </span>
                    </td>
                    <td className="p-2.5 font-extrabold tabular-nums">{fmtNum(b.harvestedBundles)} علاقية</td>
                    <td className="p-2.5 text-emerald-600 font-bold tabular-nums">
                      {fmtNum(soldBundles)} علاقية
                    </td>
                    <td className="p-2.5 text-amber-600 font-semibold tabular-nums">
                      {fmtNum(b.shrinkageBundles)} علاقية
                    </td>
                    <td className="p-2.5 font-extrabold tabular-nums">{fmtNum(remaining)} علاقية</td>
                    <td className="p-2.5">
                      {remaining >= 0 ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">
                          مطابق (متوفر: {fmtNum(remaining)})
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-[11px]">
                          تجاوز المقطوف ({fmtNum(remaining)})
                        </span>
                      )}
                    </td>
                    {!readOnly && canEditRecords && onEditInventoryBatch && (
                      <td className="p-2.5 no-print">
                        <button
                          type="button"
                          onClick={() => openEditDrawer(b)}
                          className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-bold"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}


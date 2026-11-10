"use client";

import React, { useState } from "react";
import { computeRemainingStock, fmtNum } from "@/lib/formulas";
import type { UasInventoryBatch, UasProject, UasSaleTransaction } from "@/types/uas";

interface InventoryTabProps {
  projects: UasProject[];
  inventoryBatches: UasInventoryBatch[];
  sales: UasSaleTransaction[];
  onAddInventoryBatch: (payload: {
    projectId: string;
    harvest: string;
    grade: string;
    harvestedBundles: number;
    shrinkageBundles: number;
    notes: string;
  }) => Promise<boolean>;
}

export function InventoryTab({
  projects,
  inventoryBatches,
  sales,
  onAddInventoryBatch,
}: InventoryTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
  const [grade, setGrade] = useState("رقم 1/رقم 2/رقم 3/ روس/بزغة");
  const [harvestedBundles, setHarvestedBundles] = useState("250");
  const [shrinkageBundles, setShrinkageBundles] = useState("5");
  const [notes, setNotes] = useState("");

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
    const ok = await onAddInventoryBatch({
      projectId: pid,
      harvest: harv,
      grade,
      harvestedBundles: Number(harvestedBundles) || 0,
      shrinkageBundles: Number(shrinkageBundles) || 0,
      notes: notes.trim(),
    });
    if (ok) {
      setNotes("");
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="card-surface rounded-2xl p-5 space-y-3 text-xs">
          <h3 className="text-sm font-extrabold border-b pb-2">
            تسجيل حصاد / مخزون علاقيات القطفة
          </h3>
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
            + تسجيل دفعة الحصاد في المخزون
          </button>
        </form>

        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
          <div>
            <h3 className="text-sm font-extrabold">
              مطابقة مخزون العلاقيات (المقطوف مقابل المباع والفاقد والمتبقي)
            </h3>
            <p className="text-xs text-slate-500">
              رقابة دقيقة على كميات العلاقيات لكل قطفة ولكل درجة لمنع العجز أو الفاقد غير المبرر
            </p>
          </div>
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">الدرجة (النوع)</th>
                <th className="p-2.5">المقطوف (إنتاج)</th>
                <th className="p-2.5">المباع للعملاء</th>
                <th className="p-2.5">الفاقد / التالف</th>
                <th className="p-2.5">المتبقي بالمخزون</th>
                <th className="p-2.5">حالة المطابقة</th>
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
                      {proj ? proj.name : ""} — {b.harvest}
                    </td>
                    <td className="p-2.5">
                      <span className="accent-badge px-2 py-0.5 rounded font-semibold">
                        {b.grade}
                      </span>
                    </td>
                    <td className="p-2.5 font-extrabold">{fmtNum(b.harvestedBundles)} علاقية</td>
                    <td className="p-2.5 text-emerald-600 font-bold">
                      {fmtNum(soldBundles)} علاقية
                    </td>
                    <td className="p-2.5 text-amber-600 font-semibold">
                      {fmtNum(b.shrinkageBundles)} علاقية
                    </td>
                    <td className="p-2.5 font-extrabold">{fmtNum(remaining)} علاقية</td>
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


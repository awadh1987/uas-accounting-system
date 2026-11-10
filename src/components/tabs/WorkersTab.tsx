"use client";

import React, { useMemo, useState } from "react";
import { computeWorkerWageTotals, fmtNum } from "@/lib/formulas";
import type { UasProject, UasWorkerWage } from "@/types/uas";

interface WorkersTabProps {
  projects: UasProject[];
  workers: UasWorkerWage[];
  allWorkers: UasWorkerWage[];
  onAddWorker: (payload: {
    projectId: string;
    harvest: string;
    name: string;
    dailyWage: number;
    days: number;
    credit: number;
    date: string;
    notes: string;
  }) => Promise<boolean>;
  onDeleteWorker: (id: string) => Promise<void>;
  onOpenWorkerVoucher: (w: UasWorkerWage) => void;
  onExportWorkerExcel: (workerFilter: string) => void;
  onToast: (msg: string) => void;
}

export function WorkersTab({
  projects,
  workers,
  allWorkers,
  onAddWorker,
  onDeleteWorker,
  onOpenWorkerVoucher,
  onExportWorkerExcel,
  onToast,
}: WorkersTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
  const [name, setName] = useState("");
  const [dailyWage, setDailyWage] = useState("5000");
  const [days, setDays] = useState("10");
  const [credit, setCredit] = useState("10000");
  const [date, setDate] = useState("2026-11-10");
  const [notes, setNotes] = useState("");
  const [filterWorker, setFilterWorker] = useState("ALL");

  const preview = computeWorkerWageTotals(
    Number(dailyWage),
    Number(days),
    Number(credit)
  );

  const uniqueWorkerNames = useMemo(
    () => Array.from(new Set(allWorkers.map((w) => w.name))),
    [allWorkers]
  );

  const visibleWorkers = workers.filter(
    (w) => filterWorker === "ALL" || w.name === filterWorker
  );

  const sumDays = visibleWorkers.reduce((a, b) => a + Number(b.days), 0);
  const sumTotal = visibleWorkers.reduce((a, b) => a + Number(b.total), 0);
  const sumCredit = visibleWorkers.reduce((a, b) => a + Number(b.credit), 0);
  const sumDebit = visibleWorkers.reduce((a, b) => a + Number(b.debit), 0);

  function handleProjChange(nextPid: string) {
    setProjectId(nextPid);
    const p = projects.find((x) => x.id === nextPid);
    if (p && p.harvests.length > 0) setHarvest(p.harvests[0]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      onToast("يرجى إدخال اسم العامل");
      return;
    }
    const pid = activeProj?.id || projectId;
    const harv =
      activeProj?.harvests.includes(harvest) ? harvest : activeProj?.harvests[0] || "القطفة الأولى";
    const ok = await onAddWorker({
      projectId: pid,
      harvest: harv,
      name: name.trim(),
      dailyWage: Number(dailyWage) || 0,
      days: Number(days) || 1,
      credit: Number(credit) || 0,
      date: date || "2026-11-10",
      notes: notes.trim(),
    });
    if (ok) {
      setName("");
      setNotes("");
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="card-surface rounded-2xl p-5 space-y-3 text-xs">
          <h3 className="text-sm font-extrabold border-b pb-2">إضافة عامل جديد / أجر عامل</h3>
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
            <label className="block font-semibold mb-1">اسم العامل</label>
            <input
              id="wrkNameInput"
              value={name}
              onChange={(e) => setName(e.target.value)}
              type="text"
              placeholder="مثال: بلال / معاذ / فواز"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">الأجر اليومي (ريال)</label>
              <input
                value={dailyWage}
                onChange={(e) => setDailyWage(e.target.value)}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">عدد الأيام</label>
              <input
                value={days}
                onChange={(e) => setDays(e.target.value)}
                type="number"
                inputMode="numeric"
                min={1}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-semibold mb-1">الإجمالي (=F*G)</label>
              <input
                value={fmtNum(preview.totalWage)}
                type="text"
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">دائن / مدفوع</label>
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
              <label className="block font-semibold mb-1">مدين / متبقي (=H-I)</label>
              <input
                value={fmtNum(preview.debitBalance)}
                type="text"
                readOnly
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold text-rose-600"
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
                placeholder="ملاحظات"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            + إضافة سجل أجر العامل
          </button>
        </form>

        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold">كشف حساب وأجور العمال (Worker Account Report)</h3>
              <p className="text-xs text-slate-500">فرز العمال وتصدير التقارير إلى إكسل و بي دي إف</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 no-print">
              <select
                value={filterWorker}
                onChange={(e) => setFilterWorker(e.target.value)}
                className="rounded-xl border border-slate-300 bg-transparent px-3 py-1.5 text-xs font-semibold"
              >
                <option value="ALL">جميع العمال (الكل)</option>
                {uniqueWorkerNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onExportWorkerExcel(filterWorker)}
                className="px-3 py-1.5 rounded-xl accent-bg text-xs font-bold"
              >
                تصدير Excel
              </button>
              <button
                onClick={() => window.print()}
                className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
              >
                طباعة PDF
              </button>
            </div>
          </div>
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">الاسم</th>
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">الأجر اليومي</th>
                <th className="p-2.5">عدد الأيام</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">دائن (مستلم)</th>
                <th className="p-2.5">مدين (متبقي له)</th>
                <th className="p-2.5">التاريخ</th>
                <th className="p-2.5 no-print">سند / إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleWorkers.map((w) => {
                const proj = projects.find((p) => p.id === w.projectId);
                return (
                  <tr key={w.id}>
                    <td className="p-2.5 font-extrabold">{w.name}</td>
                    <td className="p-2.5">
                      {proj ? proj.name : ""} — {w.harvest}
                    </td>
                    <td className="p-2.5">{fmtNum(w.dailyWage)}</td>
                    <td className="p-2.5">{fmtNum(w.days)}</td>
                    <td className="p-2.5 font-bold">{fmtNum(w.total)}</td>
                    <td className="p-2.5 text-emerald-600 font-semibold">{fmtNum(w.credit)}</td>
                    <td className="p-2.5 text-rose-600 font-bold">{fmtNum(w.debit)}</td>
                    <td className="p-2.5">{w.date}</td>
                    <td className="p-2.5 no-print flex items-center gap-2">
                      <button
                        onClick={() => onOpenWorkerVoucher(w)}
                        className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 font-bold"
                      >
                        سند
                      </button>
                      <button
                        onClick={() => onDeleteWorker(w.id)}
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
                <td colSpan={3} className="p-2.5">
                  الإجمالي الكلي لأجور العمال
                </td>
                <td className="p-2.5">{fmtNum(sumDays)} يوم</td>
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


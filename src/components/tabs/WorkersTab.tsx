"use client";

import React, { useMemo, useState } from "react";
import { Pencil, Plus, Printer } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { computeWorkerWageTotals, fmtNum } from "@/lib/formulas";
import type { UasProject, UasWorkerWage } from "@/types/uas";
import {
  AccountingDirectionSelector,
  type AccountingDirectionValue,
} from "@/components/AccountingDirectionSelector";

type WorkerPayload = {
  projectId: string;
  subProjectId?: string | null;
  harvest: string;
  name: string;
  dailyWage: number;
  days: number;
  credit: number;
  date: string;
  notes: string;
  expenseAccountId?: string | null;
  expenseAccountCode?: string | null;
  customAccount?: { nameAr: string; nameEn?: string; parentCode: string; code?: string } | null;
};

interface WorkersTabProps {
  projects: UasProject[];
  workers: UasWorkerWage[];
  allWorkers: UasWorkerWage[];
  readOnly?: boolean;
  canEditRecords?: boolean;
  canEditDate?: boolean;
  onAddWorker: (payload: WorkerPayload) => Promise<boolean>;
  onEditWorker?: (id: string, payload: WorkerPayload) => Promise<boolean>;
  onDeleteWorker: (id: string) => Promise<void>;
  onOpenWorkerVoucher: (w: UasWorkerWage) => void;
  onExportWorkerExcel: (workerFilter: string) => void;
  onToast: (msg: string) => void;
}

export function WorkersTab({
  projects,
  workers,
  allWorkers,
  readOnly = false,
  canEditRecords = false,
  canEditDate = false,
  onAddWorker,
  onEditWorker,
  onDeleteWorker,
  onOpenWorkerVoucher,
  onExportWorkerExcel,
  onToast,
}: WorkersTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "القطفة الأولى");
  const [subProjectId, setSubProjectId] = useState<string>("");
  const [name, setName] = useState("");
  const [dailyWage, setDailyWage] = useState("5000");
  const [days, setDays] = useState("10");
  const [credit, setCredit] = useState("10000");
  const [date, setDate] = useState("2026-11-10");
  const [notes, setNotes] = useState("");
  const [filterWorker, setFilterWorker] = useState("ALL");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountingDir, setAccountingDir] = useState<AccountingDirectionValue>({
    accountCode: "511101",
    isCustom: false,
  });

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
    setName("");
    setDailyWage("5000");
    setDays("10");
    setCredit("10000");
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setAccountingDir({ accountCode: "511101", isCustom: false });
    setDrawerOpen(true);
  }

  function openEditDrawer(w: UasWorkerWage) {
    setEditingId(w.id);
    setProjectId(w.projectId);
    setSubProjectId(w.subProjectId || "");
    setHarvest(w.harvest);
    setName(w.name);
    setDailyWage(String(w.dailyWage));
    setDays(String(w.days));
    setCredit(String(w.credit));
    setDate(w.date.slice(0, 10));
    setNotes(w.notes || "");
    setDrawerOpen(true);
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
    const payload: WorkerPayload = {
      projectId: pid,
      subProjectId: subProjectId || undefined,
      harvest: harv,
      name: name.trim(),
      dailyWage: Number(dailyWage) || 0,
      days: Number(days) || 1,
      credit: Number(credit) || 0,
      date: date || new Date().toISOString().slice(0, 10),
      notes: notes.trim(),
      expenseAccountId: accountingDir.accountId,
      expenseAccountCode: accountingDir.accountCode || "511101",
      customAccount: accountingDir.isCustom ? accountingDir.customAccount : undefined,
    };
    const ok =
      editingId && onEditWorker
        ? await onEditWorker(editingId, payload)
        : await onAddWorker(payload);
    if (ok) {
      setEditingId(null);
      setName("");
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
        title={editingId ? "تعديل سجل أجر عامل" : "إضافة سجل أجر عامل وحساب الأيام"}
        subtitle="حساب الاستحقاق اليومي والدائن (المسلم) والمدين (المتبقي) وتوليد القيد المزدوج"
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
            <label className="block font-semibold mb-1">اسم العامل</label>
            <input
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
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold tabular-nums"
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
                className="w-full rounded-xl border border-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-2 font-bold text-rose-600 tabular-nums"
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
                placeholder="ملاحظات"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          <AccountingDirectionSelector
            label="التوجيه المحاسبي لمصروف الأجر (الطرف المدين)"
            defaultParentCode="5111"
            allowedTypes={["EXPENSE"]}
            value={accountingDir}
            onChange={setAccountingDir}
          />

          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            {editingId ? "حفظ تعديلات سجل العامل" : "+ إضافة سجل أجر العامل"}
          </button>
        </form>
      </SlideOverDrawer>

      <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
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
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
            >
              تصدير Excel
            </button>
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold inline-flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
            {!readOnly && (
              <button
                id="wrkNameInput"
                type="button"
                onClick={openCreateDrawer}
                className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>تسجيل أجر عامل</span>
              </button>
            )}
          </div>
        </div>

        {visibleWorkers.length === 0 ? (
          <EmptyState
            title="لا توجد سجلات أجور للعمال"
            description="سجل أيام العمل والأجر اليومي لمتابعة المستحقات والدفعات."
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/90">
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
                      <div>{proj ? proj.name : ""} — {w.harvest}</div>
                      {w.subProjectId && (() => {
                        const sp = proj?.subProjects?.find((s) => s.id === w.subProjectId);
                        return sp ? (
                          <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="p-2.5 tabular-nums">{fmtNum(w.dailyWage)}</td>
                    <td className="p-2.5 tabular-nums">{fmtNum(w.days)}</td>
                    <td className="p-2.5 font-bold tabular-nums">{fmtNum(w.total)}</td>
                    <td className="p-2.5 text-emerald-600 font-semibold tabular-nums">{fmtNum(w.credit)}</td>
                    <td className="p-2.5 text-rose-600 font-bold tabular-nums">{fmtNum(w.debit)}</td>
                    <td className="p-2.5 font-mono">{w.date}</td>
                    <td className="p-2.5 no-print flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenWorkerVoucher(w)}
                        className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 font-bold"
                      >
                        سند
                      </button>
                      {!readOnly && canEditRecords && onEditWorker && (
                        <button
                          type="button"
                          onClick={() => openEditDrawer(w)}
                          className="inline-flex items-center gap-1 text-indigo-600 hover:underline font-bold"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => onDeleteWorker(w.id)}
                          className="text-rose-600 hover:underline font-bold"
                        >
                          حذف
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-extrabold bg-slate-50 dark:bg-slate-800/40 tabular-nums">
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
        )}
      </div>
    </section>
  );
}


"use client";

import React, { useMemo, useState } from "react";
import { Pencil, Plus, Printer, Send } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { computeWorkerWageTotals, fmtNum } from "@/lib/formulas";
import {
  printUasDocument,
  resolveLetterheadFromProfile,
} from "@/lib/print/uasDocumentPrinter";
import type { UasEnterpriseProfile, UasProject, UasTreasuryAccount, UasUser, UasWorkerWage } from "@/types/uas";
import { BankPayoutModal, type PayoutInitialData } from "@/components/BankPayoutModal";
import {
  AccountingDirectionSelector,
  type AccountingDirectionValue,
} from "@/components/AccountingDirectionSelector";
import { SelectWithOther } from "@/components/SelectWithOther";
import { CostCenterSelector } from "@/components/CostCenterSelector";
import { SaveDraftButton } from "@/components/SaveDraftButton";

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
  costCenterId?: string | null;
  expenseAccountId?: string | null;
  expenseAccountCode?: string | null;
  customAccount?: { nameAr: string; nameEn?: string; parentCode: string; code?: string } | null;
};

interface WorkerMasterItem {
  id: string;
  name: string;
  phone?: string | null;
  defaultDailyWage?: number;
  accountId?: string | null;
  account?: { id: string; code: string; nameAr: string } | null;
  costCenterId?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
  wageCount?: number;
  totalWages?: number;
  totalPaid?: number;
  balanceDue?: number;
}

interface WorkersTabProps {
  projects: UasProject[];
  workers: UasWorkerWage[];
  allWorkers: UasWorkerWage[];
  treasuryAccounts?: UasTreasuryAccount[];
  currentUser?: UasUser;
  enterpriseProfile?: UasEnterpriseProfile | null;
  readOnly?: boolean;
  canEditRecords?: boolean;
  canEditDate?: boolean;
  onAddWorker: (payload: WorkerPayload) => Promise<boolean>;
  onEditWorker?: (id: string, payload: WorkerPayload) => Promise<boolean>;
  onDeleteWorker: (id: string) => Promise<void>;
  onOpenWorkerVoucher: (w: UasWorkerWage) => void;
  onExportWorkerExcel: (workerFilter: string) => void;
  onRefreshState?: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function WorkersTab({
  projects,
  workers,
  allWorkers,
  treasuryAccounts = [],
  currentUser,
  enterpriseProfile,
  readOnly = false,
  canEditRecords = false,
  canEditDate = false,
  onAddWorker,
  onEditWorker,
  onDeleteWorker,
  onOpenWorkerVoucher,
  onExportWorkerExcel,
  onRefreshState,
  onToast,
}: WorkersTabProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const activeProj = projects.find((p) => p.id === projectId) || projects[0];
  const [harvest, setHarvest] = useState(activeProj?.harvests[0] || "");
  const [subProjectId, setSubProjectId] = useState<string>("");
  const [name, setName] = useState("");
  const [dailyWage, setDailyWage] = useState("");
  const [days, setDays] = useState("");
  const [credit, setCredit] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [filterWorker, setFilterWorker] = useState("ALL");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountingDir, setAccountingDir] = useState<AccountingDirectionValue>({
    accountCode: "511101",
    isCustom: false,
  });

  // Bank Payout Execution state
  const [payoutModalOpen, setPayoutModalOpen] = useState(false);
  const [payoutInitialData, setPayoutInitialData] = useState<PayoutInitialData | null>(null);
  const [executedWorkerDispatches, setExecutedWorkerDispatches] = useState<Record<string, string>>({});

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
    setHarvest(defProj?.harvests[0] || "");
    setName("");
    setDailyWage("");
    setDays("");
    setCredit("");
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

    // Non-blocking Duplicate Entry Warning
    if (!editingId) {
      const wageTotal = (Number(dailyWage) || 0) * (Number(days) || 1);
      const isDuplicate = workers.some(
        (w) =>
          w.projectId === pid &&
          w.name.trim().toLowerCase() === name.trim().toLowerCase() &&
          Math.abs(Number(w.total) - wageTotal) < 0.01
      );
      if (isDuplicate) {
        const proceed = window.confirm(
          `⚠️ تنبيه بوجود سجل أجور مماثل:\nتم العثور على سجل سابق لنفس العامل (${name.trim()}) في هذا المشروع بنفس المبلغ (${wageTotal.toLocaleString()} ريال).\n\nهل ترغب في المتابعة وتأكيد تسجيل السجل؟`
        );
        if (!proceed) return;
      }
    }

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
      costCenterId: costCenterId || undefined,
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
      setCostCenterId("");
      setDrawerOpen(false);
    }
  }

  const [subView, setSubView] = useState<"wages" | "directory">("wages");
  const [masterWorkers, setMasterWorkers] = useState<WorkerMasterItem[]>([]);
  const [showArchivedWorkers, setShowArchivedWorkers] = useState(false);

  const loadMasterWorkers = React.useCallback(async () => {
    try {
      const res = await fetch("/api/workers", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.workers) setMasterWorkers(data.workers);
      }
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    loadMasterWorkers();
  }, [loadMasterWorkers, workers]);

  const handleArchiveMasterWorker = React.useCallback(
    async (w: WorkerMasterItem) => {
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Worker", id: w.id, action: "ARCHIVE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast(data.message || "تمت أرشفة العامل بنجاح");
        await loadMasterWorkers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر أرشفة العامل";
        onToast(msg);
      }
    },
    [loadMasterWorkers, onToast]
  );

  const handleRestoreMasterWorker = React.useCallback(
    async (w: WorkerMasterItem) => {
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Worker", id: w.id, action: "RESTORE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast(data.message || "تمت استعادة العامل بنجاح");
        await loadMasterWorkers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر استعادة العامل";
        onToast(msg);
      }
    },
    [loadMasterWorkers, onToast]
  );

  const handleDeleteMasterWorker = React.useCallback(
    async (w: WorkerMasterItem) => {
      if (
        !confirm(
          `هل أنت متأكد من حذف العامل (${w.name})؟ في حال وجود سجلات أجور أو قيود مرتبطة سيتم أرشفته آلياً حفاظاً على التاريخ المالي.`
        )
      )
        return;
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Worker", id: w.id, action: "SAFE_DELETE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast(data.message || "تمت العملية بنجاح");
        await loadMasterWorkers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر حذف العامل";
        onToast(msg);
      }
    },
    [loadMasterWorkers, onToast]
  );

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
            <SelectWithOther
              value={harvest}
              onChange={setHarvest}
              options={activeProj?.harvests || []}
              otherOptionLabel="قطفة / مرشة مخصصة"
              customPlaceholder="أدخل اسم القطفة أو المرشة المخصصة..."
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
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
                placeholder="مثال: 5000"
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
                placeholder="1"
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
                placeholder="0"
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

          <CostCenterSelector value={costCenterId} onChange={setCostCenterId} />
          <SaveDraftButton
            module="WORKERS"
            formType="WORKER_WAGE"
            entityId={editingId}
            getTitleAr={() => `مسودة أجر عامل: ${name.trim() || "جديد"}`}
            getPayload={() => ({ projectId, subProjectId, harvest, name, dailyWage: Number(dailyWage) || 0, days: Number(days) || 1, credit: Number(credit) || 0, date, notes, costCenterId: costCenterId || null })}
            getTotalAmount={() => preview.totalWage}
            onToast={onToast}
            className="w-full"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            {editingId ? "حفظ تعديلات سجل العامل" : "+ إضافة سجل أجر العامل"}
          </button>
        </form>
      </SlideOverDrawer>

      {/* Sub-Tabs: Wages vs Directory */}
      <div className="card-surface rounded-2xl p-2 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubView("wages")}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${subView === "wages"
              ? "accent-bg shadow-sm"
              : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
          >
            سجلات واستحقاقات الأجور ({workers.length})
          </button>
          <button
            type="button"
            onClick={() => setSubView("directory")}
            className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${subView === "directory"
              ? "accent-bg shadow-sm"
              : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
          >
            دليل العمال وحسابات الذمم (2112xx) ({masterWorkers.length})
          </button>
        </div>
      </div>

      {subView === "directory" ? (
        <div className="card-surface rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/50">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="font-bold">إجمالي العمال في الدليل:</span>
              <span className="font-mono font-black">{masterWorkers.length}</span>
              <span className="text-[10px] text-slate-400">
                (النشطين: {masterWorkers.filter((w) => w.isActive !== false).length} • المؤرشفين:{" "}
                {masterWorkers.filter((w) => w.isActive === false).length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowArchivedWorkers((p) => !p)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-extrabold transition ${showArchivedWorkers
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                : "bg-slate-200/50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600"
                }`}
            >
              {showArchivedWorkers ? "إخفاء المؤرشفين" : "إظهار المؤرشفين"}
            </button>
          </div>

          {masterWorkers.filter((w) => (showArchivedWorkers ? true : w.isActive !== false)).length === 0 ? (
            <EmptyState
              title="دليل العمال فارغ"
              description="سجل أول حركة أجر لعامل ليتم فتح بطاقة وحساب أستاذ فرعي له آلياً (2112xx)."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {masterWorkers
                .filter((w) => (showArchivedWorkers ? true : w.isActive !== false))
                .map((w) => {
                  const isArchived = w.isActive === false;
                  return (
                    <div
                      key={w.id}
                      className={`p-4 rounded-2xl border text-xs space-y-2 transition ${isArchived
                        ? "border-amber-300/60 bg-amber-50/20 dark:bg-amber-950/10 dark:border-amber-800/40 opacity-80"
                        : "border-slate-200 dark:border-slate-700"
                        }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                            COA {w.account?.code || "2112xx"}
                          </span>
                          {isArchived && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                              مؤرشف
                            </span>
                          )}
                        </div>
                        {w.phone && <span className="text-slate-500 font-mono text-[11px]">{w.phone}</span>}
                      </div>

                      <div className="font-extrabold text-sm">{w.name}</div>
                      <div className="text-[11px] text-slate-500">
                        الأجر الافتراضي: <span className="font-mono font-bold tabular-nums">{fmtNum(w.defaultDailyWage ?? 0)}</span> ريال
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center tabular-nums">
                        <div>
                          <div className="text-[10px] text-slate-400">إجمالي الأجور</div>
                          <div className="font-bold">{fmtNum(w.totalWages ?? 0)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">المسلم</div>
                          <div className="font-bold text-emerald-600">{fmtNum(w.totalPaid ?? 0)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">المتبقي له</div>
                          <div className="font-extrabold text-rose-600">{fmtNum(w.balanceDue ?? 0)}</div>
                        </div>
                      </div>

                      {!readOnly && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 flex-wrap">
                          {!isArchived ? (
                            <>
                              {(w.balanceDue ?? 0) > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPayoutInitialData({
                                      sourceVoucherType: "WORKER_WAGE",
                                      sourceVoucherId: `WRK-DIR-${w.id}`,
                                      beneficiaryName: w.name,
                                      beneficiaryAccountOrPhone: w.phone || "",
                                      amount: w.balanceDue || 0,
                                      currencyCode: "YER",
                                      notes: `صرف مستحقات العامل: ${w.name}`,
                                    });
                                    setPayoutModalOpen(true);
                                  }}
                                  className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline inline-flex items-center gap-0.5"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>تحويل بنكي</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleArchiveMasterWorker(w)}
                                className="text-amber-700 dark:text-amber-400 font-bold hover:underline"
                              >
                                أرشفة
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteMasterWorker(w)}
                                className="text-rose-600 font-bold hover:underline"
                              >
                                حذف
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleRestoreMasterWorker(w)}
                                className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline"
                              >
                                استعادة
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteMasterWorker(w)}
                                className="text-rose-600 font-bold hover:underline"
                              >
                                حذف نهائي
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ) : (
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
                onClick={() =>
                  void printUasDocument({
                    titleAr: "كشف حساب وأجور العمال",
                    titleEn: "Worker Account Report",
                    documentNumber: `RPT-WRK-${new Date().toISOString().slice(0, 10)}`,
                    currency: "YER",
                    status: "POSTED",
                    format: "A4_PORTRAIT",
                    letterhead: resolveLetterheadFromProfile(enterpriseProfile),
                    metadata: [
                      {
                        labelAr: "نطاق التقرير",
                        labelEn: "Filter",
                        value: filterWorker === "ALL" ? "جميع العمال / All Workers" : filterWorker,
                      },
                    ],
                    summaryCards: [
                      { labelAr: "إجمالي الأيام", labelEn: "Total Days", value: fmtNum(sumDays), tone: "neutral" },
                      { labelAr: "إجمالي الأجور", labelEn: "Total Wages", value: `${fmtNum(sumTotal)} YER`, tone: "indigo" },
                      { labelAr: "المسلم (دائن)", labelEn: "Paid", value: `${fmtNum(sumCredit)} YER`, tone: "emerald" },
                      { labelAr: "المتبقي (مدين)", labelEn: "Balance Due", value: `${fmtNum(sumDebit)} YER`, tone: "rose" },
                    ],
                    tables: [
                      {
                        headingAr: "تفاصيل مستحقات العمال",
                        headingEn: "Worker Wage Entries",
                        columns: [
                          { key: "date", labelAr: "التاريخ", labelEn: "Date" },
                          { key: "name", labelAr: "اسم العامل", labelEn: "Worker" },
                          { key: "harvest", labelAr: "القطفة", labelEn: "Harvest" },
                          { key: "dailyWage", labelAr: "الأجر اليومي", labelEn: "Daily Wage", numeric: true },
                          { key: "days", labelAr: "الأيام", labelEn: "Days", numeric: true },
                          { key: "total", labelAr: "الإجمالي", labelEn: "Total", numeric: true },
                          { key: "credit", labelAr: "المسلم", labelEn: "Paid", numeric: true },
                          { key: "debit", labelAr: "المتبقي", labelEn: "Due", numeric: true },
                        ],
                        rows: visibleWorkers.map((w) => ({
                          date: w.date,
                          name: w.name,
                          harvest: w.harvest,
                          dailyWage: fmtNum(w.dailyWage),
                          days: fmtNum(w.days),
                          total: fmtNum(w.total),
                          credit: fmtNum(w.credit),
                          debit: fmtNum(w.debit),
                        })),
                        totalsRow: {
                          date: "الإجمالي",
                          days: fmtNum(sumDays),
                          total: fmtNum(sumTotal),
                          credit: fmtNum(sumCredit),
                          debit: fmtNum(sumDebit),
                        },
                      },
                    ],
                  })
                }
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
                      <td className="p-2.5 no-print flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onOpenWorkerVoucher(w)}
                          className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 font-bold"
                        >
                          سند
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPayoutInitialData({
                              sourceVoucherType: "WORKER_WAGE",
                              sourceVoucherId: w.id,
                              beneficiaryName: w.name,
                              beneficiaryAccountOrPhone: "",
                              amount: w.debit > 0 ? w.debit : w.total,
                              currencyCode: "YER",
                              notes: `صرف أجر عامل: ${w.name} — قطفة: ${w.harvest}`,
                            });
                            setPayoutModalOpen(true);
                          }}
                          className="px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-bold hover:bg-emerald-100 flex items-center gap-1"
                        >
                          <Send className="w-3 h-3" />
                          <span>تحويل بنكي</span>
                        </button>
                        {executedWorkerDispatches[w.id] && (
                          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 font-bold">
                            تم: {executedWorkerDispatches[w.id]}
                          </span>
                        )}
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
      )}

      {/* Shared Bank / Wallet Payout Execution Gateway Modal */}
      <BankPayoutModal
        isOpen={payoutModalOpen}
        onClose={() => {
          setPayoutModalOpen(false);
          setPayoutInitialData(null);
        }}
        treasuryAccounts={treasuryAccounts}
        currentUser={currentUser}
        initialData={payoutInitialData}
        onSuccess={(dispatch) => {
          if (dispatch?.sourceVoucherId) {
            setExecutedWorkerDispatches((prev) => ({
              ...prev,
              [dispatch.sourceVoucherId]:
                dispatch.externalReferenceId || dispatch.dispatchNumber,
            }));
          }
          void onRefreshState?.();
        }}
        onToast={onToast}
      />
    </section>
  );
}


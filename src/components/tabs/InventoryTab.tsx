"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Pencil, Plus, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { SelectWithOther } from "@/components/SelectWithOther";
import { MultiUnitInventoryPanel } from "@/components/MultiUnitInventoryPanel";
import { fmtNum } from "@/lib/formulas";
import { reconcileHarvestInventory, type ReconciliationStatus } from "@/lib/harvestReconciliation";
import type { UasInventoryBatch, UasProject, UasSaleTransaction } from "@/types/uas";
import { formatRefreshTimestamp } from "@/lib/uiFormatters";

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
  onRefreshState?: () => Promise<void>;
  onToast?: (msg: string) => void;
}

export function InventoryTab({
  projects,
  inventoryBatches,
  sales,
  readOnly = false,
  canEditRecords = false,
  onAddInventoryBatch,
  onEditInventoryBatch,
  onRefreshState,
  onToast,
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
  const [refreshing, setRefreshing] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

  const handleSyncCatalogFromHarvest = async () => {
    setSyncingCatalog(true);
    try {
      const res = await fetch("/api/portal-admin/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SYNC_FROM_HARVEST", publishImmediately: true }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      onToast?.(res.ok ? data.message || "✅ تم نشر ومزامنة المخزون والفرز للعملاء" : data.error || "تعذر المزامنة");
    } catch {
      onToast?.("تعذر الاتصال بالخادم أثناء مزامنة قائمة الأصناف والفرز");
    } finally {
      setSyncingCatalog(false);
    }
  };

  const handleRefreshHarvest = async () => {
    if (!onRefreshState) return;
    setRefreshing(true);
    try {
      await onRefreshState();
      setLastRefreshedAt(new Date().toISOString());
      onToast?.("✅ تم تحديث مطابقة مخزون العلاقيات بنجاح");
    } catch {
      onToast?.("تعذر تحديث بيانات المخزون");
    } finally {
      setRefreshing(false);
    }
  };

  const reconciliation = useMemo(
    () => reconcileHarvestInventory(inventoryBatches, sales),
    [inventoryBatches, sales]
  );

  function renderReconciliationBadge(status: ReconciliationStatus, remaining: number, shortage: number) {
    if (status === "SHORTAGE") {
      return (
        <span className="inline-flex flex-wrap items-center gap-1 max-w-full px-2.5 py-1 rounded-lg bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800 font-bold text-[11px] leading-snug whitespace-normal break-words">
          <span>عجز / تجاوز المقطوف</span>
          <bdi dir="ltr" className="tabular-nums font-mono">(-{fmtNum(shortage)})</bdi>
        </span>
      );
    }
    if (status === "DEPLETED") {
      return (
        <span className="inline-flex flex-wrap items-center gap-1 max-w-full px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 font-bold text-[11px] leading-snug whitespace-normal break-words">
          <span>نفدت الكمية</span>
          <bdi dir="ltr" className="tabular-nums font-mono">(0)</bdi>
        </span>
      );
    }
    return (
      <span className="inline-flex flex-wrap items-center gap-1 max-w-full px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 font-bold text-[11px] leading-snug whitespace-normal break-words">
        <span>مطابق (متوفر:</span>
        <bdi dir="ltr" className="tabular-nums font-mono">{fmtNum(remaining)})</bdi>
      </span>
    );
  }

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
      {/* Phase 3: Item Master Data & Multi-Unit Inventory Panel (Harvest Sector Isolated) */}
      <MultiUnitInventoryPanel sectorFilter="HARVEST" readOnly={readOnly} onRefreshState={onRefreshState} onToast={onToast} />

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
            <label className="block font-semibold mb-1">الدرجة / النوع</label>
            <SelectWithOther
              value={grade}
              onChange={setGrade}
              options={[
                {
                  value: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
                  label: "رقم 1/رقم 2/رقم 3/ روس/بزغة (مختلط)",
                },
                { value: "رقم 1", label: "رقم 1 (ممتاز)" },
                { value: "رقم 2", label: "رقم 2 (درجة ثانية)" },
                { value: "رقم 3", label: "رقم 3 (درجة ثالثة)" },
                { value: "روس", label: "روس" },
                { value: "بزغة", label: "بزغة" },
              ]}
              otherOptionLabel="درجة محصول مخصصة"
              customPlaceholder="أدخل اسم درجة المحصول المخصصة..."
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
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
            {lastRefreshedAt && (
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                {formatRefreshTimestamp(lastRefreshedAt)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            {onRefreshState && (
              <button
                type="button"
                onClick={() => void handleRefreshHarvest()}
                disabled={refreshing}
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                <span>تحديث</span>
              </button>
            )}
            {!readOnly && (
              <>
                <button
                  type="button"
                  data-testid="inventory-sync-catalog-btn"
                  disabled={syncingCatalog}
                  onClick={() => void handleSyncCatalogFromHarvest()}
                  className="px-3 py-1.5 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 text-xs font-extrabold inline-flex items-center gap-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingCatalog ? "animate-spin" : ""}`} />
                  <span>{syncingCatalog ? "جاري النشر..." : "نشر ومزامنة مع قائمة أسعار العملاء"}</span>
                </button>
                <button
                  type="button"
                  onClick={openCreateDrawer}
                  className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>تسجيل دفعة حصاد</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 p-3 bg-slate-50/70 dark:bg-slate-900/40">
            <div className="text-[11px] text-slate-500 font-semibold">إجمالي المقطوف</div>
            <div className="text-sm font-black tabular-nums mt-0.5">{fmtNum(reconciliation.summary.totalHarvested)} علاقية</div>
          </div>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 p-3 bg-emerald-50/50 dark:bg-emerald-950/20">
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">المباع للعملاء</div>
            <div className="text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums mt-0.5">{fmtNum(reconciliation.summary.totalMatchedSold)} علاقية</div>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 p-3 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">الفاقد / التالف</div>
            <div className="text-sm font-black text-amber-700 dark:text-amber-300 tabular-nums mt-0.5">{fmtNum(reconciliation.summary.totalShrinkage)} علاقية</div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 p-3 bg-slate-50/70 dark:bg-slate-900/40">
            <div className="text-[11px] text-slate-500 font-semibold">الصافي المتبقي</div>
            <div className={`text-sm font-black tabular-nums mt-0.5 ${reconciliation.summary.totalRemaining < 0 ? "text-rose-600" : ""}`}>
              {fmtNum(reconciliation.summary.totalRemaining)} علاقية
            </div>
          </div>
        </div>

        {reconciliation.unmatchedSalesGroups.length > 0 && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 p-3.5 text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-extrabold text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                تنبيه مطابقة: توجد مبيعات مفتوحة (<bdi dir="ltr">{fmtNum(reconciliation.summary.totalUnmatchedSold)}</bdi> علاقية) بدون دفعة حصاد مسجلة ومطابقة
              </span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {reconciliation.unmatchedSalesGroups.map((ug, idx) => {
                const proj = projects.find((p) => p.id === ug.projectId);
                return (
                  <span
                    key={`${ug.projectId}-${ug.harvest}-${ug.grade}-${idx}`}
                    className="inline-flex flex-wrap items-center gap-1 px-2.5 py-1 rounded-lg bg-white/90 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <span>{proj?.name || ug.projectId} — {ug.harvest} ({ug.grade}):</span>
                    <strong className="text-amber-700 dark:text-amber-300 tabular-nums">
                      {fmtNum(ug.soldBundles)} علاقية ({ug.saleCount} فواتير)
                    </strong>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {inventoryBatches.length === 0 ? (
          <EmptyState
            title="لا توجد دفعات حصاد مسجلة في المخزون"
            description="أضف دفعة حصاد جديدة لبدء مطابقة الإنتاج مع المبيعات والفاقد لكل قطفة ودرجة."
            actionLabel={!readOnly ? "تسجيل دفعة حصاد الآن" : undefined}
            onAction={!readOnly ? openCreateDrawer : undefined}
          />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800/90">
                    <th className="p-2.5">المشروع / القطفة</th>
                    <th className="p-2.5">الدرجة (النوع)</th>
                    <th className="p-2.5">المقطوف (إنتاج)</th>
                    <th className="p-2.5">المباع للعملاء</th>
                    <th className="p-2.5">الفاقد / التالف</th>
                    <th className="p-2.5">المتبقي بالمخزون</th>
                    <th className="p-2.5 min-w-[155px]">حالة المطابقة</th>
                    {!readOnly && canEditRecords && onEditInventoryBatch && (
                      <th className="p-2.5 no-print">إجراء</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {reconciliation.rows.map((row) => {
                    const b = row.batch;
                    const proj = projects.find((p) => p.id === b.projectId);
                    return (
                      <tr key={b.id}>
                        <td className="p-2.5 font-bold align-middle">
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
                        <td className="p-2.5 align-middle">
                          <span className="accent-badge inline-flex flex-wrap max-w-full px-2 py-0.5 rounded font-semibold whitespace-normal break-words">
                            {b.grade}
                          </span>
                        </td>
                        <td className="p-2.5 font-extrabold tabular-nums align-middle">{fmtNum(row.harvestedBundles)} علاقية</td>
                        <td className="p-2.5 text-emerald-600 font-bold tabular-nums align-middle">
                          {fmtNum(row.soldBundles)} علاقية
                        </td>
                        <td className="p-2.5 text-amber-600 font-semibold tabular-nums align-middle">
                          {fmtNum(row.shrinkageBundles)} علاقية
                        </td>
                        <td className="p-2.5 font-extrabold tabular-nums align-middle">{fmtNum(row.remainingBundles)} علاقية</td>
                        <td className="p-2.5 align-middle min-w-[155px]">
                          {renderReconciliationBadge(row.status, row.remainingBundles, row.shortageBundles)}
                        </td>
                        {!readOnly && canEditRecords && onEditInventoryBatch && (
                          <td className="p-2.5 no-print align-middle">
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
            </div>

            {/* Mobile RTL Cards — avoids horizontal clipping of status badges */}
            <div className="md:hidden space-y-3">
              {reconciliation.rows.map((row) => {
                const b = row.batch;
                const proj = projects.find((p) => p.id === b.projectId);
                return (
                  <div
                    key={b.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2.5 bg-slate-50/40 dark:bg-slate-900/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-extrabold text-xs text-slate-900 dark:text-slate-100 break-words">
                          {proj ? proj.name : ""} — {b.harvest}
                        </div>
                        <span className="accent-badge inline-flex mt-1 px-2 py-0.5 rounded text-[11px] font-semibold">
                          {b.grade}
                        </span>
                      </div>
                      {!readOnly && canEditRecords && onEditInventoryBatch && (
                        <button
                          type="button"
                          onClick={() => openEditDrawer(b)}
                          className="shrink-0 inline-flex items-center gap-1 text-indigo-600 font-bold text-xs px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] border-y border-slate-200/80 dark:border-slate-700/80 py-2">
                      <div>
                        <span className="text-slate-500">المقطوف: </span>
                        <strong className="tabular-nums">{fmtNum(row.harvestedBundles)}</strong>
                      </div>
                      <div>
                        <span className="text-emerald-600">المباع: </span>
                        <strong className="text-emerald-600 tabular-nums">{fmtNum(row.soldBundles)}</strong>
                      </div>
                      <div>
                        <span className="text-amber-600">الفاقد: </span>
                        <strong className="text-amber-600 tabular-nums">{fmtNum(row.shrinkageBundles)}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500">المتبقي: </span>
                        <strong className="tabular-nums">{fmtNum(row.remainingBundles)}</strong>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] font-bold text-slate-500 shrink-0">حالة المطابقة:</span>
                      {renderReconciliationBadge(row.status, row.remainingBundles, row.shortageBundles)}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}


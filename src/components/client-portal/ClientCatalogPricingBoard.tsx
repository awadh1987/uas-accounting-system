"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Calendar,
  MapPin,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { computeSaleTotals, fmtNum } from "@/lib/formulas";
import type {
  ClientCatalogBoardItemView,
  ClientCatalogBoardStats,
} from "@/lib/clientPortal/portalTypes";
import { formatMoney } from "@/lib/uiFormatters";

interface DraftOrderSummaryLine {
  itemTitle: string;
  requestedQty: string;
  unitPrice: string;
}

interface ClientCatalogPricingBoardProps {
  boardItems: ClientCatalogBoardItemView[];
  boardStats: ClientCatalogBoardStats | null;
  draftLines: DraftOrderSummaryLine[];
  loading: boolean;
  onRefresh: () => void;
  onAddToOrder: (item: ClientCatalogBoardItemView, qty: number) => void;
  onGoToOrder: () => void;
}

export function ClientCatalogPricingBoard({
  boardItems,
  boardStats,
  draftLines,
  loading,
  onRefresh,
  onAddToOrder,
  onGoToOrder,
}: ClientCatalogPricingBoardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("ALL");
  const [unitFilter, setUnitFilter] = useState("ALL");
  const [availFilter, setAvailFilter] = useState("ALL");
  const [qtyByItem, setQtyByItem] = useState<Record<string, string>>({});

  const grades = useMemo(
    () =>
      boardStats?.grades?.length
        ? boardStats.grades
        : Array.from(new Set(boardItems.map((i) => i.gradeLabel).filter(Boolean))),
    [boardItems, boardStats]
  );

  const units = useMemo(() => {
    if (boardStats?.units?.length) return boardStats.units;
    const map = new Map<string, string>();
    for (const i of boardItems) {
      if (!map.has(i.unitCode)) map.set(i.unitCode, i.displayUnitLabel);
    }
    return Array.from(map.entries()).map(([unitCode, displayUnitLabel]) => ({
      unitCode,
      displayUnitLabel,
    }));
  }, [boardItems, boardStats]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return boardItems.filter((it) => {
      if (gradeFilter !== "ALL" && it.gradeLabel !== gradeFilter) return false;
      if (unitFilter !== "ALL" && it.unitCode !== unitFilter) return false;
      if (availFilter !== "ALL" && it.availabilityStatus !== availFilter) return false;
      if (q) {
        const hit =
          it.titleAr.toLowerCase().includes(q) ||
          (it.titleEn || "").toLowerCase().includes(q) ||
          (it.sku || "").toLowerCase().includes(q) ||
          it.gradeLabel.toLowerCase().includes(q) ||
          (it.pickupLocation || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [boardItems, searchQuery, gradeFilter, unitFilter, availFilter]);

  const activeOrderLines = draftLines.filter((l) => l.itemTitle.trim() !== "");
  const activeOrderEstimatedTotal = activeOrderLines.reduce((sum, l) => {
    const q = Math.max(0, Number(l.requestedQty) || 0);
    const p = Math.max(0, Number(l.unitPrice) || 0);
    return sum + computeSaleTotals(q, p, 0).totalAmount;
  }, 0);

  const availableCount =
    boardStats?.availableCount ??
    boardItems.filter((i) => i.availabilityStatus === "AVAILABLE").length;
  const limitedCount =
    boardStats?.limitedCount ??
    boardItems.filter((i) => i.availabilityStatus === "LIMITED").length;

  return (
    <div className="space-y-4 text-xs" data-testid="client-catalog-pricing-board">
      {/* Statistics KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card-surface rounded-2xl p-4">
          <div className="text-slate-500 font-bold">الأصناف المتوفرة اليوم</div>
          <div className="text-xl font-black text-emerald-600 mt-1 tabular-nums">
            {availableCount}
            {limitedCount > 0 && (
              <span className="text-xs font-bold text-amber-600 mr-2">
                (+ {limitedCount} محدود)
              </span>
            )}
          </div>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <div className="text-slate-500 font-bold">الدرجات وأنواع الفرز</div>
          <div className="text-xl font-black text-indigo-600 mt-1 tabular-nums">
            {grades.length}
          </div>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <div className="text-slate-500 font-bold">الأصناف المحددة لطلبك</div>
          <div className="text-xl font-black mt-1 tabular-nums">{activeOrderLines.length}</div>
        </div>
        <div className="card-surface rounded-2xl p-4">
          <div className="text-slate-500 font-bold">الإجمالي التقديري (= P × Q)</div>
          <div className="text-lg font-black text-emerald-700 dark:text-emerald-300 mt-1 tabular-nums">
            {activeOrderEstimatedTotal > 0 ? formatMoney(activeOrderEstimatedTotal) : "0 ريال"}
          </div>
        </div>
      </div>

      {/* Freshness & Filter Card */}
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>قائمة الأصناف والفرز والأسعار المنشورة</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-extrabold text-[11px]">
                {boardStats?.latestFreshnessLabel || "قائمة أسعار اليوم"}
              </span>
              {boardStats?.latestEffectiveDateDmy && (
                <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-[11px] inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-500" />
                  <bdi dir="ltr">{boardStats.latestEffectiveDateDmy}</bdi>
                </span>
              )}
            </div>
            {boardStats?.latestValidityNote && (
              <p className="text-[11px] text-slate-500 mt-1">{boardStats.latestValidityNote}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={onRefresh}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>تحديث القائمة</span>
            </button>
            <button
              type="button"
              data-testid="portal-catalog-go-order-btn"
              onClick={onGoToOrder}
              className="px-3.5 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1.5 shadow-sm"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>استكمال تسجيل طلب ({activeOrderLines.length})</span>
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باسم الصنف أو الفرز..."
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
          />
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
          >
            <option value="ALL">جميع الدرجات والفرز ({grades.length})</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
          >
            <option value="ALL">جميع الوحدات</option>
            {units.map((u) => (
              <option key={u.unitCode} value={u.unitCode}>
                {u.displayUnitLabel}
              </option>
            ))}
          </select>
          <select
            value={availFilter}
            onChange={(e) => setAvailFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
          >
            <option value="ALL">كل حالات التوفر</option>
            <option value="AVAILABLE">متوفر الآن</option>
            <option value="LIMITED">كمية محدودة</option>
            <option value="UNAVAILABLE">غير متوفر</option>
          </select>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-3">
            <PackageCheck className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="font-bold text-slate-600 dark:text-slate-300">
              {boardItems.length === 0
                ? "لم تقم المنشأة بنشر أصناف تسعيرة عامة حالياً."
                : "لا توجد أصناف مطابقة للفلاتر المحددة."}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {boardItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setGradeFilter("ALL");
                    setUnitFilter("ALL");
                    setAvailFilter("ALL");
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>إعادة ضبط الفلاتر</span>
                </button>
              )}
              <button
                type="button"
                onClick={onGoToOrder}
                className="px-4 py-1.5 rounded-xl accent-bg font-extrabold"
              >
                تسجيل طلب حر مباشرة
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredItems.map((it) => {
              const qtyVal = Math.max(0.5, Number(qtyByItem[it.id] ?? "1") || 1);
              const { totalAmount: estTotal } = computeSaleTotals(qtyVal, it.unitPrice, 0);
              const isOut = it.availabilityStatus === "UNAVAILABLE";

              return (
                <div
                  key={it.id}
                  data-testid={`portal-catalog-item-${it.id}`}
                  className={`p-4 rounded-2xl border space-y-3 transition ${
                    isOut
                      ? "border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 opacity-75"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-400"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="font-black text-sm">{it.titleAr}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 font-bold text-[10px]">
                          {it.gradeLabel}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full font-extrabold text-[10px] ${
                            it.availabilityStatus === "AVAILABLE"
                              ? "bg-emerald-100 text-emerald-700"
                              : it.availabilityStatus === "LIMITED"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {it.availabilityLabelAr}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold text-[10px]">
                          {it.freshnessLabel}
                        </span>
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <div className="text-base font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
                        {it.unitPrice > 0 ? formatMoney(it.unitPrice, it.currency) : "حسب المراجعة"}
                      </div>
                      <div className="text-[10px] text-slate-500">لكل {it.displayUnitLabel}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                    {it.effectiveDateDmy && (
                      <span>
                        تاريخ القائمة: <bdi dir="ltr" className="font-mono">{it.effectiveDateDmy}</bdi>
                      </span>
                    )}
                    {it.pickupLocation && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-emerald-600" />
                        استلام من: <strong>{it.pickupLocation}</strong>
                      </span>
                    )}
                    {it.validityNote && <span>• {it.validityNote}</span>}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold text-slate-500">الكمية:</label>
                      <input
                        type="number"
                        step="any"
                        min="0.5"
                        disabled={isOut}
                        value={qtyByItem[it.id] ?? "1"}
                        onChange={(e) =>
                          setQtyByItem((prev) => ({ ...prev, [it.id]: e.target.value }))
                        }
                        className="w-20 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-mono font-bold"
                      />
                      <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300 font-bold">
                        {it.unitPrice > 0 ? `= ${fmtNum(estTotal)} ريال` : ""}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isOut}
                      data-testid={`portal-catalog-add-${it.id}`}
                      onClick={() => onAddToOrder(it, qtyVal)}
                      className="px-3.5 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1 disabled:opacity-40"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>{isOut ? "غير متوفر" : "إضافة إلى الطلب"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

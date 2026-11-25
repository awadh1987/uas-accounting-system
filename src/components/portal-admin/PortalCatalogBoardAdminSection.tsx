"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  Edit3,
  EyeOff,
  Layers,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ActionOverflowMenu } from "@/components/ActionOverflowMenu";
import { UasDateInput } from "@/components/UasDateInput";
import {
  CATALOG_AVAILABILITY_LABELS,
  PORTAL_GRADE_PRESETS,
  type CatalogAvailabilityStatus,
  type ClientCatalogBoardStats,
  type StaffCatalogBoardItemView,
} from "@/lib/clientPortal/portalTypes";
import type { TenantFormConfig } from "@/lib/clientPortal/portalConfig";
import { filterOutSyntheticTestRecords, isSyntheticTestRecord } from "@/lib/testRecordHygiene";
import { formatIsoToDmy, formatMoney, formatRefreshTimestamp } from "@/lib/uiFormatters";

interface InventorySuggestion {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  grade: string | null;
  sellPrice: number;
  baseUnitCode: string;
  baseUnitLabel: string;
}

interface PortalCatalogBoardAdminSectionProps {
  formConfig: TenantFormConfig | null;
  hideTestRecords: boolean;
  onToast: (msg: string) => void;
}

export function PortalCatalogBoardAdminSection({
  formConfig,
  hideTestRecords,
  onToast,
}: PortalCatalogBoardAdminSectionProps) {
  const [items, setItems] = useState<StaffCatalogBoardItemView[]>([]);
  const [stats, setStats] = useState<ClientCatalogBoardStats | null>(null);
  const [suggestions, setSuggestions] = useState<InventorySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");

  // Batch freshness bar
  const [batchFreshness, setBatchFreshness] = useState("قائمة أسعار اليوم");
  const [batchEffectiveDate, setBatchEffectiveDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [batchValidityNote, setBatchValidityNote] = useState("الأسعار محدثة لهذا اليوم حتى نفاد الكمية");

  // Single Item Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [sku, setSku] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [gradeChoice, setGradeChoice] = useState<string>("درجة أولى");
  const [customGrade, setCustomGrade] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("أصناف القات والطازج");
  const [unitCode, setUnitCode] = useState("QAT_BUNCH");
  const [customUnitLabel, setCustomUnitLabel] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [availabilityStatus, setAvailabilityStatus] =
    useState<CatalogAvailabilityStatus>("AVAILABLE");
  const [pickupLocation, setPickupLocation] = useState("");
  const [freshnessLabel, setFreshnessLabel] = useState("قائمة أسعار اليوم");
  const [effectiveDate, setEffectiveDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [validityNote, setValidityNote] = useState("");
  const [notes, setNotes] = useState("");
  const [isPublished, setIsPublished] = useState(true);

  const loadBoard = useCallback(
    async (manual = false) => {
      setLoading(true);
      try {
        const res = await fetch("/api/portal-admin/catalog", { cache: "no-store" });
        if (!res.ok) {
          if (manual) onToast("تعذر تحميل لوحة الأصناف والأسعار");
          return;
        }
        const data = (await res.json()) as {
          items?: StaffCatalogBoardItemView[];
          stats?: ClientCatalogBoardStats;
          inventorySuggestions?: InventorySuggestion[];
        };
        setItems(data.items || []);
        setStats(data.stats || null);
        setSuggestions(data.inventorySuggestions || []);
        setLastRefreshedAt(new Date().toISOString());
        if (manual) onToast("✅ تم تحديث لوحة الأصناف والفرز والأسعار");
      } finally {
        setLoading(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadBoard(false);
    });
    return () => {
      active = false;
    };
  }, [loadBoard]);

  function resetForm() {
    setEditingId(null);
    setInventoryItemId("");
    setSku("");
    setTitleAr("");
    setGradeChoice("درجة أولى");
    setCustomGrade("");
    setCategoryLabel("أصناف القات والطازج");
    setUnitCode("QAT_BUNCH");
    setCustomUnitLabel("");
    setUnitPrice("");
    setAvailabilityStatus("AVAILABLE");
    setPickupLocation("");
    setFreshnessLabel(batchFreshness || "قائمة أسعار اليوم");
    setEffectiveDate(batchEffectiveDate || new Date().toISOString().slice(0, 10));
    setValidityNote(batchValidityNote || "");
    setNotes("");
    setIsPublished(true);
  }

  function startEditItem(it: StaffCatalogBoardItemView) {
    setEditingId(it.id);
    setInventoryItemId(it.inventoryItemId || "");
    setSku(it.sku || "");
    setTitleAr(it.titleAr);
    const isPresetGrade = (PORTAL_GRADE_PRESETS as readonly string[]).includes(it.gradeLabel);
    if (isPresetGrade) {
      setGradeChoice(it.gradeLabel);
      setCustomGrade("");
    } else {
      setGradeChoice("OTHER");
      setCustomGrade(it.gradeLabel);
    }
    setCategoryLabel(it.categoryLabel || "أصناف عامة");
    setUnitCode(it.unitCode || "QAT_BUNCH");
    setCustomUnitLabel(it.customUnitLabel || "");
    setUnitPrice(String(it.unitPrice || 0));
    setAvailabilityStatus(it.availabilityStatus);
    setPickupLocation(it.pickupLocation || "");
    setFreshnessLabel(it.freshnessLabel || "قائمة أسعار اليوم");
    setEffectiveDate(it.effectiveDate || new Date().toISOString().slice(0, 10));
    setValidityNote(it.validityNote || "");
    setNotes(it.notes || "");
    setIsPublished(it.isPublished);
  }

  async function handleSaveItem(e: React.FormEvent, forcePublish?: boolean) {
    e.preventDefault();
    const finalGrade = gradeChoice === "OTHER" ? customGrade.trim() || "فرز خاص" : gradeChoice;
    const uOpt = (formConfig?.unitOptions || []).find((u) => u.code === unitCode);

    setSaving(true);
    try {
      const res = await fetch("/api/portal-admin/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPSERT",
          id: editingId || undefined,
          inventoryItemId: inventoryItemId || null,
          sku: sku || null,
          titleAr,
          gradeLabel: finalGrade,
          categoryLabel,
          unitCode,
          unitLabel: unitCode === "OTHER" ? customUnitLabel.trim() || "أخرى" : uOpt?.labelAr || "علاقية قات",
          customUnitLabel: unitCode === "OTHER" ? customUnitLabel.trim() : null,
          unitPrice: Number(unitPrice || 0),
          availabilityStatus,
          pickupLocation: pickupLocation.trim() || null,
          freshnessLabel: freshnessLabel.trim() || "قائمة أسعار اليوم",
          effectiveDate,
          validityNote: validityNote.trim() || null,
          notes: notes.trim() || null,
          isPublished: forcePublish !== undefined ? forcePublish : isPublished,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        onToast(data.error || "تعذر حفظ بطاقة الصنف");
        return;
      }
      onToast(data.message || "✅ تم حفظ بطاقة الصنف بنجاح");
      resetForm();
      await loadBoard(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleBatchAction(
    action: "PUBLISH" | "UNPUBLISH" | "SEED_FROM_INVENTORY",
    ids: string[] = []
  ) {
    setSaving(true);
    try {
      const res = await fetch("/api/portal-admin/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ids,
          freshnessLabel: batchFreshness,
          effectiveDate: batchEffectiveDate,
          validityNote: batchValidityNote,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      onToast(res.ok ? data.message || "✅ تم التنفيذ بنجاح" : data.error || "تعذر التنفيذ");
      if (res.ok) await loadBoard(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickAvailabilityChange(
    it: StaffCatalogBoardItemView,
    nextStatus: CatalogAvailabilityStatus
  ) {
    const res = await fetch("/api/portal-admin/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "UPSERT",
        id: it.id,
        inventoryItemId: it.inventoryItemId,
        sku: it.sku,
        titleAr: it.titleAr,
        gradeLabel: it.gradeLabel,
        categoryLabel: it.categoryLabel,
        unitCode: it.unitCode,
        unitLabel: it.unitLabel,
        customUnitLabel: it.customUnitLabel,
        unitPrice: it.unitPrice,
        availabilityStatus: nextStatus,
        pickupLocation: it.pickupLocation,
        freshnessLabel: it.freshnessLabel,
        effectiveDate: it.effectiveDate,
        validityNote: it.validityNote,
        notes: it.notes,
        isPublished: it.isPublished,
      }),
    });
    if (res.ok) {
      onToast(`✅ تم تحديث توفر (${it.titleAr}) إلى ${CATALOG_AVAILABILITY_LABELS[nextStatus]}`);
      await loadBoard(false);
    }
  }

  async function handleDeleteItem(id: string) {
    const res = await fetch("/api/portal-admin/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DELETE", id }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    onToast(res.ok ? data.message || "تم حذف الصنف" : data.error || "تعذر الحذف");
    if (res.ok) await loadBoard(false);
  }

  const { visible: visibleItems, hiddenCount } = filterOutSyntheticTestRecords(items, hideTestRecords);
  const draftCount = visibleItems.filter((x) => !x.isPublished).length;
  const publishedCount = visibleItems.filter((x) => x.isPublished).length;

  return (
    <div className="space-y-4" data-testid="staff-portal-catalog-admin">
      {/* Freshness & Batch Publish Control Strip */}
      <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-black text-sm flex items-center gap-1.5 text-emerald-900 dark:text-emerald-200">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>إعداد ونشر قائمة الأصناف والفرز والأسعار للعملاء</span>
            </h4>
            <p className="text-[11px] text-slate-500">
              تظهر للعملاء فقط الأصناف المنشورة بالأسعار المحددة وحالة التوفر، مع عزل تام عن أسعار الشراء والتكلفة والهوامش الداخلية.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastRefreshedAt && (
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                {formatRefreshTimestamp(lastRefreshedAt)}
              </span>
            )}
            <button
              type="button"
              disabled={loading || saving}
              onClick={() => void loadBoard(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleBatchAction("SEED_FROM_INVENTORY")}
              className="px-3 py-1.5 rounded-xl border border-indigo-400 text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
            >
              <Download className="w-3.5 h-3.5" />
              <span>جلب من المخزون كمسودات</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end">
          <div>
            <label className="block font-bold mb-1">وسم القائمة / التحديث</label>
            <input
              type="text"
              value={batchFreshness}
              onChange={(e) => setBatchFreshness(e.target.value)}
              placeholder="قائمة أسعار اليوم"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">تاريخ القائمة / القطفة (يوم/شهر/سنة)</label>
            <UasDateInput value={batchEffectiveDate} onChange={setBatchEffectiveDate} />
          </div>
          <div>
            <label className="block font-bold mb-1">ملاحظة الصلاحية</label>
            <input
              type="text"
              value={batchValidityNote}
              onChange={(e) => setBatchValidityNote(e.target.value)}
              placeholder="مثال: صالحة حتى نفاد الكمية"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={saving || items.length === 0}
              data-testid="staff-catalog-publish-all"
              onClick={() => void handleBatchAction("PUBLISH", items.map((x) => x.id))}
              className="flex-1 px-3 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>نشر للعملاء ({items.length})</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-bold">
          <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            منشور للعملاء: {publishedCount}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            مسودات غير منشورة: {draftCount}
          </span>
          {stats && (
            <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              الدرجات: {stats.gradesCount} • المتوفر: {stats.availableCount} • المحدود: {stats.limitedCount}
            </span>
          )}
          {hiddenCount > 0 && hideTestRecords && (
            <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
              تم إخفاء {hiddenCount} سجل اختباري
            </span>
          )}
        </div>
      </div>

      {/* Prepare / Grade / Price Item Form */}
      <form
        onSubmit={(e) => void handleSaveItem(e)}
        className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <h5 className="font-black text-xs flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-emerald-600" />
            <span>{editingId ? "تعديل بطاقة صنف في اللوحة" : "إضافة صنف وتحديد الفرز والسعر"}</span>
          </h5>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold"
            >
              إلغاء التعديل
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          {suggestions.length > 0 && (
            <div className="sm:col-span-4">
              <label className="block font-bold mb-1">اختيار سريع من دليل الأصناف</label>
              <select
                value={inventoryItemId}
                onChange={(e) => {
                  const id = e.target.value;
                  setInventoryItemId(id);
                  const found = suggestions.find((s) => s.id === id);
                  if (found) {
                    setTitleAr(found.nameAr);
                    setSku(found.sku);
                    if (found.grade) {
                      if ((PORTAL_GRADE_PRESETS as readonly string[]).includes(found.grade)) {
                        setGradeChoice(found.grade);
                      } else {
                        setGradeChoice("OTHER");
                        setCustomGrade(found.grade);
                      }
                    }
                    if (found.sellPrice > 0) setUnitPrice(String(found.sellPrice));
                    if (found.baseUnitCode) setUnitCode(found.baseUnitCode.toUpperCase());
                  }
                }}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
              >
                <option value="">إدخال صنف مخصص / مباشر...</option>
                {suggestions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameAr} {s.grade ? `(${s.grade})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={suggestions.length > 0 ? "sm:col-span-4" : "sm:col-span-6"}>
            <label className="block font-bold mb-1">اسم الصنف المعروض للعميل *</label>
            <input
              type="text"
              required
              value={titleAr}
              onChange={(e) => setTitleAr(e.target.value)}
              placeholder="مثال: قات صوطي قطفة صباحية"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-bold"
            />
          </div>

          <div className="sm:col-span-4">
            <label className="block font-bold mb-1">الدرجة / الفرز *</label>
            <div className="flex gap-1.5">
              <select
                value={gradeChoice}
                onChange={(e) => setGradeChoice(e.target.value)}
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
              >
                {PORTAL_GRADE_PRESETS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value="OTHER">أخرى (تحديد مخصص)</option>
              </select>
              {gradeChoice === "OTHER" && (
                <input
                  type="text"
                  required
                  value={customGrade}
                  onChange={(e) => setCustomGrade(e.target.value)}
                  placeholder="الفرز..."
                  className="w-32 rounded-xl border border-emerald-400 bg-transparent px-2.5 py-2"
                />
              )}
            </div>
          </div>

          <div className="sm:col-span-3">
            <label className="block font-bold mb-1">الوحدة *</label>
            <select
              value={unitCode}
              onChange={(e) => setUnitCode(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
            >
              {(formConfig?.unitOptions || []).map((u) => (
                <option key={u.code} value={u.code}>
                  {u.labelAr}
                </option>
              ))}
            </select>
            {unitCode === "OTHER" && (
              <input
                type="text"
                required
                value={customUnitLabel}
                onChange={(e) => setCustomUnitLabel(e.target.value)}
                placeholder="اخرى: اسم الوحدة المخصصة..."
                className="mt-1.5 w-full rounded-xl border border-emerald-400 bg-transparent px-2.5 py-1.5"
              />
            )}
          </div>

          <div className="sm:col-span-3">
            <label className="block font-bold mb-1">سعر الوحدة المعلن (ريال) *</label>
            <input
              type="number"
              required
              min="0"
              step="any"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="مثال: 5500"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono font-bold"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block font-bold mb-1">حالة التوفر *</label>
            <select
              value={availabilityStatus}
              onChange={(e) => setAvailabilityStatus(e.target.value as CatalogAvailabilityStatus)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
            >
              <option value="AVAILABLE">متوفر</option>
              <option value="LIMITED">كمية محدودة</option>
              <option value="UNAVAILABLE">غير متوفر</option>
            </select>
          </div>

          <div className="sm:col-span-3">
            <label className="block font-bold mb-1">موقع استلام افتراضي (استلام من:)</label>
            <select
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
            >
              <option value="">حسب اختيار العميل</option>
              {(formConfig?.pickupOptions || [])
                .filter((p) => p.type !== "OTHER")
                .map((p) => (
                  <option key={p.code} value={p.labelAr}>
                    {p.labelAr}
                  </option>
                ))}
            </select>
          </div>

          <div className="sm:col-span-4">
            <label className="block font-bold mb-1">وسم القائمة / الطزاجة</label>
            <input
              type="text"
              value={freshnessLabel}
              onChange={(e) => setFreshnessLabel(e.target.value)}
              placeholder="قائمة أسعار اليوم"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
            />
          </div>

          <div className="sm:col-span-4">
            <label className="block font-bold mb-1">تاريخ القائمة / القطفة</label>
            <UasDateInput value={effectiveDate} onChange={setEffectiveDate} />
          </div>

          <div className="sm:col-span-4">
            <label className="block font-bold mb-1">ملاحظة الصلاحية / المواصفات</label>
            <input
              type="text"
              value={validityNote}
              onChange={(e) => setValidityNote(e.target.value)}
              placeholder="مثال: صالحة حتى الساعة 6 مساءً"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            <span>نشر مباشرة للعملاء في بوابة العملاء (إزالة التحديد يحفظه كمسودة)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={(e) => void handleSaveItem(e, false)}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-50"
            >
              حفظ كمسودة
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isPublished ? "حفظ ونشر للعملاء" : "حفظ البطاقة"}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Prepared & Published Board List */}
      <div className="space-y-2">
        {visibleItems.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
            لا توجد أصناف معدة في لوحة بوابة العملاء حالياً. استخدم النموذج أعلاه أو استورد مسودات من المخزون.
          </div>
        ) : (
          visibleItems.map((it) => {
            const isTestRow = isSyntheticTestRecord(it);
            return (
              <div
                key={it.id}
                className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-sm">{it.titleAr}</span>
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
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        it.isPublished
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {it.isPublished ? "منشور للعملاء" : "مسودة داخلية"}
                    </span>
                    {isTestRow && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                        سجل اختباري
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
                    <span>
                      السعر:{" "}
                      <strong className="text-emerald-700 dark:text-emerald-300 font-mono">
                        {formatMoney(it.unitPrice, it.currency)} / {it.displayUnitLabel}
                      </strong>
                    </span>
                    <span>• الوسم: {it.freshnessLabel}</span>
                    {it.effectiveDateDmy && (
                      <span className="font-mono">
                        • <bdi dir="ltr">{formatIsoToDmy(it.effectiveDate)}</bdi>
                      </span>
                    )}
                    {it.pickupLocation && <span>• استلام من: {it.pickupLocation}</span>}
                    {it.validityNote && <span>• ({it.validityNote})</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void handleBatchAction(it.isPublished ? "UNPUBLISH" : "PUBLISH", [it.id])
                    }
                    className={`px-3 py-1.5 rounded-xl font-bold inline-flex items-center gap-1 ${
                      it.isPublished
                        ? "border border-slate-300 dark:border-slate-700"
                        : "accent-bg"
                    }`}
                  >
                    {it.isPublished ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>إيقاف النشر</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>نشر للعملاء</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditItem(it)}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل</span>
                  </button>
                  <ActionOverflowMenu
                    size="sm"
                    align="end"
                    items={[
                      {
                        id: "avail-ok",
                        label: "تعيين الحالة: متوفر",
                        hidden: it.availabilityStatus === "AVAILABLE",
                        onClick: () => handleQuickAvailabilityChange(it, "AVAILABLE"),
                      },
                      {
                        id: "avail-lim",
                        label: "تعيين الحالة: كمية محدودة",
                        hidden: it.availabilityStatus === "LIMITED",
                        onClick: () => handleQuickAvailabilityChange(it, "LIMITED"),
                      },
                      {
                        id: "avail-no",
                        label: "تعيين الحالة: غير متوفر",
                        tone: "warning",
                        hidden: it.availabilityStatus === "UNAVAILABLE",
                        onClick: () => handleQuickAvailabilityChange(it, "UNAVAILABLE"),
                      },
                      {
                        id: "delete",
                        label: "حذف الصنف من اللوحة",
                        icon: <Trash2 className="w-3.5 h-3.5" />,
                        tone: "danger",
                        dividerBefore: true,
                        confirmTitle: `حذف (${it.titleAr})`,
                        confirmMessage: "هل تريد حذف هذه البطاقة من لوحة الأسعار؟",
                        onClick: () => handleDeleteItem(it.id),
                      },
                    ]}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

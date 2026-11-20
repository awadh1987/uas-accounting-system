"use client";

import { CostCenterSelector } from "@/components/CostCenterSelector";
import { SaveDraftButton } from "@/components/SaveDraftButton";

import React, { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, Boxes, Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { safeFetchJson } from "@/lib/apiClient";
import { fmtNum } from "@/lib/formulas";

interface UomRecord {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isBaseDefault: boolean;
  isCustom: boolean;
}

interface CategoryRecord {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isCustom: boolean;
}

interface WarehouseRecord {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  isDefault: boolean;
  isCustom: boolean;
  isActive?: boolean;
  archivedAt?: string | null;
}

interface ConversionRowDraft {
  unitId: string;
  customUnitLabel: string;
  factorToBase: string;
  barcode: string;
  sellPrice: string;
  isDefaultSalesUnit: boolean;
  isDefaultPurchaseUnit: boolean;
}

interface InventoryItemRecord {
  id: string;
  sku: string;
  barcode?: string | null;
  nameAr: string;
  nameEn: string;
  itemType: string;
  grade?: string | null;
  origin?: string | null;
  purchasePrice: number;
  wholesalePrice: number;
  retailPrice: number;
  minSellPrice: number;
  baseUnitId: string;
  baseUnit?: UomRecord;
  category?: CategoryRecord | null;
  defaultWarehouse?: WarehouseRecord | null;
  conversions?: Array<{
    id: string;
    unitId: string;
    customUnitLabel?: string | null;
    factorToBase: number;
    sellPrice?: number | null;
    unit?: UomRecord;
  }>;
  totalBaseQty?: number;
  compoundBreakdown?: string;
  isActive?: boolean;
  archivedAt?: string | null;
}

interface MultiUnitInventoryPanelProps {
  lang?: "ar" | "en";
  readOnly?: boolean;
  onToast?: (msg: string) => void;
}

export function MultiUnitInventoryPanel({
  lang = "ar",
  readOnly = false,
  onToast,
}: MultiUnitInventoryPanelProps) {
  const isAr = lang === "ar";
  const notify = (msg: string) => onToast?.(msg);

  const [units, setUnits] = useState<UomRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([]);
  const [items, setItems] = useState<InventoryItemRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Item Master Form State (every selector has "OTHER" custom inline option)
  const [showItemForm, setShowItemForm] = useState(false);
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [customCategoryName, setCustomCategoryName] = useState("");
  const [itemType, setItemType] = useState("STOCKABLE");
  const [customItemType, setCustomItemType] = useState("");
  const [grade, setGrade] = useState("درجة أولى");
  const [customGrade, setCustomGrade] = useState("");
  const [origin, setOrigin] = useState("محلي");
  const [customOrigin, setCustomOrigin] = useState("");
  const [baseUnitId, setBaseUnitId] = useState("");
  const [customBaseUnitName, setCustomBaseUnitName] = useState("");
  const [defaultWarehouseId, setDefaultWarehouseId] = useState("");
  const [customWarehouseName, setCustomWarehouseName] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [wholesalePrice, setWholesalePrice] = useState("");
  const [retailPrice, setRetailPrice] = useState("");
  const [conversions, setConversions] = useState<ConversionRowDraft[]>([]);
  const [savingItem, setSavingItem] = useState(false);

  // Quick Multi-Unit Stock Movement State
  const [movItemId, setMovItemId] = useState("");
  const [movWarehouseId, setMovWarehouseId] = useState("");
  const [movCustomWarehouse, setMovCustomWarehouse] = useState("");
  const [movType, setMovType] = useState("PURCHASE_IN");
  const [movUnitId, setMovUnitId] = useState("");
  const [movCustomUnitLabel, setMovCustomUnitLabel] = useState("");
  const [movCustomFactor, setMovCustomFactor] = useState("1");
  const [movQty, setMovQty] = useState("");
  const [movUnitCost, setMovUnitCost] = useState("");
  const [movCostCenterId, setMovCostCenterId] = useState("");
  const [savingMov, setSavingMov] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, cRes, wRes, iRes] = await Promise.all([
        safeFetchJson<{ units?: UomRecord[] }>("/api/inventory/uom"),
        safeFetchJson<{ categories?: CategoryRecord[] }>("/api/inventory/categories"),
        safeFetchJson<{ warehouses?: WarehouseRecord[] }>("/api/inventory/warehouses"),
        safeFetchJson<{ items?: InventoryItemRecord[] }>("/api/inventory/items"),
      ]);
      if (uRes.ok && uRes.data?.units) {
        setUnits(uRes.data.units);
        if (!baseUnitId && uRes.data.units.length > 0) {
          setBaseUnitId(uRes.data.units[0].id);
        }
      }
      if (cRes.ok && cRes.data?.categories) {
        setCategories(cRes.data.categories);
        if (!categoryId && cRes.data.categories.length > 0) {
          setCategoryId(cRes.data.categories[0].id);
        }
      }
      if (wRes.ok && wRes.data?.warehouses) {
        setWarehouses(wRes.data.warehouses);
        if (!defaultWarehouseId && wRes.data.warehouses.length > 0) {
          setDefaultWarehouseId(wRes.data.warehouses[0].id);
          setMovWarehouseId(wRes.data.warehouses[0].id);
        }
      }
      if (iRes.ok && iRes.data?.items) {
        setItems(iRes.data.items);
        if (!movItemId && iRes.data.items.length > 0) {
          setMovItemId(iRes.data.items[0].id);
          setMovUnitId(iRes.data.items[0].baseUnitId);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [baseUnitId, categoryId, defaultWarehouseId, movItemId]);

  const [showArchivedItems, setShowArchivedItems] = useState(false);

  const handleArchiveItem = useCallback(
    async (item: InventoryItemRecord) => {
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "InventoryItem", id: item.id, action: "ARCHIVE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        notify(data.message || "تمت أرشفة الصنف بنجاح");
        await loadAll();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر أرشفة الصنف";
        notify(msg);
      }
    },
    [loadAll]
  );

  const handleRestoreItem = useCallback(
    async (item: InventoryItemRecord) => {
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "InventoryItem", id: item.id, action: "RESTORE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        notify(data.message || "تمت استعادة الصنف بنجاح");
        await loadAll();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر استعادة الصنف";
        notify(msg);
      }
    },
    [loadAll]
  );

  const handleDeleteItem = useCallback(
    async (item: InventoryItemRecord) => {
      if (
        !confirm(
          `هل أنت متأكد من حذف الصنف (${item.nameAr})؟ في حال وجود حركات مخزنية أو فواتير مرتبطة سيتم أرشفته آلياً حفاظاً على التاريخ المالي.`
        )
      )
        return;
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "InventoryItem", id: item.id, action: "SAFE_DELETE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        notify(data.message || "تمت العملية بنجاح");
        await loadAll();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر حذف الصنف";
        notify(msg);
      }
    },
    [loadAll]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function addConversionRow() {
    setConversions((prev) => [
      ...prev,
      {
        unitId: units[1]?.id || "OTHER",
        customUnitLabel: "",
        factorToBase: "10",
        barcode: "",
        sellPrice: "",
        isDefaultSalesUnit: false,
        isDefaultPurchaseUnit: false,
      },
    ]);
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!nameAr.trim()) return;
    setSavingItem(true);
    try {
      const res = await safeFetchJson<{ success?: boolean; error?: string }>("/api/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: sku.trim() || undefined,
          barcode: barcode.trim() || undefined,
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || nameAr.trim(),
          categoryId,
          customCategoryName: categoryId === "OTHER" ? customCategoryName.trim() : undefined,
          itemType,
          customItemType: itemType === "OTHER" ? customItemType.trim() : undefined,
          grade,
          customGrade: grade === "OTHER" ? customGrade.trim() : undefined,
          origin,
          customOrigin: origin === "OTHER" ? customOrigin.trim() : undefined,
          baseUnitId,
          customBaseUnitName: baseUnitId === "OTHER" ? customBaseUnitName.trim() : undefined,
          defaultWarehouseId,
          customWarehouseName: defaultWarehouseId === "OTHER" ? customWarehouseName.trim() : undefined,
          purchasePrice: Number(purchasePrice) || 0,
          wholesalePrice: Number(wholesalePrice) || 0,
          retailPrice: Number(retailPrice) || 0,
          conversions: conversions.map((c) => ({
            unitId: c.unitId,
            customUnitLabel: c.unitId === "OTHER" ? c.customUnitLabel.trim() : undefined,
            factorToBase: Number(c.factorToBase) || 1,
            barcode: c.barcode.trim() || undefined,
            sellPrice: c.sellPrice ? Number(c.sellPrice) : undefined,
            isDefaultSalesUnit: c.isDefaultSalesUnit,
            isDefaultPurchaseUnit: c.isDefaultPurchaseUnit,
          })),
        }),
      });
      if (!res.ok || !res.data?.success) {
        notify(res.data?.error || (isAr ? "تعذر حفظ بطاقة الصنف" : "Failed to save item"));
        return;
      }
      notify(isAr ? "تم حفظ بطاقة الصنف والوحدات المتعددة بنجاح" : "Item & multi-unit conversions saved");
      setSku("");
      setBarcode("");
      setNameAr("");
      setNameEn("");
      setCustomCategoryName("");
      setCustomBaseUnitName("");
      setCustomWarehouseName("");
      setCustomItemType("");
      setCustomGrade("");
      setCustomOrigin("");
      setConversions([]);
      setShowItemForm(false);
      await loadAll();
    } finally {
      setSavingItem(false);
    }
  }

  const activeMovItem = items.find((i) => i.id === movItemId);
  const resolvedFactor = (() => {
    if (!activeMovItem) return 1;
    if (movUnitId === "OTHER") return Math.max(0.0001, Number(movCustomFactor) || 1);
    if (!movUnitId || movUnitId === activeMovItem.baseUnitId) return 1;
    const conv = activeMovItem.conversions?.find((c) => c.unitId === movUnitId);
    return conv?.factorToBase || 1;
  })();
  const previewBaseQty = Math.round(((Number(movQty) || 0) * resolvedFactor + Number.EPSILON) * 10000) / 10000;

  async function handleRecordMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!movItemId) return;
    setSavingMov(true);
    try {
      const res = await safeFetchJson<{
        success?: boolean;
        compoundBreakdown?: string;
        warning?: string;
        error?: string;
      }>("/api/inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: movItemId,
          warehouseId: movWarehouseId,
          customWarehouseName: movWarehouseId === "OTHER" ? movCustomWarehouse.trim() : undefined,
          movementType: movType,
          enteredUnitId: movUnitId || activeMovItem?.baseUnitId,
          customUnitLabel: movUnitId === "OTHER" ? movCustomUnitLabel.trim() : undefined,
          factorToBase: resolvedFactor,
          enteredQty: Number(movQty) || 0,
          unitCost: Number(movUnitCost) || 0,
          costCenterId: movCostCenterId || undefined,
        }),
      });
      if (!res.ok || !res.data?.success) {
        notify(res.data?.error || (isAr ? "تعذر تسجيل الحركة المخزنية" : "Failed to record movement"));
        return;
      }
      notify(
        res.data.warning ||
          (isAr
            ? `تم تسجيل الحركة المخزنية • الرصيد المركب: ${res.data.compoundBreakdown || ""}`
            : `Movement recorded • Stock: ${res.data.compoundBreakdown || ""}`)
      );
      setMovQty("1");
      await loadAll();
    } finally {
      setSavingMov(false);
    }
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Header */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">
                {isAr ? "بطاقات الأصناف والمخزون متعدد الوحدات" : "Item Master Data & Multi-Unit Inventory"}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isAr
                  ? "إدارة الأصناف ومعاملات التحويل (كرتون / ربطة / حبة / أخرى مخصصة) مع الرصيد المركب"
                  : "Manage items, multi-unit conversion factors (with universal Other/Custom option), & compound stock"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAll}
              disabled={loading}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>{isAr ? "تحديث" : "Refresh"}</span>
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setShowItemForm((v) => !v)}
                className="px-3.5 py-1.5 rounded-xl accent-bg font-black inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isAr ? "+ إضافة بطاقة صنف" : "+ Add Item Master"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Item Master Creation Form */}
        {showItemForm && !readOnly && (
          <form
            onSubmit={handleSaveItem}
            className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3"
          >
            <div className="font-extrabold text-slate-700 dark:text-slate-200">
              {isAr ? "بطاقة صنف جديدة (تدعم خيار أخرى / مخصص في كل الحقول)" : "New Item Master (Universal Other / Custom Support)"}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input
                type="text"
                required
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder={isAr ? "اسم الصنف بالعربية *" : "Item Name (AR) *"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
              />
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder={isAr ? "الاسم بالإنجليزية" : "Item Name (EN)"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2"
              />
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder={isAr ? "رمز الصنف SKU (تلقائي إذا فارغ)" : "SKU (Auto if empty)"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono"
              />
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder={isAr ? "الباركود" : "Barcode"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono"
              />
            </div>

            {/* Universal "Other / Custom" Lookup Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Category */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">{isAr ? "التصنيف (Category)" : "Category"}</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.nameAr}</option>
                  ))}
                  <option value="OTHER">{isAr ? "➕ أخرى / مخصص (Other)" : "➕ Other / Custom"}</option>
                </select>
                {categoryId === "OTHER" && (
                  <input
                    type="text"
                    required
                    value={customCategoryName}
                    onChange={(e) => setCustomCategoryName(e.target.value)}
                    placeholder={isAr ? "اكتب اسم التصنيف المخصص..." : "Custom category name..."}
                    className="w-full rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  />
                )}
              </div>

              {/* Item Type */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">{isAr ? "نوع الصنف (Item Type)" : "Item Type"}</label>
                <select
                  value={itemType}
                  onChange={(e) => setItemType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                >
                  <option value="STOCKABLE">{isAr ? "مخزني (Stockable)" : "Stockable"}</option>
                  <option value="CONSUMABLE">{isAr ? "استهلاكي (Consumable)" : "Consumable"}</option>
                  <option value="SERVICE">{isAr ? "خدمي (Service)" : "Service"}</option>
                  <option value="OTHER">{isAr ? "➕ أخرى / مخصص (Other)" : "➕ Other / Custom"}</option>
                </select>
                {itemType === "OTHER" && (
                  <input
                    type="text"
                    required
                    value={customItemType}
                    onChange={(e) => setCustomItemType(e.target.value)}
                    placeholder={isAr ? "اكتب نوع الصنف المخصص..." : "Custom item type..."}
                    className="w-full rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  />
                )}
              </div>

              {/* Base Unit */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">{isAr ? "الوحدة الأساسية (Base UOM)" : "Base Unit"}</label>
                <select
                  value={baseUnitId}
                  onChange={(e) => setBaseUnitId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.nameAr} ({u.code})</option>
                  ))}
                  <option value="OTHER">{isAr ? "➕ وحدة أخرى مخصصة (Other)" : "➕ Other / Custom Unit"}</option>
                </select>
                {baseUnitId === "OTHER" && (
                  <input
                    type="text"
                    required
                    value={customBaseUnitName}
                    onChange={(e) => setCustomBaseUnitName(e.target.value)}
                    placeholder={isAr ? "اكتب اسم الوحدة الأساسية (مثلاً: قدح، جالون)..." : "Custom base unit..."}
                    className="w-full rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  />
                )}
              </div>

              {/* Grade */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">{isAr ? "الدرجة / الجودة (Grade)" : "Grade"}</label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                >
                  <option value="درجة أولى">درجة أولى (Grade 1)</option>
                  <option value="درجة ثانية">درجة ثانية (Grade 2)</option>
                  <option value="روس">روس (Premium)</option>
                  <option value="OTHER">{isAr ? "➕ أخرى / مخصص (Other)" : "➕ Other / Custom"}</option>
                </select>
                {grade === "OTHER" && (
                  <input
                    type="text"
                    required
                    value={customGrade}
                    onChange={(e) => setCustomGrade(e.target.value)}
                    placeholder={isAr ? "اكتب الدرجة المخصصة..." : "Custom grade..."}
                    className="w-full rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  />
                )}
              </div>

              {/* Origin */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">{isAr ? "المصدر / المنشأ (Origin)" : "Origin"}</label>
                <select
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                >
                  <option value="محلي">محلي (Local)</option>
                  <option value="مستورد">مستورد (Imported)</option>
                  <option value="OTHER">{isAr ? "➕ أخرى / مخصص (Other)" : "➕ Other / Custom"}</option>
                </select>
                {origin === "OTHER" && (
                  <input
                    type="text"
                    required
                    value={customOrigin}
                    onChange={(e) => setCustomOrigin(e.target.value)}
                    placeholder={isAr ? "اكتب المصدر المخصص..." : "Custom origin..."}
                    className="w-full rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  />
                )}
              </div>

              {/* Default Warehouse */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-500">{isAr ? "المستودع الافتراضي" : "Default Warehouse"}</label>
                <select
                  value={defaultWarehouseId}
                  onChange={(e) => setDefaultWarehouseId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.nameAr}</option>
                  ))}
                  <option value="OTHER">{isAr ? "➕ مستودع آخر مخصص (Other)" : "➕ Other / Custom Warehouse"}</option>
                </select>
                {defaultWarehouseId === "OTHER" && (
                  <input
                    type="text"
                    required
                    value={customWarehouseName}
                    onChange={(e) => setCustomWarehouseName(e.target.value)}
                    placeholder={isAr ? "اكتب اسم المستودع الجديد..." : "New warehouse name..."}
                    className="w-full rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  />
                )}
              </div>
            </div>

            {/* Pricing Tiers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500">{isAr ? "سعر الشراء (للوحدة الأساسية)" : "Purchase Price"}</span>
                <input
                  type="number"
                  step="any"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500">{isAr ? "سعر الجملة" : "Wholesale Price"}</span>
                <input
                  type="number"
                  step="any"
                  value={wholesalePrice}
                  onChange={(e) => setWholesalePrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500">{isAr ? "سعر التجزئة" : "Retail Price"}</span>
                <input
                  type="number"
                  step="any"
                  value={retailPrice}
                  onChange={(e) => setRetailPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono"
                />
              </label>
            </div>

            {/* Interactive Multi-Unit Conversion Table */}
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-extrabold inline-flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span>{isAr ? "الوحدات المتعددة ومعاملات التحويل (مثال: 1 كرتون = 240 حبة)" : "Multi-Unit Conversions (e.g. 1 Carton = 240 Pieces)"}</span>
                </span>
                <button
                  type="button"
                  onClick={addConversionRow}
                  className="px-2.5 py-1 rounded-lg border border-emerald-400 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>{isAr ? "إضافة وحدة تحويل" : "Add Unit Tier"}</span>
                </button>
              </div>

              {conversions.map((row, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center pt-1">
                  <select
                    value={row.unitId}
                    onChange={(e) => {
                      const next = [...conversions];
                      next[idx].unitId = e.target.value;
                      setConversions(next);
                    }}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-bold"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>{u.nameAr}</option>
                    ))}
                    <option value="OTHER">{isAr ? "➕ وحدة أخرى مخصصة" : "➕ Other / Custom Unit"}</option>
                  </select>

                  {row.unitId === "OTHER" ? (
                    <input
                      type="text"
                      required
                      value={row.customUnitLabel}
                      onChange={(e) => {
                        const next = [...conversions];
                        next[idx].customUnitLabel = e.target.value;
                        setConversions(next);
                      }}
                      placeholder={isAr ? "اسم الوحدة المخصصة..." : "Custom unit label..."}
                      className="rounded-lg border border-indigo-400 bg-transparent px-2 py-1.5"
                    />
                  ) : (
                    <input
                      type="text"
                      value={row.barcode}
                      onChange={(e) => {
                        const next = [...conversions];
                        next[idx].barcode = e.target.value;
                        setConversions(next);
                      }}
                      placeholder={isAr ? "باركود الوحدة" : "Unit Barcode"}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
                    />
                  )}

                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    value={row.factorToBase}
                    onChange={(e) => {
                      const next = [...conversions];
                      next[idx].factorToBase = e.target.value;
                      setConversions(next);
                    }}
                    placeholder={isAr ? "المعامل للوحدة الأساسية *" : "Factor to Base *"}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono font-bold"
                  />

                  <input
                    type="number"
                    step="any"
                    value={row.sellPrice}
                    onChange={(e) => {
                      const next = [...conversions];
                      next[idx].sellPrice = e.target.value;
                      setConversions(next);
                    }}
                    placeholder={isAr ? "سعر بيع الوحدة" : "Unit Sell Price"}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
                  />

                  <button
                    type="button"
                    onClick={() => setConversions((prev) => prev.filter((_, i) => i !== idx))}
                    className="px-2 py-1.5 rounded-lg border border-rose-300 text-rose-600 font-bold inline-flex items-center justify-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isAr ? "حذف" : "Remove"}</span>
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowItemForm(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-bold"
              >
                {isAr ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="submit"
                disabled={savingItem}
                className="px-4 py-1.5 rounded-lg accent-bg font-black disabled:opacity-50"
              >
                {savingItem ? (isAr ? "جاري الحفظ..." : "Saving...") : isAr ? "حفظ بطاقة الصنف" : "Save Item"}
              </button>
            </div>
          </form>
        )}

        {/* Quick Multi-Unit Stock Movement Bar */}
        {!readOnly && items.length > 0 && (
          <form
            onSubmit={handleRecordMovement}
            className="p-3.5 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/50 space-y-2.5"
          >
            <div className="font-extrabold flex items-center justify-between gap-2 text-indigo-800 dark:text-indigo-200">
              <span className="inline-flex items-center gap-1.5">
                <ArrowDownUp className="w-4 h-4" />
                <span>{isAr ? "تسجيل حركة مخزنية متعددة الوحدات (توريد / صرف / تسوية)" : "Multi-Unit Stock Movement"}</span>
              </span>
              {activeMovItem && (
                <span className="font-mono text-[11px] bg-white dark:bg-slate-900 px-2 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800">
                  {isAr
                    ? `المعادل الأساسي: ${fmtNum(previewBaseQty)} ${activeMovItem.baseUnit?.nameAr || ""}`
                    : `Base Equivalent: ${fmtNum(previewBaseQty)} ${activeMovItem.baseUnit?.nameEn || ""}`}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
              <select
                value={movItemId}
                onChange={(e) => {
                  setMovItemId(e.target.value);
                  const it = items.find((x) => x.id === e.target.value);
                  if (it) setMovUnitId(it.baseUnitId);
                }}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>{it.nameAr} ({it.sku})</option>
                ))}
              </select>

              <select
                value={movType}
                onChange={(e) => setMovType(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                <option value="PURCHASE_IN">{isAr ? "توريد مشتريات (+)" : "Purchase In (+)"}</option>
                <option value="SALE_OUT">{isAr ? "صرف مبيعات (-)" : "Sale Out (-)"}</option>
                <option value="ADJUSTMENT_IN">{isAr ? "تسوية بالزيادة (+)" : "Adjustment In (+)"}</option>
                <option value="ADJUSTMENT_OUT">{isAr ? "تسوية بالعجز (-)" : "Adjustment Out (-)"}</option>
                <option value="OPENING">{isAr ? "رصيد افتتاحي (+)" : "Opening Stock (+)"}</option>
              </select>

              <select
                value={movUnitId}
                onChange={(e) => setMovUnitId(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                {activeMovItem?.baseUnit && (
                  <option value={activeMovItem.baseUnitId}>
                    {activeMovItem.baseUnit.nameAr} (×1)
                  </option>
                )}
                {activeMovItem?.conversions?.map((c) => (
                  <option key={c.id} value={c.unitId}>
                    {c.customUnitLabel || c.unit?.nameAr} (×{c.factorToBase})
                  </option>
                ))}
                <option value="OTHER">{isAr ? "➕ وحدة أخرى مخصصة" : "➕ Other / Custom Unit"}</option>
              </select>

              <input
                type="number"
                step="any"
                min="0.0001"
                required
                value={movQty}
                onChange={(e) => setMovQty(e.target.value)}
                placeholder={isAr ? "الكمية" : "Qty"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono font-bold"
              />

              <input
                type="number"
                step="any"
                min="0"
                value={movUnitCost}
                onChange={(e) => setMovUnitCost(e.target.value)}
                placeholder={isAr ? "تكلفة الوحدة" : "Unit Cost"}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono"
              />

              <CostCenterSelector value={movCostCenterId} onChange={setMovCostCenterId} />
              <SaveDraftButton
                module="INVENTORY"
                formType="STOCK_MOVEMENT"
                getTitleAr={() => `مسودة حركة مخزنية (${movType})`}
                getPayload={() => ({ itemId: movItemId, warehouseId: movWarehouseId, movementType: movType, enteredUnitId: movUnitId, enteredQty: Number(movQty) || 0, unitCost: Number(movUnitCost) || 0, costCenterId: movCostCenterId || null })}
                getTotalAmount={() => (Number(movQty) || 0) * (Number(movUnitCost) || 0)}
                onToast={onToast}
              />

              <button
                type="submit"
                disabled={savingMov}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-black py-1.5 px-3 disabled:opacity-50"
              >
                {savingMov ? "..." : isAr ? "ترحيل الحركة" : "Post Move"}
              </button>
            </div>

            {movUnitId === "OTHER" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={movCustomUnitLabel}
                  onChange={(e) => setMovCustomUnitLabel(e.target.value)}
                  placeholder={isAr ? "اسم الوحدة المخصصة..." : "Custom unit name..."}
                  className="rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                />
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  required
                  value={movCustomFactor}
                  onChange={(e) => setMovCustomFactor(e.target.value)}
                  placeholder={isAr ? "معامل التحويل للوحدة الأساسية *" : "Factor to base *"}
                  className="rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5 font-mono font-bold"
                />
              </div>
            )}
            {movWarehouseId === "OTHER" && (
              <input
                type="text"
                required
                value={movCustomWarehouse}
                onChange={(e) => setMovCustomWarehouse(e.target.value)}
                placeholder={isAr ? "اسم المستودع المخصص..." : "Custom warehouse name..."}
                className="w-full rounded-lg border border-indigo-400 bg-white dark:bg-slate-900 px-2.5 py-1.5"
              />
            )}
          </form>
        )}

        {/* Archive / Active Filter Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/50">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="font-bold">{isAr ? "إجمالي الأصناف:" : "Total Items:"}</span>
            <span className="font-mono font-black">{items.length}</span>
            <span className="text-[10px] text-slate-400">
              ({isAr ? "النشطة" : "Active"}: {items.filter((i) => i.isActive !== false).length} •{" "}
              {isAr ? "المؤرشفة" : "Archived"}: {items.filter((i) => i.isActive === false).length})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowArchivedItems((p) => !p)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-extrabold transition ${
              showArchivedItems
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                : "bg-slate-200/50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600"
            }`}
          >
            {showArchivedItems
              ? isAr
                ? "إخفاء الأصناف المؤرشفة"
                : "Hide Archived Items"
              : isAr
              ? "إظهار الأصناف المؤرشفة"
              : "Show Archived Items"}
          </button>
        </div>

        {/* Item Master & Compound Stock Balance Table */}
        {items.filter((i) => (showArchivedItems ? true : i.isActive !== false)).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <th className="p-2">{isAr ? "الصنف / SKU" : "Item / SKU"}</th>
                  <th className="p-2">{isAr ? "التصنيف / النوع" : "Category / Type"}</th>
                  <th className="p-2">{isAr ? "الوحدة الأساسية والتحويلات" : "Base Unit & Conversions"}</th>
                  <th className="p-2">{isAr ? "الرصيد بالوحدة الأساسية" : "Total Base Qty"}</th>
                  <th className="p-2">{isAr ? "التفصيل المركب للرصيد" : "Compound Breakdown"}</th>
                  {!readOnly && <th className="p-2 no-print">{isAr ? "الإجراءات" : "Actions"}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {items
                  .filter((i) => (showArchivedItems ? true : i.isActive !== false))
                  .map((item) => {
                    const isArchived = item.isActive === false;
                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition ${
                          isArchived
                            ? "bg-amber-50/20 dark:bg-amber-950/10 text-slate-500"
                            : ""
                        }`}
                      >
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold">{item.nameAr}</span>
                            {isArchived && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                مؤرشف
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {item.sku} {item.grade ? `• ${item.grade}` : ""}{" "}
                            {item.origin ? `• ${item.origin}` : ""}
                          </div>
                        </td>
                        <td className="p-2">
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold">
                            {item.category?.nameAr || "عام"}
                          </span>
                          <div className="text-[10px] text-slate-400 mt-0.5">{item.itemType}</div>
                        </td>
                        <td className="p-2">
                          <div className="font-bold text-emerald-700 dark:text-emerald-300">
                            {item.baseUnit?.nameAr || "حبة"}
                          </div>
                          {item.conversions && item.conversions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.conversions.map((c) => (
                                <span
                                  key={c.id}
                                  className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-mono font-bold"
                                >
                                  1 {c.customUnitLabel || c.unit?.nameAr} = {c.factorToBase}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="p-2 font-mono font-black">
                          {fmtNum(item.totalBaseQty ?? 0)} {item.baseUnit?.nameAr || ""}
                        </td>
                        <td className="p-2">
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-extrabold">
                            {item.compoundBreakdown || `0 ${item.baseUnit?.nameAr || ""}`}
                          </span>
                        </td>
                        {!readOnly && (
                          <td className="p-2 no-print">
                            <div className="flex items-center gap-1.5">
                              {!isArchived ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleArchiveItem(item)}
                                    className="px-2 py-1 rounded border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 font-bold hover:bg-amber-50"
                                  >
                                    أرشفة
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteItem(item)}
                                    className="px-2 py-1 rounded border border-rose-300 dark:border-rose-700 text-rose-600 font-bold hover:bg-rose-50"
                                  >
                                    حذف
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleRestoreItem(item)}
                                    className="px-2 py-1 rounded border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 font-bold hover:bg-emerald-50"
                                  >
                                    استعادة
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteItem(item)}
                                    className="px-2 py-1 rounded border border-rose-300 dark:border-rose-700 text-rose-600 font-bold hover:bg-rose-50"
                                  >
                                    حذف نهائي
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
            {isAr
              ? "اضغط «+ إضافة بطاقة صنف» لإنشاء أول صنف متعدد الوحدات (كرتون / ربطة / حبة / وحدة مخصصة)."
              : "Click «+ Add Item Master» to create your first multi-unit inventory item."}
          </div>
        )}
      </div>
    </div>
  );
}

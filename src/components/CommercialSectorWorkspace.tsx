"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Layers,
  Package,
  Plus,
  RefreshCw,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import { formatIsoToDmy, formatIsoToDmyTime, formatMoney, formatRefreshTimestamp } from "@/lib/uiFormatters";
import type { ClientCatalogBoardItemView } from "@/lib/clientPortal/portalTypes";
import { MultiUnitInventoryPanel } from "@/components/MultiUnitInventoryPanel";

interface CommercialStockBucket {
  id: string;
  itemId: string;
  sku: string;
  itemNameAr: string;
  sectorType?: string;
  producerCompany?: string | null;
  countryOfOrigin?: string | null;
  productionDate?: string | null;
  expiryDate?: string | null;
  taxRate?: number;
  purchasePrice?: number;
  dispatchCost?: number;
  wholesalePrice?: number;
  retailPrice?: number;
  baseUnitLabel: string;
  warehouseId: string;
  warehouseNameAr: string;
  onHandBaseQty: number;
  reservedBaseQty: number;
  outboundStagedBaseQty: number;
  availableBaseQty: number;
  avgUnitCostBase: number;
  updatedAtDisplay: string;
}

interface CommercialMovementRow {
  id: string;
  movementType: string;
  direction?: "INBOUND" | "OUTBOUND";
  directionLabelAr?: string;
  enteredQty: number;
  baseQtyDelta: number;
  unitCostBase: number;
  createdAt: string;
  createdAtDisplay?: string;
  notes?: string | null;
  item?: { sku: string; nameAr: string; baseUnit?: { nameAr: string } };
  warehouse?: { nameAr: string };
  enteredUnit?: { nameAr: string };
}

interface CommercialDispatchView {
  id: string;
  dispatchNumber: string;
  requestId: string | null;
  driverName: string | null;
  vehicleInfo: string | null;
  tripStatus: string;
  podNotes: string | null;
  createdAt: string;
  createdAtDisplay: string;
  pickedAtDisplay: string | null;
  packedAtDisplay: string | null;
  dispatchedAtDisplay: string | null;
  deliveredAtDisplay: string | null;
}

interface CommercialRequestView {
  id: string;
  requestNumber: string;
  submissionType?: string;
  status: string;
  statusLabelAr: string;
  pickupLocation: string;
  totalEstimated: number;
  totalConfirmed: number;
  currency: string;
  linkedSalesRecordId?: string | null;
  linkedInvoiceId?: string | null;
  createdAtDisplay?: string;
  createdAt: string;
  clientAccount?: { fullName: string; phone: string } | null;
  lines: Array<{
    id: string;
    itemTitle: string;
    requestedQty: number;
    confirmedQty: number | null;
    displayUnitLabel: string;
    unitPrice: number;
    lineTotal: number;
    saleMode?: string;
  }>;
}

interface CommercialSectorWorkspaceProps {
  onRefreshState?: () => Promise<void>;
  onToast: (msg: string) => void;
  onSwitchToHarvestSector?: () => void;
}

const CATEGORY_LABELS_AR: Record<string, string> = {
  FOOD: "مواد غذائية",
  NON_FOOD: "بضائع غير غذائية",
  FUEL: "محروقات ووقود",
  GENERAL_COMMERCIAL: "تجارة عامة (جملة وتجزئة)",
};

const TRIP_STATUS_LABELS: Record<string, string> = {
  PENDING_PICK: "بانتظار السحب",
  PICKING: "قيد التجهيز والفرز",
  PACKED_STAGED: "مغلف وجاهز للشحن",
  IN_TRANSIT: "في الطريق للتسليم",
  DELIVERED: "تم التسليم (POD)",
  PARTIAL_RETURN: "تسليم جزئي / مرتجع",
};

export function CommercialSectorWorkspace({
  onRefreshState,
  onToast,
  onSwitchToHarvestSector,
}: CommercialSectorWorkspaceProps) {
  const [subTab, setSubTab] = useState<"orders" | "catalog" | "warehouse" | "dispatch">(
    "orders"
  );
  const [loading, setLoading] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const [commercialCatalog, setCommercialCatalog] = useState<ClientCatalogBoardItemView[]>([]);
  const [requests, setRequests] = useState<CommercialRequestView[]>([]);
  const [stockBuckets, setStockBuckets] = useState<CommercialStockBucket[]>([]);
  const [movements, setMovements] = useState<CommercialMovementRow[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; code: string; nameAr: string }>>([]);
  const [vendors, setVendors] = useState<Array<{ id: string; code: string; nameAr: string }>>([]);
  const [dispatches, setDispatches] = useState<CommercialDispatchView[]>([]);
  const [inventorySuggestions, setInventorySuggestions] = useState<
    Array<{ id: string; sku: string; nameAr: string; sellPrice: number; baseUnitLabel: string }>
  >([]);

  // Quick Catalog Item Form
  const [catTitle, setCatTitle] = useState("");
  const [catGroup, setCatGroup] = useState<"FOOD" | "NON_FOOD" | "FUEL" | "GENERAL_COMMERCIAL">("FOOD");
  const [catBulkLabel, setCatBulkLabel] = useState("كرتون جملة");
  const [catBulkPrice, setCatBulkPrice] = useState("");
  const [catPartialLabel, setCatPartialLabel] = useState("حبة / تجزئة");
  const [catPartialPrice, setCatPartialPrice] = useState("");
  const [catQty, setCatQty] = useState("50");
  const [catPickup, setCatPickup] = useState("المستودع الرئيسي");
  const [catProducer, setCatProducer] = useState("");
  const [catOrigin, setCatOrigin] = useState("");
  const [catProdDate, setCatProdDate] = useState("");
  const [catExpDate, setCatExpDate] = useState("");
  const [catTaxRate, setCatTaxRate] = useState("");
  const [catPurchasePrice, setCatPurchasePrice] = useState("");
  const [catDispatchCost, setCatDispatchCost] = useState("");

  // Quick GRN Form
  const [grnItemId, setGrnItemId] = useState("");
  const [grnWarehouseId, setGrnWarehouseId] = useState("");
  const [grnVendorId, setGrnVendorId] = useState("");
  const [grnQty, setGrnQty] = useState("10");
  const [grnCost, setGrnCost] = useState("");

  // Quick Dispatch Form
  const [dispReqId, setDispReqId] = useState("");
  const [dispDriver, setDispDriver] = useState("");
  const [dispVehicle, setDispVehicle] = useState("");
  const [podEdits, setPodEdits] = useState<Record<string, string>>({});

  const loadCommercial = useCallback(async (manual = false) => {
    setLoading(true);
    try {
      const res = await fetch("/api/commercial/ops", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        commercialCatalog?: ClientCatalogBoardItemView[];
        requests?: CommercialRequestView[];
        stockBuckets?: CommercialStockBucket[];
        movements?: CommercialMovementRow[];
        warehouses?: Array<{ id: string; code: string; nameAr: string }>;
        vendors?: Array<{ id: string; code: string; nameAr: string }>;
        dispatches?: CommercialDispatchView[];
        allInventorySuggestions?: Array<{
          id: string;
          sku: string;
          nameAr: string;
          sellPrice: number;
          baseUnitLabel: string;
        }>;
      };
      setCommercialCatalog(data.commercialCatalog || []);
      setRequests(data.requests || []);
      setStockBuckets(data.stockBuckets || []);
      setMovements(data.movements || []);
      setWarehouses(data.warehouses || []);
      setVendors(data.vendors || []);
      setDispatches(data.dispatches || []);
      setInventorySuggestions(data.allInventorySuggestions || []);
      if (!grnWarehouseId && data.warehouses?.[0]) setGrnWarehouseId(data.warehouses[0].id);
      if (!grnItemId && data.allInventorySuggestions?.[0]) setGrnItemId(data.allInventorySuggestions[0].id);
      setLastRefreshedAt(new Date().toISOString());
      if (manual) onToast("✅ تم تحديث عمليات القطاع التجاري والجملة والتجزئة");
    } finally {
      setLoading(false);
    }
  }, [grnWarehouseId, grnItemId, onToast]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadCommercial(false);
    });
    return () => {
      active = false;
    };
  }, [loadCommercial]);

  async function handleAddCommercialItem(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/commercial/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "UPSERT_ITEM",
        titleAr: catTitle,
        categoryGroup: catGroup,
        categoryLabel: CATEGORY_LABELS_AR[catGroup] || "تجارة عامة",
        gradeLabel: "جملة وتجزئة",
        saleMode: "BOTH",
        unitCode: "OTHER",
        unitLabel: catBulkLabel,
        customUnitLabel: catBulkLabel,
        unitPrice: Number(catBulkPrice || 0),
        bulkUnitLabel: catBulkLabel,
        partialUnitLabel: catPartialLabel,
        partialUnitPrice: Number(catPartialPrice || 0),
        publishedQty: Number(catQty || 0),
        remainingQty: Number(catQty || 0),
        pickupLocation: catPickup,
        producerCompany: catProducer.trim() || null,
        countryOfOrigin: catOrigin.trim() || null,
        productionDate: catProdDate.trim() || null,
        expiryDate: catExpDate.trim() || null,
        taxRate: catTaxRate !== "" ? Number(catTaxRate) : 0,
        purchasePrice: catPurchasePrice !== "" ? Number(catPurchasePrice) : 0,
        dispatchCost: catDispatchCost !== "" ? Number(catDispatchCost) : 0,
        isPublished: true,
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    onToast(res.ok ? data.message || "✅ تم نشر الصنف التجاري" : data.error || "تعذر الحفظ");
    if (res.ok) {
      setCatTitle("");
      setCatBulkPrice("");
      setCatPartialPrice("");
      setCatProducer("");
      setCatOrigin("");
      setCatProdDate("");
      setCatExpDate("");
      setCatTaxRate("");
      setCatPurchasePrice("");
      setCatDispatchCost("");
      await loadCommercial(false);
    }
  }

  async function handleHandoffRequest(requestId: string, action: "CONFIRM" | "HANDOVER") {
    const res = await fetch("/api/portal-admin/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, action }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    onToast(res.ok ? data.message || "✅ تم الترحيل بنجاح" : data.error || "تعذر المعالجة");
    if (res.ok) {
      await Promise.all([loadCommercial(false), onRefreshState?.()]);
    }
  }

  async function handleCreateGrn(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/commercial/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CREATE_INBOUND_GRN",
        itemId: grnItemId,
        warehouseId: grnWarehouseId,
        vendorId: grnVendorId || undefined,
        enteredQty: Number(grnQty || 0),
        unitCost: Number(grnCost || 0),
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    onToast(res.ok ? data.message || "✅ تم تسجيل الاستلام المخزني" : data.error || "تعذر القيد");
    if (res.ok) await loadCommercial(false);
  }

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/commercial/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CREATE_DISPATCH_TRIP",
        requestId: dispReqId || null,
        warehouseId: warehouses[0]?.id || null,
        driverName: dispDriver || "سائق التوزيع",
        vehicleInfo: dispVehicle || "شاحنة توزيع",
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    onToast(res.ok ? data.message || "✅ تم إنشاء أمر التجهيز والتوصيل" : data.error || "تعذر الإنشاء");
    if (res.ok) {
      setDispDriver("");
      setDispVehicle("");
      await loadCommercial(false);
    }
  }

  async function handleUpdateTripStatus(dispatchId: string, tripStatus: string) {
    const res = await fetch("/api/commercial/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "UPDATE_TRIP_STATUS",
        dispatchId,
        tripStatus,
        podNotes: podEdits[dispatchId],
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    onToast(res.ok ? data.message || "✅ تم تحديث حالة الرحلة" : data.error || "تعذر التحديث");
    if (res.ok) await loadCommercial(false);
  }

  return (
    <section data-testid="commercial-sector-workspace" className="space-y-5 text-xs">
      {/* Header Banner */}
      <div className="card-surface rounded-2xl p-4 border border-amber-300/70 dark:border-amber-800/60 bg-gradient-to-l from-amber-50/70 via-white to-emerald-50/40 dark:from-amber-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-amber-600" />
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              القطاع التجاري
            </h2>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            إدارة موحدة للبضائع الكاملة والجزئية (<bdi dir="ltr">P × Q</bdi>)، فرز الطلبات والربط المرجعي مع المبيعات (<bdi dir="ltr">linkedSalesRecordId</bdi>)، أرصدة المستودعات متعددة الوحدات، والتجهيز وإثبات التسليم (<bdi dir="ltr">POD</bdi>).
          </p>
          {lastRefreshedAt && (
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
              {formatRefreshTimestamp(lastRefreshedAt)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSwitchToHarvestSector && (
            <button
              type="button"
              onClick={onSwitchToHarvestSector}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
            >
              العودة إلى القطاع الزراعي
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadCommercial(true)}
            className="px-3 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card-surface rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800">
          <div className="text-slate-500 font-bold">أصناف القطاع التجاري</div>
          <div className="text-lg font-black mt-1 tabular-nums">{commercialCatalog.length}</div>
        </div>
        <div className="card-surface rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800">
          <div className="text-slate-500 font-bold">طلبات العملاء التجارية</div>
          <div className="text-lg font-black mt-1 text-emerald-600 tabular-nums">{requests.length}</div>
        </div>
        <div className="card-surface rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800">
          <div className="text-slate-500 font-bold">مواقع/أرصدة المستودعات</div>
          <div className="text-lg font-black mt-1 text-indigo-600 tabular-nums">{stockBuckets.length}</div>
        </div>
        <div className="card-surface rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800">
          <div className="text-slate-500 font-bold">رحلات التجهيز والتوصيل</div>
          <div className="text-lg font-black mt-1 text-amber-600 tabular-nums">{dispatches.length}</div>
        </div>
      </div>

      {/* Section 2 Workflow Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { id: "orders" as const, label: `طلبات القطاع التجاري (${requests.length})`, Icon: ClipboardCheck },
          { id: "catalog" as const, label: `الكتالوج متعدد الفئات (${commercialCatalog.length})`, Icon: Layers },
          { id: "warehouse" as const, label: `المستودعات والوارد (GRN / Buckets)`, Icon: Boxes },
          { id: "dispatch" as const, label: `التجهيز والرحلات وإثبات التسليم (${dispatches.length})`, Icon: Truck },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`px-3.5 py-2 rounded-xl font-extrabold inline-flex items-center gap-1.5 transition ${subTab === id
              ? "accent-bg shadow-sm"
              : "card-surface border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* 1. Core 1 Commercial Requests Triage & Sales Handoff */}
      {subTab === "orders" && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="card-surface rounded-2xl p-6 text-center text-slate-500">
              لا توجد طلبات تجارية واردة من بوابة العملاء حتى الآن. عند إرسال عميل لطلب عبر تبويب القطاع التجاري في البوابة، سيظهر هنا فوراً.
            </div>
          ) : (
            requests.map((r) => (
              <div
                key={r.id}
                className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-black px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      <bdi dir="ltr">{r.requestNumber}</bdi>
                    </span>
                    <span className="font-extrabold">{r.clientAccount?.fullName || "عميل"}</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px]">
                      {r.submissionType === "client_goods_registration"
                        ? "تسجيل بضاعة / طلب حر"
                        : "طلب من الكتالوج"}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                      {r.statusLabelAr}
                    </span>
                    <span className="text-slate-500">استلام من: <strong>{r.pickupLocation}</strong></span>
                    <span className="font-mono text-slate-400 inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <bdi dir="ltr">{r.createdAtDisplay || formatIsoToDmyTime(r.createdAt)}</bdi>
                    </span>
                  </div>
                  <div className="font-black text-emerald-700 dark:text-emerald-300">
                    {formatMoney(r.totalConfirmed > 0 ? r.totalConfirmed : r.totalEstimated, r.currency)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {r.lines.map((l) => (
                    <span
                      key={l.id}
                      className="px-2.5 py-1 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700"
                    >
                      {l.itemTitle}: <strong>{fmtNum(l.confirmedQty ?? l.requestedQty)}</strong> {l.displayUnitLabel} × {fmtNum(l.unitPrice)} ={" "}
                      <strong className="text-emerald-700 dark:text-emerald-300">{fmtNum(l.lineTotal)}</strong>
                    </span>
                  ))}
                </div>

                {r.status !== "COMPLETED" && r.status !== "CANCELLED" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleHandoffRequest(r.id, "CONFIRM")}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-bold"
                    >
                      {r.linkedSalesRecordId ? "تم فتح أمر البيع (مرتبط)" : "اعتماد وفتح أمر بيع"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleHandoffRequest(r.id, "HANDOVER")}
                      className="px-3 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>إتمام التسليم والترحيل للمحاسبة + الإشعارات</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 2. Commercial Catalog Setup (Bulk & Partial, Multi-Sector Categories) */}
      {subTab === "catalog" && (
        <div className="space-y-4">
          <form
            onSubmit={handleAddCommercialItem}
            className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
          >
            <div className="sm:col-span-3">
              <label className="block font-bold mb-1">اسم الصنف التجاري *</label>
              <input
                required
                value={catTitle}
                onChange={(e) => setCatTitle(e.target.value)}
                placeholder="مثال: أرز بسمتي / ديزل / زيوت..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold mb-1">الفئة التجارية</label>
              <select
                value={catGroup}
                onChange={(e) =>
                  setCatGroup(e.target.value as "FOOD" | "NON_FOOD" | "FUEL" | "GENERAL_COMMERCIAL")
                }
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                <option value="FOOD">مواد غذائية</option>
                <option value="NON_FOOD">بضائع استهلاكية</option>
                <option value="FUEL">محروقات ووقود</option>
                <option value="GENERAL_COMMERCIAL">تجارة عامة</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold mb-1">وحدة وسعر الجملة (Bulk)</label>
              <div className="flex gap-1">
                <input
                  value={catBulkLabel}
                  onChange={(e) => setCatBulkLabel(e.target.value)}
                  className="w-1/2 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5"
                />
                <input
                  type="number"
                  min="0"
                  required
                  value={catBulkPrice}
                  onChange={(e) => setCatBulkPrice(e.target.value)}
                  placeholder="السعر"
                  className="w-1/2 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold mb-1">تجزئة / جزئي (Partial)</label>
              <div className="flex gap-1">
                <input
                  value={catPartialLabel}
                  onChange={(e) => setCatPartialLabel(e.target.value)}
                  className="w-1/2 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5"
                />
                <input
                  type="number"
                  min="0"
                  value={catPartialPrice}
                  onChange={(e) => setCatPartialPrice(e.target.value)}
                  placeholder="السعر"
                  className="w-1/2 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
                />
              </div>
            </div>
            <div className="sm:col-span-1">
              <label className="block font-bold mb-1">الرصيد</label>
              <input
                type="number"
                min="0"
                value={catQty}
                onChange={(e) => setCatQty(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
              />
            </div>
            <div className="sm:col-span-2 flex gap-1.5">
              <input
                value={catPickup}
                onChange={(e) => setCatPickup(e.target.value)}
                placeholder="استلام من:"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>نشر</span>
              </button>
            </div>
            <div className="sm:col-span-6 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <input
                value={catProducer}
                onChange={(e) => setCatProducer(e.target.value)}
                placeholder="الشركة المنتجة"
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5"
              />
              <input
                value={catOrigin}
                onChange={(e) => setCatOrigin(e.target.value)}
                placeholder="بلد المنشأ"
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5"
              />
              <input
                type="date"
                title="تاريخ الإنتاج"
                value={catProdDate}
                onChange={(e) => setCatProdDate(e.target.value)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
              />
              <input
                type="date"
                title="تاريخ الانتهاء"
                value={catExpDate}
                onChange={(e) => setCatExpDate(e.target.value)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
              />
              <input
                type="number"
                step="any"
                min="0"
                value={catPurchasePrice}
                onChange={(e) => setCatPurchasePrice(e.target.value)}
                placeholder="سعر الشراء"
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
              />
              <input
                type="number"
                step="any"
                min="0"
                value={catDispatchCost}
                onChange={(e) => setCatDispatchCost(e.target.value)}
                placeholder="تكلفة التوصيل"
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
              />
              <input
                type="number"
                step="any"
                min="0"
                max="100"
                value={catTaxRate}
                onChange={(e) => setCatTaxRate(e.target.value)}
                placeholder="الضريبة %"
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 font-mono"
              />
            </div>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {commercialCatalog.map((item) => (
              <div
                key={item.id}
                className="card-surface rounded-2xl p-3.5 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
              >
                <div className="space-y-1">
                  <div className="font-black text-sm">{item.titleAr}</div>
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                      {CATEGORY_LABELS_AR[item.categoryGroup || "GENERAL_COMMERCIAL"] || item.categoryLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-mono font-bold">
                      المتبقي: {item.remainingQty ?? "مفتوح"}
                    </span>
                    {item.producerCompany && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold">
                        {item.producerCompany}
                      </span>
                    )}
                    {item.countryOfOrigin && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {item.countryOfOrigin}
                      </span>
                    )}
                    {item.expiryDate && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-mono">
                        انتهاء: <bdi dir="ltr">{formatIsoToDmy(item.expiryDate)}</bdi>
                      </span>
                    )}
                    {Number(item.taxRate || 0) > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-mono">
                        ضريبة {item.taxRate}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-left">
                  <div className="font-black text-emerald-700 dark:text-emerald-300">
                    {formatMoney(item.unitPrice, item.currency)} / {item.displayUnitLabel}
                  </div>
                  {Number(item.partialUnitPrice || 0) > 0 && (
                    <div className="text-[10px] text-indigo-600 dark:text-indigo-300 font-bold">
                      تجزئة: {formatMoney(Number(item.partialUnitPrice), item.currency)} / {item.partialUnitLabel || "قطعة"}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Warehouse Multi-Unit Stock Buckets & Inbound GRN */}
      {subTab === "warehouse" && (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateGrn}
            className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end"
          >
            <div>
              <label className="block font-bold mb-1">الصنف المخزني</label>
              <select
                value={grnItemId}
                onChange={(e) => setGrnItemId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                {inventorySuggestions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameAr}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">المستودع</label>
              <select
                value={grnWarehouseId}
                onChange={(e) => setGrnWarehouseId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.nameAr}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">المورد (اختياري)</label>
              <select
                value={grnVendorId}
                onChange={(e) => setGrnVendorId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                <option value="">استلام مباشر</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nameAr}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">كمية الاستلام (GRN)</label>
              <input
                type="number"
                min="0.01"
                step="any"
                value={grnQty}
                onChange={(e) => setGrnQty(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">التكلفة للوحدة</label>
              <input
                type="number"
                min="0"
                step="any"
                value={grnCost}
                onChange={(e) => setGrnCost(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-mono"
              />
            </div>
            <button type="submit" className="px-3.5 py-2 rounded-xl accent-bg font-extrabold">
              + قيد استلام وارد (GRN)
            </button>
          </form>

          <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b bg-slate-100 dark:bg-slate-800">
                  <th className="p-2">الصنف / SKU</th>
                  <th className="p-2">المنتج والمنشأ</th>
                  <th className="p-2">الإنتاج والانتهاء</th>
                  <th className="p-2">التكلفة / الضريبة / البيع</th>
                  <th className="p-2">المستودع</th>
                  <th className="p-2">الرصيد الفعلي (onHand)</th>
                  <th className="p-2">المحجوز (Reserved)</th>
                  <th className="p-2">قيد التجهيز (Staged)</th>
                  <th className="p-2">المتاح للبيع (Available)</th>
                  <th className="p-2">آخر تحديث</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {stockBuckets.map((b) => (
                  <tr key={b.id}>
                    <td className="p-2 font-bold">
                      {b.itemNameAr} <span className="text-slate-400 font-mono">({b.sku})</span>
                    </td>
                    <td className="p-2 text-[11px] text-slate-600 dark:text-slate-300">
                      <div>{b.producerCompany || "—"}</div>
                      <div className="text-slate-400">{b.countryOfOrigin || "—"}</div>
                    </td>
                    <td className="p-2 font-mono text-[10px]">
                      <div>إنتاج: <bdi dir="ltr">{b.productionDate ? formatIsoToDmy(b.productionDate) : "—"}</bdi></div>
                      <div className="text-rose-600 dark:text-rose-400">
                        انتهاء: <bdi dir="ltr">{b.expiryDate ? formatIsoToDmy(b.expiryDate) : "—"}</bdi>
                      </div>
                    </td>
                    <td className="p-2 font-mono text-[10px]">
                      <div>شراء: {fmtNum(Number(b.purchasePrice || 0))} | توصيل: {fmtNum(Number(b.dispatchCost || 0))}</div>
                      <div className="text-emerald-700 dark:text-emerald-300 font-bold">
                        جملة: {fmtNum(Number(b.wholesalePrice || 0))} | ضريبة: {fmtNum(Number(b.taxRate || 0))}%
                      </div>
                    </td>
                    <td className="p-2">{b.warehouseNameAr}</td>
                    <td className="p-2 font-mono">{fmtNum(b.onHandBaseQty)} {b.baseUnitLabel}</td>
                    <td className="p-2 font-mono text-amber-600">{fmtNum(b.reservedBaseQty)}</td>
                    <td className="p-2 font-mono text-indigo-600">{fmtNum(b.outboundStagedBaseQty)}</td>
                    <td className="p-2 font-mono font-black text-emerald-700 dark:text-emerald-300">
                      {fmtNum(b.availableBaseQty)} {b.baseUnitLabel}
                    </td>
                    <td className="p-2 font-mono text-slate-400"><bdi dir="ltr">{b.updatedAtDisplay}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Commercial Inbound & Outbound Movements Ledger (الوارد والصادر) */}
          <div className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-black text-slate-800 dark:text-slate-100">
                سجل حركات الوارد والصادر للقطاع التجاري ({movements.length})
              </div>
              <span className="text-[11px] text-slate-500">توثيق زمني: يوم / شهر / سنة — س:د</span>
            </div>
            {movements.length === 0 ? (
              <div className="text-center py-4 text-slate-500">لا توجد حركات وارد أو صادر في القطاع التجاري حتى الآن.</div>
            ) : (
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-right border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800">
                      <th className="p-2">التاريخ والوقت</th>
                      <th className="p-2">نوع الحركة</th>
                      <th className="p-2">الصنف</th>
                      <th className="p-2">المستودع</th>
                      <th className="p-2">الكمية</th>
                      <th className="p-2">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {movements.map((m) => {
                      const isIn = m.direction === "INBOUND" || Number(m.baseQtyDelta) >= 0;
                      const ts = m.createdAtDisplay || formatIsoToDmyTime(m.createdAt);
                      return (
                        <tr key={m.id}>
                          <td className="p-2 font-mono whitespace-nowrap"><bdi dir="ltr">{ts}</bdi></td>
                          <td className="p-2 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full font-extrabold text-[10px] ${isIn
                                ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                                : "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300"
                                }`}
                            >
                              {m.directionLabelAr || (isIn ? "وارد (+)" : "صادر (-)")} • {m.movementType}
                            </span>
                          </td>
                          <td className="p-2 font-bold">{m.item?.nameAr || "—"}</td>
                          <td className="p-2 text-slate-500">{m.warehouse?.nameAr || "—"}</td>
                          <td className="p-2 font-mono font-bold whitespace-nowrap">
                            <bdi dir="ltr">
                              {isIn ? "+" : "-"}
                              {fmtNum(Math.abs(Number(m.baseQtyDelta || m.enteredQty)))} {m.item?.baseUnit?.nameAr || ""}
                            </bdi>
                          </td>
                          <td className="p-2 text-slate-500">{m.notes || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <MultiUnitInventoryPanel
            sectorFilter="COMMERCIAL"
            onRefreshState={() => loadCommercial(false)}
            onToast={onToast}
          />
        </div>
      )}

      {/* 4. Outbound Picking, Packing & Dispatch POD */}
      {subTab === "dispatch" && (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateDispatch}
            className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700 grid grid-cols-1 sm:grid-cols-4 gap-2.5 items-end"
          >
            <div>
              <label className="block font-bold mb-1">ربط بطلب عميل تجاري</label>
              <select
                value={dispReqId}
                onChange={(e) => setDispReqId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold"
              >
                <option value="">شحنة / رحلة عامة</option>
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requestNumber} — {r.clientAccount?.fullName || "عميل"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">السائق / الموزع</label>
              <input
                value={dispDriver}
                onChange={(e) => setDispDriver(e.target.value)}
                placeholder="اسم السائق أو المسؤول"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">المركبة / رقم اللوحة</label>
              <input
                value={dispVehicle}
                onChange={(e) => setDispVehicle(e.target.value)}
                placeholder="مثال: دينا 4521"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
              />
            </div>
            <button type="submit" className="px-3.5 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center justify-center gap-1">
              <Package className="w-3.5 h-3.5" />
              <span>إنشاء أمر تجهيز وتوصيل</span>
            </button>
          </form>

          <div className="space-y-3">
            {dispatches.map((d) => (
              <div
                key={d.id}
                className="card-surface rounded-2xl p-4 border border-slate-200 dark:border-slate-700 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-black px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      <bdi dir="ltr">{d.dispatchNumber}</bdi>
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-extrabold text-[10px]">
                      {TRIP_STATUS_LABELS[d.tripStatus] || d.tripStatus}
                    </span>
                    <span className="font-bold">{d.driverName} — {d.vehicleInfo}</span>
                  </div>
                  <span className="font-mono text-slate-400">
                    <bdi dir="ltr">{d.createdAtDisplay}</bdi>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={podEdits[d.id] ?? d.podNotes ?? ""}
                    onChange={(e) => setPodEdits((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    placeholder="ملاحظات إثبات التسليم (POD) أو المرتجع..."
                    className="flex-1 min-w-[200px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
                  />
                  {["PICKING", "PACKED_STAGED", "IN_TRANSIT", "DELIVERED"].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => void handleUpdateTripStatus(d.id, st)}
                      className={`px-2.5 py-1.5 rounded-xl font-bold ${d.tripStatus === st
                        ? "accent-bg"
                        : "border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                    >
                      {TRIP_STATUS_LABELS[st]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

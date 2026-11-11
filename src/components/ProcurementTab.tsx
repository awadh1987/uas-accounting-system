"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  FileText,
  PackageCheck,
  Plus,
  Printer,
  ShoppingCart,
  Store,
  Wallet,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { UasProject, UasTreasuryAccount, UasUser, VoucherModalPayload } from "@/types/uas";

interface VendorItem {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  phone: string;
  email: string | null;
  taxRegistration: string | null;
  account: { id: string; code: string; nameAr: string };
  poCount: number;
  billCount: number;
  totalBilled: number;
  totalPaid: number;
  totalDue: number;
}

interface PurchaseOrderItem {
  id: string;
  poNumber: string;
  vendorId: string;
  vendor: { id: string; code: string; nameAr: string; phone: string };
  projectId: string;
  project: { id: string; code: string; nameAr: string };
  subProject?: { id: string; code: string; nameAr: string } | null;
  date: string;
  status: string;
  grandTotal: number;
  currency: string;
  notes: string | null;
  items: Array<{ id: string; description: string; unit: string; quantity: number; unitPrice: number; totalPrice: number }>;
  goodsReceipts: Array<{ id: string; grnNumber: string; receivedDate: string; receivedTotal: number; hasVariance: boolean }>;
  threeWayMatch: { hasGrn: boolean; receivedTotal: number; billedTotal: number; matched: boolean; varianceAmount: number };
}

interface VendorBillItem {
  id: string;
  billNumber: string;
  vendorId: string;
  vendor: { id: string; code: string; nameAr: string; phone: string };
  projectId: string;
  project: { id: string; code: string; nameAr: string };
  poNumber: string | null;
  date: string;
  status: string;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  currency: string;
  isInventory: boolean;
  threeWayStatus: string;
  notes: string | null;
}

interface PaymentVoucherItem {
  id: string;
  voucherNumber: string;
  date: string;
  vendor: { id: string; code: string; nameAr: string; phone: string };
  bill: { id: string; billNumber: string; totalAmount: number; balanceDue: number } | null;
  treasury: { id: string; code: string; nameAr: string; currency: string };
  amount: number;
  currency: string;
  referenceNumber: string | null;
  notes: string | null;
  qrVerificationHash: string | null;
}

interface ProcurementTabProps {
  projects: UasProject[];
  treasuryAccounts: UasTreasuryAccount[];
  currentUser: UasUser;
  selectedProjectId: string;
  onOpenVoucher: (payload: VoucherModalPayload) => void;
  onRefreshState: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function ProcurementTab({
  projects,
  treasuryAccounts,
  currentUser,
  selectedProjectId,
  onOpenVoucher,
  onRefreshState,
  onToast,
}: ProcurementTabProps) {
  const [subTab, setSubTab] = useState<"pos" | "bills" | "payments" | "vendors">("pos");
  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [pos, setPos] = useState<PurchaseOrderItem[]>([]);
  const [bills, setBills] = useState<VendorBillItem[]>([]);
  const [payments, setPayments] = useState<PaymentVoucherItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Vendor state
  const [vNameAr, setVNameAr] = useState("");
  const [vPhone, setVPhone] = useState("");
  const [vTax, setVTax] = useState("");

  // Create PO state
  const [poVendorId, setPoVendorId] = useState("");
  const [poProjectId, setPoProjectId] = useState(projects[0]?.id || "");
  const [poSubProjectId, setPoSubProjectId] = useState("");
  const [poDesc, setPoDesc] = useState("");
  const [poUnit, setPoUnit] = useState("وحدة");
  const [poQty, setPoQty] = useState("10");
  const [poUnitPrice, setPoUnitPrice] = useState("5000");
  const [poCurrency, setPoCurrency] = useState("YER");
  const [poNotes, setPoNotes] = useState("");

  // Create Vendor Bill state
  const [billVendorId, setBillVendorId] = useState("");
  const [billProjectId, setBillProjectId] = useState(projects[0]?.id || "");
  const [billPoId, setBillPoId] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billIsInventory, setBillIsInventory] = useState(true);
  const [billDebitCode, setBillDebitCode] = useState("113201");
  const [billNotes, setBillNotes] = useState("");

  // Create Payment Voucher state
  const [payVendorId, setPayVendorId] = useState("");
  const [payBillId, setPayBillId] = useState("");
  const [payTreasuryId, setPayTreasuryId] = useState(treasuryAccounts[0]?.id || "t1");
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const actorPayload = {
    userId: currentUser.id,
    userDisplay: `${currentUser.name} (${currentUser.role})`,
    userRole: currentUser.role,
  };

  const fetchProcurementBundle = useCallback(async () => {
    const qs =
      selectedProjectId && selectedProjectId !== "ALL"
        ? `?projectId=${encodeURIComponent(selectedProjectId)}`
        : "";
    const [vRes, pRes, bRes, payRes] = await Promise.all([
      fetch("/api/procurement/vendors", { cache: "no-store" }),
      fetch(`/api/procurement/pos${qs}`, { cache: "no-store" }),
      fetch(`/api/procurement/bills${qs}`, { cache: "no-store" }),
      fetch("/api/procurement/payments", { cache: "no-store" }),
    ]);
    return {
      vd: vRes.ok ? ((await vRes.json()) as { vendors: VendorItem[] }) : null,
      pd: pRes.ok ? ((await pRes.json()) as { purchaseOrders: PurchaseOrderItem[] }) : null,
      bd: bRes.ok ? ((await bRes.json()) as { bills: VendorBillItem[] }) : null,
      pyd: payRes.ok ? ((await payRes.json()) as { payments: PaymentVoucherItem[] }) : null,
    };
  }, [selectedProjectId]);

  const applyProcurementBundle = useCallback(
    (bundle: {
      vd: { vendors: VendorItem[] } | null;
      pd: { purchaseOrders: PurchaseOrderItem[] } | null;
      bd: { bills: VendorBillItem[] } | null;
      pyd: { payments: PaymentVoucherItem[] } | null;
    }) => {
      if (bundle.vd) {
        const list = bundle.vd.vendors || [];
        setVendors(list);
        if (list[0]) {
          setPoVendorId((prev) => prev || list[0].id);
          setBillVendorId((prev) => prev || list[0].id);
          setPayVendorId((prev) => prev || list[0].id);
        }
      }
      if (bundle.pd) setPos(bundle.pd.purchaseOrders || []);
      if (bundle.bd) setBills(bundle.bd.bills || []);
      if (bundle.pyd) setPayments(bundle.pyd.payments || []);
    },
    []
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const bundle = await fetchProcurementBundle();
      applyProcurementBundle(bundle);
    } catch {
      onToast("تعذر تحميل بيانات المشتريات والموردين");
    } finally {
      setLoading(false);
    }
  }, [fetchProcurementBundle, applyProcurementBundle, onToast]);

  useEffect(() => {
    let active = true;
    fetchProcurementBundle()
      .then((bundle) => {
        if (!active) return;
        applyProcurementBundle(bundle);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        onToast("تعذر تحميل بيانات المشتريات والموردين");
      });
    return () => {
      active = false;
    };
  }, [fetchProcurementBundle, applyProcurementBundle, onToast]);

  async function handleCreateVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!vNameAr.trim()) return;
    const res = await fetch("/api/procurement/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nameAr: vNameAr.trim(),
        phone: vPhone.trim() || "777000000",
        taxRegistration: vTax.trim() || undefined,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر إضافة المورد");
      return;
    }
    setVNameAr("");
    setVPhone("");
    setVTax("");
    onToast("✅ تم إضافة المورد وربطه بحساب ذمم دائنة من المستوى الخامس (2111xx)");
    await loadAll();
  }

  async function handleCreatePo(e: React.FormEvent) {
    e.preventDefault();
    if (!poVendorId || !poProjectId || !poDesc.trim()) {
      onToast("يرجى تعبئة بيانات المورد والمشروع والبيان");
      return;
    }
    const res = await fetch("/api/procurement/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId: poVendorId,
        projectId: poProjectId,
        subProjectId: poSubProjectId || undefined,
        currency: poCurrency,
        notes: poNotes.trim() || undefined,
        items: [
          {
            description: poDesc.trim(),
            unit: poUnit.trim() || "وحدة",
            quantity: Number(poQty) || 1,
            unitPrice: Number(poUnitPrice) || 0,
          },
        ],
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر إنشاء أمر الشراء");
      return;
    }
    setPoDesc("");
    setPoNotes("");
    onToast("✅ تم إصدار أمر الشراء (PO) بنجاح");
    await loadAll();
  }

  async function handleReceiveGrn(po: PurchaseOrderItem) {
    const res = await fetch("/api/procurement/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CREATE_GRN",
        purchaseOrderId: po.id,
        receivedTotal: po.grandTotal,
        warehouseNotes: `استلام مخزني مطابق لأمر الشراء ${po.poNumber}`,
      }),
    });
    if (!res.ok) {
      onToast("تعذر تسجيل إشعار الاستلام المخزني");
      return;
    }
    onToast(`✅ تم إصدار محضر استلام مخزني (GRN) لأمر الشراء ${po.poNumber}`);
    await loadAll();
  }

  async function handleCreateBill(e: React.FormEvent) {
    e.preventDefault();
    const numericAmt = Number(billAmount) || 0;
    if (!billVendorId || !billProjectId || numericAmt <= 0) {
      onToast("يرجى تحديد المورد والمشروع ومبلغ الفاتورة");
      return;
    }
    const res = await fetch("/api/procurement/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId: billVendorId,
        projectId: billProjectId,
        purchaseOrderId: billPoId || undefined,
        totalAmount: numericAmt,
        isInventory: billIsInventory,
        debitAccountCode: billDebitCode,
        notes: billNotes.trim() || undefined,
        actor: actorPayload,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر ترحيل فاتورة المورد");
      return;
    }
    setBillAmount("");
    setBillNotes("");
    onToast("✅ تم ترحيل فاتورة المورد وتوليد قيد اليومية المزدوج تلقائياً");
    await Promise.all([loadAll(), onRefreshState()]);
  }

  async function handleCreatePayment(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(payAmount) || 0;
    if (!payVendorId || !payTreasuryId || amt <= 0) {
      onToast("يرجى تحديد المورد والخزينة والمبلغ");
      return;
    }
    const res = await fetch("/api/procurement/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId: payVendorId,
        billId: payBillId || undefined,
        treasuryId: payTreasuryId,
        amount: amt,
        referenceNumber: payRef.trim() || undefined,
        notes: payNotes.trim() || undefined,
        actor: actorPayload,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر إصدار سند الصرف");
      return;
    }
    setPayAmount("");
    setPayRef("");
    setPayNotes("");
    onToast("✅ تم إصدار سند صرف المورد وتخفيض رصيد الخزينة وترحيل القيد المزدوج");
    await Promise.all([loadAll(), onRefreshState()]);
  }

  function printPaymentVoucher(p: PaymentVoucherItem) {
    onOpenVoucher({
      kind: "vendor_payment",
      title: `سند صرف لمورد — رقم السند: ${p.voucherNumber}`,
      subtitle: "وحدة المشتريات والمدفوعات - شركة الجبري الزراعية",
      voucherNo: p.voucherNumber,
      date: p.date.slice(0, 10),
      partyLabel: "اسم المورد",
      partyName: p.vendor.nameAr,
      phone: p.vendor.phone,
      projectHarvest: p.bill ? `فاتورة ${p.bill.billNumber}` : "دفعة على الحساب",
      detailLineLabel: "المرجع المصرفي / الملاحظات",
      detailLineValue: [p.referenceNumber, p.notes].filter(Boolean).join(" — ") || "سداد مستحقات مورد",
      treasuryName: p.treasury.nameAr,
      singleAmountYER: p.amount,
      notes: p.notes || undefined,
      qrPayload: `PV:${p.voucherNumber}|VND:${p.vendor.code}|AMT:${p.amount}|DATE:${p.date.slice(0, 10)}`,
      whatsappText: `النظام المحاسبي الموحد (UAS)\nسند صرف مورد رقم: ${p.voucherNumber}\nالمورد: ${p.vendor.nameAr}\nالمبلغ: ${fmtNum(p.amount)} ${p.currency}\nالخزينة/البنك: ${p.treasury.nameAr}\nالتاريخ: ${p.date.slice(0, 10)}`,
    });
  }

  const activePoProj = projects.find((p) => p.id === poProjectId);

  return (
    <section className="space-y-5">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">
                إدارة المشتريات والموردين والمطابقة الثلاثية (PO → GRN → Bill → Payment)
              </h2>
              <p className="text-xs text-slate-500">
                دورة شراء كاملة مع إنشاء قيد مزدوج آلي للمخزون/المصروفات وذمم الموردين (2111xx).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {[
              { id: "pos" as const, label: `أوامر الشراء والاستلام (${pos.length})`, Icon: ClipboardCheck },
              { id: "bills" as const, label: `فواتير الموردين (${bills.length})`, Icon: FileText },
              { id: "payments" as const, label: `سندات الصرف (${payments.length})`, Icon: Wallet },
              { id: "vendors" as const, label: `دليل الموردين (${vendors.length})`, Icon: Store },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setSubTab(id)}
                className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 ${
                  subTab === id ? "accent-bg" : "border border-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {loading && <div className="py-6 text-center text-xs text-slate-500">جاري تحميل سجلات المشتريات...</div>}

        {/* SUB-TAB 1: PURCHASE ORDERS & GRN */}
        {subTab === "pos" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <form onSubmit={handleCreatePo} className="p-4 rounded-2xl border space-y-3 text-xs">
              <h3 className="font-extrabold text-sm border-b pb-2 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-emerald-600" />
                <span>إنشاء أمر شراء (PO)</span>
              </h3>
              <div>
                <label className="block font-semibold mb-1">المورد</label>
                <select
                  value={poVendorId}
                  onChange={(e) => setPoVendorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} — {v.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">المشروع</label>
                <select
                  value={poProjectId}
                  onChange={(e) => {
                    setPoProjectId(e.target.value);
                    setPoSubProjectId("");
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {activePoProj?.subProjects && activePoProj.subProjects.length > 0 && (
                <div>
                  <label className="block font-semibold mb-1">القطاع / المشروع الفرعي</label>
                  <select
                    value={poSubProjectId}
                    onChange={(e) => setPoSubProjectId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                  >
                    <option value="">عام للمشروع</option>
                    {activePoProj.subProjects.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.code} — {sp.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block font-semibold mb-1">وصف الصنف / التوريد *</label>
                <input
                  value={poDesc}
                  onChange={(e) => setPoDesc(e.target.value)}
                  placeholder="مثال: أسمدة ومغذيات زراعية"
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold mb-1">الوحدة</label>
                  <input
                    value={poUnit}
                    onChange={(e) => setPoUnit(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-transparent px-2 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">الكمية</label>
                  <input
                    type="number"
                    value={poQty}
                    onChange={(e) => setPoQty(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-transparent px-2 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">سعر الوحدة</label>
                  <input
                    type="number"
                    value={poUnitPrice}
                    onChange={(e) => setPoUnitPrice(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-transparent px-2 py-2"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1">العملة</label>
                  <select
                    value={poCurrency}
                    onChange={(e) => setPoCurrency(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                  >
                    <option value="YER">YER</option>
                    <option value="SAR">SAR</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end pb-1">
                  <div className="text-[11px] text-slate-500">الإجمالي:</div>
                  <div className="font-extrabold text-emerald-600">
                    {fmtNum((Number(poQty) || 0) * (Number(poUnitPrice) || 0))} {poCurrency}
                  </div>
                </div>
              </div>
              <input
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                placeholder="ملاحظات أمر الشراء..."
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
                إصدار أمر الشراء
              </button>
            </form>

            <div className="lg:col-span-2 space-y-3">
              {pos.map((po) => (
                <div key={po.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-extrabold px-2.5 py-1 rounded-lg accent-badge">
                        {po.poNumber}
                      </span>
                      <span className="font-bold text-sm">{po.vendor.nameAr}</span>
                      <span className="text-slate-500">({po.project.nameAr})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm text-emerald-600">
                        {fmtNum(po.grandTotal)} {po.currency}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold">
                        {po.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-slate-500">
                    {po.items.map((it) => `${it.description} (${it.quantity} ${it.unit} × ${fmtNum(it.unitPrice)})`).join(" • ")}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      {po.threeWayMatch.hasGrn ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تم الاستلام ({po.goodsReceipts.map((g) => g.grnNumber).join(", ")})</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-bold">
                          بانتظار الاستلام المخزني (GRN)
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {!po.threeWayMatch.hasGrn && (
                        <button
                          onClick={() => handleReceiveGrn(po)}
                          className="px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold flex items-center gap-1"
                        >
                          <PackageCheck className="w-3.5 h-3.5" />
                          <span>إصدار إشعار استلام (GRN)</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setBillVendorId(po.vendorId);
                          setBillProjectId(po.projectId);
                          setBillPoId(po.id);
                          setBillAmount(String(po.grandTotal));
                          setSubTab("bills");
                        }}
                        className="px-3 py-1.5 rounded-xl accent-bg font-bold"
                      >
                        تحويل لفاتورة مورد ←
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SUB-TAB 2: VENDOR BILLS */}
        {subTab === "bills" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <form onSubmit={handleCreateBill} className="p-4 rounded-2xl border space-y-3 text-xs">
              <h3 className="font-extrabold text-sm border-b pb-2">إثبات فاتورة مورد (ترحيل قيد آلي)</h3>
              <div>
                <label className="block font-semibold mb-1">المورد</label>
                <select
                  value={billVendorId}
                  onChange={(e) => setBillVendorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nameAr} ({v.account.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">المشروع</label>
                <select
                  value={billProjectId}
                  onChange={(e) => setBillProjectId(e.target.value)}
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
                <label className="block font-semibold mb-1">أمر الشراء المرتبط (اختياري للمطابقة)</label>
                <select
                  value={billPoId}
                  onChange={(e) => setBillPoId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  <option value="">فاتورة مباشرة بدون أمر شراء</option>
                  {pos.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} — {po.vendor.nameAr} ({fmtNum(po.grandTotal)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">التوجيه المحاسبي (الطرف المدين)</label>
                <select
                  value={billDebitCode}
                  onChange={(e) => {
                    const c = e.target.value;
                    setBillDebitCode(c);
                    setBillIsInventory(c.startsWith("113"));
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  <option value="113201">113201 — مخزون الأسمدة والمبيدات (أصل مخزني)</option>
                  <option value="113202">113202 — مخزون الوقود والمحروقات (أصل مخزني)</option>
                  <option value="113203">113203 — أدوات التعبئة والتغليف (أصل مخزني)</option>
                  <option value="521101">521101 — مصروف الديزل والوقود المباشر</option>
                  <option value="524101">524101 — مصروف صيانة المزرعة والعدد</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">إجمالي الفاتورة (YER) *</label>
                <input
                  type="number"
                  value={billAmount}
                  onChange={(e) => setBillAmount(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                />
              </div>
              <input
                value={billNotes}
                onChange={(e) => setBillNotes(e.target.value)}
                placeholder="ملاحظات / رقم فاتورة المورد..."
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
                اعتماد وترحيل الفاتورة للـ GL
              </button>
            </form>

            <div className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="py-2">رقم الفاتورة</th>
                    <th className="py-2">المورد</th>
                    <th className="py-2">المشروع</th>
                    <th className="py-2">المطابقة الثلاثية</th>
                    <th className="py-2">الإجمالي</th>
                    <th className="py-2">المتبقي</th>
                    <th className="py-2">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bills.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 font-mono font-bold">{b.billNumber}</td>
                      <td className="py-2.5 font-semibold">{b.vendor.nameAr}</td>
                      <td className="py-2.5">{b.project.nameAr}</td>
                      <td className="py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            b.threeWayStatus === "MATCHED"
                              ? "bg-emerald-100 text-emerald-800"
                              : b.threeWayStatus === "VARIANCE_DETECTED"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {b.threeWayStatus}
                        </span>
                      </td>
                      <td className="py-2.5 font-bold">{fmtNum(b.totalAmount)}</td>
                      <td className="py-2.5 font-extrabold text-rose-600">{fmtNum(b.balanceDue)}</td>
                      <td className="py-2.5">
                        {b.balanceDue > 0 && (
                          <button
                            onClick={() => {
                              setPayVendorId(b.vendorId);
                              setPayBillId(b.id);
                              setPayAmount(String(b.balanceDue));
                              setSubTab("payments");
                            }}
                            className="px-2.5 py-1 rounded-lg accent-bg font-bold"
                          >
                            سداد
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-TAB 3: PAYMENT VOUCHERS */}
        {subTab === "payments" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <form onSubmit={handleCreatePayment} className="p-4 rounded-2xl border space-y-3 text-xs">
              <h3 className="font-extrabold text-sm border-b pb-2">إصدار سند صرف لمورد (PV)</h3>
              <div>
                <label className="block font-semibold mb-1">المورد</label>
                <select
                  value={payVendorId}
                  onChange={(e) => setPayVendorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nameAr} (المتبقي: {fmtNum(v.totalDue)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">الفاتورة (اختياري)</label>
                <select
                  value={payBillId}
                  onChange={(e) => setPayBillId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  <option value="">دفعة عامة للمورد</option>
                  {bills
                    .filter((b) => b.vendorId === payVendorId && b.balanceDue > 0)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.billNumber} (متبقي: {fmtNum(b.balanceDue)})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">حساب الخزينة / البنك الدافع</label>
                <select
                  value={payTreasuryId}
                  onChange={(e) => setPayTreasuryId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  {treasuryAccounts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (رصيد: {fmtNum(t.balanceYER)} YER)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">المبلغ المدفوع *</label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                />
              </div>
              <input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="رقم الحوالة / المرجع البنكي"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <input
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="البيان..."
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
                ترحيل سند الصرف وإصدار القيد
              </button>
            </form>

            <div className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="py-2">رقم السند</th>
                    <th className="py-2">المورد</th>
                    <th className="py-2">الخزينة / البنك</th>
                    <th className="py-2">الفاتورة</th>
                    <th className="py-2">المبلغ</th>
                    <th className="py-2">التاريخ</th>
                    <th className="py-2">طباعة PDF / QR</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 font-mono font-bold">{p.voucherNumber}</td>
                      <td className="py-2.5 font-semibold">{p.vendor.nameAr}</td>
                      <td className="py-2.5">{p.treasury.nameAr}</td>
                      <td className="py-2.5 font-mono">{p.bill?.billNumber || "—"}</td>
                      <td className="py-2.5 font-extrabold text-emerald-600">
                        {fmtNum(p.amount)} {p.currency}
                      </td>
                      <td className="py-2.5 font-mono">{p.date.slice(0, 10)}</td>
                      <td className="py-2.5">
                        <button
                          onClick={() => printPaymentVoucher(p)}
                          className="px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 font-bold flex items-center gap-1"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>طباعة / QR</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-TAB 4: VENDORS DIRECTORY */}
        {subTab === "vendors" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <form onSubmit={handleCreateVendor} className="p-4 rounded-2xl border space-y-3 text-xs">
              <h3 className="font-extrabold text-sm border-b pb-2">إضافة مورد جديد (ربط آلي بشجرة 2111xx)</h3>
              <input
                value={vNameAr}
                onChange={(e) => setVNameAr(e.target.value)}
                required
                placeholder="اسم المورد / الشركة *"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <input
                value={vPhone}
                onChange={(e) => setVPhone(e.target.value)}
                placeholder="رقم الهاتف"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <input
                value={vTax}
                onChange={(e) => setVTax(e.target.value)}
                placeholder="الرقم الضريبي (اختياري)"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
                حفظ المورد وإنشاء حساب أستاذ فرعي
              </button>
            </form>

            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {vendors.map((v) => (
                <div key={v.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      {v.code} • COA {v.account.code}
                    </span>
                    <span className="text-slate-500">{v.phone}</span>
                  </div>
                  <div className="font-extrabold text-sm">{v.nameAr}</div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center">
                    <div>
                      <div className="text-[10px] text-slate-400">الفواتير</div>
                      <div className="font-bold">{fmtNum(v.totalBilled)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">المدفوع</div>
                      <div className="font-bold text-emerald-600">{fmtNum(v.totalPaid)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">المتبقي</div>
                      <div className="font-extrabold text-rose-600">{fmtNum(v.totalDue)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}


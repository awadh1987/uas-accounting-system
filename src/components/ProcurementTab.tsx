"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Edit3,
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
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { EmptyState } from "@/components/EmptyState";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
import {
  AccountingDirectionSelector,
  type CustomAccountPayload,
} from "@/components/AccountingDirectionSelector";

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
  subProjectId?: string | null;
  subProject?: { id: string; code: string; nameAr: string } | null;
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
  vendorId?: string;
  vendor: { id: string; code: string; nameAr: string; phone: string };
  billId?: string | null;
  bill: { id: string; billNumber: string; totalAmount: number; balanceDue: number } | null;
  treasuryId?: string;
  treasury: { id: string; code: string; nameAr: string; currency: string };
  projectId?: string | null;
  project?: { id: string; code: string; nameAr: string } | null;
  subProjectId?: string | null;
  subProject?: { id: string; code: string; nameAr: string } | null;
  amount: number;
  transferFee?: number;
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
  selectedSubProjectId?: string;
  readOnly?: boolean;
  canApprove?: boolean;
  canEditRecords?: boolean;
  canEditDate?: boolean;
  onOpenVoucher: (payload: VoucherModalPayload) => void;
  onRefreshState: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function ProcurementTab({
  projects,
  treasuryAccounts,
  currentUser,
  selectedProjectId,
  selectedSubProjectId = "ALL",
  readOnly = false,
  canApprove = true,
  canEditRecords = false,
  canEditDate = false,
  onOpenVoucher,
  onRefreshState,
  onToast,
}: ProcurementTabProps) {
  const [subTab, setSubTab] = useState<"pos" | "bills" | "payments" | "vendors">("pos");
  const [drawerKind, setDrawerKind] = useState<null | "po" | "bill" | "payment" | "vendor">(null);
  const [vendors, setVendors] = useState<VendorItem[]>([]);
  const [pos, setPos] = useState<PurchaseOrderItem[]>([]);
  const [bills, setBills] = useState<VendorBillItem[]>([]);
  const [payments, setPayments] = useState<PaymentVoucherItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Add / Edit Vendor state
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingPoId, setEditingPoId] = useState<string | null>(null);
  const [editingBillId, setEditingBillId] = useState<string | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [vNameAr, setVNameAr] = useState("");
  const [vNameEn, setVNameEn] = useState("");
  const [vPhone, setVPhone] = useState("");
  const [vTax, setVTax] = useState("");
  const [quickVendorTarget, setQuickVendorTarget] = useState<null | "po" | "bill" | "payment">(null);

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
  const [billSubProjectId, setBillSubProjectId] = useState("");
  const [billPoId, setBillPoId] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billIsInventory, setBillIsInventory] = useState(true);
  const [billDebitCode, setBillDebitCode] = useState("113201");
  const [billDebitAccountId, setBillDebitAccountId] = useState<string | undefined>(undefined);
  const [billCustomAccount, setBillCustomAccount] = useState<CustomAccountPayload | undefined>(undefined);
  const [billNotes, setBillNotes] = useState("");

  // Create Payment Voucher state
  const [payVendorId, setPayVendorId] = useState("");
  const [payBillId, setPayBillId] = useState("");
  const [payProjectId, setPayProjectId] = useState("");
  const [paySubProjectId, setPaySubProjectId] = useState("");
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
    const params = new URLSearchParams();
    if (selectedProjectId && selectedProjectId !== "ALL") params.set("projectId", selectedProjectId);
    if (selectedSubProjectId && selectedSubProjectId !== "ALL") params.set("subProjectId", selectedSubProjectId);
    const qs = params.toString() ? `?${params.toString()}` : "";
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
  }, [selectedProjectId, selectedSubProjectId]);

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
    const isEdit = Boolean(editingVendorId);
    const res = await fetch("/api/procurement/vendors", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isEdit ? { id: editingVendorId } : {}),
        nameAr: vNameAr.trim(),
        nameEn: vNameEn.trim() || undefined,
        phone: vPhone.trim() || undefined,
        taxRegistration: vTax.trim() || undefined,
        actor: actorPayload,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر حفظ بيانات المورد");
      return;
    }
    setEditingVendorId(null);
    setVNameAr("");
    setVNameEn("");
    setVPhone("");
    setVTax("");
    setDrawerKind(null);
    onToast(
      isEdit
        ? "✅ تم تحديث بيانات المورد وحسابه المرتبط"
        : "✅ تم إضافة المورد وربطه بحساب ذمم دائنة من المستوى الخامس (2111xx)"
    );
    await loadAll();
  }

  async function handleCreatePo(e: React.FormEvent) {
    e.preventDefault();
    if (!poVendorId || !poProjectId || !poDesc.trim()) {
      onToast("يرجى تعبئة بيانات المورد والمشروع والبيان");
      return;
    }
    const isEdit = Boolean(editingPoId);
    const res = await fetch("/api/procurement/pos", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(isEdit ? { id: editingPoId } : {}),
        vendorId: poVendorId,
        projectId: poProjectId,
        subProjectId: poSubProjectId || (isEdit ? null : undefined),
        date: poDate,
        currency: poCurrency,
        notes: poNotes.trim() || (isEdit ? null : undefined),
        actor: actorPayload,
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
      onToast(data.error || (isEdit ? "تعذر تعديل أمر الشراء" : "تعذر إنشاء أمر الشراء"));
      return;
    }
    setEditingPoId(null);
    setPoDesc("");
    setPoNotes("");
    setDrawerKind(null);
    onToast(isEdit ? "✅ تم حفظ تعديلات أمر الشراء (PO)" : "✅ تم إصدار أمر الشراء (PO) بنجاح");
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
    const isEdit = Boolean(editingBillId);
    const res = await fetch("/api/procurement/bills", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEdit
          ? {
              id: editingBillId,
              projectId: billProjectId,
              subProjectId: billSubProjectId || null,
              date: billDate,
              totalAmount: numericAmt,
              notes: billNotes.trim() || null,
              actor: actorPayload,
            }
          : {
              vendorId: billVendorId,
              projectId: billProjectId,
              subProjectId: billSubProjectId || undefined,
              purchaseOrderId: billPoId || undefined,
              date: billDate,
              totalAmount: numericAmt,
              isInventory: billIsInventory,
              debitAccountCode: billDebitCode || undefined,
              debitAccountId: billDebitAccountId || undefined,
              customAccount: billCustomAccount || undefined,
              notes: billNotes.trim() || undefined,
              actor: actorPayload,
            }
      ),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || (isEdit ? "تعذر تعديل فاتورة المورد" : "تعذر ترحيل فاتورة المورد"));
      return;
    }
    setEditingBillId(null);
    setBillAmount("");
    setBillNotes("");
    setDrawerKind(null);
    onToast(
      isEdit
        ? "✅ تم تعديل فاتورة المورد وعكس وإعادة ترحيل القيد المحاسبي"
        : "✅ تم ترحيل فاتورة المورد وتوليد قيد اليومية المزدوج تلقائياً"
    );
    await Promise.all([loadAll(), onRefreshState()]);
  }

  async function handleCreatePayment(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(payAmount) || 0;
    if (!payVendorId || !payTreasuryId || amt <= 0) {
      onToast("يرجى تحديد المورد والخزينة والمبلغ");
      return;
    }
    const isEdit = Boolean(editingPaymentId);
    const res = await fetch("/api/procurement/payments", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEdit
          ? {
              id: editingPaymentId,
              treasuryId: payTreasuryId,
              date: payDate,
              amount: amt,
              projectId: payProjectId || null,
              subProjectId: paySubProjectId || null,
              referenceNumber: payRef.trim() || null,
              notes: payNotes.trim() || null,
              actor: actorPayload,
            }
          : {
              vendorId: payVendorId,
              billId: payBillId || undefined,
              projectId: payProjectId || undefined,
              subProjectId: paySubProjectId || undefined,
              treasuryId: payTreasuryId,
              date: payDate,
              amount: amt,
              referenceNumber: payRef.trim() || undefined,
              notes: payNotes.trim() || undefined,
              actor: actorPayload,
            }
      ),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || (isEdit ? "تعذر تعديل سند الصرف" : "تعذر إصدار سند الصرف"));
      return;
    }
    setEditingPaymentId(null);
    setPayAmount("");
    setPayRef("");
    setPayNotes("");
    setDrawerKind(null);
    onToast(
      isEdit
        ? "✅ تم تعديل سند الصرف وتحديث الخزينة والقيد المحاسبي"
        : "✅ تم إصدار سند صرف المورد وتخفيض رصيد الخزينة وترحيل القيد المزدوج"
    );
    await Promise.all([loadAll(), onRefreshState()]);
  }

  function printPaymentVoucher(p: PaymentVoucherItem) {
    onOpenVoucher({
      kind: "vendor_payment",
      title: `سند صرف لمورد — رقم السند: ${p.voucherNumber}`,
      subtitle: "وحدة المشتريات والمدفوعات - النظام المحاسبي الموحد",
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

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
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

            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  if (subTab === "pos") {
                    setEditingPoId(null);
                    setPoDate(new Date().toISOString().slice(0, 10));
                    setPoDesc("");
                    setPoNotes("");
                    setDrawerKind("po");
                  } else if (subTab === "bills") {
                    setEditingBillId(null);
                    setBillDate(new Date().toISOString().slice(0, 10));
                    setBillAmount("");
                    setBillNotes("");
                    setDrawerKind("bill");
                  } else if (subTab === "payments") {
                    setEditingPaymentId(null);
                    setPayDate(new Date().toISOString().slice(0, 10));
                    setPayAmount("");
                    setPayRef("");
                    setPayNotes("");
                    setDrawerKind("payment");
                  } else {
                    setEditingVendorId(null);
                    setVNameAr("");
                    setVNameEn("");
                    setVPhone("");
                    setVTax("");
                    setDrawerKind("vendor");
                  }
                }}
                disabled={(subTab === "payments" || subTab === "bills") && !canApprove}
                title={
                  (subTab === "payments" || subTab === "bills") && !canApprove
                    ? "يتطلب صلاحية اعتماد مالي"
                    : undefined
                }
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white font-extrabold flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>
                  {subTab === "pos"
                    ? "أمر شراء جديد"
                    : subTab === "bills"
                    ? "فاتورة مورد"
                    : subTab === "payments"
                    ? "سند صرف جديد"
                    : "مورد جديد"}
                </span>
              </button>
            )}
          </div>
        </div>

        {loading && <div className="py-6 text-center text-xs text-slate-500">جاري تحميل سجلات المشتريات...</div>}

        {/* SUB-TAB 1: PURCHASE ORDERS & GRN */}
        {subTab === "pos" && (
          <div className="space-y-3">
            {pos.length === 0 ? (
              <EmptyState
                title="لا توجد أوامر شراء مسجلة"
                description="ابدأ بإصدار أمر شراء جديد للموردين ومتابعة الاستلام المخزني (GRN)."
                actionLabel={!readOnly ? "إنشاء أمر شراء (PO)" : undefined}
                onAction={!readOnly ? () => setDrawerKind("po") : undefined}
              />
            ) : (
              <div className="space-y-3">
                {pos.map((po) => (
                  <div
                    key={po.id}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs space-y-2 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-extrabold px-2.5 py-1 rounded-lg accent-badge">
                          {po.poNumber}
                        </span>
                        <span className="font-bold text-sm">{po.vendor.nameAr}</span>
                        <span className="text-slate-500">({po.project.nameAr})</span>
                        {po.subProject && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {po.subProject.code ? `${po.subProject.code} • ${po.subProject.nameAr}` : po.subProject.nameAr}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-emerald-600 tabular-nums">
                          {fmtNum(po.grandTotal)} {po.currency}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold">
                          {po.status}
                        </span>
                      </div>
                    </div>
                    <div className="text-slate-500">
                      {po.items
                        .map((it) => `${it.description} (${it.quantity} ${it.unit} × ${fmtNum(it.unitPrice)})`)
                        .join(" • ")}
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
                      {!readOnly && (
                        <div className="flex flex-wrap gap-2">
                          {canEditRecords && (
                            <button
                              type="button"
                              onClick={() => {
                                const firstItem = po.items[0];
                                setEditingPoId(po.id);
                                setPoVendorId(po.vendorId);
                                setPoProjectId(po.projectId);
                                setPoSubProjectId(po.subProject?.id || "");
                                setPoDate(po.date.slice(0, 10));
                                setPoDesc(firstItem?.description || "");
                                setPoUnit(firstItem?.unit || "وحدة");
                                setPoQty(String(firstItem?.quantity ?? 1));
                                setPoUnitPrice(String(firstItem?.unitPrice ?? po.grandTotal));
                                setPoCurrency(po.currency);
                                setPoNotes(po.notes || "");
                                setDrawerKind("po");
                              }}
                              className="px-2.5 py-1.5 rounded-xl border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold inline-flex items-center gap-1"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>تعديل</span>
                            </button>
                          )}
                          {!po.threeWayMatch.hasGrn && (
                            <button
                              onClick={() => handleReceiveGrn(po)}
                              className="px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold flex items-center gap-1"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              <span>إصدار إشعار استلام (GRN)</span>
                            </button>
                          )}
                          {canApprove && (
                            <button
                              onClick={() => {
                                setEditingBillId(null);
                                setBillDate(new Date().toISOString().slice(0, 10));
                                setBillVendorId(po.vendorId);
                                setBillProjectId(po.projectId);
                                setBillSubProjectId(po.subProject?.id || "");
                                setBillPoId(po.id);
                                setBillAmount(String(po.grandTotal));
                                setSubTab("bills");
                                setDrawerKind("bill");
                              }}
                              className="px-3 py-1.5 rounded-xl accent-bg font-bold"
                            >
                              تحويل لفاتورة مورد ←
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SUB-TAB 2: VENDOR BILLS */}
        {subTab === "bills" && (
          <div className="space-y-3">
            {bills.length === 0 ? (
              <EmptyState
                title="لا توجد فواتير موردين"
                description="يمكنك إثبات فاتورة مورد مباشرة أو تحويل أمر شراء مستلم إلى فاتورة مرحلة لـ GL."
                actionLabel={!readOnly && canApprove ? "إثبات فاتورة مورد" : undefined}
                onAction={!readOnly && canApprove ? () => setDrawerKind("bill") : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right border-collapse">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 px-2">رقم الفاتورة</th>
                      <th className="py-2.5 px-2">المورد</th>
                      <th className="py-2.5 px-2">المشروع</th>
                      <th className="py-2.5 px-2">المطابقة الثلاثية</th>
                      <th className="py-2.5 px-2">الإجمالي</th>
                      <th className="py-2.5 px-2">المتبقي</th>
                      <th className="py-2.5 px-2">إجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bills.map((b) => (
                      <tr key={b.id}>
                        <td className="py-2.5 px-2 font-mono font-bold">{b.billNumber}</td>
                        <td className="py-2.5 px-2 font-semibold">{b.vendor.nameAr}</td>
                        <td className="py-2.5 px-2">
                          <div>{b.project.nameAr}</div>
                          {b.subProject && (
                            <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              {b.subProject.code ? `${b.subProject.code} • ${b.subProject.nameAr}` : b.subProject.nameAr}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
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
                        <td className="py-2.5 px-2 font-bold tabular-nums">{fmtNum(b.totalAmount)}</td>
                        <td className="py-2.5 px-2 font-extrabold text-rose-600 tabular-nums">
                          {fmtNum(b.balanceDue)}
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2">
                            {b.balanceDue > 0 && !readOnly && canApprove && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPaymentId(null);
                                  setPayDate(new Date().toISOString().slice(0, 10));
                                  setPayVendorId(b.vendorId);
                                  setPayBillId(b.id);
                                  setPayProjectId(b.projectId);
                                  setPaySubProjectId(b.subProjectId || b.subProject?.id || "");
                                  setPayAmount(String(b.balanceDue));
                                  setSubTab("payments");
                                  setDrawerKind("payment");
                                }}
                                className="px-2.5 py-1 rounded-lg accent-bg font-bold"
                              >
                                سداد
                              </button>
                            )}
                            {!readOnly && canApprove && canEditRecords && b.status !== "VOIDED" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingBillId(b.id);
                                  setBillVendorId(b.vendorId);
                                  setBillProjectId(b.projectId);
                                  setBillSubProjectId(b.subProjectId || b.subProject?.id || "");
                                  setBillPoId("");
                                  setBillDate(b.date.slice(0, 10));
                                  setBillAmount(String(b.totalAmount));
                                  setBillIsInventory(b.isInventory);
                                  setBillNotes(b.notes || "");
                                  setDrawerKind("bill");
                                }}
                                className="px-2 py-1 rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>تعديل</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-TAB 3: PAYMENT VOUCHERS */}
        {subTab === "payments" && (
          <div className="space-y-3">
            {payments.length === 0 ? (
              <EmptyState
                title="لا توجد سندات صرف للموردين"
                description="يتم خصم سندات الصرف آلياً من الخزينة أو البنك وتوليد القيد المحاسبي."
                actionLabel={!readOnly && canApprove ? "إصدار سند صرف لمورد" : undefined}
                onAction={!readOnly && canApprove ? () => setDrawerKind("payment") : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-right border-collapse">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 px-2">رقم السند</th>
                      <th className="py-2.5 px-2">المورد</th>
                      <th className="py-2.5 px-2">الخزينة / البنك</th>
                      <th className="py-2.5 px-2">الفاتورة</th>
                      <th className="py-2.5 px-2">المبلغ</th>
                      <th className="py-2.5 px-2">التاريخ</th>
                      <th className="py-2.5 px-2">طباعة PDF / QR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 px-2 font-mono font-bold">{p.voucherNumber}</td>
                        <td className="py-2.5 px-2 font-semibold">{p.vendor.nameAr}</td>
                        <td className="py-2.5 px-2">{p.treasury.nameAr}</td>
                        <td className="py-2.5 px-2 font-mono">{p.bill?.billNumber || "—"}</td>
                        <td className="py-2.5 px-2 font-extrabold text-emerald-600 tabular-nums">
                          {fmtNum(p.amount)} {p.currency}
                        </td>
                        <td className="py-2.5 px-2 font-mono">{p.date.slice(0, 10)}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => printPaymentVoucher(p)}
                              className="px-2.5 py-1 rounded-lg border border-slate-300 hover:bg-slate-100 font-bold flex items-center gap-1"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>طباعة / QR</span>
                            </button>
                            {!readOnly && canApprove && canEditRecords && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPaymentId(p.id);
                                  setPayVendorId(p.vendorId || p.vendor.id);
                                  setPayBillId(p.billId || p.bill?.id || "");
                                  setPayProjectId(p.projectId || "");
                                  setPaySubProjectId(p.subProjectId || p.subProject?.id || "");
                                  setPayTreasuryId(p.treasuryId || p.treasury.id);
                                  setPayDate(p.date.slice(0, 10));
                                  setPayAmount(String(p.amount));
                                  setPayRef(p.referenceNumber || "");
                                  setPayNotes(p.notes || "");
                                  setDrawerKind("payment");
                                }}
                                className="px-2 py-1 rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>تعديل</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-TAB 4: VENDORS DIRECTORY */}
        {subTab === "vendors" && (
          <div className="space-y-3">
            {vendors.length === 0 ? (
              <EmptyState
                title="دليل الموردين فارغ"
                description="أضف مورداً جديداً ليتم فتح حساب أستاذ فرعي له آلياً ضمن ذمم الموردين (2111xx)."
                actionLabel={!readOnly ? "إضافة مورد جديد" : undefined}
                onAction={!readOnly ? () => setDrawerKind("vendor") : undefined}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {vendors.map((v) => (
                  <div
                    key={v.id}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 text-xs space-y-2"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                        {v.code} • COA {v.account.code}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">{v.phone}</span>
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingVendorId(v.id);
                              setVNameAr(v.nameAr);
                              setVNameEn(v.nameEn || "");
                              setVPhone(v.phone);
                              setVTax(v.taxRegistration || "");
                              setDrawerKind("vendor");
                            }}
                            className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-0.5"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>تعديل</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="font-extrabold text-sm">{v.nameAr}</div>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center tabular-nums">
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
            )}
          </div>
        )}
      </div>

      {/* Slide-Over Drawers for Procurement Forms */}
      <SlideOverDrawer
        open={drawerKind === "po" && !readOnly}
        onClose={() => {
          setEditingPoId(null);
          setDrawerKind(null);
        }}
        title={editingPoId ? "تعديل أمر الشراء (PO)" : "إنشاء أمر شراء جديد (PO)"}
        subtitle="أصدر أمر الشراء لمتابعة الاستلام المخزني والمطابقة الثلاثية"
      >
        <form onSubmit={handleCreatePo} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">
              التاريخ{" "}
              {editingPoId && !canEditDate && (
                <span className="text-[10px] text-amber-600">(مقفل حسب الصلاحية)</span>
              )}
            </label>
            <input
              type="date"
              value={poDate}
              onChange={(e) => setPoDate(e.target.value)}
              disabled={Boolean(editingPoId) && !canEditDate}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-50"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold">المورد</label>
              <button
                type="button"
                onClick={() => setQuickVendorTarget("po")}
                className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" />
                <span>مورد جديد</span>
              </button>
            </div>
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
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">سعر الوحدة</label>
              <input
                type="number"
                value={poUnitPrice}
                onChange={(e) => setPoUnitPrice(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-2 py-2 tabular-nums"
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
              <div className="font-extrabold text-emerald-600 tabular-nums">
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
            {editingPoId ? "حفظ تعديلات أمر الشراء" : "إصدار أمر الشراء"}
          </button>
        </form>
      </SlideOverDrawer>

      <SlideOverDrawer
        open={drawerKind === "bill" && !readOnly && canApprove}
        onClose={() => {
          setEditingBillId(null);
          setDrawerKind(null);
        }}
        title={editingBillId ? "تعديل فاتورة مورد" : "إثبات فاتورة مورد"}
        subtitle="ترحيل قيد مزدوج آلي للمخزون/المصروف وذمم الموردين (2111xx)"
      >
        <form onSubmit={handleCreateBill} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">
              التاريخ{" "}
              {editingBillId && !canEditDate && (
                <span className="text-[10px] text-amber-600">(مقفل حسب الصلاحية)</span>
              )}
            </label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              disabled={Boolean(editingBillId) && !canEditDate}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-50"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold">المورد</label>
              {!editingBillId && (
                <button
                  type="button"
                  onClick={() => setQuickVendorTarget("bill")}
                  className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" />
                  <span>مورد جديد</span>
                </button>
              )}
            </div>
            <select
              value={billVendorId}
              onChange={(e) => setBillVendorId(e.target.value)}
              disabled={Boolean(editingBillId)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-50"
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
              onChange={(e) => {
                setBillProjectId(e.target.value);
                setBillSubProjectId("");
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
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-semibold">القطاع / المشروع الفرعي (Cost Center)</label>
              <span className="text-[10px] text-slate-400">اختياري</span>
            </div>
            <select
              value={billSubProjectId}
              onChange={(e) => setBillSubProjectId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="">-- بدون تحديد قطاع فرعي --</option>
              {(projects.find((p) => p.id === billProjectId)?.subProjects || []).map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
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
          <AccountingDirectionSelector
            label="التوجيه المحاسبي (الطرف المدين)"
            value={{
              accountId: billDebitAccountId,
              accountCode: billDebitCode,
              isCustom: Boolean(billCustomAccount),
              customAccount: billCustomAccount,
            }}
            onChange={(val) => {
              if (val.isCustom) {
                setBillCustomAccount(val.customAccount);
                setBillDebitAccountId(undefined);
                setBillDebitCode(val.customAccount?.code || "");
                setBillIsInventory(false);
              } else {
                setBillCustomAccount(undefined);
                setBillDebitAccountId(val.accountId);
                setBillDebitCode(val.accountCode || "");
                setBillIsInventory(Boolean(val.accountCode?.startsWith("113")));
              }
            }}
            allowedTypes={["ASSET", "EXPENSE"]}
            defaultParentCode="113200"
          />
          <div>
            <label className="block font-semibold mb-1">إجمالي الفاتورة (YER) *</label>
            <input
              type="number"
              value={billAmount}
              onChange={(e) => setBillAmount(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
            />
          </div>
          <input
            value={billNotes}
            onChange={(e) => setBillNotes(e.target.value)}
            placeholder="ملاحظات / رقم فاتورة المورد..."
            className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
            {editingBillId ? "حفظ تعديلات الفاتورة وإعادة الترحيل" : "اعتماد وترحيل الفاتورة للـ GL"}
          </button>
        </form>
      </SlideOverDrawer>

      <SlideOverDrawer
        open={drawerKind === "payment" && !readOnly && canApprove}
        onClose={() => {
          setEditingPaymentId(null);
          setDrawerKind(null);
        }}
        title={editingPaymentId ? "تعديل سند صرف مورد (PV)" : "إصدار سند صرف لمورد (PV)"}
        subtitle="تخفيض رصيد الخزينة أو البنك وترحيل القيد المزدوج"
      >
        <form onSubmit={handleCreatePayment} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">
              التاريخ{" "}
              {editingPaymentId && !canEditDate && (
                <span className="text-[10px] text-amber-600">(مقفل حسب الصلاحية)</span>
              )}
            </label>
            <input
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              disabled={Boolean(editingPaymentId) && !canEditDate}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-50"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold">المورد</label>
              {!editingPaymentId && (
                <button
                  type="button"
                  onClick={() => setQuickVendorTarget("payment")}
                  className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" />
                  <span>مورد جديد</span>
                </button>
              )}
            </div>
            <select
              value={payVendorId}
              onChange={(e) => setPayVendorId(e.target.value)}
              disabled={Boolean(editingPaymentId)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-50"
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
              onChange={(e) => {
                const bid = e.target.value;
                setPayBillId(bid);
                if (bid) {
                  const b = bills.find((x) => x.id === bid);
                  if (b) {
                    setPayProjectId(b.projectId);
                    setPaySubProjectId(b.subProjectId || b.subProject?.id || "");
                  }
                }
              }}
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
            <label className="block font-semibold mb-1">المشروع المرتبط بالصرف (اختياري)</label>
            <select
              value={payProjectId}
              onChange={(e) => {
                setPayProjectId(e.target.value);
                setPaySubProjectId("");
              }}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="">-- بدون تحديد مشروع --</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {payProjectId && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-semibold">القطاع / المشروع الفرعي (Cost Center)</label>
                <span className="text-[10px] text-slate-400">اختياري</span>
              </div>
              <select
                value={paySubProjectId}
                onChange={(e) => setPaySubProjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                <option value="">-- بدون تحديد قطاع فرعي --</option>
                {(projects.find((p) => p.id === payProjectId)?.subProjects || []).map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                  </option>
                ))}
              </select>
            </div>
          )}
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
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
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
            {editingPaymentId ? "حفظ تعديلات سند الصرف" : "ترحيل سند الصرف وإصدار القيد"}
          </button>
        </form>
      </SlideOverDrawer>

      <SlideOverDrawer
        open={drawerKind === "vendor" && !readOnly}
        onClose={() => {
          setEditingVendorId(null);
          setDrawerKind(null);
        }}
        title={editingVendorId ? "تعديل بيانات المورد" : "إضافة مورد جديد"}
        subtitle="ربط آلي بشجرة الحسابات ضمن ذمم الموردين (2111xx)"
      >
        <form onSubmit={handleCreateVendor} className="space-y-3 text-xs">
          <input
            value={vNameAr}
            onChange={(e) => setVNameAr(e.target.value)}
            required
            placeholder="اسم المورد / الشركة *"
            className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
          <input
            value={vNameEn}
            onChange={(e) => setVNameEn(e.target.value)}
            placeholder="Vendor Name (English - Optional)"
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
            {editingVendorId ? "حفظ تعديلات المورد" : "حفظ المورد وإنشاء حساب أستاذ فرعي"}
          </button>
        </form>
      </SlideOverDrawer>

      <QuickMasterCreateModal
        open={quickVendorTarget !== null}
        mode="vendor"
        currentUser={currentUser}
        onClose={() => setQuickVendorTarget(null)}
        onCreatedVendor={(created) => {
          if (quickVendorTarget === "po") setPoVendorId(created.id);
          else if (quickVendorTarget === "bill") setBillVendorId(created.id);
          else if (quickVendorTarget === "payment") setPayVendorId(created.id);
          void loadAll();
        }}
        onToast={onToast}
      />
    </section>
  );
}


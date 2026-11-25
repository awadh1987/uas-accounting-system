"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Edit3,
  FileSpreadsheet,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import { formatMoney, formatRefreshTimestamp } from "@/lib/uiFormatters";
import { filterOutSyntheticTestRecords, isSyntheticTestRecord } from "@/lib/testRecordHygiene";
import {
  printUasDocument,
  resolveLetterheadFromProfile,
  type PrintKeyValue,
  type PrintSummaryCard,
  type PrintTableColumn,
  type UasPrintDocumentSpec,
} from "@/lib/print/uasDocumentPrinter";
import { ActionOverflowMenu } from "@/components/ActionOverflowMenu";
import { EmptyState } from "@/components/EmptyState";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
import { CostCenterSelector } from "@/components/CostCenterSelector";
import { SaveDraftButton } from "@/components/SaveDraftButton";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { PhoneContactInput } from "@/components/PhoneContactInput";
import { TenantClientPortalAdminPanel } from "@/components/portal-admin/TenantClientPortalAdminPanel";
import { canEdit } from "@/lib/permissions";
import type { UasEnterpriseProfile, UasProject, UasSaleTransaction, UasUser } from "@/types/uas";

interface CustomerMasterItem {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  nameEn?: string | null;
  phone: string;
  address?: string | null;
  creditLimit: number;
  account?: { id: string; code: string; nameAr: string } | null;
  costCenterId?: string | null;
  costCenter?: { id: string; code: string; nameAr: string; nameEn?: string | null } | null;
  invoiceCount: number;
  saleCount: number;
  totalInvoiced: number;
  totalCollected: number;
  totalReceivable: number;
  isActive?: boolean;
  archivedAt?: string | null;
}

interface CustomersTabProps {
  projects: UasProject[];
  sales: UasSaleTransaction[];
  allSales: UasSaleTransaction[];
  currentUser?: UasUser;
  enterpriseProfile?: UasEnterpriseProfile | null;
  initialSection?: "cards" | "ledger" | "both" | "portal" | "whatsapp";
  readOnly?: boolean;
  canEditRecords?: boolean;
  onOpenSaleVoucher: (s: UasSaleTransaction) => void;
  onExportCustomerExcel: (customerFilter: string) => void;
  onRefreshState?: () => Promise<void>;
  onToast?: (msg: string) => void;
}

export function buildCustomerStatementPrintSpec(params: {
  selectedCustomer: string;
  visibleRows: UasSaleTransaction[];
  projects: UasProject[];
  includeSaleDetails: boolean;
  documentDate?: string;
  enterpriseProfile?: UasEnterpriseProfile | null;
}): UasPrintDocumentSpec {
  const { selectedCustomer, visibleRows, projects, includeSaleDetails, documentDate, enterpriseProfile } = params;
  const totSales = visibleRows.reduce((s, r) => s + Number(r.total || 0), 0);
  const totPaid = visibleRows.reduce((s, r) => s + Number(r.credit || 0), 0);
  const totDue = visibleRows.reduce((s, r) => s + Number(r.debit || 0), 0);
  const totBundles = visibleRows.reduce((s, r) => s + Number(r.bundles || 0), 0);
  const dateStr = documentDate || new Date().toISOString().slice(0, 10);

  const metadata: PrintKeyValue[] = [
    {
      labelAr: "العميل",
      labelEn: "Customer",
      value: selectedCustomer === "ALL" ? "جميع العملاء / All Customers" : selectedCustomer,
    },
    {
      labelAr: "نمط التقرير",
      labelEn: "Report Mode",
      value: includeSaleDetails
        ? "مفصل (يشمل تفاصيل كل عملية بيع) / Detailed (Per-sale items)"
        : "ملخص إجمالي / Summary Statement",
    },
    {
      labelAr: "عدد العمليات",
      labelEn: "Transactions Count",
      value: String(visibleRows.length),
    },
  ];

  const summaryCards: PrintSummaryCard[] = [
    { labelAr: "إجمالي المبيعات", labelEn: "Total Billed", value: `${fmtNum(totSales)} YER`, tone: "indigo" },
    { labelAr: "المقبوض (دائن)", labelEn: "Collected", value: `${fmtNum(totPaid)} YER`, tone: "emerald" },
    { labelAr: "الرصيد المستحق (مدين)", labelEn: "Receivable", value: `${fmtNum(totDue)} YER`, tone: "rose" },
  ];

  if (includeSaleDetails && totBundles > 0) {
    summaryCards.push({
      labelAr: "إجمالي الكمية / الحزم",
      labelEn: "Total Quantity",
      value: `${fmtNum(totBundles)} وحدة`,
      tone: "neutral",
    });
  }

  const columns: PrintTableColumn[] = includeSaleDetails
    ? [
      { key: "date", labelAr: "التاريخ", labelEn: "Date" },
      { key: "voucherNo", labelAr: "السند", labelEn: "Voucher" },
      { key: "customer", labelAr: "العميل", labelEn: "Customer" },
      { key: "harvest", labelAr: "المشروع / القطفة", labelEn: "Project / Harvest" },
      { key: "grade", labelAr: "الصنف / النوع", labelEn: "Grade / Item" },
      { key: "bundles", labelAr: "الكمية / الحزم", labelEn: "Qty / Units", numeric: true },
      { key: "price", labelAr: "سعر الوحدة", labelEn: "Unit Price", numeric: true },
      { key: "total", labelAr: "الإجمالي", labelEn: "Total", numeric: true },
      { key: "credit", labelAr: "المدفوع", labelEn: "Paid", numeric: true },
      { key: "debit", labelAr: "المتبقي", labelEn: "Balance", numeric: true },
    ]
    : [
      { key: "date", labelAr: "التاريخ", labelEn: "Date" },
      { key: "voucherNo", labelAr: "السند / المرجع", labelEn: "Voucher / Ref" },
      { key: "customer", labelAr: "العميل", labelEn: "Customer" },
      { key: "total", labelAr: "إجمالي الفاتورة", labelEn: "Total Billed", numeric: true },
      { key: "credit", labelAr: "المدفوع (سداد)", labelEn: "Paid (Receipt)", numeric: true },
      { key: "debit", labelAr: "الرصيد المستحق", labelEn: "Balance Due", numeric: true },
    ];

  const rows = visibleRows.map((r) => {
    if (includeSaleDetails) {
      const proj = projects.find((p) => p.id === r.projectId);
      const harvestDisplay = proj ? `${proj.name} — ${r.harvest || ""}` : (r.harvest || "—");
      return {
        date: r.date,
        voucherNo: r.voucherNo || "—",
        customer: r.customer,
        harvest: harvestDisplay,
        grade: r.grade || "—",
        bundles: fmtNum(r.bundles || 0),
        price: fmtNum(r.price || 0),
        total: fmtNum(r.total),
        credit: fmtNum(r.credit),
        debit: fmtNum(r.debit),
      };
    }
    return {
      date: r.date,
      voucherNo: r.voucherNo || "—",
      customer: r.customer,
      total: fmtNum(r.total),
      credit: fmtNum(r.credit),
      debit: fmtNum(r.debit),
    };
  });

  const totalsRow = includeSaleDetails
    ? {
      date: "الإجمالي / Total",
      bundles: fmtNum(totBundles),
      total: fmtNum(totSales),
      credit: fmtNum(totPaid),
      debit: fmtNum(totDue),
    }
    : {
      date: "الإجمالي / Total",
      total: fmtNum(totSales),
      credit: fmtNum(totPaid),
      debit: fmtNum(totDue),
    };

  return {
    titleAr: "كشف حساب وفواتير العملاء",
    titleEn: "Customer Account Statement",
    documentNumber: `RPT-CUST-${dateStr}`,
    currency: "YER",
    status: "POSTED",
    format: includeSaleDetails ? "A4_LANDSCAPE" : "A4_PORTRAIT",
    letterhead: resolveLetterheadFromProfile(enterpriseProfile),
    metadata,
    summaryCards,
    tables: [
      {
        headingAr: includeSaleDetails
          ? "حركات وفواتير العميل مع تفاصيل المبيعات"
          : "حركات وفواتير العميل (ملخص)",
        headingEn: includeSaleDetails
          ? "Statement Lines (With Sale Details)"
          : "Statement Summary Lines",
        columns,
        rows,
        totalsRow,
      },
    ],
  };
}

export function CustomersTab({
  projects,
  sales,
  allSales,
  currentUser,
  enterpriseProfile,
  initialSection = "cards",
  readOnly = false,
  canEditRecords = true,
  onOpenSaleVoucher,
  onExportCustomerExcel,
  onRefreshState,
  onToast,
}: CustomersTabProps) {
  const [selectedCustomer, setSelectedCustomer] = useState("ALL");
  const [customers, setCustomers] = useState<CustomerMasterItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [hideTestRecords, setHideTestRecords] = useState(false);
  const [viewSection, setViewSection] = useState<
    "cards" | "ledger" | "both" | "portal" | "whatsapp"
  >(initialSection);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) setViewSection(initialSection);
    });
    return () => {
      active = false;
    };
  }, [initialSection]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const [includeSaleDetails, setIncludeSaleDetails] = useState(true);

  // Edit Client drawer state
  const [editingCustomer, setEditingCustomer] = useState<CustomerMasterItem | null>(null);
  const [editNameAr, setEditNameAr] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCreditLimit, setEditCreditLimit] = useState("0");
  const [editCostCenterId, setEditCostCenterId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetch("/api/sales/customers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { customers?: CustomerMasterItem[] };
      if (data.customers) setCustomers(data.customers);
    } catch {
      // keep fallback from sales
    }
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadCustomers(), onRefreshState?.()]);
      setLastRefreshedAt(new Date().toISOString());
      onToast?.("✅ تم تحديث دليل وكشوفات العملاء بنجاح");
    } catch {
      onToast?.("تعذر تحديث بيانات العملاء");
    } finally {
      setRefreshing(false);
    }
  }, [loadCustomers, onRefreshState, onToast]);

  const handleArchiveCustomer = useCallback(
    async (c: CustomerMasterItem, skipConfirm = false) => {
      if (!skipConfirm && !confirm(`هل أنت متأكد من أرشفة العميل (${c.nameAr})؟`)) return;
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Customer", id: c.id, action: "ARCHIVE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast?.(data.message || "تمت أرشفة العميل بنجاح");
        await loadCustomers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر أرشفة العميل";
        onToast?.(msg);
      }
    },
    [loadCustomers, onToast]
  );

  const handleRestoreCustomer = useCallback(
    async (c: CustomerMasterItem) => {
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Customer", id: c.id, action: "RESTORE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast?.(data.message || "تمت استعادة العميل بنجاح");
        await loadCustomers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر استعادة العميل";
        onToast?.(msg);
      }
    },
    [loadCustomers, onToast]
  );

  const handleDeleteCustomer = useCallback(
    async (c: CustomerMasterItem, skipConfirm = false) => {
      if (
        !skipConfirm &&
        !confirm(
          `هل أنت متأكد من حذف العميل (${c.nameAr})؟ في حال وجود حركات مرتبطة سيتم أرشفته آلياً حفاظاً على التاريخ المالي.`
        )
      )
        return;
      try {
        const res = await fetch("/api/system/lifecycle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: "Customer", id: c.id, action: "SAFE_DELETE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error);
        onToast?.(data.message || "تمت العملية بنجاح");
        await loadCustomers();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "تعذر حذف العميل";
        onToast?.(msg);
      }
    },
    [loadCustomers, onToast]
  );

  useEffect(() => {
    let active = true;
    fetch("/api/sales/customers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { customers?: CustomerMasterItem[] } | null) => {
        if (active && data?.customers) setCustomers(data.customers);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [allSales]);

  const customerNames = useMemo(
    () =>
      Array.from(
        new Set([...customers.map((c) => c.nameAr), ...allSales.map((s) => s.customer)])
      ),
    [customers, allSales]
  );

  const visibleCustomers = customerNames.filter(
    (c) => selectedCustomer === "ALL" || c === selectedCustomer
  );

  const visibleRows = sales.filter(
    (s) => selectedCustomer === "ALL" || s.customer === selectedCustomer
  );

  function openEditDrawer(c: CustomerMasterItem) {
    setEditingCustomer(c);
    setEditNameAr(c.nameAr);
    setEditNameEn(c.nameEn || "");
    setEditPhone(c.phone);
    setEditAddress(c.address || "");
    setEditCreditLimit(String(c.creditLimit || 0));
    setEditCostCenterId((c as unknown as { costCenterId?: string }).costCenterId || "");
  }

  async function handleSaveCustomerEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCustomer || !editNameAr.trim()) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/sales/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingCustomer.id,
          nameAr: editNameAr.trim(),
          nameEn: editNameEn.trim() || undefined,
          phone: editPhone.trim() || undefined,
          address: editAddress.trim() || null,
          creditLimit: Number(editCreditLimit) || 0,
          costCenterId: editCostCenterId || null,
          actor: currentUser
            ? { userId: currentUser.id, userDisplay: currentUser.name, userRole: currentUser.role }
            : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        onToast?.(data.error || "تعذر تعديل بيانات العميل");
        return;
      }
      onToast?.("✅ تم تحديث ملف العميل وحسابه في الشجرة");
      setEditingCustomer(null);
      await loadCustomers();
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <section className="space-y-6">
      <QuickMasterCreateModal
        open={createOpen}
        mode="customer"
        currentUser={currentUser}
        onClose={() => setCreateOpen(false)}
        onCreatedCustomer={() => {
          void loadCustomers();
        }}
        onToast={(msg) => onToast?.(msg)}
      />

      <SlideOverDrawer
        open={Boolean(editingCustomer) && !readOnly && canEditRecords}
        onClose={() => setEditingCustomer(null)}
        title="تعديل بيانات العميل"
        subtitle="تحديث الاسم والهاتف والعنوان والحد الائتماني وحساب الأستاذ الفرعي (1131xx)"
      >
        <form onSubmit={handleSaveCustomerEdit} className="space-y-3 text-xs">
          <div>
            <label className="block font-bold mb-1">اسم العميل (عربي) *</label>
            <input
              type="text"
              required
              value={editNameAr}
              onChange={(e) => setEditNameAr(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Client Name (English)</label>
            <input
              type="text"
              value={editNameEn}
              onChange={(e) => setEditNameEn(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">رقم الهاتف</label>
              <PhoneContactInput
                value={editPhone}
                onChange={setEditPhone}
                onContactSelected={(c) => {
                  if (!editNameAr.trim() && c.name) setEditNameAr(c.name);
                }}
                fallbackContacts={customers.map((c) => ({
                  id: c.id,
                  name: c.nameAr || c.name,
                  phone: c.phone,
                  subtitle: c.code,
                }))}
                placeholder="777000000"
                inputClassName="flex-1 min-w-0 rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الحد الائتماني (YER)</label>
              <input
                type="number"
                min={0}
                value={editCreditLimit}
                onChange={(e) => setEditCreditLimit(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="block font-bold mb-1">العنوان</label>
            <input
              type="text"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <CostCenterSelector value={editCostCenterId} onChange={setEditCostCenterId} />
          <SaveDraftButton
            module="SALES"
            formType="CUSTOMER"
            entityId={editingCustomer?.id || null}
            getTitleAr={() => `مسودة تعديل عميل: ${editNameAr.trim()}`}
            getPayload={() => ({ id: editingCustomer?.id, nameAr: editNameAr, nameEn: editNameEn, phone: editPhone, address: editAddress, creditLimit: Number(editCreditLimit) || 0, costCenterId: editCostCenterId || null })}
            actor={currentUser ? { userId: currentUser.id, userDisplay: currentUser.name, userRole: currentUser.role } : undefined}
            onToast={onToast}
            className="w-full"
          />
          <button
            type="submit"
            disabled={savingEdit}
            className="w-full py-2.5 rounded-xl accent-bg font-extrabold"
          >
            {savingEdit ? "جاري الحفظ..." : "حفظ تعديلات العميل"}
          </button>
        </form>
      </SlideOverDrawer>

      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold">
              دليل العملاء وفواتير وكشوفات الحساب
            </h3>
            <p className="text-xs text-slate-500">
              إنشاء وتعديل ملفات العملاء وحسابات الأستاذ العام (<bdi dir="ltr">COA 112190xxx</bdi>)، مراكز التكلفة، وتصدير الكشوفات
            </p>
            {lastRefreshedAt && (
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                {formatRefreshTimestamp(lastRefreshedAt)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-xs font-bold"
            >
              <option value="ALL">جميع العملاء</option>
              {customerNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleRefreshAll()}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              title="تحديث دليل وكشوفات العملاء من الخادم"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const spec = buildCustomerStatementPrintSpec({
                  selectedCustomer,
                  visibleRows,
                  projects,
                  includeSaleDetails,
                  enterpriseProfile,
                });
                void printUasDocument(spec);
              }}
              className="px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة الفاتورة / الكشف PDF</span>
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة عميل جديد</span>
              </button>
            )}
            <ActionOverflowMenu
              testId="customers-toolbar-overflow"
              label="خيارات دليل العملاء"
              size="sm"
              items={[
                {
                  id: "export-excel",
                  label: "تصدير كشف العملاء Excel",
                  icon: <FileSpreadsheet className="w-3.5 h-3.5" />,
                  onClick: () => onExportCustomerExcel(selectedCustomer),
                },
                {
                  id: "toggle-archived",
                  label: showArchived ? "إخفاء المؤرشفين" : "إظهار المؤرشفين",
                  icon: <Archive className="w-3.5 h-3.5" />,
                  onClick: () => setShowArchived((v) => !v),
                },
                {
                  id: "toggle-test-records",
                  label: hideTestRecords ? "إظهار السجلات التجريبية" : "إخفاء السجلات التجريبية",
                  onClick: () => setHideTestRecords((v) => !v),
                },
                {
                  id: "toggle-details",
                  label: includeSaleDetails
                    ? "تبديل الكشف إلى: ملخص إجمالي"
                    : "تبديل الكشف إلى: تضمين تفاصيل كل بيع",
                  onClick: () => setIncludeSaleDetails((v) => !v),
                },
              ]}
            />
          </div>
        </div>

        {/* Clean Section Switcher & Print Detail Toggle (prevents bottom viewport collision) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 no-print">
          <div className="inline-flex flex-wrap rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-900/60 text-xs gap-1">
            {[
              { id: "cards" as const, label: `حسابات العملاء الموحدة (${customerNames.length})` },
              { id: "ledger" as const, label: `سجل الحركات والفواتير (${visibleRows.length})` },
              { id: "both" as const, label: "عرض مدمج" },
              { id: "portal" as const, label: "بوابة العملاء والطلبات" },
              { id: "whatsapp" as const, label: "الإشعارات" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewSection(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-bold transition ${
                  viewSection === tab.id
                    ? "accent-bg shadow-sm"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <label
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
            title={
              includeSaleDetails
                ? "تضمين تفاصيل كل عملية بيع (الأصناف، الكميات، الأسعار، السندات)"
                : "تصدير كشف حساب إجمالي ملخص بدون تفاصيل الأصناف"
            }
          >
            <input
              type="checkbox"
              data-testid="toggle-sale-details"
              checked={includeSaleDetails}
              onChange={(e) => setIncludeSaleDetails(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span>تضمين تفاصيل كل عملية بيع في PDF</span>
          </label>
        </div>

        {/* Single Unified Customer Cards Grid */}
        {(viewSection === "cards" || viewSection === "both") && (
        <div className="space-y-2.5">
          <div className="text-xs font-extrabold text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-emerald-600" />
              <span>بطاقات العملاء الموحدة وملفات الأستاذ العام ({customerNames.length})</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filterOutSyntheticTestRecords(
              visibleCustomers.map((cName) => {
                const master = customers.find((m) => m.nameAr === cName || m.name === cName);
                const rows = allSales.filter((s) => s.customer === cName);
                return { cName, master, rows, name: cName, code: master?.code || "" };
              }),
              hideTestRecords
            ).visible.map(({ cName, master, rows }) => {
              const isArchived = master ? master.isActive === false || Boolean(master.archivedAt) : false;
              if (!showArchived && isArchived) return null;

              const phone = master?.phone || rows[0]?.phone || "—";
              const code = master?.code || "CUST-000";
              const glAccountCode = master?.account?.code || "112190xxx";
              const creditLimit = master?.creditLimit || 0;
              const costCenterBadge = master?.costCenter?.nameAr || (master?.costCenterId ? "مركز تكلفة" : null);
              const isTestCustomer = isSyntheticTestRecord({ nameAr: cName, code, phone });

              const bundles = rows.reduce((a, b) => a + Number(b.bundles || 0), 0);
              const total = master ? master.totalInvoiced : rows.reduce((a, b) => a + Number(b.total || 0), 0);
              const credit = master ? master.totalCollected : rows.reduce((a, b) => a + Number(b.credit || 0), 0);
              const debit = master ? master.totalReceivable : rows.reduce((a, b) => a + Number(b.debit || 0), 0);

              return (
                <div
                  key={cName}
                  className={`p-4 rounded-2xl border text-xs space-y-3 transition shadow-sm ${isArchived
                    ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    }`}
                >
                  {/* Top: Code + COA + CostCenter + Overflow Menu */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {code}
                      </span>
                      <span className="font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300/40">
                        COA {glAccountCode}
                      </span>
                      {costCenterBadge && (
                        <span className="font-bold text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50">
                          {costCenterBadge}
                        </span>
                      )}
                      {isArchived && (
                        <span className="px-2 py-0.5 rounded-md bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100 text-[10px] font-black">
                          مؤرشف
                        </span>
                      )}
                      {isTestCustomer && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 text-[10px] font-bold">
                          تجريبي
                        </span>
                      )}
                    </div>

                    <ActionOverflowMenu
                      size="xs"
                      align="end"
                      label="خيارات بطاقة العميل"
                      items={[
                        {
                          id: "view-ledger",
                          label: "عرض جدول الحركات والفواتير",
                          onClick: () => {
                            setSelectedCustomer(cName);
                            setViewSection("ledger");
                          },
                        },
                        {
                          id: "edit",
                          label: "تعديل بيانات العميل",
                          icon: <Edit3 className="w-3.5 h-3.5" />,
                          hidden: readOnly || !canEditRecords || !master,
                          onClick: () => master && openEditDrawer(master),
                        },
                        {
                          id: "archive",
                          label: isArchived ? "استعادة العميل" : "أرشفة العميل",
                          icon: isArchived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />,
                          tone: isArchived ? "default" : "warning",
                          hidden: readOnly || !canEditRecords || !master,
                          onClick: () =>
                            master
                              ? isArchived
                                ? handleRestoreCustomer(master)
                                : handleArchiveCustomer(master, true)
                              : undefined,
                        },
                        {
                          id: "delete",
                          label: "حذف العميل",
                          icon: <Trash2 className="w-3.5 h-3.5" />,
                          tone: "danger",
                          dividerBefore: true,
                          hidden: readOnly || !canEditRecords || !master,
                          confirmTitle: `حذف العميل (${cName})`,
                          confirmMessage:
                            "في حال وجود فواتير أو قيود مرتبطة بهذا العميل سيتم أرشفته آلياً حفاظاً على التاريخ المالي.",
                          onClick: () => master && handleDeleteCustomer(master, true),
                        },
                      ]}
                    />
                  </div>

                  {/* Middle: Customer Name, Phone, Credit Limit */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-black text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-emerald-600 shrink-0" />
                        <bdi dir="auto" className="truncate">{cName}</bdi>
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                        <Phone className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span>هاتف:</span>
                        <bdi dir="ltr" className="font-mono font-bold text-slate-700 dark:text-slate-200">{phone}</bdi>
                        {rows.length > 0 && <span> • العمليات: {rows.length}</span>}
                      </p>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-[10px] text-slate-500">الحد الائتماني</div>
                      <div className="font-extrabold text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatMoney(creditLimit, "YER")}
                      </div>
                    </div>
                  </div>

                  {/* Bottom: Financial Metrics */}
                  <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-2 rounded-xl text-center">
                      <div className="text-[10px] text-slate-500">إجمالي الفواتير</div>
                      <div className="font-black text-slate-900 dark:text-slate-100 text-xs mt-0.5 tabular-nums">
                        {formatMoney(total, "YER")}
                      </div>
                      {bundles > 0 && (
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {fmtNum(bundles)} وحدة قياس
                        </div>
                      )}
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded-xl text-center">
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">دائن (مسدد)</div>
                      <div className="font-black text-emerald-700 dark:text-emerald-400 text-xs mt-0.5 tabular-nums">
                        {formatMoney(credit, "YER")}
                      </div>
                    </div>
                    <div className="bg-rose-50 dark:bg-rose-950/30 p-2 rounded-xl text-center">
                      <div className="text-[10px] text-rose-700 dark:text-rose-400 font-bold">مدين (متبقي)</div>
                      <div className="font-black text-rose-700 dark:text-rose-400 text-xs mt-0.5 tabular-nums">
                        {formatMoney(debit, "YER")}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {(viewSection === "ledger" || viewSection === "both") && (
        <div className="overflow-x-auto pt-2 space-y-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs font-extrabold text-slate-500 pt-1">
            <span>جدول العمليات وكشوفات الحساب ({visibleRows.length})</span>
            {selectedCustomer !== "ALL" && (
              <button
                type="button"
                onClick={() => setSelectedCustomer("ALL")}
                className="text-emerald-600 hover:underline font-bold"
              >
                عرض جميع العملاء
              </button>
            )}
          </div>
          {visibleRows.length === 0 ? (
            <EmptyState
              title="لا توجد حركات مبيعات أو فواتير مطابقة"
              description="اختر عميلاً آخر أو اضغط على تحديث لعرض الحركات المالية."
              actionLabel={selectedCustomer !== "ALL" ? "إظهار جميع العملاء" : undefined}
              onAction={selectedCustomer !== "ALL" ? () => setSelectedCustomer("ALL") : undefined}
            />
          ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">اسم العميل</th>
                <th className="p-2.5">رقم الهاتف</th>
                <th className="p-2.5">المشروع / القطفة</th>
                <th className="p-2.5">عملية البيع</th>
                <th className="p-2.5">النوع</th>
                <th className="p-2.5">الكمية / وحدة القياس</th>
                <th className="p-2.5">السعر</th>
                <th className="p-2.5">الإجمالي</th>
                <th className="p-2.5">دائن (مدفوع)</th>
                <th className="p-2.5">مدين (متبقي)</th>
                <th className="p-2.5 no-print">إصدار فاتورة / سند</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleRows.map((s) => {
                const proj = projects.find((p) => p.id === s.projectId);
                return (
                  <tr key={s.id}>
                    <td className="p-2.5 font-bold">{s.customer}</td>
                    <td className="p-2.5 font-mono"><bdi dir="ltr">{s.phone}</bdi></td>
                    <td className="p-2.5">
                      {proj ? proj.name : ""} — {s.harvest}
                    </td>
                    <td className="p-2.5">{s.batch}</td>
                    <td className="p-2.5">{s.grade}</td>
                    <td className="p-2.5 font-bold tabular-nums">{fmtNum(s.bundles)}</td>
                    <td className="p-2.5 tabular-nums">{fmtNum(s.price)}</td>
                    <td className="p-2.5 font-extrabold tabular-nums">{fmtNum(s.total)}</td>
                    <td className="p-2.5 text-emerald-600 font-bold tabular-nums">{fmtNum(s.credit)}</td>
                    <td className="p-2.5 text-rose-600 font-bold tabular-nums">{fmtNum(s.debit)}</td>
                    <td className="p-2.5 no-print">
                      <button
                        type="button"
                        onClick={() => onOpenSaleVoucher(s)}
                        className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-bold"
                      >
                        فاتورة / سند
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
        )}

        {(viewSection === "portal" || viewSection === "whatsapp") && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <TenantClientPortalAdminPanel
              key={viewSection}
              initialSection={viewSection === "whatsapp" ? "whatsapp" : "requests"}
              canManageSettings={Boolean(
                canEdit(currentUser, "system") ||
                  currentUser?.role === "SUPER_ADMIN" ||
                  currentUser?.role === "CHIEF_ACCOUNTANT"
              )}
              staffSignature={currentUser?.name ? `${currentUser.username || currentUser.name}${currentUser.department || currentUser.role ? ` (${currentUser.department || currentUser.role})` : ""}` : undefined}
              onRefreshState={onRefreshState}
              onToast={(m) => onToast?.(m)}
            />
          </div>
        )}
      </div>
    </section>
  );
}

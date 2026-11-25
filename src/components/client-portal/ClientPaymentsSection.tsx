"use client";

import React, { useState } from "react";
import {
  Building2,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Landmark,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { UasDateInput } from "@/components/UasDateInput";
import { formatMoney } from "@/lib/uiFormatters";

export interface ClientPaymentChannelView {
  id: string;
  tenantSlug: string;
  category: "WALLET" | "BANK" | "CASH_DEPOSIT";
  categoryLabelAr: string;
  providerCode: string;
  displayNameAr: string;
  displayNameEn: string | null;
  currency: string;
  accountOrWalletNumber: string;
  beneficiaryName: string;
  ibanOrBranch: string | null;
  qrImageUrl: string | null;
  instructionsAr: string | null;
  treasuryAccountId: string;
  glAccountCode: string | null;
  glAccountNameAr: string | null;
  treasuryNameAr: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface ClientPaymentAuditItem {
  action: string;
  labelAr: string;
  actorName: string;
  actorRole: string;
  dateDmy: string;
  timeHm: string;
  timestampDisplay: string;
  note?: string | null;
}

export interface ClientPaymentReceiptView {
  id: string;
  submissionNumber: string;
  tenantSlug: string;
  clientAccountId: string;
  channelId: string;
  channelCategory: "WALLET" | "BANK" | "CASH_DEPOSIT";
  channelCategoryLabelAr: string;
  channelNameAr: string;
  amount: number;
  currency: string;
  transferReference: string;
  transferAt: string;
  transferDateDmy: string;
  transferTimeHm: string;
  transferDisplay: string;
  linkedInvoiceIds: string[];
  linkedRequestIds: string[];
  clientNotes: string | null;
  hasReceiptAttachment: boolean;
  receiptFileName: string | null;
  receiptMimeType: string | null;
  receiptFileSize: number | null;
  receiptUrl: string | null;
  status: string;
  statusLabelAr: string;
  staffNotes: string | null;
  clarificationReason: string | null;
  rejectionReason: string | null;
  reviewedByName: string | null;
  reviewedAtDisplay: string | null;
  linkedReceiptVoucherId: string | null;
  receiptVoucherNumber: string | null;
  auditHistory: ClientPaymentAuditItem[];
  createdAt: string;
  createdAtDisplay: string;
}

export interface PaymentPaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface OpenBillOption {
  id: string;
  invoiceNumber: string;
  balanceDue: number;
  currency: string;
}

interface ClientPaymentsSectionProps {
  channels: ClientPaymentChannelView[];
  payments: ClientPaymentReceiptView[];
  pagination: PaymentPaginationMeta;
  loading: boolean;
  statusFilter: string;
  onStatusFilterChange: (next: string) => void;
  searchQuery: string;
  onSearchQueryChange: (next: string) => void;
  onPageChange: (nextPage: number) => void;
  onRefresh: () => void;
  onOpenNewPayment: (preset?: {
    channelId?: string;
    amount?: string;
    linkedInvoiceIds?: string[];
    linkedRequestIds?: string[];
    resubmitTarget?: ClientPaymentReceiptView | null;
  }) => void;
  resolveHeaders: (extra?: Record<string, string>) => Record<string, string>;
  apiUrl: (path: string) => string;
  onToast: (msg: string) => void;
}

function categoryIcon(cat: ClientPaymentChannelView["category"]) {
  if (cat === "WALLET") return <Wallet className="w-4 h-4 text-emerald-600" />;
  if (cat === "BANK") return <Landmark className="w-4 h-4 text-indigo-600" />;
  return <Building2 className="w-4 h-4 text-amber-600" />;
}

export function ClientPaymentsSection({
  channels,
  payments,
  pagination,
  loading,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  onPageChange,
  onRefresh,
  onOpenNewPayment,
  resolveHeaders,
  apiUrl,
  onToast,
}: ClientPaymentsSectionProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string>("image/png");
  const [previewTitle, setPreviewTitle] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);

  async function handleCopyAccount(val: string, label: string) {
    try {
      await navigator.clipboard?.writeText(val);
      onToast(`✅ تم نسخ ${label}: ${val}`);
    } catch {
      onToast(val);
    }
  }

  async function handleOpenReceiptPreview(p: ClientPaymentReceiptView) {
    if (!p.receiptUrl) return;
    setLoadingPreview(p.id);
    try {
      const res = await fetch(apiUrl(p.receiptUrl), {
        credentials: "include",
        headers: resolveHeaders(),
      });
      if (!res.ok) {
        onToast("تعذر تحميل ملف الإيصال المرفق");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
      setPreviewMime(p.receiptMimeType || blob.type || "image/png");
      setPreviewTitle(`${p.submissionNumber} — ${p.receiptFileName || "إيصال السداد"}`);
    } catch {
      onToast("تعذر فتح معاينة الإيصال");
    } finally {
      setLoadingPreview(null);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  const categories: Array<{ key: ClientPaymentChannelView["category"]; title: string }> = [
    { key: "WALLET", title: "المحافظ الإلكترونية" },
    { key: "BANK", title: "التحويلات البنكية" },
    { key: "CASH_DEPOSIT", title: "إيداع نقدي / مباشر" },
  ];

  return (
    <div className="space-y-4 text-xs">
      {/* Header & CTA */}
      <div className="card-surface rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-black flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-600" />
            <span>بوابة السداد الإلكتروني وإرفاق الإيصالات</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            اختر أحد حسابات الاستلام المعتمدة أدناه، ثم سجّل بيانات الحوالة وأرفق صورة الإيصال ليتم مراجعتها وترحيل سند القبض تلقائياً.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            data-testid="portal-payments-new-btn"
            onClick={() => onOpenNewPayment({})}
            className="px-4 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>تسجيل سداد وإرفاق إيصال</span>
          </button>
        </div>
      </div>

      {/* Tenant Configured Receiving Channels */}
      <div className="card-surface rounded-2xl p-4 space-y-3">
        <div className="font-black text-xs text-slate-700 dark:text-slate-200">
          قنوات وحسابات الاستلام المعتمدة لدى المنشأة ({channels.length})
        </div>
        {channels.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
            لم تقم المنشأة بتفعيل قنوات استلام إلكترونية بعد — يمكنك مراجعة إدارة المنشأة لتفعيل الحسابات.
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map((cat) => {
              const items = channels.filter((c) => c.category === cat.key);
              if (items.length === 0) return null;
              return (
                <div key={cat.key} className="space-y-2">
                  <div className="text-[11px] font-extrabold text-slate-500 flex items-center gap-1.5">
                    {categoryIcon(cat.key)}
                    <span>{cat.title}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {items.map((ch) => (
                      <div
                        key={ch.id}
                        className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2 flex flex-col justify-between"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-black text-xs">{ch.displayNameAr}</span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-mono text-[10px] font-bold">
                              {ch.currency}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/70 rounded-lg px-2.5 py-1.5">
                            <span className="font-mono font-black text-emerald-700 dark:text-emerald-300">
                              <bdi dir="ltr">{ch.accountOrWalletNumber}</bdi>
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleCopyAccount(ch.accountOrWalletNumber, "رقم الحساب")}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500"
                              title="نسخ رقم الحساب"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            المستفيد: <strong>{ch.beneficiaryName}</strong>
                          </div>
                          {ch.ibanOrBranch && (
                            <div className="text-[11px] text-slate-500">
                              الفرع / IBAN: <bdi dir="ltr" className="font-mono">{ch.ibanOrBranch}</bdi>
                            </div>
                          )}
                          {ch.instructionsAr && (
                            <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30 rounded-lg px-2 py-1">
                              {ch.instructionsAr}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenNewPayment({ channelId: ch.id })}
                          className="w-full py-1.5 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 font-extrabold inline-flex items-center justify-center gap-1"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>دفع وإرفاق إيصال عبر هذه القناة</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Submitted Receipts History */}
      <div className="card-surface rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-black text-xs">
            سجل إشعارات السداد والإيصالات ({pagination.total})
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="بحث برقم الإشعار أو المرجع..."
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent pr-8 pl-3 py-1.5 text-xs"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold"
            >
              <option value="ALL">جميع الحالات</option>
              <option value="PENDING_VERIFICATION">قيد المراجعة</option>
              <option value="APPROVED">معتمد ومرحل</option>
              <option value="RETURNED_FOR_CLARIFICATION">معاد للتوضيح</option>
              <option value="REJECTED">مرفوض</option>
            </select>
          </div>
        </div>

        {payments.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
            لا توجد إشعارات سداد مسجلة ضمن هذا الفلتر.
          </div>
        ) : (
          <div className="space-y-2.5">
            {payments.map((p) => (
              <div
                key={p.id}
                data-testid={`portal-payment-row-${p.id}`}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-black px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      <bdi dir="ltr">{p.submissionNumber}</bdi>
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-extrabold text-[11px] ${
                        p.status === "APPROVED"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : p.status === "RETURNED_FOR_CLARIFICATION"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                          : p.status === "REJECTED"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-200"
                          : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
                      }`}
                    >
                      {p.statusLabelAr}
                    </span>
                    <span className="font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                    </span>
                    <span className="text-slate-500">• {p.channelNameAr}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>
                      المرجع: <bdi dir="ltr" className="font-mono font-bold text-slate-700 dark:text-slate-200">{p.transferReference}</bdi>
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3" />
                      <bdi dir="ltr">{p.transferDisplay}</bdi>
                    </span>
                  </div>
                </div>

                {(p.clarificationReason || p.rejectionReason || p.staffNotes) && (
                  <div
                    className={`p-2.5 rounded-lg text-[11px] border ${
                      p.status === "REJECTED"
                        ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200"
                        : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
                    }`}
                  >
                    <strong>ملاحظة المحاسب: </strong>
                    {p.clarificationReason || p.rejectionReason || p.staffNotes}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {p.receiptVoucherNumber && (
                      <span className="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 font-mono font-bold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        سند قبض: <bdi dir="ltr">{p.receiptVoucherNumber}</bdi>
                      </span>
                    )}
                    {p.clientNotes && (
                      <span className="text-slate-500">ملاحظتك: {p.clientNotes}</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {p.hasReceiptAttachment && p.receiptUrl && (
                      <button
                        type="button"
                        disabled={loadingPreview === p.id}
                        onClick={() => void handleOpenReceiptPreview(p)}
                        className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Eye className="w-3.5 h-3.5 text-indigo-600" />
                        <span>{loadingPreview === p.id ? "جاري التحميل..." : "عرض الإيصال"}</span>
                      </button>
                    )}
                    {p.status === "RETURNED_FOR_CLARIFICATION" && (
                      <button
                        type="button"
                        data-testid={`portal-resubmit-payment-${p.id}`}
                        onClick={() => onOpenNewPayment({ resubmitTarget: p })}
                        className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-extrabold inline-flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>تعديل وإعادة الإرسال</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-slate-500">
              صفحة {pagination.page} من {pagination.totalPages} (إجمالي {pagination.total} إشعار)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
              >
                السابق
              </button>
              <button
                type="button"
                disabled={!pagination.hasMore}
                onClick={() => onPageChange(pagination.page + 1)}
                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Secure Receipt Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closePreview}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <span className="font-black text-xs truncate">{previewTitle}</span>
              <button
                type="button"
                onClick={closePreview}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center bg-slate-50 dark:bg-slate-950 flex-1">
              {previewMime.includes("pdf") ? (
                <iframe src={previewUrl} title={previewTitle} className="w-full h-[65vh] rounded-xl border" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={previewTitle} className="max-h-[68vh] w-auto rounded-xl object-contain" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface SubmitPaymentModalProps {
  open: boolean;
  channels: ClientPaymentChannelView[];
  openBills: OpenBillOption[];
  initialChannelId?: string;
  initialAmount?: string;
  initialLinkedInvoiceIds?: string[];
  initialLinkedRequestIds?: string[];
  resubmitTarget?: ClientPaymentReceiptView | null;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
  resolveHeaders: (extra?: Record<string, string>) => Record<string, string>;
  apiUrl: (path: string) => string;
  onToast: (msg: string) => void;
}

export function SubmitPaymentModal({
  open,
  channels,
  openBills,
  initialChannelId,
  initialAmount,
  initialLinkedInvoiceIds,
  initialLinkedRequestIds,
  resubmitTarget,
  onClose,
  onSubmitted,
  resolveHeaders,
  apiUrl,
  onToast,
}: SubmitPaymentModalProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowHm = new Date().toTimeString().slice(0, 5);

  const [channelId, setChannelId] = useState<string>(
    resubmitTarget?.channelId || initialChannelId || channels[0]?.id || ""
  );
  const [amount, setAmount] = useState<string>(
    resubmitTarget ? String(resubmitTarget.amount) : initialAmount || ""
  );
  const [currency, setCurrency] = useState<string>(
    resubmitTarget?.currency || channels.find((c) => c.id === (initialChannelId || channels[0]?.id))?.currency || "YER"
  );
  const [transferReference, setTransferReference] = useState<string>(
    resubmitTarget?.transferReference || ""
  );
  const [transferDate, setTransferDate] = useState<string>(
    resubmitTarget?.transferAt ? resubmitTarget.transferAt.slice(0, 10) : todayIso
  );
  const [transferTime, setTransferTime] = useState<string>(
    resubmitTarget?.transferTimeHm || nowHm
  );
  const [linkedInvoiceIds, setLinkedInvoiceIds] = useState<string[]>(
    resubmitTarget?.linkedInvoiceIds || initialLinkedInvoiceIds || []
  );
  const [linkedRequestIds] = useState<string[]>(
    resubmitTarget?.linkedRequestIds || initialLinkedRequestIds || []
  );
  const [clientNotes, setClientNotes] = useState<string>(resubmitTarget?.clientNotes || "");
  const [receiptDataUrl, setReceiptDataUrl] = useState<string>("");
  const [receiptFileName, setReceiptFileName] = useState<string>(resubmitTarget?.receiptFileName || "");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (!open) return null;

  const selectedChannel = channels.find((c) => c.id === channelId) || channels[0] || null;

  function handleFilePicked(file: File | null) {
    setErrMsg(null);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErrMsg("حجم ملف الإيصال يجب ألا يتجاوز 10 ميجابايت");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      if (!res) return;
      setReceiptDataUrl(res);
      setReceiptFileName(file.name || "receipt.png");
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg(null);

    const effectiveChannelId = selectedChannel?.id || channelId;
    if (!effectiveChannelId) {
      setErrMsg("يرجى اختيار قناة استلام السداد");
      return;
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setErrMsg("يرجى إدخال مبلغ سداد صحيح أكبر من صفر");
      return;
    }
    if (!transferReference.trim()) {
      setErrMsg("يرجى إدخال رقم المرجع أو الحوالة");
      return;
    }
    if (!resubmitTarget && !receiptDataUrl) {
      setErrMsg("يرجى إرفاق صورة أو ملف PDF لإيصال التحويل/الإيداع");
      return;
    }

    setSubmitting(true);
    try {
      const isResubmit = Boolean(resubmitTarget);
      const res = await fetch(apiUrl("/api/client-portal/payments"), {
        method: isResubmit ? "PATCH" : "POST",
        credentials: "include",
        headers: resolveHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...(isResubmit ? { paymentId: resubmitTarget?.id } : { channelId: effectiveChannelId }),
          amount: numAmount,
          currency: selectedChannel?.currency || currency || "YER",
          transferReference: transferReference.trim(),
          transferDate,
          transferTime,
          linkedInvoiceIds,
          linkedRequestIds,
          clientNotes: clientNotes.trim() || undefined,
          ...(receiptDataUrl ? { receiptDataUrl, receiptFileName } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setErrMsg(data.error || "تعذر إرسال إشعار السداد");
        return;
      }
      onToast(data.message || "✅ تم إرسال إشعار السداد للمراجعة بنجاح");
      await onSubmitted();
      onClose();
    } catch {
      setErrMsg("تعذر الاتصال بالخادم أثناء إرسال إشعار السداد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-700 text-xs my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-black flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-600" />
            <span>
              {resubmitTarget
                ? `تعديل وإعادة إرسال الإيصال (${resubmitTarget.submissionNumber})`
                : "تسجيل سداد وإرفاق إيصال التحويل"}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!resubmitTarget && (
            <div>
              <label className="block font-bold mb-1">قناة / حساب الاستلام *</label>
              <select
                data-testid="portal-payment-channel-select"
                value={selectedChannel?.id || ""}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setChannelId(nextId);
                  const found = channels.find((c) => c.id === nextId);
                  if (found) setCurrency(found.currency);
                }}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
              >
                {channels.length === 0 ? (
                  <option value="">لا توجد قنوات دفع نشطة حالياً</option>
                ) : (
                  channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      [{ch.categoryLabelAr}] {ch.displayNameAr} — {ch.accountOrWalletNumber} ({ch.currency})
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {selectedChannel && (
            <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-1 text-[11px]">
              <div className="font-black text-emerald-800 dark:text-emerald-200">
                بيانات التحويل إلى: {selectedChannel.displayNameAr}
              </div>
              <div>
                رقم الحساب / المحفظة:{" "}
                <strong className="font-mono">
                  <bdi dir="ltr">{selectedChannel.accountOrWalletNumber}</bdi>
                </strong>{" "}
                • المستفيد: <strong>{selectedChannel.beneficiaryName}</strong>
              </div>
              {selectedChannel.instructionsAr && (
                <div className="text-slate-600 dark:text-slate-300">{selectedChannel.instructionsAr}</div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">المبلغ المدفوع ({selectedChannel?.currency || currency}) *</label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                data-testid="portal-payment-amount-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="مثال: 50000"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">رقم المرجع / الحوالة / السند *</label>
              <input
                type="text"
                required
                dir="ltr"
                data-testid="portal-payment-ref-input"
                value={transferReference}
                onChange={(e) => setTransferReference(e.target.value)}
                placeholder="JWL-998877"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">تاريخ التحويل (يوم / شهر / سنة)</label>
              <UasDateInput value={transferDate} onChange={setTransferDate} />
            </div>
            <div>
              <label className="block font-bold mb-1">وقت التحويل (HH:mm)</label>
              <input
                type="time"
                dir="ltr"
                value={transferTime}
                onChange={(e) => setTransferTime(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right font-mono"
              />
            </div>
          </div>

          {openBills.length > 0 && (
            <div>
              <label className="block font-bold mb-1">ربط بفواتير مفتوحة (اختياري — وإلا يُسجّل دفعة على الحساب)</label>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                {openBills.map((b) => {
                  const checked = linkedInvoiceIds.includes(b.id);
                  return (
                    <label
                      key={b.id}
                      className={`px-2 py-1 rounded-lg border cursor-pointer inline-flex items-center gap-1.5 font-bold ${
                        checked
                          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-200"
                          : "border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setLinkedInvoiceIds((prev) =>
                            e.target.checked ? [...prev, b.id] : prev.filter((id) => id !== b.id)
                          )
                        }
                      />
                      <bdi dir="ltr" className="font-mono">{b.invoiceNumber}</bdi>
                      <span>({formatMoney(b.balanceDue, b.currency)})</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block font-bold mb-1">
              صورة / ملف الإيصال (JPG, PNG, WEBP, PDF حتى 10MB) {!resubmitTarget ? "*" : "(اختياري عند التعديل)"}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="px-3 py-2 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1.5 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                <Upload className="w-3.5 h-3.5" />
                <span>اختيار ملف / معرض الصور</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => handleFilePicked(e.target.files?.[0] || null)}
                />
              </label>
              <label className="px-3 py-2 rounded-xl border border-indigo-400 text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1.5 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/40">
                <Camera className="w-3.5 h-3.5" />
                <span>تصوير الإيصال</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleFilePicked(e.target.files?.[0] || null)}
                />
              </label>
              {receiptFileName && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  <FileText className="w-3.5 h-3.5" />
                  <span>{receiptFileName}</span>
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1">ملاحظات العميل (اختياري)</label>
            <input
              type="text"
              value={clientNotes}
              onChange={(e) => setClientNotes(e.target.value)}
              placeholder="مثال: سداد جزئي أو دفعة لحساب فاتورة محددة..."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
            />
          </div>

          {errMsg && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-200 font-bold flex items-center gap-1.5">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{errMsg}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting || (!resubmitTarget && channels.length === 0)}
              data-testid="portal-payment-submit-btn"
              className="px-5 py-2 rounded-xl accent-bg font-extrabold disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{submitting ? "جاري الإرسال..." : resubmitTarget ? "إعادة إرسال للمراجعة" : "إرسال إشعار السداد"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

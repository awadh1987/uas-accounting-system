"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Clock,
  CornerUpLeft,
  CreditCard,
  Eye,
  Landmark,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { formatMoney } from "@/lib/uiFormatters";
import type {
  ClientPaymentChannelView,
  ClientPaymentReceiptView,
  PaymentPaginationMeta,
} from "@/components/client-portal/ClientPaymentsSection";

interface ChannelPreset {
  code: string;
  category: "WALLET" | "BANK" | "CASH_DEPOSIT";
  labelAr: string;
  labelEn: string;
}

interface TreasuryOption {
  id: string;
  code: string;
  nameAr: string;
  type: string;
  currency: string;
  accountNumber: string | null;
  accountId: string;
  glAccountCode: string | null;
  glAccountNameAr: string | null;
}

interface AdminPaymentReceiptView extends ClientPaymentReceiptView {
  clientAccount?: {
    id: string;
    fullName: string;
    tradeName: string | null;
    phone: string;
    customerId: string | null;
  };
}

interface PortalAdminPaymentGateSectionProps {
  mode: "payments" | "channels";
  canManageChannels: boolean;
  onToast: (msg: string) => void;
  onChanged?: () => Promise<void> | void;
}

export function PortalAdminPaymentGateSection({
  mode,
  canManageChannels,
  onToast,
  onChanged,
}: PortalAdminPaymentGateSectionProps) {
  // Verification Queue State
  const [payments, setPayments] = useState<AdminPaymentReceiptView[]>([]);
  const [paymentsPagination, setPaymentsPagination] = useState<PaymentPaginationMeta>({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [statusFilter, setStatusFilter] = useState<string>("PENDING_VERIFICATION");
  const [searchInput, setSearchInput] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [loadingPayments, setLoadingPayments] = useState<boolean>(false);
  const [notesByPaymentId, setNotesByPaymentId] = useState<Record<string, string>>({});
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string>("image/png");
  const [previewTitle, setPreviewTitle] = useState<string>("");

  // Channels Setup State
  const [channels, setChannels] = useState<ClientPaymentChannelView[]>([]);
  const [presets, setPresets] = useState<ChannelPreset[]>([]);
  const [treasuries, setTreasuries] = useState<TreasuryOption[]>([]);
  const [loadingChannels, setLoadingChannels] = useState<boolean>(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [chCategory, setChCategory] = useState<"WALLET" | "BANK" | "CASH_DEPOSIT">("WALLET");
  const [chProviderCode, setChProviderCode] = useState<string>("JAWALI");
  const [chNameAr, setChNameAr] = useState<string>("محفظة جوالي (Jawali)");
  const [chCurrency, setChCurrency] = useState<string>("YER");
  const [chAccountNumber, setChAccountNumber] = useState<string>("");
  const [chBeneficiaryName, setChBeneficiaryName] = useState<string>("");
  const [chIbanOrBranch, setChIbanOrBranch] = useState<string>("");
  const [chInstructionsAr, setChInstructionsAr] = useState<string>("");
  const [chTreasuryAccountId, setChTreasuryAccountId] = useState<string>("");
  const [chDisplayOrder, setChDisplayOrder] = useState<string>("1");
  const [chIsActive, setChIsActive] = useState<boolean>(true);
  const [savingChannel, setSavingChannel] = useState<boolean>(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const qs = new URLSearchParams({
        status: statusFilter,
        page: String(page),
        pageSize: "25",
      });
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const res = await fetch(`/api/portal-admin/payments?${qs.toString()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          payments?: AdminPaymentReceiptView[];
          pagination?: PaymentPaginationMeta;
        };
        setPayments(data.payments || []);
        if (data.pagination) setPaymentsPagination(data.pagination);
      }
    } catch {
      onToast("تعذر تحميل قائمة إيصالات السداد");
    } finally {
      setLoadingPayments(false);
    }
  }, [statusFilter, page, debouncedSearch, onToast]);

  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const res = await fetch("/api/portal-admin/payment-channels", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          channels?: ClientPaymentChannelView[];
          presets?: ChannelPreset[];
          treasuries?: TreasuryOption[];
        };
        setChannels(data.channels || []);
        if (data.presets) setPresets(data.presets);
        if (data.treasuries) {
          setTreasuries(data.treasuries);
          if (!chTreasuryAccountId && data.treasuries[0]) {
            setChTreasuryAccountId(data.treasuries[0].id);
          }
        }
      }
    } catch {
      onToast("تعذر تحميل قنوات الاستلام");
    } finally {
      setLoadingChannels(false);
    }
  }, [chTreasuryAccountId, onToast]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      if (mode === "payments") {
        void loadPayments();
      } else {
        void loadChannels();
      }
    });
    return () => {
      active = false;
    };
  }, [mode, loadPayments, loadChannels]);

  async function handleReviewPayment(
    paymentId: string,
    action: "APPROVE" | "RETURN_FOR_CLARIFICATION" | "REJECT"
  ) {
    const note = (notesByPaymentId[paymentId] || "").trim();
    if ((action === "RETURN_FOR_CLARIFICATION" || action === "REJECT") && !note) {
      onToast("يرجى كتابة سبب الإعادة أو الرفض في خانة الملاحظات قبل المتابعة");
      return;
    }
    setBusyPaymentId(paymentId);
    try {
      const res = await fetch("/api/portal-admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          action,
          staffNotes: note || undefined,
          reason: note || undefined,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        onToast(data.error || "تعذر تنفيذ الإجراء على الإيصال");
        return;
      }
      onToast(data.message || "✅ تم تحديث حالة الإيصال");
      await Promise.all([loadPayments(), onChanged?.()]);
    } finally {
      setBusyPaymentId(null);
    }
  }

  async function handleOpenReceiptPreview(p: AdminPaymentReceiptView) {
    if (!p.receiptUrl) return;
    const res = await fetch(p.receiptUrl, { cache: "no-store" });
    if (!res.ok) {
      onToast("تعذر عرض ملف الإيصال");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(url);
    setPreviewMime(p.receiptMimeType || blob.type || "image/png");
    setPreviewTitle(`${p.submissionNumber} — ${p.clientAccount?.fullName || ""}`);
  }

  function startCreateChannel() {
    setEditingChannelId(null);
    setChCategory("WALLET");
    setChProviderCode("JAWALI");
    setChNameAr("محفظة جوالي (Jawali)");
    setChCurrency("YER");
    setChAccountNumber("");
    setChBeneficiaryName("");
    setChIbanOrBranch("");
    setChInstructionsAr("");
    setChDisplayOrder(String(channels.length + 1));
    setChIsActive(true);
    if (treasuries[0]) setChTreasuryAccountId(treasuries[0].id);
  }

  function startEditChannel(ch: ClientPaymentChannelView) {
    setEditingChannelId(ch.id);
    setChCategory(ch.category);
    setChProviderCode(ch.providerCode);
    setChNameAr(ch.displayNameAr);
    setChCurrency(ch.currency);
    setChAccountNumber(ch.accountOrWalletNumber);
    setChBeneficiaryName(ch.beneficiaryName);
    setChIbanOrBranch(ch.ibanOrBranch || "");
    setChInstructionsAr(ch.instructionsAr || "");
    setChTreasuryAccountId(ch.treasuryAccountId);
    setChDisplayOrder(String(ch.displayOrder));
    setChIsActive(ch.isActive);
  }

  async function handleSaveChannel(e: React.FormEvent) {
    e.preventDefault();
    setSavingChannel(true);
    try {
      const res = await fetch("/api/portal-admin/payment-channels", {
        method: editingChannelId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingChannelId ? { id: editingChannelId } : {}),
          category: chCategory,
          providerCode: chProviderCode,
          displayNameAr: chNameAr.trim(),
          currency: chCurrency.trim().toUpperCase(),
          accountOrWalletNumber: chAccountNumber.trim(),
          beneficiaryName: chBeneficiaryName.trim(),
          ibanOrBranch: chIbanOrBranch.trim() || null,
          instructionsAr: chInstructionsAr.trim() || null,
          treasuryAccountId: chTreasuryAccountId,
          displayOrder: Number(chDisplayOrder) || 1,
          isActive: chIsActive,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        onToast(data.error || "تعذر حفظ قناة الاستلام");
        return;
      }
      onToast(data.message || "✅ تم حفظ قناة استلام السداد");
      startCreateChannel();
      await loadChannels();
    } finally {
      setSavingChannel(false);
    }
  }

  async function handleToggleOrDeleteChannel(ch: ClientPaymentChannelView, remove: boolean) {
    const res = await fetch("/api/portal-admin/payment-channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: ch.id,
        ...(remove ? { remove: true } : { isActive: !ch.isActive }),
      }),
    });
    const data = (await res.json()) as { message?: string; error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر تنفيذ الإجراء");
      return;
    }
    onToast(data.message || "✅ تم التحديث");
    await loadChannels();
  }

  if (mode === "channels") {
    return (
      <div className="space-y-4 text-xs">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {canManageChannels && (
            <form
              onSubmit={handleSaveChannel}
              className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-black text-sm flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>
                    {editingChannelId
                      ? "تعديل قناة استلام السداد"
                      : "إعداد بوابات وحسابات الاستلام للمنشأة"}
                  </span>
                </h4>
                {editingChannelId && (
                  <button
                    type="button"
                    onClick={startCreateChannel}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>قناة جديدة</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold mb-1">الفئة *</label>
                  <select
                    value={chCategory}
                    onChange={(e) => {
                      const nextCat = e.target.value as "WALLET" | "BANK" | "CASH_DEPOSIT";
                      setChCategory(nextCat);
                      const firstPreset = presets.find((p) => p.category === nextCat);
                      if (firstPreset && !editingChannelId) {
                        setChProviderCode(firstPreset.code);
                        setChNameAr(firstPreset.labelAr);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                  >
                    <option value="WALLET">المحافظ الإلكترونية (Jawali / ONE Cash...)</option>
                    <option value="BANK">التحويلات البنكية (الكريمي / التضامن / كاك...)</option>
                    <option value="CASH_DEPOSIT">إيداع نقدي / مباشر في الفرع</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">المزود الجاهز / النوع</label>
                  <select
                    value={chProviderCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setChProviderCode(code);
                      const matched = presets.find((p) => p.code === code);
                      if (matched && !editingChannelId) {
                        setChCategory(matched.category);
                        setChNameAr(matched.labelAr);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                  >
                    {presets.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.labelAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block font-bold mb-1">اسم القناة الظاهر للعميل *</label>
                  <input
                    type="text"
                    required
                    value={chNameAr}
                    onChange={(e) => setChNameAr(e.target.value)}
                    placeholder="مثال: محفظة جوالي - فرع صنعاء"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">العملة</label>
                  <select
                    value={chCurrency}
                    onChange={(e) => setChCurrency(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                  >
                    <option value="YER">ريال يمني (YER)</option>
                    <option value="SAR">ريال سعودي (SAR)</option>
                    <option value="USD">دولار (USD)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold mb-1">رقم المحفظة / الحساب البنكي *</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={chAccountNumber}
                    onChange={(e) => setChAccountNumber(e.target.value)}
                    placeholder="770000111"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-right font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">اسم المستفيد / صاحب الحساب *</label>
                  <input
                    type="text"
                    required
                    value={chBeneficiaryName}
                    onChange={(e) => setChBeneficiaryName(e.target.value)}
                    placeholder="شركة / محلات ..."
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">حساب الخزينة / البنك المحاسبي المقابل (GL) *</label>
                <select
                  required
                  value={chTreasuryAccountId}
                  onChange={(e) => setChTreasuryAccountId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-bold"
                >
                  {treasuries.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr} ({t.currency}) {t.glAccountCode ? `— GL ${t.glAccountCode}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold mb-1">الفرع / IBAN (اختياري)</label>
                  <input
                    type="text"
                    value={chIbanOrBranch}
                    onChange={(e) => setChIbanOrBranch(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">ترتيب العرض</label>
                  <input
                    type="number"
                    min="1"
                    value={chDisplayOrder}
                    onChange={(e) => setChDisplayOrder(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">تعليمات التحويل للعميل (اختياري)</label>
                <input
                  type="text"
                  value={chInstructionsAr}
                  onChange={(e) => setChInstructionsAr(e.target.value)}
                  placeholder="مثال: يرجى كتابة اسم العميل في وصف الحوالة..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                />
              </div>

              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={chIsActive}
                  onChange={(e) => setChIsActive(e.target.checked)}
                />
                <span>القناة مفعلة وظاهرة للعملاء في البوابة</span>
              </label>

              <div>
                <button
                  type="submit"
                  disabled={savingChannel || treasuries.length === 0}
                  className="px-5 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingChannel ? "جاري الحفظ..." : editingChannelId ? "حفظ التعديل" : "إضافة قناة الاستلام"}</span>
                </button>
              </div>
            </form>
          )}

          {/* Configured Channels List */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-sm">الحسابات والقنوات المسجلة ({channels.length})</h4>
              <button
                type="button"
                onClick={() => void loadChannels()}
                disabled={loadingChannels}
                className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loadingChannels ? "animate-spin" : ""}`} />
                <span>تحديث</span>
              </button>
            </div>
            {channels.length === 0 ? (
              <div className="p-6 text-center text-slate-500">لا توجد قنوات مضافة لهذه المنشأة بعد.</div>
            ) : (
              <div className="space-y-2">
                {channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {ch.category === "WALLET" ? (
                          <Wallet className="w-4 h-4 text-emerald-600" />
                        ) : ch.category === "BANK" ? (
                          <Landmark className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <Building2 className="w-4 h-4 text-amber-600" />
                        )}
                        <span className="font-black">{ch.displayNameAr}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            ch.isActive
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {ch.isActive ? "نشط" : "معطل"}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-slate-500">{ch.currency}</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300">
                      رقم الحساب: <bdi dir="ltr" className="font-mono font-bold">{ch.accountOrWalletNumber}</bdi> • المستفيد: {ch.beneficiaryName}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      الربط المحاسبي: <strong>{ch.treasuryNameAr || ch.treasuryAccountId}</strong>
                      {ch.glAccountCode ? ` (GL ${ch.glAccountCode})` : ""}
                    </div>
                    {canManageChannels && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => startEditChannel(ch)}
                          className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold"
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleOrDeleteChannel(ch, false)}
                          className="px-2.5 py-1 rounded-lg border border-amber-400 text-amber-700 dark:text-amber-300 font-bold"
                        >
                          {ch.isActive ? "تعطيل" : "تفعيل"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleOrDeleteChannel(ch, true)}
                          className="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-600 font-bold inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>حذف</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold"
          >
            <option value="PENDING_VERIFICATION">قيد المراجعة والاعتماد</option>
            <option value="RETURNED_FOR_CLARIFICATION">معادة للعميل للتوضيح</option>
            <option value="APPROVED">معتمدة ومرحّلة لسند قبض</option>
            <option value="REJECTED">مرفوضة</option>
            <option value="ALL">جميع إيصالات السداد</option>
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="بحث برقم الإشعار، المرجع، أو العميل..."
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pr-8 pl-3 py-1.5"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadPayments()}
          disabled={loadingPayments}
          className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingPayments ? "animate-spin" : ""}`} />
          <span>تحديث ({paymentsPagination.total})</span>
        </button>
      </div>

      {payments.length === 0 ? (
        <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-slate-500">
          لا توجد إيصالات سداد ضمن هذا التصنيف حالياً.
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => {
            const isActionable =
              p.status === "PENDING_VERIFICATION" || p.status === "RETURNED_FOR_CLARIFICATION";
            return (
              <div
                key={p.id}
                data-testid={`staff-payment-row-${p.id}`}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-black px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                      <bdi dir="ltr">{p.submissionNumber}</bdi>
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-extrabold text-[11px] ${
                        p.status === "APPROVED"
                          ? "bg-emerald-100 text-emerald-700"
                          : p.status === "RETURNED_FOR_CLARIFICATION"
                          ? "bg-amber-100 text-amber-800"
                          : p.status === "REJECTED"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-indigo-100 text-indigo-800"
                      }`}
                    >
                      {p.statusLabelAr}
                    </span>
                    <span className="font-black text-sm">{p.clientAccount?.fullName || "عميل"}</span>
                    {p.clientAccount?.phone && (
                      <span className="font-mono text-slate-500">
                        <bdi dir="ltr">{p.clientAccount.phone}</bdi>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-emerald-700 dark:text-emerald-300 tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                    </span>
                    {p.hasReceiptAttachment && p.receiptUrl && (
                      <button
                        type="button"
                        onClick={() => void handleOpenReceiptPreview(p)}
                        className="px-3 py-1 rounded-xl border border-indigo-400 text-indigo-700 dark:text-indigo-300 font-bold inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>معاينة الإيصال</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                  <span>
                    القناة: <strong>{p.channelNameAr}</strong> ({p.channelCategoryLabelAr})
                  </span>
                  <span>
                    رقم الحوالة / المرجع: <bdi dir="ltr" className="font-mono font-black">{p.transferReference}</bdi>
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3" />
                    <bdi dir="ltr">{p.transferDisplay}</bdi>
                  </span>
                  {p.receiptVoucherNumber && (
                    <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-mono font-bold">
                      سند قبض مرحّل: <bdi dir="ltr">{p.receiptVoucherNumber}</bdi>
                    </span>
                  )}
                </div>

                {p.clientNotes && (
                  <div className="text-[11px] text-slate-500">
                    ملاحظات العميل: {p.clientNotes}
                  </div>
                )}

                {p.auditHistory.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                    {p.auditHistory.map((h, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                        {h.labelAr} • {h.actorName} (<bdi dir="ltr">{h.timestampDisplay}</bdi>)
                      </span>
                    ))}
                  </div>
                )}

                {isActionable && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <input
                      type="text"
                      value={notesByPaymentId[p.id] || ""}
                      onChange={(e) =>
                        setNotesByPaymentId((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                      placeholder="ملاحظة الاعتماد أو سبب الإعادة للتوضيح / الرفض..."
                      className="flex-1 min-w-[220px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5"
                    />
                    <button
                      type="button"
                      disabled={busyPaymentId === p.id}
                      data-testid={`staff-approve-payment-${p.id}`}
                      onClick={() => void handleReviewPayment(p.id, "APPROVE")}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>اعتماد وترحيل سند قبض</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyPaymentId === p.id}
                      onClick={() => void handleReviewPayment(p.id, "RETURN_FOR_CLARIFICATION")}
                      className="px-3 py-1.5 rounded-xl border border-amber-400 text-amber-700 dark:text-amber-300 font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      <span>إعادة للتوضيح</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyPaymentId === p.id}
                      onClick={() => void handleReviewPayment(p.id, "REJECT")}
                      className="px-3 py-1.5 rounded-xl border border-rose-400 text-rose-600 font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>رفض</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {paymentsPagination.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <span className="text-[11px] text-slate-500">
            صفحة {paymentsPagination.page} من {paymentsPagination.totalPages} (إجمالي {paymentsPagination.total})
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={paymentsPagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
            >
              السابق
            </button>
            <button
              type="button"
              disabled={!paymentsPagination.hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold disabled:opacity-40"
            >
              التالي
            </button>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <span className="font-black text-xs truncate">{previewTitle}</span>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                }}
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

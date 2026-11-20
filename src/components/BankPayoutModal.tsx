"use client";

import React, { useState, useEffect } from "react";
import {
  CheckCircle2,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { UasTreasuryAccount, UasUser } from "@/types/uas";

export interface PayoutInitialData {
  treasuryAccountId?: string;
  sourceVoucherType: "PAYMENT_VOUCHER" | "VENDOR_BILL" | "WORKER_WAGE" | "TREASURY_TRANSFER";
  sourceVoucherId: string;
  beneficiaryName: string;
  beneficiaryAccountOrPhone: string;
  amount: number;
  currencyCode?: string;
  notes?: string;
}

interface BankPayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  treasuryAccounts: UasTreasuryAccount[];
  currentUser?: UasUser;
  initialData?: PayoutInitialData | null;
  onSuccess?: (dispatch: any) => void;
  onToast: (msg: string) => void;
}

const PROVIDER_NAMES: Record<string, string> = {
  MANUAL: "تحويل يدوي (Manual)",
  KURAIMI_API: "بنك الكريمي (Kuraimi Express)",
  JAWALI_API: "محفظة جوالي (Jawali Wallet)",
  JEEB_API: "محفظة جيب (Jeeb Wallet)",
  ONECASH_API: "ون كاش (OneCash)",
  FLOOSAK_API: "فلوسك (Floosak)",
  CUSTOM_WEBHOOK: "رابط مخصص (Custom Webhook)",
};

export function BankPayoutModal({
  isOpen,
  onClose,
  treasuryAccounts,
  currentUser,
  initialData,
  onSuccess,
  onToast,
}: BankPayoutModalProps) {
  const [selectedTreasuryId, setSelectedTreasuryId] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryAccountOrPhone, setBeneficiaryAccountOrPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("YER");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [receiptResult, setReceiptResult] = useState<any | null>(null);

  // Filter active treasuries
  const activeTreasuries = treasuryAccounts.filter(
    (t) => t.isActive !== false && !t.archivedAt
  );

  useEffect(() => {
    if (isOpen) {
      setReceiptResult(null);
      if (initialData) {
        setSelectedTreasuryId(
          initialData.treasuryAccountId || activeTreasuries[0]?.id || ""
        );
        setBeneficiaryName(initialData.beneficiaryName || "");
        setBeneficiaryAccountOrPhone(initialData.beneficiaryAccountOrPhone || "");
        setAmount(initialData.amount ? String(initialData.amount) : "");
        setCurrencyCode(initialData.currencyCode || "YER");
        setNotes(initialData.notes || "");
      } else {
        setSelectedTreasuryId(activeTreasuries[0]?.id || "");
        setBeneficiaryName("");
        setBeneficiaryAccountOrPhone("");
        setAmount("");
        setCurrencyCode("YER");
        setNotes("");
      }
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const currentTreasury = activeTreasuries.find((t) => t.id === selectedTreasuryId);
  const isApiGateway =
    currentTreasury?.gatewayProvider && currentTreasury.gatewayProvider !== "MANUAL";
  const numAmount = Number(amount) || 0;
  const feePercent = currentTreasury?.transferFeePercent || 0;
  const estimatedFee = (numAmount * feePercent) / 100;
  const totalDeduction = numAmount + estimatedFee;

  async function handleExecutePayout(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTreasuryId) {
      onToast("يرجى اختيار حساب الخزينة أو البنك المسدد منه");
      return;
    }
    if (!beneficiaryName.trim() || !beneficiaryAccountOrPhone.trim()) {
      onToast("يرجى إدخال اسم المستفيد ورقم حسابه أو هاتفه");
      return;
    }
    if (numAmount <= 0) {
      onToast("يرجى إدخال مبلغ صحيح للتحويل");
      return;
    }

    setLoading(true);
    try {
      const actor = currentUser
        ? {
            userId: currentUser.id,
            userDisplay: currentUser.name,
            userRole: currentUser.role,
          }
        : undefined;

      const res = await fetch("/api/treasury/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryAccountId: selectedTreasuryId,
          sourceVoucherType: initialData?.sourceVoucherType || "PAYMENT_VOUCHER",
          sourceVoucherId: initialData?.sourceVoucherId || `MANUAL-${Date.now()}`,
          beneficiaryName: beneficiaryName.trim(),
          beneficiaryAccountOrPhone: beneficiaryAccountOrPhone.trim(),
          amount: numAmount,
          currencyCode,
          notes: notes.trim() || undefined,
          actor,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        onToast(data.error || "فشل تنفيذ عملية التحويل البنكي");
        return;
      }

      setReceiptResult(data.dispatch);
      onToast("✅ تم تنفيذ أمر التحويل وتوليد سند الصرف والقيد المحاسبي بنجاح");
      onSuccess?.(data.dispatch);
    } catch {
      onToast("حدث خطأ أثناء الاتصال ببوابة الدفع البنكية");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
      dir="rtl"
    >
      <div className="card-surface rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                تنفيذ التحويل البنكي / المحفظة (Live Payment Gateway)
              </h3>
              <p className="text-[11px] text-slate-500">
                تسديد فوري عبر الربط البنكي مع الترحيل المزدوج لدفتر الأستاذ (Gen-6)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {receiptResult ? (
            /* Success Receipt View */
            <div className="space-y-4 animate-in zoom-in-95 duration-150">
              <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                <div className="font-extrabold text-sm text-emerald-900 dark:text-emerald-200">
                  تم إرسال وتنفيذ التحويل البنكي بنجاح!
                </div>
                <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-mono">
                  رقم الإرسالية: {receiptResult.dispatchNumber}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/30 space-y-2.5">
                <div className="flex justify-between items-center text-slate-500">
                  <span>المستفيد:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {receiptResult.beneficiaryName}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-500">
                  <span>رقم الحساب / الهاتف:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {receiptResult.beneficiaryAccountOrPhone}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-500">
                  <span>المبلغ المحول:</span>
                  <span className="font-extrabold text-emerald-600 tabular-nums">
                    {fmtNum(receiptResult.amount)} {receiptResult.currencyCode}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-500">
                  <span>رسوم البوابة (531200):</span>
                  <span className="font-mono tabular-nums">
                    {fmtNum(receiptResult.feeAmount || 0)} {receiptResult.currencyCode}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-500">
                  <span>بوابة الدفع:</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    {PROVIDER_NAMES[receiptResult.provider] || receiptResult.provider}
                  </span>
                </div>
                {receiptResult.externalReferenceId && (
                  <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      رقم الإشعار البنكي الخارجي:
                    </span>
                    <span className="font-mono font-black px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 text-xs">
                      {receiptResult.externalReferenceId}
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl accent-bg font-extrabold text-xs shadow-sm"
              >
                إغلاق
              </button>
            </div>
          ) : (
            /* Execution Form View */
            <form onSubmit={handleExecutePayout} className="space-y-3.5">
              {/* Treasury Account Selector */}
              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  حساب المصدر (البنك أو المحفظة) *
                </label>
                <select
                  value={selectedTreasuryId}
                  onChange={(e) => setSelectedTreasuryId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                >
                  {activeTreasuries.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr || t.name} ({t.currencyCode} • رصيد: {fmtNum(t.balanceYER)} YER)
                      {t.gatewayProvider && t.gatewayProvider !== "MANUAL"
                        ? ` — [${t.gatewayProvider}${t.isSandbox ? " - تجريبي" : ""}]`
                        : " — [يدوي]"}
                    </option>
                  ))}
                </select>
                {currentTreasury && (
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                    {isApiGateway ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        بوابة نشطة: {PROVIDER_NAMES[currentTreasury.gatewayProvider || ""] || currentTreasury.gatewayProvider}
                        {currentTreasury.isSandbox && " (وضع المحاكاة/Sandbox)"}
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        تنفيذ يدوي (Manual Dispatch) — سيتم إنشاء سند القيد والإرسالية بدون استدعاء API خارجي
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Beneficiary Name & Account */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    اسم المستفيد *
                  </label>
                  <input
                    type="text"
                    required
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                    placeholder="الاسم الثلاثي أو التجاري للمستفيد"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    رقم الحساب / المحفظة / الهاتف *
                  </label>
                  <input
                    type="text"
                    required
                    value={beneficiaryAccountOrPhone}
                    onChange={(e) => setBeneficiaryAccountOrPhone(e.target.value)}
                    placeholder="مثال: 770123456 أو 300123456"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Amount & Currency */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    المبلغ المراد تحويله *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs tabular-nums font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                    العملة
                  </label>
                  <select
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                  >
                    <option value="YER">ريال يمني (YER)</option>
                    <option value="SAR">ريال سعودي (SAR)</option>
                    <option value="USD">دولار أمريكي (USD)</option>
                  </select>
                </div>
              </div>

              {/* Fee and Balance Calculation Summary */}
              {numAmount > 0 && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-1.5 text-[11px] tabular-nums">
                  <div className="flex justify-between items-center text-slate-600 dark:text-slate-400">
                    <span>رسوم التحويل ({feePercent}%):</span>
                    <span className="font-mono">{fmtNum(estimatedFee)} {currencyCode}</span>
                  </div>
                  <div className="flex justify-between items-center font-bold text-slate-800 dark:text-slate-200 pt-1 border-t border-slate-200 dark:border-slate-700">
                    <span>إجمالي الخصم من الحساب:</span>
                    <span className="text-emerald-600 font-extrabold">{fmtNum(totalDeduction)} {currencyCode}</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block font-bold mb-1 text-slate-700 dark:text-slate-300">
                  بيان العملية / ملاحظات
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: تسديد دفعة فاتورة / صرف مستحقات..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-xs"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || numAmount <= 0}
                className="w-full py-2.5 rounded-xl accent-bg font-extrabold text-xs shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري الاتصال وتنفيذ التحويل البنكي...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>تنفيذ التحويل الفوري وتوليد القيد المحاسبي</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

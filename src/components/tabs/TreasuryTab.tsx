"use client";

import React, { useState } from "react";
import { fmtNum, formatCurrencyVal, type CurrencyCode } from "@/lib/formulas";
import type {
  UasInstallmentVoucher,
  UasSaleTransaction,
  UasTreasuryAccount,
  UasWorkerWage,
} from "@/types/uas";

interface TreasuryTabProps {
  currency: CurrencyCode;
  exchangeRates: Record<string, number>;
  treasuryAccounts: UasTreasuryAccount[];
  installments: UasInstallmentVoucher[];
  sales: UasSaleTransaction[];
  workers: UasWorkerWage[];
  onAddInstallment: (payload: {
    type: "CUSTOMER_RECEIPT" | "WORKER_PAYOUT";
    targetId: string;
    treasuryId: string;
    amount: number;
    voucherNo: string;
    date: string;
    notes: string;
  }) => Promise<boolean>;
  onOpenInstallmentModal: (inst: UasInstallmentVoucher) => void;
  onExportExcel: () => void;
  onToast: (msg: string) => void;
}

export function TreasuryTab({
  currency,
  exchangeRates,
  treasuryAccounts,
  installments,
  sales,
  workers,
  onAddInstallment,
  onOpenInstallmentModal,
  onExportExcel,
  onToast,
}: TreasuryTabProps) {
  const [type, setType] = useState<"CUSTOMER_RECEIPT" | "WORKER_PAYOUT">("CUSTOMER_RECEIPT");
  const [targetId, setTargetId] = useState(sales[0]?.id || "");
  const [treasuryId, setTreasuryId] = useState(treasuryAccounts[0]?.id || "t1");
  const [amount, setAmount] = useState("25000");
  const [voucherNo, setVoucherNo] = useState("RV-INST-201");
  const [date, setDate] = useState("2026-11-10");
  const [notes, setNotes] = useState("");

  const targets = type === "CUSTOMER_RECEIPT" ? sales : workers;
  const effectiveTargetId = targets.some((t) => t.id === targetId)
    ? targetId
    : targets[0]?.id || "";

  function handleTypeChange(nextType: "CUSTOMER_RECEIPT" | "WORKER_PAYOUT") {
    setType(nextType);
    const nextList = nextType === "CUSTOMER_RECEIPT" ? sales : workers;
    setTargetId(nextList[0]?.id || "");
    setVoucherNo(nextType === "CUSTOMER_RECEIPT" ? "RV-INST-201" : "PV-INST-201");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount) || 0;
    if (numericAmount <= 0 || !effectiveTargetId) {
      onToast("يرجى تحديد السجل وإدخال مبلغ صحيح");
      return;
    }
    const ok = await onAddInstallment({
      type,
      targetId: effectiveTargetId,
      treasuryId: treasuryId || treasuryAccounts[0]?.id || "t1",
      amount: numericAmount,
      voucherNo: voucherNo.trim() || `RV-INST-${Math.floor(100 + Math.random() * 900)}`,
      date: date || "2026-11-10",
      notes: notes.trim() || "دفعة مسجلة",
    });
    if (ok) {
      setNotes("");
    }
  }

  return (
    <section className="space-y-6">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-extrabold">
              إدارة الصندوق والبنوك والمحافظ وسندات الدفعات المتعددة
            </h3>
            <p className="text-xs text-slate-500">
              متابعة أرصدة الخزينة والبنوك (الكريمي، جوالي، جيب) وفصل تحصيل الدفعات (سندات القبض والصرف) عن الفواتير الأصلية
            </p>
          </div>
          <div className="text-xs font-bold accent-badge px-3 py-1.5 rounded-xl">
            سعر الصرف المعتمد: 1 SAR = {exchangeRates.SAR || 425} YER | 1 USD ={" "}
            {fmtNum(exchangeRates.USD || 1620)} YER
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {treasuryAccounts.map((t) => (
            <div
              key={t.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">{t.type}</span>
                <span className="text-[11px] font-mono text-slate-400">{t.accountNo}</span>
              </div>
              <div className="font-extrabold text-sm">{t.name}</div>
              <div className="text-lg font-extrabold text-emerald-600 pt-1">
                {formatCurrencyVal(t.balanceYER, currency, exchangeRates)}
              </div>
              <div className="text-[11px] text-slate-400">
                الرصيد بالريال: {fmtNum(t.balanceYER)} YER
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="card-surface rounded-2xl p-5 space-y-3 text-xs">
          <h4 className="text-sm font-extrabold border-b pb-2">
            إصدار سند قبض / صرف دفعة (Installment Voucher)
          </h4>
          <div>
            <label className="block font-semibold mb-1">نوع العملية</label>
            <select
              value={type}
              onChange={(e) =>
                handleTypeChange(e.target.value as "CUSTOMER_RECEIPT" | "WORKER_PAYOUT")
              }
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="CUSTOMER_RECEIPT">
                سند قبض دفعة من عميل (تخفيض مديونية عميل)
              </option>
              <option value="WORKER_PAYOUT">
                سند صرف دفعة لعامل (تخفيض مستحقات عامل)
              </option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">الفاتورة / السجل المرتبط</label>
            <select
              value={effectiveTargetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              {type === "CUSTOMER_RECEIPT"
                ? sales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.customer} — {s.batch} (مدين متبقي: {fmtNum(s.debit)} ريال)
                    </option>
                  ))
                : workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} — {w.harvest} (متبقي له: {fmtNum(w.debit)} ريال)
                    </option>
                  ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">الصندوق / البنك / المحفظة</label>
            <select
              value={treasuryId}
              onChange={(e) => setTreasuryId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              {treasuryAccounts.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({formatCurrencyVal(t.balanceYER, currency, exchangeRates)})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">المبلغ (بالريال اليمني YER)</label>
              <input
                id="instAmountInput"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                inputMode="numeric"
                min={100}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">رقم السند</label>
              <input
                value={voucherNo}
                onChange={(e) => setVoucherNo(e.target.value)}
                type="text"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-semibold mb-1">التاريخ</label>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">ملاحظات الدفعة</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                type="text"
                placeholder="دفعة جزئية من الحساب"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
            + حفظ السند وتحديث الحساب والخزينة
          </button>
        </form>

        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-extrabold">سجل سندات القبض والصرف والدفعات المتعددة</h4>
            <button
              onClick={onExportExcel}
              className="px-3 py-1.5 rounded-xl accent-bg text-xs font-bold"
            >
              تصدير السندات Excel
            </button>
          </div>
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">رقم السند</th>
                <th className="p-2.5">النوع</th>
                <th className="p-2.5">العميل / العامل</th>
                <th className="p-2.5">الخزينة / البنك</th>
                <th className="p-2.5">المبلغ</th>
                <th className="p-2.5">التاريخ</th>
                <th className="p-2.5">ملاحظات</th>
                <th className="p-2.5 no-print">سند QR / واتساب</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {installments.map((inst) => {
                const treas = treasuryAccounts.find((t) => t.id === inst.treasuryId);
                const isReceipt = inst.type === "CUSTOMER_RECEIPT";
                return (
                  <tr key={inst.id}>
                    <td className="p-2.5 font-mono font-bold">{inst.voucherNo}</td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          isReceipt
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {isReceipt ? "سند قبض عميل" : "سند صرف عامل"}
                      </span>
                    </td>
                    <td className="p-2.5 font-bold">{inst.targetName}</td>
                    <td className="p-2.5">{treas ? treas.name : ""}</td>
                    <td className="p-2.5 font-extrabold text-emerald-600">
                      {formatCurrencyVal(inst.amount, currency, exchangeRates)}
                    </td>
                    <td className="p-2.5">{inst.date}</td>
                    <td className="p-2.5 text-slate-500">{inst.notes || "—"}</td>
                    <td className="p-2.5 no-print">
                      <button
                        onClick={() => onOpenInstallmentModal(inst)}
                        className="px-2.5 py-1 rounded-lg accent-bg text-[11px] font-bold"
                      >
                        سند QR / واتساب
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


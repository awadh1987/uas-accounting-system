"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmtNum, formatCurrencyVal, type CurrencyCode } from "@/lib/formulas";
import { getDict } from "@/lib/i18n";
import { triggerNativePrint } from "@/lib/nativeBridge";
import type { LanguageCode, UasEnterpriseProfile, VoucherModalPayload } from "@/types/uas";
import { QrVerificationBlock } from "./QrVerificationBlock";

interface VoucherModalProps {
  voucher: VoucherModalPayload | null;
  lang: LanguageCode;
  currency: CurrencyCode;
  exchangeRates: Record<string, number>;
  logoText: string;
  enterpriseProfile?: UasEnterpriseProfile | null;
  onClose: () => void;
  onSendWhatsApp: (voucher: VoucherModalPayload) => void;
}

export function VoucherModal({
  voucher,
  lang,
  currency,
  exchangeRates,
  logoText,
  enterpriseProfile,
  onClose,
  onSendWhatsApp,
}: VoucherModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!voucher) return;
    document.body.classList.add("uas-printing-voucher-modal");
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => {
      document.body.classList.remove("uas-printing-voucher-modal");
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [voucher, onClose]);

  if (!voucher || !mounted) return null;
  const dict = getDict(lang);

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-[70] flex items-center justify-center p-4 uas-voucher-modal-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative z-[80] card-surface rounded-2xl max-w-2xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto uas-voucher-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b pb-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center font-bold">
              {logoText || "UAS"}
            </div>
            <div>
              <h3 className="font-bold text-base">{voucher.title}</h3>
              <p className="text-xs text-slate-500">
                {voucher.subtitle ||
                  (lang === "ar"
                    ? enterpriseProfile?.legalNameAr || "اسم المنشأة"
                    : enterpriseProfile?.legalNameEn || "Enterprise Name")}
                {enterpriseProfile?.commercialReg ? ` • ${enterpriseProfile.commercialReg}` : ""}
                {enterpriseProfile?.taxNumber
                  ? ` • ${lang === "ar" ? "الرقم الضريبي:" : "Tax ID:"} ${enterpriseProfile.taxNumber}`
                  : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold px-2 no-print"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <div>
              <strong>{voucher.partyLabel}:</strong> {voucher.partyName}
            </div>
            <div>
              <strong>رقم الهاتف / التاريخ:</strong> {voucher.phone} — {voucher.date}
            </div>
            <div>
              <strong>المشروع / القطفة:</strong> {voucher.projectHarvest}
            </div>
            <div>
              <strong>{voucher.detailLineLabel}:</strong> {voucher.detailLineValue}
            </div>
            {voucher.treasuryName && (
              <div>
                <strong>الخزينة / البنك:</strong> {voucher.treasuryName}
              </div>
            )}
            {voucher.notes && (
              <div>
                <strong>البيان:</strong> {voucher.notes}
              </div>
            )}
          </div>

          {(voucher.kind === "installment" || voucher.kind === "vendor_payment") &&
          voucher.singleAmountYER !== undefined ? (
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 text-center">
              <div className="text-xs text-emerald-700">قيمة السند ({voucher.voucherNo})</div>
              <div className="text-lg font-extrabold text-emerald-700">
                {formatCurrencyVal(voucher.singleAmountYER, currency, exchangeRates)}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 text-center pt-2">
              <div className="p-3 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">
                  {voucher.kind === "worker" ? "إجمالي الأجر المستحق" : "الإجمالي الكلي"}
                </div>
                <div className="text-base font-extrabold">
                  {fmtNum(voucher.totalAmount)} ريال
                </div>
              </div>
              <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                <div className="text-xs text-emerald-700">
                  {voucher.kind === "worker" ? "المسلم للعامل (دائن)" : "مقبوض دائن (Credit)"}
                </div>
                <div className="text-base font-extrabold text-emerald-700">
                  {fmtNum(voucher.creditAmount)} ريال
                </div>
              </div>
              <div className="p-3 rounded-xl border border-rose-200 bg-rose-50/50">
                <div className="text-xs text-rose-700">
                  {voucher.kind === "worker" ? "المتبقي للعامل (مدين)" : "متبقي مدين (Debit)"}
                </div>
                <div className="text-base font-extrabold text-rose-700">
                  {fmtNum(voucher.debitAmount)} ريال
                </div>
              </div>
            </div>
          )}

          <QrVerificationBlock payload={voucher.qrPayload} />

          {voucher.kind === "sale" && (
            <div className="pt-4 flex justify-between text-xs text-slate-500 border-t">
              <span>توقيع المستلم (العميل): ______________________</span>
              <span>توقيع المحاسب / المدير: ______________________</span>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2 no-print">
          <button
            onClick={() => onSendWhatsApp(voucher)}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-bold"
          >
            {dict.whatsappBtn}
          </button>
          <button
            onClick={() =>
              void triggerNativePrint({
                title: `${voucher.title}-${voucher.voucherNo || "Voucher"}`,
              })
            }
            className="px-4 py-2 rounded-lg accent-bg text-xs font-bold"
          >
            {dict.printPdfBtn}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold"
          >
            {dict.closeBtn}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


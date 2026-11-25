"use client";

import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  History,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { computeSaleTotals } from "@/lib/formulas";
import type { ClientCatalogBoardItemView } from "@/lib/clientPortal/portalTypes";
import {
  buildBulkImportTemplateWorkbook,
  generateBulkImportSampleText,
  parseBulkOrderFileBuffer,
  parseBulkOrderText,
  type CatalogItemMatchSource,
  type ParsedBulkRequestRow,
  type QuickRepeatBasketItem,
} from "@/lib/clientPortal/bulkRequestParser";
import type { TenantFormConfig } from "@/lib/clientPortal/portalConfig";
import { exportOrShareBinaryFile } from "@/lib/nativeBridge";
import { buildTenantExportFilename, formatIsoToDmy, formatMoney } from "@/lib/uiFormatters";

interface BulkItemImportModalProps {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  boardItems: ClientCatalogBoardItemView[];
  catalogItems: CatalogItemMatchSource[];
  formConfig: TenantFormConfig | null;
  onApplyRows: (rows: ParsedBulkRequestRow[], mode: "merge" | "replace") => void;
}

export function BulkItemImportModal({
  open,
  onClose,
  tenantSlug,
  boardItems,
  catalogItems,
  formConfig,
  onApplyRows,
}: BulkItemImportModalProps) {
  const [rawText, setRawText] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedBulkRequestRow[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parseOptions = useMemo(
    () => ({ boardItems, catalogItems, formConfig }),
    [boardItems, catalogItems, formConfig]
  );

  if (!open) return null;

  function handleParseText(nextText: string) {
    setRawText(nextText);
    setFileError(null);
    const res = parseBulkOrderText(nextText, parseOptions);
    setParsedRows(res.rows);
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileError(null);
    setSourceFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const res = parseBulkOrderFileBuffer(buf, file.name, parseOptions);
      if (res.rows.length === 0) {
        setFileError("لم يتم العثور على صفوف أصناف صالحة داخل الملف.");
        setParsedRows([]);
        return;
      }
      setParsedRows(res.rows);
    } catch {
      setFileError("تعذر قراءة الملف — تأكد أن الصيغة CSV أو Excel (.xlsx)");
    }
  }

  function handleDownloadTemplate() {
    const wb = buildBulkImportTemplateWorkbook();
    const filename = buildTenantExportFilename({
      tenantSlug,
      module: "BulkOrderTemplate",
      ext: "xlsx",
    });
    const arr = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    void exportOrShareBinaryFile({
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: new Uint8Array(arr),
      title: filename,
    }).then((res) => {
      if (!res.ok) XLSX.writeFile(wb, filename);
    });
  }

  const validRows = parsedRows.filter((r) => !r.rowError);
  const warningCount = validRows.filter(
    (r) => r.needsPriceConfirmation || r.needsCustomUnitConfirmation
  ).length;
  const previewTotal = validRows.reduce((s, r) => s + r.lineTotal, 0);

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
      dir="rtl"
      data-testid="portal-bulk-import-modal"
    >
      <div className="card-surface w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl p-5 shadow-2xl border border-slate-200 dark:border-slate-700 space-y-4 text-xs">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-base font-black flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              <span>استيراد أصناف بالجملة إلى الطلب</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              الصق قائمة متعددة الأسطر (من واتساب أو إكسل) أو ارفع ملف CSV / Excel (.xlsx) مع معاينة وتأكيد الأسعار قبل الدمج.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              onChange={(e) => void handleUploadFile(e)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-extrabold inline-flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>رفع ملف CSV / Excel</span>
            </button>
            <button
              type="button"
              onClick={() => handleParseText(generateBulkImportSampleText())}
              className="px-3 py-1.5 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold inline-flex items-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>تعبئة مثال جاهز</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تحميل نموذج Excel</span>
            </button>
          </div>
          {sourceFileName && (
            <span className="text-[11px] text-slate-500 font-mono">الملف: {sourceFileName}</span>
          )}
        </div>

        <div>
          <label className="block font-bold mb-1">
            أو الصق الأصناف هنا (سطر لكل صنف: الصنف، الكمية، الوحدة، سعر الوحدة، ملاحظات)
          </label>
          <textarea
            rows={5}
            data-testid="portal-bulk-import-textarea"
            value={rawText}
            onChange={(e) => handleParseText(e.target.value)}
            placeholder={`مثال:\nقات صوطي درجة أولى, 5, علاقية قات, 4500\nقات نهمي, 3, كيس, 12000, فرز خاص`}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900 p-3 font-mono text-xs"
          />
        </div>

        {fileError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-200 font-bold">
            {fileError}
          </div>
        )}

        {parsedRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2 font-bold">
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  صفوف صالحة: {validRows.length}
                </span>
                {warningCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    تحتاج تأكيد سعر أو وحدة: {warningCount}
                  </span>
                )}
              </div>
              <div className="font-black text-emerald-700 dark:text-emerald-300">
                الإجمالي التقديري (= P × Q): {formatMoney(previewTotal)}
              </div>
            </div>

            <div className="overflow-x-auto max-h-60 border border-slate-200 dark:border-slate-700 rounded-xl">
              <table className="w-full text-xs text-right border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 border-b">
                    <th className="p-2">#</th>
                    <th className="p-2">الصنف</th>
                    <th className="p-2">الكمية</th>
                    <th className="p-2">الوحدة</th>
                    <th className="p-2">سعر الوحدة</th>
                    <th className="p-2">الإجمالي (P×Q)</th>
                    <th className="p-2">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {parsedRows.map((row) => (
                    <tr key={row.rowIndex} className={row.rowError ? "bg-rose-50/50 dark:bg-rose-950/20" : ""}>
                      <td className="p-2">{row.rowIndex}</td>
                      <td className="p-2 font-bold">
                        {row.itemTitle}
                        {row.matchedFromCatalog && (
                          <span className="mr-1.5 text-[10px] text-emerald-600">(مطابق)</span>
                        )}
                      </td>
                      <td className="p-2 font-mono">{row.requestedQty}</td>
                      <td className="p-2">
                        {row.unitCode === "OTHER" && row.needsCustomUnitConfirmation ? (
                          <input
                            type="text"
                            placeholder="اكتب الوحدة المخصصة..."
                            value={row.customUnitLabel}
                            onChange={(e) => {
                              const val = e.target.value;
                              setParsedRows((prev) =>
                                prev.map((x) =>
                                  x.rowIndex === row.rowIndex
                                    ? {
                                        ...x,
                                        customUnitLabel: val,
                                        displayUnitLabel: val || "أخرى",
                                        needsCustomUnitConfirmation: !val.trim(),
                                      }
                                    : x
                                )
                              );
                            }}
                            className="w-28 rounded-lg border border-amber-400 px-2 py-0.5 bg-white dark:bg-slate-900"
                          />
                        ) : (
                          row.displayUnitLabel
                        )}
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={row.unitPrice > 0 ? String(row.unitPrice) : ""}
                          placeholder="تأكيد السعر"
                          onChange={(e) => {
                            const p = Math.max(0, Number(e.target.value) || 0);
                            setParsedRows((prev) =>
                              prev.map((x) =>
                                x.rowIndex === row.rowIndex
                                  ? {
                                      ...x,
                                      unitPrice: p,
                                      lineTotal: computeSaleTotals(x.requestedQty, p, 0).totalAmount,
                                      needsPriceConfirmation: p <= 0,
                                    }
                                  : x
                              )
                            );
                          }}
                          className={`w-24 rounded-lg border px-2 py-0.5 font-mono bg-transparent ${
                            row.needsPriceConfirmation
                              ? "border-amber-400"
                              : "border-slate-300 dark:border-slate-700"
                          }`}
                        />
                      </td>
                      <td className="p-2 font-mono font-bold text-emerald-700 dark:text-emerald-300">
                        {row.lineTotal > 0 ? formatMoney(row.lineTotal) : "تقديري"}
                      </td>
                      <td className="p-2 text-[10px] font-bold">
                        {row.rowError ? (
                          <span className="text-rose-600">{row.rowError}</span>
                        ) : row.needsPriceConfirmation || row.needsCustomUnitConfirmation ? (
                          <span className="text-amber-600">تأكيد سعر / وحدة</span>
                        ) : (
                          <span className="text-emerald-600 inline-flex items-center gap-0.5">
                            <Check className="w-3 h-3" /> جاهز
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
          >
            إغلاق
          </button>
          <button
            type="button"
            disabled={validRows.length === 0}
            data-testid="portal-bulk-apply-merge"
            onClick={() => {
              onApplyRows(validRows, "merge");
              onClose();
            }}
            className="px-4 py-2 rounded-xl border border-emerald-500 text-emerald-700 dark:text-emerald-300 font-extrabold disabled:opacity-40"
          >
            دمج في الطلب ({validRows.length})
          </button>
          <button
            type="button"
            disabled={validRows.length === 0}
            data-testid="portal-bulk-apply-replace"
            onClick={() => {
              onApplyRows(validRows, "replace");
              onClose();
            }}
            className="px-4 py-2 rounded-xl accent-bg font-black disabled:opacity-40"
          >
            اعتماد واستبدال سطور الطلب ({validRows.length})
          </button>
        </div>
      </div>
    </div>
  );
}

interface QuickRepeatBasketPanelProps {
  items: QuickRepeatBasketItem[];
  onAddOne: (item: QuickRepeatBasketItem) => void;
  onAddAll: (items: QuickRepeatBasketItem[]) => void;
}

export function QuickRepeatBasketPanel({
  items,
  onAddOne,
  onAddAll,
}: QuickRepeatBasketPanelProps) {
  if (items.length === 0) {
    return (
      <div className="p-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-[11px] text-slate-500 text-center">
        ستظهر هنا أصنافك المتكررة تلقائياً بعد تسجيل طلباتك الأولى لتسريع إعادة الطلب بضغطة زر.
      </div>
    );
  }

  return (
    <div
      className="p-3.5 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-2.5"
      data-testid="portal-quick-repeat-basket"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-black text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
          <History className="w-4 h-4 text-indigo-600" />
          <span>سلة الأصناف المتكررة ({items.length})</span>
        </div>
        <button
          type="button"
          data-testid="portal-quick-repeat-fill-all"
          onClick={() => onAddAll(items)}
          className="px-3 py-1 rounded-xl bg-indigo-600 text-white font-extrabold text-[11px] inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          <span>تعبئة الأصناف المتكررة بالطلب</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => onAddOne(it)}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-right hover:border-emerald-400 transition flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="font-extrabold truncate">{it.itemTitle}</div>
              <div className="text-[10px] text-slate-500">
                {it.lastQty} {it.displayUnitLabel} • تكرر {it.orderCount}× •{" "}
                <bdi dir="ltr">{formatIsoToDmy(it.lastOrderedAt.slice(0, 10))}</bdi>
              </div>
              <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                {it.unitPrice > 0 ? formatMoney(it.unitPrice) : "تأكيد السعر عند المراجعة"}
              </div>
            </div>
            <span className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-black shrink-0">
              + إضافة
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Printer, X } from "lucide-react";
import {
  buildUasPrintHtml,
  printUasDocument,
  type PrintPaperFormat,
  type UasPrintDocumentSpec,
} from "@/lib/print/uasDocumentPrinter";

interface UasPrintLayoutProps {
  open: boolean;
  spec: UasPrintDocumentSpec | null;
  onClose: () => void;
}

const FORMAT_OPTIONS: Array<{ value: PrintPaperFormat; label: string }> = [
  { value: "A4_PORTRAIT", label: "A4 عمودي (Portrait)" },
  { value: "A4_LANDSCAPE", label: "A4 أفقي (Landscape)" },
  { value: "THERMAL_80MM", label: "80mm حراري (POS)" },
];

/**
 * Interactive pure light-mode print preview modal backed by `uasDocumentPrinter.ts`.
 * Lets the user inspect the exact letterhead, status watermark, and dual UAS footer
 * and switch between A4 Portrait / A4 Landscape / 80mm Thermal before printing or saving to PDF.
 */
export function UasPrintLayout({ open, spec, onClose }: UasPrintLayoutProps) {
  const [formatOverride, setFormatOverride] = useState<PrintPaperFormat | null>(null);
  const [printing, setPrinting] = useState(false);

  const effectiveSpec = useMemo<UasPrintDocumentSpec | null>(() => {
    if (!spec) return null;
    return { ...spec, format: formatOverride ?? spec.format ?? "A4_PORTRAIT" };
  }, [spec, formatOverride]);

  const previewHtml = useMemo(
    () => (effectiveSpec ? buildUasPrintHtml(effectiveSpec) : ""),
    [effectiveSpec]
  );

  if (!open || !effectiveSpec) return null;

  async function handlePrint() {
    if (!effectiveSpec) return;
    setPrinting(true);
    try {
      await printUasDocument(effectiveSpec);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full h-[90vh] flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <div className="text-sm font-black">{effectiveSpec.titleAr}</div>
            {effectiveSpec.titleEn && (
              <div className="text-[11px] text-slate-500">
                <bdi>{effectiveSpec.titleEn}</bdi>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={effectiveSpec.format}
              onChange={(e) => setFormatOverride(e.target.value as PrintPaperFormat)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-bold"
            >
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={printing}
              onClick={() => void handlePrint()}
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              <span>{printing ? "جاري التحضير..." : "طباعة / حفظ PDF"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl border border-slate-300 hover:bg-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-200 p-3 overflow-hidden">
          <iframe
            title="UAS Print Preview"
            srcDoc={previewHtml}
            className="w-full h-full bg-white rounded-xl shadow-md border border-slate-300"
          />
        </div>
      </div>
    </div>
  );
}

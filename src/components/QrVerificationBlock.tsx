"use client";

import { generateQrMatrix } from "@/lib/formulas";

export function QrVerificationBlock({ payload }: { payload: string }) {
  const { cells, codeHash } = generateQrMatrix(payload, 11);

  return (
    <div className="flex items-center justify-between p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 dark:bg-slate-800 mt-2 gap-3">
      <div className="text-xs space-y-1 min-w-0">
        <div className="font-extrabold text-emerald-800 dark:text-emerald-300">
          ✅ سند موثق رقمياً بتقنية QR
        </div>
        <div className="text-slate-500">
          معرف التحقق الفوري: <span className="font-mono font-bold">{codeHash}</span>
        </div>
        <div className="text-[11px] text-slate-400 break-all">{payload}</div>
      </div>
      <svg
        width="74"
        height="74"
        viewBox="0 0 74 74"
        className="bg-white p-1 rounded-lg border border-slate-200 shrink-0"
      >
        {cells.map((cell, idx) => (
          <rect
            key={idx}
            x={cell.c * 6 + 4}
            y={cell.r * 6 + 4}
            width="5"
            height="5"
            fill="#065f46"
            rx="1"
          />
        ))}
      </svg>
    </div>
  );
}


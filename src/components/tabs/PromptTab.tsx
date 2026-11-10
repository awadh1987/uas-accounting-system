"use client";

import { masterAgentPromptText } from "@/lib/agentPrompt";

export function PromptTab({ onToast }: { onToast: (msg: string) => void }) {
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(masterAgentPromptText);
      onToast("تم نسخ أمر وكيل البرمجة إلى الحافظة");
    } catch {
      onToast("يرجى النسخ يدوياً");
    }
  }

  return (
    <section className="space-y-4">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-extrabold">
              أمر وكيل البرمجة لبناء النظام الكامل (Coding Agent Master Prompt)
            </h3>
            <p className="text-xs text-slate-500">
              انسخ هذا الوصف الهندسي الشامل وألصقه في وكيل البرمجة (Cursor / Claude Code / Copilot / Windsurf) لبناء نسخة الإنتاج الكاملة
            </p>
          </div>
          <button onClick={copyPrompt} className="px-4 py-2 rounded-xl accent-bg text-xs font-bold shadow">
            📋 نسخ أمر وكيل البرمجة (Copy Prompt)
          </button>
        </div>
        <textarea
          readOnly
          rows={20}
          dir="ltr"
          value={masterAgentPromptText}
          className="w-full rounded-xl border border-slate-300 bg-slate-950 text-emerald-400 font-mono text-xs p-4 leading-relaxed"
        />
      </div>
    </section>
  );
}


"use client";

import { useState } from "react";
import { FileClock } from "lucide-react";
import { notifyDraftsChanged } from "@/hooks/useFormDraft";

export interface SaveDraftButtonProps {
  module: string;
  formType: string;
  getTitleAr: () => string;
  getPayload: () => Record<string, unknown>;
  getTotalAmount?: () => number | null;
  currencyCode?: string;
  entityId?: string | null;
  actor?: { userId?: string; userDisplay?: string; userRole?: string };
  onToast?: (msg: string) => void;
  onSaved?: (draftId: string) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

/**
 * Reusable "حفظ كمسودة (Save as Draft)" button wired beside every primary
 * "حفظ / ترحيل" button across all UAS forms & subforms.
 */
export function SaveDraftButton({
  module,
  formType,
  getTitleAr,
  getPayload,
  getTotalAmount,
  currencyCode = "YER",
  entityId = null,
  actor,
  onToast,
  onSaved,
  disabled,
  className = "",
  label = "حفظ كمسودة",
}: SaveDraftButtonProps) {
  const [saving, setSaving] = useState(false);

  async function handleClick() {
    setSaving(true);
    try {
      const payload = getPayload();
      const titleAr =
        (getTitleAr() || "").trim() ||
        `مسودة ${formType} (${new Date().toISOString().slice(0, 10)})`;
      const totalAmount = getTotalAmount ? getTotalAmount() : null;

      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module,
          formType,
          entityId,
          titleAr,
          titleEn: titleAr,
          payload,
          totalAmount,
          currencyCode,
          visibility: "SHARED_WORKSPACE",
          actor,
        }),
      });
      const data = (await res.json()) as { draft?: { id: string; draftNumber: string }; error?: string };
      if (!res.ok || !data.draft) {
        onToast?.(data.error || "تعذر حفظ المسودة");
        return;
      }
      notifyDraftsChanged();
      onSaved?.(data.draft.id);
      onToast?.(`💾 تم حفظ المسودة ${data.draft.draftNumber} في مركز المسودات المشتركة`);
    } catch {
      onToast?.("تعذر حفظ المسودة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || saving}
      onClick={() => void handleClick()}
      className={`px-3.5 py-2 rounded-xl border border-amber-500/70 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 hover:bg-amber-100/80 text-xs font-extrabold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition ${className}`}
    >
      <FileClock className="w-3.5 h-3.5" />
      <span>{saving ? "جاري الحفظ..." : label}</span>
    </button>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

export const DRAFTS_CHANGED_EVENT = "uas:drafts-changed";
export const RESUME_DRAFT_EVENT = "uas:resume-draft";
export const PENDING_RESUME_DRAFT_KEY = "uas_pending_resume_draft";

export interface WorkspaceDraftItem {
  id: string;
  draftNumber: string;
  module: string;
  formType: string;
  entityId?: string | null;
  titleAr: string;
  titleEn: string;
  payload: Record<string, unknown>;
  totalAmount?: number | null;
  currencyCode: string;
  visibility: "SHARED_WORKSPACE" | "PRIVATE";
  status: string;
  convertedEntityId?: string | null;
  createdById: string;
  createdByName: string;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UseFormDraftOptions<TState extends Record<string, unknown>> {
  module: string;
  formType: string;
  getFormState: () => TState;
  setFormState?: (state: TState, draft: WorkspaceDraftItem) => void;
  getTitleAr?: () => string;
  getTotalAmount?: () => number | null;
  currencyCode?: string;
  entityId?: string | null;
  actor?: { userId?: string; userDisplay?: string; userRole?: string };
  onToast?: (msg: string) => void;
}

export function notifyDraftsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DRAFTS_CHANGED_EVENT));
  }
}

export function dispatchResumeDraft(draft: WorkspaceDraftItem) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_RESUME_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore storage quota errors */
  }
  window.dispatchEvent(new CustomEvent(RESUME_DRAFT_EVENT, { detail: draft }));
}

export function useFormDraft<TState extends Record<string, unknown>>({
  module,
  formType,
  getFormState,
  setFormState,
  getTitleAr,
  getTotalAmount,
  currencyCode = "YER",
  entityId = null,
  actor,
  onToast,
}: UseFormDraftOptions<TState>) {
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  // Listen for one-click resume from Shared Drafts Center
  useEffect(() => {
    if (!setFormState || typeof window === "undefined") return;

    const tryApply = (draft: WorkspaceDraftItem | null) => {
      if (!draft) return;
      if (
        draft.module.toUpperCase() === module.toUpperCase() &&
        draft.formType.toUpperCase() === formType.toUpperCase()
      ) {
        setActiveDraftId(draft.id);
        setFormState((draft.payload || {}) as TState, draft);
        try {
          sessionStorage.removeItem(PENDING_RESUME_DRAFT_KEY);
        } catch {
          /* ignore */
        }
        onToast?.(`📝 تم استعادة المسودة ${draft.draftNumber} للاستكمال`);
      }
    };

    // Check sessionStorage on mount (when tab was just switched)
    try {
      const raw = sessionStorage.getItem(PENDING_RESUME_DRAFT_KEY);
      if (raw) tryApply(JSON.parse(raw) as WorkspaceDraftItem);
    } catch {
      /* ignore */
    }

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<WorkspaceDraftItem>).detail;
      tryApply(detail);
    };
    window.addEventListener(RESUME_DRAFT_EVENT, handler);
    return () => window.removeEventListener(RESUME_DRAFT_EVENT, handler);
  }, [module, formType, setFormState, onToast]);

  const saveDraft = useCallback(
    async (visibility: "SHARED_WORKSPACE" | "PRIVATE" = "SHARED_WORKSPACE") => {
      setSavingDraft(true);
      try {
        const payload = getFormState();
        const titleAr =
          (getTitleAr?.() || "").trim() ||
          `مسودة ${formType} (${new Date().toISOString().slice(0, 10)})`;
        const totalAmount = getTotalAmount ? getTotalAmount() : null;

        const isUpdate = Boolean(activeDraftId);
        const url = isUpdate ? `/api/drafts/${encodeURIComponent(activeDraftId!)}` : "/api/drafts";
        const res = await fetch(url, {
          method: isUpdate ? "PATCH" : "POST",
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
            visibility,
            actor,
          }),
        });
        const data = (await res.json()) as { draft?: WorkspaceDraftItem; error?: string };
        if (!res.ok || !data.draft) {
          onToast?.(data.error || "تعذر حفظ المسودة");
          return null;
        }
        setActiveDraftId(data.draft.id);
        notifyDraftsChanged();
        onToast?.(`💾 تم حفظ المسودة (${data.draft.draftNumber}) — متاحة للاستكمال دون ترحيل`);
        return data.draft;
      } catch {
        onToast?.("تعذر الاتصال بالخادم لحفظ المسودة");
        return null;
      } finally {
        setSavingDraft(false);
      }
    },
    [
      activeDraftId,
      actor,
      currencyCode,
      entityId,
      formType,
      getFormState,
      getTitleAr,
      getTotalAmount,
      module,
      onToast,
    ]
  );

  const clearActiveDraft = useCallback(() => setActiveDraftId(null), []);

  return { activeDraftId, savingDraft, saveDraft, clearActiveDraft };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileClock, Play, RefreshCw, Trash2, X } from "lucide-react";
import {
  DRAFTS_CHANGED_EVENT,
  dispatchResumeDraft,
  notifyDraftsChanged,
  type WorkspaceDraftItem,
} from "@/hooks/useFormDraft";
import { fmtNum } from "@/lib/formulas";
import type { TabId, UasUser } from "@/types/uas";

interface SharedDraftsCenterDrawerProps {
  open: boolean;
  onClose: () => void;
  currentUser: UasUser;
  onNavigateTab: (tab: TabId) => void;
  onToast: (msg: string) => void;
}

const MODULE_TO_TAB: Record<string, TabId> = {
  ACCOUNTING: "ledger",
  SALES: "sales",
  PROCUREMENT: "procurement",
  TREASURY: "treasury",
  INVENTORY: "inventory",
  PROJECTS: "projects",
  WORKERS: "workers",
  SYSTEM: "system",
};

const MODULE_LABELS: Record<string, string> = {
  ALL: "كافة الوحدات / All",
  ACCOUNTING: "المحاسبة والقيود",
  SALES: "المبيعات والعملاء",
  PROCUREMENT: "المشتريات والموردون",
  TREASURY: "الخزينة والسندات",
  INVENTORY: "المخزون والأصناف",
  PROJECTS: "المشاريع",
  WORKERS: "العمال والأجور",
  SYSTEM: "النظام",
};

export function SharedDraftsCenterDrawer({
  open,
  onClose,
  currentUser,
  onNavigateTab,
  onToast,
}: SharedDraftsCenterDrawerProps) {
  const [drafts, setDrafts] = useState<WorkspaceDraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [moduleFilter, setModuleFilter] = useState("ALL");
  const [creatorFilter, setCreatorFilter] = useState("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (moduleFilter !== "ALL") qs.set("module", moduleFilter);
      qs.set("userId", currentUser.id);
      qs.set("userRole", currentUser.role);
      const res = await fetch(`/api/drafts?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { drafts?: WorkspaceDraftItem[] };
      setDrafts(data.drafts || []);
    } finally {
      setLoading(false);
    }
  }, [moduleFilter, currentUser.id, currentUser.role]);

  useEffect(() => {
    if (open) void loadDrafts();
  }, [open, loadDrafts]);

  useEffect(() => {
    const handler = () => {
      if (open) void loadDrafts();
    };
    window.addEventListener(DRAFTS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, handler);
  }, [open, loadDrafts]);

  async function handlePromote(draft: WorkspaceDraftItem) {
    setBusyId(draft.id);
    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draft.id)}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        onToast(data.error || "تعذر ترحيل المسودة");
        return;
      }
      onToast(`✅ تم تحويل وترحيل المسودة ${draft.draftNumber} بنجاح`);
      notifyDraftsChanged();
      await loadDrafts();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscard(draft: WorkspaceDraftItem) {
    setBusyId(draft.id);
    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });
      if (!res.ok) {
        onToast("تعذر حذف المسودة");
        return;
      }
      onToast(`🗑️ تم استبعاد المسودة ${draft.draftNumber}`);
      notifyDraftsChanged();
      await loadDrafts();
    } finally {
      setBusyId(null);
    }
  }

  function handleResume(draft: WorkspaceDraftItem) {
    const targetTab = MODULE_TO_TAB[draft.module] || "ledger";
    onNavigateTab(targetTab);
    setTimeout(() => dispatchResumeDraft(draft), 120);
    onClose();
  }

  if (!open) return null;

  const creators = Array.from(new Set(drafts.map((d) => d.createdByName).filter(Boolean)));
  const visibleDrafts = drafts.filter(
    (d) => creatorFilter === "ALL" || d.createdByName === creatorFilter
  );

  return (
    <div className="fixed inset-0 z-[85] bg-slate-950/70 backdrop-blur-sm flex justify-end" dir="rtl">
      <div className="card-surface w-full max-w-xl h-full overflow-y-auto p-5 shadow-2xl border-r border-slate-200 dark:border-slate-800 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 flex items-center justify-center">
              <FileClock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">مركز المسودات المشتركة (Shared Drafts Center)</h3>
              <p className="text-[11px] text-slate-500">
                استكمال، مراجعة، أو ترحيل المسودات المحفوظة عبر كافة النماذج دون التأثير على الأستاذ العام
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2 font-bold"
          >
            {Object.entries(MODULE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={creatorFilter}
            onChange={(e) => setCreatorFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-2 font-bold"
          >
            <option value="ALL">كافة المستخدمين</option>
            {creators.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadDrafts()}
            className="rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 font-bold inline-flex items-center justify-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>تحديث ({visibleDrafts.length})</span>
          </button>
        </div>

        {/* Drafts List */}
        {loading && <div className="py-8 text-center text-xs text-slate-500">جاري تحميل المسودات...</div>}

        {!loading && visibleDrafts.length === 0 && (
          <div className="py-12 text-center text-xs text-slate-500 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
            لا توجد مسودات نشطة حالياً في مساحة العمل.
          </div>
        )}

        <div className="space-y-2.5">
          {visibleDrafts.map((d) => (
            <div
              key={d.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2 bg-slate-50/50 dark:bg-slate-900/40 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-black text-amber-700 dark:text-amber-300">
                      {d.draftNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-800">
                      {MODULE_LABELS[d.module] || d.module} • {d.formType}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      {d.visibility === "PRIVATE" ? "خاصة" : "مشتركة"}
                    </span>
                  </div>
                  <div className="font-extrabold text-sm mt-1">{d.titleAr}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    أنشأها: {d.createdByName} • آخر تحديث: {String(d.updatedAt).slice(0, 16).replace("T", " ")}
                  </div>
                </div>
                {d.totalAmount !== null && d.totalAmount !== undefined && (
                  <div className="font-mono font-black text-sm tabular-nums shrink-0">
                    {fmtNum(d.totalAmount)} {d.currencyCode}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => handleResume(d)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold inline-flex items-center gap-1"
                >
                  <Play className="w-3 h-3" />
                  <span>استكمال التعديل</span>
                </button>
                <button
                  type="button"
                  disabled={busyId === d.id}
                  onClick={() => void handlePromote(d)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>اعتماد وترحيل</span>
                </button>
                <button
                  type="button"
                  disabled={busyId === d.id}
                  onClick={() => void handleDiscard(d)}
                  className="px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-600 font-bold inline-flex items-center gap-1 mr-auto disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>استبعاد</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CornerUpLeft,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { UasUser } from "@/types/uas";
import { notifyDraftsChanged } from "@/hooks/useFormDraft";

export const APPROVALS_CHANGED_EVENT = "uas:approvals-changed";

export function notifyApprovalsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(APPROVALS_CHANGED_EVENT));
  }
}

interface ApprovalDiff {
  field: string;
  before: unknown;
  after: unknown;
}

interface ApprovalRequestItem {
  id: string;
  requestNumber: string;
  module: string;
  actionType: string;
  targetType: string;
  targetId: string;
  documentNumber: string;
  summaryAr: string;
  summaryEn: string;
  amountBase: number;
  currencyCode: string;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot?: Record<string, unknown>;
  diffs?: ApprovalDiff[];
  reasonAr?: string | null;
  status: string;
  requestedById: string;
  requestedByName: string;
  reviewedByName?: string | null;
  reviewNotes?: string | null;
  createdAt: string;
}

interface ApprovalsCenterProps {
  open: boolean;
  onClose: () => void;
  currentUser: UasUser;
  onToast: (msg: string) => void;
}

const ACTION_LABELS: Record<string, string> = {
  CREATE_AND_POST: "إنشاء وترحيل مستند",
  GL_POSTING: "ترحيل قيد يومية",
  AMEND_POSTED_RECORD: "تعديل بعد الترحيل (Amendment)",
  VOID_RECORD: "إلغاء / عكس مستند",
  HIGH_VALUE_TRANSACTION: "عملية عالية القيمة",
  FISCAL_YEAR_CLOSE: "إقفال سنة مالية",
};

export function ApprovalsCenter({
  open,
  onClose,
  currentUser,
  onToast,
}: ApprovalsCenterProps) {
  const [requests, setRequests] = useState<ApprovalRequestItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [loading, setLoading] = useState(false);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "ALL") qs.set("status", statusFilter);
      const res = await fetch(`/api/approvals?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { requests?: ApprovalRequestItem[] };
      setRequests(data.requests || []);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (open) void loadRequests();
  }, [open, loadRequests]);

  async function handleDecide(
    reqItem: ApprovalRequestItem,
    decision: "APPROVED" | "REJECTED" | "RETURNED_FOR_EDIT"
  ) {
    setBusyId(reqItem.id);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(reqItem.id)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reviewNotes: notesById[reqItem.id] || undefined,
          actor: {
            userId: currentUser.id,
            userDisplay: currentUser.name,
            userRole: currentUser.role,
          },
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        onToast(data.error || "تعذر تنفيذ قرار الاعتماد");
        return;
      }
      const msg =
        decision === "APPROVED"
          ? `✅ تم اعتماد وترحيل الطلب ${reqItem.requestNumber}`
          : decision === "RETURNED_FOR_EDIT"
          ? `↩️ تم إعادة الطلب ${reqItem.requestNumber} إلى المسودات للتعديل`
          : `✖ تم رفض الطلب ${reqItem.requestNumber}`;
      onToast(msg);
      notifyApprovalsChanged();
      if (decision === "RETURNED_FOR_EDIT") notifyDraftsChanged();
      await loadRequests();
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[88] bg-slate-950/75 backdrop-blur-sm flex justify-end" dir="rtl">
      <div className="card-surface w-full max-w-2xl h-full overflow-y-auto p-5 shadow-2xl border-r border-slate-200 dark:border-slate-800 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black">مركز الاعتمادات والمراجعة (Approvals &amp; Amendments Center)</h3>
              <p className="text-[11px] text-slate-500">
                مراجعة طلبات الترحيل والتعديلات بعد الترحيل بمقارنة قبل/بعد (Before/After Diff) وسجل تدقيق غير قابل للتعديل
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

        {/* Status Filter Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "PENDING", label: "بانتظار الاعتماد" },
              { id: "APPROVED", label: "معتمد" },
              { id: "RETURNED_FOR_EDIT", label: "معاد للتعديل" },
              { id: "REJECTED", label: "مرفوض" },
              { id: "ALL", label: "الكل" },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setStatusFilter(t.id)}
                className={`px-3 py-1.5 rounded-xl font-bold border ${
                  statusFilter === t.id
                    ? "accent-bg border-transparent"
                    : "border-slate-300 dark:border-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadRequests()}
            className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-bold inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>تحديث</span>
          </button>
        </div>

        {loading && <div className="py-10 text-center text-xs text-slate-500">جاري تحميل طلبات الاعتماد...</div>}

        {!loading && requests.length === 0 && (
          <div className="py-12 text-center text-xs text-slate-500 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
            لا توجد طلبات اعتماد في هذه الفئة.
          </div>
        )}

        <div className="space-y-3">
          {requests.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/50 dark:bg-slate-900/40 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-black text-indigo-700 dark:text-indigo-300">
                      {r.requestNumber}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-800">
                      {ACTION_LABELS[r.actionType] || r.actionType}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      {r.documentNumber}
                    </span>
                  </div>
                  <div className="font-extrabold text-sm mt-1">{r.summaryAr}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    مقدم الطلب: {r.requestedByName} • {String(r.createdAt).slice(0, 16).replace("T", " ")}
                  </div>
                  {r.reasonAr && (
                    <div className="text-[11px] text-amber-800 dark:text-amber-300 mt-1 font-semibold">
                      سبب التعديل: {r.reasonAr}
                    </div>
                  )}
                </div>
                <div className="font-mono font-black text-sm tabular-nums shrink-0">
                  {fmtNum(r.amountBase)} {r.currencyCode}
                </div>
              </div>

              {/* Side-by-Side Before / After Diff */}
              {r.diffs && r.diffs.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <table className="w-full text-[11px] text-right">
                    <thead className="bg-slate-100 dark:bg-slate-800 font-bold">
                      <tr>
                        <th className="px-2.5 py-1.5">الحقل / Field</th>
                        <th className="px-2.5 py-1.5 text-rose-700 dark:text-rose-300">قبل التعديل (Before)</th>
                        <th className="px-2.5 py-1.5 text-emerald-700 dark:text-emerald-300">بعد التعديل (After)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.diffs.map((d) => (
                        <tr key={d.field} className="border-t border-slate-200 dark:border-slate-800">
                          <td className="px-2.5 py-1 font-mono font-bold">{d.field}</td>
                          <td className="px-2.5 py-1 text-rose-700 dark:text-rose-300 bg-rose-50/40 dark:bg-rose-950/20">
                            {typeof d.before === "object" ? JSON.stringify(d.before) : String(d.before ?? "—")}
                          </td>
                          <td className="px-2.5 py-1 text-emerald-700 dark:text-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20 font-bold">
                            {typeof d.after === "object" ? JSON.stringify(d.after) : String(d.after ?? "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {r.status === "PENDING" ? (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <input
                    value={notesById[r.id] || ""}
                    onChange={(e) => setNotesById((p) => ({ ...p, [r.id]: e.target.value }))}
                    placeholder="ملاحظات المراجع / سبب القرار (اختياري)..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 py-1.5 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void handleDecide(r, "APPROVED")}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>اعتماد وترحيل (Approve &amp; Post)</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void handleDecide(r, "RETURNED_FOR_EDIT")}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      <span>إعادة للتعديل (Return to Draft)</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void handleDecide(r, "REJECTED")}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold inline-flex items-center gap-1 mr-auto disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>رفض (Reject)</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-800">
                  الحالة: <strong>{r.status}</strong> {r.reviewedByName ? `• بواسطة ${r.reviewedByName}` : ""}{" "}
                  {r.reviewNotes ? `• ملاحظة: ${r.reviewNotes}` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

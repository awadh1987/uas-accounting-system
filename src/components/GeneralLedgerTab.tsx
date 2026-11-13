"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Pencil, Plus, RotateCcw, Search, Trash2, AlertTriangle } from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { UasProject, UasUser } from "@/types/uas";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { EmptyState } from "@/components/EmptyState";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";

interface AccountOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  isPosting: boolean;
  type: string;
}

interface JournalLineRecord {
  id: string;
  accountId: string;
  account: { id: string; code: string; nameAr: string; nameEn: string; type: string };
  debit: number;
  credit: number;
  currency: string;
  exchangeRate: number;
  debitBase: number;
  creditBase: number;
  memo: string | null;
  projectId?: string | null;
  project?: { id: string; code: string; nameAr: string } | null;
  subProjectId?: string | null;
  subProject?: { id: string; code: string; nameAr: string } | null;
}

interface JournalEntryRecord {
  id: string;
  entryNumber: string;
  date: string;
  reference: string | null;
  narrationAr: string;
  status: string;
  sourceType: string | null;
  projectId?: string | null;
  project?: { id: string; code: string; nameAr: string } | null;
  subProjectId?: string | null;
  subProject?: { id: string; code: string; nameAr: string } | null;
  createdBy: { id: string; name: string; role: string };
  attachments: Array<{ id: string; fileName: string; fileUrl: string }>;
  totalDebitBase: number;
  totalCreditBase: number;
  isBalanced: boolean;
  lines: JournalLineRecord[];
}

interface DraftLine {
  accountId: string;
  debit: string;
  credit: string;
  currency: string;
  memo: string;
  projectId: string;
  subProjectId: string;
}

interface GeneralLedgerTabProps {
  projects: UasProject[];
  currentUser: UasUser;
  exchangeRates: Record<string, number>;
  selectedProjectId: string;
  selectedSubProjectId?: string;
  readOnly?: boolean;
  canPost?: boolean;
  canEditDate?: boolean;
  onToast: (msg: string) => void;
}

export function GeneralLedgerTab({
  projects,
  currentUser,
  exchangeRates,
  selectedProjectId,
  selectedSubProjectId = "ALL",
  readOnly = false,
  canPost = true,
  canEditDate = false,
  onToast,
}: GeneralLedgerTabProps) {
  const [entries, setEntries] = useState<JournalEntryRecord[]>([]);
  const [postingAccounts, setPostingAccounts] = useState<AccountOption[]>([]);
  const [summary, setSummary] = useState({ count: 0, totalDebitBase: 0, totalCreditBase: 0, isLedgerBalanced: true });
  const [loading, setLoading] = useState(true);

  const [filterAccountId, setFilterAccountId] = useState("ALL");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [search, setSearch] = useState("");

  // New / Edit Journal Entry Form
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [narrationAr, setNarrationAr] = useState("");
  const [headerProjectId, setHeaderProjectId] = useState(projects[0]?.id || "");
  const [headerSubProjectId, setHeaderSubProjectId] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [quickCoaOpen, setQuickCoaOpen] = useState(false);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { accountId: "", debit: "10000", credit: "0", currency: "YER", memo: "", projectId: projects[0]?.id || "", subProjectId: "" },
    { accountId: "", debit: "0", credit: "10000", currency: "YER", memo: "", projectId: projects[0]?.id || "", subProjectId: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const fetchJournalAndCoa = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedProjectId && selectedProjectId !== "ALL") params.set("projectId", selectedProjectId);
    if (selectedSubProjectId && selectedSubProjectId !== "ALL") params.set("subProjectId", selectedSubProjectId);
    if (filterAccountId !== "ALL") params.set("accountId", filterAccountId);
    if (filterFrom) params.set("fromDate", filterFrom);
    if (filterTo) params.set("toDate", filterTo);
    if (search.trim()) params.set("search", search.trim());

    const [journalRes, coaRes] = await Promise.all([
      fetch(`/api/accounting/journal?${params.toString()}`, { cache: "no-store" }),
      fetch("/api/accounting/coa", { cache: "no-store" }),
    ]);
    return {
      jData: journalRes.ok
        ? ((await journalRes.json()) as {
            entries: JournalEntryRecord[];
            summary: { count: number; totalDebitBase: number; totalCreditBase: number; isLedgerBalanced: boolean };
          })
        : null,
      cData: coaRes.ok ? ((await coaRes.json()) as { flat: AccountOption[] }) : null,
    };
  }, [selectedProjectId, selectedSubProjectId, filterAccountId, filterFrom, filterTo, search]);

  const applyJournalAndCoa = useCallback(
    (res: {
      jData: {
        entries: JournalEntryRecord[];
        summary: { count: number; totalDebitBase: number; totalCreditBase: number; isLedgerBalanced: boolean };
      } | null;
      cData: { flat: AccountOption[] } | null;
    }) => {
      if (res.jData) {
        setEntries(res.jData.entries || []);
        setSummary(res.jData.summary || { count: 0, totalDebitBase: 0, totalCreditBase: 0, isLedgerBalanced: true });
      }
      if (res.cData) {
        const posting = (res.cData.flat || []).filter((a) => a.isPosting);
        setPostingAccounts(posting);
        setDraftLines((prev) =>
          prev.map((l, idx) =>
            l.accountId
              ? l
              : { ...l, accountId: posting[idx === 0 ? 0 : Math.min(1, posting.length - 1)]?.id || "" }
          )
        );
      }
    },
    []
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchJournalAndCoa();
      applyJournalAndCoa(res);
    } catch {
      onToast("تعذر تحميل قيود دفتر اليومية العام");
    } finally {
      setLoading(false);
    }
  }, [fetchJournalAndCoa, applyJournalAndCoa, onToast]);

  useEffect(() => {
    let active = true;
    fetchJournalAndCoa()
      .then((res) => {
        if (!active) return;
        applyJournalAndCoa(res);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        onToast("تعذر تحميل قيود دفتر اليومية العام");
      });
    return () => {
      active = false;
    };
  }, [fetchJournalAndCoa, applyJournalAndCoa, onToast]);

  const totals = useMemo(() => {
    let drBase = 0;
    let crBase = 0;
    for (const l of draftLines) {
      const rate = exchangeRates[l.currency] || 1;
      drBase += (Number(l.debit) || 0) * rate;
      crBase += (Number(l.credit) || 0) * rate;
    }
    const diff = Math.round((drBase - crBase) * 100) / 100;
    return { drBase, crBase, diff, balanced: Math.abs(diff) <= 0.005 && drBase > 0 };
  }, [draftLines, exchangeRates]);

  function openCreateEntry() {
    setEditingEntryId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setReference("");
    setNarrationAr("");
    setHeaderProjectId(projects[0]?.id || "");
    setHeaderSubProjectId("");
    setAttachmentName("");
    setDraftLines([
      {
        accountId: postingAccounts[0]?.id || "",
        debit: "10000",
        credit: "0",
        currency: "YER",
        memo: "",
        projectId: projects[0]?.id || "",
        subProjectId: "",
      },
      {
        accountId: postingAccounts[Math.min(1, postingAccounts.length - 1)]?.id || "",
        debit: "0",
        credit: "10000",
        currency: "YER",
        memo: "",
        projectId: projects[0]?.id || "",
        subProjectId: "",
      },
    ]);
    setShowBuilder(true);
  }

  function openEditEntry(je: JournalEntryRecord) {
    setEditingEntryId(je.id);
    setDate(je.date.slice(0, 10));
    setReference(je.reference || "");
    setNarrationAr(je.narrationAr);
    setHeaderProjectId(je.projectId || je.project?.id || "");
    setHeaderSubProjectId(je.subProjectId || je.subProject?.id || "");
    setAttachmentName("");
    setDraftLines(
      je.lines.map((l) => ({
        accountId: l.accountId,
        debit: String(l.debit || 0),
        credit: String(l.credit || 0),
        currency: l.currency || "YER",
        memo: l.memo || "",
        projectId: l.projectId || l.project?.id || je.projectId || je.project?.id || "",
        subProjectId: l.subProjectId || l.subProject?.id || je.subProjectId || je.subProject?.id || "",
      }))
    );
    setShowBuilder(true);
  }

  async function handlePostJournal(e: React.FormEvent) {
    e.preventDefault();
    if (!totals.balanced) {
      onToast("❌ لا يمكن الترحيل: إجمالي المدين يجب أن يساوي إجمالي الدائن تماماً!");
      return;
    }
    if (!narrationAr.trim()) {
      onToast("يرجى إدخال البيان المحاسبي للقيد");
      return;
    }
    setSubmitting(true);
    try {
      const isEdit = Boolean(editingEntryId);
      const res = await fetch("/api/accounting/journal", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEdit ? { id: editingEntryId } : {}),
          date,
          reference: reference.trim() || undefined,
          narrationAr: narrationAr.trim(),
          projectId: headerProjectId || (selectedProjectId !== "ALL" ? selectedProjectId : draftLines[0]?.projectId || null),
          subProjectId: headerSubProjectId || (selectedSubProjectId !== "ALL" ? selectedSubProjectId : draftLines[0]?.subProjectId || null),
          actor: {
            userId: currentUser.id,
            userDisplay: `${currentUser.name} (${currentUser.role})`,
            userRole: currentUser.role,
          },
          lines: draftLines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            currency: l.currency,
            exchangeRate: exchangeRates[l.currency] || 1,
            memo: l.memo.trim() || narrationAr.trim(),
            projectId: l.projectId || headerProjectId || null,
            subProjectId: l.subProjectId || headerSubProjectId || null,
          })),
          ...(!isEdit && attachmentName.trim()
            ? {
                attachments: [
                  { fileName: attachmentName.trim(), fileUrl: `/attachments/${attachmentName.trim()}`, fileType: "application/pdf" },
                ],
              }
            : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        onToast(data.error || (isEdit ? "تعذر تعديل القيد" : "فشل ترحيل القيد"));
        return;
      }
      onToast(
        isEdit
          ? "✅ تم تعديل القيد المحاسبي وإعادة احتساب الأرصدة وتوثيق التغيير"
          : "✅ تم ترحيل قيد اليومية المزدوج وتحديث الأرصدة بنجاح"
      );
      setEditingEntryId(null);
      setNarrationAr("");
      setReference("");
      setAttachmentName("");
      setShowBuilder(false);
      await loadData();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReverse(entryId: string, entryNumber: string) {
    const res = await fetch("/api/accounting/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "REVERSE",
        journalEntryId: entryId,
        reason: `عكس القيد ${entryNumber} بناءً على مراجعة المحاسب`,
        actor: {
          userId: currentUser.id,
          userDisplay: `${currentUser.name} (${currentUser.role})`,
          userRole: currentUser.role,
        },
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر عكس القيد");
      return;
    }
    onToast(`✅ تم إنشاء قيد عكسي وإلغاء أثر القيد ${entryNumber} دون مساس بسجل التاريخ`);
    await loadData();
  }

  return (
    <section className="space-y-5">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">
                دفتر اليومية العام وقيد اليومية المزدوج (General Ledger)
              </h2>
              <p className="text-xs text-slate-500">
                قيود محاسبية غير قابلة للحذف أو التعديل بعد الترحيل — الإلغاء يتم عبر قيود عكسية فقط.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 ${
                summary.isLedgerBalanced
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}
            >
              {summary.isLedgerBalanced ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              <span>
                Σ مدين: {fmtNum(summary.totalDebitBase)} | Σ دائن: {fmtNum(summary.totalCreditBase)}
              </span>
            </span>

            {canPost && !readOnly && (
              <button
                type="button"
                onClick={openCreateEntry}
                className="px-4 py-2 rounded-xl accent-bg text-xs font-extrabold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>قيد يومية جديد</span>
              </button>
            )}
          </div>
        </div>

        {/* Interactive Journal Entry Builder in SlideOverDrawer */}
        <SlideOverDrawer
          open={showBuilder && canPost && !readOnly}
          onClose={() => {
            setEditingEntryId(null);
            setShowBuilder(false);
          }}
          title={editingEntryId ? "تعديل قيد يومية محاسبي" : "إنشاء قيد يومية محاسبي جديد"}
          subtitle="القيد المزدوج المتوازن — يجب تساوي إجمالي المدين والدائن بالعملة الأساسية (YER)"
          size="xl"
        >
          <form
            onSubmit={handlePostJournal}
            className="space-y-4 text-xs"
          >
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-semibold mb-1">
                  التاريخ{" "}
                  {editingEntryId && !canEditDate && (
                    <span className="text-[10px] text-amber-600">(مقفل حسب الصلاحية)</span>
                  )}
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={Boolean(editingEntryId) && !canEditDate}
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">المرجع (Reference)</label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="DOC-2026-..."
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">المشروع العام للقيد</label>
                <select
                  value={headerProjectId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setHeaderProjectId(pid);
                    setHeaderSubProjectId("");
                    setDraftLines((prev) =>
                      prev.map((l) => (!l.projectId ? { ...l, projectId: pid } : l))
                    );
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                >
                  <option value="">عام / بدون مشروع</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">القطاع الفرعي العام للقيد</label>
                <select
                  value={headerSubProjectId}
                  onChange={(e) => {
                    const spid = e.target.value;
                    setHeaderSubProjectId(spid);
                    setDraftLines((prev) =>
                      prev.map((l) => (!l.subProjectId ? { ...l, subProjectId: spid } : l))
                    );
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                >
                  <option value="">بدون قطاع فرعي</option>
                  {(projects.find((p) => p.id === headerProjectId)?.subProjects || []).map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-4">
                <label className="block font-semibold mb-1">البيان المحاسبي العام *</label>
                <input
                  type="text"
                  value={narrationAr}
                  onChange={(e) => setNarrationAr(e.target.value)}
                  required
                  placeholder="مثال: تحويل نقدي من الصندوق إلى بنك الكريمي..."
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                />
              </div>
            </div>

            <div className="space-y-2 overflow-x-auto">
              <table className="w-full text-right border-collapse min-w-[760px]">
                <thead>
                  <tr className="border-b text-[11px] text-slate-500">
                    <th className="py-2">الحساب (المستوى 5 فقط)</th>
                    <th className="py-2">المشروع</th>
                    <th className="py-2">القطاع الفرعي</th>
                    <th className="py-2">العملة</th>
                    <th className="py-2">مدين (DR)</th>
                    <th className="py-2">دائن (CR)</th>
                    <th className="py-2">ملاحظة السطر</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {draftLines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pl-2">
                        <select
                          value={line.accountId}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, accountId: e.target.value } : x))
                            )
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1.5"
                        >
                          {postingAccounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              [{acc.code}] {acc.nameAr} (الجيل {acc.level})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pl-2">
                        <select
                          value={line.projectId}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, projectId: e.target.value, subProjectId: "" } : x))
                            )
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1.5"
                        >
                          <option value="">عام / بدون مشروع</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pl-2">
                        <select
                          value={line.subProjectId || ""}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, subProjectId: e.target.value } : x))
                            )
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1.5"
                        >
                          <option value="">بدون قطاع</option>
                          {(projects.find((p) => p.id === (line.projectId || headerProjectId))?.subProjects || []).map((sp) => (
                            <option key={sp.id} value={sp.id}>
                              {sp.code ? `${sp.code} • ${sp.nameAr}` : sp.nameAr}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pl-2">
                        <select
                          value={line.currency}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, currency: e.target.value } : x))
                            )
                          }
                          className="rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1.5"
                        >
                          <option value="YER">YER</option>
                          <option value="SAR">SAR</option>
                          <option value="USD">USD</option>
                        </select>
                      </td>
                      <td className="py-2 pl-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={line.debit}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, debit: e.target.value, credit: Number(e.target.value) > 0 ? "0" : x.credit } : x
                              )
                            )
                          }
                          className="w-28 rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono"
                        />
                      </td>
                      <td className="py-2 pl-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={line.credit}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, credit: e.target.value, debit: Number(e.target.value) > 0 ? "0" : x.debit } : x
                              )
                            )
                          }
                          className="w-28 rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono"
                        />
                      </td>
                      <td className="py-2 pl-2">
                        <input
                          type="text"
                          value={line.memo}
                          onChange={(e) =>
                            setDraftLines((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, memo: e.target.value } : x))
                            )
                          }
                          placeholder="بيان السطر..."
                          className="w-full rounded-lg border border-slate-300 bg-white dark:bg-slate-900 px-2 py-1.5"
                        />
                      </td>
                      <td className="py-2">
                        {draftLines.length > 2 && (
                          <button
                            type="button"
                            onClick={() => setDraftLines((prev) => prev.filter((_, i) => i !== idx))}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDraftLines((prev) => [
                      ...prev,
                      {
                        accountId: postingAccounts[0]?.id || "",
                        debit: "0",
                        credit: "0",
                        currency: "YER",
                        memo: "",
                        projectId: headerProjectId || projects[0]?.id || "",
                        subProjectId: headerSubProjectId || "",
                      },
                    ])
                  }
                  className="px-3 py-1.5 rounded-xl border border-slate-300 font-bold"
                >
                  + إضافة سطر
                </button>
                <button
                  type="button"
                  onClick={() => setQuickCoaOpen(true)}
                  className="px-3 py-1.5 rounded-xl border border-dashed border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ حساب جديد بالدليل</span>
                </button>
                <input
                  type="text"
                  value={attachmentName}
                  onChange={(e) => setAttachmentName(e.target.value)}
                  placeholder="اسم ملف المرفق (اختياري، مثال: invoice.pdf)"
                  className="rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-1.5"
                />
              </div>

              <div className="flex items-center gap-4">
                <div className={`font-extrabold ${totals.balanced ? "text-emerald-600" : "text-rose-600"}`}>
                  مدين: {fmtNum(totals.drBase)} | دائن: {fmtNum(totals.crBase)} | الفرق: {fmtNum(totals.diff)} YER
                </div>
                <button
                  type="submit"
                  disabled={!totals.balanced || submitting}
                  className="px-5 py-2 rounded-xl accent-bg font-extrabold disabled:opacity-40"
                >
                  {submitting
                    ? "جاري الحفظ..."
                    : editingEntryId
                    ? "حفظ تعديلات القيد"
                    : "ترحيل القيد (Post)"}
                </button>
              </div>
            </div>
          </form>
        </SlideOverDrawer>

        <QuickMasterCreateModal
          open={quickCoaOpen}
          mode="coa"
          currentUser={currentUser}
          onClose={() => setQuickCoaOpen(false)}
          onCreatedCoa={(acc) => {
            void loadData();
            onToast(`✅ تم إنشاء الحساب [${acc.code}] ${acc.nameAr}`);
          }}
          onToast={onToast}
        />

        {/* Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم القيد، المرجع، البيان..."
              className="w-full rounded-xl border border-slate-300 bg-transparent pr-8 pl-3 py-2"
            />
          </div>
          <select
            value={filterAccountId}
            onChange={(e) => setFilterAccountId(e.target.value)}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          >
            <option value="ALL">جميع حسابات الترحيل (الجيل 5 والجيل 6)</option>
            {postingAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                [{a.code}] {a.nameAr} (الجيل {a.level})
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
        </div>

        {/* Entries List */}
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-500">جاري تحميل القيود...</div>
        ) : entries.length === 0 ? (
          <EmptyState
            title="لا توجد قيود يومية مطابقة"
            description="لم يتم العثور على قيود يومية في دفتر الأستاذ العام وفق الفلاتر المحددة."
            actionLabel={canPost && !readOnly ? "إنشاء قيد يومية جديد" : undefined}
            onAction={canPost && !readOnly ? () => setShowBuilder(true) : undefined}
          />
        ) : (
          <div className="space-y-3">
            {entries.map((je) => (
              <div
                key={je.id}
                className={`rounded-2xl border p-4 space-y-2.5 text-xs ${
                  je.status === "VOIDED"
                    ? "border-rose-200 bg-rose-50/30 opacity-75"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-extrabold px-2.5 py-1 rounded-lg accent-badge">
                      {je.entryNumber}
                    </span>
                    <span className="text-slate-500 font-mono">{je.date.slice(0, 10)}</span>
                    {je.reference && (
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">
                        Ref: {je.reference}
                      </span>
                    )}
                    {je.project && (
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px]">
                        {je.project.nameAr}
                      </span>
                    )}
                    {je.subProject && (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-mono text-[11px]">
                        {je.subProject.code ? `${je.subProject.code} • ${je.subProject.nameAr}` : je.subProject.nameAr}
                      </span>
                    )}
                    <span className="font-bold text-sm">{je.narrationAr}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        je.status === "POSTED"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {je.status}
                    </span>
                    {je.status === "POSTED" && canPost && !readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditEntry(je)}
                          className="px-2.5 py-1 rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold flex items-center gap-1"
                          title="تعديل بيانات وأسطر القيد"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReverse(je.id, je.entryNumber)}
                          className="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 font-bold flex items-center gap-1"
                          title="عكس القيد المحاسبي"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>قيد عكسي</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="border-b text-[11px] text-slate-400">
                        <th className="py-1">رقم الحساب</th>
                        <th className="py-1">اسم الحساب</th>
                        <th className="py-1">المشروع</th>
                        <th className="py-1">البيان</th>
                        <th className="py-1">مدين (YER)</th>
                        <th className="py-1">دائن (YER)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {je.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-1.5 font-mono font-bold">{line.account.code}</td>
                          <td className="py-1.5 font-semibold">{line.account.nameAr}</td>
                          <td className="py-1.5 text-slate-500">
                            <div>{line.project?.nameAr || "—"}</div>
                            {line.subProject && (
                              <span className="inline-block mt-0.5 text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                {line.subProject.code ? `${line.subProject.code} • ${line.subProject.nameAr}` : line.subProject.nameAr}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 text-slate-500">{line.memo || "—"}</td>
                          <td className="py-1.5 font-mono font-bold text-emerald-700">
                            {line.debitBase > 0 ? fmtNum(line.debitBase) : "—"}
                          </td>
                          <td className="py-1.5 font-mono font-bold text-indigo-700">
                            {line.creditBase > 0 ? fmtNum(line.creditBase) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}


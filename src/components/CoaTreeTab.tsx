"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Edit3, FolderTree, Plus, RefreshCw, Search } from "lucide-react";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";
import { fmtNum } from "@/lib/formulas";

export interface CoaNodeItem {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  type: string;
  isPosting: boolean;
  parentId: string | null;
  directDebit: number;
  directCredit: number;
  rollupDebit: number;
  rollupCredit: number;
  balance: number;
  children: CoaNodeItem[];
}

interface CoaTreeTabProps {
  selectedProjectId: string;
  readOnly?: boolean;
  canEdit?: boolean;
  onToast: (msg: string) => void;
}

const TYPE_BADGE: Record<string, string> = {
  ASSET: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  LIABILITY: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  EQUITY: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  REVENUE: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  EXPENSE: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

export function CoaTreeTab({
  selectedProjectId,
  readOnly = false,
  canEdit = true,
  onToast,
}: CoaTreeTabProps) {
  const [tree, setTree] = useState<CoaNodeItem[]>([]);
  const [flat, setFlat] = useState<Omit<CoaNodeItem, "children">[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addingParent, setAddingParent] = useState<CoaNodeItem | null>(null);
  const [newNameAr, setNewNameAr] = useState("");
  const [newNameEn, setNewNameEn] = useState("");
  const [newCode, setNewCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [quickTier5Open, setQuickTier5Open] = useState(false);
  const [editingNode, setEditingNode] = useState<CoaNodeItem | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editNameEn, setEditNameEn] = useState("");

  const fetchTreePayload = useCallback(async () => {
    const qs =
      selectedProjectId && selectedProjectId !== "ALL"
        ? `?projectId=${encodeURIComponent(selectedProjectId)}`
        : "";
    const res = await fetch(`/api/accounting/coa${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed");
    return (await res.json()) as {
      tree: CoaNodeItem[];
      flat: Omit<CoaNodeItem, "children">[];
    };
  }, [selectedProjectId]);

  const applyTreePayload = useCallback((data: { tree: CoaNodeItem[]; flat: Omit<CoaNodeItem, "children">[] }) => {
    setTree(data.tree || []);
    setFlat(data.flat || []);
    const initExp: Record<string, boolean> = {};
    for (const n of data.flat || []) {
      if (n.level <= 3) initExp[n.id] = true;
    }
    setExpanded((prev) => (Object.keys(prev).length > 0 ? prev : initExp));
  }, []);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTreePayload();
      applyTreePayload(data);
    } catch {
      onToast("تعذر تحميل شجرة الحسابات");
    } finally {
      setLoading(false);
    }
  }, [fetchTreePayload, applyTreePayload, onToast]);

  useEffect(() => {
    let active = true;
    fetchTreePayload()
      .then((data) => {
        if (!active) return;
        applyTreePayload(data);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        onToast("تعذر تحميل شجرة الحسابات");
      });
    return () => {
      active = false;
    };
  }, [fetchTreePayload, applyTreePayload, onToast]);

  function toggleAll(open: boolean) {
    const next: Record<string, boolean> = {};
    for (const n of flat) {
      next[n.id] = open;
    }
    setExpanded(next);
  }

  async function handleCreateChild(e: React.FormEvent) {
    e.preventDefault();
    if (!addingParent || !newNameAr.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/accounting/coa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: addingParent.id,
          code: newCode.trim() || undefined,
          nameAr: newNameAr.trim(),
          nameEn: newNameEn.trim() || newNameAr.trim(),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        tree?: CoaNodeItem[];
        flat?: Omit<CoaNodeItem, "children">[];
      };
      if (!res.ok) {
        onToast(data.error || "تعذر إنشاء الحساب الفرعي");
        return;
      }
      if (data.tree) setTree(data.tree);
      if (data.flat) setFlat(data.flat);
      setExpanded((prev) => ({ ...prev, [addingParent.id]: true }));
      setAddingParent(null);
      setNewNameAr("");
      setNewNameEn("");
      setNewCode("");
      onToast("✅ تم إضافة الحساب الفرعي في شجرة الحسابات بنجاح");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEditNode(e: React.FormEvent) {
    e.preventDefault();
    if (!editingNode || !editNameAr.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/accounting/coa", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingNode.id,
          code: editCode.trim() || editingNode.code,
          nameAr: editNameAr.trim(),
          nameEn: editNameEn.trim() || editNameAr.trim(),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        tree?: CoaNodeItem[];
        flat?: Omit<CoaNodeItem, "children">[];
      };
      if (!res.ok) {
        onToast(data.error || "تعذر تعديل الحساب");
        return;
      }
      if (data.tree) setTree(data.tree);
      if (data.flat) setFlat(data.flat);
      setEditingNode(null);
      onToast("✅ تم تحديث بيانات الحساب في شجرة الحسابات");
    } finally {
      setSubmitting(false);
    }
  }

  function matchesSearch(node: CoaNodeItem): boolean {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    if (
      node.code.toLowerCase().includes(q) ||
      node.nameAr.toLowerCase().includes(q) ||
      node.nameEn.toLowerCase().includes(q)
    ) {
      return true;
    }
    return node.children.some(matchesSearch);
  }

  function renderNode(node: CoaNodeItem): React.ReactNode {
    if (!matchesSearch(node)) return null;
    const hasChildren = node.children.length > 0;
    const isOpen = search.trim() ? true : Boolean(expanded[node.id]);

    return (
      <div key={node.id} className="space-y-1">
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border transition ${
            node.isPosting
              ? "border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40"
              : "border-slate-200/80 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/60"
          }`}
          style={{ marginInlineStart: `${(node.level - 1) * 16}px` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !isOpen }))}
                className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
              >
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                )}
              </button>
            ) : (
              <span className="w-6 text-center text-xs text-slate-400">•</span>
            )}

            <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-700">
              {node.code}
            </span>
            <div className="truncate">
              <span className={`text-xs ${node.level <= 2 ? "font-black" : "font-bold"}`}>
                {node.nameAr}
              </span>
              <span className="text-[11px] text-slate-400 mr-2 hidden sm:inline">
                ({node.nameEn})
              </span>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_BADGE[node.type] || ""}`}>
              T{node.level} • {node.isPosting ? "حساب ترحيل (Posting)" : "حساب تجميعي"}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="text-left">
              <div className="text-[10px] text-slate-400">
                مدين: {fmtNum(node.rollupDebit)} | دائن: {fmtNum(node.rollupCredit)}
              </div>
              <div
                className={`font-extrabold ${
                  node.balance >= 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                الرصيد: {fmtNum(node.balance)} YER
              </div>
            </div>

            {!readOnly && canEdit && (
              <div className="flex items-center gap-1">
                {node.level < 5 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAddingParent(node);
                      setEditingNode(null);
                      setNewNameAr("");
                      setNewNameEn("");
                      setNewCode("");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>فرع T{node.level + 1}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingNode(node);
                    setAddingParent(null);
                    setEditCode(node.code);
                    setEditNameAr(node.nameAr);
                    setEditNameEn(node.nameEn);
                  }}
                  className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-bold hover:border-emerald-500 flex items-center gap-1"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>تعديل</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {hasChildren && isOpen && (
          <div className="space-y-1">{node.children.map((child) => renderNode(child))}</div>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="card-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">
                دليل الحسابات الموحد (5-Tier Chart of Accounts)
              </h2>
              <p className="text-xs text-slate-500">
                هيكلية 5 مستويات (أب ← مجموعة ← رقابي ← فرعي ← تفصيلي). الترحيل المحاسبي مقيد حصرياً بحسابات المستوى الخامس.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                type="text"
                placeholder="بحث بالرمز أو الاسم..."
                className="rounded-xl border border-slate-300 bg-transparent pr-8 pl-3 py-1.5 text-xs"
              />
            </div>
            <button
              onClick={() => toggleAll(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
            >
              توسيع الكل
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold"
            >
              طي الكل
            </button>
            <button
              onClick={loadTree}
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-bold flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث</span>
            </button>
            {!readOnly && canEdit && (
              <button
                type="button"
                onClick={() => setQuickTier5Open(true)}
                className="px-3.5 py-1.5 rounded-xl accent-bg text-xs font-extrabold flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>حساب مستوى 5 جديد</span>
              </button>
            )}
          </div>
        </div>

        <QuickMasterCreateModal
          open={quickTier5Open}
          mode="coa"
          onClose={() => setQuickTier5Open(false)}
          onCreatedCoa={() => {
            void loadTree();
          }}
          onToast={onToast}
        />

        {/* Tier-1 Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {tree.map((root) => (
            <div key={root.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
              <div className="text-[11px] font-bold text-slate-500">
                {root.code} • {root.nameAr}
              </div>
              <div className="text-sm font-black text-emerald-600">{fmtNum(root.balance)} YER</div>
            </div>
          ))}
        </div>

        {!readOnly && canEdit && editingNode && (
          <form
            onSubmit={handleSaveEditNode}
            className="p-4 rounded-2xl border-2 border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm">
                تعديل بيانات الحساب: [{editingNode.code}] {editingNode.nameAr}
              </h4>
              <button
                type="button"
                onClick={() => setEditingNode(null)}
                className="text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold mb-1">رمز الحساب *</label>
                <input
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">اسم الحساب (عربي) *</label>
                <input
                  value={editNameAr}
                  onChange={(e) => setEditNameAr(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Account Name (English)</label>
                <input
                  value={editNameEn}
                  onChange={(e) => setEditNameEn(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingNode(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 font-bold"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl accent-bg font-extrabold"
              >
                {submitting ? "جاري التحديث..." : "حفظ تعديل الحساب"}
              </button>
            </div>
          </form>
        )}

        {!readOnly && canEdit && addingParent && (
          <form
            onSubmit={handleCreateChild}
            className="p-4 rounded-2xl border-2 border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm">
                إضافة حساب فرعي جديد (المستوى {addingParent.level + 1}) أسفل: [{addingParent.code}]{" "}
                {addingParent.nameAr}
              </h4>
              <button
                type="button"
                onClick={() => setAddingParent(null)}
                className="text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold mb-1">اسم الحساب (عربي) *</label>
                <input
                  value={newNameAr}
                  onChange={(e) => setNewNameAr(e.target.value)}
                  required
                  placeholder="مثال: حساب بنك سبأ الإسلامي"
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Account Name (English)</label>
                <input
                  value={newNameEn}
                  onChange={(e) => setNewNameEn(e.target.value)}
                  placeholder="e.g. Saba Islamic Bank"
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">الرمز المحاسبي (اختياري - آلي)</label>
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="يتم توليده آلياً عند الترك فارغاً"
                  className="w-full rounded-xl border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddingParent(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 font-bold"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-xl accent-bg font-extrabold"
              >
                {submitting ? "جاري الحفظ..." : "حفظ الحساب الجديد"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="py-10 text-center text-xs text-slate-500">جاري تحميل دليل الحسابات...</div>
        ) : (
          <div className="space-y-1.5">{tree.map((root) => renderNode(root))}</div>
        )}
      </div>
    </section>
  );
}


"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { fmtNum } from "@/lib/formulas";

interface ApprovalRuleRow {
  id: string;
  module: string;
  actionType: string;
  minAmountBase: number;
  currencyCode: string;
  requiredRole: string;
  allowSelfApproval: boolean;
  isActive: boolean;
}

interface ApprovalRulesMatrixPanelProps {
  readOnly?: boolean;
  onToast: (msg: string) => void;
}

const MODULES = ["ACCOUNTING", "SALES", "PROCUREMENT", "TREASURY", "INVENTORY", "PROJECTS", "WORKERS", "FISCAL_YEAR"];
const ACTIONS = [
  "CREATE_AND_POST",
  "GL_POSTING",
  "AMEND_POSTED_RECORD",
  "VOID_RECORD",
  "HIGH_VALUE_TRANSACTION",
  "FISCAL_YEAR_CLOSE",
];
const ROLES = ["SUPER_ADMIN", "CHIEF_ACCOUNTANT", "PROJECT_MANAGER", "AUDITOR"];

/**
 * Approval Rules Matrix (سياسات الاعتماد والحوكمة) mounted in SystemTab.
 */
export function ApprovalRulesMatrixPanel({ readOnly = false, onToast }: ApprovalRulesMatrixPanelProps) {
  const [rules, setRules] = useState<ApprovalRuleRow[]>([]);
  const [mod, setMod] = useState("ACCOUNTING");
  const [actionType, setActionType] = useState("AMEND_POSTED_RECORD");
  const [minAmountBase, setMinAmountBase] = useState("0");
  const [requiredRole, setRequiredRole] = useState("CHIEF_ACCOUNTANT");
  const [allowSelf, setAllowSelf] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals/rules", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { rules?: ApprovalRuleRow[] };
      setRules(data.rules || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadRules();
    });
    return () => {
      active = false;
    };
  }, [loadRules]);

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/approvals/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: mod,
          actionType,
          minAmountBase: Number(minAmountBase) || 0,
          currencyCode: "YER",
          requiredRole,
          allowSelfApproval: allowSelf,
          isActive: true,
        }),
      });
      if (!res.ok) {
        onToast("تعذر حفظ قاعدة الاعتماد");
        return;
      }
      onToast("✅ تمت إضافة سياسة الاعتماد والحوكمة");
      await loadRules();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(r: ApprovalRuleRow) {
    await fetch("/api/approvals/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, isActive: !r.isActive }),
    });
    await loadRules();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/approvals/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    onToast("تم حذف قاعدة الاعتماد");
    await loadRules();
  }

  return (
    <div className="card-surface rounded-2xl p-5 space-y-4 border border-slate-200 dark:border-slate-800" dir="rtl">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-black">سياسات الاعتماد والحوكمة (Approval Rules Matrix)</h3>
          <p className="text-[11px] text-slate-500">
            تحديد العمليات التي تتطلب موافقة مسبقة قبل الترحيل أو التعديل بعد الترحيل مع منع الاعتماد الذاتي
          </p>
        </div>
      </div>

      {!readOnly && (
        <form onSubmit={handleAddRule} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-center text-xs">
          <select value={mod} onChange={(e) => setMod(e.target.value)} className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold">
            {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={actionType} onChange={(e) => setActionType(e.target.value)} className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold">
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="number" min={0} value={minAmountBase} onChange={(e) => setMinAmountBase(e.target.value)} placeholder="الحد الأدنى (YER)" className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-mono" />
          <select value={requiredRole} onChange={(e) => setRequiredRole(e.target.value)} className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-2 font-bold">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label className="flex items-center gap-1.5 px-2 text-[11px] font-bold">
            <input type="checkbox" checked={allowSelf} onChange={(e) => setAllowSelf(e.target.checked)} />
            <span>السماح بالاعتماد الذاتي</span>
          </label>
          <button type="submit" disabled={saving} className="rounded-xl accent-bg font-extrabold py-2 px-3 inline-flex items-center justify-center gap-1">
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة سياسة</span>
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-xs text-right">
          <thead className="bg-slate-100 dark:bg-slate-800 font-extrabold">
            <tr>
              <th className="px-3 py-2">الوحدة</th>
              <th className="px-3 py-2">نوع الإجراء</th>
              <th className="px-3 py-2">الحد الأدنى (YER)</th>
              <th className="px-3 py-2">الصلاحية المطلوبة</th>
              <th className="px-3 py-2">اعتماد ذاتي</th>
              <th className="px-3 py-2">الحالة</th>
              {!readOnly && <th className="px-3 py-2">إجراء</th>}
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-slate-200 dark:border-slate-800">
                <td className="px-3 py-2 font-bold">{r.module}</td>
                <td className="px-3 py-2 font-mono">{r.actionType}</td>
                <td className="px-3 py-2 tabular-nums">{fmtNum(r.minAmountBase)}</td>
                <td className="px-3 py-2 font-bold">{r.requiredRole}</td>
                <td className="px-3 py-2">{r.allowSelfApproval ? "مسموح" : "ممنوع 🔒"}</td>
                <td className="px-3 py-2">
                  <button type="button" disabled={readOnly} onClick={() => void handleToggle(r)} className={`px-2 py-0.5 rounded-full text-[10px] font-black ${r.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                    {r.isActive ? "مفعل" : "معطل"}
                  </button>
                </td>
                {!readOnly && (
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => void handleDelete(r.id)} className="text-rose-600 hover:underline inline-flex items-center gap-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  لا توجد سياسات اعتماد مضافة بعد — يمكنك إضافة سياسة للترحيل أو التعديل بعد الترحيل أعلاه.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

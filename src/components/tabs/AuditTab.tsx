"use client";

import React, { useMemo, useState } from "react";
import type { UasAuditLog, UasProject } from "@/types/uas";

interface AuditTabProps {
  projects: UasProject[];
  lockedPeriods: Record<string, boolean>;
  auditLogs: UasAuditLog[];
  onTogglePeriodLock: (key: string) => Promise<void>;
  onPostAdjustment: (payload: {
    key: string;
    periodLabel: string;
    reason: string;
    amount: number;
  }) => Promise<boolean>;
  onExportExcel: () => void;
  onToast: (msg: string) => void;
}

export function AuditTab({
  projects,
  lockedPeriods,
  auditLogs,
  onTogglePeriodLock,
  onPostAdjustment,
  onExportExcel,
  onToast,
}: AuditTabProps) {
  const pairs = useMemo(() => {
    const list: Array<{ key: string; label: string }> = [];
    projects.forEach((p) => {
      (p.harvests || []).forEach((h) => {
        list.push({ key: `${p.id}::${h}`, label: `${p.name} — ${h}` });
      });
    });
    return list;
  }, [projects]);

  const [selectedKey, setSelectedKey] = useState(pairs[0]?.key || "");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("5000");

  async function handleSubmitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      onToast("يرجى إدخال بيان قيد التسوية");
      return;
    }
    const activePair = pairs.find((p) => p.key === selectedKey) || pairs[0];
    const ok = await onPostAdjustment({
      key: activePair?.key || "",
      periodLabel: activePair?.label || "",
      reason: reason.trim(),
      amount: Number(amount) || 0,
    });
    if (ok) setReason("");
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-surface rounded-2xl p-5 space-y-4 text-xs">
          <h3 className="text-sm font-extrabold border-b pb-2">
            إغلاق الفترات والقطفات (Period Locking)
          </h3>
          <p className="text-slate-500">
            عند إغلاق القطفة محاسبياً، يمنع النظام الحذف أو التعديل المباشر إلا عبر قيد تسوية معتمد.
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {pairs.map((pair) => {
              const locked = Boolean(lockedPeriods[pair.key]);
              return (
                <div
                  key={pair.key}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 gap-2"
                >
                  <div>
                    <div className="font-bold">{pair.label}</div>
                    <div
                      className={`text-[11px] ${
                        locked ? "text-rose-600 font-bold" : "text-emerald-600"
                      }`}
                    >
                      {locked ? "🔒 مغلقة ومعتمدة محاسبياً" : "🔓 مفتوحة للعمليات"}
                    </div>
                  </div>
                  <button
                    onClick={() => onTogglePeriodLock(pair.key)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold shrink-0 ${
                      locked ? "bg-slate-200 text-slate-800" : "bg-rose-600 text-white"
                    }`}
                  >
                    {locked ? "فتح القطفة" : "إغلاق القطفة 🔒"}
                  </button>
                </div>
              );
            })}
          </div>

          <form
            onSubmit={handleSubmitAdjustment}
            className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3"
          >
            <h4 className="font-extrabold text-sm">
              إضافة قيد تسوية محاسبي معتمد (Adjustment Entry)
            </h4>
            <div>
              <label className="block font-semibold mb-1">المشروع / القطفة</label>
              <select
                value={selectedKey || pairs[0]?.key || ""}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                {pairs.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">بيان قيد التسوية</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                type="text"
                placeholder="مثال: تسوية فرق وزن علاقية أو خصم مسموح به"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">قيمة التسوية (ريال)</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                inputMode="numeric"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <button type="submit" className="w-full py-2 rounded-xl accent-bg font-bold">
              + ترحيل قيد التسوية إلى سجل الرقابة
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold">
                سجل الرقابة والتدقيق غير القابل للتعديل (Immutable Audit Log)
              </h3>
              <p className="text-xs text-slate-500">
                يوثق كل عملية إضافة أو حذف أو تحصيل أو إغلاق فترة مع بصمة تحقق رقمية
              </p>
            </div>
            <button
              onClick={onExportExcel}
              className="px-3 py-1.5 rounded-xl accent-bg text-xs font-bold"
            >
              تصدير سجل الرقابة Excel
            </button>
          </div>
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/60">
                <th className="p-2.5">التوقيت</th>
                <th className="p-2.5">المستخدم والدور</th>
                <th className="p-2.5">نوع الحدث</th>
                <th className="p-2.5">التفاصيل والبيان</th>
                <th className="p-2.5">بصمة التحقق (Hash)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {auditLogs.map((a) => (
                <tr key={a.id}>
                  <td className="p-2.5 font-mono text-[11px]">{a.timestamp}</td>
                  <td className="p-2.5 font-bold">{a.user}</td>
                  <td className="p-2.5">
                    <span className="accent-badge px-2 py-0.5 rounded font-semibold">
                      {a.action}
                    </span>
                  </td>
                  <td className="p-2.5">{a.details}</td>
                  <td className="p-2.5 font-mono text-[11px] text-emerald-700 font-bold">
                    {a.hash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}


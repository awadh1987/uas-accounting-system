"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";

export interface CostCenterOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  generation: number;
  centerType: string;
  isActive: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  BRANCH: "فرع / Branch",
  PROJECT: "مشروع / Project",
  FARM: "مزرعة / Farm",
  DEPARTMENT: "قسم / Department",
  FLEET: "أسطول / Fleet",
  OTHER: "أخرى / مخصص (Other)",
};

const OTHER_TOKEN = "__other_cost_center__";

export interface CostCenterSelectorProps {
  value: string;
  onChange: (costCenterId: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Only show leaf-level (generation >= 2) centers; group roots are hidden by default. */
  includeGroups?: boolean;
}

/**
 * Cost Center selector used by every voucher / invoice / bill / stock / master-data form.
 * Includes the universal "➕ مركز تكلفة آخر مخصص / Other" option which creates a custom center in place.
 */
export function CostCenterSelector({
  value,
  onChange,
  label = "مركز التكلفة / Cost Center",
  disabled,
  className = "",
  includeGroups = false,
}: CostCenterSelectorProps) {
  const [centers, setCenters] = useState<CostCenterOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("OTHER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/cost-centers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { costCenters?: CostCenterOption[] };
      setCenters((data.costCenters || []).filter((c) => c.isActive !== false));
    } catch {
      /* offline / transient: leave list as-is */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCustom() {
    const nameAr = newName.trim();
    if (!nameAr) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/accounting/cost-centers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameAr, nameEn: nameAr, centerType: newType, customLabel: newType === "OTHER" ? nameAr : null }),
      });
      const data = (await res.json()) as { costCenter?: CostCenterOption; error?: string };
      if (!res.ok || !data.costCenter) {
        setError(data.error || "تعذر إنشاء مركز التكلفة");
        return;
      }
      await load();
      onChange(data.costCenter.id);
      setAdding(false);
      setNewName("");
    } catch {
      setError("تعذر إنشاء مركز التكلفة");
    } finally {
      setBusy(false);
    }
  }

  const visible = centers.filter((c) => includeGroups || c.generation >= 2);

  return (
    <div className={`space-y-1.5 w-full ${className}`}>
      <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">{label}</label>
      <select
        value={adding ? OTHER_TOKEN : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === OTHER_TOKEN) {
            setAdding(true);
          } else {
            setAdding(false);
            onChange(e.target.value);
          }
        }}
        className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-xs font-semibold"
      >
        <option value="">— بدون مركز تكلفة / Auto (من الحساب) —</option>
        {visible.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} • {c.nameAr}
          </option>
        ))}
        <option value={OTHER_TOKEN}>➕ مركز تكلفة آخر مخصص / Other</option>
      </select>
      {adding && (
        <div className="rounded-xl border border-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/20 p-2 space-y-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم مركز التكلفة المخصص / Custom center name"
            className="w-full rounded-lg border border-emerald-300 bg-transparent px-2.5 py-1.5 text-xs font-semibold"
          />
          <div className="flex gap-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-[11px] font-semibold"
            >
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() => void createCustom()}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold flex items-center gap-1 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              <span>إضافة</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError("");
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-[11px] font-bold"
            >
              إلغاء
            </button>
          </div>
          {error && <div className="text-[10px] font-bold text-rose-600">{error}</div>}
        </div>
      )}
    </div>
  );
}

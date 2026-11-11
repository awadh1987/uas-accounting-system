"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FolderKanban, Lock, Plus, Unlock } from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { LanguageCode, UasProject } from "@/types/uas";

interface ApiProjectItem {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  nameEn: string;
  type: string;
  budgetTotal: number;
  status: string;
  notes: string;
  subProjects: Array<{ id: string; code: string; nameAr: string; nameEn: string; budget: number }>;
  harvestCycles: Array<{ id: string; cycleNumber: number; name: string; isLocked: boolean }>;
  metrics: {
    revenue: number;
    actualCost: number;
    netProfit: number;
    variance: number;
    utilizationPct: number;
    isOverBudget: boolean;
  };
}

interface ProjectsManagerTabProps {
  projects: UasProject[];
  lang: LanguageCode;
  onAddProject: (payload: {
    name: string;
    type: string;
    parentProjectId: string;
    estimatedValue: number;
    plannedHarvests: number;
    notes: string;
  }) => Promise<boolean>;
  onAddHarvest: (payload: { projectId: string; name: string }) => Promise<boolean>;
  onTogglePeriodLock: (key: string) => Promise<void>;
  onRefreshState: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function ProjectsManagerTab({
  projects,
  lang,
  onAddProject,
  onAddHarvest,
  onTogglePeriodLock,
  onRefreshState,
  onToast,
}: ProjectsManagerTabProps) {
  const [apiProjects, setApiProjects] = useState<ApiProjectItem[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("مشروع رئيسي");
  const [parentProjectId, setParentProjectId] = useState(projects[0]?.id || "");
  const [budgetTotal, setBudgetTotal] = useState("1000000");
  const [plannedHarvests, setPlannedHarvests] = useState("3");
  const [notes, setNotes] = useState("");

  // Sub-project creator
  const [subTargetProjectId, setSubTargetProjectId] = useState(projects[0]?.id || "");
  const [subNameAr, setSubNameAr] = useState("");
  const [subBudget, setSubBudget] = useState("250000");

  // Harvest creator
  const [harvestProjId, setHarvestProjId] = useState(projects[0]?.id || "");
  const [harvestName, setHarvestName] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { projects: ApiProjectItem[] };
      setApiProjects(data.projects || []);
    } catch {
      // keep fallback from props
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/projects", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { projects?: ApiProjectItem[] } | null) => {
        if (active && data?.projects) {
          setApiProjects(data.projects);
        }
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [projects]);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      onToast("يرجى إدخال اسم المشروع");
      return;
    }
    const ok = await onAddProject({
      name: name.trim(),
      type,
      parentProjectId: type === "مشروع فرعي" ? parentProjectId : "",
      estimatedValue: Number(budgetTotal) || 0,
      plannedHarvests: Math.max(1, Number(plannedHarvests) || 1),
      notes: notes.trim(),
    });
    if (ok) {
      setName("");
      setNotes("");
      await loadProjects();
    }
  }

  async function handleAddSubProject(e: React.FormEvent) {
    e.preventDefault();
    const pid = subTargetProjectId || projects[0]?.id;
    if (!pid || !subNameAr.trim()) return;
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ADD_SUBPROJECT",
        projectId: pid,
        nameAr: subNameAr.trim(),
        budget: Number(subBudget) || 0,
      }),
    });
    if (!res.ok) {
      onToast("تعذر إضافة المشروع الفرعي");
      return;
    }
    setSubNameAr("");
    onToast("✅ تم إضافة القطاع / المشروع الفرعي بنجاح");
    await Promise.all([loadProjects(), onRefreshState()]);
  }

  async function handleCreateHarvest(e: React.FormEvent) {
    e.preventDefault();
    const pid = harvestProjId || projects[0]?.id;
    if (!pid || !harvestName.trim()) {
      onToast("يرجى اختيار المشروع وإدخال اسم القطفة");
      return;
    }
    const ok = await onAddHarvest({ projectId: pid, name: harvestName.trim() });
    if (ok) {
      setHarvestName("");
      await loadProjects();
    }
  }

  const displayList: ApiProjectItem[] =
    apiProjects.length > 0
      ? apiProjects
      : projects.map((p) => ({
          id: p.id,
          code: p.code || p.id.toUpperCase(),
          name: p.name,
          nameAr: p.nameAr || p.name,
          nameEn: p.nameEn || p.name,
          type: p.type,
          budgetTotal: p.budgetTotal ?? p.estimatedValue,
          status: p.status || "ACTIVE",
          notes: p.notes,
          subProjects: p.subProjects || [],
          harvestCycles: (p.harvestCycles || []).map((hc) => ({
            id: hc.id,
            cycleNumber: hc.cycleNumber || hc.sortOrder,
            name: hc.name,
            isLocked: hc.isLocked,
          })),
          metrics: {
            revenue: 0,
            actualCost: 0,
            netProfit: 0,
            variance: p.budgetTotal ?? p.estimatedValue,
            utilizationPct: 0,
            isOverBudget: false,
          },
        }));

  const isAr = lang === "ar";

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Forms */}
        <div className="space-y-5 text-xs">
          <form onSubmit={handleCreateProject} className="card-surface rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-extrabold border-b pb-2 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-emerald-600" />
              <span>{isAr ? "إضافة مشروع رئيسي / فرعي" : "Create Main / Sub Project"}</span>
            </h3>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="مشروع رئيسي">مشروع رئيسي (Main Project)</option>
              <option value="مشروع فرعي">مشروع فرعي (Sub Project)</option>
            </select>
            {type === "مشروع فرعي" && (
              <select
                value={parentProjectId}
                onChange={(e) => setParentProjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسم المشروع *"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={budgetTotal}
                onChange={(e) => setBudgetTotal(e.target.value)}
                placeholder="الموازنة (YER)"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
              <input
                type="number"
                value={plannedHarvests}
                onChange={(e) => setPlannedHarvests(e.target.value)}
                min={1}
                max={20}
                placeholder="عدد القطفات"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات المشروع..."
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
            <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
              + حفظ المشروع
            </button>
          </form>

          <form onSubmit={handleAddSubProject} className="card-surface rounded-2xl p-5 space-y-3">
            <h4 className="text-sm font-extrabold border-b pb-2">إضافة قطاع فرعي (Sub-Project Cost Center)</h4>
            <select
              value={subTargetProjectId}
              onChange={(e) => setSubTargetProjectId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              value={subNameAr}
              onChange={(e) => setSubNameAr(e.target.value)}
              placeholder="اسم القطاع (مثال: قطاع C - البئر الشمالية)"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
            <input
              type="number"
              value={subBudget}
              onChange={(e) => setSubBudget(e.target.value)}
              placeholder="موازنة القطاع (YER)"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
            <button type="submit" className="w-full py-2 rounded-xl border border-emerald-600 text-emerald-700 font-bold">
              + إضافة القطاع الفرعي
            </button>
          </form>

          <form onSubmit={handleCreateHarvest} className="card-surface rounded-2xl p-5 space-y-3">
            <h4 className="text-sm font-extrabold border-b pb-2">إضافة قطفة / مرشة جديدة</h4>
            <select
              value={harvestProjId}
              onChange={(e) => setHarvestProjId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              value={harvestName}
              onChange={(e) => setHarvestName(e.target.value)}
              placeholder="مثال: القطفة الرابعة - شتاء 2026"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
            <button type="submit" className="w-full py-2 rounded-xl accent-bg font-bold">
              + إضافة القطفة
            </button>
          </form>
        </div>

        {/* Right column: Project Cards with Budget Meters & Lock Switches */}
        <div className="lg:col-span-2 space-y-4">
          {displayList.map((proj) => {
            const pct = Math.min(100, Math.max(0, proj.metrics.utilizationPct));
            return (
              <div key={proj.id} className="card-surface rounded-2xl p-5 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl accent-badge flex items-center justify-center">
                      <FolderKanban className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          {proj.code}
                        </span>
                        <h3 className="font-extrabold text-base">{proj.nameAr}</h3>
                      </div>
                      <p className="text-slate-500">{proj.notes}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {proj.metrics.isOverBudget && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-extrabold">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>تجاوز الموازنة!</span>
                      </span>
                    )}
                    <span className="px-2.5 py-1 rounded-full accent-badge font-bold">{proj.status}</span>
                  </div>
                </div>

                {/* Budget Envelope Meter */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-2">
                  <div className="flex flex-wrap justify-between gap-2 font-bold">
                    <span>الموازنة: {fmtNum(proj.budgetTotal)} YER</span>
                    <span>المنصرف الفعلي: {fmtNum(proj.metrics.actualCost)} YER</span>
                    <span>الإيرادات: {fmtNum(proj.metrics.revenue)} YER</span>
                    <span className={proj.metrics.netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      صافي الربح: {fmtNum(proj.metrics.netProfit)} YER
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        proj.metrics.isOverBudget
                          ? "bg-rose-600"
                          : pct > 80
                          ? "bg-amber-500"
                          : "bg-emerald-600"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>نسبة استهلاك الموازنة: {proj.metrics.utilizationPct.toFixed(1)}%</span>
                    <span>المتبقي من الموازنة: {fmtNum(proj.metrics.variance)} YER</span>
                  </div>
                </div>

                {/* Sub-Projects */}
                {proj.subProjects.length > 0 && (
                  <div>
                    <div className="font-bold text-slate-500 mb-1.5">المشاريع والقطاعات الفرعية (Cost Centers):</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {proj.subProjects.map((sp) => (
                        <div key={sp.id} className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                          <div className="font-mono text-[10px] text-slate-400">{sp.code}</div>
                          <div className="font-bold">{sp.nameAr}</div>
                          <div className="text-emerald-600 font-bold">{fmtNum(sp.budget)} YER</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Harvest Cycles with Lock Switches */}
                <div>
                  <div className="font-bold text-slate-500 mb-1.5">دورات الحصاد والقطفات (إغلاق الفترة المحاسبية):</div>
                  <div className="flex flex-wrap gap-2">
                    {proj.harvestCycles.map((hc) => (
                      <button
                        key={hc.id}
                        type="button"
                        onClick={async () => {
                          await onTogglePeriodLock(`${proj.id}::${hc.name}`);
                          await loadProjects();
                        }}
                        className={`px-3 py-1.5 rounded-xl border font-bold flex items-center gap-1.5 transition ${
                          hc.isLocked
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : "border-emerald-300 bg-emerald-50/70 text-emerald-800"
                        }`}
                      >
                        {hc.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        <span>{hc.name}</span>
                        <span className="text-[10px] opacity-75">{hc.isLocked ? "مغلقة" : "مفتوحة"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


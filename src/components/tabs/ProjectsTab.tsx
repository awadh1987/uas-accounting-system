"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import { getDict } from "@/lib/i18n";
import type { LanguageCode, UasProject } from "@/types/uas";

interface ProjectsTabProps {
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
  onToast: (msg: string) => void;
}

export function ProjectsTab({
  projects,
  lang,
  onAddProject,
  onAddHarvest,
  onToast,
}: ProjectsTabProps) {
  const dict = getDict(lang);
  const [type, setType] = useState("مشروع رئيسي");
  const [parentProjectId, setParentProjectId] = useState(projects[0]?.id || "");
  const [name, setName] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("1000000");
  const [plannedHarvests, setPlannedHarvests] = useState("3");
  const [notes, setNotes] = useState("");

  const [harvestProjId, setHarvestProjId] = useState(projects[0]?.id || "");
  const [harvestName, setHarvestName] = useState("");

  // Projects & Operations Local Filters (Harvest & Sub-project filters)
  const [filterProject, setFilterProject] = useState("ALL");
  const [filterHarvest, setFilterHarvest] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const allHarvests = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => (p.harvests || []).forEach((h) => set.add(h)));
    return Array.from(set);
  }, [projects]);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterProject !== "ALL" && p.id !== filterProject && p.parentProjectId !== filterProject) {
        return false;
      }
      if (filterHarvest !== "ALL" && !(p.harvests || []).includes(filterHarvest)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesHarvest = (p.harvests || []).some((h) => h.toLowerCase().includes(q));
        const matchesNotes = (p.notes || "").toLowerCase().includes(q);
        if (!matchesName && !matchesHarvest && !matchesNotes) return false;
      }
      return true;
    });
  }, [projects, filterProject, filterHarvest, searchQuery]);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      onToast("يرجى إدخال اسم المشروع");
      return;
    }
    const ok = await onAddProject({
      name: name.trim(),
      type,
      parentProjectId: type === "مشروع فرعي" ? parentProjectId || projects[0]?.id || "" : "",
      estimatedValue: Number(estimatedValue) || 0,
      plannedHarvests: Math.max(1, Number(plannedHarvests) || 1),
      notes: notes.trim(),
    });
    if (ok) {
      setName("");
      setNotes("");
    }
  }

  async function handleCreateHarvest(e: React.FormEvent) {
    e.preventDefault();
    const pid = harvestProjId || projects[0]?.id;
    if (!pid || !harvestName.trim()) {
      onToast("يرجى اختيار المشروع وإدخال اسم القطفة/المرشة");
      return;
    }
    const ok = await onAddHarvest({ projectId: pid, name: harvestName.trim() });
    if (ok) setHarvestName("");
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card-surface rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-extrabold border-b pb-2">{dict.addProjectTitle}</h3>
          <form onSubmit={handleCreateProject} className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">تصنيف المشروع</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                <option value="مشروع رئيسي">مشروع رئيسي (Main Project)</option>
                <option value="مشروع فرعي">مشروع فرعي (Sub Project)</option>
              </select>
            </div>
            {type === "مشروع فرعي" && (
              <div>
                <label className="block font-semibold mb-1">تابع للمشروع الرئيسي</label>
                <select
                  value={parentProjectId || projects[0]?.id || ""}
                  onChange={(e) => setParentProjectId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block font-semibold mb-1">اسم المشروع</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                type="text"
                placeholder="مثال: الجبري العليا"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">قيمة المشروع (ريال)</label>
                <input
                  value={estimatedValue}
                  onChange={(e) => setEstimatedValue(e.target.value)}
                  type="number"
                  inputMode="numeric"
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">عدد القطفات/مرشات</label>
                <input
                  value={plannedHarvests}
                  onChange={(e) => setPlannedHarvests(e.target.value)}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">ملاحظات</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                type="text"
                placeholder="مثال: بقعة قات الجبري"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold shadow-sm">
              + حفظ وإضافة المشروع
            </button>
          </form>

          {/* Add Harvest / Spray */}
          <form
            onSubmit={handleCreateHarvest}
            className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3 text-xs"
          >
            <h4 className="font-extrabold">إضافة قطفة / مرشة جديدة لمشروع</h4>
            <div>
              <label className="block font-semibold mb-1">اختر المشروع</label>
              <select
                value={harvestProjId || projects[0]?.id || ""}
                onChange={(e) => setHarvestProjId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">اسم القطفة / المرشة</label>
              <input
                value={harvestName}
                onChange={(e) => setHarvestName(e.target.value)}
                type="text"
                placeholder="مثال: القطفة الرابعة / مرشة وقائية"
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 rounded-xl border border-emerald-600 text-emerald-600 font-bold hover:bg-emerald-50"
            >
              + إضافة قطفة / مرشة
            </button>
          </form>
        </div>

        {/* Directory */}
        <div className="lg:col-span-2 card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold">قائمة المشاريع والقطفات المسجلة</h3>
              <p className="text-xs text-slate-500">
                إدارة وتصفية المشاريع الرئيسية والفرعية ومواسم القطف والرش الميداني
              </p>
            </div>
            <span className="accent-badge text-xs px-2.5 py-1 rounded-lg font-bold">
              {filteredProjects.length} / {projects.length} مشاريع
            </span>
          </div>

          {/* Agricultural Harvest & Sector Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-xs">
            {/* Filter by Project */}
            <select
              aria-label="تصفية بالمشروع"
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold focus:outline-none"
            >
              <option value="ALL">جميع المشاريع (All Projects)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>

            {/* Filter by Harvest / Spray */}
            <select
              aria-label="تصفية بالقطفة أو المرشة"
              value={filterHarvest}
              onChange={(e) => setFilterHarvest(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 font-bold focus:outline-none"
            >
              <option value="ALL">كل القطافات والمرشات (All Harvests)</option>
              {allHarvests.map((h) => (
                <option key={h} value={h}>
                  🌿 {h}
                </option>
              ))}
            </select>

            {/* Search Input */}
            <div className="relative flex-1 min-w-[150px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث في أسماء المشاريع أو القطفات..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 ps-8 pe-3 py-1.5 text-xs focus:outline-none"
              />
            </div>

            {(filterProject !== "ALL" || filterHarvest !== "ALL" || searchQuery.trim()) && (
              <button
                type="button"
                onClick={() => {
                  setFilterProject("ALL");
                  setFilterHarvest("ALL");
                  setSearchQuery("");
                }}
                className="text-xs text-rose-600 font-bold hover:underline px-2"
              >
                إعادة ضبط
              </button>
            )}
          </div>

          <div className="space-y-3">
            {filteredProjects.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                لا توجد مشاريع أو قطفات مطابقة لمعايير البحث الحالية.
              </div>
            ) : (
              filteredProjects.map((p) => {
                const parent = p.parentProjectId
                  ? projects.find((x) => x.id === p.parentProjectId)
                  : null;
                return (
                  <div
                    key={p.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-sm">{p.name}</span>
                        <span className="accent-badge px-2 py-0.5 rounded text-[11px] font-bold">
                          {p.type}
                        </span>
                        {parent && (
                          <span className="text-xs text-slate-500">
                            (تابع لـ: {parent.name})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        قيمة المشروع: <strong>{fmtNum(p.estimatedValue)} ريال</strong> | ملاحظات:{" "}
                        {p.notes || "—"}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(p.harvests || []).map((h) => (
                          <span
                            key={h}
                            className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold"
                          >
                            🌿 {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}


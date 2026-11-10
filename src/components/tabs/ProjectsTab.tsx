"use client";

import React, { useState } from "react";
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
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold">قائمة المشاريع والقطفات المسجلة</h3>
            <span className="accent-badge text-xs px-2.5 py-1 rounded-lg font-bold">
              {projects.length} مشاريع
            </span>
          </div>
          <div className="space-y-3">
            {projects.map((p) => {
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
            })}
          </div>
        </div>
      </div>
    </section>
  );
}


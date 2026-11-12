"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Briefcase,
  Edit3,
  FilePlus2,
  FolderKanban,
  Lock,
  Plus,
  Store,
  Unlock,
  Wallet,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import type { LanguageCode, UasProject, UasTreasuryAccount, UasUser } from "@/types/uas";
import { SlideOverDrawer } from "@/components/SlideOverDrawer";
import { EmptyState } from "@/components/EmptyState";
import { QuickMasterCreateModal } from "@/components/QuickMasterCreateModal";

interface OwnerVendorOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  phone: string;
}

interface AcquisitionBillRef {
  id: string;
  billNumber: string;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  status: string;
  date: string;
}

interface AcquisitionCycleItem {
  id: string;
  projectId: string;
  project: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    vendorId: string | null;
    ownerVendor?: OwnerVendorOption | null;
  };
  cycleTitle: string;
  startDate: string;
  endDate: string;
  contractAmount: number;
  currency: string;
  status: string;
  notes: string | null;
  totalBilled: number;
  totalPaid: number;
  vendorBills: AcquisitionBillRef[];
}

interface ApiProjectItem {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  nameEn: string;
  type: string;
  vendorId?: string | null;
  ownerVendor?: OwnerVendorOption | null;
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
  treasuryAccounts?: UasTreasuryAccount[];
  currentUser?: UasUser;
  lang: LanguageCode;
  readOnly?: boolean;
  canLock?: boolean;
  canApprove?: boolean;
  canEditRecords?: boolean;
  canEditDate?: boolean;
  onAddProject: (payload: {
    name: string;
    type: string;
    parentProjectId: string;
    vendorId?: string;
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
  treasuryAccounts = [],
  currentUser,
  lang,
  readOnly = false,
  canLock = true,
  canApprove = true,
  canEditRecords = true,
  canEditDate = true,
  onAddProject,
  onAddHarvest,
  onTogglePeriodLock,
  onRefreshState,
  onToast,
}: ProjectsManagerTabProps) {
  const isAr = lang === "ar";
  const [apiProjects, setApiProjects] = useState<ApiProjectItem[]>([]);
  const [vendors, setVendors] = useState<OwnerVendorOption[]>([]);
  const [acquisitions, setAcquisitions] = useState<AcquisitionCycleItem[]>([]);
  const [vendorModalTarget, setVendorModalTarget] = useState<
    null | "project" | "editProject" | "acquisition"
  >(null);

  const [drawerMode, setDrawerMode] = useState<
    null | "project" | "editProject" | "subproject" | "harvest" | "acquisition" | "batchPayment"
  >(null);

  // Create Project state
  const [name, setName] = useState("");
  const [type, setType] = useState("مشروع رئيسي");
  const [parentProjectId, setParentProjectId] = useState(projects[0]?.id || "");
  const [vendorId, setVendorId] = useState("");
  const [budgetTotal, setBudgetTotal] = useState("1000000");
  const [plannedHarvests, setPlannedHarvests] = useState("3");
  const [notes, setNotes] = useState("");

  // Edit Project state
  const [editProjId, setEditProjId] = useState("");
  const [editProjName, setEditProjName] = useState("");
  const [editProjVendorId, setEditProjVendorId] = useState("");
  const [editProjBudget, setEditProjBudget] = useState("");
  const [editProjStatus, setEditProjStatus] = useState("ACTIVE");
  const [editProjNotes, setEditProjNotes] = useState("");

  // Sub-project creator
  const [subTargetProjectId, setSubTargetProjectId] = useState(projects[0]?.id || "");
  const [subNameAr, setSubNameAr] = useState("");
  const [subBudget, setSubBudget] = useState("250000");

  // Harvest creator
  const [harvestProjId, setHarvestProjId] = useState(projects[0]?.id || "");
  const [harvestName, setHarvestName] = useState("");

  // Acquisition Cycle create / edit state
  const [editingAcqId, setEditingAcqId] = useState<string | null>(null);
  const [acqProjectId, setAcqProjectId] = useState(projects[0]?.id || "");
  const [acqVendorId, setAcqVendorId] = useState("");
  const [acqTitle, setAcqTitle] = useState("");
  const [acqStartDate, setAcqStartDate] = useState("2026-11-01");
  const [acqEndDate, setAcqEndDate] = useState("2027-04-30");
  const [acqAmount, setAcqAmount] = useState("500000");
  const [acqCurrency, setAcqCurrency] = useState("YER");
  const [acqStatus, setAcqStatus] = useState("ACTIVE");
  const [acqAutoBill, setAcqAutoBill] = useState(true);
  const [acqCapitalize, setAcqCapitalize] = useState(false);
  const [acqNotes, setAcqNotes] = useState("");

  // Owner Batch Payment Drawer state
  const [payCycle, setPayCycle] = useState<AcquisitionCycleItem | null>(null);
  const [payBillId, setPayBillId] = useState("");
  const [payTreasuryId, setPayTreasuryId] = useState(treasuryAccounts[0]?.id || "");
  const [payAmount, setPayAmount] = useState("100000");
  const [payFee, setPayFee] = useState("0");
  const [payDate, setPayDate] = useState("2026-11-10");
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const actor = currentUser
    ? { userId: currentUser.id, userDisplay: currentUser.name, userRole: currentUser.role }
    : undefined;

  const loadPortfolioData = useCallback(async () => {
    try {
      const [pRes, vRes, aRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/procurement/vendors", { cache: "no-store" }),
        fetch("/api/projects/acquisitions", { cache: "no-store" }),
      ]);
      if (pRes.ok) {
        const pData = (await pRes.json()) as { projects?: ApiProjectItem[] };
        if (pData.projects) setApiProjects(pData.projects);
      }
      if (vRes.ok) {
        const vData = (await vRes.json()) as { vendors?: OwnerVendorOption[] };
        if (vData.vendors) setVendors(vData.vendors);
      }
      if (aRes.ok) {
        const aData = (await aRes.json()) as { acquisitions?: AcquisitionCycleItem[] };
        if (aData.acquisitions) setAcquisitions(aData.acquisitions);
      }
    } catch {
      // keep fallback from props
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/projects", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/procurement/vendors", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/projects/acquisitions", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([pData, vData, aData]) => {
        if (!active) return;
        if (pData?.projects) setApiProjects(pData.projects as ApiProjectItem[]);
        if (vData?.vendors) setVendors(vData.vendors as OwnerVendorOption[]);
        if (aData?.acquisitions) setAcquisitions(aData.acquisitions as AcquisitionCycleItem[]);
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
      vendorId: vendorId || undefined,
      estimatedValue: Number(budgetTotal) || 0,
      plannedHarvests: Math.max(1, Number(plannedHarvests) || 1),
      notes: notes.trim(),
    });
    if (ok) {
      setName("");
      setVendorId("");
      setNotes("");
      setDrawerMode(null);
      await loadPortfolioData();
    }
  }

  function openEditProjectDrawer(proj: ApiProjectItem) {
    setEditProjId(proj.id);
    setEditProjName(proj.nameAr);
    setEditProjVendorId(proj.vendorId || proj.ownerVendor?.id || "");
    setEditProjBudget(String(proj.budgetTotal));
    setEditProjStatus(proj.status || "ACTIVE");
    setEditProjNotes(proj.notes || "");
    setDrawerMode("editProject");
  }

  async function handleSaveEditProject(e: React.FormEvent) {
    e.preventDefault();
    if (!editProjId || !editProjName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editProjId,
        nameAr: editProjName.trim(),
        vendorId: editProjVendorId || null,
        budgetTotal: Number(editProjBudget) || 0,
        status: editProjStatus,
        notes: editProjNotes.trim(),
        actor,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر تعديل بيانات المشروع");
      return;
    }
    setDrawerMode(null);
    onToast("✅ تم تحديث بيانات المشروع والمالك في قاعدة البيانات");
    await Promise.all([loadPortfolioData(), onRefreshState()]);
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
        actor,
      }),
    });
    if (!res.ok) {
      onToast("تعذر إضافة المشروع الفرعي");
      return;
    }
    setSubNameAr("");
    setDrawerMode(null);
    onToast("✅ تم إضافة القطاع / المشروع الفرعي بنجاح");
    await Promise.all([loadPortfolioData(), onRefreshState()]);
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
      setDrawerMode(null);
      await loadPortfolioData();
    }
  }

  function openCreateAcquisition() {
    setEditingAcqId(null);
    const defaultProj = apiProjects[0] || projects[0];
    setAcqProjectId(defaultProj?.id || "");
    setAcqVendorId(
      (defaultProj && "vendorId" in defaultProj ? defaultProj.vendorId : "") ||
        vendors[0]?.id ||
        ""
    );
    setAcqTitle("");
    setAcqStartDate("2026-11-01");
    setAcqEndDate("2027-04-30");
    setAcqAmount("500000");
    setAcqCurrency("YER");
    setAcqStatus("ACTIVE");
    setAcqAutoBill(true);
    setAcqCapitalize(false);
    setAcqNotes("");
    setDrawerMode("acquisition");
  }

  function openEditAcquisition(ac: AcquisitionCycleItem) {
    setEditingAcqId(ac.id);
    setAcqProjectId(ac.projectId);
    setAcqVendorId(ac.project.vendorId || ac.project.ownerVendor?.id || "");
    setAcqTitle(ac.cycleTitle);
    setAcqStartDate(ac.startDate);
    setAcqEndDate(ac.endDate);
    setAcqAmount(String(ac.contractAmount));
    setAcqCurrency(ac.currency);
    setAcqStatus(ac.status);
    setAcqNotes(ac.notes || "");
    setDrawerMode("acquisition");
  }

  async function handleSaveAcquisition(e: React.FormEvent) {
    e.preventDefault();
    if (!acqTitle.trim() || (!editingAcqId && !acqProjectId)) {
      onToast("يرجى إدخال المشروع وعنوان العقد");
      return;
    }
    const isEdit = Boolean(editingAcqId);
    const res = await fetch("/api/projects/acquisitions", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEdit
          ? {
              id: editingAcqId,
              cycleTitle: acqTitle.trim(),
              startDate: acqStartDate,
              endDate: acqEndDate,
              contractAmount: Number(acqAmount) || 0,
              currency: acqCurrency,
              status: acqStatus,
              notes: acqNotes.trim() || null,
              actor,
            }
          : {
              action: "CREATE_CYCLE",
              projectId: acqProjectId,
              vendorId: acqVendorId || undefined,
              cycleTitle: acqTitle.trim(),
              startDate: acqStartDate,
              endDate: acqEndDate,
              contractAmount: Number(acqAmount) || 0,
              currency: acqCurrency,
              status: acqStatus,
              autoGenerateBill: acqAutoBill,
              capitalizeAsset: acqCapitalize,
              notes: acqNotes.trim() || undefined,
              actor,
            }
      ),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر حفظ دورة الاستحواذ");
      return;
    }
    setDrawerMode(null);
    onToast(
      isEdit
        ? "✅ تم تعديل بيانات عقد الاستحواذ بنجاح"
        : "✅ تم تسجيل عقد الاستحواذ وتوليد الالتزام الآلي"
    );
    await Promise.all([loadPortfolioData(), onRefreshState()]);
  }

  async function handleGenerateAcquisitionBill(ac: AcquisitionCycleItem) {
    const res = await fetch("/api/projects/acquisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "GENERATE_BILL",
        projectId: ac.projectId,
        acquisitionCycleId: ac.id,
        vendorId: ac.project.vendorId || ac.project.ownerVendor?.id || undefined,
        amount: ac.contractAmount,
        currency: ac.currency,
        notes: `استحقاق عقد استحواذ: ${ac.cycleTitle}`,
        actor,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر توليد فاتورة الاستحواذ");
      return;
    }
    onToast(`✅ تم اعتماد فاتورة التزام المالك للعقد (${ac.cycleTitle}) وترحيلها للـ GL`);
    await Promise.all([loadPortfolioData(), onRefreshState()]);
  }

  function openOwnerBatchPaymentDrawer(ac: AcquisitionCycleItem) {
    setPayCycle(ac);
    const openBill = ac.vendorBills.find((b) => b.balanceDue > 0);
    setPayBillId(openBill?.id || "");
    setPayTreasuryId(treasuryAccounts[0]?.id || "");
    const suggested = openBill
      ? openBill.balanceDue
      : Math.max(0, ac.contractAmount - ac.totalPaid);
    setPayAmount(String(suggested > 0 ? suggested : ac.contractAmount));
    setPayFee("0");
    setPayDate("2026-11-10");
    setPayRef("");
    setPayNotes(`دفعة سداد مالك المشروع — ${ac.cycleTitle}`);
    setDrawerMode("batchPayment");
  }

  async function handleOwnerBatchPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!payCycle) return;
    const amt = Number(payAmount) || 0;
    if (!payTreasuryId || amt <= 0) {
      onToast("يرجى اختيار الخزينة / البنك وإدخال مبلغ سداد صحيح");
      return;
    }
    const res = await fetch("/api/projects/acquisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "BATCH_PAYMENT",
        projectId: payCycle.projectId,
        acquisitionCycleId: payCycle.id,
        vendorId: payCycle.project.vendorId || payCycle.project.ownerVendor?.id || undefined,
        billId: payBillId || null,
        treasuryId: payTreasuryId,
        amount: amt,
        transferFee: Number(payFee) || 0,
        currency: payCycle.currency,
        date: payDate,
        referenceNumber: payRef.trim() || undefined,
        notes: payNotes.trim() || undefined,
        actor,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      onToast(data.error || "تعذر تنفيذ سند سداد المالك");
      return;
    }
    setDrawerMode(null);
    onToast("✅ تم إصدار سند سداد مالك المشروع وخصم الخزينة وترحيل الـ GL");
    await Promise.all([loadPortfolioData(), onRefreshState()]);
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
          vendorId: p.vendorId || null,
          ownerVendor: p.ownerVendorName
            ? { id: p.vendorId || "", code: "", nameAr: p.ownerVendorName, phone: "" }
            : null,
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

  return (
    <section className="space-y-6">
      <QuickMasterCreateModal
        open={vendorModalTarget !== null}
        mode="vendor"
        currentUser={currentUser}
        onClose={() => setVendorModalTarget(null)}
        onCreatedVendor={(created) => {
          setVendors((prev) => [...prev, created]);
          if (vendorModalTarget === "project") setVendorId(created.id);
          else if (vendorModalTarget === "editProject") setEditProjVendorId(created.id);
          else if (vendorModalTarget === "acquisition") setAcqVendorId(created.id);
        }}
        onToast={onToast}
      />

      {/* Toolbar */}
      <div className="card-surface rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center">
            <FolderKanban className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold">
              {isAr
                ? "إدارة المشاريع ومراكز التكلفة وعقود الاستحواذ"
                : "Projects, Acquisition Cycles & Harvest Controls"}
            </h2>
            <p className="text-xs text-slate-500">
              {isAr
                ? "ربط ملاك المشاريع، متابعة الموازنات، عقود الاستحواذ المتكررة، وسداد دفعات الملاك."
                : "Link project owners, track budgets vs. actuals, recurring acquisition cycles, and batch owner payments."}
            </p>
          </div>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setDrawerMode("project")}
              className="px-3.5 py-2 rounded-xl accent-bg font-extrabold flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{isAr ? "مشروع جديد" : "New Project"}</span>
            </button>
            <button
              type="button"
              onClick={openCreateAcquisition}
              className="px-3.5 py-2 rounded-xl border border-indigo-600/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 font-extrabold flex items-center gap-1.5"
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>{isAr ? "عقد استحواذ / إيجار" : "Acquisition Contract"}</span>
            </button>
            <button
              type="button"
              onClick={() => setDrawerMode("subproject")}
              className="px-3.5 py-2 rounded-xl border border-emerald-600/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 font-bold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isAr ? "قطاع فرعي" : "Sub-Project"}</span>
            </button>
            <button
              type="button"
              onClick={() => setDrawerMode("harvest")}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isAr ? "قطفة جديدة" : "New Harvest"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Full-Width Project Cards with Budget Meters, Owner Vendor & Lock Switches */}
      {displayList.length === 0 ? (
        <EmptyState
          title="لا توجد مشاريع مضافة"
          description="أضف مشروعك الزراعي الأول لبدء تتبع القطفات والموازنة والعمليات."
          actionLabel={!readOnly ? "إضافة مشروع جديد" : undefined}
          onAction={!readOnly ? () => setDrawerMode("project") : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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

                  <div className="flex flex-wrap items-center gap-1.5">
                    {proj.ownerVendor && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold">
                        <Store className="w-3 h-3" />
                        <span>المالك: {proj.ownerVendor.nameAr}</span>
                      </span>
                    )}
                    {proj.metrics.isOverBudget && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 font-extrabold">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>تجاوز الموازنة!</span>
                      </span>
                    )}
                    <span className="px-2.5 py-1 rounded-full accent-badge font-bold">{proj.status}</span>
                    {!readOnly && canEditRecords && (
                      <button
                        type="button"
                        onClick={() => openEditProjectDrawer(proj)}
                        className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-emerald-500 font-bold inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>تعديل</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Budget Envelope Meter */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-2 tabular-nums">
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
                          <div className="text-emerald-600 font-bold tabular-nums">{fmtNum(sp.budget)} YER</div>
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
                        disabled={readOnly || !canLock}
                        title={readOnly || !canLock ? "صلاحية إقفال القطفة مقيدة" : undefined}
                        onClick={async () => {
                          if (readOnly || !canLock) return;
                          await onTogglePeriodLock(`${proj.id}::${hc.name}`);
                          await loadPortfolioData();
                        }}
                        className={`px-3 py-1.5 rounded-xl border font-bold flex items-center gap-1.5 transition disabled:opacity-65 ${
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
      )}

      {/* Project Acquisitions & Owner Batch-Payment Engine */}
      <div className="card-surface rounded-2xl p-5 space-y-4 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
          <div>
            <h3 className="text-sm font-extrabold flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-indigo-600" />
              <span>عقود الاستحواذ المتكررة وسداد مستحقات ملاك المشاريع (Acquisitions &amp; Owner Payouts)</span>
            </h3>
            <p className="text-xs text-slate-500">
              توثيق عقود الاستثمار / الإيجار طويل الأجل لكل فترة، توليد فواتير الالتزام الآلية (2111xx)، وسداد الدفعات من الخزينة
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={openCreateAcquisition}
              className="px-3.5 py-2 rounded-xl accent-bg text-xs font-extrabold inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة عقد / فترة استحواذ</span>
            </button>
          )}
        </div>

        {acquisitions.length === 0 ? (
          <EmptyState
            title="لا توجد عقود استحواذ مشاريع مسجلة"
            description="أضف عقد استحواذ أو إيجار لمشروع مربوط بمالكه لتوليد فواتير الالتزام وجدولة السداد."
            actionLabel={!readOnly ? "إضافة عقد استحواذ" : undefined}
            onAction={!readOnly ? openCreateAcquisition : undefined}
          />
        ) : (
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/60">
                <th className="p-2.5">العقد / الدورة</th>
                <th className="p-2.5">المشروع</th>
                <th className="p-2.5">المالك (المورد)</th>
                <th className="p-2.5">الفترة التعاقدية</th>
                <th className="p-2.5">قيمة العقد</th>
                <th className="p-2.5">المفوتر / المسدد</th>
                <th className="p-2.5">الحالة</th>
                <th className="p-2.5 no-print">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {acquisitions.map((ac) => {
                const remaining = Math.max(0, ac.contractAmount - ac.totalPaid);
                return (
                  <tr key={ac.id}>
                    <td className="p-2.5 font-extrabold">{ac.cycleTitle}</td>
                    <td className="p-2.5">
                      <span className="font-mono text-[10px] text-slate-400 me-1">{ac.project.code}</span>
                      <span>{ac.project.nameAr}</span>
                    </td>
                    <td className="p-2.5 font-bold text-indigo-700 dark:text-indigo-300">
                      {ac.project.ownerVendor?.nameAr || "— غير مربوط بمالك"}
                    </td>
                    <td className="p-2.5 font-mono text-[11px]">
                      {ac.startDate} → {ac.endDate}
                    </td>
                    <td className="p-2.5 font-extrabold tabular-nums">
                      {fmtNum(ac.contractAmount)} {ac.currency}
                    </td>
                    <td className="p-2.5 tabular-nums">
                      <div className="text-slate-600 dark:text-slate-300">
                        فواتير: {fmtNum(ac.totalBilled)}
                      </div>
                      <div className="text-emerald-600 font-bold">
                        مسدد: {fmtNum(ac.totalPaid)} | متبقي: {fmtNum(remaining)}
                      </div>
                    </td>
                    <td className="p-2.5">
                      <span className="px-2 py-0.5 rounded-full accent-badge font-bold text-[10px]">
                        {ac.status}
                      </span>
                    </td>
                    <td className="p-2.5 no-print">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!readOnly && canEditRecords && (
                          <button
                            type="button"
                            onClick={() => openEditAcquisition(ac)}
                            className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-bold hover:border-emerald-500"
                          >
                            تعديل
                          </button>
                        )}
                        {!readOnly && canApprove && ac.totalBilled < ac.contractAmount && (
                          <button
                            type="button"
                            onClick={() => void handleGenerateAcquisitionBill(ac)}
                            className="px-2 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold inline-flex items-center gap-1"
                          >
                            <FilePlus2 className="w-3 h-3" />
                            <span>توليد فاتورة</span>
                          </button>
                        )}
                        {!readOnly && ac.project.vendorId && (
                          <button
                            type="button"
                            onClick={() => openOwnerBatchPaymentDrawer(ac)}
                            className="px-2.5 py-1 rounded-lg accent-bg font-bold inline-flex items-center gap-1"
                          >
                            <Wallet className="w-3 h-3" />
                            <span>سداد المالك</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Project Drawer */}
      <SlideOverDrawer
        open={drawerMode === "project" && !readOnly}
        onClose={() => setDrawerMode(null)}
        title={isAr ? "إضافة مشروع رئيسي / فرعي" : "Create Main / Sub Project"}
        subtitle={isAr ? "تعريف المشروع وربطه بمالكه وموازنته التقديرية" : "Define project, owner vendor & budget"}
      >
        <form onSubmit={handleCreateProject} className="space-y-3 text-xs">
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
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold">مالك المشروع / المؤجر (مورد 2111xx)</label>
              <button
                type="button"
                onClick={() => setVendorModalTarget("project")}
                className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>مورد / مالك جديد</span>
              </button>
            </div>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="">— بدون ربط مالك حالياً —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={budgetTotal}
              onChange={(e) => setBudgetTotal(e.target.value)}
              placeholder="الموازنة (YER)"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
            />
            <input
              type="number"
              value={plannedHarvests}
              onChange={(e) => setPlannedHarvests(e.target.value)}
              min={1}
              max={20}
              placeholder="عدد القطفات"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
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
      </SlideOverDrawer>

      {/* Edit Project Drawer */}
      <SlideOverDrawer
        open={drawerMode === "editProject" && !readOnly && canEditRecords}
        onClose={() => setDrawerMode(null)}
        title="تعديل بيانات المشروع والمالك"
        subtitle="تحديث الاسم والموازنة وحالة المشروع والمورد المالك مع توثيق Audit Diff"
      >
        <form onSubmit={handleSaveEditProject} className="space-y-3 text-xs">
          <div>
            <label className="block font-bold mb-1">اسم المشروع *</label>
            <input
              value={editProjName}
              onChange={(e) => setEditProjName(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold">مالك المشروع (المورد)</label>
              <button
                type="button"
                onClick={() => setVendorModalTarget("editProject")}
                className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>مورد جديد</span>
              </button>
            </div>
            <select
              value={editProjVendorId}
              onChange={(e) => setEditProjVendorId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            >
              <option value="">— غير مرتبط بمالك —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">الموازنة التقديرية (YER)</label>
              <input
                type="number"
                value={editProjBudget}
                onChange={(e) => setEditProjBudget(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">الحالة</label>
              <select
                value={editProjStatus}
                onChange={(e) => setEditProjStatus(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                <option value="ACTIVE">ACTIVE (نشط)</option>
                <option value="PAUSED">PAUSED (متوقف مؤقتاً)</option>
                <option value="COMPLETED">COMPLETED (مكتمل)</option>
              </select>
            </div>
          </div>
          <input
            value={editProjNotes}
            onChange={(e) => setEditProjNotes(e.target.value)}
            placeholder="ملاحظات المشروع..."
            className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
            حفظ تعديلات المشروع
          </button>
        </form>
      </SlideOverDrawer>

      {/* Create / Edit Acquisition Cycle Drawer */}
      <SlideOverDrawer
        open={drawerMode === "acquisition" && !readOnly}
        onClose={() => setDrawerMode(null)}
        title={editingAcqId ? "تعديل عقد استحواذ المشروع" : "إضافة عقد / دورة استحواذ مشروع"}
        subtitle="إبرام عقد الفترة وتوليد فاتورة التزام المالك آلياً"
      >
        <form onSubmit={handleSaveAcquisition} className="space-y-3 text-xs">
          {!editingAcqId && (
            <>
              <div>
                <label className="block font-bold mb-1">المشروع *</label>
                <select
                  value={acqProjectId}
                  onChange={(e) => setAcqProjectId(e.target.value)}
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
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold">مالك المشروع (المورد)</label>
                  <button
                    type="button"
                    onClick={() => setVendorModalTarget("acquisition")}
                    className="text-[11px] font-extrabold text-emerald-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>مورد / مالك جديد</span>
                  </button>
                </div>
                <select
                  value={acqVendorId}
                  onChange={(e) => setAcqVendorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  <option value="">الاعتماد على المالك المرتبط بالمشروع</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} — {v.nameAr}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block font-bold mb-1">عنوان العقد / الفترة *</label>
            <input
              type="text"
              required
              value={acqTitle}
              onChange={(e) => setAcqTitle(e.target.value)}
              placeholder="مثال: عقد استثمار موسم 2026-2027"
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-bold mb-1">تاريخ البدء *</label>
              <input
                type="date"
                value={acqStartDate}
                disabled={Boolean(editingAcqId) && !canEditDate}
                onChange={(e) => setAcqStartDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">تاريخ الانتهاء *</label>
              <input
                type="date"
                value={acqEndDate}
                disabled={Boolean(editingAcqId) && !canEditDate}
                onChange={(e) => setAcqEndDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-60"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block font-bold mb-1">قيمة التعاقد *</label>
              <input
                type="number"
                min={1}
                value={acqAmount}
                onChange={(e) => setAcqAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">العملة</label>
              <select
                value={acqCurrency}
                onChange={(e) => setAcqCurrency(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                <option value="YER">YER</option>
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          {!editingAcqId && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-2 border border-slate-200 dark:border-slate-700">
              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={acqAutoBill}
                  onChange={(e) => setAcqAutoBill(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                />
                <span>توليد فاتورة التزام المالك آلياً وترحيلها للـ GL</span>
              </label>
              {acqAutoBill && (
                <label className="inline-flex items-center gap-2 font-bold cursor-pointer block">
                  <input
                    type="checkbox"
                    checked={acqCapitalize}
                    onChange={(e) => setAcqCapitalize(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 w-4 h-4"
                  />
                  <span>رسملة العقد كأصل مشروع (121100) بدلاً من تكلفة استئجار (512000)</span>
                </label>
              )}
            </div>
          )}

          {editingAcqId && (
            <div>
              <label className="block font-bold mb-1">حالة العقد</label>
              <select
                value={acqStatus}
                onChange={(e) => setAcqStatus(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                <option value="ACTIVE">ACTIVE (نشط)</option>
                <option value="COMPLETED">COMPLETED (منتهي)</option>
                <option value="CANCELLED">CANCELLED (ملغى)</option>
              </select>
            </div>
          )}

          <input
            type="text"
            value={acqNotes}
            onChange={(e) => setAcqNotes(e.target.value)}
            placeholder="شروط وملاحظات التعاقد..."
            className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
            {editingAcqId ? "حفظ تعديلات العقد" : "+ اعتماد عقد الاستحواذ"}
          </button>
        </form>
      </SlideOverDrawer>

      {/* Owner Batch Payment Drawer */}
      <SlideOverDrawer
        open={drawerMode === "batchPayment" && Boolean(payCycle) && !readOnly}
        onClose={() => setDrawerMode(null)}
        title="سداد دفعة لمالك المشروع (Owner Batch Payment)"
        subtitle={payCycle ? `${payCycle.project.nameAr} — ${payCycle.cycleTitle}` : ""}
      >
        {payCycle && (
          <form onSubmit={handleOwnerBatchPayment} className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
              <div className="font-bold">
                المالك: {payCycle.project.ownerVendor?.nameAr || "—"}
              </div>
              <div className="text-slate-500 tabular-nums">
                قيمة العقد: {fmtNum(payCycle.contractAmount)} {payCycle.currency} • المسدد:{" "}
                {fmtNum(payCycle.totalPaid)}
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">الخزينة / البنك / المحفظة المسدد منها *</label>
              <select
                value={payTreasuryId}
                onChange={(e) => setPayTreasuryId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
              >
                {treasuryAccounts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameAr || t.name} ({fmtNum(t.balanceYER)} YER)
                  </option>
                ))}
              </select>
            </div>

            {payCycle.vendorBills.length > 0 && (
              <div>
                <label className="block font-bold mb-1">الفاتورة المرتبطة (اختياري)</label>
                <select
                  value={payBillId}
                  onChange={(e) => setPayBillId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
                >
                  <option value="">دفعة عامة على حساب المالك</option>
                  {payCycle.vendorBills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.billNumber} (متبقي: {fmtNum(b.balanceDue)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold mb-1">مبلغ الدفعة ({payCycle.currency}) *</label>
                <input
                  type="number"
                  min={1}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">رسوم التحويل (531200)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={payFee}
                  onChange={(e) => setPayFee(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-bold mb-1">تاريخ السداد</label>
                <input
                  type="date"
                  value={payDate}
                  disabled={!canEditDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">مرجع التحويل / الشيك</label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="REF-001"
                  className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 font-mono"
                />
              </div>
            </div>

            <input
              type="text"
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              placeholder="بيان الدفعة..."
              className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2"
            />
            <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-extrabold">
              اعتماد سند سداد المالك وترحيل القيد
            </button>
          </form>
        )}
      </SlideOverDrawer>

      <SlideOverDrawer
        open={drawerMode === "subproject" && !readOnly}
        onClose={() => setDrawerMode(null)}
        title="إضافة قطاع فرعي (Sub-Project Cost Center)"
        subtitle="ربط مركز تكلفة فرعي بمشروع رئيسي"
      >
        <form onSubmit={handleAddSubProject} className="space-y-3 text-xs">
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
            className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 tabular-nums"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold">
            + إضافة القطاع الفرعي
          </button>
        </form>
      </SlideOverDrawer>

      <SlideOverDrawer
        open={drawerMode === "harvest" && !readOnly}
        onClose={() => setDrawerMode(null)}
        title="إضافة قطفة / مرشة جديدة"
        subtitle="إنشاء دورة حصاد جديدة ضمن المشروع المختار"
      >
        <form onSubmit={handleCreateHarvest} className="space-y-3 text-xs">
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
          <button type="submit" className="w-full py-2.5 rounded-xl accent-bg font-bold">
            + إضافة القطفة
          </button>
        </form>
      </SlideOverDrawer>
    </section>
  );
}

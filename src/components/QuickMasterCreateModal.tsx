"use client";

import React, { useEffect, useState } from "react";
import { BookOpen, Plus, Store, UserPlus, X } from "lucide-react";
import type { UasUser } from "@/types/uas";

export type MasterCreateMode = "vendor" | "customer" | "coa";

export interface CreatedVendorResult {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  phone: string;
  accountId: string;
}

export interface CreatedCustomerResult {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  nameEn?: string | null;
  phone: string;
  address?: string | null;
  creditLimit?: number;
  accountId: string;
}

export interface CreatedCoaResult {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  type: string;
  isPosting: boolean;
}

interface CoaParentOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  type: string;
  isPosting: boolean;
  parentId?: string | null;
  lineageChain?: Array<{
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    level: number;
  }>;
}

interface QuickMasterCreateModalProps {
  open: boolean;
  mode: MasterCreateMode;
  currentUser?: UasUser;
  defaultParentCode?: string;
  onClose: () => void;
  onCreatedVendor?: (vendor: CreatedVendorResult) => void;
  onCreatedCustomer?: (customer: CreatedCustomerResult) => void;
  onCreatedCoa?: (account: CreatedCoaResult) => void;
  onToast: (msg: string) => void;
}

export function QuickMasterCreateModal({
  open,
  mode,
  currentUser,
  defaultParentCode,
  onClose,
  onCreatedVendor,
  onCreatedCustomer,
  onCreatedCoa,
  onToast,
}: QuickMasterCreateModalProps) {
  const [submitting, setSubmitting] = useState(false);

  // Vendor / Customer shared fields
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxReg, setTaxReg] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimit, setCreditLimit] = useState("500000");

  // 6-Generation COA fields
  const [coaParents, setCoaParents] = useState<CoaParentOption[]>([]);
  const [parentId, setParentId] = useState("__GEN1_ROOT__");
  const [coaCode, setCoaCode] = useState("");
  const [rootType, setRootType] = useState("EXPENSE");

  useEffect(() => {
    if (!open || mode !== "coa") return;
    let active = true;
    fetch("/api/accounting/coa", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { flat?: CoaParentOption[] } | null) => {
        if (!active || !data?.flat) return;
        // Include summary nodes from level 1 up to level 5 (parents capable of holding children)
        const eligibleParents = data.flat.filter((a) => a.level < 6);
        setCoaParents(eligibleParents);
        const preferred =
          (defaultParentCode && eligibleParents.find((a) => a.code === defaultParentCode)) ||
          eligibleParents.find((a) => a.level === 4) ||
          eligibleParents[0];
        if (preferred) setParentId(preferred.id);
        else setParentId("__GEN1_ROOT__");
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [open, mode, defaultParentCode]);

  if (!open) return null;

  const actor = currentUser
    ? {
        userId: currentUser.id,
        userDisplay: currentUser.name,
        userRole: currentUser.role,
      }
    : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameAr.trim()) {
      onToast("يرجى إدخال الاسم العربي");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "vendor") {
        const res = await fetch("/api/procurement/vendors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nameAr: nameAr.trim(),
            nameEn: nameEn.trim() || undefined,
            phone: phone.trim() || "777000000",
            email: email.trim() || undefined,
            taxRegistration: taxReg.trim() || undefined,
            address: address.trim() || undefined,
            actor,
          }),
        });
        const data = (await res.json()) as { error?: string; vendor?: CreatedVendorResult };
        if (!res.ok || !data.vendor) {
          onToast(data.error || "تعذر إنشاء ملف المورد");
          return;
        }
        onToast(`✅ تم إنشاء المورد (${data.vendor.nameAr}) وفتح حساب ذمم 2111xx`);
        onCreatedVendor?.(data.vendor);
        resetAndClose();
        return;
      }

      if (mode === "customer") {
        const res = await fetch("/api/sales/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nameAr: nameAr.trim(),
            nameEn: nameEn.trim() || undefined,
            phone: phone.trim() || "777000000",
            address: address.trim() || undefined,
            creditLimit: Number(creditLimit) || 0,
            actor,
          }),
        });
        const data = (await res.json()) as { error?: string; customer?: CreatedCustomerResult };
        if (!res.ok || !data.customer) {
          onToast(data.error || "تعذر إنشاء ملف العميل");
          return;
        }
        onToast(`✅ تم إنشاء العميل (${data.customer.nameAr}) وفتح حساب ذمم 1131xx`);
        onCreatedCustomer?.(data.customer);
        resetAndClose();
        return;
      }

      const isRoot = parentId === "__GEN1_ROOT__" || !parentId;
      const res = await fetch("/api/accounting/coa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: isRoot ? undefined : parentId,
          level: isRoot ? 1 : undefined,
          type: isRoot ? rootType : undefined,
          code: coaCode.trim() || undefined,
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim() || nameAr.trim(),
          actor,
        }),
      });
      const data = (await res.json()) as { error?: string; account?: CreatedCoaResult };
      if (!res.ok || !data.account) {
        onToast(data.error || "تعذر إنشاء الحساب المحاسبي");
        return;
      }
      onToast(`✅ تم فتح الحساب الهرمي [${data.account.code}] ${data.account.nameAr} (الجيل ${data.account.level})`);
      onCreatedCoa?.(data.account);
      resetAndClose();
    } catch {
      onToast("تعذر الاتصال بالخادم");
    } finally {
      setSubmitting(false);
    }
  }

  function resetAndClose() {
    setNameAr("");
    setNameEn("");
    setPhone("");
    setEmail("");
    setTaxReg("");
    setAddress("");
    setCoaCode("");
    onClose();
  }

  const titleMap: Record<MasterCreateMode, string> = {
    vendor: "إضافة مورد / مالك مشروع جديد",
    customer: "إضافة عميل جديد (ذمم مدينة 1131xx)",
    coa: "إنشاء حساب تفصيلي من المستوى الخامس (Tier-5 COA)",
  };

  const subtitleMap: Record<MasterCreateMode, string> = {
    vendor: "إنشاء فوري مع فتح حساب أستاذ فرعي ضمن ذمم الموردين (2111xx)",
    customer: "إنشاء فوري مع ربط آلي بشجرة الحسابات وحد ائتماني",
    coa: "اختر الحساب الرقابي الأب (T4) ليتم فتح حساب ترحيل (T5 Posting) فوري",
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 no-print"
      onClick={resetAndClose}
    >
      <div
        className="card-surface rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl accent-bg flex items-center justify-center shrink-0">
              {mode === "vendor" ? (
                <Store className="w-5 h-5" />
              ) : mode === "customer" ? (
                <UserPlus className="w-5 h-5" />
              ) : (
                <BookOpen className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-extrabold">{titleMap[mode]}</h3>
              <p className="text-[11px] text-slate-500">{subtitleMap[mode]}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {mode === "coa" && (
            <div className="space-y-2.5">
              <div>
                <label className="block font-bold mb-1">
                  الحساب الأب (المسار الهرمي من الجيل 1 إلى 5) *
                </label>
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-medium"
                >
                  <option value="__GEN1_ROOT__">
                    -- إنشاء فئة رئيسية جديدة (الجيل 1 / Main Class Root) --
                  </option>
                  {coaParents.map((p) => (
                    <option key={p.id} value={p.id}>
                      [الجيل {p.level}] {p.code} — {p.nameAr} ({p.type})
                    </option>
                  ))}
                </select>
              </div>

              {parentId === "__GEN1_ROOT__" && (
                <div>
                  <label className="block font-bold mb-1">نوع الفئة المحاسبية *</label>
                  <select
                    value={rootType}
                    onChange={(e) => setRootType(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-bold"
                  >
                    <option value="ASSET">أصول (ASSET)</option>
                    <option value="LIABILITY">خصوم / التزامات (LIABILITY)</option>
                    <option value="EQUITY">حقوق ملكية (EQUITY)</option>
                    <option value="REVENUE">إيرادات (REVENUE)</option>
                    <option value="EXPENSE">مصروفات وتكاليف (EXPENSE)</option>
                  </select>
                </div>
              )}

              {/* Visual 6-Generation Lineage Cascade Banner */}
              {(() => {
                const selectedParent = coaParents.find((p) => p.id === parentId);
                const targetLevel = selectedParent ? selectedParent.level + 1 : 1;
                const isPostingLeaf = targetLevel >= 5;
                return (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40 p-2.5 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-500">
                        مسار النسب الشجري (Lineage Chain):
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isPostingLeaf
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300"
                            : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        الهدف: الجيل {targetLevel} • {isPostingLeaf ? "حساب ترحيل (Posting Leaf)" : "حساب تجميعي (Summary Header)"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-700 dark:text-slate-300">
                      {selectedParent?.lineageChain?.map((l) => (
                        <React.Fragment key={l.id}>
                          <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono">
                            G{l.level}: {l.code} • {l.nameAr}
                          </span>
                          <span className="text-slate-400">←</span>
                        </React.Fragment>
                      ))}
                      <span className="px-2 py-0.5 rounded bg-emerald-500 text-white font-extrabold font-mono shadow-sm">
                        G{targetLevel} الجديد: {coaCode.trim() || "آلي"} • {nameAr.trim() || "الحساب الجديد"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">الاسم العربي *</label>
              <input
                type="text"
                required
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder={
                  mode === "vendor"
                    ? "مثال: مؤسسة الإمداد الزراعي"
                    : mode === "customer"
                    ? "مثال: عميل تجاري جديد"
                    : "مثال: مصروف صيانة مضخة"
                }
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">English Name</label>
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="Optional English title"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
              />
            </div>
          </div>

          {mode === "coa" ? (
            <div>
              <label className="block font-bold mb-1">الرمز المحاسبي (اختياري — يتولد آلياً)</label>
              <input
                type="text"
                value={coaCode}
                onChange={(e) => setCoaCode(e.target.value)}
                placeholder="اتركه فارغاً للتوليد التسلسلي الآلي"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono"
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">رقم الهاتف *</label>
                  <input
                    type="text"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="777000000"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                  />
                </div>
                {mode === "vendor" ? (
                  <div>
                    <label className="block font-bold mb-1">الرقم الضريبي</label>
                    <input
                      type="text"
                      value={taxReg}
                      onChange={(e) => setTaxReg(e.target.value)}
                      placeholder="اختياري"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block font-bold mb-1">الحد الائتماني (YER)</label>
                    <input
                      type="number"
                      min={0}
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 tabular-nums"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">العنوان</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="المدينة / المنطقة"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                  />
                </div>
                {mode === "vendor" && (
                  <div>
                    <label className="block font-bold mb-1">البريد الإلكتروني</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="vendor@example.com"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2"
                    />
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={resetAndClose}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl accent-bg font-extrabold inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Plus className="w-4 h-4" />
              <span>{submitting ? "جاري الحفظ..." : "حفظ وإضافة"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


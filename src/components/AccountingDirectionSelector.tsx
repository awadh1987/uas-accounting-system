"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, FolderTree, PlusCircle, Search, Sparkles } from "lucide-react";

export interface CustomAccountPayload {
  nameAr: string;
  nameEn?: string;
  parentCode: string;
  code?: string;
}

export interface AccountingDirectionValue {
  accountId?: string;
  accountCode?: string;
  isCustom: boolean;
  customAccount?: CustomAccountPayload;
}

export interface AccountOptionNode {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  type: string;
  isPosting: boolean;
  parentId: string | null;
  lineageChain?: Array<{
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    level: number;
  }>;
}

interface AccountingDirectionSelectorProps {
  value?: AccountingDirectionValue | string;
  onChange: (val: AccountingDirectionValue) => void;
  allowedTypes?: string[]; // e.g. ["EXPENSE", "ASSET"] or undefined for all
  defaultParentCode?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function AccountingDirectionSelector({
  value,
  onChange,
  allowedTypes,
  defaultParentCode,
  label = "التوجيه المحاسبي (حساب الترحيل)",
  placeholder = "اختر حساب التوجيه المحاسبي...",
  required = false,
  disabled = false,
  className = "",
}: AccountingDirectionSelectorProps) {
  const [accounts, setAccounts] = useState<AccountOptionNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  // Normalize current value
  const currentValue: AccountingDirectionValue = useMemo(() => {
    if (!value) return { isCustom: false };
    if (typeof value === "string") {
      return {
        accountId: value.length > 10 ? value : undefined,
        accountCode: value.length <= 10 ? value : undefined,
        isCustom: false,
      };
    }
    return value;
  }, [value]);

  const [isCustomMode, setIsCustomMode] = useState<boolean>(Boolean(currentValue.isCustom));
  const [customNameAr, setCustomNameAr] = useState(currentValue.customAccount?.nameAr || "");
  const [customNameEn, setCustomNameEn] = useState(currentValue.customAccount?.nameEn || "");
  const [customParentCode, setCustomParentCode] = useState(
    currentValue.customAccount?.parentCode || defaultParentCode || ""
  );
  const [customCode, setCustomCode] = useState(currentValue.customAccount?.code || "");

  // Load COA accounts
  useEffect(() => {
    let active = true;
    fetch("/api/accounting/coa", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { flat?: AccountOptionNode[] } | null) => {
        if (!active || !data?.flat) return;
        setAccounts(data.flat);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Filter eligible posting leaf accounts (isPosting === true)
  const postingAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (!a.isPosting) return false;
      if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(a.type)) {
        return false;
      }
      return true;
    });
  }, [accounts, allowedTypes]);

  // Eligible parent summary accounts for custom account creation (Gen 1-5, isPosting === false or summary)
  const potentialParents = useMemo(() => {
    return accounts.filter((a) => {
      if (a.level >= 6) return false;
      if (allowedTypes && allowedTypes.length > 0 && !allowedTypes.includes(a.type)) {
        return false;
      }
      return true;
    });
  }, [accounts, allowedTypes]);

  // Effective parent code for custom account
  const effectiveParentCode = useMemo(() => {
    if (customParentCode) return customParentCode;
    if (defaultParentCode && potentialParents.some((p) => p.code === defaultParentCode)) {
      return defaultParentCode;
    }
    const l4 = potentialParents.find((p) => p.level === 4);
    if (l4) return l4.code;
    return potentialParents[0]?.code || "";
  }, [customParentCode, defaultParentCode, potentialParents]);

  // Selected account node
  const selectedNode = useMemo(() => {
    if (isCustomMode) return null;
    if (currentValue.accountId) {
      return postingAccounts.find((a) => a.id === currentValue.accountId);
    }
    if (currentValue.accountCode) {
      return postingAccounts.find((a) => a.code === currentValue.accountCode);
    }
    return null;
  }, [isCustomMode, currentValue, postingAccounts]);

  // Selected parent node for custom account
  const selectedCustomParentNode = useMemo(() => {
    return accounts.find((a) => a.code === effectiveParentCode) || null;
  }, [accounts, effectiveParentCode]);

  // Auto-suggested code
  const suggestedCode = useMemo(() => {
    if (!selectedCustomParentNode) return "";
    const parent = selectedCustomParentNode;
    const siblings = accounts.filter((a) => a.parentId === parent.id);
    if (parent.level === 5) {
      if (siblings.length === 0) return `${parent.code}01`;
      let maxSuffix = 0;
      for (const s of siblings) {
        if (s.code.startsWith(parent.code)) {
          const suf = parseInt(s.code.slice(parent.code.length), 10);
          if (Number.isFinite(suf) && suf > maxSuffix) maxSuffix = suf;
        }
      }
      return `${parent.code}${String(maxSuffix + 1).padStart(2, "0")}`;
    }
    if (parent.level === 4) {
      if (siblings.length === 0) {
        if (parent.code.endsWith("00") && parent.code.length === 6) {
          return `${parent.code.slice(0, 4)}01`;
        }
        return `${parent.code}01`;
      }
      let maxVal = 0;
      for (const s of siblings) {
        const val = parseInt(s.code, 10);
        if (Number.isFinite(val) && val > maxVal) maxVal = val;
      }
      return String(maxVal + 1);
    }
    return `${parent.code}01`;
  }, [selectedCustomParentNode, accounts]);

  const activeCustomCode = customCode || suggestedCode;

  // Filtered dropdown list
  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return postingAccounts;
    const q = search.trim().toLowerCase();
    return postingAccounts.filter((a) => {
      if (a.code.toLowerCase().includes(q) || a.nameAr.toLowerCase().includes(q) || a.nameEn.toLowerCase().includes(q)) {
        return true;
      }
      if (a.lineageChain?.some((l) => l.nameAr.toLowerCase().includes(q) || l.code.includes(q))) {
        return true;
      }
      return false;
    });
  }, [postingAccounts, search]);

  function handleSelectStandard(account: AccountOptionNode) {
    setIsCustomMode(false);
    setIsOpen(false);
    onChange({
      accountId: account.id,
      accountCode: account.code,
      isCustom: false,
    });
  }

  function handleSwitchToCustom() {
    setIsCustomMode(true);
    setIsOpen(false);
    onChange({
      isCustom: true,
      customAccount: {
        nameAr: customNameAr.trim(),
        nameEn: customNameEn.trim() || undefined,
        parentCode: effectiveParentCode,
        code: activeCustomCode.trim() || undefined,
      },
    });
  }

  function handleCustomFieldChange(updates: Partial<CustomAccountPayload>) {
    const nextNameAr = updates.nameAr !== undefined ? updates.nameAr : customNameAr;
    const nextNameEn = updates.nameEn !== undefined ? updates.nameEn : customNameEn;
    const nextParent = updates.parentCode !== undefined ? updates.parentCode : effectiveParentCode;
    const nextCode = updates.code !== undefined ? updates.code : activeCustomCode;

    if (updates.nameAr !== undefined) setCustomNameAr(updates.nameAr);
    if (updates.nameEn !== undefined) setCustomNameEn(updates.nameEn);
    if (updates.parentCode !== undefined) setCustomParentCode(updates.parentCode);
    if (updates.code !== undefined) setCustomCode(updates.code);

    onChange({
      isCustom: true,
      customAccount: {
        nameAr: nextNameAr.trim(),
        nameEn: nextNameEn.trim() || undefined,
        parentCode: nextParent,
        code: nextCode.trim() || undefined,
      },
    });
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex items-center justify-between text-xs">
          <label className="font-bold text-slate-700 dark:text-slate-300">
            {label} {required && <span className="text-rose-500">*</span>}
          </label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (isCustomMode) {
                setIsCustomMode(false);
                if (postingAccounts.length > 0) {
                  handleSelectStandard(postingAccounts[0]);
                }
              } else {
                handleSwitchToCustom();
              }
            }}
            className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>
              {isCustomMode
                ? "← العودة إلى قائمة الحسابات القياسية"
                : "أخرى — تسمية حساب توجيه مخصص (Free-Named)"}
            </span>
          </button>
        </div>
      )}

      {/* Mode A: Standard Account Selection */}
      {!isCustomMode ? (
        <div className="relative">
          <button
            type="button"
            disabled={disabled || loading}
            onClick={() => setIsOpen((prev) => !prev)}
            className="w-full text-right rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs transition flex items-center justify-between hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
          >
            {selectedNode ? (
              <div className="truncate text-start flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-700 dark:text-slate-300">
                    {selectedNode.code}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 truncate">
                    {selectedNode.nameAr}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold shrink-0">
                    الجيل {selectedNode.level} (حساب ترحيل)
                  </span>
                </div>
                {selectedNode.lineageChain && selectedNode.lineageChain.length > 1 && (
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">
                    {selectedNode.lineageChain
                      .slice(0, -1)
                      .map((l) => l.nameAr)
                      .join(" > ")}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-slate-400">{loading ? "جاري تحميل الدليل..." : placeholder}</span>
            )}
            <FolderTree className="w-4 h-4 text-slate-400 shrink-0 mr-2" />
          </button>

          {/* Searchable Dropdown Popup */}
          {isOpen && (
            <div className="absolute z-50 mt-1 w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl p-2 space-y-2 max-h-72 flex flex-col">
              <div className="relative shrink-0">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث بالرمز أو اسم الحساب أو المجموعة..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 pr-8 pl-3 py-1.5 text-xs focus:outline-none"
                />
              </div>

              {/* Special Option: Create / Free-name custom account */}
              <button
                type="button"
                onClick={handleSwitchToCustom}
                className="w-full text-right p-2 rounded-xl border border-dashed border-emerald-400/80 bg-emerald-50/60 dark:bg-emerald-950/30 hover:bg-emerald-100/70 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 text-xs font-bold transition flex items-center justify-between shrink-0"
              >
                <div className="flex items-center gap-1.5">
                  <PlusCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <div>أخرى — تسمية حساب توجيه مخصص (Free Named Account)</div>
                    <div className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                      إنشاء حساب ترحيلي وتوجيه القيد عليه تلقائياً
                    </div>
                  </div>
                </div>
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              </button>

              {/* Accounts List */}
              <div className="overflow-y-auto space-y-1 flex-1 pr-0.5">
                {filteredAccounts.length === 0 ? (
                  <div className="text-center py-4 text-xs text-slate-400">
                    لا توجد حسابات ترحيل مطابقة
                  </div>
                ) : (
                  filteredAccounts.map((acc) => {
                    const isCurrent =
                      currentValue.accountId === acc.id || currentValue.accountCode === acc.code;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => handleSelectStandard(acc)}
                        className={`w-full text-right p-2 rounded-xl text-xs transition flex flex-col gap-0.5 ${
                          isCurrent
                            ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700"
                            : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[11px] font-bold px-1.5 py-0.2 rounded bg-slate-200/80 dark:bg-slate-700">
                              {acc.code}
                            </span>
                            <span className="font-bold truncate">{acc.nameAr}</span>
                          </div>
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0">
                            الجيل {acc.level}
                          </span>
                        </div>
                        {acc.lineageChain && acc.lineageChain.length > 1 && (
                          <div className="text-[10px] text-slate-400 truncate pr-1">
                            {acc.lineageChain
                              .slice(0, -1)
                              .map((l) => l.nameAr)
                              .join(" > ")}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Mode B: Atomic "Other" Custom Free-Named Account Creator */
        <div className="rounded-2xl border-2 border-emerald-500/50 bg-emerald-50/20 dark:bg-emerald-950/20 p-3 space-y-2.5">
          <div className="flex items-center justify-between border-b border-emerald-200 dark:border-emerald-800 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-200">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>إنشاء حساب توجيه محاسبي مخصص ذرياً (Other / Custom Account)</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsCustomMode(false);
                if (postingAccounts.length > 0) {
                  handleSelectStandard(postingAccounts[0]);
                }
              }}
              className="text-[11px] text-slate-500 hover:text-slate-800 underline"
            >
              إلغاء التخصيص
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold mb-1">اسم الحساب المخصص بالعربية *</label>
              <input
                type="text"
                required
                value={customNameAr}
                onChange={(e) => handleCustomFieldChange({ nameAr: e.target.value })}
                placeholder="مثال: مصروف وقود مولدات إضافي / سماد عضوي مركب"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-1">الاسم بالإنجليزية (اختياري)</label>
              <input
                type="text"
                value={customNameEn}
                onChange={(e) => handleCustomFieldChange({ nameEn: e.target.value })}
                placeholder="Custom Account Name in English"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-sans"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold mb-1">
                الحساب الأب (المجموعة من الجيل 1 إلى 5) *
              </label>
              <select
                value={effectiveParentCode}
                onChange={(e) => handleCustomFieldChange({ parentCode: e.target.value })}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-semibold"
              >
                {potentialParents.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.code} — {p.nameAr} (الجيل {p.level})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-1">الرمز المقترح (آلي)</label>
              <input
                type="text"
                value={activeCustomCode}
                onChange={(e) => handleCustomFieldChange({ code: e.target.value })}
                placeholder="يتولد آلياً"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-mono font-bold"
              />
            </div>
          </div>

          {/* Lineage Visual Chain Preview */}
          {selectedCustomParentNode && (
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800/80 p-2 text-[10px] space-y-1">
              <div className="font-bold text-slate-500">
                المسار الشجري للحساب المخصص الجديد (Lineage Chain):
              </div>
              <div className="flex flex-wrap items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                {selectedCustomParentNode.lineageChain?.map((ancestor) => (
                  <React.Fragment key={ancestor.id}>
                    <span className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono">
                      G{ancestor.level}: {ancestor.code} • {ancestor.nameAr}
                    </span>
                    <ChevronRight className="w-3 h-3 text-slate-400 rotate-180" />
                  </React.Fragment>
                ))}
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-300 dark:border-emerald-700">
                  G{selectedCustomParentNode.level + 1} (الجديد): {customCode || "آلي"} •{" "}
                  {customNameAr || "الحساب المخصص"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Compass,
  FileText,
  FolderKanban,
  Receipt,
  Search,
  Store,
  Users,
  X,
} from "lucide-react";
import { fmtNum } from "@/lib/formulas";
import { resolveGroupForTab } from "@/lib/erpNavigation";
import { canAccessModule } from "@/lib/permissions";
import type { LanguageCode, TabId, UasBootstrapState, UasUser } from "@/types/uas";

interface CommandSearchModalProps {
  open: boolean;
  onClose: () => void;
  state: UasBootstrapState;
  lang: LanguageCode;
  currentUser: UasUser;
  onNavigate: (tab: TabId) => void;
  onSelectProject: (projectId: string) => void;
}

interface SearchResultItem {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  badge?: string;
  icon: "nav" | "voucher" | "account" | "vendor" | "project" | "client";
  onSelect: () => void;
}

interface RemoteCoaItem {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
}

interface RemoteVendorItem {
  id: string;
  code: string;
  nameAr: string;
  phone: string;
}

export function CommandSearchModal({
  open,
  onClose,
  state,
  lang,
  currentUser,
  onNavigate,
  onSelectProject,
}: CommandSearchModalProps) {
  const isAr = lang === "ar";
  const [query, setQuery] = useState("");
  const [coaItems, setCoaItems] = useState<RemoteCoaItem[]>([]);
  const [vendorItems, setVendorItems] = useState<RemoteVendorItem[]>([]);

  const handleClose = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    Promise.all([
      fetch("/api/accounting/coa", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/procurement/vendors", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([coaData, vendorData]) => {
      if (!active) return;
      if (coaData?.flat) setCoaItems(coaData.flat as RemoteCoaItem[]);
      if (vendorData?.vendors) setVendorItems(vendorData.vendors as RemoteVendorItem[]);
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, handleClose]);

  const results = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const items: SearchResultItem[] = [];

    const navTargets: Array<{ tab: TabId; titleAr: string; titleEn: string; groupAr: string; groupEn: string }> = [
      { tab: "dashboard", titleAr: "لوحة المشاريع والملخصات", titleEn: "Projects Dashboard & KPIs", groupAr: "الرئيسية", groupEn: "Overview" },
      { tab: "projects", titleAr: "المشاريع والقطفات والموازنة", titleEn: "Projects, Budgets & Harvests", groupAr: "المشاريع", groupEn: "Projects" },
      { tab: "procurement", titleAr: "المشتريات والموردون", titleEn: "Procurement & Vendors", groupAr: "التجارة", groupEn: "Commerce" },
      { tab: "sales", titleAr: "المبيعات والفواتير", titleEn: "Harvest Sales & Invoices", groupAr: "التجارة", groupEn: "Commerce" },
      { tab: "customers", titleAr: "كشوفات العملاء", titleEn: "Customer Ledgers", groupAr: "التجارة", groupEn: "Commerce" },
      { tab: "inventory", titleAr: "المخزون وفرز المحصول", titleEn: "Harvest Inventory & Grading", groupAr: "التجارة", groupEn: "Commerce" },
      { tab: "expenses", titleAr: "المصروفات التشغيلية", titleEn: "Operating Expenses", groupAr: "العمليات", groupEn: "Operations" },
      { tab: "workers", titleAr: "العمال والأجور اليومية", titleEn: "Workers & Daily Wages", groupAr: "العمليات", groupEn: "Operations" },
      { tab: "coa", titleAr: "شجرة الحسابات (5-Tier COA)", titleEn: "5-Tier Chart of Accounts", groupAr: "المحاسبة", groupEn: "Accounting" },
      { tab: "ledger", titleAr: "دفتر اليومية العام", titleEn: "General Ledger", groupAr: "المحاسبة", groupEn: "Accounting" },
      { tab: "treasury", titleAr: "الصندوق والبنوك والدفعات", titleEn: "Multi-Currency Treasury & FX", groupAr: "المحاسبة", groupEn: "Accounting" },
      { tab: "reports", titleAr: "القوائم المالية وميزان المراجعة", titleEn: "Financial Statements & Budgets", groupAr: "التقارير", groupEn: "Reports" },
      { tab: "audit", titleAr: "الرقابة وسجل التدقيق", titleEn: "Audit Trail & Period Locks", groupAr: "التقارير", groupEn: "Reports" },
      { tab: "system", titleAr: "إدارة النظام والهوية والصلاحيات", titleEn: "System Settings & RBAC", groupAr: "النظام", groupEn: "System" },
      { tab: "mobile", titleAr: "تطبيق الجوال والمزامنة Offline PWA", titleEn: "Mobile App & Offline Sync", groupAr: "النظام", groupEn: "System" },
    ];

    for (const nav of navTargets) {
      if (!canAccessModule(currentUser, nav.tab)) continue;
      const groupDef = resolveGroupForTab(nav.tab);
      const subDef = groupDef.subTabs.find((s) => s.id === nav.tab);
      const namespace = subDef?.subdomain || groupDef.domainPath;
      if (
        !q ||
        nav.titleAr.toLowerCase().includes(q) ||
        nav.titleEn.toLowerCase().includes(q) ||
        nav.tab.includes(q) ||
        namespace.toLowerCase().includes(q)
      ) {
        items.push({
          id: `nav-${nav.tab}`,
          category: isAr ? "التنقل السريع" : "Navigation",
          title: isAr ? nav.titleAr : nav.titleEn,
          subtitle: `${isAr ? nav.groupAr : nav.groupEn} • ${namespace}`,
          badge: namespace.toUpperCase(),
          icon: "nav",
          onSelect: () => {
            onNavigate(nav.tab);
            onClose();
          },
        });
      }
    }

    // Projects
    for (const p of state.projects) {
      if (
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.nameEn || "").toLowerCase().includes(q)
      ) {
        items.push({
          id: `proj-${p.id}`,
          category: isAr ? "المشاريع" : "Projects",
          title: p.nameAr || p.name,
          subtitle: `${p.code || p.id} • ${fmtNum(p.budgetTotal ?? p.estimatedValue)} YER`,
          badge: p.type,
          icon: "project",
          onSelect: () => {
            onSelectProject(p.id);
            if (canAccessModule(currentUser, "projects")) onNavigate("projects");
            onClose();
          },
        });
      }
    }

    if (q.length >= 1) {
      // Vouchers / Installments
      for (const inst of state.installments) {
        if (
          inst.voucherNo.toLowerCase().includes(q) ||
          inst.targetName.toLowerCase().includes(q) ||
          inst.notes.toLowerCase().includes(q)
        ) {
          items.push({
            id: `inst-${inst.id}`,
            category: isAr ? "السندات والدفعات" : "Vouchers",
            title: `${inst.voucherNo} — ${inst.targetName}`,
            subtitle: `${fmtNum(inst.amount)} YER • ${inst.date}`,
            badge: inst.type === "CUSTOMER_RECEIPT" ? (isAr ? "قبض" : "Receipt") : isAr ? "صرف" : "Payout",
            icon: "voucher",
            onSelect: () => {
              onNavigate("treasury");
              onClose();
            },
          });
        }
      }

      // Sales & Customers
      const seenCustomers = new Set<string>();
      for (const s of state.sales) {
        if (
          s.customer.toLowerCase().includes(q) ||
          s.voucherNo.toLowerCase().includes(q) ||
          s.batch.toLowerCase().includes(q)
        ) {
          if (!seenCustomers.has(s.customer)) {
            seenCustomers.add(s.customer);
            items.push({
              id: `cust-${s.id}`,
              category: isAr ? "العملاء والمبيعات" : "Clients & Sales",
              title: s.customer,
              subtitle: `${s.voucherNo} • ${fmtNum(s.total)} YER (${s.harvest})`,
              badge: s.phone,
              icon: "client",
              onSelect: () => {
                onNavigate("sales");
                onClose();
              },
            });
          }
        }
      }

      // Vendors
      for (const v of vendorItems) {
        if (v.nameAr.toLowerCase().includes(q) || v.code.toLowerCase().includes(q) || v.phone.includes(q)) {
          items.push({
            id: `vnd-${v.id}`,
            category: isAr ? "الموردون" : "Vendors",
            title: v.nameAr,
            subtitle: `${v.code} • ${v.phone}`,
            badge: "VENDOR",
            icon: "vendor",
            onSelect: () => {
              onNavigate("procurement");
              onClose();
            },
          });
        }
      }

      // COA Accounts
      for (const acc of coaItems) {
        if (
          acc.code.toLowerCase().includes(q) ||
          acc.nameAr.toLowerCase().includes(q) ||
          acc.nameEn.toLowerCase().includes(q)
        ) {
          items.push({
            id: `coa-${acc.id}`,
            category: isAr ? "شجرة الحسابات" : "Chart of Accounts",
            title: `${acc.code} — ${isAr ? acc.nameAr : acc.nameEn}`,
            subtitle: `Tier ${acc.level}`,
            badge: `L${acc.level}`,
            icon: "account",
            onSelect: () => {
              onNavigate(canAccessModule(currentUser, "coa") ? "coa" : "dashboard");
              onClose();
            },
          });
        }
      }
    }

    return items.slice(0, 18);
  }, [query, state, currentUser, isAr, vendorItems, coaItems, onNavigate, onSelectProject, onClose]);

  if (!open) return null;

  const renderIcon = (kind: SearchResultItem["icon"]) => {
    switch (kind) {
      case "voucher":
        return <Receipt className="w-4 h-4 text-emerald-600" />;
      case "account":
        return <BookOpen className="w-4 h-4 text-indigo-600" />;
      case "vendor":
        return <Store className="w-4 h-4 text-amber-600" />;
      case "project":
        return <FolderKanban className="w-4 h-4 text-teal-600" />;
      case "client":
        return <Users className="w-4 h-4 text-cyan-600" />;
      default:
        return <Compass className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-start justify-center pt-[10vh] p-4 no-print"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card-surface rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-700">
          <Search className="w-5 h-5 text-emerald-600 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="text"
            placeholder={
              isAr
                ? "ابحث عن سند، حساب (111101)، مورد، عميل، مشروع، أو صفحة..."
                : "Search vouchers, COA accounts, vendors, clients, projects, or pages..."
            }
            className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
          />
          <kbd className="hidden sm:inline-block px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-[10px] font-mono text-slate-400">
            ESC
          </kbd>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="py-10 text-center space-y-2 text-slate-400">
              <FileText className="w-8 h-8 mx-auto opacity-50" />
              <div className="text-xs font-bold">
                {isAr ? "لا توجد نتائج مطابقة لبحثك" : "No matching records found"}
              </div>
            </div>
          ) : (
            results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onSelect}
                className="w-full px-3.5 py-2.5 rounded-2xl flex items-center justify-between gap-3 text-start hover:bg-slate-100 dark:hover:bg-slate-800/80 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    {renderIcon(item.icon)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold truncate">{item.title}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {item.category} • {item.subtitle}
                    </div>
                  </div>
                </div>
                {item.badge && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300 shrink-0">
                    {item.badge}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


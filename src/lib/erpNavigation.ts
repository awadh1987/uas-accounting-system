import type { ErpGroupId, LanguageCode, TabId, UasUser } from "@/types/uas";
import { canAccessModule } from "@/lib/permissions";

export interface ErpSubTabDef {
  id: TabId;
  subdomain: string;
  labelAr: string;
  labelEn: string;
}

export interface ErpGroupDef {
  id: ErpGroupId;
  domainPath: string;
  defaultTab: TabId;
  labelAr: string;
  labelEn: string;
  descriptionAr: string;
  descriptionEn: string;
  subTabs: ErpSubTabDef[];
}

export const ERP_GROUPS: ErpGroupDef[] = [
  {
    id: "public",
    domainPath: "public/dashboard",
    defaultTab: "dashboard",
    labelAr: "لوحة المشاريع والملخصات",
    labelEn: "Projects Dashboard",
    descriptionAr: "مؤشرات الأداء التنفيذية وملخصات الأرباح والمشاريع",
    descriptionEn: "Projects Dashboard & Executive KPIs",
    subTabs: [],
  },
  {
    id: "projects",
    domainPath: "projects/portfolio",
    defaultTab: "projects",
    labelAr: "المشاريع والاستحواذ والقطفات",
    labelEn: "Projects & Acquisitions",
    descriptionAr: "المشاريع الرئيسية والفرعية وعقود الاستحواذ وإقفال القطفات",
    descriptionEn: "Main/Sub Projects, Owner Acquisition Cycles & Harvest Locks",
    subTabs: [],
  },
  {
    id: "commercial",
    domainPath: "commercial/procurement",
    defaultTab: "procurement",
    labelAr: "التجارة وسلسلة الإمداد",
    labelEn: "Commerce & Supply Chain",
    descriptionAr: "المشتريات والموردون، المبيعات والعملاء، والمخزون والفرز",
    descriptionEn: "Procurement, Harvest Sales & Clients, and Inventory",
    subTabs: [
      { id: "procurement", subdomain: "commercial/procurement", labelAr: "المشتريات والموردون", labelEn: "Procurement & Vendors" },
      { id: "sales", subdomain: "commercial/sales", labelAr: "المبيعات والعملاء", labelEn: "Sales & Clients" },
      { id: "inventory", subdomain: "commercial/inventory", labelAr: "المخزون وفرز المحصول", labelEn: "Inventory & Grading" },
    ],
  },
  {
    id: "operations",
    domainPath: "operations/expenses",
    defaultTab: "expenses",
    labelAr: "العمليات الميدانية والعمالة",
    labelEn: "Field Ops & Labor",
    descriptionAr: "المصروفات التشغيلية وسجلات العمال والأجور اليومية",
    descriptionEn: "Operating Expenses & Daily Worker Wages",
    subTabs: [
      { id: "expenses", subdomain: "operations/expenses", labelAr: "المصروفات التشغيلية", labelEn: "Operating Expenses" },
      { id: "workers", subdomain: "operations/workers", labelAr: "العمال والأجور اليومية", labelEn: "Workers & Daily Wages" },
    ],
  },
  {
    id: "finance",
    domainPath: "finance/treasury",
    defaultTab: "coa",
    labelAr: "المحاسبة والخزينة والبنوك",
    labelEn: "Finance, Treasury & Banks",
    descriptionAr: "شجرة الحسابات الخماسية، دفتر اليومية العام، الصندوق والبنوك والمحافظ",
    descriptionEn: "5-Tier COA, General Ledger, Vaults, Banks & Digital Wallets",
    subTabs: [
      { id: "coa", subdomain: "finance/coa", labelAr: "شجرة الحسابات (5-Tier COA)", labelEn: "Chart of Accounts (5-Tier)" },
      { id: "ledger", subdomain: "finance/ledger", labelAr: "دفتر اليومية العام", labelEn: "General Ledger" },
      { id: "treasury", subdomain: "finance/treasury", labelAr: "الخزينة والبنوك والمحافظ", labelEn: "Treasury, Banks & Wallets" },
    ],
  },
  {
    id: "intelligence",
    domainPath: "intelligence/reports",
    defaultTab: "reports",
    labelAr: "التقارير والرقابة المالية",
    labelEn: "Intelligence & Audit",
    descriptionAr: "القوائم المالية والموازنة وسجل التدقيق غير القابل للتعديل",
    descriptionEn: "Financial Statements, Budgets & Immutable Audit Trail",
    subTabs: [
      { id: "reports", subdomain: "intelligence/reports", labelAr: "القوائم المالية والموازنة", labelEn: "Financial Statements" },
      { id: "audit", subdomain: "intelligence/audit", labelAr: "الرقابة وسجل التدقيق", labelEn: "Audit Trail & Adjustments" },
    ],
  },
  {
    id: "admin",
    domainPath: "admin/system",
    defaultTab: "system",
    labelAr: "إدارة النظام والهوية",
    labelEn: "Admin, Branding & CMS",
    descriptionAr: "الهوية المؤسسية، إدارة الصفحة العامة، مصفوفة الصلاحيات، ومزامنة PWA",
    descriptionEn: "Dual Logo Branding, Landing CMS, RBAC Matrix & Mobile PWA",
    subTabs: [
      { id: "system", subdomain: "admin/branding", labelAr: "الهوية والصلاحيات وCMS", labelEn: "Branding, RBAC & CMS" },
      { id: "mobile", subdomain: "admin/mobile", labelAr: "تطبيق الجوال والمزامنة", labelEn: "Mobile App & PWA Sync" },
      { id: "prompt", subdomain: "admin/prompt", labelAr: "موجه الوكيل الذكي", labelEn: "Agent Prompt" },
    ],
  },
];

export function resolveGroupForTab(tab: TabId): ErpGroupDef {
  if (tab === "customers") {
    return ERP_GROUPS.find((g) => g.id === "commercial")!;
  }
  if (tab === "accounting") {
    return ERP_GROUPS.find((g) => g.id === "finance")!;
  }
  const direct = ERP_GROUPS.find(
    (g) => g.id === tab || g.defaultTab === tab || g.subTabs.some((s) => s.id === tab)
  );
  return direct || ERP_GROUPS[0];
}

export function resolveEffectiveTab(tab: TabId, user?: UasUser | null): TabId {
  // Map group IDs to their default sub-tab (taking user permissions into account)
  const group = ERP_GROUPS.find((g) => g.id === tab);
  if (group && group.subTabs.length > 0) {
    const allowedSub = group.subTabs.find((s) => !user || canAccessModule(user, s.id));
    return allowedSub ? allowedSub.id : group.defaultTab;
  }
  return tab;
}

export function getBreadcrumb(tab: TabId, lang: LanguageCode): { groupLabel: string; subLabel?: string } {
  const isAr = lang === "ar";
  const group = resolveGroupForTab(tab);
  const groupLabel = isAr ? group.labelAr : group.labelEn;
  if (tab === "customers") {
    return {
      groupLabel,
      subLabel: isAr ? "المبيعات والعملاء — كشوفات العملاء" : "Sales & Clients — Ledgers",
    };
  }
  const sub = group.subTabs.find((s) => s.id === tab);
  return {
    groupLabel,
    subLabel: sub ? (isAr ? sub.labelAr : sub.labelEn) : undefined,
  };
}


import type { ErpGroupId, TabId, UasProject, UasUser, UserRole } from "@/types/uas";

export const ALL_USER_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "PROJECT_MANAGER",
  "CHIEF_ACCOUNTANT",
  "PROCUREMENT_OFFICER",
  "SALES_COLLECTOR",
  "FIELD_ACCOUNTANT",
  "EXTERNAL_AUDITOR",
];

export interface RoleDefinition {
  role: UserRole;
  labelAr: string;
  labelEn: string;
  shortEn: string;
  departmentAr: string;
  badgeClass: string;
  descriptionAr: string;
  descriptionEn: string;
}

export const ROLE_DEFINITIONS: Record<UserRole, RoleDefinition> = {
  SUPER_ADMIN: {
    role: "SUPER_ADMIN",
    labelAr: "مدير النظام العام",
    labelEn: "System Owner / Super Admin",
    shortEn: "System Owner",
    departmentAr: "الإدارة العليا وتقنية المعلومات",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    descriptionAr: "صلاحيات كاملة لإدارة النظام، الإعدادات، القوائم، القيود، والمستخدمين",
    descriptionEn: "Full system control, RBAC, settings, ledger posting, and period locking",
  },
  PROJECT_MANAGER: {
    role: "PROJECT_MANAGER",
    labelAr: "مدير المشاريع",
    labelEn: "Project Manager",
    shortEn: "Project Manager",
    departmentAr: "إدارة المشاريع والعمليات الزراعية",
    badgeClass: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
    descriptionAr: "إدارة المشاريع والقطفات، اعتماد أوامر الشراء، متابعة المصروفات والتقارير",
    descriptionEn: "Projects, harvest cycles, approvals, budget tracking, and operational oversight",
  },
  CHIEF_ACCOUNTANT: {
    role: "CHIEF_ACCOUNTANT",
    labelAr: "رئيس الحسابات",
    labelEn: "Chief Accountant",
    shortEn: "Chief Accountant",
    departmentAr: "الإدارة المالية والحسابات",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    descriptionAr: "ترحيل قيود اليومية، شجرة الحسابات، الخزينة، القوائم المالية وإقفال الفترات",
    descriptionEn: "General Ledger posting, 5-tier COA, treasury, financial statements, and period locks",
  },
  PROCUREMENT_OFFICER: {
    role: "PROCUREMENT_OFFICER",
    labelAr: "مسؤول المشتريات والمخازن",
    labelEn: "Procurement & Inventory Officer",
    shortEn: "Procurement",
    departmentAr: "المشتريات وسلسلة الإمداد",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    descriptionAr: "إدارة الموردين، أوامر الشراء، استلام المخزون، فواتير المشتريات والمصروفات",
    descriptionEn: "Vendors, Purchase Orders, Goods Receipts, vendor bills, and harvest inventory",
  },
  SALES_COLLECTOR: {
    role: "SALES_COLLECTOR",
    labelAr: "مسؤول المبيعات والتحصيل",
    labelEn: "Sales & Collections Officer",
    shortEn: "Sales",
    departmentAr: "المبيعات وعلاقات العملاء",
    badgeClass: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
    descriptionAr: "فواتير بيع المحصول، كشوفات العملاء، وتحصيل الدفعات والسندات للخزينة",
    descriptionEn: "Harvest sales, customer ledgers, installment receipts, and stock visibility",
  },
  FIELD_ACCOUNTANT: {
    role: "FIELD_ACCOUNTANT",
    labelAr: "محاسب ميداني",
    labelEn: "Field Accountant",
    shortEn: "Field Accountant",
    departmentAr: "العمليات الميدانية بالمزارع",
    badgeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    descriptionAr: "تسجيل المصروفات اليومية، أجور العمال، المبيعات الميدانية ودفعات الخزينة للمشاريع المسندة",
    descriptionEn: "Field expenses, worker attendance wages, harvest sales, and receipts on assigned projects",
  },
  EXTERNAL_AUDITOR: {
    role: "EXTERNAL_AUDITOR",
    labelAr: "مدقق مالي",
    labelEn: "Financial Auditor (Read-Only)",
    shortEn: "Financial Auditor",
    departmentAr: "التدقيق والرقابة الخارجية",
    badgeClass: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
    descriptionAr: "اطلاع ومراجعة شاملة للقوائم المالية وسجل التدقيق والدفاتر (للقراءة فقط)",
    descriptionEn: "Full read-only audit inspection across ledgers, vouchers, reports, and audit trail",
  },
};

export type ModuleIdentifier = ErpGroupId | TabId;

const MODULE_TO_GROUP: Record<TabId, ErpGroupId> = {
  dashboard: "public",
  projects: "projects",
  commercial: "commercial",
  procurement: "commercial",
  sales: "commercial",
  customers: "commercial",
  inventory: "commercial",
  operations: "operations",
  expenses: "operations",
  workers: "operations",
  finance: "finance",
  accounting: "finance",
  coa: "finance",
  ledger: "finance",
  treasury: "finance",
  reports: "intelligence",
  audit: "intelligence",
  system: "admin",
  mobile: "admin",
  prompt: "admin",
};

const ROLE_GROUP_ACCESS: Record<UserRole, ErpGroupId[]> = {
  SUPER_ADMIN: ["public", "projects", "commercial", "operations", "finance", "intelligence", "admin"],
  PROJECT_MANAGER: ["public", "projects", "commercial", "operations", "intelligence"],
  CHIEF_ACCOUNTANT: ["public", "projects", "commercial", "operations", "finance", "intelligence", "admin"],
  PROCUREMENT_OFFICER: ["public", "commercial", "operations"],
  SALES_COLLECTOR: ["public", "commercial", "finance"],
  FIELD_ACCOUNTANT: ["public", "projects", "commercial", "operations", "finance"],
  EXTERNAL_AUDITOR: ["public", "projects", "commercial", "operations", "finance", "intelligence"],
};

const ROLE_TAB_ACCESS: Record<UserRole, TabId[]> = {
  SUPER_ADMIN: [
    "dashboard",
    "projects",
    "commercial",
    "procurement",
    "sales",
    "customers",
    "inventory",
    "operations",
    "expenses",
    "workers",
    "finance",
    "accounting",
    "coa",
    "ledger",
    "treasury",
    "reports",
    "audit",
    "system",
    "mobile",
    "prompt",
  ],
  PROJECT_MANAGER: [
    "dashboard",
    "projects",
    "commercial",
    "procurement",
    "sales",
    "customers",
    "inventory",
    "operations",
    "expenses",
    "workers",
    "reports",
    "audit",
  ],
  CHIEF_ACCOUNTANT: [
    "dashboard",
    "projects",
    "commercial",
    "procurement",
    "sales",
    "customers",
    "inventory",
    "operations",
    "expenses",
    "workers",
    "finance",
    "accounting",
    "coa",
    "ledger",
    "treasury",
    "reports",
    "audit",
    "system",
    "mobile",
  ],
  PROCUREMENT_OFFICER: ["dashboard", "commercial", "procurement", "inventory", "operations", "expenses"],
  SALES_COLLECTOR: ["dashboard", "commercial", "sales", "customers", "inventory", "finance", "accounting", "treasury"],
  FIELD_ACCOUNTANT: [
    "dashboard",
    "projects",
    "commercial",
    "sales",
    "customers",
    "inventory",
    "operations",
    "expenses",
    "workers",
    "finance",
    "accounting",
    "treasury",
  ],
  EXTERNAL_AUDITOR: [
    "dashboard",
    "projects",
    "commercial",
    "procurement",
    "sales",
    "customers",
    "inventory",
    "operations",
    "expenses",
    "workers",
    "finance",
    "accounting",
    "coa",
    "ledger",
    "treasury",
    "reports",
    "audit",
  ],
};

function extractRoleString(userOrRole?: UasUser | string | null): string {
  if (!userOrRole) return "FIELD_ACCOUNTANT";
  if (typeof userOrRole === "string") return userOrRole;
  return userOrRole.role || "FIELD_ACCOUNTANT";
}

export function normalizeRole(userOrRole?: UasUser | string | null): UserRole {
  const raw = extractRoleString(userOrRole).trim().toUpperCase();
  if ((ALL_USER_ROLES as string[]).includes(raw)) {
    return raw as UserRole;
  }
  if (raw === "AUDITOR" || raw.includes("AUDIT") || raw.includes("مدقق")) return "EXTERNAL_AUDITOR";
  if (raw.includes("ADMIN") || raw.includes("مدير النظام")) return "SUPER_ADMIN";
  if (raw.includes("PROJECT") || raw.includes("مشاريع")) return "PROJECT_MANAGER";
  if (raw.includes("CHIEF") || raw.includes("رئيس الحسابات") || raw.includes("محاسب رئيسي")) {
    return "CHIEF_ACCOUNTANT";
  }
  if (raw.includes("PROCURE") || raw.includes("مشتريات")) return "PROCUREMENT_OFFICER";
  if (raw.includes("SALES") || raw.includes("مبيعات")) return "SALES_COLLECTOR";
  return "FIELD_ACCOUNTANT";
}

export function getRoleMeta(userOrRole?: UasUser | string | null): RoleDefinition {
  return ROLE_DEFINITIONS[normalizeRole(userOrRole)];
}

export function resolveErpGroup(tab: TabId): ErpGroupId {
  return MODULE_TO_GROUP[tab] || "public";
}

export function canAccessModule(
  userOrRole: UasUser | string | null | undefined,
  moduleId: ModuleIdentifier
): boolean {
  const role = normalizeRole(userOrRole);
  if (moduleId in MODULE_TO_GROUP) {
    return ROLE_TAB_ACCESS[role].includes(moduleId as TabId);
  }
  return ROLE_GROUP_ACCESS[role].includes(moduleId as ErpGroupId);
}

export function getAccessibleTabs(userOrRole?: UasUser | string | null): TabId[] {
  return ROLE_TAB_ACCESS[normalizeRole(userOrRole)];
}

export function getAccessibleGroups(userOrRole?: UasUser | string | null): ErpGroupId[] {
  return ROLE_GROUP_ACCESS[normalizeRole(userOrRole)];
}

export function isReadOnly(userOrRole?: UasUser | string | null): boolean {
  return normalizeRole(userOrRole) === "EXTERNAL_AUDITOR";
}

export function canCreate(
  userOrRole?: UasUser | string | null,
  moduleId?: ModuleIdentifier
): boolean {
  if (isReadOnly(userOrRole)) return false;
  if (moduleId) return canAccessModule(userOrRole, moduleId);
  return true;
}

export function canEdit(
  userOrRole?: UasUser | string | null,
  moduleId?: ModuleIdentifier
): boolean {
  if (isReadOnly(userOrRole)) return false;
  if (moduleId) return canAccessModule(userOrRole, moduleId);
  return true;
}

export function canEditDate(userOrRole?: UasUser | string | null): boolean {
  const role = normalizeRole(userOrRole);
  return role === "SUPER_ADMIN" || role === "CHIEF_ACCOUNTANT" || role === "PROJECT_MANAGER";
}

export function canDeleteVoid(userOrRole?: UasUser | string | null): boolean {
  const role = normalizeRole(userOrRole);
  return role === "SUPER_ADMIN" || role === "CHIEF_ACCOUNTANT";
}

export function canApprove(userOrRole?: UasUser | string | null): boolean {
  const role = normalizeRole(userOrRole);
  return role === "SUPER_ADMIN" || role === "PROJECT_MANAGER" || role === "CHIEF_ACCOUNTANT";
}

export function canPostLedger(userOrRole?: UasUser | string | null): boolean {
  const role = normalizeRole(userOrRole);
  return role === "SUPER_ADMIN" || role === "CHIEF_ACCOUNTANT";
}

export function canManageTreasury(userOrRole?: UasUser | string | null): boolean {
  const role = normalizeRole(userOrRole);
  return role === "SUPER_ADMIN" || role === "CHIEF_ACCOUNTANT";
}

export function canManageLandingCms(userOrRole?: UasUser | string | null): boolean {
  return normalizeRole(userOrRole) === "SUPER_ADMIN";
}

export function canLockPeriod(userOrRole?: UasUser | string | null): boolean {
  const role = normalizeRole(userOrRole);
  return role === "SUPER_ADMIN" || role === "CHIEF_ACCOUNTANT" || role === "PROJECT_MANAGER";
}

export function canManageUsers(userOrRole?: UasUser | string | null): boolean {
  return normalizeRole(userOrRole) === "SUPER_ADMIN";
}

export function canAccessProject(user: UasUser | null | undefined, projectId: string): boolean {
  if (!user) return false;
  const role = normalizeRole(user);
  if (role === "SUPER_ADMIN" || role === "CHIEF_ACCOUNTANT" || role === "EXTERNAL_AUDITOR") {
    return true;
  }
  if (!user.assignedProjects || user.assignedProjects.length === 0) return true;
  return user.assignedProjects.includes(projectId);
}

export function filterAssignedProjects(user: UasUser | null | undefined, projects: UasProject[]): UasProject[] {
  if (!user) return projects;
  const role = normalizeRole(user);
  if (role === "SUPER_ADMIN" || role === "CHIEF_ACCOUNTANT" || role === "EXTERNAL_AUDITOR") {
    return projects;
  }
  if (!user.assignedProjects || user.assignedProjects.length === 0) return projects;
  const allowed = new Set(user.assignedProjects);
  const filtered = projects.filter((p) => allowed.has(p.id));
  return filtered.length > 0 ? filtered : projects;
}


import type { ErpGroupId, TabId, UasProject, UasUser, UasUserCustomOverrides, UserRole } from "@/types/uas";

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

export interface GranularActionPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canEditDate: boolean;
  canDeleteVoid: boolean;
  canApprove: boolean;
  canPostLedger: boolean;
  canLockPeriod: boolean;
  canManageTreasury: boolean;
  canManageLandingCms: boolean;
  canManageUsers: boolean;
}

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, GranularActionPermissions> = {
  SUPER_ADMIN: {
    canCreate: true,
    canEdit: true,
    canEditDate: true,
    canDeleteVoid: true,
    canApprove: true,
    canPostLedger: true,
    canLockPeriod: true,
    canManageTreasury: true,
    canManageLandingCms: true,
    canManageUsers: true,
  },
  PROJECT_MANAGER: {
    canCreate: true,
    canEdit: true,
    canEditDate: true,
    canDeleteVoid: false,
    canApprove: true,
    canPostLedger: false,
    canLockPeriod: true,
    canManageTreasury: false,
    canManageLandingCms: false,
    canManageUsers: false,
  },
  CHIEF_ACCOUNTANT: {
    canCreate: true,
    canEdit: true,
    canEditDate: true,
    canDeleteVoid: true,
    canApprove: true,
    canPostLedger: true,
    canLockPeriod: true,
    canManageTreasury: true,
    canManageLandingCms: false,
    canManageUsers: false,
  },
  PROCUREMENT_OFFICER: {
    canCreate: true,
    canEdit: true,
    canEditDate: false,
    canDeleteVoid: false,
    canApprove: false,
    canPostLedger: false,
    canLockPeriod: false,
    canManageTreasury: false,
    canManageLandingCms: false,
    canManageUsers: false,
  },
  SALES_COLLECTOR: {
    canCreate: true,
    canEdit: true,
    canEditDate: false,
    canDeleteVoid: false,
    canApprove: false,
    canPostLedger: false,
    canLockPeriod: false,
    canManageTreasury: false,
    canManageLandingCms: false,
    canManageUsers: false,
  },
  FIELD_ACCOUNTANT: {
    canCreate: true,
    canEdit: true,
    canEditDate: false,
    canDeleteVoid: false,
    canApprove: false,
    canPostLedger: false,
    canLockPeriod: false,
    canManageTreasury: false,
    canManageLandingCms: false,
    canManageUsers: false,
  },
  EXTERNAL_AUDITOR: {
    canCreate: false,
    canEdit: false,
    canEditDate: false,
    canDeleteVoid: false,
    canApprove: false,
    canPostLedger: false,
    canLockPeriod: false,
    canManageTreasury: false,
    canManageLandingCms: false,
    canManageUsers: false,
  },
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

export function isSuperAdmin(userOrRole?: UasUser | string | null): boolean {
  return normalizeRole(userOrRole) === "SUPER_ADMIN";
}

export function isUserActive(userOrRole?: UasUser | string | null): boolean {
  if (!userOrRole || typeof userOrRole === "string") return true;
  if (userOrRole.active === false || userOrRole.isActive === false) return false;
  return true;
}

export function resolveCustomOverrides(user: UasUser): UasUserCustomOverrides {
  if (user.customOverrides) return user.customOverrides;

  let allowedGroups: ErpGroupId[] = [];
  if (Array.isArray(user.customAllowedGroups)) {
    allowedGroups = user.customAllowedGroups as ErpGroupId[];
  } else if (typeof user.customAllowedGroups === "string" && user.customAllowedGroups.trim()) {
    try {
      const parsed = JSON.parse(user.customAllowedGroups);
      if (Array.isArray(parsed)) allowedGroups = parsed as ErpGroupId[];
    } catch {
      allowedGroups = [];
    }
  }

  let actions: Record<string, boolean> = {};
  if (user.customPermissionsJson && typeof user.customPermissionsJson === "object") {
    actions = user.customPermissionsJson as Record<string, boolean>;
  } else if (typeof user.customPermissionsJson === "string" && user.customPermissionsJson.trim()) {
    try {
      const parsed = JSON.parse(user.customPermissionsJson);
      if (typeof parsed === "object" && parsed !== null) actions = parsed;
    } catch {
      actions = {};
    }
  }

  return {
    allowedGroups,
    canCreate: actions.canCreate,
    canEdit: actions.canEdit,
    canEditDate: actions.canEditDate,
    canDeleteVoid: actions.canDeleteVoid,
    canApprove: actions.canApprove,
    canPostLedger: actions.canPostLedger,
    canLockPeriod: actions.canLockPeriod,
    canManageTreasury: actions.canManageTreasury,
    canManageLandingCms: actions.canManageLandingCms,
    canManageUsers: actions.canManageUsers,
    ...actions,
  };
}

function evaluateActionRight(
  userOrRole: UasUser | string | null | undefined,
  actionKey: keyof GranularActionPermissions,
  superAdminEmergencyRecovery = false
): boolean {
  if (!isUserActive(userOrRole)) return false;
  const role = normalizeRole(userOrRole);
  if (role === "SUPER_ADMIN" && superAdminEmergencyRecovery) return true;

  if (userOrRole && typeof userOrRole === "object" && userOrRole.useCustomPermissions) {
    const overrides = resolveCustomOverrides(userOrRole);
    if (typeof overrides[actionKey] === "boolean") {
      return Boolean(overrides[actionKey]);
    }
  }

  return ROLE_DEFAULT_PERMISSIONS[role][actionKey];
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
  if (!isUserActive(userOrRole)) return false;
  const role = normalizeRole(userOrRole);

  // Administrative recovery access: SUPER_ADMIN can ALWAYS access admin & system modules
  if (role === "SUPER_ADMIN" && (moduleId === "admin" || moduleId === "system")) {
    return true;
  }

  if (userOrRole && typeof userOrRole === "object" && userOrRole.useCustomPermissions) {
    const overrides = resolveCustomOverrides(userOrRole);
    const allowed = overrides.allowedGroups || [];
    if (moduleId in MODULE_TO_GROUP) {
      const group = MODULE_TO_GROUP[moduleId as TabId] || "public";
      if (group === "public") return true;
      return allowed.includes(group) || (role === "SUPER_ADMIN" && group === "admin");
    }
    if (moduleId === "public") return true;
    return allowed.includes(moduleId as ErpGroupId) || (role === "SUPER_ADMIN" && moduleId === "admin");
  }

  if (moduleId in MODULE_TO_GROUP) {
    return ROLE_TAB_ACCESS[role].includes(moduleId as TabId);
  }
  return ROLE_GROUP_ACCESS[role].includes(moduleId as ErpGroupId);
}

export function getAccessibleTabs(userOrRole?: UasUser | string | null): TabId[] {
  if (!isUserActive(userOrRole)) return ["dashboard"];
  const role = normalizeRole(userOrRole);

  if (userOrRole && typeof userOrRole === "object" && userOrRole.useCustomPermissions) {
    const allowedGroups = new Set(getAccessibleGroups(userOrRole));
    const tabs = (Object.keys(MODULE_TO_GROUP) as TabId[]).filter((tab) =>
      allowedGroups.has(MODULE_TO_GROUP[tab])
    );
    if (!tabs.includes("dashboard")) tabs.unshift("dashboard");
    if (role === "SUPER_ADMIN" && !tabs.includes("system")) tabs.push("system");
    return tabs;
  }

  return ROLE_TAB_ACCESS[role];
}

export function getAccessibleGroups(userOrRole?: UasUser | string | null): ErpGroupId[] {
  if (!isUserActive(userOrRole)) return ["public"];
  const role = normalizeRole(userOrRole);

  if (userOrRole && typeof userOrRole === "object" && userOrRole.useCustomPermissions) {
    const overrides = resolveCustomOverrides(userOrRole);
    const list = new Set<ErpGroupId>(overrides.allowedGroups || []);
    list.add("public");
    if (role === "SUPER_ADMIN") list.add("admin");
    return Array.from(list);
  }

  return ROLE_GROUP_ACCESS[role];
}

export function isReadOnly(userOrRole?: UasUser | string | null): boolean {
  if (!isUserActive(userOrRole)) return true;
  if (userOrRole && typeof userOrRole === "object" && userOrRole.useCustomPermissions) {
    const overrides = resolveCustomOverrides(userOrRole);
    if (overrides.canCreate === false && overrides.canEdit === false) return true;
    if (overrides.canCreate === true || overrides.canEdit === true) return false;
  }
  return normalizeRole(userOrRole) === "EXTERNAL_AUDITOR";
}

export function canCreate(
  userOrRole?: UasUser | string | null,
  moduleId?: ModuleIdentifier
): boolean {
  if (moduleId && !canAccessModule(userOrRole, moduleId)) return false;
  return evaluateActionRight(userOrRole, "canCreate", true);
}

export function canEdit(
  userOrRole?: UasUser | string | null,
  moduleId?: ModuleIdentifier
): boolean {
  if (moduleId && !canAccessModule(userOrRole, moduleId)) return false;
  return evaluateActionRight(userOrRole, "canEdit", true);
}

export function canEditDate(userOrRole?: UasUser | string | null): boolean {
  return evaluateActionRight(userOrRole, "canEditDate", true);
}

export function canDeleteVoid(userOrRole?: UasUser | string | null): boolean {
  return evaluateActionRight(userOrRole, "canDeleteVoid", true);
}

export function canApprove(userOrRole?: UasUser | string | null): boolean {
  return evaluateActionRight(userOrRole, "canApprove", true);
}

export function canPostLedger(userOrRole?: UasUser | string | null): boolean {
  return evaluateActionRight(userOrRole, "canPostLedger", true);
}

export function canManageTreasury(userOrRole?: UasUser | string | null): boolean {
  return evaluateActionRight(userOrRole, "canManageTreasury", true);
}

export function canManageLandingCms(userOrRole?: UasUser | string | null): boolean {
  return evaluateActionRight(userOrRole, "canManageLandingCms", true);
}

export function canLockPeriod(userOrRole?: UasUser | string | null): boolean {
  return evaluateActionRight(userOrRole, "canLockPeriod", true);
}

export function canManageUsers(userOrRole?: UasUser | string | null): boolean {
  // SUPER_ADMIN always retains recovery access to user management
  return evaluateActionRight(userOrRole, "canManageUsers", true);
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


import type { TabId } from "@/types/uas";
import type { SectorType } from "@/lib/clientPortal/portalPolicy";

export interface WorkspaceRouteSection {
  tab: TabId;
  sector?: SectorType;
  customersSection?: "cards" | "portal" | "ledger" | "both" | "whatsapp";
  salesViewMode?: "sales" | "customers" | "procurement" | "inventory" | "portal";
}

/**
 * Clean subdomain sub-paths under https://<slug>.qat.world/<section>
 * Maps both Arabic-aligned ERP domains and sector shortcuts deterministically.
 */
export const WORKSPACE_ROUTE_SECTIONS: Record<string, WorkspaceRouteSection> = {
  harvest: { tab: "dashboard", sector: "HARVEST" },
  commercial: { tab: "commercial", sector: "COMMERCIAL" },
  "inbound-outbound": { tab: "inventory", sector: "HARVEST" },
  payments: { tab: "treasury", sector: "HARVEST" },
  dashboard: { tab: "dashboard", sector: "HARVEST" },
  sales: { tab: "sales", sector: "HARVEST", salesViewMode: "sales" },
  inventory: { tab: "inventory", sector: "HARVEST" },
  customers: { tab: "customers", sector: "HARVEST", customersSection: "cards" },
  accounting: { tab: "coa", sector: "HARVEST" },
  coa: { tab: "coa", sector: "HARVEST" },
  ledger: { tab: "ledger", sector: "HARVEST" },
  procurement: { tab: "procurement", sector: "HARVEST" },
  reports: { tab: "reports", sector: "HARVEST" },
  projects: { tab: "projects", sector: "HARVEST" },
  expenses: { tab: "expenses", sector: "HARVEST" },
  workers: { tab: "workers", sector: "HARVEST" },
  system: { tab: "system", sector: "HARVEST" },
  audit: { tab: "audit", sector: "HARVEST" },
};

export const WORKSPACE_SALES_SUBSECTIONS: Record<string, WorkspaceRouteSection> = {
  portal: { tab: "customers", sector: "HARVEST", customersSection: "portal" },
  ledgers: { tab: "customers", sector: "HARVEST", customersSection: "cards" },
  invoices: { tab: "sales", sector: "HARVEST", salesViewMode: "sales" },
};

export function resolveWorkspaceRouteSection(
  pathname: string,
  search = ""
): WorkspaceRouteSection | null {
  const clean = String(pathname || "").toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  if (clean.startsWith("sales/")) {
    const sub = clean.slice("sales/".length);
    if (!sub || sub.includes("/")) return null;
    return WORKSPACE_SALES_SUBSECTIONS[sub] || null;
  }
  if (clean.includes("/")) return null;
  const matched = WORKSPACE_ROUTE_SECTIONS[clean];
  if (!matched) return null;
  if (clean === "inbound-outbound" && search) {
    try {
      const sp = new URLSearchParams(search);
      const sec = (sp.get("sector") || sp.get("sectorType") || "").trim().toUpperCase();
      if (sec === "COMMERCIAL") {
        return { tab: "commercial", sector: "COMMERCIAL" };
      }
    } catch {
      // ignore invalid search string
    }
  }
  return matched;
}

export function resolveCanonicalWorkspacePath(params: {
  activeTab: TabId;
  activeTradingSector: SectorType;
  customersInitialSection?: "cards" | "portal" | "ledger" | "both" | "whatsapp";
  salesViewMode?: "sales" | "customers" | "procurement" | "inventory" | "portal";
  preferHarvestPath?: boolean;
  currentPath?: string;
}): string {
  switch (params.activeTab) {
    case "commercial":
      return "/commercial";
    case "customers":
      return params.customersInitialSection === "portal"
        ? "/sales/portal"
        : "/sales/ledgers";
    case "sales":
      return params.salesViewMode === "portal" ? "/sales/portal" : "/sales/invoices";
    case "procurement":
      return "/procurement";
    case "treasury":
      return "/payments";
    case "inventory":
      return params.currentPath === "/inventory" ? "/inventory" : "/inbound-outbound";
    case "coa":
      return params.currentPath === "/coa" ? "/coa" : "/accounting";
    case "ledger":
      return "/ledger";
    case "reports":
      return "/reports";
    case "projects":
      return "/projects";
    case "expenses":
      return "/expenses";
    case "workers":
      return "/workers";
    case "system":
      return "/system";
    case "audit":
      return "/audit";
    case "dashboard":
    default:
      if (params.preferHarvestPath || params.currentPath === "/harvest") {
        return "/harvest";
      }
      return "/dashboard";
  }
}

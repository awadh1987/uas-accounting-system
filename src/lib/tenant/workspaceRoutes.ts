import type { TabId } from "@/types/uas";
import type { SectorType } from "@/lib/clientPortal/portalPolicy";

export interface WorkspaceRouteSection {
  tab: TabId;
  sector?: SectorType;
}

/**
 * Clean subdomain sub-paths under https://<slug>.qat.world/<section>
 * Maps both Arabic-aligned ERP domains and sector shortcuts deterministically.
 */
export const WORKSPACE_ROUTE_SECTIONS: Record<string, WorkspaceRouteSection> = {
  harvest: { tab: "dashboard", sector: "HARVEST" },
  commercial: { tab: "commercial", sector: "COMMERCIAL" },
  "inbound-outbound": { tab: "inventory", sector: "HARVEST" },
  payments: { tab: "treasury" },
  dashboard: { tab: "dashboard" },
  sales: { tab: "sales" },
  inventory: { tab: "inventory" },
  customers: { tab: "customers" },
  accounting: { tab: "coa" },
  coa: { tab: "coa" },
  ledger: { tab: "ledger" },
  procurement: { tab: "procurement" },
  reports: { tab: "reports" },
  projects: { tab: "projects" },
  expenses: { tab: "expenses" },
  workers: { tab: "workers" },
  system: { tab: "system" },
  audit: { tab: "audit" },
};

export function resolveWorkspaceRouteSection(
  pathname: string,
  search = ""
): WorkspaceRouteSection | null {
  const clean = String(pathname || "").toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("/")) return null;
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

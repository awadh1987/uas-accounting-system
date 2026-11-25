import type { SectorType } from "@/lib/clientPortal/portalPolicy";

export type PortalRouteTab =
  | "catalog"
  | "new_request"
  | "requests"
  | "statement"
  | "payments"
  | "profile";

export type PortalStmtTab = "bills" | "receipts" | "ledger" | "notifications";

export interface PortalRouteSection {
  tab: PortalRouteTab;
  sector?: SectorType;
  stmtTab?: PortalStmtTab;
}

/** Path segment (under /client/portal/ or /portal/) → portal tab + optional sector. */
export const CLIENT_PORTAL_ROUTE_SECTIONS: Record<string, PortalRouteSection> = {
  harvest: { tab: "new_request", sector: "HARVEST" },
  commercial: { tab: "new_request", sector: "COMMERCIAL" },
  catalog: { tab: "catalog" },
  orders: { tab: "requests" },
  requests: { tab: "requests" },
  "inbound-outbound": { tab: "requests" },
  invoices: { tab: "statement", stmtTab: "bills" },
  payments: { tab: "payments" },
  statement: { tab: "statement" },
  profile: { tab: "profile" },
};

export const CANONICAL_CLIENT_PORTAL_PATH = "/client/portal";

/** True for `/portal`, `/portal/...`, `/client/portal`, `/client/portal/...` (case-insensitive, trailing slash tolerant). */
export function isClientPortalPath(pathname: string): boolean {
  const p = String(pathname || "").toLowerCase().replace(/\/+$/, "") || "/";
  return (
    p === "/portal" ||
    p.startsWith("/portal/") ||
    p === CANONICAL_CLIENT_PORTAL_PATH ||
    p.startsWith(`${CANONICAL_CLIENT_PORTAL_PATH}/`)
  );
}

/** Resolves the sub-section segment of a portal path (e.g. `/client/portal/commercial` → commercial). */
export function resolvePortalRouteSection(pathname: string): PortalRouteSection | null {
  const p = String(pathname || "").toLowerCase().replace(/\/+$/, "");
  const m = p.match(/^\/(?:client\/)?portal\/([a-z0-9-]+)$/);
  if (!m) return null;
  return CLIENT_PORTAL_ROUTE_SECTIONS[m[1]] || null;
}

export function buildPortalPath(section?: string, slug?: string | null): string {
  const base =
    section && CLIENT_PORTAL_ROUTE_SECTIONS[section]
      ? `${CANONICAL_CLIENT_PORTAL_PATH}/${section}`
      : `${CANONICAL_CLIENT_PORTAL_PATH}/`;
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!cleanSlug) return base;
  return `${base}?slug=${encodeURIComponent(cleanSlug)}`;
}

export function resolveCanonicalPortalPath(params: {
  portalTab: PortalRouteTab;
  activeSector?: SectorType;
  stmtTab?: PortalStmtTab;
}): string {
  switch (params.portalTab) {
    case "new_request":
      return params.activeSector === "COMMERCIAL"
        ? "/client/portal/commercial"
        : "/client/portal/harvest";
    case "catalog":
      return "/client/portal/catalog";
    case "requests":
      return "/client/portal/orders";
    case "payments":
      return "/client/portal/payments";
    case "statement":
      return params.stmtTab === "bills"
        ? "/client/portal/invoices"
        : "/client/portal/statement";
    case "profile":
      return "/client/portal/profile";
    default:
      return "/client/portal/";
  }
}

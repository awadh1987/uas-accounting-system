import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  allowedSectorsForMode,
  assertReturnEditAllowed,
  assertSectorAllowed,
  canClientCreateOrders,
  canClientLogin,
  findLockedFieldViolations,
  lockedSectorForMode,
  nextAccountStatus,
  normalizeReturnEditPermissions,
  normalizeSectorMode,
  portalErrorStatus,
  resolveEffectiveSectorMode,
  DEFAULT_RETURN_EDIT_PERMISSIONS,
} from "../src/lib/clientPortal/portalPolicy";
import {
  isClientPortalPath,
  resolvePortalRouteSection,
  resolveCanonicalPortalPath,
  CLIENT_PORTAL_ROUTE_SECTIONS,
} from "../src/lib/clientPortal/portalRoutes";
import {
  resolveWorkspaceRouteSection,
  resolveCanonicalWorkspacePath,
} from "../src/lib/tenant/workspaceRoutes";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const PROTECTED = ["default", "aljabri", "alameri", "yasser-albukli", "uas-ye"];
const TEST_TENANT_RE = /^(checkout|xintai|test-.*|demo-.*|sample-.*|ext-corp-.*|al[-_]jabri[-_]test.*|p3h-.*|phase\d.*)$/i;

describe("Phase 23 — test tenant cleanup", () => {
  it("tenants_registry.json files contain only protected tenants (no checkout/xintai/synthetic)", () => {
    for (const rel of ["tenants_registry.json", "data/tenants_registry.json"]) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) continue;
      const list = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ slug: string }>;
      for (const t of list) {
        assert.ok(!TEST_TENANT_RE.test(t.slug), `${rel} still lists test tenant ${t.slug}`);
      }
      for (const slug of PROTECTED) {
        if (rel === "tenants_registry.json") assert.ok(list.some((t) => t.slug === slug), `${slug} missing`);
      }
    }
  });

  it("VS Code Gradle Java home uses a Linux JDK path, not a Windows C:\\ path", () => {
    const settings = read(".vscode/settings.json");
    assert.ok(!/C:\\\\Program Files/i.test(settings));
    assert.ok(settings.includes("/usr/lib/jvm/"));
  });
});

describe("Phase 23 — subdomain routes", () => {
  it("/client/portal and /portal resolve as portal paths; sector sub-paths map to tabs", () => {
    assert.ok(isClientPortalPath("/client/portal/"));
    assert.ok(isClientPortalPath("/client/portal/commercial"));
    assert.ok(isClientPortalPath("/portal"));
    assert.ok(!isClientPortalPath("/portalx"));
    assert.equal(resolvePortalRouteSection("/client/portal/harvest/")?.sector, "HARVEST");
    assert.equal(resolvePortalRouteSection("/portal/commercial")?.sector, "COMMERCIAL");
    assert.equal(resolvePortalRouteSection("/client/portal/inbound-outbound")?.tab, "requests");
    assert.equal(resolvePortalRouteSection("/client/portal/payments")?.tab, "payments");
    assert.equal(resolvePortalRouteSection("/client/portal/unknown"), null);
    assert.ok(Object.keys(CLIENT_PORTAL_ROUTE_SECTIONS).length >= 6);
  });

  it("route files + proxy matcher exist and keep the host-derived tenantSlug binding", () => {
    assert.ok(fs.existsSync(path.join(root, "src/app/client/portal/page.tsx")));
    assert.ok(fs.existsSync(path.join(root, "src/app/client/portal/[section]/page.tsx")));
    assert.ok(fs.existsSync(path.join(root, "src/app/portal/page.tsx")));
    assert.ok(fs.existsSync(path.join(root, "src/app/[section]/page.tsx")));
    assert.ok(fs.existsSync(path.join(root, "src/lib/tenant/workspaceRoutes.ts")));
    const proxy = read("src/proxy.ts");
    assert.ok(proxy.includes("/client/portal/:path*"));
    assert.ok(proxy.includes('"/commercial"'));
    assert.ok(proxy.includes('"/harvest"'));
    assert.ok(proxy.includes('"/inbound-outbound"'));
    assert.ok(proxy.includes('"/payments"'));
    assert.ok(proxy.includes('requestHeaders.set("x-uas-resolved-tenant", resolvedSlug)'));
    const shell = read("src/components/UasAppShell.tsx");
    assert.ok(shell.includes("resolveWorkspaceRouteSection"));
  });
});

describe("Phase 23 — clean sector titles & commercial/inbound-outbound capabilities", () => {
  it("UasAppShell keeps clean sector tab labels without trailing subtitle text", () => {
    const shell = read("src/components/UasAppShell.tsx");
    assert.ok(shell.includes('data-testid="workspace-sector-tab-harvest"'));
    assert.ok(shell.includes('data-testid="workspace-sector-tab-commercial"'));
    assert.ok(!shell.includes("المبيعات، المخزون وفرز المحصول، بوابة العملاء، والمحاسبة الشاملة"));
    assert.ok(!shell.includes("السلع الغذائية، غير الغذائية، المحروقات، المستودعات والرحلات (POD)"));
    assert.ok(shell.includes("pt-2 sm:pt-2.5 md:pt-3"));
    const css = read("src/app/globals.css");
    assert.ok(css.includes(".card-surface:not(.fixed):not(.sticky):not(.absolute)"));
  });

  it("MultiUnitInventoryPanel supports item card editing, landed cost, bulk import, and inbound/outbound refs", () => {
    const inv = read("src/components/MultiUnitInventoryPanel.tsx");
    assert.ok(inv.includes("openEditItemForm"));
    assert.ok(inv.includes("التكلفة الإجمالية للوحدة"));
    assert.ok(inv.includes("movReference"));
    assert.ok(inv.includes("movNotes"));
    assert.ok(inv.includes("BULK_IMPORT_ITEMS"));
    assert.ok(inv.includes("inventory-movements-ledger"));
  });
});

describe("Phase 23 — landing page cleanup", () => {
  const landing = read("src/components/LandingPage.tsx");
  it("keeps only the two top download buttons and removes duplicate download blocks", () => {
    assert.equal((landing.match(/href="\/downloads\/UAS-Setup-Win64\.exe"/g) || []).length, 1);
    assert.equal((landing.match(/href="\/downloads\/UAS-Mobile-Release-qat\.world\.apk"/g) || []).length, 1);
    assert.ok(!landing.includes("public-downloads-section"));
    assert.ok(!landing.includes('href="#downloads-center"'));
  });
  it("removes the staff-access block but keeps دخول beside the language toggle", () => {
    assert.ok(!landing.includes("منطقة دخول فريق العمل"));
    assert.ok(!landing.includes("tenant-staff-login-cta"));
    const lang = landing.indexOf("onClick={onToggleLang}");
    const login = landing.indexOf('data-testid="root-login-cta"');
    assert.ok(lang > 0 && login > lang);
    assert.ok(landing.includes("root-tenant-card-"));
    assert.ok(landing.includes("tenant-client-card-"));
  });
});

describe("Phase 23 — notifications naming", () => {
  it("visible labels say الإشعارات while the WhatsApp outbox service stays intact", () => {
    const portal = read("src/components/client-portal/ClientPortalApp.tsx");
    assert.ok(!portal.includes("الإشعارات والواتساب"));
    assert.ok(portal.includes("الإشعارات ("));
    const admin = read("src/components/portal-admin/TenantClientPortalAdminPanel.tsx");
    assert.ok(admin.includes('label: `الإشعارات (${pendingWaCount})`'));
    assert.ok(fs.existsSync(path.join(root, "src/lib/whatsapp/outboxService.ts")));
    assert.ok(fs.existsSync(path.join(root, "src/app/api/whatsapp-outbox/route.ts")));
  });
});

describe("Phase 23 — sector access control (BOTH / HARVEST_ONLY / COMMERCIAL_ONLY)", () => {
  it("resolves effective mode: client override → tenant default → BOTH", () => {
    assert.equal(resolveEffectiveSectorMode("INHERIT", "HARVEST_ONLY"), "HARVEST_ONLY");
    assert.equal(resolveEffectiveSectorMode(undefined, undefined), "BOTH");
    assert.equal(resolveEffectiveSectorMode("COMMERCIAL_ONLY", "HARVEST_ONLY"), "COMMERCIAL_ONLY");
    assert.equal(normalizeSectorMode("garbage"), "BOTH");
  });
  it("locks single-sector accounts and shows the switcher only for BOTH", () => {
    assert.deepEqual(allowedSectorsForMode("BOTH"), ["HARVEST", "COMMERCIAL"]);
    assert.equal(lockedSectorForMode("BOTH"), null);
    assert.equal(lockedSectorForMode("HARVEST_ONLY"), "HARVEST");
    assert.equal(lockedSectorForMode("COMMERCIAL_ONLY"), "COMMERCIAL");
  });
  it("throws FORBIDDEN (HTTP 403) when a forbidden sector is requested", () => {
    assert.equal(assertSectorAllowed("BOTH", "COMMERCIAL"), "COMMERCIAL");
    assert.throws(() => assertSectorAllowed("HARVEST_ONLY", "COMMERCIAL"), (e: unknown) => portalErrorStatus(e) === 403);
    assert.throws(() => assertSectorAllowed("COMMERCIAL_ONLY", "HARVEST"), (e: unknown) => portalErrorStatus(e) === 403);
  });
  it("API routes enforce sector authorization server-side", () => {
    assert.ok(read("src/lib/clientPortal/portalService.ts").includes("assertSectorAllowed("));
    const reqRoute = read("src/app/api/client-portal/requests/route.ts");
    assert.ok(reqRoute.includes("portalErrorStatus(err)"));
    assert.ok(reqRoute.includes("هذا القطاع غير متاح لحسابك"));
    assert.ok(read("src/app/api/client-portal/catalog/route.ts").includes("isSectorAllowed"));
  });
  it("portal UI hides the switcher for single-sector accounts and drops sector subtitles", () => {
    const portal = read("src/components/client-portal/ClientPortalApp.tsx");
    assert.ok(portal.includes("{showSectorSwitcher && ("));
    assert.ok(portal.includes("sectorCatalogItems"));
    assert.ok(portal.includes('data-testid="portal-reg-sector-preference"'));
    assert.ok(!portal.includes("قوائم الفرز اليومية، علاقيات القات وأخرى، ونقاط الاستلام المباشر"));
    assert.ok(!portal.includes("البضائع الكاملة والجزئية، المواد الغذائية"));
  });
});

describe("Phase 23 — client account lifecycle", () => {
  it("ACTIVE ↔ SUSPENDED ↔ ARCHIVED transitions and login/order gating", () => {
    assert.equal(nextAccountStatus("ACTIVE", "SUSPEND"), "SUSPENDED");
    assert.equal(nextAccountStatus("ACTIVE", "ARCHIVE"), "ARCHIVED");
    assert.equal(nextAccountStatus("SUSPENDED", "REACTIVATE"), "ACTIVE");
    assert.equal(nextAccountStatus("ARCHIVED", "REACTIVATE"), "ACTIVE");
    assert.throws(() => nextAccountStatus("SUSPENDED", "SUSPEND"));
    assert.throws(() => nextAccountStatus("ACTIVE", "REACTIVATE"));
    assert.equal(canClientLogin("ACTIVE").ok, true);
    assert.equal(canClientLogin("SUSPENDED").ok, false);
    assert.equal(canClientLogin("ARCHIVED").ok, false);
    assert.equal(canClientCreateOrders("ACTIVE"), true);
    assert.equal(canClientCreateOrders("ARCHIVED"), false);
  });
  it("service + admin route expose suspend/archive/restore/revoke/sector/bulk actions with audit", () => {
    const svc = read("src/lib/clientPortal/portalService.ts");
    assert.ok(svc.includes("export async function staffManageClientAccount"));
    assert.ok(svc.includes("sessionVersion"));
    assert.ok(svc.includes("CLIENT_PORTAL_${params.action}"));
    const route = read("src/app/api/portal-admin/clients/route.ts");
    for (const a of ["ARCHIVE", "REACTIVATE", "REVOKE_SESSIONS", "SET_SECTORS", "BULK_SET_SECTORS", "RESET_PASSWORD"]) {
      assert.ok(route.includes(a), a);
    }
    assert.ok(read("src/lib/clientPortal/clientAuth.ts").includes('account.status === "ARCHIVED"'));
  });
});

describe("Phase 23 — granular return-to-client edit permissions", () => {
  const before = {
    pickupLocation: "السوق",
    pickupNotes: "ظهراً",
    lines: [
      { id: "l1", itemTitle: "قات", qty: 2, unitCode: "QAT_BUNCH", unitLabel: "علاقية قات", unitPrice: 100 },
      { id: "l2", itemTitle: "أخرى", qty: 1, unitCode: "OTHER", unitLabel: "أخرى", customUnitLabel: "كرتون", unitPrice: 50 },
    ],
  };
  const clone = () => JSON.parse(JSON.stringify(before)) as typeof before;

  it("defaults to everything editable (backward compatible) and parses persisted JSON", () => {
    assert.deepEqual(normalizeReturnEditPermissions(undefined), DEFAULT_RETURN_EDIT_PERMISSIONS);
    assert.equal(normalizeReturnEditPermissions('{"price":false}').price, false);
    assert.equal(normalizeReturnEditPermissions("not json").quantity, true);
  });
  it("flags every locked-field modification", () => {
    const locked = { price: false, quantity: false, unit: false, pickupLocation: false, pickupNotes: false, lines: false };
    const a = clone();
    a.lines[0].unitPrice = 90;
    assert.deepEqual(findLockedFieldViolations(before, a, locked), ["price"]);
    const b = clone();
    b.lines[0].qty = 5;
    assert.deepEqual(findLockedFieldViolations(before, b, locked), ["quantity"]);
    const c = clone();
    c.lines[1].customUnitLabel = "كيس";
    assert.deepEqual(findLockedFieldViolations(before, c, locked), ["unit"]);
    const d = clone();
    d.pickupLocation = "الفرع";
    d.pickupNotes = "";
    assert.deepEqual(new Set(findLockedFieldViolations(before, d, locked)), new Set(["pickupLocation", "pickupNotes"]));
    const e = clone();
    e.lines.pop();
    e.lines.push({ id: undefined as unknown as string, itemTitle: "جديد", qty: 1, unitCode: "KG", unitLabel: "كجم", unitPrice: 1 });
    assert.deepEqual(findLockedFieldViolations(before, e, locked), ["lines"]);
  });
  it("allows changes only where permitted and passes untouched resubmissions", () => {
    const onlyQty = { ...DEFAULT_RETURN_EDIT_PERMISSIONS, price: false, unit: false, lines: false, pickupLocation: false, pickupNotes: false };
    const a = clone();
    a.lines[0].qty = 7;
    assert.doesNotThrow(() => assertReturnEditAllowed(before, a, onlyQty));
    a.lines[0].unitPrice = 1;
    assert.throws(() => assertReturnEditAllowed(before, a, onlyQty), (e: unknown) => portalErrorStatus(e) === 403);
    const locked = { price: false, quantity: false, unit: false, pickupLocation: false, pickupNotes: false, lines: false };
    assert.doesNotThrow(() => assertReturnEditAllowed(before, clone(), locked));
  });
  it("is persisted on RETURN_TO_CLIENT, enforced on resubmission and locked in the portal UI", () => {
    const svc = read("src/lib/clientPortal/portalService.ts");
    assert.ok(svc.includes("returnEditPermissionsJson: JSON.stringify("));
    assert.ok(svc.includes("assertReturnEditAllowed("));
    assert.ok(read("prisma/schema.prisma").includes("returnEditPermissionsJson"));
    assert.ok(read("src/lib/clientPortal/ensurePortalSchema.ts").includes("returnEditPermissionsJson"));
    const portal = read("src/components/client-portal/ClientPortalApp.tsx");
    for (const k of ["editLocks.price", "editLocks.quantity", "editLocks.unit", "editLocks.pickupLocation", "editLocks.pickupNotes", "editLocks.lines"]) {
      assert.ok(portal.includes(k), k);
    }
    assert.ok(read("src/components/portal-admin/TenantClientPortalAdminPanel.tsx").includes("staff-return-permissions-"));
  });
});

describe("Phase 23 — sector isolation + tenant-side control panel", () => {
  it("admin panel exposes the sector access control panel and per-client/bulk assignment", () => {
    const panel = read("src/components/portal-admin/ClientAccountsControlPanel.tsx");
    assert.ok(panel.includes("التحكم في القطاعات المتاحة للعملاء"));
    assert.ok(panel.includes("BULK_SET_SECTORS"));
    assert.ok(panel.includes("إدارة حسابات العملاء"));
    assert.ok(panel.includes("إنهاء الجلسات النشطة"));
  });
  it("client request list is restricted to allowed sectors and tenant-scoped", () => {
    const route = read("src/app/api/client-portal/requests/route.ts");
    assert.ok(route.includes("sectorAccess.allowedSectors"));
    assert.ok(route.includes("clientAccountId: auth.account.id"));
  });
});

describe("Phase 24 — subdomain URL sync, inventory field layout & 4-part separated navigation", () => {
  it("resolves /client/portal/orders, /client/portal/invoices & canonical portal paths", () => {
    assert.equal(resolvePortalRouteSection("/client/portal/orders")?.tab, "requests");
    assert.equal(resolvePortalRouteSection("/client/portal/invoices")?.tab, "statement");
    assert.equal(resolvePortalRouteSection("/client/portal/invoices")?.stmtTab, "bills");
    assert.equal(
      resolveCanonicalPortalPath({ portalTab: "new_request", activeSector: "HARVEST" }),
      "/client/portal/harvest"
    );
    assert.equal(
      resolveCanonicalPortalPath({ portalTab: "new_request", activeSector: "COMMERCIAL" }),
      "/client/portal/commercial"
    );
    assert.equal(resolveCanonicalPortalPath({ portalTab: "requests" }), "/client/portal/orders");
    assert.equal(
      resolveCanonicalPortalPath({ portalTab: "statement", stmtTab: "bills" }),
      "/client/portal/invoices"
    );
    assert.equal(
      resolveCanonicalPortalPath({ portalTab: "statement", stmtTab: "ledger" }),
      "/client/portal/statement"
    );
    const portal = read("src/components/client-portal/ClientPortalApp.tsx");
    assert.ok(portal.includes("resolveCanonicalPortalPath("));
    assert.ok(portal.includes("window.history.replaceState"));
    assert.ok(read("src/app/api/public/tenant/route.ts").includes('"/client/portal/"'));
  });

  it("resolves /sales/portal, /sales/ledgers, /sales/invoices & syncs 4-part workspace paths", () => {
    assert.ok(fs.existsSync(path.join(root, "src/app/sales/page.tsx")));
    assert.ok(fs.existsSync(path.join(root, "src/app/sales/[sub]/page.tsx")));
    assert.ok(read("src/proxy.ts").includes('"/sales/:path*"'));
    assert.equal(resolveWorkspaceRouteSection("/sales/portal")?.customersSection, "portal");
    assert.equal(resolveWorkspaceRouteSection("/sales/ledgers")?.customersSection, "cards");
    assert.equal(resolveWorkspaceRouteSection("/sales/invoices")?.tab, "sales");
    assert.equal(resolveWorkspaceRouteSection("/procurement")?.tab, "procurement");
    assert.equal(resolveWorkspaceRouteSection("/harvest")?.tab, "dashboard");
    assert.equal(resolveWorkspaceRouteSection("/commercial")?.sector, "COMMERCIAL");
    assert.equal(
      resolveCanonicalWorkspacePath({
        activeTab: "customers",
        activeTradingSector: "HARVEST",
        customersInitialSection: "portal",
      }),
      "/sales/portal"
    );
    assert.equal(
      resolveCanonicalWorkspacePath({
        activeTab: "customers",
        activeTradingSector: "HARVEST",
        customersInitialSection: "cards",
      }),
      "/sales/ledgers"
    );
    assert.equal(
      resolveCanonicalWorkspacePath({
        activeTab: "sales",
        activeTradingSector: "HARVEST",
      }),
      "/sales/invoices"
    );
  });

  it("fixes الصنف المخزني alignment/label and enforces dark option contrast & 4-part separation", () => {
    const inv = read("src/components/MultiUnitInventoryPanel.tsx");
    assert.ok(inv.includes("items-end"));
    assert.ok(!inv.includes("sm:col-span-2 lg:col-span-2 w-full min-w-0 truncate"));
    assert.ok(read("src/components/CommercialSectorWorkspace.tsx").includes("sm:col-span-12 grid"));
    assert.ok(read("src/app/globals.css").includes("select option,"));
    const shell = read("src/components/UasAppShell.tsx");
    for (const tid of [
      'data-testid="workspace-4part-nav"',
      'data-testid="workspace-part-sales-portal"',
      'data-testid="workspace-nav-client-portal"',
      'data-testid="workspace-nav-client-ledgers"',
      'data-testid="workspace-nav-sales-invoices"',
      'data-testid="workspace-part-procurement"',
      'data-testid="workspace-sector-tab-harvest"',
      'data-testid="workspace-sector-tab-commercial"',
    ]) {
      assert.ok(shell.includes(tid), tid);
    }
  });
});

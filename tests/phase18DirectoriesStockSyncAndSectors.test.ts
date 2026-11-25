import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { groupRequestsByClientAndMonth } from "../src/lib/clientPortal/requestGrouping";
import { computeBoardAvailabilityFromStock } from "../src/lib/clientPortal/catalogStockSync";
import { ERP_GROUPS, resolveGroupForTab } from "../src/lib/erpNavigation";
import { canAccessModule } from "../src/lib/permissions";

describe("Phase 18 — Client Monthly Directories, Stock Sync, Sales Relocation & Dual Sector Tabs", () => {
  it("groups incoming requests hierarchically under Client -> Monthly folders (YYYY-MM) with accurate summaries", () => {
    const sample = [
      {
        id: "r1",
        requestNumber: "REQ-01",
        status: "PENDING_REVIEW",
        totalEstimated: 20000,
        totalConfirmed: 0,
        createdAt: "2026-11-20T09:15:00.000Z",
        clientAccount: { id: "c1", fullName: "أحمد الجبري", phone: "77000111" },
      },
      {
        id: "r2",
        requestNumber: "REQ-02",
        status: "COMPLETED",
        totalEstimated: 15000,
        totalConfirmed: 16000,
        createdAt: "2026-11-04T12:00:00.000Z",
        clientAccount: { id: "c1", fullName: "أحمد الجبري", phone: "77000111" },
      },
      {
        id: "r3",
        requestNumber: "REQ-03",
        status: "CONFIRMED",
        totalEstimated: 9000,
        totalConfirmed: 9000,
        createdAt: "2026-10-18T15:30:00.000Z",
        clientAccount: { id: "c1", fullName: "أحمد الجبري", phone: "77000111" },
      },
      {
        id: "r4",
        requestNumber: "REQ-04",
        status: "PENDING_REVIEW",
        totalEstimated: 5000,
        totalConfirmed: 0,
        createdAt: "2026-11-10T08:00:00.000Z",
        clientAccount: { id: "c2", fullName: "محمد العامري", phone: "77000222" },
      },
    ];

    const res = groupRequestsByClientAndMonth(sample);
    assert.equal(res.directories.length, 2);
    assert.equal(res.clientOptions.length, 2);
    assert.equal(res.monthOptions.length, 2);

    const ahmedDir = res.directories.find((d) => d.clientKey === "c1")!;
    assert.equal(ahmedDir.totalRequests, 3);
    assert.equal(ahmedDir.openRequests, 2);
    assert.equal(ahmedDir.totalAmount, 45000);
    assert.equal(ahmedDir.months.length, 2);
    assert.equal(ahmedDir.months[0].monthKey, "2026-11");
    assert.equal(ahmedDir.months[0].requests.length, 2);
    assert.equal(ahmedDir.months[1].monthKey, "2026-10");
    assert.equal(ahmedDir.months[1].requests.length, 1);
  });

  it("maps live inventory remaining quantities to published catalog board availability statuses", () => {
    assert.equal(computeBoardAvailabilityFromStock(25, 5), "AVAILABLE");
    assert.equal(computeBoardAvailabilityFromStock(5, 5), "LIMITED");
    assert.equal(computeBoardAvailabilityFromStock(1, 5), "LIMITED");
    assert.equal(computeBoardAvailabilityFromStock(0, 5), "UNAVAILABLE");
    assert.equal(computeBoardAvailabilityFromStock(-2, 5), "UNAVAILABLE");
    assert.equal(computeBoardAvailabilityFromStock(null, 5), "AVAILABLE");

    const salesRouteSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/sales/route.ts"),
      "utf8"
    );
    assert.ok(salesRouteSrc.includes("syncPublishedCatalogStockTx"));

    const invRouteSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/inventory/route.ts"),
      "utf8"
    );
    assert.ok(invRouteSrc.includes("syncPublishedCatalogStockTx"));

    const invTabSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/tabs/InventoryTab.tsx"),
      "utf8"
    );
    assert.ok(invTabSrc.includes("inventory-sync-catalog-btn"));
  });

  it("promotes inventory as a main workflow tab, exposes Client Portal inside Sales, and renders dual trading sectors", () => {
    const invGroup = ERP_GROUPS.find((g) => g.id === "inventory");
    assert.ok(invGroup, "inventory must be promoted to a top-level ERP_GROUP");
    assert.equal(invGroup.defaultTab, "inventory");
    assert.equal(resolveGroupForTab("inventory").id, "inventory");
    assert.equal(canAccessModule("SALES_COLLECTOR", "inventory"), true);
    assert.equal(canAccessModule("PROCUREMENT_OFFICER", "inventory"), true);

    const salesTabSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/tabs/SalesTab.tsx"),
      "utf8"
    );
    assert.ok(salesTabSrc.includes("TenantClientPortalAdminPanel"));
    assert.ok(salesTabSrc.includes("sales-subview-portal"));

    const appShellSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/UasAppShell.tsx"),
      "utf8"
    );
    assert.ok(appShellSrc.includes("workspace-sector-tab-harvest"));
    assert.ok(appShellSrc.includes("workspace-sector-tab-commercial"));
    assert.ok(appShellSrc.includes("CommercialSectorWorkspace"));

    const portalAppSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/client-portal/ClientPortalApp.tsx"),
      "utf8"
    );
    assert.ok(portalAppSrc.includes("portal-sector-tab-harvest"));
    assert.ok(portalAppSrc.includes("portal-sector-tab-commercial"));
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET as publicTenantGET } from "../src/app/api/public/tenant/route";

describe("Phase 19 — qat.world Tenant Login Cards, Tenant Landing Client Cards & Header Login", () => {
  it("renders active UAS tenants as login-linked cards above UAS Architecture and tenant client cards with top header دخول", () => {
    const landingSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/LandingPage.tsx"),
      "utf8"
    );

    // 1. Top "دخول" button (root-login-cta) sits right after onToggleLang (English / العربية) for BOTH root & tenants
    const langBtnIdx = landingSrc.indexOf("onClick={onToggleLang}");
    const topLoginIdx = landingSrc.indexOf('data-testid="root-login-cta"');
    const heroIdx = landingSrc.indexOf("{/* Focused Hero Section */}");
    assert.ok(langBtnIdx > 0 && topLoginIdx > langBtnIdx && topLoginIdx < heroIdx);
    const headerSlice = landingSrc.slice(langBtnIdx, heroIdx);
    assert.ok(headerSlice.includes("English"));
    assert.ok(headerSlice.includes("العربية"));
    assert.ok(headerSlice.includes("دخول"));

    // 2. Active tenant cards block is present on the root landing (feature pillars were removed in the cleanup)
    const rootTenantsIdx = landingSrc.indexOf('data-testid="root-active-tenants-section"');
    assert.ok(rootTenantsIdx > 0);
    assert.ok(!landingSrc.includes("ركائز النظام المحاسبي الموحد"));

    // 3. Tenant client cards section present inside tenant landing view
    assert.ok(landingSrc.includes('data-testid="tenant-client-cards-section"'));
    assert.ok(landingSrc.includes('data-testid="tenant-client-portal-card"'));
  });

  it("GET /api/public/tenant returns sanitized activeTenants on qat.world without leaking private fields", async () => {
    const req = new NextRequest("https://qat.world/api/public/tenant", {
      headers: { host: "qat.world" },
    });
    const res = await publicTenantGET(req);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      isTenantWorkspace: boolean;
      activeTenants?: Array<{ slug: string; tenantUrl: string; nameAr: string }>;
    };
    assert.equal(body.success, true);
    assert.equal(body.isTenantWorkspace, false);
    assert.ok(Array.isArray(body.activeTenants));
    const aljabri = body.activeTenants!.find((t) => t.slug === "aljabri");
    assert.ok(aljabri, "Active tenant aljabri must appear in qat.world tenant cards");
    assert.ok(aljabri.tenantUrl.includes("aljabri.qat.world"));
  });
});

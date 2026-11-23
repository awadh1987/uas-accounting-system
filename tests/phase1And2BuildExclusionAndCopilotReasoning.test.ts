import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getBuildTarget, isPlatformAdminSurfaceEnabled } from "../src/lib/buildTarget";
import { requireSuperadminRootAuth } from "../src/lib/licensing/superadminLicenseService";
import { diagnoseLiveSystemState } from "../src/lib/localSupportEngine";
import {
  UAS_AGENT_TOOL_SCHEMAS,
  executeUasAgentTool,
} from "../src/lib/ai/uasAgentTools";
import {
  parseBilingualAgentIntent,
  runUasAiAgent,
} from "../src/lib/ai/offlineAgentEngine";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";
import type { UasBootstrapState } from "../src/types/uas";

function createTestWorkspaceState(): UasBootstrapState {
  const base: UasBootstrapState = structuredClone(INITIAL_FALLBACK_STATE);
  base.projects = [
    {
      id: "prj-1",
      code: "PRJ-001",
      name: "مزرعة الجوف",
      status: "نشط",
      plannedHarvests: 2,
      harvests: ["القطفة الأولى", "القطفة الثانية"],
      budgetTotal: 100000,
    },
  ];
  base.treasuryAccounts = [
    {
      id: "t1",
      code: "111101",
      name: "الصندوق الرئيسي",
      nameAr: "الصندوق الرئيسي",
      nameEn: "Main Cash",
      accountNo: "111101",
      type: "CASH",
      currencyCode: "YER",
      balance: 30000,
      balanceYER: 30000,
      isActive: true,
    },
    {
      id: "t2",
      code: "111201",
      name: "بنك الكريمي",
      nameAr: "بنك الكريمي",
      nameEn: "Kuraimi Bank",
      accountNo: "111201",
      type: "BANK",
      currencyCode: "YER",
      balance: 250000,
      balanceYER: 250000,
      isActive: true,
    },
  ];
  base.inventoryBatches = [
    {
      id: "lot-1",
      projectId: "prj-1",
      harvest: "القطفة الأولى",
      grade: "رقم 1",
      harvestedBundles: 100,
      shrinkageBundles: 15,
      notes: "دفعة أولى",
    },
  ];
  base.sales = [
    {
      id: "sal-1",
      voucherNo: "RV-101",
      projectId: "prj-1",
      harvest: "القطفة الأولى",
      grade: "رقم 1",
      customer: "شركة الأمل",
      phone: "777111222",
      bundles: 90,
      price: 2000,
      total: 180000,
      credit: 100000,
      debit: 80000,
      date: "2026-11-20",
      notes: "بيع آجل",
    },
  ];
  base.expenses = [
    {
      id: "exp-1",
      projectId: "prj-1",
      harvest: "القطفة الأولى",
      category: "وقود/محروقات",
      subType: "ديزل",
      qty: 1,
      unitPrice: 40000,
      total: 40000,
      date: "2026-11-20",
      notes: "وقود",
    },
  ];
  base.workers = [
    {
      id: "wrk-1",
      projectId: "prj-1",
      harvest: "القطفة الأولى",
      name: "أحمد علي",
      dailyWage: 5000,
      days: 4,
      total: 20000,
      credit: 15000,
      debit: 5000,
      date: "2026-11-20",
      notes: "أجر قطاف",
    },
  ];
  base.lockedPeriods = {
    "prj-1::القطفة الثانية": true,
  };
  return base;
}

test("Phase 1: Build targets exclude platform admin on mobile/desktop while keeping cloud active", async () => {
  const prevTarget = process.env.UAS_BUILD_TARGET;
  const prevPubTarget = process.env.NEXT_PUBLIC_UAS_BUILD_TARGET;
  const prevEnable = process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN;

  try {
    process.env.UAS_BUILD_TARGET = "cloud";
    process.env.NEXT_PUBLIC_UAS_BUILD_TARGET = "cloud";
    delete process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN;
    assert.equal(getBuildTarget(), "cloud");
    assert.equal(isPlatformAdminSurfaceEnabled(), true);

    process.env.UAS_BUILD_TARGET = "mobile";
    process.env.NEXT_PUBLIC_UAS_BUILD_TARGET = "mobile";
    process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN = "0";
    assert.equal(getBuildTarget(), "mobile");
    assert.equal(isPlatformAdminSurfaceEnabled(), false);

    const blockedReq = new Request("https://qat.world/api/superadmin/licenses", {
      method: "POST",
      headers: { host: "qat.world" },
    });
    const authRes = await requireSuperadminRootAuth(blockedReq as never);
    assert.equal(authRes.ok, false);
    if (!authRes.ok) {
      assert.equal(authRes.response.status, 403);
    }

    process.env.UAS_BUILD_TARGET = "desktop";
    process.env.NEXT_PUBLIC_UAS_BUILD_TARGET = "desktop";
    assert.equal(getBuildTarget(), "desktop");
    assert.equal(isPlatformAdminSurfaceEnabled(), false);

    // Check packaging scripts strip control-panel & superadmin while keeping LicenseActivationModal intact
    const capScript = fs.readFileSync(path.join(process.cwd(), "scripts", "build-capacitor.mjs"), "utf8");
    const relScript = fs.readFileSync(path.join(process.cwd(), "scripts", "build-commercial-release.mjs"), "utf8");
    assert.ok(capScript.includes("control-panel") && capScript.includes("superadmin"));
    assert.ok(relScript.includes("control-panel") && relScript.includes("superadmin"));
    assert.ok(fs.existsSync(path.join(process.cwd(), "src", "components", "LicenseActivationModal.tsx")));
  } finally {
    if (prevTarget === undefined) delete process.env.UAS_BUILD_TARGET;
    else process.env.UAS_BUILD_TARGET = prevTarget;
    if (prevPubTarget === undefined) delete process.env.NEXT_PUBLIC_UAS_BUILD_TARGET;
    else process.env.NEXT_PUBLIC_UAS_BUILD_TARGET = prevPubTarget;
    if (prevEnable === undefined) delete process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN;
    else process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN = prevEnable;
  }
});

test("Phase 2: Cross-section harvest reconciliation detects negative stock shortage, shrinkage rate & open AR", async () => {
  const state = createTestWorkspaceState();
  // Batch harvested 100 - 15 shrinkage = 85 net available; sold = 90 => 5 shortage
  const res = await executeUasAgentTool(
    "reconcile_harvest_inventory",
    { projectId: "prj-1", harvest: "القطفة الأولى" },
    { state, lang: "ar", user: "SUPER_ADMIN" }
  );

  assert.equal(res.ok, true);
  assert.equal(res.data?.shortageCount, 1);
  assert.equal(res.data?.shrinkageRate, 15);
  assert.equal(res.data?.uncollectedAR, 80000);
  assert.ok(res.summaryAr.includes("عجز"));
  assert.ok(res.citations && res.citations.length >= 2);
});

test("Phase 2: Cross-section pre-flight checks detect locked periods, stock deficits, liquidity & budget overshoots", async () => {
  const state = createTestWorkspaceState();

  // Locked harvest sale draft surfaces period lock warning
  const lockedSale = await executeUasAgentTool(
    "draft_sale_transaction",
    {
      projectId: "prj-1",
      harvest: "القطفة الثانية",
      customer: "شركة الأمل",
      bundles: 10,
      price: 2000,
    },
    { state, lang: "ar", user: "SUPER_ADMIN" }
  );
  assert.equal(lockedSale.ok, true);
  assert.equal(lockedSale.requiresConfirmation, true);
  assert.ok(
    lockedSale.confirmationCard?.preFlightChecks?.some((c) => c.key === "period_lock" && c.status === "blocked")
  );

  // Operating expense exceeding both treasury balance (30,000) and remaining budget (100,000 - 60,000 = 40,000)
  const expDraft = await executeUasAgentTool(
    "draft_operating_expense",
    {
      projectId: "prj-1",
      harvest: "القطفة الأولى",
      category: "وقود/محروقات",
      qty: 1,
      unitPrice: 50000,
      treasuryAccountId: "t1",
    },
    { state, lang: "en", user: "SUPER_ADMIN" }
  );
  assert.equal(expDraft.requiresConfirmation, true);
  assert.ok(
    expDraft.confirmationCard?.preFlightChecks?.some((c) => c.key === "treasury_balance" && c.status === "warning")
  );
  assert.ok(
    expDraft.confirmationCard?.preFlightChecks?.some((c) => c.key === "project_budget" && c.status === "warning")
  );
});

test("Phase 2: Interactive execution tools cover workers, treasury transfer, period lock RBAC, and workspace context", async () => {
  const state = createTestWorkspaceState();

  // Period lock RBAC blocked for FIELD_ACCOUNTANT
  const blockedLock = await executeUasAgentTool(
    "toggle_period_lock",
    { projectId: "prj-1", harvest: "القطفة الأولى" },
    { state, lang: "en", user: "FIELD_ACCOUNTANT" }
  );
  assert.equal(blockedLock.ok, false);
  assert.equal(blockedLock.code, "RBAC_FORBIDDEN");

  // Period lock allowed for CHIEF_ACCOUNTANT with stock & AR pre-lock audit
  const allowedLock = await executeUasAgentTool(
    "toggle_period_lock",
    { projectId: "prj-1", harvest: "القطفة الأولى" },
    { state, lang: "en", user: "CHIEF_ACCOUNTANT" }
  );
  assert.equal(allowedLock.ok, true);
  assert.equal(allowedLock.requiresConfirmation, true);
  assert.equal(allowedLock.confirmationCard?.operationType, "TOGGLE_PERIOD_LOCK");

  // Context-aware workspace briefing inspects active tab, project, harvest, and offline sync queue
  const ctxRes = await runUasAiAgent("تحليل الوضع الحالي عبر الأقسام", {
    lang: "ar",
    user: "SUPER_ADMIN",
    state,
    workspaceContext: {
      activeTab: "inventory",
      selectedProjectId: "prj-1",
      selectedHarvest: "القطفة الأولى",
      isOffline: true,
      offlineQueueCount: 3,
      pendingConflictsCount: 1,
    },
  });
  assert.equal(ctxRes.ok, true);
  assert.equal(ctxRes.toolName, "analyze_workspace_context");
  assert.ok(ctxRes.replyAr.includes("مزرعة الجوف"));
  assert.ok(ctxRes.replyAr.includes("3"));

  // Workers and Audit workspace scopes
  const workersRes = await executeUasAgentTool("query_workspace_data", { scope: "workers", query: "" }, { state, lang: "en" });
  assert.equal(workersRes.data?.totalOwed, 5000);
  const auditRes = await executeUasAgentTool(
    "query_workspace_data",
    { scope: "audit", query: "" },
    { state, lang: "en", workspaceContext: { offlineQueueCount: 2, pendingConflictsCount: 1 } }
  );
  assert.equal(auditRes.data?.lockedPeriodsCount, 1);
  assert.equal(auditRes.data?.offlineQueueCount, 2);
});

test("Phase 2: Support diagnostics & bilingual intent routing preserve offline/APK parity", () => {
  const diag = diagnoseLiveSystemState({
    license_status: "ACTIVE",
    is_valid: true,
    company_locked: true,
    company_matches: true,
    signature_verified: false,
    offline_queue_count: 4,
    pending_conflicts_count: 2,
    is_offline: true,
  });
  assert.ok(diag.findingsEn.some((f) => f.includes("signature")));
  assert.ok(diag.findingsEn.some((f) => f.includes("Pending queued operations: 4")));
  assert.ok(diag.remediationsEn.some((r) => r.includes("sync conflict")));

  const intentSale = parseBilingualAgentIntent("سجل بيع 10 علاقي بسعر 5000 للعميل شركة الأمل", {
    workspaceContext: { activeTab: "sales", selectedProjectId: "prj-1", selectedHarvest: "القطفة الأولى" },
  });
  assert.equal(intentSale.toolName, "draft_sale_transaction");
  assert.equal(intentSale.args.projectId, "prj-1");
  assert.equal(intentSale.args.harvest, "القطفة الأولى");

  const intentTransfer = parseBilingualAgentIntent("Treasury transfer 50000");
  assert.equal(intentTransfer.toolName, "draft_treasury_transfer");
  assert.ok(UAS_AGENT_TOOL_SCHEMAS.length >= 25);
});

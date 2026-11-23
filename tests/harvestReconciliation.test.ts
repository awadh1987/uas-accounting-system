import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  ensureTenantRegistered,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
} from "../src/lib/tenant";
import { issueSessionToken, SESSION_COOKIE_NAME } from "../src/lib/authSession";
import { hashPassword } from "../src/lib/serverBootstrap";
import { ensure6GenerationCoaHierarchy } from "../src/lib/accountingCoreEngine";
import { createTreasuryAccount } from "../src/lib/accounting/ledgerService";
import {
  canonicalizeLicensePayload,
  type UasLicensePayload,
} from "../src/lib/licensing/licenseSchema";
import {
  resolveTenantLicensePath,
  saveInstalledLicense,
} from "../src/lib/licensing/verifier";
import {
  evaluateSaleAgainstHarvestStock,
  reconcileHarvestInventory,
} from "../src/lib/harvestReconciliation";
import { PATCH as inventoryPATCH, POST as inventoryPOST } from "../src/app/api/inventory/route";
import { POST as salesPOST } from "../src/app/api/sales/route";
import type { UasInventoryBatch, UasSaleTransaction } from "../src/types/uas";

const TEST_TAG = `${Math.floor(10000 + Math.random() * 90000)}`;
const TEST_TENANT = `p3h-${TEST_TAG}`;

function makeReq(
  urlPath: string,
  method: string,
  token: string,
  body?: unknown
): NextRequest {
  const headers: Record<string, string> = {
    "x-uas-tenant-id": TEST_TENANT,
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
  };
  let bodyText: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    bodyText = JSON.stringify(body);
  }
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method,
    headers,
    ...(bodyText !== undefined ? { body: bodyText } : {}),
  });
}

describe("Phase 3: Harvest Reconciliation & Stock Integrity", () => {
  let adminToken = "";
  let salesUserToken = "";
  let projectId = "";
  let treasuryId = "";

  before(async () => {
    const tmpDb = path.join(process.cwd(), "data", `test_phase3_base_${TEST_TAG}.db`);
    process.env.DATABASE_URL = `file:${tmpDb}`;

    const dbFile = resolveTenantDbFilePath(TEST_TENANT);
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    ensureTenantRegistered(TEST_TENANT, "Harvest Reconciliation Test", { slug: TEST_TENANT });

    const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
    if (fs.existsSync(privPath)) {
      const priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));
      const payload: UasLicensePayload = {
        license_id: `UAS-P3-${TEST_TAG}`,
        customer_name: "Harvest Test Org",
        company_name: "Harvest Test Org",
        tenant_slug: TEST_TENANT,
        hwid: "*",
        allowed_modes: ["local", "lan", "cloud"],
        max_branches: 3,
        max_lan_seats: 10,
        max_users: 10,
        per_user_devices: { windows: 2, android: 2 },
        issued_at: new Date(Date.now() - 86_400_000).toISOString(),
        expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      };
      const sig = crypto
        .sign(null, Buffer.from(canonicalizeLicensePayload(payload), "utf8"), priv)
        .toString("base64");
      saveInstalledLicense({ ...payload, signature: sig }, TEST_TENANT);
    }

    await runWithTenant(TEST_TENANT, async () => {
      await prisma.enterpriseProfile.updateMany({
        data: { legalNameAr: "Harvest Test Org", legalNameEn: "Harvest Test Org", isConfigured: true },
      });
      await ensure6GenerationCoaHierarchy(prisma);
      const admin = await prisma.user.create({
        data: {
          username: `admin_p3_${TEST_TAG}`,
          name: "Chief Test",
          fullName: "Chief Test",
          email: `admin_p3_${TEST_TAG}@qat.world`,
          passwordHash: hashPassword("Secret123!"),
          role: "CHIEF_ACCOUNTANT",
          department: "Finance",
          active: true,
          isActive: true,
        },
      });
      const proj = await prisma.project.create({
        data: {
          code: `PRJ-P3-${TEST_TAG}`,
          name: `مزرعة الوادي ${TEST_TAG}`,
          nameAr: `مزرعة الوادي ${TEST_TAG}`,
          nameEn: `Wadi Farm ${TEST_TAG}`,
          type: "مزرعة",
          estimatedValue: 1000000,
          plannedHarvestCount: 2,
          notes: "",
        },
      });
      projectId = proj.id;
      await prisma.harvestCycle.create({
        data: { projectId: proj.id, name: "القطفة الأولى", cycleNumber: 1, isLocked: false },
      });

      const collector = await prisma.user.create({
        data: {
          username: `sales_p3_${TEST_TAG}`,
          name: "Field Collector",
          fullName: "Field Collector",
          email: `sales_p3_${TEST_TAG}@qat.world`,
          passwordHash: hashPassword("Secret123!"),
          role: "SALES_COLLECTOR",
          department: "Sales",
          assignedProjects: JSON.stringify([proj.id]),
          active: true,
          isActive: true,
        },
      });
      adminToken = issueSessionToken({
        userId: admin.id,
        userRole: admin.role,
        tenantId: TEST_TENANT,
        userDisplay: admin.name,
      });
      salesUserToken = issueSessionToken({
        userId: collector.id,
        userRole: collector.role,
        tenantId: TEST_TENANT,
        userDisplay: collector.name,
      });

      const tr = await createTreasuryAccount({
        nameAr: `صندوق رئيسي ${TEST_TAG}`,
        type: "VAULT",
        openingBalance: 100000,
        currency: "YER",
        createdById: admin.id,
      });
      treasuryId = tr.treasury.id;
    });
  });

  after(async () => {
    resetTenantClientsForTests();
    const dbFile = resolveTenantDbFilePath(TEST_TENANT);
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    const licFile = resolveTenantLicensePath(TEST_TENANT);
    if (fs.existsSync(licFile)) fs.unlinkSync(licFile);
    const baseDb = path.join(process.cwd(), "data", `test_phase3_base_${TEST_TAG}.db`);
    if (fs.existsSync(baseDb)) fs.unlinkSync(baseDb);
  });

  it("allocates sales FIFO across multiple harvest batches without row duplication and flags composite & unposted sales", () => {
    const batches: UasInventoryBatch[] = [
      {
        id: "b1",
        projectId: "p1",
        harvest: "القطفة الأولى",
        grade: "رقم 1",
        harvestedBundles: 100,
        shrinkageBundles: 10, // usable = 90
        notes: "صباحي",
      },
      {
        id: "b2",
        projectId: "p1",
        harvest: "القطفة الأولى",
        grade: "رقم 1",
        harvestedBundles: 80,
        shrinkageBundles: 0, // usable = 80 (group usable = 170)
        notes: "مسائي",
      },
      {
        id: "b3",
        projectId: "p1",
        harvest: "القطفة الثانية",
        grade: "رقم 1/رقم 2/رقم 3/ روس/بزغة",
        harvestedBundles: 250,
        shrinkageBundles: 5, // usable = 245
        notes: "مختلط",
      },
    ];

    const sales: UasSaleTransaction[] = [
      {
        id: "s1",
        projectId: "p1",
        harvest: "القطفة الأولى",
        batch: "SO-1",
        customer: "عميل 1",
        phone: "770",
        grade: "رقم 1",
        bundles: 120,
        price: 1000,
        total: 120000,
        credit: 120000,
        debit: 0,
        date: "2026-06-01",
        voucherNo: "RV-1",
        notes: "",
      },
      {
        id: "s2",
        projectId: "p1",
        harvest: "القطفة الثانية",
        batch: "SO-2",
        customer: "عميل 2",
        phone: "771",
        grade: "رقم 2",
        bundles: 45,
        price: 800,
        total: 36000,
        credit: 36000,
        debit: 0,
        date: "2026-06-02",
        voucherNo: "RV-2",
        notes: "",
      },
      {
        id: "s3",
        projectId: "p99",
        harvest: "قطفة غير مسجلة",
        batch: "SO-3",
        customer: "عميل 3",
        phone: "772",
        grade: "رقم 1",
        bundles: 30,
        price: 500,
        total: 15000,
        credit: 15000,
        debit: 0,
        date: "2026-06-03",
        voucherNo: "RV-3",
        notes: "",
      },
    ];

    const report = reconcileHarvestInventory(batches, sales);
    assert.equal(report.byBatchId["b1"].soldBundles, 90);
    assert.equal(report.byBatchId["b1"].remainingBundles, 0);
    assert.equal(report.byBatchId["b1"].status, "DEPLETED");

    assert.equal(report.byBatchId["b2"].soldBundles, 30);
    assert.equal(report.byBatchId["b2"].remainingBundles, 50);
    assert.equal(report.byBatchId["b2"].status, "MATCHED");

    // Composite batch absorbs single-grade "رقم 2" sale cleanly
    assert.equal(report.byBatchId["b3"].soldBundles, 45);
    assert.equal(report.byBatchId["b3"].remainingBundles, 200);
    assert.equal(report.byBatchId["b3"].matchedViaComposite, true);

    assert.equal(report.summary.totalHarvested, 430);
    assert.equal(report.summary.totalShrinkage, 15);
    assert.equal(report.summary.totalMatchedSold, 165);
    assert.equal(report.summary.totalRemaining, 250);
    assert.equal(report.summary.totalUnmatchedSold, 30);
    assert.equal(report.unmatchedSalesGroups.length, 1);

    const deficitCheck = evaluateSaleAgainstHarvestStock({
      batches,
      sales,
      projectId: "p1",
      harvest: "القطفة الأولى",
      grade: "رقم 1",
      requestedBundles: 60, // available is 50 -> shortage 10
    });
    assert.equal(deficitCheck.withinStock, false);
    assert.equal(deficitCheck.availableBundles, 50);
    assert.equal(deficitCheck.shortageBundles, 10);
  });

  it("preserves gross harvestedBundles on sales, blocks stock shortages, and requires authorized override", async () => {
    // 1. Create a harvest batch: 100 harvested, 10 shrinkage -> 90 usable
    const invRes = await inventoryPOST(
      makeReq("/api/inventory", "POST", adminToken, {
        projectId,
        harvest: "القطفة الأولى",
        grade: "رقم 1",
        harvestedBundles: 100,
        shrinkageBundles: 10,
        notes: "دفعة رئيسية",
      })
    );
    const invBodyText = await invRes.clone().text();
    assert.equal(invRes.status, 201, `inventoryPOST returned ${invRes.status}: ${invBodyText}`);
    const invJson = (await invRes.json()) as { createdId: string };
    const batchId = invJson.createdId;

    // 2. Record valid sale of 60 bundles
    const saleOk = await salesPOST(
      makeReq("/api/sales", "POST", salesUserToken, {
        projectId,
        harvest: "القطفة الأولى",
        grade: "رقم 1",
        customer: `عميل 1 ${TEST_TAG}`,
        bundles: 60,
        price: 1000,
        credit: 60000,
        treasuryAccountId: treasuryId,
      })
    );
    const saleOkText = await saleOk.clone().text();
    assert.equal(saleOk.status, 201, `saleOk returned ${saleOk.status}: ${saleOkText}`);

    // Confirm gross harvestedBundles was NOT decremented (eliminates double-deduction bug)
    await runWithTenant(TEST_TENANT, async () => {
      const batchDb = await prisma.harvestInventoryBatch.findUniqueOrThrow({
        where: { id: batchId },
      });
      assert.equal(batchDb.harvestedBundles, 100);
      assert.equal(batchDb.shrinkageBundles, 10);
    });

    // 3. Attempting to sell 40 bundles (remaining is 30) must fail 400 NEGATIVE_STOCK_BLOCKED
    const saleBlocked = await salesPOST(
      makeReq("/api/sales", "POST", salesUserToken, {
        projectId,
        harvest: "القطفة الأولى",
        grade: "رقم 1",
        customer: `عميل 2 ${TEST_TAG}`,
        bundles: 40,
        price: 1000,
        credit: 40000,
        treasuryAccountId: treasuryId,
      })
    );
    assert.equal(saleBlocked.status, 400);

    // 4. Non-privileged SALES_COLLECTOR cannot pass allowNegativeStock override (403)
    const unauthOverride = await salesPOST(
      makeReq("/api/sales", "POST", salesUserToken, {
        projectId,
        harvest: "القطفة الأولى",
        grade: "رقم 1",
        customer: `عميل 2 ${TEST_TAG}`,
        bundles: 40,
        price: 1000,
        credit: 40000,
        treasuryAccountId: treasuryId,
        allowNegativeStock: true,
      })
    );
    assert.equal(unauthOverride.status, 403);

    // 5. Updating batch harvestedBundles down below sold (50 harvested vs 60 sold) fails without override
    const batchShrinkBlocked = await inventoryPATCH(
      makeReq("/api/inventory", "PATCH", adminToken, {
        id: batchId,
        harvestedBundles: 50,
      })
    );
    assert.equal(batchShrinkBlocked.status, 400);

    // 6. CHIEF_ACCOUNTANT explicit override succeeds with audit log
    const saleOverrideOk = await salesPOST(
      makeReq("/api/sales", "POST", adminToken, {
        projectId,
        harvest: "القطفة الأولى",
        grade: "رقم 1",
        customer: `عميل معتمد ${TEST_TAG}`,
        bundles: 40,
        price: 1000,
        credit: 40000,
        date: "2026-06-05",
        treasuryAccountId: treasuryId,
        allowNegativeStock: true,
        negativeStockReason: "تسوية كمية فرز متأخرة",
      })
    );
    assert.equal(saleOverrideOk.status, 201);
  });
});

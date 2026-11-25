import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { canonicalizeLicensePayload, type UasLicensePayload } from "../src/lib/licensing/licenseSchema";
import { resolveTenantLicensePath, saveInstalledLicense } from "../src/lib/licensing/verifier";
import { getMachineHwid } from "../src/lib/licensing/hwid";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uas-p21-22-"));
const tmpDbPath = path.join(tmpDir, "phase21_22.sqlite");

const rootRegistryPath = path.join(process.cwd(), "tenants_registry.json");
const dataRegistryPath = path.join(process.cwd(), "data", "tenants_registry.json");
const origRootRegistry = fs.existsSync(rootRegistryPath) ? fs.readFileSync(rootRegistryPath, "utf8") : null;
const origDataRegistry = fs.existsSync(dataRegistryPath) ? fs.readFileSync(dataRegistryPath, "utf8") : null;

// 1x1 transparent PNG
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;
const SAMPLE_PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF", "utf8").toString("base64")}`;

const TEST_SLUG_A = "p21test-alpha";
const TEST_SLUG_B = "p21test-beta";

function seedTenantLicense(slug: string, nameAr: string) {
  const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
  const priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));
  const payload: UasLicensePayload = {
    license_id: `UAS-P21-${slug}`,
    customer_name: nameAr,
    hwid: getMachineHwid(),
    allowed_modes: ["local", "lan", "cloud"],
    max_branches: 10,
    max_lan_seats: 20,
    issued_at: new Date(Date.now() - 86400_000).toISOString(),
    expires_at: new Date(Date.now() + 86400_000 * 365).toISOString(),
    tenant_slug: slug,
    tenant_url: `https://${slug}.qat.world`,
    name_ar: nameAr,
    name_en: slug,
  };
  const sig = crypto
    .sign(null, Buffer.from(canonicalizeLicensePayload(payload), "utf8"), priv)
    .toString("base64");
  saveInstalledLicense({ ...payload, signature: sig }, slug);
}

describe("Phase 21 & 22 — Unlimited Scale (1,000+ Tenants × 1,000+ Clients) & Client Portal Payment Gate", () => {
  let defaultPrisma: typeof import("../src/lib/prisma").defaultPrisma;
  let ensureSqliteDatabaseReady: typeof import("../src/lib/sqliteBootstrap").ensureSqliteDatabaseReady;
  let ensure6GenerationCoaHierarchy: typeof import("../src/lib/accountingCoreEngine").ensure6GenerationCoaHierarchy;
  let hashPassword: typeof import("../src/lib/serverBootstrap").hashPassword;
  let issueSessionToken: typeof import("../src/lib/authSession").issueSessionToken;
  let invalidateTenantRegistryCache: typeof import("../src/lib/tenant/tenantRegistry").invalidateTenantRegistryCache;
  let findTenantBySlug: typeof import("../src/lib/tenant/tenantRegistry").findTenantBySlug;
  let resolveTenantBySlugAsync: typeof import("../src/lib/tenant/tenantRegistry").resolveTenantBySlugAsync;
  let applyPgBouncerParams: typeof import("../src/lib/tenant/tenantDbManager").applyPgBouncerParams;
  let buildPooledTenantRlsStatements: typeof import("../src/lib/tenant/tenantDbManager").buildPooledTenantRlsStatements;
  let evictTenantPrismaCacheIfNeeded: typeof import("../src/lib/tenant/tenantDbManager").evictTenantPrismaCacheIfNeeded;
  let getTenantPrismaCacheStats: typeof import("../src/lib/tenant/tenantDbManager").getTenantPrismaCacheStats;

  let registerRoute: typeof import("../src/app/api/client-portal/register/route");
  let loginRoute: typeof import("../src/app/api/client-portal/login/route");
  let tenantsRoute: typeof import("../src/app/api/client-portal/tenants/route");
  let switchTenantRoute: typeof import("../src/app/api/client-portal/switch-tenant/route");
  let clientPaymentsRoute: typeof import("../src/app/api/client-portal/payments/route");
  let clientReceiptRoute: typeof import("../src/app/api/client-portal/payments/[id]/receipt/route");
  let clientStatementRoute: typeof import("../src/app/api/client-portal/statement/route");
  let adminClientsRoute: typeof import("../src/app/api/portal-admin/clients/route");
  let adminChannelsRoute: typeof import("../src/app/api/portal-admin/payment-channels/route");
  let adminPaymentsRoute: typeof import("../src/app/api/portal-admin/payments/route");
  let inventoryItemsRoute: typeof import("../src/app/api/inventory/items/route");
  let inventoryMovementsRoute: typeof import("../src/app/api/inventory/movements/route");
  let commercialOpsRoute: typeof import("../src/app/api/commercial/ops/route");
  let catalogBoardLib: typeof import("../src/lib/clientPortal/catalogBoard");
  let portalConfigLib: typeof import("../src/lib/clientPortal/portalConfig");

  let staffCookie = "";
  let treasuryId = "";
  let treasuryGlAccountId = "";

  let clientAlphaId = "";
  let clientAlphaToken = "";
  let clientBetaId = "";
  let clientBetaToken = "";
  let otherClientToken = "";

  let walletChannelId = "";
  let openInvoiceId = "";
  let createdPaymentId = "";

  function makeReq(
    url: string,
    opts?: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      tenantSlug?: string;
      clientToken?: string;
      cookie?: string;
    }
  ): NextRequest {
    const headers: Record<string, string> = { ...(opts?.headers || {}) };
    if (opts?.tenantSlug) headers["x-uas-tenant-id"] = opts.tenantSlug;
    if (opts?.clientToken) headers["x-uas-client-token"] = opts.clientToken;
    if (opts?.cookie) headers["cookie"] = opts.cookie;
    let bodyStr: string | undefined;
    if (opts?.body !== undefined) {
      headers["content-type"] = "application/json";
      bodyStr = JSON.stringify(opts.body);
    }
    return new NextRequest(url, {
      method: opts?.method || "GET",
      headers,
      ...(bodyStr !== undefined ? { body: bodyStr } : {}),
    });
  }

  before(async () => {
    process.env.DATABASE_URL = `file:${tmpDbPath}`;
    process.env.UAS_TENANT_DB_MODE = "shared";

    ({ defaultPrisma } = await import("../src/lib/prisma"));
    ({ ensureSqliteDatabaseReady } = await import("../src/lib/sqliteBootstrap"));
    ({ ensure6GenerationCoaHierarchy } = await import("../src/lib/accountingCoreEngine"));
    ({ hashPassword } = await import("../src/lib/serverBootstrap"));
    ({ issueSessionToken } = await import("../src/lib/authSession"));
    ({ invalidateTenantRegistryCache, findTenantBySlug, resolveTenantBySlugAsync } = await import(
      "../src/lib/tenant/tenantRegistry"
    ));
    ({
      applyPgBouncerParams,
      buildPooledTenantRlsStatements,
      evictTenantPrismaCacheIfNeeded,
      getTenantPrismaCacheStats,
    } = await import("../src/lib/tenant/tenantDbManager"));

    registerRoute = await import("../src/app/api/client-portal/register/route");
    loginRoute = await import("../src/app/api/client-portal/login/route");
    tenantsRoute = await import("../src/app/api/client-portal/tenants/route");
    switchTenantRoute = await import("../src/app/api/client-portal/switch-tenant/route");
    clientPaymentsRoute = await import("../src/app/api/client-portal/payments/route");
    clientReceiptRoute = await import("../src/app/api/client-portal/payments/[id]/receipt/route");
    clientStatementRoute = await import("../src/app/api/client-portal/statement/route");
    adminClientsRoute = await import("../src/app/api/portal-admin/clients/route");
    adminChannelsRoute = await import("../src/app/api/portal-admin/payment-channels/route");
    adminPaymentsRoute = await import("../src/app/api/portal-admin/payments/route");
    inventoryItemsRoute = await import("../src/app/api/inventory/items/route");
    inventoryMovementsRoute = await import("../src/app/api/inventory/movements/route");
    commercialOpsRoute = await import("../src/app/api/commercial/ops/route");
    catalogBoardLib = await import("../src/lib/clientPortal/catalogBoard");
    portalConfigLib = await import("../src/lib/clientPortal/portalConfig");

    await ensureSqliteDatabaseReady();
    await ensure6GenerationCoaHierarchy(defaultPrisma);

    // Register two active test tenants in central registry table & invalidate cache
    for (const [slug, nameAr] of [
      [TEST_SLUG_A, "مؤسسة ألفا التجارية"],
      [TEST_SLUG_B, "مؤسسة بيتا للاستيراد"],
    ] as const) {
      await defaultPrisma.tenantRegistry.upsert({
        where: { slug },
        update: { status: "ACTIVE", nameAr, isolationMode: "POOLED_RLS" },
        create: {
          slug,
          tenantId: slug.replace(/-/g, "_"),
          nameAr,
          nameEn: slug,
          companyName: nameAr,
          status: "ACTIVE",
          isolationMode: "POOLED_RLS",
          schemaOrDb: "uas_qat_prod",
          postgresDb: "uas_qat_prod",
          tenantUrl: `https://${slug}.qat.world`,
        },
      });
      seedTenantLicense(slug, nameAr);
    }
    invalidateTenantRegistryCache();

    // Seed an Enterprise staff user (Username + Title for WhatsApp signature assertions)
    const staff = await defaultPrisma.user.create({
      data: {
        username: "khalid.cfo",
        name: "خالد العريقي",
        fullName: "خالد العريقي",
        displayName: "المدير المالي",
        email: "khalid.cfo@alpha.example",
        passwordHash: hashPassword("StaffPass#2026"),
        role: "SUPER_ADMIN",
        isActive: true,
      },
    });
    const tok = issueSessionToken({
      userId: staff.id,
      userRole: "SUPER_ADMIN",
      tenantId: "default",
      userDisplay: staff.fullName,
    });
    staffCookie = `uas_session=${tok}`;

    // Seed active TreasuryAccount linked to a dedicated COA asset account
    const glAcc = await defaultPrisma.account.create({
      data: {
        code: "110299",
        nameAr: "محفظة جوالي التشغيلية",
        nameEn: "Jawali Operational Wallet",
        type: "ASSET",
        level: 5,
        isPosting: true,
      },
    });
    treasuryGlAccountId = glAcc.id;

    const treasury = await defaultPrisma.treasuryAccount.create({
      data: {
        code: "TR-WALLET-JAWALI",
        name: "حساب جوالي الرئيسي",
        nameAr: "حساب جوالي الرئيسي",
        nameEn: "Main Jawali Wallet",
        type: "WALLET",
        currency: "YER",
        accountNumber: "770099887",
        accountId: glAcc.id,
        isActive: true,
      },
    });
    treasuryId = treasury.id;
  });

  after(async () => {
    try {
      await defaultPrisma.$disconnect();
    } catch {
      // ignore
    }
    if (origRootRegistry !== null) fs.writeFileSync(rootRegistryPath, origRootRegistry, "utf8");
    if (origDataRegistry !== null) fs.writeFileSync(dataRegistryPath, origDataRegistry, "utf8");
    for (const slug of [TEST_SLUG_A, TEST_SLUG_B]) {
      const uploadDir = path.join(process.cwd(), "data", "uploads", slug);
      if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true });
      const licPath = resolveTenantLicensePath(slug);
      if (fs.existsSync(licPath)) fs.rmSync(licPath, { force: true });
      const leftoverDb = path.join(process.cwd(), "data", "tenants", `${slug}.db`);
      if (fs.existsSync(leftoverDb)) fs.rmSync(leftoverDb, { force: true });
    }
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Phase 21.1 — resolves 1,000+ tenants in O(1) cached lookup & invalidates immediately on writes", async () => {
    const bulkRows = Array.from({ length: 1050 }, (_, idx) => ({
      slug: `scale-tenant-${String(idx).padStart(4, "0")}`,
      tenantId: `scale_tenant_${idx}`,
      nameAr: `منشأة اختبار ${idx}`,
      nameEn: `Scale Tenant ${idx}`,
      companyName: `Scale Tenant ${idx}`,
      status: "ACTIVE",
      isolationMode: "POOLED_RLS",
      schemaOrDb: "uas_qat_prod",
      postgresDb: "uas_qat_prod",
      tenantUrl: `https://scale-tenant-${String(idx).padStart(4, "0")}.qat.world`,
    }));

    // Insert 1,050 rows into central tenants table in chunks
    for (let i = 0; i < bulkRows.length; i += 250) {
      await defaultPrisma.tenantRegistry.createMany({
        data: bulkRows.slice(i, i + 250),
      });
    }
    invalidateTenantRegistryCache();

    // Warm cache from DB
    const first = await resolveTenantBySlugAsync("scale-tenant-0999");
    assert.ok(first);
    assert.equal(first.slug, "scale-tenant-0999");

    // 1,000 sequential O(1) lookups must complete well under 100ms
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const slug = `scale-tenant-${String((i * 7) % 1050).padStart(4, "0")}`;
      const found = findTenantBySlug(slug);
      assert.ok(found, `Missing cached tenant ${slug}`);
    }
    const elapsedMs = performance.now() - t0;
    assert.ok(elapsedMs < 150, `Expected 1,000 O(1) lookups < 150ms, got ${elapsedMs.toFixed(1)}ms`);

    // Update nameAr in DB + invalidate cache -> fresh value returned immediately
    await defaultPrisma.tenantRegistry.update({
      where: { slug: "scale-tenant-0500" },
      data: { nameAr: "منشأة محدثة 500" },
    });
    invalidateTenantRegistryCache();
    const updated = await resolveTenantBySlugAsync("scale-tenant-0500");
    assert.equal(updated?.nameAr, "منشأة محدثة 500");
  });

  it("Phase 21.2 — allows SAME phone & email across multiple tenants, blocks duplicate within same tenant, and switches workspace with (tenantSlug, clientId) isolation", async () => {
    const sharedPhoneAlpha = "771234567";
    const sharedPhoneBeta = "+967 771 234 567"; // normalizes identically to 771234567
    const sharedEmailAlpha = "Merchant.Ali@Example.COM";
    const sharedEmailBeta = "merchant.ali@example.com";
    const unifiedPass = "AliPortal#99";

    // Register in Alpha
    const regARes = await registerRoute.POST(
      makeReq("http://localhost/api/client-portal/register", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        body: {
          fullName: "علي التاجر",
          phone: sharedPhoneAlpha,
          email: sharedEmailAlpha,
          password: unifiedPass,
          preferredPickup: "السوق",
        },
      })
    );
    assert.equal(regARes.status, 201);
    const regAData = await regARes.json();
    clientAlphaId = regAData.account.id;
    assert.equal(regAData.account.tenantSlug, TEST_SLUG_A);
    assert.ok(regAData.account.globalClientId);

    // Register SAME normalized phone inside SAME tenant Alpha -> must fail (per-tenant uniqueness)
    const dupSameTenantRes = await registerRoute.POST(
      makeReq("http://localhost/api/client-portal/register", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        body: {
          fullName: "مكرر داخل نفس المنشأة",
          phone: "00967771234567",
          email: "other@example.com",
          password: unifiedPass,
        },
      })
    );
    assert.equal(dupSameTenantRes.status, 409);

    // Register SAME normalized phone & case-insensitive email in Beta -> must SUCCEED with distinct clientId & SAME globalClientId
    const regBRes = await registerRoute.POST(
      makeReq("http://localhost/api/client-portal/register", {
        method: "POST",
        tenantSlug: TEST_SLUG_B,
        body: {
          fullName: "علي التاجر - فرع بيتا",
          phone: sharedPhoneBeta,
          email: sharedEmailBeta,
          password: unifiedPass,
          preferredPickup: "صنعاء",
        },
      })
    );
    assert.equal(regBRes.status, 201);
    const regBData = await regBRes.json();
    clientBetaId = regBData.account.id;
    assert.notEqual(clientAlphaId, clientBetaId);
    assert.equal(regBData.account.globalClientId, regAData.account.globalClientId);

    // Register a second client in Alpha for cross-client access tests
    const otherRes = await registerRoute.POST(
      makeReq("http://localhost/api/client-portal/register", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        body: {
          fullName: "عميل آخر في ألفا",
          phone: "779998877",
          email: "other.client@example.com",
          password: unifiedPass,
        },
      })
    );
    assert.equal(otherRes.status, 201);
    const otherData = await otherRes.json();

    // Activate all three accounts + link Alpha client to a Customer & open SalesInvoice (40,000 YER)
    const arAcc = await defaultPrisma.account.create({
      data: {
        code: "1121999",
        nameAr: "ذمم علي التاجر - ألفا",
        nameEn: "AR Ali Trader Alpha",
        type: "ASSET",
        level: 5,
        isPosting: true,
      },
    });
    const custAlpha = await defaultPrisma.customer.create({
      data: {
        tenantSlug: TEST_SLUG_A,
        code: "CUST-ALPHA-01",
        name: "علي التاجر",
        nameAr: "علي التاجر",
        phone: "771234567",
        creditLimit: 100000,
        accountId: arAcc.id,
      },
    });
    const proj =
      (await defaultPrisma.project.findFirst()) ||
      (await defaultPrisma.project.create({
        data: {
          code: "PRJ-ALPHA-01",
          name: "مشروع ألفا",
          nameAr: "مشروع ألفا",
          nameEn: "Alpha Project",
        },
      }));

    await defaultPrisma.clientPortalAccount.update({
      where: { id: clientAlphaId },
      data: { status: "ACTIVE", customerId: custAlpha.id },
    });
    await defaultPrisma.clientPortalAccount.update({
      where: { id: clientBetaId },
      data: { status: "ACTIVE" },
    });
    await defaultPrisma.clientPortalAccount.update({
      where: { id: otherData.account.id },
      data: { status: "ACTIVE" },
    });

    const inv = await defaultPrisma.salesInvoice.create({
      data: {
        tenantSlug: TEST_SLUG_A,
        invoiceNumber: "INV-ALPHA-1001",
        customerId: custAlpha.id,
        projectId: proj.id,
        date: new Date(),
        subTotal: 40000,
        taxAmount: 0,
        totalAmount: 40000,
        paidAmount: 0,
        balanceDue: 40000,
        status: "POSTED",
      },
    });
    openInvoiceId = inv.id;

    // Login in Alpha using 9-digit phone
    const loginARes = await loginRoute.POST(
      makeReq("http://localhost/api/client-portal/login", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        body: { identifier: "771234567", password: unifiedPass },
      })
    );
    assert.equal(loginARes.status, 200);
    clientAlphaToken = (await loginARes.json()).token;

    // Login as other client in Alpha
    const loginOtherRes = await loginRoute.POST(
      makeReq("http://localhost/api/client-portal/login", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        body: { identifier: "779998877", password: unifiedPass },
      })
    );
    assert.equal(loginOtherRes.status, 200);
    otherClientToken = (await loginOtherRes.json()).token;

    // Verify Alpha token is strictly rejected when presented to Beta tenant!
    const crossTenantAttempt = await clientPaymentsRoute.GET(
      makeReq("http://localhost/api/client-portal/payments", {
        tenantSlug: TEST_SLUG_B,
        clientToken: clientAlphaToken,
      })
    );
    assert.equal(crossTenantAttempt.status, 403);

    // My Tenants / Workspace Switcher lists BOTH Alpha & Beta
    const listTenantsRes = await tenantsRoute.GET(
      makeReq("http://localhost/api/client-portal/tenants", {
        tenantSlug: TEST_SLUG_A,
        clientToken: clientAlphaToken,
      })
    );
    assert.equal(listTenantsRes.status, 200);
    const listTenantsData = await listTenantsRes.json();
    const slugs = (listTenantsData.memberships as Array<{ tenantSlug: string }>).map((m) => m.tenantSlug);
    assert.ok(slugs.includes(TEST_SLUG_A));
    assert.ok(slugs.includes(TEST_SLUG_B));

    // Switch tenant from Alpha -> Beta issues Beta-scoped token
    const switchRes = await switchTenantRoute.POST(
      makeReq("http://localhost/api/client-portal/switch-tenant", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        clientToken: clientAlphaToken,
        body: { targetTenantSlug: TEST_SLUG_B },
      })
    );
    assert.equal(switchRes.status, 200);
    const switchData = await switchRes.json();
    assert.equal(switchData.tenantSlug, TEST_SLUG_B);
    assert.equal(switchData.account.id, clientBetaId);
    clientBetaToken = switchData.token;
    assert.ok(clientBetaToken);

    // Beta's statement has 0 invoices (isolated from Alpha's 40,000 invoice)
    const betaStmtRes = await clientStatementRoute.GET(
      makeReq("http://localhost/api/client-portal/statement", {
        tenantSlug: TEST_SLUG_B,
        clientToken: clientBetaToken,
      })
    );
    assert.equal(betaStmtRes.status, 200);
    const betaStmt = await betaStmtRes.json();
    assert.equal(betaStmt.bills.length, 0);
  });

  it("Phase 21.3 — paginates 1,000+ clients cleanly & enforces LRU + PgBouncer + RLS helpers", async () => {
    const bulkClients = Array.from({ length: 1020 }, (_, i) => ({
      tenantSlug: TEST_SLUG_A,
      fullName: `عميل الجملة رقم ${i}`,
      phone: `73${String(1000000 + i)}`,
      normalizedPhone: `73${String(1000000 + i)}`,
      email: `bulk.${i}@alpha.example`,
      normalizedEmail: `bulk.${i}@alpha.example`,
      passwordHash: "hash",
      clientType: "DIRECT_CLIENT",
      preferredPickup: "السوق",
      status: "ACTIVE",
    }));
    for (let i = 0; i < bulkClients.length; i += 250) {
      await defaultPrisma.clientPortalAccount.createMany({
        data: bulkClients.slice(i, i + 250),
      });
    }

    const page1Res = await adminClientsRoute.GET(
      makeReq("http://localhost/api/portal-admin/clients?page=1&pageSize=50", {
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
      })
    );
    assert.equal(page1Res.status, 200);
    const page1 = await page1Res.json();
    assert.ok(page1.pagination.total >= 1020);
    assert.ok(page1.pagination.totalPages >= 21);
    assert.equal(page1.clients.length, 50);

    const searchRes = await adminClientsRoute.GET(
      makeReq(
        `http://localhost/api/portal-admin/clients?search=${encodeURIComponent("731000999")}`,
        { tenantSlug: TEST_SLUG_A, cookie: staffCookie }
      )
    );
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.clients.length, 1);
    assert.equal(searchData.clients[0].phone, "731000999");

    // Verify PgBouncer URL parameterization & RLS DDL generation & LRU stats
    const pgUrl = applyPgBouncerParams("postgresql://u:p@127.0.0.1:6432/uas_qat_prod", {
      pgbouncer: true,
      connectionLimit: 12,
    });
    assert.ok(pgUrl.includes("pgbouncer=true"));
    assert.ok(pgUrl.includes("connection_limit=12"));

    const rlsDdls = buildPooledTenantRlsStatements(["Customer", "ClientPaymentReceipt"]);
    assert.ok(rlsDdls.some((s) => s.includes("ENABLE ROW LEVEL SECURITY")));
    assert.ok(rlsDdls.some((s) => s.includes("FORCE ROW LEVEL SECURITY")));
    assert.ok(rlsDdls.some((s) => s.includes("current_setting('app.current_tenant', true)")));

    evictTenantPrismaCacheIfNeeded();
    const stats = getTenantPrismaCacheStats();
    assert.ok(stats.maxClients >= 1);
  });

  it("Phase 22 — configures payment channels, enforces duplicate reference & receipt auth, approves idempotently with balanced double-entry & WhatsApp draft", async () => {
    // 1. Staff configures WALLET, BANK, and CASH_DEPOSIT payment channels
    for (const ch of [
      {
        category: "WALLET",
        providerCode: "JAWALI",
        displayNameAr: "محفظة جوالي الرسمية",
        currency: "YER",
        accountOrWalletNumber: "770099887",
        beneficiaryName: "مؤسسة ألفا",
        treasuryAccountId: treasuryId,
      },
      {
        category: "BANK",
        providerCode: "KURAIMI_BANK",
        displayNameAr: "بنك الكريمي الإسلامي",
        currency: "YER",
        accountOrWalletNumber: "300112233",
        beneficiaryName: "مؤسسة ألفا",
        treasuryAccountId: treasuryId,
      },
      {
        category: "CASH_DEPOSIT",
        providerCode: "BRANCH_DEPOSIT",
        displayNameAr: "إيداع نقدي - صندوق المركز الرئيسي",
        currency: "YER",
        accountOrWalletNumber: "BOX-MAIN-01",
        beneficiaryName: "أمين الصندوق",
        treasuryAccountId: treasuryId,
      },
    ]) {
      const chRes = await adminChannelsRoute.POST(
        makeReq("http://localhost/api/portal-admin/payment-channels", {
          method: "POST",
          tenantSlug: TEST_SLUG_A,
          cookie: staffCookie,
          body: ch,
        })
      );
      assert.equal(chRes.status, 201);
      const chData = await chRes.json();
      if (ch.category === "WALLET") walletChannelId = chData.channel.id;
    }

    // Beta must see 0 channels configured by Alpha; Alpha admin sees all 3 channels
    const adminChRes = await adminChannelsRoute.GET(
      makeReq("http://localhost/api/portal-admin/payment-channels", {
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
      })
    );
    assert.equal(adminChRes.status, 200);
    assert.equal((await adminChRes.json()).channels.length, 3);

    const betaChannelsRes = await clientPaymentsRoute.GET(
      makeReq("http://localhost/api/client-portal/payments", {
        tenantSlug: TEST_SLUG_B,
        clientToken: clientBetaToken,
      })
    );
    assert.equal(betaChannelsRes.status, 200);
    assert.equal((await betaChannelsRes.json()).channels.length, 0);

    // 2. Client submits payment + PNG receipt in Alpha
    const submitRes = await clientPaymentsRoute.POST(
      makeReq("http://localhost/api/client-portal/payments", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        clientToken: clientAlphaToken,
        body: {
          channelId: walletChannelId,
          amount: 25000,
          currency: "YER",
          transferReference: "JWL-2026-001",
          transferDate: "25 / 11 / 2026",
          transferTime: "14:35",
          linkedInvoiceIds: [openInvoiceId],
          clientNotes: "تحويل عبر جوالي",
          receiptDataUrl: SAMPLE_PNG_DATA_URL,
          receiptFileName: "jawali-receipt.png",
        },
      })
    );
    assert.equal(submitRes.status, 201);
    const submitData = await submitRes.json();
    createdPaymentId = submitData.payment.id;
    assert.equal(submitData.payment.status, "PENDING_VERIFICATION");
    assert.equal(submitData.payment.transferDateDmy, "25 / 11 / 2026");
    assert.equal(submitData.payment.transferTimeHm, "14:35");

    // Invoice balance must remain UNCHANGED (40,000) before accountant verification
    const invBefore = await defaultPrisma.salesInvoice.findUniqueOrThrow({ where: { id: openInvoiceId } });
    assert.equal(Number(invBefore.balanceDue), 40000);
    assert.equal(Number(invBefore.paidAmount), 0);

    // 3. Duplicate transfer reference detection (normalized spaces/hyphens/case) -> 409
    const dupRefRes = await clientPaymentsRoute.POST(
      makeReq("http://localhost/api/client-portal/payments", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        clientToken: clientAlphaToken,
        body: {
          channelId: walletChannelId,
          amount: 25000,
          transferReference: "jwl 2026 001",
          receiptDataUrl: SAMPLE_PNG_DATA_URL,
        },
      })
    );
    assert.equal(dupRefRes.status, 409);

    // 4. Receipt file access control: 401 unauthenticated, 403 cross-client & cross-tenant, 200 owner & staff
    const unauthReceipt = await clientReceiptRoute.GET(
      makeReq(`http://localhost/api/client-portal/payments/${createdPaymentId}/receipt`, {
        tenantSlug: TEST_SLUG_A,
      }),
      { params: Promise.resolve({ id: createdPaymentId }) }
    );
    assert.equal(unauthReceipt.status, 401);

    const otherClientReceipt = await clientReceiptRoute.GET(
      makeReq(`http://localhost/api/client-portal/payments/${createdPaymentId}/receipt`, {
        tenantSlug: TEST_SLUG_A,
        clientToken: otherClientToken,
      }),
      { params: Promise.resolve({ id: createdPaymentId }) }
    );
    assert.equal(otherClientReceipt.status, 403);

    const crossTenantReceipt = await clientReceiptRoute.GET(
      makeReq(`http://localhost/api/client-portal/payments/${createdPaymentId}/receipt`, {
        tenantSlug: TEST_SLUG_B,
        clientToken: clientBetaToken,
      }),
      { params: Promise.resolve({ id: createdPaymentId }) }
    );
    assert.equal(crossTenantReceipt.status, 404);

    const ownerReceipt = await clientReceiptRoute.GET(
      makeReq(`http://localhost/api/client-portal/payments/${createdPaymentId}/receipt`, {
        tenantSlug: TEST_SLUG_A,
        clientToken: clientAlphaToken,
      }),
      { params: Promise.resolve({ id: createdPaymentId }) }
    );
    assert.equal(ownerReceipt.status, 200);
    assert.equal(ownerReceipt.headers.get("X-Content-Type-Options"), "nosniff");

    // 5. Return for clarification + Resubmit with PDF attachment
    const returnRes = await adminPaymentsRoute.POST(
      makeReq("http://localhost/api/portal-admin/payments", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
        body: {
          paymentId: createdPaymentId,
          action: "RETURN_FOR_CLARIFICATION",
          reason: "يرجى إرفاق إيصال PDF أوضح",
        },
      })
    );
    assert.equal(returnRes.status, 200);
    assert.equal((await returnRes.json()).payment.status, "RETURNED_FOR_CLARIFICATION");

    const resubmitRes = await clientPaymentsRoute.PATCH(
      makeReq("http://localhost/api/client-portal/payments", {
        method: "PATCH",
        tenantSlug: TEST_SLUG_A,
        clientToken: clientAlphaToken,
        body: {
          paymentId: createdPaymentId,
          clientNotes: "تم إرفاق نسخة PDF واضحة",
          receiptDataUrl: SAMPLE_PDF_DATA_URL,
          receiptFileName: "jawali-clear.pdf",
        },
      })
    );
    assert.equal(resubmitRes.status, 200);
    assert.equal((await resubmitRes.json()).payment.status, "PENDING_VERIFICATION");

    // 6. Reject a separate receipt -> leaves accounting balances completely untouched
    const rejectCandidateRes = await clientPaymentsRoute.POST(
      makeReq("http://localhost/api/client-portal/payments", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        clientToken: clientAlphaToken,
        body: {
          channelId: walletChannelId,
          amount: 5000,
          transferReference: "JWL-REJECT-999",
          receiptDataUrl: SAMPLE_PNG_DATA_URL,
        },
      })
    );
    const rejId = (await rejectCandidateRes.json()).payment.id;
    const rejectRes = await adminPaymentsRoute.POST(
      makeReq("http://localhost/api/portal-admin/payments", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
        body: {
          paymentId: rejId,
          action: "REJECT",
          reason: "رقم الحوالة غير وارد في كشف المحفظة",
        },
      })
    );
    assert.equal(rejectRes.status, 200);
    assert.equal((await rejectRes.json()).payment.status, "REJECTED");
    const vouchersBeforeApprove = await defaultPrisma.receiptVoucher.count();
    assert.equal(vouchersBeforeApprove, 0);

    // 7. Approve primary payment -> posts balanced ReceiptVoucher idempotently + updates invoice & balance + WhatsApp draft
    const approveRes = await adminPaymentsRoute.POST(
      makeReq("http://localhost/api/portal-admin/payments", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
        body: {
          paymentId: createdPaymentId,
          action: "APPROVE",
          staffNotes: "تمت المطابقة مع كشف جوالي",
        },
      })
    );
    assert.equal(approveRes.status, 200);
    const approveData = await approveRes.json();
    assert.equal(approveData.idempotentReplay, false);
    assert.equal(approveData.payment.status, "APPROVED");
    assert.ok(approveData.receiptVoucherId);
    assert.ok(approveData.payment.linkedJournalEntryId);

    // Balanced double-entry check
    const journalLines = await defaultPrisma.journalEntryLine.findMany({
      where: { journalEntryId: approveData.payment.linkedJournalEntryId },
    });
    const totalDebit = journalLines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = journalLines.reduce((s, l) => s + Number(l.credit), 0);
    assert.equal(totalDebit, 25000);
    assert.equal(totalCredit, 25000);
    assert.ok(journalLines.some((l) => l.accountId === treasuryGlAccountId && Number(l.debit) === 25000));

    // Invoice paidAmount/balanceDue & Client Statement updated
    const invAfter = await defaultPrisma.salesInvoice.findUniqueOrThrow({ where: { id: openInvoiceId } });
    assert.equal(Number(invAfter.paidAmount), 25000);
    assert.equal(Number(invAfter.balanceDue), 15000);
    assert.equal(invAfter.status, "PARTIALLY_PAID");

    // Global Membership balance synced
    const membershipAfter = await defaultPrisma.globalClientMembership.findFirst({
      where: { tenantSlug: TEST_SLUG_A, clientAccountId: clientAlphaId },
    });
    assert.equal(Number(membershipAfter?.balance), 15000);

    // WhatsApp Confirmation Draft queued with Username + Title signature
    const waDraft = await defaultPrisma.whatsAppOutboxMessage.findFirst({
      where: { clientAccountId: clientAlphaId, eventType: "PAYMENT_RECEIPT" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(waDraft);
    assert.equal(waDraft.status, "PENDING_APPROVAL");
    assert.ok(waDraft.finalMessageText.includes("khalid.cfo"));
    assert.ok(waDraft.finalMessageText.includes("الصفة:"));

    // Idempotent second approval replay -> NO duplicate voucher or GL lines
    const replayRes = await adminPaymentsRoute.POST(
      makeReq("http://localhost/api/portal-admin/payments", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
        body: {
          paymentId: createdPaymentId,
          action: "APPROVE",
        },
      })
    );
    assert.equal(replayRes.status, 200);
    const replayData = await replayRes.json();
    assert.equal(replayData.idempotentReplay, true);
    assert.equal(await defaultPrisma.receiptVoucher.count(), 1);
    const invReplay = await defaultPrisma.salesInvoice.findUniqueOrThrow({ where: { id: openInvoiceId } });
    assert.equal(Number(invReplay.paidAmount), 25000);

    // Admin paginated search for approved payment
    const adminListRes = await adminPaymentsRoute.GET(
      makeReq("http://localhost/api/portal-admin/payments?status=APPROVED&search=JWL-2026-001", {
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
      })
    );
    assert.equal(adminListRes.status, 200);
    const adminListData = await adminListRes.json();
    assert.equal(adminListData.payments.length, 1);
    assert.equal(adminListData.payments[0].receiptVoucherNumber, approveData.receiptVoucherNumber);
  });

  it("Phase 22.2 — enforces clean Sector Titles, Harvest/Commercial isolation, Commercial metadata without cost leakage, sector form config & dd / mm / yyyy + HH:mm movements", async () => {
    // 1. Verify clean sector titles across AppShell, Portal, CommercialWorkspace, CatalogBoard & AdminPanel
    const appShellSrc = fs.readFileSync(path.join(process.cwd(), "src/components/UasAppShell.tsx"), "utf8");
    const portalAppSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/client-portal/ClientPortalApp.tsx"),
      "utf8"
    );
    const commercialWsSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/CommercialSectorWorkspace.tsx"),
      "utf8"
    );
    assert.ok(appShellSrc.includes("القطاع الزراعي"));
    assert.ok(appShellSrc.includes("القطاع التجاري"));
    assert.equal(appShellSrc.includes("1. القطاع الحالي —"), false);
    assert.equal(appShellSrc.includes("2. القطاع التجاري —"), false);
    assert.ok(portalAppSrc.includes("القطاع الزراعي"));
    assert.ok(portalAppSrc.includes("القطاع التجاري"));
    assert.equal(portalAppSrc.includes("1. القطاع الحالي —"), false);
    assert.equal(portalAppSrc.includes("2. القطاع التجاري —"), false);
    assert.ok(commercialWsSrc.includes("العودة إلى القطاع الزراعي"));
    assert.equal(commercialWsSrc.includes("العودة إلى القطاع الحالي"), false);

    // 2. Verify Bulk Import & Harvest/Commercial isolation with full commercial fields
    const bulkRes = await inventoryItemsRoute.POST(
      makeReq("http://localhost/api/inventory/items", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
        body: {
          action: "BULK_IMPORT_ITEMS",
          sectorType: "COMMERCIAL",
          rows: [
            {
              sku: "COM-RICE-01",
              nameAr: "أرز بسمتي هندي 10 كجم",
              producerCompany: "شركة السندباد الغذائية",
              countryOfOrigin: "الهند",
              productionDate: "2026-01-15",
              expiryDate: "2027-06-30",
              unitLabel: "كيس 10 كجم",
              categoryLabel: "مواد غذائية",
              openingQty: 40,
              purchasePrice: 7200,
              dispatchCost: 350,
              taxRate: 5,
              wholesalePrice: 8900,
              retailPrice: 9300,
            },
          ],
        },
      })
    );
    assert.equal(bulkRes.status, 201);
    const bulkData = await bulkRes.json();
    assert.equal(bulkData.importedCount, 1);

    const harvestOnlyRes = await inventoryItemsRoute.POST(
      makeReq("http://localhost/api/inventory/items", {
        method: "POST",
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
        body: {
          sku: "HARV-LEAF-01",
          nameAr: "محصول صوطي طازج",
          sectorType: "HARVEST",
          openingQty: 25,
          purchasePrice: 1500,
          wholesalePrice: 2200,
        },
      })
    );
    assert.equal(harvestOnlyRes.status, 201);

    const comItemsRes = await inventoryItemsRoute.GET(
      makeReq("http://localhost/api/inventory/items?sectorType=COMMERCIAL", {
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
      })
    );
    assert.equal(comItemsRes.status, 200);
    const comItemsData = await comItemsRes.json();
    assert.ok(comItemsData.items.some((i: { sku: string }) => i.sku === "COM-RICE-01"));
    assert.equal(comItemsData.items.some((i: { sku: string }) => i.sku === "HARV-LEAF-01"), false);
    const rice = comItemsData.items.find((i: { sku: string }) => i.sku === "COM-RICE-01");
    assert.equal(rice.producerCompany, "شركة السندباد الغذائية");
    assert.equal(rice.countryOfOrigin, "الهند");
    assert.equal(rice.productionDate, "2026-01-15");
    assert.equal(rice.expiryDate, "2027-06-30");
    assert.equal(Number(rice.dispatchCost), 350);
    assert.equal(Number(rice.taxRate), 5);

    const harvItemsRes = await inventoryItemsRoute.GET(
      makeReq("http://localhost/api/inventory/items?sectorType=HARVEST", {
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
      })
    );
    const harvItemsData = await harvItemsRes.json();
    assert.ok(harvItemsData.items.some((i: { sku: string }) => i.sku === "HARV-LEAF-01"));
    assert.equal(harvItemsData.items.some((i: { sku: string }) => i.sku === "COM-RICE-01"), false);

    // 3. Inbound & Outbound movements isolation + dd / mm / yyyy — HH:mm timestamps
    const comMovRes = await inventoryMovementsRoute.GET(
      makeReq("http://localhost/api/inventory/movements?sectorType=COMMERCIAL", {
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
      })
    );
    assert.equal(comMovRes.status, 200);
    const comMovData = await comMovRes.json();
    assert.ok(comMovData.movements.length >= 1);
    assert.ok(
      comMovData.movements.every(
        (m: { item?: { sectorType?: string } }) => m.item?.sectorType === "COMMERCIAL"
      )
    );
    assert.match(comMovData.movements[0].createdAtDisplay, /^\d{2} \/ \d{2} \/ \d{4} — \d{2}:\d{2}$/);
    assert.equal(comMovData.movements[0].direction, "INBOUND");
    assert.equal(comMovData.movements[0].directionLabelAr, "وارد (+)");

    // Commercial Ops API exposes isolated commercial movements & stockBuckets
    const opsRes = await commercialOpsRoute.GET(
      makeReq("http://localhost/api/commercial/ops", {
        tenantSlug: TEST_SLUG_A,
        cookie: staffCookie,
      })
    );
    assert.equal(opsRes.status, 200);
    const opsData = await opsRes.json();
    assert.ok(Array.isArray(opsData.movements) && opsData.movements.length >= 1);
    assert.ok(opsData.stockBuckets.some((b: { sku: string }) => b.sku === "COM-RICE-01"));
    assert.equal(opsData.stockBuckets.some((b: { sku: string }) => b.sku === "HARV-LEAF-01"), false);

    // 4. Client Portal catalog board sanitization strips purchasePrice / dispatchCost
    await catalogBoardLib.upsertStaffCatalogBoardItem({
      inventoryItemId: rice.id,
      sku: rice.sku,
      titleAr: rice.nameAr,
      sectorType: "COMMERCIAL",
      categoryGroup: "FOOD",
      saleMode: "BOTH",
      unitCode: "OTHER",
      unitLabel: "كيس 10 كجم",
      customUnitLabel: "كيس 10 كجم",
      unitPrice: 8900,
      partialUnitLabel: "كيلو",
      partialUnitPrice: 950,
      producerCompany: rice.producerCompany,
      countryOfOrigin: rice.countryOfOrigin,
      productionDate: rice.productionDate,
      expiryDate: rice.expiryDate,
      taxRate: Number(rice.taxRate),
      isPublished: true,
      tenantSlug: TEST_SLUG_A,
      actor: {
        userId: "staff-test-1",
        userDisplay: "khalid.cfo",
        userRole: "ADMIN",
      },
    });
    const clientCatalog = await catalogBoardLib.listPublishedClientCatalogBoard(defaultPrisma);
    const pubRice = clientCatalog.items.find((x) => x.sku === "COM-RICE-01");
    assert.ok(pubRice);
    assert.equal(pubRice.producerCompany, "شركة السندباد الغذائية");
    assert.equal(pubRice.countryOfOrigin, "الهند");
    assert.equal(pubRice.expiryDate, "2027-06-30");
    assert.equal(pubRice.taxRate, 5);
    assert.equal("purchasePrice" in (pubRice as unknown as Record<string, unknown>), false);
    assert.equal("dispatchCost" in (pubRice as unknown as Record<string, unknown>), false);

    // 5. Sector request form config preserves separate HARVEST and COMMERCIAL configurations
    const normCfg = portalConfigLib.normalizeTenantFormConfig({
      sectorForms: {
        HARVEST: {
          headingAr: "نموذج القطاع الزراعي المخصص",
          subtitleAr: "تفاصيل الفرز",
          allowCustomPickup: true,
          customFields: [{ key: "farm_note", labelAr: "ملاحظة المزرعة", type: "text", required: false }],
        },
        COMMERCIAL: {
          headingAr: "نموذج القطاع التجاري المخصص",
          subtitleAr: "طلبات الجملة والتجزئة",
          allowCustomPickup: true,
          customFields: [{ key: "tax_no", labelAr: "الرقم الضريبي", type: "text", required: true }],
        },
      },
    });
    assert.equal(normCfg.sectorForms?.HARVEST.headingAr, "نموذج القطاع الزراعي المخصص");
    assert.equal(normCfg.sectorForms?.COMMERCIAL.headingAr, "نموذج القطاع التجاري المخصص");
    assert.equal(normCfg.sectorForms?.COMMERCIAL.customFields[0]?.labelAr, "الرقم الضريبي");
  });
});

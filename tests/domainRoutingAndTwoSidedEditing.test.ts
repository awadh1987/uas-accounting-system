import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  ensureTenantRegistered,
  extractTenantResolutionFromRequest,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
  unregisterTenant,
} from "../src/lib/tenant";
import { proxy as uasProxy } from "../src/proxy";
import { buildCorsHeaders, isAllowedCorsOrigin } from "../src/lib/cors";
import { ensure6GenerationCoaHierarchy } from "../src/lib/accountingCoreEngine";
import { createTreasuryAccount } from "../src/lib/accounting/ledgerService";
import { issueSessionToken, SESSION_COOKIE_NAME } from "../src/lib/authSession";
import { hashPassword } from "../src/lib/serverBootstrap";
import {
  canonicalizeLicensePayload,
  type UasLicensePayload,
} from "../src/lib/licensing/licenseSchema";
import {
  resolveTenantLicensePath,
  saveInstalledLicense,
} from "../src/lib/licensing/verifier";
import { ensurePortalSchemaReady } from "../src/lib/clientPortal/ensurePortalSchema";
import { CLIENT_PORTAL_TOKEN_HEADER } from "../src/lib/clientPortal/clientAuth";
import { POST as portalRegisterPOST } from "../src/app/api/client-portal/register/route";
import { GET as portalConfigGET } from "../src/app/api/client-portal/config/route";
import { GET as portalCatalogGET } from "../src/app/api/client-portal/catalog/route";
import {
  GET as portalRequestsGET,
  POST as portalRequestsPOST,
} from "../src/app/api/client-portal/requests/route";
import { PATCH as portalRequestByIdPATCH } from "../src/app/api/client-portal/requests/[id]/route";
import { GET as portalStatementGET } from "../src/app/api/client-portal/statement/route";
import { POST as adminClientsPOST } from "../src/app/api/portal-admin/clients/route";
import { POST as adminCatalogPOST } from "../src/app/api/portal-admin/catalog/route";
import { POST as adminRequestsPOST } from "../src/app/api/portal-admin/requests/route";

const TEST_TAG = `${Math.floor(10000 + Math.random() * 90000)}`;
const TENANT_HYPHEN = `yasser-test-${TEST_TAG}`;
const TENANT_OTHER = `other-test-${TEST_TAG}`;
const REPO_ROOT = path.resolve(__dirname, "..");

function seedTenantLicense(slug: string) {
  const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
  if (!fs.existsSync(privPath)) return;
  const priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));
  const payload: UasLicensePayload = {
    license_id: `UAS-DR-${slug}`,
    customer_name: `Co ${slug}`,
    company_name: `Co ${slug}`,
    tenant_slug: slug,
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
  saveInstalledLicense({ ...payload, signature: sig }, slug);
}

function makeSubdomainReq(
  tenantSlug: string,
  urlPath: string,
  method: string,
  opts?: { clientToken?: string; staffToken?: string; body?: unknown; extraHeaders?: Record<string, string> }
): NextRequest {
  const headers: Record<string, string> = {
    host: `${tenantSlug}.qat.world`,
    "x-forwarded-host": `${tenantSlug}.qat.world`,
    "x-forwarded-proto": "https",
    ...(opts?.extraHeaders || {}),
  };
  if (opts?.clientToken) headers[CLIENT_PORTAL_TOKEN_HEADER] = opts.clientToken;
  if (opts?.staffToken) headers["cookie"] = `${SESSION_COOKIE_NAME}=${opts.staffToken}`;
  let bodyStr: string | undefined;
  if (opts?.body !== undefined) {
    headers["content-type"] = "application/json";
    bodyStr = JSON.stringify(opts.body);
  }
  return new NextRequest(`https://${tenantSlug}.qat.world${urlPath}`, {
    method,
    headers,
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });
}

describe("Domain Routing Audit, Two-Sided Order Editing & Tenant Landing Portal Polish", () => {
  let staffAdminToken = "";
  let clientAccountId = "";
  let clientToken = "";
  let clientTokenOtherTenant = "";
  let projectId = "";
  let treasuryId = "";
  let boardItemId = "";

  before(async () => {
    const tmpBase = path.join(process.cwd(), "data", `test_dr_base_${TEST_TAG}.db`);
    process.env.DATABASE_URL = `file:${tmpBase}`;

    for (const slug of [TENANT_HYPHEN, TENANT_OTHER]) {
      const dbFile = resolveTenantDbFilePath(slug);
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
      ensureTenantRegistered(slug, `Workspace ${slug}`, { slug });
      seedTenantLicense(slug);

      await runWithTenant(slug, async () => {
        await ensurePortalSchemaReady();
        await prisma.enterpriseProfile.updateMany({
          data: {
            tenantSlug: slug,
            legalNameAr: `مؤسسة ${slug}`,
            legalNameEn: `Co ${slug}`,
            isConfigured: true,
          },
        });
        await ensure6GenerationCoaHierarchy(prisma);
        const admin = await prisma.user.create({
          data: {
            id: `adm-${slug}`,
            username: `staff_${slug}`,
            name: `مدير ${slug}`,
            fullName: `مدير ${slug}`,
            role: "SUPER_ADMIN",
            email: `staff_${slug}@${slug}.qat.world`,
            passwordHash: hashPassword("StaffPass#123"),
            active: true,
          },
        });
        const prj = await prisma.project.create({
          data: {
            id: `prj-${slug}`,
            code: `PRJ-${slug}`,
            name: "مشروع رئيسي",
            nameAr: "مشروع رئيسي",
            nameEn: "Main Project",
            estimatedValue: 2000000,
            plannedHarvestCount: 2,
          },
        });
        const trs = await createTreasuryAccount({
          nameAr: "الصندوق الرئيسي",
          currency: "YER",
          type: "VAULT",
        });

        if (slug === TENANT_HYPHEN) {
          projectId = prj.id;
          treasuryId = trs.treasury.id;
          staffAdminToken = issueSessionToken({
            userId: admin.id,
            userRole: admin.role,
            tenantId: TENANT_HYPHEN,
            userDisplay: admin.fullName,
          });
        }
      });
    }

    const regRes = await portalRegisterPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/client-portal/register", "POST", {
        body: {
          fullName: "صادق الجبري",
          phone: "777888999",
          email: "sadiq@example.test",
          password: "ClientPass#123",
        },
      })
    );
    const regJson = await regRes.json();
    assert.ok(regRes.status === 200 || regRes.status === 201, `regRes failed (${regRes.status}): ${JSON.stringify(regJson)}`);
    clientAccountId = regJson.account.id;
    clientToken = regJson.token;

    const appRes = await adminClientsPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/portal-admin/clients", "POST", {
        staffToken: staffAdminToken,
        body: { clientAccountId, action: "APPROVE", creditLimit: 600000 },
      })
    );
    const appJson = await appRes.json();
    assert.equal(appRes.status, 200, `approve failed (${appRes.status}): ${JSON.stringify(appJson)}`);

    const regOther = await portalRegisterPOST(
      makeSubdomainReq(TENANT_OTHER, "/api/client-portal/register", "POST", {
        body: {
          fullName: "عميل منشأة أخرى",
          phone: "777000111",
          email: "other@example.test",
          password: "OtherPass#123",
        },
      })
    );
    const regOtherJson = await regOther.json();
    assert.ok(regOther.status === 200 || regOther.status === 201, `regOther failed: ${JSON.stringify(regOtherJson)}`);
    clientTokenOtherTenant = regOtherJson.token;

    const pubItem = await adminCatalogPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/portal-admin/catalog", "POST", {
        staffToken: staffAdminToken,
        body: {
          titleAr: "قات صوطي قطفة أولى",
          gradeLabel: "نخب ممتاز",
          unitCode: "QAT_BUNCH",
          unitLabel: "علاقية قات",
          unitPrice: 5500,
          availabilityStatus: "AVAILABLE",
          freshnessLabel: "قائمة أسعار اليوم",
          effectiveDate: "2026-11-25",
          isPublished: true,
        },
      })
    );
    const pubJson = await pubItem.json();
    assert.equal(pubItem.status, 200, `pubItem failed (${pubItem.status}): ${JSON.stringify(pubJson)}`);
    boardItemId = pubJson.item.id;
  });

  after(async () => {
    await prisma.$disconnect().catch(() => null);
    await resetTenantClientsForTests();
    for (const slug of [TENANT_HYPHEN, TENANT_OTHER]) {
      const dbFile = resolveTenantDbFilePath(slug);
      unregisterTenant(slug);
      for (const suffix of ["", "-shm", "-wal", "-journal"]) {
        if (fs.existsSync(dbFile + suffix)) fs.unlinkSync(dbFile + suffix);
      }
      const licPath = resolveTenantLicensePath(slug);
      const licDir = path.dirname(licPath);
      if (fs.existsSync(licDir) && path.basename(licDir) === slug) {
        fs.rmSync(licDir, { recursive: true, force: true });
      }
    }
    const baseDb = path.join(process.cwd(), "data", `test_dr_base_${TEST_TAG}.db`);
    for (const suffix of ["", "-shm", "-wal", "-journal"]) {
      if (fs.existsSync(baseDb + suffix)) fs.unlinkSync(baseDb + suffix);
    }
  });

  it("enforces subdomain/proxy tenant binding, CORS credentials policy, and cross-tenant isolation", async () => {
    // 1. Proxy overwrites spoofed x-uas-resolved-tenant with authoritative Host subdomain and applies CORS only on /api/*
    const spoofedApiReq = new NextRequest(`https://${TENANT_HYPHEN}.qat.world/api/client-portal/config`, {
      headers: {
        host: `${TENANT_HYPHEN}.qat.world`,
        origin: `https://${TENANT_HYPHEN}.qat.world`,
        "x-uas-resolved-tenant": TENANT_OTHER,
      },
    });
    const proxyRes = uasProxy(spoofedApiReq);
    assert.equal(proxyRes.headers.get("x-uas-tenant-slug"), TENANT_HYPHEN);
    assert.equal(proxyRes.headers.get("access-control-allow-origin"), `https://${TENANT_HYPHEN}.qat.world`);
    assert.equal(proxyRes.headers.get("access-control-allow-credentials"), "true");

    // Page route (/portal) sets x-uas-tenant-slug without leaking API CORS headers
    const portalPageProxyRes = uasProxy(
      new NextRequest(`https://${TENANT_HYPHEN}.qat.world/portal`, {
        headers: { host: `${TENANT_HYPHEN}.qat.world`, origin: "https://evil.example" },
      })
    );
    assert.equal(portalPageProxyRes.headers.get("x-uas-tenant-slug"), TENANT_HYPHEN);
    assert.equal(portalPageProxyRes.headers.get("access-control-allow-origin"), null);

    // CORS blocks untrusted third-party origins from wildcard/credential reflection
    assert.equal(isAllowedCorsOrigin(`https://${TENANT_HYPHEN}.qat.world`), true);
    assert.equal(isAllowedCorsOrigin("https://evil-site.example"), false);
    const untrustedCors = buildCorsHeaders("https://evil-site.example");
    assert.notEqual(untrustedCors["Access-Control-Allow-Origin"], "https://evil-site.example");
    assert.equal(untrustedCors["Access-Control-Allow-Credentials"], undefined);

    // 2. Noisy x-uas-tenant-id="default" does not shadow explicit ?slug= on root apex domain
    const queryWithDefaultHeader = new NextRequest(`https://qat.world/api/client-portal/config?slug=${TENANT_HYPHEN}`, {
      headers: {
        host: "qat.world",
        "x-uas-tenant-id": "default",
      },
    });
    const resolved = extractTenantResolutionFromRequest(queryWithDefaultHeader);
    assert.equal(resolved.source, "query");
    assert.equal(resolved.slug, TENANT_HYPHEN);

    // 3. Hyphenated subdomain resolves its own config + published catalog without leaking other tenant data
    const cfgRes = await portalConfigGET(
      makeSubdomainReq(TENANT_HYPHEN, "/api/client-portal/config", "GET")
    );
    assert.equal(cfgRes.status, 200);
    const cfgJson = await cfgRes.json();
    assert.equal(cfgJson.tenantSlug, TENANT_HYPHEN);
    assert.equal(cfgJson.boardItems.length, 1);

    const otherCatRes = await portalCatalogGET(
      makeSubdomainReq(TENANT_OTHER, "/api/client-portal/catalog", "GET")
    );
    assert.equal(otherCatRes.status, 200);
    const otherCatJson = await otherCatRes.json();
    assert.equal(otherCatJson.tenantSlug, TENANT_OTHER);
    assert.equal(otherCatJson.items.length, 0);

    // 4. Cross-tenant client token rejected with 403
    const crossTokenAttempt = await portalRequestsGET(
      makeSubdomainReq(TENANT_HYPHEN, "/api/client-portal/requests", "GET", {
        clientToken: clientTokenOtherTenant,
      })
    );
    assert.equal(crossTokenAttempt.status, 403);
  });

  it("supports two-sided order editing (client edits require staff approval; staff edits sync linked sales & post-handover ledger atomically without duplicates)", async () => {
    // 1. Client submits initial request (4 * 5,500 = 22,000)
    const createRes = await portalRequestsPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/client-portal/requests", "POST", {
        clientToken,
        body: {
          pickupType: "MARKET",
          pickupLocation: "السوق",
          lines: [
            {
              itemId: boardItemId,
              itemTitle: "قات صوطي قطفة أولى",
              requestedQty: 4,
              unitCode: "QAT_BUNCH",
              unitLabel: "علاقية قات",
            },
          ],
        },
      })
    );
    assert.equal(createRes.status, 201);
    const createdReq = (await createRes.json()).request;
    const reqId = createdReq.id;
    const lineId = createdReq.lines[0].id;
    assert.equal(createdReq.totalEstimated, 22000);

    // 2. Client edits quantity, price, unit (OTHER), and pickup location on open request -> requires staff approval
    const clientEditRes = await portalRequestByIdPATCH(
      makeSubdomainReq(TENANT_HYPHEN, `/api/client-portal/requests/${reqId}`, "PATCH", {
        clientToken,
        body: {
          action: "EDIT",
          pickupType: "WAREHOUSE",
          pickupLocation: "مخزن رقم 1",
          pickupNotes: "استلام الساعة 3 عصراً",
          lines: [
            {
              id: lineId,
              itemId: boardItemId,
              itemTitle: "قات صوطي قطفة أولى",
              requestedQty: 6,
              unitCode: "OTHER",
              unitLabel: "أخرى",
              customUnitLabel: "ربطة خاصة",
              unitPrice: 5200,
            },
          ],
        },
      }),
      { params: Promise.resolve({ id: reqId }) }
    );
    assert.equal(clientEditRes.status, 200);
    const clientEditedReq = (await clientEditRes.json()).request;
    assert.equal(clientEditedReq.status, "PENDING_REVIEW");
    assert.equal(clientEditedReq.clientResponseStatus, "PENDING_STAFF_APPROVAL");
    assert.equal(clientEditedReq.clientResponseStatusLabelAr, "بانتظار اعتماد الموظف");
    assert.equal(clientEditedReq.linkedSalesRecordId, null, "Client edit must NOT initiate linked sales record without staff approval");
    assert.equal(clientEditedReq.totalEstimated, 31200); // 6 * 5200
    assert.equal(clientEditedReq.lines[0].displayUnitLabel, "ربطة خاصة");
    assert.ok(clientEditedReq.amendmentDiff.length >= 2);

    // Check editable WhatsApp draft queued (with subdomain /portal URL) & audit entry recorded
    await runWithTenant(TENANT_HYPHEN, async () => {
      const editDraft = await prisma.whatsAppOutboxMessage.findFirst({
        where: { requestId: reqId, eventType: "CLIENT_ORDER_EDITED" },
      });
      assert.ok(editDraft, "Client edit must queue editable CLIENT_ORDER_EDITED WhatsApp draft");
      assert.equal(editDraft.status, "PENDING_APPROVAL");
      assert.ok(editDraft.finalMessageText.includes("بانتظار اعتماد الموظف"));
    });

    // 3. Staff returns to client -> Client edits RETURNED_TO_CLIENT request -> moves back to PENDING_REVIEW (PENDING_STAFF_APPROVAL)
    const retRes = await adminRequestsPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "RETURN_TO_CLIENT",
          reviewerRemarks: "يرجى تأكيد الكمية أو السعر المحدّث",
          lines: [{ id: lineId, confirmedQty: 6, unitPrice: 5300 }],
        },
      })
    );
    assert.equal(retRes.status, 200);
    const retJson = await retRes.json();
    assert.equal(retJson.request.status, "RETURNED_TO_CLIENT");

    // Verify WhatsApp draft uses tenant subdomain URL (never localhost/127.0.0.1)
    await runWithTenant(TENANT_HYPHEN, async () => {
      const retDraft = await prisma.whatsAppOutboxMessage.findFirst({
        where: { requestId: reqId, eventType: "REQUEST_RETURNED_FOR_APPROVAL" },
      });
      assert.ok(retDraft);
      assert.ok(retDraft.finalMessageText.includes(`https://${TENANT_HYPHEN}.qat.world/portal`));
      assert.ok(!retDraft.finalMessageText.includes("127.0.0.1"));
    });

    const editReturnedRes = await portalRequestByIdPATCH(
      makeSubdomainReq(TENANT_HYPHEN, `/api/client-portal/requests/${reqId}`, "PATCH", {
        clientToken,
        body: {
          action: "EDIT",
          pickupType: "WAREHOUSE",
          pickupLocation: "مخزن رقم 1",
          lines: [
            {
              id: lineId,
              itemTitle: "قات صوطي قطفة أولى",
              requestedQty: 6,
              unitCode: "OTHER",
              unitLabel: "أخرى",
              customUnitLabel: "ربطة خاصة",
              unitPrice: 5250,
            },
          ],
        },
      }),
      { params: Promise.resolve({ id: reqId }) }
    );
    assert.equal(editReturnedRes.status, 200);
    const backPendingReq = (await editReturnedRes.json()).request;
    assert.equal(backPendingReq.status, "PENDING_REVIEW");
    assert.equal(backPendingReq.clientResponseStatus, "PENDING_STAFF_APPROVAL");
    assert.equal(backPendingReq.linkedSalesRecordId, null);

    // 4. Staff approves -> creates ONE linked WorkspaceDraft; staff edits CONFIRMED qty/price/payment -> updates EXISTING draft without duplicating
    const confirm1Res = await adminRequestsPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "CONFIRM",
          projectId,
          treasuryId,
          immediatePaidAmount: 10000,
        },
      })
    );
    assert.equal(confirm1Res.status, 200);
    const confirmed1 = (await confirm1Res.json()).request;
    assert.equal(confirmed1.status, "CONFIRMED");
    assert.equal(confirmed1.clientResponseStatus, "STAFF_APPROVED");
    assert.ok(confirmed1.linkedSalesRecordId);

    const confirmUpdateRes = await adminRequestsPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "CONFIRM",
          projectId,
          treasuryId,
          immediatePaidAmount: 10000,
          lines: [{ id: lineId, confirmedQty: 6, unitPrice: 5200 }],
        },
      })
    );
    assert.equal(confirmUpdateRes.status, 200);
    const confirmUpdateJson = await confirmUpdateRes.json();
    assert.equal(confirmUpdateJson.idempotentReplay, false);
    assert.equal(confirmUpdateJson.request.totalConfirmed, 31200);
    assert.equal(confirmUpdateJson.request.linkedSalesRecordId, confirmed1.linkedSalesRecordId);

    await runWithTenant(TENANT_HYPHEN, async () => {
      const drafts = await prisma.workspaceDraft.findMany({
        where: { module: "SALES", entityId: reqId },
      });
      assert.equal(drafts.length, 1, "Updating confirmed request must keep exactly ONE WorkspaceDraft");
      assert.equal(Number(drafts[0].totalAmount), 31200);
    });

    // 5. Complete handover -> then amend post-handover (COMPLETED): 5 * 5,400 = 27,000, paid 15,000 (credit 12,000)
    const handoverRes = await adminRequestsPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "HANDOVER",
          projectId,
          treasuryId,
          immediatePaidAmount: 10000,
        },
      })
    );
    assert.equal(handoverRes.status, 200);
    const handedReq = (await handoverRes.json()).request;
    const origSaleId = handedReq.linkedSaleId;
    const origInvoiceId = handedReq.linkedInvoiceId;
    const origReceiptId = handedReq.linkedReceiptId;
    assert.ok(origSaleId && origInvoiceId && origReceiptId);

    const postAmendRes = await adminRequestsPOST(
      makeSubdomainReq(TENANT_HYPHEN, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "AMEND",
          projectId,
          treasuryId,
          immediatePaidAmount: 15000,
          pickupLocation: "فرع المبيعات الرئيسي",
          lines: [{ id: lineId, confirmedQty: 5, unitPrice: 5400 }],
        },
      })
    );
    assert.equal(postAmendRes.status, 200);
    const postAmended = (await postAmendRes.json()).request;
    assert.equal(postAmended.status, "COMPLETED");
    assert.equal(postAmended.totalConfirmed, 27000);
    assert.equal(postAmended.creditPaidPlanned, 15000);
    assert.equal(postAmended.debitPlanned, 12000);
    assert.equal(postAmended.linkedSaleId, origSaleId, "Must update original SaleTransaction without duplicating");
    assert.equal(postAmended.linkedInvoiceId, origInvoiceId, "Must update original SalesInvoice without duplicating");
    assert.equal(postAmended.linkedReceiptId, origReceiptId, "Must update original ReceiptVoucher without duplicating");

    // Verify ledger integrity (Σ Debit == Σ Credit), treasury balance == 15,000, zero duplicate Sales/Invoices/Receipts
    await runWithTenant(TENANT_HYPHEN, async () => {
      const salesCount = await prisma.saleTransaction.count({ where: { id: origSaleId } });
      const totalSales = await prisma.saleTransaction.count();
      const totalInvoices = await prisma.salesInvoice.count({ where: { customerId: postAmended.customerId } });
      const activeReceipts = await prisma.receiptVoucher.count({
        where: { customerId: postAmended.customerId, documentStatus: { not: "VOIDED" } },
      });
      assert.equal(salesCount, 1);
      assert.equal(totalSales, 1);
      assert.equal(totalInvoices, 1);
      assert.equal(activeReceipts, 1);

      const tr = await prisma.treasuryAccount.findUniqueOrThrow({ where: { id: treasuryId } });
      assert.equal(Number(tr.balance), 15000, "Treasury balance must net cleanly to amended paid amount (15,000)");

      const jeLines = await prisma.journalEntryLine.findMany({
        where: { journalEntry: { status: "POSTED" } },
      });
      const sumDr = jeLines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const sumCr = jeLines.reduce((s, l) => s + Number(l.credit || 0), 0);
      assert.ok(Math.abs(sumDr - sumCr) < 0.01, `General Ledger must stay balanced (DR=${sumDr}, CR=${sumCr})`);

      const reversedCount = await prisma.journalEntry.count({ where: { isReversed: true } });
      assert.ok(reversedCount >= 2, "Prior invoice and receipt JEs must be immutably reversed on amendment");
    });

    // Client portal statement shows amended 27,000 total, 15,000 paid, 12,000 unpaid
    const stmtJson = await (
      await portalStatementGET(
        makeSubdomainReq(TENANT_HYPHEN, "/api/client-portal/statement", "GET", { clientToken })
      )
    ).json();
    assert.equal(stmtJson.summary.totalInvoiced, 27000);
    assert.equal(stmtJson.summary.totalPaid, 15000);
    assert.equal(stmtJson.summary.totalUnpaid, 12000);
    assert.equal(stmtJson.bills[0].billStatusAr, "جزئية");
  });

  it("verifies single دخول workspace login button, zero exposed role labels, elevated Client Portal card with full directory, and UI wiring", () => {
    const landingSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/LandingPage.tsx"), "utf8");
    const loginSrc = fs.readFileSync(path.join(REPO_ROOT, "src/components/LoginView.tsx"), "utf8");
    const portalSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/client-portal/ClientPortalApp.tsx"),
      "utf8"
    );
    const adminSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/portal-admin/TenantClientPortalAdminPanel.tsx"),
      "utf8"
    );

    // 1. Client Portal card present while deprecated feature pillars / active projects showcase are removed
    const cardIdx = landingSrc.indexOf('data-testid="tenant-client-portal-card"');
    assert.ok(cardIdx > 0);
    assert.ok(!landingSrc.includes("ركائز النظام المحاسبي الموحد"));

    // 2. Full action directory & single clean "دخول" login button without exposed role labels
    for (const label of [
      "دخول بوابة العملاء",
      "تسجيل عميل جديد",
      "الأسعار والفرز",
      "تسجيل طلب",
      "متابعة الطلبات",
      "الفواتير وكشف الحساب",
    ]) {
      assert.ok(landingSrc.includes(label), `Missing Client Portal directory item: ${label}`);
    }
    assert.ok(!landingSrc.includes('data-testid="tenant-staff-login-cta"'));
    assert.ok(landingSrc.includes('data-testid="root-login-cta"'));
    assert.ok(!/<span>\s*تسجيل الدخول\s*<\/span>/.test(landingSrc));
    assert.ok(!landingSrc.includes("دخول مساحة العمل"));
    assert.ok(!landingSrc.includes("مدير النظام العام"));
    assert.ok(!landingSrc.includes("مديري النظام"));
    assert.ok(!landingSrc.includes("SUPER_ADMIN"));
    assert.ok(!loginSrc.includes("مدير النظام العام"));
    assert.ok(!loginSrc.includes("SUPER_ADMIN Password Recovery"));

    // 3. Client Portal & Admin two-sided editing / deep-linking affordances present
    assert.ok(portalSrc.includes("portal-guest-tab-catalog"));
    assert.ok(portalSrc.includes("portal-pending-staff-badge-"));
    assert.ok(portalSrc.includes("portal-edit-req-"));
    assert.ok(portalSrc.includes("بانتظار اعتماد الموظف"));
    assert.ok(adminSrc.includes("staff-awaiting-approval-"));
    assert.ok(adminSrc.includes("staff-toggle-post-amend-"));
    assert.ok(adminSrc.includes("staff-save-post-amend-"));
  });
});

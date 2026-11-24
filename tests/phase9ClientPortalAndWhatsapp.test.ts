import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  ensureTenantRegistered,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
  unregisterTenant,
} from "../src/lib/tenant";
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
import {
  CLIENT_PORTAL_TOKEN_HEADER,
  normalizeClientEmail,
  normalizeClientPhone,
} from "../src/lib/clientPortal/clientAuth";
import { GET as portalConfigGET } from "../src/app/api/client-portal/config/route";
import { POST as portalRegisterPOST } from "../src/app/api/client-portal/register/route";
import { POST as portalLoginPOST } from "../src/app/api/client-portal/login/route";
import { GET as portalMeGET } from "../src/app/api/client-portal/me/route";
import {
  GET as portalRequestsGET,
  POST as portalRequestsPOST,
} from "../src/app/api/client-portal/requests/route";
import { GET as portalStatementGET } from "../src/app/api/client-portal/statement/route";
import {
  GET as adminClientsGET,
  POST as adminClientsPOST,
} from "../src/app/api/portal-admin/clients/route";
import {
  GET as adminRequestsGET,
  POST as adminRequestsPOST,
} from "../src/app/api/portal-admin/requests/route";
import {
  GET as adminFormConfigGET,
  PUT as adminFormConfigPUT,
} from "../src/app/api/portal-admin/form-config/route";
import {
  GET as waOutboxGET,
  POST as waOutboxPOST,
} from "../src/app/api/whatsapp-outbox/route";

const TEST_TAG = `${Math.floor(10000 + Math.random() * 90000)}`;
const TENANT_A = `p9a-${TEST_TAG}`;
const TENANT_B = `p9b-${TEST_TAG}`;

function seedTenantLicense(slug: string) {
  const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
  if (!fs.existsSync(privPath)) return;
  const priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));
  const payload: UasLicensePayload = {
    license_id: `UAS-P9-${slug}`,
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

function makePortalReq(
  tenantSlug: string,
  urlPath: string,
  method: string,
  opts?: { clientToken?: string; staffToken?: string; body?: unknown }
): NextRequest {
  const headers: Record<string, string> = {
    "x-uas-tenant-id": tenantSlug,
  };
  if (opts?.clientToken) {
    headers[CLIENT_PORTAL_TOKEN_HEADER] = opts.clientToken;
  }
  if (opts?.staffToken) {
    headers["cookie"] = `${SESSION_COOKIE_NAME}=${opts.staffToken}`;
  }
  let bodyStr: string | undefined;
  if (opts?.body !== undefined) {
    headers["content-type"] = "application/json";
    bodyStr = JSON.stringify(opts.body);
  }
  return new NextRequest(`http://${tenantSlug}.qat.world${urlPath}`, {
    method,
    headers,
    ...(bodyStr !== undefined ? { body: bodyStr } : {}),
  });
}

describe("Phase 9 — External Client Portal, Requests, Accounting Handover & WhatsApp Outbox", () => {
  let staffTokenA = "";
  let projectIdA = "";
  let treasuryIdA = "";
  let client1Token = "";
  let client1Id = "";
  let client2Token = "";
  let request1Id = "";

  before(async () => {
    const tmpBase = path.join(process.cwd(), "data", `test_p9_base_${TEST_TAG}.db`);
    process.env.DATABASE_URL = `file:${tmpBase}`;

    for (const slug of [TENANT_A, TENANT_B]) {
      const dbFile = resolveTenantDbFilePath(slug);
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
      ensureTenantRegistered(slug, `Workspace ${slug}`, { slug });
      seedTenantLicense(slug);

      await runWithTenant(slug, async () => {
        await ensurePortalSchemaReady();
        await prisma.enterpriseProfile.updateMany({
          data: { legalNameAr: `شركة ${slug}`, legalNameEn: `Co ${slug}`, isConfigured: true },
        });
        await ensure6GenerationCoaHierarchy(prisma);
        const adminUser = await prisma.user.create({
          data: {
            id: `adm-${slug}`,
            username: `staff_${slug}`,
            name: `مدير ${slug}`,
            fullName: `مدير ${slug}`,
            role: "SUPER_ADMIN",
            email: `staff_${slug}@qat.world`,
            passwordHash: hashPassword("Admin@123"),
            active: true,
          },
        });
        const prj = await prisma.project.create({
          data: {
            id: `prj-${slug}`,
            code: `PRJ-${slug}`,
            name: "مزرعة الوادي الرئيسية",
            nameAr: "مزرعة الوادي الرئيسية",
            nameEn: "Main Valley Farm",
            estimatedValue: 5000000,
            plannedHarvestCount: 3,
          },
        });
        const trs = await createTreasuryAccount({
          nameAr: "الصندوق الرئيسي",
          currency: "YER",
          type: "VAULT",
          openingBalance: 100000,
          createdById: adminUser.id,
        });
        if (slug === TENANT_A) {
          projectIdA = prj.id;
          treasuryIdA = trs.id;
          staffTokenA = issueSessionToken({
            userId: adminUser.id,
            userRole: "SUPER_ADMIN",
            tenantId: slug,
            userDisplay: adminUser.name,
          });
        }
      });
    }
  });

  after(async () => {
    await prisma.$disconnect();
    resetTenantClientsForTests();
    for (const slug of [TENANT_A, TENANT_B]) {
      unregisterTenant(slug);
      const dbFile = resolveTenantDbFilePath(slug);
      for (const suffix of ["", "-shm", "-wal", "-journal"]) {
        if (fs.existsSync(dbFile + suffix)) fs.unlinkSync(dbFile + suffix);
      }
      const licPath = resolveTenantLicensePath(slug);
      const licDir = path.dirname(licPath);
      if (fs.existsSync(licDir) && path.basename(licDir) === slug) {
        fs.rmSync(licDir, { recursive: true, force: true });
      } else if (fs.existsSync(licPath)) {
        fs.unlinkSync(licPath);
      }
    }
    const baseDb = path.join(process.cwd(), "data", `test_p9_base_${TEST_TAG}.db`);
    for (const suffix of ["", "-shm", "-wal", "-journal"]) {
      if (fs.existsSync(baseDb + suffix)) fs.unlinkSync(baseDb + suffix);
    }
  });

  it("validates Yemeni/E.164 phone numbers and RFC emails cleanly", () => {
    assert.deepEqual(normalizeClientPhone("0777123456"), {
      valid: true,
      normalized: "777123456",
      e164: "+967777123456",
    });
    assert.equal(normalizeClientPhone("+967 781-234-567").normalized, "781234567");
    assert.equal(normalizeClientPhone("+447911123456").valid, true);
    assert.equal(normalizeClientPhone("791234567").valid, false);
    assert.equal(normalizeClientPhone("12345").valid, false);

    assert.equal(normalizeClientEmail("  Ahmed.Ali@Example.COM ").normalized, "ahmed.ali@example.com");
    assert.equal(normalizeClientEmail("bad..email@example.com").valid, false);
  });

  it("serves tenant-scoped portal form config with علاقيات قات + أخرى units and zero internal cost/secret leakage", async () => {
    const res = await portalConfigGET(makePortalReq(TENANT_A, "/api/client-portal/config", "GET"));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.tenantSlug, TENANT_A);
    assert.equal(data.formConfig.requestHeadingAr, "تسجيل طلب");
    assert.ok(
      data.formConfig.unitOptions.some((u: { code: string; labelAr: string }) => u.labelAr === "علاقية قات"),
      "علاقية قات unit must be present by default"
    );
    assert.ok(
      data.formConfig.unitOptions.some((u: { code: string; labelAr: string }) => u.code === "OTHER" && u.labelAr === "أخرى"),
      "أخرى unit must be present"
    );
    const rawJson = JSON.stringify(data);
    assert.ok(!rawJson.includes("credentialsEnc"));
    assert.ok(!rawJson.includes("purchasePrice"));
  });

  it("supports client registration (PENDING_APPROVAL -> staff APPROVE + Customer COA), blocks unapproved requests, and rejects duplicate phone/email", async () => {
    const badRes = await portalRegisterPOST(
      makePortalReq(TENANT_A, "/api/client-portal/register", "POST", {
        body: {
          fullName: "خالد الصالحي",
          phone: "791234567",
          email: "khaled@example.com",
          password: "pass1234",
        },
      })
    );
    assert.equal(badRes.status, 400);

    const reg1 = await portalRegisterPOST(
      makePortalReq(TENANT_A, "/api/client-portal/register", "POST", {
        body: {
          fullName: "خالد الصالحي",
          tradeName: "مكتب الصالحي",
          phone: "0777555111",
          email: "Khaled@Example.com",
          password: "pass1234",
          clientType: "WHOLESALE",
          preferredPickup: "السوق",
        },
      })
    );
    assert.equal(reg1.status, 201);
    const d1 = await reg1.json();
    client1Id = d1.account.id;
    client1Token = d1.token;
    assert.equal(d1.account.status, "PENDING_APPROVAL");
    assert.equal(d1.account.phone, "777555111");
    assert.equal(d1.account.email, "khaled@example.com");

    // Duplicate phone rejected within same tenant
    const dupRes = await portalRegisterPOST(
      makePortalReq(TENANT_A, "/api/client-portal/register", "POST", {
        body: {
          fullName: "مكرر",
          phone: "+967777555111",
          email: "other@example.com",
          password: "pass1234",
        },
      })
    );
    assert.equal(dupRes.status, 409);

    // Unapproved client cannot submit goods requests
    const blockedReq = await portalRequestsPOST(
      makePortalReq(TENANT_A, "/api/client-portal/requests", "POST", {
        clientToken: client1Token,
        body: {
          pickupLocation: "السوق",
          lines: [{ itemTitle: "صوطي", requestedQty: 5, unitCode: "QAT_BUNCH", unitLabel: "علاقية قات" }],
        },
      })
    );
    assert.equal(blockedReq.status, 400);

    // Staff approves registration and assigns 500,000 credit limit
    const appRes = await adminClientsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffTokenA,
        body: {
          clientAccountId: client1Id,
          action: "APPROVE",
          creditLimit: 500000,
        },
      })
    );
    assert.equal(appRes.status, 200);
    const appData = await appRes.json();
    assert.equal(appData.client.status, "ACTIVE");
    assert.ok(appData.client.customerId, "Must link or provision ERP Customer");
    assert.equal(appData.client.creditLimit, 500000);
  });

  it("enforces strict tenant & client isolation (rejects client token on Tenant B & on staff APIs)", async () => {
    // Client 1 token from TENANT_A MUST be rejected on TENANT_B
    const crossTenantRes = await portalMeGET(
      makePortalReq(TENANT_B, "/api/client-portal/me", "GET", { clientToken: client1Token })
    );
    assert.equal(crossTenantRes.status, 403);

    // Client 1 token MUST NOT grant access to staff ERP APIs
    const staffAttempt = await adminClientsGET(
      makePortalReq(TENANT_A, "/api/portal-admin/clients", "GET", { clientToken: client1Token })
    );
    assert.equal(staffAttempt.status, 401);

    // Register & approve second client in TENANT_A for cross-client isolation verification later
    const reg2 = await portalRegisterPOST(
      makePortalReq(TENANT_A, "/api/client-portal/register", "POST", {
        body: {
          fullName: "علي الحداد",
          phone: "733444555",
          email: "ali@example.com",
          password: "pass1234",
        },
      })
    );
    assert.equal(reg2.status, 201);
    const d2 = await reg2.json();
    client2Token = d2.token;
    await adminClientsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffTokenA,
        body: { clientAccountId: d2.account.id, action: "APPROVE", creditLimit: 100000 },
      })
    );
  });

  it("validates custom 'اخرى:' unit text, creates multi-line request ('تم استلام طلبك'), completes handover invoice/receipt, and isolates statement", async () => {
    // Missing custom unit text when unitCode === "OTHER" must fail
    const missingOther = await portalRequestsPOST(
      makePortalReq(TENANT_A, "/api/client-portal/requests", "POST", {
        clientToken: client1Token,
        body: {
          pickupLocation: "السوق",
          lines: [{ itemTitle: "بلدي ممتاز", requestedQty: 3, unitCode: "OTHER", unitLabel: "أخرى" }],
        },
      })
    );
    assert.equal(missingOther.status, 400);

    // Valid multi-line request with علاقية قات + أخرى -> اخرى: صندوق خشبي
    const createReq = await portalRequestsPOST(
      makePortalReq(TENANT_A, "/api/client-portal/requests", "POST", {
        clientToken: client1Token,
        body: {
          pickupType: "OTHER",
          pickupLocation: "أخرى",
          customPickupLocation: "نقطة تسليم شعوب",
          lines: [
            { itemTitle: "صوطي درجة أولى", requestedQty: 10, unitCode: "QAT_BUNCH", unitLabel: "علاقية قات" },
            { itemTitle: "عنسي فاخر", requestedQty: 2, unitCode: "OTHER", unitLabel: "أخرى", customUnitLabel: "صندوق خشبي" },
          ],
        },
      })
    );
    assert.equal(createReq.status, 201);
    const reqData = await createReq.json();
    assert.equal(reqData.receiptTitle, "تم استلام طلبك");
    assert.equal(reqData.request.status, "PENDING_REVIEW");
    assert.equal(reqData.request.statusLabelAr, "قيد المراجعة");
    assert.equal(reqData.request.pickupLocation, "نقطة تسليم شعوب");
    assert.equal(reqData.request.lines[1].displayUnitLabel, "صندوق خشبي");
    request1Id = reqData.request.id;

    // Client 2 cannot see Client 1's request!
    const c2Reqs = await (
      await portalRequestsGET(
        makePortalReq(TENANT_A, "/api/client-portal/requests", "GET", { clientToken: client2Token })
      )
    ).json();
    assert.equal(c2Reqs.requests.length, 0);

    // Staff lists incoming requests, confirms with unit prices, marks READY_FOR_PICKUP, and completes HANDOVER
    const adminListRes = await (
      await adminRequestsGET(
        makePortalReq(TENANT_A, "/api/portal-admin/requests", "GET", { staffToken: staffTokenA })
      )
    ).json();
    const targetReq = adminListRes.requests.find((r: { id: string }) => r.id === request1Id);
    assert.ok(targetReq);

    const confirmRes = await adminRequestsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffTokenA,
        body: {
          requestId: request1Id,
          action: "CONFIRM",
          lines: [
            { id: targetReq.lines[0].id, confirmedQty: 10, unitPrice: 5000 },
            { id: targetReq.lines[1].id, confirmedQty: 2, unitPrice: 15000 },
          ],
        },
      })
    );
    assert.equal(confirmRes.status, 200);
    assert.equal((await confirmRes.json()).request.totalConfirmed, 80000);

    const readyRes = await adminRequestsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffTokenA,
        body: { requestId: request1Id, action: "MARK_READY" },
      })
    );
    assert.equal(readyRes.status, 200);
    assert.equal((await readyRes.json()).request.status, "READY_FOR_PICKUP");

    // Complete handover with partial payment 30,000 (leaving 50,000 receivable)
    const handoverRes = await adminRequestsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffTokenA,
        body: {
          requestId: request1Id,
          action: "HANDOVER",
          projectId: projectIdA,
          treasuryId: treasuryIdA,
          immediatePaidAmount: 30000,
        },
      })
    );
    assert.equal(handoverRes.status, 200);
    const handoverData = await handoverRes.json();
    assert.equal(handoverData.request.status, "COMPLETED");
    assert.ok(handoverData.request.linkedInvoiceId);
    assert.ok(handoverData.request.linkedSaleId);
    assert.ok(handoverData.request.linkedReceiptId);

    // Repeat handover blocked cleanly
    const dupHandover = await adminRequestsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffTokenA,
        body: { requestId: request1Id, action: "HANDOVER", projectId: projectIdA },
      })
    );
    assert.equal(dupHandover.status, 400);

    // Client 1's statement matches accounting reality; Client 2's statement stays 0!
    const stmt1 = await (
      await portalStatementGET(
        makePortalReq(TENANT_A, "/api/client-portal/statement", "GET", { clientToken: client1Token })
      )
    ).json();
    assert.equal(stmt1.summary.totalInvoiced, 80000);
    assert.equal(stmt1.summary.totalPaid, 30000);
    assert.equal(stmt1.summary.totalUnpaid, 50000);
    assert.equal(stmt1.summary.creditLimit, 500000);
    assert.equal(stmt1.summary.creditAvailable, 450000);
    assert.equal(stmt1.bills[0].billStatus, "PARTIALLY_PAID");
    assert.equal(stmt1.bills[0].billStatusAr, "مدفوعة جزئياً");

    const stmt2 = await (
      await portalStatementGET(
        makePortalReq(TENANT_A, "/api/client-portal/statement", "GET", { clientToken: client2Token })
      )
    ).json();
    assert.equal(stmt2.summary.totalInvoiced, 0);
    assert.equal(stmt2.bills.length, 0);
  });

  it("queues WhatsApp drafts, supports staff edit-before-send & skip, logs audit trail, and isolates WhatsApp API credentials per tenant", async () => {
    // Save per-tenant encrypted WhatsApp API token on TENANT_A
    const saveSettingsRes = await waOutboxPOST(
      makePortalReq(TENANT_A, "/api/whatsapp-outbox", "POST", {
        staffToken: staffTokenA,
        body: {
          action: "SAVE_SETTINGS",
          provider: "WHATSAPP_WEB_LINK",
          senderPhone: "777000999",
          apiToken: "super-secret-wa-token-xyz123",
        },
      })
    );
    assert.equal(saveSettingsRes.status, 200);
    const savedWa = await saveSettingsRes.json();
    assert.equal(savedWa.settings.hasApiToken, true);
    assert.ok(!JSON.stringify(savedWa).includes("super-secret-wa-token-xyz123"), "API token must be masked");

    // Inspect pending drafts queued during approval/request/handover
    const outboxRes = await waOutboxGET(
      makePortalReq(TENANT_A, "/api/whatsapp-outbox?status=PENDING_APPROVAL", "GET", {
        staffToken: staffTokenA,
      })
    );
    assert.equal(outboxRes.status, 200);
    const outboxData = await outboxRes.json();
    assert.ok(outboxData.drafts.length >= 3, "Multiple automatic drafts queued");

    const draftToEdit = outboxData.drafts[0];
    const customEditedMsg = `${draftToEdit.originalMessageText}\nملاحظة موظف: التسليم جاهز عند البوابة.`;
    const sendRes = await waOutboxPOST(
      makePortalReq(TENANT_A, "/api/whatsapp-outbox", "POST", {
        staffToken: staffTokenA,
        body: {
          action: "APPROVE_SEND",
          id: draftToEdit.id,
          editedMessageText: customEditedMsg,
        },
      })
    );
    assert.equal(sendRes.status, 200);
    const sentData = await sendRes.json();
    assert.equal(sentData.messageRecord.status, "DISPATCHED_LINK");
    assert.equal(sentData.messageRecord.finalMessageText, customEditedMsg);
    assert.equal(sentData.messageRecord.originalMessageText, draftToEdit.originalMessageText);
    assert.ok(sentData.whatsappUrl.startsWith("https://wa.me/967"));
    assert.ok(sentData.whatsappUrl.includes(encodeURIComponent("ملاحظة موظف")));

    // Skip another draft
    const draftToSkip = outboxData.drafts[1];
    const skipRes = await waOutboxPOST(
      makePortalReq(TENANT_A, "/api/whatsapp-outbox", "POST", {
        staffToken: staffTokenA,
        body: { action: "SKIP", id: draftToSkip.id, reason: "تم إبلاغ العميل هاتفياً" },
      })
    );
    assert.equal(skipRes.status, 200);
    assert.equal((await skipRes.json()).messageRecord.status, "SKIPPED");

    // Tenant B must have completely isolated outbox (0 drafts from Tenant A!)
    await runWithTenant(TENANT_B, async () => {
      const bDrafts = await prisma.whatsAppOutboxMessage.findMany();
      assert.equal(bDrafts.length, 0);
    });

    // Also test client login route & form config customization by staff
    const loginRes = await portalLoginPOST(
      makePortalReq(TENANT_A, "/api/client-portal/login", "POST", {
        body: { identifier: "777555111", password: "pass1234" },
      })
    );
    assert.equal(loginRes.status, 200);
    assert.equal((await loginRes.json()).account.id, client1Id);

    const cfgPut = await adminFormConfigPUT(
      makePortalReq(TENANT_A, "/api/portal-admin/form-config", "PUT", {
        staffToken: staffTokenA,
        body: { requestHeadingAr: "طلب استلام" },
      })
    );
    assert.equal(cfgPut.status, 200);
    const cfgGet = await (
      await adminFormConfigGET(
        makePortalReq(TENANT_A, "/api/portal-admin/form-config", "GET", { staffToken: staffTokenA })
      )
    ).json();
    assert.equal(cfgGet.formConfig.requestHeadingAr, "طلب استلام");
  });
});

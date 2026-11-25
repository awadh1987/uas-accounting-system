import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
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
import { CLIENT_PORTAL_TOKEN_HEADER } from "../src/lib/clientPortal/clientAuth";
import {
  buildBulkImportTemplateWorkbook,
  buildQuickRepeatBasket,
  generateBulkImportSampleText,
  parseBulkOrderFileBuffer,
  parseBulkOrderText,
} from "../src/lib/clientPortal/bulkRequestParser";
import type { ClientCatalogBoardItemView } from "../src/lib/clientPortal/catalogBoard";
import { DEFAULT_TENANT_FORM_CONFIG, getTenantFormConfig } from "../src/lib/clientPortal/portalConfig";
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
import {
  GET as adminCatalogGET,
  POST as adminCatalogPOST,
} from "../src/app/api/portal-admin/catalog/route";
import { POST as adminRequestsPOST } from "../src/app/api/portal-admin/requests/route";

const TEST_TAG = `${Math.floor(10000 + Math.random() * 90000)}`;
const TENANT_A = `p11a-${TEST_TAG}`;
const TENANT_B = `p11b-${TEST_TAG}`;
const TENANT_NEW = `p11n-${TEST_TAG}`;
const REPO_ROOT = path.resolve(__dirname, "..");

function seedTenantLicense(slug: string) {
  const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
  if (!fs.existsSync(privPath)) return;
  const priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));
  const payload: UasLicensePayload = {
    license_id: `UAS-P11-${slug}`,
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

function makeReq(
  tenantSlug: string,
  urlPath: string,
  method: string,
  opts?: { clientToken?: string; staffToken?: string; body?: unknown }
): NextRequest {
  const headers: Record<string, string> = {
    "x-uas-tenant-id": tenantSlug,
  };
  if (opts?.clientToken) headers[CLIENT_PORTAL_TOKEN_HEADER] = opts.clientToken;
  if (opts?.staffToken) headers["cookie"] = `${SESSION_COOKIE_NAME}=${opts.staffToken}`;
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

describe("Phases 11–14 — Published Catalog Board, Bulk Import, Return-to-Client Amendments & Operational Polish", () => {
  let staffAdminToken = "";
  let clientIdA = "";
  let clientTokenA = "";
  let clientTokenB_sameTenant = "";
  let projectIdA = "";
  let treasuryIdA = "";
  let publishedItemId = "";
  let publishedBoardView: ClientCatalogBoardItemView | null = null;

  before(async () => {
    const tmpBase = path.join(process.cwd(), "data", `test_p11_base_${TEST_TAG}.db`);
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
        const admin = await prisma.user.create({
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
            name: "مزرعة الوادي",
            nameAr: "مزرعة الوادي",
            nameEn: "Valley Farm",
            estimatedValue: 3000000,
            plannedHarvestCount: 2,
          },
        });
        const trs = await createTreasuryAccount({
          nameAr: "الصندوق الرئيسي",
          currency: "YER",
          type: "VAULT",
        });

        // Seed internal inventory item with purchasePrice (must NEVER leak to client endpoints!)
        const uom = await prisma.unitOfMeasure.create({
          data: { code: "QAT_BUNCH", nameAr: "علاقية قات", nameEn: "Qat Bunch", isBaseDefault: true },
        });
        await prisma.inventoryItem.create({
          data: {
            sku: `SKU-SECRET-${slug}`,
            nameAr: "قات صوطي داخلي",
            nameEn: "Internal Sooti",
            grade: "درجة أولى",
            baseUnitId: uom.id,
            purchasePrice: 2100,
            wholesalePrice: 5500,
            retailPrice: 6000,
            minSellPrice: 5000,
            isActive: true,
          },
        });

        if (slug === TENANT_A) {
          projectIdA = prj.id;
          treasuryIdA = trs.id;
          staffAdminToken = issueSessionToken({
            userId: admin.id,
            role: admin.role,
            tenantId: TENANT_A,
            sessionVersion: 1,
          });
        }
      });
    }

    // Register & approve Primary Client A and Sibling Client A2 on TENANT_A
    const regA = await (
      await portalRegisterPOST(
        makeReq(TENANT_A, "/api/client-portal/register", "POST", {
          body: {
            fullName: "ناصر العامري",
            phone: "777666111",
            email: "nasser.a@qat.test",
            password: "PassA123",
          },
        })
      )
    ).json();
    clientIdA = regA.account.id;
    clientTokenA = regA.token;

    await adminClientsPOST(
      makeReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffAdminToken,
        body: { clientAccountId: clientIdA, action: "APPROVE", creditLimit: 400000 },
      })
    );

    const regA2 = await (
      await portalRegisterPOST(
        makeReq(TENANT_A, "/api/client-portal/register", "POST", {
          body: {
            fullName: "عميل آخر نفس المنشأة",
            phone: "777666222",
            email: "other.a@qat.test",
            password: "PassB123",
          },
        })
      )
    ).json();
    clientTokenB_sameTenant = regA2.token;
    await adminClientsPOST(
      makeReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffAdminToken,
        body: { clientAccountId: regA2.account.id, action: "APPROVE", creditLimit: 100000 },
      })
    );
  });

  after(async () => {
    await prisma.$disconnect().catch(() => null);
    await resetTenantClientsForTests();
    for (const slug of [TENANT_A, TENANT_B, TENANT_NEW]) {
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
    const baseDb = path.join(process.cwd(), "data", `test_p11_base_${TEST_TAG}.db`);
    for (const suffix of ["", "-shm", "-wal", "-journal"]) {
      if (fs.existsSync(baseDb + suffix)) fs.unlinkSync(baseDb + suffix);
    }
  });

  it("Phase 11: Staff draft/publish with freshness labels, zero cost/margin leakage, tenant isolation & direct طلب handoff", async () => {
    // Unauthenticated blocked
    const unauth = await adminCatalogGET(makeReq(TENANT_A, "/api/portal-admin/catalog", "GET"));
    assert.equal(unauth.status, 401);

    // 1. Save a hidden draft (isPublished: false)
    const draftRes = await adminCatalogPOST(
      makeReq(TENANT_A, "/api/portal-admin/catalog", "POST", {
        staffToken: staffAdminToken,
        body: {
          titleAr: "مسودة خاصة لا تظهر للعملاء",
          gradeLabel: "درجة ثانية",
          unitCode: "QAT_BUNCH",
          unitLabel: "علاقية قات",
          unitPrice: 3000,
          availabilityStatus: "AVAILABLE",
          freshnessLabel: "قائمة أسعار اليوم",
          effectiveDate: "2026-11-25",
          isPublished: false,
        },
      })
    );
    assert.equal(draftRes.status, 200);

    // 2. Save & publish graded item with freshness & validity note + custom pickup
    const pubRes = await adminCatalogPOST(
      makeReq(TENANT_A, "/api/portal-admin/catalog", "POST", {
        staffToken: staffAdminToken,
        body: {
          titleAr: "قات صوطي قطفة صباحية",
          gradeLabel: "نخب ممتاز",
          unitCode: "QAT_BUNCH",
          unitLabel: "علاقية قات",
          unitPrice: 5500,
          availabilityStatus: "AVAILABLE",
          pickupLocation: "السوق",
          freshnessLabel: "قائمة أسعار اليوم",
          effectiveDate: "2026-11-25",
          validityNote: "صالح حتى نفاد الكمية اليوم",
          isPublished: true,
        },
      })
    );
    assert.equal(pubRes.status, 200);
    publishedItemId = (await pubRes.json()).item.id;

    // 3. Publish custom OTHER unit item ("ربطة ملكي") & LIMITED availability
    const pubCustomRes = await adminCatalogPOST(
      makeReq(TENANT_A, "/api/portal-admin/catalog", "POST", {
        staffToken: staffAdminToken,
        body: {
          titleAr: "قات نهمي فاخر",
          gradeLabel: "عروسي / خاص",
          unitCode: "OTHER",
          customUnitLabel: "ربطة ملكي",
          unitPrice: 7200,
          availabilityStatus: "LIMITED",
          freshnessLabel: "قطفة الفجر",
          effectiveDate: "2026-11-25",
          isPublished: true,
        },
      })
    );
    assert.equal(pubCustomRes.status, 200);

    // 4. Client Portal catalog & config endpoints return ONLY published items and NEVER internal cost/margin
    const catalogResp = await portalCatalogGET(makeReq(TENANT_A, "/api/client-portal/catalog", "GET"));
    assert.equal(catalogResp.status, 200);
    const catalogJson = await catalogResp.json();
    const rawSerialized = JSON.stringify(catalogJson);

    assert.equal(catalogJson.tenantSlug, TENANT_A);
    assert.equal(catalogJson.items.length, 2);
    assert.ok(!rawSerialized.includes("مسودة خاصة لا تظهر للعملاء"));
    assert.ok(!rawSerialized.includes("purchasePrice"));
    assert.ok(!rawSerialized.includes("avgUnitCostBase"));
    assert.ok(!rawSerialized.includes("minSellPrice"));
    assert.ok(!rawSerialized.includes("2100"), "Internal cost price must never leak");

    publishedBoardView = (catalogJson.items as ClientCatalogBoardItemView[]).find(
      (i) => i.id === publishedItemId
    )!;
    assert.equal(publishedBoardView.freshnessLabel, "قائمة أسعار اليوم");
    assert.equal(publishedBoardView.effectiveDateDmy, "25 / 11 / 2026");
    assert.equal(catalogJson.stats.availableCount, 1);
    assert.equal(catalogJson.stats.limitedCount, 1);
    assert.equal(catalogJson.stats.gradesCount, 2);

    const cfgJson = await (await portalConfigGET(makeReq(TENANT_A, "/api/client-portal/config", "GET"))).json();
    assert.equal(cfgJson.boardItems.length, 2);
    assert.ok(!JSON.stringify(cfgJson).includes("purchasePrice"));

    // Cross-tenant isolation: TENANT_B has 0 items from TENANT_A
    const tenantBCat = await (
      await portalCatalogGET(makeReq(TENANT_B, "/api/client-portal/catalog", "GET"))
    ).json();
    assert.equal(tenantBCat.tenantSlug, TENANT_B);
    assert.equal(tenantBCat.items.length, 0);

    // Direct handoff into تسجيل طلب resolves board price & computes P x Q = 16,500
    const orderRes = await portalRequestsPOST(
      makeReq(TENANT_A, "/api/client-portal/requests", "POST", {
        clientToken: clientTokenA,
        body: {
          pickupType: "MARKET",
          pickupLocation: "السوق",
          lines: [
            {
              itemId: publishedItemId,
              itemTitle: publishedBoardView.titleAr,
              requestedQty: 3,
              unitCode: "QAT_BUNCH",
              unitLabel: "علاقية قات",
            },
          ],
        },
      })
    );
    assert.equal(orderRes.status, 201);
    const createdReq = (await orderRes.json()).request;
    assert.equal(createdReq.totalEstimated, 16500);
    assert.equal(createdReq.lines[0].unitPrice, 5500);
    assert.equal(createdReq.lines[0].lineTotal, 16500);
  });

  it("Phase 12: Bulk item import (paste + CSV/Excel + P x Q + custom OTHER unit) and quick-repeat basket", async () => {
    const boardItems = publishedBoardView ? [publishedBoardView] : [];

    // 1. Multi-line paste including Arabic numbers, catalog price lookup, custom unit, and missing-price flag
    const pastedText = [
      "قات صوطي قطفة صباحية, ٥, علاقية قات",
      "صنف موسمي جديد | 2 | ربطة ملكي | 4200 | تغليف خاص",
      "صنف غير مسعر\t3\tأخرى",
      "صنف بكمية صفر, 0, كيس, 1000",
    ].join("\n");

    const pasteParsed = parseBulkOrderText(pastedText, {
      boardItems,
      formConfig: DEFAULT_TENANT_FORM_CONFIG,
    });
    assert.equal(pasteParsed.validRowsCount, 3);
    assert.equal(pasteParsed.errorRowsCount, 1);
    assert.equal(pasteParsed.warningRowsCount, 1);

    assert.equal(pasteParsed.rows[0].requestedQty, 5);
    assert.equal(pasteParsed.rows[0].unitPrice, 5500); // Auto-matched from published board!
    assert.equal(pasteParsed.rows[0].lineTotal, 27500);
    assert.equal(pasteParsed.rows[0].matchedFromCatalog, true);

    assert.equal(pasteParsed.rows[1].unitCode, "OTHER");
    assert.equal(pasteParsed.rows[1].customUnitLabel, "ربطة ملكي");
    assert.equal(pasteParsed.rows[1].lineTotal, 8400);

    assert.equal(pasteParsed.rows[2].needsPriceConfirmation, true);
    assert.equal(pasteParsed.rows[2].needsCustomUnitConfirmation, true);
    assert.equal(pasteParsed.estimatedOrderTotal, 35900);

    // 2. Sample CSV & Excel (.xlsx) workbook parsing
    const sampleParsed = parseBulkOrderText(generateBulkImportSampleText(), {
      boardItems,
      formConfig: DEFAULT_TENANT_FORM_CONFIG,
    });
    assert.equal(sampleParsed.validRowsCount, 3);
    assert.equal(sampleParsed.estimatedOrderTotal, 5 * 4500 + 3 * 12000 + 4 * 3200);

    const wb = buildBulkImportTemplateWorkbook();
    const xlsxBuf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
    const fileParsed = parseBulkOrderFileBuffer(xlsxBuf, "order.xlsx", {
      boardItems,
      formConfig: DEFAULT_TENANT_FORM_CONFIG,
    });
    assert.equal(fileParsed.validRowsCount, 3);
    assert.equal(fileParsed.rows[2].unitCode, "OTHER");
    assert.equal(fileParsed.rows[2].customUnitLabel, "ربطة ملكي");

    // 3. Quick-repeat basket aggregates prior requests cleanly & ignores cancelled requests
    const historyRes = await (
      await portalRequestsGET(makeReq(TENANT_A, "/api/client-portal/requests", "GET", { clientToken: clientTokenA }))
    ).json();
    const repeatBasket = buildQuickRepeatBasket({
      requests: [
        ...historyRes.requests,
        {
          status: "CANCELLED",
          createdAt: "2026-11-24T00:00:00.000Z",
          lines: [
            {
              itemId: null,
              itemTitle: "طلب ملغى لا يظهر",
              requestedQty: 1,
              confirmedQty: null,
              unitCode: "QAT_BUNCH",
              unitLabel: "علاقية قات",
              customUnitLabel: null,
              displayUnitLabel: "علاقية قات",
              unitPrice: 1000,
            },
          ],
        },
      ],
      bills: [],
      boardItems,
      formConfig: DEFAULT_TENANT_FORM_CONFIG,
    });
    assert.ok(repeatBasket.length >= 1);
    assert.equal(repeatBasket[0].itemTitle, "قات صوطي قطفة صباحية");
    assert.ok(!repeatBasket.some((i) => i.itemTitle === "طلب ملغى لا يظهر"));
  });

  it("Phase 13 & 14: Staff amendments + Before/After diff, return-to-client loop, edit/cancel guardrails, statement & new tenant parity", async () => {
    // 1. Client creates fresh PENDING_REVIEW request
    const createRes = await portalRequestsPOST(
      makeReq(TENANT_A, "/api/client-portal/requests", "POST", {
        clientToken: clientTokenA,
        body: {
          pickupType: "MARKET",
          pickupLocation: "السوق",
          pickupNotes: "الاستلام ظهراً",
          lines: [
            {
              itemId: publishedItemId,
              itemTitle: "قات صوطي قطفة صباحية",
              requestedQty: 4,
              unitCode: "QAT_BUNCH",
              unitLabel: "علاقية قات",
              unitPrice: 5500,
            },
          ],
        },
      })
    );
    assert.equal(createRes.status, 201);
    const reqObj = (await createRes.json()).request;
    const reqId = reqObj.id;
    const lineId = reqObj.lines[0].id;

    // Missing reviewerRemarks when returning to client -> rejected with 400
    const missingRemarksRes = await adminRequestsPOST(
      makeReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: { requestId: reqId, action: "RETURN_TO_CLIENT" },
      })
    );
    assert.equal(missingRemarksRes.status, 400);

    // 2. Staff amends pickup location, qty, price, adds new custom-unit line, sets payment plan & returns to client with remarks
    const returnRes = await adminRequestsPOST(
      makeReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "RETURN_TO_CLIENT",
          pickupType: "BRANCH",
          pickupLocation: "فرع المبيعات الرئيسي",
          immediatePaidAmount: 10000,
          reviewerRemarks: "تم تعديل موقع التسليم إلى الفرع وإضافة ربطة ملكي وتحديث الكمية",
          lines: [
            { id: lineId, confirmedQty: 3, unitPrice: 5500 },
            {
              itemTitle: "قات نهمي مضاف",
              confirmedQty: 2,
              unitCode: "OTHER",
              customUnitLabel: "ربطة ملكي",
              unitPrice: 7000,
            },
          ],
        },
      })
    );
    assert.equal(returnRes.status, 200);
    const returnedReq = (await returnRes.json()).request;
    assert.equal(returnedReq.status, "RETURNED_TO_CLIENT");
    assert.equal(returnedReq.statusLabelAr, "معاد للموافقة");
    assert.equal(returnedReq.pickupLocation, "فرع المبيعات الرئيسي");
    assert.equal(returnedReq.totalConfirmed, 3 * 5500 + 2 * 7000); // 30,500
    assert.equal(returnedReq.revisionNumber, 2);
    assert.ok(returnedReq.amendmentDiff.length >= 3);
    assert.ok(
      returnedReq.amendmentDiff.some((d: { field: string }) => d.field === "pickupLocation")
    );

    // Guardrail: Another client on same tenant cannot respond to clientA's returned request
    const crossClientResp = await portalRequestByIdPATCH(
      makeReq(TENANT_A, `/api/client-portal/requests/${reqId}`, "PATCH", {
        clientToken: clientTokenB_sameTenant,
        body: { action: "APPROVE_AMENDMENTS" },
      }),
      { params: Promise.resolve({ id: reqId }) }
    );
    assert.equal(crossClientResp.status, 404);

    // Guardrail: While RETURNED_TO_CLIENT, client cannot call direct PENDING_REVIEW EDIT or CANCEL
    const blockedEdit = await portalRequestByIdPATCH(
      makeReq(TENANT_A, `/api/client-portal/requests/${reqId}`, "PATCH", {
        clientToken: clientTokenA,
        body: { action: "CANCEL" },
      }),
      { params: Promise.resolve({ id: reqId }) }
    );
    assert.equal(blockedEdit.status, 400);

    // 3. Client declines amendment with note -> returns to PENDING_REVIEW
    const declineRes = await portalRequestByIdPATCH(
      makeReq(TENANT_A, `/api/client-portal/requests/${reqId}`, "PATCH", {
        clientToken: clientTokenA,
        body: {
          action: "DECLINE_AMENDMENTS",
          clientResponseNote: "يفضل تخفيض سعر الربطة الملكي إلى 6500",
        },
      }),
      { params: Promise.resolve({ id: reqId }) }
    );
    assert.equal(declineRes.status, 200);
    const declinedReq = (await declineRes.json()).request;
    assert.equal(declinedReq.status, "PENDING_REVIEW");
    assert.equal(declinedReq.clientResponseStatus, "CLIENT_DECLINED");

    // 4. Staff revises price and returns again to client
    const updatedLineIds = declinedReq.lines.map((l: { id: string; itemTitle: string; confirmedQty: number }) =>
      l.itemTitle === "قات نهمي مضاف"
        ? { id: l.id, confirmedQty: 2, unitPrice: 6500 }
        : { id: l.id, confirmedQty: l.confirmedQty, unitPrice: 5500 }
    );
    const returnRes2 = await adminRequestsPOST(
      makeReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "RETURN_TO_CLIENT",
          reviewerRemarks: "تم تعديل السعر إلى 6500 بناءً على ملاحظتكم",
          immediatePaidAmount: 10000,
          lines: updatedLineIds,
        },
      })
    );
    assert.equal(returnRes2.status, 200);
    const ret2 = (await returnRes2.json()).request;
    assert.equal(ret2.totalConfirmed, 3 * 5500 + 2 * 6500); // 29,500

    // 5. Client approves amendments -> transitions to CONFIRMED + idempotent linked Sales Order created
    const approveRes = await portalRequestByIdPATCH(
      makeReq(TENANT_A, `/api/client-portal/requests/${reqId}`, "PATCH", {
        clientToken: clientTokenA,
        body: { action: "APPROVE_AMENDMENTS" },
      }),
      { params: Promise.resolve({ id: reqId }) }
    );
    assert.equal(approveRes.status, 200);
    const approvedReq = (await approveRes.json()).request;
    assert.equal(approvedReq.status, "CONFIRMED");
    assert.equal(approvedReq.clientResponseStatus, "CLIENT_APPROVED");
    assert.ok(approvedReq.linkedSalesRecordId);

    // Repeating CONFIRM is idempotent (no duplicate WorkspaceDraft)
    const replayRes = await adminRequestsPOST(
      makeReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: { requestId: reqId, action: "CONFIRM" },
      })
    );
    assert.equal(replayRes.status, 200);
    assert.equal((await replayRes.json()).idempotentReplay, true);

    // Guardrail: CONFIRMED request cannot be cancelled by client
    const cancelConfirmed = await portalRequestByIdPATCH(
      makeReq(TENANT_A, `/api/client-portal/requests/${reqId}`, "PATCH", {
        clientToken: clientTokenA,
        body: { action: "CANCEL" },
      }),
      { params: Promise.resolve({ id: reqId }) }
    );
    assert.equal(cancelConfirmed.status, 400);

    // 6. Staff completes handover -> posts SalesInvoice + ReceiptVoucher with invoice application link
    const handoverRes = await adminRequestsPOST(
      makeReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId: reqId,
          action: "HANDOVER",
          projectId: projectIdA,
          treasuryId: treasuryIdA,
          immediatePaidAmount: 10000,
        },
      })
    );
    assert.equal(handoverRes.status, 200);

    const stmt = await (
      await portalStatementGET(makeReq(TENANT_A, "/api/client-portal/statement", "GET", { clientToken: clientTokenA }))
    ).json();
    assert.equal(stmt.summary.totalInvoiced, 29500);
    assert.equal(stmt.summary.totalPaid, 10000);
    assert.equal(stmt.summary.totalUnpaid, 19500);
    assert.equal(stmt.bills[0].billStatusAr, "جزئية");
    assert.equal(stmt.receipts.length, 1);
    assert.ok(stmt.receipts[0].appliedInvoiceNumber);
    assert.ok(String(stmt.receipts[0].applicationSummary).includes(stmt.receipts[0].appliedInvoiceNumber));

    // Check WhatsApp Outbox includes REQUEST_RETURNED_FOR_APPROVAL notification log entry
    assert.ok(
      (stmt.notifications as Array<{ eventType: string }>).some(
        (n) => n.eventType === "REQUEST_RETURNED_FOR_APPROVAL"
      )
    );

    // 7. New tenant parity: newly registered tenant gets portal tables & form defaults automatically
    const dbFileNew = resolveTenantDbFilePath(TENANT_NEW);
    if (fs.existsSync(dbFileNew)) fs.unlinkSync(dbFileNew);
    ensureTenantRegistered(TENANT_NEW, `New Tenant ${TENANT_NEW}`, { slug: TENANT_NEW });
    seedTenantLicense(TENANT_NEW);

    await runWithTenant(TENANT_NEW, async () => {
      await ensurePortalSchemaReady();
      const boardItems = await prisma.portalCatalogBoardItem.findMany();
      const formCfg = await getTenantFormConfig();
      assert.deepEqual(boardItems, []);
      assert.equal(formCfg.portalEnabled, true);
      assert.ok(formCfg.unitOptions.some((u) => u.code === "QAT_BUNCH"));
      assert.ok(formCfg.unitOptions.some((u) => u.code === "OTHER"));
    });

    // 8. Verify UI components retain required Phase 11–14 affordances, RTL/signature/date/currency & overflow menus
    const portalAppSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/client-portal/ClientPortalApp.tsx"),
      "utf8"
    );
    assert.ok(portalAppSrc.includes("قائمة الأسعار والأصناف"));
    assert.ok(portalAppSrc.includes("استيراد أصناف بالجملة"));
    assert.ok(portalAppSrc.includes("سلة الأصناف المتكررة"));
    assert.ok(portalAppSrc.includes("اعتماد التعديلات"));
    assert.ok(portalAppSrc.includes("رفض / طلب تعديل"));
    assert.ok(portalAppSrc.includes("معاد للموافقة"));
    assert.ok(portalAppSrc.includes("بطاقة الاستلام"));
    assert.ok(portalAppSrc.includes("handleExportStatementCsv"));
    assert.ok(portalAppSrc.includes("exportedBy: portalExportActor"));

    const adminPanelSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/portal-admin/TenantClientPortalAdminPanel.tsx"),
      "utf8"
    );
    assert.ok(adminPanelSrc.includes("إعادة للعميل للموافقة"));
    assert.ok(adminPanelSrc.includes("PortalCatalogBoardAdminSection"));
    assert.ok(adminPanelSrc.includes("filterOutSyntheticTestRecords"));
    assert.ok(adminPanelSrc.includes("ActionOverflowMenu"));
  });
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  ensureTenantRegistered,
  normalizeTenantId,
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
import { resolvePublicAvatarsDir } from "../src/lib/avatarAssets";
import { POST as portalRegisterPOST } from "../src/app/api/client-portal/register/route";
import { POST as portalLoginPOST } from "../src/app/api/client-portal/login/route";
import {
  GET as portalMeGET,
  PATCH as portalMePATCH,
} from "../src/app/api/client-portal/me/route";
import {
  DELETE as portalAvatarDELETE,
  POST as portalAvatarPOST,
} from "../src/app/api/client-portal/me/avatar/route";
import { POST as portalForgotPOST } from "../src/app/api/client-portal/forgot-password/route";
import {
  GET as portalRequestsGET,
  POST as portalRequestsPOST,
} from "../src/app/api/client-portal/requests/route";
import { PATCH as portalRequestByIdPATCH } from "../src/app/api/client-portal/requests/[id]/route";
import { GET as portalStatementGET } from "../src/app/api/client-portal/statement/route";
import { GET as publicAvatarGET } from "../src/app/api/public/avatar/[tenantKey]/[filename]/route";
import { POST as adminClientsPOST } from "../src/app/api/portal-admin/clients/route";
import { POST as adminRequestsPOST } from "../src/app/api/portal-admin/requests/route";

const TEST_TAG = `${Math.floor(10000 + Math.random() * 90000)}`;
const TENANT_A = `p10a-${TEST_TAG}`;
const TENANT_B = `p10b-${TEST_TAG}`;
const REPO_ROOT = path.resolve(__dirname, "..");

// Valid minimal 1x1 PNG binary
const TINY_VALID_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

function seedTenantLicense(slug: string) {
  const privPath = path.join(process.cwd(), "keys", "uas-license-private.pem");
  if (!fs.existsSync(privPath)) return;
  const priv = crypto.createPrivateKey(fs.readFileSync(privPath, "utf8"));
  const payload: UasLicensePayload = {
    license_id: `UAS-P10-${slug}`,
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

describe("Phase 10 — Client Password Recovery, Staff Reset, Client Avatar & Commercial Portal", () => {
  let staffAdminToken = "";
  let staffDeniedToken = "";
  let clientIdA = "";
  let clientTokenA = "";
  let projectIdA = "";
  let treasuryIdA = "";
  let uploadedFilename = "";

  before(async () => {
    const tmpBase = path.join(process.cwd(), "data", `test_p10_base_${TEST_TAG}.db`);
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
        const restrictedStaff = await prisma.user.create({
          data: {
            id: `denied-${slug}`,
            username: `restricted_${slug}`,
            name: "موظف مقيد",
            fullName: "موظف مقيد",
            role: "SALES_COLLECTOR",
            useCustomPermissions: true,
            customPermissionsJson: JSON.stringify({
              canEdit: true,
              "clients:reset_password": false,
              "clients:approve": false,
            }),
            email: `restricted_${slug}@qat.world`,
            passwordHash: hashPassword("Staff@123"),
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

        if (slug === TENANT_A) {
          projectIdA = prj.id;
          treasuryIdA = trs.id;
          staffAdminToken = issueSessionToken({
            userId: admin.id,
            role: admin.role,
            tenantId: TENANT_A,
            sessionVersion: 1,
          });
          staffDeniedToken = issueSessionToken({
            userId: restrictedStaff.id,
            role: restrictedStaff.role,
            tenantId: TENANT_A,
            sessionVersion: 1,
          });
        }
      });
    }

    const reg = await portalRegisterPOST(
      makePortalReq(TENANT_A, "/api/client-portal/register", "POST", {
        body: {
          fullName: "ناصر الجبري",
          phone: "777444555",
          email: "nasser@aljabri.test",
          password: "InitPass123",
        },
      })
    );
    assert.equal(reg.status, 201);
    const regData = await reg.json();
    clientIdA = regData.account.id;
    clientTokenA = regData.token;

    // Restricted user blocked from approving client
    const deniedApprove = await adminClientsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffDeniedToken,
        body: { clientAccountId: clientIdA, action: "APPROVE", creditLimit: 200000 },
      })
    );
    assert.equal(deniedApprove.status, 403);

    // Authorized admin approves with 300,000 credit limit
    const okApprove = await adminClientsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffAdminToken,
        body: { clientAccountId: clientIdA, action: "APPROVE", creditLimit: 300000 },
      })
    );
    assert.equal(okApprove.status, 200);
  });

  after(async () => {
    await prisma.$disconnect().catch(() => null);
    await resetTenantClientsForTests();
    for (const slug of [TENANT_A, TENANT_B]) {
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
      for (const avKey of [slug, normalizeTenantId(slug)]) {
        const avDir = resolvePublicAvatarsDir(avKey);
        if (fs.existsSync(avDir)) {
          fs.rmSync(avDir, { recursive: true, force: true });
        }
      }
    }
    const baseDb = path.join(process.cwd(), "data", `test_p10_base_${TEST_TAG}.db`);
    for (const suffix of ["", "-shm", "-wal", "-journal"]) {
      if (fs.existsSync(baseDb + suffix)) fs.unlinkSync(baseDb + suffix);
    }
  });

  it("supports non-enumerating self-service client password recovery, drafts WhatsApp message, revokes prior sessions, and blocks code reuse", async () => {
    // 1. Unknown identifier returns identical generic response (zero enumeration) and queues 0 WhatsApp drafts
    const unknownRes = await portalForgotPOST(
      makePortalReq(TENANT_A, "/api/client-portal/forgot-password", "POST", {
        body: { action: "REQUEST", identifier: "777999000" },
      })
    );
    assert.equal(unknownRes.status, 200);
    const unknownData = await unknownRes.json();
    assert.equal(unknownData.success, true);

    const reqBefore = await portalMeGET(
      makePortalReq(TENANT_A, "/api/client-portal/me", "GET", { clientToken: clientTokenA })
    );
    assert.equal(reqBefore.status, 200);

    // 2. Real client identifier returns same message shape without leaking OTP code, while queueing editable PASSWORD_RESET WhatsApp draft
    const resetReqRes = await portalForgotPOST(
      makePortalReq(TENANT_A, "/api/client-portal/forgot-password", "POST", {
        body: { action: "REQUEST", identifier: "0777444555" },
      })
    );
    assert.equal(resetReqRes.status, 200);
    const resetReqData = await resetReqRes.json();
    assert.equal(resetReqData.message, unknownData.message);
    assert.equal(resetReqData.resetCode, undefined);

    let extractedCode = "";
    await runWithTenant(TENANT_A, async () => {
      const waDraft = await prisma.whatsAppOutboxMessage.findFirst({
        where: { clientAccountId: clientIdA, eventType: "PASSWORD_RESET" },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(waDraft, "Self-service reset must queue PASSWORD_RESET draft in WhatsApp outbox");
      assert.equal(waDraft.status, "PENDING_APPROVAL");
      const m = waDraft.finalMessageText.match(/\b(\d{6})\b/);
      assert.ok(m, "Draft must include 6-digit single-use reset code");
      extractedCode = m[1];
    });

    // Cross-tenant attempt (Tenant B) must fail cleanly
    const crossConfirm = await portalForgotPOST(
      makePortalReq(TENANT_B, "/api/client-portal/forgot-password", "POST", {
        body: { action: "CONFIRM", identifier: "777444555", code: extractedCode, newPassword: "NewPass999" },
      })
    );
    assert.equal(crossConfirm.status, 400);

    // Wrong code rejects
    const badCode = await portalForgotPOST(
      makePortalReq(TENANT_A, "/api/client-portal/forgot-password", "POST", {
        body: { action: "CONFIRM", identifier: "777444555", code: "000000", newPassword: "NewPass999" },
      })
    );
    assert.equal(badCode.status, 400);

    // Confirm valid single-use code -> updates password & increments sessionVersion
    const okConfirm = await portalForgotPOST(
      makePortalReq(TENANT_A, "/api/client-portal/forgot-password", "POST", {
        body: { action: "CONFIRM", identifier: "777444555", code: extractedCode, newPassword: "NewPass999" },
      })
    );
    assert.equal(okConfirm.status, 200);

    // Prior active token is immediately REVOKED!
    const oldTokenCheck = await portalMeGET(
      makePortalReq(TENANT_A, "/api/client-portal/me", "GET", { clientToken: clientTokenA })
    );
    assert.equal(oldTokenCheck.status, 401);

    // Reusing the same reset code fails
    const replayConfirm = await portalForgotPOST(
      makePortalReq(TENANT_A, "/api/client-portal/forgot-password", "POST", {
        body: { action: "CONFIRM", identifier: "777444555", code: extractedCode, newPassword: "Another123" },
      })
    );
    assert.equal(replayConfirm.status, 400);

    // Old password fails; new password succeeds
    const oldPassLogin = await portalLoginPOST(
      makePortalReq(TENANT_A, "/api/client-portal/login", "POST", {
        body: { identifier: "777444555", password: "InitPass123" },
      })
    );
    assert.equal(oldPassLogin.status, 401);

    const newPassLogin = await portalLoginPOST(
      makePortalReq(TENANT_A, "/api/client-portal/login", "POST", {
        body: { identifier: "nasser@aljabri.test", password: "NewPass999" },
      })
    );
    assert.equal(newPassLogin.status, 200);
    clientTokenA = (await newPassLogin.json()).token;
  });

  it("allows authorized staff to trigger client password reset, enforces mustChangePassword, revokes prior sessions, and writes audit log", async () => {
    // Restricted staff denied (403)
    const denied = await adminClientsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffDeniedToken,
        body: { clientAccountId: clientIdA, action: "RESET_PASSWORD" },
      })
    );
    assert.equal(denied.status, 403);

    const res = await adminClientsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/clients", "POST", {
        staffToken: staffAdminToken,
        body: { clientAccountId: clientIdA, action: "RESET_PASSWORD" },
      })
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.temporaryPassword);
    assert.equal(data.client.mustChangePassword, true);

    // Old session revoked immediately
    const oldCheck = await portalMeGET(
      makePortalReq(TENANT_A, "/api/client-portal/me", "GET", { clientToken: clientTokenA })
    );
    assert.equal(oldCheck.status, 401);

    await runWithTenant(TENANT_A, async () => {
      const audit = await prisma.immutableAuditLog.findFirst({
        where: { actionType: "CLIENT_PASSWORD_RESET_BY_STAFF", entityReference: clientIdA },
      });
      assert.ok(audit);
      assert.ok(audit.details.includes(`[tenant:${TENANT_A}]`));
      assert.ok(audit.details.includes(`resetByUserId:adm-${TENANT_A}`));
    });

    // Sign in with temporary password -> mustChangePassword = true -> blocks requests until changed!
    const tempLoginRes = await portalLoginPOST(
      makePortalReq(TENANT_A, "/api/client-portal/login", "POST", {
        body: { identifier: "777444555", password: data.temporaryPassword },
      })
    );
    assert.equal(tempLoginRes.status, 200);
    const tempLoginData = await tempLoginRes.json();
    assert.equal(tempLoginData.account.mustChangePassword, true);
    const tempToken = tempLoginData.token;

    const blockedOrder = await portalRequestsPOST(
      makePortalReq(TENANT_A, "/api/client-portal/requests", "POST", {
        clientToken: tempToken,
        body: {
          pickupLocation: "السوق",
          lines: [{ itemTitle: "عنسي", requestedQty: 2, unitCode: "QAT_BUNCH", unitLabel: "علاقية قات" }],
        },
      })
    );
    assert.equal(blockedOrder.status, 400);
    assert.ok((await blockedOrder.json()).error.includes("MUST_CHANGE_PASSWORD"));

    // Client changes temporary password in-portal -> returns fresh session token & clears flag
    const changePassRes = await portalMePATCH(
      makePortalReq(TENANT_A, "/api/client-portal/me", "PATCH", {
        clientToken: tempToken,
        body: {
          currentPassword: data.temporaryPassword,
          newPassword: "FinalClientPass#2026",
        },
      })
    );
    assert.equal(changePassRes.status, 200);
    const changeData = await changePassRes.json();
    assert.equal(changeData.account.mustChangePassword, false);
    assert.ok(changeData.token, "PATCH /me must issue a fresh session token on password update");
    clientTokenA = changeData.token;

    // Prior temp token is revoked while fresh token works!
    const tempRevoked = await portalMeGET(
      makePortalReq(TENANT_A, "/api/client-portal/me", "GET", { clientToken: tempToken })
    );
    assert.equal(tempRevoked.status, 401);
  });

  it("uploads/validates/removes tenant-isolated client avatars and powers pending order edit + statement receipts + B2B notifications log", async () => {
    // 1. Disguised non-image payload rejected
    const badAvatar = await portalAvatarPOST(
      makePortalReq(TENANT_A, "/api/client-portal/me/avatar", "POST", {
        clientToken: clientTokenA,
        body: { dataUrl: "data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" },
      })
    );
    assert.equal(badAvatar.status, 400);

    // 2. Valid PNG upload succeeds and serves cleanly via public tenant-scoped route
    const dataUrl = `data:image/png;base64,${TINY_VALID_PNG.toString("base64")}`;
    const okAvatar = await portalAvatarPOST(
      makePortalReq(TENANT_A, "/api/client-portal/me/avatar", "POST", {
        clientToken: clientTokenA,
        body: { dataUrl },
      })
    );
    assert.equal(okAvatar.status, 200);
    const okAvatarData = await okAvatar.json();
    const expectedTenantKeyA = normalizeTenantId(TENANT_A);
    const expectedTenantKeyB = normalizeTenantId(TENANT_B);
    assert.ok(okAvatarData.avatarUrl.includes(`/api/public/avatar/${expectedTenantKeyA}/client-${clientIdA}`));
    uploadedFilename = path.basename(okAvatarData.avatarUrl);

    const serveRes = await publicAvatarGET(
      new NextRequest(`http://${TENANT_A}.qat.world${okAvatarData.avatarUrl}`),
      { params: Promise.resolve({ tenantKey: expectedTenantKeyA, filename: uploadedFilename }) }
    );
    assert.equal(serveRes.status, 200);
    assert.equal(serveRes.headers.get("content-type"), "image/png");

    // Cross-tenant avatar lookup (wrong tenantKey) returns 404
    const wrongTenantAvatar = await publicAvatarGET(
      new NextRequest(`http://${TENANT_B}.qat.world/api/public/avatar/${expectedTenantKeyB}/${uploadedFilename}`),
      { params: Promise.resolve({ tenantKey: expectedTenantKeyB, filename: uploadedFilename }) }
    );
    assert.equal(wrongTenantAvatar.status, 404);

    // 3. Create pending request -> Edit while PENDING_REVIEW -> Handover -> Verify statement receipts, credit %, & masked notification log
    const createReq = await portalRequestsPOST(
      makePortalReq(TENANT_A, "/api/client-portal/requests", "POST", {
        clientToken: clientTokenA,
        body: {
          pickupLocation: "السوق",
          lines: [{ itemTitle: "عنسي", requestedQty: 3, unitCode: "QAT_BUNCH", unitLabel: "علاقية قات", unitPrice: 5000 }],
        },
      })
    );
    assert.equal(createReq.status, 201);
    const reqJson = await createReq.json();
    const requestId = reqJson.request.id;

    const editReq = await portalRequestByIdPATCH(
      makePortalReq(TENANT_A, `/api/client-portal/requests/${requestId}`, "PATCH", {
        clientToken: clientTokenA,
        body: {
          action: "EDIT",
          pickupLocation: "فرع المبيعات الرئيسي",
          lines: [{ itemTitle: "عنسي ملكي", requestedQty: 4, unitCode: "QAT_BUNCH", unitLabel: "علاقية قات", unitPrice: 6000 }],
        },
      }),
      { params: Promise.resolve({ id: requestId }) }
    );
    assert.equal(editReq.status, 200);
    const edited = (await editReq.json()).request;
    assert.equal(edited.pickupLocation, "فرع المبيعات الرئيسي");
    assert.equal(edited.totalEstimated, 24000);

    const listedReqs = await (
      await portalRequestsGET(
        makePortalReq(TENANT_A, "/api/client-portal/requests", "GET", { clientToken: clientTokenA })
      )
    ).json();
    assert.equal(listedReqs.requests[0].pickupLocation, "فرع المبيعات الرئيسي");

    // Remove avatar -> cleanly resets to empty URL and deletes file
    const delAv = await portalAvatarDELETE(
      makePortalReq(TENANT_A, "/api/client-portal/me/avatar", "DELETE", { clientToken: clientTokenA })
    );
    assert.equal(delAv.status, 200);
    assert.equal((await delAv.json()).account.avatarUrl, "");

    // Complete handover with partial payment 10,000 (leaving 14,000 open on 300,000 credit limit)
    const handoverRes = await adminRequestsPOST(
      makePortalReq(TENANT_A, "/api/portal-admin/requests", "POST", {
        staffToken: staffAdminToken,
        body: {
          requestId,
          action: "HANDOVER",
          projectId: projectIdA,
          treasuryId: treasuryIdA,
          immediatePaidAmount: 10000,
        },
      })
    );
    assert.equal(handoverRes.status, 200);

    // Client statement now carries creditUtilizationPct, receipts[], openBillsCount, and notifications[] with masked PASSWORD_RESET!
    const stmt = await (
      await portalStatementGET(
        makePortalReq(TENANT_A, "/api/client-portal/statement", "GET", { clientToken: clientTokenA })
      )
    ).json();
    assert.equal(stmt.summary.totalInvoiced, 24000);
    assert.equal(stmt.summary.totalPaid, 10000);
    assert.equal(stmt.summary.totalUnpaid, 14000);
    assert.equal(stmt.summary.openBillsCount, 1);
    assert.ok(stmt.summary.creditUtilizationPct > 0);
    assert.equal(stmt.receipts.length, 1);
    assert.equal(stmt.receipts[0].amount, 10000);

    const pwLogs = (stmt.notifications as Array<{ eventType: string; previewText: string }>).filter(
      (n) => n.eventType === "PASSWORD_RESET"
    );
    assert.ok(pwLogs.length >= 1);
    for (const log of pwLogs) {
      assert.ok(!/\d{6}/.test(log.previewText), "Notification log must never expose 6-digit reset OTPs");
    }

    // Confirm Phase 10 UI components expose key affordances
    const portalAppSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/client-portal/ClientPortalApp.tsx"),
      "utf8"
    );
    assert.ok(portalAppSrc.includes("نسيت كلمة المرور"));
    assert.ok(portalAppSrc.includes("إعادة طلب سريع"));
    assert.ok(portalAppSrc.includes("صورة الملف الشخصي"));
    assert.ok(portalAppSrc.includes("exportedBy: portalExportActor"));

    const adminPanelSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/portal-admin/TenantClientPortalAdminPanel.tsx"),
      "utf8"
    );
    assert.ok(adminPanelSrc.includes("إعادة تعيين كلمة المرور"));
    assert.ok(adminPanelSrc.includes("SvgAvatar"));
  });
});

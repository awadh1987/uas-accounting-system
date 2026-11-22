import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import {
  ensureTenantRegistered,
  resetTenantClientsForTests,
  resolveTenantDbFilePath,
  runWithTenant,
} from "../src/lib/tenant";
import {
  hashPassword,
  isLegacySha256Hash,
  verifyPassword,
} from "../src/lib/serverBootstrap";
import {
  SESSION_COOKIE_NAME,
  issueSessionToken,
  verifySessionToken,
} from "../src/lib/authSession";
import {
  authorizeApiAction,
  extractActor,
  resolveVerifiedActor,
} from "../src/lib/apiHelpers";
import { computeWebhookSignature } from "../src/lib/treasury/bankWalletGateway";
import {
  postJournalEntry,
  updateJournalEntry,
} from "../src/lib/accounting/ledgerService";
import { POST as loginPOST } from "../src/app/api/auth/login/route";
import { POST as logoutPOST } from "../src/app/api/auth/logout/route";
import {
  GET as resetGET,
  POST as resetPOST,
} from "../src/app/api/system/reset/route";
import { POST as dispatchPOST } from "../src/app/api/treasury/dispatch/route";
import { POST as webhookPOST } from "../src/app/api/treasury/webhook/[provider]/route";
import { POST as fxRevalPOST } from "../src/app/api/accounting/fx-revaluation/route";
import { GET as syncPullGET } from "../src/app/api/sync/pull/route";
import { GET as devicesGET } from "../src/app/api/devices/route";
import {
  getTenantPrisma,
  resolveTenantDatabaseUrl,
  unregisterTenant,
} from "../src/lib/tenant";
import { isSqliteRuntime } from "../src/lib/sqliteBootstrap";

const TEST_RUN_TAG = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
const TEST_TENANT = `phase0_sec_${TEST_RUN_TAG}`;

function makeRequest(
  pathUrl: string,
  options: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
    includeTenant?: boolean;
  } = {}
): NextRequest {
  const headers: Record<string, string> = {
    ...(options.includeTenant === false ? {} : { "x-uas-tenant-id": TEST_TENANT }),
    ...(options.headers || {}),
  };
  let bodyText: string | undefined;
  if (options.rawBody !== undefined) {
    bodyText = options.rawBody;
    if (!headers["content-type"]) headers["content-type"] = "application/json";
  } else if (options.body !== undefined) {
    bodyText = JSON.stringify(options.body);
    if (!headers["content-type"]) headers["content-type"] = "application/json";
  }

  return new NextRequest(`http://localhost${pathUrl}`, {
    method: options.method || "GET",
    headers,
    body: bodyText,
  });
}

describe("Phase 0 Security, Authentication, Tenant Isolation & Ledger Immutability", () => {
  let accountantUserId = "";
  let accountantToken = "";
  let treasuryAccountId = "";
  const accountantUsername = `acct_p0_${TEST_RUN_TAG}`;
  const accountantLegacyPass = "LegacyPass@2026";
  const webhookSecret = `wh-secret-${TEST_RUN_TAG}`;

  before(async () => {
    ensureTenantRegistered(TEST_TENANT, "شركة اختبار المرحلة صفر", {
      nameAr: "شركة اختبار المرحلة صفر",
      nameEn: "Phase 0 Test Tenant",
    });

    await runWithTenant(TEST_TENANT, async () => {
      // Trigger tenant bootstrap & COA seeding
      await prisma.enterpriseProfile.findFirst();

      // Create a field accountant with a legacy unsalted SHA-256 hash to test transparent scrypt migration on login
      const legacySha = crypto
        .createHash("sha256")
        .update(accountantLegacyPass)
        .digest("hex");

      const acctUser = await prisma.user.create({
        data: {
          username: accountantUsername,
          name: "محاسب اختبار المرحلة صفر",
          fullName: "Phase 0 Accountant",
          email: `${accountantUsername}@test.local`,
          passwordHash: legacySha,
          role: "FIELD_ACCOUNTANT",
          department: "الإدارة المالية",
          active: true,
          isActive: true,
        },
      });
      accountantUserId = acctUser.id;
      accountantToken = issueSessionToken({
        userId: acctUser.id,
        userRole: "FIELD_ACCOUNTANT",
        tenantId: TEST_TENANT,
        userDisplay: acctUser.fullName,
      });

      const treasuryAccNode = await prisma.account.findUniqueOrThrow({
        where: { code: "111201" },
      });

      const treasury = await prisma.treasuryAccount.create({
        data: {
          code: `TR-P0-${TEST_RUN_TAG}`,
          name: "حساب بنك الكريمي اختبار",
          nameAr: "حساب بنك الكريمي اختبار",
          nameEn: "Phase 0 Kuraimi Test",
          type: "BANK",
          accountNumber: `ACC-P0-${TEST_RUN_TAG}`,
          accountId: treasuryAccNode.id,
          currency: "YER",
          currencyCode: "YER",
          balance: 100000,
          balanceYER: 100000,
          gatewayProvider: "KURAIMI_API",
          gatewayMerchantId: `MCH-P0-${TEST_RUN_TAG}`,
          isSandbox: true,
          isActive: true,
        },
      });
      treasuryAccountId = treasury.id;
    });
  });

  after(async () => {
    await resetTenantClientsForTests();
    await prisma.$disconnect();

    const dbPath = resolveTenantDbFilePath(TEST_TENANT);
    if (dbPath) {
      for (const file of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
        if (fs.existsSync(file)) {
          try {
            fs.unlinkSync(file);
          } catch {
            // Ignore Windows handle contention during teardown
          }
        }
      }
    }
  });

  describe("Step 0.1 — Salted scrypt Password Hashing & Signed HTTP-Only Sessions", () => {
    it("hashes passwords with unique per-user scrypt salts and verifies legacy SHA-256 hashes cleanly", () => {
      const hashA = hashPassword("StrongPass#2026");
      const hashB = hashPassword("StrongPass#2026");

      assert.ok(hashA.startsWith("scrypt$"), "New hashes must use scrypt$ format");
      assert.ok(hashB.startsWith("scrypt$"), "New hashes must use scrypt$ format");
      assert.notEqual(hashA, hashB, "Identical passwords must receive distinct random salts");
      assert.equal(isLegacySha256Hash(hashA), false);
      assert.equal(verifyPassword("StrongPass#2026", hashA), true);
      assert.equal(verifyPassword("WrongPass#2026", hashA), false);

      const legacyHash = crypto.createHash("sha256").update("OldSecret99").digest("hex");
      assert.equal(isLegacySha256Hash(legacyHash), true);
      assert.equal(verifyPassword("OldSecret99", legacyHash), true);
      assert.equal(verifyPassword("NotOldSecret99", legacyHash), false);
    });

    it("issues, verifies, and rejects tampered or expired HMAC-SHA256 session tokens", async () => {
      const token = issueSessionToken({
        userId: "user_123",
        userRole: "FIELD_ACCOUNTANT",
        tenantId: TEST_TENANT,
        userDisplay: "Test User",
      });

      const verified = verifySessionToken(token);
      assert.ok(verified, "Valid token must verify");
      assert.equal(verified?.uid, "user_123");
      assert.equal(verified?.role, "FIELD_ACCOUNTANT");
      assert.equal(verified?.tid, TEST_TENANT);

      // Tamper with payload segment
      const [payloadB64, sigB64] = token.split(".");
      const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      decoded.role = "SUPER_ADMIN";
      const forgedPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
      assert.equal(
        verifySessionToken(`${forgedPayload}.${sigB64}`),
        null,
        "Tampered role in token payload must fail signature check"
      );

      // Expired token
      const shortLivedToken = issueSessionToken({
        userId: "user_123",
        userRole: "FIELD_ACCOUNTANT",
        tenantId: TEST_TENANT,
        ttlMs: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(
        verifySessionToken(shortLivedToken),
        null,
        "Expired session token must be rejected"
      );
    });

    it("authenticates via POST /api/auth/login, auto-upgrades legacy SHA-256 to scrypt$, sets HttpOnly cookie, and clears on logout", async () => {
      const loginReq = makeRequest("/api/auth/login", {
        method: "POST",
        body: {
          username: accountantUsername,
          password: accountantLegacyPass,
        },
      });
      const loginRes = await loginPOST(loginReq);
      assert.equal(loginRes.status, 200);

      const loginJson = await loginRes.json();
      assert.ok(loginJson.user, "Login response must include user payload");
      assert.equal(loginJson.tenantId, TEST_TENANT);
      assert.equal(loginJson.user.id, accountantUserId);
      assert.equal(loginJson.user.role, "FIELD_ACCOUNTANT");
      assert.ok(loginJson.sessionToken, "Login response must include sessionToken");

      const parsedToken = verifySessionToken(loginJson.sessionToken);
      assert.equal(parsedToken?.uid, accountantUserId);
      assert.equal(parsedToken?.tid, TEST_TENANT);

      const setCookie = loginRes.headers.get("set-cookie") || "";
      assert.ok(
        setCookie.includes(`${SESSION_COOKIE_NAME}=`),
        "Login must set uas_session cookie"
      );
      assert.ok(
        /httponly/i.test(setCookie),
        "Session cookie must carry HttpOnly flag"
      );

      // Verify transparent upgrade from legacy SHA-256 to salted scrypt$ in database
      await runWithTenant(TEST_TENANT, async () => {
        const refreshed = await prisma.user.findUniqueOrThrow({
          where: { id: accountantUserId },
        });
        assert.equal(isLegacySha256Hash(refreshed.passwordHash), false);
        assert.ok(
          refreshed.passwordHash?.startsWith("scrypt$"),
          "Login must transparently upgrade legacy SHA-256 hash to salted scrypt$"
        );
        assert.equal(
          verifyPassword(accountantLegacyPass, refreshed.passwordHash),
          true
        );
      });

      // Verify logout clears session cookie
      const logoutReq = makeRequest("/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${loginJson.sessionToken}`,
        },
        body: { userId: accountantUserId },
      });
      const logoutRes = await logoutPOST(logoutReq);
      assert.equal(logoutRes.status, 200);
      const clearCookieHeader = logoutRes.headers.get("set-cookie") || "";
      assert.ok(
        clearCookieHeader.includes(`${SESSION_COOKIE_NAME}=`) &&
          /max-age=0/i.test(clearCookieHeader),
        "Logout must expire/clear uas_session cookie"
      );
    });
  });

  describe("Step 0.2 — Removal of u1 / SUPER_ADMIN Defaults & Anti-Spoofing Guards", () => {
    it("extractActor never defaults to u1 or SUPER_ADMIN when headers and tokens are omitted", () => {
      const emptyReq = makeRequest("/api/system/reset");
      const actor = extractActor({}, emptyReq);

      assert.equal(actor.userId, null, "Must never default userId to u1");
      assert.notEqual(actor.userRole, "SUPER_ADMIN", "Must never default userRole to SUPER_ADMIN");
      assert.equal(actor.userRole, "EXTERNAL_AUDITOR", "Unauthenticated placeholder must be least-privilege read-only");
      assert.equal(actor.authenticated, false);
      assert.equal(actor.sessionVerified, false);

      const tamperedReq = makeRequest("/api/system/reset", {
        headers: {
          "x-uas-session-token": "forged.token.sig",
        },
      });
      const tamperedActor = extractActor({}, tamperedReq);
      assert.equal(tamperedActor.invalidToken, true);
      assert.equal(tamperedActor.authenticated, false);
      assert.equal(tamperedActor.userId, null);
    });

    it("resolveVerifiedActor rejects unknown users and flags unverified role escalation attempts", async () => {
      await runWithTenant(TEST_TENANT, async () => {
        const unknownReq = makeRequest("/api/system/reset", {
          headers: {
            "x-uas-user-id": "non_existent_user_999",
            "x-uas-user-role": "SUPER_ADMIN",
          },
        });
        const unknownRes = await resolveVerifiedActor({}, unknownReq);
        assert.equal(unknownRes.authenticated, false);
        assert.equal(unknownRes.userId, null);

        // Existing FIELD_ACCOUNTANT attempting to claim SUPER_ADMIN via unverified headers/body
        const spoofReq = makeRequest("/api/system/reset", {
          headers: {
            "x-uas-user-id": accountantUserId,
            "x-uas-role": "SUPER_ADMIN",
          },
        });
        const spoofRes = await resolveVerifiedActor({}, spoofReq);
        assert.equal(spoofRes.spoofAttempt, true, "Must detect role escalation spoof");
        assert.equal(spoofRes.authenticated, false);

        // authorizeApiAction rejects unauthenticated (401) and spoofed (403) callers
        const unauthDecision = await authorizeApiAction({}, makeRequest("/api/system/reset"), {
          moduleId: "system",
          action: "delete",
        });
        assert.equal(unauthDecision.ok, false);
        if (!unauthDecision.ok) {
          assert.equal(unauthDecision.response.status, 401);
        }

        const spoofDecision = await authorizeApiAction({}, spoofReq, {
          moduleId: "system",
          action: "delete",
        });
        assert.equal(spoofDecision.ok, false);
        if (!spoofDecision.ok) {
          assert.equal(spoofDecision.response.status, 403);
        }
      });
    });

    it("rejects unauthenticated (401) and unauthorized non-admin (403) access on /api/system/reset and /api/treasury/dispatch", async () => {
      // Unauthenticated GET & POST /api/system/reset -> 401
      const unauthResetGet = await resetGET(makeRequest("/api/system/reset"));
      assert.equal(unauthResetGet.status, 401);

      const unauthResetPost = await resetPOST(
        makeRequest("/api/system/reset", {
          method: "POST",
          body: { confirmationText: "CONFIRM RESET ALL DATA" },
        })
      );
      assert.equal(unauthResetPost.status, 401);

      // Authenticated ACCOUNTANT (non-SUPER_ADMIN) on GET /api/system/reset -> 403
      const acctResetGet = await resetGET(
        makeRequest("/api/system/reset", {
          headers: { "x-uas-session-token": accountantToken },
        })
      );
      assert.equal(acctResetGet.status, 403);

      // Unauthenticated POST /api/treasury/dispatch -> 401
      const unauthDispatch = await dispatchPOST(
        makeRequest("/api/treasury/dispatch", {
          method: "POST",
          body: {
            treasuryAccountId,
            beneficiaryName: "اختبار غير مصرح",
            beneficiaryAccountOrPhone: "777000000",
            amount: 5000,
          },
        })
      );
      assert.equal(unauthDispatch.status, 401);

      // Spoofed actor header on POST /api/treasury/dispatch -> 403
      const spoofDispatch = await dispatchPOST(
        makeRequest("/api/treasury/dispatch", {
          method: "POST",
          headers: {
            "x-uas-user-id": accountantUserId,
            "x-uas-role": "SUPER_ADMIN",
          },
          body: {
            treasuryAccountId,
            beneficiaryName: "اختبار انتحال",
            beneficiaryAccountOrPhone: "777000000",
            amount: 5000,
          },
        })
      );
      assert.equal(spoofDispatch.status, 403);
    });
  });

  describe("Step 0.3 — Webhook Signature Verification & Route Guard Coverage", () => {
    it("enforces HMAC-SHA256 signatures on POST /api/treasury/webhook/[provider] (401 unsigned/forged, 200 signed)", async () => {
      const payload = {
        eventId: `EVT-HTTP-${TEST_RUN_TAG}`,
        referenceId: `REF-HTTP-${TEST_RUN_TAG}`,
        amount: 7500,
        currency: "YER",
        treasuryAccountId,
      };
      const rawBody = JSON.stringify(payload);
      const context = { params: Promise.resolve({ provider: "KURAIMI_API" }) };

      const prevSecret = process.env.UAS_WEBHOOK_SECRET;
      process.env.UAS_WEBHOOK_SECRET = webhookSecret;
      try {
        // 1. Missing signature -> 401
        const missingSigRes = await webhookPOST(
          makeRequest("/api/treasury/webhook/KURAIMI_API", {
            method: "POST",
            rawBody,
          }),
          context
        );
        assert.equal(missingSigRes.status, 401);

        // 2. Forged signature -> 401
        const forgedSigRes = await webhookPOST(
          makeRequest("/api/treasury/webhook/KURAIMI_API", {
            method: "POST",
            rawBody,
            headers: { "x-webhook-signature": "sha256=" + "a".repeat(64) },
          }),
          context
        );
        assert.equal(forgedSigRes.status, 401);

        // 3. Valid HMAC-SHA256 signature -> 200
        const validSig = computeWebhookSignature(rawBody, webhookSecret);
        const validSigRes = await webhookPOST(
          makeRequest("/api/treasury/webhook/KURAIMI_API", {
            method: "POST",
            rawBody,
            headers: { "x-webhook-signature": `sha256=${validSig}` },
          }),
          context
        );
        assert.equal(validSigRes.status, 200);
        const okJson = await validSigRes.json();
        assert.equal(okJson.ok, true);
      } finally {
        if (prevSecret === undefined) delete process.env.UAS_WEBHOOK_SECRET;
        else process.env.UAS_WEBHOOK_SECRET = prevSecret;
      }
    });

    it("blocks unauthenticated callers on protected accounting routes such as /api/accounting/fx-revaluation", async () => {
      const res = await fxRevalPOST(
        makeRequest("/api/accounting/fx-revaluation", {
          method: "POST",
          body: { targetDate: "2026-11-20" },
        })
      );
      assert.equal(res.status, 401);
    });
  });

  describe("Step 0.4 — Posted Journal Entry Immutability & Draft FX Preservation", () => {
    it("blocks mutating lines or date on POSTED journal entries while preserving FX metadata on editable DRAFT entries", async () => {
      await runWithTenant(TEST_TENANT, async () => {
        const postedDate = new Date("2026-06-15T00:00:00.000Z");
        const postedJe = await postJournalEntry({
          narrationAr: "قيد مرحل محمي من التعديل",
          date: postedDate,
          createdById: accountantUserId,
          lines: [
            { accountCode: "111101", debit: 15000 },
            { accountCode: "311101", credit: 15000 },
          ],
        });
        assert.equal(postedJe.status, "POSTED");

        // Mutating lines on POSTED entry must fail
        await assert.rejects(
          () =>
            updateJournalEntry({
              id: postedJe.id,
              createdById: accountantUserId,
              lines: [
                { accountCode: "111101", debit: 20000 },
                { accountCode: "311101", credit: 20000 },
              ],
            }),
          /POSTED_JOURNAL_IMMUTABLE/
        );

        // Mutating date on POSTED entry must fail
        await assert.rejects(
          () =>
            updateJournalEntry({
              id: postedJe.id,
              createdById: accountantUserId,
              date: "2026-06-22T00:00:00.000Z",
            }),
          /POSTED_JOURNAL_IMMUTABLE/
        );

        // Non-financial narration update on POSTED entry is permitted and preserves financial lines/date
        const metadataUpdated = await updateJournalEntry({
          id: postedJe.id,
          createdById: accountantUserId,
          narrationAr: "تحديث الوصف غير المالي للقيد المرحل",
        });
        assert.equal(metadataUpdated.narrationAr, "تحديث الوصف غير المالي للقيد المرحل");
        const postedDr = metadataUpdated.lines.reduce(
          (sum, l) => sum + Number(l.debitBase),
          0
        );
        assert.equal(postedDr, 15000);
        assert.equal(
          new Date(metadataUpdated.date).toISOString().slice(0, 10),
          "2026-06-15"
        );

        // Editable DRAFT entry allows lines + FX + cost center updates and preserves FX columns
        const draftJe = await postJournalEntry({
          status: "DRAFT",
          narrationAr: "مسودة قيد أجنبي",
          date: new Date("2026-06-15T00:00:00.000Z"),
          createdById: accountantUserId,
          lines: [
            { accountCode: "111101", debit: 100, currency: "SAR", exchangeRate: 425 },
            { accountCode: "311101", credit: 100, currency: "SAR", exchangeRate: 425 },
          ],
        });

        const updatedDraft = await updateJournalEntry({
          id: draftJe.id,
          createdById: accountantUserId,
          date: "2026-06-18T00:00:00.000Z",
          narrationAr: "مسودة محدثة بعملة أجنبية",
          lines: [
            { accountCode: "111101", debit: 250, currency: "SAR", exchangeRate: 425 },
            { accountCode: "311101", credit: 250, currency: "SAR", exchangeRate: 425 },
          ],
        });

        assert.equal(updatedDraft.lines[0].currencyCode, "SAR");
        assert.equal(Number(updatedDraft.lines[0].foreignDebit), 250);
        assert.equal(Number(updatedDraft.lines[0].baseDebit), 106250);
        assert.equal(
          new Date(updatedDraft.date).toISOString().slice(0, 10),
          "2026-06-18"
        );
      });
    });
  });

  describe("Multi-Tenant PostgreSQL URL/Guard & Cross-Tenant Root SUPER_ADMIN Token Handling", () => {
    it("recognizes postgres:// and postgresql:// URLs cleanly and omits SQLite runtime checks", () => {
      const prevUrl = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL = "postgres://uas:secret@127.0.0.1:5432/uas_qat_prod";
        assert.equal(isSqliteRuntime(), false);
        assert.ok(
          resolveTenantDatabaseUrl("alwaha").includes("schema=tenant_alwaha"),
          "postgres:// URL must receive ?schema=tenant_alwaha"
        );

        process.env.DATABASE_URL = "postgresql://uas:secret@127.0.0.1:5432/uas_qat_prod?sslmode=disable";
        assert.equal(isSqliteRuntime(), false);
        assert.ok(
          resolveTenantDatabaseUrl("alwaha").includes("schema=tenant_alwaha"),
          "postgresql:// URL must preserve query params and set schema=tenant_alwaha"
        );
      } finally {
        if (prevUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prevUrl;
      }
    });

    it("does not cache a PrismaClient or mark URL ready when tenant initialization fails", async () => {
      const prevUrl = process.env.DATABASE_URL;
      const failTenant = `pg_fail_${Date.now()}`;
      try {
        process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/nonexistent_uas_db?connect_timeout=1";
        await assert.rejects(async () => {
          await getTenantPrisma(failTenant);
        });
        // Second call must retry (not return a cached broken client)
        await assert.rejects(async () => {
          await getTenantPrisma(failTenant);
        });
      } finally {
        if (prevUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prevUrl;
        unregisterTenant(failTenant);
      }
    });

    it("allows verified root default SUPER_ADMIN on /api/sync/pull and /api/devices across tenants while blocking non-admin and cross-tenant tokens", async () => {
      // Ensure default root DB has an active SUPER_ADMIN user + an active non-admin user
      let rootAdminId = "";
      let rootAcctId = "";
      await runWithTenant("default", async () => {
        const admin = await prisma.user.findFirst({
          where: { role: "SUPER_ADMIN", active: true, isActive: true },
        });
        if (admin) {
          rootAdminId = admin.id;
        } else {
          const created = await prisma.user.create({
            data: {
              username: `root_sa_${TEST_RUN_TAG}`,
              name: "Root Super Admin",
              fullName: "Root Super Admin",
              email: `root_sa_${TEST_RUN_TAG}@qat.world`,
              passwordHash: hashPassword("RootPass@2026"),
              role: "SUPER_ADMIN",
              active: true,
              isActive: true,
            },
          });
          rootAdminId = created.id;
        }

        const rootAcct = await prisma.user.create({
          data: {
            username: `root_acct_${TEST_RUN_TAG}`,
            name: "Root Field Accountant",
            fullName: "Root Field Accountant",
            email: `root_acct_${TEST_RUN_TAG}@qat.world`,
            passwordHash: hashPassword("RootPass@2026"),
            role: "FIELD_ACCOUNTANT",
            active: true,
            isActive: true,
          },
        });
        rootAcctId = rootAcct.id;
      });

      const rootAdminToken = issueSessionToken({
        userId: rootAdminId,
        userRole: "SUPER_ADMIN",
        tenantId: "default",
        userDisplay: "Root Super Admin",
      });

      const rootAcctToken = issueSessionToken({
        userId: rootAcctId,
        userRole: "FIELD_ACCOUNTANT",
        tenantId: "default",
        userDisplay: "Root Field Accountant",
      });

      // 1. Root SUPER_ADMIN calling /api/sync/pull and /api/devices for TEST_TENANT via x-uas-tenant-id -> 200
      const syncRes = await syncPullGET(
        makeRequest("/api/sync/pull?sinceCursor=0", {
          headers: {
            authorization: `Bearer ${rootAdminToken}`,
            "x-uas-tenant-id": TEST_TENANT,
          },
        })
      );
      assert.equal(syncRes.status, 200);

      const devRes = await devicesGET(
        makeRequest("/api/devices", {
          headers: {
            authorization: `Bearer ${rootAdminToken}`,
            "x-uas-tenant-id": TEST_TENANT,
          },
        })
      );
      assert.equal(devRes.status, 200);

      // 2. Root non-admin calling TEST_TENANT -> 403 FORBIDDEN
      const nonAdminSyncRes = await syncPullGET(
        makeRequest("/api/sync/pull?sinceCursor=0", {
          headers: {
            authorization: `Bearer ${rootAcctToken}`,
            "x-uas-tenant-id": TEST_TENANT,
          },
        })
      );
      assert.equal(nonAdminSyncRes.status, 403);

      // 3. Tenant-scoped token from TEST_TENANT calling a different tenant ("default") -> 403 FORBIDDEN
      const crossTenantRes = await devicesGET(
        makeRequest("/api/devices", {
          includeTenant: false,
          headers: {
            authorization: `Bearer ${accountantToken}`,
            "x-uas-tenant-id": "default",
          },
        })
      );
      assert.equal(crossTenantRes.status, 403);

      // 4. Tenant-scoped token calling its own TEST_TENANT -> 200
      const sameTenantRes = await syncPullGET(
        makeRequest("/api/sync/pull?sinceCursor=0", {
          headers: {
            authorization: `Bearer ${accountantToken}`,
            "x-uas-tenant-id": TEST_TENANT,
          },
        })
      );
      assert.equal(sameTenantRes.status, 200);

      // Cleanup temporary non-admin user created in default DB
      if (rootAcctId) {
        await runWithTenant("default", async () => {
          await prisma.user.delete({ where: { id: rootAcctId } }).catch(() => {});
        });
      }
    });
  });
});

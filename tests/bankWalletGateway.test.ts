import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { ensure6GenerationCoaHierarchy } from "../src/lib/accountingCoreEngine";
import {
  executeBankOrWalletPayout,
  processInboundCollectionWebhook,
  computeWebhookSignature,
  verifyWebhookSignature,
  exportBulkBankTransferFile,
  autoReconcileStatementRows,
  SUPPORTED_GATEWAY_PROVIDERS,
} from "../src/lib/treasury/bankWalletGateway";
import {
  handleOfflineAndroidApiRequest,
  loadOfflineAndroidState,
  saveOfflineAndroidState,
  type OfflineStorageLike,
} from "../src/lib/offlineAndroidStore";

function createMemoryStorage(): OfflineStorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, val: string) => void store.set(key, val),
    removeItem: (key: string) => void store.delete(key),
  };
}

const TEST_RUN_TAG = `GW_${Date.now().toString().slice(-6)}`;
const actor = {
  userId: `usr_test_${TEST_RUN_TAG}`,
  userName: `Bank Tester ${TEST_RUN_TAG}`,
  role: "SUPER_ADMIN",
};

describe("Phase 1 — Bank & E-Wallet Gateway Engine Invariants", () => {
  let treasuryAccountId: string;
  let treasuryAccountCode: string;

  before(async () => {
    await ensure6GenerationCoaHierarchy();

    // Create a dedicated Treasury Account for testing
    treasuryAccountCode = `111299-${TEST_RUN_TAG}`;
    const parent = await prisma.account.findUnique({ where: { code: "111290" } });
    const acc = await prisma.account.create({
      data: {
        code: treasuryAccountCode,
        nameAr: `بنك الكريمي التجريبي ${TEST_RUN_TAG}`,
        nameEn: `Kuraimi Bank Test ${TEST_RUN_TAG}`,
        type: "ASSET",
        generation: 6,
        level: 6,
        parentCode: "111290",
        parentId: parent?.id || null,
        parentAccountId: parent?.id || null,
        isPosting: true,
        isPostable: true,
      },
    });

    const trs = await prisma.treasuryAccount.create({
      data: {
        code: `TRS-GW-${TEST_RUN_TAG}`,
        name: `حساب بنك الكريمي - رئيسي ${TEST_RUN_TAG}`,
        nameAr: `حساب بنك الكريمي - رئيسي ${TEST_RUN_TAG}`,
        nameEn: `Kuraimi Bank Account ${TEST_RUN_TAG}`,
        type: "BANK",
        accountNumber: `ACC-${TEST_RUN_TAG}`,
        currency: "YER",
        currencyCode: "YER",
        balance: 500000,
        balanceYER: 500000,
        dailyLimit: 100000,
        dailyUsedAmount: 0,
        transferFeePercent: 1.5,
        gatewayProvider: "KURAIMI_API",
        gatewayMerchantId: `MCH-${TEST_RUN_TAG}`,
        isSandbox: true,
        accountId: acc.id,
        isActive: true,
      },
    });
    treasuryAccountId = trs.id;
  });

  after(async () => {
    try {
      const dispatches = await prisma.bankPaymentDispatch.findMany({
        where: { treasuryAccountId },
        select: { journalEntryId: true },
      });
      const jeIds = dispatches.map((d) => d.journalEntryId).filter(Boolean) as string[];

      await prisma.bankPaymentDispatch.deleteMany({
        where: { treasuryAccountId },
      });
      await prisma.treasuryAccount.deleteMany({
        where: { id: treasuryAccountId },
      });
      if (jeIds.length > 0) {
        await prisma.journalEntryLine.deleteMany({
          where: { journalEntryId: { in: jeIds } },
        });
        await prisma.journalEntry.deleteMany({
          where: { id: { in: jeIds } },
        });
      }
      await prisma.journalEntryLine.deleteMany({
        where: { account: { code: treasuryAccountCode } },
      });
      await prisma.account.deleteMany({
        where: { code: treasuryAccountCode },
      });
    } catch {
      // Ignore cleanup constraint errors
    }
  });

  it("1. Verifies supported gateway providers list", () => {
    assert.ok(SUPPORTED_GATEWAY_PROVIDERS.includes("MANUAL"));
    assert.ok(SUPPORTED_GATEWAY_PROVIDERS.includes("KURAIMI_API"));
    assert.ok(SUPPORTED_GATEWAY_PROVIDERS.includes("JAWALI_API"));
    assert.ok(SUPPORTED_GATEWAY_PROVIDERS.includes("JEEB_API"));
    assert.ok(SUPPORTED_GATEWAY_PROVIDERS.includes("ONECASH_API"));
    assert.ok(SUPPORTED_GATEWAY_PROVIDERS.includes("FLOOSAK_API"));
    assert.ok(SUPPORTED_GATEWAY_PROVIDERS.includes("CUSTOM_WEBHOOK"));
  });

  it("2. Blocks payouts exceeding daily limit", async () => {
    // Daily limit is 100,000. Attempting 150,000 should fail
    await assert.rejects(
      async () => {
        await executeBankOrWalletPayout({
          treasuryAccountId,
          sourceVoucherType: "PAYMENT_VOUCHER",
          sourceVoucherId: "VCH-LIMIT-1",
          beneficiaryName: "أحمد علي",
          beneficiaryAccountOrPhone: "777111222",
          amount: 150000,
          currencyCode: "YER",
          idempotencyKey: `KEY-LIMIT-${Date.now()}`,
          actor,
        });
      },
      (err: Error) => {
        assert.ok(err.message.includes("DAILY_LIMIT_EXCEEDED"));
        return true;
      }
    );
  });

  it("3. Executes sandbox payout idempotently with fee calculation & balanced GL entry", async () => {
    const idemKey = `KEY-EXEC-${TEST_RUN_TAG}-001`;
    const payoutAmount = 20000;
    const feeExpected = 20000 * 0.015; // 300 YER (1.5%)
    const totalDeductExpected = 20000 + 300;

    const treasuryBefore = await prisma.treasuryAccount.findUniqueOrThrow({
      where: { id: treasuryAccountId },
    });
    const balanceBefore = treasuryBefore.balance;
    const dailyUsedBefore = treasuryBefore.dailyUsedAmount;

    // First execution
    const res1 = await executeBankOrWalletPayout({
      treasuryAccountId,
      sourceVoucherType: "PAYMENT_VOUCHER",
      sourceVoucherId: "VCH-EXEC-1",
      beneficiaryName: "محسن صالح السقاف",
      beneficiaryAccountOrPhone: "777888999",
      amount: payoutAmount,
      currencyCode: "YER",
      idempotencyKey: idemKey,
      actor,
    });

    assert.equal(res1.ok, true);
    assert.equal(res1.feeAmount, feeExpected);
    assert.equal(res1.totalDebited, totalDeductExpected);
    assert.ok(res1.externalReferenceId?.startsWith("KRM-SBX-"));
    assert.ok(res1.dispatch.id);
    assert.equal(res1.dispatch.status, "EXECUTED");

    // Verify GL Double-Entry balance
    const journalEntry: any = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: res1.journalEntryId || undefined },
      include: { lines: true },
    });
    const totalDebit = journalEntry.lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const totalCredit = journalEntry.lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    assert.equal(totalDebit, totalCredit, "GL entry must be perfectly balanced");
    assert.equal(totalDebit, totalDeductExpected);

    // Verify Treasury Balance updated
    const treasuryAfter1 = await prisma.treasuryAccount.findUniqueOrThrow({
      where: { id: treasuryAccountId },
    });
    assert.equal(Number(treasuryAfter1.balance), Number(balanceBefore) - totalDeductExpected);
    assert.equal(Number(treasuryAfter1.dailyUsedAmount), Number(dailyUsedBefore) + payoutAmount);

    // Repeat execution with exact same idempotency key -> Must return cached dispatch without re-executing
    const res2 = await executeBankOrWalletPayout({
      treasuryAccountId,
      sourceVoucherType: "PAYMENT_VOUCHER",
      sourceVoucherId: "VCH-EXEC-1",
      beneficiaryName: "محسن صالح السقاف",
      beneficiaryAccountOrPhone: "777888999",
      amount: payoutAmount,
      currencyCode: "YER",
      idempotencyKey: idemKey,
      actor,
    });

    assert.equal(res2.ok, true);
    assert.equal(res2.dispatch.id, res1.dispatch.id);
    assert.equal(res2.externalReferenceId, res1.externalReferenceId);

    // Treasury balance and daily used must remain unchanged
    const treasuryAfter2 = await prisma.treasuryAccount.findUniqueOrThrow({
      where: { id: treasuryAccountId },
    });
    assert.equal(Number(treasuryAfter2.balance), Number(treasuryAfter1.balance));
    assert.equal(Number(treasuryAfter2.dailyUsedAmount), Number(treasuryAfter1.dailyUsedAmount));
  });

  it("4. Resets daily counter when a new day arrives", async () => {
    // Manually simulate yesterday date
    await prisma.treasuryAccount.update({
      where: { id: treasuryAccountId },
      data: {
        dailyUsedAmount: 90000,
        lastDailyResetDate: "2026-01-01",
      },
    });

    // Payout of 30,000 would exceed limit if 90,000 wasn't reset (90k + 30k = 120k > 100k)
    // But since lastDailyResetDate is yesterday, dailyUsedAmount resets to 0 and allows payout
    const res = await executeBankOrWalletPayout({
      treasuryAccountId,
      sourceVoucherType: "PAYMENT_VOUCHER",
      sourceVoucherId: "VCH-RESET-1",
      beneficiaryName: "خالد سعيد",
      beneficiaryAccountOrPhone: "771234567",
      amount: 30000,
      currencyCode: "YER",
      idempotencyKey: `KEY-RESET-${Date.now()}`,
      actor,
    });

    assert.equal(res.ok, true);
    const updated = await prisma.treasuryAccount.findUniqueOrThrow({
      where: { id: treasuryAccountId },
    });
    assert.equal(Number(updated.dailyUsedAmount), 30000);
    assert.equal(updated.lastDailyResetDate, new Date().toISOString().slice(0, 10));
  });

  it("5. Handles inbound collection webhooks with deduplication", async () => {
    const eventId = `EVT-DEP-${TEST_RUN_TAG}-001`;
    const refId = `DEP-REF-${TEST_RUN_TAG}-001`;
    const initialBalance = (
      await prisma.treasuryAccount.findUniqueOrThrow({
        where: { id: treasuryAccountId },
      })
    ).balance;

    // First webhook delivery
    const hook1 = await processInboundCollectionWebhook({
      provider: "KURAIMI_API",
      payload: {
        eventId,
        referenceId: refId,
        customerPhone: "777999888",
        customerCode: "CUS-101",
        amount: 45000,
        currency: "YER",
        treasuryAccountId,
        notes: "سداد فاتورة مبيعات",
      },
    });

    assert.equal(hook1.ok, true);
    assert.ok(hook1.dispatchId);

    const balanceAfter1 = (
      await prisma.treasuryAccount.findUniqueOrThrow({
        where: { id: treasuryAccountId },
      })
    ).balance;
    assert.equal(Number(balanceAfter1), Number(initialBalance) + 45000);

    // Duplicate webhook delivery with exact same eventId/referenceId
    const hook2 = await processInboundCollectionWebhook({
      provider: "KURAIMI_API",
      payload: {
        eventId,
        referenceId: refId,
        customerPhone: "777999888",
        amount: 45000,
        currency: "YER",
        treasuryAccountId,
      },
    });

    assert.equal(hook2.ok, true);
    assert.equal(hook2.dispatchId, hook1.dispatchId);
    assert.ok(hook2.message?.includes("already processed"));

    // Balance must NOT increase a second time
    const balanceAfter2 = (
      await prisma.treasuryAccount.findUniqueOrThrow({
        where: { id: treasuryAccountId },
      })
    ).balance;
    assert.equal(Number(balanceAfter2), Number(balanceAfter1));
  });

  it("6. Exports bulk bank payout batch file in XLSX and CSV formats", () => {
    const items = [
      {
        beneficiaryName: "عمر خالد العريقي",
        accountOrPhone: "12345678",
        amount: 15000,
        currencyCode: "YER",
        reference: "VND-PAY-01",
        notes: "دفعة مورد",
      },
      {
        beneficiaryName: "طارق سليم",
        accountOrPhone: "777123987",
        amount: 25000,
        currencyCode: "YER",
        reference: "WRK-WAGE-01",
        notes: "أجور عمال",
      },
    ];

    const xlsxRes = exportBulkBankTransferFile({
      treasuryAccountId,
      treasuryName: "حساب بنك الكريمي",
      provider: "KURAIMI",
      items,
      format: "xlsx",
    });

    assert.ok(xlsxRes.filename.endsWith(".xlsx"));
    assert.equal(xlsxRes.count, 2);
    assert.equal(xlsxRes.totalAmount, 40000);
    assert.ok(xlsxRes.buffer.length > 0);

    const csvRes = exportBulkBankTransferFile({
      treasuryAccountId,
      treasuryName: "حساب بنك الكريمي",
      provider: "KURAIMI",
      items,
      format: "csv",
    });

    assert.ok(csvRes.filename.endsWith(".csv"));
    assert.equal(csvRes.count, 2);
    assert.equal(csvRes.totalAmount, 40000);
    assert.ok(csvRes.buffer.length > 0);
  });

  it("7. Auto-reconciles bank statement rows against UAS dispatches", async () => {
    // Find dispatches created in earlier tests
    const dispatches = await prisma.bankPaymentDispatch.findMany({
      where: { treasuryAccountId },
    });
    assert.ok(dispatches.length >= 2);

    const target1 = dispatches[0];
    const target2 = dispatches[1];

    const statementRows = [
      // 1. Matched by externalReferenceId
      {
        date: "2026-11-20",
        referenceId: target1.externalReferenceId || undefined,
        description: "تحويل بنكي صادر",
        debit: Number(target1.amount),
      },
      // 2. Matched by amount & date
      {
        date: "2026-11-20",
        referenceId: "BANK-STMT-UNKNOWN-REF",
        description: "حركة بنكية بمبلغ مطابق",
        debit: Number(target2.amount),
      },
      // 3. Unmatched in UAS (bank fee or external movement)
      {
        date: "2026-11-20",
        referenceId: "EXT-FEE-9999",
        description: "عمولة كشف حساب بنكي إضافية",
        debit: 500,
      },
    ];

    const reconcileResult = await autoReconcileStatementRows({
      treasuryAccountId,
      statementRows,
    });

    assert.equal(reconcileResult.statementTotalRows, 3);
    assert.equal(reconcileResult.matchedCount, 2);
    assert.equal(reconcileResult.unmatchedInUasCount, 1);
    assert.equal(reconcileResult.unmatchedInUas[0].referenceId, "EXT-FEE-9999");
    assert.ok(reconcileResult.matchedRows.some((m) => m.matchedBy === "externalReferenceId"));
  });

  it("8. Offline Android Local Mode Adapter mirrors dispatch, batch-export, and reconcile-import", async () => {
    const memStorage = createMemoryStorage();
    const state = loadOfflineAndroidState(memStorage);

    // Setup an offline treasury account with daily limit
    state.treasuryAccounts = [
      {
        id: "trs_offline_gw",
        code: "TRS-OFF-01",
        nameAr: "خزينة تجريبية أوفلاين",
        nameEn: "Offline Test Vault",
        type: "BANK",
        currency: "YER",
        balance: 100000,
        balanceYER: 100000,
        dailyLimit: 50000,
        dailyUsedAmount: 0,
        transferFeePercent: 1.0,
        status: "ACTIVE",
        gatewayProvider: "JAWALI_API",
        isSandbox: true,
      } as any,
    ];
    saveOfflineAndroidState(state, memStorage);

    // Test A: Exceeding daily limit offline
    const limitReq = await handleOfflineAndroidApiRequest(
      "/api/treasury/dispatch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryAccountId: "trs_offline_gw",
          beneficiaryName: "عادل منصور",
          beneficiaryAccountOrPhone: "777000111",
          amount: 60000,
        }),
      },
      memStorage
    );
    assert.equal(limitReq.status, 422);
    const limitJson = await limitReq.json();
    assert.equal(limitJson.error, "DAILY_LIMIT_EXCEEDED");

    // Test B: Successful offline dispatch with fee calculation and balance decrement
    const okReq = await handleOfflineAndroidApiRequest(
      "/api/treasury/dispatch",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": "OFFLINE-IDEM-001",
        },
        body: JSON.stringify({
          treasuryAccountId: "trs_offline_gw",
          beneficiaryName: "عادل منصور",
          beneficiaryAccountOrPhone: "777000111",
          amount: 10000,
        }),
      },
      memStorage
    );
    assert.equal(okReq.status, 200);
    const okJson = await okReq.json();
    assert.equal(okJson.ok, true);
    assert.equal(okJson.dispatch.amount, 10000);
    assert.equal(okJson.dispatch.feeAmount, 100); // 1.0% fee
    assert.equal(okJson.balanceAfter, 100000 - 10100); // 89,900
    assert.equal(okJson.dailyRemaining, 40000);

    // Test C: Offline batch export endpoint
    const batchReq = await handleOfflineAndroidApiRequest(
      "/api/treasury/batch-export",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryAccountId: "trs_offline_gw",
          provider: "JAWALI",
          items: [
            {
              beneficiaryName: "فؤاد سعيد",
              accountOrPhone: "777444555",
              amount: 5000,
            },
          ],
        }),
      },
      memStorage
    );
    assert.equal(batchReq.status, 200);
    const batchJson = await batchReq.json();
    assert.equal(batchJson.ok, true);
    assert.equal(batchJson.count, 1);
    assert.equal(batchJson.totalAmount, 5000);
    assert.ok(batchJson.base64);

    // Test D: Offline reconcile import endpoint
    const recReq = await handleOfflineAndroidApiRequest(
      "/api/treasury/reconcile-import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treasuryAccountId: "trs_offline_gw",
          statementRows: [
            {
              date: "2026-11-20",
              referenceId: okJson.dispatch.externalReferenceId,
              debit: 10000,
            },
            {
              date: "2026-11-20",
              referenceId: "OFFLINE-UNKNOWN-REF",
              debit: 1234,
            },
          ],
        }),
      },
      memStorage
    );
    assert.equal(recReq.status, 200);
    const recJson = await recReq.json();
    assert.equal(recJson.ok, true);
    assert.equal(recJson.result.matchedCount, 1);
    assert.equal(recJson.result.unmatchedInUasCount, 1);
  });

  it("8. Enforces HMAC-SHA256 webhook signature verification and rejects missing or forged signatures", async () => {
    const secret = "test-webhook-secret-2026";
    const payload = {
      eventId: `EVT-SIG-${TEST_RUN_TAG}`,
      referenceId: `REF-SIG-${TEST_RUN_TAG}`,
      amount: 12000,
      currency: "YER",
      treasuryAccountId,
    };
    const rawBody = JSON.stringify(payload);
    const validSig = computeWebhookSignature(rawBody, secret);
    assert.equal(verifyWebhookSignature(rawBody, validSig, secret), true);
    assert.equal(verifyWebhookSignature(rawBody, `sha256=${validSig}`, secret), true);
    assert.equal(verifyWebhookSignature(rawBody, "0".repeat(64), secret), false);

    // Reject missing signature when requireSignature=true
    await assert.rejects(
      () =>
        processInboundCollectionWebhook({
          provider: "KURAIMI_API",
          payload,
          rawBody,
          requireSignature: true,
        }),
      /INVALID_WEBHOOK_SIGNATURE/
    );

    // Accept validly signed webhook using configured treasury secret (fallback env)
    const prevSecret = process.env.UAS_WEBHOOK_SECRET;
    process.env.UAS_WEBHOOK_SECRET = secret;
    try {
      const accepted = await processInboundCollectionWebhook({
        provider: "KURAIMI_API",
        payload,
        rawBody,
        signatureHeader: `sha256=${validSig}`,
        requireSignature: true,
      });
      assert.equal(accepted.ok, true);
      assert.ok(accepted.dispatchId);
    } finally {
      if (prevSecret === undefined) delete process.env.UAS_WEBHOOK_SECRET;
      else process.env.UAS_WEBHOOK_SECRET = prevSecret;
    }
  });
});

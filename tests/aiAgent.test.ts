import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeUasAgentTool,
  UAS_AGENT_TOOL_SCHEMAS,
} from "../src/lib/ai/uasAgentTools";
import {
  parseBilingualAgentIntent,
  runUasAiAgent,
} from "../src/lib/ai/offlineAgentEngine";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";

describe("Phase 4 — Cross-Module RBAC Tool Registry & Financial Safety Guardrails", () => {
  it("registers all 11 required tools across Navigation, Accounting, Invoicing/Inventory & Reports/Support", () => {
    const names = UAS_AGENT_TOOL_SCHEMAS.map((t) => t.name);
    const expected = [
      "navigate_to_module",
      "query_account_balance",
      "search_journal_entries",
      "draft_journal_entry",
      "draft_voucher",
      "draft_invoice",
      "check_item_stock",
      "verify_qr_document",
      "generate_report_summary",
      "diagnose_system_health",
      "search_user_manual",
    ];
    for (const tool of expected) {
      assert.ok(names.includes(tool as any), `Tool ${tool} must be registered`);
    }
  });

  it("enforces balanced Debit === Credit and 5-level COA leaf accounts on draft_journal_entry", async () => {
    // 1. Rejects unbalanced journal entry (50,000 !== 30,000)
    const unbalanced = await runUasAiAgent(
      "سجل قيد يومية مدين 521101 بمبلغ 50000 ودائن 111101 بمبلغ 30000",
      { user: "CHIEF_ACCOUNTANT", lang: "ar" }
    );
    assert.equal(unbalanced.ok, false);
    assert.equal(unbalanced.toolResult.code, "UNBALANCED_JOURNAL_ENTRY");
    assert.equal(unbalanced.requiresConfirmation, false);
    assert.equal(unbalanced.confirmationCard, undefined);

    // 2. Rejects non-posting parent summary header account (Level 1: 100000 الأصول)
    const parentAccount = await executeUasAgentTool(
      "draft_journal_entry",
      {
        narrationAr: "قيد على حساب رئيسي",
        lines: [
          { accountCode: "100000", debit: 15000, credit: 0 },
          { accountCode: "111101", debit: 0, credit: 15000 },
        ],
      },
      { user: "SUPER_ADMIN", lang: "ar" }
    );
    assert.equal(parentAccount.ok, false);
    assert.equal(parentAccount.code, "COA_NON_POSTING_ACCOUNT");
    assert.equal(parentAccount.requiresConfirmation, false);

    // 3. Valid balanced journal entry on Level-5 leaf accounts returns Confirmation Preview Card (does NOT auto-write)
    const validDraft = await runUasAiAgent(
      "سجل قيد يومية مدين 521101 مصروف الديزل بمبلغ 35000 ودائن 111101 الصندوق الرئيسي بمبلغ 35000",
      { user: "CHIEF_ACCOUNTANT", lang: "ar" }
    );
    assert.equal(validDraft.ok, true);
    assert.equal(validDraft.toolName, "draft_journal_entry");
    assert.equal(validDraft.requiresConfirmation, true);
    assert.ok(validDraft.confirmationCard, "ConfirmationPreviewCard must be returned");
    assert.equal(validDraft.confirmationCard.isBalanced, true);
    assert.equal(validDraft.confirmationCard.totalDebit, 35000);
    assert.equal(validDraft.confirmationCard.totalCredit, 35000);
    assert.equal(validDraft.confirmationCard.lines.length, 2);
    assert.equal(validDraft.confirmationCard.confirmButtonLabel, "تأكيد وترحيل / Confirm & Execute");
    assert.equal(validDraft.confirmationCard.executionPayload.executed_by_ai, true);
    assert.equal(validDraft.reasoningTrace.length, 4);
  });

  it("enforces RBAC permissions across tools and blocks unauthorized roles", async () => {
    // 1. EXTERNAL_AUDITOR (Read-Only) is blocked from drafting journals, vouchers, and invoices
    const auditorJournal = await runUasAiAgent(
      "Draft journal entry debit 521101 10000 credit 111101 10000",
      { user: "EXTERNAL_AUDITOR", lang: "en" }
    );
    assert.equal(auditorJournal.ok, false);
    assert.equal(auditorJournal.toolResult.code, "RBAC_FORBIDDEN");
    assert.equal(auditorJournal.requiresConfirmation, false);

    const auditorVoucher = await runUasAiAgent(
      "سند صرف بمبلغ 12000",
      { user: "EXTERNAL_AUDITOR", lang: "ar" }
    );
    assert.equal(auditorVoucher.ok, false);
    assert.equal(auditorVoucher.toolResult.code, "RBAC_FORBIDDEN");

    // 2. SALES_COLLECTOR cannot post direct General Ledger journal entries or Purchase Bills
    const salesCollectorJe = await runUasAiAgent(
      "سجل قيد يومية مدين 521101 بمبلغ 10000 ودائن 111101 بمبلغ 10000",
      { user: "SALES_COLLECTOR", lang: "ar" }
    );
    assert.equal(salesCollectorJe.ok, false);
    assert.equal(salesCollectorJe.toolResult.code, "RBAC_FORBIDDEN");

    const salesCollectorPurchase = await runUasAiAgent(
      "فاتورة مشتريات من المورد بمبلغ 80000",
      { user: "SALES_COLLECTOR", lang: "ar" }
    );
    assert.equal(salesCollectorPurchase.ok, false);
    assert.equal(salesCollectorPurchase.toolResult.code, "RBAC_FORBIDDEN");

    // 3. SALES_COLLECTOR CAN draft a Sales Invoice & Receipt Voucher (returns Confirmation Preview Card)
    const salesCollectorInvoice = await runUasAiAgent(
      "فاتورة مبيعات للعميل مؤسسة النور بمبلغ 45000",
      { user: "SALES_COLLECTOR", lang: "ar" }
    );
    assert.equal(salesCollectorInvoice.ok, true);
    assert.equal(salesCollectorInvoice.requiresConfirmation, true);
    assert.equal(salesCollectorInvoice.confirmationCard?.operationType, "SALES_INVOICE");
    assert.equal(salesCollectorInvoice.confirmationCard?.totalDebit, 45000);

    // 4. PROCUREMENT_OFFICER is blocked from navigating to admin/system tab
    const procNavBlocked = await runUasAiAgent(
      "Navigate to system",
      { user: "PROCUREMENT_OFFICER", lang: "en" }
    );
    assert.equal(procNavBlocked.ok, false);
    assert.equal(procNavBlocked.toolResult.code, "RBAC_FORBIDDEN");
  });
});

describe("Phase 4 — Bilingual (Arabic / English) Offline Deterministic Reasoning & Navigation", () => {
  it("executes navigation deep links, account balance queries, reports, stock checks, QR verification & manual lookups 100% offline", async () => {
    // 1. Navigation deep link (Arabic & English)
    const navAr = await runUasAiAgent("افتح قسم شجرة الحسابات", {
      user: "SUPER_ADMIN",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(navAr.ok, true);
    assert.equal(navAr.toolName, "navigate_to_module");
    assert.equal(navAr.navigationTab, "coa");
    assert.equal(navAr.requiresConfirmation, false);

    const navEn = await runUasAiAgent("Open treasury tab", {
      user: "SUPER_ADMIN",
      lang: "en",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(navEn.ok, true);
    assert.equal(navEn.navigationTab, "treasury");

    // 2. Account balance query
    const bal = await runUasAiAgent("كم رصيد حساب الصندوق الرئيسي 111101؟", {
      user: "SUPER_ADMIN",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(bal.ok, true);
    assert.equal(bal.toolName, "query_account_balance");
    assert.match(bal.reply, /111101/);

    // 3. Financial report summary
    const rep = await runUasAiAgent("Generate Trial Balance and Income Statement summary", {
      user: "EXTERNAL_AUDITOR",
      lang: "en",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(rep.ok, true);
    assert.equal(rep.toolName, "generate_report_summary");
    assert.match(rep.reply, /Trial Balance/);

    // 4. Inventory stock check
    const stock = await runUasAiAgent("فحص المخزون والكميات المتوفرة", {
      user: "SUPER_ADMIN",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(stock.ok, true);
    assert.equal(stock.toolName, "check_item_stock");

    // 5. System health diagnostics
    const diag = await runUasAiAgent("Diagnose system health", {
      user: "SUPER_ADMIN",
      lang: "en",
      diagnostics: {
        license_status: "ACTIVE",
        is_valid: true,
        company_name: "Al-Jabri Trading",
        company_locked: true,
        company_matches: true,
        seat_managed: true,
        used_users: 4,
        max_users: 7,
        windows_bound: 4,
        android_bound: 3,
        active_mode: "lan",
        remaining_days: 300,
      },
    });
    assert.equal(diag.ok, true);
    assert.equal(diag.toolName, "diagnose_system_health");
    assert.match(diag.reply, /4 \/ 7 Users/);

    // 6. Bilingual User Manual lookup via Copilot
    const manual = await runUasAiAgent("كيف أقوم بإلغاء ربط جهاز مفقود في الترخيص؟", {
      user: "SUPER_ADMIN",
    });
    assert.equal(manual.ok, true);
    assert.equal(manual.toolName, "search_user_manual");
    assert.match(manual.reply, /Release Device Seat|إلغاء ربط الجهاز/);
    assert.equal(parseBilingualAgentIntent("Receipt voucher from Client A for 20000").toolName, "draft_voucher");
  });

  it("posts confirmed AI financial action to SQLite only after explicit confirmation and records executed_by_ai: true in audit trail", async () => {
    const { prisma } = await import("../src/lib/prisma");
    const { ensureSqliteDatabaseReady } = await import("../src/lib/sqliteBootstrap");
    const { executeConfirmedAiAction } = await import("../src/lib/ai/agentServerExecutor");
    await ensureSqliteDatabaseReady();

    // 1. Draft a voucher via the AI agent (verify no DB journal entry is created yet)
    const beforeCount = await prisma.journalEntry.count();
    const draftRes = await runUasAiAgent(
      "سند صرف بمبلغ 18500 ريال يمني لشراء مستلزمات صيانة",
      { user: "SUPER_ADMIN", lang: "ar" }
    );
    assert.equal(draftRes.ok, true);
    assert.equal(draftRes.requiresConfirmation, true);
    assert.ok(draftRes.confirmationCard);

    const midCount = await prisma.journalEntry.count();
    assert.equal(midCount, beforeCount, "Drafting must NEVER write to SQLite before explicit confirmation");

    // 2. EXTERNAL_AUDITOR attempting to confirm the card is blocked by RBAC
    const blockedConfirm = await executeConfirmedAiAction({
      confirmationCard: draftRes.confirmationCard,
      actor: {
        userId: "u1",
        userDisplay: "Auditor",
        userRole: "EXTERNAL_AUDITOR",
      },
    });
    assert.equal(blockedConfirm.ok, false);
    assert.equal(blockedConfirm.status, 403);

    // 3. Authorized SUPER_ADMIN confirms the card -> posts to SQLite & records executed_by_ai: true
    const confirmed = await executeConfirmedAiAction({
      confirmationCard: draftRes.confirmationCard,
      actor: {
        userId: "u1",
        userDisplay: "مدير النظام العام (SUPER_ADMIN)",
        userRole: "SUPER_ADMIN",
      },
    });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.executed_by_ai, true);
    assert.ok(confirmed.entryNumber);
    assert.ok(confirmed.journalEntryId);

    try {
      const entry = await prisma.journalEntry.findUnique({
        where: { id: confirmed.journalEntryId },
        include: { lines: true },
      });
      assert.ok(entry);
      assert.equal(entry.lines.length, 2);

      // Verify immutable audit log records executed_by_ai: true
      const immAudit = await prisma.immutableAuditLog.findFirst({
        where: { entityReference: confirmed.entryNumber },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(immAudit, "ImmutableAuditLog entry must exist for confirmed AI posting");
      assert.match(immAudit.details, /"executed_by_ai":true/);
    } finally {
      // Clean up test journal entry & audit records so baseline stays clean
      if (confirmed.journalEntryId) {
        await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: confirmed.journalEntryId } });
        await prisma.auditLog.deleteMany({ where: { entityId: confirmed.journalEntryId } });
        await prisma.journalEntry.deleteMany({ where: { id: confirmed.journalEntryId } });
      }
      if (confirmed.entryNumber) {
        await prisma.immutableAuditLog.deleteMany({ where: { entityReference: confirmed.entryNumber } });
      }
    }
  });
});

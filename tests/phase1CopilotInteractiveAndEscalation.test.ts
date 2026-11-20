import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeUasAgentTool,
  UAS_AGENT_TOOL_SCHEMAS,
  buildEscalationCard,
} from "../src/lib/ai/uasAgentTools";
import {
  parseBilingualAgentIntent,
  runUasAiAgent,
} from "../src/lib/ai/offlineAgentEngine";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";

describe("Mission 5: Phase 1 — Interactive AI Copilot (Live Search, Q&A & Escalation Card)", () => {
  it("registers query_workspace_data tool in UAS_AGENT_TOOL_SCHEMAS", () => {
    const names = UAS_AGENT_TOOL_SCHEMAS.map((t) => t.name);
    assert.ok(
      names.includes("query_workspace_data"),
      "query_workspace_data must be in tool schemas"
    );
  });

  describe("1. Live Workspace Search & Conversational Q&A", () => {
    it("answers client balance queries with sales data and direct citation link", async () => {
      const prompt = "كم رصيد العميل شركة الأمل؟";
      const intent = parseBilingualAgentIntent(prompt);
      assert.equal(intent.toolName, "query_workspace_data");
      assert.equal(intent.args.scope, "customers");

      const res = await runUasAiAgent(prompt, {
        user: "SUPER_ADMIN",
        lang: "ar",
        state: INITIAL_FALLBACK_STATE,
      });

      assert.equal(res.ok, true);
      assert.equal(res.toolName, "query_workspace_data");
      assert.ok(res.reply.includes("بيانات رصيد ومديونية العميل"));
      assert.ok(res.citations && res.citations.length > 0);
      assert.equal(res.citations[0].tab, "customers");
    });

    it("answers vendor payables queries with procurement data and citations", async () => {
      const prompt = "مستحقات المورد مؤسسة البركة";
      const intent = parseBilingualAgentIntent(prompt);
      assert.equal(intent.toolName, "query_workspace_data");
      assert.equal(intent.args.scope, "vendors");

      const res = await runUasAiAgent(prompt, {
        user: "SUPER_ADMIN",
        lang: "ar",
        state: INITIAL_FALLBACK_STATE,
      });

      assert.equal(res.ok, true);
      assert.equal(res.toolName, "query_workspace_data");
      assert.ok(res.reply.includes("بيانات المشتريات ومستحقات الموردين"));
      assert.ok(res.citations && res.citations.length > 0);
      assert.equal(res.citations[0].tab, "procurement");
    });

    it("answers project budget and actuals queries with project and reports citations", async () => {
      const prompt = "موازنة مشروع مزرعة الجوف";
      const intent = parseBilingualAgentIntent(prompt);
      assert.equal(intent.toolName, "query_workspace_data");
      assert.equal(intent.args.scope, "projects");

      const mockState = {
        ...INITIAL_FALLBACK_STATE,
        projects: [
          {
            id: "prj-jawf",
            name: "مزرعة الجوف",
            type: "AGRICULTURAL",
            parentProjectId: "",
            budgetTotal: 5000000,
            estimatedValue: 5000000,
            plannedHarvests: 2,
            notes: "مشروع استراتيجي",
            harvests: ["1", "2"],
          },
        ],
      };

      const res = await runUasAiAgent(prompt, {
        user: "SUPER_ADMIN",
        lang: "ar",
        state: mockState,
      });

      assert.equal(res.ok, true);
      assert.equal(res.toolName, "query_workspace_data");
      assert.ok(res.reply.includes("مزرعة الجوف"));
      assert.ok(res.reply.includes("5,000,000 YER"));
      assert.ok(res.citations && res.citations.length >= 2);
      assert.ok(res.citations.some((c) => c.tab === "projects"));
      assert.ok(res.citations.some((c) => c.tab === "reports"));
    });

    it("answers recent vouchers queries with treasury citations", async () => {
      const prompt = "آخر السندات المسجلة";
      const intent = parseBilingualAgentIntent(prompt);
      assert.equal(intent.toolName, "query_workspace_data");
      assert.equal(intent.args.scope, "vouchers");

      const res = await runUasAiAgent(prompt, {
        user: "SUPER_ADMIN",
        lang: "ar",
        state: INITIAL_FALLBACK_STATE,
      });

      assert.equal(res.ok, true);
      assert.equal(res.toolName, "query_workspace_data");
      assert.ok(res.reply.includes("سندات الخزينة"));
      assert.ok(res.citations && res.citations.length > 0);
      assert.equal(res.citations[0].tab, "treasury");
    });

    it("attaches citations to user manual knowledge searches", async () => {
      const toolRes = await executeUasAgentTool(
        "search_user_manual",
        { query: "كيف يتم إغلاق السنة المالية؟" },
        { lang: "ar" }
      );
      assert.equal(toolRes.ok, true);
      assert.ok(toolRes.citations && toolRes.citations.length > 0);
      assert.equal(toolRes.citations[0].type, "manual");
    });
  });

  describe("2. Interactive Clarification Prompts", () => {
    it("returns clarificationPrompt when voucher lacks required party or amount", async () => {
      const toolRes = await executeUasAgentTool(
        "draft_voucher",
        { voucherType: "RECEIPT" }, // missing amount and party
        { lang: "ar", state: INITIAL_FALLBACK_STATE }
      );

      assert.equal(toolRes.ok, true);
      assert.equal(toolRes.requiresConfirmation, false);
      assert.ok(toolRes.clarificationPrompt);
      assert.ok(toolRes.clarificationPrompt.missingFields.includes("amount"));
      assert.ok(toolRes.clarificationPrompt.quickOptions.length > 0);
      assert.ok(toolRes.summaryAr.includes("مطلوب توضيح"));
    });

    it("returns clarificationPrompt when invoice lacks required fields", async () => {
      const toolRes = await executeUasAgentTool(
        "draft_invoice",
        { invoiceType: "SALES" }, // missing party and amount
        { lang: "ar", state: INITIAL_FALLBACK_STATE }
      );

      assert.equal(toolRes.ok, true);
      assert.equal(toolRes.requiresConfirmation, false);
      assert.ok(toolRes.clarificationPrompt);
      assert.ok(toolRes.clarificationPrompt.quickOptions.length > 0);
    });

    it("returns clarificationPrompt when customer creation lacks name", async () => {
      const toolRes = await executeUasAgentTool(
        "create_customer",
        { name: "عميل جديد" }, // placeholder name triggers clarification
        { lang: "ar", state: INITIAL_FALLBACK_STATE }
      );

      assert.equal(toolRes.ok, true);
      assert.equal(toolRes.requiresConfirmation, false);
      assert.ok(toolRes.clarificationPrompt);
      assert.ok(toolRes.clarificationPrompt.missingFields.includes("name"));
      assert.ok(toolRes.clarificationPrompt.quickOptions.length > 0);
    });

    it("returns clarificationPrompt when vendor creation lacks name", async () => {
      const toolRes = await executeUasAgentTool(
        "create_vendor",
        { nameAr: "مورد جديد" }, // placeholder name triggers clarification
        { lang: "ar", state: INITIAL_FALLBACK_STATE }
      );

      assert.equal(toolRes.ok, true);
      assert.equal(toolRes.requiresConfirmation, false);
      assert.ok(toolRes.clarificationPrompt);
      assert.ok(toolRes.clarificationPrompt.missingFields.includes("nameAr"));
      assert.ok(toolRes.clarificationPrompt.quickOptions.length > 0);
    });

    it("returns clarificationPrompt when project creation lacks name", async () => {
      const toolRes = await executeUasAgentTool(
        "create_project",
        { name: "مشروع جديد" }, // placeholder name triggers clarification
        { lang: "ar", state: INITIAL_FALLBACK_STATE }
      );

      assert.equal(toolRes.ok, true);
      assert.equal(toolRes.requiresConfirmation, false);
      assert.ok(toolRes.clarificationPrompt);
      assert.ok(toolRes.clarificationPrompt.missingFields.includes("name"));
      assert.ok(toolRes.clarificationPrompt.quickOptions.length > 0);
    });
  });

  describe("3. Administrative & UAS Support Escalation Card", () => {
    it("builds a complete EscalationCardData structure with admin and support details", () => {
      const card = buildEscalationCard({
        code: "RBAC_FORBIDDEN",
        summaryAr: "غير مصرح",
        summaryEn: "RBAC Blocked",
        tab: "system",
        referenceId: "RBAC_FORBIDDEN",
      });

      assert.equal(card.reasonCode, "RBAC_FORBIDDEN");
      assert.equal(card.moduleTab, "system");
      assert.ok(card.adminContact.name);
      assert.ok(card.adminContact.phone);
      assert.ok(card.supportContact.hotline);
      assert.ok(card.supportContact.email);
      assert.ok(card.supportContact.portalUrl);
    });

    it("attaches escalationCard automatically on RBAC_FORBIDDEN violation", async () => {
      const readOnlyUser = {
        id: "usr-auditor",
        name: "مدقق خارجي",
        email: "auditor@uas.local",
        role: "EXTERNAL_AUDITOR" as const,
        active: true,
        avatarChar: "A",
      };

      const res = await runUasAiAgent(
        "سجل قيد يومية مدين 521101 بمبلغ 1000 ودائن 111101 بمبلغ 1000",
        {
          user: readOnlyUser,
          lang: "ar",
          state: INITIAL_FALLBACK_STATE,
        }
      );

      assert.equal(res.ok, false);
      assert.ok(res.escalationCard);
      assert.equal(res.escalationCard.reasonCode, "RBAC_FORBIDDEN");
      assert.ok(res.escalationCard.supportContact.email.includes("support@qat.world"));
    });

    it("attaches escalationCard on unbalanced journal entry error", async () => {
      const res = await executeUasAgentTool(
        "draft_journal_entry",
        {
          lines: [
            { accountCode: "521101", debit: 10000, credit: 0 },
            { accountCode: "111101", debit: 0, credit: 5000 }, // Unbalanced (10000 !== 5000)
          ],
        },
        { lang: "ar", user: "SUPER_ADMIN" }
      );

      assert.equal(res.ok, false);
      assert.equal(res.code, "UNBALANCED_JOURNAL_ENTRY");
      assert.ok(res.escalationCard);
      assert.equal(res.escalationCard.reasonCode, "UNBALANCED_JOURNAL_ENTRY");
    });
  });
});

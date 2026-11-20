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
import { executeConfirmedAiAction } from "../src/lib/ai/agentServerExecutor";
import { INITIAL_FALLBACK_STATE } from "../src/lib/seedFallback";

describe("Phase 1 — AI Copilot Arabic Voice, Master/Operational Actions & Chat Control Plane", () => {
  it("registers all 15 agent tools including master entity creation and client report export", () => {
    const names = UAS_AGENT_TOOL_SCHEMAS.map((t) => t.name);
    const required = [
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
      "create_customer",
      "create_vendor",
      "create_project",
      "export_client_report",
    ];
    for (const tool of required) {
      assert.ok(names.includes(tool as any), `Tool ${tool} must be registered in schemas`);
    }
  });

  it("parses Arabic voice/chat intent to create customer with phone and credit limit", async () => {
    const prompt = "أنشئ عميل جديد شركة الأمل للتجارة هاتف 771234567 وحد ائتماني 500000";
    const intent = parseBilingualAgentIntent(prompt);
    assert.equal(intent.toolName, "create_customer");
    assert.ok(String(intent.args.name).includes("الأمل"));
    assert.equal(intent.args.phone, "771234567");
    assert.equal(intent.args.creditLimit, 500000);

    const agentRes = await runUasAiAgent(prompt, {
      user: "SUPER_ADMIN",
      lang: "ar",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(agentRes.ok, true);
    assert.equal(agentRes.requiresConfirmation, true);
    assert.ok(agentRes.confirmationCard);
    assert.equal(agentRes.confirmationCard?.operationType, "CREATE_CUSTOMER");
    assert.equal(agentRes.confirmationCard?.confirmButtonLabelAr, "تأكيد وإنشاء العميل");
  });

  it("parses Arabic voice/chat intent to create vendor with phone and cost center", async () => {
    const prompt = "أنشئ مورد جديد مؤسسة البركة هاتف 777112233 مركز تكلفة CC-MAIN";
    const intent = parseBilingualAgentIntent(prompt);
    assert.equal(intent.toolName, "create_vendor");
    assert.ok(String(intent.args.nameAr).includes("البركة"));
    assert.equal(intent.args.phone, "777112233");
    assert.equal(intent.args.costCenterId, "CC-MAIN");

    const agentRes = await runUasAiAgent(prompt, {
      user: "SUPER_ADMIN",
      lang: "ar",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(agentRes.ok, true);
    assert.equal(agentRes.requiresConfirmation, true);
    assert.ok(agentRes.confirmationCard);
    assert.equal(agentRes.confirmationCard?.operationType, "CREATE_VENDOR");
    assert.equal(agentRes.confirmationCard?.confirmButtonLabelAr, "تأكيد وإنشاء المورد");
  });

  it("parses Arabic voice/chat intent to create project with budget and harvest cycles", async () => {
    const prompt = "أنشئ مشروع جديد مزرعة الجوف بموازنة 3000000 و 4 دورات";
    const intent = parseBilingualAgentIntent(prompt);
    assert.equal(intent.toolName, "create_project");
    assert.ok(String(intent.args.name).includes("الجوف"));
    assert.equal(intent.args.budgetTotal, 3000000);
    assert.equal(intent.args.plannedHarvests, 4);

    const agentRes = await runUasAiAgent(prompt, {
      user: "SUPER_ADMIN",
      lang: "ar",
      state: INITIAL_FALLBACK_STATE,
    });
    assert.equal(agentRes.ok, true);
    assert.equal(agentRes.requiresConfirmation, true);
    assert.ok(agentRes.confirmationCard);
    assert.equal(agentRes.confirmationCard?.operationType, "CREATE_PROJECT");
    assert.equal(agentRes.confirmationCard?.confirmButtonLabelAr, "تأكيد وإنشاء المشروع");
  });

  it("parses Arabic voice/chat intent for client report export with itemized per-sale details", async () => {
    const promptWithDetails = "تصدير كشف حساب العميل شركة الأمل بتفاصيل المبيعات";
    const intent1 = parseBilingualAgentIntent(promptWithDetails);
    assert.equal(intent1.toolName, "export_client_report");
    assert.equal(intent1.args.includeSaleDetails, true);

    const promptSummaryOnly = "كشف حساب للعميل شركة الأمل ملخص فقط بدون تفاصيل";
    const intent2 = parseBilingualAgentIntent(promptSummaryOnly);
    assert.equal(intent2.toolName, "export_client_report");
    assert.equal(intent2.args.includeSaleDetails, false);

    const toolRes = await executeUasAgentTool(
      "export_client_report",
      { customerName: "شركة الأمل", includeSaleDetails: true },
      { lang: "ar", state: INITIAL_FALLBACK_STATE }
    );
    assert.equal(toolRes.ok, true);
    assert.equal(toolRes.navigationTab, "customers");
    assert.ok(toolRes.summaryAr.includes("تضمين تفاصيل كل عملية بيع"));
  });

  it("enforces RBAC on master creation actions and blocks Read-Only users", async () => {
    const custRes = await executeUasAgentTool(
      "create_customer",
      { name: "عميل تجريبي" },
      { user: "AUDITOR", lang: "ar" }
    );
    assert.equal(custRes.ok, false);
    assert.equal(custRes.code, "RBAC_FORBIDDEN");

    const vendRes = await executeUasAgentTool(
      "create_vendor",
      { nameAr: "مورد تجريبي" },
      { user: "AUDITOR", lang: "ar" }
    );
    assert.equal(vendRes.ok, false);
    assert.equal(vendRes.code, "RBAC_FORBIDDEN");

    const prjRes = await executeUasAgentTool(
      "create_project",
      { name: "مشروع تجريبي" },
      { user: "AUDITOR", lang: "ar" }
    );
    assert.equal(prjRes.ok, false);
    assert.equal(prjRes.code, "RBAC_FORBIDDEN");
  });

  it("executes confirmed AI master creation actions and records executed_by_ai: true", async () => {
    const testTag = Date.now().toString().slice(-4);
    const customerCard = {
      actionId: `ai-cust-test-${testTag}`,
      toolName: "create_customer" as const,
      operationType: "CREATE_CUSTOMER" as const,
      titleAr: "معاينة إنشاء عميل جديد",
      titleEn: "Create New Customer Preview",
      narrationAr: `عميل ذكاء اصطناعي ${testTag}`,
      narrationEn: `AI Customer ${testTag}`,
      date: new Date().toISOString().slice(0, 10),
      currency: "YER",
      totalDebit: 0,
      totalCredit: 0,
      isBalanced: true,
      partyName: `عميل تجربة ${testTag}`,
      lines: [],
      confirmButtonLabelAr: "تأكيد وإنشاء العميل",
      confirmButtonLabelEn: "Confirm & Create Customer",
      confirmButtonLabel: "تأكيد وإنشاء العميل / Confirm & Create Customer",
      executionPayload: {
        operationType: "CREATE_CUSTOMER",
        name: `عميل تجربة ${testTag}`,
        phone: "770001122",
        creditLimit: 150000,
        executed_by_ai: true,
      },
    };

    const execResult = await executeConfirmedAiAction({
      confirmationCard: customerCard,
      actor: { userId: "u1", userDisplay: "Admin User", userRole: "SUPER_ADMIN" },
    });

    assert.equal(execResult.ok, true);
    assert.equal(execResult.executed_by_ai, true);
    assert.ok(execResult.entryNumber);
    assert.ok(execResult.summaryAr.includes("executed_by_ai: true"));
  });

  it("executes confirmed export_client_report action with includeSaleDetails flag", async () => {
    const reportCard = {
      actionId: "ai-rpt-test",
      toolName: "export_client_report" as const,
      operationType: "EXPORT_CLIENT_REPORT" as const,
      titleAr: "كشف حساب عميل",
      titleEn: "Client Account Statement",
      narrationAr: "تصدير كشف حساب",
      narrationEn: "Export Statement",
      date: new Date().toISOString().slice(0, 10),
      currency: "YER",
      totalDebit: 0,
      totalCredit: 0,
      isBalanced: true,
      partyName: "شركة الأمل",
      lines: [],
      confirmButtonLabelAr: "فتح كشف الحساب والطباعة",
      confirmButtonLabelEn: "Open Statement & Print",
      confirmButtonLabel: "فتح كشف الحساب والطباعة / Open Statement & Print",
      executionPayload: {
        operationType: "EXPORT_CLIENT_REPORT",
        customerName: "شركة الأمل",
        includeSaleDetails: true,
        executed_by_ai: true,
      },
    };

    const execResult = await executeConfirmedAiAction({
      confirmationCard: reportCard,
      actor: { userId: "u1", userDisplay: "Admin User", userRole: "SUPER_ADMIN" },
    });

    assert.equal(execResult.ok, true);
    assert.equal(execResult.executed_by_ai, true);
    assert.ok(execResult.summaryAr.includes("مضمّنة بالكامل"));
  });
});


import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction } from "@/lib/apiHelpers";
import { getBootstrapState } from "@/lib/serverBootstrap";
import {
  UAS_AGENT_TOOL_SCHEMAS,
  type ConfirmationPreviewCard,
  type UasAgentToolName,
  type UasWorkspaceContext,
} from "@/lib/ai/uasAgentTools";
import {
  DEFAULT_GEMINI_FAST_MODEL,
  DEFAULT_GEMINI_REASONING_MODEL,
  runGeminiCopilotAgent,
} from "@/lib/ai/geminiCopilotEngine";
import {
  buildServerAgentContext,
  executeConfirmedAiAction,
} from "@/lib/ai/agentServerExecutor";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET() {
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  return NextResponse.json({
    success: true,
    agent: "UAS Enterprise Bilingual Voice + Text Reasoning ERP Copilot",
    geminiEnabled: geminiConfigured,
    models: {
      fast: process.env.UAS_GEMINI_FAST_MODEL || DEFAULT_GEMINI_FAST_MODEL,
      reasoning: process.env.UAS_GEMINI_REASONING_MODEL || DEFAULT_GEMINI_REASONING_MODEL,
    },
    tiers: geminiConfigured
      ? ["gemini_4_argon", "gemini_3_8_flash", "tier2_local_ollama", "tier3_offline_deterministic"]
      : ["tier2_local_ollama", "tier3_offline_deterministic"],
    confirmationGate: "MANDATORY_FOR_ALL_FINANCIAL_WRITES",
    tools: UAS_AGENT_TOOL_SCHEMAS,
  });
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {});
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const lang = body.lang === "en" || body.lang === "ar" ? body.lang : undefined;

    // 1. Handle explicit user confirmation click ("تأكيد وترحيل / Confirm & Execute")
    if (body.confirmAction && typeof body.confirmAction === "object") {
      const card = body.confirmAction as ConfirmationPreviewCard;
      const execRes = await executeConfirmedAiAction({
        confirmationCard: card,
        actor,
      });

      const state = execRes.ok ? await getBootstrapState() : undefined;
      return NextResponse.json(
        {
          success: execRes.ok,
          confirmedExecution: true,
          ...execRes,
          reply: lang === "en" ? execRes.summaryEn : execRes.summaryAr,
          state,
        },
        { status: execRes.status }
      );
    }

    // 2. Normal reasoning & tool execution
    const prompt = String(body.prompt ?? body.query ?? body.message ?? "").trim();
    const serverCtx = await buildServerAgentContext(actor, lang);
    const workspaceContext =
      body.workspaceContext && typeof body.workspaceContext === "object"
        ? (body.workspaceContext as UasWorkspaceContext)
        : undefined;

    const explicitTool =
      body.explicitTool && typeof body.explicitTool === "object"
        ? (body.explicitTool as { toolName: UasAgentToolName; args: Record<string, unknown> })
        : undefined;

    const agentResponse = await runGeminiCopilotAgent(prompt, {
      ...serverCtx,
      workspaceContext,
      explicitTool,
      enableLocalOllamaProbe: body.enableLocalOllamaProbe === true,
    });

    return NextResponse.json({
      success: true,
      ...agentResponse,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : undefined;
    console.error("POST /api/ai/agent error:", err);
    return NextResponse.json(
      {
        success: false,
        error: errMsg || "تعذر تنفيذ طلب المساعد الذكي / Failed to process AI Copilot request",
      },
      { status: 500 }
    );
  }
});

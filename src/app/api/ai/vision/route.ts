/**
 * UAS Enterprise — Multimodal Camera & Image Vision API (/api/ai/vision)
 *
 * Accepts JPEG/PNG/WEBP receipt, supplier bill, sales slip, or handwritten harvest
 * tally sheet images (`multipart/form-data` or JSON base64), extracts structured
 * fields via `@google/genai` (with `gemini-3.8-flash` -> `gemini-4-argon` escalation),
 * grounds against tenant Copilot memory, and maps directly to a ConfirmationPreviewCard
 * via `executeUasAgentTool` (`requiresConfirmation: true`).
 */
import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { normalizeMemoryTenantSlug } from "@/lib/ai/copilotMemoryTypes";
import { retrieveServerCopilotMemories } from "@/lib/ai/copilotMemoryStore";
import { buildServerAgentContext } from "@/lib/ai/agentServerExecutor";
import { extractDocumentFromVisionImage } from "@/lib/ai/copilotVisionExtractor";
import { executeUasAgentTool, type UasWorkspaceContext } from "@/lib/ai/uasAgentTools";
import type { CopilotDialectMode } from "@/lib/ai/yemeniLocalization";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    let bodyObj: Record<string, unknown> = {};
    let imageBase64 = "";
    let mimeType = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (file instanceof File) {
        const buf = Buffer.from(await file.arrayBuffer());
        imageBase64 = buf.toString("base64");
        mimeType = file.type || "";
      }
      bodyObj = {
        prompt: formData.get("prompt") ? String(formData.get("prompt")) : "",
        lang: formData.get("lang") ? String(formData.get("lang")) : undefined,
        dialect: formData.get("dialect") ? String(formData.get("dialect")) : undefined,
      };
    } else {
      bodyObj = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      imageBase64 = String(bodyObj.imageBase64 ?? bodyObj.image ?? "");
      mimeType = String(bodyObj.mimeType ?? "");
    }

    const auth = await authorizeApiAction(bodyObj, req, {});
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const lang: "ar" | "en" = bodyObj.lang === "en" ? "en" : "ar";
    const dialect: CopilotDialectMode = bodyObj.dialect === "msa" ? "msa" : "yemeni";
    const prompt = String(bodyObj.prompt ?? "").trim();
    const workspaceContext =
      bodyObj.workspaceContext && typeof bodyObj.workspaceContext === "object"
        ? (bodyObj.workspaceContext as UasWorkspaceContext)
        : undefined;

    const tenantSlug = normalizeMemoryTenantSlug(
      getActiveTenantId() || workspaceContext?.tenantSlug
    );
    const [serverCtx, activeMemories] = await Promise.all([
      buildServerAgentContext(actor, lang),
      Promise.resolve(
        retrieveServerCopilotMemories({
          tenantSlug,
          userId: actor.userId,
          query: `${prompt} قطفة علاقي مصروف مبيعات عميل`,
          activeTab: workspaceContext?.activeTab,
          limit: 8,
        })
      ),
    ]);

    const visionRes = await extractDocumentFromVisionImage({
      imageBase64,
      mimeType,
      prompt,
      lang,
      dialect,
      tenantSlug,
      state: serverCtx.state,
      memories: activeMemories,
      selectedProjectId: workspaceContext?.selectedProjectId,
      selectedHarvest: workspaceContext?.selectedHarvest,
    });

    if (!visionRes.ok) {
      return NextResponse.json(
        {
          success: false,
          code: visionRes.code,
          error: lang === "en" ? visionRes.errorEn : visionRes.errorAr,
          errorAr: visionRes.errorAr,
          errorEn: visionRes.errorEn,
        },
        { status: visionRes.status }
      );
    }

    const { extraction } = visionRes;
    const toolResult = await executeUasAgentTool(
      extraction.mappedToolCall.toolName,
      extraction.mappedToolCall.args,
      {
        ...serverCtx,
        lang,
        workspaceContext,
        memories: activeMemories,
      }
    );

    const replyAr = `${extraction.summaryAr}\n\n${toolResult.summaryAr}`;
    const replyEn = `${extraction.summaryEn}\n\n${toolResult.summaryEn}`;

    return NextResponse.json({
      success: true,
      tenantSlug,
      extraction,
      toolName: extraction.mappedToolCall.toolName,
      toolArgs: extraction.mappedToolCall.args,
      toolResult,
      requiresConfirmation: Boolean(
        toolResult.confirmationCard || toolResult.requiresConfirmation
      ),
      confirmationCard: toolResult.confirmationCard,
      clarificationPrompt: toolResult.clarificationPrompt,
      escalationCard: toolResult.escalationCard,
      reply: lang === "en" ? replyEn : replyAr,
      replyAr,
      replyEn,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : undefined;
    console.error("POST /api/ai/vision error:", err);
    return NextResponse.json(
      {
        success: false,
        error: errMsg || "تعذر تحليل صورة المستند / Failed to process vision image",
      },
      { status: 500 }
    );
  }
});

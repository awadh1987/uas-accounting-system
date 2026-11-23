import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { UAS_SUPPORT_CHAPTERS } from "@/lib/uasSupportKnowledge";
import {
  answerSupportQuery,
  diagnoseLiveSystemState,
  type SupportSystemDiagnostics,
} from "@/lib/localSupportEngine";
import { runGeminiSupportSynthesis } from "@/lib/ai/geminiCopilotEngine";
import { collectServerSupportDiagnostics } from "@/lib/supportDiagnosticsServer";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const liveDiagnostics = await collectServerSupportDiagnostics();
    const q = (req.nextUrl?.searchParams.get("q") || "").trim();
    const langParam = req.nextUrl?.searchParams.get("lang");
    const lang = langParam === "en" || langParam === "ar" ? langParam : undefined;

    if (q) {
      const result = answerSupportQuery(q, { lang, diagnostics: liveDiagnostics });
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    return NextResponse.json({
      success: true,
      chapters: UAS_SUPPORT_CHAPTERS,
      diagnostics: liveDiagnostics,
      diagnosticReport: diagnoseLiveSystemState(liveDiagnostics),
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : undefined;
    console.error("GET /api/support/chat error:", err);
    return NextResponse.json(
      {
        success: false,
        error: errMsg || "تعذر تحميل دليل الدعم الفني / Failed to load support knowledge base",
      },
      { status: 500 }
    );
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const query = String(body.query ?? body.message ?? body.prompt ?? "").trim();
    const lang = body.lang === "en" || body.lang === "ar" ? body.lang : undefined;
    const clientDiag =
      body.diagnostics && typeof body.diagnostics === "object"
        ? (body.diagnostics as Partial<SupportSystemDiagnostics>)
        : undefined;

    const serverDiag = await collectServerSupportDiagnostics();
    const mergedDiagnostics: SupportSystemDiagnostics = {
      ...serverDiag,
      ...(clientDiag ?? {}),
      per_user_devices: {
        windows: Number(clientDiag?.per_user_devices?.windows ?? serverDiag.per_user_devices.windows),
        android: Number(clientDiag?.per_user_devices?.android ?? serverDiag.per_user_devices.android),
      },
    };

    const result = answerSupportQuery(query, {
      lang,
      diagnostics: mergedDiagnostics,
      topK: typeof body.topK === "number" ? body.topK : 3,
    });

    const resolvedLang = lang ?? result.lang;
    const synthesized = await runGeminiSupportSynthesis({
      query,
      lang: resolvedLang,
      baselineAnswerAr: result.answerAr,
      baselineAnswerEn: result.answerEn,
      diagnosticsSummary: `${result.diagnosticReport.statusBadge}: ${(resolvedLang === "ar" ? result.diagnosticReport.findingsAr : result.diagnosticReport.findingsEn).join(" | ")}`,
    });

    return NextResponse.json({
      success: true,
      ...result,
      answer: synthesized ? synthesized.text : result.answer,
      answerAr: synthesized && resolvedLang === "ar" ? synthesized.text : result.answerAr,
      answerEn: synthesized && resolvedLang === "en" ? synthesized.text : result.answerEn,
      modelUsed: synthesized ? synthesized.modelUsed : "Offline Local Engine",
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : undefined;
    console.error("POST /api/support/chat error:", err);
    return NextResponse.json(
      {
        success: false,
        error: errMsg || "تعذر معالجة استفسار الدعم الفني / Failed to process support query",
      },
      { status: 500 }
    );
  }
});

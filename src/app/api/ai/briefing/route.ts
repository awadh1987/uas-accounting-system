/**
 * UAS Enterprise — Proactive Daily Executive Briefing & Alerts API (/api/ai/briefing)
 *
 * Returns tenant-isolated Daily Executive Briefings, Low-Stock Alerts, and
 * Overdue-Receivable Alerts with optional Gemini synthesis (`gemini-3.8-flash`
 * / `gemini-4-argon`) and automatic deterministic fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { normalizeMemoryTenantSlug } from "@/lib/ai/copilotMemoryTypes";
import { buildServerExecutiveBriefing } from "@/lib/ai/executiveBriefingServer";
import { runGeminiBriefingSynthesis } from "@/lib/ai/geminiCopilotEngine";
import type { CopilotDialectMode } from "@/lib/ai/yemeniLocalization";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const sp = req.nextUrl?.searchParams;
    const langParam = sp?.get("lang");
    const lang: "ar" | "en" = langParam === "en" ? "en" : "ar";
    const dialect: CopilotDialectMode = sp?.get("dialect") === "msa" ? "msa" : "yemeni";
    const refresh = sp?.get("refresh") === "true";
    const date = sp?.get("date") || undefined;
    const focusRaw = sp?.get("focus");
    const focus =
      focusRaw === "low_stock" || focusRaw === "overdue_receivables"
        ? focusRaw
        : "all";
    const tenantSlug = normalizeMemoryTenantSlug(getActiveTenantId());

    const report = await buildServerExecutiveBriefing({
      tenantSlug,
      userId: actor.userId,
      userRole: actor.userRole,
      lang,
      dialect,
      date,
      focus,
      refresh,
    });

    if (refresh || sp?.get("synthesize") === "true") {
      const synth = await runGeminiBriefingSynthesis({ briefing: report });
      if (synth) {
        report.modelUsed = synth.modelUsed;
        report.briefing = synth.text;
        if (lang === "ar") report.briefingAr = synth.text;
        else report.briefingEn = synth.text;
      }
    }

    return NextResponse.json({
      success: true,
      ...report,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : undefined;
    console.error("GET /api/ai/briefing error:", err);
    return NextResponse.json(
      {
        success: false,
        error: errMsg || "تعذر توليد الملخص التنفيذي اليومي / Failed to build executive briefing",
      },
      { status: 500 }
    );
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {});
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const lang: "ar" | "en" = body.lang === "en" ? "en" : "ar";
    const dialect: CopilotDialectMode = body.dialect === "msa" ? "msa" : "yemeni";
    const refresh = Boolean(body.refresh ?? true);
    const date = typeof body.date === "string" ? body.date : undefined;
    const focus =
      body.focus === "low_stock" || body.focus === "overdue_receivables"
        ? body.focus
        : "all";
    const tenantSlug = normalizeMemoryTenantSlug(getActiveTenantId());

    const report = await buildServerExecutiveBriefing({
      tenantSlug,
      userId: actor.userId,
      userRole: actor.userRole,
      lang,
      dialect,
      date,
      focus,
      lowStockThreshold:
        typeof body.lowStockThreshold === "number" ? body.lowStockThreshold : undefined,
      defaultCreditTermDays:
        typeof body.defaultCreditTermDays === "number"
          ? body.defaultCreditTermDays
          : undefined,
      refresh,
    });

    if (body.synthesize !== false) {
      const synth = await runGeminiBriefingSynthesis({ briefing: report });
      if (synth) {
        report.modelUsed = synth.modelUsed;
        report.briefing = synth.text;
        if (lang === "ar") report.briefingAr = synth.text;
        else report.briefingEn = synth.text;
      }
    }

    return NextResponse.json({
      success: true,
      ...report,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : undefined;
    console.error("POST /api/ai/briefing error:", err);
    return NextResponse.json(
      {
        success: false,
        error: errMsg || "تعذر توليد الملخص التنفيذي اليومي / Failed to generate executive briefing",
      },
      { status: 500 }
    );
  }
});

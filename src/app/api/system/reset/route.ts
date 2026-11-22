import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, forbiddenError } from "@/lib/apiHelpers";
import {
  precheckScopedReset,
  executeScopedReset,
  type ResetScopeType,
  type ResetSectionModule,
  type ResetUnitType,
  type FactoryCoaMode,
} from "@/lib/scopedResetEngine";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "system" });
    if (!auth.ok) return auth.response;
    if (auth.actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError("صلاحية المشرف العام (SUPER_ADMIN) مطلوبة لفحص عمليات إعادة الضبط");
    }

    const url = new URL(req.url);
    const scope = (url.searchParams.get("scope") as ResetScopeType) || "section";
    const sectionModule = (url.searchParams.get("sectionModule") as ResetSectionModule) || "sales";
    const unitType = (url.searchParams.get("unitType") as ResetUnitType) || undefined;
    const unitId = url.searchParams.get("unitId") || undefined;

    const check = await precheckScopedReset({
      scope,
      sectionModule,
      unitType,
      unitId,
    });

    return NextResponse.json({ ok: true, check });
  } catch (error) {
    console.error("GET /api/system/reset error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to precheck scoped reset",
      },
      { status: 500 }
    );
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    if (auth.actor.userRole !== "SUPER_ADMIN") {
      return forbiddenError("صلاحية المشرف العام (SUPER_ADMIN) مطلوبة لتنفيذ عمليات إعادة الضبط");
    }

    const scope = (body.scope as ResetScopeType) || "section";
    const sectionModule = body.sectionModule as ResetSectionModule | undefined;
    const unitType = body.unitType as ResetUnitType | undefined;
    const unitId = body.unitId ? String(body.unitId) : undefined;
    const coaMode = (body.coaMode as FactoryCoaMode) || "starter_template";
    const confirmationPhrase = String(body.confirmationPhrase || "").trim();

    const result = await executeScopedReset({
      scope,
      sectionModule,
      unitType,
      unitId,
      coaMode,
      confirmationPhrase,
      actor: {
        userId: auth.actor.userId,
        userDisplay: auth.actor.userDisplay,
        userRole: auth.actor.userRole,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("POST /api/system/reset error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to execute scoped reset",
      },
      { status: 400 }
    );
  }
});

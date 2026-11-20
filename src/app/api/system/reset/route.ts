import { NextRequest, NextResponse } from "next/server";
import {
  precheckScopedReset,
  executeScopedReset,
  type ResetScopeType,
  type ResetSectionModule,
  type ResetUnitType,
  type FactoryCoaMode,
} from "@/lib/scopedResetEngine";

export async function GET(req: NextRequest) {
  try {
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
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const scope = (body.scope as ResetScopeType) || "section";
    const sectionModule = body.sectionModule as ResetSectionModule | undefined;
    const unitType = body.unitType as ResetUnitType | undefined;
    const unitId = body.unitId ? String(body.unitId) : undefined;
    const coaMode = (body.coaMode as FactoryCoaMode) || "starter_template";
    const confirmationPhrase = String(body.confirmationPhrase || "").trim();

    // Actor identification
    const headerUserId = req.headers.get("x-uas-user-id");
    const headerRole = req.headers.get("x-uas-role");

    const actor = {
      userId: body.actor?.userId || headerUserId || null,
      userDisplay: body.actor?.userDisplay || "مدير النظام",
      userRole: body.actor?.userRole || headerRole || "SUPER_ADMIN",
    };

    if (actor.userRole !== "SUPER_ADMIN") {
      return NextResponse.json(
        {
          ok: false,
          error: "صلاحية المشرف العام (SUPER_ADMIN) مطلوبة لتنفيذ عمليات إعادة الضبط",
        },
        { status: 403 }
      );
    }

    const result = await executeScopedReset({
      scope,
      sectionModule,
      unitType,
      unitId,
      coaMode,
      confirmationPhrase,
      actor,
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
}

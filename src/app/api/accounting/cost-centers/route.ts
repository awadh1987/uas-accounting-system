import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { withIdempotency } from "@/lib/idempotencyGuard";
import {
  archiveMasterRecord,
  restoreMasterRecord,
  safeDeleteOrArchiveMasterRecord,
} from "@/lib/masterLifecycle";
import {
  createCostCenter,
  ensure6GenerationCoaHierarchy,
  listCostCenters,
  updateCostCenter,
} from "@/lib/accountingCoreEngine";

export const dynamic = "force-dynamic";

function fail(error: unknown, fallback: string) {
  const msg = error instanceof Error ? error.message : fallback;
  const known = /^(COST_CENTER|INVALID_CENTER|DUPLICATE_COST|PARENT_COST)/.test(msg);
  return jsonError(known ? msg : fallback, known ? 400 : 500);
}

export const GET = withTenantRoute(async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    await ensure6GenerationCoaHierarchy();
    const costCenters = await listCostCenters();
    return NextResponse.json({ costCenters });
  } catch (error) {
    console.error("GET /api/accounting/cost-centers error:", error);
    return fail(error, "Failed to load cost centers / تعذر تحميل مراكز التكلفة");
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, { moduleId: "coa", action: "post" });
      if (!auth.ok) return auth.response;
      const costCenter = await createCostCenter({
        code: body.code ? String(body.code) : undefined,
        nameAr: String(body.nameAr || ""),
        nameEn: body.nameEn ? String(body.nameEn) : undefined,
        parentId: body.parentId ? String(body.parentId) : null,
        centerType: body.centerType ? String(body.centerType) : "OTHER",
        customLabel: body.customLabel ? String(body.customLabel) : null,
      });
      return NextResponse.json({ success: true, costCenter }, { status: 201 });
    } catch (error) {
      console.error("POST /api/accounting/cost-centers error:", error);
      return fail(error, "Failed to create cost center / تعذر إنشاء مركز التكلفة");
    }
  });
});

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { moduleId: "coa", action: "post" });
    if (!auth.ok) return auth.response;
    const id = String(body.id || "");
    if (!id) return jsonError("id is required", 400);
    const costCenter = await updateCostCenter(id, {
      nameAr: body.nameAr !== undefined ? String(body.nameAr) : undefined,
      nameEn: body.nameEn !== undefined ? String(body.nameEn) : undefined,
      centerType: body.centerType !== undefined ? String(body.centerType) : undefined,
      customLabel: body.customLabel !== undefined ? (body.customLabel ? String(body.customLabel) : null) : undefined,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    });
    return NextResponse.json({ success: true, costCenter });
  } catch (error) {
    console.error("PUT /api/accounting/cost-centers error:", error);
    return fail(error, "Failed to update cost center / تعذر تحديث مركز التكلفة");
  }
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const { searchParams } = new URL(req.url);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, { moduleId: "coa", action: "post" });
    if (!auth.ok) return auth.response;
    const id = searchParams.get("id") || String(body.id || "");
    const action = String(body.action || searchParams.get("action") || "SAFE_DELETE").toUpperCase();
    if (!id) return jsonError("id is required", 400);

    const actor = {
      userId: auth.actor.userId,
      userRole: auth.actor.userRole,
      userDisplay: auth.actor.userDisplay,
    };

    let result;
    if (action === "ARCHIVE") {
      result = await archiveMasterRecord("CostCenter", id, actor);
    } else if (action === "RESTORE") {
      result = await restoreMasterRecord("CostCenter", id, actor);
    } else {
      result = await safeDeleteOrArchiveMasterRecord("CostCenter", id, actor);
    }

    return NextResponse.json({ success: true, ...result }, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/accounting/cost-centers error:", error);
    return fail(error, "Failed to delete cost center / تعذر حذف مركز التكلفة");
  }
});

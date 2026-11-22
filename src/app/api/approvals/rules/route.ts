import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import {
  createApprovalRule,
  deleteApprovalRule,
  listApprovalRules,
  updateApprovalRule,
} from "@/lib/approvalEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "system" });
    if (!auth.ok) return auth.response;

    const rules = await listApprovalRules();
    return NextResponse.json({ rules });
  } catch (error) {
    console.error("GET /api/approvals/rules error:", error);
    return jsonError("تعذر تحميل سياسات الاعتماد", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { moduleId: "system", action: "edit" });
    if (!auth.ok) return auth.response;

    const { hasGranularPermission } = await import("@/lib/permissions");
    if (!hasGranularPermission(auth.actor.userRole, "approvals.configure")) {
      return jsonError("غير مصرح: ليس لديك صلاحية ضبط قواعد الاعتماد", 403);
    }

    const rule = await createApprovalRule({
      module: String(body.module || "ACCOUNTING"),
      actionType: String(body.actionType || "GL_POSTING"),
      minAmountBase: Number(body.minAmountBase) || 0,
      currencyCode: body.currencyCode ? String(body.currencyCode) : "YER",
      requiredRole: body.requiredRole ? String(body.requiredRole) : "CHIEF_ACCOUNTANT",
      approverUserIds: Array.isArray(body.approverUserIds) ? (body.approverUserIds as string[]) : [],
      allowSelfApproval: Boolean(body.allowSelfApproval),
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    });
    return NextResponse.json({ success: true, rule }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إنشاء قاعدة الاعتماد";
    return jsonError(msg, 400);
  }
});

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { moduleId: "system", action: "edit" });
    if (!auth.ok) return auth.response;

    const { hasGranularPermission } = await import("@/lib/permissions");
    if (!hasGranularPermission(auth.actor.userRole, "approvals.configure")) {
      return jsonError("غير مصرح: ليس لديك صلاحية ضبط قواعد الاعتماد", 403);
    }
    const id = String(body.id || "");
    if (!id) return jsonError("id is required", 400);

    const rule = await updateApprovalRule(id, {
      module: body.module !== undefined ? String(body.module) : undefined,
      actionType: body.actionType !== undefined ? String(body.actionType) : undefined,
      minAmountBase: body.minAmountBase !== undefined ? Number(body.minAmountBase) : undefined,
      requiredRole: body.requiredRole !== undefined ? String(body.requiredRole) : undefined,
      allowSelfApproval: body.allowSelfApproval !== undefined ? Boolean(body.allowSelfApproval) : undefined,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
    });
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تحديث قاعدة الاعتماد";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
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
    const auth = await authorizeApiAction(body, req, { moduleId: "system", action: "edit" });
    if (!auth.ok) return auth.response;

    const { hasGranularPermission } = await import("@/lib/permissions");
    if (!hasGranularPermission(auth.actor.userRole, "approvals.configure")) {
      return jsonError("غير مصرح: ليس لديك صلاحية ضبط قواعد الاعتماد", 403);
    }
    const id = searchParams.get("id") || String(body.id || "");
    if (!id) return jsonError("id is required", 400);
    await deleteApprovalRule(id);
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر حذف قاعدة الاعتماد";
    return jsonError(msg, 400);
  }
});

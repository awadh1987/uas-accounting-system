import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import {
  discardWorkspaceDraft,
  getWorkspaceDraftById,
  updateWorkspaceDraft,
  type DraftStatus,
  type DraftVisibility,
} from "@/lib/workspaceDraftsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const draft = await getWorkspaceDraftById(id);
    if (!draft) return jsonError("المسودة غير موجودة", 404);
    return NextResponse.json({ draft });
  } catch (error) {
    console.error("GET /api/drafts/[id] error:", error);
    return jsonError("تعذر تحميل المسودة", 500);
  }
});

export const PATCH = withTenantRoute(async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSqliteDatabaseReady();
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { action: "edit" });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const draft = await updateWorkspaceDraft(id, {
      titleAr: body.titleAr !== undefined ? String(body.titleAr) : undefined,
      titleEn: body.titleEn !== undefined ? String(body.titleEn) : undefined,
      payload:
        body.payload && typeof body.payload === "object"
          ? (body.payload as Record<string, unknown>)
          : undefined,
      totalAmount: body.totalAmount !== undefined ? (body.totalAmount === null ? null : Number(body.totalAmount)) : undefined,
      currencyCode: body.currencyCode !== undefined ? String(body.currencyCode) : undefined,
      visibility: body.visibility !== undefined ? (body.visibility as DraftVisibility) : undefined,
      status: body.status !== undefined ? (body.status as DraftStatus) : undefined,
      actor: {
        userId: actor.userId!,
        userName: actor.userDisplay,
        userRole: actor.userRole,
      },
    });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تحديث المسودة";
    const status = msg.includes("NOT_FOUND") ? 404 : msg.includes("DENIED") ? 403 : 400;
    return jsonError(msg, status);
  }
});

export const DELETE = withTenantRoute(async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSqliteDatabaseReady();
    const { id } = await context.params;
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, { action: "edit" });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const draft = await discardWorkspaceDraft(id, {
      userId: actor.userId!,
      userName: actor.userDisplay,
      userRole: actor.userRole,
    });
    return NextResponse.json({ success: true, draft });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إلغاء المسودة";
    const status = msg.includes("NOT_FOUND") ? 404 : msg.includes("DENIED") ? 403 : 400;
    return jsonError(msg, status);
  }
});

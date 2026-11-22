import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import {
  createWorkspaceDraft,
  listWorkspaceDrafts,
  type DraftVisibility,
} from "@/lib/workspaceDraftsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const moduleFilter = searchParams.get("module") || undefined;
    const formType = searchParams.get("formType") || undefined;
    const status = searchParams.get("status") || undefined;
    const includeInactive = searchParams.get("includeInactive") === "true";

    const drafts = await listWorkspaceDrafts({
      module: moduleFilter,
      formType,
      status,
      userId: auth.actor.userId ?? undefined,
      userRole: auth.actor.userRole,
      includeInactive,
    });
    return NextResponse.json({
      drafts,
      activeCount: drafts.filter((d) => d.status === "ACTIVE_DRAFT" || d.status === "SUBMITTED_FOR_APPROVAL").length,
    });
  } catch (error) {
    console.error("GET /api/drafts error:", error);
    return jsonError("تعذر تحميل المسودات / Failed to load drafts", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { action: "create" });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const draft = await createWorkspaceDraft({
      module: String(body.module || "ACCOUNTING"),
      formType: String(body.formType || "GENERIC"),
      entityId: body.entityId ? String(body.entityId) : null,
      titleAr: String(body.titleAr || "مسودة بدون عنوان"),
      titleEn: body.titleEn ? String(body.titleEn) : undefined,
      payload:
        body.payload && typeof body.payload === "object"
          ? (body.payload as Record<string, unknown>)
          : {},
      totalAmount: body.totalAmount !== undefined && body.totalAmount !== null ? Number(body.totalAmount) : null,
      currencyCode: body.currencyCode ? String(body.currencyCode) : "YER",
      visibility: (body.visibility === "PRIVATE" ? "PRIVATE" : "SHARED_WORKSPACE") as DraftVisibility,
      actor: {
        userId: actor.userId!,
        userName: actor.userDisplay,
        userRole: actor.userRole,
      },
    });
    return NextResponse.json({ success: true, draft }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر حفظ المسودة";
    return jsonError(msg, msg.startsWith("DRAFT_") ? 400 : 500);
  }
});

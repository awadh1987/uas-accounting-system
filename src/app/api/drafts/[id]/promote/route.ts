import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { promoteWorkspaceDraft } from "@/lib/workspaceDraftsEngine";
import { withIdempotency } from "@/lib/idempotencyGuard";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const { id } = await context.params;
      let body: Record<string, unknown> = {};
      try {
        body = (await r.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const auth = await authorizeApiAction(body, r, { action: "post" });
      if (!auth.ok) return auth.response;
      const actor = auth.actor;

      const promoted = await promoteWorkspaceDraft(id, {
        userId: actor.userId!,
        userName: actor.userDisplay,
        userRole: actor.userRole,
      });
      return NextResponse.json({ success: true, ...promoted }, { status: 200 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "تعذر ترحيل المسودة";
      const status = msg.includes("NOT_FOUND") ? 404 : 400;
      return jsonError(msg, status);
    }
  });
});

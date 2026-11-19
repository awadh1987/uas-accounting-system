import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";
import { promoteWorkspaceDraft } from "@/lib/workspaceDraftsEngine";

export const dynamic = "force-dynamic";

export async function POST(
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
    const actor = extractActor(body, req);
    const promoted = await promoteWorkspaceDraft(id, {
      userId: actor.userId || "u1",
      userName: actor.userDisplay || "مستخدم النظام",
      userRole: actor.userRole,
    });
    return NextResponse.json({ success: true, ...promoted }, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر ترحيل المسودة";
    const status = msg.includes("NOT_FOUND") ? 404 : 400;
    return jsonError(msg, status);
  }
}

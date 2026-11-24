import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import {
  getTenantFormConfig,
  saveTenantFormConfig,
  type TenantFormConfig,
} from "@/lib/clientPortal/portalConfig";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "system" });
    if (!auth.ok) return auth.response;

    const formConfig = await getTenantFormConfig();
    return NextResponse.json({ success: true, formConfig });
  } catch (err) {
    console.error("GET /api/portal-admin/form-config error:", err);
    return jsonError("تعذر تحميل إعدادات نماذج البوابة", 500);
  }
});

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "edit",
    });
    if (!auth.ok) return auth.response;

    const patch = (
      body.formConfig && typeof body.formConfig === "object" ? body.formConfig : body
    ) as Partial<TenantFormConfig>;

    const saved = await saveTenantFormConfig(patch, auth.actor.userId);
    return NextResponse.json({
      success: true,
      formConfig: saved,
      message: "✅ تم حفظ إعدادات نماذج بوابة العملاء بنجاح",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر حفظ إعدادات البوابة";
    return jsonError(msg, 400);
  }
});

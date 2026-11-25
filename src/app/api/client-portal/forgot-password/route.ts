import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import {
  clearClientSessionCookie,
  resolveRequestTenantScope,
} from "@/lib/clientPortal/clientAuth";
import {
  confirmClientPasswordReset,
  requestClientPasswordReset,
} from "@/lib/clientPortal/portalService";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * POST /api/client-portal/forgot-password
 * Public tenant-scoped self-service password reset:
 * - action="REQUEST" (default): generates short-lived single-use reset code, queues editable WhatsApp draft
 *   for staff approval / optional email webhook without leaking account existence.
 * - action="CONFIRM": verifies single-use code + identifier, sets new password, clears mustChangePassword,
 *   and revokes all prior client portal sessions.
 */
export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const scope = resolveRequestTenantScope(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "REQUEST").trim().toUpperCase();
    const identifier = String(body.identifier || body.phone || body.email || "").trim();

    if (action === "CONFIRM") {
      const code = String(body.code || body.resetCode || "").trim();
      const newPassword = String(body.newPassword || "").trim();
      await confirmClientPasswordReset({
        identifier,
        code,
        newPassword,
        tenantSlug: scope.tenantSlug,
      });

      const res = NextResponse.json({
        success: true,
        message: "✅ تم تحديث كلمة المرور بنجاح، يمكنك الآن تسجيل الدخول بكلمتك الجديدة",
      });
      return clearClientSessionCookie(res, req);
    }

    const portalUrl = `${resolveTenantCloudUrl(scope.tenantSlug)}/portal`;
    const ipHint =
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "client";

    const result = await requestClientPasswordReset({
      identifier,
      tenantSlug: scope.tenantSlug,
      tenantId: scope.tenantId,
      portalUrl,
      ipHint,
    });

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تنفيذ طلب استعادة كلمة المرور";
    const status = msg.includes("تجاوز الحد المسموح") ? 429 : 400;
    return jsonError(msg, status);
  }
});

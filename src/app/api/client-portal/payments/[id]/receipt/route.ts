import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError, resolveVerifiedActor } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient, resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { readAuthorizedPaymentReceiptFile } from "@/lib/clientPortal/paymentGateService";
import { canAccessModule } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/client-portal/payments/[id]/receipt
 * Serves payment receipt attachments ONLY to:
 *  1. The owning authenticated client within the matching tenantSlug, OR
 *  2. An authenticated staff user of that same tenant with sales/customers/treasury access.
 * Never exposed publicly or unauthenticated.
 */
export const GET = withTenantRoute(async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const scope = resolveRequestTenantScope(req);
    await ensurePortalSchemaReady(scope.tenantSlug);
    const { id } = await context.params;

    const clientAuth = await resolveAuthenticatedClient(req);
    let authorizedClientId: string | null = null;
    let isAuthorizedStaff = false;

    if (clientAuth.ok) {
      authorizedClientId = clientAuth.account.id;
    } else {
      const staffActor = await resolveVerifiedActor({}, req);
      if (
        staffActor.authenticated &&
        staffActor.sessionVerified &&
        !staffActor.tenantMismatch &&
        !staffActor.invalidToken &&
        !staffActor.inactive &&
        (canAccessModule(staffActor.user || staffActor.userRole, "sales") ||
          canAccessModule(staffActor.user || staffActor.userRole, "customers") ||
          canAccessModule(staffActor.user || staffActor.userRole, "treasury"))
      ) {
        isAuthorizedStaff = true;
      } else if (clientAuth.status === 403 || staffActor.tenantMismatch) {
        return jsonError("⛔ غير مصرح بالوصول إلى إيصال منشأة أخرى", 403);
      } else {
        return jsonError("يرجى تسجيل الدخول للوصول إلى مرفق الإيصال", 401);
      }
    }

    const file = await readAuthorizedPaymentReceiptFile({
      tenantSlug: scope.tenantSlug,
      paymentId: id,
    });
    if (!file) {
      return jsonError("مرفق الإيصال غير موجود", 404);
    }

    if (!isAuthorizedStaff && file.clientAccountId !== authorizedClientId) {
      return jsonError("⛔ لا يمكنك الوصول إلى إيصال عميل آخر", 403);
    }

    return new NextResponse(new Uint8Array(file.buffer), {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalFileName)}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("GET /api/client-portal/payments/[id]/receipt error:", err);
    return jsonError("تعذر قراءة مرفق الإيصال", 500);
  }
});

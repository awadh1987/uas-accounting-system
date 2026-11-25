import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import {
  attachClientSessionCookie,
  issueClientPortalToken,
  resolveRequestTenantScope,
} from "@/lib/clientPortal/clientAuth";
import { registerClientPortalAccount } from "@/lib/clientPortal/portalService";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const scope = resolveRequestTenantScope(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const portalUrl = `${resolveTenantCloudUrl(scope.tenantSlug)}/portal`;

    const account = await registerClientPortalAccount({
      fullName: String(body.fullName || ""),
      tradeName: body.tradeName ? String(body.tradeName) : undefined,
      phone: String(body.phone || ""),
      email: String(body.email || ""),
      password: String(body.password || ""),
      clientType: body.clientType ? String(body.clientType) : undefined,
      customClientType: body.customClientType ? String(body.customClientType) : undefined,
      preferredPickup: body.preferredPickup ? String(body.preferredPickup) : undefined,
      customFields:
        body.customFields && typeof body.customFields === "object"
          ? (body.customFields as Record<string, unknown>)
          : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      portalUrl,
    });

    const token = issueClientPortalToken({
      clientAccountId: account.id,
      customerId: account.customerId,
      tenantId: scope.tenantId,
      tenantSlug: scope.tenantSlug,
      phone: account.phone,
      displayName: account.fullName,
    });

    const res = NextResponse.json(
      {
        success: true,
        account,
        token,
        requiresApproval: account.status !== "ACTIVE",
        message:
          account.status === "ACTIVE"
            ? "✅ تم تسجيل وتفعيل حسابك في البوابة بنجاح"
            : "✅ تم استلام طلب تسجيلك بنجاح وهو بانتظار اعتماد إدارة المنشأة",
      },
      { status: 201 }
    );
    return attachClientSessionCookie(res, token, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تسجيل الحساب";
    const status = msg.includes("مسجل مسبقاً") ? 409 : 400;
    return jsonError(msg, status);
  }
});

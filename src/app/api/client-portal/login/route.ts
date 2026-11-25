import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import {
  attachClientSessionCookie,
  clearClientSessionCookie,
  issueClientPortalToken,
  resolveRequestTenantScope,
} from "@/lib/clientPortal/clientAuth";
import { authenticateClientPortalAccount } from "@/lib/clientPortal/portalService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const scope = resolveRequestTenantScope(req);
    await ensurePortalSchemaReady(scope.tenantSlug);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const identifier = String(body.identifier || body.phone || body.email || "");
    const password = String(body.password || "");

    const { sessionVersion, ...account } = await authenticateClientPortalAccount({
      identifier,
      password,
      tenantSlug: scope.tenantSlug,
      tenantId: scope.tenantId,
    });
    const token = issueClientPortalToken({
      clientAccountId: account.id,
      globalClientId: account.globalClientId,
      customerId: account.customerId,
      tenantId: scope.tenantId,
      tenantSlug: scope.tenantSlug,
      phone: account.phone,
      displayName: account.fullName,
      sessionVersion,
    });

    const res = NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      account,
      token,
    });
    return attachClientSessionCookie(res, token, req, scope.tenantSlug);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تسجيل الدخول";
    const status = msg.includes("رفض") || msg.includes("تعليق") ? 403 : 401;
    return jsonError(msg, status);
  }
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  const scope = resolveRequestTenantScope(req);
  const res = NextResponse.json({ success: true });
  return clearClientSessionCookie(res, req, scope.tenantSlug);
});

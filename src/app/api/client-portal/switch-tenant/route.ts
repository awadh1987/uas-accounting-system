import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import {
  attachClientSessionCookie,
  issueClientPortalToken,
  resolveAuthenticatedClient,
} from "@/lib/clientPortal/clientAuth";
import {
  findClientAccountByIdentifier,
  registerClientPortalAccount,
  sanitizeClientAccount,
} from "@/lib/clientPortal/portalService";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";
import { resolveTenantBySlugAsync, runWithTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * POST /api/client-portal/switch-tenant
 * Switches an authenticated client's workspace to another tenant where their Global Identity
 * is registered (or joins a new active tenant using the same Global Identity when `joinIfMissing: true`),
 * issuing a strictly target-tenant-scoped `(targetTenantSlug, targetClientId)` token & cookie.
 */
export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const targetSlug = String(body.targetTenantSlug || body.tenantSlug || "")
      .trim()
      .toLowerCase();
    if (!targetSlug) {
      return jsonError("يرجى تحديد معرف المنشأة المستهدفة (targetTenantSlug)", 400);
    }

    const targetMeta = await resolveTenantBySlugAsync(targetSlug);
    if (!targetMeta && targetSlug !== "default") {
      return jsonError("المنشأة المستهدفة غير موجودة", 404);
    }
    if (targetMeta && targetMeta.status !== "ACTIVE") {
      return jsonError("مساحة المنشأة المستهدفة غير نشطة حالياً", 403);
    }

    const targetTenantId = targetMeta?.tenantId || "default";
    const resolvedTargetSlug = targetMeta?.slug || targetSlug;
    const joinIfMissing = Boolean(body.joinIfMissing);
    const phone = auth.account.normalizedPhone || auth.account.phone;
    const email = auth.account.normalizedEmail || auth.account.email;

    const switched = await runWithTenant(targetMeta?.slug || targetTenantId, async () => {
      await ensurePortalSchemaReady(resolvedTargetSlug);
      let targetAcc =
        (await findClientAccountByIdentifier(phone, resolvedTargetSlug)) ||
        (await findClientAccountByIdentifier(email, resolvedTargetSlug));

      if (!targetAcc && joinIfMissing) {
        await registerClientPortalAccount({
          fullName: auth.account.fullName,
          tradeName: auth.account.tradeName || undefined,
          phone,
          email,
          password: "GLOBAL_IDENTITY_SWITCH",
          clientType: auth.account.clientType,
          preferredPickup: auth.account.preferredPickup,
          portalUrl: `${resolveTenantCloudUrl(resolvedTargetSlug)}/portal`,
          tenantSlug: resolvedTargetSlug,
          tenantId: targetTenantId,
          tenantName: targetMeta?.nameAr || targetMeta?.companyName,
          skipGlobalPasswordCheck: true,
        });
        targetAcc = await findClientAccountByIdentifier(phone, resolvedTargetSlug);
        if (targetAcc) {
          targetAcc = await prisma.clientPortalAccount.update({
            where: { id: targetAcc.id },
            data: { passwordHash: auth.account.passwordHash },
          });
        }
      }

      if (!targetAcc) {
        return { notFound: true as const };
      }

      if (targetAcc.status === "REJECTED") {
        throw new Error(targetAcc.rejectedReason || "تم رفض هذا الحساب في المنشأة المستهدفة");
      }
      if (targetAcc.status === "SUSPENDED") {
        throw new Error("تم تعليق هذا الحساب في المنشأة المستهدفة");
      }

      let creditLimit = 0;
      if (targetAcc.customerId) {
        const cust = await prisma.customer.findUnique({
          where: { id: targetAcc.customerId },
          select: { creditLimit: true },
        });
        creditLimit = Number(cust?.creditLimit || 0);
      }

      return {
        notFound: false as const,
        account: sanitizeClientAccount(targetAcc, creditLimit),
        sessionVersion: targetAcc.sessionVersion ?? 1,
      };
    });

    if (switched.notFound) {
      return jsonError("حسابك غير مسجل في المنشأة المستهدفة بعد", 404);
    }

    const token = issueClientPortalToken({
      clientAccountId: switched.account.id,
      globalClientId: switched.account.globalClientId || auth.account.globalClientId,
      customerId: switched.account.customerId,
      tenantId: targetTenantId,
      tenantSlug: resolvedTargetSlug,
      phone: switched.account.phone,
      displayName: switched.account.fullName,
      sessionVersion: switched.sessionVersion,
    });

    const res = NextResponse.json({
      success: true,
      tenantSlug: resolvedTargetSlug,
      tenantId: targetTenantId,
      tenantUrl: `${resolveTenantCloudUrl(resolvedTargetSlug)}/portal`,
      account: switched.account,
      token,
    });
    return attachClientSessionCookie(res, token, req, resolvedTargetSlug);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر التبديل إلى المنشأة المستهدفة";
    return jsonError(msg, 400);
  }
});

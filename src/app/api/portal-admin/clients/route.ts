import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { canApprovePortalClients, canResetPortalClientPassword } from "@/lib/permissions";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import {
  sanitizeClientAccount,
  staffResetClientPassword,
  staffReviewClientRegistration,
} from "@/lib/clientPortal/portalService";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "customers" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();

    const [accounts, customers] = await Promise.all([
      prisma.clientPortalAccount.findMany({
        where: status && status !== "ALL" ? { status } : undefined,
        orderBy: [{ createdAt: "desc" }],
        take: 250,
      }),
      prisma.customer.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          nameAr: true,
          phone: true,
          creditLimit: true,
          account: { select: { code: true } },
        },
        orderBy: { nameAr: "asc" },
      }),
    ]);

    const custMap = new Map(customers.map((c) => [c.id, c]));

    return NextResponse.json({
      success: true,
      clients: accounts.map((acc) => {
        const linkedCust = acc.customerId ? custMap.get(acc.customerId) : undefined;
        return {
          ...sanitizeClientAccount(acc, Number(linkedCust?.creditLimit || 0)),
          linkedCustomerCode: linkedCust?.code || null,
          linkedAccountCode: linkedCust?.account?.code || null,
        };
      }),
      availableCustomers: customers.map((c) => ({
        id: c.id,
        code: c.code,
        nameAr: c.nameAr,
        phone: c.phone,
        creditLimit: Number(c.creditLimit || 0),
        accountCode: c.account?.code || null,
      })),
    });
  } catch (err) {
    console.error("GET /api/portal-admin/clients error:", err);
    return jsonError("تعذر تحميل قائمة حسابات بوابة العملاء", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "customers",
      action: "edit",
    });
    if (!auth.ok) return auth.response;

    const clientAccountId = String(body.clientAccountId || "").trim();
    const actionRaw = String(body.action || "").trim().toUpperCase();
    const action =
      actionRaw === "APPROVE" ||
        actionRaw === "REJECT" ||
        actionRaw === "SUSPEND" ||
        actionRaw === "RESET_PASSWORD"
        ? actionRaw
        : null;

    if (!clientAccountId || !action) {
      return jsonError(
        "clientAccountId و action (APPROVE / REJECT / SUSPEND / RESET_PASSWORD) مطلوبان",
        400
      );
    }

    const scope = resolveRequestTenantScope(req);
    const portalUrl = `${resolveTenantCloudUrl(scope.tenantSlug)}/portal`;

    if (action === "RESET_PASSWORD") {
      if (!canResetPortalClientPassword(auth.actor.user || auth.actor.userRole)) {
        return forbiddenError("⛔ ليس لديك صلاحية إعادة تعيين كلمات مرور عملاء البوابة");
      }
      const resetResult = await staffResetClientPassword({
        clientAccountId,
        customTemporaryPassword: body.temporaryPassword
          ? String(body.temporaryPassword)
          : undefined,
        portalUrl,
        tenantSlug: scope.tenantSlug,
        actor: {
          userId: auth.actor.userId,
          userDisplay: auth.actor.userDisplay || "مسؤول النظام",
          userRole: auth.actor.userRole,
        },
      });

      return NextResponse.json({
        success: true,
        client: resetResult.client,
        temporaryPassword: resetResult.temporaryPassword,
        resetCode: resetResult.resetCode,
        expiresAt: resetResult.expiresAt,
        message: "✅ تم إنشاء كلمة مرور مؤقتة للعميل وإدراج إشعار واتساب للمراجعة والإرسال",
      });
    }

    if (!canApprovePortalClients(auth.actor.user || auth.actor.userRole)) {
      return forbiddenError("⛔ ليس لديك صلاحية اعتماد أو تعليق حسابات عملاء البوابة");
    }

    const updated = await staffReviewClientRegistration({
      clientAccountId,
      action,
      creditLimit:
        body.creditLimit !== undefined && body.creditLimit !== ""
          ? Number(body.creditLimit)
          : undefined,
      linkCustomerId: body.linkCustomerId ? String(body.linkCustomerId) : undefined,
      rejectedReason: body.rejectedReason ? String(body.rejectedReason) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      portalUrl,
      actor: {
        userId: auth.actor.userId,
        userDisplay: auth.actor.userDisplay || "مسؤول النظام",
        userRole: auth.actor.userRole,
      },
    });

    return NextResponse.json({
      success: true,
      client: updated,
      message:
        action === "APPROVE"
          ? "✅ تم اعتماد حساب العميل وربطه بشجرة الحسابات وإعداد إشعار واتساب"
          : "✅ تم تحديث حالة حساب العميل",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تنفيذ العملية على حساب العميل";
    return jsonError(msg, 400);
  }
});

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { canApprovePortalClients, canResetPortalClientPassword } from "@/lib/permissions";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { portalErrorStatus, stripPolicyPrefix } from "@/lib/clientPortal/portalPolicy";
import {
  sanitizeClientAccount,
  staffBulkSetClientSectorMode,
  staffManageClientAccount,
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
    const scope = resolveRequestTenantScope(req);
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();
    const search = (searchParams.get("search") || searchParams.get("q") || "").trim();
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("pageSize") || searchParams.get("limit") || "50", 10) || 50));

    const whereClause: Record<string, unknown> = {
      ...(scope.tenantSlug && scope.tenantSlug !== "default" ? { tenantSlug: scope.tenantSlug } : {}),
      ...(status && status !== "ALL" ? { status } : {}),
      ...(status === "ALL" && searchParams.get("includeArchived") !== "1" ? { status: { not: "ARCHIVED" } } : {}),
      ...(search
        ? {
          OR: [
            { fullName: { contains: search } },
            { tradeName: { contains: search } },
            { phone: { contains: search } },
            { normalizedPhone: { contains: search } },
            { email: { contains: search } },
          ],
        }
        : {}),
    };

    const [total, accounts, customers] = await Promise.all([
      prisma.clientPortalAccount.count({ where: whereClause }),
      prisma.clientPortalAccount.findMany({
        where: whereClause,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
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
        take: 250,
      }),
    ]);

    const custMap = new Map(customers.map((c) => [c.id, c]));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page < totalPages,
      },
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

    const rawAction = String(body.action || "").trim().toUpperCase();
    const MANAGE_ACTIONS = [
      "SUSPEND",
      "ARCHIVE",
      "REACTIVATE",
      "REVOKE_SESSIONS",
      "SET_SECTORS",
      "SET_CREDIT_LIMIT",
      "BULK_SET_SECTORS",
    ];
    if (MANAGE_ACTIONS.includes(rawAction)) {
      if (!canApprovePortalClients(auth.actor.user || auth.actor.userRole)) {
        return forbiddenError("⛔ ليس لديك صلاحية إدارة حسابات عملاء البوابة");
      }
      const actor = {
        userId: auth.actor.userId,
        userDisplay: auth.actor.userDisplay || "مسؤول النظام",
        userRole: auth.actor.userRole,
      };
      try {
        if (rawAction === "BULK_SET_SECTORS") {
          const bulk = await staffBulkSetClientSectorMode({
            clientAccountIds: Array.isArray(body.clientAccountIds)
              ? body.clientAccountIds.map((x) => String(x))
              : [],
            sectorMode: String(body.sectorMode || ""),
            tenantSlug: resolveRequestTenantScope(req).tenantSlug,
            actor,
          });
          return NextResponse.json({ success: true, ...bulk, message: `✅ تم تحديث القطاعات لـ ${bulk.updatedCount} عميل` });
        }
        const client = await staffManageClientAccount({
          clientAccountId: String(body.clientAccountId || "").trim(),
          action: rawAction as "SUSPEND",
          sectorMode: body.sectorMode !== undefined ? String(body.sectorMode) : undefined,
          creditLimit: body.creditLimit !== undefined && body.creditLimit !== "" ? Number(body.creditLimit) : undefined,
          reason: body.reason ? String(body.reason) : undefined,
          actor,
        });
        return NextResponse.json({ success: true, client, message: "✅ تم تنفيذ الإجراء على حساب العميل" });
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : "تعذر تنفيذ الإجراء";
        return jsonError(stripPolicyPrefix(m), portalErrorStatus(e));
      }
    }

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
        message: "✅ تم إنشاء كلمة مرور مؤقتة للعميل وإدراج إشعار للمراجعة والإرسال",
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
          ? "✅ تم اعتماد حساب العميل وربطه بشجرة الحسابات وإعداد إشعار للعميل"
          : "✅ تم تحديث حالة حساب العميل",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تنفيذ العملية على حساب العميل";
    return jsonError(msg, 400);
  }
});

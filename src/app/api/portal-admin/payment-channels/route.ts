import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import {
  deleteOrTogglePaymentChannel,
  listTenantPaymentChannels,
  PAYMENT_CHANNEL_PROVIDER_PRESETS,
  saveTenantPaymentChannel,
  type PaymentChannelCategory,
} from "@/lib/clientPortal/paymentGateService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const scope = resolveRequestTenantScope(req);
    await ensurePortalSchemaReady(scope.tenantSlug);
    const auth = await authorizeApiAction({}, req, { moduleId: "sales" });
    if (!auth.ok) return auth.response;

    const [channels, treasuries] = await Promise.all([
      listTenantPaymentChannels({ tenantSlug: scope.tenantSlug }),
      prisma.treasuryAccount.findMany({
        where: { isActive: true },
        include: { account: { select: { id: true, code: true, nameAr: true } } },
        orderBy: [{ type: "asc" }, { code: "asc" }],
      }),
    ]);

    return NextResponse.json({
      success: true,
      tenantSlug: scope.tenantSlug,
      channels,
      presets: PAYMENT_CHANNEL_PROVIDER_PRESETS,
      treasuries: treasuries.map((t) => ({
        id: t.id,
        code: t.code,
        nameAr: t.nameAr,
        type: t.type,
        currency: t.currency,
        accountNumber: t.accountNumber,
        accountId: t.accountId,
        glAccountCode: t.account?.code || null,
        glAccountNameAr: t.account?.nameAr || null,
      })),
    });
  } catch (err) {
    console.error("GET /api/portal-admin/payment-channels error:", err);
    return jsonError("تعذر تحميل قنوات استلام السداد", 500);
  }
});

async function handleSaveChannel(req: NextRequest) {
  try {
    const scope = resolveRequestTenantScope(req);
    await ensurePortalSchemaReady(scope.tenantSlug);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
    });
    if (!auth.ok) return auth.response;

    const channel = await saveTenantPaymentChannel({
      id: body.id ? String(body.id) : null,
      tenantSlug: scope.tenantSlug,
      category: String(body.category || "WALLET").toUpperCase() as PaymentChannelCategory,
      providerCode: body.providerCode ? String(body.providerCode) : "CUSTOM",
      displayNameAr: String(body.displayNameAr || ""),
      displayNameEn: body.displayNameEn ? String(body.displayNameEn) : null,
      currency: body.currency ? String(body.currency) : "YER",
      accountOrWalletNumber: String(body.accountOrWalletNumber || ""),
      beneficiaryName: String(body.beneficiaryName || ""),
      ibanOrBranch: body.ibanOrBranch ? String(body.ibanOrBranch) : null,
      qrImageUrl: body.qrImageUrl !== undefined ? (body.qrImageUrl ? String(body.qrImageUrl) : null) : null,
      instructionsAr: body.instructionsAr ? String(body.instructionsAr) : null,
      treasuryAccountId: String(body.treasuryAccountId || ""),
      displayOrder: body.displayOrder !== undefined ? Number(body.displayOrder) : 1,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      actor: {
        userId: auth.actor.userId,
        userDisplay: auth.actor.userDisplay || "مسؤول النظام",
        userRole: auth.actor.userRole,
      },
    });

    return NextResponse.json(
      {
        success: true,
        channel,
        message: body.id
          ? "✅ تم تحديث قناة استلام السداد بنجاح"
          : "✅ تم إضافة قناة استلام السداد وربطها بالحساب المحاسبي بنجاح",
      },
      { status: body.id ? 200 : 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر حفظ قناة استلام السداد";
    return jsonError(msg, 400);
  }
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return handleSaveChannel(req);
});

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  return handleSaveChannel(req);
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    const scope = resolveRequestTenantScope(req);
    await ensurePortalSchemaReady(scope.tenantSlug);
    const { searchParams } = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
    });
    if (!auth.ok) return auth.response;

    const id = String(searchParams.get("id") || body.id || "").trim();
    if (!id) return jsonError("معرف قناة السداد مطلوب", 400);

    const res = await deleteOrTogglePaymentChannel({
      tenantSlug: scope.tenantSlug,
      id,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      remove: body.remove !== undefined ? Boolean(body.remove) : searchParams.get("remove") === "1",
      actor: {
        userId: auth.actor.userId,
        userDisplay: auth.actor.userDisplay || "مسؤول النظام",
        userRole: auth.actor.userRole,
      },
    });

    return NextResponse.json({
      success: true,
      ...res,
      message: "✅ تم تحديث حالة قناة السداد",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر حذف أو تعطيل قناة السداد";
    return jsonError(msg, 400);
  }
});

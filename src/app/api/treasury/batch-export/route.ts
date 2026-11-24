import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction } from "@/lib/apiHelpers";
import { resolveRequestTenantScope } from "@/lib/clientPortal/clientAuth";
import { exportBulkBankTransferFile } from "@/lib/treasury/bankWalletGateway";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
    });
    if (!auth.ok) return auth.response;

    const scope = resolveRequestTenantScope(req);
    const treasuryAccountId = String(body.treasuryAccountId || "");
    const treasuryName = body.treasuryName ? String(body.treasuryName) : undefined;
    const provider = body.provider ? (String(body.provider) as Parameters<typeof exportBulkBankTransferFile>[0]["provider"]) : undefined;
    const format = body.format === "csv" ? "csv" : "xlsx";
    const items = Array.isArray(body.items)
      ? (body.items as Parameters<typeof exportBulkBankTransferFile>[0]["items"])
      : [];

    if (items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "ITEMS_ARRAY_REQUIRED: Please provide at least one payout item." },
        { status: 400 }
      );
    }

    const result = exportBulkBankTransferFile({
      treasuryAccountId,
      treasuryName,
      provider,
      items,
      format,
      exportedBy: {
        username: auth.actor.userDisplay || "treasury_user",
        displayName: auth.actor.userDisplay || "مسؤول الخزينة",
        titleAr:
          auth.actor.userRole === "SUPER_ADMIN"
            ? "مدير النظام العام"
            : auth.actor.userRole === "CHIEF_ACCOUNTANT"
            ? "رئيس الحسابات"
            : "مسؤول الخزينة والعمليات",
        tenantSlug: scope.tenantSlug,
      },
    });

    const base64 = result.buffer.toString("base64");
    const mimeType =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return NextResponse.json({
      ok: true,
      filename: result.filename,
      mimeType,
      base64,
      count: result.count,
      totalAmount: result.totalAmount,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "BATCH_EXPORT_FAILED";
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 400 }
    );
  }
});

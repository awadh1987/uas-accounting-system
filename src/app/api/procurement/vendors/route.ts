import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import {
  createVendorWithAccountTx,
  recordAuditDiffTx,
} from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { withIdempotency } from "@/lib/idempotencyGuard";
import {
  archiveMasterRecord,
  restoreMasterRecord,
  safeDeleteOrArchiveMasterRecord,
} from "@/lib/masterLifecycle";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET() {
  try {
    const vendors = await prisma.vendor.findMany({
      orderBy: { code: "asc" },
      include: {
        account: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        bills: { select: { id: true, totalAmount: true, paidAmount: true, balanceDue: true, status: true } },
        purchaseOrders: { select: { id: true } },
        payments: { select: { id: true, amount: true } },
      },
    });

    const mapped = vendors.map((v) => {
      const totalBilled = v.bills.reduce((s, b) => s + Number(b.totalAmount), 0);
      const totalPaid = v.bills.reduce((s, b) => s + Number(b.paidAmount), 0);
      const totalDue = v.bills.reduce((s, b) => s + Number(b.balanceDue), 0);
      return {
        id: v.id,
        code: v.code,
        nameAr: v.nameAr,
        nameEn: v.nameEn,
        phone: v.phone,
        email: v.email,
        taxRegistration: v.taxRegistration,
        address: v.address,
        accountId: v.accountId,
        account: v.account,
        poCount: v.purchaseOrders.length,
        billCount: v.bills.length,
        totalBilled,
        totalPaid,
        totalDue,
        isActive: v.isActive ?? true,
        archivedAt: v.archivedAt ? v.archivedAt.toISOString() : null,
      };
    });

    return NextResponse.json({ vendors: mapped });
  } catch (error) {
    console.error("GET /api/procurement/vendors error:", error);
    return jsonError("تعذر تحميل قائمة الموردين", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "procurement",
        action: "create",
      });
      if (!auth.ok) return auth.response;

      const nameAr = String(body.nameAr || "").trim();
      const nameEn = body.nameEn ? String(body.nameEn).trim() : undefined;
      const phone = String(body.phone || "").trim();
      const email = body.email ? String(body.email).trim() : undefined;
      const taxRegistration = body.taxRegistration ? String(body.taxRegistration).trim() : undefined;
      const address = body.address ? String(body.address).trim() : undefined;

      if (!nameAr) {
        return jsonError("يرجى إدخال اسم المورد", 400);
      }

      const vendor = await prisma.$transaction(async (tx) => {
        const created = await createVendorWithAccountTx(tx, {
          nameAr,
          nameEn,
          phone,
          email,
          taxRegistration,
          address,
          costCenterId: body.costCenterId ? String(body.costCenterId).trim() : undefined,
        });
        await recordAuditDiffTx(tx, {
          userId: auth.actor.userId,
          action: "CREATE",
          entity: "Vendor",
          entityId: created.id,
          before: null,
          after: { code: created.code, nameAr: created.nameAr, phone: created.phone },
        });
        return created;
      });

      return NextResponse.json({ vendor }, { status: 201 });
    } catch (error) {
      console.error("POST /api/procurement/vendors error:", error);
      return jsonError("تعذر إنشاء ملف المورد", 500);
    }
  });
});

async function handleVendorUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "edit",
    });
    if (!auth.ok) return auth.response;

    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف المورد مطلوب للتحديث", 400);

    const existing = await prisma.vendor.findUnique({ where: { id } });
    if (!existing) return jsonError("المورد غير موجود", 404);

    const nextNameAr = body.nameAr !== undefined ? String(body.nameAr).trim() : existing.nameAr;
    const nextNameEn =
      body.nameEn !== undefined
        ? body.nameEn
          ? String(body.nameEn).trim()
          : null
        : existing.nameEn;

    const vendor = await prisma.$transaction(async (tx) => {
      const updated = await tx.vendor.update({
        where: { id },
        data: {
          nameAr: nextNameAr,
          nameEn: nextNameEn,
          ...(body.phone !== undefined ? { phone: String(body.phone).trim() } : {}),
          ...(body.email !== undefined
            ? { email: body.email ? String(body.email).trim() : null }
            : {}),
          ...(body.taxRegistration !== undefined
            ? { taxRegistration: body.taxRegistration ? String(body.taxRegistration).trim() : null }
            : {}),
          ...(body.address !== undefined
            ? { address: body.address ? String(body.address).trim() : null }
            : {}),
          ...(body.costCenterId !== undefined
            ? { costCenterId: body.costCenterId ? String(body.costCenterId).trim() : null }
            : {}),
        },
        include: { account: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      });

      if (body.nameAr !== undefined || body.nameEn !== undefined) {
        await tx.account.update({
          where: { id: existing.accountId },
          data: { nameAr: nextNameAr, nameEn: nextNameEn || nextNameAr },
        });
      }

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "Vendor",
        entityId: id,
        before: { nameAr: existing.nameAr, phone: existing.phone, address: existing.address },
        after: { nameAr: updated.nameAr, phone: updated.phone, address: updated.address },
      });

      return updated;
    });

    return NextResponse.json({ vendor });
  } catch (error) {
    console.error("PATCH /api/procurement/vendors error:", error);
    return jsonError("تعذر تحديث بيانات المورد", 500);
  }
}

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  return handleVendorUpdate(req);
});

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  return handleVendorUpdate(req);
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "delete",
    });
    if (!auth.ok) return auth.response;

    const id = searchParams.get("id") || String(body.id || "");
    const action = String(body.action || searchParams.get("action") || "SAFE_DELETE").toUpperCase();
    if (!id) return jsonError("معرف المورد مطلوب للحذف", 400);

    const actor = {
      userId: auth.actor.userId,
      userRole: auth.actor.userRole,
      userDisplay: auth.actor.userDisplay,
    };

    let result;
    if (action === "ARCHIVE") {
      result = await archiveMasterRecord("Vendor", id, actor);
    } else if (action === "RESTORE") {
      result = await restoreMasterRecord("Vendor", id, actor);
    } else {
      result = await safeDeleteOrArchiveMasterRecord("Vendor", id, actor);
    }

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/procurement/vendors error:", error);
    return jsonError("تعذر حذف أو أرشفة المورد", 500);
  }
});


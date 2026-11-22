import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import {
  ensureCustomerWithAccountTx,
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
    const customers = await prisma.customer.findMany({
      orderBy: { code: "asc" },
      include: {
        account: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        invoices: {
          select: { id: true, totalAmount: true, paidAmount: true, balanceDue: true },
        },
        sales: { select: { id: true, totalAmount: true, creditPaid: true, debitReceivable: true } },
      },
    });

    return NextResponse.json({
      customers: customers.map((c) => {
        const totalInvoiced = c.invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
        const totalCollected = c.invoices.reduce((s, i) => s + Number(i.paidAmount), 0);
        const totalReceivable = c.invoices.reduce((s, i) => s + Number(i.balanceDue), 0);
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          phone: c.phone,
          address: c.address,
          creditLimit: Number(c.creditLimit) || 0,
          accountId: c.accountId,
          account: c.account,
          invoiceCount: c.invoices.length,
          saleCount: c.sales.length,
          totalInvoiced,
          totalCollected,
          totalReceivable,
          isActive: c.isActive ?? true,
          archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
        };
      }),
    });
  } catch (error) {
    console.error("GET /api/sales/customers error:", error);
    return jsonError("تعذر تحميل قائمة العملاء", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "customers",
        action: "create",
      });
      if (!auth.ok) return auth.response;

      const name = String(body.nameAr || body.name || "").trim();
      if (!name) return jsonError("يرجى إدخال اسم العميل", 400);

      const customer = await prisma.$transaction(async (tx) => {
        const created = await ensureCustomerWithAccountTx(tx, {
          name,
          nameEn: body.nameEn ? String(body.nameEn).trim() : undefined,
          phone: body.phone ? String(body.phone).trim() : undefined,
          address: body.address ? String(body.address).trim() : undefined,
          costCenterId: body.costCenterId ? String(body.costCenterId).trim() : undefined,
        });

        if (body.creditLimit !== undefined) {
          await tx.customer.update({
            where: { id: created.id },
            data: { creditLimit: Math.max(0, Number(body.creditLimit) || 0) },
          });
        }

        await recordAuditDiffTx(tx, {
          userId: auth.actor.userId,
          action: "CREATE",
          entity: "Customer",
          entityId: created.id,
          before: null,
          after: { code: created.code, nameAr: created.nameAr, phone: created.phone },
        });

        return tx.customer.findUnique({
          where: { id: created.id },
          include: { account: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
        });
      });

      return NextResponse.json({ customer }, { status: 201 });
    } catch (error) {
      console.error("POST /api/sales/customers error:", error);
      return jsonError("تعذر إنشاء ملف العميل", 500);
    }
  });
});

async function handleUpdateCustomer(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "customers",
      action: "edit",
    });
    if (!auth.ok) return auth.response;

    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف العميل مطلوب للتحديث", 400);

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return jsonError("العميل غير موجود", 404);

    const nextNameAr =
      body.nameAr !== undefined
        ? String(body.nameAr).trim()
        : body.name !== undefined
        ? String(body.name).trim()
        : existing.nameAr;
    const nextNameEn =
      body.nameEn !== undefined ? String(body.nameEn || nextNameAr).trim() : existing.nameEn;

    const customer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: {
          name: nextNameAr,
          nameAr: nextNameAr,
          nameEn: nextNameEn,
          ...(body.phone !== undefined ? { phone: String(body.phone).trim() } : {}),
          ...(body.creditLimit !== undefined
            ? { creditLimit: Math.max(0, Number(body.creditLimit) || 0) }
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

      if (body.nameAr !== undefined || body.name !== undefined || body.nameEn !== undefined) {
        await tx.account.update({
          where: { id: existing.accountId },
          data: {
            nameAr: nextNameAr,
            nameEn: nextNameEn || nextNameAr,
          },
        });
      }

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "Customer",
        entityId: id,
        before: { nameAr: existing.nameAr, phone: existing.phone, address: existing.address },
        after: { nameAr: updated.nameAr, phone: updated.phone, address: updated.address },
      });

      return updated;
    });

    return NextResponse.json({ customer });
  } catch (error) {
    console.error("PATCH /api/sales/customers error:", error);
    return jsonError("تعذر تحديث بيانات العميل", 500);
  }
}

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  return handleUpdateCustomer(req);
});

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  return handleUpdateCustomer(req);
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
      moduleId: "customers",
      action: "delete",
    });
    if (!auth.ok) return auth.response;

    const id = searchParams.get("id") || String(body.id || "");
    const action = String(body.action || searchParams.get("action") || "SAFE_DELETE").toUpperCase();
    if (!id) return jsonError("معرف العميل مطلوب للحذف", 400);

    const actor = {
      userId: auth.actor.userId,
      userRole: auth.actor.userRole,
      userDisplay: auth.actor.userDisplay,
    };

    let result;
    if (action === "ARCHIVE") {
      result = await archiveMasterRecord("Customer", id, actor);
    } else if (action === "RESTORE") {
      result = await restoreMasterRecord("Customer", id, actor);
    } else {
      result = await safeDeleteOrArchiveMasterRecord("Customer", id, actor);
    }

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/sales/customers error:", error);
    return jsonError("تعذر حذف أو أرشفة العميل", 500);
  }
});

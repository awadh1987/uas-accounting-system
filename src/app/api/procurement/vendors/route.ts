import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createVendorWithAccountTx,
  recordAuditDiffTx,
} from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET() {
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
      };
    });

    return NextResponse.json({ vendors: mapped });
  } catch (error) {
    console.error("GET /api/procurement/vendors error:", error);
    return jsonError("تعذر تحميل قائمة الموردين", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
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
}

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

export async function PATCH(req: NextRequest) {
  return handleVendorUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleVendorUpdate(req);
}


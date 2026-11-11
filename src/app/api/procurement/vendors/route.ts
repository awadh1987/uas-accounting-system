import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createVendorWithAccountTx } from "@/lib/accounting/ledgerService";
import { jsonError } from "@/lib/apiHelpers";

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
    const nameAr = String(body.nameAr || "").trim();
    const nameEn = body.nameEn ? String(body.nameEn).trim() : undefined;
    const phone = String(body.phone || "777000000").trim();
    const email = body.email ? String(body.email).trim() : undefined;
    const taxRegistration = body.taxRegistration ? String(body.taxRegistration).trim() : undefined;
    const address = body.address ? String(body.address).trim() : undefined;

    if (!nameAr) {
      return jsonError("يرجى إدخال اسم المورد", 400);
    }

    const vendor = await prisma.$transaction((tx) =>
      createVendorWithAccountTx(tx, {
        nameAr,
        nameEn,
        phone,
        email,
        taxRegistration,
        address,
      })
    );

    return NextResponse.json({ vendor }, { status: 201 });
  } catch (error) {
    console.error("POST /api/procurement/vendors error:", error);
    return jsonError("تعذر إنشاء ملف المورد", 500);
  }
}


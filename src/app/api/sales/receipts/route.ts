import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { postCustomerReceipt } from "@/lib/accounting/ledgerService";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const receipts = await prisma.receiptVoucher.findMany({
      include: {
        customer: { select: { id: true, code: true, nameAr: true, phone: true } },
        invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, balanceDue: true } },
        treasury: { select: { id: true, code: true, nameAr: true, currency: true } },
      },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      receipts: receipts.map((r) => ({
        ...r,
        amount: Number(r.amount),
      })),
    });
  } catch (error) {
    console.error("GET /api/sales/receipts error:", error);
    return jsonError("تعذر تحميل سندات القبض", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body);
    const customerId = String(body.customerId || "").trim();
    const invoiceId = body.invoiceId ? String(body.invoiceId).trim() : null;
    const treasuryId = String(body.treasuryId || "").trim();
    const amount = Number(body.amount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!customerId || !treasuryId || amount <= 0) {
      return jsonError("يرجى تحديد العميل والخزينة وإدخال مبلغ صحيح", 400);
    }

    const result = await postCustomerReceipt({
      customerId,
      invoiceId,
      treasuryId,
      amount,
      currency,
      date: body.date ? String(body.date) : new Date(),
      notes,
      createdById: actor.userId ?? undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار سند القبض";
    return jsonError(msg, 400);
  }
}


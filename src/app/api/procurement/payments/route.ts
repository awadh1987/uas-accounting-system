import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { postVendorPayment } from "@/lib/accounting/ledgerService";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("vendorId");

    const payments = await prisma.paymentVoucher.findMany({
      where: {
        ...(vendorId && vendorId !== "ALL" ? { vendorId } : {}),
      },
      include: {
        vendor: { select: { id: true, code: true, nameAr: true, nameEn: true, phone: true } },
        bill: { select: { id: true, billNumber: true, totalAmount: true, balanceDue: true } },
        treasury: { select: { id: true, code: true, nameAr: true, nameEn: true, currency: true } },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({
      payments: payments.map((p) => ({
        id: p.id,
        voucherNumber: p.voucherNumber,
        date: p.date.toISOString(),
        vendorId: p.vendorId,
        vendor: p.vendor,
        billId: p.billId,
        bill: p.bill
          ? {
              id: p.bill.id,
              billNumber: p.bill.billNumber,
              totalAmount: Number(p.bill.totalAmount),
              balanceDue: Number(p.bill.balanceDue),
            }
          : null,
        treasuryId: p.treasuryId,
        treasury: p.treasury,
        amount: Number(p.amount),
        currency: p.currency,
        referenceNumber: p.referenceNumber,
        notes: p.notes,
        journalEntryId: p.journalEntryId,
        qrVerificationHash: p.qrVerificationHash,
      })),
    });
  } catch (error) {
    console.error("GET /api/procurement/payments error:", error);
    return jsonError("تعذر تحميل سندات صرف الموردين", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body);

    const vendorId = String(body.vendorId || "").trim();
    const billId = body.billId ? String(body.billId).trim() : null;
    const treasuryId = String(body.treasuryId || "").trim();
    const amount = Number(body.amount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const referenceNumber = body.referenceNumber ? String(body.referenceNumber).trim() : undefined;
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!vendorId || !treasuryId || amount <= 0) {
      return jsonError("يرجى تحديد المورد والخزينة وإدخال مبلغ صحيح", 400);
    }

    const result = await postVendorPayment({
      vendorId,
      billId,
      treasuryId,
      amount,
      currency,
      date: body.date ? String(body.date) : new Date(),
      referenceNumber,
      notes,
      createdById: actor.userId ?? undefined,
    });

    return NextResponse.json(
      { payment: result.voucher, journalEntry: result.journalEntry },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار سند صرف المورد";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}


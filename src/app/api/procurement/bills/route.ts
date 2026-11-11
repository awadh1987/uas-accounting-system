import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { postVendorBill } from "@/lib/accounting/ledgerService";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const vendorId = searchParams.get("vendorId");

    const bills = await prisma.vendorBill.findMany({
      where: {
        ...(projectId && projectId !== "ALL" ? { projectId } : {}),
        ...(vendorId && vendorId !== "ALL" ? { vendorId } : {}),
      },
      include: {
        vendor: { select: { id: true, code: true, nameAr: true, nameEn: true, phone: true } },
        project: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        subProject: { select: { id: true, code: true, nameAr: true } },
        purchaseOrder: {
          include: { goodsReceipts: true },
        },
        paymentVouchers: true,
      },
      orderBy: { date: "desc" },
    });

    const mapped = bills.map((b) => {
      const poTotal = b.purchaseOrder ? Number(b.purchaseOrder.grandTotal) : null;
      const grnTotal = b.purchaseOrder
        ? b.purchaseOrder.goodsReceipts.reduce((s, g) => s + Number(g.receivedTotal), 0)
        : null;
      const billTotal = Number(b.totalAmount);
      const threeWayStatus = !b.purchaseOrder
        ? "DIRECT_BILL"
        : b.purchaseOrder.goodsReceipts.length === 0
        ? "AWAITING_GRN"
        : Math.abs(billTotal - (grnTotal ?? 0)) <= 0.01 && Math.abs((poTotal ?? 0) - billTotal) <= 0.01
        ? "MATCHED"
        : "VARIANCE_DETECTED";

      return {
        id: b.id,
        billNumber: b.billNumber,
        vendorId: b.vendorId,
        vendor: b.vendor,
        projectId: b.projectId,
        project: b.project,
        subProjectId: b.subProjectId,
        subProject: b.subProject,
        purchaseOrderId: b.purchaseOrderId,
        poNumber: b.purchaseOrder?.poNumber || null,
        date: b.date.toISOString(),
        dueDate: b.dueDate ? b.dueDate.toISOString() : null,
        status: b.status,
        totalAmount: billTotal,
        paidAmount: Number(b.paidAmount),
        balanceDue: Number(b.balanceDue),
        currency: b.currency,
        isInventory: b.isInventory,
        journalEntryId: b.journalEntryId,
        notes: b.notes,
        threeWayStatus,
        paymentCount: b.paymentVouchers.length,
      };
    });

    return NextResponse.json({ bills: mapped });
  } catch (error) {
    console.error("GET /api/procurement/bills error:", error);
    return jsonError("تعذر تحميل فواتير الموردين", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body);

    const vendorId = String(body.vendorId || "").trim();
    const projectId = String(body.projectId || "").trim();
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const purchaseOrderId = body.purchaseOrderId ? String(body.purchaseOrderId).trim() : null;
    const totalAmount = Number(body.totalAmount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const isInventory = Boolean(body.isInventory);
    const debitAccountCode = body.debitAccountCode ? String(body.debitAccountCode).trim() : undefined;
    const debitAccountId = body.debitAccountId ? String(body.debitAccountId).trim() : undefined;
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!vendorId || !projectId || totalAmount <= 0) {
      return jsonError("يرجى تحديد المورد والمشروع وإدخال مبلغ الفاتورة", 400);
    }

    const result = await postVendorBill({
      vendorId,
      projectId,
      subProjectId,
      purchaseOrderId,
      totalAmount,
      currency,
      date: body.date ? String(body.date) : new Date(),
      dueDate: body.dueDate ? String(body.dueDate) : null,
      isInventory,
      debitAccountCode,
      debitAccountId,
      notes,
      createdById: actor.userId ?? undefined,
    });

    return NextResponse.json(
      { bill: result.bill, journalEntry: result.journalEntry },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار فاتورة المورد";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}


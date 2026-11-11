import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { postSalesInvoice } from "@/lib/accounting/ledgerService";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const invoices = await prisma.salesInvoice.findMany({
      where: projectId && projectId !== "ALL" ? { projectId } : undefined,
      include: {
        customer: { select: { id: true, code: true, nameAr: true, phone: true } },
        project: { select: { id: true, code: true, nameAr: true } },
        harvestCycle: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      invoices: invoices.map((inv) => ({
        ...inv,
        totalAmount: Number(inv.totalAmount),
        paidAmount: Number(inv.paidAmount),
        balanceDue: Number(inv.balanceDue),
      })),
    });
  } catch (error) {
    console.error("GET /api/sales/invoices error:", error);
    return jsonError("تعذر تحميل فواتير المبيعات", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body);
    const customerId = String(body.customerId || "").trim();
    const projectId = String(body.projectId || "").trim();
    const harvestCycleId = body.harvestCycleId ? String(body.harvestCycleId).trim() : null;
    const amount = Number(body.amount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!customerId || !projectId || amount <= 0) {
      return jsonError("يرجى تحديد العميل والمشروع وإدخال المبلغ", 400);
    }

    const result = await postSalesInvoice({
      customerId,
      projectId,
      harvestCycleId,
      amount,
      currency,
      date: body.date ? String(body.date) : new Date(),
      notes,
      createdById: actor.userId ?? undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار فاتورة المبيعات";
    return jsonError(msg, 400);
  }
}


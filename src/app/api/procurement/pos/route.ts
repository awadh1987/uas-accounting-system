import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditDiffTx } from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const status = searchParams.get("status");

    const pos = await prisma.purchaseOrder.findMany({
      where: {
        ...(projectId && projectId !== "ALL" ? { projectId } : {}),
        ...(status && status !== "ALL" ? { status } : {}),
      },
      include: {
        vendor: { select: { id: true, code: true, nameAr: true, nameEn: true, phone: true } },
        project: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        subProject: { select: { id: true, code: true, nameAr: true } },
        items: true,
        goodsReceipts: { orderBy: { receivedDate: "desc" } },
        bills: { select: { id: true, billNumber: true, totalAmount: true, status: true } },
      },
      orderBy: { date: "desc" },
    });

    const mapped = pos.map((po) => {
      const grandTotal = Number(po.grandTotal);
      const receivedTotal = po.goodsReceipts.reduce((s, g) => s + Number(g.receivedTotal), 0);
      const billedTotal = po.bills.reduce((s, b) => s + Number(b.totalAmount), 0);
      const hasGrn = po.goodsReceipts.length > 0;
      const threeWayMatch = hasGrn && Math.abs(grandTotal - receivedTotal) <= 0.01 && (billedTotal === 0 || Math.abs(billedTotal - receivedTotal) <= 0.01);

      return {
        id: po.id,
        poNumber: po.poNumber,
        vendorId: po.vendorId,
        vendor: po.vendor,
        projectId: po.projectId,
        project: po.project,
        subProjectId: po.subProjectId,
        subProject: po.subProject,
        date: po.date.toISOString(),
        status: po.status,
        subTotal: Number(po.subTotal),
        taxTotal: Number(po.taxTotal),
        grandTotal,
        currency: po.currency,
        notes: po.notes,
        items: po.items.map((it) => ({
          id: it.id,
          description: it.description,
          unit: it.unit,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          totalPrice: Number(it.totalPrice),
        })),
        goodsReceipts: po.goodsReceipts.map((g) => ({
          id: g.id,
          grnNumber: g.grnNumber,
          receivedDate: g.receivedDate.toISOString(),
          receivedTotal: Number(g.receivedTotal),
          hasVariance: g.hasVariance,
          warehouseNotes: g.warehouseNotes,
        })),
        bills: po.bills.map((b) => ({
          id: b.id,
          billNumber: b.billNumber,
          totalAmount: Number(b.totalAmount),
          status: b.status,
        })),
        threeWayMatch: {
          hasGrn,
          receivedTotal,
          billedTotal,
          matched: threeWayMatch,
          varianceAmount: grandTotal - receivedTotal,
        },
      };
    });

    return NextResponse.json({ purchaseOrders: mapped });
  } catch (error) {
    console.error("GET /api/procurement/pos error:", error);
    return jsonError("تعذر تحميل أوامر الشراء", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "create",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;

    // Action: Create Goods Receipt Note (GRN) for Three-Way Matching
    if (body.action === "CREATE_GRN") {
      const purchaseOrderId = String(body.purchaseOrderId || "").trim();
      const warehouseNotes = String(body.warehouseNotes || "").trim();
      if (!purchaseOrderId) return jsonError("معرف أمر الشراء مطلوب", 400);

      const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
      if (!po) return jsonError("أمر الشراء غير موجود", 404);

      const receivedTotal = body.receivedTotal !== undefined ? Number(body.receivedTotal) : Number(po.grandTotal);
      const hasVariance = Math.abs(receivedTotal - Number(po.grandTotal)) > 0.01;
      const count = await prisma.goodsReceipt.count();
      const grnNumber = `GRN-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}-${Date.now().toString().slice(-3)}`;

      const grn = await prisma.$transaction(async (tx) => {
        const created = await tx.goodsReceipt.create({
          data: {
            grnNumber,
            purchaseOrderId: po.id,
            receivedTotal,
            hasVariance,
            warehouseNotes: warehouseNotes || (hasVariance ? "يوجد فرق استلام مخزني" : "مطابق للكمية المطلوبة"),
          },
        });
        if (po.status === "DRAFT" || po.status === "PENDING_APPROVAL") {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "APPROVED" } });
        }
        return created;
      });

      return NextResponse.json({ goodsReceipt: grn }, { status: 201 });
    }

    const vendorId = String(body.vendorId || "").trim();
    const projectId = String(body.projectId || "").trim();
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const currency = String(body.currency || "YER").toUpperCase();
    const taxTotal = Math.max(0, Number(body.taxTotal) || 0);
    const notes = body.notes ? String(body.notes).trim() : null;
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (!vendorId || !projectId || rawItems.length === 0) {
      return jsonError("يرجى تحديد المورد والمشروع وإضافة صنف واحد على الأقل", 400);
    }

    const parsedItems = rawItems.map((raw) => {
      const r = raw as Record<string, unknown>;
      const qty = Math.max(0.01, Number(r.quantity) || 1);
      const price = Math.max(0, Number(r.unitPrice) || 0);
      return {
        description: String(r.description || "صنف مشتريات").trim(),
        unit: String(r.unit || "وحدة").trim(),
        quantity: qty,
        unitPrice: price,
        totalPrice: Math.round(qty * price * 10000) / 10000,
      };
    });

    const subTotal = parsedItems.reduce((s, it) => s + it.totalPrice, 0);
    const grandTotal = subTotal + taxTotal;
    const count = await prisma.purchaseOrder.count();
    const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}-${Date.now().toString().slice(-3)}`;

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        vendorId,
        projectId,
        subProjectId,
        acquisitionCycleId: body.acquisitionCycleId ? String(body.acquisitionCycleId) : null,
        ...(body.date ? { date: new Date(String(body.date)) } : {}),
        status: String(body.status || "APPROVED"),
        subTotal,
        taxTotal,
        grandTotal,
        currency,
        notes,
        items: { create: parsedItems },
      },
      include: { vendor: true, project: true, subProject: true, items: true },
    });

    return NextResponse.json({ purchaseOrder: po }, { status: 201 });
  } catch (error) {
    console.error("POST /api/procurement/pos error:", error);
    return jsonError("تعذر إنشاء أمر الشراء", 500);
  }
}

async function handlePoUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف أمر الشراء مطلوب للتعديل", 400);

    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) return jsonError("أمر الشراء غير موجود", 404);

    const dateChanged =
      body.date !== undefined &&
      String(body.date).slice(0, 10) !== existing.date.toISOString().slice(0, 10);

    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const rawItems = Array.isArray(body.items) ? body.items : null;
    const taxTotal =
      body.taxTotal !== undefined ? Math.max(0, Number(body.taxTotal) || 0) : Number(existing.taxTotal);

    const updated = await prisma.$transaction(async (tx) => {
      let nextSubTotal = Number(existing.subTotal);
      if (rawItems && rawItems.length > 0) {
        const parsedItems = rawItems.map((raw) => {
          const r = raw as Record<string, unknown>;
          const qty = Math.max(0.01, Number(r.quantity) || 1);
          const price = Math.max(0, Number(r.unitPrice) || 0);
          return {
            purchaseOrderId: id,
            description: String(r.description || "صنف مشتريات").trim(),
            unit: String(r.unit || "وحدة").trim(),
            quantity: qty,
            unitPrice: price,
            totalPrice: Math.round(qty * price * 10000) / 10000,
          };
        });
        nextSubTotal = parsedItems.reduce((s, it) => s + it.totalPrice, 0);
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderItem.createMany({ data: parsedItems });
      }
      const nextGrandTotal = nextSubTotal + taxTotal;

      const po = await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(body.vendorId !== undefined ? { vendorId: String(body.vendorId).trim() } : {}),
          ...(body.projectId !== undefined ? { projectId: String(body.projectId).trim() } : {}),
          ...(body.subProjectId !== undefined
            ? { subProjectId: body.subProjectId ? String(body.subProjectId).trim() : null }
            : {}),
          ...(body.acquisitionCycleId !== undefined
            ? {
                acquisitionCycleId: body.acquisitionCycleId
                  ? String(body.acquisitionCycleId).trim()
                  : null,
              }
            : {}),
          ...(body.date !== undefined ? { date: new Date(String(body.date)) } : {}),
          ...(body.status !== undefined ? { status: String(body.status).trim() } : {}),
          ...(body.currency !== undefined ? { currency: String(body.currency).toUpperCase() } : {}),
          ...(body.notes !== undefined ? { notes: body.notes ? String(body.notes).trim() : null } : {}),
          subTotal: nextSubTotal,
          taxTotal,
          grandTotal: nextGrandTotal,
        },
        include: { vendor: true, project: true, subProject: true, items: true },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "PurchaseOrder",
        entityId: id,
        before: {
          date: existing.date.toISOString().slice(0, 10),
          status: existing.status,
          grandTotal: Number(existing.grandTotal),
        },
        after: {
          date: po.date.toISOString().slice(0, 10),
          status: po.status,
          grandTotal: Number(po.grandTotal),
        },
      });

      return po;
    });

    return NextResponse.json({ purchaseOrder: updated });
  } catch (error) {
    console.error("PATCH /api/procurement/pos error:", error);
    return jsonError("تعذر تحديث أمر الشراء", 500);
  }
}

export async function PATCH(req: NextRequest) {
  return handlePoUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handlePoUpdate(req);
}


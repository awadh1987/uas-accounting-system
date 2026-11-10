import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeSaleTotals } from "@/lib/formulas";
import {
  appendAuditLogTx,
  findHarvestCycle,
  getBootstrapState,
  isHarvestLockedTx,
} from "@/lib/serverBootstrap";
import { extractActor, jsonError, lockedError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const projectId = String(body.projectId || "").trim();
    const harvestName = String(body.harvest || "").trim();
    const saleBatchLabel = String(body.batch || "عملية بيع 1").trim();
    const productGrade = String(body.grade || "رقم 1").trim();
    const customerName = String(body.customer || "").trim();
    const customerPhone = String(body.phone || "783118231").trim();
    const bundlesCount = Math.max(0, Math.round(Number(body.bundles) || 0));
    const unitPrice = Number(body.price) || 0;
    const creditPaid = Number(body.credit) || 0;
    const saleDate = String(body.date || new Date().toISOString().slice(0, 10));
    const receiptVoucherNo =
      String(body.voucherNo || "").trim() || `RV-${Math.floor(100 + Math.random() * 900)}`;
    const notes = String(body.notes || "").trim();
    const actor = extractActor(body);

    if (!customerName || !projectId || !harvestName) {
      return jsonError("يرجى إدخال اسم العميل والمشروع والقطفة", 400);
    }

    const { totalAmount, debitReceivable } = computeSaleTotals(bundlesCount, unitPrice, creditPaid);

    const result = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }

      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const customer = await tx.customer.upsert({
        where: { name: customerName },
        update: { phone: customerPhone },
        create: { name: customerName, phone: customerPhone },
      });

      const sale = await tx.saleTransaction.create({
        data: {
          projectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          saleBatchLabel,
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          productGrade,
          bundlesCount,
          unitPrice,
          totalAmount,
          creditPaid,
          debitReceivable,
          saleDate,
          receiptVoucherNo,
          notes,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة عملية بيع",
        entityReference: sale.id,
        details: `${customerName} — ${saleBatchLabel} (${bundlesCount} × ${unitPrice} = ${totalAmount.toLocaleString("en-US")} ريال، سند ${receiptVoucherNo})`,
      });

      return { locked: false as const, sale };
    });

    if (result.locked) return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ createdId: result.sale.id, state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/sales error:", error);
    return jsonError("تعذر حفظ عملية البيع", 500);
  }
}


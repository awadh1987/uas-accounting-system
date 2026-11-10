import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { extractActor, jsonError, lockedError } from "@/lib/apiHelpers";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const actor = extractActor(body);

    const result = await prisma.$transaction(async (tx) => {
      const rec = await tx.saleTransaction.findUnique({ where: { id } });
      if (!rec) return { status: "NOT_FOUND" as const };
      if (await isHarvestLockedTx(tx, rec.projectId, rec.harvestName)) {
        return { status: "LOCKED" as const };
      }
      await tx.saleTransaction.delete({ where: { id } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "حذف عملية بيع",
        entityReference: id,
        details: `${rec.customerName} - ${rec.totalAmount.toLocaleString("en-US")} ريال`,
      });
      return { status: "OK" as const };
    });

    if (result.status === "NOT_FOUND") return jsonError("عملية البيع غير موجودة", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("DELETE /api/sales/[id] error:", error);
    return jsonError("تعذر حذف عملية البيع", 500);
  }
}


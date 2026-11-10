import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeOperatingExpenseTotal } from "@/lib/formulas";
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
    const category = String(body.category || "وقود/محروقات").trim();
    const subType = String(body.subType || category).trim();
    const quantity = Number(body.qty) || 1;
    const unitPrice = Number(body.unitPrice) || 0;
    const expenseDate = String(body.date || new Date().toISOString().slice(0, 10));
    const notes = String(body.notes || "").trim();
    const actor = extractActor(body);

    if (!projectId || !harvestName) {
      return jsonError("يرجى اختيار المشروع والقطفة", 400);
    }

    const totalAmount = computeOperatingExpenseTotal(quantity, unitPrice);

    const result = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }

      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const expense = await tx.operatingExpense.create({
        data: {
          projectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          category,
          subType,
          quantity,
          unitPrice,
          totalAmount,
          expenseDate,
          notes,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة مصروف تشغيلي",
        entityReference: expense.id,
        details: `${category}: ${subType} — ${totalAmount.toLocaleString("en-US")} ريال (${harvestName})`,
      });

      return { locked: false as const, expense };
    });

    if (result.locked) {
      return lockedError();
    }

    const state = await getBootstrapState();
    return NextResponse.json({ createdId: result.expense.id, state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/expenses error:", error);
    return jsonError("تعذر حفظ المصروف التشغيلي", 500);
  }
}


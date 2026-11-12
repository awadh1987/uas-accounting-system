import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeOperatingExpenseTotal } from "@/lib/formulas";
import {
  postOperatingExpenseJournalTx,
  updateOperatingExpenseAtomic,
} from "@/lib/accounting/ledgerService";
import {
  appendAuditLogTx,
  findHarvestCycle,
  getBootstrapState,
  isHarvestLockedTx,
} from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "expenses",
      action: "create",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const projectId = String(body.projectId || "").trim();
    const harvestName = String(body.harvest || "").trim();
    const category = String(body.category || "وقود/محروقات").trim();
    const subType = String(body.subType || category).trim();
    const quantity = Number(body.qty) || 1;
    const unitPrice = Number(body.unitPrice) || 0;
    const expenseDate = String(body.date || new Date().toISOString().slice(0, 10));
    const notes = String(body.notes || "").trim();

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

      const je = await postOperatingExpenseJournalTx(tx, {
        expenseId: expense.id,
        projectId,
        harvestCycleId: cycle?.id ?? null,
        category,
        subType,
        totalAmount,
        date: expenseDate,
        createdById: actor.userId ?? undefined,
      });

      if (je) {
        await tx.operatingExpense.update({
          where: { id: expense.id },
          data: { journalEntryId: je.id },
        });
      }

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

async function handleExpensePatch(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف المصروف مطلوب للتعديل", 400);

    const existing = await prisma.operatingExpense.findUnique({ where: { id } });
    if (!existing) return jsonError("المصروف غير موجود", 404);

    const dateChanged =
      body.date !== undefined && String(body.date).trim() !== existing.expenseDate;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "expenses",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const updated = await updateOperatingExpenseAtomic({
      id,
      projectId: body.projectId ? String(body.projectId) : undefined,
      harvestName: body.harvest ? String(body.harvest) : undefined,
      category: body.category ? String(body.category) : undefined,
      subType: body.subType ? String(body.subType) : undefined,
      quantity: body.qty !== undefined ? Number(body.qty) : undefined,
      unitPrice: body.unitPrice !== undefined ? Number(body.unitPrice) : undefined,
      date: body.date ? String(body.date) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ expense: updated, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل المصروف التشغيلي";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function PATCH(req: NextRequest) {
  return handleExpensePatch(req);
}

export async function PUT(req: NextRequest) {
  return handleExpensePatch(req);
}

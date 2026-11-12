import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  reverseJournalEntry,
  updateOperatingExpenseAtomic,
} from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

async function handleExpenseByIdUpdate(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
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
      subProjectId:
        body.subProjectId !== undefined
          ? body.subProjectId
            ? String(body.subProjectId)
            : null
          : undefined,
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

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleExpenseByIdUpdate(req, context);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleExpenseByIdUpdate(req, context);
}

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
    const auth = await authorizeApiAction(body, req, {
      moduleId: "expenses",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const result = await prisma.$transaction(async (tx) => {
      const rec = await tx.operatingExpense.findUnique({ where: { id } });
      if (!rec) return { status: "NOT_FOUND" as const };
      if (await isHarvestLockedTx(tx, rec.projectId, rec.harvestName)) {
        return { status: "LOCKED" as const };
      }
      if (rec.journalEntryId) {
        await reverseJournalEntry({
          journalEntryId: rec.journalEntryId,
          createdById: actor.userId ?? undefined,
          reason: `حذف مصروف تشغيلي (${rec.subType})`,
          tx,
        }).catch(() => null);
      }
      await tx.operatingExpense.delete({ where: { id } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "حذف مصروف تشغيلي",
        entityReference: id,
        details: `${rec.category} - ${rec.totalAmount.toLocaleString("en-US")} ريال`,
      });
      return { status: "OK" as const };
    });

    if (result.status === "NOT_FOUND") return jsonError("المصروف غير موجود", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("DELETE /api/expenses/[id] error:", error);
    return jsonError("تعذر حذف المصروف", 500);
  }
}

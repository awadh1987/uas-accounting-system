import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  reverseJournalEntry,
  updateWorkerWageAtomic,
} from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

async function handleWorkerByIdUpdate(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const existing = await prisma.workerWageEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("سجل العامل غير موجود", 404);

    const dateChanged =
      body.date !== undefined && String(body.date).trim() !== existing.workDate;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "workers",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const updated = await updateWorkerWageAtomic({
      id,
      projectId: body.projectId ? String(body.projectId) : undefined,
      subProjectId:
        body.subProjectId !== undefined
          ? body.subProjectId
            ? String(body.subProjectId)
            : null
          : undefined,
      harvestName: body.harvest ? String(body.harvest) : undefined,
      name: body.name ? String(body.name) : undefined,
      dailyWage: body.dailyWage !== undefined ? Number(body.dailyWage) : undefined,
      daysWorked: body.days !== undefined ? Number(body.days) : undefined,
      creditAmount: body.credit !== undefined ? Number(body.credit) : undefined,
      date: body.date ? String(body.date) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ workerEntry: updated, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل سجل العامل";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleWorkerByIdUpdate(req, context);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleWorkerByIdUpdate(req, context);
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
      moduleId: "workers",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const result = await prisma.$transaction(async (tx) => {
      const rec = await tx.workerWageEntry.findUnique({ where: { id } });
      if (!rec) return { status: "NOT_FOUND" as const };
      if (await isHarvestLockedTx(tx, rec.projectId, rec.harvestName)) {
        return { status: "LOCKED" as const };
      }
      if (rec.journalEntryId) {
        await reverseJournalEntry({
          journalEntryId: rec.journalEntryId,
          createdById: actor.userId ?? undefined,
          reason: `حذف سجل أجر عامل (${rec.workerName})`,
          tx,
        }).catch(() => null);
      }
      await tx.workerWageEntry.delete({ where: { id } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "حذف سجل عامل",
        entityReference: id,
        details: `${rec.workerName} - ${rec.totalWage.toLocaleString("en-US")} ريال`,
      });
      return { status: "OK" as const };
    });

    if (result.status === "NOT_FOUND") return jsonError("سجل العامل غير موجود", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("DELETE /api/workers/[id] error:", error);
    return jsonError("تعذر حذف سجل العامل", 500);
  }
}

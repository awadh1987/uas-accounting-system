import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeWorkerWageTotals } from "@/lib/formulas";
import {
  ensureWorkerWithAccountTx,
  postWorkerWageJournalTx,
  updateWorkerWageAtomic,
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
      moduleId: "workers",
      action: "create",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const projectId = String(body.projectId || "").trim();
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const harvestName = String(body.harvest || "").trim();
    const name = String(body.name || "").trim();
    const dailyWage = Number(body.dailyWage) || 0;
    const daysWorked = Number(body.days) || 1;
    const creditAmount = Number(body.credit) || 0;
    const workDate = String(body.date || new Date().toISOString().slice(0, 10));
    const notes = String(body.notes || "").trim();

    if (!name || !projectId || !harvestName) {
      return jsonError("يرجى إدخال اسم العامل والمشروع والقطفة", 400);
    }

    const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, daysWorked, creditAmount);

    const result = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }

      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const worker = await ensureWorkerWithAccountTx(tx, {
        name,
        defaultDailyWage: dailyWage,
        phone: "783118231",
      });

      const entry = await tx.workerWageEntry.create({
        data: {
          workerId: worker.id,
          workerName: worker.name,
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          dailyWage,
          daysWorked,
          totalWage,
          creditAmount,
          debitBalance,
          workDate,
          notes,
        },
      });

      if (worker.accountId) {
        const je = await postWorkerWageJournalTx(tx, {
          wageEntryId: entry.id,
          workerName: worker.name,
          workerAccountId: worker.accountId,
          projectId,
          subProjectId,
          harvestCycleId: cycle?.id ?? null,
          totalWage,
          creditAmount,
          date: workDate,
          createdById: actor.userId ?? undefined,
        });
        if (je) {
          await tx.workerWageEntry.update({
            where: { id: entry.id },
            data: { journalEntryId: je.id },
          });
        }
      }

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة سجل أجر عامل",
        entityReference: entry.id,
        details: `${name} (${daysWorked} × ${dailyWage} = ${totalWage.toLocaleString("en-US")} ريال، دائن: ${creditAmount.toLocaleString("en-US")})`,
      });

      return { locked: false as const, entry };
    });

    if (result.locked) return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ createdId: result.entry.id, state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/workers error:", error);
    return jsonError("تعذر حفظ سجل العامل", 500);
  }
}

async function handleWorkerPatch(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف سجل العامل مطلوب للتعديل", 400);

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

export async function PATCH(req: NextRequest) {
  return handleWorkerPatch(req);
}

export async function PUT(req: NextRequest) {
  return handleWorkerPatch(req);
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeWorkerWageTotals } from "@/lib/formulas";
import { ensureWorkerWithAccountTx, postWorkerWageJournalTx } from "@/lib/accounting/ledgerService";
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
    const name = String(body.name || "").trim();
    const dailyWage = Number(body.dailyWage) || 0;
    const daysWorked = Number(body.days) || 1;
    const creditAmount = Number(body.credit) || 0;
    const workDate = String(body.date || new Date().toISOString().slice(0, 10));
    const notes = String(body.notes || "").trim();
    const actor = extractActor(body);

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

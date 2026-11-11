import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const key = String(body.key || "").trim();
    const cycleId = String(body.cycleId || "").trim();
    const [projectId, harvestName] = key.split("::");
    const actor = extractActor(body);

    if (!cycleId && (!projectId || !harvestName)) {
      return jsonError("معرف القطفة غير صالح", 400);
    }

    await prisma.$transaction(async (tx) => {
      const cycle = cycleId
        ? await tx.harvestCycle.findUnique({ where: { id: cycleId } })
        : await tx.harvestCycle.findFirst({ where: { projectId, name: harvestName } });
      if (!cycle) throw new Error("CYCLE_NOT_FOUND");

      const nextLocked = !cycle.isLocked;
      await tx.harvestCycle.update({
        where: { id: cycle.id },
        data: {
          isLocked: nextLocked,
          lockedByUserId: nextLocked ? actor.userId : null,
          lockedById: nextLocked ? actor.userId : null,
          lockedAt: nextLocked ? new Date() : null,
        },
      });

      if (actor.userId) {
        const actorUser = await tx.user.findUnique({ where: { id: actor.userId }, select: { id: true } });
        if (actorUser) {
          await tx.auditLog.create({
            data: {
              userId: actorUser.id,
              action: "LOCK",
              entity: "HarvestCycle",
              entityId: cycle.id,
              details: { projectId: cycle.projectId, name: cycle.name, isLocked: nextLocked },
            },
          });
        }
      }

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: nextLocked ? "إغلاق فترة قطفة 🔒" : "إعادة فتح فترة قطفة 🔓",
        entityReference: cycle.id,
        details: `المعرف: ${cycle.projectId}::${cycle.name}`,
      });
    });

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    if (error instanceof Error && error.message === "CYCLE_NOT_FOUND") {
      return jsonError("القطفة غير موجودة", 404);
    }
    console.error("POST /api/audit/lock error:", error);
    return jsonError("تعذر تغيير حالة إغلاق القطفة", 500);
  }
}

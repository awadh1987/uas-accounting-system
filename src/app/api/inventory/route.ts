import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
    const productGrade = String(body.grade || "رقم 1").trim();
    const harvestedBundles = Math.max(0, Math.round(Number(body.harvestedBundles) || 0));
    const shrinkageBundles = Math.max(0, Math.round(Number(body.shrinkageBundles) || 0));
    const notes = String(body.notes || "").trim();
    const actor = extractActor(body);

    if (!projectId || !harvestName) {
      return jsonError("يرجى اختيار المشروع والقطفة", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }

      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const batch = await tx.harvestInventoryBatch.create({
        data: {
          projectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          productGrade,
          harvestedBundles,
          shrinkageBundles,
          notes,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة دفعة مخزون علاقيات",
        entityReference: batch.id,
        details: `${harvestName} (${productGrade}) — ${harvestedBundles} علاقية`,
      });

      return { locked: false as const, batch };
    });

    if (result.locked) return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ createdId: result.batch.id, state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/inventory error:", error);
    return jsonError("تعذر تسجيل دفعة المخزون", 500);
  }
}


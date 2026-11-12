import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditDiffTx } from "@/lib/accounting/ledgerService";
import {
  appendAuditLogTx,
  findHarvestCycle,
  getBootstrapState,
  isHarvestLockedTx,
} from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getBootstrapState();
    return NextResponse.json({ inventoryBatches: state.inventoryBatches });
  } catch (error) {
    console.error("GET /api/inventory error:", error);
    return jsonError("تعذر تحميل سجل المخزون", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "inventory",
      action: "create",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const projectId = String(body.projectId || "").trim();
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const harvestName = String(body.harvest || "").trim();
    const productGrade = String(body.grade || "رقم 1").trim();
    const harvestedBundles = Math.max(0, Math.round(Number(body.harvestedBundles) || 0));
    const shrinkageBundles = Math.max(0, Math.round(Number(body.shrinkageBundles) || 0));
    const notes = String(body.notes || "").trim();

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
          subProjectId,
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

async function handleInventoryUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "inventory",
      action: "edit",
    });
    if (!auth.ok) return auth.response;

    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف دفعة المخزون مطلوب للتعديل", 400);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.harvestInventoryBatch.findUnique({ where: { id } });
      if (!existing) return { status: "NOT_FOUND" as const };

      if (await isHarvestLockedTx(tx, existing.projectId, existing.harvestName)) {
        return { status: "LOCKED" as const };
      }

      const nextProjectId = body.projectId ? String(body.projectId).trim() : existing.projectId;
      const nextHarvestName = body.harvest ? String(body.harvest).trim() : existing.harvestName;
      if (
        (nextProjectId !== existing.projectId || nextHarvestName !== existing.harvestName) &&
        (await isHarvestLockedTx(tx, nextProjectId, nextHarvestName))
      ) {
        return { status: "LOCKED" as const };
      }

      const cycle = await findHarvestCycle(tx, nextProjectId, nextHarvestName);
      const updated = await tx.harvestInventoryBatch.update({
        where: { id },
        data: {
          projectId: nextProjectId,
          ...(body.subProjectId !== undefined
            ? { subProjectId: body.subProjectId ? String(body.subProjectId).trim() : null }
            : {}),
          harvestCycleId: cycle?.id ?? existing.harvestCycleId,
          harvestName: nextHarvestName,
          ...(body.grade !== undefined ? { productGrade: String(body.grade).trim() } : {}),
          ...(body.harvestedBundles !== undefined
            ? { harvestedBundles: Math.max(0, Math.round(Number(body.harvestedBundles) || 0)) }
            : {}),
          ...(body.shrinkageBundles !== undefined
            ? { shrinkageBundles: Math.max(0, Math.round(Number(body.shrinkageBundles) || 0)) }
            : {}),
          ...(body.notes !== undefined ? { notes: String(body.notes).trim() } : {}),
        },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "HarvestInventoryBatch",
        entityId: id,
        before: {
          harvestName: existing.harvestName,
          productGrade: existing.productGrade,
          harvestedBundles: existing.harvestedBundles,
          shrinkageBundles: existing.shrinkageBundles,
        },
        after: {
          harvestName: updated.harvestName,
          productGrade: updated.productGrade,
          harvestedBundles: updated.harvestedBundles,
          shrinkageBundles: updated.shrinkageBundles,
        },
      });

      await appendAuditLogTx(tx, {
        ...auth.actor,
        actionType: "تعديل دفعة مخزون",
        entityReference: id,
        details: `${updated.harvestName} (${updated.productGrade}) — ${updated.harvestedBundles} علاقية`,
      });

      return { status: "OK" as const, batch: updated };
    });

    if (result.status === "NOT_FOUND") return jsonError("دفعة المخزون غير موجودة", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ batch: result.batch, state });
  } catch (error) {
    console.error("PATCH /api/inventory error:", error);
    return jsonError("تعذر تعديل دفعة المخزون", 500);
  }
}

export async function PATCH(req: NextRequest) {
  return handleInventoryUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleInventoryUpdate(req);
}


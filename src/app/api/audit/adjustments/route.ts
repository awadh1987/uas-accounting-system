import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, findHarvestCycle, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const key = String(body.key || "").trim(); // e.g. "p1::القطفة الأولى" or label
    const periodLabel = String(body.periodLabel || key).trim();
    const reason = String(body.reason || "").trim();
    const amountYER = Number(body.amount) || 0;
    const actor = extractActor(body);

    if (!reason) {
      return jsonError("يرجى إدخال بيان قيد التسوية", 400);
    }

    const [projectId, harvestName] = key.includes("::") ? key.split("::") : ["", ""];

    await prisma.$transaction(async (tx) => {
      const cycle =
        projectId && harvestName ? await findHarvestCycle(tx, projectId, harvestName) : null;

      const entry = await tx.adjustmentEntry.create({
        data: {
          projectId: projectId || null,
          harvestCycleId: cycle?.id ?? null,
          periodLabel,
          reason,
          amountYER,
          createdByUser: actor.userDisplay,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "قيد تسوية محاسبي معتمد",
        entityReference: entry.id,
        details: `[${periodLabel}] ${reason} — القيمة: ${amountYER.toLocaleString("en-US")} ريال`,
      });
    });

    const state = await getBootstrapState();
    return NextResponse.json({ state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/audit/adjustments error:", error);
    return jsonError("تعذر ترحيل قيد التسوية", 500);
  }
}


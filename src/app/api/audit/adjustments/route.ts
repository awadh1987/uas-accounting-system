import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, findHarvestCycle, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const key = String(body.key || "").trim();
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

      let journalEntryId: string | null = null;
      if (Math.abs(amountYER) > 0) {
        const absAmt = Math.abs(amountYER);
        const je = await postJournalEntry({
          tx,
          date: new Date(),
          reference: `ADJ-${Date.now().toString().slice(-5)}`,
          narrationAr: `قيد تسوية محاسبي (${periodLabel}): ${reason}`,
          narrationEn: `Audit Adjustment (${periodLabel}): ${reason}`,
          sourceType: "ADJUSTMENT",
          projectId: projectId || null,
          createdById: actor.userId ?? undefined,
          allowLockedAdjustment: true,
          lines: [
            {
              accountCode: "531101",
              debit: absAmt,
              projectId: projectId || null,
              harvestCycleId: cycle?.id ?? null,
              memo: reason,
            },
            {
              accountCode: "111101",
              credit: absAmt,
              projectId: projectId || null,
              harvestCycleId: cycle?.id ?? null,
              memo: `تسوية مالية - ${periodLabel}`,
            },
          ],
        });
        journalEntryId = je.id;
      }

      const entry = await tx.adjustmentEntry.create({
        data: {
          projectId: projectId || null,
          harvestCycleId: cycle?.id ?? null,
          periodLabel,
          reason,
          amountYER,
          createdByUser: actor.userDisplay,
          journalEntryId,
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

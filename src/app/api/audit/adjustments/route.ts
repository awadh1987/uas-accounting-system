import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { postJournalEntry } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, findHarvestCycle, getBootstrapState } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { parseAccountingSettings } from "@/lib/accountingSettings";
import { dDiv, dSub } from "@/lib/decimalMath";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "audit",
      action: "post",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const key = String(body.key || "").trim();
    const periodLabel = String(body.periodLabel || key).trim();
    const reason = String(body.reason || "").trim();
    const amountYER = Number(body.amount) || 0;
    const requestedTreasuryId = body.treasuryAccountId ? String(body.treasuryAccountId).trim() : null;

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
        const settingsRow = await tx.systemSettings.findUnique({ where: { id: "default" } });
        const controlAccounts = parseAccountingSettings(settingsRow).controlAccounts;
        const cashCode = controlAccounts.cashAccount || "111101";

        const treasury = requestedTreasuryId
          ? await tx.treasuryAccount.findUnique({ where: { id: requestedTreasuryId } })
          : (await tx.treasuryAccount.findUnique({ where: { id: "t1" } })) ||
            (await tx.treasuryAccount.findFirst({ where: { isDefaultPayments: true, isActive: true } }));

        const creditCashSpec = treasury?.accountId
          ? { accountId: treasury.accountId }
          : { accountCode: cashCode };

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
              ...creditCashSpec,
              credit: absAmt,
              projectId: projectId || null,
              harvestCycleId: cycle?.id ?? null,
              memo: `تسوية مالية - ${periodLabel}`,
            },
          ],
        });
        journalEntryId = je.id;

        if (treasury) {
          const tCur = (treasury.currency || "YER").toUpperCase();
          const tRateRow = tCur === "YER" ? null : await tx.currencyRate.findUnique({ where: { currencyCode: tCur } });
          const tRate = tCur === "YER" ? 1 : Number(tRateRow?.rateToYER) || (tCur === "SAR" ? 425 : 1620);
          const deltaInTreasuryCurr = dDiv(absAmt, tRate, 4);
          await tx.treasuryAccount.update({
            where: { id: treasury.id },
            data: {
              balance: dSub(treasury.balance, deltaInTreasuryCurr, 4),
              balanceYER: dSub(treasury.balanceYER, absAmt, 4),
            },
          });
        }
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
});

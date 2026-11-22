import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
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
      expenseAccountId: body.expenseAccountId ? String(body.expenseAccountId).trim() : undefined,
      expenseAccountCode: body.expenseAccountCode ? String(body.expenseAccountCode).trim() : undefined,
      customAccount: body.customAccount as { nameAr: string; nameEn?: string; parentCode: string; code?: string } | null | undefined,
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

export const PATCH = withTenantRoute(async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleWorkerByIdUpdate(req, context);
});

export const PUT = withTenantRoute(async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleWorkerByIdUpdate(req, context);
});

export const DELETE = withTenantRoute(async function DELETE(
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

      const resolveTreasuryRate = async (currency: string) => {
        const c = (currency || "YER").toUpperCase();
        if (c === "YER") return 1;
        const r = await tx.currencyRate.findUnique({ where: { currencyCode: c } });
        return Number(r?.rateToYER) || (c === "SAR" ? 425 : c === "USD" ? 1620 : 1);
      };

      const reversedJeIds = new Set<string>();
      const reverseIfPosted = async (
        journalEntryId: string,
        reason: string,
        restorePayoutTreasury = false
      ) => {
        if (!journalEntryId || reversedJeIds.has(journalEntryId)) return;
        const je = await tx.journalEntry.findUnique({
          where: { id: journalEntryId },
          include: { lines: true },
        });
        if (je && je.status !== "VOIDED" && !je.isReversed) {
          if (restorePayoutTreasury && je.sourceType === "WORKER_PAYOUT") {
            for (const line of je.lines) {
              const crBase = Number(line.baseCredit || line.creditBase || line.credit || 0);
              if (crBase > 0.005) {
                const tr = await tx.treasuryAccount.findUnique({
                  where: { accountId: line.accountId },
                });
                if (tr) {
                  const trRate = await resolveTreasuryRate(tr.currency);
                  await tx.treasuryAccount.update({
                    where: { id: tr.id },
                    data: {
                      balance: Number(tr.balance) + crBase / trRate,
                      balanceYER: Number(tr.balanceYER) + crBase,
                    },
                  });
                }
              }
            }
          }
          await reverseJournalEntry({
            journalEntryId,
            createdById: actor.userId ?? undefined,
            reason,
            tx,
          });
        }
        reversedJeIds.add(journalEntryId);
      };

      // 1. Reverse and remove any linked installment payout vouchers + restore treasury
      const linkedInstallments = await tx.installmentVoucher.findMany({
        where: { workerWageEntryId: rec.id },
      });
      for (const inst of linkedInstallments) {
        const instAmt = Number(inst.amountYER);
        if (inst.journalEntryId) {
          await reverseIfPosted(inst.journalEntryId, `عكس سند صرف أجر عامل: ${inst.voucherNo}`);
        }
        const tr = await tx.treasuryAccount.findUnique({ where: { id: inst.treasuryAccountId } });
        if (tr) {
          const trRate = await resolveTreasuryRate(tr.currency);
          await tx.treasuryAccount.update({
            where: { id: tr.id },
            data: {
              balance: Number(tr.balance) + instAmt / trRate,
              balanceYER: Number(tr.balanceYER) + instAmt,
            },
          });
        }
        await tx.installmentVoucher.delete({ where: { id: inst.id } });
      }

      // 2. Reverse accrual + initial payout journal entries (primary + all sourceId entries)
      if (rec.journalEntryId) {
        await reverseIfPosted(rec.journalEntryId, `عكس سجل أجر عامل (${rec.workerName})`, true);
      }
      const linkedJes = await tx.journalEntry.findMany({
        where: { sourceId: rec.id, status: "POSTED", isReversed: false },
        select: { id: true },
      });
      for (const je of linkedJes) {
        await reverseIfPosted(je.id, `عكس قيد أجر/صرف عامل (${rec.workerName})`, true);
      }

      await tx.workerWageEntry.delete({ where: { id } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "عكس وحذف سجل عامل",
        entityReference: id,
        details: `${rec.workerName} - ${Number(rec.totalWage).toLocaleString("en-US")} ريال`,
      });
      return { status: "OK" as const };
    });

    if (result.status === "NOT_FOUND") return jsonError("سجل العامل غير موجود", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("DELETE /api/workers/[id] error:", error);
    const msg = error instanceof Error ? error.message : "تعذر عكس وحذف سجل العامل";
    return jsonError(msg, 400);
  }
});

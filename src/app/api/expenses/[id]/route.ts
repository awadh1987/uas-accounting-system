import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import {
  reverseJournalEntry,
  updateOperatingExpenseAtomic,
} from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

async function handleExpenseByIdUpdate(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const existing = await prisma.operatingExpense.findUnique({ where: { id } });
    if (!existing) return jsonError("المصروف غير موجود", 404);

    const dateChanged =
      body.date !== undefined && String(body.date).trim() !== existing.expenseDate;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "expenses",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const customAccount =
      body.customAccount && typeof body.customAccount === "object"
        ? (body.customAccount as { nameAr: string; nameEn?: string; parentCode: string; code?: string })
        : undefined;

    const updated = await updateOperatingExpenseAtomic({
      id,
      projectId: body.projectId ? String(body.projectId) : undefined,
      subProjectId:
        body.subProjectId !== undefined
          ? body.subProjectId
            ? String(body.subProjectId)
            : null
          : undefined,
      harvestName: body.harvest ? String(body.harvest) : undefined,
      category: body.category ? String(body.category) : undefined,
      subType: body.subType ? String(body.subType) : undefined,
      quantity: body.qty !== undefined ? Number(body.qty) : undefined,
      unitPrice: body.unitPrice !== undefined ? Number(body.unitPrice) : undefined,
      date: body.date ? String(body.date) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      expenseAccountId: body.expenseAccountId ? String(body.expenseAccountId).trim() : undefined,
      expenseAccountCode: body.expenseAccountCode ? String(body.expenseAccountCode).trim() : undefined,
      customAccount,
      treasuryAccountId: body.treasuryAccountId ? String(body.treasuryAccountId).trim() : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ expense: updated, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل المصروف التشغيلي";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export const PATCH = withTenantRoute(async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleExpenseByIdUpdate(req, context);
});

export const PUT = withTenantRoute(async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleExpenseByIdUpdate(req, context);
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
      moduleId: "expenses",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const result = await prisma.$transaction(async (tx) => {
      const rec = await tx.operatingExpense.findUnique({ where: { id } });
      if (!rec) return { status: "NOT_FOUND" as const };
      if (await isHarvestLockedTx(tx, rec.projectId, rec.harvestName)) {
        return { status: "LOCKED" as const };
      }

      const reversedJeIds = new Set<string>();
      const reverseAndRestoreTreasury = async (journalEntryId: string, reason: string) => {
        if (!journalEntryId || reversedJeIds.has(journalEntryId)) return;
        const je = await tx.journalEntry.findUnique({
          where: { id: journalEntryId },
          include: { lines: true },
        });
        if (je && je.status !== "VOIDED" && !je.isReversed) {
          for (const line of je.lines) {
            const crBase = Number(line.baseCredit || line.creditBase || line.credit || 0);
            if (crBase > 0.005) {
              const tr = await tx.treasuryAccount.findUnique({
                where: { accountId: line.accountId },
              });
              if (tr) {
                const trCur = (tr.currency || "YER").toUpperCase();
                const trRateRow =
                  trCur === "YER" ? null : await tx.currencyRate.findUnique({ where: { currencyCode: trCur } });
                const trRate = trCur === "YER" ? 1 : Number(trRateRow?.rateToYER) || (trCur === "SAR" ? 425 : 1620);
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
          await reverseJournalEntry({
            journalEntryId,
            createdById: actor.userId ?? undefined,
            reason,
            tx,
          });
        }
        reversedJeIds.add(journalEntryId);
      };

      if (rec.journalEntryId) {
        await reverseAndRestoreTreasury(rec.journalEntryId, `عكس وإلغاء مصروف تشغيلي (${rec.subType})`);
      }
      const linkedJes = await tx.journalEntry.findMany({
        where: { sourceId: rec.id, status: "POSTED", isReversed: false },
        select: { id: true },
      });
      for (const je of linkedJes) {
        await reverseAndRestoreTreasury(je.id, `عكس قيد مصروف تشغيلي مرتبط (${rec.subType})`);
      }

      await tx.operatingExpense.delete({ where: { id } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "عكس وحذف مصروف تشغيلي",
        entityReference: id,
        details: `${rec.category} - ${Number(rec.totalAmount).toLocaleString("en-US")} ريال`,
      });
      return { status: "OK" as const };
    });

    if (result.status === "NOT_FOUND") return jsonError("المصروف غير موجود", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("DELETE /api/expenses/[id] error:", error);
    const msg = error instanceof Error ? error.message : "تعذر عكس وحذف المصروف";
    return jsonError(msg, 400);
  }
});

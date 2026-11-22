import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import {
  reverseJournalEntry,
  updateSaleTransactionAtomic,
} from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

async function handleSaleByIdUpdate(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const existing = await prisma.saleTransaction.findUnique({ where: { id } });
    if (!existing) return jsonError("عملية البيع غير موجودة", 404);

    const dateChanged =
      body.date !== undefined && String(body.date).trim() !== existing.saleDate;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const updated = await updateSaleTransactionAtomic({
      id,
      projectId: body.projectId ? String(body.projectId) : undefined,
      subProjectId:
        body.subProjectId !== undefined
          ? body.subProjectId
            ? String(body.subProjectId)
            : null
          : undefined,
      harvestName: body.harvest ? String(body.harvest) : undefined,
      batch: body.batch ? String(body.batch) : undefined,
      dailyBatchLabel: body.dailyBatchLabel ? String(body.dailyBatchLabel).trim() : undefined,
      customer: body.customer ? String(body.customer) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      grade: body.grade ? String(body.grade) : undefined,
      bundles: body.bundles !== undefined ? Number(body.bundles) : undefined,
      price: body.price !== undefined ? Number(body.price) : undefined,
      credit: body.credit !== undefined ? Number(body.credit) : undefined,
      date: body.date ? String(body.date) : undefined,
      voucherNo: body.voucherNo ? String(body.voucherNo) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      salesOfficerId: body.salesOfficerId ? String(body.salesOfficerId).trim() : undefined,
      salesOfficerTitle: body.salesOfficerTitle ? String(body.salesOfficerTitle).trim() : undefined,
      revenueAccountCode: body.revenueAccountCode ? String(body.revenueAccountCode).trim() : undefined,
      treasuryAccountId: body.treasuryAccountId ? String(body.treasuryAccountId).trim() : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ sale: updated, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل عملية البيع";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export const PATCH = withTenantRoute(async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleSaleByIdUpdate(req, context);
});

export const PUT = withTenantRoute(async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleSaleByIdUpdate(req, context);
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
      moduleId: "sales",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const result = await prisma.$transaction(async (tx) => {
      const rec = await tx.saleTransaction.findUnique({ where: { id } });
      if (!rec) return { status: "NOT_FOUND" as const };
      if (await isHarvestLockedTx(tx, rec.projectId, rec.harvestName)) {
        return { status: "LOCKED" as const };
      }

      const reversedJeIds = new Set<string>();
      const reverseIfPosted = async (journalEntryId: string, reason: string) => {
        if (!journalEntryId || reversedJeIds.has(journalEntryId)) return;
        const je = await tx.journalEntry.findUnique({
          where: { id: journalEntryId },
          select: { status: true, isReversed: true },
        });
        if (je && je.status !== "VOIDED" && !je.isReversed) {
          await reverseJournalEntry({
            journalEntryId,
            createdById: actor.userId ?? undefined,
            reason,
            tx,
          });
        }
        reversedJeIds.add(journalEntryId);
      };

      const resolveTreasuryRate = async (currency: string) => {
        const c = (currency || "YER").toUpperCase();
        if (c === "YER") return 1;
        const r = await tx.currencyRate.findUnique({ where: { currencyCode: c } });
        return Number(r?.rateToYER) || (c === "SAR" ? 425 : c === "USD" ? 1620 : 1);
      };

      // 1. Reverse and remove any linked installment vouchers first + restore their treasury balances
      const linkedInstallments = await tx.installmentVoucher.findMany({
        where: { saleTransactionId: rec.id },
      });
      let installmentPaidTotal = 0;
      for (const inst of linkedInstallments) {
        const instAmt = Number(inst.amountYER);
        installmentPaidTotal += instAmt;
        if (inst.journalEntryId) {
          await reverseIfPosted(inst.journalEntryId, `عكس سند دفعة بيع ملغى: ${inst.voucherNo}`);
        }
        const tr = await tx.treasuryAccount.findUnique({ where: { id: inst.treasuryAccountId } });
        if (tr) {
          const trRate = await resolveTreasuryRate(tr.currency);
          await tx.treasuryAccount.update({
            where: { id: tr.id },
            data: {
              balance: Number(tr.balance) - instAmt / trRate,
              balanceYER: Number(tr.balanceYER) - instAmt,
            },
          });
        }
        await tx.installmentVoucher.delete({ where: { id: inst.id } });
      }

      // 2. Reverse remaining direct cash receipt from treasury if collected at sale creation
      const directCashPaid = Math.max(0, Number(rec.creditPaid) - installmentPaidTotal);
      if (directCashPaid > 0.005) {
        const directTreasury = rec.treasuryAccountId
          ? await tx.treasuryAccount.findUnique({ where: { id: rec.treasuryAccountId } })
          : await tx.treasuryAccount.findFirst({ where: { isDefaultReceipts: true } });
        if (directTreasury) {
          const trRate = await resolveTreasuryRate(directTreasury.currency);
          await tx.treasuryAccount.update({
            where: { id: directTreasury.id },
            data: {
              balance: Number(directTreasury.balance) - directCashPaid / trRate,
              balanceYER: Number(directTreasury.balanceYER) - directCashPaid,
            },
          });
        }
      }

      // 3. Reverse primary sale journal entry and all linked sourceId journal entries
      if (rec.journalEntryId) {
        await reverseIfPosted(rec.journalEntryId, `عكس وإلغاء عملية بيع (${rec.customerName})`);
      }
      const linkedJes = await tx.journalEntry.findMany({
        where: { sourceId: rec.id, status: "POSTED", isReversed: false },
        select: { id: true },
      });
      for (const je of linkedJes) {
        await reverseIfPosted(je.id, `عكس قيد بيع مرتبط (${rec.customerName})`);
      }

      await tx.saleTransaction.delete({ where: { id } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "عكس وحذف عملية بيع",
        entityReference: id,
        details: `${rec.customerName} - ${Number(rec.totalAmount).toLocaleString("en-US")} ريال`,
      });
      return { status: "OK" as const };
    });

    if (result.status === "NOT_FOUND") return jsonError("عملية البيع غير موجودة", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("DELETE /api/sales/[id] error:", error);
    const msg = error instanceof Error ? error.message : "تعذر عكس وحذف عملية البيع";
    return jsonError(msg, 400);
  }
});

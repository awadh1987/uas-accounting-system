import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  postCustomerReceipt,
  postJournalEntry,
  recordAuditDiffTx,
  reverseJournalEntry,
} from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const receipts = await prisma.receiptVoucher.findMany({
      include: {
        customer: { select: { id: true, code: true, nameAr: true, phone: true } },
        invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, balanceDue: true } },
        treasury: { select: { id: true, code: true, nameAr: true, currency: true } },
        subProject: { select: { id: true, code: true, nameAr: true } },
      },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      receipts: receipts.map((r) => ({
        ...r,
        amount: Number(r.amount),
      })),
    });
  } catch (error) {
    console.error("GET /api/sales/receipts error:", error);
    return jsonError("تعذر تحميل سندات القبض", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: "create",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const customerId = String(body.customerId || "").trim();
    const invoiceId = body.invoiceId ? String(body.invoiceId).trim() : null;
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const treasuryId = String(body.treasuryId || "").trim();
    const amount = Number(body.amount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!customerId || !treasuryId || amount <= 0) {
      return jsonError("يرجى تحديد العميل والخزينة وإدخال مبلغ صحيح", 400);
    }

    const result = await postCustomerReceipt({
      customerId,
      invoiceId,
      subProjectId,
      treasuryId,
      amount,
      currency,
      date: body.date ? String(body.date) : new Date(),
      notes,
      createdById: actor.userId ?? undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار سند القبض";
    return jsonError(msg, 400);
  }
}

async function handleReceiptUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف سند القبض مطلوب للتعديل", 400);

    const existing = await prisma.receiptVoucher.findUnique({
      where: { id },
      include: { customer: true, treasury: true, invoice: true },
    });
    if (!existing) return jsonError("سند القبض غير موجود", 404);

    const dateChanged =
      body.date !== undefined &&
      String(body.date).slice(0, 10) !== existing.date.toISOString().slice(0, 10);

    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const nextAmount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      return jsonError("مبلغ سند القبض غير صالح", 400);
    }
    const nextTreasuryId = body.treasuryId ? String(body.treasuryId).trim() : existing.treasuryId;
    const nextSubProjectId =
      body.subProjectId !== undefined
        ? body.subProjectId
          ? String(body.subProjectId).trim()
          : null
        : existing.subProjectId;
    const nextDate = body.date ? new Date(String(body.date)) : existing.date;
    const nextNotes =
      body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : existing.notes;

    const financialChanged =
      Math.abs(nextAmount - Number(existing.amount)) > 0.005 ||
      nextTreasuryId !== existing.treasuryId ||
      nextSubProjectId !== existing.subProjectId;

    const updated = await prisma.$transaction(async (tx) => {
      let nextJournalEntryId = existing.journalEntryId;

      if (financialChanged) {
        const rateRow = await tx.currencyRate.findUnique({ where: { currencyCode: existing.currency } });
        const rcpRate =
          existing.currency === "YER"
            ? 1
            : rateRow?.rateToYER || (existing.currency === "SAR" ? 425 : 1620);
        const oldYER = Number(existing.amount) * rcpRate;
        const oldTrRateRow = await tx.currencyRate.findUnique({
          where: { currencyCode: existing.treasury.currency },
        });
        const oldTrRate =
          existing.treasury.currency === "YER"
            ? 1
            : oldTrRateRow?.rateToYER || (existing.treasury.currency === "SAR" ? 425 : 1620);

        await tx.treasuryAccount.update({
          where: { id: existing.treasuryId },
          data: {
            balance: Number(existing.treasury.balance) - oldYER / oldTrRate,
            balanceYER: existing.treasury.balanceYER - oldYER,
          },
        });

        const nextTreasury = await tx.treasuryAccount.findUnique({ where: { id: nextTreasuryId } });
        if (!nextTreasury) throw new Error("TREASURY_NOT_FOUND");
        const nextTrRateRow = await tx.currencyRate.findUnique({
          where: { currencyCode: nextTreasury.currency },
        });
        const nextTrRate =
          nextTreasury.currency === "YER"
            ? 1
            : nextTrRateRow?.rateToYER || (nextTreasury.currency === "SAR" ? 425 : 1620);
        const newYER = nextAmount * rcpRate;

        await tx.treasuryAccount.update({
          where: { id: nextTreasury.id },
          data: {
            balance: Number(nextTreasury.balance) + newYER / nextTrRate,
            balanceYER: nextTreasury.balanceYER + newYER,
          },
        });

        if (existing.invoiceId && existing.invoice) {
          const invRateRow = await tx.currencyRate.findUnique({
            where: { currencyCode: existing.invoice.currency },
          });
          const invRate =
            existing.invoice.currency === "YER"
              ? 1
              : invRateRow?.rateToYER || (existing.invoice.currency === "SAR" ? 425 : 1620);
          const deltaInInv = ((nextAmount - Number(existing.amount)) * rcpRate) / invRate;
          const nextPaid = Math.max(0, Number(existing.invoice.paidAmount) + deltaInInv);
          const nextDue = Math.max(0, Number(existing.invoice.totalAmount) - nextPaid);
          await tx.salesInvoice.update({
            where: { id: existing.invoice.id },
            data: {
              paidAmount: nextPaid,
              balanceDue: nextDue,
              status: nextDue <= 0.005 ? "PAID" : nextPaid > 0 ? "PARTIALLY_PAID" : "POSTED",
            },
          });
        }

        if (existing.journalEntryId) {
          await reverseJournalEntry({
            tx,
            journalEntryId: existing.journalEntryId,
            createdById: auth.actor.userId ?? undefined,
            reason: `تعديل سند القبض ${existing.voucherNumber}`,
          });
        }

        const newJe = await postJournalEntry({
          tx,
          date: nextDate,
          reference: `${existing.voucherNumber}-REV`,
          narrationAr: `قيد معدل لسند القبض ${existing.voucherNumber} - ${existing.customer.nameAr}`,
          narrationEn: `Amended Receipt Voucher ${existing.voucherNumber}`,
          sourceType: "CUSTOMER_RECEIPT",
          sourceId: existing.id,
          projectId: existing.invoice?.projectId ?? null,
          subProjectId: nextSubProjectId,
          createdById: auth.actor.userId ?? undefined,
          lines: [
            {
              accountId: nextTreasury.accountId,
              debit: nextAmount,
              currency: existing.currency,
              exchangeRate: rcpRate,
              memo: `توريد إلى ${nextTreasury.nameAr}`,
              projectId: existing.invoice?.projectId ?? null,
              subProjectId: nextSubProjectId,
              harvestCycleId: existing.invoice?.harvestCycleId ?? null,
            },
            {
              accountId: existing.customer.accountId,
              credit: nextAmount,
              currency: existing.currency,
              exchangeRate: rcpRate,
              memo: nextNotes || `تحصيل معدل من العميل ${existing.customer.nameAr}`,
              projectId: existing.invoice?.projectId ?? null,
              subProjectId: nextSubProjectId,
              harvestCycleId: existing.invoice?.harvestCycleId ?? null,
            },
          ],
        });
        nextJournalEntryId = newJe.id;
      } else if (existing.journalEntryId && dateChanged) {
        await tx.journalEntry.update({
          where: { id: existing.journalEntryId },
          data: { date: nextDate },
        });
      }

      const receipt = await tx.receiptVoucher.update({
        where: { id },
        data: {
          date: nextDate,
          treasuryId: nextTreasuryId,
          subProjectId: nextSubProjectId,
          amount: nextAmount,
          notes: nextNotes,
          journalEntryId: nextJournalEntryId,
        },
        include: { customer: true, invoice: true, treasury: true },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "ReceiptVoucher",
        entityId: id,
        before: {
          date: existing.date.toISOString().slice(0, 10),
          amount: Number(existing.amount),
          treasuryId: existing.treasuryId,
        },
        after: {
          date: receipt.date.toISOString().slice(0, 10),
          amount: Number(receipt.amount),
          treasuryId: receipt.treasuryId,
        },
      });

      return receipt;
    });

    return NextResponse.json({ receipt: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل سند القبض";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function PATCH(req: NextRequest) {
  return handleReceiptUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleReceiptUpdate(req);
}


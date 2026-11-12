import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  postJournalEntry,
  postVendorPayment,
  recordAuditDiffTx,
  reverseJournalEntry,
} from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("vendorId");

    const payments = await prisma.paymentVoucher.findMany({
      where: {
        ...(vendorId && vendorId !== "ALL" ? { vendorId } : {}),
      },
      include: {
        vendor: { select: { id: true, code: true, nameAr: true, nameEn: true, phone: true } },
        bill: { select: { id: true, billNumber: true, totalAmount: true, balanceDue: true } },
        treasury: { select: { id: true, code: true, nameAr: true, nameEn: true, currency: true } },
        subProject: { select: { id: true, code: true, nameAr: true } },
      },
      orderBy: { date: "desc" },
    });

    return NextResponse.json({
      payments: payments.map((p) => ({
        id: p.id,
        voucherNumber: p.voucherNumber,
        date: p.date.toISOString(),
        vendorId: p.vendorId,
        vendor: p.vendor,
        billId: p.billId,
        bill: p.bill
          ? {
              id: p.bill.id,
              billNumber: p.bill.billNumber,
              totalAmount: Number(p.bill.totalAmount),
              balanceDue: Number(p.bill.balanceDue),
            }
          : null,
        treasuryId: p.treasuryId,
        treasury: p.treasury,
        amount: Number(p.amount),
        transferFee: Number(p.transferFee),
        currency: p.currency,
        referenceNumber: p.referenceNumber,
        projectId: p.projectId,
        subProjectId: p.subProjectId,
        subProject: p.subProject,
        acquisitionCycleId: p.acquisitionCycleId,
        notes: p.notes,
        journalEntryId: p.journalEntryId,
        qrVerificationHash: p.qrVerificationHash,
      })),
    });
  } catch (error) {
    console.error("GET /api/procurement/payments error:", error);
    return jsonError("تعذر تحميل سندات صرف الموردين", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "treasury",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const vendorId = String(body.vendorId || "").trim();
    const billId = body.billId ? String(body.billId).trim() : null;
    const projectId = body.projectId ? String(body.projectId).trim() : null;
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const acquisitionCycleId = body.acquisitionCycleId ? String(body.acquisitionCycleId).trim() : null;
    const treasuryId = String(body.treasuryId || "").trim();
    const amount = Number(body.amount) || 0;
    const transferFee = Number(body.transferFee) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const referenceNumber = body.referenceNumber ? String(body.referenceNumber).trim() : undefined;
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!vendorId || !treasuryId || amount <= 0) {
      return jsonError("يرجى تحديد المورد والخزينة وإدخال مبلغ صحيح", 400);
    }

    const result = await postVendorPayment({
      vendorId,
      billId,
      projectId,
      subProjectId,
      acquisitionCycleId,
      treasuryId,
      amount,
      transferFee,
      currency,
      date: body.date ? String(body.date) : new Date(),
      referenceNumber,
      notes,
      createdById: actor.userId ?? undefined,
    });

    return NextResponse.json(
      { payment: result.voucher, journalEntry: result.journalEntry },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار سند صرف المورد";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

async function handlePaymentUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف سند الصرف مطلوب للتعديل", 400);

    const existing = await prisma.paymentVoucher.findUnique({
      where: { id },
      include: { vendor: true, treasury: true },
    });
    if (!existing) return jsonError("سند الصرف غير موجود", 404);

    const dateChanged =
      body.date !== undefined &&
      String(body.date).slice(0, 10) !== existing.date.toISOString().slice(0, 10);

    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const nextAmount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      return jsonError("مبلغ الصرف غير صالح", 400);
    }
    const nextFee =
      body.transferFee !== undefined ? Math.max(0, Number(body.transferFee) || 0) : Number(existing.transferFee);
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
    const nextRef =
      body.referenceNumber !== undefined
        ? body.referenceNumber
          ? String(body.referenceNumber).trim()
          : null
        : existing.referenceNumber;

    const financialChanged =
      Math.abs(nextAmount - Number(existing.amount)) > 0.005 ||
      Math.abs(nextFee - Number(existing.transferFee)) > 0.005 ||
      nextTreasuryId !== existing.treasuryId ||
      nextSubProjectId !== existing.subProjectId;

    const updated = await prisma.$transaction(async (tx) => {
      let nextJournalEntryId = existing.journalEntryId;

      if (financialChanged) {
        const rateRow = await tx.currencyRate.findUnique({ where: { currencyCode: existing.currency } });
        const payRate =
          existing.currency === "YER"
            ? 1
            : rateRow?.rateToYER || (existing.currency === "SAR" ? 425 : 1620);

        const oldOut = Number(existing.amount) + Number(existing.transferFee);
        const oldOutYER = oldOut * payRate;
        const oldTrRateRow = await tx.currencyRate.findUnique({
          where: { currencyCode: existing.treasury.currency },
        });
        const oldTrRate =
          existing.treasury.currency === "YER"
            ? 1
            : oldTrRateRow?.rateToYER || (existing.treasury.currency === "SAR" ? 425 : 1620);

        // Restore old treasury deduction
        await tx.treasuryAccount.update({
          where: { id: existing.treasuryId },
          data: {
            balance: Number(existing.treasury.balance) + oldOutYER / oldTrRate,
            balanceYER: existing.treasury.balanceYER + oldOutYER,
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
        const newOut = nextAmount + nextFee;
        const newOutYER = newOut * payRate;

        await tx.treasuryAccount.update({
          where: { id: nextTreasury.id },
          data: {
            balance: Number(nextTreasury.balance) - newOutYER / nextTrRate,
            balanceYER: nextTreasury.balanceYER - newOutYER,
          },
        });

        if (existing.billId) {
          const bill = await tx.vendorBill.findUnique({ where: { id: existing.billId } });
          if (bill) {
            const billRateRow = await tx.currencyRate.findUnique({
              where: { currencyCode: bill.currency },
            });
            const billRate =
              bill.currency === "YER"
                ? 1
                : billRateRow?.rateToYER || (bill.currency === "SAR" ? 425 : 1620);
            const deltaInBill = ((nextAmount - Number(existing.amount)) * payRate) / billRate;
            const nextPaid = Math.max(0, Number(bill.paidAmount) + deltaInBill);
            const nextDue = Math.max(0, Number(bill.totalAmount) - nextPaid);
            await tx.vendorBill.update({
              where: { id: bill.id },
              data: {
                paidAmount: nextPaid,
                balanceDue: nextDue,
                status: nextDue <= 0.005 ? "PAID" : nextPaid > 0 ? "PARTIALLY_PAID" : "POSTED",
              },
            });
          }
        }

        if (existing.journalEntryId) {
          await reverseJournalEntry({
            tx,
            journalEntryId: existing.journalEntryId,
            createdById: auth.actor.userId ?? undefined,
            reason: `تعديل سند الصرف ${existing.voucherNumber}`,
          });
        }

        const newJe = await postJournalEntry({
          tx,
          date: nextDate,
          reference: `${existing.voucherNumber}-REV`,
          narrationAr: `قيد معدل لسند الصرف ${existing.voucherNumber} - ${existing.vendor.nameAr}`,
          narrationEn: `Amended Payment Voucher ${existing.voucherNumber}`,
          sourceType: "VENDOR_PAYMENT",
          sourceId: existing.id,
          projectId: existing.projectId,
          subProjectId: nextSubProjectId,
          createdById: auth.actor.userId ?? undefined,
          lines: [
            {
              accountId: existing.vendor.accountId,
              debit: nextAmount,
              currency: existing.currency,
              exchangeRate: payRate,
              memo: nextNotes || `سداد معدل للمورد ${existing.vendor.nameAr}`,
              projectId: existing.projectId,
              subProjectId: nextSubProjectId,
            },
            ...(nextFee > 0
              ? [
                  {
                    accountCode: "531201",
                    debit: nextFee,
                    currency: existing.currency,
                    exchangeRate: payRate,
                    memo: `رسوم تحويل معدلة ${existing.voucherNumber}`,
                    projectId: existing.projectId,
                    subProjectId: nextSubProjectId,
                  },
                ]
              : []),
            {
              accountId: nextTreasury.accountId,
              credit: newOut,
              currency: existing.currency,
              exchangeRate: payRate,
              memo: `صرف من ${nextTreasury.nameAr}`,
              projectId: existing.projectId,
              subProjectId: nextSubProjectId,
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

      const voucher = await tx.paymentVoucher.update({
        where: { id },
        data: {
          date: nextDate,
          treasuryId: nextTreasuryId,
          subProjectId: nextSubProjectId,
          amount: nextAmount,
          transferFee: nextFee,
          referenceNumber: nextRef,
          notes: nextNotes,
          journalEntryId: nextJournalEntryId,
        },
        include: { vendor: true, bill: true, treasury: true },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "PaymentVoucher",
        entityId: id,
        before: {
          date: existing.date.toISOString().slice(0, 10),
          amount: Number(existing.amount),
          transferFee: Number(existing.transferFee),
          treasuryId: existing.treasuryId,
        },
        after: {
          date: voucher.date.toISOString().slice(0, 10),
          amount: Number(voucher.amount),
          transferFee: Number(voucher.transferFee),
          treasuryId: voucher.treasuryId,
        },
      });

      return voucher;
    });

    return NextResponse.json({ payment: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل سند الصرف";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function PATCH(req: NextRequest) {
  return handlePaymentUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handlePaymentUpdate(req);
}


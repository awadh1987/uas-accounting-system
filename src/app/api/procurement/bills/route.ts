import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  postJournalEntry,
  postVendorBill,
  recordAuditDiffTx,
  reverseJournalEntry,
} from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const vendorId = searchParams.get("vendorId");

    const bills = await prisma.vendorBill.findMany({
      where: {
        ...(projectId && projectId !== "ALL" ? { projectId } : {}),
        ...(vendorId && vendorId !== "ALL" ? { vendorId } : {}),
      },
      include: {
        vendor: { select: { id: true, code: true, nameAr: true, nameEn: true, phone: true } },
        project: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        subProject: { select: { id: true, code: true, nameAr: true } },
        purchaseOrder: {
          include: { goodsReceipts: true },
        },
        paymentVouchers: true,
      },
      orderBy: { date: "desc" },
    });

    const mapped = bills.map((b) => {
      const poTotal = b.purchaseOrder ? Number(b.purchaseOrder.grandTotal) : null;
      const grnTotal = b.purchaseOrder
        ? b.purchaseOrder.goodsReceipts.reduce((s, g) => s + Number(g.receivedTotal), 0)
        : null;
      const billTotal = Number(b.totalAmount);
      const threeWayStatus = !b.purchaseOrder
        ? "DIRECT_BILL"
        : b.purchaseOrder.goodsReceipts.length === 0
        ? "AWAITING_GRN"
        : Math.abs(billTotal - (grnTotal ?? 0)) <= 0.01 && Math.abs((poTotal ?? 0) - billTotal) <= 0.01
        ? "MATCHED"
        : "VARIANCE_DETECTED";

      return {
        id: b.id,
        billNumber: b.billNumber,
        vendorId: b.vendorId,
        vendor: b.vendor,
        projectId: b.projectId,
        project: b.project,
        subProjectId: b.subProjectId,
        subProject: b.subProject,
        purchaseOrderId: b.purchaseOrderId,
        poNumber: b.purchaseOrder?.poNumber || null,
        date: b.date.toISOString(),
        dueDate: b.dueDate ? b.dueDate.toISOString() : null,
        status: b.status,
        totalAmount: billTotal,
        paidAmount: Number(b.paidAmount),
        balanceDue: Number(b.balanceDue),
        currency: b.currency,
        isInventory: b.isInventory,
        journalEntryId: b.journalEntryId,
        notes: b.notes,
        threeWayStatus,
        paymentCount: b.paymentVouchers.length,
      };
    });

    return NextResponse.json({ bills: mapped });
  } catch (error) {
    console.error("GET /api/procurement/bills error:", error);
    return jsonError("تعذر تحميل فواتير الموردين", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "create",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const vendorId = String(body.vendorId || "").trim();
    const projectId = String(body.projectId || "").trim();
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const purchaseOrderId = body.purchaseOrderId ? String(body.purchaseOrderId).trim() : null;
    const acquisitionCycleId = body.acquisitionCycleId ? String(body.acquisitionCycleId).trim() : null;
    const totalAmount = Number(body.totalAmount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const isInventory = Boolean(body.isInventory);
    const debitAccountCode = body.debitAccountCode ? String(body.debitAccountCode).trim() : undefined;
    const debitAccountId = body.debitAccountId ? String(body.debitAccountId).trim() : undefined;
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!vendorId || !projectId || totalAmount <= 0) {
      return jsonError("يرجى تحديد المورد والمشروع وإدخال مبلغ الفاتورة", 400);
    }

    const result = await postVendorBill({
      vendorId,
      projectId,
      subProjectId,
      purchaseOrderId,
      acquisitionCycleId,
      totalAmount,
      currency,
      date: body.date ? String(body.date) : new Date(),
      dueDate: body.dueDate ? String(body.dueDate) : null,
      isInventory,
      debitAccountCode,
      debitAccountId,
      notes,
      createdById: actor.userId ?? undefined,
    });

    return NextResponse.json(
      { bill: result.bill, journalEntry: result.journalEntry },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار فاتورة المورد";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

async function handleBillUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف فاتورة المورد مطلوب للتعديل", 400);

    const existing = await prisma.vendorBill.findUnique({
      where: { id },
      include: { vendor: true },
    });
    if (!existing) return jsonError("فاتورة المورد غير موجودة", 404);
    if (existing.status === "VOIDED") return jsonError("لا يمكن تعديل فاتورة ملغاة", 400);

    const dateChanged =
      body.date !== undefined &&
      String(body.date).slice(0, 10) !== existing.date.toISOString().slice(0, 10);

    const auth = await authorizeApiAction(body, req, {
      moduleId: "procurement",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const nextTotal =
      body.totalAmount !== undefined ? Number(body.totalAmount) : Number(existing.totalAmount);
    if (!Number.isFinite(nextTotal) || nextTotal <= 0) {
      return jsonError("إجمالي الفاتورة يجب أن يكون أكبر من صفر", 400);
    }

    const nextDate = body.date ? new Date(String(body.date)) : existing.date;
    const nextProjectId = body.projectId ? String(body.projectId).trim() : existing.projectId;
    const nextSubProjectId =
      body.subProjectId !== undefined
        ? body.subProjectId
          ? String(body.subProjectId).trim()
          : null
        : existing.subProjectId;
    const nextNotes = body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : existing.notes;
    const nextDebitAccountId = body.debitAccountId
      ? String(body.debitAccountId).trim()
      : existing.debitAccountId;
    const nextCurrency = body.currency ? String(body.currency).toUpperCase() : existing.currency;

    const financialChanged =
      Math.abs(nextTotal - Number(existing.totalAmount)) > 0.005 ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCurrency !== existing.currency ||
      (nextDebitAccountId && nextDebitAccountId !== existing.debitAccountId);

    const updated = await prisma.$transaction(async (tx) => {
      let nextJournalEntryId = existing.journalEntryId;

      if (financialChanged && existing.journalEntryId) {
        await reverseJournalEntry({
          tx,
          journalEntryId: existing.journalEntryId,
          createdById: auth.actor.userId ?? undefined,
          reason: `تعديل فاتورة المورد ${existing.billNumber}`,
        });

        let debitAccId = nextDebitAccountId;
        if (!debitAccId) {
          const fallbackAcc = await tx.account.findUnique({
            where: { code: existing.isInventory ? "113201" : "524101" },
          });
          debitAccId = fallbackAcc?.id ?? null;
        }
        if (!debitAccId) throw new Error("DEBIT_ACCOUNT_NOT_FOUND");

        const rateRow = await tx.currencyRate.findUnique({ where: { currencyCode: nextCurrency } });
        const rate = nextCurrency === "YER" ? 1 : rateRow?.rateToYER || (nextCurrency === "SAR" ? 425 : 1620);

        const newJe = await postJournalEntry({
          tx,
          date: nextDate,
          reference: `${existing.billNumber}-REV`,
          narrationAr: `قيد معدل لفاتورة المورد ${existing.billNumber} - ${existing.vendor.nameAr}`,
          narrationEn: `Amended Vendor Bill ${existing.billNumber}`,
          sourceType: "VENDOR_BILL",
          sourceId: existing.id,
          projectId: nextProjectId,
          subProjectId: nextSubProjectId,
          createdById: auth.actor.userId ?? undefined,
          lines: [
            {
              accountId: debitAccId,
              debit: nextTotal,
              currency: nextCurrency,
              exchangeRate: rate,
              memo: nextNotes || `مشتريات معدلة - ${existing.vendor.nameAr}`,
              projectId: nextProjectId,
              subProjectId: nextSubProjectId,
            },
            {
              accountId: existing.vendor.accountId,
              credit: nextTotal,
              currency: nextCurrency,
              exchangeRate: rate,
              memo: `ذمة دائنة - ${existing.vendor.nameAr}`,
              projectId: nextProjectId,
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

      const paid = Number(existing.paidAmount);
      const nextDue = Math.max(0, nextTotal - paid);
      const nextStatus =
        nextDue <= 0.005 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "POSTED";

      const bill = await tx.vendorBill.update({
        where: { id },
        data: {
          projectId: nextProjectId,
          subProjectId: nextSubProjectId,
          date: nextDate,
          ...(body.dueDate !== undefined
            ? { dueDate: body.dueDate ? new Date(String(body.dueDate)) : null }
            : {}),
          totalAmount: nextTotal,
          balanceDue: nextDue,
          status: nextStatus,
          currency: nextCurrency,
          debitAccountId: nextDebitAccountId,
          journalEntryId: nextJournalEntryId,
          notes: nextNotes,
        },
        include: { vendor: true, project: true, subProject: true },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "VendorBill",
        entityId: id,
        before: {
          date: existing.date.toISOString().slice(0, 10),
          totalAmount: Number(existing.totalAmount),
          projectId: existing.projectId,
          notes: existing.notes,
        },
        after: {
          date: bill.date.toISOString().slice(0, 10),
          totalAmount: Number(bill.totalAmount),
          projectId: bill.projectId,
          notes: bill.notes,
        },
      });

      return bill;
    });

    return NextResponse.json({ bill: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل فاتورة المورد";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function PATCH(req: NextRequest) {
  return handleBillUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleBillUpdate(req);
}


import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  postJournalEntry,
  postSalesInvoice,
  recordAuditDiffTx,
  reverseJournalEntry,
} from "@/lib/accounting/ledgerService";
import { mapProjectIdToSalesRevenueCode } from "@/lib/accounting/coaCatalog";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const invoices = await prisma.salesInvoice.findMany({
      where: projectId && projectId !== "ALL" ? { projectId } : undefined,
      include: {
        customer: { select: { id: true, code: true, nameAr: true, phone: true } },
        project: { select: { id: true, code: true, nameAr: true } },
        subProject: { select: { id: true, code: true, nameAr: true } },
        harvestCycle: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({
      invoices: invoices.map((inv) => ({
        ...inv,
        totalAmount: Number(inv.totalAmount),
        paidAmount: Number(inv.paidAmount),
        balanceDue: Number(inv.balanceDue),
      })),
    });
  } catch (error) {
    console.error("GET /api/sales/invoices error:", error);
    return jsonError("تعذر تحميل فواتير المبيعات", 500);
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
    const projectId = String(body.projectId || "").trim();
    const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
    const harvestCycleId = body.harvestCycleId ? String(body.harvestCycleId).trim() : null;
    const amount = Number(body.amount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const notes = body.notes ? String(body.notes).trim() : undefined;

    if (!customerId || !projectId || amount <= 0) {
      return jsonError("يرجى تحديد العميل والمشروع وإدخال المبلغ", 400);
    }

    const customAccount =
      body.customAccount && typeof body.customAccount === "object"
        ? (body.customAccount as { nameAr: string; nameEn?: string; parentCode: string; code?: string })
        : undefined;
    const revenueAccountCode = body.revenueAccountCode ? String(body.revenueAccountCode).trim() : undefined;
    const revenueAccountId = body.revenueAccountId ? String(body.revenueAccountId).trim() : undefined;
    const treasuryAccountId = body.treasuryAccountId ? String(body.treasuryAccountId).trim() : undefined;
    const sequenceNumber = body.sequenceNumber ? String(body.sequenceNumber).trim() : undefined;
    const dailyBatchLabel = body.dailyBatchLabel ? String(body.dailyBatchLabel).trim() : undefined;
    const salesOfficerId = body.salesOfficerId ? String(body.salesOfficerId).trim() : undefined;
    const salesOfficerTitle = body.salesOfficerTitle ? String(body.salesOfficerTitle).trim() : undefined;

    const result = await postSalesInvoice({
      customerId,
      projectId,
      subProjectId,
      harvestCycleId,
      amount,
      currency,
      date: body.date ? String(body.date) : new Date(),
      notes,
      revenueAccountId,
      revenueAccountCode,
      customAccount,
      sequenceNumber,
      dailyBatchLabel,
      salesOfficerId,
      salesOfficerTitle,
      treasuryAccountId,
      createdById: actor.userId ?? undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إصدار فاتورة المبيعات";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, 400);
  }
}

async function handleInvoiceUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف فاتورة المبيعات مطلوب", 400);

    const existing = await prisma.salesInvoice.findUnique({
      where: { id },
      include: { customer: true, project: true, harvestCycle: true },
    });
    if (!existing) return jsonError("فاتورة المبيعات غير موجودة", 404);
    if (existing.status === "VOIDED") return jsonError("لا يمكن تعديل فاتورة ملغاة", 400);
    if (existing.harvestCycle?.isLocked) return lockedError();

    const dateChanged =
      body.date !== undefined &&
      String(body.date).slice(0, 10) !== existing.date.toISOString().slice(0, 10);

    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const nextAmount = body.amount !== undefined ? Number(body.amount) : Number(existing.totalAmount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      return jsonError("قيمة الفاتورة غير صالحة", 400);
    }
    const nextProjectId = body.projectId ? String(body.projectId).trim() : existing.projectId;
    const nextSubProjectId =
      body.subProjectId !== undefined
        ? body.subProjectId
          ? String(body.subProjectId).trim()
          : null
        : existing.subProjectId;
    const nextCycleId =
      body.harvestCycleId !== undefined
        ? body.harvestCycleId
          ? String(body.harvestCycleId).trim()
          : null
        : existing.harvestCycleId;
    const nextDate = body.date ? new Date(String(body.date)) : existing.date;
    const nextNotes =
      body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : existing.notes;

    if (nextCycleId && nextCycleId !== existing.harvestCycleId) {
      const targetCycle = await prisma.harvestCycle.findUnique({ where: { id: nextCycleId } });
      if (targetCycle?.isLocked) return lockedError();
    }

    const financialChanged =
      Math.abs(nextAmount - Number(existing.totalAmount)) > 0.005 ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCycleId !== existing.harvestCycleId;

    const updated = await prisma.$transaction(async (tx) => {
      let nextJournalEntryId = existing.journalEntryId;
      if (financialChanged && existing.journalEntryId) {
        await reverseJournalEntry({
          tx,
          journalEntryId: existing.journalEntryId,
          createdById: auth.actor.userId ?? undefined,
          reason: `تعديل فاتورة مبيعات ${existing.invoiceNumber}`,
        });

        const rateRow = await tx.currencyRate.findUnique({ where: { currencyCode: existing.currency } });
        const rate =
          existing.currency === "YER"
            ? 1
            : rateRow?.rateToYER || (existing.currency === "SAR" ? 425 : 1620);

        const newJe = await postJournalEntry({
          tx,
          date: nextDate,
          reference: `${existing.invoiceNumber}-REV`,
          narrationAr: `قيد معدل لفاتورة مبيعات ${existing.invoiceNumber} - ${existing.customer.nameAr}`,
          narrationEn: `Amended Sales Invoice ${existing.invoiceNumber}`,
          sourceType: "SALES_INVOICE",
          sourceId: existing.id,
          projectId: nextProjectId,
          subProjectId: nextSubProjectId,
          createdById: auth.actor.userId ?? undefined,
          lines: [
            {
              accountId: existing.customer.accountId,
              debit: nextAmount,
              currency: existing.currency,
              exchangeRate: rate,
              memo: `ذمة مدينة معدلة - ${existing.customer.nameAr}`,
              projectId: nextProjectId,
              subProjectId: nextSubProjectId,
              harvestCycleId: nextCycleId,
            },
            {
              accountCode: mapProjectIdToSalesRevenueCode(nextProjectId),
              credit: nextAmount,
              currency: existing.currency,
              exchangeRate: rate,
              memo: nextNotes || `إيراد مبيعات معدل`,
              projectId: nextProjectId,
              subProjectId: nextSubProjectId,
              harvestCycleId: nextCycleId,
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
      const nextDue = Math.max(0, nextAmount - paid);
      const invoice = await tx.salesInvoice.update({
        where: { id },
        data: {
          projectId: nextProjectId,
          subProjectId: nextSubProjectId,
          harvestCycleId: nextCycleId,
          date: nextDate,
          totalAmount: nextAmount,
          balanceDue: nextDue,
          status: nextDue <= 0.005 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "POSTED",
          notes: nextNotes,
          journalEntryId: nextJournalEntryId,
        },
        include: { customer: true, project: true, harvestCycle: true },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "SalesInvoice",
        entityId: id,
        before: {
          date: existing.date.toISOString().slice(0, 10),
          totalAmount: Number(existing.totalAmount),
          projectId: existing.projectId,
        },
        after: {
          date: invoice.date.toISOString().slice(0, 10),
          totalAmount: Number(invoice.totalAmount),
          projectId: invoice.projectId,
        },
      });

      return invoice;
    });

    return NextResponse.json({ invoice: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل فاتورة المبيعات";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, 400);
  }
}

export async function PATCH(req: NextRequest) {
  return handleInvoiceUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleInvoiceUpdate(req);
}


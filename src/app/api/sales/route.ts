import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeQrVerificationCode, computeSaleTotals } from "@/lib/formulas";
import {
  ensureCustomerWithAccountTx,
  postCustomerReceipt,
  postSalesInvoice,
  updateSaleTransactionAtomic,
} from "@/lib/accounting/ledgerService";
import {
  appendAuditLogTx,
  findHarvestCycle,
  getBootstrapState,
  isHarvestLockedTx,
} from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

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

    const projectId = String(body.projectId || "").trim();
    const harvestName = String(body.harvest || "").trim();
    const saleBatchLabel = String(body.batch || "عملية بيع 1").trim();
    const productGrade = String(body.grade || "رقم 1").trim();
    const customerName = String(body.customer || "").trim();
    const customerPhone = String(body.phone || "783118231").trim();
    const bundlesCount = Math.max(0, Math.round(Number(body.bundles) || 0));
    const unitPrice = Number(body.price) || 0;
    const creditPaid = Number(body.credit) || 0;
    const saleDate = String(body.date || new Date().toISOString().slice(0, 10));
    const receiptVoucherNo =
      String(body.voucherNo || "").trim() || `RV-${Math.floor(100 + Math.random() * 900)}`;
    const notes = String(body.notes || "").trim();

    if (!customerName || !projectId || !harvestName) {
      return jsonError("يرجى إدخال اسم العميل والمشروع والقطفة", 400);
    }

    const { totalAmount, debitReceivable } = computeSaleTotals(bundlesCount, unitPrice, creditPaid);

    const result = await prisma.$transaction(async (tx) => {
      if (await isHarvestLockedTx(tx, projectId, harvestName)) {
        return { locked: true as const };
      }

      const cycle = await findHarvestCycle(tx, projectId, harvestName);
      const customer = await ensureCustomerWithAccountTx(tx, {
        name: customerName,
        phone: customerPhone,
      });

      let journalEntryId: string | null = null;
      if (totalAmount > 0) {
        const invRes = await postSalesInvoice({
          tx,
          customerId: customer.id,
          projectId,
          harvestCycleId: cycle?.id ?? null,
          amount: totalAmount,
          currency: "YER",
          date: new Date(`${saleDate}T10:00:00Z`),
          notes: notes || `${saleBatchLabel} (${bundlesCount} × ${unitPrice})`,
          createdById: actor.userId ?? undefined,
        });
        journalEntryId = invRes.journalEntry.id;

        if (creditPaid > 0) {
          await postCustomerReceipt({
            tx,
            customerId: customer.id,
            invoiceId: invRes.invoice.id,
            treasuryId: "t1",
            amount: creditPaid,
            currency: "YER",
            date: new Date(`${saleDate}T10:05:00Z`),
            notes: `تحصيل عند البيع (${receiptVoucherNo})`,
            createdById: actor.userId ?? undefined,
          });
        }
      }

      const sale = await tx.saleTransaction.create({
        data: {
          projectId,
          harvestCycleId: cycle?.id ?? null,
          harvestName,
          saleBatchLabel,
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          productGrade,
          bundlesCount,
          unitPrice,
          totalAmount,
          creditPaid,
          debitReceivable,
          saleDate,
          receiptVoucherNo,
          notes,
          journalEntryId,
        },
      });

      if (creditPaid > 0) {
        const existingV = await tx.installmentVoucher.findUnique({
          where: { voucherNo: receiptVoucherNo },
        });
        const finalVNo = existingV ? `${receiptVoucherNo}-${Date.now().toString().slice(-4)}` : receiptVoucherNo;
        await tx.installmentVoucher.create({
          data: {
            voucherNo: finalVNo,
            type: "CUSTOMER_RECEIPT",
            saleTransactionId: sale.id,
            targetName: `${customer.name} (${saleBatchLabel})`,
            phone: customer.phone,
            treasuryAccountId: "t1",
            amountYER: creditPaid,
            qrVerificationHash: computeQrVerificationCode(
              `INST:${finalVNo}|PARTY:${customer.name}|AMT:${creditPaid}|DATE:${saleDate}`
            ),
            paymentDate: saleDate,
            notes: `دفعة مسددة عند البيع (${saleBatchLabel})`,
            journalEntryId,
          },
        });
      }

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة عملية بيع",
        entityReference: sale.id,
        details: `${customerName} — ${saleBatchLabel} (${bundlesCount} × ${unitPrice} = ${totalAmount.toLocaleString("en-US")} ريال، سند ${receiptVoucherNo})`,
      });

      return { locked: false as const, sale };
    });

    if (result.locked) return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ createdId: result.sale.id, state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/sales error:", error);
    return jsonError("تعذر حفظ عملية البيع", 500);
  }
}

async function handleSalePatch(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف عملية البيع مطلوب للتعديل", 400);

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
      harvestName: body.harvest ? String(body.harvest) : undefined,
      batch: body.batch ? String(body.batch) : undefined,
      customer: body.customer ? String(body.customer) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      grade: body.grade ? String(body.grade) : undefined,
      bundles: body.bundles !== undefined ? Number(body.bundles) : undefined,
      price: body.price !== undefined ? Number(body.price) : undefined,
      credit: body.credit !== undefined ? Number(body.credit) : undefined,
      date: body.date ? String(body.date) : undefined,
      voucherNo: body.voucherNo ? String(body.voucherNo) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
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

export async function PATCH(req: NextRequest) {
  return handleSalePatch(req);
}

export async function PUT(req: NextRequest) {
  return handleSalePatch(req);
}

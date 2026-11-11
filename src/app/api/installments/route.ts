import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeQrVerificationCode } from "@/lib/formulas";
import { ensureWorkerWithAccountTx, postJournalEntry } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { extractActor, jsonError, lockedError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const type = String(body.type || "CUSTOMER_RECEIPT");
    const targetId = String(body.targetId || "").trim();
    const treasuryId = String(body.treasuryId || "t1").trim();
    const amount = Number(body.amount) || 0;
    const baseVoucherNo =
      String(body.voucherNo || "").trim() ||
      `${type === "CUSTOMER_RECEIPT" ? "RV" : "PV"}-INST-${Math.floor(100 + Math.random() * 900)}`;
    const paymentDate = String(body.date || new Date().toISOString().slice(0, 10));
    const notes = String(body.notes || "دفعة مسجلة").trim();
    const actor = extractActor(body);

    if (amount <= 0 || !targetId) {
      return jsonError("يرجى تحديد السجل وإدخال مبلغ صحيح", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const treasury = await tx.treasuryAccount.findUnique({ where: { id: treasuryId } });
      if (!treasury) return { status: "TREASURY_NOT_FOUND" as const };

      let targetName = "";
      let phone = "783118231";
      let saleTransactionId: string | null = null;
      let workerWageEntryId: string | null = null;
      let journalEntryId: string | null = null;

      const existingVoucher = await tx.installmentVoucher.findUnique({
        where: { voucherNo: baseVoucherNo },
      });
      const voucherNo = existingVoucher
        ? `${baseVoucherNo}-${Date.now().toString().slice(-4)}`
        : baseVoucherNo;

      if (type === "CUSTOMER_RECEIPT") {
        const sale = await tx.saleTransaction.findUnique({
          where: { id: targetId },
          include: { customer: true },
        });
        if (!sale) return { status: "TARGET_NOT_FOUND" as const };
        if (await isHarvestLockedTx(tx, sale.projectId, sale.harvestName)) {
          return { status: "LOCKED" as const };
        }
        const nextCredit = sale.creditPaid + amount;
        const nextDebit = sale.totalAmount - nextCredit;
        await tx.saleTransaction.update({
          where: { id: sale.id },
          data: { creditPaid: nextCredit, debitReceivable: nextDebit },
        });
        await tx.treasuryAccount.update({
          where: { id: treasury.id },
          data: {
            balance: Number(treasury.balance) + amount,
            balanceYER: treasury.balanceYER + amount,
          },
        });
        const je = await postJournalEntry({
          tx,
          date: new Date(`${paymentDate}T12:00:00Z`),
          reference: voucherNo,
          narrationAr: `سند قبض دفعة ${voucherNo} من ${sale.customerName}`,
          narrationEn: `Customer Receipt ${voucherNo} - ${sale.customerName}`,
          sourceType: "CUSTOMER_RECEIPT",
          projectId: sale.projectId,
          createdById: actor.userId ?? undefined,
          lines: [
            {
              accountId: treasury.accountId,
              debit: amount,
              projectId: sale.projectId,
              harvestCycleId: sale.harvestCycleId,
              memo: `تحصيل إلى ${treasury.nameAr}`,
            },
            {
              accountId: sale.customer.accountId,
              credit: amount,
              projectId: sale.projectId,
              harvestCycleId: sale.harvestCycleId,
              memo: `تخفيض مديونية ${sale.customerName}`,
            },
          ],
        });
        journalEntryId = je.id;
        targetName = `${sale.customerName} (${sale.saleBatchLabel})`;
        phone = sale.customerPhone || "783118231";
        saleTransactionId = sale.id;
      } else {
        const workerEntry = await tx.workerWageEntry.findUnique({
          where: { id: targetId },
          include: { worker: true },
        });
        if (!workerEntry) return { status: "TARGET_NOT_FOUND" as const };
        if (await isHarvestLockedTx(tx, workerEntry.projectId, workerEntry.harvestName)) {
          return { status: "LOCKED" as const };
        }
        const nextCredit = workerEntry.creditAmount + amount;
        const nextDebit = workerEntry.totalWage - nextCredit;
        await tx.workerWageEntry.update({
          where: { id: workerEntry.id },
          data: { creditAmount: nextCredit, debitBalance: nextDebit },
        });
        await tx.treasuryAccount.update({
          where: { id: treasury.id },
          data: {
            balance: Number(treasury.balance) - amount,
            balanceYER: treasury.balanceYER - amount,
          },
        });
        const workerRec = workerEntry.worker.accountId
          ? workerEntry.worker
          : await ensureWorkerWithAccountTx(tx, { name: workerEntry.workerName });

        if (workerRec.accountId) {
          const je = await postJournalEntry({
            tx,
            date: new Date(`${paymentDate}T12:00:00Z`),
            reference: voucherNo,
            narrationAr: `سند صرف دفعة أجر ${voucherNo} للعامل ${workerEntry.workerName}`,
            narrationEn: `Worker Payout ${voucherNo} - ${workerEntry.workerName}`,
            sourceType: "WORKER_PAYOUT",
            projectId: workerEntry.projectId,
            createdById: actor.userId ?? undefined,
            lines: [
              {
                accountId: workerRec.accountId,
                debit: amount,
                projectId: workerEntry.projectId,
                harvestCycleId: workerEntry.harvestCycleId,
                memo: `صرف مستحقات العامل ${workerEntry.workerName}`,
              },
              {
                accountId: treasury.accountId,
                credit: amount,
                projectId: workerEntry.projectId,
                harvestCycleId: workerEntry.harvestCycleId,
                memo: `صرف من ${treasury.nameAr}`,
              },
            ],
          });
          journalEntryId = je.id;
        }
        targetName = `${workerEntry.workerName} (${workerEntry.harvestName})`;
        workerWageEntryId = workerEntry.id;
      }

      const qrVerificationHash = computeQrVerificationCode(
        `INST:${voucherNo}|PARTY:${targetName}|AMT:${amount}|DATE:${paymentDate}`
      );

      const voucher = await tx.installmentVoucher.create({
        data: {
          voucherNo,
          type,
          saleTransactionId,
          workerWageEntryId,
          targetName,
          phone,
          treasuryAccountId: treasury.id,
          amountYER: amount,
          qrVerificationHash,
          paymentDate,
          notes,
          journalEntryId,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: type === "CUSTOMER_RECEIPT" ? "سند قبض دفعة عميل" : "سند صرف دفعة عامل",
        entityReference: voucher.id,
        details: `سند ${voucherNo} — ${targetName} — المبلغ: ${amount.toLocaleString("en-US")} ريال`,
      });

      return { status: "OK" as const, voucher };
    });

    if (result.status === "TREASURY_NOT_FOUND") return jsonError("حساب الخزينة غير موجود", 404);
    if (result.status === "TARGET_NOT_FOUND") return jsonError("السجل المرتبط غير موجود", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json(
      { createdId: result.voucher.id, voucherNo: result.voucher.voucherNo, state },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/installments error:", error);
    return jsonError("تعذر حفظ سند الدفعة", 500);
  }
}

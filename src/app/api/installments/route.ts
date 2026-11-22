import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { computeQrVerificationCode } from "@/lib/formulas";
import { ensureWorkerWithAccountTx, postJournalEntry, reverseJournalEntry } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "create",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const type = String(body.type || "CUSTOMER_RECEIPT");
    const targetId = String(body.targetId || "").trim();
    const treasuryId = String(body.treasuryId || "t1").trim();
    const amount = Number(body.amount) || 0;
    const baseVoucherNo =
      String(body.voucherNo || "").trim() ||
      `${type === "CUSTOMER_RECEIPT" ? "RV" : "PV"}-INST-${Math.floor(100 + Math.random() * 900)}`;
    const paymentDate = String(body.date || new Date().toISOString().slice(0, 10));
    const notes = String(body.notes || "دفعة مسجلة").trim();

    if (amount <= 0 || !targetId) {
      return jsonError("يرجى تحديد السجل وإدخال مبلغ صحيح", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const treasury = await tx.treasuryAccount.findUnique({ where: { id: treasuryId } });
      if (!treasury) return { status: "TREASURY_NOT_FOUND" as const };

      let targetName = "";
      let phone = "";
      let saleTransactionId: string | null = null;
      let workerWageEntryId: string | null = null;
      let journalEntryId: string | null = null;

      const existingVoucher = await tx.installmentVoucher.findUnique({
        where: { voucherNo: baseVoucherNo },
      });
      const voucherNo = existingVoucher
        ? `${baseVoucherNo}-${Date.now().toString().slice(-4)}`
        : baseVoucherNo;

      const resolveTreasuryRate = async (currency: string) => {
        const c = (currency || "YER").toUpperCase();
        if (c === "YER") return 1;
        const r = await tx.currencyRate.findUnique({ where: { currencyCode: c } });
        return Number(r?.rateToYER) || (c === "SAR" ? 425 : c === "USD" ? 1620 : 1);
      };
      const trRate = await resolveTreasuryRate(treasury.currency);

      if (type === "CUSTOMER_RECEIPT") {
        const sale = await tx.saleTransaction.findUnique({
          where: { id: targetId },
          include: { customer: true },
        });
        if (!sale) return { status: "TARGET_NOT_FOUND" as const };
        if (await isHarvestLockedTx(tx, sale.projectId, sale.harvestName)) {
          return { status: "LOCKED" as const };
        }
        const nextCredit = Number(sale.creditPaid) + amount;
        const nextDebit = Number(sale.totalAmount) - nextCredit;
        await tx.saleTransaction.update({
          where: { id: sale.id },
          data: { creditPaid: nextCredit, debitReceivable: nextDebit },
        });
        await tx.treasuryAccount.update({
          where: { id: treasury.id },
          data: {
            balance: Number(treasury.balance) + amount / trRate,
            balanceYER: Number(treasury.balanceYER) + amount,
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
          costCenterId: body.costCenterId ? String(body.costCenterId).trim() : sale.customer.costCenterId ?? null,
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
        phone = sale.customerPhone || "";
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
        const nextCredit = Number(workerEntry.creditAmount) + amount;
        const nextDebit = Number(workerEntry.totalWage) - nextCredit;
        await tx.workerWageEntry.update({
          where: { id: workerEntry.id },
          data: { creditAmount: nextCredit, debitBalance: nextDebit },
        });
        await tx.treasuryAccount.update({
          where: { id: treasury.id },
          data: {
            balance: Number(treasury.balance) - amount / trRate,
            balanceYER: Number(treasury.balanceYER) - amount,
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
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let id = searchParams.get("id");
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
      if (!id && body.id) id = String(body.id).trim();
    } catch {
      // Body may be empty
    }

    if (!id) return jsonError("يرجى تحديد معرف السند المطلوب حذفه", 400);
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const result = await prisma.$transaction(async (tx) => {
      const voucher = await tx.installmentVoucher.findUnique({ where: { id } });
      if (!voucher) return { status: "NOT_FOUND" as const };

      const voucherAmt = Number(voucher.amountYER);

      // Revert sale balances
      if (voucher.saleTransactionId) {
        const sale = await tx.saleTransaction.findUnique({ where: { id: voucher.saleTransactionId } });
        if (sale) {
          const nextCredit = Math.max(0, Number(sale.creditPaid) - voucherAmt);
          const nextDebit = Math.max(0, Number(sale.totalAmount) - nextCredit);
          await tx.saleTransaction.update({
            where: { id: sale.id },
            data: { creditPaid: nextCredit, debitReceivable: nextDebit },
          });
        }
      }

      // Revert worker balances
      if (voucher.workerWageEntryId) {
        const worker = await tx.workerWageEntry.findUnique({ where: { id: voucher.workerWageEntryId } });
        if (worker) {
          const nextCredit = Math.max(0, Number(worker.creditAmount) - voucherAmt);
          const nextDebit = Math.max(0, Number(worker.totalWage) - nextCredit);
          await tx.workerWageEntry.update({
            where: { id: worker.id },
            data: { creditAmount: nextCredit, debitBalance: nextDebit },
          });
        }
      }

      // Revert treasury balance & balanceYER atomically
      const treasury = await tx.treasuryAccount.findUnique({ where: { id: voucher.treasuryAccountId } });
      if (treasury) {
        const tCur = (treasury.currency || "YER").toUpperCase();
        const tRateRow =
          tCur === "YER" ? null : await tx.currencyRate.findUnique({ where: { currencyCode: tCur } });
        const tRate = tCur === "YER" ? 1 : Number(tRateRow?.rateToYER) || (tCur === "SAR" ? 425 : 1620);
        const delta = voucher.type === "CUSTOMER_RECEIPT" ? -voucherAmt : voucherAmt;
        await tx.treasuryAccount.update({
          where: { id: treasury.id },
          data: {
            balance: Number(treasury.balance) + delta / tRate,
            balanceYER: Number(treasury.balanceYER) + delta,
          },
        });
      }

      // Atomic reversal of journal entry (never hard-delete posted GL entries)
      if (voucher.journalEntryId) {
        const existingJe = await tx.journalEntry.findUnique({
          where: { id: voucher.journalEntryId },
          select: { status: true, isReversed: true },
        });
        if (existingJe && existingJe.status !== "VOIDED" && !existingJe.isReversed) {
          await reverseJournalEntry({
            journalEntryId: voucher.journalEntryId,
            reason: `إلغاء سند دفعة: ${voucher.voucherNo}`,
            createdById: actor.userId ?? undefined,
            tx,
          });
        }
      }

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "عكس وحذف سند دفعة",
        entityReference: voucher.id,
        details: `سند ${voucher.voucherNo} — المبلغ: ${voucherAmt.toLocaleString()} ريال`,
      });

      await tx.installmentVoucher.delete({ where: { id: voucher.id } });

      return { status: "OK" as const, voucher };
    });

    if (result.status === "NOT_FOUND") return jsonError("السند غير موجود", 404);

    const state = await getBootstrapState();
    return NextResponse.json({ success: true, deletedId: id, voucherNo: result.voucher.voucherNo, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر حذف سند الدفعة";
    return jsonError(msg, 400);
  }
});

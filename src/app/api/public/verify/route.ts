import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateFinancialReports } from "@/lib/accounting/ledgerService";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();

    if (!q) {
      const [profile, projectCount, vendorCount, customerCount, journalCount, reports] =
        await Promise.all([
          prisma.enterpriseProfile.findUnique({ where: { id: "default" } }),
          prisma.project.count(),
          prisma.vendor.count(),
          prisma.customer.count(),
          prisma.journalEntry.count({ where: { status: "POSTED" } }),
          generateFinancialReports(),
        ]);

      return NextResponse.json({
        profile,
        metrics: {
          projects: projectCount,
          vendors: vendorCount,
          customers: customerCount,
          postedJournals: journalCount,
          totalAssets: reports.balanceSheet.totalAssets,
          totalRevenue: reports.incomeStatement.totalRevenue,
          isLedgerBalanced: reports.trialBalance.isBalanced,
        },
      });
    }

    // Lookup voucher/document by Voucher No, Invoice No, Bill No, Journal Entry No, or QR Hash
    const [installment, payment, receipt, invoice, bill, journal] = await Promise.all([
      prisma.installmentVoucher.findFirst({
        where: { OR: [{ voucherNo: q }, { qrVerificationHash: q }] },
        include: { treasuryAccount: { select: { nameAr: true, accountNumber: true } } },
      }),
      prisma.paymentVoucher.findFirst({
        where: { OR: [{ voucherNumber: q }, { qrVerificationHash: q }] },
        include: {
          vendor: { select: { nameAr: true, code: true } },
          treasury: { select: { nameAr: true } },
        },
      }),
      prisma.receiptVoucher.findFirst({
        where: { OR: [{ voucherNumber: q }, { qrVerificationHash: q }] },
        include: {
          customer: { select: { nameAr: true, code: true } },
          treasury: { select: { nameAr: true } },
        },
      }),
      prisma.salesInvoice.findFirst({
        where: { OR: [{ invoiceNumber: q }, { qrVerificationHash: q }] },
        include: {
          customer: { select: { nameAr: true } },
          project: { select: { nameAr: true } },
        },
      }),
      prisma.vendorBill.findFirst({
        where: { billNumber: q },
        include: {
          vendor: { select: { nameAr: true } },
          project: { select: { nameAr: true } },
        },
      }),
      prisma.journalEntry.findFirst({
        where: { OR: [{ entryNumber: q }, { reference: q }] },
        include: { lines: true },
      }),
    ]);

    if (installment) {
      return NextResponse.json({
        verified: true,
        documentType: installment.type === "CUSTOMER_RECEIPT" ? "سند قبض عميل" : "سند صرف عامل",
        reference: installment.voucherNo,
        party: installment.targetName,
        amount: installment.amountYER,
        currency: "YER",
        date: installment.paymentDate,
        treasury: installment.treasuryAccount.nameAr,
        hash: installment.qrVerificationHash,
        status: "VERIFIED_IMMUTABLE",
      });
    }
    if (payment) {
      return NextResponse.json({
        verified: true,
        documentType: "سند صرف مورد (Payment Voucher)",
        reference: payment.voucherNumber,
        party: payment.vendor.nameAr,
        amount: Number(payment.amount),
        currency: payment.currency,
        date: payment.date.toISOString().slice(0, 10),
        treasury: payment.treasury.nameAr,
        hash: payment.qrVerificationHash,
        status: "POSTED_TO_GL",
      });
    }
    if (receipt) {
      return NextResponse.json({
        verified: true,
        documentType: "سند قبض مبيعات (Receipt Voucher)",
        reference: receipt.voucherNumber,
        party: receipt.customer.nameAr,
        amount: Number(receipt.amount),
        currency: receipt.currency,
        date: receipt.date.toISOString().slice(0, 10),
        treasury: receipt.treasury.nameAr,
        hash: receipt.qrVerificationHash,
        status: "POSTED_TO_GL",
      });
    }
    if (invoice) {
      return NextResponse.json({
        verified: true,
        documentType: "فاتورة مبيعات ضريبية (Sales Invoice)",
        reference: invoice.invoiceNumber,
        party: `${invoice.customer.nameAr} — ${invoice.project.nameAr}`,
        amount: Number(invoice.totalAmount),
        currency: invoice.currency,
        date: invoice.date.toISOString().slice(0, 10),
        hash: invoice.qrVerificationHash,
        status: invoice.status,
      });
    }
    if (bill) {
      return NextResponse.json({
        verified: true,
        documentType: "فاتورة مورد معتمدة (Vendor Bill)",
        reference: bill.billNumber,
        party: `${bill.vendor.nameAr} — ${bill.project.nameAr}`,
        amount: Number(bill.totalAmount),
        currency: bill.currency,
        date: bill.date.toISOString().slice(0, 10),
        status: bill.status,
      });
    }
    if (journal) {
      const total = journal.lines.reduce((s, l) => s + Number(l.debitBase), 0);
      return NextResponse.json({
        verified: true,
        documentType: "قيد يومية مزدوج (Journal Entry)",
        reference: journal.entryNumber,
        party: journal.narrationAr,
        amount: total,
        currency: "YER",
        date: journal.date.toISOString().slice(0, 10),
        status: journal.status,
      });
    }

    return NextResponse.json({ verified: false, message: "لم يتم العثور على مستند بهذا الرقم أو رمز التحقق" }, { status: 404 });
  } catch (error) {
    console.error("GET /api/public/verify error:", error);
    return jsonError("تعذر التحقق من المستند", 500);
  }
}


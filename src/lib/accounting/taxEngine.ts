import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dAdd, dDiv, dMul, dSub, round4Decimal } from "@/lib/decimalMath";

type Db = Prisma.TransactionClient | typeof prisma;

export interface DefaultTaxSeed {
  code: string;
  nameAr: string;
  nameEn: string;
  taxType: "VAT" | "WHT" | "SALES_TAX";
  ratePct: number;
  isInclusive?: boolean;
  salesTaxAccountCode?: string;
  purchaseTaxAccountCode?: string;
  whtAccountCode?: string;
}

export const DEFAULT_TAX_CODES: DefaultTaxSeed[] = [
  {
    code: "VAT15",
    nameAr: "ضريبة القيمة المضافة 15%",
    nameEn: "Standard VAT 15%",
    taxType: "VAT",
    ratePct: 15,
    salesTaxAccountCode: "214101",
    purchaseTaxAccountCode: "114301",
  },
  {
    code: "VAT5",
    nameAr: "ضريبة القيمة المضافة المخفضة 5%",
    nameEn: "Reduced VAT 5%",
    taxType: "VAT",
    ratePct: 5,
    salesTaxAccountCode: "214101",
    purchaseTaxAccountCode: "114301",
  },
  {
    code: "VAT0",
    nameAr: "معفى / ضريبة صفرية 0%",
    nameEn: "Zero-Rated / Exempt 0%",
    taxType: "VAT",
    ratePct: 0,
    salesTaxAccountCode: "214101",
    purchaseTaxAccountCode: "114301",
  },
  {
    code: "WHT2",
    nameAr: "ضريبة استقطاع من المنبع 2%",
    nameEn: "Withholding Tax 2%",
    taxType: "WHT",
    ratePct: 2,
    whtAccountCode: "214201",
  },
];

export async function ensureDefaultTaxCodes(client: Db = prisma) {
  const count = await client.taxCode.count();
  if (count > 0) return;
  for (const def of DEFAULT_TAX_CODES) {
    await client.taxCode.upsert({
      where: { code: def.code },
      create: {
        code: def.code,
        nameAr: def.nameAr,
        nameEn: def.nameEn,
        taxType: def.taxType,
        ratePct: def.ratePct,
        isInclusive: Boolean(def.isInclusive),
        salesTaxAccountCode: def.salesTaxAccountCode ?? "214101",
        purchaseTaxAccountCode: def.purchaseTaxAccountCode ?? "114301",
        whtAccountCode: def.whtAccountCode ?? "214201",
        isActive: true,
        rates: {
          create: [{ ratePct: def.ratePct, effectiveFrom: new Date("2025-01-01T00:00:00Z") }],
        },
      },
      update: {},
    });
  }
}

export async function listTaxCodes(client: Db = prisma) {
  await ensureDefaultTaxCodes(client);
  return client.taxCode.findMany({
    include: { rates: { orderBy: { effectiveFrom: "desc" } } },
    orderBy: [{ taxType: "asc" }, { ratePct: "desc" }],
  });
}

export async function resolveTaxCodeTx(
  tx: Db,
  taxCodeIdOrCode: string | null | undefined,
  asOfDate: Date = new Date()
) {
  if (!taxCodeIdOrCode || !taxCodeIdOrCode.trim()) return null;
  const key = taxCodeIdOrCode.trim();
  const tc = await tx.taxCode.findFirst({
    where: {
      isActive: true,
      OR: [{ id: key }, { code: key.toUpperCase() }],
    },
    include: {
      rates: {
        where: {
          effectiveFrom: { lte: asOfDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
        },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
  });
  if (!tc) return null;
  const effectivePct = tc.rates[0] ? Number(tc.rates[0].ratePct) : Number(tc.ratePct);
  return {
    ...tc,
    effectivePct,
  };
}

export interface ComputedTaxLine {
  netAmount: number;
  taxAmount: number;
  whtAmount: number;
  grossAmount: number; // net + tax (total invoice/bill value)
  payableAfterWht: number; // gross - wht
  vatRatePct: number;
  whtRatePct: number;
  salesTaxAccountCode: string;
  purchaseTaxAccountCode: string;
  whtAccountCode: string;
}

export async function computeDocumentTaxTx(
  tx: Db,
  input: {
    baseAmount: number;
    taxCodeId?: string | null;
    whtCodeId?: string | null;
    taxInclusive?: boolean;
    asOfDate?: Date;
  }
): Promise<ComputedTaxLine> {
  const rawAmt = Math.max(0, round4Decimal(Number(input.baseAmount) || 0));
  const vatTax = await resolveTaxCodeTx(tx, input.taxCodeId, input.asOfDate);
  const whtTax = await resolveTaxCodeTx(tx, input.whtCodeId, input.asOfDate);

  const vatRate = vatTax && vatTax.taxType !== "WHT" ? vatTax.effectivePct : 0;
  const whtRate =
    whtTax?.effectivePct ?? (vatTax && vatTax.taxType === "WHT" ? vatTax.effectivePct : 0);
  const isInclusive =
    input.taxInclusive !== undefined ? input.taxInclusive : Boolean(vatTax?.isInclusive);

  let netAmount = rawAmt;
  let taxAmount = 0;

  if (vatRate > 0) {
    if (isInclusive) {
      const divisor = dAdd(1, dDiv(vatRate, 100, 6), 6);
      netAmount = round4Decimal(dDiv(rawAmt, divisor, 4));
      taxAmount = round4Decimal(dSub(rawAmt, netAmount, 4));
    } else {
      netAmount = rawAmt;
      taxAmount = round4Decimal(dDiv(dMul(rawAmt, vatRate, 6), 100, 4));
    }
  }

  const whtAmount = whtRate > 0 ? round4Decimal(dDiv(dMul(netAmount, whtRate, 6), 100, 4)) : 0;
  const grossAmount = round4Decimal(dAdd(netAmount, taxAmount, 4));
  const payableAfterWht = round4Decimal(dSub(grossAmount, whtAmount, 4));

  return {
    netAmount,
    taxAmount,
    whtAmount,
    grossAmount,
    payableAfterWht,
    vatRatePct: vatRate,
    whtRatePct: whtRate,
    salesTaxAccountCode: vatTax?.salesTaxAccountCode || "214101",
    purchaseTaxAccountCode: vatTax?.purchaseTaxAccountCode || "114301",
    whtAccountCode: whtTax?.whtAccountCode || vatTax?.whtAccountCode || "214201",
  };
}

export async function generateTaxSummaryReport(
  filters: { fromDate?: string | Date; toDate?: string | Date; projectId?: string } = {},
  client: Db = prisma
) {
  const dateFilter: Prisma.DateTimeFilter = {};
  if (filters.fromDate) dateFilter.gte = new Date(filters.fromDate);
  if (filters.toDate) {
    const end = new Date(filters.toDate);
    if (typeof filters.toDate === "string" && filters.toDate.length <= 10) {
      end.setUTCHours(23, 59, 59, 999);
    }
    dateFilter.lte = end;
  }

  const [invoices, bills, expenses, glTaxLines] = await Promise.all([
    client.salesInvoice.findMany({
      where: {
        status: { not: "VOIDED" },
        documentStatus: { not: "VOIDED" },
        ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
        ...(filters.fromDate || filters.toDate ? { date: dateFilter } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceType: true,
        date: true,
        subTotal: true,
        taxAmount: true,
        totalAmount: true,
        exchangeRate: true,
      },
    }),
    client.vendorBill.findMany({
      where: {
        status: { not: "VOIDED" },
        documentStatus: { not: "VOIDED" },
        ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
        ...(filters.fromDate || filters.toDate ? { date: dateFilter } : {}),
      },
      select: {
        id: true,
        billNumber: true,
        billType: true,
        date: true,
        subTotal: true,
        taxAmount: true,
        whtAmount: true,
        totalAmount: true,
        exchangeRate: true,
      },
    }),
    client.operatingExpense.findMany({
      where: {
        ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
      },
      select: {
        id: true,
        expenseDate: true,
        netAmount: true,
        taxAmount: true,
        whtAmount: true,
        totalAmount: true,
      },
    }),
    client.journalEntryLine.findMany({
      where: {
        account: { code: { in: ["214101", "114301", "214201"] } },
        journalEntry: {
          status: "POSTED",
          documentStatus: "POSTED",
          entryType: { not: "YEAR_END_CLOSING" },
          ...(filters.fromDate || filters.toDate ? { date: dateFilter } : {}),
        },
        ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
      },
      include: { account: { select: { code: true } } },
    }),
  ]);

  let taxableSalesBase = 0;
  let outputVatFromDocs = 0;
  for (const inv of invoices) {
    const rate = Number(inv.exchangeRate) || 1;
    const sign = inv.invoiceType === "CREDIT_NOTE" ? -1 : 1;
    const vat = dMul(Number(inv.taxAmount), rate, 4) * sign;
    const net = dMul(Number(inv.subTotal) || Number(inv.totalAmount), rate, 4) * sign;
    if (Math.abs(vat) > 0) taxableSalesBase = dAdd(taxableSalesBase, net, 4);
    outputVatFromDocs = dAdd(outputVatFromDocs, vat, 4);
  }

  let taxablePurchasesBase = 0;
  let inputVatFromDocs = 0;
  let whtFromDocs = 0;
  for (const bill of bills) {
    const rate = Number(bill.exchangeRate) || 1;
    const sign = bill.billType === "CREDIT_NOTE" ? -1 : 1;
    const vat = dMul(Number(bill.taxAmount), rate, 4) * sign;
    const wht = dMul(Number(bill.whtAmount), rate, 4) * sign;
    const net = dMul(Number(bill.subTotal) || Number(bill.totalAmount), rate, 4) * sign;
    if (Math.abs(vat) > 0) taxablePurchasesBase = dAdd(taxablePurchasesBase, net, 4);
    inputVatFromDocs = dAdd(inputVatFromDocs, vat, 4);
    whtFromDocs = dAdd(whtFromDocs, wht, 4);
  }

  const fromStr = filters.fromDate ? new Date(filters.fromDate).toISOString().slice(0, 10) : null;
  const toStr = filters.toDate ? new Date(filters.toDate).toISOString().slice(0, 10) : null;
  for (const exp of expenses) {
    if (fromStr && exp.expenseDate < fromStr) continue;
    if (toStr && exp.expenseDate > toStr) continue;
    const vat = Number(exp.taxAmount);
    const wht = Number(exp.whtAmount);
    if (vat > 0) {
      taxablePurchasesBase = dAdd(taxablePurchasesBase, Number(exp.netAmount) || Number(exp.totalAmount), 4);
      inputVatFromDocs = dAdd(inputVatFromDocs, vat, 4);
    }
    whtFromDocs = dAdd(whtFromDocs, wht, 4);
  }

  let glOutputVat = 0;
  let glInputVat = 0;
  let glWhtPayable = 0;
  for (const l of glTaxLines) {
    if (l.account.code === "214101") {
      glOutputVat = dAdd(glOutputVat, dSub(Number(l.baseCredit), Number(l.baseDebit), 4), 4);
    } else if (l.account.code === "114301") {
      glInputVat = dAdd(glInputVat, dSub(Number(l.baseDebit), Number(l.baseCredit), 4), 4);
    } else if (l.account.code === "214201") {
      glWhtPayable = dAdd(glWhtPayable, dSub(Number(l.baseCredit), Number(l.baseDebit), 4), 4);
    }
  }

  const netVatPayable = round4Decimal(dSub(glOutputVat, glInputVat, 4));

  return {
    taxableSalesBase: round4Decimal(taxableSalesBase),
    taxablePurchasesBase: round4Decimal(taxablePurchasesBase),
    outputVat: round4Decimal(glOutputVat),
    inputVat: round4Decimal(glInputVat),
    netVatPayable,
    whtPayable: round4Decimal(glWhtPayable),
    documentTotals: {
      outputVatFromDocs: round4Decimal(outputVatFromDocs),
      inputVatFromDocs: round4Decimal(inputVatFromDocs),
      whtFromDocs: round4Decimal(whtFromDocs),
    },
    counts: {
      invoicesCount: invoices.length,
      billsCount: bills.length,
    },
  };
}

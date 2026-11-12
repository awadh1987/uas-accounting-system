import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  computeOperatingExpenseTotal,
  computeQrVerificationCode,
  computeSaleTotals,
  computeWorkerWageTotals,
} from "@/lib/formulas";
import type { AccountType } from "./coaCatalog";
import { mapExpenseCategoryToCoaCode, mapProjectIdToSalesRevenueCode } from "./coaCatalog";

export type DbClient = Prisma.TransactionClient | typeof prisma;

export interface JournalLineInput {
  accountId?: string;
  accountCode?: string;
  debit?: number;
  credit?: number;
  currency?: string;
  exchangeRate?: number;
  memo?: string;
  projectId?: string | null;
  subProjectId?: string | null;
  harvestCycleId?: string | null;
}

export interface AttachmentInput {
  fileName: string;
  fileUrl: string;
  fileType: string;
}

export interface PostJournalEntryInput {
  date?: Date | string;
  reference?: string;
  narrationAr: string;
  narrationEn?: string;
  sourceType?: string;
  sourceId?: string;
  projectId?: string | null;
  subProjectId?: string | null;
  createdById?: string;
  status?: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "VOIDED";
  lines: JournalLineInput[];
  attachments?: AttachmentInput[];
  allowLockedAdjustment?: boolean;
  tx?: Prisma.TransactionClient;
}

export interface PostVendorBillInput {
  vendorId: string;
  projectId: string;
  subProjectId?: string | null;
  purchaseOrderId?: string | null;
  acquisitionCycleId?: string | null;
  items?: Array<{ description: string; quantity: number; unitPrice: number }>;
  totalAmount: number;
  currency?: string;
  date?: Date | string;
  dueDate?: Date | string | null;
  isInventory?: boolean;
  debitAccountId?: string;
  debitAccountCode?: string;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export interface PostVendorPaymentInput {
  vendorId: string;
  billId?: string | null;
  projectId?: string | null;
  subProjectId?: string | null;
  acquisitionCycleId?: string | null;
  treasuryId: string;
  amount: number;
  transferFee?: number;
  currency?: string;
  date?: Date | string;
  referenceNumber?: string;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export interface PostSalesInvoiceInput {
  customerId: string;
  projectId: string;
  subProjectId?: string | null;
  harvestCycleId?: string | null;
  amount: number;
  currency?: string;
  date?: Date | string;
  notes?: string;
  revenueAccountCode?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export interface PostCustomerReceiptInput {
  customerId: string;
  invoiceId?: string | null;
  projectId?: string | null;
  subProjectId?: string | null;
  treasuryId: string;
  amount: number;
  currency?: string;
  date?: Date | string;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export interface FinancialReportFilters {
  fromDate?: string | Date;
  toDate?: string | Date;
  projectId?: string;
  subProjectId?: string;
  maxLevel?: number;
}

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return Number(v.toString()) || 0;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

async function runAtomic<T>(
  tx: Prisma.TransactionClient | undefined,
  fn: (client: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (tx) return fn(tx);
  return prisma.$transaction(fn);
}

async function getExchangeRateToYER(client: DbClient, currency: string): Promise<number> {
  const code = (currency || "YER").toUpperCase();
  if (code === "YER") return 1;
  const row = await client.currencyRate.findUnique({ where: { currencyCode: code } });
  if (row && row.rateToYER > 0) return row.rateToYER;
  if (code === "SAR") return 425;
  if (code === "USD") return 1620;
  return 1;
}

async function nextSequenceCode(
  client: DbClient,
  model: "journalEntry" | "vendorBill" | "paymentVoucher" | "salesInvoice" | "receiptVoucher" | "purchaseOrder" | "goodsReceipt",
  prefix: string
): Promise<string> {
  const year = new Date().getFullYear();
  let count = 0;
  if (model === "journalEntry") count = await client.journalEntry.count();
  else if (model === "vendorBill") count = await client.vendorBill.count();
  else if (model === "paymentVoucher") count = await client.paymentVoucher.count();
  else if (model === "salesInvoice") count = await client.salesInvoice.count();
  else if (model === "receiptVoucher") count = await client.receiptVoucher.count();
  else if (model === "purchaseOrder") count = await client.purchaseOrder.count();
  else if (model === "goodsReceipt") count = await client.goodsReceipt.count();

  const candidate = `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
  // Guarantee uniqueness even if records were previously voided/seeded with custom IDs
  const suffix = Date.now().toString().slice(-4);
  if (model === "journalEntry") {
    const exists = await client.journalEntry.findUnique({ where: { entryNumber: candidate } });
    return exists ? `${candidate}-${suffix}` : candidate;
  }
  if (model === "vendorBill") {
    const exists = await client.vendorBill.findUnique({ where: { billNumber: candidate } });
    return exists ? `${candidate}-${suffix}` : candidate;
  }
  if (model === "paymentVoucher") {
    const exists = await client.paymentVoucher.findUnique({ where: { voucherNumber: candidate } });
    return exists ? `${candidate}-${suffix}` : candidate;
  }
  if (model === "salesInvoice") {
    const exists = await client.salesInvoice.findUnique({ where: { invoiceNumber: candidate } });
    return exists ? `${candidate}-${suffix}` : candidate;
  }
  if (model === "receiptVoucher") {
    const exists = await client.receiptVoucher.findUnique({ where: { voucherNumber: candidate } });
    return exists ? `${candidate}-${suffix}` : candidate;
  }
  if (model === "purchaseOrder") {
    const exists = await client.purchaseOrder.findUnique({ where: { poNumber: candidate } });
    return exists ? `${candidate}-${suffix}` : candidate;
  }
  const exists = await client.goodsReceipt.findUnique({ where: { grnNumber: candidate } });
  return exists ? `${candidate}-${suffix}` : candidate;
}

async function resolveActorId(client: DbClient, requestedUserId?: string): Promise<string> {
  if (requestedUserId) {
    const found = await client.user.findUnique({ where: { id: requestedUserId }, select: { id: true } });
    if (found) return found.id;
  }
  const fallback = await client.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!fallback) throw new Error("NO_SYSTEM_USER_FOUND");
  return fallback.id;
}

async function resolvePostingAccount(
  client: DbClient,
  line: Pick<JournalLineInput, "accountId" | "accountCode">
) {
  const account = line.accountId
    ? await client.account.findUnique({ where: { id: line.accountId } })
    : line.accountCode
    ? await client.account.findUnique({ where: { code: line.accountCode } })
    : null;

  if (!account) {
    throw new Error(`ACCOUNT_NOT_FOUND:${line.accountCode || line.accountId || "unknown"}`);
  }
  if (!account.isPosting || account.level !== 5) {
    throw new Error(
      `NON_POSTING_ACCOUNT: Account ${account.code} (${account.nameAr}) is Tier-${account.level}. Only Tier-5 detail accounts accept direct journal postings.`
    );
  }
  return account;
}

async function ensureChildPostingAccount(
  tx: Prisma.TransactionClient,
  parentCode: string,
  nameAr: string,
  nameEn: string,
  type: AccountType
): Promise<string> {
  const parent = await tx.account.findUnique({ where: { code: parentCode } });
  if (!parent) throw new Error(`PARENT_COA_MISSING:${parentCode}`);
  const siblings = await tx.account.findMany({
    where: { parentId: parent.id },
    select: { code: true },
    orderBy: { code: "desc" },
  });
  const baseNum = Number(parentCode);
  let nextNum = baseNum + 1;
  for (const s of siblings) {
    const num = Number(s.code);
    if (Number.isFinite(num) && num >= nextNum) {
      nextNum = num + 1;
    }
  }
  const code = String(nextNum);
  const created = await tx.account.create({
    data: {
      code,
      nameAr,
      nameEn,
      level: 5,
      type,
      isPosting: true,
      parentId: parent.id,
    },
  });
  return created.id;
}

export async function ensureCustomerWithAccountTx(
  tx: Prisma.TransactionClient,
  input: { name: string; phone?: string; nameEn?: string; address?: string }
) {
  const cleanName = input.name.trim();
  const existing = await tx.customer.findUnique({ where: { name: cleanName } });
  if (existing) {
    if (input.phone && input.phone !== existing.phone) {
      return tx.customer.update({ where: { id: existing.id }, data: { phone: input.phone } });
    }
    return existing;
  }
  const accountId = await ensureChildPostingAccount(
    tx,
    "112100",
    cleanName,
    input.nameEn || cleanName,
    "ASSET"
  );
  const count = await tx.customer.count();
  return tx.customer.create({
    data: {
      code: `CUST-${String(count + 1).padStart(3, "0")}-${Date.now().toString().slice(-3)}`,
      name: cleanName,
      nameAr: cleanName,
      nameEn: input.nameEn || cleanName,
      phone: input.phone || "783118231",
      address: input.address || null,
      accountId,
    },
  });
}

export async function ensureWorkerWithAccountTx(
  tx: Prisma.TransactionClient,
  input: { name: string; defaultDailyWage?: number; phone?: string }
) {
  const cleanName = input.name.trim();
  const existing = await tx.worker.findUnique({ where: { name: cleanName } });
  if (existing) {
    let accountId = existing.accountId;
    if (!accountId) {
      accountId = await ensureChildPostingAccount(
        tx,
        "212100",
        `مستحقات العامل ${cleanName}`,
        `${cleanName} Labor Payable`,
        "LIABILITY"
      );
    }
    return tx.worker.update({
      where: { id: existing.id },
      data: {
        defaultDailyWage: input.defaultDailyWage ?? existing.defaultDailyWage,
        accountId,
      },
    });
  }
  const accountId = await ensureChildPostingAccount(
    tx,
    "212100",
    `مستحقات العامل ${cleanName}`,
    `${cleanName} Labor Payable`,
    "LIABILITY"
  );
  return tx.worker.create({
    data: {
      name: cleanName,
      phone: input.phone || "783118231",
      defaultDailyWage: input.defaultDailyWage ?? 0,
      accountId,
    },
  });
}

export async function createVendorWithAccountTx(
  tx: Prisma.TransactionClient,
  input: {
    nameAr: string;
    nameEn?: string;
    phone: string;
    email?: string;
    taxRegistration?: string;
    address?: string;
  }
) {
  const accountId = await ensureChildPostingAccount(
    tx,
    "211100",
    input.nameAr.trim(),
    input.nameEn?.trim() || input.nameAr.trim(),
    "LIABILITY"
  );
  const count = await tx.vendor.count();
  return tx.vendor.create({
    data: {
      code: `VND-${String(count + 1).padStart(3, "0")}-${Date.now().toString().slice(-3)}`,
      nameAr: input.nameAr.trim(),
      nameEn: input.nameEn?.trim() || null,
      phone: input.phone.trim() || "777000000",
      email: input.email?.trim() || null,
      taxRegistration: input.taxRegistration?.trim() || null,
      address: input.address?.trim() || null,
      accountId,
    },
    include: { account: true },
  });
}

/**
 * Core atomic double-entry journal posting engine.
 * Enforces:
 * 1. At least 2 non-zero lines
 * 2. Strict Tier-5 posting accounts only
 * 3. Harvest cycle period lock check
 * 4. Strict balance invariant: Sum(DebitBase) === Sum(CreditBase)
 */
export async function postJournalEntry(input: PostJournalEntryInput) {
  return runAtomic(input.tx, async (tx) => {
    if (!input.lines || input.lines.length < 2) {
      throw new Error("JOURNAL_MIN_TWO_LINES: A journal entry must contain at least 2 lines.");
    }

    const createdById = await resolveActorId(tx, input.createdById);
    const entryNumber = await nextSequenceCode(tx, "journalEntry", "JV");
    const entryDate = input.date ? new Date(input.date) : new Date();

    let totalDebitBase = 0;
    let totalCreditBase = 0;

    const preparedLines: Array<{
      accountId: string;
      debit: number;
      credit: number;
      currency: string;
      exchangeRate: number;
      debitBase: number;
      creditBase: number;
      memo: string;
      projectId: string | null;
      subProjectId: string | null;
      harvestCycleId: string | null;
    }> = [];

    for (const line of input.lines) {
      const account = await resolvePostingAccount(tx, line);
      const debit = round4(Number(line.debit) || 0);
      const credit = round4(Number(line.credit) || 0);
      if (debit < 0 || credit < 0) {
        throw new Error("NEGATIVE_LINE_AMOUNT: Debit and Credit amounts cannot be negative.");
      }
      if (debit === 0 && credit === 0) {
        throw new Error("ZERO_LINE_AMOUNT: Journal line cannot have both Debit and Credit equal to 0.");
      }
      if (debit > 0 && credit > 0) {
        throw new Error("DUAL_SIDED_LINE: A single journal line cannot carry both Debit and Credit.");
      }

      if (line.harvestCycleId && !input.allowLockedAdjustment) {
        const cycle = await tx.harvestCycle.findUnique({ where: { id: line.harvestCycleId } });
        if (cycle?.isLocked) {
          throw new Error(`HARVEST_LOCKED: Cycle "${cycle.name}" is locked for direct postings.`);
        }
      }

      const currency = (line.currency || "YER").toUpperCase();
      const rate =
        line.exchangeRate && line.exchangeRate > 0
          ? line.exchangeRate
          : await getExchangeRateToYER(tx, currency);
      const debitBase = round4(debit * rate);
      const creditBase = round4(credit * rate);

      totalDebitBase = round4(totalDebitBase + debitBase);
      totalCreditBase = round4(totalCreditBase + creditBase);

      preparedLines.push({
        accountId: account.id,
        debit,
        credit,
        currency,
        exchangeRate: rate,
        debitBase,
        creditBase,
        memo: line.memo || input.narrationAr,
        projectId: line.projectId !== undefined ? line.projectId : input.projectId ?? null,
        subProjectId:
          line.subProjectId !== undefined
            ? line.subProjectId
            : input.subProjectId ?? null,
        harvestCycleId: line.harvestCycleId ?? null,
      });
    }

    if (Math.abs(totalDebitBase - totalCreditBase) > 0.005) {
      throw new Error(
        `UNBALANCED_JOURNAL_ENTRY: Sum(Debits)=${totalDebitBase} !== Sum(Credits)=${totalCreditBase}`
      );
    }

    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        date: entryDate,
        reference: input.reference || entryNumber,
        narrationAr: input.narrationAr,
        narrationEn: input.narrationEn || null,
        status: input.status || "POSTED",
        sourceType: input.sourceType || "MANUAL",
        sourceId: input.sourceId || null,
        projectId: input.projectId || null,
        subProjectId: input.subProjectId || null,
        createdById,
        lines: { create: preparedLines },
        ...(input.attachments && input.attachments.length > 0
          ? {
              attachments: {
                create: input.attachments.map((att) => ({
                  fileName: att.fileName,
                  fileUrl: att.fileUrl,
                  fileType: att.fileType,
                })),
              },
            }
          : {}),
      },
      include: {
        lines: { include: { account: true } },
        attachments: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: createdById,
        action: entry.status === "POSTED" ? "POST" : "CREATE",
        entity: "JournalEntry",
        entityId: entry.id,
        details: {
          entryNumber: entry.entryNumber,
          totalDebitBase,
          totalCreditBase,
          sourceType: entry.sourceType,
          reference: entry.reference,
        },
      },
    });

    return entry;
  });
}

/**
 * Immutable reversal: posts a new offsetting entry (swapping DR/CR) and marks original as VOIDED.
 */
export async function reverseJournalEntry(input: {
  journalEntryId: string;
  createdById?: string;
  reason?: string;
  tx?: Prisma.TransactionClient;
}) {
  return runAtomic(input.tx, async (tx) => {
    const original = await tx.journalEntry.findUnique({
      where: { id: input.journalEntryId },
      include: { lines: true },
    });
    if (!original) throw new Error("JOURNAL_NOT_FOUND");
    if (original.status === "VOIDED") throw new Error("JOURNAL_ALREADY_VOIDED");

    const reversal = await postJournalEntry({
      tx,
      date: new Date(),
      reference: `REV-${original.entryNumber}`,
      narrationAr: `قيد عكسي لإلغاء القيد ${original.entryNumber}${input.reason ? `: ${input.reason}` : ""}`,
      narrationEn: `Reversal of ${original.entryNumber}${input.reason ? `: ${input.reason}` : ""}`,
      sourceType: "REVERSAL",
      sourceId: original.id,
      projectId: original.projectId,
      createdById: input.createdById,
      status: "POSTED",
      allowLockedAdjustment: true,
      lines: original.lines.map((l) => ({
        accountId: l.accountId,
        debit: toNum(l.credit),
        credit: toNum(l.debit),
        currency: l.currency,
        exchangeRate: toNum(l.exchangeRate),
        memo: `عكس: ${l.memo || original.entryNumber}`,
        projectId: l.projectId,
        subProjectId: l.subProjectId,
        harvestCycleId: l.harvestCycleId,
      })),
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: { status: "VOIDED" },
    });

    const actorId = await resolveActorId(tx, input.createdById);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "VOID",
        entity: "JournalEntry",
        entityId: original.id,
        details: { reversedByEntryNumber: reversal.entryNumber, reason: input.reason || "" },
      },
    });

    return reversal;
  });
}

/**
 * 1. Atomic Vendor Bill Posting:
 *    - Creates VendorBill
 *    - Posts balanced JournalEntry: DR Inventory (1132xx) or Project Expense (52xxxx), CR Vendor Payable (2111xx)
 */
export async function postVendorBill(input: PostVendorBillInput) {
  return runAtomic(input.tx, async (tx) => {
    const vendor = await tx.vendor.findUnique({
      where: { id: input.vendorId },
      include: { account: true },
    });
    if (!vendor) throw new Error("VENDOR_NOT_FOUND");

    const project = await tx.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const computedFromItems =
      input.items && input.items.length > 0
        ? input.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0)
        : 0;
    const totalAmount = round4(input.totalAmount > 0 ? input.totalAmount : computedFromItems);
    if (totalAmount <= 0) throw new Error("INVALID_BILL_AMOUNT");

    const currency = (input.currency || "YER").toUpperCase();
    const rate = await getExchangeRateToYER(tx, currency);
    const billNumber = await nextSequenceCode(tx, "vendorBill", "BILL");
    const billDate = input.date ? new Date(input.date) : new Date();

    const defaultDebitCode = input.isInventory ? "113201" : "524101";
    const debitAccount = await resolvePostingAccount(tx, {
      accountId: input.debitAccountId,
      accountCode: input.debitAccountId ? undefined : input.debitAccountCode || defaultDebitCode,
    });

    const je = await postJournalEntry({
      tx,
      date: billDate,
      reference: billNumber,
      narrationAr: `فاتورة مورد ${billNumber} - ${vendor.nameAr} (${project.nameAr})`,
      narrationEn: `Vendor Bill ${billNumber} - ${vendor.nameEn || vendor.nameAr}`,
      sourceType: "VENDOR_BILL",
      projectId: project.id,
      subProjectId: input.subProjectId ?? null,
      createdById: input.createdById,
      status: "POSTED",
      lines: [
        {
          accountId: debitAccount.id,
          debit: totalAmount,
          currency,
          exchangeRate: rate,
          memo: input.notes || `مشتريات من ${vendor.nameAr}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
        },
        {
          accountId: vendor.accountId,
          credit: totalAmount,
          currency,
          exchangeRate: rate,
          memo: `ذمة دائنة - ${vendor.nameAr} (${billNumber})`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
        },
      ],
    });

    const bill = await tx.vendorBill.create({
      data: {
        billNumber,
        vendorId: vendor.id,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        acquisitionCycleId: input.acquisitionCycleId ?? null,
        date: billDate,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        status: "POSTED",
        totalAmount,
        paidAmount: 0,
        balanceDue: totalAmount,
        currency,
        isInventory: Boolean(input.isInventory),
        debitAccountId: debitAccount.id,
        journalEntryId: je.id,
        notes: input.notes || null,
      },
      include: { vendor: true, project: true, subProject: true, purchaseOrder: true },
    });

    if (input.purchaseOrderId) {
      await tx.purchaseOrder.update({
        where: { id: input.purchaseOrderId },
        data: { status: "POSTED" },
      });
    }

    const actorId = await resolveActorId(tx, input.createdById);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "POST",
        entity: "VendorBill",
        entityId: bill.id,
        details: { billNumber: bill.billNumber, totalAmount, currency, journalEntryNumber: je.entryNumber },
      },
    });

    return { bill, journalEntry: je };
  });
}

/**
 * 2. Atomic Vendor Payment Posting:
 *    - Decrements VendorBill balanceDue & TreasuryAccount balance
 *    - Posts balanced JournalEntry: DR Vendor Payable (2111xx), CR Treasury (1111xx / 1112xx)
 */
export async function postVendorPayment(input: PostVendorPaymentInput) {
  return runAtomic(input.tx, async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId } });
    if (!vendor) throw new Error("VENDOR_NOT_FOUND");

    const treasury = await tx.treasuryAccount.findUnique({ where: { id: input.treasuryId } });
    if (!treasury) throw new Error("TREASURY_NOT_FOUND");

    const amount = round4(input.amount);
    if (amount <= 0) throw new Error("INVALID_PAYMENT_AMOUNT");
    const transferFee = Math.max(0, round4(Number(input.transferFee) || 0));

    const currency = (input.currency || treasury.currency || "YER").toUpperCase();
    const rate = await getExchangeRateToYER(tx, currency);
    const amountYER = round4(amount * rate);
    const feeYER = round4(transferFee * rate);
    const totalOut = round4(amount + transferFee);
    const totalOutYER = round4(amountYER + feeYER);
    const voucherNumber = await nextSequenceCode(tx, "paymentVoucher", "PV");
    const payDate = input.date ? new Date(input.date) : new Date();

    let projectId: string | null = input.projectId ?? null;
    let subProjectId: string | null = input.subProjectId ?? null;
    let acquisitionCycleId: string | null = input.acquisitionCycleId ?? null;

    if (input.billId) {
      const bill = await tx.vendorBill.findUnique({ where: { id: input.billId } });
      if (!bill) throw new Error("BILL_NOT_FOUND");
      projectId = projectId || bill.projectId;
      subProjectId = subProjectId || bill.subProjectId;
      acquisitionCycleId = acquisitionCycleId || bill.acquisitionCycleId;

      const billRate = await getExchangeRateToYER(tx, bill.currency);
      const amountInBillCurr = round4(amountYER / billRate);
      const nextPaid = round4(toNum(bill.paidAmount) + amountInBillCurr);
      const nextDue = Math.max(0, round4(toNum(bill.totalAmount) - nextPaid));

      await tx.vendorBill.update({
        where: { id: bill.id },
        data: {
          paidAmount: nextPaid,
          balanceDue: nextDue,
          status: nextDue <= 0.005 ? "PAID" : "PARTIALLY_PAID",
        },
      });
    }

    const treasuryRate = await getExchangeRateToYER(tx, treasury.currency);
    const totalOutInTreasuryCurr = round4(totalOutYER / treasuryRate);
    await tx.treasuryAccount.update({
      where: { id: treasury.id },
      data: {
        balance: round4(toNum(treasury.balance) - totalOutInTreasuryCurr),
        balanceYER: round4(treasury.balanceYER - totalOutYER),
      },
    });

    const lines: JournalLineInput[] = [
      {
        accountId: vendor.accountId,
        debit: amount,
        currency,
        exchangeRate: rate,
        memo: input.notes || `سداد للمورد ${vendor.nameAr}`,
        projectId,
        subProjectId,
      },
      ...(transferFee > 0
        ? [
            {
              accountCode: "531201",
              debit: transferFee,
              currency,
              exchangeRate: rate,
              memo: `رسوم تحويل سند الصرف ${voucherNumber}`,
              projectId,
              subProjectId,
            },
          ]
        : []),
      {
        accountId: treasury.accountId,
        credit: totalOut,
        currency,
        exchangeRate: rate,
        memo: `صرف من ${treasury.nameAr}`,
        projectId,
      },
    ];

    const je = await postJournalEntry({
      tx,
      date: payDate,
      reference: voucherNumber,
      narrationAr: `سند صرف ${voucherNumber} للمورد ${vendor.nameAr} من ${treasury.nameAr}`,
      narrationEn: `Payment Voucher ${voucherNumber} to ${vendor.nameEn || vendor.nameAr}`,
      sourceType: "VENDOR_PAYMENT",
      projectId,
      subProjectId,
      createdById: input.createdById,
      status: "POSTED",
      lines,
    });

    const qrVerificationHash = computeQrVerificationCode(
      `PV:${voucherNumber}|VND:${vendor.id}|AMT:${amountYER}|DATE:${payDate.toISOString().slice(0, 10)}`
    );

    const voucher = await tx.paymentVoucher.create({
      data: {
        voucherNumber,
        date: payDate,
        vendorId: vendor.id,
        billId: input.billId ?? null,
        treasuryId: treasury.id,
        amount,
        transferFee,
        currency,
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        projectId,
        subProjectId,
        acquisitionCycleId,
        journalEntryId: je.id,
        qrVerificationHash,
      },
      include: { vendor: true, bill: true, treasury: true },
    });

    const actorId = await resolveActorId(tx, input.createdById);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "POST",
        entity: "PaymentVoucher",
        entityId: voucher.id,
        details: { voucherNumber, amount, currency, amountYER, treasuryId: treasury.id },
      },
    });

    return { voucher, journalEntry: je };
  });
}

/**
 * 3. Atomic Sales Invoice Posting:
 *    - Creates SalesInvoice
 *    - Posts balanced JournalEntry: DR Customer Receivable (1121xx), CR Harvest Sales Revenue (411xxx)
 */
export async function postSalesInvoice(input: PostSalesInvoiceInput) {
  return runAtomic(input.tx, async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

    const project = await tx.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    if (input.harvestCycleId) {
      const cycle = await tx.harvestCycle.findUnique({ where: { id: input.harvestCycleId } });
      if (cycle?.isLocked) throw new Error("HARVEST_LOCKED");
    }

    const totalAmount = round4(input.amount);
    if (totalAmount <= 0) throw new Error("INVALID_INVOICE_AMOUNT");

    const currency = (input.currency || "YER").toUpperCase();
    const rate = await getExchangeRateToYER(tx, currency);
    const invoiceNumber = await nextSequenceCode(tx, "salesInvoice", "INV");
    const invDate = input.date ? new Date(input.date) : new Date();
    const revenueCode = input.revenueAccountCode || mapProjectIdToSalesRevenueCode(project.id);

    const je = await postJournalEntry({
      tx,
      date: invDate,
      reference: invoiceNumber,
      narrationAr: `فاتورة مبيعات ${invoiceNumber} للعميل ${customer.nameAr} (${project.nameAr})`,
      narrationEn: `Sales Invoice ${invoiceNumber} - ${customer.nameEn || customer.nameAr}`,
      sourceType: "SALES_INVOICE",
      projectId: project.id,
      subProjectId: input.subProjectId ?? null,
      createdById: input.createdById,
      status: "POSTED",
      lines: [
        {
          accountId: customer.accountId,
          debit: totalAmount,
          currency,
          exchangeRate: rate,
          memo: `ذمة مدينة - ${customer.nameAr}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
        },
        {
          accountCode: revenueCode,
          credit: totalAmount,
          currency,
          exchangeRate: rate,
          memo: input.notes || `إيراد مبيعات ${project.nameAr}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
        },
      ],
    });

    const qrVerificationHash = computeQrVerificationCode(
      `INV:${invoiceNumber}|CUST:${customer.nameAr}|AMT:${totalAmount}`
    );

    const invoice = await tx.salesInvoice.create({
      data: {
        invoiceNumber,
        customerId: customer.id,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
        date: invDate,
        totalAmount,
        paidAmount: 0,
        balanceDue: totalAmount,
        status: "POSTED",
        currency,
        notes: input.notes || null,
        journalEntryId: je.id,
        qrVerificationHash,
      },
      include: { customer: true, project: true, harvestCycle: true },
    });

    return { invoice, journalEntry: je };
  });
}

/**
 * 4. Atomic Customer Receipt Posting:
 *    - Updates SalesInvoice & TreasuryAccount balance
 *    - Posts balanced JournalEntry: DR Treasury (1111xx / 1112xx), CR Customer Receivable (1121xx)
 */
export async function postCustomerReceipt(input: PostCustomerReceiptInput) {
  return runAtomic(input.tx, async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

    const treasury = await tx.treasuryAccount.findUnique({ where: { id: input.treasuryId } });
    if (!treasury) throw new Error("TREASURY_NOT_FOUND");

    const amount = round4(input.amount);
    if (amount <= 0) throw new Error("INVALID_RECEIPT_AMOUNT");

    const currency = (input.currency || treasury.currency || "YER").toUpperCase();
    const rate = await getExchangeRateToYER(tx, currency);
    const amountYER = round4(amount * rate);
    const voucherNumber = await nextSequenceCode(tx, "receiptVoucher", "RV");
    const rcpDate = input.date ? new Date(input.date) : new Date();

    let projectId: string | null = input.projectId ?? null;
    let subProjectId: string | null = input.subProjectId ?? null;
    let harvestCycleId: string | null = null;

    if (input.invoiceId) {
      const inv = await tx.salesInvoice.findUnique({ where: { id: input.invoiceId } });
      if (!inv) throw new Error("INVOICE_NOT_FOUND");
      projectId = projectId || inv.projectId;
      subProjectId = subProjectId || inv.subProjectId;
      harvestCycleId = inv.harvestCycleId;

      const invRate = await getExchangeRateToYER(tx, inv.currency);
      const amountInInvCurr = round4(amountYER / invRate);
      const nextPaid = round4(toNum(inv.paidAmount) + amountInInvCurr);
      const nextDue = Math.max(0, round4(toNum(inv.totalAmount) - nextPaid));

      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: {
          paidAmount: nextPaid,
          balanceDue: nextDue,
          status: nextDue <= 0.005 ? "PAID" : "PARTIALLY_PAID",
        },
      });
    }

    const treasuryRate = await getExchangeRateToYER(tx, treasury.currency);
    const amountInTreasuryCurr = round4(amountYER / treasuryRate);
    await tx.treasuryAccount.update({
      where: { id: treasury.id },
      data: {
        balance: round4(toNum(treasury.balance) + amountInTreasuryCurr),
        balanceYER: round4(treasury.balanceYER + amountYER),
      },
    });

    const je = await postJournalEntry({
      tx,
      date: rcpDate,
      reference: voucherNumber,
      narrationAr: `سند قبض ${voucherNumber} من العميل ${customer.nameAr} إلى ${treasury.nameAr}`,
      narrationEn: `Receipt Voucher ${voucherNumber} from ${customer.nameEn || customer.nameAr}`,
      sourceType: "CUSTOMER_RECEIPT",
      projectId,
      subProjectId,
      createdById: input.createdById,
      status: "POSTED",
      lines: [
        {
          accountId: treasury.accountId,
          debit: amount,
          currency,
          exchangeRate: rate,
          memo: `توريد إلى ${treasury.nameAr}`,
          projectId,
          subProjectId,
          harvestCycleId,
        },
        {
          accountId: customer.accountId,
          credit: amount,
          currency,
          exchangeRate: rate,
          memo: input.notes || `تحصيل من العميل ${customer.nameAr}`,
          projectId,
          subProjectId,
          harvestCycleId,
        },
      ],
    });

    const qrVerificationHash = computeQrVerificationCode(
      `INST:${voucherNumber}|PARTY:${customer.nameAr}|AMT:${amountYER}|DATE:${rcpDate.toISOString().slice(0, 10)}`
    );

    const receipt = await tx.receiptVoucher.create({
      data: {
        voucherNumber,
        date: rcpDate,
        customerId: customer.id,
        invoiceId: input.invoiceId ?? null,
        treasuryId: treasury.id,
        subProjectId,
        amount,
        currency,
        notes: input.notes || null,
        journalEntryId: je.id,
        qrVerificationHash,
      },
      include: { customer: true, invoice: true, treasury: true },
    });

    return { receipt, journalEntry: je };
  });
}

/**
 * Operational Bridge: Post Double-Entry Journal for OperatingExpense
 */
export async function postOperatingExpenseJournalTx(
  tx: Prisma.TransactionClient,
  input: {
    expenseId: string;
    projectId: string;
    subProjectId?: string | null;
    harvestCycleId?: string | null;
    category: string;
    subType: string;
    totalAmount: number;
    date: string;
    createdById?: string;
  }
) {
  if (input.totalAmount <= 0) return null;
  const expCode = mapExpenseCategoryToCoaCode(input.category);
  const treasury = await tx.treasuryAccount.findUnique({ where: { id: "t1" } });
  const cashAccountId = treasury?.accountId;
  return postJournalEntry({
    tx,
    date: new Date(`${input.date}T10:00:00Z`),
    reference: `EXP-${input.expenseId.slice(-6).toUpperCase()}`,
    narrationAr: `مصروف تشغيلي (${input.category}): ${input.subType}`,
    narrationEn: `Operating Expense (${input.category})`,
    sourceType: "EXPENSE",
    sourceId: input.expenseId,
    projectId: input.projectId,
    subProjectId: input.subProjectId ?? null,
    createdById: input.createdById,
    lines: [
      {
        accountCode: expCode,
        debit: input.totalAmount,
        projectId: input.projectId,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
        memo: input.subType,
      },
      {
        ...(cashAccountId ? { accountId: cashAccountId } : { accountCode: "111101" }),
        credit: input.totalAmount,
        projectId: input.projectId,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
        memo: `صرف نقدي - ${input.subType}`,
      },
    ],
  });
}

/**
 * Operational Bridge: Post Double-Entry Journal for WorkerWageEntry (Accrual + Optional Initial Payout)
 */
export async function postWorkerWageJournalTx(
  tx: Prisma.TransactionClient,
  input: {
    wageEntryId: string;
    workerName: string;
    workerAccountId: string;
    projectId: string;
    subProjectId?: string | null;
    harvestCycleId?: string | null;
    totalWage: number;
    creditAmount: number;
    date: string;
    createdById?: string;
  }
) {
  if (input.totalWage <= 0) return null;
  const accrual = await postJournalEntry({
    tx,
    date: new Date(`${input.date}T10:00:00Z`),
    reference: `WRK-ACC-${input.wageEntryId.slice(-6).toUpperCase()}`,
    narrationAr: `استحقاق أجر العامل ${input.workerName}`,
    narrationEn: `Worker Wage Accrual: ${input.workerName}`,
    sourceType: "WORKER_ACCRUAL",
    sourceId: input.wageEntryId,
    projectId: input.projectId,
    subProjectId: input.subProjectId ?? null,
    createdById: input.createdById,
    lines: [
      {
        accountCode: "511101",
        debit: input.totalWage,
        projectId: input.projectId,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
        memo: `أجور عمالة مباشرة - ${input.workerName}`,
      },
      {
        accountId: input.workerAccountId,
        credit: input.totalWage,
        projectId: input.projectId,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
        memo: `مستحق للعامل ${input.workerName}`,
      },
    ],
  });

  if (input.creditAmount > 0) {
    await postJournalEntry({
      tx,
      date: new Date(`${input.date}T10:05:00Z`),
      reference: `WRK-PAY-${input.wageEntryId.slice(-6).toUpperCase()}`,
      narrationAr: `صرف دفعة للعامل ${input.workerName}`,
      narrationEn: `Worker Wage Payout: ${input.workerName}`,
      sourceType: "WORKER_PAYOUT",
      sourceId: input.wageEntryId,
      projectId: input.projectId,
      subProjectId: input.subProjectId ?? null,
      createdById: input.createdById,
      lines: [
        {
          accountId: input.workerAccountId,
          debit: input.creditAmount,
          projectId: input.projectId,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
          memo: `تسوية مستحقات ${input.workerName}`,
        },
        {
          accountCode: "111101",
          credit: input.creditAmount,
          projectId: input.projectId,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
          memo: `صرف نقدي للعامل ${input.workerName}`,
        },
      ],
    });
  }

  return accrual;
}

export interface CoaTreeNode {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  level: number;
  type: string;
  isPosting: boolean;
  parentId: string | null;
  directDebit: number;
  directCredit: number;
  rollupDebit: number;
  rollupCredit: number;
  balance: number; // Natural balance: DR - CR for ASSET/EXPENSE; CR - DR for LIABILITY/EQUITY/REVENUE
  children: CoaTreeNode[];
}

export async function getCoaTreeWithBalances(filters: FinancialReportFilters = {}): Promise<{
  tree: CoaTreeNode[];
  flat: Omit<CoaTreeNode, "children">[];
}> {
  const accounts = await prisma.account.findMany({
    orderBy: { code: "asc" },
  });

  const lineWhere = buildPostedLineWhere(filters);
  const grouped = await prisma.journalEntryLine.groupBy({
    by: ["accountId"],
    where: lineWhere,
    _sum: { debitBase: true, creditBase: true },
  });

  const totalsByAccount = new Map<string, { dr: number; cr: number }>();
  for (const row of grouped) {
    totalsByAccount.set(row.accountId, {
      dr: toNum(row._sum.debitBase),
      cr: toNum(row._sum.creditBase),
    });
  }

  const nodeMap = new Map<string, CoaTreeNode>();
  for (const acc of accounts) {
    const direct = totalsByAccount.get(acc.id) || { dr: 0, cr: 0 };
    nodeMap.set(acc.id, {
      id: acc.id,
      code: acc.code,
      nameAr: acc.nameAr,
      nameEn: acc.nameEn,
      level: acc.level,
      type: acc.type,
      isPosting: acc.isPosting,
      parentId: acc.parentId,
      directDebit: round4(direct.dr),
      directCredit: round4(direct.cr),
      rollupDebit: round4(direct.dr),
      rollupCredit: round4(direct.cr),
      balance: 0,
      children: [],
    });
  }

  const roots: CoaTreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function computeRollup(node: CoaTreeNode): { dr: number; cr: number } {
    let dr = node.directDebit;
    let cr = node.directCredit;
    for (const child of node.children) {
      const childSum = computeRollup(child);
      dr = round4(dr + childSum.dr);
      cr = round4(cr + childSum.cr);
    }
    node.rollupDebit = dr;
    node.rollupCredit = cr;
    const isDebitNormal = node.type === "ASSET" || node.type === "EXPENSE";
    node.balance = round4(isDebitNormal ? dr - cr : cr - dr);
    return { dr, cr };
  }

  for (const root of roots) {
    computeRollup(root);
  }

  const flat = Array.from(nodeMap.values()).map((n) => {
    const { children: _children, ...rest } = n;
    void _children;
    return rest;
  });

  return { tree: roots, flat };
}

function buildPostedLineWhere(filters: FinancialReportFilters): Prisma.JournalEntryLineWhereInput {
  const dateFilter: Prisma.DateTimeFilter = {};
  if (filters.fromDate) dateFilter.gte = new Date(filters.fromDate);
  if (filters.toDate) {
    const end = new Date(filters.toDate);
    if (typeof filters.toDate === "string" && filters.toDate.length <= 10) {
      end.setUTCHours(23, 59, 59, 999);
    }
    dateFilter.lte = end;
  }

  return {
    ...(filters.projectId && filters.projectId !== "ALL" ? { projectId: filters.projectId } : {}),
    ...(filters.subProjectId && filters.subProjectId !== "ALL" ? { subProjectId: filters.subProjectId } : {}),
    journalEntry: {
      status: "POSTED",
      ...(filters.fromDate || filters.toDate ? { date: dateFilter } : {}),
    },
  };
}

/**
 * 5. Dynamic Financial Reports purely from POSTED JournalEntryLine records:
 *    - Trial Balance (Levels 1-5)
 *    - Profit & Loss (Consolidated + Per Project)
 *    - Balance Sheet (Assets = Liabilities + Equity + Net Result)
 *    - Budget vs. Actual Variance
 */
export async function generateFinancialReports(filters: FinancialReportFilters = {}) {
  const { flat } = await getCoaTreeWithBalances(filters);
  const maxLevel = filters.maxLevel && filters.maxLevel >= 1 && filters.maxLevel <= 5 ? filters.maxLevel : 5;

  // Trial Balance
  const trialBalanceRows = flat
    .filter((n) => n.level <= maxLevel && (n.rollupDebit > 0 || n.rollupCredit > 0 || n.level <= 2))
    .map((n) => {
      const net = round4(n.rollupDebit - n.rollupCredit);
      return {
        id: n.id,
        code: n.code,
        nameAr: n.nameAr,
        nameEn: n.nameEn,
        level: n.level,
        type: n.type,
        isPosting: n.isPosting,
        totalDebit: n.rollupDebit,
        totalCredit: n.rollupCredit,
        netDebit: net > 0 ? net : 0,
        netCredit: net < 0 ? Math.abs(net) : 0,
        balance: n.balance,
      };
    });

  // Sum strictly across Tier-5 posting accounts to verify total debits === total credits without double counting parents
  const postingRows = flat.filter((n) => n.isPosting);
  const totalLedgerDebits = round4(postingRows.reduce((s, r) => s + r.directDebit, 0));
  const totalLedgerCredits = round4(postingRows.reduce((s, r) => s + r.directCredit, 0));
  const isTrialBalanced = Math.abs(totalLedgerDebits - totalLedgerCredits) <= 0.005;

  // Profit & Loss (Income Statement)
  const revenueAccounts = postingRows.filter((n) => n.type === "REVENUE" && (n.directDebit > 0 || n.directCredit > 0));
  const cogsAccounts = postingRows.filter(
    (n) => n.type === "EXPENSE" && n.code.startsWith("51") && (n.directDebit > 0 || n.directCredit > 0)
  );
  const opexAccounts = postingRows.filter(
    (n) => n.type === "EXPENSE" && n.code.startsWith("52") && (n.directDebit > 0 || n.directCredit > 0)
  );
  const adminAccounts = postingRows.filter(
    (n) => n.type === "EXPENSE" && n.code.startsWith("53") && (n.directDebit > 0 || n.directCredit > 0)
  );

  const totalRevenue = round4(revenueAccounts.reduce((s, a) => s + a.balance, 0));
  const totalCogs = round4(cogsAccounts.reduce((s, a) => s + a.balance, 0));
  const grossProfit = round4(totalRevenue - totalCogs);
  const totalOperatingExpenses = round4(opexAccounts.reduce((s, a) => s + a.balance, 0));
  const totalAdminExpenses = round4(adminAccounts.reduce((s, a) => s + a.balance, 0));
  const totalExpenses = round4(totalCogs + totalOperatingExpenses + totalAdminExpenses);
  const netProfit = round4(totalRevenue - totalExpenses);

  // Per-project P&L and Budget Variance
  const projects = await prisma.project.findMany({
    orderBy: { code: "asc" },
    include: { subProjects: true, harvestCycles: true },
  });

  const postedLinesWithAccount = await prisma.journalEntryLine.findMany({
    where: buildPostedLineWhere(filters),
    include: { account: { select: { type: true, code: true } } },
  });

  const projectBreakdown = projects.map((proj) => {
    const pLines = postedLinesWithAccount.filter((l) => l.projectId === proj.id);
    const rev = round4(
      pLines
        .filter((l) => l.account.type === "REVENUE")
        .reduce((s, l) => s + toNum(l.creditBase) - toNum(l.debitBase), 0)
    );
    const cogs = round4(
      pLines
        .filter((l) => l.account.type === "EXPENSE" && l.account.code.startsWith("51"))
        .reduce((s, l) => s + toNum(l.debitBase) - toNum(l.creditBase), 0)
    );
    const opex = round4(
      pLines
        .filter((l) => l.account.type === "EXPENSE" && !l.account.code.startsWith("51"))
        .reduce((s, l) => s + toNum(l.debitBase) - toNum(l.creditBase), 0)
    );
    const actualCost = round4(cogs + opex);
    const budget = round4(toNum(proj.budgetTotal) || proj.estimatedValue);
    const variance = round4(budget - actualCost);
    const utilizationPct = budget > 0 ? round4((actualCost / budget) * 100) : 0;

    return {
      projectId: proj.id,
      code: proj.code,
      nameAr: proj.nameAr,
      nameEn: proj.nameEn,
      budgetTotal: budget,
      revenue: rev,
      cogs,
      operatingExpenses: opex,
      actualCost,
      netProfit: round4(rev - actualCost),
      variance,
      utilizationPct,
      isOverBudget: actualCost > budget && budget > 0,
    };
  });

  const subProjectBreakdown = projects.flatMap((proj) =>
    proj.subProjects
      .filter((sp) => !filters.subProjectId || filters.subProjectId === "ALL" || sp.id === filters.subProjectId)
      .map((sp) => {
        const spLines = postedLinesWithAccount.filter((l) => l.subProjectId === sp.id);
        const rev = round4(
          spLines
            .filter((l) => l.account.type === "REVENUE")
            .reduce((s, l) => s + toNum(l.creditBase) - toNum(l.debitBase), 0)
        );
        const cogs = round4(
          spLines
            .filter((l) => l.account.type === "EXPENSE" && l.account.code.startsWith("51"))
            .reduce((s, l) => s + toNum(l.debitBase) - toNum(l.creditBase), 0)
        );
        const opex = round4(
          spLines
            .filter((l) => l.account.type === "EXPENSE" && !l.account.code.startsWith("51"))
            .reduce((s, l) => s + toNum(l.debitBase) - toNum(l.creditBase), 0)
        );
        const actualCost = round4(cogs + opex);
        const budget = round4(toNum(sp.budget) || 0);
        const variance = round4(budget - actualCost);
        const utilizationPct = budget > 0 ? round4((actualCost / budget) * 100) : 0;

        return {
          subProjectId: sp.id,
          projectId: proj.id,
          projectCode: proj.code,
          projectNameAr: proj.nameAr,
          code: sp.code,
          nameAr: sp.nameAr,
          nameEn: sp.nameEn,
          budgetTotal: budget,
          budget,
          revenue: rev,
          cogs,
          operatingExpenses: opex,
          actualCost,
          netProfit: round4(rev - actualCost),
          variance,
          utilizationPct,
          isOverBudget: actualCost > budget && budget > 0,
          status: sp.status,
        };
      })
  );

  // Balance Sheet
  const assetAccounts = postingRows.filter((n) => n.type === "ASSET" && n.balance !== 0);
  const liabilityAccounts = postingRows.filter((n) => n.type === "LIABILITY" && n.balance !== 0);
  const equityAccounts = postingRows.filter((n) => n.type === "EQUITY" && n.balance !== 0);

  const totalAssets = round4(assetAccounts.reduce((s, a) => s + a.balance, 0));
  const totalLiabilities = round4(liabilityAccounts.reduce((s, a) => s + a.balance, 0));
  const contributedEquity = round4(equityAccounts.reduce((s, a) => s + a.balance, 0));
  const totalEquity = round4(contributedEquity + netProfit);
  const liabilitiesPlusEquity = round4(totalLiabilities + totalEquity);
  const isBalanceSheetBalanced = Math.abs(totalAssets - liabilitiesPlusEquity) <= 0.005;

  return {
    filters: {
      fromDate: filters.fromDate || null,
      toDate: filters.toDate || null,
      projectId: filters.projectId || "ALL",
      subProjectId: filters.subProjectId || "ALL",
      maxLevel,
    },
    trialBalance: {
      rows: trialBalanceRows,
      totalDebits: totalLedgerDebits,
      totalCredits: totalLedgerCredits,
      difference: round4(totalLedgerDebits - totalLedgerCredits),
      isBalanced: isTrialBalanced,
    },
    incomeStatement: {
      revenueLines: revenueAccounts,
      cogsLines: cogsAccounts,
      operatingExpenseLines: opexAccounts,
      adminExpenseLines: adminAccounts,
      totalRevenue,
      totalCogs,
      grossProfit,
      totalOperatingExpenses,
      totalAdminExpenses,
      totalExpenses,
      netProfit,
      projectBreakdown,
      subProjectBreakdown,
    },
    balanceSheet: {
      assetLines: assetAccounts,
      liabilityLines: liabilityAccounts,
      equityLines: equityAccounts,
      currentYearNetProfit: netProfit,
      totalAssets,
      totalLiabilities,
      contributedEquity,
      totalEquity,
      liabilitiesPlusEquity,
      isBalanced: isBalanceSheetBalanced,
    },
  };
}

// =========================================================================
// PHASE 2: AUDIT DIFF, TREASURY & BANKING ENGINE, ACQUISITIONS & EDITS
// =========================================================================

export async function recordAuditDiffTx(
  tx: Prisma.TransactionClient,
  input: {
    userId?: string | null;
    action: "CREATE" | "UPDATE" | "POST" | "VOID" | "LOCK" | "RECONCILE";
    entity: string;
    entityId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    note?: string;
  }
) {
  const actorId = await resolveActorId(tx, input.userId ?? undefined);
  return tx.auditLog.create({
    data: {
      userId: actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      details: {
        before: (input.before ?? {}) as Prisma.InputJsonValue,
        after: (input.after ?? {}) as Prisma.InputJsonValue,
        ...(input.note ? { note: input.note } : {}),
      },
    },
  });
}

export interface CreateTreasuryAccountInput {
  type: "VAULT" | "BANK" | "WALLET";
  nameAr: string;
  nameEn?: string;
  currency?: string;
  providerNameAr?: string;
  providerNameEn?: string;
  accountHolderName?: string;
  accountNumber?: string;
  ibanOrSwift?: string;
  branchOrAgent?: string;
  transferFeePercent?: number;
  dailyLimit?: number;
  openingBalance?: number;
  openingDate?: Date | string;
  isDefaultReceipts?: boolean;
  isDefaultPayments?: boolean;
  isActive?: boolean;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export async function createTreasuryAccount(input: CreateTreasuryAccountInput) {
  return runAtomic(input.tx, async (tx) => {
    const type = (input.type || "VAULT").toUpperCase() as "VAULT" | "BANK" | "WALLET";
    if (type !== "VAULT" && type !== "BANK" && type !== "WALLET") {
      throw new Error("INVALID_TREASURY_TYPE");
    }
    const nameAr = input.nameAr.trim();
    if (!nameAr) throw new Error("TREASURY_NAME_REQUIRED");
    const nameEn = (input.nameEn || nameAr).trim();
    const currency = (input.currency || "YER").toUpperCase();
    const rate = await getExchangeRateToYER(tx, currency);
    const openingBalance = Math.max(0, round4(Number(input.openingBalance) || 0));
    const openingYER = round4(openingBalance * rate);

    const parentCode = type === "VAULT" ? "111100" : "111200";
    const accountId = await ensureChildPostingAccount(tx, parentCode, nameAr, nameEn, "ASSET");

    const count = await tx.treasuryAccount.count();
    const prefix = type === "VAULT" ? "TR-VAULT" : type === "BANK" ? "TR-BANK" : "TR-WAL";
    const code = `${prefix}-${String(count + 1).padStart(2, "0")}-${Date.now().toString().slice(-3)}`;

    if (input.isDefaultReceipts) {
      await tx.treasuryAccount.updateMany({ data: { isDefaultReceipts: false } });
    }
    if (input.isDefaultPayments) {
      await tx.treasuryAccount.updateMany({ data: { isDefaultPayments: false } });
    }

    const created = await tx.treasuryAccount.create({
      data: {
        code,
        name: `${nameAr} (${nameEn})`,
        nameAr,
        nameEn,
        type,
        providerNameAr: input.providerNameAr?.trim() || nameAr,
        providerNameEn: input.providerNameEn?.trim() || nameEn,
        accountHolderName: input.accountHolderName?.trim() || "",
        accountNumber: input.accountNumber?.trim() || code,
        ibanOrSwift: input.ibanOrSwift?.trim() || "",
        branchOrAgent: input.branchOrAgent?.trim() || "",
        transferFeePercent: Math.max(0, Number(input.transferFeePercent) || 0),
        dailyLimit: Math.max(0, Number(input.dailyLimit) || 0),
        isDefaultReceipts: Boolean(input.isDefaultReceipts),
        isDefaultPayments: Boolean(input.isDefaultPayments),
        isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
        notes: input.notes?.trim() || "",
        accountId,
        currency,
        currencyCode: currency,
        balance: openingBalance,
        balanceYER: openingYER,
      },
      include: { account: true },
    });

    let journalEntry = null;
    if (openingBalance > 0) {
      journalEntry = await postJournalEntry({
        tx,
        date: input.openingDate ? new Date(input.openingDate) : new Date(),
        reference: `OB-${created.code}`,
        narrationAr: `رصيد افتتاحي لحساب الخزينة: ${nameAr}`,
        narrationEn: `Opening Balance for Treasury Account: ${nameEn}`,
        sourceType: "TREASURY_OPENING",
        sourceId: created.id,
        createdById: input.createdById,
        status: "POSTED",
        lines: [
          {
            accountId: created.accountId,
            debit: openingBalance,
            currency,
            exchangeRate: rate,
            memo: `رصيد افتتاحي - ${nameAr}`,
          },
          {
            accountCode: "311101",
            credit: openingBalance,
            currency,
            exchangeRate: rate,
            memo: `مقابل رصيد افتتاحي - ${nameAr}`,
          },
        ],
      });
    }

    await recordAuditDiffTx(tx, {
      userId: input.createdById,
      action: "CREATE",
      entity: "TreasuryAccount",
      entityId: created.id,
      before: null,
      after: {
        code: created.code,
        type: created.type,
        nameAr: created.nameAr,
        currency: created.currency,
        openingBalance,
      },
    });

    return { treasury: created, journalEntry };
  });
}

export interface UpdateTreasuryAccountInput {
  id: string;
  nameAr?: string;
  nameEn?: string;
  type?: "VAULT" | "BANK" | "WALLET";
  providerNameAr?: string;
  providerNameEn?: string;
  accountHolderName?: string;
  accountNumber?: string;
  ibanOrSwift?: string;
  branchOrAgent?: string;
  transferFeePercent?: number;
  dailyLimit?: number;
  isDefaultReceipts?: boolean;
  isDefaultPayments?: boolean;
  isActive?: boolean;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export async function updateTreasuryAccount(input: UpdateTreasuryAccountInput) {
  return runAtomic(input.tx, async (tx) => {
    const existing = await tx.treasuryAccount.findUnique({
      where: { id: input.id },
      include: { account: true },
    });
    if (!existing) throw new Error("TREASURY_NOT_FOUND");

    if (input.isDefaultReceipts === true) {
      await tx.treasuryAccount.updateMany({
        where: { id: { not: existing.id } },
        data: { isDefaultReceipts: false },
      });
    }
    if (input.isDefaultPayments === true) {
      await tx.treasuryAccount.updateMany({
        where: { id: { not: existing.id } },
        data: { isDefaultPayments: false },
      });
    }

    const nextNameAr = input.nameAr !== undefined ? input.nameAr.trim() : existing.nameAr;
    const nextNameEn = input.nameEn !== undefined ? input.nameEn.trim() : existing.nameEn;

    const updated = await tx.treasuryAccount.update({
      where: { id: existing.id },
      data: {
        ...(input.type ? { type: input.type } : {}),
        ...(input.nameAr !== undefined || input.nameEn !== undefined
          ? {
              name: `${nextNameAr} (${nextNameEn})`,
              nameAr: nextNameAr,
              nameEn: nextNameEn,
            }
          : {}),
        ...(input.providerNameAr !== undefined ? { providerNameAr: input.providerNameAr.trim() } : {}),
        ...(input.providerNameEn !== undefined ? { providerNameEn: input.providerNameEn.trim() } : {}),
        ...(input.accountHolderName !== undefined ? { accountHolderName: input.accountHolderName.trim() } : {}),
        ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber.trim() } : {}),
        ...(input.ibanOrSwift !== undefined ? { ibanOrSwift: input.ibanOrSwift.trim() } : {}),
        ...(input.branchOrAgent !== undefined ? { branchOrAgent: input.branchOrAgent.trim() } : {}),
        ...(input.transferFeePercent !== undefined
          ? { transferFeePercent: Math.max(0, Number(input.transferFeePercent) || 0) }
          : {}),
        ...(input.dailyLimit !== undefined ? { dailyLimit: Math.max(0, Number(input.dailyLimit) || 0) } : {}),
        ...(input.isDefaultReceipts !== undefined ? { isDefaultReceipts: Boolean(input.isDefaultReceipts) } : {}),
        ...(input.isDefaultPayments !== undefined ? { isDefaultPayments: Boolean(input.isDefaultPayments) } : {}),
        ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      },
      include: { account: true },
    });

    if (input.nameAr !== undefined || input.nameEn !== undefined) {
      await tx.account.update({
        where: { id: existing.accountId },
        data: { nameAr: nextNameAr, nameEn: nextNameEn },
      });
    }

    await recordAuditDiffTx(tx, {
      userId: input.createdById,
      action: "UPDATE",
      entity: "TreasuryAccount",
      entityId: existing.id,
      before: {
        nameAr: existing.nameAr,
        type: existing.type,
        accountNumber: existing.accountNumber,
        transferFeePercent: existing.transferFeePercent,
        isDefaultReceipts: existing.isDefaultReceipts,
        isDefaultPayments: existing.isDefaultPayments,
        isActive: existing.isActive,
      },
      after: {
        nameAr: updated.nameAr,
        type: updated.type,
        accountNumber: updated.accountNumber,
        transferFeePercent: updated.transferFeePercent,
        isDefaultReceipts: updated.isDefaultReceipts,
        isDefaultPayments: updated.isDefaultPayments,
        isActive: updated.isActive,
      },
    });

    return updated;
  });
}

export interface TreasuryTransferInput {
  fromTreasuryId: string;
  toTreasuryId: string;
  amount: number;
  feeAmount?: number;
  applyDefaultFee?: boolean;
  exchangeRateOverride?: number;
  date?: Date | string;
  reference?: string;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export async function transferBetweenTreasuries(input: TreasuryTransferInput) {
  return runAtomic(input.tx, async (tx) => {
    if (input.fromTreasuryId === input.toTreasuryId) {
      throw new Error("SAME_TREASURY_TRANSFER");
    }
    const from = await tx.treasuryAccount.findUnique({ where: { id: input.fromTreasuryId } });
    const to = await tx.treasuryAccount.findUnique({ where: { id: input.toTreasuryId } });
    if (!from || !to) throw new Error("TREASURY_NOT_FOUND");

    const amount = round4(Number(input.amount) || 0);
    if (amount <= 0) throw new Error("INVALID_TRANSFER_AMOUNT");

    const fromRate =
      input.exchangeRateOverride && input.exchangeRateOverride > 0
        ? input.exchangeRateOverride
        : await getExchangeRateToYER(tx, from.currency);
    const toRate = await getExchangeRateToYER(tx, to.currency);

    const feeInFromCurr =
      input.feeAmount !== undefined
        ? Math.max(0, round4(Number(input.feeAmount) || 0))
        : input.applyDefaultFee && from.transferFeePercent > 0
        ? round4((amount * from.transferFeePercent) / 100)
        : 0;

    const transferYER = round4(amount * fromRate);
    const feeYER = round4(feeInFromCurr * fromRate);
    const totalOutFrom = round4(amount + feeInFromCurr);
    const totalOutYER = round4(transferYER + feeYER);
    const creditedToAmount = round4(transferYER / toRate);
    // Use effective rate on destination FX leg so DebitBase === transferYER without rounding drift
    const toEffectiveRate = creditedToAmount > 0 ? transferYER / creditedToAmount : toRate;

    await tx.treasuryAccount.update({
      where: { id: from.id },
      data: {
        balance: round4(toNum(from.balance) - totalOutFrom),
        balanceYER: round4(from.balanceYER - totalOutYER),
      },
    });

    await tx.treasuryAccount.update({
      where: { id: to.id },
      data: {
        balance: round4(toNum(to.balance) + creditedToAmount),
        balanceYER: round4(to.balanceYER + transferYER),
      },
    });

    const lines: JournalLineInput[] = [
      {
        accountId: to.accountId,
        debit: creditedToAmount,
        currency: to.currency,
        exchangeRate: toEffectiveRate,
        memo: `تحويل وارد من ${from.nameAr}`,
      },
      ...(feeInFromCurr > 0
        ? [
            {
              accountCode: "531201",
              debit: feeInFromCurr,
              currency: from.currency,
              exchangeRate: fromRate,
              memo: `رسوم تحويل بين الخزائن (${from.nameAr} -> ${to.nameAr})`,
            },
          ]
        : []),
      {
        accountId: from.accountId,
        credit: totalOutFrom,
        currency: from.currency,
        exchangeRate: fromRate,
        memo: input.notes || `تحويل صادر إلى ${to.nameAr}`,
      },
    ];

    const je = await postJournalEntry({
      tx,
      date: input.date ? new Date(input.date) : new Date(),
      reference: input.reference || `TRF-${Date.now().toString().slice(-6)}`,
      narrationAr: `تحويل مالي من ${from.nameAr} إلى ${to.nameAr}${feeInFromCurr > 0 ? ` (شامل رسوم ${feeInFromCurr} ${from.currency})` : ""}`,
      narrationEn: `Treasury Transfer: ${from.nameEn} -> ${to.nameEn}`,
      sourceType: "TREASURY_TRANSFER",
      sourceId: `${from.id}->${to.id}`,
      createdById: input.createdById,
      status: "POSTED",
      lines,
    });

    await recordAuditDiffTx(tx, {
      userId: input.createdById,
      action: "POST",
      entity: "TreasuryTransfer",
      entityId: je.id,
      before: { fromBalance: toNum(from.balance), toBalance: toNum(to.balance) },
      after: {
        fromBalance: round4(toNum(from.balance) - totalOutFrom),
        toBalance: round4(toNum(to.balance) + creditedToAmount),
        amount,
        feeInFromCurr,
        transferYER,
      },
    });

    return {
      journalEntry: je,
      transferYER,
      feeYER,
      creditedToAmount,
      fromCurrency: from.currency,
      toCurrency: to.currency,
    };
  });
}

export async function getTreasuryLedgerAndReconcile(treasuryId: string) {
  const treasury = await prisma.treasuryAccount.findUnique({
    where: { id: treasuryId },
    include: { account: true },
  });
  if (!treasury) throw new Error("TREASURY_NOT_FOUND");

  const [lines, logs] = await Promise.all([
    prisma.journalEntryLine.findMany({
      where: {
        accountId: treasury.accountId,
        journalEntry: { status: "POSTED" },
      },
      include: {
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            date: true,
            reference: true,
            narrationAr: true,
            sourceType: true,
          },
        },
      },
      orderBy: { journalEntry: { date: "desc" } },
    }),
    prisma.auditLog.findMany({
      where: {
        entity: "TreasuryAccount",
        entityId: treasuryId,
        action: "RECONCILE",
      },
      orderBy: { timestamp: "desc" },
      take: 25,
    }),
  ]);

  const reconciledEntryIds = new Set<string>();
  for (let i = logs.length - 1; i >= 0; i--) {
    const d = logs[i].details as Record<string, unknown> | null;
    if (d && Array.isArray(d.reconciledEntryIds)) {
      for (const id of d.reconciledEntryIds) reconciledEntryIds.add(String(id));
    }
    if (d && typeof d.toggleEntryId === "string") {
      if (d.reconciled) reconciledEntryIds.add(d.toggleEntryId);
      else reconciledEntryIds.delete(d.toggleEntryId);
    }
  }

  const glBookBalanceYER = round4(
    lines.reduce((s, l) => s + toNum(l.debitBase) - toNum(l.creditBase), 0)
  );

  return {
    treasury: {
      id: treasury.id,
      code: treasury.code,
      nameAr: treasury.nameAr,
      nameEn: treasury.nameEn,
      type: treasury.type,
      currency: treasury.currency,
      balance: toNum(treasury.balance),
      balanceYER: treasury.balanceYER,
      glBookBalanceYER,
      varianceYER: round4(treasury.balanceYER - glBookBalanceYER),
    },
    entries: lines.map((l) => ({
      lineId: l.id,
      journalEntryId: l.journalEntry.id,
      entryNumber: l.journalEntry.entryNumber,
      date: l.journalEntry.date.toISOString(),
      reference: l.journalEntry.reference,
      narrationAr: l.journalEntry.narrationAr,
      sourceType: l.journalEntry.sourceType,
      debit: toNum(l.debit),
      credit: toNum(l.credit),
      debitBase: toNum(l.debitBase),
      creditBase: toNum(l.creditBase),
      reconciled: reconciledEntryIds.has(l.journalEntry.id),
    })),
    reconciliationHistory: logs.map((l) => ({
      id: l.id,
      timestamp: l.timestamp.toISOString(),
      details: l.details,
    })),
  };
}

export async function reconcileTreasuryAccount(input: {
  treasuryId: string;
  statementBalance?: number;
  statementDate?: string;
  toggleEntryId?: string;
  reconciled?: boolean;
  reconciledEntryIds?: string[];
  notes?: string;
  createdById?: string;
}) {
  const treasury = await prisma.treasuryAccount.findUnique({ where: { id: input.treasuryId } });
  if (!treasury) throw new Error("TREASURY_NOT_FOUND");

  const actorId = await resolveActorId(prisma, input.createdById);
  await prisma.auditLog.create({
    data: {
      userId: actorId,
      action: "RECONCILE",
      entity: "TreasuryAccount",
      entityId: treasury.id,
      details: {
        statementBalance: input.statementBalance ?? toNum(treasury.balance),
        statementDate: input.statementDate || new Date().toISOString().slice(0, 10),
        bookBalance: toNum(treasury.balance),
        difference:
          input.statementBalance !== undefined
            ? round4(Number(input.statementBalance) - toNum(treasury.balance))
            : 0,
        ...(input.toggleEntryId ? { toggleEntryId: input.toggleEntryId, reconciled: Boolean(input.reconciled) } : {}),
        ...(input.reconciledEntryIds ? { reconciledEntryIds: input.reconciledEntryIds } : {}),
        notes: input.notes || "",
      },
    },
  });

  return getTreasuryLedgerAndReconcile(treasury.id);
}

export interface GenerateAcquisitionBillInput {
  projectId: string;
  acquisitionCycleId: string;
  vendorId?: string;
  amount?: number;
  currency?: string;
  date?: Date | string;
  dueDate?: Date | string | null;
  capitalizeAsset?: boolean;
  debitAccountCode?: string;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}

export async function generateAcquisitionBill(input: GenerateAcquisitionBillInput) {
  return runAtomic(input.tx, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      include: { ownerVendor: true },
    });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const cycle = await tx.projectAcquisitionCycle.findUnique({
      where: { id: input.acquisitionCycleId },
    });
    if (!cycle || cycle.projectId !== project.id) {
      throw new Error("ACQUISITION_CYCLE_NOT_FOUND");
    }

    const vendorId = input.vendorId || project.vendorId;
    if (!vendorId) throw new Error("PROJECT_OWNER_VENDOR_REQUIRED");

    const amount = round4(Number(input.amount ?? cycle.contractAmount) || 0);
    if (amount <= 0) throw new Error("INVALID_ACQUISITION_AMOUNT");

    const currency = (input.currency || cycle.currency || "YER").toUpperCase();
    const poNumber = await nextSequenceCode(tx, "purchaseOrder", "PO-ACQ");
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber,
        vendorId,
        projectId: project.id,
        acquisitionCycleId: cycle.id,
        date: input.date ? new Date(input.date) : new Date(),
        status: "APPROVED",
        subTotal: amount,
        taxTotal: 0,
        grandTotal: amount,
        currency,
        notes: input.notes || `أمر توريد واستحواذ: ${cycle.cycleTitle}`,
        items: {
          create: [
            {
              description: cycle.cycleTitle,
              unit: "عقد/دورة",
              quantity: 1,
              unitPrice: amount,
              totalPrice: amount,
            },
          ],
        },
      },
    });

    const debitAccountCode =
      input.debitAccountCode || (input.capitalizeAsset ? "121101" : "512101");

    const { bill, journalEntry } = await postVendorBill({
      tx,
      vendorId,
      projectId: project.id,
      purchaseOrderId: po.id,
      acquisitionCycleId: cycle.id,
      totalAmount: amount,
      currency,
      date: input.date || new Date(),
      dueDate: input.dueDate ?? cycle.endDate,
      debitAccountCode,
      notes: input.notes || `استحقاق دورة استحواذ المشروع: ${cycle.cycleTitle}`,
      createdById: input.createdById,
    });

    return { purchaseOrder: po, bill, journalEntry };
  });
}

export async function postOwnerBatchPayment(input: {
  projectId: string;
  acquisitionCycleId?: string | null;
  vendorId?: string;
  billId?: string | null;
  treasuryId: string;
  amount: number;
  transferFee?: number;
  currency?: string;
  date?: Date | string;
  referenceNumber?: string;
  notes?: string;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}) {
  return runAtomic(input.tx, async (tx) => {
    const project = await tx.project.findUnique({ where: { id: input.projectId } });
    if (!project) throw new Error("PROJECT_NOT_FOUND");

    const vendorId = input.vendorId || project.vendorId;
    if (!vendorId) throw new Error("PROJECT_OWNER_VENDOR_REQUIRED");

    return postVendorPayment({
      tx,
      vendorId,
      billId: input.billId ?? null,
      projectId: project.id,
      acquisitionCycleId: input.acquisitionCycleId ?? null,
      treasuryId: input.treasuryId,
      amount: input.amount,
      transferFee: input.transferFee,
      currency: input.currency,
      date: input.date,
      referenceNumber: input.referenceNumber,
      notes: input.notes || `دفعة مجمعة لصاحب المشروع (${project.nameAr})`,
      createdById: input.createdById,
    });
  });
}

export async function updateJournalEntry(input: {
  id: string;
  date?: Date | string;
  reference?: string;
  narrationAr?: string;
  narrationEn?: string;
  projectId?: string | null;
  subProjectId?: string | null;
  lines?: JournalLineInput[];
  allowLockedAdjustment?: boolean;
  createdById?: string;
  tx?: Prisma.TransactionClient;
}) {
  return runAtomic(input.tx, async (tx) => {
    const existing = await tx.journalEntry.findUnique({
      where: { id: input.id },
      include: { lines: true },
    });
    if (!existing) throw new Error("JOURNAL_NOT_FOUND");
    if (existing.status === "VOIDED") throw new Error("JOURNAL_ALREADY_VOIDED");

    if (!input.allowLockedAdjustment) {
      for (const oldLine of existing.lines) {
        if (oldLine.harvestCycleId) {
          const cycle = await tx.harvestCycle.findUnique({ where: { id: oldLine.harvestCycleId } });
          if (cycle?.isLocked) {
            throw new Error(`HARVEST_LOCKED: Cycle "${cycle.name}" is locked for direct edits.`);
          }
        }
      }
    }

    const nextDate = input.date ? new Date(input.date) : existing.date;
    const nextNarrationAr = input.narrationAr?.trim() || existing.narrationAr;
    const nextNarrationEn =
      input.narrationEn !== undefined ? input.narrationEn?.trim() || null : existing.narrationEn;
    const nextReference = input.reference !== undefined ? input.reference.trim() : existing.reference;
    const nextProjectId = input.projectId !== undefined ? input.projectId : existing.projectId;
    const nextSubProjectId =
      input.subProjectId !== undefined ? input.subProjectId : existing.subProjectId;

    if (input.lines) {
      if (input.lines.length < 2) {
        throw new Error("JOURNAL_MIN_TWO_LINES: A journal entry must contain at least 2 lines.");
      }

      let totalDebitBase = 0;
      let totalCreditBase = 0;
      const preparedLines: Array<{
        accountId: string;
        debit: number;
        credit: number;
        currency: string;
        exchangeRate: number;
        debitBase: number;
        creditBase: number;
        memo: string;
        projectId: string | null;
        subProjectId: string | null;
        harvestCycleId: string | null;
      }> = [];

      for (const line of input.lines) {
        const account = await resolvePostingAccount(tx, line);
        const debit = round4(Number(line.debit) || 0);
        const credit = round4(Number(line.credit) || 0);
        if (debit < 0 || credit < 0) throw new Error("NEGATIVE_LINE_AMOUNT");
        if (debit === 0 && credit === 0) throw new Error("ZERO_LINE_AMOUNT");
        if (debit > 0 && credit > 0) throw new Error("DUAL_SIDED_LINE");

        if (line.harvestCycleId && !input.allowLockedAdjustment) {
          const cycle = await tx.harvestCycle.findUnique({ where: { id: line.harvestCycleId } });
          if (cycle?.isLocked) {
            throw new Error(`HARVEST_LOCKED: Cycle "${cycle.name}" is locked for direct edits.`);
          }
        }

        const currency = (line.currency || "YER").toUpperCase();
        const rate =
          line.exchangeRate && line.exchangeRate > 0
            ? line.exchangeRate
            : await getExchangeRateToYER(tx, currency);
        const debitBase = round4(debit * rate);
        const creditBase = round4(credit * rate);
        totalDebitBase = round4(totalDebitBase + debitBase);
        totalCreditBase = round4(totalCreditBase + creditBase);

        preparedLines.push({
          accountId: account.id,
          debit,
          credit,
          currency,
          exchangeRate: rate,
          debitBase,
          creditBase,
          memo: line.memo || nextNarrationAr,
          projectId: line.projectId !== undefined ? line.projectId : nextProjectId,
          subProjectId: line.subProjectId !== undefined ? line.subProjectId : nextSubProjectId,
          harvestCycleId: line.harvestCycleId ?? null,
        });
      }

      if (Math.abs(totalDebitBase - totalCreditBase) > 0.005) {
        throw new Error(
          `UNBALANCED_JOURNAL_ENTRY: Sum(Debits)=${totalDebitBase} !== Sum(Credits)=${totalCreditBase}`
        );
      }

      await tx.journalEntryLine.deleteMany({ where: { journalEntryId: existing.id } });
      await tx.journalEntryLine.createMany({
        data: preparedLines.map((l) => ({ ...l, journalEntryId: existing.id })),
      });
    }

    const updated = await tx.journalEntry.update({
      where: { id: existing.id },
      data: {
        date: nextDate,
        reference: nextReference,
        narrationAr: nextNarrationAr,
        narrationEn: nextNarrationEn,
        projectId: nextProjectId,
        subProjectId: nextSubProjectId,
      },
      include: {
        lines: { include: { account: true } },
        attachments: true,
      },
    });

    await recordAuditDiffTx(tx, {
      userId: input.createdById,
      action: "UPDATE",
      entity: "JournalEntry",
      entityId: existing.id,
      before: {
        date: existing.date.toISOString(),
        reference: existing.reference,
        narrationAr: existing.narrationAr,
        lineCount: existing.lines.length,
      },
      after: {
        date: updated.date.toISOString(),
        reference: updated.reference,
        narrationAr: updated.narrationAr,
        lineCount: updated.lines.length,
      },
    });

    return updated;
  });
}

export async function updateOperatingExpenseAtomic(input: {
  id: string;
  projectId?: string;
  subProjectId?: string | null;
  harvestName?: string;
  category?: string;
  subType?: string;
  quantity?: number;
  unitPrice?: number;
  date?: string;
  notes?: string;
  createdById?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.operatingExpense.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("EXPENSE_NOT_FOUND");

    const oldCycle = await tx.harvestCycle.findFirst({
      where: { projectId: existing.projectId, name: existing.harvestName },
    });
    if (oldCycle?.isLocked) throw new Error("HARVEST_LOCKED");

    const nextProjectId = input.projectId?.trim() || existing.projectId;
    const nextSubProjectId =
      input.subProjectId !== undefined
        ? input.subProjectId
          ? input.subProjectId.trim()
          : null
        : existing.subProjectId;
    const nextHarvest = input.harvestName?.trim() || existing.harvestName;
    const nextCycle = await tx.harvestCycle.findFirst({
      where: { projectId: nextProjectId, name: nextHarvest },
    });
    if (nextCycle?.isLocked) throw new Error("HARVEST_LOCKED");

    const nextCategory = input.category?.trim() || existing.category;
    const nextSubType = input.subType?.trim() || existing.subType;
    const nextQty = input.quantity !== undefined ? Number(input.quantity) : existing.quantity;
    const nextUnitPrice =
      input.unitPrice !== undefined ? Number(input.unitPrice) : existing.unitPrice;
    const nextTotal = computeOperatingExpenseTotal(nextQty, nextUnitPrice);
    const nextDate = input.date?.trim() || existing.expenseDate;
    const nextNotes = input.notes !== undefined ? input.notes.trim() : existing.notes;

    const financialChanged =
      Math.abs(nextTotal - existing.totalAmount) > 0.005 ||
      nextCategory !== existing.category ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCycle?.id !== existing.harvestCycleId;

    let nextJournalEntryId = existing.journalEntryId;
    if (financialChanged) {
      if (existing.journalEntryId) {
        await reverseJournalEntry({
          tx,
          journalEntryId: existing.journalEntryId,
          createdById: input.createdById,
          reason: `تعديل مصروف تشغيلي (${existing.subType})`,
        }).catch(() => null);
      }
      const je = await postOperatingExpenseJournalTx(tx, {
        expenseId: existing.id,
        projectId: nextProjectId,
        subProjectId: nextSubProjectId,
        harvestCycleId: nextCycle?.id ?? null,
        category: nextCategory,
        subType: nextSubType,
        totalAmount: nextTotal,
        date: nextDate,
        createdById: input.createdById,
      });
      nextJournalEntryId = je?.id ?? null;
    } else if (existing.journalEntryId && nextDate !== existing.expenseDate) {
      await tx.journalEntry.update({
        where: { id: existing.journalEntryId },
        data: { date: new Date(`${nextDate}T10:00:00Z`) },
      });
    }

    const updated = await tx.operatingExpense.update({
      where: { id: existing.id },
      data: {
        projectId: nextProjectId,
        subProjectId: nextSubProjectId,
        harvestCycleId: nextCycle?.id ?? null,
        harvestName: nextHarvest,
        category: nextCategory,
        subType: nextSubType,
        quantity: nextQty,
        unitPrice: nextUnitPrice,
        totalAmount: nextTotal,
        expenseDate: nextDate,
        notes: nextNotes,
        journalEntryId: nextJournalEntryId,
      },
    });

    await recordAuditDiffTx(tx, {
      userId: input.createdById,
      action: "UPDATE",
      entity: "OperatingExpense",
      entityId: existing.id,
      before: {
        date: existing.expenseDate,
        category: existing.category,
        totalAmount: existing.totalAmount,
        harvestName: existing.harvestName,
      },
      after: {
        date: updated.expenseDate,
        category: updated.category,
        totalAmount: updated.totalAmount,
        harvestName: updated.harvestName,
      },
    });

    return updated;
  });
}

export async function updateWorkerWageAtomic(input: {
  id: string;
  projectId?: string;
  subProjectId?: string | null;
  harvestName?: string;
  name?: string;
  dailyWage?: number;
  daysWorked?: number;
  creditAmount?: number;
  date?: string;
  notes?: string;
  createdById?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.workerWageEntry.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("WORKER_WAGE_NOT_FOUND");

    const oldCycle = await tx.harvestCycle.findFirst({
      where: { projectId: existing.projectId, name: existing.harvestName },
    });
    if (oldCycle?.isLocked) throw new Error("HARVEST_LOCKED");

    const nextProjectId = input.projectId?.trim() || existing.projectId;
    const nextSubProjectId =
      input.subProjectId !== undefined
        ? input.subProjectId
          ? input.subProjectId.trim()
          : null
        : existing.subProjectId;
    const nextHarvest = input.harvestName?.trim() || existing.harvestName;
    const nextCycle = await tx.harvestCycle.findFirst({
      where: { projectId: nextProjectId, name: nextHarvest },
    });
    if (nextCycle?.isLocked) throw new Error("HARVEST_LOCKED");

    const nextName = input.name?.trim() || existing.workerName;
    const nextDailyWage =
      input.dailyWage !== undefined ? Number(input.dailyWage) : existing.dailyWage;
    const nextDays =
      input.daysWorked !== undefined ? Number(input.daysWorked) : existing.daysWorked;
    const nextCredit =
      input.creditAmount !== undefined ? Number(input.creditAmount) : existing.creditAmount;
    const { totalWage: nextTotal, debitBalance: nextDebit } = computeWorkerWageTotals(
      nextDailyWage,
      nextDays,
      nextCredit
    );
    const nextDate = input.date?.trim() || existing.workDate;
    const nextNotes = input.notes !== undefined ? input.notes.trim() : existing.notes;

    const worker = await ensureWorkerWithAccountTx(tx, {
      name: nextName,
      defaultDailyWage: nextDailyWage,
    });

    const financialChanged =
      Math.abs(nextTotal - existing.totalWage) > 0.005 ||
      Math.abs(nextCredit - existing.creditAmount) > 0.005 ||
      nextName !== existing.workerName ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCycle?.id !== existing.harvestCycleId;

    let nextJournalEntryId = existing.journalEntryId;
    if (financialChanged) {
      const linkedEntries = await tx.journalEntry.findMany({
        where: { sourceId: existing.id, status: { not: "VOIDED" } },
        select: { id: true },
      });
      for (const je of linkedEntries) {
        await reverseJournalEntry({
          tx,
          journalEntryId: je.id,
          createdById: input.createdById,
          reason: `تعديل سجل أجر العامل (${existing.workerName})`,
        }).catch(() => null);
      }
      if (worker.accountId) {
        const newAccrual = await postWorkerWageJournalTx(tx, {
          wageEntryId: existing.id,
          workerName: worker.name,
          workerAccountId: worker.accountId,
          projectId: nextProjectId,
          subProjectId: nextSubProjectId,
          harvestCycleId: nextCycle?.id ?? null,
          totalWage: nextTotal,
          creditAmount: nextCredit,
          date: nextDate,
          createdById: input.createdById,
        });
        nextJournalEntryId = newAccrual?.id ?? null;
      }
    } else if (nextDate !== existing.workDate) {
      await tx.journalEntry.updateMany({
        where: { sourceId: existing.id, status: { not: "VOIDED" } },
        data: { date: new Date(`${nextDate}T10:00:00Z`) },
      });
    }

    const updated = await tx.workerWageEntry.update({
      where: { id: existing.id },
      data: {
        workerId: worker.id,
        workerName: worker.name,
        projectId: nextProjectId,
        subProjectId: nextSubProjectId,
        harvestCycleId: nextCycle?.id ?? null,
        harvestName: nextHarvest,
        dailyWage: nextDailyWage,
        daysWorked: nextDays,
        totalWage: nextTotal,
        creditAmount: nextCredit,
        debitBalance: nextDebit,
        workDate: nextDate,
        notes: nextNotes,
        journalEntryId: nextJournalEntryId,
      },
    });

    await recordAuditDiffTx(tx, {
      userId: input.createdById,
      action: "UPDATE",
      entity: "WorkerWageEntry",
      entityId: existing.id,
      before: {
        date: existing.workDate,
        workerName: existing.workerName,
        totalWage: existing.totalWage,
        creditAmount: existing.creditAmount,
      },
      after: {
        date: updated.workDate,
        workerName: updated.workerName,
        totalWage: updated.totalWage,
        creditAmount: updated.creditAmount,
      },
    });

    return updated;
  });
}

export async function updateSaleTransactionAtomic(input: {
  id: string;
  projectId?: string;
  subProjectId?: string | null;
  harvestName?: string;
  batch?: string;
  customer?: string;
  phone?: string;
  grade?: string;
  bundles?: number;
  price?: number;
  credit?: number;
  date?: string;
  voucherNo?: string;
  notes?: string;
  createdById?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saleTransaction.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("SALE_NOT_FOUND");

    const oldCycle = await tx.harvestCycle.findFirst({
      where: { projectId: existing.projectId, name: existing.harvestName },
    });
    if (oldCycle?.isLocked) throw new Error("HARVEST_LOCKED");

    const nextProjectId = input.projectId?.trim() || existing.projectId;
    const nextSubProjectId =
      input.subProjectId !== undefined
        ? input.subProjectId
          ? input.subProjectId.trim()
          : null
        : existing.subProjectId;
    const nextHarvest = input.harvestName?.trim() || existing.harvestName;
    const nextCycle = await tx.harvestCycle.findFirst({
      where: { projectId: nextProjectId, name: nextHarvest },
    });
    if (nextCycle?.isLocked) throw new Error("HARVEST_LOCKED");

    const nextCustomerName = input.customer?.trim() || existing.customerName;
    const nextPhone = input.phone?.trim() || existing.customerPhone;
    const nextBundles =
      input.bundles !== undefined ? Math.max(0, Math.round(Number(input.bundles) || 0)) : existing.bundlesCount;
    const nextPrice = input.price !== undefined ? Number(input.price) : existing.unitPrice;
    const nextCredit = input.credit !== undefined ? Number(input.credit) : existing.creditPaid;
    const { totalAmount: nextTotal, debitReceivable: nextDebit } = computeSaleTotals(
      nextBundles,
      nextPrice,
      nextCredit
    );
    const nextDate = input.date?.trim() || existing.saleDate;
    const nextBatch = input.batch?.trim() || existing.saleBatchLabel;
    const nextGrade = input.grade?.trim() || existing.productGrade;
    const nextVoucherNo = input.voucherNo?.trim() || existing.receiptVoucherNo;
    const nextNotes = input.notes !== undefined ? input.notes.trim() : existing.notes;

    const customer = await ensureCustomerWithAccountTx(tx, {
      name: nextCustomerName,
      phone: nextPhone,
    });

    const financialChanged =
      Math.abs(nextTotal - existing.totalAmount) > 0.005 ||
      Math.abs(nextCredit - existing.creditPaid) > 0.005 ||
      nextCustomerName !== existing.customerName ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCycle?.id !== existing.harvestCycleId;

    let nextJournalEntryId = existing.journalEntryId;
    if (financialChanged) {
      if (existing.journalEntryId) {
        await reverseJournalEntry({
          tx,
          journalEntryId: existing.journalEntryId,
          createdById: input.createdById,
          reason: `تعديل عملية بيع (${existing.customerName})`,
        }).catch(() => null);
      }

      if (nextTotal > 0) {
        const invRes = await postSalesInvoice({
          tx,
          customerId: customer.id,
          projectId: nextProjectId,
          subProjectId: nextSubProjectId,
          harvestCycleId: nextCycle?.id ?? null,
          amount: nextTotal,
          currency: "YER",
          date: new Date(`${nextDate}T10:00:00Z`),
          notes: nextNotes || `${nextBatch} (${nextBundles} × ${nextPrice})`,
          createdById: input.createdById,
        });
        nextJournalEntryId = invRes.journalEntry.id;

        if (nextCredit > 0) {
          await postCustomerReceipt({
            tx,
            customerId: customer.id,
            invoiceId: invRes.invoice.id,
            projectId: nextProjectId,
            subProjectId: nextSubProjectId,
            treasuryId: "t1",
            amount: nextCredit,
            currency: "YER",
            date: new Date(`${nextDate}T10:05:00Z`),
            notes: `تحصيل معدل عند البيع (${nextVoucherNo})`,
            createdById: input.createdById,
          });
        }
      } else {
        nextJournalEntryId = null;
      }
    } else if (existing.journalEntryId && nextDate !== existing.saleDate) {
      await tx.journalEntry.update({
        where: { id: existing.journalEntryId },
        data: { date: new Date(`${nextDate}T10:00:00Z`) },
      });
    }

    const updated = await tx.saleTransaction.update({
      where: { id: existing.id },
      data: {
        projectId: nextProjectId,
        subProjectId: nextSubProjectId,
        harvestCycleId: nextCycle?.id ?? null,
        harvestName: nextHarvest,
        saleBatchLabel: nextBatch,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        productGrade: nextGrade,
        bundlesCount: nextBundles,
        unitPrice: nextPrice,
        totalAmount: nextTotal,
        creditPaid: nextCredit,
        debitReceivable: nextDebit,
        saleDate: nextDate,
        receiptVoucherNo: nextVoucherNo,
        notes: nextNotes,
        journalEntryId: nextJournalEntryId,
      },
    });

    await recordAuditDiffTx(tx, {
      userId: input.createdById,
      action: "UPDATE",
      entity: "SaleTransaction",
      entityId: existing.id,
      before: {
        date: existing.saleDate,
        customerName: existing.customerName,
        totalAmount: existing.totalAmount,
        creditPaid: existing.creditPaid,
      },
      after: {
        date: updated.saleDate,
        customerName: updated.customerName,
        totalAmount: updated.totalAmount,
        creditPaid: updated.creditPaid,
      },
    });

    return updated;
  });
}


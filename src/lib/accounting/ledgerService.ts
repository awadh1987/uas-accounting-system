import type { Account } from "@prisma/client";
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
import {
  assertPostableAccount,
  deriveGenFields,
  provisionEntityGen6AccountAndCostCenter,
  resolveLineCostCenter,
} from "@/lib/accountingCoreEngine";
import { assertDateNotInClosedFiscalYear } from "@/lib/fiscalYearClosingEngine";
import { assertDateInOpenAccountingPeriod } from "@/lib/accounting/periodEngine";
import { computeDocumentTaxTx } from "@/lib/accounting/taxEngine";
import { evaluateAndRouteApprovalTx } from "@/lib/approvalEngine";
import { consumeStockLayersOutTx, recordStockLayerInTx } from "@/lib/inventoryGlBridge";
import { convertToBaseQty } from "@/lib/multiUnitInventoryEngine";
import {
  assertNotInLockedPeriod,
  DEFAULT_CONTROL_ACCOUNTS,
  generateNextDocumentNumber,
  parseAccountingSettings,
  type ControlAccountsMap,
  type DocumentSequenceKey,
} from "@/lib/accountingSettings";
import {
  balanceDualCurrencyLines,
  computeRealizedFxGainLoss,
} from "@/lib/multiCurrencyEngine";
import { dAdd, dDiv, dMul, dSub, round4Decimal, toDecimalNumber } from "@/lib/decimalMath";
import { emitNotification } from "@/lib/notifications/notificationService";

export type DbClient = Prisma.TransactionClient | typeof prisma;

export interface JournalLineInput {
  accountId?: string;
  accountCode?: string;
  debit?: number;
  credit?: number;
  foreignDebit?: number;
  foreignCredit?: number;
  baseDebit?: number;
  baseCredit?: number;
  currency?: string;
  exchangeRate?: number;
  memo?: string;
  projectId?: string | null;
  subProjectId?: string | null;
  harvestCycleId?: string | null;
  costCenterId?: string | null;
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
  entryType?: "NORMAL" | "OPENING" | "ADJUSTMENT" | "YEAR_END_CLOSING";
  fiscalYearId?: string | null;
  projectId?: string | null;
  subProjectId?: string | null;
  costCenterId?: string | null;
  createdById?: string;
  status?: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "VOIDED";
  lines: JournalLineInput[];
  attachments?: AttachmentInput[];
  allowLockedAdjustment?: boolean;
  skipApprovalCheck?: boolean;
  tx?: Prisma.TransactionClient;
}

export interface CustomAccountInput {
  nameAr: string;
  nameEn?: string;
  parentCode: string;
  code?: string;
}

export interface PostVendorBillItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  itemId?: string | null;
  warehouseId?: string | null;
  unitId?: string | null;
  taxCodeId?: string | null;
  whtCodeId?: string | null;
}

export interface PostVendorBillInput {
  vendorId: string;
  projectId: string;
  subProjectId?: string | null;
  purchaseOrderId?: string | null;
  acquisitionCycleId?: string | null;
  billType?: "BILL" | "CREDIT_NOTE" | "DEBIT_NOTE";
  originalBillId?: string | null;
  items?: PostVendorBillItemInput[];
  totalAmount: number;
  currency?: string;
  date?: Date | string;
  dueDate?: Date | string | null;
  taxCodeId?: string | null;
  whtCodeId?: string | null;
  taxInclusive?: boolean;
  isInventory?: boolean;
  debitAccountId?: string | null;
  debitAccountCode?: string | null;
  customAccount?: CustomAccountInput | null;
  notes?: string;
  costCenterId?: string | null;
  createdById?: string;
  skipApprovalCheck?: boolean;
  gatewayProvider?: string;
  gatewayMerchantId?: string;
  gatewayEndpointUrl?: string;
  gatewayCredentialsEnc?: string;
  isSandbox?: boolean;
  linkedPaymentReceiptId?: string | null;
  tenantSlug?: string | null;
  tx?: Prisma.TransactionClient;
}

export interface PostVendorPaymentInput {
  vendorId: string;
  billId?: string | null;
  allocations?: Array<{ billId: string; amount: number }>;
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
  costCenterId?: string | null;
  createdById?: string;
  skipApprovalCheck?: boolean;
  gatewayProvider?: string;
  gatewayMerchantId?: string;
  gatewayEndpointUrl?: string;
  gatewayCredentialsEnc?: string;
  isSandbox?: boolean;
  linkedPaymentReceiptId?: string | null;
  tenantSlug?: string | null;
  tx?: Prisma.TransactionClient;
}

export interface PostSalesInvoiceItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  itemId?: string | null;
  warehouseId?: string | null;
  unitId?: string | null;
  taxCodeId?: string | null;
  whtCodeId?: string | null;
}

export interface PostSalesInvoiceInput {
  customerId: string;
  projectId: string;
  subProjectId?: string | null;
  harvestCycleId?: string | null;
  invoiceType?: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  originalInvoiceId?: string | null;
  items?: PostSalesInvoiceItemInput[];
  amount: number;
  currency?: string;
  date?: Date | string;
  dueDate?: Date | string | null;
  taxCodeId?: string | null;
  whtCodeId?: string | null;
  taxInclusive?: boolean;
  overrideCreditLimit?: boolean;
  creditPaidImmediate?: number;
  notes?: string;
  revenueAccountId?: string | null;
  revenueAccountCode?: string | null;
  customAccount?: CustomAccountInput | null;
  sequenceNumber?: string | null;
  dailyBatchLabel?: string | null;
  salesOfficerId?: string | null;
  salesOfficerTitle?: string | null;
  treasuryAccountId?: string | null;
  costCenterId?: string | null;
  createdById?: string;
  skipApprovalCheck?: boolean;
  tx?: Prisma.TransactionClient;
}

export interface PostCustomerReceiptInput {
  customerId: string;
  invoiceId?: string | null;
  allocations?: Array<{ invoiceId: string; amount: number }>;
  projectId?: string | null;
  subProjectId?: string | null;
  treasuryId: string;
  amount: number;
  currency?: string;
  date?: Date | string;
  notes?: string;
  costCenterId?: string | null;
  createdById?: string;
  skipApprovalCheck?: boolean;
  gatewayProvider?: string;
  gatewayMerchantId?: string;
  gatewayEndpointUrl?: string;
  gatewayCredentialsEnc?: string;
  isSandbox?: boolean;
  linkedPaymentReceiptId?: string | null;
  tenantSlug?: string | null;
  tx?: Prisma.TransactionClient;
}

export interface FinancialReportFilters {
  fromDate?: string | Date;
  toDate?: string | Date;
  projectId?: string;
  subProjectId?: string;
  costCenterId?: string;
  maxLevel?: number;
  includeYearEndClosing?: boolean;
}

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  return toDecimalNumber(v, 0);
}

function round4(n: number): number {
  return round4Decimal(n);
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
  if (row && toNum(row.rateToYER) > 0) return toNum(row.rateToYER);
  if (code === "SAR") return 425;
  if (code === "USD") return 1620;
  return 1;
}

async function getControlAccountsTx(client: DbClient): Promise<ControlAccountsMap> {
  try {
    const settingsRow = await client.systemSettings.findUnique({ where: { id: "default" } });
    return parseAccountingSettings(settingsRow).controlAccounts;
  } catch {
    return { ...DEFAULT_CONTROL_ACCOUNTS };
  }
}

async function ensureControlAccountTx(
  tx: Prisma.TransactionClient,
  code: string,
  meta: { nameAr: string; nameEn: string; type: AccountType; parentCode: string }
): Promise<Account> {
  const existing = await tx.account.findUnique({ where: { code } });
  if (existing) return existing;
  const parent = await tx.account.findUnique({ where: { code: meta.parentCode } });
  if (parent) {
    return createHierarchicalAccount({
      code,
      nameAr: meta.nameAr,
      nameEn: meta.nameEn,
      parentId: parent.id,
      parentCode: parent.code,
      type: meta.type,
      tx,
    });
  }
  return tx.account.create({
    data: {
      code,
      nameAr: meta.nameAr,
      nameEn: meta.nameEn,
      level: 5,
      generation: 5,
      type: meta.type,
      isPosting: true,
      isPostable: true,
    },
  });
}

async function documentCodeExists(
  client: DbClient,
  model: "journalEntry" | "vendorBill" | "paymentVoucher" | "salesInvoice" | "receiptVoucher" | "purchaseOrder" | "goodsReceipt",
  candidate: string
): Promise<boolean> {
  if (model === "journalEntry") {
    return Boolean(await client.journalEntry.findUnique({ where: { entryNumber: candidate }, select: { id: true } }));
  }
  if (model === "vendorBill") {
    return Boolean(await client.vendorBill.findUnique({ where: { billNumber: candidate }, select: { id: true } }));
  }
  if (model === "paymentVoucher") {
    return Boolean(await client.paymentVoucher.findUnique({ where: { voucherNumber: candidate }, select: { id: true } }));
  }
  if (model === "salesInvoice") {
    return Boolean(await client.salesInvoice.findUnique({ where: { invoiceNumber: candidate }, select: { id: true } }));
  }
  if (model === "receiptVoucher") {
    return Boolean(await client.receiptVoucher.findUnique({ where: { voucherNumber: candidate }, select: { id: true } }));
  }
  if (model === "purchaseOrder") {
    return Boolean(await client.purchaseOrder.findUnique({ where: { poNumber: candidate }, select: { id: true } }));
  }
  return Boolean(await client.goodsReceipt.findUnique({ where: { grnNumber: candidate }, select: { id: true } }));
}

async function nextSequenceCode(
  client: DbClient,
  model: "journalEntry" | "vendorBill" | "paymentVoucher" | "salesInvoice" | "receiptVoucher" | "purchaseOrder" | "goodsReceipt",
  prefix: string,
  docDate?: Date
): Promise<string> {
  const year = (docDate || new Date()).getFullYear();

  const seqKeyMap: Partial<Record<typeof model, DocumentSequenceKey>> = {
    journalEntry: "JV",
    vendorBill: "BILL",
    paymentVoucher: "PV",
    salesInvoice: "INV",
    receiptVoucher: "RV",
  };
  const seqKey = seqKeyMap[model];

  if (seqKey) {
    // Acquire transactional write lock on SystemSettings singleton before reading sequence counter
    await client.systemSettings.upsert({
      where: { id: "default" },
      update: { updatedAt: new Date() },
      create: { id: "default" },
    });
    const settingsRow = await client.systemSettings.findUnique({ where: { id: "default" } });
    let sequences = parseAccountingSettings(settingsRow).documentSequences;
    let allocated = generateNextDocumentNumber(seqKey, sequences, year);

    let attempts = 0;
    while ((await documentCodeExists(client, model, allocated.documentNumber)) && attempts < 200) {
      sequences = allocated.nextSequences;
      allocated = generateNextDocumentNumber(seqKey, sequences, year);
      attempts++;
    }
    if (await documentCodeExists(client, model, allocated.documentNumber)) {
      const uniqueSuffix = crypto.randomUUID().slice(0, 6).toUpperCase();
      allocated = {
        ...allocated,
        documentNumber: `${allocated.documentNumber}-${uniqueSuffix}`,
      };
    }

    await client.systemSettings.update({
      where: { id: "default" },
      data: { documentSequencesJson: JSON.stringify(allocated.nextSequences) },
    });

    return allocated.documentNumber;
  }

  let count = 0;
  if (model === "purchaseOrder") count = await client.purchaseOrder.count();
  else if (model === "goodsReceipt") count = await client.goodsReceipt.count();

  let seq = count + 1;
  let candidate = `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
  let guard = 0;
  while ((await documentCodeExists(client, model, candidate)) && guard < 100) {
    seq++;
    candidate = `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
    guard++;
  }
  return candidate;
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
  await assertPostableAccount(client, account);
  return account;
}

export const resolveOrProvisionPostingAccountTx = resolveOrCreatePostingAccountTx;

export async function resolveOrCreatePostingAccountTx(
  tx: Prisma.TransactionClient,
  input: {
    accountId?: string | null;
    accountCode?: string | null;
    customAccount?: CustomAccountInput | null;
    fallbackDefaultCode?: string;
    userId?: string | null;
  }
): Promise<Account> {
  // If customAccount is specified with a name and parentCode, create it atomically
  if (
    input.customAccount &&
    input.customAccount.nameAr?.trim() &&
    input.customAccount.parentCode?.trim()
  ) {
    const custom = input.customAccount;
    const parent = await tx.account.findUnique({ where: { code: custom.parentCode.trim() } });
    if (!parent) {
      throw new Error(`PARENT_COA_MISSING: الحساب الأب برمز '${custom.parentCode}' غير موجود لإنشاء الحساب المخصص`);
    }

    return await createHierarchicalAccount({
      code: custom.code?.trim() || undefined,
      nameAr: custom.nameAr.trim(),
      nameEn: custom.nameEn?.trim() || custom.nameAr.trim(),
      parentId: parent.id,
      parentCode: parent.code,
      type: parent.type,
      tx,
      userId: input.userId,
    });
  }

  // Otherwise resolve existing posting leaf account
  const targetCode = input.accountId
    ? undefined
    : input.accountCode?.trim() || input.fallbackDefaultCode;
  return await resolvePostingAccount(tx, {
    accountId: input.accountId || undefined,
    accountCode: targetCode,
  });
}

export async function ensureChildPostingAccount(
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
      ...deriveGenFields(5, true, parent.id),
    },
  });
  return created.id;
}

export async function ensureCustomerWithAccountTx(
  tx: Prisma.TransactionClient,
  input: { name: string; phone?: string; nameEn?: string; address?: string; costCenterId?: string | null }
) {
  const cleanName = input.name.trim();
  const existing = await tx.customer.findUnique({ where: { name: cleanName } });
  if (existing) {
    if (input.phone && input.phone !== existing.phone) {
      return tx.customer.update({ where: { id: existing.id }, data: { phone: input.phone } });
    }
    return existing;
  }
  const customerId = crypto.randomUUID();
  const prov = await provisionEntityGen6AccountAndCostCenter(
    { entityType: "CUSTOMER", entityId: customerId, nameAr: cleanName, nameEn: input.nameEn || cleanName, costCenterId: input.costCenterId ?? null },
    tx
  );
  const accountId = prov.account.id;
  const count = await tx.customer.count();
  return tx.customer.create({
    data: {
      id: customerId,
      glAccountId: accountId,
      costCenterId: prov.costCenterId,
      code: `CUST-${String(count + 1).padStart(3, "0")}-${Date.now().toString().slice(-3)}`,
      name: cleanName,
      nameAr: cleanName,
      nameEn: input.nameEn || cleanName,
      phone: input.phone || "",
      address: input.address || null,
      accountId,
    },
  });
}

export async function ensureWorkerWithAccountTx(
  tx: Prisma.TransactionClient,
  input: { name: string; defaultDailyWage?: number; phone?: string; costCenterId?: string | null }
) {
  const cleanName = input.name.trim();
  const existing = await tx.worker.findUnique({ where: { name: cleanName } });
  if (existing) {
    let accountId = existing.accountId;
    let costCenterId = input.costCenterId || existing.costCenterId;
    if (!accountId || !existing.glAccountId || !costCenterId) {
      const prov = await provisionEntityGen6AccountAndCostCenter(
        { entityType: "WORKER", entityId: existing.id, nameAr: cleanName, nameEn: cleanName, costCenterId },
        tx
      );
      accountId = accountId || prov.account.id;
      costCenterId = prov.costCenterId;
    }
    return tx.worker.update({
      where: { id: existing.id },
      data: {
        defaultDailyWage: input.defaultDailyWage ?? existing.defaultDailyWage,
        accountId,
        glAccountId: existing.glAccountId ?? accountId,
        costCenterId,
      },
    });
  }
  const workerId = crypto.randomUUID();
  const prov = await provisionEntityGen6AccountAndCostCenter(
    { entityType: "WORKER", entityId: workerId, nameAr: cleanName, nameEn: cleanName, costCenterId: input.costCenterId ?? null },
    tx
  );
  const accountId = prov.account.id;
  return tx.worker.create({
    data: {
      id: workerId,
      glAccountId: accountId,
      costCenterId: prov.costCenterId,
      name: cleanName,
      phone: input.phone || "",
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
    costCenterId?: string | null;
  }
) {
  const vendorId = crypto.randomUUID();
  const prov = await provisionEntityGen6AccountAndCostCenter(
    { entityType: "VENDOR", entityId: vendorId, nameAr: input.nameAr.trim(), nameEn: input.nameEn?.trim() || input.nameAr.trim(), costCenterId: input.costCenterId ?? null },
    tx
  );
  const accountId = prov.account.id;
  const count = await tx.vendor.count();
  return tx.vendor.create({
    data: {
      id: vendorId,
      glAccountId: accountId,
      costCenterId: prov.costCenterId,
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
    const entryDate = input.date ? new Date(input.date) : new Date();
    const entryNumber = await nextSequenceCode(tx, "journalEntry", "JV", entryDate);
    const entryType = input.entryType || "NORMAL";

    const settingsRow = await tx.systemSettings.findUnique({ where: { id: "default" } });
    const parsedSettings = parseAccountingSettings(settingsRow);
    const controlAccounts = parsedSettings.controlAccounts;

    if (
      !input.allowLockedAdjustment &&
      entryType !== "YEAR_END_CLOSING" &&
      entryType !== "OPENING"
    ) {
      await assertDateNotInClosedFiscalYear(tx, entryDate);
      const lockCheck = assertNotInLockedPeriod(entryDate, parsedSettings.periodLockDate);
      if (!lockCheck.ok) {
        throw new Error(`PERIOD_LOCKED: ${lockCheck.error}`);
      }
      await assertDateInOpenAccountingPeriod(tx, entryDate, {
        allowSoftCloseOverride: Boolean(input.allowLockedAdjustment),
      });
    } else if (entryType !== "YEAR_END_CLOSING" && entryType !== "OPENING") {
      await assertDateInOpenAccountingPeriod(tx, entryDate, {
        allowSoftCloseOverride: true,
      });
    }

    let resolvedFiscalYearId = input.fiscalYearId ?? null;
    if (!resolvedFiscalYearId) {
      const matchingFy = await tx.fiscalYear.findFirst({
        where: { startDate: { lte: entryDate }, endDate: { gte: entryDate } },
        select: { id: true },
      });
      resolvedFiscalYearId = matchingFy?.id ?? null;
    }

    let totalDebitBase = 0;
    let totalCreditBase = 0;
    let hasNonYerCurrency = false;

    const preparedLines: Array<{
      accountId: string;
      debit: number;
      credit: number;
      currency: string;
      currencyCode: string;
      exchangeRate: number;
      foreignDebit: number;
      foreignCredit: number;
      debitBase: number;
      creditBase: number;
      baseDebit: number;
      baseCredit: number;
      memo: string;
      projectId: string | null;
      subProjectId: string | null;
      harvestCycleId: string | null;
      costCenterId: string | null;
    }> = [];

    for (const line of input.lines) {
      const account = await resolvePostingAccount(tx, line);
      const debit = round4(Number(line.debit) || 0);
      const credit = round4(Number(line.credit) || 0);
      const explicitBaseDr = line.baseDebit !== undefined ? round4(Number(line.baseDebit) || 0) : undefined;
      const explicitBaseCr = line.baseCredit !== undefined ? round4(Number(line.baseCredit) || 0) : undefined;
      const hasBaseOnlyReval =
        debit === 0 &&
        credit === 0 &&
        ((explicitBaseDr !== undefined && explicitBaseDr > 0) ||
          (explicitBaseCr !== undefined && explicitBaseCr > 0));

      if (debit < 0 || credit < 0) {
        throw new Error("NEGATIVE_LINE_AMOUNT: Debit and Credit amounts cannot be negative.");
      }
      if (!hasBaseOnlyReval && debit === 0 && credit === 0) {
        throw new Error("ZERO_LINE_AMOUNT: Journal line cannot have both Debit and Credit equal to 0.");
      }
      if ((debit > 0 && credit > 0) || ((explicitBaseDr ?? 0) > 0 && (explicitBaseCr ?? 0) > 0)) {
        throw new Error("DUAL_SIDED_LINE: A single journal line cannot carry both Debit and Credit.");
      }

      if (line.harvestCycleId && !input.allowLockedAdjustment) {
        const cycle = await tx.harvestCycle.findUnique({ where: { id: line.harvestCycleId } });
        if (cycle?.isLocked) {
          throw new Error(`HARVEST_LOCKED: Cycle "${cycle.name}" is locked for direct postings.`);
        }
      }

      const currency = (line.currency || "YER").toUpperCase();
      if (currency !== "YER") hasNonYerCurrency = true;
      const rate =
        currency === "YER"
          ? 1
          : line.exchangeRate && line.exchangeRate > 0
          ? line.exchangeRate
          : await getExchangeRateToYER(tx, currency);

      const foreignDebit =
        line.foreignDebit !== undefined ? round4(Number(line.foreignDebit) || 0) : debit;
      const foreignCredit =
        line.foreignCredit !== undefined ? round4(Number(line.foreignCredit) || 0) : credit;
      const debitBase =
        explicitBaseDr !== undefined ? explicitBaseDr : dMul(debit, rate, 4);
      const creditBase =
        explicitBaseCr !== undefined ? explicitBaseCr : dMul(credit, rate, 4);

      totalDebitBase = dAdd(totalDebitBase, debitBase, 4);
      totalCreditBase = dAdd(totalCreditBase, creditBase, 4);

      preparedLines.push({
        accountId: account.id,
        debit,
        credit,
        currency,
        currencyCode: currency,
        exchangeRate: rate,
        foreignDebit,
        foreignCredit,
        debitBase,
        creditBase,
        baseDebit: debitBase,
        baseCredit: creditBase,
        memo: line.memo || input.narrationAr,
        projectId: line.projectId !== undefined ? line.projectId : input.projectId ?? null,
        subProjectId:
          line.subProjectId !== undefined
            ? line.subProjectId
            : input.subProjectId ?? null,
        harvestCycleId: line.harvestCycleId ?? null,
        costCenterId: resolveLineCostCenter({
          line: line.costCenterId,
          entry: input.costCenterId,
          accountDefault: account.defaultCostCenterId,
        }),
      });
    }

    const baseImbalance = dSub(totalDebitBase, totalCreditBase, 4);
    if (
      Math.abs(baseImbalance) > 0.0001 &&
      Math.abs(baseImbalance) <= 1.0 &&
      hasNonYerCurrency
    ) {
      const fxRoundingCode = controlAccounts.fxRoundingAccount || "532103";
      const fxCheck = balanceDualCurrencyLines(
        preparedLines.map((l) => ({
          accountId: l.accountId,
          currencyCode: l.currencyCode,
          exchangeRate: l.exchangeRate,
          foreignDebit: l.foreignDebit,
          foreignCredit: l.foreignCredit,
          baseDebit: l.baseDebit,
          baseCredit: l.baseCredit,
          memo: l.memo,
        })),
        fxRoundingCode
      );
      if (fxCheck.ok && fxCheck.lines.length > preparedLines.length) {
        const roundingLine = fxCheck.lines[fxCheck.lines.length - 1];
        const roundingAccount = await ensureControlAccountTx(tx, fxRoundingCode, {
          nameAr: "فروق تقريب العملات الأجنبية",
          nameEn: "FX Rounding Adjustment",
          type: "EXPENSE",
          parentCode: "532100",
        });
        preparedLines.push({
          accountId: roundingAccount.id,
          debit: roundingLine.foreignDebit,
          credit: roundingLine.foreignCredit,
          currency: "YER",
          currencyCode: "YER",
          exchangeRate: 1,
          foreignDebit: roundingLine.foreignDebit,
          foreignCredit: roundingLine.foreignCredit,
          debitBase: roundingLine.baseDebit,
          creditBase: roundingLine.baseCredit,
          baseDebit: roundingLine.baseDebit,
          baseCredit: roundingLine.baseCredit,
          memo: roundingLine.memo || "فروق تقريب عملات أجنبية / FX rounding adjustment",
          projectId: input.projectId ?? null,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: null,
          costCenterId: input.costCenterId ?? null,
        });
        totalDebitBase = dAdd(totalDebitBase, roundingLine.baseDebit, 4);
        totalCreditBase = dAdd(totalCreditBase, roundingLine.baseCredit, 4);
      }
    }

    if (Math.abs(dSub(totalDebitBase, totalCreditBase, 4)) > 0.005) {
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
        documentStatus: input.status || "POSTED",
        sourceType: input.sourceType || "MANUAL",
        sourceId: input.sourceId || null,
        entryType,
        fiscalYearId: resolvedFiscalYearId,
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

    // Unified Approval Gate for direct/manual GL journals
    const documentDelegatedSources = new Set([
      "REVERSAL",
      "FX_REVALUATION",
      "VENDOR_BILL",
      "VENDOR_PAYMENT",
      "SALES_INVOICE",
      "CUSTOMER_RECEIPT",
      "EXPENSE",
      "WORKER_ACCRUAL",
      "WORKER_PAYOUT",
      "INVENTORY_MOVEMENT",
      "BANK_GATEWAY_PAYOUT",
      "BANK_GATEWAY_COLLECTION",
      "YEAR_END_CLOSING",
      "OPENING",
    ]);
    let finalEntry = entry;
    if (
      !input.skipApprovalCheck &&
      entry.status === "POSTED" &&
      entryType === "NORMAL" &&
      !documentDelegatedSources.has(entry.sourceType || "")
    ) {
      const approval = await evaluateAndRouteApprovalTx(tx, {
        module: "ACCOUNTING",
        actionType: "GL_POSTING",
        targetType: "JournalEntry",
        targetId: entry.id,
        documentNumber: entry.entryNumber,
        summaryAr: entry.narrationAr,
        summaryEn: entry.narrationEn || entry.narrationAr,
        amountBase: totalDebitBase,
        currencyCode: "YER",
        afterSnapshot: {
          entryNumber: entry.entryNumber,
          totalDebitBase,
          date: entryDate.toISOString().slice(0, 10),
        },
        requestedById: createdById,
      });
      if (approval.requiresApproval) {
        finalEntry = await tx.journalEntry.findUniqueOrThrow({
          where: { id: entry.id },
          include: {
            lines: { include: { account: true } },
            attachments: true,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: createdById,
        action: finalEntry.status === "POSTED" ? "POST" : "CREATE",
        entity: "JournalEntry",
        entityId: finalEntry.id,
        details: {
          entryNumber: finalEntry.entryNumber,
          totalDebitBase,
          totalCreditBase,
          sourceType: finalEntry.sourceType,
          reference: finalEntry.reference,
        },
      },
    });

    if (finalEntry.status === "POSTED") {
      await emitNotification(
        {
          eventType: "JOURNAL_POSTED",
          channel: "general",
          severity: "SUCCESS",
          titleAr: `تم ترحيل قيد يومية (${finalEntry.entryNumber})`,
          titleEn: `Journal Entry Posted (${finalEntry.entryNumber})`,
          messageAr: `${finalEntry.narrationAr} — الإجمالي: ${totalDebitBase.toLocaleString("en-US")} ريال`,
          messageEn: `${finalEntry.narrationEn || finalEntry.narrationAr} — Total: ${totalDebitBase.toLocaleString("en-US")} YER`,
          targetTab: "ledger",
          targetEntityType: "JournalEntry",
          targetEntityId: finalEntry.id,
          actorUserId: createdById,
          metadata: { entryNumber: finalEntry.entryNumber, totalDebitBase, sourceType: finalEntry.sourceType },
        },
        tx
      );
    }

    return finalEntry;
  });
}

/**
 * Immutable reversal: keeps original POSTED (marking isReversed=true) and posts an
 * offsetting entry swapping DR/CR while preserving costCenterId, currencyCode, foreign* & base*.
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
    if (original.status === "VOIDED" || original.isReversed) {
      throw new Error("JOURNAL_ALREADY_VOIDED");
    }

    const reversal = await postJournalEntry({
      tx,
      date: new Date(),
      reference: `REV-${original.entryNumber}`,
      narrationAr: `قيد عكسي لإلغاء القيد ${original.entryNumber}${input.reason ? `: ${input.reason}` : ""}`,
      narrationEn: `Reversal of ${original.entryNumber}${input.reason ? `: ${input.reason}` : ""}`,
      sourceType: "REVERSAL",
      sourceId: original.id,
      projectId: original.projectId,
      subProjectId: original.subProjectId,
      createdById: input.createdById,
      status: "POSTED",
      allowLockedAdjustment: true,
      lines: original.lines.map((l) => ({
        accountId: l.accountId,
        debit: toNum(l.credit),
        credit: toNum(l.debit),
        foreignDebit: toNum(l.foreignCredit),
        foreignCredit: toNum(l.foreignDebit),
        baseDebit: toNum(l.baseCredit) || toNum(l.creditBase),
        baseCredit: toNum(l.baseDebit) || toNum(l.debitBase),
        currency: l.currencyCode || l.currency,
        exchangeRate: toNum(l.exchangeRate),
        memo: `عكس: ${l.memo || original.entryNumber}`,
        projectId: l.projectId,
        subProjectId: l.subProjectId,
        harvestCycleId: l.harvestCycleId,
        costCenterId: l.costCenterId,
      })),
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: {
        status: "POSTED",
        documentStatus: "POSTED",
        isReversed: true,
        reversedByEntryId: reversal.id,
      },
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
        ? input.items.reduce(
            (sum, item) => dAdd(sum, dMul(Number(item.quantity), Number(item.unitPrice), 4), 4),
            0
          )
        : 0;
    const rawAmount = round4(input.totalAmount > 0 ? input.totalAmount : computedFromItems);
    if (rawAmount <= 0) throw new Error("INVALID_BILL_AMOUNT");

    const billType = input.billType || "BILL";
    const currency = (input.currency || "YER").toUpperCase();
    const rate = await getExchangeRateToYER(tx, currency);
    const billDate = input.date ? new Date(input.date) : new Date();
    const billNumber = await nextSequenceCode(tx, "vendorBill", "BILL", billDate);
    const controlAccounts = await getControlAccountsTx(tx);

    // Calculate line-level or document-level tax (VAT Input + WHT)
    let netAmount = 0;
    let taxAmount = 0;
    let whtAmount = 0;
    let grossAmount = 0;
    const preparedItems: Array<{
      itemId: string | null;
      warehouseId: string | null;
      taxCodeId: string | null;
      description: string;
      unitId: string | null;
      quantity: number;
      unitPrice: number;
      netAmount: number;
      taxAmount: number;
      whtAmount: number;
      totalAmount: number;
    }> = [];

    if (input.items && input.items.length > 0) {
      for (const it of input.items) {
        const lineBase = round4(dMul(Number(it.quantity) || 0, Number(it.unitPrice) || 0, 4));
        const taxBreak = await computeDocumentTaxTx(tx, {
          baseAmount: lineBase,
          taxCodeId: it.taxCodeId ?? input.taxCodeId,
          whtCodeId: it.whtCodeId ?? input.whtCodeId,
          taxInclusive: input.taxInclusive,
          asOfDate: billDate,
        });
        netAmount = dAdd(netAmount, taxBreak.netAmount, 4);
        taxAmount = dAdd(taxAmount, taxBreak.taxAmount, 4);
        whtAmount = dAdd(whtAmount, taxBreak.whtAmount, 4);
        grossAmount = dAdd(grossAmount, taxBreak.grossAmount, 4);
        preparedItems.push({
          itemId: it.itemId ?? null,
          warehouseId: it.warehouseId ?? null,
          taxCodeId: it.taxCodeId ?? input.taxCodeId ?? null,
          description: it.description || "صنف مشتريات",
          unitId: it.unitId ?? null,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          netAmount: taxBreak.netAmount,
          taxAmount: taxBreak.taxAmount,
          whtAmount: taxBreak.whtAmount,
          totalAmount: taxBreak.grossAmount,
        });
      }
    } else {
      const docTax = await computeDocumentTaxTx(tx, {
        baseAmount: rawAmount,
        taxCodeId: input.taxCodeId,
        whtCodeId: input.whtCodeId,
        taxInclusive: input.taxInclusive,
        asOfDate: billDate,
      });
      netAmount = docTax.netAmount;
      taxAmount = docTax.taxAmount;
      whtAmount = docTax.whtAmount;
      grossAmount = docTax.grossAmount;
    }

    const totalAmount = round4(grossAmount);
    const payableToVendor = round4(dSub(totalAmount, whtAmount, 4));

    // Check if linked PO already posted GRN/IR inventory accrual
    let hasPostedGrnAccrual = false;
    if (input.purchaseOrderId && input.isInventory) {
      const grnAccrued = await tx.goodsReceipt.count({
        where: { purchaseOrderId: input.purchaseOrderId, journalEntryId: { not: null } },
      });
      hasPostedGrnAccrual = grnAccrued > 0;
    }

    const defaultDebitCode = input.isInventory
      ? hasPostedGrnAccrual
        ? controlAccounts.grnClearingAccount || "215101"
        : controlAccounts.inventoryInputsAccount || controlAccounts.inventoryAssetAccount || "113201"
      : controlAccounts.operatingExpenseAccount || "524101";
    const debitAccount = await resolveOrCreatePostingAccountTx(tx, {
      accountId: input.debitAccountId,
      accountCode: input.debitAccountCode,
      customAccount: input.customAccount,
      fallbackDefaultCode: defaultDebitCode,
      userId: input.createdById,
    });

    const costCenterId = input.costCenterId ?? project.costCenterId ?? vendor.costCenterId ?? null;
    const isCreditNote = billType === "CREDIT_NOTE";

    const jeLines: JournalLineInput[] = [];
    if (!isCreditNote) {
      jeLines.push({
        accountId: debitAccount.id,
        debit: netAmount,
        currency,
        exchangeRate: rate,
        memo: input.notes || `مشتريات (${billType}) من ${vendor.nameAr}`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
      });
      if (taxAmount > 0.005) {
        jeLines.push({
          accountCode: controlAccounts.taxReceivableAccount || "114301",
          debit: taxAmount,
          currency,
          exchangeRate: rate,
          memo: `ضريبة مدخلات - ${billNumber}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
        });
      }
      if (whtAmount > 0.005) {
        jeLines.push({
          accountCode: controlAccounts.whtPayableAccount || "214201",
          credit: whtAmount,
          currency,
          exchangeRate: rate,
          memo: `ضريبة استقطاع من المنبع - ${billNumber}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
        });
      }
      jeLines.push({
        accountId: vendor.accountId,
        credit: payableToVendor,
        currency,
        exchangeRate: rate,
        memo: `ذمة دائنة - ${vendor.nameAr} (${billNumber})`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
      });
    } else {
      // Purchase Credit Note: DR Vendor Payable, CR Expense/Inventory & Input VAT
      jeLines.push({
        accountId: vendor.accountId,
        debit: payableToVendor,
        currency,
        exchangeRate: rate,
        memo: `إشعار دائن مورد ${billNumber} - ${vendor.nameAr}`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
      });
      jeLines.push({
        accountId: debitAccount.id,
        credit: netAmount,
        currency,
        exchangeRate: rate,
        memo: `عكس مشتريات (إشعار دائن) - ${billNumber}`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
      });
      if (taxAmount > 0.005) {
        jeLines.push({
          accountCode: controlAccounts.taxReceivableAccount || "114301",
          credit: taxAmount,
          currency,
          exchangeRate: rate,
          memo: `عكس ضريبة مدخلات - ${billNumber}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
        });
      }
    }

    let je = await postJournalEntry({
      tx,
      date: billDate,
      costCenterId,
      reference: billNumber,
      narrationAr: `${isCreditNote ? "إشعار دائن مورد" : billType === "DEBIT_NOTE" ? "إشعار مدين مورد" : "فاتورة مورد"} ${billNumber} - ${vendor.nameAr} (${project.nameAr})`,
      narrationEn: `Vendor ${billType} ${billNumber} - ${vendor.nameEn || vendor.nameAr}`,
      sourceType: "VENDOR_BILL",
      projectId: project.id,
      subProjectId: input.subProjectId ?? null,
      createdById: input.createdById,
      status: "POSTED",
      skipApprovalCheck: true,
      lines: jeLines,
    });

    const bill = await tx.vendorBill.create({
      data: {
        billNumber,
        billType,
        originalBillId: input.originalBillId ?? null,
        vendorId: vendor.id,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        acquisitionCycleId: input.acquisitionCycleId ?? null,
        date: billDate,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        status: isCreditNote ? "PAID" : "POSTED",
        subTotal: netAmount,
        taxAmount,
        whtAmount,
        totalAmount: payableToVendor,
        paidAmount: isCreditNote ? payableToVendor : 0,
        balanceDue: isCreditNote ? 0 : payableToVendor,
        currency,
        currencyCode: currency,
        exchangeRate: rate,
        foreignAmount: payableToVendor,
        baseAmount: dMul(payableToVendor, rate, 4),
        isInventory: Boolean(input.isInventory),
        debitAccountId: debitAccount.id,
        costCenterId,
        journalEntryId: je.id,
        notes: input.notes || null,
        ...(preparedItems.length > 0 ? { items: { create: preparedItems } } : {}),
      },
      include: { vendor: true, project: true, subProject: true, purchaseOrder: true, items: true },
    });

    // If inventory VendorBill has itemId lines and no prior GRN already received stock, book StockMovement + FIFO Lot
    if (input.isInventory && !hasPostedGrnAccrual && !isCreditNote && preparedItems.length > 0) {
      const defaultWh = await tx.warehouse.findFirst({ orderBy: { isDefault: "desc" } });
      for (const it of preparedItems) {
        if (!it.itemId) continue;
        const targetWhId = it.warehouseId || defaultWh?.id;
        if (!targetWhId) continue;
        const itemRec = await tx.inventoryItem.findUnique({
          where: { id: it.itemId },
          include: { conversions: true },
        });
        if (!itemRec) continue;
        let factor = 1;
        if (it.unitId && it.unitId !== itemRec.baseUnitId) {
          const conv = itemRec.conversions.find((c) => c.unitId === it.unitId);
          if (conv && Number(conv.factorToBase) > 0) factor = Number(conv.factorToBase);
        }
        const qtyBase = convertToBaseQty(it.quantity, factor);
        const unitCostBase = dMul(dDiv(it.netAmount, qtyBase || 1, 6), rate, 4);
        await recordStockLayerInTx(tx, {
          itemId: it.itemId,
          warehouseId: targetWhId,
          enteredQty: it.quantity,
          enteredUnitId: it.unitId || itemRec.baseUnitId,
          factorToBase: factor,
          qtyBase,
          unitCostBase,
          movementType: "PURCHASE_IN",
          referenceType: "BILL",
          referenceId: bill.id,
          projectId: project.id,
          costCenterId,
          date: billDate,
          postGl: false,
        });
      }
    }

    if (isCreditNote && input.originalBillId) {
      const origBill = await tx.vendorBill.findUnique({ where: { id: input.originalBillId } });
      if (origBill && origBill.status !== "VOIDED") {
        const nextPaid = dAdd(toNum(origBill.paidAmount), payableToVendor, 4);
        const nextDue = Math.max(0, dSub(toNum(origBill.totalAmount), nextPaid, 4));
        await tx.vendorBill.update({
          where: { id: origBill.id },
          data: {
            paidAmount: nextPaid,
            balanceDue: nextDue,
            status: nextDue <= 0.005 ? "PAID" : "PARTIALLY_PAID",
          },
        });
      }
    }

    if (input.purchaseOrderId) {
      await tx.purchaseOrder.update({
        where: { id: input.purchaseOrderId },
        data: { status: "POSTED" },
      });
    }

    const approval = await evaluateAndRouteApprovalTx(tx, {
      module: "PROCUREMENT",
      actionType: "CREATE_AND_POST",
      targetType: "VendorBill",
      targetId: bill.id,
      documentNumber: bill.billNumber,
      summaryAr: `اعتماد فاتورة المورد ${bill.billNumber} - ${vendor.nameAr}`,
      summaryEn: `Vendor Bill ${bill.billNumber} - ${vendor.nameEn || vendor.nameAr}`,
      amountBase: dMul(payableToVendor, rate, 4),
      currencyCode: currency,
      afterSnapshot: { billNumber: bill.billNumber, totalAmount: payableToVendor, currency },
      requestedById: input.createdById,
      skipApprovalCheck: input.skipApprovalCheck,
    });

    if (approval.requiresApproval) {
      je = await tx.journalEntry.update({
        where: { id: je.id },
        data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
        include: { lines: { include: { account: true } }, attachments: true },
      });
      await tx.vendorBill.update({
        where: { id: bill.id },
        data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
      });
    }

    const actorId = await resolveActorId(tx, input.createdById);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: approval.requiresApproval ? "CREATE" : "POST",
        entity: "VendorBill",
        entityId: bill.id,
        details: { billNumber: bill.billNumber, totalAmount: payableToVendor, taxAmount, whtAmount, currency, journalEntryNumber: je.entryNumber },
      },
    });

    const finalBill = approval.requiresApproval
      ? await tx.vendorBill.findUniqueOrThrow({
          where: { id: bill.id },
          include: { vendor: true, project: true, subProject: true, purchaseOrder: true, items: true },
        })
      : bill;

    return { bill: finalBill, journalEntry: je, approvalRequest: approval.request };
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
    const amountYER = dMul(amount, rate, 4);
    const feeYER = dMul(transferFee, rate, 4);
    const totalOut = dAdd(amount, transferFee, 4);
    const totalOutYER = dAdd(amountYER, feeYER, 4);
    const payDate = input.date ? new Date(input.date) : new Date();
    const voucherNumber = await nextSequenceCode(tx, "paymentVoucher", "PV", payDate);
    const controlAccounts = await getControlAccountsTx(tx);

    let projectId: string | null = input.projectId ?? null;
    let subProjectId: string | null = input.subProjectId ?? null;
    let acquisitionCycleId: string | null = input.acquisitionCycleId ?? null;
    let linkedBillCurrency = currency;
    let settledBillForeignAmt = amount;
    let bookedBillRate = rate;

    const allocList =
      input.allocations && input.allocations.length > 0
        ? input.allocations.filter((a) => a.billId && Number(a.amount) > 0)
        : input.billId
        ? [{ billId: input.billId, amount }]
        : [];

    if (allocList.length > 0) {
      const totalAllocated = allocList.reduce((s, a) => dAdd(s, Number(a.amount), 4), 0);
      if (totalAllocated > amount + 0.01) {
        throw new Error(
          `OVER_ALLOCATION: إجمالي التوزيع على الفواتير (${totalAllocated}) يتجاوز مبلغ سند الصرف (${amount}).`
        );
      }

      let primaryProcessed = false;
      for (const alloc of allocList) {
        const bill = await tx.vendorBill.findUnique({ where: { id: alloc.billId } });
        if (!bill) throw new Error(`BILL_NOT_FOUND:${alloc.billId}`);
        projectId = projectId || bill.projectId;
        subProjectId = subProjectId || bill.subProjectId;
        acquisitionCycleId = acquisitionCycleId || bill.acquisitionCycleId;
        const bCurr = (bill.currency || "YER").toUpperCase();
        const currentBillSpotRate = await getExchangeRateToYER(tx, bCurr);
        const allocBase = dMul(Number(alloc.amount), rate, 4);
        const amountInBillCurr = currency === bCurr ? Number(alloc.amount) : dDiv(allocBase, currentBillSpotRate, 4);

        if (!primaryProcessed) {
          linkedBillCurrency = bCurr;
          bookedBillRate = toNum(bill.exchangeRate) > 0 && bCurr !== "YER" ? toNum(bill.exchangeRate) : currentBillSpotRate;
          if (bill.journalEntryId) {
            const billApLine = await tx.journalEntryLine.findFirst({
              where: { journalEntryId: bill.journalEntryId, accountId: vendor.accountId },
              select: { exchangeRate: true },
            });
            if (billApLine && toNum(billApLine.exchangeRate) > 0) {
              bookedBillRate = toNum(billApLine.exchangeRate);
            }
          }
          settledBillForeignAmt = allocList.length === 1 ? amountInBillCurr : amount;
          primaryProcessed = true;
        }

        const nextPaid = dAdd(bill.paidAmount, amountInBillCurr, 4);
        const nextDue = Math.max(0, dSub(bill.totalAmount, nextPaid, 4));
        await tx.vendorBill.update({
          where: { id: bill.id },
          data: {
            paidAmount: nextPaid,
            balanceDue: nextDue,
            status: nextDue <= 0.005 ? "PAID" : "PARTIALLY_PAID",
          },
        });
      }
    }

    const treasuryRate = await getExchangeRateToYER(tx, treasury.currency);
    const totalOutInTreasuryCurr = dDiv(totalOutYER, treasuryRate, 4);
    await tx.treasuryAccount.update({
      where: { id: treasury.id },
      data: {
        balance: dSub(treasury.balance, totalOutInTreasuryCurr, 4),
        balanceYER: dSub(treasury.balanceYER, totalOutYER, 4),
      },
    });

    const apEffectiveSettlementRate =
      settledBillForeignAmt > 0 ? dDiv(amountYER, settledBillForeignAmt, 6) : rate;
    const realizedFx =
      input.billId && linkedBillCurrency !== "YER" && Math.abs(apEffectiveSettlementRate - bookedBillRate) > 0.0001
        ? computeRealizedFxGainLoss({
            foreignAmount: settledBillForeignAmt,
            bookedRate: bookedBillRate,
            settlementRate: apEffectiveSettlementRate,
            side: "PAYABLE",
          })
        : null;

    const feeAccountCode = controlAccounts.bankFeeAccount || "531201";
    const fxGainCode = controlAccounts.realizedFxGainAccount || "421101";
    const fxLossCode = controlAccounts.realizedFxLossAccount || "532101";

    let fxLine: JournalLineInput | null = null;
    if (realizedFx && realizedFx.gainAmount > 0.005) {
      const fxGainAcc = await ensureControlAccountTx(tx, fxGainCode, {
        nameAr: "أرباح فروق عملة محققة",
        nameEn: "Realized FX Gain",
        type: "REVENUE",
        parentCode: "421100",
      });
      fxLine = {
        accountId: fxGainAcc.id,
        credit: realizedFx.gainAmount,
        currency: "YER",
        exchangeRate: 1,
        memo: `أرباح فروق عملة محققة لسند الصرف ${voucherNumber}`,
        projectId,
        subProjectId,
      };
    } else if (realizedFx && realizedFx.lossAmount > 0.005) {
      const fxLossAcc = await ensureControlAccountTx(tx, fxLossCode, {
        nameAr: "خسائر فروق عملة محققة",
        nameEn: "Realized FX Loss",
        type: "EXPENSE",
        parentCode: "532100",
      });
      fxLine = {
        accountId: fxLossAcc.id,
        debit: realizedFx.lossAmount,
        currency: "YER",
        exchangeRate: 1,
        memo: `خسائر فروق عملة محققة لسند الصرف ${voucherNumber}`,
        projectId,
        subProjectId,
      };
    }

    const lines: JournalLineInput[] = [
      {
        accountId: vendor.accountId,
        debit: realizedFx ? settledBillForeignAmt : amount,
        baseDebit: realizedFx ? realizedFx.bookedBase : undefined,
        currency: realizedFx ? linkedBillCurrency : currency,
        exchangeRate: realizedFx ? bookedBillRate : rate,
        memo: input.notes || `سداد للمورد ${vendor.nameAr}`,
        projectId,
        subProjectId,
      },
      ...(transferFee > 0
        ? [
          {
            accountCode: feeAccountCode,
            debit: transferFee,
            currency,
            exchangeRate: rate,
            memo: `رسوم تحويل سند الصرف ${voucherNumber}`,
            projectId,
            subProjectId,
          },
        ]
        : []),
      ...(fxLine ? [fxLine] : []),
      {
        accountId: treasury.accountId,
        credit: totalOut,
        currency,
        exchangeRate: rate,
        memo: `صرف من ${treasury.nameAr}`,
        projectId,
      },
    ];

    const costCenterId = input.costCenterId ?? vendor.costCenterId ?? null;

    let je = await postJournalEntry({
      tx,
      date: payDate,
      costCenterId,
      reference: voucherNumber,
      narrationAr: `سند صرف ${voucherNumber} للمورد ${vendor.nameAr} من ${treasury.nameAr}`,
      narrationEn: `Payment Voucher ${voucherNumber} to ${vendor.nameEn || vendor.nameAr}`,
      sourceType: "VENDOR_PAYMENT",
      projectId,
      subProjectId,
      createdById: input.createdById,
      status: "POSTED",
      skipApprovalCheck: true,
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
        billId: input.billId ?? (allocList[0]?.billId ?? null),
        allocationsJson: allocList.length > 0 ? JSON.stringify(allocList) : null,
        treasuryId: treasury.id,
        amount,
        transferFee,
        currency,
        currencyCode: currency,
        exchangeRate: rate,
        foreignAmount: amount,
        baseAmount: amountYER,
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        projectId,
        subProjectId,
        acquisitionCycleId,
        costCenterId,
        journalEntryId: je.id,
        qrVerificationHash,
      },
      include: { vendor: true, bill: true, treasury: true },
    });

    const approval = await evaluateAndRouteApprovalTx(tx, {
      module: "TREASURY",
      actionType: "CREATE_AND_POST",
      targetType: "PaymentVoucher",
      targetId: voucher.id,
      documentNumber: voucherNumber,
      summaryAr: `اعتماد سند الصرف ${voucherNumber} للمورد ${vendor.nameAr}`,
      summaryEn: `Payment Voucher ${voucherNumber} to ${vendor.nameEn || vendor.nameAr}`,
      amountBase: amountYER,
      currencyCode: currency,
      afterSnapshot: { voucherNumber, amount, currency, amountYER },
      requestedById: input.createdById,
      skipApprovalCheck: input.skipApprovalCheck,
    });

    if (approval.requiresApproval) {
      je = await tx.journalEntry.update({
        where: { id: je.id },
        data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
        include: { lines: { include: { account: true } }, attachments: true },
      });
    }

    const actorId = await resolveActorId(tx, input.createdById);
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: approval.requiresApproval ? "CREATE" : "POST",
        entity: "PaymentVoucher",
        entityId: voucher.id,
        details: { voucherNumber, amount, currency, amountYER, treasuryId: treasury.id },
      },
    });

    return { voucher, journalEntry: je, approvalRequest: approval.request };
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

    const invoiceType = input.invoiceType || "INVOICE";
    const isCreditNote = invoiceType === "CREDIT_NOTE";
    const computedFromItems =
      input.items && input.items.length > 0
        ? input.items.reduce(
            (sum, item) => dAdd(sum, dMul(Number(item.quantity), Number(item.unitPrice), 4), 4),
            0
          )
        : 0;
    const rawAmount = round4(input.amount > 0 ? input.amount : computedFromItems);
    if (rawAmount <= 0) throw new Error("INVALID_INVOICE_AMOUNT");

    const currency = (input.currency || "YER").toUpperCase();
    const rate = await getExchangeRateToYER(tx, currency);
    const invDate = input.date ? new Date(input.date) : new Date();
    const controlAccounts = await getControlAccountsTx(tx);

    // Line-level / doc-level tax computation (VAT Output & WHT)
    let netAmount = 0;
    let taxAmount = 0;
    let whtAmount = 0;
    let grossAmount = 0;
    const preparedItems: Array<{
      itemId: string | null;
      warehouseId: string | null;
      taxCodeId: string | null;
      description: string;
      unitId: string | null;
      quantity: number;
      unitPrice: number;
      netAmount: number;
      taxAmount: number;
      whtAmount: number;
      totalAmount: number;
      costOfGoodsSold: number;
    }> = [];

    if (input.items && input.items.length > 0) {
      for (const it of input.items) {
        const lineBase = round4(dMul(Number(it.quantity) || 0, Number(it.unitPrice) || 0, 4));
        const taxBreak = await computeDocumentTaxTx(tx, {
          baseAmount: lineBase,
          taxCodeId: it.taxCodeId ?? input.taxCodeId,
          whtCodeId: it.whtCodeId ?? input.whtCodeId,
          taxInclusive: input.taxInclusive,
          asOfDate: invDate,
        });
        netAmount = dAdd(netAmount, taxBreak.netAmount, 4);
        taxAmount = dAdd(taxAmount, taxBreak.taxAmount, 4);
        whtAmount = dAdd(whtAmount, taxBreak.whtAmount, 4);
        grossAmount = dAdd(grossAmount, taxBreak.grossAmount, 4);
        preparedItems.push({
          itemId: it.itemId ?? null,
          warehouseId: it.warehouseId ?? null,
          taxCodeId: it.taxCodeId ?? input.taxCodeId ?? null,
          description: it.description || "صنف مبيعات",
          unitId: it.unitId ?? null,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          netAmount: taxBreak.netAmount,
          taxAmount: taxBreak.taxAmount,
          whtAmount: taxBreak.whtAmount,
          totalAmount: taxBreak.grossAmount,
          costOfGoodsSold: 0,
        });
      }
    } else {
      const docTax = await computeDocumentTaxTx(tx, {
        baseAmount: rawAmount,
        taxCodeId: input.taxCodeId,
        whtCodeId: input.whtCodeId,
        taxInclusive: input.taxInclusive,
        asOfDate: invDate,
      });
      netAmount = docTax.netAmount;
      taxAmount = docTax.taxAmount;
      whtAmount = docTax.whtAmount;
      grossAmount = docTax.grossAmount;
    }

    const totalAmount = round4(grossAmount);
    const receivableFromCustomer = round4(dSub(totalAmount, whtAmount, 4));

    // Step 2.3: Enforce Customer.creditLimit before issuing credit exposure
    const creditLimit = toNum(customer.creditLimit);
    if (!isCreditNote && creditLimit > 0 && !input.overrideCreditLimit) {
      const openInvoices = await tx.salesInvoice.findMany({
        where: {
          customerId: customer.id,
          balanceDue: { gt: 0 },
          status: { not: "VOIDED" },
          documentStatus: { not: "VOIDED" },
          invoiceType: { not: "CREDIT_NOTE" },
        },
        select: { balanceDue: true, exchangeRate: true },
      });
      const existingArBase = openInvoices.reduce(
        (s, inv) => dAdd(s, dMul(toNum(inv.balanceDue), toNum(inv.exchangeRate) || 1, 4), 4),
        0
      );
      const immediatePaidBase = dMul(Math.max(0, Number(input.creditPaidImmediate) || 0), rate, 4);
      const newArExposureBase = Math.max(0, dSub(dMul(receivableFromCustomer, rate, 4), immediatePaidBase, 4));
      if (newArExposureBase > 0.005 && dAdd(existingArBase, newArExposureBase, 4) > creditLimit + 0.01) {
        throw new Error(
          `CREDIT_LIMIT_EXCEEDED: تجاوز العميل (${customer.nameAr}) حد الائتمان المسموح (${creditLimit.toLocaleString("en-US")}). الرصيد المفتوح + الفاتورة الجديدة = ${dAdd(existingArBase, newArExposureBase, 2).toLocaleString("en-US")}.`
        );
      }
    }

    const invoiceNumber = await nextSequenceCode(tx, "salesInvoice", "INV", invDate);
    const defaultRevenueCode = isCreditNote
      ? controlAccounts.salesReturnsAccount || "411401"
      : mapProjectIdToSalesRevenueCode(project.id);
    const revenueAccount = await resolveOrCreatePostingAccountTx(tx, {
      accountId: isCreditNote ? null : input.revenueAccountId,
      accountCode: isCreditNote ? controlAccounts.salesReturnsAccount || "411401" : input.revenueAccountCode,
      customAccount: input.customAccount,
      fallbackDefaultCode: defaultRevenueCode,
      userId: input.createdById,
    });

    const costCenterId = input.costCenterId ?? project.costCenterId ?? customer.costCenterId ?? null;
    const invLines: JournalLineInput[] = [];

    if (!isCreditNote) {
      invLines.push({
        accountId: customer.accountId,
        debit: receivableFromCustomer,
        currency,
        exchangeRate: rate,
        memo: `ذمة مدينة - ${customer.nameAr}`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
      });
      if (whtAmount > 0.005) {
        invLines.push({
          accountCode: controlAccounts.taxReceivableAccount || "114301",
          debit: whtAmount,
          currency,
          exchangeRate: rate,
          memo: `ضريبة مستقطعة من العميل - ${invoiceNumber}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
        });
      }
      invLines.push({
        accountId: revenueAccount.id,
        credit: netAmount,
        currency,
        exchangeRate: rate,
        memo: input.notes || `إيراد مبيعات ${project.nameAr}`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
      });
      if (taxAmount > 0.005) {
        invLines.push({
          accountCode: controlAccounts.taxPayableAccount || "214101",
          credit: taxAmount,
          currency,
          exchangeRate: rate,
          memo: `ضريبة مخرجات مبيعات - ${invoiceNumber}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
        });
      }
    } else {
      // Sales Credit Note: DR Sales Returns (411401) + DR VAT Payable, CR Customer AR
      invLines.push({
        accountId: revenueAccount.id,
        debit: netAmount,
        currency,
        exchangeRate: rate,
        memo: input.notes || `مردودات / إشعار دائن مبيعات ${invoiceNumber}`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
      });
      if (taxAmount > 0.005) {
        invLines.push({
          accountCode: controlAccounts.taxPayableAccount || "214101",
          debit: taxAmount,
          currency,
          exchangeRate: rate,
          memo: `عكس ضريبة مخرجات - ${invoiceNumber}`,
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
        });
      }
      invLines.push({
        accountId: customer.accountId,
        credit: receivableFromCustomer,
        currency,
        exchangeRate: rate,
        memo: `تخفيض ذمة عميل (إشعار دائن) - ${customer.nameAr}`,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
      });
    }

    let je = await postJournalEntry({
      tx,
      date: invDate,
      costCenterId,
      reference: invoiceNumber,
      narrationAr: `${isCreditNote ? "إشعار دائن مبيعات" : invoiceType === "DEBIT_NOTE" ? "إشعار مدين مبيعات" : "فاتورة مبيعات"} ${invoiceNumber} للعميل ${customer.nameAr} (${project.nameAr})`,
      narrationEn: `Sales ${invoiceType} ${invoiceNumber} - ${customer.nameEn || customer.nameAr}`,
      sourceType: "SALES_INVOICE",
      projectId: project.id,
      subProjectId: input.subProjectId ?? null,
      createdById: input.createdById,
      status: "POSTED",
      skipApprovalCheck: true,
      lines: invLines,
    });

    // Step 2.1: Inventory Stock Deduction (FIFO/WAC) & DR COGS / CR Inventory GL
    let cogsJournalEntryId: string | null = null;
    if (!isCreditNote && preparedItems.some((it) => Boolean(it.itemId))) {
      const defaultWh = await tx.warehouse.findFirst({ orderBy: { isDefault: "desc" } });
      const cogsGlLines: JournalLineInput[] = [];

      for (const it of preparedItems) {
        if (!it.itemId) continue;
        const itemRec = await tx.inventoryItem.findUnique({
          where: { id: it.itemId },
          include: { conversions: true },
        });
        if (!itemRec || itemRec.itemType === "SERVICE") continue;
        const targetWhId = it.warehouseId || itemRec.defaultWarehouseId || defaultWh?.id;
        if (!targetWhId) continue;

        let factor = 1;
        if (it.unitId && it.unitId !== itemRec.baseUnitId) {
          const conv = itemRec.conversions.find((c) => c.unitId === it.unitId);
          if (conv && Number(conv.factorToBase) > 0) factor = Number(conv.factorToBase);
        }
        const qtyBase = convertToBaseQty(it.quantity, factor);
        const consumed = await consumeStockLayersOutTx(tx, {
          itemId: itemRec.id,
          warehouseId: targetWhId,
          enteredQty: it.quantity,
          enteredUnitId: it.unitId || itemRec.baseUnitId,
          factorToBase: factor,
          qtyBase,
          movementType: "SALE_OUT",
          referenceType: "INVOICE",
          referenceId: invoiceNumber,
          projectId: project.id,
          costCenterId,
          date: invDate,
          postGl: false,
        });
        it.costOfGoodsSold = consumed.totalCost;

        if (consumed.totalCost > 0.005) {
          cogsGlLines.push({
            ...(itemRec.cogsAccountId
              ? { accountId: itemRec.cogsAccountId }
              : { accountCode: controlAccounts.cogsInventoryAccount || controlAccounts.cogsAccount || "512201" }),
            debit: consumed.totalCost,
            projectId: project.id,
            subProjectId: input.subProjectId ?? null,
            memo: `تكلفة مبيعات ${itemRec.nameAr} (${invoiceNumber})`,
          });
          cogsGlLines.push({
            ...(itemRec.inventoryAccountId
              ? { accountId: itemRec.inventoryAccountId }
              : {
                  accountCode:
                    itemRec.itemType === "CONSUMABLE"
                      ? controlAccounts.inventoryInputsAccount || "113201"
                      : controlAccounts.inventoryAssetAccount || "113101",
                }),
            credit: consumed.totalCost,
            projectId: project.id,
            subProjectId: input.subProjectId ?? null,
            memo: `تخفيض مخزون ${itemRec.nameAr} (${invoiceNumber})`,
          });
        }
      }

      if (cogsGlLines.length >= 2) {
        const cogsJe = await postJournalEntry({
          tx,
          date: invDate,
          costCenterId,
          reference: `COGS-${invoiceNumber}`,
          narrationAr: `تكلفة مبيعات المخزون - ${invoiceNumber}`,
          narrationEn: `Inventory COGS - ${invoiceNumber}`,
          sourceType: "SALES_INVOICE",
          projectId: project.id,
          subProjectId: input.subProjectId ?? null,
          createdById: input.createdById,
          status: "POSTED",
          skipApprovalCheck: true,
          lines: cogsGlLines,
        });
        cogsJournalEntryId = cogsJe.id;
      }
    }

    const qrVerificationHash = computeQrVerificationCode(
      `INV:${invoiceNumber}|CUST:${customer.nameAr}|AMT:${receivableFromCustomer}`
    );

    const invoice = await tx.salesInvoice.create({
      data: {
        invoiceNumber,
        invoiceType,
        originalInvoiceId: input.originalInvoiceId ?? null,
        sequenceNumber: input.sequenceNumber ?? null,
        dailyBatchLabel: input.dailyBatchLabel ?? null,
        salesOfficerId: input.salesOfficerId ?? null,
        salesOfficerTitle: input.salesOfficerTitle ?? null,
        revenueAccountCode: revenueAccount.code,
        treasuryAccountId: input.treasuryAccountId ?? null,
        customerId: customer.id,
        projectId: project.id,
        subProjectId: input.subProjectId ?? null,
        harvestCycleId: input.harvestCycleId ?? null,
        date: invDate,
        dueDate: input.dueDate ? new Date(input.dueDate) : invDate,
        subTotal: netAmount,
        taxAmount,
        whtAmount,
        totalAmount: receivableFromCustomer,
        paidAmount: isCreditNote ? receivableFromCustomer : 0,
        balanceDue: isCreditNote ? 0 : receivableFromCustomer,
        status: isCreditNote ? "PAID" : "POSTED",
        currency,
        currencyCode: currency,
        exchangeRate: rate,
        foreignAmount: receivableFromCustomer,
        baseAmount: dMul(receivableFromCustomer, rate, 4),
        notes: input.notes || null,
        costCenterId,
        journalEntryId: je.id,
        cogsJournalEntryId,
        qrVerificationHash,
        ...(preparedItems.length > 0 ? { items: { create: preparedItems } } : {}),
      },
      include: { customer: true, project: true, harvestCycle: true, items: true },
    });

    if (isCreditNote && input.originalInvoiceId) {
      const origInv = await tx.salesInvoice.findUnique({ where: { id: input.originalInvoiceId } });
      if (origInv && origInv.status !== "VOIDED") {
        const nextPaid = dAdd(toNum(origInv.paidAmount), receivableFromCustomer, 4);
        const nextDue = Math.max(0, dSub(toNum(origInv.totalAmount), nextPaid, 4));
        await tx.salesInvoice.update({
          where: { id: origInv.id },
          data: {
            paidAmount: nextPaid,
            balanceDue: nextDue,
            status: nextDue <= 0.005 ? "PAID" : "PARTIALLY_PAID",
          },
        });
      }
    }

    const approval = await evaluateAndRouteApprovalTx(tx, {
      module: "SALES",
      actionType: "CREATE_AND_POST",
      targetType: "SalesInvoice",
      targetId: invoice.id,
      documentNumber: invoice.invoiceNumber,
      summaryAr: `اعتماد فاتورة مبيعات ${invoice.invoiceNumber} - ${customer.nameAr}`,
      summaryEn: `Sales Invoice ${invoice.invoiceNumber} - ${customer.nameEn || customer.nameAr}`,
      amountBase: dMul(receivableFromCustomer, rate, 4),
      currencyCode: currency,
      afterSnapshot: { invoiceNumber: invoice.invoiceNumber, totalAmount: receivableFromCustomer, currency },
      requestedById: input.createdById,
      skipApprovalCheck: input.skipApprovalCheck,
    });

    if (approval.requiresApproval) {
      je = await tx.journalEntry.update({
        where: { id: je.id },
        data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
        include: { lines: { include: { account: true } }, attachments: true },
      });
      if (cogsJournalEntryId) {
        await tx.journalEntry.update({
          where: { id: cogsJournalEntryId },
          data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
        });
      }
      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
      });
    }

    const finalInvoice = approval.requiresApproval
      ? await tx.salesInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: { customer: true, project: true, harvestCycle: true, items: true },
        })
      : invoice;

    return { invoice: finalInvoice, journalEntry: je, cogsJournalEntryId, approvalRequest: approval.request };
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
    const amountYER = dMul(amount, rate, 4);
    const rcpDate = input.date ? new Date(input.date) : new Date();
    const voucherNumber = await nextSequenceCode(tx, "receiptVoucher", "RV", rcpDate);
    const controlAccounts = await getControlAccountsTx(tx);

    let projectId: string | null = input.projectId ?? null;
    let subProjectId: string | null = input.subProjectId ?? null;
    let harvestCycleId: string | null = null;
    let linkedInvCurrency = currency;
    let settledInvForeignAmt = amount;
    let bookedInvRate = rate;

    const allocList =
      input.allocations && input.allocations.length > 0
        ? input.allocations.filter((a) => a.invoiceId && Number(a.amount) > 0)
        : input.invoiceId
        ? [{ invoiceId: input.invoiceId, amount }]
        : [];

    if (allocList.length > 0) {
      const totalAllocated = allocList.reduce((s, a) => dAdd(s, Number(a.amount), 4), 0);
      if (totalAllocated > amount + 0.01) {
        throw new Error(
          `OVER_ALLOCATION: إجمالي التوزيع على الفواتير (${totalAllocated}) يتجاوز مبلغ سند القبض (${amount}).`
        );
      }

      let primaryProcessed = false;
      for (const alloc of allocList) {
        const inv = await tx.salesInvoice.findUnique({ where: { id: alloc.invoiceId } });
        if (!inv) throw new Error(`INVOICE_NOT_FOUND:${alloc.invoiceId}`);
        projectId = projectId || inv.projectId;
        subProjectId = subProjectId || inv.subProjectId;
        harvestCycleId = harvestCycleId || inv.harvestCycleId;
        const iCurr = (inv.currency || "YER").toUpperCase();
        const currentInvSpotRate = await getExchangeRateToYER(tx, iCurr);
        const allocBase = dMul(Number(alloc.amount), rate, 4);
        const amountInInvCurr = currency === iCurr ? Number(alloc.amount) : dDiv(allocBase, currentInvSpotRate, 4);

        if (!primaryProcessed) {
          linkedInvCurrency = iCurr;
          bookedInvRate = toNum(inv.exchangeRate) > 0 && iCurr !== "YER" ? toNum(inv.exchangeRate) : currentInvSpotRate;
          if (inv.journalEntryId) {
            const invArLine = await tx.journalEntryLine.findFirst({
              where: { journalEntryId: inv.journalEntryId, accountId: customer.accountId },
              select: { exchangeRate: true },
            });
            if (invArLine && toNum(invArLine.exchangeRate) > 0) {
              bookedInvRate = toNum(invArLine.exchangeRate);
            }
          }
          settledInvForeignAmt = allocList.length === 1 ? amountInInvCurr : amount;
          primaryProcessed = true;
        }

        const nextPaid = dAdd(inv.paidAmount, amountInInvCurr, 4);
        const nextDue = Math.max(0, dSub(inv.totalAmount, nextPaid, 4));
        await tx.salesInvoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: nextPaid,
            balanceDue: nextDue,
            status: nextDue <= 0.005 ? "PAID" : "PARTIALLY_PAID",
          },
        });
      }
    }

    const treasuryRate = await getExchangeRateToYER(tx, treasury.currency);
    const amountInTreasuryCurr = dDiv(amountYER, treasuryRate, 4);
    await tx.treasuryAccount.update({
      where: { id: treasury.id },
      data: {
        balance: dAdd(treasury.balance, amountInTreasuryCurr, 4),
        balanceYER: dAdd(treasury.balanceYER, amountYER, 4),
      },
    });

    const arEffectiveSettlementRate =
      settledInvForeignAmt > 0 ? dDiv(amountYER, settledInvForeignAmt, 6) : rate;
    const realizedFx =
      input.invoiceId && linkedInvCurrency !== "YER" && Math.abs(arEffectiveSettlementRate - bookedInvRate) > 0.0001
        ? computeRealizedFxGainLoss({
            foreignAmount: settledInvForeignAmt,
            bookedRate: bookedInvRate,
            settlementRate: arEffectiveSettlementRate,
            side: "RECEIVABLE",
          })
        : null;

    const fxGainCode = controlAccounts.realizedFxGainAccount || "421101";
    const fxLossCode = controlAccounts.realizedFxLossAccount || "532101";

    let fxLine: JournalLineInput | null = null;
    if (realizedFx && realizedFx.gainAmount > 0.005) {
      const fxGainAcc = await ensureControlAccountTx(tx, fxGainCode, {
        nameAr: "أرباح فروق عملة محققة",
        nameEn: "Realized FX Gain",
        type: "REVENUE",
        parentCode: "421100",
      });
      fxLine = {
        accountId: fxGainAcc.id,
        credit: realizedFx.gainAmount,
        currency: "YER",
        exchangeRate: 1,
        memo: `أرباح فروق عملة محققة لسند القبض ${voucherNumber}`,
        projectId,
        subProjectId,
        harvestCycleId,
      };
    } else if (realizedFx && realizedFx.lossAmount > 0.005) {
      const fxLossAcc = await ensureControlAccountTx(tx, fxLossCode, {
        nameAr: "خسائر فروق عملة محققة",
        nameEn: "Realized FX Loss",
        type: "EXPENSE",
        parentCode: "532100",
      });
      fxLine = {
        accountId: fxLossAcc.id,
        debit: realizedFx.lossAmount,
        currency: "YER",
        exchangeRate: 1,
        memo: `خسائر فروق عملة محققة لسند القبض ${voucherNumber}`,
        projectId,
        subProjectId,
        harvestCycleId,
      };
    }

    const costCenterId = input.costCenterId ?? customer.costCenterId ?? null;

    let je = await postJournalEntry({
      tx,
      date: rcpDate,
      costCenterId,
      reference: voucherNumber,
      narrationAr: `سند قبض ${voucherNumber} من العميل ${customer.nameAr} إلى ${treasury.nameAr}`,
      narrationEn: `Receipt Voucher ${voucherNumber} from ${customer.nameEn || customer.nameAr}`,
      sourceType: "CUSTOMER_RECEIPT",
      projectId,
      subProjectId,
      createdById: input.createdById,
      status: "POSTED",
      skipApprovalCheck: true,
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
        ...(fxLine ? [fxLine] : []),
        {
          accountId: customer.accountId,
          credit: realizedFx ? settledInvForeignAmt : amount,
          baseCredit: realizedFx ? realizedFx.bookedBase : undefined,
          currency: realizedFx ? linkedInvCurrency : currency,
          exchangeRate: realizedFx ? bookedInvRate : rate,
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
        ...(input.tenantSlug ? { tenantSlug: input.tenantSlug } : {}),
        ...(input.linkedPaymentReceiptId ? { linkedPaymentReceiptId: input.linkedPaymentReceiptId } : {}),
        voucherNumber,
        date: rcpDate,
        customerId: customer.id,
        invoiceId: input.invoiceId ?? (allocList[0]?.invoiceId ?? null),
        allocationsJson: allocList.length > 0 ? JSON.stringify(allocList) : null,
        treasuryId: treasury.id,
        subProjectId,
        amount,
        currency,
        currencyCode: currency,
        exchangeRate: rate,
        foreignAmount: amount,
        baseAmount: amountYER,
        notes: input.notes || null,
        costCenterId,
        journalEntryId: je.id,
        qrVerificationHash,
      },
      include: { customer: true, invoice: true, treasury: true },
    });

    const approval = await evaluateAndRouteApprovalTx(tx, {
      module: "TREASURY",
      actionType: "CREATE_AND_POST",
      targetType: "ReceiptVoucher",
      targetId: receipt.id,
      documentNumber: voucherNumber,
      summaryAr: `اعتماد سند القبض ${voucherNumber} من ${customer.nameAr}`,
      summaryEn: `Receipt Voucher ${voucherNumber} from ${customer.nameEn || customer.nameAr}`,
      amountBase: amountYER,
      currencyCode: currency,
      afterSnapshot: { voucherNumber, amount, currency, amountYER },
      requestedById: input.createdById,
      skipApprovalCheck: input.skipApprovalCheck,
    });

    if (approval.requiresApproval) {
      je = await tx.journalEntry.update({
        where: { id: je.id },
        data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
        include: { lines: { include: { account: true } }, attachments: true },
      });
    }

    return { receipt, journalEntry: je, approvalRequest: approval.request };
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
    expenseAccountId?: string | null;
    expenseAccountCode?: string | null;
    customAccount?: CustomAccountInput | null;
    treasuryAccountId?: string | null;
    taxCodeId?: string | null;
    whtCodeId?: string | null;
    taxInclusive?: boolean;
    skipApprovalCheck?: boolean;
    createdById?: string;
  }
) {
  if (input.totalAmount <= 0) return null;
  const controlAccounts = await getControlAccountsTx(tx);
  const expDate = new Date(`${input.date}T10:00:00Z`);
  const taxBreak = await computeDocumentTaxTx(tx, {
    baseAmount: input.totalAmount,
    taxCodeId: input.taxCodeId,
    whtCodeId: input.whtCodeId,
    taxInclusive: input.taxInclusive,
    asOfDate: expDate,
  });

  const defaultExpCode = mapExpenseCategoryToCoaCode(input.category);
  const debitAccount = await resolveOrCreatePostingAccountTx(tx, {
    accountId: input.expenseAccountId,
    accountCode: input.expenseAccountCode,
    customAccount: input.customAccount,
    fallbackDefaultCode: defaultExpCode,
    userId: input.createdById,
  });

  const targetTreasury = input.treasuryAccountId
    ? await tx.treasuryAccount.findUnique({ where: { id: input.treasuryAccountId } })
    : (await tx.treasuryAccount.findUnique({ where: { id: "t1" } })) ||
      (await tx.treasuryAccount.findFirst({ where: { isDefaultPayments: true, isActive: true } }));

  const creditAccountId = targetTreasury?.accountId;
  const expProject = await tx.project.findUnique({ where: { id: input.projectId }, select: { costCenterId: true } });

  const expLines: JournalLineInput[] = [
    {
      accountId: debitAccount.id,
      debit: taxBreak.netAmount,
      projectId: input.projectId,
      subProjectId: input.subProjectId ?? null,
      harvestCycleId: input.harvestCycleId ?? null,
      memo: input.subType,
    },
    ...(taxBreak.taxAmount > 0.005
      ? [
          {
            accountCode: taxBreak.purchaseTaxAccountCode || controlAccounts.taxReceivableAccount || "114301",
            debit: taxBreak.taxAmount,
            projectId: input.projectId,
            subProjectId: input.subProjectId ?? null,
            harvestCycleId: input.harvestCycleId ?? null,
            memo: `ضريبة مدخلات مصروف - ${input.subType}`,
          },
        ]
      : []),
    ...(taxBreak.whtAmount > 0.005
      ? [
          {
            accountCode: taxBreak.whtAccountCode || controlAccounts.whtPayableAccount || "214201",
            credit: taxBreak.whtAmount,
            projectId: input.projectId,
            subProjectId: input.subProjectId ?? null,
            harvestCycleId: input.harvestCycleId ?? null,
            memo: `ضريبة استقطاع مصروف - ${input.subType}`,
          },
        ]
      : []),
    {
      ...(creditAccountId
        ? { accountId: creditAccountId }
        : { accountCode: controlAccounts.cashAccount || "111101" }),
      credit: taxBreak.payableAfterWht,
      projectId: input.projectId,
      subProjectId: input.subProjectId ?? null,
      harvestCycleId: input.harvestCycleId ?? null,
      memo: `صرف نقدي - ${input.subType}`,
    },
  ];

  let je = await postJournalEntry({
    tx,
    costCenterId: expProject?.costCenterId ?? null,
    date: expDate,
    reference: `EXP-${input.expenseId.slice(-6).toUpperCase()}`,
    narrationAr: `مصروف تشغيلي (${input.category}): ${input.subType}`,
    narrationEn: `Operating Expense (${input.category})`,
    sourceType: "EXPENSE",
    sourceId: input.expenseId,
    projectId: input.projectId,
    subProjectId: input.subProjectId ?? null,
    createdById: input.createdById,
    skipApprovalCheck: true,
    lines: expLines,
  });

  if (taxBreak.taxAmount > 0 || taxBreak.whtAmount > 0 || input.taxCodeId) {
    await tx.operatingExpense.updateMany({
      where: { id: input.expenseId },
      data: {
        taxCodeId: input.taxCodeId ?? null,
        netAmount: taxBreak.netAmount,
        taxAmount: taxBreak.taxAmount,
        whtAmount: taxBreak.whtAmount,
        totalAmount: taxBreak.grossAmount,
      },
    });
  }

  if (targetTreasury) {
    const trRate = await getExchangeRateToYER(tx, targetTreasury.currency);
    const amountInTrCurr = dDiv(taxBreak.payableAfterWht, trRate, 4);
    await tx.treasuryAccount.update({
      where: { id: targetTreasury.id },
      data: {
        balance: dSub(targetTreasury.balance, amountInTrCurr, 4),
        balanceYER: dSub(targetTreasury.balanceYER, taxBreak.payableAfterWht, 4),
      },
    });
  }

  const approval = await evaluateAndRouteApprovalTx(tx, {
    module: "EXPENSES",
    actionType: "CREATE_AND_POST",
    targetType: "OperatingExpense",
    targetId: input.expenseId,
    documentNumber: `EXP-${input.expenseId.slice(-6).toUpperCase()}`,
    summaryAr: `اعتماد مصروف تشغيلي (${input.category}): ${input.subType}`,
    summaryEn: `Operating Expense (${input.category}): ${input.subType}`,
    amountBase: taxBreak.grossAmount,
    currencyCode: "YER",
    afterSnapshot: { category: input.category, subType: input.subType, totalAmount: taxBreak.grossAmount },
    requestedById: input.createdById,
    skipApprovalCheck: input.skipApprovalCheck,
  });

  if (approval.requiresApproval) {
    je = await tx.journalEntry.update({
      where: { id: je.id },
      data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
      include: { lines: { include: { account: true } }, attachments: true },
    });
  }

  return je;
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
    expenseAccountId?: string | null;
    expenseAccountCode?: string | null;
    customAccount?: CustomAccountInput | null;
    treasuryAccountId?: string | null;
    costCenterId?: string | null;
    skipApprovalCheck?: boolean;
  }
) {
  if (input.totalWage <= 0) return null;

  const controlAccounts = await getControlAccountsTx(tx);
  const expenseAccount = await resolveOrCreatePostingAccountTx(tx, {
    accountId: input.expenseAccountId,
    accountCode: input.expenseAccountCode,
    customAccount: input.customAccount,
    fallbackDefaultCode: controlAccounts.directLaborAccount || controlAccounts.cogsAccount || "511101",
    userId: input.createdById,
  });

  const wageProject = await tx.project.findUnique({ where: { id: input.projectId }, select: { costCenterId: true } });
  const wageWorkerAcc = await tx.account.findUnique({ where: { id: input.workerAccountId }, select: { defaultCostCenterId: true } });
  const wageCostCenterId = input.costCenterId ?? wageProject?.costCenterId ?? wageWorkerAcc?.defaultCostCenterId ?? null;

  let accrual = await postJournalEntry({
    tx,
    costCenterId: wageCostCenterId,
    date: new Date(`${input.date}T10:00:00Z`),
    reference: `WRK-ACC-${input.wageEntryId.slice(-6).toUpperCase()}`,
    narrationAr: `استحقاق أجر العامل ${input.workerName}`,
    narrationEn: `Worker Wage Accrual: ${input.workerName}`,
    sourceType: "WORKER_ACCRUAL",
    sourceId: input.wageEntryId,
    projectId: input.projectId,
    subProjectId: input.subProjectId ?? null,
    createdById: input.createdById,
    skipApprovalCheck: true,
    lines: [
      {
        accountId: expenseAccount.id,
        accountCode: expenseAccount.code,
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
    const payoutTreasury = input.treasuryAccountId
      ? await tx.treasuryAccount.findUnique({ where: { id: input.treasuryAccountId } })
      : (await tx.treasuryAccount.findUnique({ where: { id: "t1" } })) ||
        (await tx.treasuryAccount.findFirst({ where: { isDefaultPayments: true, isActive: true } }));

    await postJournalEntry({
      tx,
      costCenterId: wageCostCenterId,
      date: new Date(`${input.date}T10:05:00Z`),
      reference: `WRK-PAY-${input.wageEntryId.slice(-6).toUpperCase()}`,
      narrationAr: `صرف دفعة للعامل ${input.workerName}`,
      narrationEn: `Worker Wage Payout: ${input.workerName}`,
      sourceType: "WORKER_PAYOUT",
      sourceId: input.wageEntryId,
      projectId: input.projectId,
      subProjectId: input.subProjectId ?? null,
      createdById: input.createdById,
      skipApprovalCheck: true,
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
          ...(payoutTreasury?.accountId
            ? { accountId: payoutTreasury.accountId }
            : { accountCode: controlAccounts.cashAccount || "111101" }),
          credit: input.creditAmount,
          projectId: input.projectId,
          subProjectId: input.subProjectId ?? null,
          harvestCycleId: input.harvestCycleId ?? null,
          memo: `صرف نقدي للعامل ${input.workerName}`,
        },
      ],
    });

    if (payoutTreasury) {
      const trRate = await getExchangeRateToYER(tx, payoutTreasury.currency);
      const amountInTrCurr = dDiv(input.creditAmount, trRate, 4);
      await tx.treasuryAccount.update({
        where: { id: payoutTreasury.id },
        data: {
          balance: dSub(payoutTreasury.balance, amountInTrCurr, 4),
          balanceYER: dSub(payoutTreasury.balanceYER, input.creditAmount, 4),
        },
      });
    }
  }

  const approval = await evaluateAndRouteApprovalTx(tx, {
    module: "WORKERS",
    actionType: "CREATE_AND_POST",
    targetType: "WorkerWageEntry",
    targetId: input.wageEntryId,
    documentNumber: `WRK-${input.wageEntryId.slice(-6).toUpperCase()}`,
    summaryAr: `اعتماد أجر العامل ${input.workerName}`,
    summaryEn: `Worker Wage: ${input.workerName}`,
    amountBase: input.totalWage,
    currencyCode: "YER",
    afterSnapshot: { workerName: input.workerName, totalWage: input.totalWage, creditAmount: input.creditAmount },
    requestedById: input.createdById,
    skipApprovalCheck: input.skipApprovalCheck,
  });

  if (approval.requiresApproval) {
    await tx.journalEntry.updateMany({
      where: { sourceId: input.wageEntryId, status: "POSTED" },
      data: { status: "PENDING_APPROVAL", documentStatus: "PENDING_APPROVAL" },
    });
    accrual = await tx.journalEntry.findUniqueOrThrow({
      where: { id: accrual.id },
      include: { lines: { include: { account: true } }, attachments: true },
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
  generation: number;
  isPostable: boolean;
  subLedgerType: string | null;
  defaultCostCenterId: string | null;
  parentId: string | null;
  directDebit: number;
  directCredit: number;
  rolledUpDebit: number;
  rolledUpCredit: number;
  rolledUpBalance: number;
  // Aliases for full backwards compatibility
  rollupDebit: number;
  rollupCredit: number;
  balance: number; // Natural balance: DR - CR for ASSET/EXPENSE; CR - DR for LIABILITY/EQUITY/REVENUE
  childrenCount: number;
  lineageChain: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    level: number;
  }[];
  children: CoaTreeNode[];
}

/**
 * Standard 6-Generation Hierarchical Chart of Accounts Engine
 * Computes directDebit, directCredit, rolledUpDebit, rolledUpCredit, rolledUpBalance,
 * childrenCount, and lineageChain (ordered array of ancestor accounts from Gen 1 to current node).
 */
export function buildHierarchicalCoaTree(
  accounts: Array<{
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    level: number;
    type: string;
    isPosting: boolean;
    parentId: string | null;
    subLedgerType?: string | null;
    defaultCostCenterId?: string | null;
  }>,
  journalLines: Array<{
    accountId: string;
    debitBase?: number | Prisma.Decimal | null;
    creditBase?: number | Prisma.Decimal | null;
    debit?: number | Prisma.Decimal | null;
    credit?: number | Prisma.Decimal | null;
  }>
): {
  tree: CoaTreeNode[];
  flat: Omit<CoaTreeNode, "children">[];
  nodeMap: Map<string, CoaTreeNode>;
} {
  const totalsByAccount = new Map<string, { dr: number; cr: number }>();
  for (const line of journalLines) {
    const dr = toNum(line.debitBase ?? line.debit ?? 0);
    const cr = toNum(line.creditBase ?? line.credit ?? 0);
    const curr = totalsByAccount.get(line.accountId) || { dr: 0, cr: 0 };
    curr.dr += dr;
    curr.cr += cr;
    totalsByAccount.set(line.accountId, curr);
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
      generation: acc.level,
      isPostable: acc.isPosting,
      subLedgerType: acc.subLedgerType ?? null,
      defaultCostCenterId: acc.defaultCostCenterId ?? null,
      parentId: acc.parentId,
      directDebit: round4(direct.dr),
      directCredit: round4(direct.cr),
      rolledUpDebit: round4(direct.dr),
      rolledUpCredit: round4(direct.cr),
      rolledUpBalance: 0,
      rollupDebit: round4(direct.dr),
      rollupCredit: round4(direct.cr),
      balance: 0,
      childrenCount: 0,
      lineageChain: [],
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

  // Compute lineageChain from Gen 1 down to the node itself
  for (const node of nodeMap.values()) {
    const chain: { id: string; code: string; nameAr: string; nameEn: string; level: number }[] = [];
    let curr: CoaTreeNode | undefined = node;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      chain.unshift({
        id: curr.id,
        code: curr.code,
        nameAr: curr.nameAr,
        nameEn: curr.nameEn,
        level: curr.level,
      });
      curr = curr.parentId ? nodeMap.get(curr.parentId) : undefined;
    }
    node.lineageChain = chain;
  }

  // Recursive post-order rollup calculation
  function computeRollup(node: CoaTreeNode): { dr: number; cr: number } {
    let dr = node.directDebit;
    let cr = node.directCredit;
    for (const child of node.children) {
      const childSum = computeRollup(child);
      dr = round4(dr + childSum.dr);
      cr = round4(cr + childSum.cr);
    }
    node.rolledUpDebit = dr;
    node.rolledUpCredit = cr;
    node.rollupDebit = dr;
    node.rollupCredit = cr;
    node.childrenCount = node.children.length;
    const isDebitNormal = node.type === "ASSET" || node.type === "EXPENSE";
    const bal = round4(isDebitNormal ? dr - cr : cr - dr);
    node.rolledUpBalance = bal;
    node.balance = bal;
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

  return { tree: roots, flat, nodeMap };
}

export async function suggestNextHierarchicalCodeTx(
  tx: Prisma.TransactionClient,
  parent: Account | null,
  level: number,
  type?: string
): Promise<string> {
  void type;
  if (!parent) {
    const roots = await tx.account.findMany({
      where: { level: 1 },
      select: { code: true },
      orderBy: { code: "desc" },
    });
    let highestNum = 0;
    for (const r of roots) {
      const n = parseInt(r.code, 10);
      if (Number.isFinite(n) && n > highestNum) highestNum = n;
    }
    return highestNum > 0 ? String(highestNum + 100000) : "100000";
  }

  const siblings = await tx.account.findMany({
    where: { parentId: parent.id },
    select: { code: true },
    orderBy: { code: "desc" },
  });

  if (level === 6) {
    // Gen 6 sub-leaves: parent.code + 2 digits (e.g., 11110101)
    if (siblings.length === 0) {
      return `${parent.code}01`;
    }
    let maxSuffix = 0;
    for (const s of siblings) {
      if (s.code.startsWith(parent.code)) {
        const suffixStr = s.code.slice(parent.code.length);
        const suffixNum = parseInt(suffixStr, 10);
        if (Number.isFinite(suffixNum) && suffixNum > maxSuffix) {
          maxSuffix = suffixNum;
        }
      }
    }
    const nextSuffix = String(maxSuffix + 1).padStart(2, "0");
    return `${parent.code}${nextSuffix}`;
  }

  if (level === 5) {
    // Gen 5 analytical accounts
    if (siblings.length === 0) {
      if (parent.code.endsWith("00") && parent.code.length === 6) {
        return `${parent.code.slice(0, 4)}01`;
      }
      return `${parent.code}01`;
    }
    let maxVal = 0;
    for (const s of siblings) {
      const val = parseInt(s.code, 10);
      if (Number.isFinite(val) && val > maxVal) {
        maxVal = val;
      }
    }
    return String(maxVal + 1);
  }

  const step = level === 2 ? 10000 : level === 3 ? 1000 : 100;
  if (siblings.length === 0) {
    const pNum = parseInt(parent.code, 10);
    if (Number.isFinite(pNum)) {
      return String(pNum + step);
    }
    return `${parent.code}01`;
  }

  let maxVal = 0;
  for (const s of siblings) {
    const val = parseInt(s.code, 10);
    if (Number.isFinite(val) && val > maxVal) {
      maxVal = val;
    }
  }
  return String(maxVal + step);
}

export interface CreateHierarchicalAccountInput {
  code?: string;
  nameAr: string;
  nameEn?: string;
  type?: AccountType | string;
  level?: 1 | 2 | 3 | 4 | 5 | 6 | number;
  parentId?: string | null;
  parentCode?: string | null;
  isPosting?: boolean;
  tx?: Prisma.TransactionClient;
  userId?: string | null;
}

/**
 * Creates an account across any generation (Gen 1 to Gen 6) following IFRS COA integrity rules:
 * - isPosting = false for summary headers (Gen 1-4, or Gen 5 with Gen 6 children)
 * - isPosting = true for operational posting leaves (Gen 5 leaves or Gen 6 leaves)
 * - Auto-promotes zero-transaction Gen 5 leaves to summary headers if a Gen 6 child is added
 * - Rejects adding children if the parent already holds posted journal lines
 */
export async function createHierarchicalAccount(
  input: CreateHierarchicalAccountInput
): Promise<Account> {
  const run = async (tx: Prisma.TransactionClient): Promise<Account> => {
    const nameAr = input.nameAr?.trim();
    if (!nameAr) {
      throw new Error("ACCOUNT_NAME_REQUIRED: يرجى إدخال اسم الحساب بالعربية");
    }
    const nameEn = input.nameEn?.trim() || nameAr;

    // Resolve parent if provided
    let parent: Account | null = null;
    if (input.parentId) {
      parent = await tx.account.findUnique({ where: { id: input.parentId } });
      if (!parent) {
        throw new Error(`PARENT_ACCOUNT_NOT_FOUND: الحساب الأب المعرف برقم ${input.parentId} غير موجود`);
      }
    } else if (input.parentCode) {
      parent = await tx.account.findUnique({ where: { code: input.parentCode } });
      if (!parent) {
        throw new Error(`PARENT_ACCOUNT_NOT_FOUND: الحساب الأب بالرمز ${input.parentCode} غير موجود`);
      }
    }

    let level: number;
    let type: string;
    let isPosting: boolean;

    if (parent) {
      if (parent.level >= 6) {
        throw new Error(
          "CANNOT_EXCEED_LEVEL_6: لا يمكن إنشاء حساب فرعي دون المستوى السادس (الجيل السادس هو أدنى مستوى تشغيلي في النظام)"
        );
      }
      level = parent.level + 1;
      if (input.level && input.level !== level) {
        throw new Error(
          `INVALID_LEVEL_DEPTH: مستوى الحساب (${input.level}) غير مطابق للعمق الهيكلي للحساب الأب (${parent.level}). يجب أن يكون المستوى ${level}`
        );
      }
      type = (input.type as string) || parent.type;

      // IFRS COA integrity check:
      // If parent was a posting leaf, check if it has existing journal entries
      if (parent.isPosting) {
        const txCount = await tx.journalEntryLine.count({
          where: { accountId: parent.id },
        });
        if (txCount > 0) {
          throw new Error(
            `PARENT_HAS_TRANSACTIONS: لا يمكن تفريع الحساب '${parent.code} - ${parent.nameAr}' (المستوى ${parent.level}) لوجود ${txCount} قيد/حركات يومية مسجلة عليه مباشرة. يرجى نقل أو إعادة تبويب القيود إلى حساب فرعي قبل التفريع لضمان سلامة القيود المزدوجة.`
          );
        }
        // Auto-promote parent from posting leaf to summary header
        await tx.account.update({
          where: { id: parent.id },
          data: { isPosting: false, isPostable: false },
        });
      }

      // Determine posting eligibility:
      // Gen 1-4 are headers (false)
      // Gen 5 is leaf by default (true), unless caller specifies isPosting = false
      // Gen 6 is always posting leaf (true)
      if (level <= 4) {
        isPosting = false;
      } else if (level === 5) {
        isPosting = input.isPosting !== undefined ? input.isPosting : true;
      } else {
        // level === 6
        isPosting = true;
      }
    } else {
      // Root Generation 1 (Main Class)
      level = 1;
      if (input.level && input.level !== 1) {
        throw new Error("ROOT_MUST_BE_LEVEL_1: الحساب الرئيسي الذي ليس له أب يجب أن يكون من الجيل الأول (Level 1)");
      }
      if (!input.type) {
        throw new Error(
          "ACCOUNT_TYPE_REQUIRED: يجب تحديد نوع الحساب (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE) للحساب الرئيسي"
        );
      }
      type = input.type;
      isPosting = false; // Gen 1 is never a posting leaf
    }

    // Determine code
    let finalCode = input.code?.trim();
    if (!finalCode) {
      finalCode = await suggestNextHierarchicalCodeTx(tx, parent, level, type);
    }

    const duplicate = await tx.account.findUnique({ where: { code: finalCode } });
    if (duplicate) {
      throw new Error(`DUPLICATE_ACCOUNT_CODE: رمز الحساب '${finalCode}' مستخدم مسبقاً (${duplicate.nameAr})`);
    }

    const created = await tx.account.create({
      data: {
        code: finalCode,
        nameAr,
        nameEn,
        level,
        type,
        isPosting,
        parentCode: parent ? parent.code : input.parentCode ?? null,
        parentId: parent ? parent.id : null,
        ...deriveGenFields(level, isPosting, parent ? parent.id : null),
      },
    });

    if (input.userId) {
      await recordAuditDiffTx(tx, {
        userId: input.userId,
        action: "CREATE",
        entity: "Account",
        entityId: created.id,
        before: null,
        after: {
          code: created.code,
          nameAr: created.nameAr,
          level: created.level,
          type: created.type,
          isPosting: created.isPosting,
          parentId: created.parentId,
        },
      });
    }

    return created;
  };

  if (input.tx) {
    return run(input.tx);
  }
  return prisma.$transaction(run);
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

  const lines = grouped.map((g) => ({
    accountId: g.accountId,
    debitBase: g._sum.debitBase,
    creditBase: g._sum.creditBase,
  }));

  const { tree, flat } = buildHierarchicalCoaTree(accounts, lines);
  return { tree, flat };
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
    ...(filters.costCenterId && filters.costCenterId !== "ALL" ? { costCenterId: filters.costCenterId } : {}),
    journalEntry: {
      status: "POSTED",
      documentStatus: "POSTED",
      ...(!filters.includeYearEndClosing ? { entryType: { not: "YEAR_END_CLOSING" } } : {}),
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
  const maxLevel = filters.maxLevel && filters.maxLevel >= 1 && filters.maxLevel <= 6 ? filters.maxLevel : 6;

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
    const budget = round4(toNum(proj.budgetTotal) || toNum(proj.estimatedValue));
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

  // Balance Sheet: cumulative up to toDate (ignores fromDate), anchored at latest YEAR_END_ROLLOVER OPENING entry <= toDate
  let asOfEnd: Date | undefined;
  if (filters.toDate) {
    asOfEnd = new Date(filters.toDate);
    if (typeof filters.toDate === "string" && filters.toDate.length <= 10) {
      asOfEnd.setUTCHours(23, 59, 59, 999);
    }
  }
  const latestOpeningEntry = await prisma.journalEntry.findFirst({
    where: {
      status: "POSTED",
      documentStatus: "POSTED",
      entryType: "OPENING",
      ...(asOfEnd ? { date: { lte: asOfEnd } } : {}),
    },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  const bsFromDate = latestOpeningEntry?.date ?? undefined;
  const sameAsReportRange =
    !filters.fromDate &&
    ((!bsFromDate && !filters.fromDate) ||
      (bsFromDate && filters.fromDate && new Date(filters.fromDate).getTime() === bsFromDate.getTime()));
  const bsFlat = sameAsReportRange
    ? flat
    : (
        await getCoaTreeWithBalances({
          ...filters,
          fromDate: bsFromDate,
          includeYearEndClosing: false,
        })
      ).flat;
  const bsPostingRows = bsFlat.filter((n) => n.isPosting);
  const bsRevenue = round4(
    bsPostingRows
      .filter((n) => n.type === "REVENUE")
      .reduce((s, a) => dAdd(s, a.balance), 0)
  );
  const bsExpenses = round4(
    bsPostingRows
      .filter((n) => n.type === "EXPENSE")
      .reduce((s, a) => dAdd(s, a.balance), 0)
  );
  const bsNetProfit = round4(dSub(bsRevenue, bsExpenses));

  const assetAccounts = bsPostingRows.filter((n) => n.type === "ASSET" && Math.abs(n.balance) > 0.0001);
  const liabilityAccounts = bsPostingRows.filter((n) => n.type === "LIABILITY" && Math.abs(n.balance) > 0.0001);
  const equityAccounts = bsPostingRows.filter((n) => n.type === "EQUITY" && Math.abs(n.balance) > 0.0001);

  const totalAssets = round4(assetAccounts.reduce((s, a) => dAdd(s, a.balance), 0));
  const totalLiabilities = round4(liabilityAccounts.reduce((s, a) => dAdd(s, a.balance), 0));
  const contributedEquity = round4(equityAccounts.reduce((s, a) => dAdd(s, a.balance), 0));
  const totalEquity = round4(dAdd(contributedEquity, bsNetProfit));
  const liabilitiesPlusEquity = round4(dAdd(totalLiabilities, totalEquity));
  const isBalanceSheetBalanced = Math.abs(dSub(totalAssets, liabilitiesPlusEquity)) <= 0.005;

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
      currentYearNetProfit: bsNetProfit,
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
  costCenterId?: string | null;
  createdById?: string;
  gatewayProvider?: string;
  gatewayMerchantId?: string;
  gatewayEndpointUrl?: string;
  gatewayCredentialsEnc?: string;
  isSandbox?: boolean;
  linkedPaymentReceiptId?: string | null;
  tenantSlug?: string | null;
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

    const treasuryId = crypto.randomUUID();
    const parentControlCode = type === "VAULT" ? "111190" : "111290";
    const prov = await provisionEntityGen6AccountAndCostCenter(
      {
        entityType: "TREASURY",
        entityId: treasuryId,
        nameAr,
        nameEn,
        parentControlCode,
        costCenterId: input.costCenterId ?? null,
      },
      tx
    );
    const accountId = prov.account.id;

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
        id: treasuryId,
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
        gatewayProvider: input.gatewayProvider?.trim() || "MANUAL",
        gatewayMerchantId: input.gatewayMerchantId?.trim() || null,
        gatewayEndpointUrl: input.gatewayEndpointUrl?.trim() || null,
        gatewayCredentialsEnc: input.gatewayCredentialsEnc?.trim() || null,
        isSandbox: input.isSandbox !== undefined ? Boolean(input.isSandbox) : true,
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
            accountCode: (await getControlAccountsTx(tx)).capitalAccount || "311101",
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
  gatewayProvider?: string;
  gatewayMerchantId?: string;
  gatewayEndpointUrl?: string;
  gatewayCredentialsEnc?: string;
  isSandbox?: boolean;
  linkedPaymentReceiptId?: string | null;
  tenantSlug?: string | null;
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
        ...(input.gatewayProvider !== undefined ? { gatewayProvider: input.gatewayProvider.trim() } : {}),
        ...(input.gatewayMerchantId !== undefined ? { gatewayMerchantId: input.gatewayMerchantId.trim() || null } : {}),
        ...(input.gatewayEndpointUrl !== undefined ? { gatewayEndpointUrl: input.gatewayEndpointUrl.trim() || null } : {}),
        ...(input.gatewayCredentialsEnc !== undefined ? { gatewayCredentialsEnc: input.gatewayCredentialsEnc.trim() || null } : {}),
        ...(input.isSandbox !== undefined ? { isSandbox: Boolean(input.isSandbox) } : {}),
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

    const fromFeePct = toNum(from.transferFeePercent);
    const feeInFromCurr =
      input.feeAmount !== undefined
        ? Math.max(0, round4(Number(input.feeAmount) || 0))
        : input.applyDefaultFee && fromFeePct > 0
          ? round4(dMul(amount, fromFeePct) / 100)
          : 0;

    const transferYER = round4(dMul(amount, fromRate));
    const feeYER = round4(dMul(feeInFromCurr, fromRate));
    const totalOutFrom = round4(dAdd(amount, feeInFromCurr));
    const totalOutYER = round4(dAdd(transferYER, feeYER));
    const creditedToAmount = round4(dDiv(transferYER, toRate));
    // Use effective rate on destination FX leg so DebitBase === transferYER without rounding drift
    const toEffectiveRate = creditedToAmount > 0 ? transferYER / creditedToAmount : toRate;

    await tx.treasuryAccount.update({
      where: { id: from.id },
      data: {
        balance: round4(dSub(toNum(from.balance), totalOutFrom)),
        balanceYER: round4(dSub(toNum(from.balanceYER), totalOutYER)),
      },
    });

    await tx.treasuryAccount.update({
      where: { id: to.id },
      data: {
        balance: round4(dAdd(toNum(to.balance), creditedToAmount)),
        balanceYER: round4(dAdd(toNum(to.balanceYER), transferYER)),
      },
    });

    const controlAccounts = await getControlAccountsTx(tx);
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
            accountCode: controlAccounts.bankFeeAccount || "531201",
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
      balanceYER: toNum(treasury.balanceYER),
      glBookBalanceYER,
      varianceYER: round4(dSub(toNum(treasury.balanceYER), glBookBalanceYER)),
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
  subProjectId?: string | null;
  acquisitionCycleId: string;
  vendorId?: string;
  amount?: number;
  currency?: string;
  date?: Date | string;
  dueDate?: Date | string | null;
  capitalizeAsset?: boolean;
  debitAccountId?: string | null;
  debitAccountCode?: string | null;
  customAccount?: CustomAccountInput | null;
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
        subProjectId: input.subProjectId ?? null,
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

    const defaultDebitCode = input.capitalizeAsset ? "121101" : "512101";

    const { bill, journalEntry } = await postVendorBill({
      tx,
      vendorId,
      projectId: project.id,
      subProjectId: input.subProjectId ?? null,
      purchaseOrderId: po.id,
      acquisitionCycleId: cycle.id,
      totalAmount: amount,
      currency,
      date: input.date || new Date(),
      dueDate: input.dueDate ?? cycle.endDate,
      debitAccountId: input.debitAccountId,
      debitAccountCode: input.debitAccountCode || defaultDebitCode,
      customAccount: input.customAccount,
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
    if (existing.status === "VOIDED" || existing.documentStatus === "VOIDED") {
      throw new Error("JOURNAL_ALREADY_VOIDED");
    }

    const isPosted =
      existing.status === "POSTED" ||
      (existing.status !== "DRAFT" &&
        existing.status !== "RETURNED_FOR_EDIT" &&
        existing.documentStatus === "POSTED");
    const nextDate = input.date ? new Date(input.date) : existing.date;
    const dateActuallyChanged =
      input.date !== undefined &&
      nextDate.toISOString().slice(0, 10) !== existing.date.toISOString().slice(0, 10);

    if (isPosted) {
      if (input.lines !== undefined) {
        throw new Error(
          "POSTED_JOURNAL_IMMUTABLE: Cannot modify lines, accounts, or amounts of a POSTED journal entry in-place. Reverse the entry or use a controlled amendment."
        );
      }
      if (dateActuallyChanged) {
        throw new Error(
          "POSTED_JOURNAL_IMMUTABLE: Cannot modify the posting date of a POSTED journal entry in-place. Reverse and re-post instead."
        );
      }
    }

    if (!input.allowLockedAdjustment) {
      const settingsRow = await tx.systemSettings.findUnique({ where: { id: "default" } });
      const settings = parseAccountingSettings(settingsRow);
      const existingLockCheck = assertNotInLockedPeriod(existing.date, settings.periodLockDate);
      if (!existingLockCheck.ok) {
        throw new Error(existingLockCheck.error || "PERIOD_LOCKED");
      }
      const nextLockCheck = assertNotInLockedPeriod(nextDate, settings.periodLockDate);
      if (!nextLockCheck.ok) {
        throw new Error(nextLockCheck.error || "PERIOD_LOCKED");
      }

      await assertDateNotInClosedFiscalYear(tx, existing.date);
      if (dateActuallyChanged) {
        await assertDateNotInClosedFiscalYear(tx, nextDate);
      }

      for (const oldLine of existing.lines) {
        if (oldLine.harvestCycleId) {
          const cycle = await tx.harvestCycle.findUnique({ where: { id: oldLine.harvestCycleId } });
          if (cycle?.isLocked) {
            throw new Error(`HARVEST_LOCKED: Cycle "${cycle.name}" is locked for direct edits.`);
          }
        }
      }
    }

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
        currencyCode: string;
        exchangeRate: number;
        foreignDebit: number;
        foreignCredit: number;
        debitBase: number;
        creditBase: number;
        baseDebit: number;
        baseCredit: number;
        memo: string;
        projectId: string | null;
        subProjectId: string | null;
        harvestCycleId: string | null;
        costCenterId: string | null;
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

        const resolvedCostCenterId = resolveLineCostCenter({
          line: line.costCenterId,
          entry: existing.lines.find((l) => l.costCenterId)?.costCenterId ?? null,
          accountDefault: account.defaultCostCenterId,
        });

        preparedLines.push({
          accountId: account.id,
          debit,
          credit,
          currency,
          currencyCode: currency,
          exchangeRate: rate,
          foreignDebit: debit,
          foreignCredit: credit,
          debitBase,
          creditBase,
          baseDebit: debitBase,
          baseCredit: creditBase,
          memo: line.memo || nextNarrationAr,
          projectId: line.projectId !== undefined ? line.projectId : nextProjectId,
          subProjectId: line.subProjectId !== undefined ? line.subProjectId : nextSubProjectId,
          harvestCycleId: line.harvestCycleId ?? null,
          costCenterId: resolvedCostCenterId ?? null,
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
        lines: existing.lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          debitBase: Number(l.debitBase),
          creditBase: Number(l.creditBase),
          currency: l.currency,
          costCenterId: l.costCenterId,
        })),
      },
      after: {
        date: updated.date.toISOString(),
        reference: updated.reference,
        narrationAr: updated.narrationAr,
        lines: updated.lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          debitBase: Number(l.debitBase),
          creditBase: Number(l.creditBase),
          currency: l.currency,
          costCenterId: l.costCenterId,
        })),
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
  expenseAccountId?: string;
  expenseAccountCode?: string;
  customAccount?: CustomAccountInput;
  treasuryAccountId?: string;
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
    const nextQty = input.quantity !== undefined ? Number(input.quantity) : toNum(existing.quantity);
    const nextUnitPrice =
      input.unitPrice !== undefined ? Number(input.unitPrice) : toNum(existing.unitPrice);
    const nextTotal = computeOperatingExpenseTotal(nextQty, nextUnitPrice);
    const nextDate = input.date?.trim() || existing.expenseDate;
    const nextNotes = input.notes !== undefined ? input.notes.trim() : existing.notes;

    const directionChanged = Boolean(
      input.expenseAccountId ||
      input.expenseAccountCode ||
      input.customAccount ||
      input.treasuryAccountId
    );

    const financialChanged =
      Math.abs(nextTotal - toNum(existing.totalAmount)) > 0.005 ||
      nextCategory !== existing.category ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCycle?.id !== existing.harvestCycleId ||
      nextDate !== existing.expenseDate ||
      directionChanged;

    let nextJournalEntryId = existing.journalEntryId;
    if (financialChanged) {
      if (existing.journalEntryId) {
        const oldJe = await tx.journalEntry.findUnique({
          where: { id: existing.journalEntryId },
          include: { lines: true },
        });
        if (oldJe && oldJe.status !== "VOIDED" && !oldJe.isReversed) {
          for (const line of oldJe.lines) {
            const crBase = toNum(line.baseCredit) || toNum(line.creditBase) || toNum(line.credit);
            if (crBase > 0.005) {
              const tr = await tx.treasuryAccount.findUnique({ where: { accountId: line.accountId } });
              if (tr) {
                const trRate = await getExchangeRateToYER(tx, tr.currency);
                await tx.treasuryAccount.update({
                  where: { id: tr.id },
                  data: {
                    balance: round4(dAdd(toNum(tr.balance), dDiv(crBase, trRate))),
                    balanceYER: round4(dAdd(toNum(tr.balanceYER), crBase)),
                  },
                });
              }
            }
          }
          await reverseJournalEntry({
            tx,
            journalEntryId: existing.journalEntryId,
            createdById: input.createdById,
            reason: `تعديل مصروف تشغيلي (${existing.subType})`,
          });
        }
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
        expenseAccountId: input.expenseAccountId,
        expenseAccountCode: input.expenseAccountCode,
        customAccount: input.customAccount,
        treasuryAccountId: input.treasuryAccountId,
        createdById: input.createdById,
      });
      nextJournalEntryId = je?.id ?? null;
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
  expenseAccountId?: string | null;
  expenseAccountCode?: string | null;
  customAccount?: CustomAccountInput | null;
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
      input.dailyWage !== undefined ? Number(input.dailyWage) : toNum(existing.dailyWage);
    const nextDays =
      input.daysWorked !== undefined ? Number(input.daysWorked) : toNum(existing.daysWorked);
    const nextCredit =
      input.creditAmount !== undefined ? Number(input.creditAmount) : toNum(existing.creditAmount);
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
      Math.abs(nextTotal - toNum(existing.totalWage)) > 0.005 ||
      Math.abs(nextCredit - toNum(existing.creditAmount)) > 0.005 ||
      nextName !== existing.workerName ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCycle?.id !== existing.harvestCycleId ||
      nextDate !== existing.workDate;

    let nextJournalEntryId = existing.journalEntryId;
    if (financialChanged) {
      const linkedEntries = await tx.journalEntry.findMany({
        where: { sourceId: existing.id, status: { not: "VOIDED" }, isReversed: false },
        include: { lines: true },
      });
      for (const je of linkedEntries) {
        if (je.sourceType === "WORKER_PAYOUT") {
          for (const line of je.lines) {
            const crBase = toNum(line.baseCredit) || toNum(line.creditBase) || toNum(line.credit);
            if (crBase > 0.005) {
              const tr = await tx.treasuryAccount.findUnique({ where: { accountId: line.accountId } });
              if (tr) {
                const trRate = await getExchangeRateToYER(tx, tr.currency);
                await tx.treasuryAccount.update({
                  where: { id: tr.id },
                  data: {
                    balance: round4(dAdd(toNum(tr.balance), dDiv(crBase, trRate))),
                    balanceYER: round4(dAdd(toNum(tr.balanceYER), crBase)),
                  },
                });
              }
            }
          }
        }
        await reverseJournalEntry({
          tx,
          journalEntryId: je.id,
          createdById: input.createdById,
          reason: `تعديل سجل أجر العامل (${existing.workerName})`,
        });
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
          expenseAccountId: input.expenseAccountId,
          expenseAccountCode: input.expenseAccountCode,
          customAccount: input.customAccount,
          createdById: input.createdById,
        });
        nextJournalEntryId = newAccrual?.id ?? null;
      }
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
  sequenceNumber?: string;
  dailyBatchLabel?: string;
  salesOfficerId?: string;
  salesOfficerTitle?: string;
  revenueAccountCode?: string;
  treasuryAccountId?: string;
  createdById?: string;
  allowNegativeStock?: boolean;
  actorRole?: string;
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
    const nextPrice = input.price !== undefined ? Number(input.price) : toNum(existing.unitPrice);
    const nextCredit = input.credit !== undefined ? Number(input.credit) : toNum(existing.creditPaid);
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
    const nextSeqNo = input.sequenceNumber?.trim() || existing.sequenceNumber;
    const nextDailyLabel = input.dailyBatchLabel?.trim() || existing.dailyBatchLabel || nextBatch;
    const nextOfficerId = input.salesOfficerId?.trim() || existing.salesOfficerId;
    const nextOfficerTitle = input.salesOfficerTitle?.trim() || existing.salesOfficerTitle;
    const nextRevenueCode = input.revenueAccountCode?.trim() || existing.revenueAccountCode;
    const nextTreasuryId = input.treasuryAccountId?.trim() || existing.treasuryAccountId || "t1";

    if (nextBundles > 0) {
      const { validateHarvestStockForSaleTx } = await import("@/lib/harvestStockGuard");
      await validateHarvestStockForSaleTx(tx, {
        projectId: nextProjectId,
        subProjectId: nextSubProjectId,
        harvestName: nextHarvest,
        productGrade: nextGrade,
        requestedBundles: nextBundles,
        excludeSaleId: existing.id,
        allowNegativeStock: input.allowNegativeStock,
        actorRole: input.actorRole,
      });
    }

    const customer = await ensureCustomerWithAccountTx(tx, {
      name: nextCustomerName,
      phone: nextPhone,
    });

    const financialChanged =
      Math.abs(nextTotal - toNum(existing.totalAmount)) > 0.005 ||
      Math.abs(nextCredit - toNum(existing.creditPaid)) > 0.005 ||
      nextCustomerName !== existing.customerName ||
      nextProjectId !== existing.projectId ||
      nextSubProjectId !== existing.subProjectId ||
      nextCycle?.id !== existing.harvestCycleId ||
      nextDate !== existing.saleDate;

    let nextJournalEntryId = existing.journalEntryId;
    if (financialChanged) {
      if (existing.journalEntryId) {
        const oldJe = await tx.journalEntry.findUnique({
          where: { id: existing.journalEntryId },
          select: { status: true, isReversed: true },
        });
        if (oldJe && oldJe.status !== "VOIDED" && !oldJe.isReversed) {
          await reverseJournalEntry({
            tx,
            journalEntryId: existing.journalEntryId,
            createdById: input.createdById,
            reason: `تعديل عملية بيع (${existing.customerName})`,
          });
        }
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
          sequenceNumber: nextSeqNo,
          dailyBatchLabel: nextDailyLabel,
          salesOfficerId: nextOfficerId,
          salesOfficerTitle: nextOfficerTitle,
          revenueAccountCode: nextRevenueCode,
          treasuryAccountId: nextTreasuryId,
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
            treasuryId: nextTreasuryId,
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
    }

    const updated = await tx.saleTransaction.update({
      where: { id: existing.id },
      data: {
        sequenceNumber: nextSeqNo,
        dailyBatchLabel: nextDailyLabel,
        salesOfficerId: nextOfficerId,
        salesOfficerTitle: nextOfficerTitle,
        revenueAccountCode: nextRevenueCode,
        treasuryAccountId: nextTreasuryId,
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


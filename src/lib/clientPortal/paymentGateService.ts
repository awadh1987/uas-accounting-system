import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensure6GenerationCoaHierarchy } from "@/lib/accountingCoreEngine";
import { ensureCustomerWithAccountTx, postCustomerReceipt } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { createWhatsAppDraftTx } from "@/lib/whatsapp/outboxService";
import { emitNotification } from "@/lib/notifications/notificationService";
import { getClientPortalFinancialSnapshot } from "@/lib/clientPortal/portalService";
import { syncGlobalClientMembershipStatus } from "@/lib/clientPortal/globalClientService";
import {
  readClientPaymentReceiptFile,
  saveClientPaymentReceiptFile,
  validateReceiptUpload,
  decodeReceiptDataUrl,
} from "@/lib/clientPortal/receiptStorage";
import { dAdd, round4Decimal as round4 } from "@/lib/decimalMath";
import {
  formatIsoToDmy,
  formatIsoToDmyTime,
  formatIsoToTimeHm,
  parseDmyOrIsoToIso,
  resolveExportSignature,
} from "@/lib/uiFormatters";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";

export type PaymentChannelCategory = "WALLET" | "BANK" | "CASH_DEPOSIT";

export const PAYMENT_CHANNEL_CATEGORY_LABELS: Record<PaymentChannelCategory, string> = {
  WALLET: "محفظة إلكترونية",
  BANK: "تحويل بنكي",
  CASH_DEPOSIT: "إيداع نقدي / مباشر",
};

export const PAYMENT_RECEIPT_STATUS_LABELS: Record<string, string> = {
  PENDING_VERIFICATION: "قيد المراجعة",
  APPROVED: "معتمد ومرحل",
  RETURNED_FOR_CLARIFICATION: "معاد للتوضيح",
  REJECTED: "مرفوض",
};

export const PAYMENT_CHANNEL_PROVIDER_PRESETS: Array<{
  code: string;
  category: PaymentChannelCategory;
  labelAr: string;
  labelEn: string;
}> = [
  { code: "JAWALI", category: "WALLET", labelAr: "محفظة جوالي (Jawali)", labelEn: "Jawali Wallet" },
  { code: "KURAIMI_JAWAL", category: "WALLET", labelAr: "كريمي جوال (Kuraimi Jawal)", labelEn: "Kuraimi Jawal" },
  { code: "ONE_CASH", category: "WALLET", labelAr: "ون كاش (ONE Cash)", labelEn: "ONE Cash" },
  { code: "FLOOSAK", category: "WALLET", labelAr: "فلوسك (Floosak)", labelEn: "Floosak" },
  { code: "CASH", category: "WALLET", labelAr: "محفظة كاش (Cash)", labelEn: "Cash Wallet" },
  { code: "MOBILE_MONEY", category: "WALLET", labelAr: "موبايل موني (Mobile Money)", labelEn: "Mobile Money" },
  { code: "KURAIMI_BANK", category: "BANK", labelAr: "بنك الكريمي (Al-Kuraimi)", labelEn: "Al-Kuraimi Bank" },
  { code: "TADHAMON", category: "BANK", labelAr: "بنك التضامن (Tadhamon)", labelEn: "Tadhamon Bank" },
  { code: "CAC_BANK", category: "BANK", labelAr: "كاك بنك (CAC Bank)", labelEn: "CAC Bank" },
  { code: "SABA_ISLAMIC", category: "BANK", labelAr: "بنك سبأ الإسلامي", labelEn: "Saba Islamic Bank" },
  { code: "BRANCH_DEPOSIT", category: "CASH_DEPOSIT", labelAr: "إيداع نقدي في الفرع / الصندوق", labelEn: "Branch Cash Deposit" },
  { code: "CUSTOM", category: "WALLET", labelAr: "قناة مخصصة", labelEn: "Custom Channel" },
];

export interface PaymentAuditEntry {
  action: string;
  labelAr: string;
  actorName: string;
  actorRole: string;
  dateDmy: string;
  timeHm: string;
  timestampDisplay: string;
  note?: string | null;
}

export function normalizeTransferReference(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/[\s\-_/]+/g, "")
    .toUpperCase();
}

export function parseTransferDateTime(
  rawDate?: string | null,
  rawTime?: string | null
): { transferAt: Date; transferDateDmy: string; transferTimeHm: string } {
  const now = new Date();
  const isoDate = parseDmyOrIsoToIso(rawDate) || now.toISOString().slice(0, 10);
  let hhmm = String(rawTime || "").trim();
  if (!hhmm) {
    hhmm = formatIsoToTimeHm(now) || "12:00";
  } else {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!m) {
      throw new Error("صيغة وقت التحويل غير صحيحة (المطلوب HH:mm مثل 14:30)");
    }
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      throw new Error("وقت التحويل غير صالح (00:00 - 23:59)");
    }
    hhmm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  const dt = new Date(`${isoDate}T${hhmm}:00.000Z`);
  if (Number.isNaN(dt.getTime())) {
    throw new Error("تاريخ التحويل غير صالح");
  }
  return {
    transferAt: dt,
    transferDateDmy: formatIsoToDmy(dt),
    transferTimeHm: hhmm,
  };
}

function buildAuditEntry(
  action: string,
  labelAr: string,
  actorName: string,
  actorRole: string,
  note?: string | null,
  at = new Date()
): PaymentAuditEntry {
  return {
    action,
    labelAr,
    actorName,
    actorRole,
    dateDmy: formatIsoToDmy(at),
    timeHm: formatIsoToTimeHm(at),
    timestampDisplay: formatIsoToDmyTime(at),
    note: note ?? null,
  };
}

function sanitizeChannelQrUrl(raw?: string | null): string | null {
  const clean = String(raw || "").trim();
  if (!clean) return null;
  if (
    clean.startsWith("data:image/png;base64,") ||
    clean.startsWith("data:image/jpeg;base64,") ||
    clean.startsWith("data:image/jpg;base64,") ||
    clean.startsWith("data:image/webp;base64,") ||
    clean.startsWith("https://") ||
    clean.startsWith("/")
  ) {
    return clean;
  }
  throw new Error("رابط صورة QR غير صالح");
}

export async function listTenantPaymentChannels(params: {
  tenantSlug: string;
  activeOnly?: boolean;
}) {
  const channels = await prisma.tenantPaymentChannel.findMany({
    where: {
      tenantSlug: params.tenantSlug,
      ...(params.activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });

  const treasuryIds = Array.from(new Set(channels.map((c) => c.treasuryAccountId)));
  const treasuries = treasuryIds.length
    ? await prisma.treasuryAccount.findMany({
        where: { id: { in: treasuryIds } },
        include: { account: { select: { id: true, code: true, nameAr: true, nameEn: true } } },
      })
    : [];
  const trMap = new Map(treasuries.map((t) => [t.id, t]));

  return channels.map((c) => {
    const tr = trMap.get(c.treasuryAccountId);
    return {
      id: c.id,
      tenantSlug: c.tenantSlug,
      category: c.category as PaymentChannelCategory,
      categoryLabelAr:
        PAYMENT_CHANNEL_CATEGORY_LABELS[c.category as PaymentChannelCategory] || c.category,
      providerCode: c.providerCode,
      displayNameAr: c.displayNameAr,
      displayNameEn: c.displayNameEn,
      currency: c.currency,
      accountOrWalletNumber: c.accountOrWalletNumber,
      beneficiaryName: c.beneficiaryName,
      ibanOrBranch: c.ibanOrBranch,
      qrImageUrl: c.qrImageUrl,
      instructionsAr: c.instructionsAr,
      treasuryAccountId: c.treasuryAccountId,
      glAccountId: c.glAccountId || tr?.accountId || null,
      glAccountCode: tr?.account?.code || null,
      glAccountNameAr: tr?.account?.nameAr || null,
      treasuryNameAr: tr?.nameAr || null,
      displayOrder: c.displayOrder,
      isActive: c.isActive,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  });
}

export async function saveTenantPaymentChannel(params: {
  id?: string | null;
  tenantSlug: string;
  category: PaymentChannelCategory;
  providerCode?: string;
  displayNameAr: string;
  displayNameEn?: string | null;
  currency?: string;
  accountOrWalletNumber: string;
  beneficiaryName: string;
  ibanOrBranch?: string | null;
  qrImageUrl?: string | null;
  instructionsAr?: string | null;
  treasuryAccountId: string;
  displayOrder?: number;
  isActive?: boolean;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const categoryRaw = String(params.category || "").trim().toUpperCase();
  if (categoryRaw !== "WALLET" && categoryRaw !== "BANK" && categoryRaw !== "CASH_DEPOSIT") {
    throw new Error("فئة قناة الدفع غير صالحة (WALLET | BANK | CASH_DEPOSIT)");
  }
  const displayNameAr = String(params.displayNameAr || "").trim();
  if (!displayNameAr) throw new Error("يرجى إدخال اسم القناة / المحفظة / البنك");
  const accountOrWalletNumber = String(params.accountOrWalletNumber || "").trim();
  if (!accountOrWalletNumber) throw new Error("يرجى إدخال رقم الحساب أو المحفظة أو الصندوق");
  const beneficiaryName = String(params.beneficiaryName || "").trim();
  if (!beneficiaryName) throw new Error("يرجى إدخال اسم المستفيد");
  const treasuryAccountId = String(params.treasuryAccountId || "").trim();
  if (!treasuryAccountId) throw new Error("يرجى ربط القناة بحساب خزينة / بنك محاسبي");

  const treasury = await prisma.treasuryAccount.findUnique({
    where: { id: treasuryAccountId },
    include: { account: { select: { id: true, code: true, nameAr: true } } },
  });
  if (!treasury || !treasury.isActive) {
    throw new Error("حساب الخزينة / البنك المختار غير موجود أو غير نشط");
  }

  const qrImageUrl = sanitizeChannelQrUrl(params.qrImageUrl);
  const currency = String(params.currency || treasury.currency || "YER").trim().toUpperCase();
  const providerCode = String(params.providerCode || "CUSTOM").trim().toUpperCase();
  const displayOrder = Math.max(1, Number(params.displayOrder) || 1);

  const saved = await prisma.$transaction(async (tx) => {
    const record = params.id
      ? await tx.tenantPaymentChannel.update({
          where: { id: params.id },
          data: {
            category: categoryRaw,
            providerCode,
            displayNameAr,
            displayNameEn: params.displayNameEn?.trim() || null,
            currency,
            accountOrWalletNumber,
            beneficiaryName,
            ibanOrBranch: params.ibanOrBranch?.trim() || null,
            qrImageUrl,
            instructionsAr: params.instructionsAr?.trim() || null,
            treasuryAccountId: treasury.id,
            glAccountId: treasury.accountId,
            displayOrder,
            ...(params.isActive !== undefined ? { isActive: Boolean(params.isActive) } : {}),
          },
        })
      : await tx.tenantPaymentChannel.create({
          data: {
            tenantSlug: params.tenantSlug,
            category: categoryRaw,
            providerCode,
            displayNameAr,
            displayNameEn: params.displayNameEn?.trim() || null,
            currency,
            accountOrWalletNumber,
            beneficiaryName,
            ibanOrBranch: params.ibanOrBranch?.trim() || null,
            qrImageUrl,
            instructionsAr: params.instructionsAr?.trim() || null,
            treasuryAccountId: treasury.id,
            glAccountId: treasury.accountId,
            displayOrder,
            isActive: params.isActive !== undefined ? Boolean(params.isActive) : true,
            createdById: params.actor.userId ?? null,
            createdByName: params.actor.userDisplay,
          },
        });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: params.id ? "PAYMENT_CHANNEL_UPDATED" : "PAYMENT_CHANNEL_CREATED",
      entityReference: record.id,
      details: `[tenant:${params.tenantSlug}] ${params.id ? "تحديث" : "إضافة"} قناة استلام سداد: ${displayNameAr} (${categoryRaw}) — الحساب: ${accountOrWalletNumber} -> GL ${treasury.account.code}`,
    });

    return record;
  });

  return {
    ...saved,
    categoryLabelAr: PAYMENT_CHANNEL_CATEGORY_LABELS[saved.category as PaymentChannelCategory] || saved.category,
    glAccountCode: treasury.account.code,
    glAccountNameAr: treasury.account.nameAr,
    treasuryNameAr: treasury.nameAr,
    createdAt: saved.createdAt.toISOString(),
    updatedAt: saved.updatedAt.toISOString(),
  };
}

export async function deleteOrTogglePaymentChannel(params: {
  tenantSlug: string;
  id: string;
  isActive?: boolean;
  remove?: boolean;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const existing = await prisma.tenantPaymentChannel.findUnique({ where: { id: params.id } });
  if (!existing || existing.tenantSlug !== params.tenantSlug) {
    throw new Error("قناة السداد غير موجودة في هذه المنشأة");
  }

  if (params.remove) {
    const linkedCount = await prisma.clientPaymentReceipt.count({
      where: { channelId: existing.id },
    });
    if (linkedCount > 0) {
      const deactivated = await prisma.tenantPaymentChannel.update({
        where: { id: existing.id },
        data: { isActive: false },
      });
      return { deactivated: true, channel: deactivated };
    }
    await prisma.tenantPaymentChannel.delete({ where: { id: existing.id } });
    return { deleted: true, id: existing.id };
  }

  const updated = await prisma.tenantPaymentChannel.update({
    where: { id: existing.id },
    data: { isActive: params.isActive !== undefined ? Boolean(params.isActive) : !existing.isActive },
  });
  return { channel: updated };
}

function parseJsonStringArray(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseAuditHistory(raw?: string | null): PaymentAuditEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PaymentAuditEntry[]) : [];
  } catch {
    return [];
  }
}

export function serializeClientPaymentReceipt(
  row: {
    id: string;
    submissionNumber: string;
    tenantSlug: string;
    clientAccountId: string;
    customerId: string | null;
    channelId: string;
    channelCategory: string;
    channelNameAr: string;
    treasuryAccountId: string;
    amount: unknown;
    currency: string;
    transferReference: string;
    normalizedReference: string;
    transferAt: Date;
    transferDateDmy: string;
    transferTimeHm: string;
    linkedInvoiceIdsJson: string;
    linkedRequestIdsJson: string;
    clientNotes: string | null;
    receiptFileName: string | null;
    receiptFilePath: string | null;
    receiptMimeType: string | null;
    receiptFileSize: number | null;
    status: string;
    staffNotes: string | null;
    clarificationReason: string | null;
    rejectionReason: string | null;
    reviewedByUserId: string | null;
    reviewedByName: string | null;
    reviewedAt: Date | null;
    linkedReceiptVoucherId: string | null;
    linkedJournalEntryId: string | null;
    auditHistoryJson: string;
    createdAt: Date;
    updatedAt: Date;
    clientAccount?: {
      id: string;
      fullName: string;
      tradeName: string | null;
      phone: string;
      customerId: string | null;
    };
  },
  extra?: { receiptVoucherNumber?: string | null }
) {
  return {
    id: row.id,
    submissionNumber: row.submissionNumber,
    tenantSlug: row.tenantSlug,
    clientAccountId: row.clientAccountId,
    customerId: row.customerId,
    channelId: row.channelId,
    channelCategory: row.channelCategory as PaymentChannelCategory,
    channelCategoryLabelAr:
      PAYMENT_CHANNEL_CATEGORY_LABELS[row.channelCategory as PaymentChannelCategory] || row.channelCategory,
    channelNameAr: row.channelNameAr,
    treasuryAccountId: row.treasuryAccountId,
    amount: Number(row.amount || 0),
    currency: row.currency,
    transferReference: row.transferReference,
    normalizedReference: row.normalizedReference,
    transferAt: row.transferAt.toISOString(),
    transferDateDmy: row.transferDateDmy,
    transferTimeHm: row.transferTimeHm,
    transferDisplay: `${row.transferDateDmy} — ${row.transferTimeHm}`,
    linkedInvoiceIds: parseJsonStringArray(row.linkedInvoiceIdsJson),
    linkedRequestIds: parseJsonStringArray(row.linkedRequestIdsJson),
    clientNotes: row.clientNotes,
    hasReceiptAttachment: Boolean(row.receiptFilePath),
    receiptFileName: row.receiptFileName,
    receiptMimeType: row.receiptMimeType,
    receiptFileSize: row.receiptFileSize,
    receiptUrl: row.receiptFilePath
      ? `/api/client-portal/payments/${encodeURIComponent(row.id)}/receipt`
      : null,
    status: row.status,
    statusLabelAr: PAYMENT_RECEIPT_STATUS_LABELS[row.status] || row.status,
    staffNotes: row.staffNotes,
    clarificationReason: row.clarificationReason,
    rejectionReason: row.rejectionReason,
    reviewedByName: row.reviewedByName,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewedAtDisplay: row.reviewedAt ? formatIsoToDmyTime(row.reviewedAt) : null,
    linkedReceiptVoucherId: row.linkedReceiptVoucherId,
    receiptVoucherNumber: extra?.receiptVoucherNumber ?? null,
    linkedJournalEntryId: row.linkedJournalEntryId,
    auditHistory: parseAuditHistory(row.auditHistoryJson),
    createdAt: row.createdAt.toISOString(),
    createdAtDisplay: formatIsoToDmyTime(row.createdAt),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.clientAccount
      ? {
          clientAccount: {
            id: row.clientAccount.id,
            fullName: row.clientAccount.fullName,
            tradeName: row.clientAccount.tradeName,
            phone: row.clientAccount.phone,
            customerId: row.clientAccount.customerId,
          },
        }
      : {}),
  };
}

export interface ReceiptFileInput {
  buffer?: Buffer;
  mimeType?: string | null;
  filename?: string | null;
  dataUrl?: string | null;
}

function validateAndExtractReceiptBuffer(file?: ReceiptFileInput | null): {
  buffer: Buffer;
  ext: "jpg" | "png" | "webp" | "pdf";
  contentType: string;
  originalName: string;
} | null {
  if (!file) return null;
  if (file.buffer && file.buffer.length > 0) {
    const check = validateReceiptUpload({
      buffer: file.buffer,
      mimeType: file.mimeType,
      filename: file.filename,
    });
    if (!check.ok) throw new Error(check.error);
    return {
      buffer: file.buffer,
      ext: check.ext,
      contentType: check.contentType,
      originalName: file.filename || `receipt.${check.ext}`,
    };
  }
  if (file.dataUrl && file.dataUrl.trim()) {
    const decoded = decodeReceiptDataUrl(file.dataUrl);
    if (!decoded) {
      throw new Error(
        "ملف الإيصال غير صالح أو يتجاوز 10 ميجابايت (الصيغ المسموحة: JPG, PNG, WEBP, PDF)"
      );
    }
    return {
      buffer: decoded.buffer,
      ext: decoded.ext,
      contentType: decoded.contentType,
      originalName: file.filename || `receipt.${decoded.ext}`,
    };
  }
  return null;
}

export async function submitClientPaymentReceipt(params: {
  tenantSlug: string;
  clientAccountId: string;
  channelId: string;
  amount: number;
  currency?: string;
  transferReference: string;
  transferDate?: string | null;
  transferTime?: string | null;
  linkedInvoiceIds?: string[];
  linkedRequestIds?: string[];
  clientNotes?: string | null;
  file?: ReceiptFileInput | null;
}) {
  const account = await prisma.clientPortalAccount.findUnique({
    where: { id: params.clientAccountId },
  });
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  if (account.status !== "ACTIVE") {
    throw new Error("يجب اعتماد حسابك من المنشأة قبل تسجيل إشعارات السداد");
  }
  if (account.mustChangePassword) {
    throw new Error("MUST_CHANGE_PASSWORD: يرجى تحديث كلمة المرور المؤقتة أولاً");
  }

  const channel = await prisma.tenantPaymentChannel.findUnique({
    where: { id: params.channelId },
  });
  if (!channel || channel.tenantSlug !== params.tenantSlug || !channel.isActive) {
    throw new Error("قناة السداد المختارة غير متاحة أو غير نشطة في هذه المنشأة");
  }

  const amount = round4(Number(params.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("مبلغ السداد يجب أن يكون أكبر من صفر");
  }

  const transferReference = String(params.transferReference || "").trim();
  const normalizedReference = normalizeTransferReference(transferReference);
  if (!normalizedReference || normalizedReference.length < 3) {
    throw new Error("يرجى إدخال رقم المرجع / الحوالة / السند بشكل صحيح (3 أحرف أو أرقام على الأقل)");
  }

  const duplicate = await prisma.clientPaymentReceipt.findFirst({
    where: {
      tenantSlug: params.tenantSlug,
      channelId: channel.id,
      normalizedReference,
    },
    select: { id: true, submissionNumber: true, status: true },
  });
  if (duplicate) {
    throw new Error(
      `DUPLICATE_TRANSFER_REFERENCE: رقم المرجع (${transferReference}) مسجل مسبقاً لهذه القناة (${duplicate.submissionNumber})`
    );
  }

  const extractedFile = validateAndExtractReceiptBuffer(params.file);
  if (!extractedFile) {
    throw new Error("يرجى إرفاق صورة أو ملف الإيصال (JPG, PNG, WEBP, PDF بحد أقصى 10MB)");
  }

  const { transferAt, transferDateDmy, transferTimeHm } = parseTransferDateTime(
    params.transferDate,
    params.transferTime
  );

  // Validate linked invoices & requests strictly belong to this client
  const requestedInvIds = Array.from(new Set((params.linkedInvoiceIds || []).map(String).filter(Boolean)));
  let validInvoiceIds: string[] = [];
  if (requestedInvIds.length > 0 && account.customerId) {
    const ownedInvoices = await prisma.salesInvoice.findMany({
      where: {
        id: { in: requestedInvIds },
        customerId: account.customerId,
        status: { not: "VOIDED" },
      },
      select: { id: true },
    });
    validInvoiceIds = ownedInvoices.map((i) => i.id);
  }

  const requestedReqIds = Array.from(new Set((params.linkedRequestIds || []).map(String).filter(Boolean)));
  let validRequestIds: string[] = [];
  if (requestedReqIds.length > 0) {
    const ownedReqs = await prisma.clientGoodsRequest.findMany({
      where: {
        id: { in: requestedReqIds },
        clientAccountId: account.id,
      },
      select: { id: true },
    });
    validRequestIds = ownedReqs.map((r) => r.id);
  }

  const submissionNumber = `PAY-${new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

  const savedFile = saveClientPaymentReceiptFile({
    tenantSlug: params.tenantSlug,
    submissionNumber,
    buffer: extractedFile.buffer,
    ext: extractedFile.ext,
  });

  const currency = String(params.currency || channel.currency || "YER").trim().toUpperCase();
  const initialAudit = [
    buildAuditEntry(
      "SUBMITTED",
      "تقديم إشعار سداد وإرفاق إيصال",
      account.fullName,
      "CLIENT_PORTAL",
      `المبلغ: ${amount} ${currency} | المرجع: ${transferReference} | تاريخ التحويل: ${transferDateDmy} ${transferTimeHm}`
    ),
  ];

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const rec = await tx.clientPaymentReceipt.create({
        data: {
          submissionNumber,
          tenantSlug: params.tenantSlug,
          clientAccountId: account.id,
          customerId: account.customerId,
          channelId: channel.id,
          channelCategory: channel.category,
          channelNameAr: channel.displayNameAr,
          treasuryAccountId: channel.treasuryAccountId,
          amount,
          currency,
          transferReference,
          normalizedReference,
          transferAt,
          transferDateDmy,
          transferTimeHm,
          linkedInvoiceIdsJson: JSON.stringify(validInvoiceIds),
          linkedRequestIdsJson: JSON.stringify(validRequestIds),
          clientNotes: params.clientNotes?.trim() || null,
          receiptFileName: extractedFile.originalName,
          receiptFilePath: savedFile.relativePath,
          receiptMimeType: extractedFile.contentType,
          receiptFileSize: savedFile.fileSize,
          status: "PENDING_VERIFICATION",
          auditHistoryJson: JSON.stringify(initialAudit),
        },
      });

      await appendAuditLogTx(tx, {
        userId: null,
        userDisplay: account.fullName,
        userRole: "CLIENT_PORTAL",
        actionType: "CLIENT_PAYMENT_SUBMITTED",
        entityReference: rec.submissionNumber,
        details: `[tenant:${params.tenantSlug}] قدم العميل ${account.fullName} إيصال سداد ${rec.submissionNumber} بمبلغ ${amount} ${currency} عبر ${channel.displayNameAr} (مرجع: ${transferReference}) — قيد المراجعة`,
      });

      return rec;
    });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error(
        `DUPLICATE_TRANSFER_REFERENCE: رقم المرجع (${transferReference}) مسجل مسبقاً لهذه القناة`
      );
    }
    throw err;
  }

  await emitNotification({
    eventType: "SYSTEM_ALERT",
    severity: "INFO",
    titleAr: `إيصال سداد جديد بانتظار المراجعة (${submissionNumber})`,
    titleEn: `New Payment Receipt Pending Verification (${submissionNumber})`,
    messageAr: `أرسل العميل ${account.fullName} إيصال سداد بمبلغ ${amount.toLocaleString("en-US")} ${currency} عبر ${channel.displayNameAr}.`,
    messageEn: `Client ${account.fullName} submitted payment ${submissionNumber} (${amount} ${currency}).`,
    targetTab: "sales",
    targetEntityType: "ClientPaymentReceipt",
    targetEntityId: created.id,
  }).catch(() => null);

  return serializeClientPaymentReceipt(created);
}

export async function resubmitClientPaymentReceipt(params: {
  tenantSlug: string;
  paymentId: string;
  clientAccountId: string;
  amount?: number;
  transferReference?: string;
  transferDate?: string | null;
  transferTime?: string | null;
  clientNotes?: string | null;
  file?: ReceiptFileInput | null;
}) {
  const existing = await prisma.clientPaymentReceipt.findUnique({
    where: { id: params.paymentId },
    include: { clientAccount: true },
  });
  if (!existing || existing.tenantSlug !== params.tenantSlug || existing.clientAccountId !== params.clientAccountId) {
    throw new Error("NOT_FOUND: إشعار السداد غير موجود");
  }
  if (existing.status !== "RETURNED_FOR_CLARIFICATION") {
    throw new Error("لا يمكن تعديل وإعادة إرسال الإيصال إلا إذا كان في حالة (معاد للتوضيح)");
  }

  const nextAmount =
    params.amount !== undefined && Number(params.amount) > 0
      ? round4(Number(params.amount))
      : Number(existing.amount);
  const nextRef = params.transferReference?.trim() || existing.transferReference;
  const nextNormRef = normalizeTransferReference(nextRef);
  if (nextNormRef.length < 3) {
    throw new Error("رقم المرجع / الحوالة غير صالح");
  }

  if (nextNormRef !== existing.normalizedReference) {
    const dup = await prisma.clientPaymentReceipt.findFirst({
      where: {
        tenantSlug: params.tenantSlug,
        channelId: existing.channelId,
        normalizedReference: nextNormRef,
        id: { not: existing.id },
      },
      select: { submissionNumber: true },
    });
    if (dup) {
      throw new Error(`DUPLICATE_TRANSFER_REFERENCE: رقم المرجع مسجل مسبقاً (${dup.submissionNumber})`);
    }
  }

  const extractedFile = validateAndExtractReceiptBuffer(params.file);
  const savedFile = extractedFile
    ? saveClientPaymentReceiptFile({
        tenantSlug: params.tenantSlug,
        submissionNumber: existing.submissionNumber,
        buffer: extractedFile.buffer,
        ext: extractedFile.ext,
      })
    : null;

  const parsedDt =
    params.transferDate || params.transferTime
      ? parseTransferDateTime(
          params.transferDate || existing.transferDateDmy,
          params.transferTime || existing.transferTimeHm
        )
      : {
          transferAt: existing.transferAt,
          transferDateDmy: existing.transferDateDmy,
          transferTimeHm: existing.transferTimeHm,
        };

  const history = parseAuditHistory(existing.auditHistoryJson);
  history.push(
    buildAuditEntry(
      "RESUBMITTED",
      "إعادة إرسال الإيصال بعد التوضيح",
      existing.clientAccount.fullName,
      "CLIENT_PORTAL",
      params.clientNotes?.trim() || "تم التحديث وإعادة الإرسال للمراجعة"
    )
  );

  const updated = await prisma.clientPaymentReceipt.update({
    where: { id: existing.id },
    data: {
      amount: nextAmount,
      transferReference: nextRef,
      normalizedReference: nextNormRef,
      transferAt: parsedDt.transferAt,
      transferDateDmy: parsedDt.transferDateDmy,
      transferTimeHm: parsedDt.transferTimeHm,
      clientNotes:
        params.clientNotes !== undefined ? params.clientNotes?.trim() || null : existing.clientNotes,
      ...(savedFile && extractedFile
        ? {
            receiptFileName: extractedFile.originalName,
            receiptFilePath: savedFile.relativePath,
            receiptMimeType: extractedFile.contentType,
            receiptFileSize: savedFile.fileSize,
          }
        : {}),
      status: "PENDING_VERIFICATION",
      clarificationReason: null,
      auditHistoryJson: JSON.stringify(history),
    },
  });

  return serializeClientPaymentReceipt(updated);
}

export async function listClientPaymentReceipts(params: {
  tenantSlug: string;
  clientAccountId?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 50));
  const status = (params.status || "ALL").trim().toUpperCase();
  const search = (params.search || "").trim();

  const whereClause: Prisma.ClientPaymentReceiptWhereInput = {
    tenantSlug: params.tenantSlug,
    ...(params.clientAccountId ? { clientAccountId: params.clientAccountId } : {}),
    ...(status && status !== "ALL" ? { status } : {}),
    ...(search
      ? {
          OR: [
            { submissionNumber: { contains: search } },
            { transferReference: { contains: search } },
            { channelNameAr: { contains: search } },
            { clientAccount: { fullName: { contains: search } } },
            { clientAccount: { phone: { contains: search } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.clientPaymentReceipt.count({ where: whereClause }),
    prisma.clientPaymentReceipt.findMany({
      where: whereClause,
      include: {
        clientAccount: {
          select: {
            id: true,
            fullName: true,
            tradeName: true,
            phone: true,
            customerId: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const voucherIds = rows.map((r) => r.linkedReceiptVoucherId).filter(Boolean) as string[];
  const vouchers = voucherIds.length
    ? await prisma.receiptVoucher.findMany({
        where: { id: { in: voucherIds } },
        select: { id: true, voucherNumber: true },
      })
    : [];
  const vMap = new Map(vouchers.map((v) => [v.id, v.voucherNumber]));

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    payments: rows.map((r) =>
      serializeClientPaymentReceipt(r, {
        receiptVoucherNumber: r.linkedReceiptVoucherId ? vMap.get(r.linkedReceiptVoucherId) ?? null : null,
      })
    ),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

export async function reviewClientPaymentReceipt(params: {
  tenantSlug: string;
  paymentId: string;
  action: "APPROVE" | "RETURN_FOR_CLARIFICATION" | "REJECT";
  staffNotes?: string | null;
  reason?: string | null;
  actor: { userId?: string | null; username?: string | null; userDisplay: string; userRole: string };
}) {
  const existing = await prisma.clientPaymentReceipt.findUnique({
    where: { id: params.paymentId },
    include: { clientAccount: true },
  });
  if (!existing || existing.tenantSlug !== params.tenantSlug) {
    throw new Error("NOT_FOUND: إشعار السداد غير موجود في هذه المنشأة");
  }

  if (params.action === "APPROVE") {
    if (existing.status === "REJECTED") {
      throw new Error("لا يمكن اعتماد إيصال سداد مرفوض مسبقاً");
    }

    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.clientPaymentReceipt.findUniqueOrThrow({
        where: { id: existing.id },
        include: { clientAccount: true },
      });

      // Strict Idempotency Check: prevent double receipt / double GL entry
      const existingVoucher = await tx.receiptVoucher.findUnique({
        where: { linkedPaymentReceiptId: fresh.id },
      });
      if (fresh.status === "APPROVED" && (fresh.linkedReceiptVoucherId || existingVoucher)) {
        const voucherId = fresh.linkedReceiptVoucherId || existingVoucher!.id;
        return {
          payment: fresh,
          voucherId,
          voucherNumber: existingVoucher?.voucherNumber || fresh.submissionNumber,
          journalEntryId: fresh.linkedJournalEntryId || existingVoucher?.journalEntryId || null,
          idempotentReplay: true,
        };
      }
      if (existingVoucher) {
        const repaired = await tx.clientPaymentReceipt.update({
          where: { id: fresh.id },
          data: {
            status: "APPROVED",
            linkedReceiptVoucherId: existingVoucher.id,
            linkedJournalEntryId: existingVoucher.journalEntryId,
          },
          include: { clientAccount: true },
        });
        return {
          payment: repaired,
          voucherId: existingVoucher.id,
          voucherNumber: existingVoucher.voucherNumber,
          journalEntryId: existingVoucher.journalEntryId,
          idempotentReplay: true,
        };
      }

      await ensure6GenerationCoaHierarchy(tx);

      // Ensure linked accounting Customer exists
      let customerId = fresh.customerId || fresh.clientAccount.customerId;
      if (!customerId) {
        const cust = await ensureCustomerWithAccountTx(tx, {
          name: fresh.clientAccount.tradeName || fresh.clientAccount.fullName,
          phone: fresh.clientAccount.phone,
        });
        customerId = cust.id;
        await tx.clientPortalAccount.update({
          where: { id: fresh.clientAccountId },
          data: { customerId: cust.id },
        });
      }

      const channel = await tx.tenantPaymentChannel.findUnique({
        where: { id: fresh.channelId },
      });
      const treasuryId = channel?.treasuryAccountId || fresh.treasuryAccountId;

      // Build invoice allocations up to open balanceDue; excess remains on-account
      const linkedInvIds = parseJsonStringArray(fresh.linkedInvoiceIdsJson);
      const allocations: Array<{ invoiceId: string; amount: number }> = [];
      let remainingToAllocate = round4(Number(fresh.amount || 0));

      if (linkedInvIds.length > 0 && remainingToAllocate > 0) {
        const invoices = await tx.salesInvoice.findMany({
          where: {
            id: { in: linkedInvIds },
            customerId,
            status: { not: "VOIDED" },
            balanceDue: { gt: 0 },
          },
          orderBy: { date: "asc" },
        });
        for (const inv of invoices) {
          if (remainingToAllocate <= 0.005) break;
          const due = round4(Number(inv.balanceDue || 0));
          if (due <= 0) continue;
          const allocAmt = Math.min(remainingToAllocate, due);
          allocations.push({ invoiceId: inv.id, amount: round4(allocAmt) });
          remainingToAllocate = round4(remainingToAllocate - allocAmt);
        }
      }

      const posted = await postCustomerReceipt({
        customerId,
        allocations: allocations.length > 0 ? allocations : undefined,
        treasuryId,
        amount: Number(fresh.amount || 0),
        currency: fresh.currency || "YER",
        date: fresh.transferAt,
        notes: `اعتماد سداد بوابة العميل (${fresh.submissionNumber}) — ${fresh.channelNameAr} | مرجع: ${fresh.transferReference}`,
        createdById: params.actor.userId ?? undefined,
        skipApprovalCheck: true,
        linkedPaymentReceiptId: fresh.id,
        tenantSlug: params.tenantSlug,
        tx,
      });

      const now = new Date();
      const history = parseAuditHistory(fresh.auditHistoryJson);
      history.push(
        buildAuditEntry(
          "APPROVED",
          "اعتماد الإيصال وترحيل سند قبض مزدوج القيد",
          params.actor.userDisplay,
          params.actor.userRole,
          `سند قبض ${posted.receipt.voucherNumber}${params.staffNotes ? ` — ${params.staffNotes}` : ""}`,
          now
        )
      );

      const updatedPayment = await tx.clientPaymentReceipt.update({
        where: { id: fresh.id },
        data: {
          status: "APPROVED",
          customerId,
          staffNotes: params.staffNotes?.trim() || fresh.staffNotes,
          reviewedByUserId: params.actor.userId ?? null,
          reviewedByName: params.actor.userDisplay,
          reviewedAt: now,
          linkedReceiptVoucherId: posted.receipt.id,
          linkedJournalEntryId: posted.journalEntry.id,
          auditHistoryJson: JSON.stringify(history),
        },
        include: { clientAccount: true },
      });

      // Compute remaining balance for WhatsApp confirmation draft + Username/Title signature
      const openInvs = await tx.salesInvoice.findMany({
        where: { customerId, balanceDue: { gt: 0 }, status: { not: "VOIDED" } },
        select: { balanceDue: true },
      });
      const totalOpenDue = openInvs.reduce((s, r) => dAdd(s, Number(r.balanceDue || 0), 4), 0);

      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      const sig = resolveExportSignature({
        user: {
          username: params.actor.username || params.actor.userDisplay,
          displayName: params.actor.userDisplay,
          role: params.actor.userRole,
        },
        tenantSlug: params.tenantSlug,
        tenantName: profile?.legalNameAr || params.tenantSlug,
        now,
      });

      const receiptMsg = [
        `مرحباً ${fresh.clientAccount.fullName}،`,
        `تم اعتماد إشعار السداد رقم ${fresh.submissionNumber} وترحيل سند القبض رقم ${posted.receipt.voucherNumber}.`,
        `القناة: ${fresh.channelNameAr} | المرجع: ${fresh.transferReference}`,
        `المبلغ المستلم: ${Number(fresh.amount).toLocaleString("en-US")} ${fresh.currency}`,
        `الرصيد المستحق الحالي: ${Math.round(totalOpenDue).toLocaleString("en-US")} ${fresh.currency}`,
        `التاريخ والوقت: ${formatIsoToDmyTime(now)}`,
        `---`,
        `المُصدِر: ${sig.username} (${sig.displayName}) — الصفة: ${sig.titleAr}`,
      ].join("\n");

      await createWhatsAppDraftTx(tx, {
        eventType: "PAYMENT_RECEIPT",
        clientAccountId: fresh.clientAccountId,
        customerId,
        recipientName: fresh.clientAccount.fullName,
        recipientPhone: fresh.clientAccount.phone,
        explicitMessageText: receiptMsg,
      });

      await appendAuditLogTx(tx, {
        userId: params.actor.userId,
        userDisplay: params.actor.userDisplay,
        userRole: params.actor.userRole,
        actionType: "CLIENT_PAYMENT_APPROVED",
        entityReference: fresh.submissionNumber,
        details: `[tenant:${params.tenantSlug}] اعتماد إيصال سداد ${fresh.submissionNumber} وترحيل سند قبض ${posted.receipt.voucherNumber} بمبلغ ${fresh.amount} ${fresh.currency} (قيد ${posted.journalEntry.entryNumber})`,
      });

      return {
        payment: updatedPayment,
        voucherId: posted.receipt.id,
        voucherNumber: posted.receipt.voucherNumber,
        journalEntryId: posted.journalEntry.id,
        idempotentReplay: false,
      };
    });

    // Recompute live balance and sync Global Client Membership
    if (result.payment.customerId) {
      const snapshot = await getClientPortalFinancialSnapshot({
        customerId: result.payment.customerId,
      }).catch(() => null);
      if (snapshot) {
        await syncGlobalClientMembershipStatus({
          globalClientId: result.payment.clientAccount.globalClientId,
          tenantSlug: params.tenantSlug,
          tenantId: getActiveTenantId(),
          clientAccountId: result.payment.clientAccountId,
          customerId: result.payment.customerId,
          normalizedPhone:
            result.payment.clientAccount.normalizedPhone || result.payment.clientAccount.phone,
          normalizedEmail:
            result.payment.clientAccount.normalizedEmail || result.payment.clientAccount.email,
          status: result.payment.clientAccount.status,
          creditLimit: snapshot.summary.creditLimit,
          balance: snapshot.summary.totalUnpaid,
        });
      }
    }

    return {
      idempotentReplay: result.idempotentReplay,
      payment: serializeClientPaymentReceipt(result.payment, {
        receiptVoucherNumber: result.voucherNumber,
      }),
      receiptVoucherId: result.voucherId,
      receiptVoucherNumber: result.voucherNumber,
      journalEntryId: result.journalEntryId,
    };
  }

  // RETURN_FOR_CLARIFICATION or REJECT (never alters GL or balances)
  if (existing.status === "APPROVED") {
    throw new Error("لا يمكن رفض أو إعادة إيصال تم اعتماده وترحيله محاسبياً مسبقاً");
  }

  const nextStatus =
    params.action === "RETURN_FOR_CLARIFICATION" ? "RETURNED_FOR_CLARIFICATION" : "REJECTED";
  const reasonText =
    params.reason?.trim() ||
    (nextStatus === "RETURNED_FOR_CLARIFICATION"
      ? "يرجى توضيح رقم المرجع أو إرفاق صورة أوضح للإيصال"
      : "لم يتم تأكيد وصول الحوالة");
  const now = new Date();
  const history = parseAuditHistory(existing.auditHistoryJson);
  history.push(
    buildAuditEntry(
      nextStatus,
      nextStatus === "RETURNED_FOR_CLARIFICATION" ? "إعادة للتوضيح" : "رفض إيصال السداد",
      params.actor.userDisplay,
      params.actor.userRole,
      reasonText,
      now
    )
  );

  const updated = await prisma.$transaction(async (tx) => {
    const rec = await tx.clientPaymentReceipt.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        staffNotes: params.staffNotes?.trim() || existing.staffNotes,
        ...(nextStatus === "RETURNED_FOR_CLARIFICATION"
          ? { clarificationReason: reasonText }
          : { rejectionReason: reasonText }),
        reviewedByUserId: params.actor.userId ?? null,
        reviewedByName: params.actor.userDisplay,
        reviewedAt: now,
        auditHistoryJson: JSON.stringify(history),
      },
      include: { clientAccount: true },
    });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: `CLIENT_PAYMENT_${nextStatus}`,
      entityReference: existing.submissionNumber,
      details: `[tenant:${params.tenantSlug}] ${nextStatus} إيصال السداد ${existing.submissionNumber}: ${reasonText}`,
    });

    return rec;
  });

  return {
    idempotentReplay: false,
    payment: serializeClientPaymentReceipt(updated),
  };
}

export async function readAuthorizedPaymentReceiptFile(params: {
  tenantSlug: string;
  paymentId: string;
}) {
  const rec = await prisma.clientPaymentReceipt.findUnique({
    where: { id: params.paymentId },
    select: {
      id: true,
      tenantSlug: true,
      clientAccountId: true,
      receiptFilePath: true,
      receiptFileName: true,
      receiptMimeType: true,
    },
  });
  if (!rec || rec.tenantSlug !== params.tenantSlug) {
    return null;
  }
  const file = readClientPaymentReceiptFile(params.tenantSlug, rec.receiptFilePath);
  if (!file) return null;
  return {
    ...file,
    clientAccountId: rec.clientAccountId,
    originalFileName: rec.receiptFileName || file.fileName,
  };
}

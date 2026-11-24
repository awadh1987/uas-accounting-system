import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, hashPassword, verifyPassword } from "@/lib/serverBootstrap";
import {
  ensureCustomerWithAccountTx,
  postCustomerReceipt,
  postSalesInvoice,
} from "@/lib/accounting/ledgerService";
import { emitNotification } from "@/lib/notifications/notificationService";
import {
  normalizeClientEmail,
  normalizeClientPhone,
} from "@/lib/clientPortal/clientAuth";
import { getTenantFormConfig } from "@/lib/clientPortal/portalConfig";
import { createWhatsAppDraftTx } from "@/lib/whatsapp/outboxService";
import { ensure6GenerationCoaHierarchy } from "@/lib/accountingCoreEngine";

export const REQUEST_STATUS_LABELS_AR: Record<string, string> = {
  PENDING_REVIEW: "قيد المراجعة",
  CONFIRMED: "مؤكد",
  READY_FOR_PICKUP: "جاهز للاستلام",
  COMPLETED: "تم الاستلام",
  CANCELLED: "ملغى",
  REJECTED: "مرفوض",
};

export interface ClientSafeAccountView {
  id: string;
  customerId: string | null;
  fullName: string;
  tradeName: string | null;
  phone: string;
  email: string;
  clientType: string;
  customClientType: string | null;
  preferredPickup: string;
  customFields: Record<string, unknown>;
  status: string;
  notes: string | null;
  creditLimit: number;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

export function sanitizeClientAccount(
  acc: {
    id: string;
    customerId: string | null;
    fullName: string;
    tradeName: string | null;
    phone: string;
    email: string;
    clientType: string;
    customClientType: string | null;
    preferredPickup: string;
    customFieldsJson: string;
    status: string;
    notes: string | null;
    approvedAt: Date | null;
    rejectedReason: string | null;
    createdAt: Date;
  },
  creditLimit = 0
): ClientSafeAccountView {
  let customFields: Record<string, unknown> = {};
  try {
    customFields = JSON.parse(acc.customFieldsJson || "{}") as Record<string, unknown>;
  } catch {
    customFields = {};
  }
  return {
    id: acc.id,
    customerId: acc.customerId,
    fullName: acc.fullName,
    tradeName: acc.tradeName,
    phone: acc.phone,
    email: acc.email,
    clientType: acc.clientType,
    customClientType: acc.customClientType,
    preferredPickup: acc.preferredPickup,
    customFields,
    status: acc.status,
    notes: acc.notes,
    creditLimit,
    approvedAt: acc.approvedAt ? acc.approvedAt.toISOString() : null,
    rejectedReason: acc.rejectedReason,
    createdAt: acc.createdAt.toISOString(),
  };
}

export async function registerClientPortalAccount(params: {
  fullName: string;
  tradeName?: string;
  phone: string;
  email: string;
  password: string;
  clientType?: string;
  customClientType?: string;
  preferredPickup?: string;
  customFields?: Record<string, unknown>;
  notes?: string;
  portalUrl?: string;
}) {
  const fullName = String(params.fullName || "").trim();
  if (fullName.length < 2) {
    throw new Error("يرجى إدخال الاسم الكامل / الاسم التجاري (حرفان على الأقل)");
  }

  const phoneCheck = normalizeClientPhone(params.phone);
  if (!phoneCheck.valid) {
    throw new Error(phoneCheck.error || "رقم الجوال غير صحيح");
  }

  const emailCheck = normalizeClientEmail(params.email);
  if (!emailCheck.valid) {
    throw new Error(emailCheck.error || "البريد الإلكتروني غير صحيح");
  }

  const rawPassword = String(params.password || "");
  if (rawPassword.length < 4) {
    throw new Error("يرجى تعيين كلمة مرور أو رمز PIN من 4 أحرف/أرقام على الأقل");
  }

  const [existingPhone, existingEmail] = await Promise.all([
    prisma.clientPortalAccount.findUnique({ where: { phone: phoneCheck.normalized } }),
    prisma.clientPortalAccount.findUnique({ where: { email: emailCheck.normalized } }),
  ]);
  if (existingPhone) {
    throw new Error("رقم الجوال مسجل مسبقاً في بوابة هذه المنشأة");
  }
  if (existingEmail) {
    throw new Error("البريد الإلكتروني مسجل مسبقاً في بوابة هذه المنشأة");
  }

  const formCfg = await getTenantFormConfig();
  const autoApprove = formCfg.approvalPolicy === "AUTO";
  const passwordHash = hashPassword(rawPassword);
  const tradeName = params.tradeName?.trim() || null;
  const clientType = String(params.clientType || "DIRECT_CLIENT").trim().toUpperCase();
  const customClientType = params.customClientType?.trim() || null;
  const preferredPickup = String(params.preferredPickup || "السوق").trim() || "السوق";
  const customFieldsJson = JSON.stringify(params.customFields || {});

  const result = await prisma.$transaction(async (tx) => {
    let linkedCustomerId: string | null = null;
    let creditLimit = 0;

    if (autoApprove) {
      await ensure6GenerationCoaHierarchy(tx);
      const cust = await ensureCustomerWithAccountTx(tx, {
        name: tradeName || fullName,
        phone: phoneCheck.normalized,
      });
      linkedCustomerId = cust.id;
      creditLimit = Number(cust.creditLimit || 0);
    }

    const account = await tx.clientPortalAccount.create({
      data: {
        customerId: linkedCustomerId,
        fullName,
        tradeName,
        phone: phoneCheck.normalized,
        email: emailCheck.normalized,
        passwordHash,
        clientType,
        customClientType,
        preferredPickup,
        customFieldsJson,
        status: autoApprove ? "ACTIVE" : "PENDING_APPROVAL",
        notes: params.notes?.trim() || null,
        approvedAt: autoApprove ? new Date() : null,
        approvedByName: autoApprove ? "اعتماد تلقائي للبوابة" : null,
      },
    });

    await appendAuditLogTx(tx, {
      userId: null,
      userDisplay: fullName,
      userRole: "CLIENT_PORTAL",
      actionType: "CLIENT_PORTAL_REGISTER",
      entityReference: account.id,
      details: `تسجيل عميل جديد في البوابة: ${fullName} (${phoneCheck.normalized} / ${emailCheck.normalized}) — الحالة: ${account.status}`,
    });

    if (autoApprove) {
      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      await createWhatsAppDraftTx(tx, {
        eventType: "CLIENT_APPROVED",
        clientAccountId: account.id,
        customerId: linkedCustomerId,
        recipientName: fullName,
        recipientPhone: phoneCheck.normalized,
        variables: {
          companyName: profile?.legalNameAr || "المنشأة",
          portalUrl: params.portalUrl || "https://qat.world",
        },
      });
    }

    return { account, creditLimit };
  });

  await emitNotification({
    eventType: "SYSTEM_ALERT",
    severity: "INFO",
    titleAr: "تسجيل عميل جديد في البوابة",
    titleEn: "New Client Portal Registration",
    messageAr: `سجل العميل ${fullName} (${phoneCheck.normalized}) — ${
      autoApprove ? "مفعل تلقائياً" : "بانتظار الاعتماد"
    }`,
    messageEn: `New portal client ${fullName} (${phoneCheck.normalized})`,
    targetTab: "customers",
    targetEntityType: "ClientPortalAccount",
    targetEntityId: result.account.id,
  }).catch(() => null);

  return sanitizeClientAccount(result.account, result.creditLimit);
}

export async function authenticateClientPortalAccount(params: {
  identifier: string;
  password: string;
}) {
  const idRaw = String(params.identifier || "").trim();
  const password = String(params.password || "");
  if (!idRaw || !password) {
    throw new Error("يرجى إدخال رقم الجوال أو البريد الإلكتروني وكلمة المرور");
  }

  let account = null;
  if (idRaw.includes("@")) {
    const emailNorm = normalizeClientEmail(idRaw);
    if (emailNorm.valid) {
      account = await prisma.clientPortalAccount.findUnique({ where: { email: emailNorm.normalized } });
    }
  } else {
    const phoneNorm = normalizeClientPhone(idRaw);
    if (phoneNorm.valid) {
      account = await prisma.clientPortalAccount.findUnique({ where: { phone: phoneNorm.normalized } });
    }
  }

  if (!account || !verifyPassword(password, account.passwordHash)) {
    throw new Error("بيانات الدخول غير صحيحة");
  }

  if (account.status === "REJECTED") {
    throw new Error(account.rejectedReason || "تم رفض هذا الحساب من قبل المنشأة");
  }
  if (account.status === "SUSPENDED") {
    throw new Error("تم تعليق الحساب، يرجى التواصل مع إدارة المنشأة");
  }

  const updated = await prisma.clientPortalAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
  });

  let creditLimit = 0;
  if (updated.customerId) {
    const cust = await prisma.customer.findUnique({
      where: { id: updated.customerId },
      select: { creditLimit: true },
    });
    creditLimit = Number(cust?.creditLimit || 0);
  }

  return sanitizeClientAccount(updated, creditLimit);
}

export async function updateClientPortalProfile(
  clientAccountId: string,
  patch: {
    fullName?: string;
    tradeName?: string;
    email?: string;
    preferredPickup?: string;
    customFields?: Record<string, unknown>;
    notes?: string;
    newPassword?: string;
    currentPassword?: string;
  }
) {
  const existing = await prisma.clientPortalAccount.findUnique({ where: { id: clientAccountId } });
  if (!existing) throw new Error("ACCOUNT_NOT_FOUND");

  let nextEmail = existing.email;
  if (patch.email && patch.email.trim().toLowerCase() !== existing.email) {
    const chk = normalizeClientEmail(patch.email);
    if (!chk.valid) throw new Error(chk.error || "البريد الإلكتروني غير صحيح");
    const conflict = await prisma.clientPortalAccount.findUnique({ where: { email: chk.normalized } });
    if (conflict && conflict.id !== existing.id) {
      throw new Error("البريد الإلكتروني مستخدم لحساب آخر");
    }
    nextEmail = chk.normalized;
  }

  let nextHash = existing.passwordHash;
  if (patch.newPassword && patch.newPassword.trim()) {
    if (!patch.currentPassword || !verifyPassword(patch.currentPassword, existing.passwordHash)) {
      throw new Error("كلمة المرور الحالية غير صحيحة");
    }
    if (patch.newPassword.trim().length < 4) {
      throw new Error("كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل");
    }
    nextHash = hashPassword(patch.newPassword.trim());
  }

  let mergedCustom: Record<string, unknown> = {};
  try {
    mergedCustom = JSON.parse(existing.customFieldsJson || "{}") as Record<string, unknown>;
  } catch {
    mergedCustom = {};
  }
  if (patch.customFields && typeof patch.customFields === "object") {
    mergedCustom = { ...mergedCustom, ...patch.customFields };
  }

  const updated = await prisma.clientPortalAccount.update({
    where: { id: existing.id },
    data: {
      fullName: patch.fullName?.trim() ? patch.fullName.trim() : existing.fullName,
      tradeName: patch.tradeName !== undefined ? patch.tradeName.trim() || null : existing.tradeName,
      email: nextEmail,
      preferredPickup:
        patch.preferredPickup !== undefined
          ? patch.preferredPickup.trim() || existing.preferredPickup
          : existing.preferredPickup,
      customFieldsJson: JSON.stringify(mergedCustom),
      notes: patch.notes !== undefined ? patch.notes.trim() || null : existing.notes,
      passwordHash: nextHash,
    },
  });

  let creditLimit = 0;
  if (updated.customerId) {
    const cust = await prisma.customer.findUnique({
      where: { id: updated.customerId },
      select: { creditLimit: true },
    });
    creditLimit = Number(cust?.creditLimit || 0);
  }

  return sanitizeClientAccount(updated, creditLimit);
}

export async function createClientGoodsRequest(params: {
  clientAccountId: string;
  pickupType?: string;
  pickupLocation: string;
  customPickupLocation?: string;
  pickupNotes?: string;
  customData?: Record<string, unknown>;
  lines: Array<{
    itemId?: string | null;
    itemTitle: string;
    requestedQty: number;
    unitCode: string;
    unitLabel: string;
    customUnitLabel?: string | null;
    notes?: string | null;
  }>;
}) {
  const account = await prisma.clientPortalAccount.findUnique({
    where: { id: params.clientAccountId },
  });
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  if (account.status !== "ACTIVE") {
    throw new Error("حسابك بانتظار اعتماد إدارة المنشأة قبل إرسال الطلبات");
  }

  const pickupTypeRaw = String(params.pickupType || "MARKET").toUpperCase();
  const isCustomPickup = pickupTypeRaw === "OTHER" || params.pickupLocation.trim() === "أخرى";
  const resolvedPickupLocation = isCustomPickup
    ? String(params.customPickupLocation || "").trim()
    : String(params.pickupLocation || "").trim();

  if (!resolvedPickupLocation) {
    throw new Error("يرجى تحديد موقع الاستلام (أو كتابة الموقع عند اختيار أخرى)");
  }

  if (!Array.isArray(params.lines) || params.lines.length === 0) {
    throw new Error("يرجى إضافة صنف واحد على الأقل للطلب");
  }

  const formCfg = await getTenantFormConfig();
  const preparedLines: Array<{
    lineOrder: number;
    itemId: string | null;
    itemTitle: string;
    requestedQty: number;
    unitCode: string;
    unitLabel: string;
    customUnitLabel: string | null;
    unitPrice: number;
    lineTotal: number;
    notes: string | null;
  }> = [];

  for (let i = 0; i < params.lines.length; i++) {
    const raw = params.lines[i];
    const qty = Number(raw.requestedQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`الكمية في السطر ${i + 1} يجب أن تكون أكبر من صفر`);
    }

    const unitCode = String(raw.unitCode || "QAT_BUNCH").trim().toUpperCase();
    const isOtherUnit = unitCode === "OTHER";
    const customUnitLabel = isOtherUnit ? String(raw.customUnitLabel || "").trim() : null;
    if (isOtherUnit && !customUnitLabel) {
      throw new Error(`يرجى كتابة اسم الوحدة المخصصة في حقل "اخرى:" للسطر ${i + 1}`);
    }

    let itemTitle = String(raw.itemTitle || "").trim();
    let unitPrice = 0;
    let itemId: string | null = raw.itemId ? String(raw.itemId).trim() : null;

    if (itemId) {
      const catItem = await prisma.inventoryItem.findUnique({
        where: { id: itemId },
        include: { conversions: { include: { unit: true } } },
      });
      if (catItem) {
        itemTitle = itemTitle || catItem.nameAr;
        unitPrice = Number(catItem.wholesalePrice || catItem.retailPrice || 0);
        const conv = catItem.conversions.find((c) => c.unit?.code === unitCode);
        if (conv && Number(conv.sellPrice || 0) > 0) {
          unitPrice = Number(conv.sellPrice);
        }
      } else {
        itemId = null;
      }
    }

    if (!itemTitle) {
      throw new Error(`يرجى تحديد اسم الصنف في السطر ${i + 1}`);
    }

    const unitOption = formCfg.unitOptions.find((u) => u.code === unitCode);
    const unitLabel = isOtherUnit
      ? customUnitLabel || "أخرى"
      : String(raw.unitLabel || unitOption?.labelAr || "علاقية قات").trim();
    const lineTotal = Math.round(qty * unitPrice * 100) / 100;

    preparedLines.push({
      lineOrder: i + 1,
      itemId,
      itemTitle,
      requestedQty: qty,
      unitCode,
      unitLabel,
      customUnitLabel,
      unitPrice,
      lineTotal,
      notes: raw.notes ? String(raw.notes).trim() : null,
    });
  }

  const totalEstimated = preparedLines.reduce((s, l) => s + l.lineTotal, 0);
  const requestNumber = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto
    .randomBytes(2)
    .toString("hex")
    .toUpperCase()}`;

  const created = await prisma.$transaction(async (tx) => {
    const reqRecord = await tx.clientGoodsRequest.create({
      data: {
        requestNumber,
        clientAccountId: account.id,
        customerId: account.customerId,
        status: "PENDING_REVIEW",
        pickupType: pickupTypeRaw === "BRANCH" || pickupTypeRaw === "WAREHOUSE" || pickupTypeRaw === "OTHER" ? pickupTypeRaw : "MARKET",
        pickupLocation: resolvedPickupLocation,
        pickupNotes: params.pickupNotes?.trim() || null,
        customDataJson: JSON.stringify(params.customData || {}),
        totalEstimated,
        totalConfirmed: 0,
        currency: "YER",
        lines: { create: preparedLines },
      },
      include: { lines: { orderBy: { lineOrder: "asc" } } },
    });

    const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
    const linesSummary = preparedLines
      .map(
        (l) =>
          `- ${l.itemTitle}: ${l.requestedQty} ${
            l.unitCode === "OTHER" && l.customUnitLabel ? l.customUnitLabel : l.unitLabel
          }`
      )
      .join("\n");

    await createWhatsAppDraftTx(tx, {
      eventType: "REQUEST_RECEIVED",
      clientAccountId: account.id,
      customerId: account.customerId,
      requestId: reqRecord.id,
      recipientName: account.fullName,
      recipientPhone: account.phone,
      variables: {
        companyName: profile?.legalNameAr || "المنشأة",
        requestNumber: reqRecord.requestNumber,
        pickupLocation: reqRecord.pickupLocation,
        linesSummary,
        totalAmount: totalEstimated.toLocaleString("en-US"),
        currency: "YER",
      },
    });

    return reqRecord;
  });

  await emitNotification({
    eventType: "SYSTEM_ALERT",
    severity: "INFO",
    titleAr: `طلب استلام جديد (${requestNumber})`,
    titleEn: `New Client Pickup Request (${requestNumber})`,
    messageAr: `العميل ${account.fullName} أرسل طلب استلام من (${resolvedPickupLocation}) بعدد ${preparedLines.length} صنف.`,
    messageEn: `Client ${account.fullName} submitted request ${requestNumber} (${resolvedPickupLocation}).`,
    targetTab: "customers",
    targetEntityType: "ClientGoodsRequest",
    targetEntityId: created.id,
  }).catch(() => null);

  return serializeRequest(created);
}

export function serializeRequest(req: {
  id: string;
  requestNumber: string;
  clientAccountId: string;
  customerId: string | null;
  status: string;
  pickupType: string;
  pickupLocation: string;
  pickupNotes: string | null;
  customDataJson: string;
  reserveStock: boolean;
  reservedSummaryJson: string;
  totalEstimated: unknown;
  totalConfirmed: unknown;
  currency: string;
  projectId: string | null;
  subProjectId: string | null;
  harvestName: string | null;
  linkedInvoiceId: string | null;
  linkedSaleId: string | null;
  linkedReceiptId: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  readyAt: Date | null;
  handedOverByName: string | null;
  handedOverAt: Date | null;
  staffNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  clientAccount?: {
    id: string;
    fullName: string;
    tradeName: string | null;
    phone: string;
    email: string;
    clientType: string;
    customerId: string | null;
  } | null;
  lines: Array<{
    id: string;
    lineOrder: number;
    itemId: string | null;
    itemTitle: string;
    requestedQty: unknown;
    confirmedQty: unknown;
    unitCode: string;
    unitLabel: string;
    customUnitLabel: string | null;
    unitPrice: unknown;
    lineTotal: unknown;
    notes: string | null;
  }>;
}) {
  let customData: Record<string, unknown> = {};
  let reservedSummary: unknown[] = [];
  try {
    customData = JSON.parse(req.customDataJson || "{}") as Record<string, unknown>;
  } catch {
    customData = {};
  }
  try {
    reservedSummary = JSON.parse(req.reservedSummaryJson || "[]") as unknown[];
  } catch {
    reservedSummary = [];
  }

  return {
    id: req.id,
    requestNumber: req.requestNumber,
    clientAccountId: req.clientAccountId,
    customerId: req.customerId,
    status: req.status,
    statusLabelAr: REQUEST_STATUS_LABELS_AR[req.status] || req.status,
    pickupType: req.pickupType,
    pickupLocation: req.pickupLocation,
    pickupNotes: req.pickupNotes,
    customData,
    reserveStock: req.reserveStock,
    reservedSummary,
    totalEstimated: Number(req.totalEstimated || 0),
    totalConfirmed: Number(req.totalConfirmed || 0),
    currency: req.currency || "YER",
    projectId: req.projectId,
    subProjectId: req.subProjectId,
    harvestName: req.harvestName,
    linkedInvoiceId: req.linkedInvoiceId,
    linkedSaleId: req.linkedSaleId,
    linkedReceiptId: req.linkedReceiptId,
    reviewedByName: req.reviewedByName,
    reviewedAt: req.reviewedAt ? req.reviewedAt.toISOString() : null,
    readyAt: req.readyAt ? req.readyAt.toISOString() : null,
    handedOverByName: req.handedOverByName,
    handedOverAt: req.handedOverAt ? req.handedOverAt.toISOString() : null,
    staffNotes: req.staffNotes,
    createdAt: req.createdAt.toISOString(),
    updatedAt: req.updatedAt.toISOString(),
    clientAccount: req.clientAccount
      ? {
          id: req.clientAccount.id,
          fullName: req.clientAccount.fullName,
          tradeName: req.clientAccount.tradeName,
          phone: req.clientAccount.phone,
          email: req.clientAccount.email,
          clientType: req.clientAccount.clientType,
          customerId: req.clientAccount.customerId,
        }
      : undefined,
    lines: req.lines.map((l) => ({
      id: l.id,
      lineOrder: l.lineOrder,
      itemId: l.itemId,
      itemTitle: l.itemTitle,
      requestedQty: Number(l.requestedQty || 0),
      confirmedQty: l.confirmedQty !== null && l.confirmedQty !== undefined ? Number(l.confirmedQty) : null,
      unitCode: l.unitCode,
      unitLabel: l.unitLabel,
      customUnitLabel: l.customUnitLabel,
      displayUnitLabel:
        l.unitCode === "OTHER" && l.customUnitLabel ? l.customUnitLabel : l.unitLabel,
      unitPrice: Number(l.unitPrice || 0),
      lineTotal: Number(l.lineTotal || 0),
      notes: l.notes,
    })),
  };
}

/**
 * Strictly client-scoped financial summary, bills, and running-balance statement.
 * Zero internal cost/COGS/vendor/other-client leakage.
 */
export async function getClientPortalFinancialSnapshot(params: {
  customerId: string | null;
  fromDate?: string;
  toDate?: string;
}) {
  if (!params.customerId) {
    return {
      summary: {
        creditLimit: 0,
        totalInvoiced: 0,
        totalPaid: 0,
        totalUnpaid: 0,
        creditAvailable: null as number | null,
        currency: "YER",
      },
      bills: [],
      statementRows: [],
    };
  }

  const [customer, invoices, receipts, sales] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, code: true, nameAr: true, creditLimit: true },
    }),
    prisma.salesInvoice.findMany({
      where: {
        customerId: params.customerId,
        status: { not: "VOIDED" },
        documentStatus: { not: "VOIDED" },
      },
      include: { items: true },
      orderBy: { date: "desc" },
    }),
    prisma.receiptVoucher.findMany({
      where: { customerId: params.customerId },
      orderBy: { date: "asc" },
    }),
    prisma.saleTransaction.findMany({
      where: { customerId: params.customerId },
      orderBy: { saleDate: "asc" },
    }),
  ]);

  const creditLimit = Number(customer?.creditLimit || 0);
  const totalInvoicedFromInv = invoices.reduce((s, inv) => s + Number(inv.totalAmount || 0), 0);
  const totalPaidFromInv = invoices.reduce((s, inv) => s + Number(inv.paidAmount || 0), 0);
  const totalUnpaidFromInv = invoices.reduce((s, inv) => s + Number(inv.balanceDue || 0), 0);

  // Include direct POS/cash sales that weren't tied to an invoice yet when counting legacy/POS ledger rows
  const invoiceNumbers = new Set(invoices.map((i) => i.invoiceNumber));
  const standaloneSales = sales.filter((s) => !s.sequenceNumber || !invoiceNumbers.has(s.sequenceNumber));

  const standaloneTotal = standaloneSales.reduce((s, r) => s + Number(r.totalAmount || 0), 0);
  const standalonePaid = standaloneSales.reduce((s, r) => s + Number(r.creditPaid || 0), 0);
  const standaloneDue = standaloneSales.reduce((s, r) => s + Number(r.debitReceivable || 0), 0);

  const totalInvoiced = Math.round((totalInvoicedFromInv + standaloneTotal) * 100) / 100;
  const totalPaid = Math.round((totalPaidFromInv + standalonePaid) * 100) / 100;
  const totalUnpaid = Math.round((totalUnpaidFromInv + standaloneDue) * 100) / 100;
  const creditAvailable = creditLimit > 0 ? Math.max(0, Math.round((creditLimit - totalUnpaid) * 100) / 100) : null;

  const bills = invoices.map((inv) => {
    const paid = Number(inv.paidAmount || 0);
    const due = Number(inv.balanceDue || 0);
    const total = Number(inv.totalAmount || 0);
    const billStatus =
      due <= 0.005 ? "PAID" : paid > 0.005 ? "PARTIALLY_PAID" : "UNPAID";
    const billStatusAr =
      billStatus === "PAID"
        ? "مسددة"
        : billStatus === "PARTIALLY_PAID"
        ? "مدفوعة جزئياً"
        : "غير مسددة";

    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: inv.date.toISOString().slice(0, 10),
      dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
      currency: inv.currency || "YER",
      totalAmount: total,
      paidAmount: paid,
      balanceDue: due,
      billStatus,
      billStatusAr,
      notes: inv.notes || "",
      items: inv.items.map((it) => ({
        description: it.description,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        totalAmount: Number(it.totalAmount),
      })),
    };
  });

  // Build chronological statement events (Invoices as debit, Receipts/Immediate POS paid as credit)
  const rawEvents: Array<{
    id: string;
    date: string;
    reference: string;
    typeAr: string;
    description: string;
    debit: number;
    credit: number;
    currency: string;
  }> = [];

  for (const inv of invoices) {
    rawEvents.push({
      id: `inv-${inv.id}`,
      date: inv.date.toISOString().slice(0, 10),
      reference: inv.invoiceNumber,
      typeAr: "فاتورة مبيعات",
      description: inv.notes || `فاتورة مبيعات رقم ${inv.invoiceNumber}`,
      debit: Number(inv.totalAmount || 0),
      credit: 0,
      currency: inv.currency || "YER",
    });
  }

  for (const rc of receipts) {
    rawEvents.push({
      id: `rcp-${rc.id}`,
      date: rc.date.toISOString().slice(0, 10),
      reference: rc.voucherNumber,
      typeAr: "سند قبض",
      description: rc.notes || `سداد نقدي / تحصيل بسند ${rc.voucherNumber}`,
      debit: 0,
      credit: Number(rc.amount || 0),
      currency: rc.currency || "YER",
    });
  }

  for (const sl of standaloneSales) {
    rawEvents.push({
      id: `sale-${sl.id}`,
      date: sl.saleDate.slice(0, 10),
      reference: sl.receiptVoucherNo || sl.sequenceNumber || sl.id.slice(0, 8),
      typeAr: "عملية بيع",
      description: `${sl.productGrade} (${sl.bundlesCount})`,
      debit: Number(sl.totalAmount || 0),
      credit: Number(sl.creditPaid || 0),
      currency: "YER",
    });
  }

  rawEvents.sort((a, b) => a.date.localeCompare(b.date));

  let running = 0;
  const statementRows = rawEvents
    .map((ev) => {
      running = Math.round((running + ev.debit - ev.credit) * 100) / 100;
      return { ...ev, runningBalance: running };
    })
    .filter((row) => {
      if (params.fromDate && row.date < params.fromDate) return false;
      if (params.toDate && row.date > params.toDate) return false;
      return true;
    });

  return {
    summary: {
      creditLimit,
      totalInvoiced,
      totalPaid,
      totalUnpaid,
      creditAvailable,
      currency: "YER",
    },
    bills,
    statementRows,
  };
}

export async function staffReviewClientRegistration(params: {
  clientAccountId: string;
  action: "APPROVE" | "REJECT" | "SUSPEND";
  creditLimit?: number;
  linkCustomerId?: string;
  rejectedReason?: string;
  notes?: string;
  portalUrl?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const existing = await prisma.clientPortalAccount.findUnique({
    where: { id: params.clientAccountId },
  });
  if (!existing) throw new Error("CLIENT_ACCOUNT_NOT_FOUND");

  const updated = await prisma.$transaction(async (tx) => {
    let customerId = existing.customerId;
    let effectiveCreditLimit = 0;

    if (params.action === "APPROVE") {
      await ensure6GenerationCoaHierarchy(tx);
      if (params.linkCustomerId) {
        const chosen = await tx.customer.findUnique({ where: { id: params.linkCustomerId } });
        if (!chosen) throw new Error("TARGET_CUSTOMER_NOT_FOUND");
        customerId = chosen.id;
        if (typeof params.creditLimit === "number" && params.creditLimit >= 0) {
          await tx.customer.update({
            where: { id: chosen.id },
            data: { creditLimit: params.creditLimit },
          });
          effectiveCreditLimit = params.creditLimit;
        } else {
          effectiveCreditLimit = Number(chosen.creditLimit || 0);
        }
      } else if (!customerId) {
        const byPhone = await tx.customer.findFirst({ where: { phone: existing.phone } });
        const cust =
          byPhone ||
          (await ensureCustomerWithAccountTx(tx, {
            name: existing.tradeName || existing.fullName,
            phone: existing.phone,
          }));
        customerId = cust.id;
        if (typeof params.creditLimit === "number" && params.creditLimit >= 0) {
          await tx.customer.update({
            where: { id: cust.id },
            data: { creditLimit: params.creditLimit },
          });
          effectiveCreditLimit = params.creditLimit;
        } else {
          effectiveCreditLimit = Number(cust.creditLimit || 0);
        }
      }

      const acc = await tx.clientPortalAccount.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          customerId,
          approvedById: params.actor.userId ?? null,
          approvedByName: params.actor.userDisplay,
          approvedAt: new Date(),
          rejectedReason: null,
          notes: params.notes !== undefined ? params.notes.trim() || null : existing.notes,
        },
      });

      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      await createWhatsAppDraftTx(tx, {
        eventType: "CLIENT_APPROVED",
        clientAccountId: acc.id,
        customerId,
        recipientName: acc.fullName,
        recipientPhone: acc.phone,
        variables: {
          companyName: profile?.legalNameAr || "المنشأة",
          portalUrl: params.portalUrl || "https://qat.world",
        },
      });

      await appendAuditLogTx(tx, {
        userId: params.actor.userId,
        userDisplay: params.actor.userDisplay,
        userRole: params.actor.userRole,
        actionType: "CLIENT_PORTAL_APPROVED",
        entityReference: acc.id,
        details: `اعتماد حساب العميل (${acc.fullName}) وربطه بالعميل المحاسبي ${customerId} بحد ائتماني ${effectiveCreditLimit}`,
      });

      return { acc, creditLimit: effectiveCreditLimit };
    }

    const nextStatus = params.action === "SUSPEND" ? "SUSPENDED" : "REJECTED";
    const acc = await tx.clientPortalAccount.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        rejectedReason: params.rejectedReason?.trim() || "غير مستوفٍ للشروط حالياً",
        approvedById: params.actor.userId ?? null,
        approvedByName: params.actor.userDisplay,
      },
    });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: `CLIENT_PORTAL_${nextStatus}`,
      entityReference: acc.id,
      details: `${nextStatus} حساب العميل (${acc.fullName}): ${acc.rejectedReason || ""}`,
    });

    return { acc, creditLimit: 0 };
  });

  return sanitizeClientAccount(updated.acc, updated.creditLimit);
}

export async function staffProcessGoodsRequest(params: {
  requestId: string;
  action: "CONFIRM" | "MARK_READY" | "HANDOVER" | "REJECT" | "CANCEL";
  projectId?: string;
  subProjectId?: string | null;
  harvestName?: string;
  treasuryId?: string | null;
  immediatePaidAmount?: number;
  reserveStock?: boolean;
  overrideCreditLimit?: boolean;
  staffNotes?: string;
  lines?: Array<{
    id: string;
    confirmedQty?: number;
    unitPrice?: number;
  }>;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const reqRecord = await prisma.clientGoodsRequest.findUnique({
    where: { id: params.requestId },
    include: {
      clientAccount: true,
      lines: { orderBy: { lineOrder: "asc" } },
    },
  });
  if (!reqRecord) throw new Error("REQUEST_NOT_FOUND");
  if (reqRecord.status === "COMPLETED") {
    throw new Error("REQUEST_ALREADY_COMPLETED");
  }

  if (params.action === "REJECT" || params.action === "CANCEL") {
    const nextStatus = params.action === "REJECT" ? "REJECTED" : "CANCELLED";
    const updated = await prisma.$transaction(async (tx) => {
      const rec = await tx.clientGoodsRequest.update({
        where: { id: reqRecord.id },
        data: {
          status: nextStatus,
          staffNotes: params.staffNotes?.trim() || reqRecord.staffNotes,
          reviewedById: params.actor.userId ?? null,
          reviewedByName: params.actor.userDisplay,
          reviewedAt: new Date(),
        },
        include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
      });
      await appendAuditLogTx(tx, {
        userId: params.actor.userId,
        userDisplay: params.actor.userDisplay,
        userRole: params.actor.userRole,
        actionType: `CLIENT_REQUEST_${nextStatus}`,
        entityReference: reqRecord.requestNumber,
        details: `تحويل طلب العميل ${reqRecord.requestNumber} إلى ${nextStatus}`,
      });
      return rec;
    });
    return serializeRequest(updated);
  }

  // Compute confirmed line totals from staff overrides or existing values
  const linePatchMap = new Map(
    (params.lines || []).map((lp) => [lp.id, lp])
  );
  const updatedLinesData = reqRecord.lines.map((line) => {
    const patch = linePatchMap.get(line.id);
    const cQty =
      patch?.confirmedQty !== undefined
        ? Number(patch.confirmedQty)
        : line.confirmedQty !== null && line.confirmedQty !== undefined
        ? Number(line.confirmedQty)
        : Number(line.requestedQty);
    const uPrice =
      patch?.unitPrice !== undefined ? Number(patch.unitPrice) : Number(line.unitPrice);
    const lTotal = Math.round(cQty * uPrice * 100) / 100;
    return {
      ...line,
      confirmedQty: Math.max(0, cQty),
      unitPrice: Math.max(0, uPrice),
      lineTotal: Math.max(0, lTotal),
    };
  });
  const totalConfirmed =
    Math.round(updatedLinesData.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

  if (params.action === "CONFIRM" || params.action === "MARK_READY") {
    const nextStatus = params.action === "MARK_READY" ? "READY_FOR_PICKUP" : "CONFIRMED";
    const reserveStock = Boolean(params.reserveStock ?? reqRecord.reserveStock);
    const reservedSummary: Array<{ itemId: string; itemTitle: string; qty: number }> = [];

    if (reserveStock) {
      for (const l of updatedLinesData) {
        if (!l.itemId || l.confirmedQty <= 0) continue;
        const balances = await prisma.stockBalance.findMany({ where: { itemId: l.itemId } });
        const totalAvail = balances.reduce((s, b) => s + Number(b.qtyOnHandBase || 0), 0);
        if (totalAvail > 0 && totalAvail + 0.001 < l.confirmedQty) {
          throw new Error(
            `الرصيد المخزني المتاح للصنف (${l.itemTitle}) هو ${totalAvail} فقط، أقل من الكمية المطلوبة (${l.confirmedQty})`
          );
        }
        reservedSummary.push({ itemId: l.itemId, itemTitle: l.itemTitle, qty: l.confirmedQty });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      for (const l of updatedLinesData) {
        await tx.clientGoodsRequestLine.update({
          where: { id: l.id },
          data: {
            confirmedQty: l.confirmedQty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          },
        });
      }

      const rec = await tx.clientGoodsRequest.update({
        where: { id: reqRecord.id },
        data: {
          status: nextStatus,
          reserveStock,
          reservedSummaryJson: JSON.stringify(reservedSummary),
          totalConfirmed,
          projectId: params.projectId ?? reqRecord.projectId,
          subProjectId: params.subProjectId ?? reqRecord.subProjectId,
          harvestName: params.harvestName ?? reqRecord.harvestName,
          staffNotes: params.staffNotes?.trim() || reqRecord.staffNotes,
          reviewedById: params.actor.userId ?? null,
          reviewedByName: params.actor.userDisplay,
          reviewedAt: reqRecord.reviewedAt || new Date(),
          ...(nextStatus === "READY_FOR_PICKUP" ? { readyAt: new Date() } : {}),
        },
        include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
      });

      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      await createWhatsAppDraftTx(tx, {
        eventType: nextStatus === "READY_FOR_PICKUP" ? "READY_FOR_PICKUP" : "REQUEST_CONFIRMED",
        clientAccountId: rec.clientAccountId,
        customerId: rec.customerId,
        requestId: rec.id,
        recipientName: rec.clientAccount.fullName,
        recipientPhone: rec.clientAccount.phone,
        variables: {
          companyName: profile?.legalNameAr || "المنشأة",
          requestNumber: rec.requestNumber,
          pickupLocation: rec.pickupLocation,
          totalAmount: totalConfirmed.toLocaleString("en-US"),
          currency: rec.currency || "YER",
        },
      });

      await appendAuditLogTx(tx, {
        userId: params.actor.userId,
        userDisplay: params.actor.userDisplay,
        userRole: params.actor.userRole,
        actionType: `CLIENT_REQUEST_${nextStatus}`,
        entityReference: rec.requestNumber,
        details: `تحديث حالة طلب العميل ${rec.requestNumber} إلى ${REQUEST_STATUS_LABELS_AR[nextStatus]} بإجمالي ${totalConfirmed}`,
      });

      return rec;
    });

    return serializeRequest(updated);
  }

  // HANDOVER ("تم الاستلام"): Post accounting SalesInvoice + SaleTransaction + optional ReceiptVoucher
  const effectiveTotal = totalConfirmed > 0 ? totalConfirmed : Number(reqRecord.totalEstimated || 0);
  if (effectiveTotal <= 0) {
    throw new Error("يرجى تحديد سعر وكمية مؤكدة أكبر من الصفر قبل إتمام التسليم وإصدار الفاتورة");
  }

  const paidImmediate = Math.max(0, Number(params.immediatePaidAmount || 0));
  if (paidImmediate > effectiveTotal + 0.01) {
    throw new Error("المبلغ المقبوض عند التسليم يتجاوز إجمالي الفاتورة");
  }

  const handoverResult = await prisma.$transaction(async (tx) => {
    await ensure6GenerationCoaHierarchy(tx);

    let customerId = reqRecord.customerId || reqRecord.clientAccount.customerId;
    if (!customerId) {
      const cust = await ensureCustomerWithAccountTx(tx, {
        name: reqRecord.clientAccount.tradeName || reqRecord.clientAccount.fullName,
        phone: reqRecord.clientAccount.phone,
      });
      customerId = cust.id;
      await tx.clientPortalAccount.update({
        where: { id: reqRecord.clientAccountId },
        data: { customerId: cust.id },
      });
    }

    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const targetProject =
      (params.projectId
        ? await tx.project.findUnique({ where: { id: params.projectId } })
        : null) ||
      (await tx.project.findFirst({ orderBy: { createdAt: "asc" } }));
    if (!targetProject) {
      throw new Error("لا يوجد مشروع فعال لربط فاتورة التسليم به");
    }

    for (const l of updatedLinesData) {
      await tx.clientGoodsRequestLine.update({
        where: { id: l.id },
        data: {
          confirmedQty: l.confirmedQty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        },
      });
    }

    const invoiceItems = updatedLinesData
      .filter((l) => l.confirmedQty > 0)
      .map((l) => ({
        description: `${l.itemTitle} (${
          l.unitCode === "OTHER" && l.customUnitLabel ? l.customUnitLabel : l.unitLabel
        })`,
        quantity: l.confirmedQty,
        unitPrice: l.unitPrice,
        itemId: l.itemId,
      }));

    const postedInvoice = await postSalesInvoice({
      tx,
      customerId: customer.id,
      projectId: targetProject.id,
      subProjectId: params.subProjectId || reqRecord.subProjectId || null,
      amount: effectiveTotal,
      items: invoiceItems,
      creditPaidImmediate: paidImmediate,
      overrideCreditLimit: Boolean(params.overrideCreditLimit),
      notes: `تسليم طلب بوابة العميل ${reqRecord.requestNumber} (${reqRecord.pickupLocation})`,
      createdById: params.actor.userId ?? undefined,
    });

    let linkedReceiptId: string | null = null;
    let receiptVoucherNo = postedInvoice.invoice.invoiceNumber;

    if (paidImmediate > 0) {
      const treasury =
        (params.treasuryId
          ? await tx.treasuryAccount.findUnique({ where: { id: params.treasuryId } })
          : null) || (await tx.treasuryAccount.findFirst({ orderBy: { code: "asc" } }));
      if (!treasury) throw new Error("يرجى اختيار خزينة/صندوق لتحصيل الدفعة النقدية");

      const rec = await postCustomerReceipt({
        tx,
        customerId: customer.id,
        invoiceId: postedInvoice.invoice.id,
        projectId: targetProject.id,
        subProjectId: params.subProjectId || reqRecord.subProjectId || null,
        treasuryId: treasury.id,
        amount: paidImmediate,
        notes: `تحصيل عند تسليم طلب البوابة ${reqRecord.requestNumber}`,
        createdById: params.actor.userId ?? undefined,
      });
      linkedReceiptId = rec.receipt.id;
      receiptVoucherNo = rec.receipt.voucherNumber;
    }

    const totalBundles = updatedLinesData.reduce((s, l) => s + Math.round(l.confirmedQty), 0);
    const firstGrade =
      updatedLinesData.map((l) => l.itemTitle).slice(0, 2).join(" / ") || "طلب عميل";

    const saleTx = await tx.saleTransaction.create({
      data: {
        sequenceNumber: postedInvoice.invoice.invoiceNumber,
        dailyBatchLabel: reqRecord.requestNumber,
        salesOfficerId: params.actor.userId ?? null,
        salesOfficerTitle: params.actor.userDisplay,
        projectId: targetProject.id,
        subProjectId: params.subProjectId || reqRecord.subProjectId || null,
        harvestName: params.harvestName || reqRecord.harvestName || "مبيعات بوابة العملاء",
        saleBatchLabel: reqRecord.requestNumber,
        customerId: customer.id,
        customerName: customer.nameAr,
        customerPhone: customer.phone || reqRecord.clientAccount.phone,
        productGrade: firstGrade,
        bundlesCount: Math.max(1, totalBundles),
        unitPrice: totalBundles > 0 ? Math.round((effectiveTotal / totalBundles) * 100) / 100 : effectiveTotal,
        totalAmount: effectiveTotal,
        creditPaid: paidImmediate,
        debitReceivable: Math.max(0, effectiveTotal - paidImmediate),
        saleDate: new Date().toISOString().slice(0, 10),
        receiptVoucherNo,
        notes: `تسليم طلب عميل ${reqRecord.requestNumber} من ${reqRecord.pickupLocation}`,
        journalEntryId: postedInvoice.journalEntry.id,
      },
    });

    const completedReq = await tx.clientGoodsRequest.update({
      where: { id: reqRecord.id },
      data: {
        status: "COMPLETED",
        customerId: customer.id,
        totalConfirmed: effectiveTotal,
        projectId: targetProject.id,
        subProjectId: params.subProjectId || reqRecord.subProjectId || null,
        harvestName: params.harvestName || reqRecord.harvestName || "مبيعات بوابة العملاء",
        linkedInvoiceId: postedInvoice.invoice.id,
        linkedSaleId: saleTx.id,
        linkedReceiptId,
        handedOverById: params.actor.userId ?? null,
        handedOverByName: params.actor.userDisplay,
        handedOverAt: new Date(),
        staffNotes: params.staffNotes?.trim() || reqRecord.staffNotes,
      },
      include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
    });

    const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
    await createWhatsAppDraftTx(tx, {
      eventType: "HANDOVER_INVOICE",
      clientAccountId: completedReq.clientAccountId,
      customerId: customer.id,
      requestId: completedReq.id,
      recipientName: completedReq.clientAccount.fullName,
      recipientPhone: completedReq.clientAccount.phone,
      variables: {
        companyName: profile?.legalNameAr || "المنشأة",
        requestNumber: completedReq.requestNumber,
        invoiceNumber: postedInvoice.invoice.invoiceNumber,
        totalAmount: effectiveTotal.toLocaleString("en-US"),
        paidAmount: paidImmediate.toLocaleString("en-US"),
        balanceDue: Math.max(0, effectiveTotal - paidImmediate).toLocaleString("en-US"),
        currency: completedReq.currency || "YER",
      },
    });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: "CLIENT_REQUEST_HANDOVER",
      entityReference: completedReq.requestNumber,
      details: `تسليم طلب العميل ${completedReq.requestNumber} وإصدار فاتورة ${postedInvoice.invoice.invoiceNumber} بمبلغ ${effectiveTotal} (مدفوع: ${paidImmediate})`,
    });

    return completedReq;
  });

  return serializeRequest(handoverResult);
}

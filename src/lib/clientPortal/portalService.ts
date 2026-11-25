import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, hashPassword, isHarvestLockedTx, verifyPassword } from "@/lib/serverBootstrap";
import { mapProjectIdToSalesRevenueCode } from "@/lib/accounting/coaCatalog";
import {
  ensureCustomerWithAccountTx,
  postCustomerReceipt,
  postJournalEntry,
  postSalesInvoice,
  reverseJournalEntry,
} from "@/lib/accounting/ledgerService";
import {
  allowedSectorsForMode,
  assertReturnEditAllowed,
  assertSectorAllowed,
  canClientLogin,
  forbiddenMessage,
  isSectorAllowed,
  lockedSectorForMode,
  nextAccountStatus,
  normalizeReturnEditPermissions,
  normalizeSectorMode,
  resolveEffectiveSectorMode,
  type ClientAccountAction,
  type SectorMode,
} from "@/lib/clientPortal/portalPolicy";
import { emitNotification } from "@/lib/notifications/notificationService";
import {
  consumeClientResetRateLimit,
  hashClientResetCode,
  normalizeClientEmail,
  normalizeClientPhone,
  verifyClientResetCode,
} from "@/lib/clientPortal/clientAuth";
import {
  ensureGlobalClientIdentityAndMembership,
  getGlobalClientIdentityById,
  syncGlobalClientMembershipStatus,
  syncGlobalClientPasswordHash,
} from "@/lib/clientPortal/globalClientService";
import { getActiveTenantId, getActiveTenantSlug } from "@/lib/tenant/tenantContext";
import { getTenantFormConfig } from "@/lib/clientPortal/portalConfig";
import { createWhatsAppDraftTx } from "@/lib/whatsapp/outboxService";
import { ensure6GenerationCoaHierarchy } from "@/lib/accountingCoreEngine";
import { computeSaleTotals } from "@/lib/formulas";
import { dAdd, dDiv, dMul, dSub, round4Decimal as round4 } from "@/lib/decimalMath";
import { resolveTenantCloudUrl } from "@/lib/serverConnection";
import {
  formatIsoToDmy,
  formatIsoToDmyTime,
  formatIsoToTimeHm,
} from "@/lib/uiFormatters";
import {
  canArchiveOrHideRequest,
  canClientCancelRequest,
  canSafelyDeleteRequest,
} from "@/lib/clientPortal/orderLineBuilder";
import {
  deductPublishedCatalogStockForLinesTx,
  syncPublishedCatalogStockTx,
} from "@/lib/clientPortal/catalogStockSync";
import type {
  AmendmentDiffEntry,
  RequestAmendmentSnapshot,
} from "@/lib/clientPortal/portalTypes";

export type { AmendmentDiffEntry, RequestAmendmentSnapshot };

export const REQUEST_STATUS_LABELS_AR: Record<string, string> = {
  PENDING_REVIEW: "قيد المراجعة",
  RETURNED_TO_CLIENT: "معاد للموافقة",
  CONFIRMED: "مؤكد",
  READY_FOR_PICKUP: "جاهز للاستلام",
  COMPLETED: "تم الاستلام",
  CANCELLED: "ملغى",
  REJECTED: "مرفوض",
};

export const CLIENT_RESPONSE_STATUS_LABELS_AR: Record<string, string> = {
  PENDING_STAFF_APPROVAL: "بانتظار اعتماد الموظف",
  PENDING_CLIENT_APPROVAL: "معاد للعميل للموافقة",
  CLIENT_APPROVED: "وافق العميل على التعديلات",
  CLIENT_DECLINED: "طلب العميل إعادة المراجعة",
  STAFF_APPROVED: "معتمد من الموظف",
  STAFF_AMENDED_POST_HANDOVER: "معدل مع تحديث الفاتورة والمبيعات",
};

export interface ClientSafeAccountView {
  id: string;
  tenantSlug: string;
  globalClientId: string | null;
  customerId: string | null;
  fullName: string;
  tradeName: string | null;
  phone: string;
  normalizedPhone: string;
  email: string;
  normalizedEmail: string;
  avatarUrl: string;
  avatarColor: string;
  avatarChar: string;
  mustChangePassword: boolean;
  passwordUpdatedAt: string | null;
  deviceLimit: number;
  clientType: string;
  customClientType: string | null;
  preferredPickup: string;
  customFields: Record<string, unknown>;
  status: string;
  sectorMode: string;
  suspendedAt: string | null;
  archivedAt: string | null;
  notes: string | null;
  creditLimit: number;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
}

export function sanitizeClientAccount(
  acc: {
    id: string;
    tenantSlug?: string | null;
    globalClientId?: string | null;
    customerId: string | null;
    fullName: string;
    tradeName: string | null;
    phone: string;
    normalizedPhone?: string | null;
    email: string;
    normalizedEmail?: string | null;
    avatarUrl?: string | null;
    avatarColor?: string | null;
    mustChangePassword?: boolean;
    passwordUpdatedAt?: Date | null;
    deviceLimit?: number | null;
    clientType: string;
    customClientType: string | null;
    preferredPickup: string;
    customFieldsJson: string;
    status: string;
    sectorMode?: string | null;
    suspendedAt?: Date | null;
    archivedAt?: Date | null;
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
  const cleanName = acc.fullName.trim();
  const resolvedSlug = (acc.tenantSlug || getActiveTenantSlug() || "default").trim().toLowerCase();
  return {
    id: acc.id,
    tenantSlug: resolvedSlug,
    globalClientId: acc.globalClientId ?? null,
    customerId: acc.customerId,
    fullName: acc.fullName,
    tradeName: acc.tradeName,
    phone: acc.phone,
    normalizedPhone: acc.normalizedPhone || acc.phone,
    email: acc.email,
    normalizedEmail: acc.normalizedEmail || acc.email.trim().toLowerCase(),
    avatarUrl: acc.avatarUrl ?? "",
    avatarColor: acc.avatarColor || "#059669",
    avatarChar: cleanName.charAt(0) || "ع",
    mustChangePassword: Boolean(acc.mustChangePassword),
    passwordUpdatedAt: acc.passwordUpdatedAt ? acc.passwordUpdatedAt.toISOString() : null,
    deviceLimit: Number(acc.deviceLimit || 3),
    clientType: acc.clientType,
    customClientType: acc.customClientType,
    preferredPickup: acc.preferredPickup,
    customFields,
    status: acc.status,
    sectorMode: String(acc.sectorMode || "INHERIT").toUpperCase(),
    suspendedAt: acc.suspendedAt ? acc.suspendedAt.toISOString() : null,
    archivedAt: acc.archivedAt ? acc.archivedAt.toISOString() : null,
    notes: acc.notes,
    creditLimit,
    approvedAt: acc.approvedAt ? acc.approvedAt.toISOString() : null,
    rejectedReason: acc.rejectedReason,
    createdAt: acc.createdAt.toISOString(),
  };
}

export async function findClientAccountByIdentifier(rawIdentifier: string, tenantSlug?: string) {
  const idRaw = String(rawIdentifier || "").trim();
  if (!idRaw) return null;
  const effectiveSlug = (tenantSlug || getActiveTenantSlug() || "default").trim().toLowerCase();

  if (idRaw.includes("@")) {
    const emailNorm = normalizeClientEmail(idRaw);
    if (!emailNorm.valid) return null;
    return prisma.clientPortalAccount.findFirst({
      where: {
        tenantSlug: effectiveSlug,
        OR: [{ normalizedEmail: emailNorm.normalized }, { email: emailNorm.normalized }],
      },
    });
  }
  const phoneNorm = normalizeClientPhone(idRaw);
  if (!phoneNorm.valid) return null;
  return prisma.clientPortalAccount.findFirst({
    where: {
      tenantSlug: effectiveSlug,
      OR: [{ normalizedPhone: phoneNorm.normalized }, { phone: phoneNorm.normalized }],
    },
  });
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
  tenantSlug?: string;
  tenantId?: string;
  tenantName?: string;
  skipGlobalPasswordCheck?: boolean;
  /** Optional sector preference selected at self-registration (honoured only within the tenant default). */
  sectorPreference?: string;
}) {
  const registrationSectorMode = await resolveRegistrationSectorMode(params.sectorPreference);
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

  const effectiveSlug = (params.tenantSlug || getActiveTenantSlug() || "default").trim().toLowerCase();
  const effectiveTenantId = params.tenantId || getActiveTenantId() || "default";

  const [existingPhone, existingEmail] = await Promise.all([
    prisma.clientPortalAccount.findFirst({
      where: {
        tenantSlug: effectiveSlug,
        OR: [{ normalizedPhone: phoneCheck.normalized }, { phone: phoneCheck.normalized }],
      },
    }),
    prisma.clientPortalAccount.findFirst({
      where: {
        tenantSlug: effectiveSlug,
        OR: [{ normalizedEmail: emailCheck.normalized }, { email: emailCheck.normalized }],
      },
    }),
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
  const preAccountId = crypto.randomUUID();

  // Ensure or verify Global Client Identity BEFORE creating tenant membership
  const globalRes = await ensureGlobalClientIdentityAndMembership({
    normalizedPhone: phoneCheck.normalized,
    normalizedEmail: emailCheck.normalized,
    fullName,
    tradeName,
    rawPassword,
    passwordHash,
    tenantSlug: effectiveSlug,
    tenantId: effectiveTenantId,
    tenantName: params.tenantName,
    clientAccountId: preAccountId,
    status: autoApprove ? "ACTIVE" : "PENDING_APPROVAL",
    skipPasswordVerification: params.skipGlobalPasswordCheck,
  });

  const result = await prisma.$transaction(async (tx) => {
    let linkedCustomerId: string | null = null;
    let creditLimit = 0;

    if (autoApprove) {
      await ensure6GenerationCoaHierarchy(tx);
      const cust = await ensureCustomerWithAccountTx(tx, {
        name: tradeName || fullName,
        phone: phoneCheck.normalized,
      });
      await tx.customer.update({
        where: { id: cust.id },
        data: { tenantSlug: effectiveSlug },
      }).catch(() => { });
      linkedCustomerId = cust.id;
      creditLimit = Number(cust.creditLimit || 0);
    }

    const account = await tx.clientPortalAccount.create({
      data: {
        id: preAccountId,
        tenantSlug: effectiveSlug,
        globalClientId: globalRes.globalClientId,
        customerId: linkedCustomerId,
        fullName,
        tradeName,
        phone: phoneCheck.normalized,
        normalizedPhone: phoneCheck.normalized,
        email: emailCheck.normalized,
        normalizedEmail: emailCheck.normalized,
        passwordHash,
        clientType,
        customClientType,
        preferredPickup,
        customFieldsJson,
        status: autoApprove ? "ACTIVE" : "PENDING_APPROVAL",
        sectorMode: registrationSectorMode,
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
      details: `[tenant:${effectiveSlug}] تسجيل عميل جديد في البوابة: ${fullName} (${phoneCheck.normalized} / ${emailCheck.normalized}) — الحالة: ${account.status}`,
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
          portalUrl: params.portalUrl || `${resolveTenantCloudUrl(effectiveSlug === "default" ? profile?.tenantSlug : effectiveSlug)}/portal`,
        },
      });
    }

    return { account, creditLimit };
  });

  if (autoApprove && result.account.customerId) {
    await syncGlobalClientMembershipStatus({
      globalClientId: globalRes.globalClientId,
      tenantSlug: effectiveSlug,
      tenantId: effectiveTenantId,
      clientAccountId: result.account.id,
      customerId: result.account.customerId,
      normalizedPhone: phoneCheck.normalized,
      normalizedEmail: emailCheck.normalized,
      status: result.account.status,
      creditLimit: result.creditLimit,
    });
  }

  await emitNotification({
    eventType: "SYSTEM_ALERT",
    severity: "INFO",
    titleAr: "تسجيل عميل جديد في البوابة",
    titleEn: "New Client Portal Registration",
    messageAr: `سجل العميل ${fullName} (${phoneCheck.normalized}) — ${autoApprove ? "مفعل تلقائياً" : "بانتظار الاعتماد"
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
  tenantSlug?: string;
  tenantId?: string;
}) {
  const idRaw = String(params.identifier || "").trim();
  const password = String(params.password || "");
  if (!idRaw || !password) {
    throw new Error("يرجى إدخال رقم الجوال أو البريد الإلكتروني وكلمة المرور");
  }

  const effectiveSlug = (params.tenantSlug || getActiveTenantSlug() || "default").trim().toLowerCase();
  const account = await findClientAccountByIdentifier(idRaw, effectiveSlug);
  if (!account) {
    throw new Error("بيانات الدخول غير صحيحة");
  }

  let passwordValid = verifyPassword(password, account.passwordHash);
  let syncedHash: string | undefined;
  if (!passwordValid && account.globalClientId) {
    const globalIdentity = await getGlobalClientIdentityById(account.globalClientId).catch(() => null);
    if (globalIdentity && verifyPassword(password, globalIdentity.passwordHash)) {
      passwordValid = true;
      syncedHash = globalIdentity.passwordHash;
    }
  }
  if (!passwordValid) {
    throw new Error("بيانات الدخول غير صحيحة");
  }

  if (account.status === "REJECTED") {
    throw new Error(account.rejectedReason || "تم رفض هذا الحساب من قبل المنشأة");
  }
  const loginGate = canClientLogin(account.status);
  if (!loginGate.ok) {
    throw new Error(loginGate.message || "تعذر تسجيل الدخول لهذا الحساب");
  }

  const updated = await prisma.clientPortalAccount.update({
    where: { id: account.id },
    data: {
      lastLoginAt: new Date(),
      ...(syncedHash ? { passwordHash: syncedHash } : {}),
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

  return {
    ...sanitizeClientAccount(updated, creditLimit),
    sessionVersion: updated.sessionVersion ?? 1,
  };
}

  export async function updateClientPortalProfile(
    clientAccountId: string,
    patch: {
      fullName?: string;
      tradeName?: string;
      email?: string;
      preferredPickup?: string;
      avatarColor?: string;
      customFields?: Record<string, unknown>;
      notes?: string;
      newPassword?: string;
      currentPassword?: string;
    }
  ) {
    const existing = await prisma.clientPortalAccount.findUnique({ where: { id: clientAccountId } });
    if (!existing) throw new Error("ACCOUNT_NOT_FOUND");
    const effectiveSlug = (existing.tenantSlug || getActiveTenantSlug() || "default").trim().toLowerCase();

    let nextEmail = existing.email;
    let nextNormEmail = existing.normalizedEmail || existing.email.trim().toLowerCase();
    if (patch.email && patch.email.trim().toLowerCase() !== existing.email) {
      const chk = normalizeClientEmail(patch.email);
      if (!chk.valid) throw new Error(chk.error || "البريد الإلكتروني غير صحيح");
      const conflict = await prisma.clientPortalAccount.findFirst({
        where: {
          tenantSlug: effectiveSlug,
          OR: [{ normalizedEmail: chk.normalized }, { email: chk.normalized }],
        },
      });
      if (conflict && conflict.id !== existing.id) {
        throw new Error("البريد الإلكتروني مستخدم لحساب آخر");
      }
      nextEmail = chk.normalized;
      nextNormEmail = chk.normalized;
    }

    let nextHash = existing.passwordHash;
    let passwordChanged = false;
    if (patch.newPassword && patch.newPassword.trim()) {
      if (!patch.currentPassword || !verifyPassword(patch.currentPassword, existing.passwordHash)) {
        throw new Error("كلمة المرور الحالية غير صحيحة");
      }
      if (patch.newPassword.trim().length < 4) {
        throw new Error("كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل");
      }
      nextHash = hashPassword(patch.newPassword.trim());
      passwordChanged = true;
    }

    const cleanColor =
      patch.avatarColor && /^#[0-9a-fA-F]{6}$/.test(patch.avatarColor.trim())
        ? patch.avatarColor.trim()
        : existing.avatarColor || "#059669";

    let mergedCustom: Record<string, unknown> = {};
    try {
      mergedCustom = JSON.parse(existing.customFieldsJson || "{}") as Record<string, unknown>;
    } catch {
      mergedCustom = {};
    }
    if (patch.customFields && typeof patch.customFields === "object") {
      mergedCustom = { ...mergedCustom, ...patch.customFields };
    }

    const now = new Date();
    const updated = await prisma.clientPortalAccount.update({
      where: { id: existing.id },
      data: {
        fullName: patch.fullName?.trim() ? patch.fullName.trim() : existing.fullName,
        tradeName: patch.tradeName !== undefined ? patch.tradeName.trim() || null : existing.tradeName,
        email: nextEmail,
        normalizedEmail: nextNormEmail,
        preferredPickup:
          patch.preferredPickup !== undefined
            ? patch.preferredPickup.trim() || existing.preferredPickup
            : existing.preferredPickup,
        avatarColor: cleanColor,
        customFieldsJson: JSON.stringify(mergedCustom),
        notes: patch.notes !== undefined ? patch.notes.trim() || null : existing.notes,
        passwordHash: nextHash,
        ...(passwordChanged
          ? {
            mustChangePassword: false,
            passwordUpdatedAt: now,
            sessionVersion: { increment: 1 },
          }
          : {}),
      },
    });

    if (passwordChanged) {
      await prisma.clientPasswordResetToken.updateMany({
        where: { clientAccountId: updated.id, usedAt: null },
        data: { usedAt: now },
      });
      await syncGlobalClientPasswordHash({
        globalClientId: updated.globalClientId,
        normalizedPhone: updated.normalizedPhone || updated.phone,
        normalizedEmail: updated.normalizedEmail || updated.email,
        passwordHash: nextHash,
      });
    }

    let creditLimit = 0;
    if (updated.customerId) {
      const cust = await prisma.customer.findUnique({
        where: { id: updated.customerId },
        select: { creditLimit: true },
      });
      creditLimit = Number(cust?.creditLimit || 0);
    }

    return {
      account: sanitizeClientAccount(updated, creditLimit),
      passwordChanged,
      sessionVersion: updated.sessionVersion ?? 1,
    };
  }

  interface RawClientRequestLineInput {
    id?: string | null;
    catalogBoardItemId?: string | null;
    itemId?: string | null;
    itemTitle: string;
    requestedQty: number;
    unitCode: string;
    unitLabel: string;
    customUnitLabel?: string | null;
    unitPrice?: number | null;
    saleMode?: string | null;
    notes?: string | null;
  }

  async function prepareValidatedRequestLines(
    rawLines: RawClientRequestLineInput[],
    opts?: { allowProposedPrice?: boolean; allowedLineIds?: Set<string> }
  ) {
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      throw new Error("يرجى إضافة صنف واحد على الأقل للطلب");
    }

    const formCfg = await getTenantFormConfig();
    const preparedLines: Array<{
      existingId?: string;
      lineOrder: number;
      itemId: string | null;
      catalogBoardItemId: string | null;
      itemTitle: string;
      requestedQty: number;
      confirmedQty?: number | null;
      unitCode: string;
      unitLabel: string;
      customUnitLabel: string | null;
      unitPrice: number;
      lineTotal: number;
      saleMode: string;
      notes: string | null;
    }> = [];

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
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

      const unitOption = formCfg.unitOptions.find((u) => u.code === unitCode);
      let itemTitle = String(raw.itemTitle || "").trim();
      let unitPrice = 0;
      let itemId: string | null = raw.itemId ? String(raw.itemId).trim() : null;
      let catalogBoardItemId: string | null = raw.catalogBoardItemId
        ? String(raw.catalogBoardItemId).trim()
        : null;
      const requestedSaleMode =
        String(raw.saleMode || "BULK").trim().toUpperCase() === "PARTIAL"
          ? "PARTIAL"
          : "BULK";

      const rawPricePresent =
        raw.unitPrice !== undefined &&
        raw.unitPrice !== null &&
        String(raw.unitPrice).trim() !== "";
      if (rawPricePresent) {
        const checkPrice = Number(raw.unitPrice);
        if (!Number.isFinite(checkPrice) || checkPrice < 0) {
          throw new Error(`سعر الوحدة في السطر ${i + 1} يجب أن يكون رقماً موجباً أو صفراً`);
        }
      }

      // Prioritize published catalog board item pricing/grade isolation over shared inventory item fallback
      const boardCandidateId = catalogBoardItemId || itemId;
      const boardItem = boardCandidateId
        ? await prisma.portalCatalogBoardItem
          .findFirst({ where: { id: boardCandidateId, isPublished: true } })
          .catch(() => null)
        : null;

      if (boardItem) {
        catalogBoardItemId = boardItem.id;
        itemTitle = itemTitle || boardItem.titleAr;
        unitPrice =
          requestedSaleMode === "PARTIAL" && Number(boardItem.partialUnitPrice || 0) > 0
            ? Math.max(0, Number(boardItem.partialUnitPrice || 0))
            : Math.max(0, Number(boardItem.unitPrice || 0));
        itemId = boardItem.inventoryItemId || itemId || null;
      } else if (itemId) {
        const catItem = await prisma.inventoryItem.findUnique({
          where: { id: itemId },
          include: {
            baseUnit: true,
            conversions: { include: { unit: true } },
          },
        });
        if (catItem) {
          itemTitle = itemTitle || catItem.nameAr;
          const basePrice = Number(catItem.wholesalePrice || catItem.retailPrice || 0);
          unitPrice = basePrice;
          const conv = catItem.conversions.find((c) => c.unit?.code?.toUpperCase() === unitCode);
          if (conv && Number(conv.sellPrice || 0) > 0) {
            unitPrice = Number(conv.sellPrice);
          } else if (conv && basePrice > 0 && Number(conv.factorToBase || 0) > 0) {
            unitPrice = round4(basePrice * Number(conv.factorToBase));
          }
        } else {
          itemId = null;
        }
      }

      if (opts?.allowProposedPrice && rawPricePresent && Number(raw.unitPrice) > 0) {
        unitPrice = round4(Number(raw.unitPrice));
      } else if (!boardItem) {
        if (unitPrice <= 0 && unitOption?.defaultUnitPrice && Number(unitOption.defaultUnitPrice) > 0) {
          unitPrice = round4(Number(unitOption.defaultUnitPrice));
        }
        if (unitPrice <= 0 && raw.unitPrice !== undefined && raw.unitPrice !== null) {
          const candidatePrice = Number(raw.unitPrice);
          if (Number.isFinite(candidatePrice) && candidatePrice > 0) {
            unitPrice = round4(candidatePrice);
          }
        }
      }

      if (!itemTitle) {
        throw new Error(`يرجى تحديد اسم الصنف في السطر ${i + 1}`);
      }

      const unitLabel = isOtherUnit
        ? customUnitLabel || "أخرى"
        : String(raw.unitLabel || unitOption?.labelAr || "علاقية قات").trim();
      const { totalAmount: lineTotal } = computeSaleTotals(qty, unitPrice, 0);
      const validExistingId =
        raw.id && opts?.allowedLineIds?.has(String(raw.id)) ? String(raw.id) : undefined;

      preparedLines.push({
        ...(validExistingId ? { existingId: validExistingId } : {}),
        lineOrder: i + 1,
        itemId,
        catalogBoardItemId,
        itemTitle,
        requestedQty: qty,
        unitCode,
        unitLabel,
        customUnitLabel,
        unitPrice,
        lineTotal,
        saleMode: requestedSaleMode,
        notes: raw.notes ? String(raw.notes).trim() : null,
      });
    }

    return preparedLines;
  }

  export async function createClientGoodsRequest(params: {
    clientAccountId: string;
    sectorType?: string;
    submissionType?: string;
    pickupType?: string;
    pickupLocation: string;
    customPickupLocation?: string;
    pickupNotes?: string;
    customData?: Record<string, unknown>;
    lines: RawClientRequestLineInput[];
  }) {
    const account = await prisma.clientPortalAccount.findUnique({
      where: { id: params.clientAccountId },
    });
    if (!account) throw new Error("ACCOUNT_NOT_FOUND");
    if (account.status !== "ACTIVE") {
      throw new Error("حسابك بانتظار اعتماد إدارة المنشأة قبل إرسال الطلبات");
    }
    if (account.mustChangePassword) {
      throw new Error("MUST_CHANGE_PASSWORD: يرجى تحديث كلمة المرور المؤقتة من الملف الشخصي أولاً قبل إرسال الطلبات");
    }

    const tenantCfg = await getTenantFormConfig();
    const effectiveSectorMode = resolveEffectiveSectorMode(
      (account as { sectorMode?: string | null }).sectorMode,
      tenantCfg.defaultSectorMode
    );
    const sectorType = assertSectorAllowed(
      effectiveSectorMode,
      String(params.sectorType || "").trim() ? params.sectorType : lockedSectorForMode(effectiveSectorMode) || "HARVEST"
    );
    const submissionType =
      String(params.submissionType || "").trim() === "client_goods_registration"
        ? "client_goods_registration"
        : "catalog_order";

    const pickupTypeRaw = String(params.pickupType || "MARKET").toUpperCase();
    const isCustomPickup = pickupTypeRaw === "OTHER" || params.pickupLocation.trim() === "أخرى";
    const resolvedPickupLocation = isCustomPickup
      ? String(params.customPickupLocation || "").trim()
      : String(params.pickupLocation || "").trim();

    if (!resolvedPickupLocation) {
      throw new Error("يرجى تحديد موقع الاستلام (أو كتابة الموقع عند اختيار أخرى)");
    }

    const preparedLines = await prepareValidatedRequestLines(params.lines, {
      allowProposedPrice: submissionType === "client_goods_registration",
    });

    const totalEstimated = preparedLines.reduce((s, l) => dAdd(s, l.lineTotal, 4), 0);
    const requestNumber = `${sectorType === "COMMERCIAL" ? "CREQ" : "REQ"}-${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

    const created = await prisma.$transaction(async (tx) => {
      const reqRecord = await tx.clientGoodsRequest.create({
        data: {
          tenantSlug: account.tenantSlug || getActiveTenantSlug() || "default",
          requestNumber,
          clientAccountId: account.id,
          customerId: account.customerId,
          sectorType,
          submissionType,
          status: "PENDING_REVIEW",
          pickupType: pickupTypeRaw === "BRANCH" || pickupTypeRaw === "WAREHOUSE" || pickupTypeRaw === "OTHER" ? pickupTypeRaw : "MARKET",
          pickupLocation: resolvedPickupLocation,
          pickupNotes: params.pickupNotes?.trim() || null,
          customDataJson: JSON.stringify(params.customData || {}),
          totalEstimated,
          totalConfirmed: 0,
          currency: "YER",
          lines: {
            create: preparedLines.map((l) => ({
              lineOrder: l.lineOrder,
              itemId: l.itemId,
              catalogBoardItemId: l.catalogBoardItemId,
              itemTitle: l.itemTitle,
              requestedQty: l.requestedQty,
              unitCode: l.unitCode,
              unitLabel: l.unitLabel,
              customUnitLabel: l.customUnitLabel,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              saleMode: l.saleMode,
              notes: l.notes,
            })),
          },
        },
        include: { lines: { orderBy: { lineOrder: "asc" } } },
      });

      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      const linesSummary = preparedLines
        .map(
          (l) =>
            `- ${l.itemTitle}: ${l.requestedQty} ${l.unitCode === "OTHER" && l.customUnitLabel ? l.customUnitLabel : l.unitLabel
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

  export async function updatePendingClientRequest(params: {
    requestId: string;
    clientAccountId: string;
    tenantSlug?: string;
    portalUrl?: string;
    pickupType?: string;
    pickupLocation: string;
    customPickupLocation?: string;
    pickupNotes?: string;
    lines: RawClientRequestLineInput[];
  }) {
    const existing = await prisma.clientGoodsRequest.findUnique({
      where: { id: params.requestId },
      include: {
        clientAccount: true,
        lines: { orderBy: { lineOrder: "asc" } },
      },
    });
    if (!existing || existing.clientAccountId !== params.clientAccountId) {
      throw new Error("NOT_FOUND: الطلب غير موجود أو غير مصرح بالوصول إليه");
    }
    const editableStatus =
      existing.status === "PENDING_REVIEW" || existing.status === "RETURNED_TO_CLIENT";
    if (
      !editableStatus ||
      existing.reserveStock ||
      existing.linkedSalesRecordId ||
      existing.linkedSaleId ||
      existing.linkedInvoiceId ||
      existing.linkedDraftId
    ) {
      throw new Error("لا يمكن تعديل الطلب بعد حجز المخزون أو الاعتماد والربط بالمبيعات من الإدارة");
    }

    const pickupTypeRaw = String(params.pickupType || existing.pickupType || "MARKET").toUpperCase();
    const isCustomPickup = pickupTypeRaw === "OTHER" || params.pickupLocation.trim() === "أخرى";
    const resolvedPickupLocation = isCustomPickup
      ? String(params.customPickupLocation || "").trim()
      : String(params.pickupLocation || existing.pickupLocation || "").trim();

    if (!resolvedPickupLocation) {
      throw new Error("يرجى تحديد موقع الاستلام");
    }

    const allowedLineIds = new Set(existing.lines.map((l) => l.id));
    const preparedLines = await prepareValidatedRequestLines(params.lines, {
      allowProposedPrice: true,
      allowedLineIds,
    });
    const totalEstimated = round4(preparedLines.reduce((s, l) => dAdd(s, l.lineTotal, 4), 0));
    const nextPickupType =
      pickupTypeRaw === "BRANCH" || pickupTypeRaw === "WAREHOUSE" || pickupTypeRaw === "OTHER"
        ? pickupTypeRaw
        : "MARKET";
    const nextPickupNotes =
      params.pickupNotes !== undefined ? params.pickupNotes.trim() || null : existing.pickupNotes;

    if (existing.status === "RETURNED_TO_CLIENT") {
      assertReturnEditAllowed(
        {
          pickupLocation: existing.pickupLocation,
          pickupNotes: existing.pickupNotes,
          lines: existing.lines.map((l) => ({
            id: l.id,
            itemTitle: l.itemTitle,
            qty:
              l.confirmedQty !== null && l.confirmedQty !== undefined
                ? Number(l.confirmedQty)
                : Number(l.requestedQty),
            unitCode: l.unitCode,
            unitLabel: l.unitLabel,
            customUnitLabel: l.customUnitLabel,
            unitPrice: Number(l.unitPrice || 0),
          })),
        },
        {
          pickupLocation: resolvedPickupLocation,
          pickupNotes: nextPickupNotes,
          lines: preparedLines.map((l) => ({
            id: l.existingId || null,
            itemTitle: l.itemTitle,
            qty: l.requestedQty,
            unitCode: l.unitCode,
            unitLabel: l.unitLabel,
            customUnitLabel: l.customUnitLabel,
            unitPrice: l.unitPrice,
          })),
        },
        normalizeReturnEditPermissions(
          (existing as { returnEditPermissionsJson?: string | null }).returnEditPermissionsJson
        )
      );
    }

    const beforeBaseTotal =
      Number(existing.totalConfirmed || 0) > 0
        ? Number(existing.totalConfirmed || 0)
        : Number(existing.totalEstimated || 0);
    const beforeSnap = buildRequestSnapshotFromValues({
      pickupType: existing.pickupType,
      pickupLocation: existing.pickupLocation,
      pickupNotes: existing.pickupNotes,
      creditPaidPlanned: Number(existing.creditPaidPlanned || 0),
      debitPlanned: Number(existing.debitPlanned || 0),
      totalAmount: beforeBaseTotal,
      lines: existing.lines.map((l) => ({
        id: l.id,
        itemTitle: l.itemTitle,
        qty:
          l.confirmedQty !== null && l.confirmedQty !== undefined
            ? Number(l.confirmedQty)
            : Number(l.requestedQty),
        unitCode: l.unitCode,
        unitLabel: l.unitLabel,
        customUnitLabel: l.customUnitLabel,
        unitPrice: Number(l.unitPrice || 0),
        lineTotal: Number(l.lineTotal || 0),
      })),
    });

    const afterSnap = buildRequestSnapshotFromValues({
      pickupType: nextPickupType,
      pickupLocation: resolvedPickupLocation,
      pickupNotes: nextPickupNotes,
      creditPaidPlanned: Number(existing.creditPaidPlanned || 0),
      debitPlanned: Number(existing.debitPlanned || 0),
      totalAmount: totalEstimated,
      lines: preparedLines.map((l, idx) => ({
        id: l.existingId || `client-new-${idx + 1}`,
        itemTitle: l.itemTitle,
        qty: l.requestedQty,
        unitCode: l.unitCode,
        unitLabel: l.unitLabel,
        customUnitLabel: l.customUnitLabel,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    });

    const amendmentDiffs = computeRequestAmendmentDiff(beforeSnap, afterSnap);
    const tenantSlugLabel = (params.tenantSlug || "default").trim() || "default";
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.clientGoodsRequestLine.deleteMany({ where: { requestId: existing.id } });
      await tx.clientGoodsRequestLine.createMany({
        data: preparedLines.map((l) => ({
          ...(l.existingId ? { id: l.existingId } : {}),
          requestId: existing.id,
          lineOrder: l.lineOrder,
          itemId: l.itemId,
          catalogBoardItemId: l.catalogBoardItemId,
          itemTitle: l.itemTitle,
          requestedQty: l.requestedQty,
          confirmedQty: null,
          unitCode: l.unitCode,
          unitLabel: l.unitLabel,
          customUnitLabel: l.customUnitLabel,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          saleMode: l.saleMode,
          notes: l.notes,
        })),
      });

      const saved = await tx.clientGoodsRequest.update({
        where: { id: existing.id },
        data: {
          status: "PENDING_REVIEW",
          pickupType: nextPickupType,
          pickupLocation: resolvedPickupLocation,
          pickupNotes: nextPickupNotes,
          totalEstimated,
          totalConfirmed: 0,
          ...(amendmentDiffs.length > 0
            ? {
              amendmentDiffJson: JSON.stringify(amendmentDiffs),
              beforeSnapshotJson: JSON.stringify(beforeSnap),
              afterSnapshotJson: JSON.stringify(afterSnap),
              revisionNumber: { increment: 1 },
              clientResponseStatus: "PENDING_STAFF_APPROVAL",
              clientResponseNote: "قام العميل بتعديل تفاصيل الطلب — بانتظار اعتماد الموظف",
              clientRespondedAt: now,
            }
            : {}),
        },
        include: { lines: { orderBy: { lineOrder: "asc" } } },
      });

      if (amendmentDiffs.length > 0) {
        const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
        await createWhatsAppDraftTx(tx, {
          eventType: "CLIENT_ORDER_EDITED",
          clientAccountId: existing.clientAccountId,
          customerId: existing.customerId,
          requestId: saved.id,
          recipientName: existing.clientAccount.fullName,
          recipientPhone: existing.clientAccount.phone,
          variables: {
            companyName: profile?.legalNameAr || "المنشأة",
            requestNumber: saved.requestNumber,
            pickupLocation: saved.pickupLocation,
            totalAmount: totalEstimated.toLocaleString("en-US"),
            currency: saved.currency || "YER",
            portalUrl: params.portalUrl || `${resolveTenantCloudUrl(tenantSlugLabel)}/portal`,
          },
        });

        await appendAuditLogTx(tx, {
          userId: null,
          userDisplay: existing.clientAccount.fullName,
          userRole: "CLIENT_PORTAL",
          actionType: "CLIENT_REQUEST_EDITED_BY_CLIENT",
          entityReference: saved.requestNumber,
          details: `[tenant:${tenantSlugLabel}] تعديل العميل (${existing.clientAccount.fullName}) على الطلب ${saved.requestNumber} (${amendmentDiffs.length} تغييرات) — بانتظار اعتماد الموظف | الإجمالي المحدث: ${totalEstimated}`,
        });
      }

      return saved;
    });

    if (amendmentDiffs.length > 0) {
      await emitNotification({
        eventType: "SYSTEM_ALERT",
        severity: "WARNING",
        titleAr: `تعديل عميل بانتظار اعتماد الموظف (${updated.requestNumber})`,
        titleEn: `Client Order Edited — Awaiting Staff Approval (${updated.requestNumber})`,
        messageAr: `عدّل العميل ${existing.clientAccount.fullName} الطلب ${updated.requestNumber} (${amendmentDiffs.length} تغييرات) وهو بانتظار المراجعة والاعتماد.`,
        messageEn: `Client ${existing.clientAccount.fullName} edited request ${updated.requestNumber}; pending staff approval.`,
        targetTab: "customers",
        targetEntityType: "ClientGoodsRequest",
        targetEntityId: updated.id,
      }).catch(() => null);
    }

    return serializeRequest(updated);
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
    linkedSalesRecordId?: string | null;
    linkedDraftId?: string | null;
    creditPaidPlanned?: unknown;
    debitPlanned?: unknown;
    approvedByUserId?: string | null;
    approvedByName?: string | null;
    approvedAt?: Date | null;
    reviewedByName: string | null;
    reviewedAt: Date | null;
    readyAt: Date | null;
    handedOverByName: string | null;
    handedOverAt: Date | null;
    staffNotes: string | null;
    reviewerRemarks?: string | null;
    returnEditPermissionsJson?: string | null;
    amendmentDiffJson?: string;
    beforeSnapshotJson?: string | null;
    afterSnapshotJson?: string | null;
    revisionNumber?: number;
    returnedToClientAt?: Date | null;
    returnedByUserId?: string | null;
    returnedByName?: string | null;
    clientResponseStatus?: string | null;
    clientResponseNote?: string | null;
    clientRespondedAt?: Date | null;
    sectorType?: string;
    submissionType?: string;
    isArchived?: boolean;
    archivedAt?: Date | null;
    archivedBy?: string | null;
    isArchivedByClient?: boolean;
    archivedByClientAt?: Date | null;
    isHiddenByClient?: boolean;
    hiddenByClientAt?: Date | null;
    isHiddenByStaff?: boolean;
    hiddenByStaffAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    clientAccount?: {
      id: string;
      fullName: string;
      tradeName: string | null;
      phone: string;
      email: string;
      avatarUrl?: string | null;
      avatarColor?: string | null;
      clientType: string;
      customerId: string | null;
    } | null;
    lines: Array<{
      id: string;
      lineOrder: number;
      itemId: string | null;
      catalogBoardItemId?: string | null;
      itemTitle: string;
      requestedQty: unknown;
      confirmedQty: unknown;
      unitCode: string;
      unitLabel: string;
      customUnitLabel: string | null;
      unitPrice: unknown;
      lineTotal: unknown;
      saleMode?: string | null;
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
    let amendmentDiff: AmendmentDiffEntry[] = [];
    let beforeSnapshot: RequestAmendmentSnapshot | null = null;
    let afterSnapshot: RequestAmendmentSnapshot | null = null;
    try {
      const parsedDiff = JSON.parse(req.amendmentDiffJson || "[]");
      if (Array.isArray(parsedDiff)) amendmentDiff = parsedDiff as AmendmentDiffEntry[];
    } catch {
      amendmentDiff = [];
    }
    try {
      if (req.beforeSnapshotJson) {
        beforeSnapshot = JSON.parse(req.beforeSnapshotJson) as RequestAmendmentSnapshot;
      }
    } catch {
      beforeSnapshot = null;
    }
    try {
      if (req.afterSnapshotJson) {
        afterSnapshot = JSON.parse(req.afterSnapshotJson) as RequestAmendmentSnapshot;
      }
    } catch {
      afterSnapshot = null;
    }

    return {
      id: req.id,
      requestNumber: req.requestNumber,
      pickupPassCode: req.requestNumber,
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
      linkedSalesRecordId: req.linkedSalesRecordId ?? req.linkedSaleId ?? req.linkedDraftId ?? null,
      linkedDraftId: req.linkedDraftId ?? null,
      creditPaidPlanned: Number(req.creditPaidPlanned || 0),
      debitPlanned: Number(req.debitPlanned || 0),
      approvedByUserId: req.approvedByUserId ?? null,
      approvedByName: req.approvedByName ?? null,
      approvedAt: req.approvedAt ? req.approvedAt.toISOString() : null,
      approvedAtDisplay: req.approvedAt ? formatIsoToDmyTime(req.approvedAt) : null,
      reviewedByName: req.reviewedByName,
      reviewedAt: req.reviewedAt ? req.reviewedAt.toISOString() : null,
      reviewedAtDisplay: req.reviewedAt ? formatIsoToDmyTime(req.reviewedAt) : null,
      readyAt: req.readyAt ? req.readyAt.toISOString() : null,
      readyAtDisplay: req.readyAt ? formatIsoToDmyTime(req.readyAt) : null,
      handedOverByName: req.handedOverByName,
      handedOverAt: req.handedOverAt ? req.handedOverAt.toISOString() : null,
      handedOverAtDisplay: req.handedOverAt ? formatIsoToDmyTime(req.handedOverAt) : null,
      staffNotes: req.staffNotes,
      reviewerRemarks: req.reviewerRemarks ?? null,
      returnEditPermissions: normalizeReturnEditPermissions(req.returnEditPermissionsJson),
      amendmentDiff,
      beforeSnapshot,
      afterSnapshot,
      revisionNumber: Number(req.revisionNumber || 1),
      returnedToClientAt: req.returnedToClientAt ? req.returnedToClientAt.toISOString() : null,
      returnedToClientAtDisplay: req.returnedToClientAt
        ? formatIsoToDmyTime(req.returnedToClientAt)
        : null,
      returnedByUserId: req.returnedByUserId ?? null,
      returnedByName: req.returnedByName ?? null,
      clientResponseStatus: req.clientResponseStatus ?? null,
      clientResponseStatusLabelAr: req.clientResponseStatus
        ? CLIENT_RESPONSE_STATUS_LABELS_AR[req.clientResponseStatus] || req.clientResponseStatus
        : null,
      clientResponseNote: req.clientResponseNote ?? null,
      clientRespondedAt: req.clientRespondedAt ? req.clientRespondedAt.toISOString() : null,
      clientRespondedAtDisplay: req.clientRespondedAt
        ? formatIsoToDmyTime(req.clientRespondedAt)
        : null,
      sectorType: req.sectorType || "HARVEST",
      submissionType: req.submissionType || "catalog_order",
      isArchived: Boolean(req.isArchived),
      archivedAt: req.archivedAt ? req.archivedAt.toISOString() : null,
      archivedAtDisplay: req.archivedAt ? formatIsoToDmyTime(req.archivedAt) : null,
      archivedBy: req.archivedBy ?? null,
      isArchivedByClient: Boolean(req.isArchivedByClient),
      archivedByClientAt: req.archivedByClientAt ? req.archivedByClientAt.toISOString() : null,
      isHiddenByClient: Boolean(req.isHiddenByClient),
      hiddenByClientAt: req.hiddenByClientAt ? req.hiddenByClientAt.toISOString() : null,
      isHiddenByStaff: Boolean(req.isHiddenByStaff),
      hiddenByStaffAt: req.hiddenByStaffAt ? req.hiddenByStaffAt.toISOString() : null,
      createdAt: req.createdAt.toISOString(),
      updatedAt: req.updatedAt.toISOString(),
      createdAtDmy: formatIsoToDmy(req.createdAt),
      createdAtTime: formatIsoToTimeHm(req.createdAt),
      createdAtDisplay: formatIsoToDmyTime(req.createdAt),
      updatedAtDmy: formatIsoToDmy(req.updatedAt),
      updatedAtTime: formatIsoToTimeHm(req.updatedAt),
      updatedAtDisplay: formatIsoToDmyTime(req.updatedAt),
      canClientCancel: canClientCancelRequest(req),
      canArchiveOrHide: canArchiveOrHideRequest(req),
      canSafelyDelete: canSafelyDeleteRequest(req).allowed,
      clientAccount: req.clientAccount
        ? {
          id: req.clientAccount.id,
          fullName: req.clientAccount.fullName,
          tradeName: req.clientAccount.tradeName,
          phone: req.clientAccount.phone,
          email: req.clientAccount.email,
          avatarUrl: req.clientAccount.avatarUrl ?? "",
          avatarColor: req.clientAccount.avatarColor || "#059669",
          avatarChar: req.clientAccount.fullName.trim().charAt(0) || "ع",
          clientType: req.clientAccount.clientType,
          customerId: req.clientAccount.customerId,
        }
        : undefined,
      lines: req.lines.map((l) => ({
        id: l.id,
        lineOrder: l.lineOrder,
        itemId: l.itemId,
        catalogBoardItemId: l.catalogBoardItemId ?? null,
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
        saleMode: l.saleMode || "BULK",
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
          creditUtilizationPct: 0,
          openBillsCount: 0,
          paidBillsCount: 0,
          currency: "YER",
        },
        bills: [],
        receipts: [],
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
        where: { customerId: params.customerId, documentStatus: { not: "VOIDED" } },
        include: {
          treasury: { select: { type: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
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
            ? "جزئية"
            : "مستحقة";

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

    const openBillsCount = bills.filter((b) => b.billStatus !== "PAID").length;
    const paidBillsCount = bills.filter((b) => b.billStatus === "PAID").length;
    const creditUtilizationPct =
      creditLimit > 0
        ? Math.min(100, Math.round((totalUnpaid / creditLimit) * 1000) / 10)
        : 0;

    const clientReceipts = receipts
      .map((rc) => {
        const tType = (rc.treasury?.type || "VAULT").toUpperCase();
        const paymentMethod =
          tType === "BANK"
            ? "تحويل بنكي"
            : tType === "WALLET"
              ? "محفظة إلكترونية"
              : "نقداً";
        return {
          id: rc.id,
          voucherNumber: rc.voucherNumber,
          date: rc.date.toISOString().slice(0, 10),
          amount: Number(rc.amount || 0),
          currency: rc.currency || "YER",
          paymentMethod,
          appliedInvoiceId: rc.invoiceId || null,
          appliedInvoiceNumber: rc.invoice?.invoiceNumber || null,
          applicationSummary: rc.invoice?.invoiceNumber
            ? `سداد على الفاتورة ${rc.invoice.invoiceNumber}`
            : "دفعة مقيدة في رصيد الحساب",
          notes: rc.notes || "",
        };
      })
      .filter((row) => {
        if (params.fromDate && row.date < params.fromDate) return false;
        if (params.toDate && row.date > params.toDate) return false;
        return true;
      })
      .reverse();

    return {
      summary: {
        creditLimit,
        totalInvoiced,
        totalPaid,
        totalUnpaid,
        creditAvailable,
        creditUtilizationPct,
        openBillsCount,
        paidBillsCount,
        currency: "YER",
      },
      bills,
      receipts: clientReceipts,
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
            portalUrl: params.portalUrl || `${resolveTenantCloudUrl(profile?.tenantSlug)}/portal`,
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

    await syncGlobalClientMembershipStatus({
      globalClientId: updated.acc.globalClientId,
      tenantSlug: updated.acc.tenantSlug || getActiveTenantSlug() || "default",
      tenantId: getActiveTenantId() || "default",
      clientAccountId: updated.acc.id,
      customerId: updated.acc.customerId,
      normalizedPhone: updated.acc.normalizedPhone || updated.acc.phone,
      normalizedEmail: updated.acc.normalizedEmail || updated.acc.email,
      status: updated.acc.status,
      creditLimit: updated.creditLimit,
    });

    return sanitizeClientAccount(updated.acc, updated.creditLimit);
  }

  async function nextSalesDraftNumberTx(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `DRF-${year}-`;
    const count = await tx.workspaceDraft.count({
      where: { draftNumber: { startsWith: prefix } },
    });
    let seq = count + 1;
    for (; ;) {
      const candidate = `${prefix}${String(seq).padStart(4, "0")}`;
      const exists = await tx.workspaceDraft.findUnique({
        where: { draftNumber: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
      seq++;
    }
  }

  async function assertCustomerCreditAvailableTx(
    tx: Prisma.TransactionClient,
    customerId: string,
    newDebitAmount: number,
    overrideCreditLimit?: boolean
  ) {
    if (overrideCreditLimit || newDebitAmount <= 0) return;
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { creditLimit: true, nameAr: true },
    });
    const limit = Number(customer?.creditLimit || 0);
    if (limit <= 0) return;
    const openInv = await tx.salesInvoice.findMany({
      where: { customerId, status: { in: ["POSTED", "PARTIALLY_PAID", "PENDING_APPROVAL"] } },
      select: { balanceDue: true },
    });
    const currentDue = openInv.reduce((s, r) => dAdd(s, Number(r.balanceDue || 0), 4), 0);
    if (currentDue + newDebitAmount > limit + 0.01) {
      throw new Error(
        `CREDIT_LIMIT_EXCEEDED: تجاوز الحد الائتماني للعميل (${customer?.nameAr || ""}) — المتاح ${Math.max(
          0,
          limit - currentDue
        ).toLocaleString("en-US")} ريال`
      );
    }
  }

  function resolveDisplayUnitLabel(
    unitCode: string,
    unitLabel: string,
    customUnitLabel?: string | null
  ): string {
    if (unitCode === "OTHER" && customUnitLabel?.trim()) {
      return customUnitLabel.trim();
    }
    return unitLabel || "علاقية قات";
  }

  function buildRequestSnapshotFromValues(input: {
    pickupType: string;
    pickupLocation: string;
    pickupNotes: string | null;
    creditPaidPlanned: number;
    debitPlanned: number;
    totalAmount: number;
    lines: Array<{
      id: string;
      itemTitle: string;
      qty: number;
      unitCode: string;
      unitLabel: string;
      customUnitLabel: string | null;
      unitPrice: number;
      lineTotal: number;
    }>;
  }): RequestAmendmentSnapshot {
    return {
      pickupType: input.pickupType,
      pickupLocation: input.pickupLocation,
      pickupNotes: input.pickupNotes,
      creditPaidPlanned: round4(Number(input.creditPaidPlanned || 0)),
      debitPlanned: round4(Number(input.debitPlanned || 0)),
      totalAmount: round4(Number(input.totalAmount || 0)),
      lines: input.lines.map((l) => ({
        id: l.id,
        itemTitle: l.itemTitle,
        qty: round4(Number(l.qty || 0)),
        unitCode: l.unitCode,
        unitLabel: l.unitLabel,
        customUnitLabel: l.customUnitLabel,
        displayUnitLabel: resolveDisplayUnitLabel(l.unitCode, l.unitLabel, l.customUnitLabel),
        unitPrice: round4(Number(l.unitPrice || 0)),
        lineTotal: round4(Number(l.lineTotal || 0)),
      })),
    };
  }

  export function computeRequestAmendmentDiff(
    beforeSnap: RequestAmendmentSnapshot,
    afterSnap: RequestAmendmentSnapshot
  ): AmendmentDiffEntry[] {
    const diffs: AmendmentDiffEntry[] = [];

    if (beforeSnap.pickupLocation !== afterSnap.pickupLocation) {
      diffs.push({
        field: "pickupLocation",
        labelAr: "موقع الاستلام (استلام من:)",
        before: beforeSnap.pickupLocation,
        after: afterSnap.pickupLocation,
      });
    }
    if ((beforeSnap.pickupNotes || "") !== (afterSnap.pickupNotes || "")) {
      diffs.push({
        field: "pickupNotes",
        labelAr: "ملاحظات الاستلام",
        before: beforeSnap.pickupNotes || "—",
        after: afterSnap.pickupNotes || "—",
      });
    }

    const afterById = new Map(afterSnap.lines.map((l) => [l.id, l]));
    const matchedAfterIds = new Set<string>();

    for (const bLine of beforeSnap.lines) {
      const aLine = afterById.get(bLine.id);
      if (!aLine) {
        diffs.push({
          field: `line_removed_${bLine.id}`,
          labelAr: `حذف صنف: ${bLine.itemTitle}`,
          before: `${bLine.qty} ${bLine.displayUnitLabel} × ${bLine.unitPrice.toLocaleString("en-US")} = ${bLine.lineTotal.toLocaleString("en-US")}`,
          after: "تمت الإزالة",
        });
        continue;
      }
      matchedAfterIds.add(aLine.id);
      const changed =
        bLine.itemTitle !== aLine.itemTitle ||
        Math.abs(bLine.qty - aLine.qty) > 0.0001 ||
        bLine.displayUnitLabel !== aLine.displayUnitLabel ||
        Math.abs(bLine.unitPrice - aLine.unitPrice) > 0.0001;
      if (changed) {
        diffs.push({
          field: `line_modified_${bLine.id}`,
          labelAr: `تعديل الصنف (${aLine.itemTitle})`,
          before: `${bLine.itemTitle}: ${bLine.qty} ${bLine.displayUnitLabel} × ${bLine.unitPrice.toLocaleString("en-US")} = ${bLine.lineTotal.toLocaleString("en-US")}`,
          after: `${aLine.itemTitle}: ${aLine.qty} ${aLine.displayUnitLabel} × ${aLine.unitPrice.toLocaleString("en-US")} = ${aLine.lineTotal.toLocaleString("en-US")}`,
        });
      }
    }

    for (const aLine of afterSnap.lines) {
      if (matchedAfterIds.has(aLine.id)) continue;
      diffs.push({
        field: `line_added_${aLine.id}`,
        labelAr: `إضافة صنف: ${aLine.itemTitle}`,
        before: "غير موجود",
        after: `${aLine.qty} ${aLine.displayUnitLabel} × ${aLine.unitPrice.toLocaleString("en-US")} = ${aLine.lineTotal.toLocaleString("en-US")}`,
      });
    }

    if (
      Math.abs(beforeSnap.creditPaidPlanned - afterSnap.creditPaidPlanned) > 0.01 ||
      Math.abs(beforeSnap.debitPlanned - afterSnap.debitPlanned) > 0.01
    ) {
      diffs.push({
        field: "paymentTerms",
        labelAr: "شروط الدفع (مدفوع / آجل)",
        before: `مدفوع: ${beforeSnap.creditPaidPlanned.toLocaleString("en-US")} | آجل: ${beforeSnap.debitPlanned.toLocaleString("en-US")}`,
        after: `مدفوع: ${afterSnap.creditPaidPlanned.toLocaleString("en-US")} | آجل: ${afterSnap.debitPlanned.toLocaleString("en-US")}`,
      });
    }

    if (Math.abs(beforeSnap.totalAmount - afterSnap.totalAmount) > 0.01) {
      diffs.push({
        field: "totalAmount",
        labelAr: "الإجمالي الكلي (= P × Q)",
        before: beforeSnap.totalAmount.toLocaleString("en-US"),
        after: afterSnap.totalAmount.toLocaleString("en-US"),
      });
    }

    return diffs;
  }

  interface ResolvedStaffLineItem {
    existingId?: string;
    itemId: string | null;
    itemTitle: string;
    requestedQty: number;
    confirmedQty: number;
    unitCode: string;
    unitLabel: string;
    customUnitLabel: string | null;
    unitPrice: number;
    lineTotal: number;
    notes: string | null;
  }

  async function resolveUpdatedRequestLinesAndPickup(params: {
    reqRecord: {
      pickupType: string;
      pickupLocation: string;
      pickupNotes: string | null;
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
    };
    pickupType?: string;
    pickupLocation?: string;
    customPickupLocation?: string;
    pickupNotes?: string | null;
    lines?: Array<{
      id?: string;
      itemId?: string | null;
      itemTitle?: string;
      confirmedQty?: number;
      unitCode?: string;
      unitLabel?: string;
      customUnitLabel?: string | null;
      unitPrice?: number;
      notes?: string | null;
      remove?: boolean;
    }>;
  }): Promise<{
    pickupType: string;
    pickupLocation: string;
    pickupNotes: string | null;
    resolvedLines: ResolvedStaffLineItem[];
    totalConfirmed: number;
  }> {
    const formCfg = await getTenantFormConfig();
    const nextPickupTypeRaw = String(params.pickupType || params.reqRecord.pickupType || "MARKET")
      .trim()
      .toUpperCase();
    const nextPickupType =
      nextPickupTypeRaw === "BRANCH" || nextPickupTypeRaw === "WAREHOUSE" || nextPickupTypeRaw === "OTHER"
        ? nextPickupTypeRaw
        : "MARKET";

    const rawLoc =
      params.pickupLocation !== undefined ? params.pickupLocation : params.reqRecord.pickupLocation;
    const isOtherLoc = nextPickupType === "OTHER" || String(rawLoc || "").trim() === "أخرى";
    const pickupLocation = isOtherLoc
      ? String(params.customPickupLocation || rawLoc || "").trim()
      : String(rawLoc || "").trim();
    if (!pickupLocation) {
      throw new Error("يرجى تحديد موقع الاستلام (أو كتابة الموقع المخصص)");
    }

    const pickupNotes =
      params.pickupNotes !== undefined
        ? params.pickupNotes?.trim() || null
        : params.reqRecord.pickupNotes;

    const resolvedLines: ResolvedStaffLineItem[] = [];
    const patches = params.lines || [];
    const patchById = new Map(patches.filter((p) => p.id).map((p) => [String(p.id), p]));

    for (const existingLine of params.reqRecord.lines) {
      const patch = patchById.get(existingLine.id);
      if (patch?.remove) continue;

      const unitCode = String(patch?.unitCode || existingLine.unitCode || "QAT_BUNCH")
        .trim()
        .toUpperCase();
      const isOtherUnit = unitCode === "OTHER";
      const customUnitLabel = isOtherUnit
        ? String(patch?.customUnitLabel ?? existingLine.customUnitLabel ?? "").trim() || null
        : null;
      if (isOtherUnit && !customUnitLabel) {
        throw new Error(`يرجى كتابة اسم الوحدة المخصصة للصنف (${existingLine.itemTitle})`);
      }
      const unitOption = formCfg.unitOptions.find((u) => u.code === unitCode);
      const unitLabel = isOtherUnit
        ? customUnitLabel || "أخرى"
        : String(patch?.unitLabel || unitOption?.labelAr || existingLine.unitLabel || "علاقية قات").trim();

      const itemTitle = String(patch?.itemTitle ?? existingLine.itemTitle ?? "").trim();
      if (!itemTitle) throw new Error("اسم الصنف مطلوب في جميع السطور");

      const cQty =
        patch?.confirmedQty !== undefined
          ? Math.max(0, Number(patch.confirmedQty))
          : existingLine.confirmedQty !== null && existingLine.confirmedQty !== undefined
            ? Math.max(0, Number(existingLine.confirmedQty))
            : Math.max(0, Number(existingLine.requestedQty));
      const uPrice =
        patch?.unitPrice !== undefined
          ? Math.max(0, Number(patch.unitPrice))
          : Math.max(0, Number(existingLine.unitPrice));
      const { totalAmount: lTotal } = computeSaleTotals(cQty, uPrice, 0);

      resolvedLines.push({
        existingId: existingLine.id,
        itemId: patch?.itemId !== undefined ? patch.itemId : existingLine.itemId,
        itemTitle,
        requestedQty: Math.max(0, Number(existingLine.requestedQty)),
        confirmedQty: cQty,
        unitCode,
        unitLabel,
        customUnitLabel,
        unitPrice: uPrice,
        lineTotal: lTotal,
        notes: patch?.notes !== undefined ? patch.notes?.trim() || null : existingLine.notes,
      });
    }

    // Handle newly added lines from staff amendment UI
    const existingIdSet = new Set(params.reqRecord.lines.map((l) => l.id));
    for (const patch of patches) {
      if (patch.remove) continue;
      if (patch.id && existingIdSet.has(patch.id)) continue;
      const itemTitle = String(patch.itemTitle || "").trim();
      if (!itemTitle) continue;
      const cQty = Math.max(0, Number(patch.confirmedQty ?? 1));
      if (cQty <= 0) throw new Error(`الكمية للصنف المضاف (${itemTitle}) يجب أن تكون أكبر من صفر`);
      const unitCode = String(patch.unitCode || "QAT_BUNCH").trim().toUpperCase();
      const isOtherUnit = unitCode === "OTHER";
      const customUnitLabel = isOtherUnit ? String(patch.customUnitLabel || "").trim() || null : null;
      if (isOtherUnit && !customUnitLabel) {
        throw new Error(`يرجى كتابة اسم الوحدة المخصصة للصنف (${itemTitle})`);
      }
      const unitOption = formCfg.unitOptions.find((u) => u.code === unitCode);
      const unitLabel = isOtherUnit
        ? customUnitLabel || "أخرى"
        : String(patch.unitLabel || unitOption?.labelAr || "علاقية قات").trim();
      const uPrice = Math.max(0, Number(patch.unitPrice || 0));
      const { totalAmount: lTotal } = computeSaleTotals(cQty, uPrice, 0);

      resolvedLines.push({
        itemId: patch.itemId ? String(patch.itemId) : null,
        itemTitle,
        requestedQty: cQty,
        confirmedQty: cQty,
        unitCode,
        unitLabel,
        customUnitLabel,
        unitPrice: uPrice,
        lineTotal: lTotal,
        notes: patch.notes?.trim() || null,
      });
    }

    if (resolvedLines.length === 0) {
      throw new Error("يجب أن يحتوي الطلب على صنف واحد على الأقل");
    }

    const totalConfirmed = round4(
      resolvedLines.reduce((s, l) => dAdd(s, l.lineTotal, 4), 0)
    );

    return {
      pickupType: nextPickupType,
      pickupLocation,
      pickupNotes,
      resolvedLines,
      totalConfirmed,
    };
  }

  async function initiateOrUpdateLinkedSalesDraftTx(
    tx: Prisma.TransactionClient,
    params: {
      freshReq: {
        id: string;
        requestNumber: string;
        clientAccountId: string;
        customerId: string | null;
        projectId: string | null;
        subProjectId: string | null;
        harvestName: string | null;
        pickupLocation: string;
        currency: string;
        linkedSalesRecordId: string | null;
        linkedSaleId: string | null;
        linkedDraftId: string | null;
        creditPaidPlanned: unknown;
        clientAccount: {
          customerId: string | null;
          fullName: string;
          tradeName: string | null;
          phone: string;
        };
        lines: Array<{
          id: string;
          itemId: string | null;
          itemTitle: string;
          requestedQty: unknown;
          confirmedQty: unknown;
          unitCode: string;
          unitLabel: string;
          customUnitLabel: string | null;
          unitPrice: unknown;
          lineTotal: unknown;
        }>;
      };
      projectId?: string;
      subProjectId?: string | null;
      harvestName?: string;
      treasuryId?: string | null;
      immediatePaidAmount?: number;
      overrideCreditLimit?: boolean;
      actor: { userId?: string | null; userDisplay: string };
    }
  ) {
    await ensure6GenerationCoaHierarchy(tx);

    let customerId = params.freshReq.customerId || params.freshReq.clientAccount.customerId;
    if (!customerId) {
      const cust = await ensureCustomerWithAccountTx(tx, {
        name: params.freshReq.clientAccount.tradeName || params.freshReq.clientAccount.fullName,
        phone: params.freshReq.clientAccount.phone,
      });
      customerId = cust.id;
      await tx.clientPortalAccount.update({
        where: { id: params.freshReq.clientAccountId },
        data: { customerId: cust.id },
      });
    }

    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: {
        account: { select: { code: true, nameAr: true } },
        glAccount: { select: { code: true, nameAr: true } },
      },
    });
    const targetProject =
      (params.projectId
        ? await tx.project.findUnique({ where: { id: params.projectId } })
        : params.freshReq.projectId
          ? await tx.project.findUnique({ where: { id: params.freshReq.projectId } })
          : null) || (await tx.project.findFirst({ orderBy: { createdAt: "asc" } }));

    const effectiveLines = params.freshReq.lines.map((l) => {
      const cQty =
        l.confirmedQty !== null && l.confirmedQty !== undefined
          ? Math.max(0, Number(l.confirmedQty))
          : Math.max(0, Number(l.requestedQty));
      const uPrice = Math.max(0, Number(l.unitPrice || 0));
      const lTotal = computeSaleTotals(cQty, uPrice, 0).totalAmount;
      return { ...l, cQty, uPrice, lTotal };
    });

    const totalConfirmed = round4(
      effectiveLines.reduce((s, l) => dAdd(s, l.lTotal, 4), 0)
    );
    const plannedCreditPaid = Math.min(
      totalConfirmed,
      Math.max(
        0,
        Number(
          params.immediatePaidAmount !== undefined
            ? params.immediatePaidAmount
            : params.freshReq.creditPaidPlanned || 0
        )
      )
    );
    const { debitReceivable: plannedDebit } = computeSaleTotals(
      totalConfirmed,
      1,
      plannedCreditPaid
    );

    await assertCustomerCreditAvailableTx(
      tx,
      customer.id,
      plannedDebit,
      params.overrideCreditLimit
    );

    const totalQty = effectiveLines.reduce((s, l) => s + l.cQty, 0);
    const effectiveUnitPrice =
      totalQty > 0 ? round4(totalConfirmed / totalQty) : round4(effectiveLines[0]?.uPrice || 0);
    const firstGrade =
      effectiveLines.map((l) => l.itemTitle).slice(0, 2).join(" / ") || "طلب بوابة عميل";
    const coaCode = customer.glAccount?.code || customer.account.code;
    const draftPayload = {
      portalRequestId: params.freshReq.id,
      requestNumber: params.freshReq.requestNumber,
      clientAccountId: params.freshReq.clientAccountId,
      customerId: customer.id,
      customer: customer.nameAr,
      customerCode: customer.code,
      customerAccountCode: coaCode,
      phone: customer.phone || params.freshReq.clientAccount.phone,
      projectId: targetProject?.id || params.freshReq.projectId || "",
      subProjectId: params.subProjectId ?? params.freshReq.subProjectId ?? null,
      harvest: params.harvestName || params.freshReq.harvestName || "مبيعات بوابة العملاء",
      pickupLocation: params.freshReq.pickupLocation,
      grade: firstGrade,
      bundles: Math.max(1, Math.round(totalQty)),
      price: effectiveUnitPrice,
      amount: totalConfirmed,
      totalAmount: totalConfirmed,
      credit: plannedCreditPaid,
      debitReceivable: plannedDebit,
      treasuryAccountId: params.treasuryId || null,
      date: new Date().toISOString().slice(0, 10),
      notes: `أمر بيع معتمد من بوابة العملاء (${params.freshReq.requestNumber}) — استلام من: ${params.freshReq.pickupLocation}`,
      lines: effectiveLines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        itemTitle: l.itemTitle,
        qty: l.cQty,
        unitLabel: resolveDisplayUnitLabel(l.unitCode, l.unitLabel, l.customUnitLabel),
        unitPrice: l.uPrice,
        lineTotal: l.lTotal,
      })),
    };

    const existingSalesRecordId =
      params.freshReq.linkedSalesRecordId ||
      params.freshReq.linkedSaleId ||
      params.freshReq.linkedDraftId;
    let linkedDraftId = existingSalesRecordId || params.freshReq.linkedDraftId || null;

    if (!linkedDraftId) {
      const draftNumber = await nextSalesDraftNumberTx(tx);
      const createdDraft = await tx.workspaceDraft.create({
        data: {
          draftNumber,
          module: "SALES",
          formType: "SALES_INVOICE",
          entityId: params.freshReq.id,
          titleAr: `أمر بيع بوابة عميل ${params.freshReq.requestNumber} — ${customer.nameAr}`,
          titleEn: `Portal Sales Order ${params.freshReq.requestNumber} — ${customer.nameEn || customer.nameAr}`,
          payloadJson: JSON.stringify(draftPayload),
          totalAmount: totalConfirmed,
          currencyCode: params.freshReq.currency || "YER",
          visibility: "SHARED_WORKSPACE",
          status: "ACTIVE_DRAFT",
          createdById: params.actor.userId || "u1",
          createdByName: params.actor.userDisplay,
          updatedById: params.actor.userId || "u1",
          updatedByName: params.actor.userDisplay,
        },
      });
      linkedDraftId = createdDraft.id;
    } else if (params.freshReq.linkedDraftId) {
      const existingDraft = await tx.workspaceDraft.findUnique({
        where: { id: params.freshReq.linkedDraftId },
        select: { id: true, status: true },
      });
      if (existingDraft && existingDraft.status === "ACTIVE_DRAFT") {
        await tx.workspaceDraft.update({
          where: { id: existingDraft.id },
          data: {
            payloadJson: JSON.stringify(draftPayload),
            totalAmount: totalConfirmed,
            updatedById: params.actor.userId || "u1",
            updatedByName: params.actor.userDisplay,
          },
        });
      }
    }

    return {
      customer,
      targetProject,
      linkedDraftId,
      totalConfirmed,
      plannedCreditPaid,
      plannedDebit,
    };
  }

  export async function staffProcessGoodsRequest(params: {
    requestId: string;
    action: "CONFIRM" | "MARK_READY" | "HANDOVER" | "AMEND" | "RETURN_TO_CLIENT" | "REJECT" | "CANCEL";
    tenantSlug?: string;
    portalUrl?: string;
    projectId?: string;
    subProjectId?: string | null;
    harvestName?: string;
    treasuryId?: string | null;
    immediatePaidAmount?: number;
    reserveStock?: boolean;
    overrideCreditLimit?: boolean;
    staffNotes?: string;
    reviewerRemarks?: string;
    /** Per-return edit permissions (price/quantity/unit/pickupLocation/pickupNotes/lines). */
    returnEditPermissions?: unknown;
    pickupType?: string;
    pickupLocation?: string;
    customPickupLocation?: string;
    pickupNotes?: string | null;
    lines?: Array<{
      id?: string;
      itemId?: string | null;
      itemTitle?: string;
      confirmedQty?: number;
      unitCode?: string;
      unitLabel?: string;
      customUnitLabel?: string | null;
      unitPrice?: number;
      notes?: string | null;
      remove?: boolean;
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

    const tenantSlugLabel = (params.tenantSlug || "default").trim() || "default";

    if (reqRecord.status === "COMPLETED" || reqRecord.linkedSaleId || reqRecord.linkedInvoiceId) {
      if (params.action !== "AMEND") {
        throw new Error("REQUEST_ALREADY_COMPLETED");
      }

      const beforeTotalPost =
        Number(reqRecord.totalConfirmed || 0) > 0
          ? Number(reqRecord.totalConfirmed || 0)
          : Number(reqRecord.totalEstimated || 0);
      const oldPaid = Math.max(0, Number(reqRecord.creditPaidPlanned || 0));
      const oldDebit = Math.max(0, Number(reqRecord.debitPlanned || 0));
      const beforeSnapPost = buildRequestSnapshotFromValues({
        pickupType: reqRecord.pickupType,
        pickupLocation: reqRecord.pickupLocation,
        pickupNotes: reqRecord.pickupNotes,
        creditPaidPlanned: oldPaid,
        debitPlanned: oldDebit,
        totalAmount: beforeTotalPost,
        lines: reqRecord.lines.map((l) => ({
          id: l.id,
          itemTitle: l.itemTitle,
          qty:
            l.confirmedQty !== null && l.confirmedQty !== undefined
              ? Number(l.confirmedQty)
              : Number(l.requestedQty),
          unitCode: l.unitCode,
          unitLabel: l.unitLabel,
          customUnitLabel: l.customUnitLabel,
          unitPrice: Number(l.unitPrice || 0),
          lineTotal: Number(l.lineTotal || 0),
        })),
      });

      const resolvedPost = await resolveUpdatedRequestLinesAndPickup({
        reqRecord,
        pickupType: params.pickupType,
        pickupLocation: params.pickupLocation,
        customPickupLocation: params.customPickupLocation,
        pickupNotes: params.pickupNotes,
        lines: params.lines,
      });
      const nextTotal = resolvedPost.totalConfirmed;
      if (nextTotal <= 0) {
        throw new Error("يرجى تحديد كمية وأسعار مؤكدة أكبر من الصفر عند تعديل الطلب المسلم");
      }
      const nextPaid = Math.max(
        0,
        Number(params.immediatePaidAmount !== undefined ? params.immediatePaidAmount : oldPaid)
      );
      if (nextPaid > nextTotal + 0.01) {
        throw new Error("المبلغ المقبوض يتجاوز الإجمالي المعدل للفاتورة");
      }
      const { debitReceivable: nextDebit } = computeSaleTotals(nextTotal, 1, nextPaid);
      const afterSnapPost = buildRequestSnapshotFromValues({
        pickupType: resolvedPost.pickupType,
        pickupLocation: resolvedPost.pickupLocation,
        pickupNotes: resolvedPost.pickupNotes,
        creditPaidPlanned: nextPaid,
        debitPlanned: nextDebit,
        totalAmount: nextTotal,
        lines: resolvedPost.resolvedLines.map((l, idx) => ({
          id: l.existingId || `post-new-${idx + 1}`,
          itemTitle: l.itemTitle,
          qty: l.confirmedQty,
          unitCode: l.unitCode,
          unitLabel: l.unitLabel,
          customUnitLabel: l.customUnitLabel,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
      });
      const postDiffs = computeRequestAmendmentDiff(beforeSnapPost, afterSnapPost);
      const projectChanged = Boolean(params.projectId && params.projectId !== reqRecord.projectId);
      const notesChanged =
        params.staffNotes !== undefined && (params.staffNotes.trim() || null) !== reqRecord.staffNotes;

      if (postDiffs.length === 0 && !projectChanged && !notesChanged) {
        return { ...serializeRequest(reqRecord), idempotentReplay: true };
      }

      const postResult = await prisma.$transaction(async (tx) => {
        const freshReq = await tx.clientGoodsRequest.findUniqueOrThrow({
          where: { id: reqRecord.id },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });

        const targetProjectId = params.projectId || freshReq.projectId;
        const targetProject =
          (targetProjectId
            ? await tx.project.findUnique({ where: { id: targetProjectId } })
            : null) || (await tx.project.findFirst({ orderBy: { createdAt: "asc" } }));
        if (!targetProject) {
          throw new Error("لا يوجد مشروع فعال مرتبط بتعديل هذه الفاتورة");
        }
        const targetSubProjectId =
          params.subProjectId !== undefined ? params.subProjectId : freshReq.subProjectId;
        const targetHarvestName =
          params.harvestName || freshReq.harvestName || "مبيعات بوابة العملاء";

        if (await isHarvestLockedTx(tx, targetProject.id, targetHarvestName)) {
          throw new Error("HARVEST_LOCKED");
        }

        const customerId = freshReq.customerId || freshReq.clientAccount.customerId;
        if (!customerId) {
          throw new Error("لا يوجد حساب عميل محاسبي مرتبط بهذا الطلب");
        }
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: customerId },
          include: { account: true },
        });

        const netDebitDelta = Math.max(0, round4(nextDebit - oldDebit));
        if (netDebitDelta > 0.01) {
          await assertCustomerCreditAvailableTx(
            tx,
            customer.id,
            netDebitDelta,
            params.overrideCreditLimit
          );
        }

        await tx.clientGoodsRequestLine.deleteMany({ where: { requestId: freshReq.id } });
        await tx.clientGoodsRequestLine.createMany({
          data: resolvedPost.resolvedLines.map((l, idx) => ({
            ...(l.existingId ? { id: l.existingId } : {}),
            requestId: freshReq.id,
            lineOrder: idx + 1,
            itemId: l.itemId,
            itemTitle: l.itemTitle,
            requestedQty: l.requestedQty,
            confirmedQty: l.confirmedQty,
            unitCode: l.unitCode,
            unitLabel: l.unitLabel,
            customUnitLabel: l.customUnitLabel,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            notes: l.notes,
          })),
        });

        const now = new Date();
        const nextRev = Number(freshReq.revisionNumber || 1) + 1;
        const totalBundles = resolvedPost.resolvedLines.reduce(
          (s, l) => s + Math.max(0, Math.round(l.confirmedQty)),
          0
        );
        const firstGrade =
          resolvedPost.resolvedLines.map((l) => l.itemTitle).slice(0, 2).join(" / ") || "طلب عميل";

        let invoiceNumberLabel = freshReq.requestNumber;
        let invoiceJournalId: string | null = null;
        let nextLinkedReceiptId: string | null = freshReq.linkedReceiptId;
        let receiptVoucherNoLabel = freshReq.requestNumber;

        if (freshReq.linkedInvoiceId) {
          const inv = await tx.salesInvoice.findUnique({
            where: { id: freshReq.linkedInvoiceId },
            include: { harvestCycle: true },
          });
          if (inv && inv.status !== "VOIDED") {
            if (inv.harvestCycle?.isLocked) throw new Error("HARVEST_LOCKED");
            invoiceNumberLabel = inv.invoiceNumber;
            receiptVoucherNoLabel = inv.invoiceNumber;
            invoiceJournalId = inv.journalEntryId;

            const invTotalChanged =
              Math.abs(nextTotal - Number(inv.totalAmount || 0)) > 0.005 ||
              targetProject.id !== inv.projectId ||
              targetSubProjectId !== inv.subProjectId;

            await tx.salesInvoiceItem.deleteMany({ where: { invoiceId: inv.id } });
            await tx.salesInvoiceItem.createMany({
              data: resolvedPost.resolvedLines
                .filter((l) => l.confirmedQty > 0)
                .map((l) => ({
                  invoiceId: inv.id,
                  itemId: l.itemId,
                  description: `${l.itemTitle} (${resolveDisplayUnitLabel(
                    l.unitCode,
                    l.unitLabel,
                    l.customUnitLabel
                  )})`,
                  quantity: l.confirmedQty,
                  unitPrice: l.unitPrice,
                  netAmount: l.lineTotal,
                  taxAmount: 0,
                  whtAmount: 0,
                  totalAmount: l.lineTotal,
                  costOfGoodsSold: 0,
                })),
            });

            if (invTotalChanged) {
              if (inv.journalEntryId) {
                const oldInvJe = await tx.journalEntry.findUnique({
                  where: { id: inv.journalEntryId },
                  select: { status: true, isReversed: true },
                });
                if (oldInvJe && oldInvJe.status !== "VOIDED" && !oldInvJe.isReversed) {
                  await reverseJournalEntry({
                    tx,
                    journalEntryId: inv.journalEntryId,
                    createdById: params.actor.userId ?? undefined,
                    reason: `تعديل فاتورة طلب البوابة ${freshReq.requestNumber}`,
                  });
                }
              }

              const newInvJe = await postJournalEntry({
                tx,
                date: inv.date,
                costCenterId: inv.costCenterId ?? customer.costCenterId ?? null,
                reference: `${inv.invoiceNumber}-REV-${nextRev}`,
                narrationAr: `قيد معدل لفاتورة ${inv.invoiceNumber} (طلب البوابة ${freshReq.requestNumber}) - ${customer.nameAr}`,
                narrationEn: `Amended Sales Invoice ${inv.invoiceNumber} - ${customer.nameEn || customer.nameAr}`,
                sourceType: "SALES_INVOICE",
                sourceId: inv.id,
                projectId: targetProject.id,
                subProjectId: targetSubProjectId,
                createdById: params.actor.userId ?? undefined,
                status: "POSTED",
                skipApprovalCheck: true,
                lines: [
                  {
                    accountId: customer.accountId,
                    debit: nextTotal,
                    currency: inv.currency || "YER",
                    exchangeRate: Number(inv.exchangeRate || 1),
                    memo: `ذمة مدينة معدلة - ${customer.nameAr}`,
                    projectId: targetProject.id,
                    subProjectId: targetSubProjectId,
                    harvestCycleId: inv.harvestCycleId,
                  },
                  {
                    accountCode: inv.revenueAccountCode || mapProjectIdToSalesRevenueCode(targetProject.id),
                    credit: nextTotal,
                    currency: inv.currency || "YER",
                    exchangeRate: Number(inv.exchangeRate || 1),
                    memo: `إيراد مبيعات معدل (${inv.invoiceNumber})`,
                    projectId: targetProject.id,
                    subProjectId: targetSubProjectId,
                    harvestCycleId: inv.harvestCycleId,
                  },
                ],
              });
              invoiceJournalId = newInvJe.id;
            }

            const paidDelta = Math.abs(nextPaid - oldPaid);
            const existingReceipt = freshReq.linkedReceiptId
              ? await tx.receiptVoucher.findUnique({
                where: { id: freshReq.linkedReceiptId },
                include: { treasury: true },
              })
              : null;

            if (paidDelta > 0.005) {
              if (existingReceipt && existingReceipt.documentStatus !== "VOIDED") {
                if (existingReceipt.journalEntryId) {
                  const oldRcpJe = await tx.journalEntry.findUnique({
                    where: { id: existingReceipt.journalEntryId },
                    select: { status: true, isReversed: true },
                  });
                  if (oldRcpJe && oldRcpJe.status !== "VOIDED" && !oldRcpJe.isReversed) {
                    await reverseJournalEntry({
                      tx,
                      journalEntryId: existingReceipt.journalEntryId,
                      createdById: params.actor.userId ?? undefined,
                      reason: `تعديل سند قبض طلب البوابة ${freshReq.requestNumber}`,
                    });
                  }
                }

                const oldTrRateRow = await tx.currencyRate.findUnique({
                  where: { currencyCode: existingReceipt.treasury.currency },
                });
                const oldTrRate =
                  existingReceipt.treasury.currency === "YER"
                    ? 1
                    : Number(oldTrRateRow?.rateToYER) ||
                    (existingReceipt.treasury.currency === "SAR" ? 425 : 1620);
                const oldBaseAmt = Number(existingReceipt.amount || 0);
                await tx.treasuryAccount.update({
                  where: { id: existingReceipt.treasuryId },
                  data: {
                    balance: dSub(existingReceipt.treasury.balance, dDiv(oldBaseAmt, oldTrRate, 4), 4),
                    balanceYER: dSub(existingReceipt.treasury.balanceYER, oldBaseAmt, 4),
                  },
                });

                if (nextPaid > 0.005) {
                  const targetTreasury =
                    (params.treasuryId
                      ? await tx.treasuryAccount.findUnique({ where: { id: params.treasuryId } })
                      : null) ||
                    (await tx.treasuryAccount.findUnique({ where: { id: existingReceipt.treasuryId } })) ||
                    (await tx.treasuryAccount.findFirst({ orderBy: { code: "asc" } }));
                  if (!targetTreasury) throw new Error("يرجى اختيار خزينة لتحديث الدفعة النقدية");

                  const nextTrRateRow = await tx.currencyRate.findUnique({
                    where: { currencyCode: targetTreasury.currency },
                  });
                  const nextTrRate =
                    targetTreasury.currency === "YER"
                      ? 1
                      : Number(nextTrRateRow?.rateToYER) ||
                      (targetTreasury.currency === "SAR" ? 425 : 1620);

                  await tx.treasuryAccount.update({
                    where: { id: targetTreasury.id },
                    data: {
                      balance: dAdd(targetTreasury.balance, dDiv(nextPaid, nextTrRate, 4), 4),
                      balanceYER: dAdd(targetTreasury.balanceYER, nextPaid, 4),
                    },
                  });

                  const newRcpJe = await postJournalEntry({
                    tx,
                    date: existingReceipt.date,
                    reference: `${existingReceipt.voucherNumber}-REV-${nextRev}`,
                    narrationAr: `سند قبض معدل ${existingReceipt.voucherNumber} - ${customer.nameAr}`,
                    narrationEn: `Amended Receipt ${existingReceipt.voucherNumber}`,
                    sourceType: "CUSTOMER_RECEIPT",
                    sourceId: existingReceipt.id,
                    projectId: targetProject.id,
                    subProjectId: targetSubProjectId,
                    createdById: params.actor.userId ?? undefined,
                    status: "POSTED",
                    skipApprovalCheck: true,
                    lines: [
                      {
                        accountId: targetTreasury.accountId,
                        debit: nextPaid,
                        currency: "YER",
                        exchangeRate: 1,
                        memo: `توريد معدل إلى ${targetTreasury.nameAr}`,
                        projectId: targetProject.id,
                        subProjectId: targetSubProjectId,
                      },
                      {
                        accountId: customer.accountId,
                        credit: nextPaid,
                        currency: "YER",
                        exchangeRate: 1,
                        memo: `تحصيل معدل لطلب ${freshReq.requestNumber}`,
                        projectId: targetProject.id,
                        subProjectId: targetSubProjectId,
                      },
                    ],
                  });

                  await tx.receiptVoucher.update({
                    where: { id: existingReceipt.id },
                    data: {
                      treasuryId: targetTreasury.id,
                      subProjectId: targetSubProjectId,
                      amount: nextPaid,
                      foreignAmount: nextPaid,
                      baseAmount: nextPaid,
                      journalEntryId: newRcpJe.id,
                      revisionNumber: { increment: 1 },
                      notes: `تحصيل معدل عند تعديل طلب البوابة ${freshReq.requestNumber}`,
                    },
                  });
                  receiptVoucherNoLabel = existingReceipt.voucherNumber;
                  nextLinkedReceiptId = existingReceipt.id;
                } else {
                  await tx.receiptVoucher.update({
                    where: { id: existingReceipt.id },
                    data: {
                      documentStatus: "VOIDED",
                      amount: 0,
                      foreignAmount: 0,
                      baseAmount: 0,
                      revisionNumber: { increment: 1 },
                      notes: `ملغى بعد تعديل مقبوض طلب البوابة ${freshReq.requestNumber}`,
                    },
                  });
                  nextLinkedReceiptId = null;
                }
              } else if (nextPaid > 0.005) {
                // Ensure invoice balances reset cleanly before postCustomerReceipt increments paidAmount
                await tx.salesInvoice.update({
                  where: { id: inv.id },
                  data: {
                    paidAmount: 0,
                    balanceDue: nextTotal,
                    status: "POSTED",
                  },
                });
                const treasury =
                  (params.treasuryId
                    ? await tx.treasuryAccount.findUnique({ where: { id: params.treasuryId } })
                    : null) || (await tx.treasuryAccount.findFirst({ orderBy: { code: "asc" } }));
                if (!treasury) throw new Error("يرجى اختيار خزينة لتحصيل الدفعة النقدية");

                const newRec = await postCustomerReceipt({
                  tx,
                  customerId: customer.id,
                  invoiceId: inv.id,
                  projectId: targetProject.id,
                  subProjectId: targetSubProjectId,
                  treasuryId: treasury.id,
                  amount: nextPaid,
                  notes: `تحصيل مضاف بعد تعديل طلب البوابة ${freshReq.requestNumber}`,
                  createdById: params.actor.userId ?? undefined,
                });
                nextLinkedReceiptId = newRec.receipt.id;
                receiptVoucherNoLabel = newRec.receipt.voucherNumber;
              }
            }

            const nextInvStatus =
              nextDebit <= 0.005 ? "PAID" : nextPaid > 0.005 ? "PARTIALLY_PAID" : "POSTED";
            await tx.salesInvoice.update({
              where: { id: inv.id },
              data: {
                projectId: targetProject.id,
                subProjectId: targetSubProjectId,
                subTotal: nextTotal,
                totalAmount: nextTotal,
                paidAmount: nextPaid,
                balanceDue: nextDebit,
                foreignAmount: nextTotal,
                baseAmount: dMul(nextTotal, Number(inv.exchangeRate || 1), 4),
                status: nextInvStatus,
                revisionNumber: nextRev,
                journalEntryId: invoiceJournalId,
                notes: `طلب بوابة عميل معدل ${freshReq.requestNumber} (استلام من: ${resolvedPost.pickupLocation})`,
              },
            });
          }
        }

        if (freshReq.linkedSaleId) {
          const existingSale = await tx.saleTransaction.findUnique({
            where: { id: freshReq.linkedSaleId },
          });
          if (existingSale) {
            await tx.saleTransaction.update({
              where: { id: existingSale.id },
              data: {
                projectId: targetProject.id,
                subProjectId: targetSubProjectId,
                harvestName: targetHarvestName,
                productGrade: firstGrade,
                bundlesCount: Math.max(1, totalBundles),
                unitPrice: totalBundles > 0 ? round4(nextTotal / totalBundles) : nextTotal,
                totalAmount: nextTotal,
                creditPaid: nextPaid,
                debitReceivable: nextDebit,
                receiptVoucherNo: receiptVoucherNoLabel,
                sequenceNumber: invoiceNumberLabel,
                notes: `تسليم معدل لطلب عميل ${freshReq.requestNumber} — استلام من: ${resolvedPost.pickupLocation}`,
                journalEntryId: invoiceJournalId ?? existingSale.journalEntryId,
              },
            });
          }
        }

        const savedPostReq = await tx.clientGoodsRequest.update({
          where: { id: freshReq.id },
          data: {
            status: "COMPLETED",
            pickupType: resolvedPost.pickupType,
            pickupLocation: resolvedPost.pickupLocation,
            pickupNotes: resolvedPost.pickupNotes,
            totalConfirmed: nextTotal,
            creditPaidPlanned: nextPaid,
            debitPlanned: nextDebit,
            projectId: targetProject.id,
            subProjectId: targetSubProjectId,
            harvestName: targetHarvestName,
            linkedReceiptId: nextLinkedReceiptId,
            staffNotes:
              params.staffNotes !== undefined ? params.staffNotes.trim() || null : freshReq.staffNotes,
            reviewerRemarks:
              params.reviewerRemarks !== undefined
                ? params.reviewerRemarks.trim() || freshReq.reviewerRemarks
                : freshReq.reviewerRemarks,
            amendmentDiffJson: JSON.stringify(postDiffs),
            beforeSnapshotJson: JSON.stringify(beforeSnapPost),
            afterSnapshotJson: JSON.stringify(afterSnapPost),
            revisionNumber: nextRev,
            clientResponseStatus: "STAFF_AMENDED_POST_HANDOVER",
            reviewedById: params.actor.userId ?? null,
            reviewedByName: params.actor.userDisplay,
            reviewedAt: now,
          },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });

        const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
        await createWhatsAppDraftTx(tx, {
          eventType: "HANDOVER_INVOICE",
          clientAccountId: savedPostReq.clientAccountId,
          customerId: savedPostReq.customerId,
          requestId: savedPostReq.id,
          recipientName: savedPostReq.clientAccount.fullName,
          recipientPhone: savedPostReq.clientAccount.phone,
          variables: {
            companyName: profile?.legalNameAr || "المنشأة",
            requestNumber: savedPostReq.requestNumber,
            invoiceNumber: invoiceNumberLabel,
            totalAmount: nextTotal.toLocaleString("en-US"),
            paidAmount: nextPaid.toLocaleString("en-US"),
            balanceDue: nextDebit.toLocaleString("en-US"),
            currency: savedPostReq.currency || "YER",
          },
        });

        await appendAuditLogTx(tx, {
          userId: params.actor.userId,
          userDisplay: params.actor.userDisplay,
          userRole: params.actor.userRole,
          actionType: "CLIENT_REQUEST_POST_HANDOVER_AMENDED",
          entityReference: savedPostReq.requestNumber,
          details: `[tenant:${tenantSlugLabel}] تعديل طلب مسلّم ${savedPostReq.requestNumber} مع مزامنة الفاتورة (${invoiceNumberLabel}) والمبيعات (${freshReq.linkedSaleId || "—"}) دون تكرار | الإجمالي: ${nextTotal} (مدفوع: ${nextPaid}، آجل: ${nextDebit}) | (${postDiffs.length} تغييرات)`,
        });

        return savedPostReq;
      });

      return { ...serializeRequest(postResult), idempotentReplay: false };
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
          details: `[tenant:${tenantSlugLabel}] تحويل طلب العميل ${reqRecord.requestNumber} إلى ${nextStatus} بواسطة ${params.actor.userDisplay} (${params.actor.userId || "staff"}) في ${new Date().toISOString()}`,
        });
        return rec;
      });
      return { ...serializeRequest(updated), idempotentReplay: false };
    }

    // Capture Before snapshot prior to applying staff modifications
    const beforeBaseTotal =
      Number(reqRecord.totalConfirmed || 0) > 0
        ? Number(reqRecord.totalConfirmed || 0)
        : Number(reqRecord.totalEstimated || 0);
    const beforeSnap = buildRequestSnapshotFromValues({
      pickupType: reqRecord.pickupType,
      pickupLocation: reqRecord.pickupLocation,
      pickupNotes: reqRecord.pickupNotes,
      creditPaidPlanned: Number(reqRecord.creditPaidPlanned || 0),
      debitPlanned: Number(reqRecord.debitPlanned || 0),
      totalAmount: beforeBaseTotal,
      lines: reqRecord.lines.map((l) => ({
        id: l.id,
        itemTitle: l.itemTitle,
        qty:
          l.confirmedQty !== null && l.confirmedQty !== undefined
            ? Number(l.confirmedQty)
            : Number(l.requestedQty),
        unitCode: l.unitCode,
        unitLabel: l.unitLabel,
        customUnitLabel: l.customUnitLabel,
        unitPrice: Number(l.unitPrice || 0),
        lineTotal: Number(l.lineTotal || 0),
      })),
    });

    const resolvedPatch = await resolveUpdatedRequestLinesAndPickup({
      reqRecord,
      pickupType: params.pickupType,
      pickupLocation: params.pickupLocation,
      customPickupLocation: params.customPickupLocation,
      pickupNotes: params.pickupNotes,
      lines: params.lines,
    });

    const totalConfirmed = resolvedPatch.totalConfirmed;
    const plannedCreditPaidPreview = Math.min(
      totalConfirmed,
      Math.max(
        0,
        Number(
          params.immediatePaidAmount !== undefined
            ? params.immediatePaidAmount
            : reqRecord.creditPaidPlanned || 0
        )
      )
    );
    const { debitReceivable: plannedDebitPreview } = computeSaleTotals(
      totalConfirmed,
      1,
      plannedCreditPaidPreview
    );

    const afterSnapPreview = buildRequestSnapshotFromValues({
      pickupType: resolvedPatch.pickupType,
      pickupLocation: resolvedPatch.pickupLocation,
      pickupNotes: resolvedPatch.pickupNotes,
      creditPaidPlanned: plannedCreditPaidPreview,
      debitPlanned: plannedDebitPreview,
      totalAmount: totalConfirmed,
      lines: resolvedPatch.resolvedLines.map((l, idx) => ({
        id: l.existingId || `new-${idx + 1}`,
        itemTitle: l.itemTitle,
        qty: l.confirmedQty,
        unitCode: l.unitCode,
        unitLabel: l.unitLabel,
        customUnitLabel: l.customUnitLabel,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
      })),
    });
    const amendmentDiffs = computeRequestAmendmentDiff(beforeSnap, afterSnapPreview);

    if (params.action === "RETURN_TO_CLIENT" || params.action === "AMEND") {
      const cleanRemarks = params.reviewerRemarks !== undefined
        ? params.reviewerRemarks.trim()
        : params.staffNotes?.trim() || "";
      if (params.action === "RETURN_TO_CLIENT" && !cleanRemarks) {
        throw new Error("يرجى كتابة ملاحظات المراجع للعميل قبل إعادة الطلب للموافقة");
      }

      const updatedRec = await prisma.$transaction(async (tx) => {
        const freshReq = await tx.clientGoodsRequest.findUniqueOrThrow({
          where: { id: reqRecord.id },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });

        await tx.clientGoodsRequestLine.deleteMany({ where: { requestId: freshReq.id } });
        await tx.clientGoodsRequestLine.createMany({
          data: resolvedPatch.resolvedLines.map((l, idx) => ({
            ...(l.existingId ? { id: l.existingId } : {}),
            requestId: freshReq.id,
            lineOrder: idx + 1,
            itemId: l.itemId,
            itemTitle: l.itemTitle,
            requestedQty: l.requestedQty,
            confirmedQty: l.confirmedQty,
            unitCode: l.unitCode,
            unitLabel: l.unitLabel,
            customUnitLabel: l.customUnitLabel,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            notes: l.notes,
          })),
        });

        const now = new Date();
        const nextStatus =
          params.action === "RETURN_TO_CLIENT" ? "RETURNED_TO_CLIENT" : freshReq.status;

        const saved = await tx.clientGoodsRequest.update({
          where: { id: freshReq.id },
          data: {
            status: nextStatus,
            ...(params.action === "RETURN_TO_CLIENT"
              ? {
                returnEditPermissionsJson: JSON.stringify(
                  normalizeReturnEditPermissions(params.returnEditPermissions)
                ),
              }
              : {}),
            pickupType: resolvedPatch.pickupType,
            pickupLocation: resolvedPatch.pickupLocation,
            pickupNotes: resolvedPatch.pickupNotes,
            totalConfirmed,
            creditPaidPlanned: plannedCreditPaidPreview,
            debitPlanned: plannedDebitPreview,
            staffNotes: params.staffNotes !== undefined ? params.staffNotes.trim() || null : freshReq.staffNotes,
            reviewerRemarks: cleanRemarks || freshReq.reviewerRemarks,
            amendmentDiffJson: JSON.stringify(amendmentDiffs),
            beforeSnapshotJson: JSON.stringify(beforeSnap),
            afterSnapshotJson: JSON.stringify(afterSnapPreview),
            revisionNumber: { increment: 1 },
            reviewedById: params.actor.userId ?? null,
            reviewedByName: params.actor.userDisplay,
            reviewedAt: now,
            ...(params.action === "RETURN_TO_CLIENT"
              ? {
                returnedToClientAt: now,
                returnedByUserId: params.actor.userId ?? null,
                returnedByName: params.actor.userDisplay,
                clientResponseStatus: "PENDING_CLIENT_APPROVAL",
                clientResponseNote: null,
                clientRespondedAt: null,
              }
              : {}),
          },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });

        if (freshReq.linkedDraftId) {
          await initiateOrUpdateLinkedSalesDraftTx(tx, {
            freshReq: saved,
            projectId: params.projectId,
            subProjectId: params.subProjectId,
            harvestName: params.harvestName,
            treasuryId: params.treasuryId,
            immediatePaidAmount: plannedCreditPaidPreview,
            overrideCreditLimit: params.overrideCreditLimit,
            actor: params.actor,
          });
        }

        if (params.action === "RETURN_TO_CLIENT") {
          const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
          await createWhatsAppDraftTx(tx, {
            eventType: "REQUEST_RETURNED_FOR_APPROVAL",
            clientAccountId: saved.clientAccountId,
            customerId: saved.customerId,
            requestId: saved.id,
            recipientName: saved.clientAccount.fullName,
            recipientPhone: saved.clientAccount.phone,
            variables: {
              companyName: profile?.legalNameAr || "المنشأة",
              requestNumber: saved.requestNumber,
              reviewerRemarks: cleanRemarks,
              totalAmount: totalConfirmed.toLocaleString("en-US"),
              currency: saved.currency || "YER",
              portalUrl: params.portalUrl || `${resolveTenantCloudUrl(tenantSlugLabel)}/portal`,
            },
          });
        }

        await appendAuditLogTx(tx, {
          userId: params.actor.userId,
          userDisplay: params.actor.userDisplay,
          userRole: params.actor.userRole,
          actionType:
            params.action === "RETURN_TO_CLIENT"
              ? "CLIENT_REQUEST_RETURNED_TO_CLIENT"
              : "CLIENT_REQUEST_AMENDED",
          entityReference: saved.requestNumber,
          details: `[tenant:${tenantSlugLabel}] ${params.action === "RETURN_TO_CLIENT"
            ? `إعادة طلب ${saved.requestNumber} للعميل للموافقة`
            : `تعديل بيانات طلب ${saved.requestNumber}`
            } (${amendmentDiffs.length} تغييرات) | ملاحظات: ${cleanRemarks || "—"} | الإجمالي: ${totalConfirmed}`,
        });

        return saved;
      });

      return { ...serializeRequest(updatedRec), idempotentReplay: false };
    }

    if (params.action === "CONFIRM" || params.action === "MARK_READY") {
      const nextStatus = params.action === "MARK_READY" ? "READY_FOR_PICKUP" : "CONFIRMED";
      const reserveStock = Boolean(params.reserveStock ?? reqRecord.reserveStock);
      const reservedSummary: Array<{ itemId: string; itemTitle: string; qty: number }> = [];

      if (reserveStock) {
        for (const l of resolvedPatch.resolvedLines) {
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

      const result = await prisma.$transaction(async (tx) => {
        const freshReq = await tx.clientGoodsRequest.findUniqueOrThrow({
          where: { id: reqRecord.id },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });
        const existingSalesRecordId =
          freshReq.linkedSalesRecordId || freshReq.linkedSaleId || freshReq.linkedDraftId;

        const noStaffParamChange =
          amendmentDiffs.length === 0 &&
          (params.projectId === undefined || params.projectId === freshReq.projectId) &&
          (params.reserveStock === undefined || Boolean(params.reserveStock) === Boolean(freshReq.reserveStock)) &&
          (params.immediatePaidAmount === undefined ||
            Math.abs(Number(params.immediatePaidAmount) - Number(freshReq.creditPaidPlanned || 0)) <= 0.005);

        if (
          params.action === "CONFIRM" &&
          existingSalesRecordId &&
          freshReq.status === "CONFIRMED" &&
          noStaffParamChange
        ) {
          return { rec: freshReq, idempotentReplay: true };
        }

        await tx.clientGoodsRequestLine.deleteMany({ where: { requestId: freshReq.id } });
        await tx.clientGoodsRequestLine.createMany({
          data: resolvedPatch.resolvedLines.map((l, idx) => ({
            ...(l.existingId ? { id: l.existingId } : {}),
            requestId: freshReq.id,
            lineOrder: idx + 1,
            itemId: l.itemId,
            itemTitle: l.itemTitle,
            requestedQty: l.requestedQty,
            confirmedQty: l.confirmedQty,
            unitCode: l.unitCode,
            unitLabel: l.unitLabel,
            customUnitLabel: l.customUnitLabel,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            notes: l.notes,
          })),
        });

        const refreshedWithLines = await tx.clientGoodsRequest.findUniqueOrThrow({
          where: { id: freshReq.id },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });
        refreshedWithLines.pickupLocation = resolvedPatch.pickupLocation;

        const salesLink = await initiateOrUpdateLinkedSalesDraftTx(tx, {
          freshReq: refreshedWithLines,
          projectId: params.projectId,
          subProjectId: params.subProjectId,
          harvestName: params.harvestName,
          treasuryId: params.treasuryId,
          immediatePaidAmount: params.immediatePaidAmount,
          overrideCreditLimit: params.overrideCreditLimit,
          actor: params.actor,
        });

        const now = new Date();
        const rec = await tx.clientGoodsRequest.update({
          where: { id: freshReq.id },
          data: {
            status: nextStatus,
            pickupType: resolvedPatch.pickupType,
            pickupLocation: resolvedPatch.pickupLocation,
            pickupNotes: resolvedPatch.pickupNotes,
            customerId: salesLink.customer.id,
            reserveStock,
            reservedSummaryJson: JSON.stringify(reservedSummary),
            totalConfirmed: salesLink.totalConfirmed,
            creditPaidPlanned: salesLink.plannedCreditPaid,
            debitPlanned: salesLink.plannedDebit,
            linkedDraftId: salesLink.linkedDraftId,
            linkedSalesRecordId: freshReq.linkedSalesRecordId || salesLink.linkedDraftId,
            projectId: params.projectId ?? salesLink.targetProject?.id ?? freshReq.projectId,
            subProjectId: params.subProjectId ?? freshReq.subProjectId,
            harvestName: params.harvestName ?? freshReq.harvestName,
            staffNotes: params.staffNotes?.trim() || freshReq.staffNotes,
            ...(amendmentDiffs.length > 0
              ? {
                amendmentDiffJson: JSON.stringify(amendmentDiffs),
                beforeSnapshotJson: JSON.stringify(beforeSnap),
                afterSnapshotJson: JSON.stringify(afterSnapPreview),
                revisionNumber: { increment: 1 },
              }
              : {}),
            ...(freshReq.clientResponseStatus === "PENDING_STAFF_APPROVAL"
              ? { clientResponseStatus: "STAFF_APPROVED" }
              : {}),
            approvedByUserId: freshReq.approvedByUserId ?? params.actor.userId ?? null,
            approvedByName: freshReq.approvedByName ?? params.actor.userDisplay,
            approvedAt: freshReq.approvedAt ?? now,
            reviewedById: params.actor.userId ?? null,
            reviewedByName: params.actor.userDisplay,
            reviewedAt: freshReq.reviewedAt || now,
            ...(nextStatus === "READY_FOR_PICKUP" ? { readyAt: freshReq.readyAt || now } : {}),
          },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });

        const statusChanged = freshReq.status !== nextStatus;
        if (statusChanged) {
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
              totalAmount: salesLink.totalConfirmed.toLocaleString("en-US"),
              currency: rec.currency || "YER",
            },
          });
        }

        await appendAuditLogTx(tx, {
          userId: params.actor.userId,
          userDisplay: params.actor.userDisplay,
          userRole: params.actor.userRole,
          actionType: `CLIENT_REQUEST_${nextStatus}`,
          entityReference: rec.requestNumber,
          details: `[tenant:${tenantSlugLabel}] اعتماد/تحديث طلب ${rec.requestNumber} -> ${REQUEST_STATUS_LABELS_AR[nextStatus]} | سجل المبيعات المرتبط: ${salesLink.linkedDraftId} | الإجمالي: ${salesLink.totalConfirmed} | مقبوض: ${salesLink.plannedCreditPaid} | آجل: ${salesLink.plannedDebit} | المستخدم: ${params.actor.userDisplay} (${params.actor.userId || "staff"}) في ${now.toISOString()}`,
        });

        return { rec, idempotentReplay: false };
      });

      return { ...serializeRequest(result.rec), idempotentReplay: result.idempotentReplay };
    }

    // HANDOVER ("تم الاستلام"): Post accounting SalesInvoice + SaleTransaction + optional ReceiptVoucher
    const updatedLinesData = resolvedPatch.resolvedLines;
    const effectiveTotal = totalConfirmed > 0 ? totalConfirmed : Number(reqRecord.totalEstimated || 0);
    if (effectiveTotal <= 0) {
      throw new Error("يرجى تحديد سعر وكمية مؤكدة أكبر من الصفر قبل إتمام التسليم وإصدار الفاتورة");
    }

    const paidImmediate = Math.max(0, Number(params.immediatePaidAmount || 0));
    if (paidImmediate > effectiveTotal + 0.01) {
      throw new Error("المبلغ المقبوض عند التسليم يتجاوز إجمالي الفاتورة");
    }
    const { debitReceivable } = computeSaleTotals(effectiveTotal, 1, paidImmediate);

    const handoverResult = await prisma.$transaction(async (tx) => {
      const freshReq = await tx.clientGoodsRequest.findUniqueOrThrow({
        where: { id: reqRecord.id },
        include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
      });
      if (freshReq.status === "COMPLETED" || freshReq.linkedSaleId || freshReq.linkedInvoiceId) {
        throw new Error("REQUEST_ALREADY_COMPLETED");
      }

      await tx.clientGoodsRequestLine.deleteMany({ where: { requestId: freshReq.id } });
      await tx.clientGoodsRequestLine.createMany({
        data: updatedLinesData.map((l, idx) => ({
          ...(l.existingId ? { id: l.existingId } : {}),
          requestId: freshReq.id,
          lineOrder: idx + 1,
          itemId: l.itemId,
          itemTitle: l.itemTitle,
          requestedQty: l.requestedQty,
          confirmedQty: l.confirmedQty,
          unitCode: l.unitCode,
          unitLabel: l.unitLabel,
          customUnitLabel: l.customUnitLabel,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          notes: l.notes,
        })),
      });

      await ensure6GenerationCoaHierarchy(tx);

      let customerId = freshReq.customerId || freshReq.clientAccount.customerId;
      if (!customerId) {
        const cust = await ensureCustomerWithAccountTx(tx, {
          name: freshReq.clientAccount.tradeName || freshReq.clientAccount.fullName,
          phone: freshReq.clientAccount.phone,
        });
        customerId = cust.id;
        await tx.clientPortalAccount.update({
          where: { id: freshReq.clientAccountId },
          data: { customerId: cust.id },
        });
      }

      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      const targetProject =
        (params.projectId
          ? await tx.project.findUnique({ where: { id: params.projectId } })
          : freshReq.projectId
            ? await tx.project.findUnique({ where: { id: freshReq.projectId } })
            : null) ||
        (await tx.project.findFirst({ orderBy: { createdAt: "asc" } }));
      if (!targetProject) {
        throw new Error("لا يوجد مشروع فعال لربط فاتورة التسليم به");
      }

      const invoiceItems = updatedLinesData
        .filter((l) => l.confirmedQty > 0)
        .map((l) => ({
          description: `${l.itemTitle} (${l.unitCode === "OTHER" && l.customUnitLabel ? l.customUnitLabel : l.unitLabel
            })`,
          quantity: l.confirmedQty,
          unitPrice: l.unitPrice,
          itemId: l.itemId,
        }));

      const postedInvoice = await postSalesInvoice({
        tx,
        customerId: customer.id,
        projectId: targetProject.id,
        subProjectId: params.subProjectId || freshReq.subProjectId || null,
        amount: effectiveTotal,
        items: invoiceItems,
        creditPaidImmediate: paidImmediate,
        overrideCreditLimit: Boolean(params.overrideCreditLimit),
        notes: `تسليم طلب بوابة العميل ${freshReq.requestNumber} (استلام من: ${freshReq.pickupLocation})`,
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
          subProjectId: params.subProjectId || freshReq.subProjectId || null,
          treasuryId: treasury.id,
          amount: paidImmediate,
          notes: `تحصيل عند تسليم طلب البوابة ${freshReq.requestNumber}`,
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
          dailyBatchLabel: freshReq.requestNumber,
          salesOfficerId: params.actor.userId ?? null,
          salesOfficerTitle: params.actor.userDisplay,
          projectId: targetProject.id,
          subProjectId: params.subProjectId || freshReq.subProjectId || null,
          harvestName: params.harvestName || freshReq.harvestName || "مبيعات بوابة العملاء",
          saleBatchLabel: freshReq.requestNumber,
          customerId: customer.id,
          customerName: customer.nameAr,
          customerPhone: customer.phone || freshReq.clientAccount.phone,
          productGrade: firstGrade,
          bundlesCount: Math.max(1, totalBundles),
          unitPrice: totalBundles > 0 ? round4(effectiveTotal / totalBundles) : effectiveTotal,
          totalAmount: effectiveTotal,
          creditPaid: paidImmediate,
          debitReceivable,
          saleDate: new Date().toISOString().slice(0, 10),
          receiptVoucherNo,
          notes: `تسليم طلب عميل ${freshReq.requestNumber} — استلام من: ${freshReq.pickupLocation}`,
          journalEntryId: postedInvoice.journalEntry.id,
        },
      });

      if (freshReq.linkedDraftId) {
        await tx.workspaceDraft.updateMany({
          where: { id: freshReq.linkedDraftId, status: { in: ["ACTIVE_DRAFT", "SUBMITTED_FOR_APPROVAL"] } },
          data: {
            status: "CONVERTED",
            convertedEntityId: saleTx.id,
            updatedById: params.actor.userId || "u1",
            updatedByName: params.actor.userDisplay,
          },
        });
      }

      const now = new Date();
      const completedReq = await tx.clientGoodsRequest.update({
        where: { id: freshReq.id },
        data: {
          status: "COMPLETED",
          pickupType: resolvedPatch.pickupType,
          pickupLocation: resolvedPatch.pickupLocation,
          pickupNotes: resolvedPatch.pickupNotes,
          customerId: customer.id,
          totalConfirmed: effectiveTotal,
          creditPaidPlanned: paidImmediate,
          debitPlanned: debitReceivable,
          projectId: targetProject.id,
          subProjectId: params.subProjectId || freshReq.subProjectId || null,
          harvestName: params.harvestName || freshReq.harvestName || "مبيعات بوابة العملاء",
          linkedInvoiceId: postedInvoice.invoice.id,
          linkedSaleId: saleTx.id,
          linkedSalesRecordId: saleTx.id,
          linkedReceiptId,
          ...(freshReq.clientResponseStatus === "PENDING_STAFF_APPROVAL"
            ? { clientResponseStatus: "STAFF_APPROVED" }
            : {}),
          approvedByUserId: freshReq.approvedByUserId ?? params.actor.userId ?? null,
          approvedByName: freshReq.approvedByName ?? params.actor.userDisplay,
          approvedAt: freshReq.approvedAt ?? now,
          handedOverById: params.actor.userId ?? null,
          handedOverByName: params.actor.userDisplay,
          handedOverAt: now,
          staffNotes: params.staffNotes?.trim() || freshReq.staffNotes,
        },
        include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
      });

      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      await deductPublishedCatalogStockForLinesTx(
        tx,
        completedReq.lines.map((l) => ({
          catalogBoardItemId: (l as { catalogBoardItemId?: string | null }).catalogBoardItemId ?? null,
          qty: Math.max(0, Number(l.confirmedQty ?? l.requestedQty ?? 0)),
        }))
      ).catch(() => null);
      await syncPublishedCatalogStockTx(tx).catch(() => null);
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
          balanceDue: debitReceivable.toLocaleString("en-US"),
          currency: completedReq.currency || "YER",
        },
      });

      await appendAuditLogTx(tx, {
        userId: params.actor.userId,
        userDisplay: params.actor.userDisplay,
        userRole: params.actor.userRole,
        actionType: "CLIENT_REQUEST_HANDOVER",
        entityReference: completedReq.requestNumber,
        details: `[tenant:${tenantSlugLabel}] تسليم طلب العميل ${completedReq.requestNumber} (تم الاستلام) وإصدار فاتورة ${postedInvoice.invoice.invoiceNumber} وسجل بيع ${saleTx.id} بمبلغ ${effectiveTotal} (دائن: ${paidImmediate}، مدين: ${debitReceivable}) بواسطة ${params.actor.userDisplay} (${params.actor.userId || "staff"}) في ${now.toISOString()}`,
      });

      return completedReq;
    });

    return serializeRequest(handoverResult);
  }

  /**
   * Phase 13: Client review response on a RETURNED_TO_CLIENT request.
   * Allows approving staff amendments (advancing to CONFIRMED + idempotent sales cycle handoff)
   * or declining / requesting further modifications back to PENDING_REVIEW.
   */
  export async function clientRespondToAmendedRequest(params: {
    requestId: string;
    clientAccountId: string;
    decision: "APPROVE_AMENDMENTS" | "DECLINE_AMENDMENTS";
    clientResponseNote?: string;
    cancelOrder?: boolean;
    tenantSlug?: string;
  }) {
    const existing = await prisma.clientGoodsRequest.findUnique({
      where: { id: params.requestId },
      include: {
        clientAccount: true,
        lines: { orderBy: { lineOrder: "asc" } },
      },
    });
    if (!existing || existing.clientAccountId !== params.clientAccountId) {
      throw new Error("NOT_FOUND: الطلب غير موجود أو غير مصرح بالوصول إليه");
    }
    if (existing.status !== "RETURNED_TO_CLIENT") {
      throw new Error("هذا الطلب ليس في حالة بانتظار موافقة العميل على التعديلات");
    }

    const tenantSlugLabel = (params.tenantSlug || "default").trim() || "default";
    const now = new Date();

    if (params.decision === "APPROVE_AMENDMENTS") {
      const approvedRec = await prisma.$transaction(async (tx) => {
        const freshReq = await tx.clientGoodsRequest.findUniqueOrThrow({
          where: { id: existing.id },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });

        const salesLink = await initiateOrUpdateLinkedSalesDraftTx(tx, {
          freshReq,
          actor: {
            userId: freshReq.returnedByUserId ?? freshReq.approvedByUserId ?? null,
            userDisplay: freshReq.returnedByName || freshReq.clientAccount.fullName,
          },
        });

        const rec = await tx.clientGoodsRequest.update({
          where: { id: freshReq.id },
          data: {
            status: "CONFIRMED",
            customerId: salesLink.customer.id,
            totalConfirmed: salesLink.totalConfirmed,
            creditPaidPlanned: salesLink.plannedCreditPaid,
            debitPlanned: salesLink.plannedDebit,
            linkedDraftId: salesLink.linkedDraftId,
            linkedSalesRecordId: freshReq.linkedSalesRecordId || salesLink.linkedDraftId,
            projectId: salesLink.targetProject?.id ?? freshReq.projectId,
            clientResponseStatus: "CLIENT_APPROVED",
            clientResponseNote: params.clientResponseNote?.trim() || "موافق على التعديلات",
            clientRespondedAt: now,
            approvedAt: freshReq.approvedAt ?? now,
            approvedByUserId: freshReq.approvedByUserId ?? freshReq.returnedByUserId ?? null,
            approvedByName: freshReq.approvedByName ?? freshReq.returnedByName ?? "اعتماد العميل",
          },
          include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
        });

        const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
        await createWhatsAppDraftTx(tx, {
          eventType: "REQUEST_CONFIRMED",
          clientAccountId: rec.clientAccountId,
          customerId: rec.customerId,
          requestId: rec.id,
          recipientName: rec.clientAccount.fullName,
          recipientPhone: rec.clientAccount.phone,
          variables: {
            companyName: profile?.legalNameAr || "المنشأة",
            requestNumber: rec.requestNumber,
            pickupLocation: rec.pickupLocation,
            totalAmount: salesLink.totalConfirmed.toLocaleString("en-US"),
            currency: rec.currency || "YER",
          },
        });

        await appendAuditLogTx(tx, {
          userId: null,
          userDisplay: rec.clientAccount.fullName,
          userRole: "CLIENT_PORTAL",
          actionType: "CLIENT_APPROVED_AMENDMENTS",
          entityReference: rec.requestNumber,
          details: `[tenant:${tenantSlugLabel}] وافق العميل (${rec.clientAccount.fullName}) على التعديلات للطلب ${rec.requestNumber} وتم ربطه بأمر البيع (${salesLink.linkedDraftId})`,
        });

        return rec;
      });

      await emitNotification({
        eventType: "SYSTEM_ALERT",
        severity: "INFO",
        titleAr: `اعتماد العميل لتعديلات الطلب (${approvedRec.requestNumber})`,
        titleEn: `Client Approved Amendments (${approvedRec.requestNumber})`,
        messageAr: `اعتمد العميل ${approvedRec.clientAccount.fullName} التعديلات وأُنشئ/تُحدث أمر البيع المرتبط.`,
        messageEn: `Client approved amended request ${approvedRec.requestNumber}.`,
        targetTab: "customers",
        targetEntityType: "ClientGoodsRequest",
        targetEntityId: approvedRec.id,
      }).catch(() => null);

      return serializeRequest(approvedRec);
    }

    // DECLINE_AMENDMENTS
    const cleanNote =
      params.clientResponseNote?.trim() || "رفض التعديلات وطلب إعادة المراجعة من الموظف";
    const nextStatus = params.cancelOrder ? "CANCELLED" : "PENDING_REVIEW";

    const declinedRec = await prisma.$transaction(async (tx) => {
      const rec = await tx.clientGoodsRequest.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          clientResponseStatus: "CLIENT_DECLINED",
          clientResponseNote: cleanNote,
          clientRespondedAt: now,
        },
        include: { clientAccount: true, lines: { orderBy: { lineOrder: "asc" } } },
      });

      await appendAuditLogTx(tx, {
        userId: null,
        userDisplay: rec.clientAccount.fullName,
        userRole: "CLIENT_PORTAL",
        actionType: "CLIENT_DECLINED_AMENDMENTS",
        entityReference: rec.requestNumber,
        details: `[tenant:${tenantSlugLabel}] رفض/أعاد العميل (${rec.clientAccount.fullName}) تعديلات الطلب ${rec.requestNumber} بملاحظة: ${cleanNote}`,
      });

      return rec;
    });

    await emitNotification({
      eventType: "SYSTEM_ALERT",
      severity: "WARNING",
      titleAr: `ملاحظات عميل على تعديلات الطلب (${declinedRec.requestNumber})`,
      titleEn: `Client Declined Amendments (${declinedRec.requestNumber})`,
      messageAr: `${declinedRec.clientAccount.fullName}: ${cleanNote}`,
      messageEn: `Client declined amendments on ${declinedRec.requestNumber}: ${cleanNote}`,
      targetTab: "customers",
      targetEntityType: "ClientGoodsRequest",
      targetEntityId: declinedRec.id,
    }).catch(() => null);

    return serializeRequest(declinedRec);
  }

  const WA_EVENT_LABELS_AR: Record<string, string> = {
    CLIENT_APPROVED: "اعتماد الحساب",
    REQUEST_RECEIVED: "استلام طلب",
    CLIENT_ORDER_EDITED: "تعديل طلب عميل (بانتظار الاعتماد)",
    REQUEST_RETURNED_FOR_APPROVAL: "معاد للعميل للموافقة",
    REQUEST_CONFIRMED: "تأكيد طلب",
    READY_FOR_PICKUP: "جاهز للاستلام",
    HANDOVER_INVOICE: "فاتورة وتسليم",
    PAYMENT_RECEIPT: "إيصال دفعة",
    BALANCE_SUMMARY: "ملخص الرصيد",
    PASSWORD_RESET: "استعادة كلمة المرور",
    CUSTOM: "إشعار عام",
  };

  const WA_STATUS_LABELS_AR: Record<string, string> = {
    PENDING_APPROVAL: "بانتظار الاعتماد",
    DISPATCHED_LINK: "تم الإرسال (رابط مباشر)",
    APPROVED_SENT: "تم الإرسال",
    SKIPPED: "متجاهل",
    FAILED: "تعذر الإرسال",
  };

  const NON_ENUMERATING_RESET_MSG =
    "في حال كانت البيانات مسجلة في هذه المنشأة، تم إنشاء رمز الاستعادة وإدراجه للمراجعة والإرسال عبر قنوات التواصل المعتمدة لدى المنشأة.";

  async function dispatchOptionalResetEmailWebhook(params: {
    tenantSlug: string;
    email: string;
    fullName: string;
    companyName: string;
    resetCode: string;
    expiresMinutes: number;
    portalUrl: string;
  }): Promise<boolean> {
    const emailWebhookUrl = (process.env.UAS_ALERT_EMAIL_WEBHOOK_URL || "").trim();
    if (!emailWebhookUrl) return false;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = (process.env.UAS_ALERT_EMAIL_WEBHOOK_TOKEN || "").trim();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(emailWebhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          kind: "CLIENT_PASSWORD_RESET",
          tenantSlug: params.tenantSlug,
          to: params.email,
          subject: `رمز استعادة كلمة المرور — ${params.companyName}`,
          body: `مرحباً ${params.fullName}، رمز التحقق الخاص بك: ${params.resetCode} (صالح لمدة ${params.expiresMinutes} دقيقة) عبر ${params.portalUrl}`,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  export async function requestClientPasswordReset(params: {
    identifier: string;
    tenantSlug: string;
    tenantId: string;
    portalUrl: string;
    ipHint?: string;
  }) {
    const raw = String(params.identifier || "").trim();
    if (!raw) {
      throw new Error("يرجى إدخال رقم الجوال أو البريد الإلكتروني");
    }

    const normalizedBucket = `${params.tenantId}:${raw.toLowerCase()}:${params.ipHint || "client"}`;
    if (!consumeClientResetRateLimit(normalizedBucket, 5, 15 * 60 * 1000)) {
      throw new Error("تم تجاوز الحد المسموح من طلبات الاستعادة، يرجى المحاولة بعد 15 دقيقة");
    }

    const account = await findClientAccountByIdentifier(raw, params.tenantSlug);
    if (!account || account.status === "REJECTED" || account.status === "SUSPENDED") {
      return {
        ok: true,
        message: NON_ENUMERATING_RESET_MSG,
      };
    }

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentCount = await prisma.clientPasswordResetToken.count({
      where: {
        clientAccountId: account.id,
        createdAt: { gte: fifteenMinAgo },
      },
    });
    if (recentCount >= 5) {
      return {
        ok: true,
        message: NON_ENUMERATING_RESET_MSG,
      };
    }

    const resetCode = String(crypto.randomInt(100000, 1000000));
    const codeHash = hashClientResetCode(account.id, resetCode);
    const now = new Date();
    const expiresMinutes = 15;
    const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000);

    let companyName = "المنشأة";
    await prisma.$transaction(async (tx) => {
      await tx.clientPasswordResetToken.updateMany({
        where: { clientAccountId: account.id, usedAt: null },
        data: { usedAt: now },
      });

      await tx.clientPasswordResetToken.create({
        data: {
          clientAccountId: account.id,
          codeHash,
          initiatedBy: "SELF",
          expiresAt,
        },
      });

      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      companyName = profile?.legalNameAr || "المنشأة";

      await createWhatsAppDraftTx(tx, {
        eventType: "PASSWORD_RESET",
        clientAccountId: account.id,
        customerId: account.customerId,
        recipientName: account.fullName,
        recipientPhone: account.phone,
        variables: {
          companyName,
          resetCode,
          expiresMinutes,
          portalUrl: params.portalUrl,
        },
      });

      await appendAuditLogTx(tx, {
        userId: null,
        userDisplay: account.fullName,
        userRole: "CLIENT_PORTAL",
        actionType: "CLIENT_PASSWORD_RESET_REQUESTED",
        entityReference: account.id,
        details: `[tenant:${params.tenantSlug}] طلب العميل استعادة كلمة المرور (${account.phone})`,
      });
    });

    if (account.email) {
      await dispatchOptionalResetEmailWebhook({
        tenantSlug: params.tenantSlug,
        email: account.email,
        fullName: account.fullName,
        companyName,
        resetCode,
        expiresMinutes,
        portalUrl: params.portalUrl,
      });
    }

    await emitNotification({
      eventType: "SYSTEM_ALERT",
      severity: "INFO",
      titleAr: `طلب استعادة كلمة مرور عميل (${account.fullName})`,
      titleEn: `Client Password Reset Request (${account.fullName})`,
      messageAr: `طلب العميل ${account.fullName} رمز استعادة كلمة المرور — مسودة إشعار جاهزة في قائمة الاعتماد والإرسال.`,
      messageEn: `Client ${account.fullName} requested password reset; Notification draft queued.`,
      targetTab: "customers",
      targetEntityType: "ClientPortalAccount",
      targetEntityId: account.id,
    }).catch(() => null);

    return {
      ok: true,
      message: NON_ENUMERATING_RESET_MSG,
    };
  }

  export async function confirmClientPasswordReset(params: {
    identifier: string;
    code: string;
    newPassword: string;
    tenantSlug: string;
  }) {
    const identifier = String(params.identifier || "").trim();
    const code = String(params.code || "").trim();
    const newPassword = String(params.newPassword || "").trim();

    if (!identifier || !code) {
      throw new Error("يرجى إدخال رقم الجوال أو البريد الإلكتروني ورمز التحقق");
    }
    if (newPassword.length < 4) {
      throw new Error("كلمة المرور الجديدة يجب أن تتكون من 4 أحرف/أرقام على الأقل");
    }

    const account = await findClientAccountByIdentifier(identifier, params.tenantSlug);
    if (!account || account.status === "REJECTED" || account.status === "SUSPENDED") {
      throw new Error("رمز التحقق غير صالح أو منتهي الصلاحية");
    }

    const now = new Date();
    const token = await prisma.clientPasswordResetToken.findFirst({
      where: {
        clientAccountId: account.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!token) {
      throw new Error("رمز التحقق غير صالح أو منتهي الصلاحية");
    }

    if (token.attempts >= 5) {
      await prisma.clientPasswordResetToken.update({
        where: { id: token.id },
        data: { usedAt: now },
      });
      throw new Error("تم تجاوز الحد الأقصى لمحاولات التحقق، يرجى طلب رمز جديد");
    }

    if (!verifyClientResetCode(account.id, code, token.codeHash)) {
      const nextAttempts = token.attempts + 1;
      await prisma.clientPasswordResetToken.update({
        where: { id: token.id },
        data: {
          attempts: nextAttempts,
          ...(nextAttempts >= 5 ? { usedAt: now } : {}),
        },
      });
      throw new Error("رمز التحقق غير صالح أو منتهي الصلاحية");
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.clientPasswordResetToken.updateMany({
        where: { clientAccountId: account.id, usedAt: null },
        data: { usedAt: now },
      });

      const acc = await tx.clientPortalAccount.update({
        where: { id: account.id },
        data: {
          passwordHash: hashPassword(newPassword),
          mustChangePassword: false,
          passwordUpdatedAt: now,
          sessionVersion: { increment: 1 },
        },
      });

      await appendAuditLogTx(tx, {
        userId: null,
        userDisplay: acc.fullName,
        userRole: "CLIENT_PORTAL",
        actionType: "CLIENT_PASSWORD_RESET_COMPLETED",
        entityReference: acc.id,
        details: `[tenant:${params.tenantSlug}] أكمل العميل استعادة وتعيين كلمة المرور وإلغاء الجلسات السابقة (${acc.phone})`,
      });

      return acc;
    });

    await syncGlobalClientPasswordHash({
      globalClientId: updated.globalClientId,
      normalizedPhone: updated.normalizedPhone || updated.phone,
      normalizedEmail: updated.normalizedEmail || updated.email,
      passwordHash: updated.passwordHash,
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

  function generateReadableTemporaryPassword(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }

  export async function staffResetClientPassword(params: {
    clientAccountId: string;
    customTemporaryPassword?: string;
    portalUrl: string;
    tenantSlug: string;
    actor: { userId?: string | null; userDisplay: string; userRole: string };
  }) {
    const existing = await prisma.clientPortalAccount.findUnique({
      where: { id: params.clientAccountId },
    });
    if (!existing) throw new Error("CLIENT_ACCOUNT_NOT_FOUND");
    if (existing.status === "REJECTED") {
      throw new Error("لا يمكن إعادة تعيين كلمة مرور حساب مرفوض");
    }

    const customTemp = String(params.customTemporaryPassword || "").trim();
    if (customTemp && customTemp.length < 4) {
      throw new Error("كلمة المرور المؤقتة المخصصة يجب أن تكون 4 أحرف/أرقام على الأقل");
    }

    const temporaryPassword = customTemp || generateReadableTemporaryPassword();
    const resetCode = String(crypto.randomInt(100000, 1000000));
    const codeHash = hashClientResetCode(existing.id, resetCode);
    const now = new Date();
    const expiresMinutes = 30;
    const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      await tx.clientPasswordResetToken.updateMany({
        where: { clientAccountId: existing.id, usedAt: null },
        data: { usedAt: now },
      });

      await tx.clientPasswordResetToken.create({
        data: {
          clientAccountId: existing.id,
          codeHash,
          initiatedBy: "STAFF",
          staffUserId: params.actor.userId ?? null,
          staffUserName: params.actor.userDisplay,
          expiresAt,
        },
      });

      const acc = await tx.clientPortalAccount.update({
        where: { id: existing.id },
        data: {
          passwordHash: hashPassword(temporaryPassword),
          mustChangePassword: true,
          passwordUpdatedAt: now,
          sessionVersion: { increment: 1 },
        },
      });

      const profile = await tx.enterpriseProfile.findUnique({ where: { id: "default" } }).catch(() => null);
      const companyName = profile?.legalNameAr || "المنشأة";

      await createWhatsAppDraftTx(tx, {
        eventType: "PASSWORD_RESET",
        clientAccountId: acc.id,
        customerId: acc.customerId,
        recipientName: acc.fullName,
        recipientPhone: acc.phone,
        variables: {
          companyName,
          resetCode: `${temporaryPassword} (أو رمز الاستعادة: ${resetCode})`,
          expiresMinutes,
          portalUrl: params.portalUrl,
        },
      });

      await appendAuditLogTx(tx, {
        userId: params.actor.userId,
        userDisplay: params.actor.userDisplay,
        userRole: params.actor.userRole,
        actionType: "CLIENT_PASSWORD_RESET_BY_STAFF",
        entityReference: acc.id,
        details: `[tenant:${params.tenantSlug}] إعادة تعيين كلمة مرور العميل (${acc.fullName} / ${acc.id}) بواسطة ${params.actor.userDisplay} (resetByUserId:${params.actor.userId || "staff"}) في ${now.toISOString()} مع تفعيل التغيير الإلزامي وإلغاء الجلسات السابقة`,
      });

      let creditLimit = 0;
      if (acc.customerId) {
        const cust = await tx.customer.findUnique({
          where: { id: acc.customerId },
          select: { creditLimit: true },
        });
        creditLimit = Number(cust?.creditLimit || 0);
      }

      return { acc, creditLimit, companyName };
    });

    if (result.acc.email) {
      await dispatchOptionalResetEmailWebhook({
        tenantSlug: params.tenantSlug,
        email: result.acc.email,
        fullName: result.acc.fullName,
        companyName: result.companyName,
        resetCode: temporaryPassword,
        expiresMinutes,
        portalUrl: params.portalUrl,
      });
    }

    return {
      client: sanitizeClientAccount(result.acc, result.creditLimit),
      temporaryPassword,
      resetCode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  export async function getClientPortalNotifications(clientAccountId: string) {
    const rows = await prisma.whatsAppOutboxMessage.findMany({
      where: { clientAccountId },
      orderBy: [{ createdAt: "desc" }],
      take: 40,
    });

    return rows.map((row) => ({
      id: row.id,
      draftNumber: row.draftNumber,
      eventType: row.eventType,
      eventLabelAr: WA_EVENT_LABELS_AR[row.eventType] || row.eventType,
      status: row.status,
      statusLabelAr: WA_STATUS_LABELS_AR[row.status] || row.status,
      dispatchChannel: row.dispatchChannel,
      createdAt: row.createdAt.toISOString(),
      createdAtDisplay: formatIsoToDmyTime(row.createdAt),
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      sentAtDisplay: row.sentAt ? formatIsoToDmyTime(row.sentAt) : null,
      // Never leak OTP/reset secrets through portal notification list
      previewText:
        row.eventType === "PASSWORD_RESET"
          ? "إشعار استعادة / تحديث كلمة المرور (محتوى الرمز محمي)"
          : row.finalMessageText.slice(0, 160),
    }));
  }

  export type ClientOrStaffLifecycleAction =
    | "CANCEL"
    | "ARCHIVE"
    | "UNARCHIVE"
    | "HIDE"
    | "UNHIDE"
    | "DELETE";

  export async function lifecycleClientGoodsRequest(params: {
    requestId: string;
    actorScope: "CLIENT" | "STAFF";
    clientAccountId?: string;
    action: ClientOrStaffLifecycleAction;
    actorName?: string;
    actorUserId?: string | null;
    actorRole?: string;
    tenantSlug?: string;
  }): Promise<{
    deleted?: boolean;
    deletedId?: string;
    requestNumber?: string;
    request?: ReturnType<typeof serializeRequest>;
  }> {
    const existing = await prisma.clientGoodsRequest.findUnique({
      where: { id: params.requestId },
      include: {
        clientAccount: {
          select: {
            id: true,
            fullName: true,
            tradeName: true,
            phone: true,
            email: true,
            avatarUrl: true,
            avatarColor: true,
            clientType: true,
            customerId: true,
          },
        },
        lines: { orderBy: { lineOrder: "asc" } },
      },
    });

    if (!existing) {
      throw new Error("NOT_FOUND: الطلب غير موجود");
    }
    if (params.actorScope === "CLIENT" && existing.clientAccountId !== params.clientAccountId) {
      throw new Error("NOT_FOUND: الطلب غير موجود أو غير مصرح بالوصول إليه");
    }

    const now = new Date();
    const tenantLabel = (params.tenantSlug || "default").trim() || "default";

    if (params.action === "CANCEL") {
      if (!canClientCancelRequest(existing)) {
        throw new Error(
          "يمكن إلغاء الطلب فقط قبل حجز المخزون أو معالجة الإدارة والربط بالمبيعات"
        );
      }
      const updated = await prisma.$transaction(async (tx) => {
        const rec = await tx.clientGoodsRequest.update({
          where: { id: existing.id },
          data: { status: "CANCELLED" },
          include: {
            clientAccount: true,
            lines: { orderBy: { lineOrder: "asc" } },
          },
        });
        await appendAuditLogTx(tx, {
          userId: params.actorUserId ?? null,
          userDisplay: params.actorName || existing.clientAccount?.fullName || "العميل",
          userRole: params.actorRole || (params.actorScope === "CLIENT" ? "CLIENT_PORTAL" : "USER"),
          actionType: "CLIENT_REQUEST_CANCELLED",
          entityReference: existing.requestNumber,
          details: `[tenant:${tenantLabel}] إلغاء الطلب ${existing.requestNumber} قبل المعالجة/حجز المخزون`,
        });
        return rec;
      });
      return { request: serializeRequest(updated) };
    }

    if (params.action === "ARCHIVE" || params.action === "HIDE") {
      if (!canArchiveOrHideRequest(existing)) {
        throw new Error(
          "يمكن أرشفة أو إخفاء الطلبات المكتملة أو الملغاة أو المرفوضة فقط"
        );
      }
    }

    if (params.action === "ARCHIVE" || params.action === "UNARCHIVE") {
      const isArchive = params.action === "ARCHIVE";
      const data =
        params.actorScope === "CLIENT"
          ? {
            isArchivedByClient: isArchive,
            archivedByClientAt: isArchive ? now : null,
          }
          : {
            isArchived: isArchive,
            archivedAt: isArchive ? now : null,
            archivedBy: isArchive ? params.actorName || "الإدارة" : null,
          };
      const updated = await prisma.clientGoodsRequest.update({
        where: { id: existing.id },
        data,
        include: {
          clientAccount: true,
          lines: { orderBy: { lineOrder: "asc" } },
        },
      });
      return { request: serializeRequest(updated) };
    }

    if (params.action === "HIDE" || params.action === "UNHIDE") {
      const isHide = params.action === "HIDE";
      const data =
        params.actorScope === "CLIENT"
          ? {
            isHiddenByClient: isHide,
            hiddenByClientAt: isHide ? now : null,
          }
          : {
            isHiddenByStaff: isHide,
            hiddenByStaffAt: isHide ? now : null,
          };
      const updated = await prisma.clientGoodsRequest.update({
        where: { id: existing.id },
        data,
        include: {
          clientAccount: true,
          lines: { orderBy: { lineOrder: "asc" } },
        },
      });
      return { request: serializeRequest(updated) };
    }

    // DELETE action — strict accounting safety guardrails
    const deleteCheck = canSafelyDeleteRequest(existing);
    if (!deleteCheck.allowed) {
      throw new Error(deleteCheck.reason || "لا يمكن حذف هذا الطلب للحفاظ على سلامة القيود المحاسبية");
    }

    await prisma.$transaction(async (tx) => {
      await tx.clientGoodsRequest.delete({
        where: { id: existing.id },
      });
      await appendAuditLogTx(tx, {
        userId: params.actorUserId ?? null,
        userDisplay: params.actorName || existing.clientAccount?.fullName || "العميل",
        userRole: params.actorRole || (params.actorScope === "CLIENT" ? "CLIENT_PORTAL" : "USER"),
        actionType: "CLIENT_REQUEST_DELETED",
        entityReference: existing.requestNumber,
        details: `[tenant:${tenantLabel}] حذف آمن للطلب غير المرحّل ${existing.requestNumber} (الحالة السابقة: ${existing.status})`,
      });
    });

    return {
      deleted: true,
      deletedId: existing.id,
      requestNumber: existing.requestNumber,
    };
  }

  export async function bulkHideClientGoodsRequests(params: {
    actorScope: "CLIENT" | "STAFF";
    clientAccountId?: string;
    requestIds?: string[];
    includeArchived?: boolean;
  }) {
    const allowedStatuses = ["COMPLETED", "CANCELLED", "REJECTED"];
    const hasExplicitIds = Array.isArray(params.requestIds) && params.requestIds.length > 0;
    const now = new Date();

    const candidates = await prisma.clientGoodsRequest.findMany({
      where: {
        ...(params.actorScope === "CLIENT" && params.clientAccountId
          ? { clientAccountId: params.clientAccountId }
          : {}),
        ...(hasExplicitIds ? { id: { in: params.requestIds } } : {}),
      },
      select: {
        id: true,
        status: true,
        isArchived: true,
        isArchivedByClient: true,
      },
    });

    const targetIds = candidates
      .filter(
        (c) =>
          allowedStatuses.includes(c.status) ||
          Boolean(params.includeArchived && (c.isArchived || c.isArchivedByClient))
      )
      .map((c) => c.id);

    if (targetIds.length === 0) {
      return { updatedCount: 0, ids: [] as string[] };
    }

    await prisma.clientGoodsRequest.updateMany({
      where: { id: { in: targetIds } },
      data:
        params.actorScope === "CLIENT"
          ? { isHiddenByClient: true, hiddenByClientAt: now }
          : { isHiddenByStaff: true, hiddenByStaffAt: now },
    });

    return { updatedCount: targetIds.length, ids: targetIds };
  }


// ---------------------------------------------------------------------------
// Sector access + tenant control over client accounts
// ---------------------------------------------------------------------------

/** Effective sector access for an account (client override → tenant default → BOTH). */
export async function resolveClientSectorAccess(account: { sectorMode?: string | null }) {
  const cfg = await getTenantFormConfig();
  const mode = resolveEffectiveSectorMode(account.sectorMode, cfg.defaultSectorMode);
  return {
    sectorMode: mode,
    allowedSectors: allowedSectorsForMode(mode),
    lockedSector: lockedSectorForMode(mode),
  };
}

/** Self-registration preference is honoured only when it narrows (never widens) the tenant default. */
export async function resolveRegistrationSectorMode(preference?: string | null): Promise<string> {
  const raw = String(preference ?? "").trim();
  if (!raw) return "INHERIT";
  const cfg = await getTenantFormConfig();
  if (!cfg.allowSectorPreferenceOnRegister) return "INHERIT";
  const wanted = normalizeSectorMode(raw, cfg.defaultSectorMode);
  const tenantAllowed = new Set<string>(allowedSectorsForMode(cfg.defaultSectorMode));
  const wantedList = allowedSectorsForMode(wanted);
  if (!wantedList.every((sec) => tenantAllowed.has(sec))) return "INHERIT";
  return wanted === cfg.defaultSectorMode ? "INHERIT" : wanted;
}

/** Throws FORBIDDEN (HTTP 403) if the authenticated client may not access the sector. */
export async function assertClientSectorAccess(
  account: { sectorMode?: string | null },
  sector: unknown
) {
  const access = await resolveClientSectorAccess(account);
  return assertSectorAllowed(access.sectorMode, sector);
}

export async function clientCanAccessSector(account: { sectorMode?: string | null }, sector: unknown) {
  const access = await resolveClientSectorAccess(account);
  return isSectorAllowed(access.sectorMode, sector);
}

export interface StaffClientAccountActionParams {
  clientAccountId: string;
  action: ClientAccountAction;
  sectorMode?: string;
  creditLimit?: number;
  reason?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}

/**
 * Staff account management: suspend / archive / reactivate / revoke sessions / sector mode / credit limit.
 * Every action is audited and bumps `sessionVersion` when access must be cut immediately.
 */
export async function staffManageClientAccount(params: StaffClientAccountActionParams) {
  const existing = await prisma.clientPortalAccount.findUnique({ where: { id: params.clientAccountId } });
  if (!existing) throw new Error("NOT_FOUND: حساب العميل غير موجود");

  const now = new Date();
  const data: Record<string, unknown> = {};
  let detail = "";

  switch (params.action) {
    case "SUSPEND":
    case "ARCHIVE": {
      const next = nextAccountStatus(existing.status, params.action);
      data.status = next;
      data.sessionVersion = (existing.sessionVersion ?? 1) + 1;
      if (params.action === "SUSPEND") data.suspendedAt = now;
      else data.archivedAt = now;
      if (params.reason?.trim()) data.rejectedReason = params.reason.trim();
      detail = params.action === "SUSPEND" ? "إيقاف مؤقت" : "أرشفة";
      break;
    }
    case "REACTIVATE": {
      data.status = nextAccountStatus(existing.status, "REACTIVATE");
      data.suspendedAt = null;
      data.archivedAt = null;
      data.rejectedReason = null;
      data.sessionVersion = (existing.sessionVersion ?? 1) + 1;
      detail = "إعادة تفعيل";
      break;
    }
    case "REVOKE_SESSIONS": {
      data.sessionVersion = (existing.sessionVersion ?? 1) + 1;
      detail = "إنهاء الجلسات النشطة";
      break;
    }
    case "SET_SECTORS": {
      const raw = String(params.sectorMode || "").trim().toUpperCase();
      if (raw !== "INHERIT" && raw !== "BOTH" && raw !== "HARVEST_ONLY" && raw !== "COMMERCIAL_ONLY") {
        throw new Error("وضع القطاعات غير صالح (INHERIT / BOTH / HARVEST_ONLY / COMMERCIAL_ONLY)");
      }
      data.sectorMode = raw;
      detail = `تحديد القطاعات المتاحة: ${raw}`;
      break;
    }
    case "SET_CREDIT_LIMIT": {
      const limit = Number(params.creditLimit);
      if (!Number.isFinite(limit) || limit < 0) throw new Error("الحد الائتماني غير صالح");
      if (!existing.customerId) throw new Error("لا يمكن تحديد الحد الائتماني قبل ربط الحساب بعميل محاسبي");
      await prisma.customer.update({ where: { id: existing.customerId }, data: { creditLimit: limit } });
      detail = `تعديل الحد الائتماني إلى ${limit}`;
      break;
    }
    default:
      throw new Error("إجراء غير معروف على حساب العميل");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const acc = Object.keys(data).length
      ? await tx.clientPortalAccount.update({ where: { id: existing.id }, data })
      : existing;
    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: `CLIENT_PORTAL_${params.action}`,
      entityReference: acc.id,
      details: `${detail} — العميل (${acc.fullName}) — ${formatIsoToDmyTime(now)}`,
    });
    return acc;
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

/** Bulk sector assignment for high-volume client lists (scoped by tenantSlug). */
export async function staffBulkSetClientSectorMode(params: {
  clientAccountIds: string[];
  sectorMode: string;
  tenantSlug?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const raw = String(params.sectorMode || "").trim().toUpperCase();
  if (raw !== "INHERIT" && raw !== "BOTH" && raw !== "HARVEST_ONLY" && raw !== "COMMERCIAL_ONLY") {
    throw new Error("وضع القطاعات غير صالح");
  }
  const ids = [...new Set(params.clientAccountIds.map((x) => String(x).trim()).filter(Boolean))].slice(0, 2000);
  if (ids.length === 0) throw new Error("لم يتم تحديد أي عميل");
  const slug = (params.tenantSlug || "").trim().toLowerCase();
  const result = await prisma.clientPortalAccount.updateMany({
    where: { id: { in: ids }, ...(slug && slug !== "default" ? { tenantSlug: slug } : {}) },
    data: { sectorMode: raw },
  });
  await prisma.$transaction(async (tx) => {
    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: "CLIENT_PORTAL_BULK_SET_SECTORS",
      entityReference: `bulk:${result.count}`,
      details: `تعيين القطاعات (${raw}) لعدد ${result.count} عميل`,
    });
  });
  return { updatedCount: result.count };
}

export { forbiddenMessage as portalForbiddenMessage };
export type { SectorMode as PortalSectorMode };

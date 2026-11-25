import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatWhatsAppUrl, normalizeWhatsAppPhone } from "@/lib/nativeBridge";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export type WhatsAppEventType =
  | "CLIENT_APPROVED"
  | "REQUEST_RECEIVED"
  | "REQUEST_RETURNED_FOR_APPROVAL"
  | "REQUEST_CONFIRMED"
  | "READY_FOR_PICKUP"
  | "HANDOVER_INVOICE"
  | "PAYMENT_RECEIPT"
  | "BALANCE_SUMMARY"
  | "PASSWORD_RESET"
  | "CUSTOM";

export interface TenantWhatsAppSettingsPublic {
  provider: "WHATSAPP_WEB_LINK" | "CLOUD_API" | "CUSTOM_WEBHOOK";
  gatewayUrl: string;
  senderPhone: string;
  defaultCountryCode: string;
  hasApiToken: boolean;
  maskedApiToken: string;
  isActive: boolean;
  autoDraftEvents: Record<WhatsAppEventType, boolean>;
  templates: Record<WhatsAppEventType, string>;
}

export const WHATSAPP_SETTING_ID = "whatsapp";

export const DEFAULT_AUTO_DRAFT_EVENTS: Record<WhatsAppEventType, boolean> = {
  CLIENT_APPROVED: true,
  REQUEST_RECEIVED: true,
  REQUEST_RETURNED_FOR_APPROVAL: true,
  REQUEST_CONFIRMED: true,
  READY_FOR_PICKUP: true,
  HANDOVER_INVOICE: true,
  PAYMENT_RECEIPT: true,
  BALANCE_SUMMARY: true,
  PASSWORD_RESET: true,
  CUSTOM: true,
};

export const DEFAULT_WHATSAPP_TEMPLATES: Record<WhatsAppEventType, string> = {
  CLIENT_APPROVED:
    "مرحباً {{clientName}}،\nتم تفعيل حسابكم في بوابة عملاء {{companyName}} بنجاح.\nيمكنكم الآن تسجيل طلبات الاستلام ومتابعة الفواتير وكشف الحساب عبر: {{portalUrl}}",
  REQUEST_RECEIVED:
    "مرحباً {{clientName}}،\nتم استلام طلبكم رقم {{requestNumber}} بنجاح.\nموقع الاستلام: {{pickupLocation}}\nالتفاصيل:\n{{linesSummary}}\nالحالة الحالية: قيد المراجعة.",
  REQUEST_RETURNED_FOR_APPROVAL:
    "مرحباً {{clientName}}،\nتمت مراجعة وتعديل طلبكم رقم {{requestNumber}} في {{companyName}} وإعادته لاعتمادكم.\nملاحظات المراجع: {{reviewerRemarks}}\nالإجمالي المحدث: {{totalAmount}} {{currency}}\nيرجى الدخول إلى بوابة العملاء لمراجعة التعديلات واعتمادها عبر: {{portalUrl}}",
  REQUEST_CONFIRMED:
    "مرحباً {{clientName}}،\nتم تأكيد طلبكم رقم {{requestNumber}} من {{companyName}}.\nموقع الاستلام: {{pickupLocation}}\nالإجمالي التقديري: {{totalAmount}} {{currency}}",
  READY_FOR_PICKUP:
    "مرحباً {{clientName}}،\nطلبكم رقم {{requestNumber}} جاهز الآن للاستلام من: {{pickupLocation}}.\nالإجمالي: {{totalAmount}} {{currency}}",
  HANDOVER_INVOICE:
    "مرحباً {{clientName}}،\nتم تسليم الطلب رقم {{requestNumber}} وإصدار الفاتورة رقم {{invoiceNumber}}.\nالإجمالي: {{totalAmount}} {{currency}}\nالمدفوع: {{paidAmount}} {{currency}}\nالمتبقي: {{balanceDue}} {{currency}}\nشكراً لتعاملكم مع {{companyName}}.",
  PAYMENT_RECEIPT:
    "مرحباً {{clientName}}،\nتم استلام دفعتكم بسند رقم {{receiptNumber}} بمبلغ {{paidAmount}} {{currency}}.\nالرصيد المتبقي: {{balanceDue}} {{currency}}",
  BALANCE_SUMMARY:
    "مرحباً {{clientName}}،\nملخص رصيدكم لدى {{companyName}}:\nإجمالي الفواتير: {{totalInvoiced}} {{currency}}\nالمدفوع: {{totalPaid}} {{currency}}\nالرصيد المستحق: {{balanceDue}} {{currency}}",
  PASSWORD_RESET:
    "مرحباً {{clientName}}،\nبناءً على طلب استعادة كلمة المرور في بوابة عملاء {{companyName}}:\nرمز التحقق / كلمة المرور المؤقتة: {{resetCode}}\nصلاحية الرمز: {{expiresMinutes}} دقيقة.\nيرجى تسجيل الدخول وتحديث كلمة المرور عبر: {{portalUrl}}",
  CUSTOM: "مرحباً {{clientName}}،\n{{customBody}}",
};

function deriveTenantEncryptionKey(tenantSlug: string): Buffer {
  const baseSecret =
    process.env.UAS_TENANT_INTEGRATION_KEY ||
    process.env.UAS_SESSION_SECRET ||
    process.env.UAS_VENDOR_ADMIN_TOKEN ||
    "uas-enterprise-tenant-integration-secret-2026";
  return crypto
    .createHash("sha256")
    .update(`WA_CRED_V1|${tenantSlug.toLowerCase()}|${baseSecret}`)
    .digest();
}

export function encryptTenantWhatsAppSecret(plaintext: string, tenantSlug: string): string {
  const trimmed = plaintext.trim();
  if (!trimmed) return "";
  const iv = crypto.randomBytes(12);
  const key = deriveTenantEncryptionKey(tenantSlug);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm1$${iv.toString("hex")}$${tag.toString("hex")}$${enc.toString("hex")}`;
}

export function decryptTenantWhatsAppSecret(ciphertext: string | null | undefined, tenantSlug: string): string {
  if (!ciphertext || !ciphertext.startsWith("gcm1$")) return "";
  const parts = ciphertext.split("$");
  if (parts.length !== 4) return "";
  try {
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const data = Buffer.from(parts[3], "hex");
    const key = deriveTenantEncryptionKey(tenantSlug);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 6) return "******";
  return `${token.slice(0, 3)}****${token.slice(-3)}`;
}

export async function getTenantWhatsAppSettings(
  tenantSlug: string
): Promise<TenantWhatsAppSettingsPublic> {
  const row = await prisma.tenantIntegrationSetting
    .findUnique({ where: { id: WHATSAPP_SETTING_ID } })
    .catch(() => null);

  const decryptedToken = row?.credentialsEnc
    ? decryptTenantWhatsAppSecret(row.credentialsEnc, tenantSlug)
    : "";

  let autoDraftEvents = { ...DEFAULT_AUTO_DRAFT_EVENTS };
  if (row?.autoDraftEventsJson) {
    try {
      autoDraftEvents = { ...autoDraftEvents, ...JSON.parse(row.autoDraftEventsJson) };
    } catch {
      // keep defaults
    }
  }

  let templates = { ...DEFAULT_WHATSAPP_TEMPLATES };
  if (row?.templatesJson) {
    try {
      templates = { ...templates, ...JSON.parse(row.templatesJson) };
    } catch {
      // keep defaults
    }
  }

  const provider =
    row?.provider === "CLOUD_API" || row?.provider === "CUSTOM_WEBHOOK"
      ? row.provider
      : "WHATSAPP_WEB_LINK";

  return {
    provider,
    gatewayUrl: row?.gatewayUrl || "",
    senderPhone: row?.senderPhone || "",
    defaultCountryCode: row?.defaultCountryCode || "967",
    hasApiToken: Boolean(row?.credentialsEnc),
    maskedApiToken: decryptedToken ? maskToken(decryptedToken) : row?.credentialsEnc ? "****" : "",
    isActive: row?.isActive ?? true,
    autoDraftEvents,
    templates,
  };
}

export async function saveTenantWhatsAppSettings(params: {
  tenantSlug: string;
  provider?: "WHATSAPP_WEB_LINK" | "CLOUD_API" | "CUSTOM_WEBHOOK";
  gatewayUrl?: string;
  apiToken?: string;
  clearApiToken?: boolean;
  senderPhone?: string;
  defaultCountryCode?: string;
  isActive?: boolean;
  autoDraftEvents?: Partial<Record<WhatsAppEventType, boolean>>;
  templates?: Partial<Record<WhatsAppEventType, string>>;
  updatedById?: string | null;
}): Promise<TenantWhatsAppSettingsPublic> {
  const existing = await prisma.tenantIntegrationSetting
    .findUnique({ where: { id: WHATSAPP_SETTING_ID } })
    .catch(() => null);
  const current = await getTenantWhatsAppSettings(params.tenantSlug);

  let nextCred = existing?.credentialsEnc ?? null;
  if (params.clearApiToken) {
    nextCred = null;
  } else if (typeof params.apiToken === "string" && params.apiToken.trim()) {
    nextCred = encryptTenantWhatsAppSecret(params.apiToken.trim(), params.tenantSlug);
  }

  const nextAuto = {
    ...current.autoDraftEvents,
    ...(params.autoDraftEvents || {}),
  };
  const nextTemplates = {
    ...current.templates,
    ...(params.templates || {}),
  };

  await prisma.tenantIntegrationSetting.upsert({
    where: { id: WHATSAPP_SETTING_ID },
    update: {
      provider: params.provider || current.provider,
      gatewayUrl: params.gatewayUrl !== undefined ? params.gatewayUrl.trim() : current.gatewayUrl,
      credentialsEnc: nextCred,
      senderPhone: params.senderPhone !== undefined ? params.senderPhone.trim() : current.senderPhone,
      defaultCountryCode:
        params.defaultCountryCode !== undefined
          ? params.defaultCountryCode.replace(/\D/g, "") || "967"
          : current.defaultCountryCode,
      isActive: params.isActive !== undefined ? params.isActive : current.isActive,
      autoDraftEventsJson: JSON.stringify(nextAuto),
      templatesJson: JSON.stringify(nextTemplates),
      updatedById: params.updatedById ?? null,
    },
    create: {
      id: WHATSAPP_SETTING_ID,
      provider: params.provider || "WHATSAPP_WEB_LINK",
      gatewayUrl: params.gatewayUrl?.trim() || "",
      credentialsEnc: nextCred,
      senderPhone: params.senderPhone?.trim() || "",
      defaultCountryCode: params.defaultCountryCode?.replace(/\D/g, "") || "967",
      isActive: params.isActive ?? true,
      autoDraftEventsJson: JSON.stringify(nextAuto),
      templatesJson: JSON.stringify(nextTemplates),
      updatedById: params.updatedById ?? null,
    },
  });

  return getTenantWhatsAppSettings(params.tenantSlug);
}

export function renderWhatsAppTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = variables[key];
    return val === undefined || val === null ? "" : String(val);
  });
}

export async function createWhatsAppDraftTx(
  tx: Prisma.TransactionClient | typeof prisma,
  params: {
    eventType: WhatsAppEventType;
    clientAccountId?: string | null;
    customerId?: string | null;
    requestId?: string | null;
    recipientName: string;
    recipientPhone: string;
    variables?: Record<string, string | number | null | undefined>;
    explicitMessageText?: string;
  }
) {
  const settingRow = await tx.tenantIntegrationSetting
    .findUnique({ where: { id: WHATSAPP_SETTING_ID } })
    .catch(() => null);

  let autoEvents = { ...DEFAULT_AUTO_DRAFT_EVENTS };
  if (settingRow?.autoDraftEventsJson) {
    try {
      autoEvents = { ...autoEvents, ...JSON.parse(settingRow.autoDraftEventsJson) };
    } catch {
      // fallback
    }
  }
  if (autoEvents[params.eventType] === false && params.eventType !== "CUSTOM") {
    return null;
  }

  let templates = { ...DEFAULT_WHATSAPP_TEMPLATES };
  if (settingRow?.templatesJson) {
    try {
      templates = { ...templates, ...JSON.parse(settingRow.templatesJson) };
    } catch {
      // fallback
    }
  }

  const rawTemplate = templates[params.eventType] || DEFAULT_WHATSAPP_TEMPLATES[params.eventType];
  const renderedText = (
    params.explicitMessageText ||
    renderWhatsAppTemplate(rawTemplate, {
      clientName: params.recipientName,
      ...(params.variables || {}),
    })
  ).trim();

  const draftNumber = `WA-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;

  return tx.whatsAppOutboxMessage.create({
    data: {
      draftNumber,
      eventType: params.eventType,
      clientAccountId: params.clientAccountId ?? null,
      customerId: params.customerId ?? null,
      requestId: params.requestId ?? null,
      recipientName: params.recipientName.trim(),
      recipientPhone: normalizeWhatsAppPhone(
        params.recipientPhone,
        settingRow?.defaultCountryCode || "967"
      ) || params.recipientPhone.trim(),
      templateKey: params.eventType,
      originalMessageText: renderedText,
      finalMessageText: renderedText,
      status: "PENDING_APPROVAL",
      dispatchChannel:
        settingRow?.provider && settingRow.provider !== "WHATSAPP_WEB_LINK" && settingRow.gatewayUrl
          ? "GATEWAY_API"
          : "WHATSAPP_LINK",
    },
  });
}

export async function listWhatsAppOutboxDrafts(statusFilter?: string) {
  const where =
    statusFilter && statusFilter !== "ALL"
      ? { status: statusFilter }
      : undefined;

  return prisma.whatsAppOutboxMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
}

export async function approveAndSendWhatsAppDraft(params: {
  id: string;
  editedMessageText?: string;
  recipientPhone?: string;
  forceWebLink?: boolean;
  tenantSlug: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const existing = await prisma.whatsAppOutboxMessage.findUnique({ where: { id: params.id } });
  if (!existing) throw new Error("WHATSAPP_DRAFT_NOT_FOUND");
  if (existing.status === "SKIPPED") throw new Error("DRAFT_ALREADY_SKIPPED");

  const finalMessage =
    typeof params.editedMessageText === "string" && params.editedMessageText.trim().length > 0
      ? params.editedMessageText.trim()
      : existing.finalMessageText;

  const settingsRow = await prisma.tenantIntegrationSetting
    .findUnique({ where: { id: WHATSAPP_SETTING_ID } })
    .catch(() => null);
  const countryCode = settingsRow?.defaultCountryCode || "967";
  const targetPhone =
    normalizeWhatsAppPhone(params.recipientPhone || existing.recipientPhone, countryCode) ||
    existing.recipientPhone;

  const whatsappUrl = formatWhatsAppUrl({
    phone: targetPhone,
    text: finalMessage,
    defaultCountryCode: countryCode,
  });

  const canCallGateway =
    !params.forceWebLink &&
    settingsRow?.isActive &&
    (settingsRow.provider === "CLOUD_API" || settingsRow.provider === "CUSTOM_WEBHOOK") &&
    Boolean(settingsRow.gatewayUrl?.trim());

  let nextStatus: "APPROVED_SENT" | "DISPATCHED_LINK" | "FAILED" = "DISPATCHED_LINK";
  let dispatchChannel: "WHATSAPP_LINK" | "GATEWAY_API" = "WHATSAPP_LINK";
  let providerResponseJson: string | null = null;

  if (canCallGateway && settingsRow?.gatewayUrl) {
    dispatchChannel = "GATEWAY_API";
    const apiToken = decryptTenantWhatsAppSecret(settingsRow.credentialsEnc, params.tenantSlug);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;

      const payload =
        settingsRow.provider === "CLOUD_API"
          ? {
              messaging_product: "whatsapp",
              to: targetPhone,
              type: "text",
              text: { body: finalMessage },
            }
          : {
              tenantSlug: params.tenantSlug,
              draftNumber: existing.draftNumber,
              eventType: existing.eventType,
              recipientName: existing.recipientName,
              recipientPhone: targetPhone,
              senderPhone: settingsRow.senderPhone || "",
              messageText: finalMessage,
            };

      const res = await fetch(settingsRow.gatewayUrl.trim(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const respText = await res.text().catch(() => "");
      providerResponseJson = JSON.stringify({ ok: res.ok, status: res.status, body: respText.slice(0, 500) });
      nextStatus = res.ok ? "APPROVED_SENT" : "FAILED";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      providerResponseJson = JSON.stringify({ ok: false, error: msg });
      nextStatus = "FAILED";
    }
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const rec = await tx.whatsAppOutboxMessage.update({
      where: { id: existing.id },
      data: {
        recipientPhone: targetPhone,
        finalMessageText: finalMessage,
        status: nextStatus,
        dispatchChannel,
        approvedByUserId: params.actor.userId ?? null,
        approvedByName: params.actor.userDisplay,
        approvedAt: now,
        sentAt: nextStatus !== "FAILED" ? now : null,
        providerResponseJson,
      },
    });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: `WHATSAPP_${nextStatus}`,
      entityReference: existing.draftNumber,
      details: `اعتماد وإرسال رسالة واتساب إلى ${existing.recipientName} (${targetPhone}) | القناة: ${dispatchChannel} | النص: ${finalMessage.slice(0, 160)}`,
    });

    return rec;
  });

  return {
    message: updated,
    whatsappUrl,
  };
}

export async function skipWhatsAppDraft(params: {
  id: string;
  reason?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}) {
  const existing = await prisma.whatsAppOutboxMessage.findUnique({ where: { id: params.id } });
  if (!existing) throw new Error("WHATSAPP_DRAFT_NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.whatsAppOutboxMessage.update({
      where: { id: existing.id },
      data: {
        status: "SKIPPED",
        skippedReason: params.reason?.trim() || "تم التجاهل بواسطة الموظف",
        approvedByUserId: params.actor.userId ?? null,
        approvedByName: params.actor.userDisplay,
        approvedAt: new Date(),
      },
    });

    await appendAuditLogTx(tx, {
      userId: params.actor.userId,
      userDisplay: params.actor.userDisplay,
      userRole: params.actor.userRole,
      actionType: "WHATSAPP_SKIPPED",
      entityReference: existing.draftNumber,
      details: `تجاهل مسودة واتساب (${existing.recipientName}): ${updated.skippedReason}`,
    });

    return updated;
  });
}

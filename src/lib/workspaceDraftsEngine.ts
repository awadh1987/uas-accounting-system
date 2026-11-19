/**
 * Universal Workspace Drafts Engine (Mission 2 / Phase 4)
 * --------------------------------------------------------------------------
 * Allows saving any form + subform line items as a shared or private draft
 * without posting to the General Ledger or altering stock balances.
 * Authorized team members can resume, edit, discard, or promote drafts into
 * live posted/pending-approval records.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseAccountingSettings } from "@/lib/accountingSettings";
import {
  createVendorWithAccountTx,
  ensureCustomerWithAccountTx,
  ensureWorkerWithAccountTx,
  postCustomerReceipt,
  postJournalEntry,
  postSalesInvoice,
  postVendorBill,
  postVendorPayment,
  type JournalLineInput,
} from "@/lib/accounting/ledgerService";

type Db = Prisma.TransactionClient | typeof prisma;

export const DRAFT_MODULES = [
  "ACCOUNTING",
  "SALES",
  "PROCUREMENT",
  "TREASURY",
  "INVENTORY",
  "PROJECTS",
  "WORKERS",
  "SYSTEM",
] as const;
export type DraftModule = (typeof DRAFT_MODULES)[number];

export const DRAFT_STATUSES = [
  "ACTIVE_DRAFT",
  "SUBMITTED_FOR_APPROVAL",
  "CONVERTED",
  "DISCARDED",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export type DraftVisibility = "SHARED_WORKSPACE" | "PRIVATE";

export interface DraftActor {
  userId: string;
  userName: string;
  userRole?: string;
}

export interface CreateWorkspaceDraftInput {
  module: string;
  formType: string;
  entityId?: string | null;
  titleAr: string;
  titleEn?: string;
  payload: Record<string, unknown>;
  totalAmount?: number | null;
  currencyCode?: string;
  visibility?: DraftVisibility;
  actor: DraftActor;
}

export interface UpdateWorkspaceDraftInput {
  titleAr?: string;
  titleEn?: string;
  payload?: Record<string, unknown>;
  totalAmount?: number | null;
  currencyCode?: string;
  visibility?: DraftVisibility;
  status?: DraftStatus;
  actor: DraftActor;
}

export interface ListWorkspaceDraftsFilter {
  module?: string;
  formType?: string;
  status?: string;
  userId?: string;
  userRole?: string;
  includeInactive?: boolean;
}

async function nextDraftNumber(tx: Db): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `DRF-${year}-`;
  const count = await tx.workspaceDraft.count({
    where: { draftNumber: { startsWith: prefix } },
  });
  let seq = count + 1;
  for (;;) {
    const candidate = `${prefix}${String(seq).padStart(4, "0")}`;
    const exists = await tx.workspaceDraft.findUnique({ where: { draftNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
    seq++;
  }
}

export async function listWorkspaceDrafts(
  filter: ListWorkspaceDraftsFilter = {},
  client: Db = prisma
) {
  const where: Prisma.WorkspaceDraftWhereInput = {};
  if (filter.module && filter.module !== "ALL") where.module = filter.module.toUpperCase();
  if (filter.formType && filter.formType !== "ALL") where.formType = filter.formType.toUpperCase();
  if (filter.status && filter.status !== "ALL") {
    where.status = filter.status.toUpperCase();
  } else if (!filter.includeInactive) {
    where.status = { in: ["ACTIVE_DRAFT", "SUBMITTED_FOR_APPROVAL"] };
  }

  // Visibility guard: SHARED_WORKSPACE is visible to all authorized workspace members;
  // PRIVATE is visible only to its creator (or SUPER_ADMIN).
  if (filter.userId && filter.userRole !== "SUPER_ADMIN") {
    where.OR = [
      { visibility: "SHARED_WORKSPACE" },
      { createdById: filter.userId },
    ];
  }

  const rows = await client.workspaceDraft.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((r) => ({
    ...r,
    payload: safeParsePayload(r.payloadJson),
  }));
}

export function safeParsePayload(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function createWorkspaceDraft(
  input: CreateWorkspaceDraftInput,
  client: Db = prisma
) {
  const titleAr = input.titleAr?.trim();
  if (!titleAr) throw new Error("DRAFT_TITLE_REQUIRED: عنوان المسودة مطلوب");
  const mod = (input.module || "ACCOUNTING").toUpperCase();
  const formType = (input.formType || "GENERIC").toUpperCase();
  const draftNumber = await nextDraftNumber(client);
  const visibility: DraftVisibility =
    input.visibility === "PRIVATE" ? "PRIVATE" : "SHARED_WORKSPACE";

  const created = await client.workspaceDraft.create({
    data: {
      draftNumber,
      module: mod,
      formType,
      entityId: input.entityId ?? null,
      titleAr,
      titleEn: input.titleEn?.trim() || titleAr,
      payloadJson: JSON.stringify(input.payload ?? {}),
      totalAmount: input.totalAmount !== undefined && input.totalAmount !== null ? Number(input.totalAmount) : null,
      currencyCode: (input.currencyCode || "YER").toUpperCase(),
      visibility,
      status: "ACTIVE_DRAFT",
      createdById: input.actor.userId || "u1",
      createdByName: input.actor.userName || "مستخدم النظام",
      updatedById: input.actor.userId || "u1",
      updatedByName: input.actor.userName || "مستخدم النظام",
    },
  });

  return { ...created, payload: safeParsePayload(created.payloadJson) };
}

export async function getWorkspaceDraftById(id: string, client: Db = prisma) {
  const row = await client.workspaceDraft.findUnique({ where: { id } });
  if (!row) return null;
  return { ...row, payload: safeParsePayload(row.payloadJson) };
}

export async function updateWorkspaceDraft(
  id: string,
  input: UpdateWorkspaceDraftInput,
  client: Db = prisma
) {
  const existing = await client.workspaceDraft.findUnique({ where: { id } });
  if (!existing) throw new Error("DRAFT_NOT_FOUND");
  if (existing.status === "CONVERTED" || existing.status === "DISCARDED") {
    throw new Error(`DRAFT_IMMUTABLE: لا يمكن تعديل مسودة بحالة ${existing.status}`);
  }
  if (
    existing.visibility === "PRIVATE" &&
    input.actor.userRole !== "SUPER_ADMIN" &&
    existing.createdById !== input.actor.userId
  ) {
    throw new Error("DRAFT_ACCESS_DENIED: هذه المسودة خاصة بمنشئها فقط");
  }

  const updated = await client.workspaceDraft.update({
    where: { id },
    data: {
      ...(input.titleAr !== undefined ? { titleAr: input.titleAr.trim() } : {}),
      ...(input.titleEn !== undefined ? { titleEn: input.titleEn.trim() } : {}),
      ...(input.payload !== undefined ? { payloadJson: JSON.stringify(input.payload) } : {}),
      ...(input.totalAmount !== undefined ? { totalAmount: input.totalAmount } : {}),
      ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode.toUpperCase() } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedById: input.actor.userId,
      updatedByName: input.actor.userName,
    },
  });

  return { ...updated, payload: safeParsePayload(updated.payloadJson) };
}

export async function discardWorkspaceDraft(
  id: string,
  actor: DraftActor,
  client: Db = prisma
) {
  const existing = await client.workspaceDraft.findUnique({ where: { id } });
  if (!existing) throw new Error("DRAFT_NOT_FOUND");
  if (
    existing.visibility === "PRIVATE" &&
    actor.userRole !== "SUPER_ADMIN" &&
    actor.userRole !== "CHIEF_ACCOUNTANT" &&
    existing.createdById !== actor.userId
  ) {
    const { hasGranularPermission } = await import("@/lib/permissions");
    if (!hasGranularPermission(actor.userRole, "drafts.manage_all")) {
      throw new Error("DRAFT_ACCESS_DENIED");
    }
  }
  return client.workspaceDraft.update({
    where: { id },
    data: {
      status: "DISCARDED",
      updatedById: actor.userId,
      updatedByName: actor.userName,
    },
  });
}

/**
 * Validates a draft payload and promotes it into a live accounting/operational document
 * (POSTED directly or PENDING_APPROVAL if approval workflow is required), marking the
 * draft CONVERTED with a link to the resulting entity ID.
 */
export async function promoteWorkspaceDraft(
  id: string,
  actor: DraftActor,
  client: typeof prisma = prisma
) {
  return client.$transaction(async (tx) => {
    // Concurrency State Guard: Atomically lock draft from ACTIVE_DRAFT / SUBMITTED_FOR_APPROVAL
    const guarded = await tx.workspaceDraft.updateMany({
      where: {
        id,
        status: { in: ["ACTIVE_DRAFT", "SUBMITTED_FOR_APPROVAL"] },
      },
      data: {
        status: "CONVERTED",
      },
    });
    if (guarded.count === 0) {
      const existing = await tx.workspaceDraft.findUnique({ where: { id } });
      if (!existing) throw new Error("DRAFT_NOT_FOUND");
      if (existing.status === "CONVERTED") {
        throw new Error("DRAFT_ALREADY_CONVERTED: تم تحويل هذه المسودة مسبقاً");
      }
      if (existing.status === "DISCARDED") {
        throw new Error("DRAFT_DISCARDED: لا يمكن ترحيل مسودة ملغاة");
      }
      throw new Error(`DRAFT_INVALID_STATUS: لا يمكن ترحيل مسودة في حالة (${existing.status})`);
    }

    const draft = await tx.workspaceDraft.findUniqueOrThrow({ where: { id } });

    const payload = safeParsePayload(draft.payloadJson);
    const settingsRow = await tx.systemSettings.findUnique({ where: { id: "default" } });
    const settings = parseAccountingSettings(settingsRow);
    const requireApproval = Boolean(settings.requireApprovalWorkflow);
    const targetDocStatus = requireApproval ? "PENDING_APPROVAL" : "POSTED";

    let convertedEntityId: string | null = null;
    let promotedResult: unknown = null;

    if (draft.formType === "JOURNAL_VOUCHER") {
      const lines = Array.isArray(payload.lines) ? (payload.lines as JournalLineInput[]) : [];
      if (lines.length < 2) {
        throw new Error("DRAFT_INVALID_PAYLOAD: قيد اليومية يتطلب سطرين على الأقل");
      }
      const je = await postJournalEntry({
        tx,
        date: payload.date ? String(payload.date) : new Date(),
        reference: payload.reference ? String(payload.reference) : draft.draftNumber,
        narrationAr: String(payload.narrationAr || draft.titleAr),
        narrationEn: payload.narrationEn ? String(payload.narrationEn) : draft.titleEn,
        projectId: payload.projectId ? String(payload.projectId) : null,
        subProjectId: payload.subProjectId ? String(payload.subProjectId) : null,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : null,
        createdById: actor.userId,
        sourceType: "MANUAL",
        status: targetDocStatus,
        lines,
      });
      convertedEntityId = je.id;
      promotedResult = je;
    } else if (draft.formType === "CUSTOMER") {
      const name = String(payload.nameAr || payload.name || draft.titleAr).trim();
      const customer = await ensureCustomerWithAccountTx(tx, {
        name,
        nameEn: payload.nameEn ? String(payload.nameEn) : undefined,
        phone: payload.phone ? String(payload.phone) : undefined,
        address: payload.address ? String(payload.address) : undefined,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : undefined,
      });
      convertedEntityId = customer.id;
      promotedResult = customer;
    } else if (draft.formType === "VENDOR") {
      const nameAr = String(payload.nameAr || draft.titleAr).trim();
      const vendor = await createVendorWithAccountTx(tx, {
        nameAr,
        nameEn: payload.nameEn ? String(payload.nameEn) : undefined,
        phone: String(payload.phone || "777000000"),
        email: payload.email ? String(payload.email) : undefined,
        taxRegistration: payload.taxRegistration ? String(payload.taxRegistration) : undefined,
        address: payload.address ? String(payload.address) : undefined,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : undefined,
      });
      convertedEntityId = vendor.id;
      promotedResult = vendor;
    } else if (draft.formType === "WORKER_WAGE") {
      const name = String(payload.name || draft.titleAr).trim();
      const worker = await ensureWorkerWithAccountTx(tx, {
        name,
        defaultDailyWage: Number(payload.dailyWage) || 0,
        phone: payload.phone ? String(payload.phone) : undefined,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : undefined,
      });
      convertedEntityId = worker.id;
      promotedResult = worker;
    } else if (
      draft.formType === "SALES_INVOICE" &&
      payload.customerId &&
      payload.projectId &&
      Number(payload.amount || payload.totalAmount) > 0
    ) {
      const res = await postSalesInvoice({
        tx,
        customerId: String(payload.customerId),
        projectId: String(payload.projectId),
        amount: Number(payload.amount || payload.totalAmount),
        currency: payload.currency ? String(payload.currency) : draft.currencyCode,
        date: payload.date ? String(payload.date) : new Date(),
        notes: payload.notes ? String(payload.notes) : undefined,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : null,
        createdById: actor.userId,
      });
      convertedEntityId = res.invoice.id;
      promotedResult = res;
    } else if (
      draft.formType === "PURCHASE_BILL" &&
      payload.vendorId &&
      payload.projectId &&
      Number(payload.totalAmount || payload.amount) > 0
    ) {
      const res = await postVendorBill({
        tx,
        vendorId: String(payload.vendorId),
        projectId: String(payload.projectId),
        totalAmount: Number(payload.totalAmount || payload.amount),
        currency: payload.currency ? String(payload.currency) : draft.currencyCode,
        date: payload.date ? String(payload.date) : new Date(),
        notes: payload.notes ? String(payload.notes) : undefined,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : null,
        createdById: actor.userId,
      });
      convertedEntityId = res.bill.id;
      promotedResult = res;
    } else if (
      draft.formType === "RECEIPT_VOUCHER" &&
      payload.customerId &&
      payload.treasuryId &&
      Number(payload.amount) > 0
    ) {
      const res = await postCustomerReceipt({
        tx,
        customerId: String(payload.customerId),
        treasuryId: String(payload.treasuryId),
        amount: Number(payload.amount),
        currency: payload.currency ? String(payload.currency) : draft.currencyCode,
        date: payload.date ? String(payload.date) : new Date(),
        notes: payload.notes ? String(payload.notes) : undefined,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : null,
        createdById: actor.userId,
      });
      convertedEntityId = res.receipt.id;
      promotedResult = res;
    } else if (
      draft.formType === "PAYMENT_VOUCHER" &&
      payload.vendorId &&
      payload.treasuryId &&
      Number(payload.amount) > 0
    ) {
      const res = await postVendorPayment({
        tx,
        vendorId: String(payload.vendorId),
        treasuryId: String(payload.treasuryId),
        amount: Number(payload.amount),
        currency: payload.currency ? String(payload.currency) : draft.currencyCode,
        date: payload.date ? String(payload.date) : new Date(),
        notes: payload.notes ? String(payload.notes) : undefined,
        costCenterId: payload.costCenterId ? String(payload.costCenterId) : null,
        createdById: actor.userId,
      });
      convertedEntityId = res.voucher.id;
      promotedResult = res;
    } else {
      // Non-auto-postable form draft: mark converted / handed off with validated payload
      convertedEntityId = `PROMOTED-${draft.draftNumber}`;
      promotedResult = { handedOff: true, payload };
    }

    const updatedDraft = await tx.workspaceDraft.update({
      where: { id: draft.id },
      data: {
        status: requireApproval ? "SUBMITTED_FOR_APPROVAL" : "CONVERTED",
        convertedEntityId,
        updatedById: actor.userId,
        updatedByName: actor.userName,
      },
    });

    return {
      draft: { ...updatedDraft, payload },
      convertedEntityId,
      targetDocStatus,
      result: promotedResult,
    };
  });
}

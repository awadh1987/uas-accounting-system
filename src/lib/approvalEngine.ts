/**
 * Approval & Controlled Post-Posting Amendment Governance Engine (Mission 2 / Phase 5)
 * --------------------------------------------------------------------------
 * - Enforces configurable ApprovalRule matrix (module, actionType, minAmountBase,
 *   requiredRole, approverUserIdsJson, allowSelfApproval = false).
 * - Holds matching creations/GL postings in PENDING_APPROVAL until approved.
 * - Captures beforeSnapshotJson + afterSnapshotJson + reasonAr for post-posting
 *   amendments, computes field-by-field diffs, atomically applies approved
 *   amendments with revisionNumber increment, and logs immutable AuditLog rows.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createWorkspaceDraft } from "@/lib/workspaceDraftsEngine";
import { emitNotification } from "@/lib/notifications/notificationService";

type Db = Prisma.TransactionClient | typeof prisma;

export const APPROVAL_ACTION_TYPES = [
  "CREATE_AND_POST",
  "GL_POSTING",
  "AMEND_POSTED_RECORD",
  "VOID_RECORD",
  "HIGH_VALUE_TRANSACTION",
  "FISCAL_YEAR_CLOSE",
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export type ApprovalDecision = "APPROVED" | "REJECTED" | "RETURNED_FOR_EDIT";

export interface ApprovalActor {
  userId: string;
  userName: string;
  userRole: string;
}

export interface SnapshotFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export function safeJsonParse<T = Record<string, unknown>>(raw?: string | null): T {
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export function computeSnapshotDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): SnapshotFieldDiff[] {
  const b = before || {};
  const a = after || {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  const diffs: SnapshotFieldDiff[] = [];
  for (const key of keys) {
    const bv = b[key];
    const av = a[key];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      diffs.push({ field: key, before: bv ?? null, after: av ?? null });
    }
  }
  return diffs;
}

async function nextApprovalRequestNumber(tx: Db): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `APR-${year}-`;
  const count = await tx.approvalRequest.count({
    where: { requestNumber: { startsWith: prefix } },
  });
  let seq = count + 1;
  for (;;) {
    const candidate = `${prefix}${String(seq).padStart(4, "0")}`;
    const exists = await tx.approvalRequest.findUnique({
      where: { requestNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
    seq++;
  }
}

async function resolveValidAuditUserId(tx: Db, requestedId?: string): Promise<string> {
  if (requestedId) {
    const u = await tx.user.findUnique({ where: { id: requestedId }, select: { id: true } });
    if (u) return u.id;
  }
  const fallback = await tx.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!fallback) throw new Error("NO_SYSTEM_USER_FOUND");
  return fallback.id;
}

// ============================================================================
// 1. Approval Rules Matrix CRUD & Evaluation
// ============================================================================

export async function listApprovalRules(client: Db = prisma) {
  return client.approvalRule.findMany({ orderBy: [{ module: "asc" }, { minAmountBase: "asc" }] });
}

export interface CreateApprovalRuleInput {
  module: string;
  actionType: string;
  minAmountBase?: number;
  currencyCode?: string;
  requiredRole?: string;
  approverUserIds?: string[];
  allowSelfApproval?: boolean;
  isActive?: boolean;
}

export async function createApprovalRule(input: CreateApprovalRuleInput, client: Db = prisma) {
  const mod = (input.module || "ACCOUNTING").toUpperCase();
  const actionType = (input.actionType || "GL_POSTING").toUpperCase();
  if (!(APPROVAL_ACTION_TYPES as readonly string[]).includes(actionType)) {
    throw new Error(`INVALID_APPROVAL_ACTION_TYPE:${actionType}`);
  }
  return client.approvalRule.create({
    data: {
      module: mod,
      actionType,
      minAmountBase: Math.max(0, Number(input.minAmountBase) || 0),
      currencyCode: (input.currencyCode || "YER").toUpperCase(),
      requiredRole: (input.requiredRole || "CHIEF_ACCOUNTANT").toUpperCase(),
      approverUserIdsJson: JSON.stringify(input.approverUserIds ?? []),
      allowSelfApproval: Boolean(input.allowSelfApproval),
      isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
    },
  });
}

export async function updateApprovalRule(
  id: string,
  input: Partial<CreateApprovalRuleInput>,
  client: Db = prisma
) {
  const existing = await client.approvalRule.findUnique({ where: { id } });
  if (!existing) throw new Error("APPROVAL_RULE_NOT_FOUND");
  return client.approvalRule.update({
    where: { id },
    data: {
      ...(input.module !== undefined ? { module: input.module.toUpperCase() } : {}),
      ...(input.actionType !== undefined ? { actionType: input.actionType.toUpperCase() } : {}),
      ...(input.minAmountBase !== undefined ? { minAmountBase: Math.max(0, Number(input.minAmountBase) || 0) } : {}),
      ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode.toUpperCase() } : {}),
      ...(input.requiredRole !== undefined ? { requiredRole: input.requiredRole.toUpperCase() } : {}),
      ...(input.approverUserIds !== undefined ? { approverUserIdsJson: JSON.stringify(input.approverUserIds) } : {}),
      ...(input.allowSelfApproval !== undefined ? { allowSelfApproval: Boolean(input.allowSelfApproval) } : {}),
      ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}),
    },
  });
}

export async function deleteApprovalRule(id: string, client: Db = prisma) {
  await client.approvalRule.delete({ where: { id } });
  return { deleted: true };
}

export async function findMatchingApprovalRule(
  params: { module: string; actionType: string; amountBase?: number },
  client: Db = prisma
) {
  const mod = params.module.toUpperCase();
  const act = params.actionType.toUpperCase();
  const amt = Math.max(0, Number(params.amountBase) || 0);
  const rules = await client.approvalRule.findMany({
    where: {
      module: mod,
      actionType: act,
      isActive: true,
      minAmountBase: { lte: amt },
    },
    orderBy: { minAmountBase: "desc" },
  });
  return rules[0] ?? null;
}

// ============================================================================
// 2. Submit Approval Requests & Post-Posting Amendments
// ============================================================================

async function setTargetDocumentStatus(
  tx: Db,
  targetType: string,
  targetId: string,
  documentStatus: string,
  extra?: { status?: string; incrementRevision?: boolean; patchFields?: Record<string, unknown> }
) {
  const data: Record<string, unknown> = { documentStatus };
  if (extra?.status) data.status = extra.status;
  if (extra?.incrementRevision) data.revisionNumber = { increment: 1 };
  if (extra?.patchFields) Object.assign(data, extra.patchFields);

  if (targetType === "JournalEntry") {
    await tx.journalEntry.updateMany({ where: { id: targetId }, data });
  } else if (targetType === "SalesInvoice") {
    await tx.salesInvoice.updateMany({ where: { id: targetId }, data });
  } else if (targetType === "VendorBill") {
    await tx.vendorBill.updateMany({ where: { id: targetId }, data });
  } else if (targetType === "ReceiptVoucher") {
    const safeData = { ...data };
    delete safeData.status;
    await tx.receiptVoucher.updateMany({ where: { id: targetId }, data: safeData });
  } else if (targetType === "PaymentVoucher") {
    const safeData = { ...data };
    delete safeData.status;
    await tx.paymentVoucher.updateMany({ where: { id: targetId }, data: safeData });
  } else if (targetType === "StockMovement") {
    const safeData = { ...data };
    delete safeData.status;
    await tx.stockMovement.updateMany({ where: { id: targetId }, data: safeData });
  } else if (targetType === "OperatingExpense") {
    await tx.operatingExpense.updateMany({ where: { id: targetId }, data: { documentStatus } });
  } else if (targetType === "WorkerWageEntry") {
    await tx.workerWageEntry.updateMany({ where: { id: targetId }, data: { documentStatus } });
  }
}

export interface EvaluateApprovalInput {
  module: string;
  actionType?: ApprovalActionType;
  targetType: string;
  targetId: string;
  documentNumber: string;
  summaryAr: string;
  summaryEn?: string;
  amountBase?: number;
  currencyCode?: string;
  afterSnapshot?: Record<string, unknown>;
  requestedById?: string | null;
  requestedByName?: string | null;
  skipApprovalCheck?: boolean;
}

/**
 * Unified Approval Gate (Step 2.2):
 * Evaluates both `SystemSettings.requireApprovalWorkflow` and active `ApprovalRule`
 * thresholds for `(module, actionType, amountBase)`. When triggered inside an active
 * Prisma transaction `tx`, creates a PENDING `ApprovalRequest` and marks the target
 * document `PENDING_APPROVAL` atomically.
 */
export async function evaluateAndRouteApprovalTx(
  tx: Db,
  input: EvaluateApprovalInput
): Promise<{ requiresApproval: boolean; request: { id: string; requestNumber: string } | null }> {
  if (input.skipApprovalCheck) {
    return { requiresApproval: false, request: null };
  }

  const mod = (input.module || "ACCOUNTING").toUpperCase();
  const actionType: ApprovalActionType = input.actionType || "CREATE_AND_POST";
  const amountBase = Math.max(0, Number(input.amountBase) || 0);

  const settingsRow = await tx.systemSettings.findUnique({
    where: { id: "default" },
    select: { requireApprovalWorkflow: true },
  });
  const globalRequire = Boolean(settingsRow?.requireApprovalWorkflow);

  let matchedRule = await findMatchingApprovalRule(
    { module: mod, actionType, amountBase },
    tx
  );
  if (!matchedRule && actionType !== "GL_POSTING") {
    matchedRule = await findMatchingApprovalRule(
      { module: mod, actionType: "GL_POSTING", amountBase },
      tx
    );
  }
  if (!matchedRule && actionType !== "HIGH_VALUE_TRANSACTION") {
    matchedRule = await findMatchingApprovalRule(
      { module: mod, actionType: "HIGH_VALUE_TRANSACTION", amountBase },
      tx
    );
  }

  if (!globalRequire && !matchedRule) {
    return { requiresApproval: false, request: null };
  }

  const requesterId = await resolveValidAuditUserId(tx, input.requestedById ?? undefined);
  let requesterName = input.requestedByName?.trim() || "";
  if (!requesterName) {
    const u = await tx.user.findUnique({
      where: { id: requesterId },
      select: { fullName: true, name: true },
    });
    requesterName = u?.fullName || u?.name || "مستخدم النظام";
  }

  const requestNumber = await nextApprovalRequestNumber(tx);
  const request = await tx.approvalRequest.create({
    data: {
      requestNumber,
      ruleId: matchedRule?.id ?? null,
      module: mod,
      actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      documentNumber: input.documentNumber,
      summaryAr: input.summaryAr,
      summaryEn: input.summaryEn || input.summaryAr,
      amountBase,
      currencyCode: (input.currencyCode || "YER").toUpperCase(),
      beforeSnapshotJson: null,
      afterSnapshotJson: JSON.stringify(input.afterSnapshot ?? {}),
      reasonAr: globalRequire
        ? "تتطلب سياسة المنظومة اعتماد المراجعة قبل الترحيل النهائي"
        : `تجاوز حد قاعدة الاعتماد (${matchedRule?.requiredRole || "CHIEF_ACCOUNTANT"})`,
      status: "PENDING",
      requestedById: requesterId,
      requestedByName: requesterName,
    },
    select: { id: true, requestNumber: true },
  });

  await setTargetDocumentStatus(
    tx,
    input.targetType,
    input.targetId,
    "PENDING_APPROVAL",
    input.targetType === "JournalEntry" ||
    input.targetType === "SalesInvoice" ||
    input.targetType === "VendorBill"
      ? { status: "PENDING_APPROVAL" }
      : undefined
  );

  await emitNotification(
    {
      eventType: "APPROVAL_REQUIRED",
      channel: "approvals",
      severity: "WARNING",
      titleAr: `طلب اعتماد مالي جديد (${requestNumber})`,
      titleEn: `Approval Required (${requestNumber})`,
      messageAr: `${input.summaryAr} — مقدم الطلب: ${requesterName}`,
      messageEn: `${input.summaryEn || input.summaryAr} — Requested by: ${requesterName}`,
      targetTab: "audit",
      targetEntityType: "ApprovalRequest",
      targetEntityId: request.id,
      actorUserId: requesterId,
      metadata: { requestNumber, module: mod, actionType, amountBase },
    },
    tx
  );

  return { requiresApproval: true, request };
}

export interface SubmitApprovalRequestInput {
  module: string;
  actionType: ApprovalActionType;
  targetType: string;
  targetId: string;
  documentNumber: string;
  summaryAr: string;
  summaryEn?: string;
  amountBase?: number;
  currencyCode?: string;
  beforeSnapshot?: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown>;
  reasonAr?: string | null;
  actor: ApprovalActor;
}

export async function submitApprovalRequest(
  input: SubmitApprovalRequestInput,
  client: typeof prisma = prisma
) {
  return client.$transaction(async (tx) => {
    const mod = input.module.toUpperCase();
    const rule = await findMatchingApprovalRule(
      { module: mod, actionType: input.actionType, amountBase: input.amountBase ?? 0 },
      tx
    );
    const requestNumber = await nextApprovalRequestNumber(tx);

    const request = await tx.approvalRequest.create({
      data: {
        requestNumber,
        ruleId: rule?.id ?? null,
        module: mod,
        actionType: input.actionType,
        targetType: input.targetType,
        targetId: input.targetId,
        documentNumber: input.documentNumber,
        summaryAr: input.summaryAr,
        summaryEn: input.summaryEn || input.summaryAr,
        amountBase: Number(input.amountBase) || 0,
        currencyCode: (input.currencyCode || "YER").toUpperCase(),
        beforeSnapshotJson: input.beforeSnapshot ? JSON.stringify(input.beforeSnapshot) : null,
        afterSnapshotJson: JSON.stringify(input.afterSnapshot ?? {}),
        reasonAr: input.reasonAr?.trim() || null,
        status: "PENDING",
        requestedById: input.actor.userId,
        requestedByName: input.actor.userName,
      },
      include: { rule: true },
    });

    const isAmend = input.actionType === "AMEND_POSTED_RECORD";
    await setTargetDocumentStatus(
      tx,
      input.targetType,
      input.targetId,
      isAmend ? "AMENDMENT_PENDING" : "PENDING_APPROVAL",
      !isAmend && input.targetType === "JournalEntry" ? { status: "PENDING_APPROVAL" } : undefined
    );

    await emitNotification(
      {
        eventType: "APPROVAL_REQUIRED",
        channel: "approvals",
        severity: "WARNING",
        titleAr: `طلب اعتماد مالي جديد (${requestNumber})`,
        titleEn: `Approval Required (${requestNumber})`,
        messageAr: `${input.summaryAr} — مقدم الطلب: ${input.actor.userName}`,
        messageEn: `${input.summaryEn || input.summaryAr} — Requested by: ${input.actor.userName}`,
        targetTab: "audit",
        targetEntityType: "ApprovalRequest",
        targetEntityId: request.id,
        actorUserId: input.actor.userId,
        metadata: { requestNumber, module: mod, actionType: input.actionType, amountBase: input.amountBase ?? 0 },
      },
      tx
    );

    return {
      ...request,
      beforeSnapshot: input.beforeSnapshot ?? null,
      afterSnapshot: input.afterSnapshot,
      diffs: computeSnapshotDiff(input.beforeSnapshot, input.afterSnapshot),
    };
  });
}

export async function listApprovalRequests(
  filter: { status?: string; module?: string } = {},
  client: Db = prisma
) {
  const where: Prisma.ApprovalRequestWhereInput = {};
  if (filter.status && filter.status !== "ALL") where.status = filter.status.toUpperCase();
  if (filter.module && filter.module !== "ALL") where.module = filter.module.toUpperCase();

  const rows = await client.approvalRequest.findMany({
    where,
    include: { rule: true },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => {
    const beforeSnapshot = r.beforeSnapshotJson ? safeJsonParse(r.beforeSnapshotJson) : null;
    const afterSnapshot = safeJsonParse(r.afterSnapshotJson);
    return {
      ...r,
      beforeSnapshot,
      afterSnapshot,
      diffs: computeSnapshotDiff(beforeSnapshot, afterSnapshot),
    };
  });
}

// ============================================================================
// 3. Decision Execution Engine (APPROVE / REJECT / RETURN_FOR_EDIT)
// ============================================================================

export async function decideApprovalRequest(
  input: {
    requestId: string;
    decision: ApprovalDecision;
    reviewNotes?: string | null;
    reviewer: ApprovalActor;
  },
  client: typeof prisma = prisma
) {
  return client.$transaction(async (tx) => {
    // Concurrency State Guard: Atomically lock request with WHERE status = 'PENDING'
    const guarded = await tx.approvalRequest.updateMany({
      where: { id: input.requestId, status: "PENDING" },
      data: { status: input.decision },
    });
    if (guarded.count === 0) {
      const existing = await tx.approvalRequest.findUnique({ where: { id: input.requestId } });
      if (!existing) throw new Error("APPROVAL_REQUEST_NOT_FOUND");
      throw new Error(`APPROVAL_ALREADY_DECIDED: تم البت في هذا الطلب مسبقاً (${existing.status})`);
    }

    const req = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: input.requestId },
      include: { rule: true },
    });

    const allowSelf = req.rule?.allowSelfApproval ?? false;
    if (!allowSelf && input.reviewer.userId === req.requestedById) {
      throw new Error(
        "SELF_APPROVAL_FORBIDDEN: لا يسمح لمقدم الطلب باعتماد طلبه بنفسه وفق سياسة الحوكمة."
      );
    }

    // Role / explicit approver authorization check
    if (req.rule && input.reviewer.userRole !== "SUPER_ADMIN") {
      const explicitApprovers = safeJsonParse<string[]>(req.rule.approverUserIdsJson);
      const allowedByRole =
        input.reviewer.userRole.toUpperCase() === req.rule.requiredRole.toUpperCase();
      const allowedByUser =
        Array.isArray(explicitApprovers) && explicitApprovers.includes(input.reviewer.userId);
      if (!allowedByRole && !allowedByUser) {
        throw new Error(
          `APPROVAL_ROLE_REQUIRED: يتطلب هذا الاعتماد صلاحية (${req.rule.requiredRole}) أو مدير النظام.`
        );
      }
    }

    const beforeSnapshot = req.beforeSnapshotJson ? safeJsonParse(req.beforeSnapshotJson) : null;
    const afterSnapshot = safeJsonParse(req.afterSnapshotJson);
    const isAmend = req.actionType === "AMEND_POSTED_RECORD";
    const auditUserId = await resolveValidAuditUserId(tx, input.reviewer.userId);

    let createdDraftId: string | null = null;

    if (input.decision === "APPROVED") {
      if (isAmend) {
        // Apply safe amended fields + increment revisionNumber
        const patchFields: Record<string, unknown> = {};
        if (req.targetType === "JournalEntry") {
          if (typeof afterSnapshot.narrationAr === "string") patchFields.narrationAr = afterSnapshot.narrationAr;
          if (typeof afterSnapshot.narrationEn === "string") patchFields.narrationEn = afterSnapshot.narrationEn;
          if (typeof afterSnapshot.reference === "string") patchFields.reference = afterSnapshot.reference;
        } else if (req.targetType === "SalesInvoice" || req.targetType === "VendorBill") {
          if (typeof afterSnapshot.notes === "string") patchFields.notes = afterSnapshot.notes;
        } else if (req.targetType === "ReceiptVoucher" || req.targetType === "PaymentVoucher") {
          if (typeof afterSnapshot.notes === "string") patchFields.notes = afterSnapshot.notes;
        }

        await setTargetDocumentStatus(tx, req.targetType, req.targetId, "POSTED", {
          incrementRevision: true,
          patchFields,
        });
      } else {
        // Approve creation / GL posting -> transition from PENDING_APPROVAL to POSTED
        await setTargetDocumentStatus(tx, req.targetType, req.targetId, "POSTED", {
          status:
            req.targetType === "JournalEntry" ||
            req.targetType === "SalesInvoice" ||
            req.targetType === "VendorBill"
              ? "POSTED"
              : undefined,
        });

        // Cascade approval posting to linked JournalEntry if this document held a PENDING_APPROVAL journal
        const linkLookup =
          req.targetType === "VendorBill"
            ? await tx.vendorBill.findUnique({ where: { id: req.targetId }, select: { journalEntryId: true } })
            : req.targetType === "SalesInvoice"
            ? await tx.salesInvoice.findUnique({ where: { id: req.targetId }, select: { journalEntryId: true, cogsJournalEntryId: true } })
            : req.targetType === "PaymentVoucher"
            ? await tx.paymentVoucher.findUnique({ where: { id: req.targetId }, select: { journalEntryId: true } })
            : req.targetType === "ReceiptVoucher"
            ? await tx.receiptVoucher.findUnique({ where: { id: req.targetId }, select: { journalEntryId: true } })
            : req.targetType === "OperatingExpense"
            ? await tx.operatingExpense.findUnique({ where: { id: req.targetId }, select: { journalEntryId: true } })
            : req.targetType === "WorkerWageEntry"
            ? await tx.workerWageEntry.findUnique({ where: { id: req.targetId }, select: { journalEntryId: true } })
            : null;
        if (linkLookup && "journalEntryId" in linkLookup && linkLookup.journalEntryId) {
          await tx.journalEntry.updateMany({
            where: { id: linkLookup.journalEntryId, status: "PENDING_APPROVAL" },
            data: { status: "POSTED", documentStatus: "POSTED" },
          });
        }
        if (linkLookup && "cogsJournalEntryId" in linkLookup && linkLookup.cogsJournalEntryId) {
          await tx.journalEntry.updateMany({
            where: { id: linkLookup.cogsJournalEntryId, status: "PENDING_APPROVAL" },
            data: { status: "POSTED", documentStatus: "POSTED" },
          });
        }
        if (req.targetType === "WorkerWageEntry") {
          await tx.journalEntry.updateMany({
            where: { sourceId: req.targetId, status: "PENDING_APPROVAL" },
            data: { status: "POSTED", documentStatus: "POSTED" },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          userId: auditUserId,
          action: isAmend ? "AMENDMENT_APPROVED" : "APPROVAL_APPROVED",
          entity: req.targetType,
          entityId: req.targetId,
          details: {
            requestNumber: req.requestNumber,
            actionType: req.actionType,
            documentNumber: req.documentNumber,
            before: beforeSnapshot as Prisma.InputJsonValue,
            after: afterSnapshot as Prisma.InputJsonValue,
            reasonAr: req.reasonAr,
            reviewedBy: input.reviewer.userName,
            reviewNotes: input.reviewNotes || null,
          },
        },
      });
    } else if (input.decision === "REJECTED") {
      await setTargetDocumentStatus(
        tx,
        req.targetType,
        req.targetId,
        isAmend ? "POSTED" : "REJECTED",
        !isAmend && req.targetType === "JournalEntry" ? { status: "VOIDED" } : undefined
      );
      await tx.auditLog.create({
        data: {
          userId: auditUserId,
          action: "APPROVAL_REJECTED",
          entity: req.targetType,
          entityId: req.targetId,
          details: {
            requestNumber: req.requestNumber,
            reviewedBy: input.reviewer.userName,
            reviewNotes: input.reviewNotes || null,
          },
        },
      });
    } else if (input.decision === "RETURNED_FOR_EDIT") {
      await setTargetDocumentStatus(
        tx,
        req.targetType,
        req.targetId,
        isAmend ? "POSTED" : "DRAFT",
        !isAmend && req.targetType === "JournalEntry" ? { status: "DRAFT" } : undefined
      );
      const draft = await createWorkspaceDraft(
        {
          module: req.module,
          formType: req.targetType.toUpperCase(),
          entityId: req.targetId,
          titleAr: `معاد للتعديل: ${req.summaryAr}`,
          titleEn: `Returned for Edit: ${req.summaryEn || req.summaryAr}`,
          payload: { ...afterSnapshot, _reviewNotes: input.reviewNotes || "" },
          totalAmount: Number(req.amountBase),
          currencyCode: req.currencyCode,
          visibility: "SHARED_WORKSPACE",
          actor: {
            userId: req.requestedById,
            userName: req.requestedByName,
          },
        },
        tx
      );
      createdDraftId = draft.id;
    }

    const updated = await tx.approvalRequest.update({
      where: { id: req.id },
      data: {
        status: input.decision,
        reviewedById: input.reviewer.userId,
        reviewedByName: input.reviewer.userName,
        reviewNotes: input.reviewNotes?.trim() || null,
        reviewedAt: new Date(),
      },
      include: { rule: true },
    });

    return {
      request: {
        ...updated,
        beforeSnapshot,
        afterSnapshot,
        diffs: computeSnapshotDiff(beforeSnapshot, afterSnapshot),
      },
      createdDraftId,
    };
  });
}

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertNotInLockedPeriod } from "@/lib/accountingSettings";
import { computeOperatingExpenseTotal, computeSaleTotals, computeWorkerWageTotals } from "@/lib/formulas";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { emitNotification } from "@/lib/notifications/notificationService";
import type { UasSyncConflict } from "@/types/uas";

type Db = Prisma.TransactionClient | typeof prisma;

export interface SyncChangeItem {
  cursor: number;
  entityType: string;
  entityId: string;
  operation: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  deviceId: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface ClientSyncMutationInput {
  idempotencyKey: string;
  entityType: string;
  entityId?: string;
  operation: "CREATE" | "UPDATE" | "DELETE" | "POST" | "VOID" | string;
  payload: Record<string, unknown>;
  baseUpdatedAt?: string | null;
  expectedRevision?: number | null;
  projectId?: string | null;
  harvestName?: string | null;
  txDate?: string | null;
}

export interface SyncPushOutcomeItem {
  idempotencyKey: string;
  entityType: string;
  entityId: string;
  status: "APPLIED" | "DUPLICATE_SKIPPED" | "CONFLICT_PENDING";
  cursor?: number;
  conflictId?: string;
  reason?: string;
}

function safeParseJsonObj(raw?: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function recordSyncChangeTx(
  tx: Db,
  input: {
    entityType: string;
    entityId: string;
    operation: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string | null;
    deviceId?: string | null;
    actorUserId?: string | null;
  }
): Promise<SyncChangeItem> {
  const row = await tx.syncChangeLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation.toUpperCase(),
      payloadJson: JSON.stringify(input.payload ?? {}),
      idempotencyKey: input.idempotencyKey?.trim() || null,
      deviceId: input.deviceId ?? null,
      actorUserId: input.actorUserId ?? null,
    },
  });
  return {
    cursor: row.cursor,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    payload: safeParseJsonObj(row.payloadJson),
    idempotencyKey: row.idempotencyKey,
    deviceId: row.deviceId,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function pullChangesSince(params: {
  sinceCursor?: number;
  limit?: number;
  deviceId?: string | null;
}): Promise<{
  changes: SyncChangeItem[];
  latestCursor: number;
  hasMore: boolean;
  serverTime: string;
  pendingConflictsCount: number;
  devicePolicy?: {
    status: string;
    syncMode: string;
    syncIntervalSec: number;
    pendingCommand: string | null;
  } | null;
}> {
  const sinceCursor = Math.max(0, Math.floor(Number(params.sinceCursor) || 0));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(params.limit) || 100)));

  const [rows, latestRow, pendingConflictsCount] = await Promise.all([
    prisma.syncChangeLog.findMany({
      where: { cursor: { gt: sinceCursor } },
      orderBy: { cursor: "asc" },
      take: limit + 1,
    }),
    prisma.syncChangeLog.findFirst({
      orderBy: { cursor: "desc" },
      select: { cursor: true },
    }),
    prisma.syncConflict.count({
      where: { status: "CONFLICT_PENDING" },
    }),
  ]);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const changes: SyncChangeItem[] = sliced.map((r) => ({
    cursor: r.cursor,
    entityType: r.entityType,
    entityId: r.entityId,
    operation: r.operation,
    payload: safeParseJsonObj(r.payloadJson),
    idempotencyKey: r.idempotencyKey,
    deviceId: r.deviceId,
    actorUserId: r.actorUserId,
    createdAt: r.createdAt.toISOString(),
  }));

  const latestCursor = latestRow?.cursor ?? sinceCursor;
  const deliveredCursor = changes.length > 0 ? changes[changes.length - 1].cursor : sinceCursor;

  let devicePolicy: {
    status: string;
    syncMode: string;
    syncIntervalSec: number;
    pendingCommand: string | null;
  } | null = null;

  if (params.deviceId) {
    const dev = await prisma.tenantDevice.findUnique({ where: { deviceId: params.deviceId } });
    if (dev) {
      devicePolicy = {
        status: dev.status,
        syncMode: dev.syncMode,
        syncIntervalSec: dev.syncIntervalSec,
        pendingCommand: dev.pendingCommand,
      };
      const shouldClearCmd =
        dev.pendingCommand === "SYNC_NOW" || dev.pendingCommand === "FORCE_FULL_RESYNC";
      await prisma.tenantDevice.update({
        where: { deviceId: params.deviceId },
        data: {
          lastSeenAt: new Date(),
          lastCursor: Math.max(dev.lastCursor, deliveredCursor),
          lastSyncAt: new Date(),
          ...(shouldClearCmd ? { pendingCommand: null } : {}),
        },
      });
    }
  }

  return {
    changes,
    latestCursor,
    hasMore,
    serverTime: new Date().toISOString(),
    pendingConflictsCount,
    devicePolicy,
  };
}

async function detectConflictForMutation(
  tx: Db,
  mutation: ClientSyncMutationInput,
  clientCursor: number,
  periodLockDate: string | null
): Promise<{
  conflict: boolean;
  reason?: string;
  serverSnapshot?: Record<string, unknown>;
}> {
  const entityType = mutation.entityType.trim();
  const entityId = String(mutation.entityId || mutation.payload?.id || "").trim();
  const txDate = String(mutation.txDate || mutation.payload?.date || "").trim();

  // 1. Period lock date check
  if (txDate && periodLockDate) {
    const lockRes = assertNotInLockedPeriod(txDate, periodLockDate);
    if (!lockRes.ok) {
      return {
        conflict: true,
        reason: lockRes.error,
        serverSnapshot: { periodLockDate, txDate },
      };
    }
  }

  // 2. Harvest cycle lock check
  const projectId = String(mutation.projectId || mutation.payload?.projectId || "").trim();
  const harvestName = String(mutation.harvestName || mutation.payload?.harvest || "").trim();
  if (projectId && harvestName) {
    const cycle = await tx.harvestCycle.findFirst({
      where: { projectId, name: harvestName },
    });
    if (cycle?.isLocked) {
      return {
        conflict: true,
        reason: `🔒 القطفة (${harvestName}) مغلقة محاسبياً على الخادم / Harvest cycle (${harvestName}) is locked on server.`,
        serverSnapshot: {
          projectId,
          harvestName,
          isLocked: true,
          lockedAt: cycle.lockedAt?.toISOString() ?? null,
        },
      };
    }
  }

  // 3. Immutable / concurrently modified records check
  if (entityId) {
    if (entityType === "JournalEntry") {
      const existing = await tx.journalEntry.findUnique({ where: { id: entityId } });
      if (existing) {
        if (existing.status === "POSTED" || existing.status === "VOIDED") {
          return {
            conflict: true,
            reason: `قيد اليومية (${existing.entryNumber}) مرحّل أو ملغى بالفعل ولا يمكن تعديله بالمزامنة / JournalEntry already ${existing.status}.`,
            serverSnapshot: {
              id: existing.id,
              entryNumber: existing.entryNumber,
              status: existing.status,
              revisionNumber: existing.revisionNumber,
              updatedAt: existing.updatedAt.toISOString(),
            },
          };
        }
        if (
          (mutation.expectedRevision !== undefined &&
            mutation.expectedRevision !== null &&
            existing.revisionNumber !== mutation.expectedRevision) ||
          (mutation.baseUpdatedAt &&
            existing.updatedAt.toISOString() !== mutation.baseUpdatedAt)
        ) {
          return {
            conflict: true,
            reason: "تعديل متزامن على نفس قيد اليومية / Concurrent edit detected on JournalEntry.",
            serverSnapshot: {
              id: existing.id,
              entryNumber: existing.entryNumber,
              status: existing.status,
              revisionNumber: existing.revisionNumber,
              updatedAt: existing.updatedAt.toISOString(),
            },
          };
        }
      }
    } else if (entityType === "SalesInvoice") {
      const existing = await tx.salesInvoice.findUnique({ where: { id: entityId } });
      if (existing && (existing.status === "POSTED" || existing.status === "PAID" || existing.status === "VOIDED")) {
        return {
          conflict: true,
          reason: `فاتورة المبيعات (${existing.invoiceNumber}) مرحلة بالفعل ولا يمكن استبدالها / SalesInvoice already ${existing.status}.`,
          serverSnapshot: {
            id: existing.id,
            invoiceNumber: existing.invoiceNumber,
            status: existing.status,
            totalAmount: Number(existing.totalAmount),
            revisionNumber: existing.revisionNumber,
          },
        };
      }
    } else if (entityType === "VendorBill") {
      const existing = await tx.vendorBill.findUnique({ where: { id: entityId } });
      if (existing && (existing.status === "POSTED" || existing.status === "PAID" || existing.status === "VOIDED")) {
        return {
          conflict: true,
          reason: `فاتورة المورد (${existing.billNumber}) مرحلة بالفعل / VendorBill already ${existing.status}.`,
          serverSnapshot: {
            id: existing.id,
            billNumber: existing.billNumber,
            status: existing.status,
            totalAmount: Number(existing.totalAmount),
            revisionNumber: existing.revisionNumber,
          },
        };
      }
    } else if (mutation.operation.toUpperCase() !== "CREATE") {
      // Check SyncChangeLog for newer edits to the same entity after clientCursor
      const newerChange = await tx.syncChangeLog.findFirst({
        where: {
          entityType,
          entityId,
          cursor: { gt: clientCursor },
        },
        orderBy: { cursor: "desc" },
      });
      if (newerChange) {
        return {
          conflict: true,
          reason: `تم تعديل السجل (${entityType}:${entityId}) على الخادم بعد آخر مزامنة للجهاز (Cursor #${newerChange.cursor}) / Concurrent modification detected.`,
          serverSnapshot: {
            serverCursor: newerChange.cursor,
            operation: newerChange.operation,
            payload: safeParseJsonObj(newerChange.payloadJson),
            updatedAt: newerChange.createdAt.toISOString(),
          },
        };
      }
    }
  }

  return { conflict: false };
}

async function applySafeEntityMutation(
  tx: Db,
  mutation: ClientSyncMutationInput
): Promise<string> {
  const entityType = mutation.entityType.trim();
  const op = mutation.operation.toUpperCase();
  const payload = mutation.payload || {};
  const providedId = String(mutation.entityId || payload.id || "").trim();

  if (entityType === "OperatingExpense" && op === "CREATE") {
    const projectId = String(payload.projectId || "");
    const qty = Number(payload.qty ?? payload.quantity) || 1;
    const unitPrice = Number(payload.unitPrice) || 0;
    const totalAmount = Number(payload.totalAmount) || computeOperatingExpenseTotal(qty, unitPrice);
    if (projectId) {
      const created = await tx.operatingExpense.create({
        data: {
          ...(providedId ? { id: providedId } : {}),
          projectId,
          subProjectId: payload.subProjectId ? String(payload.subProjectId) : null,
          harvestName: String(payload.harvest || payload.harvestName || "القطفة الأولى"),
          category: String(payload.category || "وقود/محروقات"),
          subType: String(payload.subType || payload.category || "أخرى"),
          quantity: qty,
          unitPrice,
          totalAmount,
          expenseDate: String(payload.date || payload.expenseDate || new Date().toISOString().slice(0, 10)),
          notes: String(payload.notes || ""),
        },
      });
      return created.id;
    }
  }

  if (entityType === "WorkerWageEntry" && op === "CREATE") {
    const workerId = String(payload.workerId || "");
    const projectId = String(payload.projectId || "");
    if (workerId && projectId) {
      const dailyWage = Number(payload.dailyWage) || 0;
      const daysWorked = Number(payload.daysWorked ?? payload.days) || 1;
      const creditAmount = Number(payload.creditAmount ?? payload.credit) || 0;
      const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, daysWorked, creditAmount);
      const created = await tx.workerWageEntry.create({
        data: {
          ...(providedId ? { id: providedId } : {}),
          workerId,
          workerName: String(payload.workerName || payload.name || "عامل"),
          projectId,
          subProjectId: payload.subProjectId ? String(payload.subProjectId) : null,
          harvestName: String(payload.harvest || payload.harvestName || "القطفة الأولى"),
          dailyWage,
          daysWorked,
          totalWage,
          creditAmount,
          debitBalance,
          workDate: String(payload.date || payload.workDate || new Date().toISOString().slice(0, 10)),
          notes: String(payload.notes || ""),
        },
      });
      return created.id;
    }
  }

  if (entityType === "SaleTransaction" && op === "CREATE") {
    const projectId = String(payload.projectId || "");
    const customerId = String(payload.customerId || "");
    if (projectId && customerId) {
      const bundlesCount = Math.max(0, Math.round(Number(payload.bundlesCount ?? payload.bundles) || 0));
      const unitPrice = Number(payload.unitPrice ?? payload.price) || 0;
      const creditPaid = Number(payload.creditPaid ?? payload.credit) || 0;
      const { totalAmount, debitReceivable } = computeSaleTotals(bundlesCount, unitPrice, creditPaid);
      const created = await tx.saleTransaction.create({
        data: {
          ...(providedId ? { id: providedId } : {}),
          projectId,
          customerId,
          customerName: String(payload.customerName || payload.customer || "عميل"),
          customerPhone: String(payload.customerPhone || payload.phone || ""),
          harvestName: String(payload.harvest || payload.harvestName || "القطفة الأولى"),
          saleBatchLabel: String(payload.saleBatchLabel || payload.batch || "دفعة ميدانية"),
          productGrade: String(payload.productGrade || payload.grade || "صنف 1"),
          bundlesCount,
          unitPrice,
          totalAmount,
          creditPaid,
          debitReceivable,
          saleDate: String(payload.saleDate || payload.date || new Date().toISOString().slice(0, 10)),
          receiptVoucherNo: String(payload.receiptVoucherNo || payload.voucherNo || `RV-SYNC-${Date.now().toString().slice(-4)}`),
          notes: String(payload.notes || ""),
        },
      });
      return created.id;
    }
  }

  return providedId || `sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function pushClientMutations(input: {
  deviceId?: string | null;
  clientCursor?: number;
  mutations: ClientSyncMutationInput[];
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}): Promise<{
  ok: boolean;
  status: number;
  code?: string;
  error?: string;
  results: SyncPushOutcomeItem[];
  appliedCount: number;
  duplicateCount: number;
  conflictCount: number;
  latestCursor: number;
}> {
  const deviceId = input.deviceId?.trim() || null;
  const clientCursor = Math.max(0, Math.floor(Number(input.clientCursor) || 0));

  if (deviceId) {
    const dev = await prisma.tenantDevice.findUnique({ where: { deviceId } });
    if (dev?.status === "REVOKED") {
      return {
        ok: false,
        status: 403,
        code: "DEVICE_REVOKED",
        error: "تم إلغاء صلاحية هذا الجهاز من قبل مسؤول المنشأة / Device revoked by tenant admin.",
        results: [],
        appliedCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        latestCursor: clientCursor,
      };
    }
    if (dev?.status === "SUSPENDED") {
      return {
        ok: false,
        status: 403,
        code: "DEVICE_LOCKED",
        error: "تم قفل هذا الجهاز مؤقتاً / Device suspended by tenant admin.",
        results: [],
        appliedCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        latestCursor: clientCursor,
      };
    }
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: "default" } });
  const periodLockDate = settings?.periodLockDate ?? null;

  const results: SyncPushOutcomeItem[] = [];
  let appliedCount = 0;
  let duplicateCount = 0;
  let conflictCount = 0;

  for (const mutation of input.mutations) {
    const idempotencyKey = String(mutation.idempotencyKey || "").trim();
    const entityType = String(mutation.entityType || "UnknownEntity").trim();
    const rawEntityId = String(mutation.entityId || mutation.payload?.id || "").trim();

    if (!idempotencyKey) {
      throw new Error("Each sync mutation must include an idempotencyKey");
    }

    // 1. Check idempotency across SyncChangeLog & IdempotencyRecord
    const existingChange = await prisma.syncChangeLog.findUnique({
      where: { idempotencyKey },
    });
    if (existingChange) {
      duplicateCount++;
      results.push({
        idempotencyKey,
        entityType: existingChange.entityType,
        entityId: existingChange.entityId,
        status: "DUPLICATE_SKIPPED",
        cursor: existingChange.cursor,
      });
      continue;
    }

    const existingIdemp = await prisma.idempotencyRecord.findUnique({
      where: { idempotencyKey },
    });
    if (existingIdemp) {
      duplicateCount++;
      results.push({
        idempotencyKey,
        entityType,
        entityId: rawEntityId || "dedup",
        status: "DUPLICATE_SKIPPED",
      });
      continue;
    }

    // 2. Process mutation inside transaction with conflict detection
    const outcome = await prisma.$transaction(async (tx) => {
      const conflictCheck = await detectConflictForMutation(
        tx,
        mutation,
        clientCursor,
        periodLockDate
      );

      if (conflictCheck.conflict) {
        const conflictRow = await tx.syncConflict.create({
          data: {
            entityType,
            entityId: rawEntityId || idempotencyKey,
            idempotencyKey,
            deviceId,
            status: "CONFLICT_PENDING",
            reason: conflictCheck.reason || "CONFLICT_DETECTED",
            clientPayloadJson: JSON.stringify(mutation.payload ?? {}),
            serverSnapshotJson: JSON.stringify(conflictCheck.serverSnapshot ?? {}),
          },
        });

        await emitNotification(
          {
            eventType: "SYNC_CONFLICT",
            channel: "sync",
            severity: "CRITICAL",
            titleAr: `تعارض مزامنة يتطلب المراجعة (${entityType})`,
            titleEn: `Sync Conflict Pending Resolution (${entityType})`,
            messageAr: conflictCheck.reason || "تم تعليق العملية لحماية الأرصدة المحاسبية.",
            messageEn: conflictCheck.reason || "Operation flagged as CONFLICT_PENDING.",
            targetTab: "mobile",
            targetEntityType: "SyncConflict",
            targetEntityId: conflictRow.id,
            actorUserId: input.actor.userId ?? null,
            metadata: { conflictId: conflictRow.id, entityType, entityId: rawEntityId, deviceId },
          },
          tx
        );

        return {
          status: "CONFLICT_PENDING" as const,
          entityId: rawEntityId || conflictRow.id,
          conflictId: conflictRow.id,
          reason: conflictRow.reason,
        };
      }

      const resolvedEntityId = await applySafeEntityMutation(tx, mutation);
      const change = await recordSyncChangeTx(tx, {
        entityType,
        entityId: resolvedEntityId,
        operation: mutation.operation,
        payload: mutation.payload ?? {},
        idempotencyKey,
        deviceId,
        actorUserId: input.actor.userId ?? null,
      });

      await tx.idempotencyRecord.create({
        data: {
          idempotencyKey,
          endpoint: "/api/sync/push",
          method: "POST",
          userId: input.actor.userId ?? null,
          statusCode: 200,
          responseJson: JSON.stringify({ ok: true, cursor: change.cursor, entityId: resolvedEntityId }),
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });

      return {
        status: "APPLIED" as const,
        entityId: resolvedEntityId,
        cursor: change.cursor,
      };
    });

    if (outcome.status === "CONFLICT_PENDING") {
      conflictCount++;
      results.push({
        idempotencyKey,
        entityType,
        entityId: outcome.entityId,
        status: "CONFLICT_PENDING",
        conflictId: outcome.conflictId,
        reason: outcome.reason,
      });
    } else {
      appliedCount++;
      results.push({
        idempotencyKey,
        entityType,
        entityId: outcome.entityId,
        status: "APPLIED",
        cursor: outcome.cursor,
      });
    }
  }

  const latestRow = await prisma.syncChangeLog.findFirst({
    orderBy: { cursor: "desc" },
    select: { cursor: true },
  });
  const latestCursor = latestRow?.cursor ?? clientCursor;

  if (deviceId) {
    await prisma.tenantDevice
      .updateMany({
        where: { deviceId },
        data: {
          lastSeenAt: new Date(),
          lastSyncAt: new Date(),
          lastCursor: latestCursor,
          pendingQueueCount: conflictCount,
          lastSyncError:
            conflictCount > 0 ? `${conflictCount} conflict(s) pending resolution` : null,
        },
      })
      .catch(() => {});
  }

  if (appliedCount > 0) {
    await emitNotification({
      eventType: "SYNC_COMPLETED",
      channel: "sync",
      severity: "SUCCESS",
      titleAr: `اكتملت مزامنة ${appliedCount} عملية`,
      titleEn: `Synced ${appliedCount} mutation(s)`,
      messageAr: `تمت مزامنة ${appliedCount} عملية بنجاح (مؤشر #${latestCursor})${conflictCount > 0 ? ` مع ${conflictCount} تعارض بانتظار القرار` : ""}.`,
      messageEn: `Synchronized ${appliedCount} mutation(s) at cursor #${latestCursor}${conflictCount > 0 ? ` with ${conflictCount} conflict(s) pending` : ""}.`,
      targetTab: "mobile",
      actorUserId: input.actor.userId ?? null,
      metadata: { appliedCount, duplicateCount, conflictCount, latestCursor, deviceId },
    });
  }

  return {
    ok: true,
    status: 200,
    results,
    appliedCount,
    duplicateCount,
    conflictCount,
    latestCursor,
  };
}

export async function listSyncConflicts(statusFilter?: string): Promise<UasSyncConflict[]> {
  const where =
    statusFilter && statusFilter !== "ALL"
      ? { status: statusFilter.toUpperCase() }
      : undefined;
  const rows = await prisma.syncConflict.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    idempotencyKey: r.idempotencyKey,
    deviceId: r.deviceId,
    status: r.status,
    reason: r.reason,
    clientPayload: safeParseJsonObj(r.clientPayloadJson),
    serverSnapshot: safeParseJsonObj(r.serverSnapshotJson),
    resolutionNotes: r.resolutionNotes,
    resolvedById: r.resolvedById,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function resolveSyncConflict(input: {
  conflictId: string;
  resolution: "KEEP_SERVER" | "APPLY_CLIENT" | "DISMISS";
  resolutionNotes?: string;
  actor: { userId?: string | null; userDisplay: string; userRole: string };
}): Promise<UasSyncConflict> {
  const existing = await prisma.syncConflict.findUnique({
    where: { id: input.conflictId },
  });
  if (!existing) {
    throw new Error("SYNC_CONFLICT_NOT_FOUND");
  }
  if (existing.status !== "CONFLICT_PENDING") {
    throw new Error(`SYNC_CONFLICT_ALREADY_RESOLVED:${existing.status}`);
  }

  const nextStatus =
    input.resolution === "KEEP_SERVER"
      ? "RESOLVED_KEEP_SERVER"
      : input.resolution === "APPLY_CLIENT"
      ? "RESOLVED_APPLY_CLIENT"
      : "DISMISSED";

  const updated = await prisma.$transaction(async (tx) => {
    const clientPayload = safeParseJsonObj(existing.clientPayloadJson);
    if (input.resolution === "APPLY_CLIENT") {
      const entityId = await applySafeEntityMutation(tx, {
        idempotencyKey: existing.idempotencyKey || `resolve-${existing.id}`,
        entityType: existing.entityType,
        entityId: existing.entityId,
        operation: "UPDATE",
        payload: clientPayload,
      });
      await recordSyncChangeTx(tx, {
        entityType: existing.entityType,
        entityId,
        operation: "UPDATE",
        payload: clientPayload,
        deviceId: existing.deviceId,
        actorUserId: input.actor.userId ?? null,
      });
    }

    const row = await tx.syncConflict.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        resolutionNotes: input.resolutionNotes?.trim() || null,
        resolvedById: input.actor.userId ?? null,
        resolvedAt: new Date(),
      },
    });

    await appendAuditLogTx(tx, {
      userId: input.actor.userId ?? null,
      userDisplay: input.actor.userDisplay,
      userRole: input.actor.userRole,
      actionType: `حل تعارض مزامنة (${nextStatus})`,
      entityReference: `SyncConflict:${row.id}`,
      details: `تمت معالجة تعارض المزامنة للسجل ${row.entityType}:${row.entityId} بقرار ${nextStatus}`,
    });

    return row;
  });

  return {
    id: updated.id,
    entityType: updated.entityType,
    entityId: updated.entityId,
    idempotencyKey: updated.idempotencyKey,
    deviceId: updated.deviceId,
    status: updated.status,
    reason: updated.reason,
    clientPayload: safeParseJsonObj(updated.clientPayloadJson),
    serverSnapshot: safeParseJsonObj(updated.serverSnapshotJson),
    resolutionNotes: updated.resolutionNotes,
    resolvedById: updated.resolvedById,
    resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

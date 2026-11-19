import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/permissions";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export interface UserLifecycleActor {
  userId: string | null;
  userRole: string;
  userDisplay: string;
}

export interface SafeDeleteUserResult {
  ok: boolean;
  status: number;
  deleted: boolean;
  archived: boolean;
  seatsReleased: number;
  linkedCount?: number;
  message: string;
  error?: string;
}

export interface ArchiveRestoreUserResult {
  ok: boolean;
  status: number;
  archived?: boolean;
  restored?: boolean;
  seatsReleased?: number;
  message: string;
  error?: string;
}

/**
 * Releases all active `LicenseDeviceBinding` seats associated with the given user email.
 */
async function releaseSeatsByEmailTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  email: string
): Promise<number> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return 0;
  const res = await tx.licenseDeviceBinding.updateMany({
    where: { userEmail: cleanEmail, active: true },
    data: { active: false },
  });
  return res.count;
}

/**
 * Safely deletes or auto-archives a user:
 * - Admin-only (`SUPER_ADMIN`), blocks self-deletion.
 * - Counts linked `JournalEntry`, `AuditLog`, `ImmutableAuditLog`, and operational `Sale` records.
 * - Releases any active `LicenseDeviceBinding` seats for the user's email.
 * - If 0 linked records exist -> permanently deletes the user.
 * - If linked accounting/audit records exist -> soft-archives (`isActive = false`, `active = false`, `archivedAt = new Date()`).
 */
export async function safeDeleteOrArchiveUser(
  targetUserId: string,
  actor: UserLifecycleActor
): Promise<SafeDeleteUserResult> {
  if (!canManageUsers(actor.userRole)) {
    return {
      ok: false,
      status: 403,
      deleted: false,
      archived: false,
      seatsReleased: 0,
      message: "غير مصرح",
      error: "⛔ إدارة وحذف المستخدمين محصورة بمدير النظام العام / Restricted to SUPER_ADMIN",
    };
  }

  if (targetUserId === actor.userId) {
    return {
      ok: false,
      status: 400,
      deleted: false,
      archived: false,
      seatsReleased: 0,
      message: "لا يمكن حذف حسابك الشخصي",
      error: "لا يمكن حذف حسابك الشخصي المسجل به حالياً / Cannot delete your own active admin account",
    };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!existing) {
      return {
        ok: false,
        status: 404,
        deleted: false,
        archived: false,
        seatsReleased: 0,
        message: "المستخدم غير موجود",
        error: "المستخدم غير موجود / User not found",
      };
    }

    const [journalCount, auditCount, immutableAuditCount, salesTxCount, salesInvCount] = await Promise.all([
      tx.journalEntry.count({ where: { createdById: targetUserId } }),
      tx.auditLog.count({ where: { userId: targetUserId } }),
      tx.immutableAuditLog.count({ where: { userId: targetUserId } }),
      tx.saleTransaction.count({ where: { salesOfficerId: targetUserId } }),
      tx.salesInvoice.count({ where: { salesOfficerId: targetUserId } }),
    ]);

    const linkedCount = journalCount + auditCount + immutableAuditCount + salesTxCount + salesInvCount;
    const seatsReleased = await releaseSeatsByEmailTx(tx, existing.email);

    if (linkedCount === 0) {
      await tx.user.delete({ where: { id: targetUserId } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "حذف مستخدم نهائياً",
        entityReference: `User:${targetUserId}`,
        details: JSON.stringify({
          deletedUser: existing.name,
          email: existing.email,
          seatsReleased,
        }),
      });
      return {
        ok: true,
        status: 200,
        deleted: true,
        archived: false,
        seatsReleased,
        linkedCount: 0,
        message: "تم حذف المستخدم نهائياً وتحرير مقعد الترخيص بنجاح",
      };
    }

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        active: false,
        isActive: false,
        archivedAt: existing.archivedAt ?? new Date(),
      },
    });
    await appendAuditLogTx(tx, {
      ...actor,
      actionType: "أرشفة تلقائية لمستخدم مرتبط بقيود محاسبية",
      entityReference: `User:${targetUserId}`,
      details: JSON.stringify({
        archivedUser: existing.name,
        email: existing.email,
        linkedCount,
        seatsReleased,
      }),
    });

    return {
      ok: true,
      status: 200,
      deleted: false,
      archived: true,
      seatsReleased,
      linkedCount,
      message: "تمت أرشفة المستخدم لوجود قيود محاسبية مرتبطة به مع تحرير مقعد الترخيص",
    };
  });
}

/**
 * Explicitly archives (`action: "archive"`) or restores (`action: "restore"`) a user.
 * Archiving disables login, sets `archivedAt`, and releases active `LicenseDeviceBinding` seats.
 */
export async function archiveOrRestoreUser(
  targetUserId: string,
  action: "archive" | "restore",
  actor: UserLifecycleActor
): Promise<ArchiveRestoreUserResult> {
  if (!canManageUsers(actor.userRole)) {
    return {
      ok: false,
      status: 403,
      message: "غير مصرح",
      error: "⛔ إدارة وأرشفة المستخدمين محصورة بمدير النظام العام / Restricted to SUPER_ADMIN",
    };
  }

  if (action === "archive" && targetUserId === actor.userId) {
    return {
      ok: false,
      status: 400,
      message: "لا يمكن أرشفة حسابك الشخصي",
      error: "لا يمكن أرشفة حسابك الشخصي المسجل به حالياً / Cannot archive your own active admin account",
    };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: targetUserId } });
    if (!existing) {
      return {
        ok: false,
        status: 404,
        message: "المستخدم غير موجود",
        error: "المستخدم غير موجود / User not found",
      };
    }

    if (action === "archive") {
      const seatsReleased = await releaseSeatsByEmailTx(tx, existing.email);
      await tx.user.update({
        where: { id: targetUserId },
        data: {
          active: false,
          isActive: false,
          archivedAt: new Date(),
        },
      });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "أرشفة مستخدم",
        entityReference: `User:${targetUserId}`,
        details: JSON.stringify({
          targetUser: existing.name,
          email: existing.email,
          seatsReleased,
        }),
      });
      return {
        ok: true,
        status: 200,
        archived: true,
        seatsReleased,
        message: "تمت أرشفة المستخدم وإلغاء ربط أجهزته بنجاح",
      };
    }

    await tx.user.update({
      where: { id: targetUserId },
      data: {
        active: true,
        isActive: true,
        archivedAt: null,
      },
    });
    await appendAuditLogTx(tx, {
      ...actor,
      actionType: "استعادة مستخدم مؤرشف",
      entityReference: `User:${targetUserId}`,
      details: JSON.stringify({
        targetUser: existing.name,
        email: existing.email,
      }),
    });
    return {
      ok: true,
      status: 200,
      restored: true,
      message: "تمت استعادة المستخدم وتفعيل حسابه بنجاح",
    };
  });
}

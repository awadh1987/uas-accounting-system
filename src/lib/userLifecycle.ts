import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/permissions";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export interface UserLifecycleActor {
  userId: string | null;
  userRole: string;
  userDisplay: string;
  userEmail?: string;
}

export interface SafeDeleteUserResult {
  ok: boolean;
  status: number;
  deleted: boolean;
  archived: boolean;
  seatsReleased: number;
  linkedCount?: number;
  code?: string;
  guardReason?: "SELF_DELETION" | "LAST_ADMIN" | "LINKED_RECORDS" | "NONE";
  guidance?: string;
  message: string;
  error?: string;
}

export interface ArchiveRestoreUserResult {
  ok: boolean;
  status: number;
  archived?: boolean;
  restored?: boolean;
  seatsReleased?: number;
  code?: string;
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
 * - Admin-only (`SUPER_ADMIN`), blocks self-deletion with actionable guidance.
 * - Protects the last active SUPER_ADMIN from deletion or archiving.
 * - Counts linked `JournalEntry`, `AuditLog`, `ImmutableAuditLog`, operational `Sale`, and `WorkspaceDraft` records.
 * - Releases any active `LicenseDeviceBinding` seats for the user's email.
 * - If 0 linked records exist -> permanently deletes the user.
 * - If linked accounting/audit records exist -> soft-archives (`isActive = false`, `active = false`, `archivedAt = new Date()`)
 *   and guides the administrator toward Suspend (إيقاف) / Archive (أرشفة).
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
      code: "FORBIDDEN",
      message: "غير مصرح",
      error: "⛔ إدارة وحذف المستخدمين محصورة بمدير النظام العام / Restricted to SUPER_ADMIN",
    };
  }

  const cleanTarget = (targetUserId || "").trim();
  if (!cleanTarget) {
    return {
      ok: false,
      status: 400,
      deleted: false,
      archived: false,
      seatsReleased: 0,
      code: "INVALID_TARGET",
      message: "يرجى تحديد المستخدم المطلوب حذفه",
      error: "User ID or identifier is required",
    };
  }

  return prisma.$transaction(async (tx) => {
    // 1. Normalize lookup: match by ID, email (case-insensitive), or username
    const existing = await tx.user.findFirst({
      where: {
        OR: [
          { id: cleanTarget },
          { email: cleanTarget.toLowerCase() },
          { username: cleanTarget },
          { username: cleanTarget.toLowerCase() },
          { name: cleanTarget },
        ],
      },
    });

    if (!existing) {
      return {
        ok: false,
        status: 404,
        deleted: false,
        archived: false,
        seatsReleased: 0,
        code: "USER_NOT_FOUND",
        message: `المستخدم غير موجود (${cleanTarget})`,
        error: `المستخدم غير موجود (${cleanTarget}) / User not found`,
      };
    }

    // 2. Self-deletion guard
    const isSelf =
      existing.id === actor.userId ||
      cleanTarget === actor.userId ||
      (actor.userEmail && existing.email.toLowerCase() === actor.userEmail.toLowerCase());

    if (isSelf) {
      return {
        ok: false,
        status: 400,
        deleted: false,
        archived: false,
        seatsReleased: 0,
        code: "SELF_DELETION_FORBIDDEN",
        guardReason: "SELF_DELETION",
        guidance: "لا يمكن حذف الحساب المسجل به حالياً. يمكنك استخدام خيار إيقاف الحساب (إيقاف) أو تسليم الصلاحيات لمشرف آخر أولاً.",
        message: "لا يمكن حذف حسابك الشخصي المسجل به حالياً. يمكنك استخدام خيار إيقاف الحساب (إيقاف) أو تسليم الصلاحيات لمشرف آخر أولاً.",
        error: "لا يمكن حذف حسابك الشخصي المسجل به حالياً / Cannot delete your own active admin account. Use Suspend (إيقاف) or transfer ownership.",
      };
    }

    // 3. Last Admin guard
    if (existing.role === "SUPER_ADMIN") {
      const activeAdminsCount = await tx.user.count({
        where: {
          role: "SUPER_ADMIN",
          active: true,
          isActive: true,
          archivedAt: null,
        },
      });

      if (activeAdminsCount <= 1 && existing.active && existing.isActive && !existing.archivedAt) {
        return {
          ok: false,
          status: 400,
          deleted: false,
          archived: false,
          seatsReleased: 0,
          code: "LAST_ADMIN_PROTECTED",
          guardReason: "LAST_ADMIN",
          guidance: "للحفاظ على النظام، قم بإنشاء أو ترقية حساب مشرف عام بديل أولاً، أو استخدم خيار الإيقاف المؤقت (إيقاف).",
          message: "لا يمكن حذف أو أرشفة المشرف العام الوحيد المتبقي في المنشأة لضمان استمرارية إدارة النظام. يرجى إنشاء أو ترقية حساب مشرف عام بديل أولاً، أو استخدام خيار الإيقاف المؤقت (إيقاف).",
          error: "لا يمكن حذف المشرف العام الوحيد المتبقي في المنشأة / Cannot delete the last active SUPER_ADMIN. Designate a replacement admin first, or use Suspend (إيقاف).",
        };
      }
    }

    // 4. Count linked accounting and audit records
    const [journalCount, auditCount, immutableAuditCount, salesTxCount, salesInvCount, draftsCount] =
      await Promise.all([
        tx.journalEntry.count({ where: { createdById: existing.id } }),
        tx.auditLog.count({ where: { userId: existing.id } }),
        tx.immutableAuditLog.count({ where: { userId: existing.id } }),
        tx.saleTransaction.count({ where: { salesOfficerId: existing.id } }),
        tx.salesInvoice.count({ where: { salesOfficerId: existing.id } }),
        tx.workspaceDraft.count({ where: { createdById: existing.id } }).catch(() => 0),
      ]);

    const linkedCount = journalCount + auditCount + immutableAuditCount + salesTxCount + salesInvCount + draftsCount;
    const seatsReleased = await releaseSeatsByEmailTx(tx, existing.email);

    // 5. If 0 linked records exist -> permanently delete
    if (linkedCount === 0) {
      try {
        await tx.user.delete({ where: { id: existing.id } });
        await appendAuditLogTx(tx, {
          ...actor,
          actionType: "حذف مستخدم نهائياً",
          entityReference: `User:${existing.id}`,
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
          guardReason: "NONE",
          message: "تم حذف المستخدم نهائياً وتحرير مقعد الترخيص بنجاح",
        };
      } catch (delErr: unknown) {
        // Unexpected Foreign Key violation -> fall back safely to auto-archive
        console.warn("[UserLifecycle] Foreign key constraint caught on user delete, falling back to archive:", delErr);
        await tx.user.update({
          where: { id: existing.id },
          data: {
            active: false,
            isActive: false,
            archivedAt: existing.archivedAt ?? new Date(),
          },
        });
        return {
          ok: true,
          status: 200,
          deleted: false,
          archived: true,
          seatsReleased,
          linkedCount: 1,
          guardReason: "LINKED_RECORDS",
          guidance: "تم تحويل الإجراء تلقائياً إلى الأرشفة مع تحرير مقعد الترخيص لحماية القيود. يمكنك إيقافه (إيقاف) أو استعادته لاحقاً.",
          message: `تعذر الحذف النهائي لوجود سجلات مرتبطة بالمستخدم (${existing.displayName || existing.name}). تم تحويل الإجراء تلقائياً إلى الأرشفة مع تحرير مقعد الترخيص لحماية تكامل البيانات. يمكنك إيقافه (إيقاف) أو استعادته لاحقاً.`,
        };
      }
    }

    // 6. Linked accounting/audit records exist -> soft-archive
    await tx.user.update({
      where: { id: existing.id },
      data: {
        active: false,
        isActive: false,
        archivedAt: existing.archivedAt ?? new Date(),
      },
    });

    await appendAuditLogTx(tx, {
      ...actor,
      actionType: "أرشفة تلقائية لمستخدم مرتبط بقيود محاسبية",
      entityReference: `User:${existing.id}`,
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
      guardReason: "LINKED_RECORDS",
      guidance: "يوصى بإبقاء الحساب مؤرشفاً أو استخدام خيار إيقاف الحساب (إيقاف) لمنع تسجيل دخوله دون التأثير على القيود المحاسبية.",
      message: `تمت أرشفة المستخدم تلقائياً (${existing.displayName || existing.name}) مع تحرير مقعد الترخيص لوجود ${linkedCount} سجل محاسبي وتدقيقي مرتبط به حفاظاً على سلامة القيود والدفاتر. يوصى بإبقاء السجل مؤرشفاً أو استخدام خيار الإيقاف (إيقاف).`,
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

  const cleanTarget = (targetUserId || "").trim();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({
      where: {
        OR: [
          { id: cleanTarget },
          { email: cleanTarget.toLowerCase() },
          { username: cleanTarget },
          { username: cleanTarget.toLowerCase() },
          { name: cleanTarget },
        ],
      },
    });

    if (!existing) {
      return {
        ok: false,
        status: 404,
        message: `المستخدم غير موجود (${cleanTarget})`,
        error: `المستخدم غير موجود (${cleanTarget}) / User not found`,
      };
    }

    if (action === "archive") {
      if (existing.id === actor.userId || cleanTarget === actor.userId) {
        return {
          ok: false,
          status: 400,
          code: "CANNOT_ARCHIVE_OWN_ACCOUNT",
          message: "لا يمكن أرشفة حسابك الشخصي المسجل به حالياً",
          error: "لا يمكن أرشفة حسابك الشخصي المسجل به حالياً / Cannot archive your own active admin account",
        };
      }

      // Check last admin protection
      if (existing.role === "SUPER_ADMIN") {
        const activeAdminsCount = await tx.user.count({
          where: {
            role: "SUPER_ADMIN",
            active: true,
            isActive: true,
            archivedAt: null,
          },
        });
        if (activeAdminsCount <= 1 && existing.active && existing.isActive && !existing.archivedAt) {
          return {
            ok: false,
            status: 400,
            code: "LAST_ADMIN_PROTECTED",
            message: "لا يمكن أرشفة المشرف العام الوحيد المتبقي في المنشأة. يرجى إضافة مشرف عام بديل أولاً.",
            error: "Cannot archive the last active SUPER_ADMIN",
          };
        }
      }

      const seatsReleased = await releaseSeatsByEmailTx(tx, existing.email);
      await tx.user.update({
        where: { id: existing.id },
        data: {
          active: false,
          isActive: false,
          archivedAt: new Date(),
        },
      });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "أرشفة مستخدم",
        entityReference: `User:${existing.id}`,
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
      where: { id: existing.id },
      data: {
        active: true,
        isActive: true,
        archivedAt: null,
      },
    });
    await appendAuditLogTx(tx, {
      ...actor,
      actionType: "استعادة مستخدم مؤرشف",
      entityReference: `User:${existing.id}`,
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

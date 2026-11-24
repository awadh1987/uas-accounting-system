import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { canManageUsers, normalizeRole } from "@/lib/permissions";
import { appendAuditLogTx, hashPassword } from "@/lib/serverBootstrap";
import { emitNotification } from "@/lib/notifications/notificationService";
import { authorizeApiAction, forbiddenError } from "@/lib/apiHelpers";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { recordUserSessionRevocation } from "@/lib/controlPanel/governanceStore";
import { attachSessionCookie, issueSessionToken } from "@/lib/authSession";

function sanitizeResetErrorDetail(error: unknown): string {
  if (!error || typeof error !== "object") return "خطأ غير متوقع في الخادم";
  const errObj = error as { code?: string; message?: string };
  if (errObj.code === "P2025") return "تعذر العثور على سجل المستخدم لتحديثه";
  if (errObj.code === "P2002") return "تعارض في بيانات المستخدم";
  const msg = String(errObj.message || "").trim();
  if (!msg) return "خطأ غير متوقع في الخادم";
  // Strip any connection strings or credentials before returning to client
  return msg
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL]")
    .replace(/scrypt\$[^\s"']+/gi, "[REDACTED]")
    .slice(0, 180);
}

export const POST = withTenantRoute(async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }

    const { id } = await context.params;
    const cleanId = decodeURIComponent(id).trim();
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "edit",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    if (!canManageUsers(actor.user || actor.userRole)) {
      return forbiddenError("⛔ إعادة تعيين كلمات المرور محصورة بمدير النظام العام");
    }

    const newPassword = String(body.newPassword || "").trim();
    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json(
        {
          error: "يجب أن تتكون كلمة المرور الجديدة من 6 أحرف/أرقام على الأقل",
          guidance: "أدخل كلمة مرور قوية تحتوي على 6 خانات على الأقل تتضمن أحرفاً وأرقاماً.",
          code: "PASSWORD_TOO_SHORT",
        },
        { status: 400 }
      );
    }

    const mustChangePassword =
      body.mustChangePassword === false || body.mustChangePassword === "false" ? false : true;

    const targetEmail = String(body.targetUserEmail || body.email || "").trim().toLowerCase();
    const targetUserId = String(body.targetUserId || "").trim();

    // Normalize lookup: search by exact id, email (case-insensitive), username (case-insensitive), or name
    const lookupConditions: Array<Record<string, unknown>> = [
      { id: cleanId },
      { email: cleanId.toLowerCase() },
      { username: cleanId },
      { username: cleanId.toLowerCase() },
      { name: cleanId },
      { fullName: cleanId },
    ];
    if (targetEmail) {
      lookupConditions.push({ email: targetEmail });
    }
    if (targetUserId && targetUserId !== cleanId) {
      lookupConditions.push({ id: targetUserId });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: lookupConditions,
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          error: `المستخدم غير موجود (${cleanId}) في المنشأة المحددة`,
          guidance: "تأكد من وجود المستخدم ضمن نفس الشركة أو المنشأة المحددة، أو تحقق من دقة المعرف/البريد الإلكتروني.",
          code: "USER_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(newPassword),
          mustChangePassword,
          passwordUpdatedAt: now,
        },
      });

      await appendAuditLogTx(tx, {
        userId: actor.userId,
        userDisplay: actor.userDisplay,
        userRole: actor.userRole,
        actionType: "إعادة تعيين كلمة مرور مستخدم",
        entityReference: `User:${user.id}`,
        details: `تمت إعادة تعيين كلمة مرور المستخدم ${user.displayName || user.name} (${normalizeRole(user.role)}) بنجاح. إلزام التغيير: ${mustChangePassword ? "نعم" : "لا"}`,
      });
    });

    // Emit notification outside the transaction so a non-fatal notification error never aborts the DB commit
    await emitNotification({
      eventType: "PASSWORD_RESET",
      channel: "security",
      severity: "WARNING",
      titleAr: `تمت إعادة تعيين كلمة مرور (${user.displayName || user.name})`,
      titleEn: `Password Reset (${user.displayName || user.name})`,
      messageAr: `قام ${actor.userDisplay} بإعادة تعيين كلمة المرور (${mustChangePassword ? "مع إلزام التغيير عند الدخول" : "دون إلزام التغيير"}).`,
      messageEn: `${actor.userDisplay} reset the user password (change required: ${mustChangePassword}).`,
      targetTab: "system",
      targetEntityType: "User",
      targetEntityId: user.id,
      recipientUserId: user.id,
      actorUserId: actor.userId,
    });

    // Invalidate all previously issued sessions/tokens for this user across the tenant
    const activeTenantId = getActiveTenantId();
    const isSelfReset = actor.userId === user.id;
    let refreshedSessionToken: string | undefined;
    try {
      recordUserSessionRevocation(activeTenantId, user.id, {
        revokedBeforeMs: isSelfReset ? now.getTime() - 1 : now.getTime(),
        blockSignIn: false,
        reason: "PASSWORD_RESET",
        updatedBy: actor.userDisplay,
      });
      if (isSelfReset) {
        const normalizedRole = normalizeRole(user.role);
        refreshedSessionToken = issueSessionToken({
          userId: user.id,
          userRole: normalizedRole,
          tenantId: activeTenantId,
          userDisplay: `${user.displayName || user.name} (${normalizedRole})`,
        });
      }
    } catch (revErr) {
      console.warn("[ResetPassword] Non-fatal notice recording session revocation:", revErr);
    }

    const res = NextResponse.json({
      success: true,
      message: `تمت إعادة تعيين كلمة مرور ${user.displayName || user.name} بنجاح`,
      mustChangePassword,
      passwordUpdatedAt: now.toISOString(),
      ...(refreshedSessionToken ? { sessionToken: refreshedSessionToken } : {}),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        mustChangePassword,
      },
    });
    if (refreshedSessionToken) {
      attachSessionCookie(res, refreshedSessionToken);
    }
    return res;
  } catch (error) {
    console.error("POST /api/users/[id]/reset-password error:", error);
    const detail = sanitizeResetErrorDetail(error);
    return NextResponse.json(
      {
        error: `تعذر إعادة تعيين كلمة المرور: ${detail}`,
        message: `تعذر إعادة تعيين كلمة المرور: ${detail}`,
        code: "PASSWORD_RESET_FAILED",
      },
      { status: 500 }
    );
  }
});

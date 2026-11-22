import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { forbiddenError, jsonError, resolveVerifiedActor, unauthorizedError } from "@/lib/apiHelpers";
import { appendAuditLogTx, hashPassword, verifyPassword } from "@/lib/serverBootstrap";
import { normalizeRole } from "@/lib/permissions";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = await resolveVerifiedActor(body, req);
    if (actor.spoofAttempt) {
      return forbiddenError("⛔ رفض أمني: عدم تطابق الصلاحية المرسلة");
    }
    if (actor.inactive) {
      return forbiddenError("الحساب موقوف. يرجى التواصل مع الإدارة");
    }
    if (!actor.authenticated || !actor.userId) {
      return unauthorizedError("غير مصرح: يرجى تسجيل الدخول أولاً");
    }

    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = body.confirmPassword !== undefined ? String(body.confirmPassword) : "";

    if (!currentPassword) {
      return jsonError("يرجى إدخال كلمة المرور الحالية", 400);
    }
    if (!newPassword || newPassword.length < 6) {
      return jsonError("يجب أن تتكون كلمة المرور الجديدة من 6 خانات على الأقل", 400);
    }
    if (confirmPassword && confirmPassword !== newPassword) {
      return jsonError("كلمة المرور الجديدة وتأكيدها غير متطابقين", 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
    });

    if (!user) {
      return jsonError("المستخدم غير موجود", 404);
    }

    if (user.active === false || user.isActive === false) {
      return forbiddenError("الحساب موقوف. يرجى التواصل مع الإدارة");
    }

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return jsonError("كلمة المرور الحالية غير صحيحة", 400);
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(newPassword),
          mustChangePassword: false,
          passwordUpdatedAt: now,
        },
      });

      await appendAuditLogTx(tx, {
        userId: user.id,
        userDisplay: `${user.displayName || user.name} (${normalizeRole(user.role)})`,
        userRole: user.role,
        actionType: "تغيير كلمة المرور الشخصية",
        entityReference: `User:${user.id}`,
        details: "تم تغيير كلمة المرور الذاتية بنجاح وتحديث تاريخ التغيير",
      });
    });

    return NextResponse.json({
      success: true,
      message: "تم تغيير كلمة المرور بنجاح",
      passwordUpdatedAt: now.toISOString(),
      mustChangePassword: false,
    });
  } catch (error) {
    console.error("POST /api/users/me/password error:", error);
    return jsonError("تعذر تغيير كلمة المرور", 500);
  }
});


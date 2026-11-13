import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractActor, jsonError, forbiddenError } from "@/lib/apiHelpers";
import { appendAuditLogTx, hashPassword } from "@/lib/serverBootstrap";
import { normalizeRole } from "@/lib/permissions";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body, req);
    if (!actor.userId) {
      return jsonError("غير مصرح: لم يتم تحديد المستخدم", 401);
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

    if (user.passwordHash !== hashPassword(currentPassword)) {
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
}


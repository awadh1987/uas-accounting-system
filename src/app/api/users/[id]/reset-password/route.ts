import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageUsers, normalizeRole } from "@/lib/permissions";
import { appendAuditLogTx, hashPassword } from "@/lib/serverBootstrap";
import { extractActor, forbiddenError, jsonError } from "@/lib/apiHelpers";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body, req);

    if (!canManageUsers(actor.userRole)) {
      return forbiddenError("⛔ إعادة تعيين كلمات المرور محصورة بمدير النظام العام");
    }

    const newPassword = String(body.newPassword || "").trim();
    if (!newPassword || newPassword.length < 6) {
      return jsonError("يجب أن تتكون كلمة المرور الجديدة من 6 أحرف/أرقام على الأقل", 400);
    }

    const mustChangePassword =
      body.mustChangePassword !== undefined ? Boolean(body.mustChangePassword) : true;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return jsonError("المستخدم غير موجود", 404);
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
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
        entityReference: `User:${id}`,
        details: `تمت إعادة تعيين كلمة مرور المستخدم ${user.displayName || user.name} (${normalizeRole(user.role)}) بنجاح. إلزام التغيير: ${mustChangePassword ? "نعم" : "لا"}`,
      });
    });

    return NextResponse.json({
      success: true,
      message: `تمت إعادة تعيين كلمة مرور ${user.displayName || user.name} بنجاح`,
      mustChangePassword,
      passwordUpdatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/users/[id]/reset-password error:", error);
    return jsonError("تعذر إعادة تعيين كلمة المرور", 500);
  }
}


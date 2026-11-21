import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { canManageUsers, normalizeRole } from "@/lib/permissions";
import { appendAuditLogTx, hashPassword } from "@/lib/serverBootstrap";
import { extractActor, forbiddenError, jsonError } from "@/lib/apiHelpers";

export const POST = withTenantRoute(async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const cleanId = decodeURIComponent(id).trim();
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

    // Normalize lookup: search by exact id, email (case-insensitive), username (case-insensitive), or name
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: cleanId },
          { email: cleanId.toLowerCase() },
          { username: cleanId },
          { username: cleanId.toLowerCase() },
          { name: cleanId },
          { fullName: cleanId },
        ],
      },
    });

    if (!user) {
      return jsonError(`المستخدم غير موجود (${cleanId}) في المنشأة المحددة`, 404);
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

    return NextResponse.json({
      success: true,
      message: `تمت إعادة تعيين كلمة مرور ${user.displayName || user.name} بنجاح`,
      mustChangePassword,
      passwordUpdatedAt: now.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("POST /api/users/[id]/reset-password error:", error);
    return jsonError("تعذر إعادة تعيين كلمة المرور", 500);
  }
});

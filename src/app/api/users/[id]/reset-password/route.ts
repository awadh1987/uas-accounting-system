import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { canManageUsers, normalizeRole } from "@/lib/permissions";
import { appendAuditLogTx, hashPassword } from "@/lib/serverBootstrap";
import { extractActor, forbiddenError } from "@/lib/apiHelpers";

export const POST = withTenantRoute(async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const cleanId = decodeURIComponent(id).trim();
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const actor = extractActor(body, req);

    if (!canManageUsers(actor.userRole)) {
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
      body.mustChangePassword !== undefined ? Boolean(body.mustChangePassword) : true;

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
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: `تعذر إعادة تعيين كلمة المرور: ${detail}`,
        message: `تعذر إعادة تعيين كلمة المرور: ${detail}`,
      },
      { status: 500 }
    );
  }
});

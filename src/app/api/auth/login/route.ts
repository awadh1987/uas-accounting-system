import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, hashPassword, parseAssignedProjects } from "@/lib/serverBootstrap";
import { jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const userId = String(body.userId || "").trim();
    const password = String(body.password || "");

    if (!userId || !password) {
      return jsonError("يرجى اختيار المستخدم وإدخال كلمة المرور", 400);
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) {
      return jsonError("الحساب غير موجود أو موقوف", 403);
    }

    if (user.passwordHash !== hashPassword(password)) {
      return jsonError("كلمة المرور غير صحيحة", 401);
    }

    await prisma.$transaction(async (tx) => {
      await appendAuditLogTx(tx, {
        userId: user.id,
        userDisplay: `${user.name} (${user.role})`,
        userRole: user.role,
        actionType: "تسجيل دخول",
        entityReference: user.id,
        details: `تم تسجيل الدخول بنجاح بحساب ${user.name}`,
      });
    });

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        active: user.active,
        avatarChar: user.avatarChar,
        assignedProjects: parseAssignedProjects(user.assignedProjects),
      },
    });
  } catch (error) {
    console.error("POST /api/auth/login error:", error);
    return jsonError("تعذر تسجيل الدخول", 500);
  }
}

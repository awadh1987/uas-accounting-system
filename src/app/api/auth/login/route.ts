import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import {
  authenticateAndBuildSessionTx,
  verifyPassword,
} from "@/lib/serverBootstrap";
import { attachSessionCookie } from "@/lib/authSession";
import { jsonError } from "@/lib/apiHelpers";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const body = (await req.json()) as Record<string, unknown>;
    const userId = String(body.userId || "").trim();
    const identifier = String(body.identifier || body.email || body.username || "").trim();
    const password = String(body.password || "");

    if ((!userId && !identifier) || !password) {
      return jsonError("يرجى إدخال اسم المستخدم أو البريد الإلكتروني وكلمة المرور", 400);
    }

    const cleanId = identifier.trim();
    const user = userId
      ? await prisma.user.findFirst({
          where: {
            OR: [
              { id: userId },
              { email: userId.toLowerCase() },
              { username: userId },
              { username: userId.toLowerCase() },
              { name: userId },
            ],
          },
        })
      : await prisma.user.findFirst({
          where: {
            OR: [
              { id: cleanId },
              { email: cleanId.toLowerCase() },
              { username: cleanId },
              { username: cleanId.toLowerCase() },
              { name: cleanId },
            ],
          },
        });

    if (!user) {
      return jsonError("اسم المستخدم أو البريد الإلكتروني غير صحيح", 404);
    }

    if (user.active === false || user.isActive === false) {
      return NextResponse.json(
        {
          error: "الحساب موقوف. يرجى مراجعة مدير النظام العام",
          code: "ACCOUNT_SUSPENDED",
        },
        { status: 403 }
      );
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return jsonError("كلمة المرور غير صحيحة", 401);
    }

    const activeTenantId = getActiveTenantId();
    const sessionData = await authenticateAndBuildSessionTx(user, activeTenantId, {
      plainPassword: password,
    });

    const response = NextResponse.json(sessionData, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      },
    });
    attachSessionCookie(response, sessionData.sessionToken);
    return response;
  } catch (error) {
    console.error("POST /api/auth/login error:", error);
    return jsonError("تعذر تسجيل الدخول", 500);
  }
});

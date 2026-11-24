import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { forbiddenError, jsonError, resolveVerifiedActor, unauthorizedError } from "@/lib/apiHelpers";
import { appendAuditLogTx, hashPassword, parseAssignedProjects, verifyPassword } from "@/lib/serverBootstrap";
import { normalizeRole } from "@/lib/permissions";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { recordUserSessionRevocation } from "@/lib/controlPanel/governanceStore";
import { attachSessionCookie, issueSessionToken } from "@/lib/authSession";
import type { UasUser } from "@/types/uas";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }

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
    const newPassword = String(body.newPassword || "").trim();
    const confirmPassword = body.confirmPassword !== undefined ? String(body.confirmPassword).trim() : "";

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

    if (user.mustChangePassword && newPassword === currentPassword) {
      return jsonError("يجب أن تختلف كلمة المرور الجديدة عن كلمة المرور المؤقتة الحالية", 400);
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const savedUser = await tx.user.update({
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
        actionType: user.mustChangePassword
          ? "تغيير كلمة المرور الإلزامي عند الدخول"
          : "تغيير كلمة المرور الشخصية",
        entityReference: `User:${user.id}`,
        details: user.mustChangePassword
          ? "تم تعيين كلمة مرور جديدة دائمة وإزالة إلزام التغيير بنجاح"
          : "تم تغيير كلمة المرور الذاتية بنجاح وتحديث تاريخ التغيير",
      });

      return savedUser;
    });

    const activeTenantId = getActiveTenantId();
    const normalizedRole = normalizeRole(updated.role);
    try {
      recordUserSessionRevocation(activeTenantId, updated.id, {
        revokedBeforeMs: now.getTime() - 1,
        blockSignIn: false,
        reason: "PASSWORD_CHANGED",
        updatedBy: `${updated.displayName || updated.name} (${normalizedRole})`,
      });
    } catch (revErr) {
      console.warn("[ChangePassword] Non-fatal notice recording session revocation:", revErr);
    }

    const sessionToken = issueSessionToken({
      userId: updated.id,
      userRole: normalizedRole,
      tenantId: activeTenantId,
      userDisplay: `${updated.displayName || updated.name} (${normalizedRole})`,
    });

    let customAllowedGroups: string[] = [];
    try {
      if (updated.customAllowedGroups) {
        const p = JSON.parse(updated.customAllowedGroups);
        if (Array.isArray(p)) customAllowedGroups = p.map(String);
      }
    } catch {
      customAllowedGroups = [];
    }

    let customPermissionsJson: Record<string, boolean> = {};
    try {
      if (updated.customPermissionsJson) {
        const p = JSON.parse(updated.customPermissionsJson);
        if (p && typeof p === "object") customPermissionsJson = p;
      }
    } catch {
      customPermissionsJson = {};
    }

    const mappedUser: UasUser = {
      id: updated.id,
      username: updated.username,
      name: updated.name,
      fullName: updated.fullName,
      displayName: updated.displayName ?? "",
      phone: updated.phone ?? "",
      email: updated.email,
      role: updated.role,
      department: updated.department,
      active: updated.active && (updated.isActive ?? true),
      isActive: updated.isActive ?? updated.active,
      archivedAt: updated.archivedAt ? updated.archivedAt.toISOString() : null,
      avatarChar: updated.avatarChar,
      avatarUrl: updated.avatarUrl ?? "",
      avatarColor: updated.avatarColor ?? "#059669",
      preferredLang: updated.preferredLang ?? "ar",
      preferredCurrency: updated.preferredCurrency ?? "YER",
      preferredTheme: updated.preferredTheme ?? "emerald",
      defaultModule: updated.defaultModule ?? "",
      lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
      useCustomPermissions: Boolean(updated.useCustomPermissions),
      customAllowedGroups,
      customPermissionsJson,
      mustChangePassword: false,
      passwordUpdatedAt: now.toISOString(),
      assignedProjects: parseAssignedProjects(updated.assignedProjects),
    };

    const res = NextResponse.json({
      success: true,
      message: "تم تغيير كلمة المرور بنجاح",
      passwordUpdatedAt: now.toISOString(),
      mustChangePassword: false,
      sessionToken,
      user: mappedUser,
    });
    attachSessionCookie(res, sessionToken);
    return res;
  } catch (error) {
    console.error("POST /api/users/me/password error:", error);
    return jsonError("تعذر تغيير كلمة المرور", 500);
  }
});


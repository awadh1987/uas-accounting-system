import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import {
  appendAuditLogTx,
  hashPassword,
  isLegacySha256Hash,
  parseAssignedProjects,
  verifyPassword,
} from "@/lib/serverBootstrap";
import { attachSessionCookie, issueSessionToken } from "@/lib/authSession";
import { jsonError } from "@/lib/apiHelpers";
import {
  canApprove,
  canCreate,
  canDeleteVoid,
  canEdit,
  canEditDate,
  canLockPeriod,
  canManageLandingCms,
  canManageTreasury,
  canManageUsers,
  canPostLedger,
  getAccessibleGroups,
  getAccessibleTabs,
  isReadOnly,
  normalizeRole,
} from "@/lib/permissions";
import type { UasUser } from "@/types/uas";

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

    const now = new Date();
    const shouldUpgradeHash = isLegacySha256Hash(user.passwordHash);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: now,
          ...(shouldUpgradeHash ? { passwordHash: hashPassword(password), passwordUpdatedAt: now } : {}),
        },
      });

      await appendAuditLogTx(tx, {
        userId: user.id,
        userDisplay: `${user.displayName || user.name} (${normalizeRole(user.role)})`,
        userRole: user.role,
        actionType: "تسجيل دخول",
        entityReference: user.id,
        details: `تم تسجيل الدخول بنجاح بحساب ${user.displayName || user.name}`,
      });
    });

    let customAllowedGroups: string[] = [];
    try {
      if (user.customAllowedGroups) {
        const parsed = JSON.parse(user.customAllowedGroups);
        if (Array.isArray(parsed)) customAllowedGroups = parsed.map(String);
      }
    } catch {
      customAllowedGroups = [];
    }

    let customPermissionsJson: Record<string, boolean> = {};
    try {
      if (user.customPermissionsJson) {
        const parsed = JSON.parse(user.customPermissionsJson);
        if (parsed && typeof parsed === "object") customPermissionsJson = parsed;
      }
    } catch {
      customPermissionsJson = {};
    }

    const uasUser: UasUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      fullName: user.fullName,
      displayName: user.displayName ?? "",
      phone: user.phone ?? "",
      email: user.email,
      role: user.role,
      department: user.department,
      active: user.active && (user.isActive ?? true),
      isActive: user.isActive ?? user.active,
      avatarChar: user.avatarChar,
      avatarUrl: user.avatarUrl ?? "",
      avatarColor: user.avatarColor ?? "#059669",
      preferredLang: user.preferredLang ?? "ar",
      preferredCurrency: user.preferredCurrency ?? "YER",
      preferredTheme: user.preferredTheme ?? "emerald",
      defaultModule: user.defaultModule ?? "",
      lastLoginAt: now.toISOString(),
      useCustomPermissions: Boolean(user.useCustomPermissions),
      customAllowedGroups,
      customPermissionsJson,
      mustChangePassword: Boolean(user.mustChangePassword),
      passwordUpdatedAt: user.passwordUpdatedAt ? user.passwordUpdatedAt.toISOString() : null,
      assignedProjects: parseAssignedProjects(user.assignedProjects),
    };

    const normalizedUserRole = normalizeRole(user.role);
    const activeTenantId = getActiveTenantId();
    const sessionToken = issueSessionToken({
      userId: user.id,
      userRole: normalizedUserRole,
      tenantId: activeTenantId,
      userDisplay: `${user.displayName || user.name} (${normalizedUserRole})`,
    });

    const response = NextResponse.json(
      {
        user: uasUser,
        sessionToken,
        preferences: {
          preferredLang: uasUser.preferredLang,
          preferredCurrency: uasUser.preferredCurrency,
          preferredTheme: uasUser.preferredTheme,
          defaultModule: uasUser.defaultModule,
        },
        mustChangePassword: uasUser.mustChangePassword,
        tenantId: activeTenantId,
        permissions: {
          allowedGroups: getAccessibleGroups(uasUser),
          accessibleTabs: getAccessibleTabs(uasUser),
          canCreate: canCreate(uasUser),
          canEdit: canEdit(uasUser),
          canEditDate: canEditDate(uasUser),
          canDeleteVoid: canDeleteVoid(uasUser),
          canApprove: canApprove(uasUser),
          canPostLedger: canPostLedger(uasUser),
          canManageTreasury: canManageTreasury(uasUser),
          canManageLandingCms: canManageLandingCms(uasUser),
          canLockPeriod: canLockPeriod(uasUser),
          canManageUsers: canManageUsers(uasUser),
          isReadOnly: isReadOnly(uasUser),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        },
      }
    );
    attachSessionCookie(response, sessionToken);
    return response;
  } catch (error) {
    console.error("POST /api/auth/login error:", error);
    return jsonError("تعذر تسجيل الدخول", 500);
  }
});

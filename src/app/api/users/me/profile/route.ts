import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractActor, jsonError, forbiddenError } from "@/lib/apiHelpers";
import { appendAuditLogTx, getBootstrapState, parseAssignedProjects } from "@/lib/serverBootstrap";
import { getAccessibleGroups, getAccessibleTabs, normalizeRole } from "@/lib/permissions";
import type { UasUser } from "@/types/uas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const actor = extractActor({}, req);
    if (!actor.userId) {
      return jsonError("غير مصرح: لم يتم تحديد المستخدم", 401);
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
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      useCustomPermissions: Boolean(user.useCustomPermissions),
      customAllowedGroups,
      customPermissionsJson,
      mustChangePassword: Boolean(user.mustChangePassword),
      passwordUpdatedAt: user.passwordUpdatedAt ? user.passwordUpdatedAt.toISOString() : null,
      assignedProjects: parseAssignedProjects(user.assignedProjects),
    };

    return NextResponse.json({
      user: uasUser,
      permissions: {
        allowedGroups: getAccessibleGroups(uasUser),
        accessibleTabs: getAccessibleTabs(uasUser),
      },
    });
  } catch (error) {
    console.error("GET /api/users/me/profile error:", error);
    return jsonError("تعذر استرجاع الملف الشخصي", 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body, req);
    if (!actor.userId) {
      return jsonError("غير مصرح: لم يتم تحديد المستخدم", 401);
    }

    const existing = await prisma.user.findUnique({
      where: { id: actor.userId },
    });

    if (!existing) {
      return jsonError("المستخدم غير موجود", 404);
    }

    if (existing.active === false || existing.isActive === false) {
      return forbiddenError("الحساب موقوف. يرجى التواصل مع الإدارة");
    }

    const nextDisplayName =
      body.displayName !== undefined
        ? String(body.displayName).trim()
        : existing.displayName;
    const nextPhone =
      body.phone !== undefined ? String(body.phone).trim() : existing.phone;
    const nextEmail =
      body.email !== undefined ? String(body.email).trim().toLowerCase() : existing.email;
    const nextAvatarUrl =
      body.avatarUrl !== undefined
        ? String(body.avatarUrl).trim()
        : existing.avatarUrl;
    const nextAvatarColor =
      body.avatarColor !== undefined
        ? String(body.avatarColor).trim()
        : existing.avatarColor;
    const nextAvatarChar =
      body.avatarChar !== undefined
        ? String(body.avatarChar).trim().slice(0, 2)
        : existing.avatarChar;
    const nextPreferredLang =
      body.preferredLang === "en" ? "en" : body.preferredLang === "ar" ? "ar" : existing.preferredLang;
    const nextPreferredCurrency =
      body.preferredCurrency === "SAR" || body.preferredCurrency === "USD"
        ? body.preferredCurrency
        : body.preferredCurrency === "YER"
        ? "YER"
        : existing.preferredCurrency;
    const nextPreferredTheme =
      body.preferredTheme === "dark" || body.preferredTheme === "royal"
        ? body.preferredTheme
        : body.preferredTheme === "emerald"
        ? "emerald"
        : existing.preferredTheme;
    const nextDefaultModule =
      body.defaultModule !== undefined
        ? String(body.defaultModule).trim()
        : existing.defaultModule;

    // Validate email uniqueness if changed
    if (nextEmail && nextEmail !== existing.email) {
      const emailConflict = await prisma.user.findUnique({ where: { email: nextEmail } });
      if (emailConflict && emailConflict.id !== existing.id) {
        return jsonError("البريد الإلكتروني مستخدم بالفعل من قبل مستخدم آخر", 409);
      }
    }

    const beforeSnapshot = {
      displayName: existing.displayName,
      phone: existing.phone,
      email: existing.email,
      avatarColor: existing.avatarColor,
      avatarUrl: existing.avatarUrl,
      preferredLang: existing.preferredLang,
      preferredCurrency: existing.preferredCurrency,
      preferredTheme: existing.preferredTheme,
      defaultModule: existing.defaultModule,
    };

    const afterSnapshot = {
      displayName: nextDisplayName,
      phone: nextPhone,
      email: nextEmail,
      avatarColor: nextAvatarColor,
      avatarUrl: nextAvatarUrl,
      preferredLang: nextPreferredLang,
      preferredCurrency: nextPreferredCurrency,
      preferredTheme: nextPreferredTheme,
      defaultModule: nextDefaultModule,
    };

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of Object.keys(afterSnapshot) as Array<keyof typeof afterSnapshot>) {
      if (beforeSnapshot[key] !== afterSnapshot[key]) {
        diff[key] = { before: beforeSnapshot[key], after: afterSnapshot[key] };
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: existing.id },
        data: {
          displayName: nextDisplayName,
          phone: nextPhone,
          email: nextEmail,
          avatarUrl: nextAvatarUrl,
          avatarColor: nextAvatarColor,
          avatarChar: nextAvatarChar,
          preferredLang: nextPreferredLang,
          preferredCurrency: nextPreferredCurrency,
          preferredTheme: nextPreferredTheme,
          defaultModule: nextDefaultModule,
        },
      });

      await appendAuditLogTx(tx, {
        userId: existing.id,
        userDisplay: `${nextDisplayName || existing.name} (${normalizeRole(existing.role)})`,
        userRole: existing.role,
        actionType: "تحديث الملف الشخصي الذاتي",
        entityReference: `User:${existing.id}`,
        details: JSON.stringify({ diff }),
      });

      return user;
    });

    let customAllowedGroups: string[] = [];
    try {
      if (updated.customAllowedGroups) {
        const parsed = JSON.parse(updated.customAllowedGroups);
        if (Array.isArray(parsed)) customAllowedGroups = parsed.map(String);
      }
    } catch {
      customAllowedGroups = [];
    }

    let customPermissionsJson: Record<string, boolean> = {};
    try {
      if (updated.customPermissionsJson) {
        const parsed = JSON.parse(updated.customPermissionsJson);
        if (parsed && typeof parsed === "object") customPermissionsJson = parsed;
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
      mustChangePassword: Boolean(updated.mustChangePassword),
      passwordUpdatedAt: updated.passwordUpdatedAt ? updated.passwordUpdatedAt.toISOString() : null,
      assignedProjects: parseAssignedProjects(updated.assignedProjects),
    };

    const state = await getBootstrapState();

    return NextResponse.json({
      user: mappedUser,
      permissions: {
        allowedGroups: getAccessibleGroups(mappedUser),
        accessibleTabs: getAccessibleTabs(mappedUser),
      },
      diff,
      state,
    });
  } catch (error) {
    console.error("PATCH /api/users/me/profile error:", error);
    return jsonError("تعذر تحديث الملف الشخصي", 500);
  }
}


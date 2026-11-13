import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageUsers, normalizeRole } from "@/lib/permissions";
import { appendAuditLogTx, getBootstrapState, hashPassword, parseAssignedProjects } from "@/lib/serverBootstrap";
import { extractActor, forbiddenError, jsonError } from "@/lib/apiHelpers";
import type { UasUser } from "@/types/uas";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body, req);

    if (!canManageUsers(actor.userRole)) {
      return forbiddenError("⛔ إدارة صلاحيات وحسابات المستخدمين محصورة بمدير النظام العام");
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) return { notFound: true as const };

      const toggleActive = body.toggleActive === true;
      const nextActive = toggleActive
        ? !(existing.active && existing.isActive)
        : typeof body.isActive === "boolean"
        ? body.isActive
        : typeof body.active === "boolean"
        ? body.active
        : existing.active;

      const nextName = body.name ? String(body.name).trim() : existing.name;
      const nextDisplayName =
        body.displayName !== undefined ? String(body.displayName).trim() : existing.displayName;
      const nextPhone =
        body.phone !== undefined ? String(body.phone).trim() : existing.phone;
      const nextEmail =
        body.email !== undefined ? String(body.email).trim().toLowerCase() : existing.email;
      const nextAvatar = body.avatarChar
        ? String(body.avatarChar).trim().slice(0, 2)
        : existing.avatarChar;
      const nextAvatarColor =
        body.avatarColor !== undefined ? String(body.avatarColor).trim() : existing.avatarColor;
      const nextRole = body.role ? normalizeRole(String(body.role)) : existing.role;
      const nextDepartment = body.department !== undefined
        ? String(body.department).trim()
        : existing.department;
      const nextAssigned = Array.isArray(body.assignedProjects)
        ? JSON.stringify(body.assignedProjects.map(String))
        : existing.assignedProjects;

      const nextUseCustom =
        typeof body.useCustomPermissions === "boolean"
          ? body.useCustomPermissions
          : existing.useCustomPermissions;

      const nextCustomAllowed =
        Array.isArray(body.customAllowedGroups)
          ? JSON.stringify(body.customAllowedGroups)
          : typeof body.customAllowedGroups === "string"
          ? body.customAllowedGroups
          : existing.customAllowedGroups;

      const nextCustomPerms =
        typeof body.customPermissionsJson === "object" && body.customPermissionsJson !== null
          ? JSON.stringify(body.customPermissionsJson)
          : typeof body.customPermissionsJson === "string"
          ? body.customPermissionsJson
          : existing.customPermissionsJson;

      const nextMustChangePass =
        typeof body.mustChangePassword === "boolean"
          ? body.mustChangePassword
          : existing.mustChangePassword;

      const newPassword = body.newPassword ? String(body.newPassword) : "";

      const beforeSnapshot = {
        role: existing.role,
        department: existing.department,
        active: existing.active && existing.isActive,
        useCustomPermissions: existing.useCustomPermissions,
        customAllowedGroups: existing.customAllowedGroups,
        customPermissionsJson: existing.customPermissionsJson,
        assignedProjects: existing.assignedProjects,
      };

      const afterSnapshot = {
        role: nextRole,
        department: nextDepartment,
        active: nextActive,
        useCustomPermissions: nextUseCustom,
        customAllowedGroups: nextCustomAllowed,
        customPermissionsJson: nextCustomPerms,
        assignedProjects: nextAssigned,
      };

      const diff: Record<string, { before: unknown; after: unknown }> = {};
      for (const key of Object.keys(afterSnapshot) as Array<keyof typeof afterSnapshot>) {
        if (beforeSnapshot[key] !== afterSnapshot[key]) {
          diff[key] = { before: beforeSnapshot[key], after: afterSnapshot[key] };
        }
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          active: nextActive,
          isActive: nextActive,
          name: nextName,
          displayName: nextDisplayName,
          phone: nextPhone,
          email: nextEmail,
          avatarChar: nextAvatar,
          avatarColor: nextAvatarColor,
          role: nextRole,
          department: nextDepartment,
          assignedProjects: nextAssigned,
          useCustomPermissions: nextUseCustom,
          customAllowedGroups: nextCustomAllowed,
          customPermissionsJson: nextCustomPerms,
          mustChangePassword: nextMustChangePass,
          ...(newPassword ? { passwordHash: hashPassword(newPassword), passwordUpdatedAt: new Date() } : {}),
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: toggleActive
          ? "تغيير حالة مستخدم"
          : body.useCustomPermissions !== undefined
          ? "تعديل صلاحيات مخصصة لمستخدم"
          : "تحديث حساب مستخدم",
        entityReference: `User:${id}`,
        details: JSON.stringify({
          targetUser: updated.displayName || updated.name,
          diff,
        }),
      });

      let parsedAllowed: string[] = [];
      try {
        if (updated.customAllowedGroups) {
          const p = JSON.parse(updated.customAllowedGroups);
          if (Array.isArray(p)) parsedAllowed = p.map(String);
        }
      } catch {
        parsedAllowed = [];
      }

      let parsedPerms: Record<string, boolean> = {};
      try {
        if (updated.customPermissionsJson) {
          const p = JSON.parse(updated.customPermissionsJson);
          if (p && typeof p === "object") parsedPerms = p;
        }
      } catch {
        parsedPerms = {};
      }

      const mapped: UasUser = {
        id: updated.id,
        username: updated.username,
        name: updated.name,
        fullName: updated.fullName,
        displayName: updated.displayName ?? "",
        phone: updated.phone ?? "",
        email: updated.email,
        role: updated.role,
        department: updated.department,
        active: updated.active && updated.isActive,
        isActive: updated.isActive && updated.active,
        avatarChar: updated.avatarChar,
        avatarUrl: updated.avatarUrl ?? "",
        avatarColor: updated.avatarColor ?? "#059669",
        preferredLang: updated.preferredLang ?? "ar",
        preferredCurrency: updated.preferredCurrency ?? "YER",
        preferredTheme: updated.preferredTheme ?? "emerald",
        defaultModule: updated.defaultModule ?? "",
        lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
        useCustomPermissions: updated.useCustomPermissions,
        customAllowedGroups: parsedAllowed,
        customPermissionsJson: parsedPerms,
        mustChangePassword: updated.mustChangePassword,
        passwordUpdatedAt: updated.passwordUpdatedAt ? updated.passwordUpdatedAt.toISOString() : null,
        assignedProjects: parseAssignedProjects(updated.assignedProjects),
      };

      return {
        notFound: false as const,
        updated: mapped,
        diff,
      };
    });

    if (result.notFound) return jsonError("المستخدم غير موجود", 404);

    const state = await getBootstrapState();
    return NextResponse.json({ user: result.updated, diff: result.diff, state });
  } catch (error) {
    console.error("PATCH /api/users/[id] error:", error);
    return jsonError("تعذر تحديث بيانات وصلاحيات المستخدم", 500);
  }
}



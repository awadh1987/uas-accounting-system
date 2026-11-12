import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";
import { appendAuditLogTx, getBootstrapState, hashPassword, parseAssignedProjects } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { id } });
      if (!existing) return { notFound: true as const };

      const toggleActive = body.toggleActive === true;
      const nextActive = toggleActive
        ? !existing.active
        : typeof body.active === "boolean"
        ? body.active
        : existing.active;
      const nextName = body.name ? String(body.name).trim() : existing.name;
      const nextAvatar = body.avatarChar
        ? String(body.avatarChar).trim().slice(0, 2)
        : existing.avatarChar;
      const nextRole = body.role ? normalizeRole(String(body.role)) : existing.role;
      const nextDepartment = body.department
        ? String(body.department).trim()
        : existing.department;
      const nextAssigned = Array.isArray(body.assignedProjects)
        ? JSON.stringify(body.assignedProjects.map(String))
        : existing.assignedProjects;
      const newPassword = body.newPassword ? String(body.newPassword) : "";

      const updated = await tx.user.update({
        where: { id },
        data: {
          active: nextActive,
          name: nextName,
          avatarChar: nextAvatar,
          role: nextRole,
          department: nextDepartment,
          assignedProjects: nextAssigned,
          ...(newPassword ? { passwordHash: hashPassword(newPassword) } : {}),
        },
        select: {
          id: true,
          username: true,
          name: true,
          fullName: true,
          email: true,
          role: true,
          department: true,
          active: true,
          avatarChar: true,
          assignedProjects: true,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: toggleActive ? "تغيير حالة مستخدم" : "تحديث الملف الشخصي",
        entityReference: id,
        details: `${updated.name} — الحالة: ${updated.active ? "نشط" : "موقوف"}`,
      });

      return {
        notFound: false as const,
        updated: {
          ...updated,
          assignedProjects: parseAssignedProjects(updated.assignedProjects),
        },
      };
    });

    if (result.notFound) return jsonError("المستخدم غير موجود", 404);

    const state = await getBootstrapState();
    return NextResponse.json({ user: result.updated, state });
  } catch (error) {
    console.error("PATCH /api/users/[id] error:", error);
    return jsonError("تعذر تحديث بيانات المستخدم", 500);
  }
}


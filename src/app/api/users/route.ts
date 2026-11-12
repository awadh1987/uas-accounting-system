import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeRole, ROLE_DEFINITIONS } from "@/lib/permissions";
import { appendAuditLogTx, getBootstrapState, hashPassword } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim() || `user-${Date.now()}@uas-ye.com`;
    const role = normalizeRole(String(body.role || "FIELD_ACCOUNTANT").trim());
    const department =
      String(body.department || "").trim() || ROLE_DEFINITIONS[role].departmentAr;
    const password = String(body.password || "123456");
    const assignedProjects = Array.isArray(body.assignedProjects)
      ? JSON.stringify(body.assignedProjects.map(String))
      : JSON.stringify(["p1", "p2", "p3"]);
    const actor = extractActor(body);

    if (!name) {
      return jsonError("يرجى إدخال اسم المستخدم", 400);
    }

    const avatarChar = name.charAt(0) || "م";
    const baseUsername =
      String(body.username || "").trim() ||
      email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_") ||
      `user_${Date.now()}`;

    await prisma.$transaction(async (tx) => {
      const existingEmail = await tx.user.findUnique({ where: { email } });
      const uniqueEmail = existingEmail ? `${Date.now()}-${email}` : email;

      const existingUser = await tx.user.findUnique({ where: { username: baseUsername } });
      const uniqueUsername = existingUser ? `${baseUsername}_${Date.now().toString().slice(-4)}` : baseUsername;

      const user = await tx.user.create({
        data: {
          username: uniqueUsername,
          name,
          fullName: String(body.fullName || `${name} - ${ROLE_DEFINITIONS[role].labelAr}`),
          email: uniqueEmail,
          passwordHash: hashPassword(password),
          role,
          department,
          active: true,
          avatarChar,
          assignedProjects,
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة مستخدم نظام",
        entityReference: user.id,
        details: `${name} (${role})`,
      });
    });

    const state = await getBootstrapState();
    return NextResponse.json({ state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/users error:", error);
    return jsonError("تعذر إضافة المستخدم", 500);
  }
}

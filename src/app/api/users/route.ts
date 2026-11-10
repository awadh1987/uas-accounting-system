import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, getBootstrapState, hashPassword } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim() || `user-${Date.now()}@uas-ye.com`;
    const role = String(body.role || "محاسب رئيسي (Accountant)").trim();
    const password = String(body.password || "123456");
    const actor = extractActor(body);

    if (!name) {
      return jsonError("يرجى إدخال اسم المستخدم", 400);
    }

    const avatarChar = name.charAt(0) || "م";

    await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      const uniqueEmail = existing ? `${Date.now()}-${email}` : email;

      const user = await tx.user.create({
        data: {
          name,
          email: uniqueEmail,
          passwordHash: hashPassword(password),
          role,
          active: true,
          avatarChar,
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


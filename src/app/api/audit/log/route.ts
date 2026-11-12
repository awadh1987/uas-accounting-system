import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function GET() {
  try {
    const diffLogs = await prisma.auditLog.findMany({
      orderBy: { timestamp: "desc" },
      take: 80,
      include: {
        user: {
          select: { id: true, name: true, fullName: true, role: true },
        },
      },
    });
    return NextResponse.json({ diffLogs });
  } catch (error) {
    console.error("GET /api/audit/log error:", error);
    return jsonError("تعذر تحميل سجل تعديلات الحقول", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actionType = String(body.action || "").trim();
    const details = String(body.details || "").trim();
    const entityReference = String(body.entityReference || "system").trim();
    const actor = extractActor(body);

    if (!actionType) {
      return jsonError("نوع الحدث مطلوب", 400);
    }

    await prisma.$transaction(async (tx) => {
      await appendAuditLogTx(tx, {
        ...actor,
        actionType,
        entityReference,
        details,
      });
    });

    const state = await getBootstrapState();
    return NextResponse.json({ state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/audit/log error:", error);
    return jsonError("تعذر توثيق الحدث", 500);
  }
}


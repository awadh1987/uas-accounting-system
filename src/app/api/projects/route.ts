import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

const ORDINAL_HARVESTS = [
  "القطفة الأولى",
  "القطفة الثانية",
  "القطفة الثالثة",
  "القطفة الرابعة",
  "القطفة الخامسة",
];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.name || "").trim();
    const type = String(body.type || "مشروع رئيسي").trim();
    const parentProjectId =
      type === "مشروع فرعي" && body.parentProjectId ? String(body.parentProjectId) : null;
    const estimatedValue = Number(body.estimatedValue) || 0;
    const count = Math.max(1, Math.min(20, Number(body.plannedHarvests) || 1));
    const notes = String(body.notes || "").trim();
    const actor = extractActor(body);

    if (!name) {
      return jsonError("يرجى إدخال اسم المشروع", 400);
    }

    const harvests: string[] = [];
    for (let i = 0; i < count; i++) {
      harvests.push(ORDINAL_HARVESTS[i] || `القطفة ${i + 1}`);
    }

    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name,
          type,
          parentProjectId,
          estimatedValue,
          plannedHarvestCount: count,
          notes,
          harvestCycles: {
            create: harvests.map((hName, idx) => ({
              name: hName,
              sortOrder: idx + 1,
              isLocked: false,
            })),
          },
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إنشاء مشروع",
        entityReference: project.id,
        details: `إضافة مشروع ${name} (${type}) بقيمة ${estimatedValue.toLocaleString("en-US")} ريال`,
      });

      return project;
    });

    const state = await getBootstrapState();
    return NextResponse.json({ createdId: created.id, state }, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects error:", error);
    return jsonError("تعذر إنشاء المشروع", 500);
  }
}


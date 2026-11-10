import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const projectId = String(body.projectId || "").trim();
    const harvestName = String(body.name || "").trim();
    const actor = extractActor(body);

    if (!projectId || !harvestName) {
      return jsonError("يرجى اختيار المشروع وإدخال اسم القطفة/المرشة", 400);
    }

    await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        include: { harvestCycles: true },
      });
      if (!project) {
        throw new Error("PROJECT_NOT_FOUND");
      }

      const existing = project.harvestCycles.find((h) => h.name === harvestName);
      if (!existing) {
        await tx.harvestCycle.create({
          data: {
            projectId,
            name: harvestName,
            sortOrder: project.harvestCycles.length + 1,
            isLocked: false,
          },
        });
        await tx.project.update({
          where: { id: projectId },
          data: { plannedHarvestCount: project.harvestCycles.length + 1 },
        });
        await appendAuditLogTx(tx, {
          ...actor,
          actionType: "إضافة قطفة / مرشة",
          entityReference: projectId,
          details: `إضافة "${harvestName}" إلى مشروع ${project.name}`,
        });
      }
    });

    const state = await getBootstrapState();
    return NextResponse.json({ state }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
      return jsonError("المشروع غير موجود", 404);
    }
    console.error("POST /api/projects/harvests error:", error);
    return jsonError("تعذر إضافة القطفة", 500);
  }
}


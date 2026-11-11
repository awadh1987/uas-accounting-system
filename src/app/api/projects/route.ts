import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateFinancialReports } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

const ORDINAL_HARVESTS = [
  "القطفة الأولى",
  "القطفة الثانية",
  "القطفة الثالثة",
  "القطفة الرابعة",
  "القطفة الخامسة",
];

export async function GET() {
  try {
    const [projects, reports] = await Promise.all([
      prisma.project.findMany({
        orderBy: { code: "asc" },
        include: {
          subProjects: { orderBy: { code: "asc" } },
          harvestCycles: { orderBy: { sortOrder: "asc" } },
        },
      }),
      generateFinancialReports(),
    ]);

    const breakdownByProj = new Map(
      reports.incomeStatement.projectBreakdown.map((b) => [b.projectId, b])
    );

    return NextResponse.json({
      projects: projects.map((p) => {
        const metrics = breakdownByProj.get(p.id);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          nameAr: p.nameAr,
          nameEn: p.nameEn,
          type: p.type,
          parentProjectId: p.parentProjectId,
          budgetTotal: Number(p.budgetTotal) || p.estimatedValue,
          estimatedValue: p.estimatedValue,
          status: p.status,
          notes: p.notes,
          startDate: p.startDate ? p.startDate.toISOString() : null,
          endDate: p.endDate ? p.endDate.toISOString() : null,
          subProjects: p.subProjects.map((sp) => ({
            id: sp.id,
            code: sp.code,
            nameAr: sp.nameAr,
            nameEn: sp.nameEn,
            budget: Number(sp.budget),
          })),
          harvestCycles: p.harvestCycles.map((hc) => ({
            id: hc.id,
            cycleNumber: hc.cycleNumber,
            name: hc.name,
            sortOrder: hc.sortOrder,
            isLocked: hc.isLocked,
            lockedAt: hc.lockedAt ? hc.lockedAt.toISOString() : null,
          })),
          metrics: metrics || {
            revenue: 0,
            actualCost: 0,
            netProfit: 0,
            variance: Number(p.budgetTotal) || p.estimatedValue,
            utilizationPct: 0,
            isOverBudget: false,
          },
        };
      }),
    });
  } catch (error) {
    console.error("GET /api/projects error:", error);
    return jsonError("تعذر تحميل المشاريع", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = String(body.nameAr || body.name || "").trim();
    const nameEn = String(body.nameEn || name).trim();
    const type = String(body.type || "مشروع رئيسي").trim();
    const parentProjectId =
      type === "مشروع فرعي" && body.parentProjectId ? String(body.parentProjectId) : null;
    const budgetTotal = Number(body.budgetTotal ?? body.estimatedValue) || 0;
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

    const existingCount = await prisma.project.count();
    const code =
      String(body.code || "").trim() || `PRJ-${String(existingCount + 1).padStart(3, "0")}`;

    const created = await prisma.$transaction(async (tx) => {
      const uniqueCode = (await tx.project.findUnique({ where: { code } }))
        ? `${code}-${Date.now().toString().slice(-3)}`
        : code;

      const project = await tx.project.create({
        data: {
          code: uniqueCode,
          name,
          nameAr: name,
          nameEn,
          type,
          parentProjectId,
          budgetTotal,
          estimatedValue: budgetTotal,
          plannedHarvestCount: count,
          status: String(body.status || "ACTIVE"),
          notes,
          harvestCycles: {
            create: harvests.map((hName, idx) => ({
              cycleNumber: idx + 1,
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
        details: `إضافة مشروع ${name} (${uniqueCode}) بموازنة ${budgetTotal.toLocaleString("en-US")} ريال`,
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

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || "").trim();
    const projectId = String(body.projectId || "").trim();

    if (action === "ADD_SUBPROJECT") {
      const nameAr = String(body.nameAr || "").trim();
      const nameEn = String(body.nameEn || nameAr).trim();
      const budget = Number(body.budget) || 0;
      if (!projectId || !nameAr) {
        return jsonError("يرجى تحديد المشروع الرئيسي واسم القطاع الفرعي", 400);
      }
      const existingSubs = await prisma.subProject.count({ where: { projectId } });
      const code =
        String(body.code || "").trim() || `SUB-${String(existingSubs + 1).padStart(2, "0")}`;

      const sub = await prisma.subProject.create({
        data: {
          projectId,
          code,
          nameAr,
          nameEn,
          budget,
        },
      });
      const state = await getBootstrapState();
      return NextResponse.json({ subProject: sub, state }, { status: 201 });
    }

    if (action === "UPDATE_BUDGET") {
      const budgetTotal = Number(body.budgetTotal);
      if (!projectId || !Number.isFinite(budgetTotal) || budgetTotal < 0) {
        return jsonError("قيمة الموازنة غير صالحة", 400);
      }
      await prisma.project.update({
        where: { id: projectId },
        data: {
          budgetTotal,
          estimatedValue: budgetTotal,
          ...(body.status ? { status: String(body.status) } : {}),
        },
      });
      const state = await getBootstrapState();
      return NextResponse.json({ state });
    }

    return jsonError("إجراء غير مدعوم", 400);
  } catch (error) {
    console.error("PATCH /api/projects error:", error);
    return jsonError("تعذر تحديث بيانات المشروع", 500);
  }
}

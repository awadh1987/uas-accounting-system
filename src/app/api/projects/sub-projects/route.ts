import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || undefined;

    const subProjects = await prisma.subProject.findMany({
      where: projectId && projectId !== "ALL" ? { projectId } : undefined,
      include: {
        project: {
          select: {
            id: true,
            code: true,
            nameAr: true,
            nameEn: true,
          },
        },
        vendor: {
          select: {
            id: true,
            code: true,
            nameAr: true,
            nameEn: true,
            phone: true,
          },
        },
      },
      orderBy: [{ projectId: "asc" }, { code: "asc" }],
    });

    // Compute actual spend, revenue, net profit, and remaining budget from posted journal lines
    const postedLines = await prisma.journalEntryLine.findMany({
      where: {
        subProjectId: { in: subProjects.map((sp) => sp.id) },
        journalEntry: { status: "POSTED" },
      },
      include: {
        account: {
          select: { type: true, code: true },
        },
      },
    });

    const enriched = subProjects.map((sp) => {
      const spLines = postedLines.filter((l) => l.subProjectId === sp.id);
      const revenue = Math.round(
        spLines
          .filter((l) => l.account.type === "REVENUE")
          .reduce(
            (sum, l) => sum + Number(l.creditBase) - Number(l.debitBase),
            0,
          ) * 100,
      ) / 100;
      const actualSpend = Math.round(
        spLines
          .filter((l) => l.account.type === "EXPENSE")
          .reduce(
            (sum, l) => sum + Number(l.debitBase) - Number(l.creditBase),
            0,
          ) * 100,
      ) / 100;
      const budget = Number(sp.budget) || 0;
      const remainingBudget = Math.round((budget - actualSpend) * 100) / 100;
      const netProfit = Math.round((revenue - actualSpend) * 100) / 100;

      return {
        id: sp.id,
        projectId: sp.projectId,
        projectCode: sp.project.code,
        projectNameAr: sp.project.nameAr,
        projectNameEn: sp.project.nameEn,
        code: sp.code,
        nameAr: sp.nameAr,
        nameEn: sp.nameEn,
        budget,
        status: sp.status,
        notes: sp.notes,
        vendorId: sp.vendorId,
        vendorName: sp.vendor?.nameAr ?? null,
        vendorPhone: sp.vendor?.phone ?? null,
        actualSpend,
        revenue,
        netProfit,
        remainingBudget,
        createdAt: sp.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ subProjects: enriched });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر جلب القطاعات والمشاريع الفرعية";
    return jsonError(msg, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "projects",
      action: "create",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const projectId = String(body.projectId || "").trim();
    const nameAr = String(body.nameAr || "").trim();
    const nameEn = String(body.nameEn || nameAr).trim();
    const budget = Number(body.budget) || 0;
    const status = String(body.status || "ACTIVE").trim().toUpperCase();
    const notes = String(body.notes || "").trim();
    const vendorId = body.vendorId ? String(body.vendorId).trim() : null;

    if (!projectId) {
      return jsonError("يرجى تحديد المشروع الرئيسي التابع له القطاع", 400);
    }
    if (!nameAr) {
      return jsonError("يرجى كتابة اسم القطاع الفرعي بالعربية", 400);
    }

    const parentProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, code: true, nameAr: true },
    });
    if (!parentProject) {
      return jsonError("المشروع الرئيسي المحدد غير موجود", 404);
    }

    let code = String(body.code || "").trim();
    if (!code) {
      const count = await prisma.subProject.count({
        where: { projectId },
      });
      code = `SUB-${String(count + 1).padStart(2, "0")}`;
    }

    // Verify code uniqueness per project
    const existingCode = await prisma.subProject.findUnique({
      where: { projectId_code: { projectId, code } },
    });
    if (existingCode) {
      code = `${code}-${Date.now().toString().slice(-3)}`;
    }

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.subProject.create({
        data: {
          projectId,
          code,
          nameAr,
          nameEn,
          budget,
          status,
          notes,
          vendorId,
        },
        include: {
          project: { select: { id: true, code: true, nameAr: true } },
          vendor: { select: { id: true, nameAr: true } },
        },
      });

      await appendAuditLogTx(tx, {
        userId: actor.userId,
        userDisplay: actor.userDisplay,
        userRole: actor.userRole,
        actionType: "إضافة قطاع فرعي",
        entityReference: `SubProject:${created.id}`,
        details: `إنشاء قطاع فرعي: ${code} - ${nameAr} بموازنة ${budget.toLocaleString("en-US")} ريال تحت مشروع ${parentProject.nameAr}`,
      });

      return created;
    });

    const state = await getBootstrapState();
    return NextResponse.json({ subProject: result, state }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إنشاء القطاع الفرعي";
    return jsonError(msg, 500);
  }
}

async function handleSubProjectUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "projects",
      action: "edit",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف القطاع الفرعي مطلوب", 400);

    const existing = await prisma.subProject.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, code: true, nameAr: true } },
        vendor: { select: { id: true, nameAr: true } },
      },
    });
    if (!existing) return jsonError("القطاع الفرعي غير موجود", 404);

    const nextProjectId = body.projectId !== undefined ? String(body.projectId).trim() : existing.projectId;
    const nextCode = body.code !== undefined ? String(body.code).trim() : existing.code;
    const nextNameAr = body.nameAr !== undefined ? String(body.nameAr).trim() : existing.nameAr;
    const nextNameEn = body.nameEn !== undefined ? String(body.nameEn).trim() : existing.nameEn;
    const nextBudget = body.budget !== undefined ? Number(body.budget) || 0 : Number(existing.budget);
    const nextStatus = body.status !== undefined ? String(body.status).trim().toUpperCase() : existing.status;
    const nextNotes = body.notes !== undefined ? String(body.notes).trim() : existing.notes;
    const nextVendorId = body.vendorId !== undefined ? (body.vendorId ? String(body.vendorId).trim() : null) : existing.vendorId;

    if (!nextNameAr) {
      return jsonError("اسم القطاع الفرعي مطلوب", 400);
    }

    // Check code collision if code or projectId changed
    if (nextCode !== existing.code || nextProjectId !== existing.projectId) {
      const conflict = await prisma.subProject.findUnique({
        where: { projectId_code: { projectId: nextProjectId, code: nextCode } },
      });
      if (conflict && conflict.id !== id) {
        return jsonError(`الرمز ${nextCode} مستخدم بالفعل في هذا المشروع`, 400);
      }
    }

    const beforeSnapshot = {
      projectId: existing.projectId,
      code: existing.code,
      nameAr: existing.nameAr,
      nameEn: existing.nameEn,
      budget: Number(existing.budget),
      status: existing.status,
      notes: existing.notes,
      vendorId: existing.vendorId,
    };

    const afterSnapshot = {
      projectId: nextProjectId,
      code: nextCode,
      nameAr: nextNameAr,
      nameEn: nextNameEn,
      budget: nextBudget,
      status: nextStatus,
      notes: nextNotes,
      vendorId: nextVendorId,
    };

    const diff: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of Object.keys(afterSnapshot) as Array<keyof typeof afterSnapshot>) {
      if (beforeSnapshot[key] !== afterSnapshot[key]) {
        diff[key] = { before: beforeSnapshot[key], after: afterSnapshot[key] };
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.subProject.update({
        where: { id },
        data: {
          projectId: nextProjectId,
          code: nextCode,
          nameAr: nextNameAr,
          nameEn: nextNameEn,
          budget: nextBudget,
          status: nextStatus,
          notes: nextNotes,
          vendorId: nextVendorId,
        },
        include: {
          project: { select: { id: true, code: true, nameAr: true } },
          vendor: { select: { id: true, nameAr: true } },
        },
      });

      await appendAuditLogTx(tx, {
        userId: actor.userId,
        userDisplay: actor.userDisplay,
        userRole: actor.userRole,
        actionType: "تعديل قطاع فرعي",
        entityReference: `SubProject:${id}`,
        details: JSON.stringify({
          subProjectCode: nextCode,
          nameAr: nextNameAr,
          diff,
        }),
      });

      return updated;
    });

    const state = await getBootstrapState();
    return NextResponse.json({ subProject: result, diff, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل القطاع الفرعي";
    return jsonError(msg, 500);
  }
}

export async function PATCH(req: NextRequest) {
  return handleSubProjectUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleSubProjectUpdate(req);
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let id = searchParams.get("id") || "";
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
      if (!id && body.id) id = String(body.id).trim();
    } catch {
      // Body may be empty if id in query
    }

    const auth = await authorizeApiAction(body, req, {
      moduleId: "projects",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    if (!id) return jsonError("معرف القطاع الفرعي مطلوب للحذف", 400);

    const existing = await prisma.subProject.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            journalLines: true,
            purchaseOrders: true,
            vendorBills: true,
            expenses: true,
            workerWages: true,
            sales: true,
          },
        },
      },
    });

    if (!existing) return jsonError("القطاع الفرعي غير موجود", 404);

    const totalPostings =
      existing._count.journalLines +
      existing._count.purchaseOrders +
      existing._count.vendorBills +
      existing._count.expenses +
      existing._count.workerWages +
      existing._count.sales;

    const result = await prisma.$transaction(async (tx) => {
      if (totalPostings > 0) {
        // Archive instead of hard delete to preserve historical integrity
        const archived = await tx.subProject.update({
          where: { id },
          data: { status: "ARCHIVED" },
        });

        await appendAuditLogTx(tx, {
          userId: actor.userId,
          userDisplay: actor.userDisplay,
          userRole: actor.userRole,
          actionType: "أرشفة قطاع فرعي",
          entityReference: `SubProject:${id}`,
          details: `أرشفة القطاع ${existing.code} (${existing.nameAr}) لوجود ${totalPostings} عملية وسندات مرتبطة به`,
        });

        return { deleted: false, archived: true, subProject: archived };
      } else {
        await tx.subProject.delete({ where: { id } });

        await appendAuditLogTx(tx, {
          userId: actor.userId,
          userDisplay: actor.userDisplay,
          userRole: actor.userRole,
          actionType: "حذف قطاع فرعي",
          entityReference: `SubProject:${id}`,
          details: `حذف القطاع الفرعي ${existing.code} (${existing.nameAr}) نهائياً لعدم وجود حركات محاسبية مرتبطة به`,
        });

        return { deleted: true, archived: false };
      }
    });

    const state = await getBootstrapState();
    return NextResponse.json({ ...result, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر حذف/أرشفة القطاع الفرعي";
    return jsonError(msg, 500);
  }
}


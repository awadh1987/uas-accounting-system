import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCoaTreeWithBalances,
  recordAuditDiffTx,
} from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId") || undefined;
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;

    const result = await getCoaTreeWithBalances({ projectId, fromDate, toDate });
    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/accounting/coa error:", error);
    return jsonError("تعذر تحميل شجرة الحسابات", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "coa",
      action: "post",
    });
    if (!auth.ok) return auth.response;

    const parentId = String(body.parentId || "").trim();
    const code = String(body.code || "").trim();
    const nameAr = String(body.nameAr || "").trim();
    const nameEn = String(body.nameEn || "").trim() || nameAr;

    if (!parentId || !nameAr) {
      return jsonError("يرجى تحديد الحساب الأب والاسم العربي للحساب", 400);
    }

    const parent = await prisma.account.findUnique({ where: { id: parentId } });
    if (!parent) {
      return jsonError("الحساب الأب غير موجود", 404);
    }
    if (parent.level >= 5) {
      return jsonError("لا يمكن إنشاء حساب فرعي أسفل حساب تفصيلي من المستوى الخامس", 400);
    }

    const level = parent.level + 1;
    const isPosting = level === 5;

    let finalCode = code;
    if (!finalCode) {
      const siblings = await prisma.account.findMany({
        where: { parentId: parent.id },
        select: { code: true },
        orderBy: { code: "desc" },
      });
      const step = level === 2 ? 10000 : level === 3 ? 1000 : level === 4 ? 100 : 1;
      let nextNum = Number(parent.code) + step;
      for (const s of siblings) {
        const val = Number(s.code);
        if (Number.isFinite(val) && val >= nextNum) {
          nextNum = val + (level === 5 ? 1 : step);
        }
      }
      finalCode = String(nextNum);
    }

    const duplicate = await prisma.account.findUnique({ where: { code: finalCode } });
    if (duplicate) {
      return jsonError(`رمز الحساب ${finalCode} مستخدم مسبقاً`, 409);
    }

    const created = await prisma.$transaction(async (tx) => {
      const acc = await tx.account.create({
        data: {
          code: finalCode,
          nameAr,
          nameEn,
          level,
          type: parent.type,
          isPosting,
          parentId: parent.id,
        },
      });
      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "CREATE",
        entity: "Account",
        entityId: acc.id,
        before: null,
        after: { code: acc.code, nameAr: acc.nameAr, level: acc.level },
      });
      return acc;
    });

    const treeData = await getCoaTreeWithBalances();
    return NextResponse.json({ account: created, ...treeData }, { status: 201 });
  } catch (error) {
    console.error("POST /api/accounting/coa error:", error);
    return jsonError("تعذر إنشاء الحساب الفرعي", 500);
  }
}

async function handleCoaUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "coa",
      action: "post",
    });
    if (!auth.ok) return auth.response;

    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف الحساب مطلوب للتعديل", 400);

    const existing = await prisma.account.findUnique({ where: { id } });
    if (!existing) return jsonError("الحساب غير موجود", 404);

    const nextCode = body.code !== undefined ? String(body.code).trim() : existing.code;
    if (nextCode !== existing.code) {
      const duplicate = await prisma.account.findUnique({ where: { code: nextCode } });
      if (duplicate) return jsonError(`رمز الحساب ${nextCode} مستخدم مسبقاً`, 409);
    }

    const nextNameAr = body.nameAr !== undefined ? String(body.nameAr).trim() : existing.nameAr;
    const nextNameEn = body.nameEn !== undefined ? String(body.nameEn).trim() : existing.nameEn;
    if (!nextNameAr) return jsonError("اسم الحساب العربي مطلوب", 400);

    const updated = await prisma.$transaction(async (tx) => {
      const acc = await tx.account.update({
        where: { id },
        data: {
          code: nextCode,
          nameAr: nextNameAr,
          nameEn: nextNameEn || nextNameAr,
        },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "Account",
        entityId: id,
        before: { code: existing.code, nameAr: existing.nameAr, nameEn: existing.nameEn },
        after: { code: acc.code, nameAr: acc.nameAr, nameEn: acc.nameEn },
      });

      return acc;
    });

    const treeData = await getCoaTreeWithBalances();
    return NextResponse.json({ account: updated, ...treeData });
  } catch (error) {
    console.error("PATCH /api/accounting/coa error:", error);
    return jsonError("تعذر تعديل بيانات الحساب", 500);
  }
}

export async function PATCH(req: NextRequest) {
  return handleCoaUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleCoaUpdate(req);
}


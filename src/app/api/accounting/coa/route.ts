import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createHierarchicalAccount,
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

    const parentId = body.parentId ? String(body.parentId).trim() : null;
    const parentCode = body.parentCode ? String(body.parentCode).trim() : null;
    const code = body.code ? String(body.code).trim() : undefined;
    const nameAr = String(body.nameAr || "").trim();
    const nameEn = String(body.nameEn || "").trim() || nameAr;
    const type = body.type ? String(body.type).trim() : undefined;
    const level = body.level ? Number(body.level) : undefined;
    const isPosting = body.isPosting !== undefined ? Boolean(body.isPosting) : undefined;

    if (!nameAr) {
      return jsonError("يرجى إدخال اسم الحساب بالعربية", 400);
    }

    if (!parentId && !parentCode && (!level || level !== 1)) {
      return jsonError("يرجى تحديد الحساب الأب للحسابات من الجيل الثاني إلى السادس", 400);
    }

    const created = await createHierarchicalAccount({
      code,
      nameAr,
      nameEn,
      type,
      level,
      parentId,
      parentCode,
      isPosting,
      userId: auth.actor.userId,
    });

    const treeData = await getCoaTreeWithBalances();
    return NextResponse.json({ account: created, ...treeData }, { status: 201 });
  } catch (error) {
    console.error("POST /api/accounting/coa error:", error);
    const msg = error instanceof Error ? error.message : "تعذر إنشاء الحساب في شجرة الحسابات";
    return jsonError(msg, 400);
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

    const existing = await prisma.account.findUnique({
      where: { id },
      include: {
        children: { select: { id: true } },
      },
    });
    if (!existing) return jsonError("الحساب غير موجود", 404);

    const nextCode = body.code !== undefined ? String(body.code).trim() : existing.code;
    if (nextCode !== existing.code) {
      const duplicate = await prisma.account.findUnique({ where: { code: nextCode } });
      if (duplicate && duplicate.id !== id) {
        return jsonError(`رمز الحساب ${nextCode} مستخدم مسبقاً (${duplicate.nameAr})`, 409);
      }
    }

    const nextNameAr = body.nameAr !== undefined ? String(body.nameAr).trim() : existing.nameAr;
    const nextNameEn = body.nameEn !== undefined ? String(body.nameEn).trim() : existing.nameEn;
    if (!nextNameAr) return jsonError("اسم الحساب العربي مطلوب", 400);

    // If changing isPosting, verify that account with children cannot become a posting leaf
    let nextIsPosting = existing.isPosting;
    if (body.isPosting !== undefined) {
      const reqPosting = Boolean(body.isPosting);
      if (reqPosting && existing.children.length > 0) {
        return jsonError("لا يمكن تحويل حساب تجميعي يمتلك حسابات فرعية إلى حساب ترحيل", 400);
      }
      if (reqPosting && existing.level <= 4) {
        return jsonError("حسابات الأجيال من 1 إلى 4 هي حسابات تجميعية ومراقبة ولا يمكن الترحيل المباشر عليها", 400);
      }
      nextIsPosting = reqPosting;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const acc = await tx.account.update({
        where: { id },
        data: {
          code: nextCode,
          nameAr: nextNameAr,
          nameEn: nextNameEn || nextNameAr,
          isPosting: nextIsPosting,
        },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "Account",
        entityId: id,
        before: {
          code: existing.code,
          nameAr: existing.nameAr,
          nameEn: existing.nameEn,
          isPosting: existing.isPosting,
        },
        after: {
          code: acc.code,
          nameAr: acc.nameAr,
          nameEn: acc.nameEn,
          isPosting: acc.isPosting,
        },
      });

      return acc;
    });

    const treeData = await getCoaTreeWithBalances();
    return NextResponse.json({ account: updated, ...treeData });
  } catch (error) {
    console.error("PATCH /api/accounting/coa error:", error);
    const msg = error instanceof Error ? error.message : "تعذر تعديل بيانات الحساب";
    return jsonError(msg, 500);
  }
}

export async function PATCH(req: NextRequest) {
  return handleCoaUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleCoaUpdate(req);
}


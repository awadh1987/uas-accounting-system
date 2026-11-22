import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { listTaxCodes } from "@/lib/accounting/taxEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;
    const taxCodes = await listTaxCodes();
    return NextResponse.json({ taxCodes });
  } catch (error) {
    console.error("GET /api/accounting/taxes error:", error);
    return jsonError("تعذر تحميل أكواد الضرائب", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { moduleId: "coa", action: "edit" });
    if (!auth.ok) return auth.response;

    const code = String(body.code || "").trim().toUpperCase();
    const nameAr = String(body.nameAr || "").trim();
    const nameEn = String(body.nameEn || nameAr).trim();
    const taxType = String(body.taxType || "VAT").trim().toUpperCase();
    const ratePct = Math.max(0, Number(body.ratePct) || 0);
    const isInclusive = Boolean(body.isInclusive);
    const effectiveFrom = body.effectiveFrom ? new Date(String(body.effectiveFrom)) : new Date();

    if (!code || !nameAr) {
      return jsonError("يرجى إدخال رمز واسم الضريبة", 400);
    }

    const taxCode = await prisma.taxCode.upsert({
      where: { code },
      create: {
        code,
        nameAr,
        nameEn,
        taxType,
        ratePct,
        isInclusive,
        salesTaxAccountCode: body.salesTaxAccountCode ? String(body.salesTaxAccountCode).trim() : "214101",
        purchaseTaxAccountCode: body.purchaseTaxAccountCode ? String(body.purchaseTaxAccountCode).trim() : "114301",
        whtAccountCode: body.whtAccountCode ? String(body.whtAccountCode).trim() : "214201",
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
        rates: {
          create: [{ ratePct, effectiveFrom }],
        },
      },
      update: {
        nameAr,
        nameEn,
        taxType,
        ratePct,
        isInclusive,
        ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        rates: {
          create: [{ ratePct, effectiveFrom }],
        },
      },
      include: { rates: { orderBy: { effectiveFrom: "desc" } } },
    });

    return NextResponse.json({ taxCode }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر حفظ كود الضريبة";
    return jsonError(msg, 400);
  }
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "coa", action: "delete" });
    if (!auth.ok) return auth.response;

    const id = new URL(req.url).searchParams.get("id")?.trim();
    if (!id) return jsonError("معرف الضريبة مطلوب", 400);

    await prisma.taxCode.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعطيل كود الضريبة";
    return jsonError(msg, 400);
  }
});

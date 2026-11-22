import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { DEFAULT_CATEGORIES, slugifyLookupCode } from "@/lib/multiUnitInventoryEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function ensureDefaultCategoriesSeeded() {
  const count = await prisma.itemCategory.count();
  if (count > 0) return;
  for (const c of DEFAULT_CATEGORIES) {
    await prisma.itemCategory.upsert({
      where: { code: c.code },
      update: {},
      create: c,
    });
  }
}

export const GET = withTenantRoute(async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultCategoriesSeeded();
    const categories = await prisma.itemCategory.findMany({
      orderBy: [{ isCustom: "asc" }, { nameAr: "asc" }],
    });
    return NextResponse.json({ categories });
  } catch (error) {
    console.error("GET /api/inventory/categories error:", error);
    return jsonError("تعذر تحميل تصنيفات الأصناف / Failed to load item categories", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultCategoriesSeeded();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "inventory",
      action: "create",
    });
    if (!auth.ok) return auth.response;

    const nameAr = String(body.nameAr || "").trim();
    const nameEn = String(body.nameEn || nameAr).trim();
    if (!nameAr) {
      return jsonError("يرجى إدخال اسم التصنيف / Category name is required.", 400);
    }
    const rawCode = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const code = rawCode || slugifyLookupCode(nameEn || nameAr, "CAT");

    const category = await prisma.itemCategory.upsert({
      where: { code },
      update: { nameAr, nameEn },
      create: {
        code,
        nameAr,
        nameEn,
        parentId: body.parentId ? String(body.parentId) : null,
        isCustom: body.isCustom !== undefined ? Boolean(body.isCustom) : true,
      },
    });
    return NextResponse.json({ success: true, category }, { status: 201 });
  } catch (error) {
    console.error("POST /api/inventory/categories error:", error);
    return jsonError("تعذر حفظ التصنيف / Failed to save item category", 500);
  }
});

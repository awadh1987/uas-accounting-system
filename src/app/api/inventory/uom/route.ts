import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { DEFAULT_UOMS, slugifyLookupCode } from "@/lib/multiUnitInventoryEngine";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function ensureDefaultUomsSeeded() {
  const count = await prisma.unitOfMeasure.count();
  if (count > 0) return;
  for (const u of DEFAULT_UOMS) {
    await prisma.unitOfMeasure.upsert({
      where: { code: u.code },
      update: {},
      create: u,
    });
  }
}

export async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultUomsSeeded();
    const units = await prisma.unitOfMeasure.findMany({
      orderBy: [{ isBaseDefault: "desc" }, { isCustom: "asc" }, { nameAr: "asc" }],
    });
    return NextResponse.json({ units });
  } catch (error) {
    console.error("GET /api/inventory/uom error:", error);
    return jsonError("تعذر تحميل وحدات القياس / Failed to load units of measure", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultUomsSeeded();
    const body = (await req.json()) as Record<string, unknown>;
    const nameAr = String(body.nameAr || body.customUnitLabel || "").trim();
    const nameEn = String(body.nameEn || nameAr).trim();
    if (!nameAr) {
      return jsonError("يرجى إدخال اسم وحدة القياس / Unit name is required.", 400);
    }
    const rawCode = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const code = rawCode || slugifyLookupCode(nameEn || nameAr, "UOM");

    const unit = await prisma.unitOfMeasure.upsert({
      where: { code },
      update: { nameAr, nameEn },
      create: {
        code,
        nameAr,
        nameEn,
        isBaseDefault: Boolean(body.isBaseDefault),
        isCustom: body.isCustom !== undefined ? Boolean(body.isCustom) : true,
      },
    });
    return NextResponse.json({ success: true, unit }, { status: 201 });
  } catch (error) {
    console.error("POST /api/inventory/uom error:", error);
    return jsonError("تعذر حفظ وحدة القياس / Failed to save unit of measure", 500);
  }
}

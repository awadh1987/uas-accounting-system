import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { DEFAULT_WAREHOUSES, slugifyLookupCode } from "@/lib/multiUnitInventoryEngine";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function ensureDefaultWarehousesSeeded() {
  const count = await prisma.warehouse.count();
  if (count > 0) return;
  for (const w of DEFAULT_WAREHOUSES) {
    await prisma.warehouse.upsert({
      where: { code: w.code },
      update: {},
      create: w,
    });
  }
}

export async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultWarehousesSeeded();
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { nameAr: "asc" }],
    });
    return NextResponse.json({ warehouses });
  } catch (error) {
    console.error("GET /api/inventory/warehouses error:", error);
    return jsonError("تعذر تحميل المستودعات / Failed to load warehouses", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultWarehousesSeeded();
    const body = (await req.json()) as Record<string, unknown>;
    const nameAr = String(body.nameAr || "").trim();
    const nameEn = String(body.nameEn || nameAr).trim();
    if (!nameAr) {
      return jsonError("يرجى إدخال اسم المستودع / Warehouse name is required.", 400);
    }
    const rawCode = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const code = rawCode || slugifyLookupCode(nameEn || nameAr, "WH");

    const warehouse = await prisma.warehouse.upsert({
      where: { code },
      update: {
        nameAr,
        nameEn,
        location: body.location !== undefined ? String(body.location) : undefined,
        isActive: true,
      },
      create: {
        code,
        nameAr,
        nameEn,
        location: body.location ? String(body.location) : null,
        isDefault: Boolean(body.isDefault),
        isCustom: body.isCustom !== undefined ? Boolean(body.isCustom) : true,
        isActive: true,
      },
    });
    return NextResponse.json({ success: true, warehouse }, { status: 201 });
  } catch (error) {
    console.error("POST /api/inventory/warehouses error:", error);
    return jsonError("تعذر حفظ المستودع / Failed to save warehouse", 500);
  }
}

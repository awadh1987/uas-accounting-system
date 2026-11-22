import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { DEFAULT_WAREHOUSES, slugifyLookupCode } from "@/lib/multiUnitInventoryEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { provisionEntityGen6AccountAndCostCenter } from "@/lib/accountingCoreEngine";
import { withIdempotency } from "@/lib/idempotencyGuard";
import {
  archiveMasterRecord,
  restoreMasterRecord,
  safeDeleteOrArchiveMasterRecord,
} from "@/lib/masterLifecycle";

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

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultWarehousesSeeded();
    const showArchived = req.nextUrl?.searchParams?.get("includeArchived") === "true";
    const warehouses = await prisma.warehouse.findMany({
      where: showArchived ? {} : { isActive: true },
      orderBy: [{ isDefault: "desc" }, { nameAr: "asc" }],
    });
    return NextResponse.json({ warehouses });
  } catch (error) {
    console.error("GET /api/inventory/warehouses error:", error);
    return jsonError("تعذر تحميل المستودعات / Failed to load warehouses", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      await ensureDefaultWarehousesSeeded();
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "inventory",
        action: "create",
      });
      if (!auth.ok) return auth.response;

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
          archivedAt: null,
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
      // Accounting-Core: every warehouse owns a Gen-6 inventory GL leaf + Cost Center
      const prov = await provisionEntityGen6AccountAndCostCenter({
        entityType: "WAREHOUSE",
        entityId: warehouse.id,
        nameAr: warehouse.nameAr,
        nameEn: warehouse.nameEn,
        costCenterId: warehouse.costCenterId,
      });
      const linked = await prisma.warehouse.findUnique({ where: { id: warehouse.id } });
      return NextResponse.json(
        { success: true, warehouse: linked ?? warehouse, glAccount: prov.account, costCenterId: prov.costCenterId },
        { status: 201 }
      );
    } catch (error) {
      console.error("POST /api/inventory/warehouses error:", error);
      return jsonError("تعذر حفظ المستودع / Failed to save warehouse", 500);
    }
  });
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, {
      moduleId: "inventory",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const id = searchParams.get("id") || String(body.id || "");
    const action = String(body.action || searchParams.get("action") || "SAFE_DELETE").toUpperCase();
    if (!id) return jsonError("معرف المستودع مطلوب / Warehouse id is required", 400);

    const validActor = {
      userId: actor.userId,
      userRole: actor.userRole,
      userDisplay: actor.userDisplay || "مستخدم النظام",
    };

    let result;
    if (action === "ARCHIVE") {
      result = await archiveMasterRecord("Warehouse", id, validActor);
    } else if (action === "RESTORE") {
      result = await restoreMasterRecord("Warehouse", id, validActor);
    } else {
      result = await safeDeleteOrArchiveMasterRecord("Warehouse", id, validActor);
    }

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/inventory/warehouses error:", error);
    return jsonError("تعذر حذف أو أرشفة المستودع", 500);
  }
});

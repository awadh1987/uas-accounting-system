import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { generateEntityOrAccountStatement } from "@/lib/accounting/statutoryReportsEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const rawType = (searchParams.get("entityType") || "ACCOUNT").toUpperCase();
    const entityType =
      rawType === "CUSTOMER" || rawType === "VENDOR" ? rawType : "ACCOUNT";
    const entityId = searchParams.get("entityId")?.trim();
    const fromDate = searchParams.get("fromDate") || undefined;
    const toDate = searchParams.get("toDate") || undefined;

    if (!entityId) {
      const [customers, vendors, accounts] = await Promise.all([
        prisma.customer.findMany({ select: { id: true, code: true, nameAr: true }, orderBy: { nameAr: "asc" } }),
        prisma.vendor.findMany({ select: { id: true, code: true, nameAr: true }, orderBy: { nameAr: "asc" } }),
        prisma.account.findMany({
          where: { isPosting: true },
          select: { id: true, code: true, nameAr: true },
          orderBy: { code: "asc" },
        }),
      ]);
      return NextResponse.json({ customers, vendors, accounts });
    }

    const statement = await generateEntityOrAccountStatement({
      entityType,
      entityId,
      fromDate,
      toDate,
    });
    return NextResponse.json(statement);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر توليد كشف الحساب";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 500);
  }
});

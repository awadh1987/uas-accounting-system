import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  ensurePeriodsForYear,
  listAccountingPeriods,
  runPeriodCloseChecklist,
  updateAccountingPeriodStatus,
  type AccountingPeriodStatus,
} from "@/lib/accounting/periodEngine";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "reports" });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const checklistId = searchParams.get("checklistId");
    if (checklistId) {
      const checklist = await runPeriodCloseChecklist(checklistId);
      return NextResponse.json(checklist);
    }

    const yearParam = searchParams.get("year");
    const fiscalYearId = searchParams.get("fiscalYearId") || undefined;
    const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
    const periods = await listAccountingPeriods({ year, fiscalYearId });
    return NextResponse.json({ periods });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تحميل الفترات المحاسبية";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, { moduleId: "coa", action: "post" });
    if (!auth.ok) return auth.response;

    const action = String(body.action || "SET_STATUS").toUpperCase();
    if (action === "GENERATE_YEAR") {
      const year = Number(body.year) || new Date().getUTCFullYear();
      const fiscalYearId = body.fiscalYearId ? String(body.fiscalYearId).trim() : null;
      const periods = await ensurePeriodsForYear(year, fiscalYearId);
      return NextResponse.json({ periods }, { status: 201 });
    }

    if (action === "CHECKLIST") {
      const periodId = String(body.periodId || "").trim();
      if (!periodId) return jsonError("معرف الفترة مطلوب", 400);
      const checklist = await runPeriodCloseChecklist(periodId);
      return NextResponse.json(checklist);
    }

    const periodId = String(body.periodId || "").trim();
    const nextStatus = String(body.status || "").toUpperCase() as AccountingPeriodStatus;
    if (!periodId || !["OPEN", "SOFT_CLOSED", "HARD_CLOSED"].includes(nextStatus)) {
      return jsonError("يرجى تحديد الفترة والحالة (OPEN | SOFT_CLOSED | HARD_CLOSED)", 400);
    }

    const updated = await updateAccountingPeriodStatus({
      periodId,
      status: nextStatus,
      actorUserId: auth.actor.userId,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
    });
    return NextResponse.json({ period: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تحديث الفترة المحاسبية";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
});

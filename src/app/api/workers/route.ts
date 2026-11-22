import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { computeWorkerWageTotals } from "@/lib/formulas";
import {
  ensureWorkerWithAccountTx,
  postWorkerWageJournalTx,
  updateWorkerWageAtomic,
} from "@/lib/accounting/ledgerService";
import {
  appendAuditLogTx,
  findHarvestCycle,
  getBootstrapState,
  isHarvestLockedTx,
} from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";
import { withIdempotency } from "@/lib/idempotencyGuard";
import {
  archiveMasterRecord,
  restoreMasterRecord,
  safeDeleteOrArchiveMasterRecord,
} from "@/lib/masterLifecycle";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "workers",
        action: "create",
        dateChanged: Boolean(body.date),
      });
      if (!auth.ok) return auth.response;
      const actor = auth.actor;

      const projectId = String(body.projectId || "").trim();
      const subProjectId = body.subProjectId ? String(body.subProjectId).trim() : null;
      const harvestName = String(body.harvest || "").trim();
      const name = String(body.name || "").trim();
      const dailyWage = Number(body.dailyWage) || 0;
      const daysWorked = Number(body.days) || 1;
      const creditAmount = Number(body.credit) || 0;
      const workDate = String(body.date || new Date().toISOString().slice(0, 10));
      const notes = String(body.notes || "").trim();
      const expenseAccountId = body.expenseAccountId ? String(body.expenseAccountId).trim() : null;
      const expenseAccountCode = body.expenseAccountCode ? String(body.expenseAccountCode).trim() : null;
      const customAccount = body.customAccount as { nameAr: string; nameEn?: string; parentCode: string; code?: string } | null | undefined;

      if (!name || !projectId || !harvestName) {
        return jsonError("يرجى إدخال اسم العامل والمشروع والقطفة", 400);
      }

      const { totalWage, debitBalance } = computeWorkerWageTotals(dailyWage, daysWorked, creditAmount);

      const result = await prisma.$transaction(async (tx) => {
        if (await isHarvestLockedTx(tx, projectId, harvestName)) {
          return { locked: true as const };
        }

        const cycle = await findHarvestCycle(tx, projectId, harvestName);
        const worker = await ensureWorkerWithAccountTx(tx, {
          name,
          defaultDailyWage: dailyWage,
          phone: body.phone ? String(body.phone).trim() : "",
          costCenterId: body.costCenterId ? String(body.costCenterId).trim() : undefined,
        });

        const entry = await tx.workerWageEntry.create({
          data: {
            workerId: worker.id,
            workerName: worker.name,
            projectId,
            subProjectId,
            harvestCycleId: cycle?.id ?? null,
            harvestName,
            dailyWage,
            daysWorked,
            totalWage,
            creditAmount,
            debitBalance,
            workDate,
            notes,
          },
        });

        if (worker.accountId) {
          const je = await postWorkerWageJournalTx(tx, {
            wageEntryId: entry.id,
            workerName: worker.name,
            workerAccountId: worker.accountId,
            projectId,
            subProjectId,
            harvestCycleId: cycle?.id ?? null,
            totalWage,
            creditAmount,
            date: workDate,
            expenseAccountId,
            expenseAccountCode,
            customAccount,
            costCenterId: body.costCenterId ? String(body.costCenterId).trim() : worker.costCenterId ?? undefined,
            createdById: actor.userId ?? undefined,
          });
          if (je) {
            await tx.workerWageEntry.update({
              where: { id: entry.id },
              data: { journalEntryId: je.id },
            });
          }
        }

        await appendAuditLogTx(tx, {
          ...actor,
          actionType: "إضافة سجل أجر عامل",
          entityReference: entry.id,
          details: `${name} (${daysWorked} × ${dailyWage} = ${totalWage.toLocaleString("en-US")} ريال، دائن: ${creditAmount.toLocaleString("en-US")})`,
        });

        return { locked: false as const, entry };
      });

      if (result.locked) return lockedError();

      const state = await getBootstrapState();
      return NextResponse.json({ createdId: result.entry.id, state }, { status: 201 });
    } catch (error) {
      console.error("POST /api/workers error:", error);
      return jsonError("تعذر حفظ سجل العامل", 500);
    }
  });
});

async function handleWorkerPatch(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف سجل العامل مطلوب للتعديل", 400);

    const existing = await prisma.workerWageEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("سجل العامل غير موجود", 404);

    const dateChanged =
      body.date !== undefined && String(body.date).trim() !== existing.workDate;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "workers",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const updated = await updateWorkerWageAtomic({
      id,
      projectId: body.projectId ? String(body.projectId) : undefined,
      subProjectId:
        body.subProjectId !== undefined
          ? body.subProjectId
            ? String(body.subProjectId).trim()
            : null
          : undefined,
      harvestName: body.harvest ? String(body.harvest) : undefined,
      name: body.name ? String(body.name) : undefined,
      dailyWage: body.dailyWage !== undefined ? Number(body.dailyWage) : undefined,
      daysWorked: body.days !== undefined ? Number(body.days) : undefined,
      creditAmount: body.credit !== undefined ? Number(body.credit) : undefined,
      date: body.date ? String(body.date) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ workerEntry: updated, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل سجل العامل";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  return handleWorkerPatch(req);
});

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  return handleWorkerPatch(req);
});

export const GET = withTenantRoute(async function GET() {
  try {
    const workers = await prisma.worker.findMany({
      orderBy: { name: "asc" },
      include: {
        account: { select: { id: true, code: true, nameAr: true } },
        wageEntries: { select: { id: true, totalWage: true, creditAmount: true, debitBalance: true } },
      },
    });
    return NextResponse.json({
      workers: workers.map((w) => {
        const totalWages = w.wageEntries.reduce((s, e) => s + (Number(e.totalWage) || 0), 0);
        const totalPaid = w.wageEntries.reduce((s, e) => s + (Number(e.creditAmount) || 0), 0);
        const balanceDue = w.wageEntries.reduce((s, e) => s + (Number(e.debitBalance) || 0), 0);
        return {
          id: w.id,
          name: w.name,
          phone: w.phone,
          defaultDailyWage: Number(w.defaultDailyWage),
          accountId: w.accountId,
          account: w.account,
          costCenterId: w.costCenterId,
          isActive: w.isActive ?? true,
          archivedAt: w.archivedAt ? w.archivedAt.toISOString() : null,
          wageCount: w.wageEntries.length,
          totalWages,
          totalPaid,
          balanceDue,
        };
      }),
    });
  } catch (error) {
    console.error("GET /api/workers error:", error);
    return jsonError("تعذر تحميل قائمة العمال", 500);
  }
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
      moduleId: "workers",
      action: "delete",
    });
    if (!auth.ok) return auth.response;

    const id = searchParams.get("id") || String(body.id || "");
    const action = String(body.action || searchParams.get("action") || "SAFE_DELETE").toUpperCase();
    if (!id) return jsonError("معرف العامل مطلوب للحذف", 400);

    const actor = {
      userId: auth.actor.userId,
      userRole: auth.actor.userRole,
      userDisplay: auth.actor.userDisplay,
    };

    let result;
    if (action === "ARCHIVE") {
      result = await archiveMasterRecord("Worker", id, actor);
    } else if (action === "RESTORE") {
      result = await restoreMasterRecord("Worker", id, actor);
    } else {
      result = await safeDeleteOrArchiveMasterRecord("Worker", id, actor);
    }

    return NextResponse.json(result, { status: result.status });
  } catch (error) {
    console.error("DELETE /api/workers error:", error);
    return jsonError("تعذر حذف أو أرشفة العامل", 500);
  }
});

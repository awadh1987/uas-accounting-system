import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  reverseJournalEntry,
  updateSaleTransactionAtomic,
} from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState, isHarvestLockedTx } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError, lockedError } from "@/lib/apiHelpers";

async function handleSaleByIdUpdate(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const existing = await prisma.saleTransaction.findUnique({ where: { id } });
    if (!existing) return jsonError("عملية البيع غير موجودة", 404);

    const dateChanged =
      body.date !== undefined && String(body.date).trim() !== existing.saleDate;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const updated = await updateSaleTransactionAtomic({
      id,
      projectId: body.projectId ? String(body.projectId) : undefined,
      harvestName: body.harvest ? String(body.harvest) : undefined,
      batch: body.batch ? String(body.batch) : undefined,
      customer: body.customer ? String(body.customer) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      grade: body.grade ? String(body.grade) : undefined,
      bundles: body.bundles !== undefined ? Number(body.bundles) : undefined,
      price: body.price !== undefined ? Number(body.price) : undefined,
      credit: body.credit !== undefined ? Number(body.credit) : undefined,
      date: body.date ? String(body.date) : undefined,
      voucherNo: body.voucherNo ? String(body.voucherNo) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ sale: updated, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تعديل عملية البيع";
    if (msg.includes("HARVEST_LOCKED")) return lockedError();
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleSaleByIdUpdate(req, context);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleSaleByIdUpdate(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const auth = await authorizeApiAction(body, req, {
      moduleId: "sales",
      action: "delete",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const result = await prisma.$transaction(async (tx) => {
      const rec = await tx.saleTransaction.findUnique({ where: { id } });
      if (!rec) return { status: "NOT_FOUND" as const };
      if (await isHarvestLockedTx(tx, rec.projectId, rec.harvestName)) {
        return { status: "LOCKED" as const };
      }
      if (rec.journalEntryId) {
        await reverseJournalEntry({
          journalEntryId: rec.journalEntryId,
          createdById: actor.userId ?? undefined,
          reason: `حذف عملية بيع (${rec.customerName})`,
          tx,
        }).catch(() => null);
      }
      await tx.saleTransaction.delete({ where: { id } });
      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "حذف عملية بيع",
        entityReference: id,
        details: `${rec.customerName} - ${rec.totalAmount.toLocaleString("en-US")} ريال`,
      });
      return { status: "OK" as const };
    });

    if (result.status === "NOT_FOUND") return jsonError("عملية البيع غير موجودة", 404);
    if (result.status === "LOCKED") return lockedError();

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("DELETE /api/sales/[id] error:", error);
    return jsonError("تعذر حذف عملية البيع", 500);
  }
}

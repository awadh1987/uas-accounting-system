import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateAcquisitionBill,
  postOwnerBatchPayment,
  recordAuditDiffTx,
} from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    const acquisitions = await prisma.projectAcquisitionCycle.findMany({
      where: projectId && projectId !== "ALL" ? { projectId } : undefined,
      include: {
        project: {
          select: {
            id: true,
            code: true,
            nameAr: true,
            nameEn: true,
            vendorId: true,
            ownerVendor: {
              select: {
                id: true,
                code: true,
                nameAr: true,
                nameEn: true,
                phone: true,
              },
            },
          },
        },
        purchaseOrders: {
          select: { id: true, poNumber: true, grandTotal: true, status: true },
        },
        vendorBills: {
          select: {
            id: true,
            billNumber: true,
            totalAmount: true,
            paidAmount: true,
            balanceDue: true,
            status: true,
            date: true,
          },
        },
        paymentVouchers: {
          select: {
            id: true,
            voucherNumber: true,
            amount: true,
            transferFee: true,
            currency: true,
            date: true,
            treasuryId: true,
          },
        },
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      acquisitions: acquisitions.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        project: a.project,
        cycleTitle: a.cycleTitle,
        startDate: a.startDate.toISOString().slice(0, 10),
        endDate: a.endDate.toISOString().slice(0, 10),
        contractAmount: Number(a.contractAmount),
        currency: a.currency,
        status: a.status,
        notes: a.notes,
        totalBilled: a.vendorBills.reduce(
          (s, b) => s + Number(b.totalAmount),
          0,
        ),
        totalPaid: a.paymentVouchers.reduce((s, p) => s + Number(p.amount), 0),
        purchaseOrders: a.purchaseOrders.map((p) => ({
          ...p,
          grandTotal: Number(p.grandTotal),
        })),
        vendorBills: a.vendorBills.map((b) => ({
          ...b,
          date: b.date.toISOString().slice(0, 10),
          totalAmount: Number(b.totalAmount),
          paidAmount: Number(b.paidAmount),
          balanceDue: Number(b.balanceDue),
        })),
        paymentVouchers: a.paymentVouchers.map((p) => ({
          ...p,
          date: p.date.toISOString().slice(0, 10),
          amount: Number(p.amount),
          transferFee: Number(p.transferFee),
        })),
      })),
    });
  } catch (error) {
    console.error("GET /api/projects/acquisitions error:", error);
    return jsonError("تعذر تحميل دورات الاستحواذ وعقود الملاك", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || "CREATE_CYCLE").trim();

    if (action === "GENERATE_BILL") {
      const auth = await authorizeApiAction(body, req, {
        moduleId: "projects",
        action: "approve",
        dateChanged: Boolean(body.date),
      });
      if (!auth.ok) return auth.response;

      const projectId = String(body.projectId || "").trim();
      const acquisitionCycleId = String(body.acquisitionCycleId || "").trim();
      if (!projectId || !acquisitionCycleId) {
        return jsonError("يرجى تحديد المشروع ودورة الاستحواذ", 400);
      }

      const customAccount =
        body.customAccount && typeof body.customAccount === "object"
          ? (body.customAccount as { nameAr: string; nameEn?: string; parentCode: string; code?: string })
          : undefined;

      const result = await generateAcquisitionBill({
        projectId,
        subProjectId: body.subProjectId ? String(body.subProjectId).trim() : undefined,
        acquisitionCycleId,
        vendorId: body.vendorId ? String(body.vendorId) : undefined,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        currency: body.currency ? String(body.currency) : undefined,
        date: body.date ? String(body.date) : new Date(),
        dueDate: body.dueDate ? String(body.dueDate) : undefined,
        capitalizeAsset: Boolean(body.capitalizeAsset),
        debitAccountId: body.debitAccountId ? String(body.debitAccountId).trim() : undefined,
        debitAccountCode: body.debitAccountCode
          ? String(body.debitAccountCode)
          : undefined,
        customAccount,
        notes: body.notes ? String(body.notes) : undefined,
        createdById: auth.actor.userId ?? undefined,
      });

      const state = await getBootstrapState();
      return NextResponse.json({ ...result, state }, { status: 201 });
    }

    if (action === "BATCH_PAYMENT") {
      const auth = await authorizeApiAction(body, req, {
        moduleId: "projects",
        action: "treasury",
        dateChanged: Boolean(body.date),
      });
      if (!auth.ok) return auth.response;

      const projectId = String(body.projectId || "").trim();
      const treasuryId = String(body.treasuryId || "").trim();
      const amount = Number(body.amount) || 0;
      if (!projectId || !treasuryId || amount <= 0) {
        return jsonError("يرجى تحديد المشروع والخزينة ومبلغ الدفعة", 400);
      }

      const result = await postOwnerBatchPayment({
        projectId,
        acquisitionCycleId: body.acquisitionCycleId
          ? String(body.acquisitionCycleId)
          : null,
        vendorId: body.vendorId ? String(body.vendorId) : undefined,
        billId: body.billId ? String(body.billId) : null,
        treasuryId,
        amount,
        transferFee:
          body.transferFee !== undefined ? Number(body.transferFee) : 0,
        currency: body.currency ? String(body.currency) : undefined,
        date: body.date ? String(body.date) : new Date(),
        referenceNumber: body.referenceNumber
          ? String(body.referenceNumber)
          : undefined,
        notes: body.notes ? String(body.notes) : undefined,
        createdById: auth.actor.userId ?? undefined,
      });

      const state = await getBootstrapState();
      return NextResponse.json(
        { payment: result.voucher, journalEntry: result.journalEntry, state },
        { status: 201 },
      );
    }

    // Default: CREATE_CYCLE
    const auth = await authorizeApiAction(body, req, {
      moduleId: "projects",
      action: "create",
    });
    if (!auth.ok) return auth.response;

    const projectId = String(body.projectId || "").trim();
    const cycleTitle = String(body.cycleTitle || "").trim();
    const startDate = String(body.startDate || "").trim();
    const endDate = String(body.endDate || "").trim();
    const contractAmount = Number(body.contractAmount) || 0;
    const currency = String(body.currency || "YER").toUpperCase();
    const status = String(body.status || "ACTIVE").trim();
    const notes = body.notes ? String(body.notes).trim() : null;

    if (
      !projectId ||
      !cycleTitle ||
      !startDate ||
      !endDate ||
      contractAmount <= 0
    ) {
      return jsonError(
        "يرجى إدخال المشروع وعنوان العقد وتواريخ الفترة وقيمة التعاقد",
        400,
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      if (body.vendorId) {
        await tx.project.update({
          where: { id: projectId },
          data: { vendorId: String(body.vendorId) },
        });
      }

      const cycle = await tx.projectAcquisitionCycle.create({
        data: {
          projectId,
          cycleTitle,
          startDate: new Date(`${startDate.slice(0, 10)}T00:00:00Z`),
          endDate: new Date(`${endDate.slice(0, 10)}T23:59:59Z`),
          contractAmount,
          currency,
          status,
          notes,
        },
      });

      await appendAuditLogTx(tx, {
        ...auth.actor,
        actionType: "إضافة عقد/دورة استحواذ مشروع",
        entityReference: cycle.id,
        details: `${cycleTitle} — ${contractAmount.toLocaleString("en-US")} ${currency}`,
      });

      if (body.autoGenerateBill) {
        await generateAcquisitionBill({
          tx,
          projectId,
          acquisitionCycleId: cycle.id,
          vendorId: body.vendorId ? String(body.vendorId) : undefined,
          amount: contractAmount,
          currency,
          date: new Date(`${startDate.slice(0, 10)}T10:00:00Z`),
          dueDate: new Date(`${endDate.slice(0, 10)}T23:59:59Z`),
          capitalizeAsset: Boolean(body.capitalizeAsset),
          createdById: auth.actor.userId ?? undefined,
        });
      }

      return cycle;
    });

    const state = await getBootstrapState();
    return NextResponse.json({ acquisition: created, state }, { status: 201 });
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "تعذر تنفيذ عملية استحواذ المشروع";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

async function handleUpdateCycle(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف دورة الاستحواذ مطلوب", 400);

    const existing = await prisma.projectAcquisitionCycle.findUnique({
      where: { id },
    });
    if (!existing) return jsonError("دورة الاستحواذ غير موجودة", 404);

    const dateChanged =
      (body.startDate !== undefined &&
        String(body.startDate).slice(0, 10) !==
          existing.startDate.toISOString().slice(0, 10)) ||
      (body.endDate !== undefined &&
        String(body.endDate).slice(0, 10) !==
          existing.endDate.toISOString().slice(0, 10));

    const auth = await authorizeApiAction(body, req, {
      moduleId: "projects",
      action: "edit",
      dateChanged,
    });
    if (!auth.ok) return auth.response;

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.projectAcquisitionCycle.update({
        where: { id },
        data: {
          ...(body.cycleTitle !== undefined
            ? { cycleTitle: String(body.cycleTitle).trim() }
            : {}),
          ...(body.startDate !== undefined
            ? {
                startDate: new Date(
                  `${String(body.startDate).slice(0, 10)}T00:00:00Z`,
                ),
              }
            : {}),
          ...(body.endDate !== undefined
            ? {
                endDate: new Date(
                  `${String(body.endDate).slice(0, 10)}T23:59:59Z`,
                ),
              }
            : {}),
          ...(body.contractAmount !== undefined
            ? { contractAmount: Number(body.contractAmount) || 0 }
            : {}),
          ...(body.currency !== undefined
            ? { currency: String(body.currency).toUpperCase() }
            : {}),
          ...(body.status !== undefined
            ? { status: String(body.status).trim() }
            : {}),
          ...(body.notes !== undefined
            ? { notes: body.notes ? String(body.notes).trim() : null }
            : {}),
        },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "ProjectAcquisitionCycle",
        entityId: id,
        before: {
          cycleTitle: existing.cycleTitle,
          startDate: existing.startDate.toISOString().slice(0, 10),
          endDate: existing.endDate.toISOString().slice(0, 10),
          contractAmount: Number(existing.contractAmount),
          status: existing.status,
        },
        after: {
          cycleTitle: next.cycleTitle,
          startDate: next.startDate.toISOString().slice(0, 10),
          endDate: next.endDate.toISOString().slice(0, 10),
          contractAmount: Number(next.contractAmount),
          status: next.status,
        },
      });

      return next;
    });

    const state = await getBootstrapState();
    return NextResponse.json({ acquisition: updated, state });
  } catch (error) {
    console.error("PATCH /api/projects/acquisitions error:", error);
    return jsonError("تعذر تعديل دورة الاستحواذ", 500);
  }
}

export async function PATCH(req: NextRequest) {
  return handleUpdateCycle(req);
}

export async function PUT(req: NextRequest) {
  return handleUpdateCycle(req);
}

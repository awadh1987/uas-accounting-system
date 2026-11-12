import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createTreasuryAccount,
  updateTreasuryAccount,
} from "@/lib/accounting/ledgerService";
import { getBootstrapState } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const treasuries = await prisma.treasuryAccount.findMany({
      orderBy: { id: "asc" },
      include: {
        account: { select: { id: true, code: true, nameAr: true, nameEn: true } },
      },
    });
    return NextResponse.json({
      treasuries: treasuries.map((t) => ({
        ...t,
        balance: Number(t.balance) || 0,
        dailyLimit: Number(t.dailyLimit) || 0,
        accountNo: t.accountNumber,
      })),
    });
  } catch (error) {
    console.error("GET /api/treasury error:", error);
    return jsonError("تعذر تحميل حسابات الخزينة والبنوك", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
      dateChanged: Boolean(body.openingDate),
    });
    if (!auth.ok) return auth.response;

    const type = String(body.type || "VAULT").toUpperCase() as "VAULT" | "BANK" | "WALLET";
    const nameAr = String(body.nameAr || body.name || "").trim();
    if (!nameAr) {
      return jsonError("يرجى إدخال اسم الصندوق أو البنك أو المحفظة", 400);
    }

    const result = await createTreasuryAccount({
      type,
      nameAr,
      nameEn: body.nameEn ? String(body.nameEn) : undefined,
      currency: body.currencyCode ? String(body.currencyCode) : body.currency ? String(body.currency) : "YER",
      providerNameAr: body.providerNameAr ? String(body.providerNameAr) : undefined,
      providerNameEn: body.providerNameEn ? String(body.providerNameEn) : undefined,
      accountHolderName: body.accountHolderName ? String(body.accountHolderName) : undefined,
      accountNumber: body.accountNumber ? String(body.accountNumber) : body.accountNo ? String(body.accountNo) : undefined,
      ibanOrSwift: body.ibanOrSwift ? String(body.ibanOrSwift) : undefined,
      branchOrAgent: body.branchOrAgent ? String(body.branchOrAgent) : undefined,
      transferFeePercent: body.transferFeePercent !== undefined ? Number(body.transferFeePercent) : 0,
      dailyLimit: body.dailyLimit !== undefined ? Number(body.dailyLimit) : 0,
      openingBalance: body.openingBalance !== undefined ? Number(body.openingBalance) : 0,
      openingDate: body.openingDate ? String(body.openingDate) : undefined,
      isDefaultReceipts: Boolean(body.isDefaultReceipts),
      isDefaultPayments: Boolean(body.isDefaultPayments),
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      notes: body.notes ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json(
      { treasury: result.treasury, journalEntry: result.journalEntry, state },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر إنشاء حساب الخزينة";
    return jsonError(msg, 400);
  }
}

async function handleUpdate(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
    });
    if (!auth.ok) return auth.response;

    const id = String(body.id || "").trim();
    if (!id) return jsonError("معرف حساب الخزينة مطلوب للتحديث", 400);

    const updated = await updateTreasuryAccount({
      id,
      type: body.type ? (String(body.type).toUpperCase() as "VAULT" | "BANK" | "WALLET") : undefined,
      nameAr: body.nameAr !== undefined ? String(body.nameAr) : undefined,
      nameEn: body.nameEn !== undefined ? String(body.nameEn) : undefined,
      providerNameAr: body.providerNameAr !== undefined ? String(body.providerNameAr) : undefined,
      providerNameEn: body.providerNameEn !== undefined ? String(body.providerNameEn) : undefined,
      accountHolderName: body.accountHolderName !== undefined ? String(body.accountHolderName) : undefined,
      accountNumber:
        body.accountNumber !== undefined
          ? String(body.accountNumber)
          : body.accountNo !== undefined
          ? String(body.accountNo)
          : undefined,
      ibanOrSwift: body.ibanOrSwift !== undefined ? String(body.ibanOrSwift) : undefined,
      branchOrAgent: body.branchOrAgent !== undefined ? String(body.branchOrAgent) : undefined,
      transferFeePercent:
        body.transferFeePercent !== undefined ? Number(body.transferFeePercent) : undefined,
      dailyLimit: body.dailyLimit !== undefined ? Number(body.dailyLimit) : undefined,
      isDefaultReceipts:
        body.isDefaultReceipts !== undefined ? Boolean(body.isDefaultReceipts) : undefined,
      isDefaultPayments:
        body.isDefaultPayments !== undefined ? Boolean(body.isDefaultPayments) : undefined,
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ treasury: updated, state });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تحديث حساب الخزينة";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function PATCH(req: NextRequest) {
  return handleUpdate(req);
}

export async function PUT(req: NextRequest) {
  return handleUpdate(req);
}


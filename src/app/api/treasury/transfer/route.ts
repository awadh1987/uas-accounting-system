import { NextRequest, NextResponse } from "next/server";
import { transferBetweenTreasuries } from "@/lib/accounting/ledgerService";
import { getBootstrapState } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
      dateChanged: Boolean(body.date),
    });
    if (!auth.ok) return auth.response;

    const fromTreasuryId = String(body.fromTreasuryId || "").trim();
    const toTreasuryId = String(body.toTreasuryId || "").trim();
    const amount = Number(body.amount) || 0;

    if (!fromTreasuryId || !toTreasuryId || amount <= 0) {
      return jsonError("يرجى تحديد حساب المصدر والوجهة وإدخال مبلغ التحويل", 400);
    }

    const result = await transferBetweenTreasuries({
      fromTreasuryId,
      toTreasuryId,
      amount,
      feeAmount: body.feeAmount !== undefined ? Number(body.feeAmount) : undefined,
      applyDefaultFee: Boolean(body.applyDefaultFee),
      exchangeRateOverride:
        body.exchangeRateOverride !== undefined ? Number(body.exchangeRateOverride) : undefined,
      date: body.date ? String(body.date) : new Date(),
      reference: body.reference ? String(body.reference) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    const state = await getBootstrapState();
    return NextResponse.json({ ...result, state }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تنفيذ التحويل المالي";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}


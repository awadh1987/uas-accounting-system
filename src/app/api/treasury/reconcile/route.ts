import { NextRequest, NextResponse } from "next/server";
import {
  getTreasuryLedgerAndReconcile,
  reconcileTreasuryAccount,
} from "@/lib/accounting/ledgerService";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const treasuryId = searchParams.get("treasuryId")?.trim();
    if (!treasuryId) {
      return jsonError("يرجى تحديد معرف الخزينة للمطابقة", 400);
    }
    const data = await getTreasuryLedgerAndReconcile(treasuryId);
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تحميل كشف المطابقة";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

async function handleReconcile(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "treasury",
      action: "treasury",
    });
    if (!auth.ok) return auth.response;

    const treasuryId = String(body.treasuryId || "").trim();
    if (!treasuryId) {
      return jsonError("يرجى تحديد معرف الخزينة", 400);
    }

    const result = await reconcileTreasuryAccount({
      treasuryId,
      statementBalance:
        body.statementBalance !== undefined ? Number(body.statementBalance) : undefined,
      statementDate: body.statementDate ? String(body.statementDate) : undefined,
      toggleEntryId: body.toggleEntryId ? String(body.toggleEntryId) : undefined,
      reconciled: body.reconciled !== undefined ? Boolean(body.reconciled) : undefined,
      reconciledEntryIds: Array.isArray(body.reconciledEntryIds)
        ? body.reconciledEntryIds.map(String)
        : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      createdById: auth.actor.userId ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر تنفيذ مطابقة الكشف";
    return jsonError(msg, msg.includes("NOT_FOUND") ? 404 : 400);
  }
}

export async function POST(req: NextRequest) {
  return handleReconcile(req);
}

export async function PATCH(req: NextRequest) {
  return handleReconcile(req);
}


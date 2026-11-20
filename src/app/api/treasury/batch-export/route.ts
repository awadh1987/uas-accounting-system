import { NextRequest, NextResponse } from "next/server";
import { exportBulkBankTransferFile } from "@/lib/treasury/bankWalletGateway";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { treasuryAccountId, treasuryName, provider, items, format = "xlsx" } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "ITEMS_ARRAY_REQUIRED: Please provide at least one payout item." },
        { status: 400 }
      );
    }

    const result = exportBulkBankTransferFile({
      treasuryAccountId,
      treasuryName,
      provider,
      items,
      format,
    });

    const base64 = result.buffer.toString("base64");
    const mimeType =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    return NextResponse.json({
      ok: true,
      filename: result.filename,
      mimeType,
      base64,
      count: result.count,
      totalAmount: result.totalAmount,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "BATCH_EXPORT_FAILED" },
      { status: 400 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { processInboundCollectionWebhook } from "@/lib/treasury/bankWalletGateway";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const body = await req.json();
    const signature =
      req.headers.get("x-signature") ||
      req.headers.get("x-webhook-signature") ||
      req.headers.get("authorization");

    const result = await processInboundCollectionWebhook({
      provider: provider.toUpperCase(),
      payload: body,
      signatureHeader: signature,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "WEBHOOK_PROCESSING_FAILED",
      },
      { status: 400 }
    );
  }
}

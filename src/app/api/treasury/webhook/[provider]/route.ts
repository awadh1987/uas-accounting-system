import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { processInboundCollectionWebhook } from "@/lib/treasury/bankWalletGateway";

export const POST = withTenantRoute(async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params;
    const rawBody = await req.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    const signature =
      req.headers.get("x-gateway-signature") ||
      req.headers.get("x-webhook-signature") ||
      req.headers.get("x-signature") ||
      req.headers.get("authorization");

    const result = await processInboundCollectionWebhook({
      provider: provider.toUpperCase(),
      payload: body,
      rawBody,
      signatureHeader: signature,
      requireSignature: true,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    const msg = err?.message || "WEBHOOK_PROCESSING_FAILED";
    const status = msg.includes("INVALID_WEBHOOK_SIGNATURE") ? 401 : 400;
    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status }
    );
  }
});

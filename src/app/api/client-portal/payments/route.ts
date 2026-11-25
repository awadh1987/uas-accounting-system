import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import {
  listClientPaymentReceipts,
  listTenantPaymentChannels,
  PAYMENT_CHANNEL_CATEGORY_LABELS,
  resubmitClientPaymentReceipt,
  submitClientPaymentReceipt,
  type ReceiptFileInput,
} from "@/lib/clientPortal/paymentGateService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    await ensurePortalSchemaReady(auth.scope.tenantSlug);

    if (auth.account.status !== "ACTIVE") {
      return jsonError("حسابك قيد المراجعة — لا يمكن عرض بوابة السداد قبل التفعيل", 403);
    }

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "ALL").trim().toUpperCase();
    const search = (searchParams.get("search") || searchParams.get("q") || "").trim();
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("pageSize") || "25", 10) || 25));

    const [channels, paymentsData] = await Promise.all([
      listTenantPaymentChannels({ tenantSlug: auth.scope.tenantSlug, activeOnly: true }),
      listClientPaymentReceipts({
        tenantSlug: auth.scope.tenantSlug,
        clientAccountId: auth.account.id,
        status,
        search,
        page,
        pageSize,
      }),
    ]);

    return NextResponse.json({
      success: true,
      tenantSlug: auth.scope.tenantSlug,
      categoryLabels: PAYMENT_CHANNEL_CATEGORY_LABELS,
      channels,
      ...paymentsData,
    });
  } catch (err) {
    console.error("GET /api/client-portal/payments error:", err);
    return jsonError("تعذر تحميل بوابة السداد والإيصالات", 500);
  }
});

async function parseSubmissionBody(req: NextRequest): Promise<{
  fields: Record<string, unknown>;
  file: ReceiptFileInput | null;
}> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const fields: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") fields[k] = v;
    }
    const fileField = form.get("file") || form.get("receipt");
    let file: ReceiptFileInput | null = null;
    if (fileField && typeof fileField !== "string") {
      const buf = Buffer.from(await fileField.arrayBuffer());
      file = {
        buffer: buf,
        mimeType: fileField.type,
        filename: fileField.name,
      };
    } else if (typeof fields.receiptDataUrl === "string" || typeof fields.dataUrl === "string") {
      file = {
        dataUrl: String(fields.receiptDataUrl || fields.dataUrl),
        filename: fields.receiptFileName ? String(fields.receiptFileName) : undefined,
      };
    }
    return { fields, file };
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rawDataUrl =
    typeof body.receiptDataUrl === "string"
      ? body.receiptDataUrl
      : typeof body.dataUrl === "string"
      ? body.dataUrl
      : typeof body.receiptFileBase64 === "string"
      ? body.receiptFileBase64
      : null;

  let file: ReceiptFileInput | null = null;
  if (rawDataUrl) {
    if (rawDataUrl.startsWith("data:")) {
      file = {
        dataUrl: rawDataUrl,
        filename: body.receiptFileName ? String(body.receiptFileName) : undefined,
      };
    } else {
      file = {
        buffer: Buffer.from(rawDataUrl, "base64"),
        mimeType: body.receiptMimeType ? String(body.receiptMimeType) : "image/png",
        filename: body.receiptFileName ? String(body.receiptFileName) : "receipt.png",
      };
    }
  }
  return { fields: body, file };
}

function parseIdArrayField(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === "string" && val.trim()) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    await ensurePortalSchemaReady(auth.scope.tenantSlug);

    const { fields, file } = await parseSubmissionBody(req);

    const payment = await submitClientPaymentReceipt({
      tenantSlug: auth.scope.tenantSlug,
      clientAccountId: auth.account.id,
      channelId: String(fields.channelId || ""),
      amount: Number(fields.amount || 0),
      currency: fields.currency ? String(fields.currency) : undefined,
      transferReference: String(fields.transferReference || ""),
      transferDate: fields.transferDate ? String(fields.transferDate) : undefined,
      transferTime: fields.transferTime ? String(fields.transferTime) : undefined,
      linkedInvoiceIds: parseIdArrayField(fields.linkedInvoiceIds),
      linkedRequestIds: parseIdArrayField(fields.linkedRequestIds),
      clientNotes: fields.clientNotes ? String(fields.clientNotes) : undefined,
      file,
    });

    return NextResponse.json(
      {
        success: true,
        payment,
        message: "✅ تم استلام إشعار السداد وإرفاق الإيصال بنجاح — قيد مراجعة المحاسب",
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر تسجيل إشعار السداد";
    const status = msg.includes("DUPLICATE_TRANSFER_REFERENCE") ? 409 : 400;
    return jsonError(msg, status);
  }
});

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  try {
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);
    await ensurePortalSchemaReady(auth.scope.tenantSlug);

    const { fields, file } = await parseSubmissionBody(req);
    const paymentId = String(fields.paymentId || fields.id || "").trim();
    if (!paymentId) return jsonError("معرف إشعار السداد مطلوب", 400);

    const payment = await resubmitClientPaymentReceipt({
      tenantSlug: auth.scope.tenantSlug,
      paymentId,
      clientAccountId: auth.account.id,
      amount: fields.amount !== undefined ? Number(fields.amount) : undefined,
      transferReference: fields.transferReference ? String(fields.transferReference) : undefined,
      transferDate: fields.transferDate ? String(fields.transferDate) : undefined,
      transferTime: fields.transferTime ? String(fields.transferTime) : undefined,
      clientNotes: fields.clientNotes !== undefined ? String(fields.clientNotes) : undefined,
      file,
    });

    return NextResponse.json({
      success: true,
      payment,
      message: "✅ تم تحديث الإيصال وإعادة إرساله للمراجعة",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "تعذر إعادة إرسال الإيصال";
    const status = msg.startsWith("NOT_FOUND:") ? 404 : msg.includes("DUPLICATE_TRANSFER_REFERENCE") ? 409 : 400;
    return jsonError(msg.replace(/^NOT_FOUND:\s*/, ""), status);
  }
});

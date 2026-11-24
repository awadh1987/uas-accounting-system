/**
 * UAS Enterprise — Tenant-Scoped Vision Scans Archive Search API (/api/ai/vision/archive)
 *
 * Supports querying archived camera/upload scans strictly inside the caller's
 * authenticated tenant workspace, filtered by documentType, dateFrom/dateTo,
 * linkedRecordId / linkedCode, and keyword query `q`.
 */
import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction } from "@/lib/apiHelpers";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import { normalizeMemoryTenantSlug } from "@/lib/ai/copilotMemoryTypes";
import { searchTenantVisionArchive } from "@/lib/ai/visionAttachmentArchive";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, {});
    if (!auth.ok) return auth.response;

    const tenantSlug = normalizeMemoryTenantSlug(getActiveTenantId());
    const sp = req.nextUrl?.searchParams;
    const documentType = sp?.get("documentType") || "all";
    const dateFrom = sp?.get("dateFrom") || undefined;
    const dateTo = sp?.get("dateTo") || undefined;
    const linkedRecordId = sp?.get("linkedRecordId") || undefined;
    const linkedCode = sp?.get("linkedCode") || undefined;
    const q = sp?.get("q") || undefined;

    const attachments = searchTenantVisionArchive({
      tenantSlug,
      documentType: documentType as
        | "all"
        | "harvest_tally_sheet"
        | "expense_or_supplier_receipt"
        | "sales_or_customer_slip",
      dateFrom,
      dateTo,
      linkedRecordId,
      linkedCode,
      q,
    });

    return NextResponse.json({
      success: true,
      tenantSlug,
      count: attachments.length,
      attachments,
    });
  } catch (err: unknown) {
    console.error("GET /api/ai/vision/archive error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "تعذر البحث في أرشيف المستندات الممسوحة / Failed to query vision archive",
      },
      { status: 500 }
    );
  }
});

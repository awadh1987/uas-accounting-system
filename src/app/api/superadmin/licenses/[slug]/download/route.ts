import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import {
  requireSuperadminRootAuth,
  resolveSafeLicenseDownloadFile,
} from "@/lib/licensing/superadminLicenseService";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/superadmin/licenses/[slug]/download?type=uas|txt
 * Streams `<slug>.uas` or `<slug>.uaskey.txt` as an attachment for the root platform owner.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const auth = await requireSuperadminRootAuth(req);
    if (!auth.ok) return auth.response;

    const { slug } = await context.params;
    const type = req.nextUrl.searchParams.get("type") || "uas";

    const resolved = resolveSafeLicenseDownloadFile(slug, type);
    if (!resolved.ok) {
      return jsonError(resolved.error, resolved.status);
    }

    return new NextResponse(new Uint8Array(resolved.content), {
      status: 200,
      headers: {
        "Content-Type": resolved.contentType,
        "Content-Disposition": `attachment; filename="${resolved.filename}"`,
        "Content-Length": String(resolved.content.byteLength),
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("GET /api/superadmin/licenses/[slug]/download error:", err);
    return jsonError("تعذر تحميل ملف الترخيص / Failed to download license file", 500);
  }
}

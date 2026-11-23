import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import {
  requireSuperadminRootAuth,
  resolveSafeLicenseDownloadFile,
} from "@/lib/licensing/superadminLicenseService";
import { NO_STORE_HEADERS } from "@/lib/controlPanel/routeHelper";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

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
        ...NO_STORE_HEADERS,
        "Content-Type": resolved.contentType,
        "Content-Disposition": `attachment; filename="${resolved.filename}"`,
        "Content-Length": String(resolved.content.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("GET /api/control-panel/tenants/[slug]/download error:", err);
    return jsonError("Failed to download license artifact", 500);
  }
}

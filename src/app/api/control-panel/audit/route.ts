import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse } from "@/lib/apiHelpers";
import { requireSuperadminRootAuth } from "@/lib/licensing/superadminLicenseService";
import { listControlPanelAuditFeed } from "@/lib/controlPanel/controlPanelService";
import {
  handleControlPanelError,
  NO_STORE_HEADERS,
} from "@/lib/controlPanel/routeHelper";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSuperadminRootAuth(req);
    if (!auth.ok) return auth.response;

    const sp = req.nextUrl.searchParams;
    const auditLogs = listControlPanelAuditFeed({
      slug: sp.get("slug") || undefined,
      entityType: sp.get("entityType") || undefined,
      search: sp.get("search") || undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : 150,
    });

    return NextResponse.json(
      { success: true, auditLogs },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return handleControlPanelError(err, "Failed to load control panel audit logs");
  }
}

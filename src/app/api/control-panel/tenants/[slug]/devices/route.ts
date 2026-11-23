import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse } from "@/lib/apiHelpers";
import { requireSuperadminRootAuth } from "@/lib/licensing/superadminLicenseService";
import { listTenantDevicesForControlPanel } from "@/lib/controlPanel/controlPanelService";
import {
  handleControlPanelError,
  NO_STORE_HEADERS,
} from "@/lib/controlPanel/routeHelper";

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
    const data = await listTenantDevicesForControlPanel(slug);
    return NextResponse.json(
      { success: true, ...data },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return handleControlPanelError(err, "Failed to list tenant devices");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse } from "@/lib/apiHelpers";
import { requireSuperadminRootAuth } from "@/lib/licensing/superadminLicenseService";
import { controlTenantDeviceFromPanel } from "@/lib/controlPanel/controlPanelService";
import {
  handleControlPanelError,
  NO_STORE_HEADERS,
} from "@/lib/controlPanel/routeHelper";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ slug: string; deviceId: string }> }
) {
  try {
    const auth = await requireSuperadminRootAuth(req);
    if (!auth.ok) return auth.response;

    const { slug, deviceId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const res = await controlTenantDeviceFromPanel(slug, deviceId, body, auth.actor);
    return NextResponse.json(
      { success: true, ...res },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return handleControlPanelError(err, "Failed to update tenant device");
  }
}

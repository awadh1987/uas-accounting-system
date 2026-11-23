import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse } from "@/lib/apiHelpers";
import { requireSuperadminRootAuth } from "@/lib/licensing/superadminLicenseService";
import {
  issueControlPanelTenantLicense,
  listControlPanelTenants,
} from "@/lib/controlPanel/controlPanelService";
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
    const tenants = await listControlPanelTenants({
      search: sp.get("search") || undefined,
      status: sp.get("status") || undefined,
      plan: sp.get("plan") || undefined,
    });

    return NextResponse.json(
      {
        success: true,
        actor: {
          email: auth.actor.email,
          role: auth.actor.role,
          name: auth.actor.name,
        },
        tenants,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return handleControlPanelError(err, "Failed to list tenants");
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireSuperadminRootAuth(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const issued = await issueControlPanelTenantLicense(body, auth.actor);

    return NextResponse.json(
      {
        success: true,
        license: issued,
      },
      { status: 201, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return handleControlPanelError(err, "Failed to issue tenant license");
  }
}

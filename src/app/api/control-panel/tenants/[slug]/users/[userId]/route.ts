import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse } from "@/lib/apiHelpers";
import { requireSuperadminRootAuth } from "@/lib/licensing/superadminLicenseService";
import { manageTenantUserFromPanel } from "@/lib/controlPanel/controlPanelService";
import {
  handleControlPanelError,
  NO_STORE_HEADERS,
} from "@/lib/controlPanel/routeHelper";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

async function handleUserAction(
  req: NextRequest,
  context: { params: Promise<{ slug: string; userId: string }> }
) {
  try {
    const auth = await requireSuperadminRootAuth(req);
    if (!auth.ok) return auth.response;

    const { slug, userId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const res = await manageTenantUserFromPanel(slug, userId, body, auth.actor);
    return NextResponse.json(
      { success: true, ...res },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return handleControlPanelError(err, "Failed to manage tenant user");
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string; userId: string }> }
) {
  return handleUserAction(req, context);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ slug: string; userId: string }> }
) {
  return handleUserAction(req, context);
}

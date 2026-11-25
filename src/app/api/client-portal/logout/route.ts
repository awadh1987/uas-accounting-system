import { NextRequest, NextResponse } from "next/server";
import { withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse } from "@/lib/apiHelpers";
import { clearClientSessionCookie } from "@/lib/clientPortal/clientAuth";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  const res = NextResponse.json({ success: true });
  return clearClientSessionCookie(res, req);
});

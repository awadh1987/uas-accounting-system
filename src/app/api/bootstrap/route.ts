import { NextRequest, NextResponse } from "next/server";
import { getBootstrapState } from "@/lib/serverBootstrap";
import { withTenantRoute } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(_req: NextRequest) {
  try {
    const state = await getBootstrapState();
    return NextResponse.json(state, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      },
    });
  } catch (error) {
    console.error("GET /api/bootstrap failed:", error);
    return NextResponse.json(
      { error: "Failed to load UAS state" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        },
      }
    );
  }
});

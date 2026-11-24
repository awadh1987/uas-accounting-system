import { NextRequest, NextResponse } from "next/server";
import { getBootstrapState } from "@/lib/serverBootstrap";
import { withTenantRoute } from "@/lib/prisma";
import { resolveVerifiedActor } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    const state = await getBootstrapState();
    const actor = await resolveVerifiedActor({}, req).catch(() => null);
    const sessionUser =
      actor?.authenticated && actor.user
        ? state.users.find((u) => u.id === actor.user!.id) || actor.user
        : null;
    return NextResponse.json(
      {
        ...state,
        ...(sessionUser
          ? {
              sessionUser,
              mustChangePassword: Boolean(sessionUser.mustChangePassword),
            }
          : {}),
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        },
      }
    );
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

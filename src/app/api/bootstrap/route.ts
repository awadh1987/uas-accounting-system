import { NextResponse } from "next/server";
import { getBootstrapState } from "@/lib/serverBootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
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
}


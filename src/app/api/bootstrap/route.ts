import { NextResponse } from "next/server";
import { getBootstrapState } from "@/lib/serverBootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getBootstrapState();
    return NextResponse.json(state);
  } catch (error) {
    console.error("GET /api/bootstrap failed:", error);
    return NextResponse.json({ error: "Failed to load UAS state" }, { status: 500 });
  }
}


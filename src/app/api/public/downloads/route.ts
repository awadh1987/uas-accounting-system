import { NextResponse } from "next/server";
import { getPublicDownloadsInventory } from "@/lib/downloadsServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = getPublicDownloadsInventory();
  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

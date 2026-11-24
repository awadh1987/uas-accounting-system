import { NextRequest, NextResponse } from "next/server";
import { readVisionAttachmentFile } from "@/lib/ai/visionAttachmentArchive";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tenantKey: string; filename: string }> }
) {
  const { tenantKey, filename } = await context.params;
  const file = readVisionAttachmentFile(tenantKey, filename);
  if (!file) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

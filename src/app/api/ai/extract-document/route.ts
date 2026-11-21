import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { extractDocumentDraft } from "@/lib/ai/documentExtractionEngine";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();

    let fileName = "document.txt";
    let mimeType = "text/plain";
    let textContent = "";
    let base64Content = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const hintText = String(formData.get("text") || formData.get("notes") || "").trim();
      if (file) {
        fileName = file.name || "upload";
        mimeType = file.type || "application/octet-stream";
        const buf = Buffer.from(await file.arrayBuffer());
        base64Content = buf.toString("base64");
        if (mimeType.startsWith("text/") || mimeType === "application/json" || fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
          textContent = buf.toString("utf8");
        } else if (mimeType === "application/pdf") {
          // Extract readable ASCII/UTF-8 text fragments from PDF stream if no external OCR is configured
          textContent = buf.toString("latin1").replace(/[^\x20-\x7E\r\n]/g, " ");
        }
      }
      if (hintText) {
        textContent = `${hintText}\n${textContent}`.trim();
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      fileName = String(body.fileName || "document.txt");
      mimeType = String(body.mimeType || "text/plain");
      textContent = String(body.textContent || body.text || body.ocrText || "");
      base64Content = String(body.base64Content || "");
    }

    const [settings, recentJournals, closedYears] = await Promise.all([
      prisma.systemSettings.findUnique({ where: { id: "default" } }),
      prisma.journalEntry.findMany({
        take: 100,
        orderBy: { createdAt: "desc" },
        select: { reference: true, entryNumber: true },
      }),
      prisma.fiscalYear.findMany({
        where: { status: "CLOSED" },
        select: { code: true, startDate: true, endDate: true },
      }),
    ]);

    const existingReferences = recentJournals
      .flatMap((j) => [j.reference, j.entryNumber])
      .filter((x): x is string => Boolean(x));

    const draft = await extractDocumentDraft({
      fileName,
      mimeType,
      textContent,
      base64Content,
      defaultCurrency: settings?.defaultCurrency || "YER",
      validationContext: {
        periodLockDate: settings?.periodLockDate ?? null,
        existingReferences,
        closedFiscalYears: closedYears.map((fy) => ({
          code: fy.code,
          startDate: fy.startDate.toISOString(),
          endDate: fy.endDate.toISOString(),
        })),
      },
    });

    return NextResponse.json({
      success: true,
      draft,
    });
  } catch (err) {
    console.error("POST /api/ai/extract-document error:", err);
    return jsonError("تعذر استخراج بيانات المستند / Failed to extract document draft", 500);
  }
});

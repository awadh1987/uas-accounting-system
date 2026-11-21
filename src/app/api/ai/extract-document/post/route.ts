import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { postJournalEntry } from "@/lib/accounting/ledgerService";
import { validateExtractedDraft } from "@/lib/ai/documentExtractionEngine";
import { withIdempotency } from "@/lib/idempotencyGuard";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import type { ExtractedDocumentDraft } from "@/types/uas";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;

      // Enforce explicit human-in-the-loop confirmation before posting
      if (body.confirmed !== true) {
        return NextResponse.json(
          {
            success: false,
            code: "CONFIRMATION_REQUIRED",
            error: "⛔ يتطلب ترحيل المستندات المستخرجة تأكيداً صريحاً من المستخدم (تأكيد الترحيل) / Explicit user confirmation is required before posting.",
          },
          { status: 400 }
        );
      }

      const auth = await authorizeApiAction(body, r, {
        moduleId: "ledger",
        action: "post",
      });
      if (!auth.ok) return auth.response;

      const draft = body.draft as ExtractedDocumentDraft | undefined;
      if (!draft || !Array.isArray(draft.lines) || draft.lines.length < 2) {
        return jsonError("بيانات مسودة المستند غير مكتملة أو السطور المحاسبية غير صالحة", 400);
      }

      const [settings, closedYears] = await Promise.all([
        prisma.systemSettings.findUnique({ where: { id: "default" } }),
        prisma.fiscalYear.findMany({
          where: { status: "CLOSED" },
          select: { code: true, startDate: true, endDate: true },
        }),
      ]);

      const warnings = validateExtractedDraft(draft, {
        periodLockDate: settings?.periodLockDate ?? null,
        closedFiscalYears: closedYears.map((fy) => ({
          code: fy.code,
          startDate: fy.startDate.toISOString(),
          endDate: fy.endDate.toISOString(),
        })),
      });

      const blockingErrors = warnings.filter((w) => w.severity === "error");
      if (blockingErrors.length > 0) {
        return NextResponse.json(
          {
            success: false,
            code: blockingErrors[0].code,
            error: blockingErrors[0].messageAr,
            warnings,
          },
          { status: 400 }
        );
      }

      const entry = await prisma.$transaction(async (tx) => {
        const posted = await postJournalEntry({
          tx,
          date: draft.date,
          reference: draft.reference,
          narrationAr: draft.narrationAr || `${draft.documentType}: ${draft.partyName || draft.reference}`,
          narrationEn: draft.narrationEn || `${draft.documentType}: ${draft.partyName || draft.reference}`,
          sourceType: draft.documentType || "AI_DOCUMENT_EXTRACT",
          projectId: draft.projectId || null,
          costCenterId: draft.costCenterId || null,
          createdById: auth.actor.userId || undefined,
          status: "POSTED",
          lines: draft.lines.map((l) => ({
            accountCode: l.accountCode,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            currency: draft.currency || "YER",
            memo: l.description || draft.narrationAr,
            costCenterId: l.costCenterId || draft.costCenterId || null,
            projectId: l.projectId || draft.projectId || null,
          })),
          attachments: draft.fileName
            ? [
                {
                  fileName: draft.fileName,
                  fileUrl: `copilot://extracted/${draft.draftId}`,
                  fileType: draft.mimeType || "application/octet-stream",
                },
              ]
            : undefined,
        });

        await appendAuditLogTx(tx, {
          ...auth.actor,
          actionType: "ترحيل مستند عبر المساعد الذكي [executed_by_ai: true]",
          entityReference: posted.entryNumber,
          details: `ترحيل ${draft.documentType} (${draft.reference}) بمبلغ ${draft.totalAmount} ${draft.currency} بعد مراجعة وتأكيد المستخدم`,
        });

        return posted;
      });

      const state = await getBootstrapState();

      return NextResponse.json(
        {
          success: true,
          entryNumber: entry.entryNumber,
          journalEntryId: entry.id,
          state,
        },
        { status: 201 }
      );
    } catch (err) {
      console.error("POST /api/ai/extract-document/post error:", err);
      return jsonError(
        err instanceof Error ? err.message : "تعذر ترحيل المستند المستخرج / Failed to post extracted document",
        500
      );
    }
  });
});

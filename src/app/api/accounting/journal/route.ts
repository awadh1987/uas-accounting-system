import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  postJournalEntry,
  reverseJournalEntry,
  type AttachmentInput,
  type JournalLineInput,
} from "@/lib/accounting/ledgerService";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const accountId = searchParams.get("accountId");
    const status = searchParams.get("status");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const search = searchParams.get("search")?.trim();

    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (fromDate) dateFilter.gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      if (toDate.length <= 10) end.setUTCHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const entries = await prisma.journalEntry.findMany({
      where: {
        ...(projectId && projectId !== "ALL" ? { projectId } : {}),
        ...(status && status !== "ALL" ? { status } : {}),
        ...(fromDate || toDate ? { date: dateFilter } : {}),
        ...(accountId && accountId !== "ALL"
          ? { lines: { some: { accountId } } }
          : {}),
        ...(search
          ? {
              OR: [
                { entryNumber: { contains: search } },
                { reference: { contains: search } },
                { narrationAr: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        project: { select: { id: true, code: true, nameAr: true, nameEn: true } },
        createdBy: { select: { id: true, name: true, role: true } },
        attachments: true,
        lines: {
          include: {
            account: { select: { id: true, code: true, nameAr: true, nameEn: true, type: true, level: true } },
            project: { select: { id: true, code: true, nameAr: true } },
            subProject: { select: { id: true, code: true, nameAr: true } },
            harvestCycle: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ date: "desc" }, { entryNumber: "desc" }],
    });

    let totalDebitAll = 0;
    let totalCreditAll = 0;

    const mapped = entries.map((e) => {
      const dr = e.lines.reduce((s, l) => s + Number(l.debitBase), 0);
      const cr = e.lines.reduce((s, l) => s + Number(l.creditBase), 0);
      if (e.status === "POSTED") {
        totalDebitAll += dr;
        totalCreditAll += cr;
      }
      return {
        id: e.id,
        entryNumber: e.entryNumber,
        date: e.date.toISOString(),
        reference: e.reference,
        narrationAr: e.narrationAr,
        narrationEn: e.narrationEn,
        status: e.status,
        sourceType: e.sourceType,
        projectId: e.projectId,
        project: e.project,
        createdBy: e.createdBy,
        attachments: e.attachments,
        totalDebitBase: dr,
        totalCreditBase: cr,
        isBalanced: Math.abs(dr - cr) <= 0.005,
        lines: e.lines.map((l) => ({
          id: l.id,
          accountId: l.accountId,
          account: l.account,
          debit: Number(l.debit),
          credit: Number(l.credit),
          currency: l.currency,
          exchangeRate: Number(l.exchangeRate),
          debitBase: Number(l.debitBase),
          creditBase: Number(l.creditBase),
          memo: l.memo,
          projectId: l.projectId,
          project: l.project,
          subProjectId: l.subProjectId,
          subProject: l.subProject,
          harvestCycleId: l.harvestCycleId,
          harvestCycle: l.harvestCycle,
        })),
      };
    });

    return NextResponse.json({
      entries: mapped,
      summary: {
        count: mapped.length,
        totalDebitBase: totalDebitAll,
        totalCreditBase: totalCreditAll,
        isLedgerBalanced: Math.abs(totalDebitAll - totalCreditAll) <= 0.005,
      },
    });
  } catch (error) {
    console.error("GET /api/accounting/journal error:", error);
    return jsonError("تعذر تحميل قيود دفتر اليومية", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body);

    if (body.action === "REVERSE") {
      const journalEntryId = String(body.journalEntryId || "").trim();
      if (!journalEntryId) return jsonError("معرف القيد مطلوب للعكس", 400);
      const reversal = await reverseJournalEntry({
        journalEntryId,
        createdById: actor.userId ?? undefined,
        reason: String(body.reason || "عكس قيد من دفتر اليومية"),
      });
      return NextResponse.json({ entry: reversal }, { status: 201 });
    }

    const narrationAr = String(body.narrationAr || "").trim();
    const narrationEn = body.narrationEn ? String(body.narrationEn).trim() : undefined;
    const reference = body.reference ? String(body.reference).trim() : undefined;
    const projectId = body.projectId && body.projectId !== "ALL" ? String(body.projectId) : null;
    const date = body.date ? String(body.date) : new Date().toISOString();
    const lines = Array.isArray(body.lines) ? (body.lines as JournalLineInput[]) : [];
    const attachments = Array.isArray(body.attachments)
      ? (body.attachments as AttachmentInput[])
      : undefined;

    if (!narrationAr) {
      return jsonError("يرجى إدخال البيان المحاسبي للقيد", 400);
    }

    const entry = await postJournalEntry({
      date,
      reference,
      narrationAr,
      narrationEn,
      projectId,
      createdById: actor.userId ?? undefined,
      sourceType: "MANUAL",
      status: "POSTED",
      lines,
      attachments,
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "تعذر ترحيل القيد المحاسبي";
    const status = msg.includes("UNBALANCED") || msg.includes("NON_POSTING") || msg.includes("HARVEST_LOCKED") ? 400 : 500;
    return jsonError(msg, status);
  }
}


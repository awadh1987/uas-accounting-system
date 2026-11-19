import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import {
  assertNotInLockedPeriod,
  parseAccountingSettings,
} from "@/lib/accountingSettings";
import {
  computeUnrealizedFxRevaluation,
  type FxOpenPosition,
} from "@/lib/multiCurrencyEngine";

export const dynamic = "force-dynamic";

async function collectOpenFxPositions(spotRatesOverride?: Record<string, number>): Promise<FxOpenPosition[]> {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      OR: [
        { currencyCode: { not: "YER" } },
        { currency: { not: "YER" } },
      ],
      journalEntry: { status: "POSTED" },
    },
    include: { account: true },
  });

  // Load latest spot rates per currency
  const latestRates = await prisma.exchangeRate.findMany({
    orderBy: { rateDate: "desc" },
  });
  const spotMap: Record<string, number> = {};
  for (const r of latestRates) {
    if (spotMap[r.currencyCode] === undefined) spotMap[r.currencyCode] = r.midRate;
  }
  const legacyRates = await prisma.currencyRate.findMany();
  for (const lr of legacyRates) {
    if (spotMap[lr.currencyCode] === undefined) spotMap[lr.currencyCode] = lr.rateToYER;
  }
  if (spotRatesOverride) {
    for (const [code, val] of Object.entries(spotRatesOverride)) {
      if (Number.isFinite(val) && val > 0) spotMap[code.toUpperCase()] = val;
    }
  }

  const grouped = new Map<string, FxOpenPosition>();
  for (const l of lines) {
    const code = (l.currencyCode || l.currency || "YER").toUpperCase();
    if (code === "YER") continue;
    const key = `${l.accountId}::${code}`;
    const isLiability = l.account.type.toUpperCase() === "LIABILITY";
    const fDebit = Number(l.foreignDebit || l.debit || 0);
    const fCredit = Number(l.foreignCredit || l.credit || 0);
    const bDebit = Number(l.baseDebit || l.debitBase || 0);
    const bCredit = Number(l.baseCredit || l.creditBase || 0);

    const foreignDelta = isLiability ? fCredit - fDebit : fDebit - fCredit;
    const baseDelta = isLiability ? bCredit - bDebit : bDebit - bCredit;

    const existing = grouped.get(key) ?? {
      accountId: l.accountId,
      accountCode: l.account.code,
      accountNameAr: l.account.nameAr,
      accountType: l.account.type,
      currencyCode: code,
      foreignBalance: 0,
      bookedBaseBalance: 0,
      spotRate: spotMap[code] ?? 1,
    };
    existing.foreignBalance += foreignDelta;
    existing.bookedBaseBalance += baseDelta;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).filter((p) => Math.abs(p.foreignBalance) > 0.0001);
}

export async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    const settingsRow = await prisma.systemSettings.findUnique({ where: { id: "default" } });
    const settings = parseAccountingSettings(settingsRow);
    const positions = await collectOpenFxPositions();
    const preview = computeUnrealizedFxRevaluation(positions, {
      unrealizedFxGainAccount: settings.controlAccounts.unrealizedFxGainAccount,
      unrealizedFxLossAccount: settings.controlAccounts.unrealizedFxLossAccount,
    });
    return NextResponse.json({
      success: true,
      asOfDate: new Date().toISOString().slice(0, 10),
      ...preview,
    });
  } catch (error) {
    console.error("GET /api/accounting/fx-revaluation error:", error);
    return jsonError("تعذر معاينة إعادة تقييم العملات الأجنبية / Failed to preview FX revaluation", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body, req);

    const { hasGranularPermission } = await import("@/lib/permissions");
    if (!hasGranularPermission(actor.userRole, "accounting.fx_revalue")) {
      return jsonError("غير مصرح: ليس لديك صلاحية إعادة تقييم فروق العملات الأجنبية", 403);
    }

    const revalDateStr = String(body.date || new Date().toISOString().slice(0, 10));

    const settingsRow = await prisma.systemSettings.findUnique({ where: { id: "default" } });
    const settings = parseAccountingSettings(settingsRow);
    const lockCheck = assertNotInLockedPeriod(revalDateStr, settings.periodLockDate);
    if (!lockCheck.ok) {
      return jsonError(lockCheck.error, 403);
    }

    const spotRatesOverride =
      body.spotRates && typeof body.spotRates === "object"
        ? (body.spotRates as Record<string, number>)
        : undefined;

    const positions = Array.isArray(body.positions)
      ? (body.positions as FxOpenPosition[])
      : await collectOpenFxPositions(spotRatesOverride);

    const calc = computeUnrealizedFxRevaluation(positions, {
      unrealizedFxGainAccount: settings.controlAccounts.unrealizedFxGainAccount,
      unrealizedFxLossAccount: settings.controlAccounts.unrealizedFxLossAccount,
    });

    if (calc.journalLines.length === 0) {
      return NextResponse.json({
        success: true,
        posted: false,
        message: "لا توجد فروق إعادة تقييم لترحيلها / No FX revaluation differences to post.",
        ...calc,
      });
    }

    const entry = await prisma.$transaction(async (tx) => {
      const fallbackUser = await tx.user.findFirst({ orderBy: { createdAt: "asc" } });
      const createdById = actor.userId || fallbackUser?.id || "u1";

      // Resolve account IDs by code when accountId isn't provided (for Unrealized FX Gain/Loss control accounts)
      const resolvedLines: Array<{
        accountId: string;
        debit: number;
        credit: number;
        debitBase: number;
        creditBase: number;
        baseDebit: number;
        baseCredit: number;
        foreignDebit: number;
        foreignCredit: number;
        currency: string;
        currencyCode: string;
        exchangeRate: number;
        memo: string;
      }> = [];

      for (const l of calc.journalLines) {
        let accId = l.accountId;
        if (!accId && l.accountCode) {
          let acc = await tx.account.findUnique({ where: { code: l.accountCode } });
          if (!acc) {
            const isGain = l.accountCode.startsWith("4");
            acc = await tx.account.create({
              data: {
                code: l.accountCode,
                nameAr: isGain ? "أرباح فروق عملة غير محققة" : "خسائر فروق عملة غير محققة",
                nameEn: isGain ? "Unrealized FX Gain" : "Unrealized FX Loss",
                level: 5,
                type: isGain ? "REVENUE" : "EXPENSE",
                isPosting: true,
              },
            });
          }
          accId = acc.id;
        }
        if (!accId) continue;
        resolvedLines.push({
          accountId: accId,
          debit: l.baseDebit,
          credit: l.baseCredit,
          debitBase: l.baseDebit,
          creditBase: l.baseCredit,
          baseDebit: l.baseDebit,
          baseCredit: l.baseCredit,
          foreignDebit: l.foreignDebit,
          foreignCredit: l.foreignCredit,
          currency: "YER",
          currencyCode: "YER",
          exchangeRate: 1,
          memo: l.memo || "إعادة تقييم عملات أجنبية",
        });
      }

      const entryNumber = `FXR-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
      const je = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: new Date(revalDateStr),
          reference: `FX-REVAL-${revalDateStr}`,
          narrationAr: `قيد إعادة تقييم العملات الأجنبية بتاريخ ${revalDateStr}`,
          narrationEn: `Period-End Unrealized FX Revaluation as of ${revalDateStr}`,
          status: "POSTED",
          sourceType: "ADJUSTMENT",
          createdById,
          lines: { create: resolvedLines },
        },
        include: { lines: true },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "ترحيل قيد إعادة تقييم العملات الأجنبية",
        entityReference: je.entryNumber,
        details: `Gain: ${calc.totalUnrealizedGain} | Loss: ${calc.totalUnrealizedLoss}`,
      });

      return je;
    });

    return NextResponse.json({
      success: true,
      posted: true,
      journalEntryId: entry.id,
      entryNumber: entry.entryNumber,
      ...calc,
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/accounting/fx-revaluation error:", error);
    return jsonError("تعذر ترحيل قيد إعادة التقييم / Failed to post FX revaluation", 500);
  }
}

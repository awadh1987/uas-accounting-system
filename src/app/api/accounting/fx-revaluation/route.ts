import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, forbiddenError, jsonError } from "@/lib/apiHelpers";
import { withIdempotency } from "@/lib/idempotencyGuard";
import { hasGranularPermission } from "@/lib/permissions";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import {
  assertNotInLockedPeriod,
  parseAccountingSettings,
} from "@/lib/accountingSettings";
import {
  createHierarchicalAccount,
  postJournalEntry,
} from "@/lib/accounting/ledgerService";
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
      journalEntry: {
        status: "POSTED",
        documentStatus: "POSTED",
        entryType: { not: "YEAR_END_CLOSING" },
      },
    },
    include: { account: true },
  });

  // Load latest spot rates per currency
  const latestRates = await prisma.exchangeRate.findMany({
    orderBy: { rateDate: "desc" },
  });
  const spotMap: Record<string, number> = {};
  for (const r of latestRates) {
    if (spotMap[r.currencyCode] === undefined) spotMap[r.currencyCode] = Number(r.midRate);
  }
  const legacyRates = await prisma.currencyRate.findMany();
  for (const lr of legacyRates) {
    if (spotMap[lr.currencyCode] === undefined) spotMap[lr.currencyCode] = Number(lr.rateToYER);
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
    // Monetary balance sheet accounts (Assets & Liabilities) only
    const accType = l.account.type.toUpperCase();
    if (accType !== "ASSET" && accType !== "LIABILITY") continue;

    const key = `${l.accountId}::${code}`;
    const isLiability = accType === "LIABILITY";
    const bDebit = Number(l.baseDebit || l.debitBase || 0);
    const bCredit = Number(l.baseCredit || l.creditBase || 0);
    // Pure base-currency FX revaluation lines have debit=0, credit=0, foreignDebit=0, foreignCredit=0
    const isBaseOnlyReval =
      Number(l.debit) === 0 &&
      Number(l.credit) === 0 &&
      Number(l.foreignDebit) === 0 &&
      Number(l.foreignCredit) === 0 &&
      (bDebit > 0 || bCredit > 0);
    const fDebit = isBaseOnlyReval ? 0 : Number(l.foreignDebit) || Number(l.debit) || 0;
    const fCredit = isBaseOnlyReval ? 0 : Number(l.foreignCredit) || Number(l.credit) || 0;

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

export const GET = withTenantRoute(async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const auth = await authorizeApiAction({}, req, { moduleId: "ledger" });
    if (!auth.ok) return auth.response;

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
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  return withIdempotency(req, async (r) => {
    try {
      await ensureSqliteDatabaseReady();
      const body = (await r.json()) as Record<string, unknown>;
      const auth = await authorizeApiAction(body, r, {
        moduleId: "ledger",
        action: "post",
        dateChanged: Boolean(body.date),
      });
      if (!auth.ok) return auth.response;
      const actor = auth.actor;

      if (!hasGranularPermission(actor.user || actor.userRole, "accounting.fx_revalue")) {
        return forbiddenError("غير مصرح: ليس لديك صلاحية إعادة تقييم فروق العملات الأجنبية");
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
      const gainCode = settings.controlAccounts.unrealizedFxGainAccount || "421102";
      const lossCode = settings.controlAccounts.unrealizedFxLossAccount || "532102";

      const ensureFxControlAccount = async (code: string, isGain: boolean) => {
        const existingAcc = await tx.account.findUnique({ where: { code } });
        if (existingAcc) return existingAcc;
        const parentCode = isGain ? "421100" : "532100";
        const parent = await tx.account.findUnique({ where: { code: parentCode } });
        if (parent) {
          return createHierarchicalAccount({
            code,
            nameAr: isGain ? "أرباح فروق عملة غير محققة" : "خسائر فروق عملة غير محققة",
            nameEn: isGain ? "Unrealized FX Gain" : "Unrealized FX Loss",
            parentId: parent.id,
            parentCode: parent.code,
            type: isGain ? "REVENUE" : "EXPENSE",
            tx,
            userId: actor.userId ?? undefined,
          });
        }
        return tx.account.create({
          data: {
            code,
            nameAr: isGain ? "أرباح فروق عملة غير محققة" : "خسائر فروق عملة غير محققة",
            nameEn: isGain ? "Unrealized FX Gain" : "Unrealized FX Loss",
            level: 5,
            generation: 5,
            type: isGain ? "REVENUE" : "EXPENSE",
            isPosting: true,
            isPostable: true,
          },
        });
      };

      const journalLines: Array<{
        accountId?: string;
        accountCode?: string;
        debit?: number;
        credit?: number;
        foreignDebit?: number;
        foreignCredit?: number;
        baseDebit?: number;
        baseCredit?: number;
        currency?: string;
        exchangeRate?: number;
        memo?: string;
      }> = [];

      for (const row of calc.rows) {
        if (row.unrealizedGain > 0) {
          const gainAcc = await ensureFxControlAccount(gainCode, true);
          journalLines.push({
            accountId: row.accountId,
            debit: 0,
            credit: 0,
            foreignDebit: 0,
            foreignCredit: 0,
            baseDebit: row.unrealizedGain,
            baseCredit: 0,
            currency: row.currencyCode,
            exchangeRate: row.spotRate,
            memo: `إعادة تقييم عملة ${row.currencyCode} بسعر ${row.spotRate}`,
          });
          journalLines.push({
            accountId: gainAcc.id,
            debit: row.unrealizedGain ? 0 : 0,
            credit: row.unrealizedGain,
            currency: "YER",
            exchangeRate: 1,
            memo: `أرباح فروق عملة غير محققة (${row.currencyCode})`,
          });
        } else if (row.unrealizedLoss > 0) {
          const lossAcc = await ensureFxControlAccount(lossCode, false);
          journalLines.push({
            accountId: lossAcc.id,
            debit: row.unrealizedLoss,
            credit: 0,
            currency: "YER",
            exchangeRate: 1,
            memo: `خسائر فروق عملة غير محققة (${row.currencyCode})`,
          });
          journalLines.push({
            accountId: row.accountId,
            debit: 0,
            credit: 0,
            foreignDebit: 0,
            foreignCredit: 0,
            baseDebit: 0,
            baseCredit: row.unrealizedLoss,
            currency: row.currencyCode,
            exchangeRate: row.spotRate,
            memo: `إعادة تقييم عملة ${row.currencyCode} بسعر ${row.spotRate}`,
          });
        }
      }

      const je = await postJournalEntry({
        tx,
        date: new Date(`${revalDateStr.slice(0, 10)}T12:00:00.000Z`),
        reference: `FX-REVAL-${revalDateStr.slice(0, 10)}`,
        narrationAr: `قيد إعادة تقييم العملات الأجنبية بتاريخ ${revalDateStr}`,
        narrationEn: `Period-End Unrealized FX Revaluation as of ${revalDateStr}`,
        sourceType: "FX_REVALUATION",
        entryType: "ADJUSTMENT",
        status: "POSTED",
        createdById: actor.userId ?? undefined,
        lines: journalLines,
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
    const msg = error instanceof Error ? error.message : "تعذر ترحيل قيد إعادة التقييم / Failed to post FX revaluation";
    return jsonError(msg, msg.includes("CLOSED") || msg.includes("PERIOD_LOCKED") ? 403 : 500);
  }
  });
});

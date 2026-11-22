import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { DEFAULT_CURRENCIES } from "@/lib/multiCurrencyEngine";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export const dynamic = "force-dynamic";

async function ensureDefaultCurrenciesSeeded() {
  const count = await prisma.currency.count();
  if (count > 0) return;

  for (const c of DEFAULT_CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: {},
      create: {
        code: c.code,
        nameAr: c.nameAr,
        nameEn: c.nameEn,
        symbol: c.symbol,
        decimalPlaces: c.decimalPlaces,
        isBaseCurrency: c.isBaseCurrency,
        isCustom: c.isCustom,
        isActive: true,
      },
    });
    const existingRate = await prisma.exchangeRate.findFirst({ where: { currencyCode: c.code } });
    if (!existingRate) {
      await prisma.exchangeRate.create({
        data: {
          currencyCode: c.code,
          buyRate: c.defaultRateToBase,
          sellRate: c.defaultRateToBase,
          midRate: c.defaultRateToBase,
          source: "SYSTEM_DEFAULT",
        },
      });
    }
  }
}

export const GET = withTenantRoute(async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultCurrenciesSeeded();

    const currencies = await prisma.currency.findMany({
      orderBy: [{ isBaseCurrency: "desc" }, { code: "asc" }],
      include: {
        exchangeRates: {
          orderBy: { rateDate: "desc" },
          take: 1,
        },
      },
    });

    const mapped = currencies.map((c) => ({
      id: c.id,
      code: c.code,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      symbol: c.symbol,
      decimalPlaces: c.decimalPlaces,
      isBaseCurrency: c.isBaseCurrency,
      isCustom: c.isCustom,
      isActive: c.isActive,
      latestRate: c.exchangeRates[0]
        ? {
            buyRate: c.exchangeRates[0].buyRate,
            sellRate: c.exchangeRates[0].sellRate,
            midRate: c.exchangeRates[0].midRate,
            rateDate: c.exchangeRates[0].rateDate.toISOString(),
          }
        : {
            buyRate: c.isBaseCurrency ? 1 : 1,
            sellRate: c.isBaseCurrency ? 1 : 1,
            midRate: c.isBaseCurrency ? 1 : 1,
            rateDate: c.createdAt.toISOString(),
          },
    }));

    return NextResponse.json({ currencies: mapped });
  } catch (error) {
    console.error("GET /api/accounting/currencies error:", error);
    return jsonError("تعذر تحميل العملات / Failed to load currencies", 500);
  }
});

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    await ensureDefaultCurrenciesSeeded();

    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "ledger",
      action: "edit",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;
    const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const nameAr = String(body.nameAr || code).trim();
    const nameEn = String(body.nameEn || nameAr || code).trim();
    const symbol = String(body.symbol || code).trim();
    const decimalPlaces = Number.isFinite(Number(body.decimalPlaces))
      ? Math.max(0, Math.min(4, Math.floor(Number(body.decimalPlaces))))
      : 2;
    const isBaseCurrency = Boolean(body.isBaseCurrency);
    const isCustom = body.isCustom !== undefined ? Boolean(body.isCustom) : true;
    const initialRate = Number(body.initialRate ?? body.midRate ?? 1);

    if (!code || code.length < 2 || code.length > 10) {
      return jsonError("يرجى إدخال رمز عملة صالح (2-10 أحرف) / Valid currency code (2-10 chars) is required.", 400);
    }

    const created = await prisma.$transaction(async (tx) => {
      if (isBaseCurrency) {
        await tx.currency.updateMany({ data: { isBaseCurrency: false } });
      }
      const currency = await tx.currency.upsert({
        where: { code },
        update: { nameAr, nameEn, symbol, decimalPlaces, isBaseCurrency, isActive: true },
        create: {
          code,
          nameAr,
          nameEn,
          symbol,
          decimalPlaces,
          isBaseCurrency,
          isCustom,
          isActive: true,
        },
      });

      if (Number.isFinite(initialRate) && initialRate > 0) {
        await tx.exchangeRate.create({
          data: {
            currencyCode: code,
            buyRate: Number(body.buyRate || initialRate),
            sellRate: Number(body.sellRate || initialRate),
            midRate: initialRate,
            source: "MANUAL",
            createdBy: actor.userDisplay,
          },
        });
        await tx.currencyRate.upsert({
          where: { currencyCode: code },
          update: { rateToYER: initialRate },
          create: { currencyCode: code, rateToYER: initialRate },
        });
      }

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "إضافة / تحديث عملة",
        entityReference: `Currency:${code}`,
        details: `${code} — ${nameAr} (${initialRate})`,
      });
      return currency;
    });

    return NextResponse.json({ success: true, currency: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/accounting/currencies error:", error);
    return jsonError("تعذر حفظ العملة / Failed to save currency", 500);
  }
});

export async function PUT(req: NextRequest) {
  return POST(req);
}

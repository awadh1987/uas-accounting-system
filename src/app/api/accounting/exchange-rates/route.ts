import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const currencyCode = req.nextUrl.searchParams.get("currencyCode")?.trim().toUpperCase() || "";
    const asOfParam = req.nextUrl.searchParams.get("date")?.trim() || "";

    if (currencyCode && asOfParam) {
      const asOfDate = new Date(asOfParam.length === 10 ? `${asOfParam}T23:59:59.999Z` : asOfParam);
      const effective = await prisma.exchangeRate.findFirst({
        where: {
          currencyCode,
          ...(Number.isNaN(asOfDate.getTime()) ? {} : { rateDate: { lte: asOfDate } }),
        },
        orderBy: { rateDate: "desc" },
      });
      if (effective) {
        return NextResponse.json({ currencyCode, effectiveRate: effective });
      }
      const fallback = await prisma.currencyRate.findUnique({ where: { currencyCode } });
      const midRate = fallback?.rateToYER ?? (currencyCode === "YER" ? 1 : 1);
      return NextResponse.json({
        currencyCode,
        effectiveRate: {
          currencyCode,
          buyRate: midRate,
          sellRate: midRate,
          midRate,
          rateDate: new Date().toISOString(),
          source: "FALLBACK",
        },
      });
    }

    const rates = await prisma.exchangeRate.findMany({
      where: currencyCode ? { currencyCode } : undefined,
      orderBy: [{ rateDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({ rates });
  } catch (error) {
    console.error("GET /api/accounting/exchange-rates error:", error);
    return jsonError("تعذر تحميل أسعار الصرف / Failed to load exchange rates", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body, req);

    const currencyCode = String(body.currencyCode || "").trim().toUpperCase();
    const buyRate = Number(body.buyRate ?? body.midRate ?? 0);
    const sellRate = Number(body.sellRate ?? body.midRate ?? 0);
    const midRate = Number(body.midRate ?? (buyRate + sellRate) / 2);
    const rateDate = body.rateDate ? new Date(String(body.rateDate)) : new Date();
    const source = String(body.source || "MANUAL").trim();

    if (!currencyCode || !Number.isFinite(midRate) || midRate <= 0) {
      return jsonError("يرجى إدخال رمز العملة وسعر صرف صحيح (> 0) / Valid currencyCode and positive rate required.", 400);
    }

    const created = await prisma.$transaction(async (tx) => {
      // Ensure currency exists (supports custom currencies on the fly)
      await tx.currency.upsert({
        where: { code: currencyCode },
        update: {},
        create: {
          code: currencyCode,
          nameAr: String(body.nameAr || currencyCode),
          nameEn: String(body.nameEn || currencyCode),
          symbol: String(body.symbol || currencyCode),
          decimalPlaces: currencyCode === "YER" ? 0 : 2,
          isBaseCurrency: currencyCode === "YER",
          isCustom: !["YER", "SAR", "USD", "AED", "OMR"].includes(currencyCode),
          isActive: true,
        },
      });

      const rate = await tx.exchangeRate.create({
        data: {
          currencyCode,
          rateDate: Number.isNaN(rateDate.getTime()) ? new Date() : rateDate,
          buyRate: buyRate > 0 ? buyRate : midRate,
          sellRate: sellRate > 0 ? sellRate : midRate,
          midRate,
          source,
          createdBy: actor.userDisplay,
        },
      });

      await tx.currencyRate.upsert({
        where: { currencyCode },
        update: { rateToYER: midRate },
        create: { currencyCode, rateToYER: midRate },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "تحديث سعر صرف العملة",
        entityReference: `ExchangeRate:${currencyCode}`,
        details: `${currencyCode} | Buy: ${rate.buyRate} | Mid: ${rate.midRate} | Sell: ${rate.sellRate}`,
      });

      return rate;
    });

    return NextResponse.json({ success: true, rate: created }, { status: 201 });
  } catch (error) {
    console.error("POST /api/accounting/exchange-rates error:", error);
    return jsonError("تعذر حفظ سعر الصرف / Failed to save exchange rate", 500);
  }
}

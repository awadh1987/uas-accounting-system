import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { extractActor, jsonError } from "@/lib/apiHelpers";

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const actor = extractActor(body);

    const orgName = body.orgName !== undefined ? String(body.orgName).trim() : undefined;
    const logoText = body.logoText !== undefined ? String(body.logoText).trim() : undefined;
    const defaultLang =
      body.defaultLang === "en" || body.defaultLang === "ar" ? body.defaultLang : undefined;
    const defaultTheme =
      body.defaultTheme === "emerald" ||
      body.defaultTheme === "dark" ||
      body.defaultTheme === "royal"
        ? body.defaultTheme
        : undefined;
    const defaultCurrency =
      body.defaultCurrency === "YER" ||
      body.defaultCurrency === "SAR" ||
      body.defaultCurrency === "USD"
        ? body.defaultCurrency
        : undefined;

    await prisma.$transaction(async (tx) => {
      await tx.systemSettings.upsert({
        where: { id: "default" },
        update: {
          ...(orgName ? { orgName } : {}),
          ...(logoText ? { logoText } : {}),
          ...(defaultLang ? { defaultLang } : {}),
          ...(defaultTheme ? { defaultTheme } : {}),
          ...(defaultCurrency ? { defaultCurrency } : {}),
        },
        create: {
          id: "default",
          orgName: orgName || "النظام المحاسبي الموحد Unified Accounting System (UAS)",
          logoText: logoText || "UAS",
          defaultLang: defaultLang || "ar",
          defaultTheme: defaultTheme || "emerald",
          defaultCurrency: defaultCurrency || "YER",
        },
      });

      if (orgName || logoText) {
        await appendAuditLogTx(tx, {
          ...actor,
          actionType: "تحديث إعدادات النظام",
          entityReference: "settings",
          details: `تحديث اسم النظام والشعار (${logoText || "UAS"})`,
        });
      }
    });

    const state = await getBootstrapState();
    return NextResponse.json({ state });
  } catch (error) {
    console.error("PATCH /api/system/settings error:", error);
    return jsonError("تعذر حفظ إعدادات النظام", 500);
  }
}


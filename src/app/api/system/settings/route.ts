import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import {
  clampDiskAlertThresholdPercent,
  DEFAULT_CONTROL_ACCOUNTS,
  DEFAULT_DOCUMENT_SEQUENCES,
  parseAccountingSettings,
  parseTenantAdminConfigJson,
} from "@/lib/accountingSettings";

export const dynamic = "force-dynamic";

export const GET = withTenantRoute(async function GET() {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const row = await prisma.systemSettings.findUnique({ where: { id: "default" } });
    const accountingSettings = parseAccountingSettings(row);
    return NextResponse.json({ success: true, settings: accountingSettings });
  } catch (error) {
    console.error("GET /api/system/settings error:", error);
    return jsonError("تعذر تحميل إعدادات النظام / Failed to load system settings", 500);
  }
});

async function saveSettings(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "edit",
    });
    if (!auth.ok) return auth.response;
    const actor = auth.actor;

    const existingRow = await prisma.systemSettings.findUnique({ where: { id: "default" } });
    const current = parseAccountingSettings(existingRow);

    const orgName = body.orgName !== undefined ? String(body.orgName).trim() : undefined;
    const logoText = body.logoText !== undefined ? String(body.logoText).trim() : undefined;
    const defaultLang =
      body.defaultLang === "en" || body.defaultLang === "ar" ? body.defaultLang : undefined;
    const defaultTheme =
      body.defaultTheme === "light" ||
      body.defaultTheme === "emerald" ||
      body.defaultTheme === "dark" ||
      body.defaultTheme === "royal" ||
      body.defaultTheme === "system"
        ? body.defaultTheme
        : undefined;
    const defaultCurrency =
      typeof body.defaultCurrency === "string" && body.defaultCurrency.trim().length >= 2
        ? body.defaultCurrency.trim().toUpperCase()
        : undefined;

    const fiscalYearStart =
      typeof body.fiscalYearStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fiscalYearStart.trim())
        ? body.fiscalYearStart.trim()
        : undefined;
    const fiscalYearEnd =
      typeof body.fiscalYearEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fiscalYearEnd.trim())
        ? body.fiscalYearEnd.trim()
        : undefined;
    const periodLockDate =
      body.periodLockDate === null || body.periodLockDate === ""
        ? null
        : typeof body.periodLockDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.periodLockDate.trim())
        ? body.periodLockDate.trim()
        : undefined;

    const requireApprovalWorkflow =
      typeof body.requireApprovalWorkflow === "boolean" ? body.requireApprovalWorkflow : undefined;
    const costingMethod =
      body.costingMethod === "WEIGHTED_AVERAGE" || body.costingMethod === "FIFO"
        ? body.costingMethod
        : undefined;
    const negativeStockPolicy =
      body.negativeStockPolicy === "BLOCK" || body.negativeStockPolicy === "WARN"
        ? body.negativeStockPolicy
        : undefined;
    const printLayout =
      typeof body.printLayout === "string" && body.printLayout.trim()
        ? body.printLayout.trim().toUpperCase()
        : undefined;

    const mergedControlAccounts =
      body.controlAccounts && typeof body.controlAccounts === "object"
        ? { ...DEFAULT_CONTROL_ACCOUNTS, ...current.controlAccounts, ...(body.controlAccounts as Record<string, string>) }
        : current.controlAccounts;

    const mergedSequences =
      body.documentSequences && typeof body.documentSequences === "object"
        ? { ...DEFAULT_DOCUMENT_SEQUENCES, ...current.documentSequences, ...(body.documentSequences as Record<string, unknown>) }
        : current.documentSequences;

    const existingAdminCfg = parseTenantAdminConfigJson(existingRow?.tenantAdminConfigJson);
    const hasThresholdUpdate =
      body.diskAlertThresholdPercent !== undefined &&
      body.diskAlertThresholdPercent !== null &&
      String(body.diskAlertThresholdPercent).trim() !== "";
    const nextDiskThreshold = hasThresholdUpdate
      ? clampDiskAlertThresholdPercent(
          body.diskAlertThresholdPercent,
          current.diskAlertThresholdPercent
        )
      : undefined;
    const nextTenantAdminConfigJson =
      nextDiskThreshold !== undefined
        ? JSON.stringify({
            ...existingAdminCfg,
            diskAlertThresholdPercent: nextDiskThreshold,
            diskAlertThresholdUpdatedAt: new Date().toISOString(),
            diskAlertThresholdUpdatedBy: actor.userId || actor.userDisplay,
          })
        : undefined;

    const updatedRow = await prisma.$transaction(async (tx) => {
      const saved = await tx.systemSettings.upsert({
        where: { id: "default" },
        update: {
          ...(orgName ? { orgName } : {}),
          ...(logoText ? { logoText } : {}),
          ...(defaultLang ? { defaultLang } : {}),
          ...(defaultTheme ? { defaultTheme } : {}),
          ...(defaultCurrency ? { defaultCurrency } : {}),
          ...(fiscalYearStart !== undefined ? { fiscalYearStart } : {}),
          ...(fiscalYearEnd !== undefined ? { fiscalYearEnd } : {}),
          ...(periodLockDate !== undefined ? { periodLockDate } : {}),
          ...(requireApprovalWorkflow !== undefined ? { requireApprovalWorkflow } : {}),
          ...(costingMethod ? { costingMethod } : {}),
          ...(negativeStockPolicy ? { negativeStockPolicy } : {}),
          ...(printLayout ? { printLayout } : {}),
          ...(body.controlAccounts ? { controlAccountsJson: JSON.stringify(mergedControlAccounts) } : {}),
          ...(body.documentSequences ? { documentSequencesJson: JSON.stringify(mergedSequences) } : {}),
          ...(nextTenantAdminConfigJson !== undefined
            ? { tenantAdminConfigJson: nextTenantAdminConfigJson }
            : {}),
        },
        create: {
          id: "default",
          orgName: orgName || current.orgName,
          logoText: logoText || current.logoText,
          defaultLang: defaultLang || current.defaultLang,
          defaultTheme: defaultTheme || current.defaultTheme,
          defaultCurrency: defaultCurrency || current.defaultCurrency,
          fiscalYearStart: fiscalYearStart || current.fiscalYearStart,
          fiscalYearEnd: fiscalYearEnd || current.fiscalYearEnd,
          periodLockDate: periodLockDate ?? current.periodLockDate,
          requireApprovalWorkflow: requireApprovalWorkflow ?? current.requireApprovalWorkflow,
          costingMethod: costingMethod || current.costingMethod,
          negativeStockPolicy: negativeStockPolicy || current.negativeStockPolicy,
          printLayout: printLayout || current.printLayout,
          controlAccountsJson: JSON.stringify(mergedControlAccounts),
          documentSequencesJson: JSON.stringify(mergedSequences),
          ...(nextTenantAdminConfigJson !== undefined
            ? { tenantAdminConfigJson: nextTenantAdminConfigJson }
            : {}),
        },
      });

      await appendAuditLogTx(tx, {
        ...actor,
        actionType: "تحديث الإعدادات المحاسبية والتشغيلية",
        entityReference: "SystemSettings:default",
        details: JSON.stringify({
          periodLockDate: saved.periodLockDate,
          costingMethod: saved.costingMethod,
          negativeStockPolicy: saved.negativeStockPolicy,
          printLayout: saved.printLayout,
          ...(nextDiskThreshold !== undefined
            ? { diskAlertThresholdPercent: nextDiskThreshold }
            : {}),
        }),
      });
      return saved;
    });

    const state = await getBootstrapState();
    return NextResponse.json({
      success: true,
      settings: parseAccountingSettings(updatedRow),
      state,
    });
  } catch (error) {
    console.error("PUT/PATCH /api/system/settings error:", error);
    return jsonError("تعذر حفظ إعدادات النظام / Failed to save system settings", 500);
  }
}

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  return saveSettings(req);
});

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  return saveSettings(req);
});

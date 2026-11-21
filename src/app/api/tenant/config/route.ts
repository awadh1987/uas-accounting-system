import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import {
  buildTenantWorkspaceUrl,
  getActiveTenantId,
  getTenantMetadata,
} from "@/lib/tenant";
import { checkProfileUpdateAgainstLock } from "@/lib/licensing/companyLock";
import { loadActiveLockedLicense } from "@/lib/licensing/companyLockServer";
import type { UasTenantAdminConfig } from "@/types/uas";

export const dynamic = "force-dynamic";

function buildTenantAdminConfig(params: {
  tenantId: string;
  slug: string;
  profile: Awaited<ReturnType<typeof prisma.enterpriseProfile.findUnique>>;
  settings: Awaited<ReturnType<typeof prisma.systemSettings.findUnique>>;
}): UasTenantAdminConfig {
  const { tenantId, slug, profile, settings } = params;
  return {
    tenantId,
    slug,
    tenantUrl: buildTenantWorkspaceUrl(slug),
    legalNameAr: profile?.legalNameAr || "اسم المنشأة",
    legalNameEn: profile?.legalNameEn || "Enterprise Name",
    brandColor: profile?.brandColor || "#059669",
    logoUrl: profile?.enterpriseLogoCustomUrl || profile?.logoUrl || "/uas-logo.png",
    welcomeNoticeAr: profile?.welcomeNoticeAr || "",
    welcomeNoticeEn: profile?.welcomeNoticeEn || "",
    supportEmail: profile?.supportEmail || profile?.email || "",
    contactPhone: profile?.contactPhone || profile?.phone || "",
    contactWhatsApp: profile?.contactWhatsApp || "",
    contactAddress: profile?.contactAddress || profile?.address || "",
    defaultLang: settings?.defaultLang === "en" ? "en" : "ar",
    defaultCurrency:
      settings?.defaultCurrency === "SAR" || settings?.defaultCurrency === "USD"
        ? settings.defaultCurrency
        : "YER",
    requireApprovalWorkflow: Boolean(settings?.requireApprovalWorkflow),
    periodLockDate: settings?.periodLockDate ?? null,
    autoSyncEnabled: settings?.autoSyncEnabled ?? true,
    autoSyncIntervalSec: settings?.autoSyncIntervalSec ?? 60,
    defaultDeviceSyncMode: settings?.defaultDeviceSyncMode === "MANUAL" ? "MANUAL" : "AUTO",
    requireDeviceApproval: Boolean(settings?.requireDeviceApproval),
    showPublicMetrics: profile?.showPublicMetrics ?? true,
    showPublicVerify: profile?.showPublicVerify ?? true,
  };
}

export const GET = withTenantRoute(async function GET() {
  try {
    await ensureSqliteDatabaseReady();
    const tenantId = getActiveTenantId();
    const meta = getTenantMetadata(tenantId);
    const [profile, settings] = await Promise.all([
      prisma.enterpriseProfile.findUnique({ where: { id: "default" } }),
      prisma.systemSettings.findUnique({ where: { id: "default" } }),
    ]);

    const slug = profile?.tenantSlug || meta?.slug || tenantId;
    const config = buildTenantAdminConfig({ tenantId, slug, profile, settings });

    return NextResponse.json({
      success: true,
      config,
    });
  } catch (err) {
    console.error("GET /api/tenant/config error:", err);
    return jsonError("تعذر تحميل إعدادات إدارة المنشأة / Failed to load tenant admin config", 500);
  }
});

async function handleSaveTenantConfig(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "cms",
    });
    if (!auth.ok) return auth.response;

    const tenantId = getActiveTenantId();
    const meta = getTenantMetadata(tenantId);
    const existingProfile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });

    const legalNameAr =
      typeof body.legalNameAr === "string" ? body.legalNameAr.trim() : undefined;
    const legalNameEn =
      typeof body.legalNameEn === "string" ? body.legalNameEn.trim() : undefined;

    const lockedLicense = loadActiveLockedLicense();
    if (lockedLicense) {
      const check = checkProfileUpdateAgainstLock(
        lockedLicense.company_name as string,
        existingProfile
          ? {
              legalNameAr: existingProfile.legalNameAr,
              legalNameEn: existingProfile.legalNameEn,
              isConfigured: existingProfile.isConfigured,
            }
          : null,
        { legalNameAr, legalNameEn }
      );
      if (!check.ok) {
        return NextResponse.json(
          { error: check.error, code: "COMPANY_NAME_LOCKED" },
          { status: 403 }
        );
      }
    }

    const strOpt = (k: string) =>
      typeof body[k] === "string" ? String(body[k]).trim() : undefined;
    const boolOpt = (k: string) =>
      typeof body[k] === "boolean" ? Boolean(body[k]) : undefined;

    const intervalSecRaw = Number(body.autoSyncIntervalSec);
    const autoSyncIntervalSec =
      Number.isFinite(intervalSecRaw) && intervalSecRaw >= 10 && intervalSecRaw <= 3600
        ? Math.round(intervalSecRaw)
        : undefined;
    const defaultDeviceSyncMode =
      body.defaultDeviceSyncMode === "MANUAL" || body.defaultDeviceSyncMode === "AUTO"
        ? body.defaultDeviceSyncMode
        : undefined;
    const periodLockDate =
      body.periodLockDate === null || body.periodLockDate === ""
        ? null
        : typeof body.periodLockDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.periodLockDate.trim())
        ? body.periodLockDate.trim()
        : undefined;

    const { profile, settings } = await prisma.$transaction(async (tx) => {
      const savedProfile = await tx.enterpriseProfile.upsert({
        where: { id: "default" },
        update: {
          isConfigured: true,
          ...(legalNameAr ? { legalNameAr } : {}),
          ...(legalNameEn ? { legalNameEn } : {}),
          ...(strOpt("brandColor") ? { brandColor: strOpt("brandColor") } : {}),
          ...(body.logoUrl !== undefined
            ? {
                logoUrl: body.logoUrl ? String(body.logoUrl).trim() : null,
                ...(body.logoUrl
                  ? { enterpriseLogoCustomUrl: String(body.logoUrl).trim(), enterpriseLogoStyle: "custom" }
                  : {}),
              }
            : {}),
          ...(strOpt("welcomeNoticeAr") !== undefined
            ? { welcomeNoticeAr: strOpt("welcomeNoticeAr") }
            : {}),
          ...(strOpt("welcomeNoticeEn") !== undefined
            ? { welcomeNoticeEn: strOpt("welcomeNoticeEn") }
            : {}),
          ...(strOpt("supportEmail") !== undefined ? { supportEmail: strOpt("supportEmail") } : {}),
          ...(strOpt("contactPhone") !== undefined ? { contactPhone: strOpt("contactPhone") } : {}),
          ...(strOpt("contactWhatsApp") !== undefined
            ? { contactWhatsApp: strOpt("contactWhatsApp") }
            : {}),
          ...(strOpt("contactAddress") !== undefined
            ? { contactAddress: strOpt("contactAddress") }
            : {}),
          ...(boolOpt("showPublicMetrics") !== undefined
            ? { showPublicMetrics: boolOpt("showPublicMetrics") }
            : {}),
          ...(boolOpt("showPublicVerify") !== undefined
            ? { showPublicVerify: boolOpt("showPublicVerify") }
            : {}),
        },
        create: {
          id: "default",
          legalNameAr: legalNameAr || meta?.nameAr || "اسم المنشأة",
          legalNameEn: legalNameEn || meta?.nameEn || "Enterprise Name",
          tenantSlug: meta?.slug && meta.slug !== "default" ? meta.slug : null,
          brandColor: strOpt("brandColor") || "#059669",
          welcomeNoticeAr: strOpt("welcomeNoticeAr") || "",
          welcomeNoticeEn: strOpt("welcomeNoticeEn") || "",
          supportEmail: strOpt("supportEmail") || "",
          contactPhone: strOpt("contactPhone") || "",
          contactWhatsApp: strOpt("contactWhatsApp") || "",
          contactAddress: strOpt("contactAddress") || "",
          isConfigured: true,
        },
      });

      const savedSettings = await tx.systemSettings.upsert({
        where: { id: "default" },
        update: {
          ...(body.defaultLang === "en" || body.defaultLang === "ar"
            ? { defaultLang: body.defaultLang }
            : {}),
          ...(typeof body.defaultCurrency === "string" && body.defaultCurrency.trim().length >= 2
            ? { defaultCurrency: body.defaultCurrency.trim().toUpperCase() }
            : {}),
          ...(boolOpt("requireApprovalWorkflow") !== undefined
            ? { requireApprovalWorkflow: boolOpt("requireApprovalWorkflow") }
            : {}),
          ...(periodLockDate !== undefined ? { periodLockDate } : {}),
          ...(boolOpt("autoSyncEnabled") !== undefined
            ? { autoSyncEnabled: boolOpt("autoSyncEnabled") }
            : {}),
          ...(autoSyncIntervalSec !== undefined ? { autoSyncIntervalSec } : {}),
          ...(defaultDeviceSyncMode ? { defaultDeviceSyncMode } : {}),
          ...(boolOpt("requireDeviceApproval") !== undefined
            ? { requireDeviceApproval: boolOpt("requireDeviceApproval") }
            : {}),
          tenantAdminConfigJson: JSON.stringify({
            updatedAt: new Date().toISOString(),
            updatedBy: auth.actor.userId,
          }),
        },
        create: {
          id: "default",
          orgName: savedProfile.legalNameAr,
          defaultLang: body.defaultLang === "en" ? "en" : "ar",
          defaultCurrency:
            typeof body.defaultCurrency === "string"
              ? body.defaultCurrency.trim().toUpperCase()
              : "YER",
          requireApprovalWorkflow: Boolean(body.requireApprovalWorkflow),
          periodLockDate: periodLockDate ?? null,
          autoSyncEnabled: boolOpt("autoSyncEnabled") ?? true,
          autoSyncIntervalSec: autoSyncIntervalSec ?? 60,
          defaultDeviceSyncMode: defaultDeviceSyncMode || "AUTO",
          requireDeviceApproval: Boolean(body.requireDeviceApproval),
        },
      });

      await appendAuditLogTx(tx, {
        ...auth.actor,
        actionType: "تحديث إعدادات مساحة المنشأة المستقلة",
        entityReference: `TenantConfig:${tenantId}`,
        details: `تحديث إعدادات البوابة والتشغيل والمزامنة والأجهزة لنطاق المنشأة (${meta?.slug || tenantId})`,
      });

      return { profile: savedProfile, settings: savedSettings };
    });

    const slug = profile.tenantSlug || meta?.slug || tenantId;
    const config = buildTenantAdminConfig({ tenantId, slug, profile, settings });
    const state = await getBootstrapState();

    return NextResponse.json({
      success: true,
      config,
      state,
    });
  } catch (err) {
    console.error("PUT/PATCH /api/tenant/config error:", err);
    return jsonError("تعذر حفظ إعدادات مساحة المنشأة / Failed to save tenant admin config", 500);
  }
}

export const PUT = withTenantRoute(async function PUT(req: NextRequest) {
  return handleSaveTenantConfig(req);
});

export const PATCH = withTenantRoute(async function PATCH(req: NextRequest) {
  return handleSaveTenantConfig(req);
});

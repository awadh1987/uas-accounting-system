import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAuditDiffTx } from "@/lib/accounting/ledgerService";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getBootstrapState();
    return NextResponse.json({ enterpriseProfile: state.enterpriseProfile });
  } catch (error) {
    console.error("GET /api/system/branding error:", error);
    return jsonError("تعذر تحميل إعدادات الهوية البصرية", 500);
  }
}

async function handleUpdateBranding(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const auth = await authorizeApiAction(body, req, {
      moduleId: "system",
      action: "cms",
    });
    if (!auth.ok) return auth.response;

    const existing = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });

    const strOpt = (key: string) =>
      body[key] !== undefined ? String(body[key] ?? "").trim() : undefined;
    const nullableStrOpt = (key: string) =>
      body[key] !== undefined ? (body[key] ? String(body[key]).trim() : null) : undefined;
    const boolOpt = (key: string) =>
      body[key] !== undefined ? Boolean(body[key]) : undefined;

    const updateData = {
      isConfigured: true,
      ...(strOpt("legalNameAr") ? { legalNameAr: strOpt("legalNameAr") } : {}),
      ...(strOpt("legalNameEn") ? { legalNameEn: strOpt("legalNameEn") } : {}),
      ...(nullableStrOpt("taxNumber") !== undefined ? { taxNumber: nullableStrOpt("taxNumber") } : {}),
      ...(nullableStrOpt("commercialReg") !== undefined
        ? { commercialReg: nullableStrOpt("commercialReg") }
        : {}),
      ...(strOpt("currencyCode") ? { currencyCode: strOpt("currencyCode") } : {}),
      ...(nullableStrOpt("address") !== undefined ? { address: nullableStrOpt("address") } : {}),
      ...(nullableStrOpt("phone") !== undefined ? { phone: nullableStrOpt("phone") } : {}),
      ...(nullableStrOpt("email") !== undefined ? { email: nullableStrOpt("email") } : {}),
      ...(nullableStrOpt("logoUrl") !== undefined ? { logoUrl: nullableStrOpt("logoUrl") } : {}),
      ...(strOpt("brandColor") ? { brandColor: strOpt("brandColor") } : {}),
      ...(boolOpt("showUasLogo") !== undefined ? { showUasLogo: boolOpt("showUasLogo") } : {}),
      ...(strOpt("uasLogoStyle") ? { uasLogoStyle: strOpt("uasLogoStyle") } : {}),
      ...(nullableStrOpt("uasLogoCustomUrl") !== undefined
        ? { uasLogoCustomUrl: nullableStrOpt("uasLogoCustomUrl") }
        : {}),
      ...(boolOpt("showEnterpriseLogo") !== undefined
        ? { showEnterpriseLogo: boolOpt("showEnterpriseLogo") }
        : {}),
      ...(strOpt("enterpriseLogoStyle") ? { enterpriseLogoStyle: strOpt("enterpriseLogoStyle") } : {}),
      ...(nullableStrOpt("enterpriseLogoCustomUrl") !== undefined
        ? { enterpriseLogoCustomUrl: nullableStrOpt("enterpriseLogoCustomUrl") }
        : {}),
      ...(strOpt("heroBadgeAr") !== undefined ? { heroBadgeAr: strOpt("heroBadgeAr") } : {}),
      ...(strOpt("heroBadgeEn") !== undefined ? { heroBadgeEn: strOpt("heroBadgeEn") } : {}),
      ...(strOpt("heroTitleAr") !== undefined ? { heroTitleAr: strOpt("heroTitleAr") } : {}),
      ...(strOpt("heroTitleEn") !== undefined ? { heroTitleEn: strOpt("heroTitleEn") } : {}),
      ...(strOpt("heroSubtitleAr") !== undefined ? { heroSubtitleAr: strOpt("heroSubtitleAr") } : {}),
      ...(strOpt("heroSubtitleEn") !== undefined ? { heroSubtitleEn: strOpt("heroSubtitleEn") } : {}),
      ...(strOpt("aboutMissionAr") !== undefined ? { aboutMissionAr: strOpt("aboutMissionAr") } : {}),
      ...(strOpt("aboutMissionEn") !== undefined ? { aboutMissionEn: strOpt("aboutMissionEn") } : {}),
      ...(strOpt("contactPhone") !== undefined ? { contactPhone: strOpt("contactPhone") } : {}),
      ...(strOpt("contactWhatsApp") !== undefined ? { contactWhatsApp: strOpt("contactWhatsApp") } : {}),
      ...(strOpt("contactAddress") !== undefined ? { contactAddress: strOpt("contactAddress") } : {}),
      ...(boolOpt("showPublicMetrics") !== undefined
        ? { showPublicMetrics: boolOpt("showPublicMetrics") }
        : {}),
      ...(boolOpt("showPublicVerify") !== undefined
        ? { showPublicVerify: boolOpt("showPublicVerify") }
        : {}),
      ...(strOpt("ctaPrimaryTextAr") !== undefined
        ? { ctaPrimaryTextAr: strOpt("ctaPrimaryTextAr") }
        : {}),
      ...(strOpt("ctaPrimaryTextEn") !== undefined
        ? { ctaPrimaryTextEn: strOpt("ctaPrimaryTextEn") }
        : {}),
    };

    const updated = await prisma.$transaction(async (tx) => {
      const profile = await tx.enterpriseProfile.upsert({
        where: { id: "default" },
        update: updateData,
        create: {
          id: "default",
          legalNameAr: strOpt("legalNameAr") || "اسم المنشأة",
          legalNameEn:
            strOpt("legalNameEn") || "Enterprise Name",
          currencyCode: strOpt("currencyCode") || "YER",
          brandColor: strOpt("brandColor") || "#059669",
          ...updateData,
        },
      });

      await recordAuditDiffTx(tx, {
        userId: auth.actor.userId,
        action: "UPDATE",
        entity: "EnterpriseProfile",
        entityId: "default",
        before: existing
          ? {
              legalNameAr: existing.legalNameAr,
              showUasLogo: existing.showUasLogo,
              showEnterpriseLogo: existing.showEnterpriseLogo,
              heroTitleAr: existing.heroTitleAr,
            }
          : null,
        after: {
          legalNameAr: profile.legalNameAr,
          showUasLogo: profile.showUasLogo,
          showEnterpriseLogo: profile.showEnterpriseLogo,
          heroTitleAr: profile.heroTitleAr,
        },
      });

      await appendAuditLogTx(tx, {
        ...auth.actor,
        actionType: "تحديث الهوية البصرية وبوابة CMS",
        entityReference: "enterprise_profile",
        details: `تحديث بيانات المؤسسة (${profile.legalNameAr}) وإعدادات الشعار وبوابة الواجهة`,
      });

      return profile;
    });

    const state = await getBootstrapState();
    return NextResponse.json({ enterpriseProfile: updated, state });
  } catch (error) {
    console.error("PUT /api/system/branding error:", error);
    return jsonError("تعذر حفظ إعدادات الهوية البصرية وبوابة CMS", 500);
  }
}

export async function PUT(req: NextRequest) {
  return handleUpdateBranding(req);
}

export async function PATCH(req: NextRequest) {
  return handleUpdateBranding(req);
}


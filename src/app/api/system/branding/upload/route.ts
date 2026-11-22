import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { authorizeApiAction, jsonError } from "@/lib/apiHelpers";
import { appendAuditLogTx, getBootstrapState } from "@/lib/serverBootstrap";
import { getActiveTenantId, getTenantMetadata } from "@/lib/tenant";
import {
  decodeDataUrlAsset,
  deleteTenantBrandAssetFile,
  normalizeAssetMimeType,
  saveTenantBrandAssetFile,
  type TenantBrandAssetKind,
} from "@/lib/brandingAssets";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    let kind: TenantBrandAssetKind = "logo";
    let assetBuffer: Buffer | null = null;
    let mimeInfo: { contentType: string; ext: string } | null = null;
    let bodyForAuth: Record<string, unknown> = {};

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const rawKind = String(formData.get("kind") || "logo").trim().toLowerCase();
      kind = rawKind === "favicon" ? "favicon" : "logo";
      const fileEntry = formData.get("file");
      if (fileEntry && typeof fileEntry === "object" && "arrayBuffer" in fileEntry) {
        const file = fileEntry as File;
        mimeInfo = normalizeAssetMimeType(file.type, file.name);
        assetBuffer = Buffer.from(await file.arrayBuffer());
      }
      const actorRaw = formData.get("actor");
      if (typeof actorRaw === "string" && actorRaw.trim()) {
        try {
          bodyForAuth = { actor: JSON.parse(actorRaw) };
        } catch {
          bodyForAuth = {};
        }
      }
    } else {
      const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      bodyForAuth = json;
      const rawKind = String(json.kind || "logo").trim().toLowerCase();
      kind = rawKind === "favicon" ? "favicon" : "logo";
      const dataUrl = typeof json.dataUrl === "string" ? json.dataUrl : "";
      const decoded = decodeDataUrlAsset(dataUrl);
      if (decoded) {
        assetBuffer = decoded.buffer;
        mimeInfo = { contentType: decoded.contentType, ext: decoded.ext };
      }
    }

    const auth = await authorizeApiAction(bodyForAuth, req, {
      moduleId: "system",
      action: "cms",
    });
    if (!auth.ok) return auth.response;

    if (!assetBuffer || !mimeInfo) {
      return jsonError(
        "ملف الشعار أو الأيقونة غير صالح أو يتجاوز الحد المسموح (1 ميجابايت) / Invalid or oversized image file (max 1MB)",
        400
      );
    }

    const tenantId = getActiveTenantId();
    const meta = getTenantMetadata(tenantId);
    const existing = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
    const tenantKey = existing?.tenantSlug || meta?.slug || tenantId;

    const savedFile = saveTenantBrandAssetFile({
      tenantKey,
      kind,
      buffer: assetBuffer,
      contentType: mimeInfo.contentType,
      ext: mimeInfo.ext,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const patch =
        kind === "favicon"
          ? {
              isConfigured: true,
              faviconUrl: savedFile.publicUrl,
            }
          : {
              isConfigured: true,
              logoUrl: savedFile.publicUrl,
              enterpriseLogoCustomUrl: savedFile.publicUrl,
              enterpriseLogoStyle: "custom",
              showEnterpriseLogo: true,
            };

      const profile = await tx.enterpriseProfile.upsert({
        where: { id: "default" },
        update: patch,
        create: {
          id: "default",
          legalNameAr: meta?.nameAr || "اسم المنشأة",
          legalNameEn: meta?.nameEn || "Enterprise Name",
          tenantSlug: meta?.slug && meta.slug !== "default" ? meta.slug : null,
          ...patch,
        },
      });

      await appendAuditLogTx(tx, {
        ...auth.actor,
        actionType: kind === "favicon" ? "تحديث أيقونة المتصفح للمنشأة" : "تحديث شعار المنشأة المخصص",
        entityReference: "enterprise_profile",
        details: `رفع وحفظ ${kind === "favicon" ? "Favicon" : "Logo"} مخصص لنطاق المنشأة (${tenantKey})`,
      });

      return profile;
    });

    const state = await getBootstrapState();
    return NextResponse.json({
      success: true,
      kind,
      assetUrl: savedFile.publicUrl,
      enterpriseProfile: updated,
      state,
    });
  } catch (err) {
    console.error("POST /api/system/branding/upload error:", err);
    return jsonError("تعذر رفع وحفظ ملف الهوية البصرية / Failed to upload brand asset", 500);
  }
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    const auth = await authorizeApiAction({}, req, {
      moduleId: "system",
      action: "cms",
    });
    if (!auth.ok) return auth.response;

    const url = new URL(req.url, "http://localhost");
    const rawKind = (url.searchParams.get("kind") || "all").trim().toLowerCase();
    const kind: TenantBrandAssetKind | "all" =
      rawKind === "logo" ? "logo" : rawKind === "favicon" ? "favicon" : "all";

    const tenantId = getActiveTenantId();
    const meta = getTenantMetadata(tenantId);
    const existing = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
    const tenantKey = existing?.tenantSlug || meta?.slug || tenantId;

    deleteTenantBrandAssetFile(tenantKey, kind);

    const updated = await prisma.$transaction(async (tx) => {
      const resetData =
        kind === "favicon"
          ? { faviconUrl: null }
          : kind === "logo"
          ? {
              logoUrl: "/uas-logo.png",
              enterpriseLogoCustomUrl: null,
              enterpriseLogoStyle: "agri-leaf",
              showEnterpriseLogo: false,
            }
          : {
              logoUrl: "/uas-logo.png",
              faviconUrl: null,
              enterpriseLogoCustomUrl: null,
              enterpriseLogoStyle: "agri-leaf",
              showEnterpriseLogo: false,
              showUasLogo: true,
              uasLogoStyle: "official-brand",
              uasLogoCustomUrl: "/uas-logo.png",
              taglineAr: "",
              taglineEn: "",
            };

      const profile = await tx.enterpriseProfile.upsert({
        where: { id: "default" },
        update: resetData,
        create: {
          id: "default",
          legalNameAr: meta?.nameAr || "اسم المنشأة",
          legalNameEn: meta?.nameEn || "Enterprise Name",
          tenantSlug: meta?.slug && meta.slug !== "default" ? meta.slug : null,
          ...resetData,
        },
      });

      await appendAuditLogTx(tx, {
        ...auth.actor,
        actionType: "استعادة هوية UAS الافتراضية",
        entityReference: "enterprise_profile",
        details: `إزالة الأصول المخصصة (${kind}) والعودة إلى هوية UAS الافتراضية`,
      });

      return profile;
    });

    const state = await getBootstrapState();
    return NextResponse.json({
      success: true,
      kind,
      enterpriseProfile: updated,
      state,
    });
  } catch (err) {
    console.error("DELETE /api/system/branding/upload error:", err);
    return jsonError("تعذر استعادة الهوية الافتراضية / Failed to reset brand assets", 500);
  }
});

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isPlatformAdminSurfaceEnabled } from "@/lib/buildTarget";
import {
  buildTenantWorkspaceUrl,
  ensureTenantRegistered,
  extractTenantResolutionFromRequest,
  findTenantBySlug,
  generateTenantSlug,
  getTenantMetadata,
  getTenantPrisma,
  listExistingSlugs,
  normalizeTenantId,
  registerTenant,
  runWithTenant,
  unregisterTenant,
  validateTenantSlug,
} from "@/lib/tenant";
import {
  corsOptionsResponse,
  forbiddenError,
  jsonError,
  resolveVerifiedActor,
  unauthorizedError,
} from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

function timingSafeMatch(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * GET /api/tenants/provision?name=...&preferredSlug=...
 * Previews derived/validated ASCII lowercase slug (3–32 chars, reserved-word guarded)
 * and collision disambiguation before key issuance or tenant provisioning.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url, "http://localhost");
    const name = (searchParams.get("name") || searchParams.get("companyName") || "").trim();
    const preferredSlug = (searchParams.get("preferredSlug") || searchParams.get("slug") || "").trim();

    if (!name && !preferredSlug) {
      return jsonError("يرجى تمرير اسم المنشأة أو النطاق الفرعي المقترح / name or preferredSlug is required", 400);
    }

    const explicitValidation = preferredSlug ? validateTenantSlug(preferredSlug) : null;
    const existingSlugs = listExistingSlugs();
    const generated = generateTenantSlug(name || preferredSlug, {
      existingSlugs,
      preferredSlug: explicitValidation?.valid ? explicitValidation.normalized : undefined,
    });

    return NextResponse.json({
      success: true,
      slug: generated.slug,
      tenantUrl: generated.url,
      collisionAdjusted: generated.collisionAdjusted,
      validation: explicitValidation || validateTenantSlug(generated.slug),
    });
  } catch (err) {
    console.error("GET /api/tenants/provision error:", err);
    return jsonError("تعذر معاينة النطاق الفرعي للمنشأة", 500);
  }
}

/**
 * POST /api/tenants/provision
 * Platform-level provisioning endpoint (guarded by UAS_VENDOR_ADMIN_TOKEN or root default SUPER_ADMIN).
 */
export async function POST(req: NextRequest) {
  try {
    if (!isPlatformAdminSurfaceEnabled()) {
      return forbiddenError(
        "⛔ تجهيز مساحات المنشآت متاح في المنصة السحابية الرئيسية فقط / Tenant provisioning is restricted to the cloud platform"
      );
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const adminToken = (process.env.UAS_VENDOR_ADMIN_TOKEN || "").trim();
    const authHeader = req.headers.get("authorization") || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    const hasVendorToken = Boolean(adminToken && bearer && timingSafeMatch(adminToken, bearer));

    if (!hasVendorToken) {
      // Inspect only request host/headers/session (never body.companyName) for caller tenant scope
      const callerResolution = extractTenantResolutionFromRequest(req);
      const actor = await runWithTenant("default", () => resolveVerifiedActor({}, req));

      if (actor.spoofAttempt || actor.tenantMismatch || actor.inactive) {
        return forbiddenError(
          "⛔ إنشاء مساحات المنشآت السحابية محصور بمسؤول المنصة / Platform provisioning authorization required"
        );
      }

      if (!actor.authenticated || !actor.userId) {
        return unauthorizedError(
          "غير مصرح: يرجى تسجيل الدخول كمسؤول منصة (SUPER_ADMIN) / Authentication required"
        );
      }

      const isRootSuperAdmin =
        callerResolution.tenantId === "default" && actor.userRole === "SUPER_ADMIN";

      if (!isRootSuperAdmin) {
        return forbiddenError(
          "⛔ إنشاء مساحات المنشآت السحابية محصور بمسؤول المنصة / Platform provisioning authorization required"
        );
      }
    }

    const companyName = String(body.companyName || body.nameAr || body.nameEn || "").trim();
    const nameAr = String(body.nameAr || companyName).trim();
    const nameEn = String(body.nameEn || companyName).trim();
    const preferredSlug = typeof body.slug === "string" ? body.slug.trim() : "";
    const maxSeats = Math.max(1, Number(body.maxSeats || 10));
    const allowExisting = body.allowExisting === true;

    if (!companyName && !preferredSlug) {
      return jsonError("اسم المنشأة أو النطاق الفرعي مطلوب / companyName or slug is required", 400);
    }

    if (preferredSlug) {
      const check = validateTenantSlug(preferredSlug);
      if (!check.valid) {
        return NextResponse.json({ success: false, code: "INVALID_SLUG", error: check.error }, { status: 400 });
      }
      const existing = findTenantBySlug(check.normalized);
      if (existing && !allowExisting) {
        return NextResponse.json(
          {
            success: false,
            code: "SLUG_TAKEN",
            error: `النطاق الفرعي "${check.normalized}" مستخدم بالفعل / Subdomain slug already exists`,
          },
          { status: 409 }
        );
      }
    }

    const adminUsername = typeof body.adminUsername === "string" ? body.adminUsername.trim() : "";
    const adminEmail = typeof body.adminEmail === "string" ? body.adminEmail.trim().toLowerCase() : "";
    const adminPassword = typeof body.adminPassword === "string" ? body.adminPassword : "";
    const adminName = typeof body.adminName === "string" ? body.adminName.trim() : "";

    if (adminPassword && adminPassword.trim().length < 6) {
      return jsonError("كلمة مرور مدير المنشأة يجب أن تكون 6 أحرف على الأقل / adminPassword must be at least 6 chars", 400);
    }

    const existingSlugs = listExistingSlugs();
    const normalizedPreferred = preferredSlug ? preferredSlug.toLowerCase() : undefined;
    if (allowExisting && normalizedPreferred) {
      existingSlugs.delete(normalizedPreferred);
    }

    const generated = generateTenantSlug(nameEn || companyName || preferredSlug, {
      existingSlugs,
      preferredSlug: normalizedPreferred,
    });
    const tenantId = normalizeTenantId(generated.slug);
    const previousMeta = getTenantMetadata(tenantId);

    const meta = ensureTenantRegistered(tenantId, companyName || generated.slug, {
      slug: generated.slug,
      nameAr: nameAr || companyName || generated.slug,
      nameEn: nameEn || companyName || generated.slug,
      licenseId: typeof body.licenseId === "string" ? body.licenseId : undefined,
      maxSeats,
    });

    let tenantPrisma;
    try {
      // Provision isolated database/schema immediately (re-initializing if allowExisting=true)
      tenantPrisma = await getTenantPrisma(meta.tenantId, {
        adminUsername: adminUsername || undefined,
        adminEmail: adminEmail || undefined,
        adminPassword: adminPassword || undefined,
        adminName: adminName || undefined,
        forceReinitialize: allowExisting,
      });

      await tenantPrisma.enterpriseProfile.updateMany({
        where: { id: "default" },
        data: {
          tenantSlug: meta.slug,
          legalNameAr: meta.nameAr || meta.companyName,
          legalNameEn: meta.nameEn || meta.companyName,
        },
      });
    } catch (initErr) {
      if (!previousMeta && !allowExisting) {
        unregisterTenant(meta.tenantId);
      } else if (previousMeta) {
        registerTenant({
          tenantId: previousMeta.tenantId,
          companyName: previousMeta.companyName,
          slug: previousMeta.slug,
          nameAr: previousMeta.nameAr,
          nameEn: previousMeta.nameEn,
          tenantUrl: previousMeta.tenantUrl,
          licenseId: previousMeta.licenseId,
          maxSeats: previousMeta.maxSeats,
          schemaOrDb: previousMeta.schemaOrDb,
        });
      }
      throw initErr;
    }

    const seededAdmin = await tenantPrisma.user.findFirst({
      where: {
        role: "SUPER_ADMIN",
        active: true,
        isActive: true,
        ...(adminEmail ? { email: adminEmail } : adminUsername ? { username: adminUsername } : {}),
      },
      select: { id: true, username: true, email: true, role: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      {
        success: true,
        slug: meta.slug,
        tenantId: meta.tenantId,
        tenantUrl: meta.tenantUrl || buildTenantWorkspaceUrl(meta.slug),
        collisionAdjusted: generated.collisionAdjusted,
        tenant: { ...meta, maxSeats },
        adminAccount: seededAdmin,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/tenants/provision error:", err);
    return jsonError("تعذر تهيئة مساحة المنشأة المستقلة / Failed to provision tenant workspace", 500);
  }
}

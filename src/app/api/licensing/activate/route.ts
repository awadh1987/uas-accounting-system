import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { validateLicenseStructure, type SeatPlatform, type UasSignedLicense } from "@/lib/licensing/licenseSchema";
import { verifyLicense, saveInstalledLicense } from "@/lib/licensing/verifier";
import { getMachineHwid } from "@/lib/licensing/hwid";
import { getRuntimeConfig } from "@/lib/runtimeMode";
import { createPrismaSeatStore } from "@/lib/licensing/prismaSeatStore";
import { createPrismaProfileRepo } from "@/lib/licensing/companyLockServer";
import { enforceActivationPolicy } from "@/lib/licensing/activationPolicy";
import { normalizePlatform } from "@/lib/licensing/seatService";
import {
  buildTenantWorkspaceUrl,
  ensureTenantRegistered,
  findTenantBySlug,
  generateTenantSlug,
  getTenantPrisma,
  listExistingSlugs,
  normalizeTenantId,
} from "@/lib/tenant";

export const dynamic = "force-dynamic";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    let licenseObj: UasSignedLicense | null = null;
    let confirmCompanyName = "";
    let userEmail = "";
    let platform: SeatPlatform = "windows";
    let customHwid = "";
    let deviceName = "";
    let onlineError: { status?: number; code?: string; error?: string } | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      confirmCompanyName = String(formData.get("companyName") || formData.get("company_name") || "").trim();
      userEmail = String(formData.get("userEmail") || formData.get("user_email") || "").trim();
      platform = normalizePlatform(String(formData.get("platform") || "windows")) || "windows";
      customHwid = String(formData.get("hwid") || formData.get("deviceId") || "").trim();
      deviceName = String(formData.get("deviceName") || formData.get("device_name") || "").trim();
      const file = formData.get("licenseFile") as File | null;
      if (file) {
        const text = await file.text();
        licenseObj = validateLicenseStructure(JSON.parse(text));
      }
    } else {
      const body = await req.json();
      confirmCompanyName = String(body.companyName || body.company_name || "").trim();
      userEmail = String(body.userEmail || body.user_email || "").trim();
      platform = normalizePlatform(String(body.platform || "windows")) || "windows";
      customHwid = String(body.hwid || body.deviceId || "").trim();
      deviceName = String(body.deviceName || body.device_name || "").trim();

      if (body.licenseFileContent) {
        const text = typeof body.licenseFileContent === "string"
          ? body.licenseFileContent
          : JSON.stringify(body.licenseFileContent);
        licenseObj = validateLicenseStructure(JSON.parse(text));
      } else if (body.activationKey) {
        const key = String(body.activationKey).trim();
        if (key.startsWith("UASKEY-")) {
          try {
            const b64 = key.replace("UASKEY-", "");
            const decoded = Buffer.from(b64, "base64").toString("utf8");
            licenseObj = validateLicenseStructure(JSON.parse(decoded));
          } catch {
            licenseObj = null;
          }
        }

        // Query online activation server (always https://qat.world unless UAS_ACTIVATION_URL is overridden)
        // when key is an online key or when online verification is explicitly requested.
        const envActivationUrl = (process.env.UAS_ACTIVATION_URL || "").trim().replace(/\/+$/, "");
        const shouldQueryOnline = !key.startsWith("UASKEY-") || Boolean(envActivationUrl) || body.verifyOnline === true;
        if (shouldQueryOnline) {
          try {
            const serverBase =
              envActivationUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(envActivationUrl)
                ? envActivationUrl
                : "https://qat.world";
            const seatHwid = customHwid || getMachineHwid();
            const res = await fetch(`${serverBase}/api/licensing/verify-key`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                key,
                company_name: confirmCompanyName || licenseObj?.company_name || "",
                user_email: userEmail,
                platform,
                hwid: seatHwid,
                device_name: deviceName || undefined,
              }),
              signal: AbortSignal.timeout(8000),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              if (data.license) {
                licenseObj = validateLicenseStructure(data.license);
              }
            } else {
              onlineError = { status: res.status, code: data?.code, error: data?.error };
              // If the cloud authority explicitly rejected the company name or seat quota, stop immediately
              if (res.status === 403 || res.status === 409) {
                return NextResponse.json(
                  {
                    success: false,
                    code: data?.code,
                    error: data?.error || "فشل التحقق عبر الخادم السحابي / Cloud license verification failed",
                  },
                  { status: res.status }
                );
              }
            }
          } catch (e: any) {
            console.error("[Licensing Activation] Online activation check error:", e);
          }
        }
      }
    }

    if (!licenseObj) {
      return NextResponse.json(
        {
          success: false,
          code: onlineError?.code,
          error:
            onlineError?.error ||
            "بيانات ملف الترخيص أو مفتاح التفعيل غير صالحة. / Invalid license payload or activation key format.",
        },
        { status: onlineError?.status || (onlineError?.code === "COMPANY_MISMATCH" ? 403 : 400) }
      );
    }

    // Verify cryptographic signature, HWID match, and expiry
    const runtimeConfig = getRuntimeConfig();
    const verification = verifyLicense(licenseObj, runtimeConfig.mode);

    if (!verification.valid) {
      return NextResponse.json(
        {
          success: false,
          status: verification.status,
          error: verification.error || "فشل التحقق من صلاحية الترخيص / License verification failed",
        },
        { status: 400 }
      );
    }

    const currentHwid = getMachineHwid();
    const seatHwid = (customHwid || currentHwid).toUpperCase();

    // Company-name lock (EnterpriseProfile) + activating user's seat (7 users × 1 Windows + 1 Android)
    const policy = await enforceActivationPolicy(
      {
        license: licenseObj,
        confirmCompanyName,
        userEmail,
        platform,
        hwid: seatHwid,
        deviceName: deviceName || process.env.COMPUTERNAME || process.env.HOSTNAME || undefined,
      },
      { profileRepo: createPrismaProfileRepo(), seatStore: createPrismaSeatStore() }
    );
    if (!policy.ok) {
      return NextResponse.json(
        { success: false, code: policy.code, error: policy.error },
        { status: policy.status }
      );
    }

    // Persist to disk (C:\UAS-Data\license.uas or local license.uas)
    const savedPath = saveInstalledLicense(licenseObj);

    // Update Database LicenseState
    const now = new Date();
    await prisma.licenseState.upsert({
      where: { id: "active" },
      update: {
        licenseId: licenseObj.license_id,
        customerName: licenseObj.customer_name,
        hwidHash: currentHwid,
        lastVerifiedUtc: now,
        status: "ACTIVE",
        licenseDataJson: JSON.stringify(licenseObj),
      },
      create: {
        id: "active",
        licenseId: licenseObj.license_id,
        customerName: licenseObj.customer_name,
        hwidHash: currentHwid,
        lastVerifiedUtc: now,
        status: "ACTIVE",
        licenseDataJson: JSON.stringify(licenseObj),
      },
    });

    // Persist tenant subdomain mapping & provision isolated DB/schema when slug or company name is present
    let tenantSlug = licenseObj.tenant_slug || null;
    let tenantUrl = licenseObj.tenant_url || null;
    const companyForTenant = (licenseObj.company_name || licenseObj.customer_name || confirmCompanyName || "").trim();
    if (companyForTenant) {
      try {
        const existingBySlug = tenantSlug ? findTenantBySlug(tenantSlug) : null;
        const resolvedSlug =
          tenantSlug ||
          existingBySlug?.slug ||
          generateTenantSlug(licenseObj.name_en || companyForTenant, {
            existingSlugs: listExistingSlugs(),
          }).slug;
        const tenantId = existingBySlug?.tenantId || normalizeTenantId(resolvedSlug);
        const meta = ensureTenantRegistered(tenantId, companyForTenant, {
          slug: resolvedSlug,
          nameAr: licenseObj.name_ar || companyForTenant,
          nameEn: licenseObj.name_en || companyForTenant,
          licenseId: licenseObj.license_id,
        });
        await getTenantPrisma(meta.tenantId);
        tenantSlug = meta.slug;
        tenantUrl = meta.tenantUrl || buildTenantWorkspaceUrl(meta.slug);
      } catch (tenantErr) {
        console.warn("[Licensing Activate] Non-fatal tenant registration notice:", tenantErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: "تم تفعيل الترخيص بنجاح وتوثيقه مشفراً على هذا الجهاز / License activated successfully and bound to this hardware.",
      saved_path: savedPath,
      license: licenseObj,
      tenant_slug: tenantSlug,
      tenant_url: tenantUrl,
      company_lock: policy.companyLock,
      seat: policy.seat
        ? {
            user_email: policy.seat.binding.userEmail,
            platform: policy.seat.binding.platform,
            hwid: policy.seat.binding.hwid,
            status: policy.seat.status,
          }
        : null,
    });
  } catch (err: any) {
    console.error("[Licensing Activation Error]:", err);
    return NextResponse.json(
      {
        success: false,
        error: `خطأ أثناء معالجة التفعيل: ${err?.message || "Unknown error"}`,
      },
      { status: 500 }
    );
  }
});

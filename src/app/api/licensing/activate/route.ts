import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { ensureSqliteDatabaseReady, isSqliteRuntime } from "@/lib/sqliteBootstrap";
import {
  validateLicenseStructure,
  type SeatPlatform,
  type UasSignedLicense,
} from "@/lib/licensing/licenseSchema";
import {
  loadInstalledLicense,
  resolveTenantLicensePath,
  saveInstalledLicense,
  verifyLicense,
} from "@/lib/licensing/verifier";
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
  getActiveTenantId,
  getTenantMetadata,
  getTenantPrisma,
  listExistingSlugs,
  normalizeTenantId,
  runWithTenant,
} from "@/lib/tenant";

export const dynamic = "force-dynamic";

function decodeUasKeyToken(rawKey: string): UasSignedLicense | null {
  const key = rawKey.trim();
  if (!/^UASKEY-/i.test(key)) return null;
  const b64 = key.replace(/^UASKEY-/i, "").trim();
  for (const encoding of ["base64", "base64url"] as const) {
    try {
      const decoded = Buffer.from(b64, encoding).toString("utf8");
      const parsed = validateLicenseStructure(JSON.parse(decoded));
      if (parsed) return parsed;
    } catch {
      // Try next encoding
    }
  }
  return null;
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    if (isSqliteRuntime()) {
      await ensureSqliteDatabaseReady();
    }

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
      const body = (await req.json()) as Record<string, unknown>;
      confirmCompanyName = String(body.companyName || body.company_name || "").trim();
      userEmail = String(body.userEmail || body.user_email || "").trim();
      platform = normalizePlatform(String(body.platform || "windows")) || "windows";
      customHwid = String(body.hwid || body.deviceId || "").trim();
      deviceName = String(body.deviceName || body.device_name || "").trim();

      if (body.licenseFileContent) {
        const text =
          typeof body.licenseFileContent === "string"
            ? body.licenseFileContent
            : JSON.stringify(body.licenseFileContent);
        licenseObj = validateLicenseStructure(JSON.parse(text));
      } else if (body.activationKey) {
        const key = String(body.activationKey).trim();
        licenseObj = decodeUasKeyToken(key);

        // Query online activation server only for non-UASKEY keys or when explicitly configured/requested.
        const envActivationUrl = (process.env.UAS_ACTIVATION_URL || "").trim().replace(/\/+$/, "");
        const shouldQueryOnline =
          !/^UASKEY-/i.test(key) || Boolean(envActivationUrl) || body.verifyOnline === true;
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
            const data = (await res.json().catch(() => ({}))) as {
              license?: unknown;
              code?: string;
              error?: string;
            };
            if (res.ok) {
              if (data.license) {
                licenseObj = validateLicenseStructure(data.license) || licenseObj;
              }
            } else {
              onlineError = { status: res.status, code: data?.code, error: data?.error };
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
          } catch (err: unknown) {
            console.error("[Licensing Activation] Online activation check error:", err);
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

    // Verify cryptographic signature (against UAS_LICENSE_PUBLIC_KEY), HWID match, expiry, and mode
    const runtimeConfig = getRuntimeConfig();
    const verification = verifyLicense(licenseObj, runtimeConfig.mode);

    if (!verification.valid) {
      return NextResponse.json(
        {
          success: false,
          status: verification.status,
          code: `LICENSE_${verification.status}`,
          error: verification.error || "فشل التحقق من صلاحية الترخيص / License verification failed",
        },
        { status: 400 }
      );
    }

    // Validate tenant_slug matching when activating inside a non-default tenant workspace
    const activeTenantId = getActiveTenantId();
    const activeMeta = getTenantMetadata(activeTenantId);
    const activeSlug = activeMeta?.slug || (activeTenantId === "default" ? "default" : activeTenantId);

    if (activeTenantId !== "default" && licenseObj.tenant_slug) {
      const licSlugClean = licenseObj.tenant_slug.trim().toLowerCase();
      const licNormId = normalizeTenantId(licSlugClean);
      if (licNormId !== activeTenantId && licSlugClean !== activeSlug.trim().toLowerCase()) {
        return NextResponse.json(
          {
            success: false,
            code: "TENANT_MISMATCH",
            error: `الترخيص مخصص للمنشأة (${licSlugClean}) ولا يطابق مساحة المنشأة الحالية (${activeSlug}) / License tenant_slug does not match target workspace.`,
          },
          { status: 403 }
        );
      }
    }

    // Determine target tenant for storage & DB state
    let targetTenantId = activeTenantId;
    let tenantSlug: string | null = licenseObj.tenant_slug || (activeTenantId !== "default" ? activeSlug : null);
    let tenantUrl: string | null = licenseObj.tenant_url || (tenantSlug ? buildTenantWorkspaceUrl(tenantSlug) : null);

    const companyForTenant = (licenseObj.company_name || licenseObj.customer_name || confirmCompanyName || "").trim();
    if (activeTenantId === "default" && licenseObj.tenant_slug) {
      const existingBySlug = findTenantBySlug(licenseObj.tenant_slug);
      const resolvedSlug = existingBySlug?.slug || licenseObj.tenant_slug.trim().toLowerCase();
      const resolvedId = existingBySlug?.tenantId || normalizeTenantId(resolvedSlug);
      const meta = ensureTenantRegistered(resolvedId, companyForTenant || resolvedSlug, {
        slug: resolvedSlug,
        nameAr: licenseObj.name_ar || companyForTenant || resolvedSlug,
        nameEn: licenseObj.name_en || companyForTenant || resolvedSlug,
        licenseId: licenseObj.license_id,
      });
      await getTenantPrisma(meta.tenantId);
      targetTenantId = meta.tenantId;
      tenantSlug = meta.slug;
      tenantUrl = meta.tenantUrl || buildTenantWorkspaceUrl(meta.slug);
    } else if (companyForTenant && activeTenantId === "default") {
      try {
        const resolvedSlug = generateTenantSlug(licenseObj.name_en || companyForTenant, {
          existingSlugs: listExistingSlugs(),
        }).slug;
        const meta = ensureTenantRegistered(normalizeTenantId(resolvedSlug), companyForTenant, {
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

    const currentHwid = getMachineHwid();
    const seatHwid = (customHwid || currentHwid).toUpperCase();

    return await runWithTenant(targetTenantId, async () => {
      const targetLicensePath = resolveTenantLicensePath(targetTenantId);
      const hadPriorFile = fs.existsSync(/*turbopackIgnore: true*/ targetLicensePath);
      const priorFileContent = hadPriorFile
        ? fs.readFileSync(/*turbopackIgnore: true*/ targetLicensePath, "utf8")
        : null;
      const priorLicenseLookup = loadInstalledLicense(targetTenantId);

      // Snapshot EnterpriseProfile & LicenseState before mutating so any write error rolls back cleanly
      const priorProfile = await prisma.enterpriseProfile.findUnique({ where: { id: "default" } });
      const priorLicenseState = await prisma.licenseState.findUnique({ where: { id: "active" } });

      // 1. Company-name lock (EnterpriseProfile) + activating user's seat
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

      // 2. Persist license file into persistent writable directory (`data/licenses/<tenantSlug>/license.uas`)
      let savedPath: string;
      try {
        savedPath = saveInstalledLicense(licenseObj, targetTenantId);
      } catch (fsErr: unknown) {
        // Roll back any profile mutation if disk write fails (e.g., EACCES / EPERM / EROFS)
        if (priorProfile) {
          await prisma.enterpriseProfile
            .update({
              where: { id: "default" },
              data: {
                legalNameAr: priorProfile.legalNameAr,
                legalNameEn: priorProfile.legalNameEn,
                isConfigured: priorProfile.isConfigured,
              },
            })
            .catch(() => {});
        }
        const errCode = (fsErr as NodeJS.ErrnoException)?.code;
        const msg = fsErr instanceof Error ? fsErr.message : String(fsErr);
        console.error("[Licensing Activation] Failed to write license file:", fsErr);
        return NextResponse.json(
          {
            success: false,
            code: errCode === "EACCES" || errCode === "EPERM" ? "LICENSE_STORAGE_PERMISSION_DENIED" : "LICENSE_STORAGE_UNWRITABLE",
            error: `تعذر حفظ ملف الترخيص على القرص (${path.basename(targetLicensePath)}): ${msg}`,
          },
          { status: errCode === "EACCES" || errCode === "EPERM" ? 403 : 500 }
        );
      }

      // 3. Update Database LicenseState (roll back written file if DB update fails)
      const now = new Date();
      try {
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
      } catch (dbErr) {
        try {
          if (hadPriorFile && priorFileContent !== null) {
            fs.writeFileSync(/*turbopackIgnore: true*/ savedPath, priorFileContent, "utf8");
          } else if (!priorLicenseLookup.license && fs.existsSync(/*turbopackIgnore: true*/ savedPath)) {
            fs.unlinkSync(/*turbopackIgnore: true*/ savedPath);
          }
          if (priorLicenseState) {
            await prisma.licenseState
              .update({
                where: { id: "active" },
                data: {
                  licenseId: priorLicenseState.licenseId,
                  customerName: priorLicenseState.customerName,
                  hwidHash: priorLicenseState.hwidHash,
                  lastVerifiedUtc: priorLicenseState.lastVerifiedUtc,
                  status: priorLicenseState.status,
                  licenseDataJson: priorLicenseState.licenseDataJson,
                },
              })
              .catch(() => {});
          }
        } catch {
          // Best-effort rollback
        }
        throw dbErr;
      }

      return NextResponse.json({
        success: true,
        license_status: "ACTIVE",
        is_valid: true,
        message:
          "تم تفعيل الترخيص بنجاح وتوثيقه مشفراً على هذا الجهاز / License activated successfully and bound to this workspace.",
        saved_path: savedPath,
        license: licenseObj,
        tenant_id: targetTenantId,
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
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Licensing Activation Error]:", err);
    return NextResponse.json(
      {
        success: false,
        error: `خطأ أثناء معالجة التفعيل: ${msg}`,
      },
      { status: 500 }
    );
  }
});

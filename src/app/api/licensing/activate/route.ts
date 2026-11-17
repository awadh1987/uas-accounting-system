import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { validateLicenseStructure, type UasSignedLicense } from "@/lib/licensing/licenseSchema";
import { verifyLicense, saveInstalledLicense } from "@/lib/licensing/verifier";
import { getMachineHwid } from "@/lib/licensing/hwid";
import { getRuntimeConfig } from "@/lib/runtimeMode";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();
    let licenseObj: UasSignedLicense | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("licenseFile") as File | null;
      if (file) {
        const text = await file.text();
        licenseObj = validateLicenseStructure(JSON.parse(text));
      }
    } else {
      const body = await req.json();
      if (body.licenseFileContent) {
        const text = typeof body.licenseFileContent === "string"
          ? body.licenseFileContent
          : JSON.stringify(body.licenseFileContent);
        licenseObj = validateLicenseStructure(JSON.parse(text));
      } else if (body.activationKey) {
        const key = String(body.activationKey).trim();
        if (key.startsWith("UASKEY-")) {
          const b64 = key.replace("UASKEY-", "");
          const decoded = Buffer.from(b64, "base64").toString("utf8");
          licenseObj = validateLicenseStructure(JSON.parse(decoded));
        } else {
          // Query online activation server (https://qat.world)
          try {
            const runtimeConfig = getRuntimeConfig();
            const serverBase = runtimeConfig.cloudUrl || "https://qat.world";
            const currentHwid = getMachineHwid();
            const res = await fetch(`${serverBase}/api/licensing/verify-key`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key, hwid: currentHwid }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.license) {
                licenseObj = validateLicenseStructure(data.license);
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
          error: "بيانات ملف الترخيص أو مفتاح التفعيل غير صالحة. / Invalid license payload or activation key format.",
        },
        { status: 400 }
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

    // Persist to disk (C:\UAS-Data\license.uas or local license.uas)
    const savedPath = saveInstalledLicense(licenseObj);

    // Update Database LicenseState
    const currentHwid = getMachineHwid();
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

    return NextResponse.json({
      success: true,
      message: "تم تفعيل الترخيص بنجاح وتوثيقه مشفراً على هذا الجهاز / License activated successfully and bound to this hardware.",
      saved_path: savedPath,
      license: licenseObj,
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
}

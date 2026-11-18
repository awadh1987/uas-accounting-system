import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import {
  companyNamesMatch,
  validateLicenseStructure,
  type UasSignedLicense,
} from "@/lib/licensing/licenseSchema";
import {
  loadInstalledLicense,
  verifyLicenseSignature,
} from "@/lib/licensing/verifier";
import { appendAuditLogTx, hashPassword } from "@/lib/serverBootstrap";
import { jsonError } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

interface RateLimitEntry {
  failedAttempts: number;
  firstFailedAt: number;
  blockedUntil: number;
}

// In-memory sliding window rate limiter for password recovery per IP
const recoveryAttempts = new Map<string, RateLimitEntry>();
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes block

function checkRateLimit(ip: string): { allowed: boolean; remainingMinutes?: number } {
  const now = Date.now();
  const entry = recoveryAttempts.get(ip);
  if (!entry) return { allowed: true };

  if (entry.blockedUntil > now) {
    const remaining = Math.ceil((entry.blockedUntil - now) / 60000);
    return { allowed: false, remainingMinutes: remaining };
  }

  // If window expired and not blocked, reset entry
  if (now - entry.firstFailedAt > WINDOW_MS && entry.blockedUntil <= now) {
    recoveryAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = recoveryAttempts.get(ip) || {
    failedAttempts: 0,
    firstFailedAt: now,
    blockedUntil: 0,
  };

  entry.failedAttempts += 1;
  if (entry.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_DURATION_MS;
  }
  recoveryAttempts.set(ip, entry);
}

function clearRateLimit(ip: string): void {
  recoveryAttempts.delete(ip);
}

export async function POST(req: NextRequest) {
  try {
    await ensureSqliteDatabaseReady();

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";

    // 1. Rate Limit Check
    const rateCheck = checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `تم تجاوز الحد الأقصى لمحاولات الاستعادة الفاشلة. تم حظر المحاولات مؤقتاً لمدة ${rateCheck.remainingMinutes} دقيقة لدواعي الأمان.`,
          code: "RATE_LIMITED",
        },
        { status: 429 }
      );
    }

    let companyName = "";
    let newPassword = "";
    let licenseObj: UasSignedLicense | null = null;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      companyName = String(formData.get("companyName") || formData.get("company_name") || "").trim();
      newPassword = String(formData.get("newPassword") || formData.get("password") || "").trim();

      const file = formData.get("licenseFile") as File | null;
      if (file) {
        try {
          const text = await file.text();
          licenseObj = validateLicenseStructure(JSON.parse(text));
        } catch {
          licenseObj = null;
        }
      } else if (formData.get("activationKey")) {
        const key = String(formData.get("activationKey")).trim();
        if (key.startsWith("UASKEY-")) {
          try {
            const b64 = key.replace("UASKEY-", "");
            const decoded = Buffer.from(b64, "base64").toString("utf8");
            licenseObj = validateLicenseStructure(JSON.parse(decoded));
          } catch {
            licenseObj = null;
          }
        }
      }
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      companyName = String(body.companyName || body.company_name || "").trim();
      newPassword = String(body.newPassword || body.password || "").trim();

      if (body.licenseFileContent) {
        try {
          const text =
            typeof body.licenseFileContent === "string"
              ? body.licenseFileContent
              : JSON.stringify(body.licenseFileContent);
          licenseObj = validateLicenseStructure(JSON.parse(text));
        } catch {
          licenseObj = null;
        }
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
      } else if (body.licenseData && typeof body.licenseData === "object") {
        licenseObj = validateLicenseStructure(body.licenseData);
      }
    }

    // 2. Validate Inputs
    if (!companyName) {
      return jsonError("يرجى إدخال اسم المنشأة المرخصة بالضبط", 400);
    }

    if (!newPassword || newPassword.length < 6) {
      return jsonError("كلمة المرور الجديدة يجب أن تتكون من 6 أحرف على الأقل", 400);
    }

    if (!licenseObj) {
      recordFailedAttempt(clientIp);
      return jsonError("يرجى رفع ملف الترخيص الرقمي (license.uas) أو إدخال رمز المفتاح (UASKEY-...)", 400);
    }

    // 3. Cryptographically Verify License Signature
    const isSignatureValid = verifyLicenseSignature(licenseObj);
    if (!isSignatureValid) {
      recordFailedAttempt(clientIp);
      return NextResponse.json(
        {
          error: "توقيع الترخيص الرقمي غير صالح أو تالف! لا يمكن استعادة كلمة المرور بدون إثبات تشفيري موثوق لملكية الترخيص.",
          code: "INVALID_LICENSE_SIGNATURE",
        },
        { status: 401 }
      );
    }

    // 4. Confirm License Matches Installed License
    const installed = loadInstalledLicense();
    if (installed.license) {
      if (installed.license.license_id !== licenseObj.license_id) {
        recordFailedAttempt(clientIp);
        return NextResponse.json(
          {
            error: `ملف الترخيص المقدم (${licenseObj.license_id}) لا يطابق الترخيص المثبت حالياً على النظام (${installed.license.license_id}).`,
            code: "LICENSE_ID_MISMATCH",
          },
          { status: 403 }
        );
      }
    }

    // 5. Confirm Company Name Matches License
    const licenseCompany = licenseObj.company_name || "";
    if (!companyNamesMatch(companyName, licenseCompany)) {
      recordFailedAttempt(clientIp);
      return NextResponse.json(
        {
          error: `اسم المنشأة المدخل (${companyName}) لا يطابق اسم المنشأة المعتمد في الترخيص الرقمي (${licenseCompany}).`,
          code: "COMPANY_NAME_MISMATCH",
        },
        { status: 403 }
      );
    }

    // 6. Find SUPER_ADMIN User
    const adminUser =
      (await prisma.user.findFirst({
        where: { role: "SUPER_ADMIN" },
      })) ||
      (await prisma.user.findFirst({
        where: { username: "admin" },
      }));

    if (!adminUser) {
      return jsonError("لم يتم العثور على حساب مدير النظام العام (SUPER_ADMIN) في قاعدة البيانات", 404);
    }

    // 7. Update Password & Activate Account
    const newHash = hashPassword(newPassword);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          passwordHash: newHash,
          active: true,
          isActive: true,
          mustChangePassword: false,
          passwordUpdatedAt: now,
        },
      });

      await appendAuditLogTx(tx, {
        userId: adminUser.id,
        userDisplay: `${adminUser.displayName || adminUser.name} (SUPER_ADMIN)`,
        userRole: "SUPER_ADMIN",
        actionType: "ADMIN_PASSWORD_RECOVERED_VIA_LICENSE",
        entityReference: adminUser.id,
        details: `تمت استعادة كلمة مرور مدير النظام بنجاح عبر إثبات ملكية الترخيص التشفيري ${licenseObj.license_id} للمنشأة (${licenseCompany}) من IP ${clientIp}`,
      });
    });

    // 8. Clear Failed Rate Limit on Success
    clearRateLimit(clientIp);

    return NextResponse.json({
      ok: true,
      message: "تمت استعادة كلمة مرور مدير النظام بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.",
      username: adminUser.username,
      email: adminUser.email,
    });
  } catch (error) {
    console.error("POST /api/auth/recover-admin error:", error);
    return jsonError(`تعذر استعادة كلمة المرور: ${(error as Error).message}`, 500);
  }
}

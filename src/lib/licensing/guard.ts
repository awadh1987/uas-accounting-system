import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { loadInstalledLicense, verifyLicense } from "./verifier";
import { getMachineHwid } from "./hwid";
import { isCompanyLockedPayload, type RuntimeMode, type UasSignedLicense } from "./licenseSchema";
import { evaluateCompanyLock } from "./companyLock";
import { createPrismaProfileRepo } from "./companyLockServer";

export interface ActiveSeatRecord {
  token: string;
  deviceName: string;
  ip: string;
  lastSeenUtc: string;
}

export interface LicenseGuardCheck {
  allowed: boolean;
  status: "ACTIVE" | "UNLICENSED" | "EXPIRED" | "HWID_MISMATCH" | "CLOCK_TAMPER" | "SEAT_LIMIT_REACHED" | "MODE_NOT_ALLOWED" | "COMPANY_MISMATCH";
  code?: string;
  error?: string;
  license?: UasSignedLicense | null;
  activeSeatsCount?: number;
  maxLanSeats?: number;
}

const SEAT_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes of inactivity

export async function checkLicenseAndClock(
  mode: RuntimeMode = "local",
  seatToken?: string,
  clientIp?: string,
  deviceName?: string
): Promise<LicenseGuardCheck> {
  await ensureSqliteDatabaseReady();
  const currentHwid = getMachineHwid();
  const { license } = loadInstalledLicense();

  // 1. Check if license is present
  if (!license) {
    return {
      allowed: false,
      status: "UNLICENSED",
      code: "LICENSE_MISSING",
      error: "المنظومة غير مفعلة بترخيص رسمي. يرجى تفعيل الترخيص للبدء في الاستخدام. / System is not activated with a valid license.",
    };
  }

  // 2. Cryptographic signature, HWID, expiration & mode check
  const verification = verifyLicense(license, mode);
  if (!verification.valid) {
    return {
      allowed: false,
      status: verification.status === "ACTIVE" ? "MODE_NOT_ALLOWED" : (verification.status as any),
      code: `LICENSE_${verification.status}`,
      error: verification.error,
      license,
    };
  }

  // 2b. Company-name lock check against EnterpriseProfile (v2 company-locked licenses)
  if (isCompanyLockedPayload(license) && license.company_name) {
    try {
      const profile = await createPrismaProfileRepo().get();
      const lockEval = evaluateCompanyLock(license.company_name, profile);
      if (lockEval.outcome === "MISMATCH") {
        return {
          allowed: false,
          status: "COMPANY_MISMATCH",
          code: "COMPANY_MISMATCH",
          error: lockEval.error,
          license,
        };
      }
    } catch (err) {
      console.error("[Licensing Guard] Company lock check warning:", err);
    }
  }

  // 3. Database State & Anti-Clock-Rollback Monotonic Verification
  const now = new Date();
  let dbState = null;
  try {
    dbState = await prisma.licenseState.findUnique({
      where: { id: "active" },
    });
  } catch (err) {
    console.error("[Licensing Guard] DB check warning:", err);
  }

  if (dbState) {
    // If flagged as CLOCK_TAMPER previously
    if (dbState.status === "CLOCK_TAMPER") {
      const last = new Date(dbState.lastVerifiedUtc);
      if (now.getTime() < last.getTime() - 5 * 60 * 1000) {
        return {
          allowed: false,
          status: "CLOCK_TAMPER",
          code: "LICENSE_CLOCK_TAMPER",
          error: "تم اكتشاف تلاعب بساعة وتاريخ النظام. تم إيقاف العمليات لتأمين البيانات المالية. / System clock rollback detected. Write operations blocked.",
          license,
        };
      }
    }

    // Check monotonic clock
    const last = new Date(dbState.lastVerifiedUtc);
    if (now.getTime() < last.getTime() - 5 * 60 * 1000) {
      try {
        await prisma.licenseState.update({
          where: { id: "active" },
          data: { status: "CLOCK_TAMPER" },
        });
      } catch {
        // ignore
      }
      return {
        allowed: false,
        status: "CLOCK_TAMPER",
        code: "LICENSE_CLOCK_TAMPER",
        error: "تم اكتشاف تراجع تاريخ وساعة النظام لتجاوز فترة الصلاحية. تم تجميد العمليات المحاسبية. / System clock rollback detected. Monotonic lock triggered.",
        license,
      };
    }
  }

  // 4. LAN Seat Allocation (if running in LAN mode)
  let activeSeatsCount = 1;
  const maxLanSeats = license.max_lan_seats || 5;

  if (mode === "lan" && seatToken) {
    let registry: ActiveSeatRecord[] = [];
    if (dbState?.seatRegistryJson) {
      try {
        const parsed = JSON.parse(dbState.seatRegistryJson);
        if (Array.isArray(parsed)) registry = parsed;
      } catch {
        registry = [];
      }
    }

    // Prune stale seats (> 15 minutes inactive)
    const nowMs = now.getTime();
    registry = registry.filter(
      (s) => nowMs - new Date(s.lastSeenUtc).getTime() < SEAT_EXPIRY_MS
    );

    const existingIndex = registry.findIndex((s) => s.token === seatToken);
    if (existingIndex >= 0) {
      // Seat already allocated: refresh timestamp
      registry[existingIndex].lastSeenUtc = now.toISOString();
      if (clientIp) registry[existingIndex].ip = clientIp;
      if (deviceName) registry[existingIndex].deviceName = deviceName;
    } else {
      // New seat attempting to connect
      if (registry.length >= maxLanSeats) {
        return {
          allowed: false,
          status: "SEAT_LIMIT_REACHED",
          code: "LICENSE_SEAT_LIMIT",
          error: `تم الوصول للحد الأقصى لعدد الأجهزة المتصلة بالشبكة المحلية (${maxLanSeats} أجهزة). يرجى ترقية الترخيص أو فصل أحد الأجهزة. / Maximum LAN seats (${maxLanSeats}) reached. Please upgrade your license or disconnect an inactive device.`,
          license,
          activeSeatsCount: registry.length,
          maxLanSeats,
        };
      }
      // Register new seat
      registry.push({
        token: seatToken,
        deviceName: deviceName || "Workstation",
        ip: clientIp || "LAN-Client",
        lastSeenUtc: now.toISOString(),
      });
    }

    activeSeatsCount = registry.length;

    // Persist updated seats and timestamp
    try {
      await prisma.licenseState.upsert({
        where: { id: "active" },
        update: {
          licenseId: license.license_id,
          customerName: license.customer_name,
          hwidHash: currentHwid,
          lastVerifiedUtc: now,
          status: "ACTIVE",
          seatRegistryJson: JSON.stringify(registry),
          licenseDataJson: JSON.stringify(license),
        },
        create: {
          id: "active",
          licenseId: license.license_id,
          customerName: license.customer_name,
          hwidHash: currentHwid,
          lastVerifiedUtc: now,
          status: "ACTIVE",
          seatRegistryJson: JSON.stringify(registry),
          licenseDataJson: JSON.stringify(license),
        },
      });
    } catch (e) {
      console.error("[Licensing Guard] Failed to update license state:", e);
    }
  } else {
    // Local / Cloud mode - persist heartbeat
    try {
      await prisma.licenseState.upsert({
        where: { id: "active" },
        update: {
          licenseId: license.license_id,
          customerName: license.customer_name,
          hwidHash: currentHwid,
          lastVerifiedUtc: now,
          status: "ACTIVE",
          licenseDataJson: JSON.stringify(license),
        },
        create: {
          id: "active",
          licenseId: license.license_id,
          customerName: license.customer_name,
          hwidHash: currentHwid,
          lastVerifiedUtc: now,
          status: "ACTIVE",
          licenseDataJson: JSON.stringify(license),
        },
      });
    } catch {
      // ignore
    }
  }

  return {
    allowed: true,
    status: "ACTIVE",
    license,
    activeSeatsCount,
    maxLanSeats,
  };
}

export async function assertWriteAllowed(
  req: NextRequest,
  mode: RuntimeMode = "local"
): Promise<NextResponse | null> {
  const method = req.method.toUpperCase();
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!isMutation) return null;

  // Exempt public verification and licensing activation endpoints from write blocks
  const pathname = req.nextUrl?.pathname || "";
  if (
    pathname.startsWith("/api/licensing/") ||
    pathname.startsWith("/api/public/") ||
    pathname === "/api/auth/login"
  ) {
    return null;
  }

  const seatToken = req.headers.get("x-uas-seat-token") || req.cookies.get("uas_seat")?.value;
  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
  const deviceName = req.headers.get("x-uas-device-name") || "Client";

  const result = await checkLicenseAndClock(mode, seatToken, clientIp, deviceName);
  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.error,
        code: result.code || `LICENSE_${result.status}`,
        status: result.status,
      },
      { status: 402 } // Payment Required / License Tamper Lock
    );
  }

  return null;
}

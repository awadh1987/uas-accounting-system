/**
 * Build-target & runtime-surface guard for UAS Accounting System.
 *
 * Ensures root platform-owner surfaces (Platform Control Panel & Superadmin
 * License Generator) are active ONLY in cloud web builds (`https://qat.world`),
 * and cleanly excluded from Capacitor Android APK (`mobile`) and Windows
 * Commercial `.exe` (`desktop`) builds/runtimes.
 */

export type UasBuildTarget = "cloud" | "mobile" | "desktop";

export function getBuildTarget(): UasBuildTarget {
  const raw = (
    process.env.NEXT_PUBLIC_UAS_BUILD_TARGET ||
    process.env.UAS_BUILD_TARGET ||
    ""
  )
    .trim()
    .toLowerCase();

  if (
    raw === "mobile" ||
    process.env.NEXT_PUBLIC_CAPACITOR_EXPORT === "1" ||
    process.env.CAPACITOR_EXPORT === "1"
  ) {
    return "mobile";
  }

  if (raw === "desktop") {
    return "desktop";
  }

  if (typeof window !== "undefined") {
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    if (w.Capacitor?.isNativePlatform?.()) return "mobile";
    const proto = (window.location?.protocol || "").toLowerCase();
    if (proto === "capacitor:" || proto === "file:") return "mobile";
  }

  return "cloud";
}

export function isPlatformAdminSurfaceEnabled(): boolean {
  const flag = (process.env.NEXT_PUBLIC_ENABLE_PLATFORM_ADMIN || "")
    .trim()
    .toLowerCase();
  if (flag === "0" || flag === "false") {
    return false;
  }

  const target = getBuildTarget();
  if (target === "mobile" || target === "desktop") {
    return false;
  }

  return true;
}

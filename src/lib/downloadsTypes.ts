export type DownloadPlatform = "android" | "windows";

export interface DownloadPackageInfo {
  id: string;
  platform: DownloadPlatform;
  fileName: string;
  downloadUrl: string;
  mirrorFileName?: string;
  mirrorDownloadUrl?: string;
  titleAr: string;
  titleEn: string;
  subtitleAr: string;
  subtitleEn: string;
  extension: ".apk" | ".exe";
  mimeType: string;
  version: string;
  exists: boolean;
  sizeBytes: number;
  sizeFormatted: string;
  updatedAt: string | null;
}

export interface PublicDownloadsResponse {
  ok: boolean;
  version: string;
  updatedAt: string | null;
  packages: DownloadPackageInfo[];
}

export function formatDownloadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(value >= 100 || idx === 0 ? 0 : 1) : value.toFixed(2)} ${units[idx]}`;
}

export const FALLBACK_DOWNLOAD_PACKAGES: DownloadPackageInfo[] = [
  {
    id: "android-apk",
    platform: "android",
    fileName: "UAS-Mobile-Release-qat.world.apk",
    downloadUrl: "/downloads/UAS-Mobile-Release-qat.world.apk",
    mirrorFileName: "UAS-Accounting.apk",
    mirrorDownloadUrl: "/downloads/UAS-Accounting.apk",
    titleAr: "تطبيق أندرويد الميداني (Android APK)",
    titleEn: "Android Field & Offline ERP (APK)",
    subtitleAr: "العمل الميداني، الإدخال الصوتي اليمني، تصوير الكشوفات، والمزامنة التلقائية",
    subtitleEn: "Field operations, Yemeni voice commands, receipt Vision OCR & auto-sync",
    extension: ".apk",
    mimeType: "application/vnd.android.package-archive",
    version: "1.0.0",
    exists: true,
    sizeBytes: 0,
    sizeFormatted: "—",
    updatedAt: null,
  },
  {
    id: "windows-exe",
    platform: "windows",
    fileName: "UAS-Setup-Win64.exe",
    downloadUrl: "/downloads/UAS-Setup-Win64.exe",
    mirrorFileName: "UAS.exe",
    mirrorDownloadUrl: "/downloads/UAS.exe",
    titleAr: "نسخة ويندوز المكتبية والشبكية (Win64 Setup)",
    titleEn: "Windows Desktop & LAN Server (.exe)",
    subtitleAr: "مثبت ويندوز 64-بت للعمل المكتبي والشبكة المحلية (LAN) والطباعة الاحترافية",
    subtitleEn: "64-bit Windows installer supporting offline SQLite, local LAN server & printing",
    extension: ".exe",
    mimeType: "application/vnd.microsoft.portable-executable",
    version: "1.0.0",
    exists: true,
    sizeBytes: 0,
    sizeFormatted: "—",
    updatedAt: null,
  },
];

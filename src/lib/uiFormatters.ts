/**
 * Shared UI formatting helpers for Yemeni/Arabic dates (dd / mm / yyyy),
 * consistent currency labels, refresh timestamps, and tenant-stamped filenames.
 */

export function formatIsoToDmy(isoOrDate?: string | Date | null): string {
  if (!isoOrDate) return "";
  if (isoOrDate instanceof Date) {
    if (Number.isNaN(isoOrDate.getTime())) return "";
    const d = String(isoOrDate.getUTCDate()).padStart(2, "0");
    const m = String(isoOrDate.getUTCMonth() + 1).padStart(2, "0");
    const y = isoOrDate.getUTCFullYear();
    return `${d} / ${m} / ${y}`;
  }

  const trimmed = String(isoOrDate).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]} / ${isoMatch[2]} / ${isoMatch[1]}`;
  }

  const dmyMatch = /^(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    return `${dmyMatch[1].padStart(2, "0")} / ${dmyMatch[2].padStart(2, "0")} / ${dmyMatch[3]}`;
  }

  return trimmed;
}

export function parseDmyOrIsoToIso(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let year = 0;
  let month = 0;
  let day = 0;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const dmyMatch = /^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})$/.exec(trimmed);
    if (!dmyMatch) return null;
    day = Number(dmyMatch[1]);
    month = Number(dmyMatch[2]);
    year = Number(dmyMatch[3]);
  }

  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getCurrencyUnitLabel(
  currency?: string | null,
  lang: "ar" | "en" = "ar",
  style: "localized" | "code" = "localized"
): string {
  const code = String(currency || "YER").trim().toUpperCase() || "YER";
  if (style === "code" || lang === "en") return code;
  if (code === "YER") return "ريال";
  if (code === "SAR") return "ريال سعودي";
  if (code === "USD") return "دولار";
  return code;
}

export function formatMoney(
  amount: number | string | null | undefined,
  currency: string = "YER",
  opts: { lang?: "ar" | "en"; style?: "localized" | "code"; decimals?: number } = {}
): string {
  const num = Number(amount) || 0;
  const code = String(currency || "YER").trim().toUpperCase() || "YER";
  const decimals = opts.decimals ?? (code === "YER" ? 0 : 2);
  const formattedNumber = num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const unit = getCurrencyUnitLabel(code, opts.lang ?? "ar", opts.style ?? "localized");
  return `${formattedNumber} ${unit}`;
}

export function formatRefreshTimestamp(
  input?: Date | string | number | null,
  lang: "ar" | "en" = "ar"
): string {
  if (!input) return "";
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return "";
  const timeStr = dt.toLocaleTimeString(lang === "ar" ? "en-GB" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return lang === "ar" ? `آخر تحديث: ${timeStr}` : `Updated: ${timeStr}`;
}

export function buildTenantExportFilename(params: {
  tenantSlug?: string | null;
  module: string;
  ext: "pdf" | "xlsx" | "csv" | "html";
  date?: Date | string | null;
}): string {
  const rawSlug = String(params.tenantSlug || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
  const rawMod = String(params.module || "report")
    .trim()
    .replace(/[\s/\\:*?"<>|]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";

  const dt = params.date
    ? typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(params.date)
      ? params.date.slice(0, 10)
      : new Date(params.date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return `UAS-${rawSlug}-${rawMod}-${dt}.${params.ext}`;
}

export interface ExportActorMeta {
  username?: string | null;
  displayName?: string | null;
  titleAr?: string | null;
  titleEn?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  exportedAt?: string | null;
}

export interface ResolvedExportSignature {
  username: string;
  displayName: string;
  titleAr: string;
  titleEn: string;
  tenantSlug: string;
  tenantName: string;
  dateDmy: string;
  timeStr: string;
  exportedAtDisplay: string;
}

const ROLE_TITLES_AR: Record<string, { ar: string; en: string }> = {
  SUPER_ADMIN: { ar: "مدير النظام العام", en: "System Owner" },
  PROJECT_MANAGER: { ar: "مدير المشاريع والعمليات", en: "Project Manager" },
  CHIEF_ACCOUNTANT: { ar: "رئيس الحسابات", en: "Chief Accountant" },
  SALES_COLLECTOR: { ar: "مسؤول مبيعات وتحصيل", en: "Sales & Collections" },
  FIELD_ACCOUNTANT: { ar: "محاسب ميداني", en: "Field Accountant" },
  AUDITOR: { ar: "مراجع ومدقق مالي", en: "Auditor" },
  EXTERNAL_AUDITOR: { ar: "مدقق خارجي", en: "External Auditor" },
  CLIENT_PORTAL: { ar: "عميل بوابة إلكترونية", en: "Client Portal User" },
};

function sanitizeExportText(raw: string | null | undefined, fallback = ""): string {
  const s = String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\/var\/www\/[^\s]+|[A-Za-z]:\\[^\s]+/g, "")
    .trim();
  return s || fallback;
}

export function resolveExportSignature(input?: {
  actor?: ExportActorMeta | null;
  user?: {
    username?: string | null;
    name?: string | null;
    fullName?: string | null;
    displayName?: string | null;
    role?: string | null;
  } | null;
  fallbackPrintedBy?: string | null;
  tenantSlug?: string | null;
  tenantName?: string | null;
  now?: Date;
}): ResolvedExportSignature {
  const dt = input?.now || new Date();
  const dateDmy = formatIsoToDmy(dt);
  const timeStr = dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const actor = input?.actor;
  const user = input?.user;
  const roleKey = String(user?.role || "").trim().toUpperCase();
  const roleTitle = ROLE_TITLES_AR[roleKey];

  const displayName = sanitizeExportText(
    actor?.displayName || user?.displayName || user?.fullName || user?.name || input?.fallbackPrintedBy,
    "مستخدم النظام"
  );
  const username = sanitizeExportText(
    actor?.username || user?.username || user?.name || actor?.displayName || input?.fallbackPrintedBy,
    "system"
  );
  const titleAr = sanitizeExportText(
    actor?.titleAr || roleTitle?.ar,
    "مستخدم النظام"
  );
  const titleEn = sanitizeExportText(
    actor?.titleEn || roleTitle?.en,
    "System User"
  );
  const tenantSlug = sanitizeExportText(
    actor?.tenantSlug ?? input?.tenantSlug,
    "default"
  );
  const tenantName = sanitizeExportText(
    actor?.tenantName ?? input?.tenantName,
    tenantSlug === "default" ? "النظام المحاسبي الموحد" : tenantSlug
  );

  return {
    username,
    displayName,
    titleAr,
    titleEn,
    tenantSlug,
    tenantName,
    dateDmy,
    timeStr,
    exportedAtDisplay: `${dateDmy} • ${timeStr}`,
  };
}

let activeClientExportActor: ExportActorMeta | null = null;

export function setActiveClientExportActor(actor?: ExportActorMeta | null): void {
  activeClientExportActor = actor ? { ...actor } : null;
}

export function getActiveClientExportActor(): ExportActorMeta | null {
  return activeClientExportActor;
}



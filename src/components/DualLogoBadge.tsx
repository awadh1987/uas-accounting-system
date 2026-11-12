"use client";

import type { UasEnterpriseProfile } from "@/types/uas";

export interface LogoPresetOption {
  id: string;
  labelAr: string;
  labelEn: string;
}

export const UAS_LOGO_PRESETS: LogoPresetOption[] = [
  { id: "emerald-shield", labelAr: "درع القيد المزدوج", labelEn: "Ledger Shield" },
  { id: "geometric", labelAr: "الشبكة الهندسية", labelEn: "Geometric Grid" },
  { id: "ledger-cube", labelAr: "مكعب الأستاذ العام", labelEn: "Ledger Cube" },
  { id: "gold-crest", labelAr: "ختم الرقابة", labelEn: "Audit Crest" },
  { id: "minimal-monogram", labelAr: "رمز الحروف", labelEn: "Monogram" },
];

export const ENTERPRISE_LOGO_PRESETS: LogoPresetOption[] = [
  { id: "agri-leaf", labelAr: "ورقة النمو الزراعي", labelEn: "Agri Leaf" },
  { id: "emblem", labelAr: "شعار المؤسسة الكلاسيكي", labelEn: "Classic Emblem" },
  { id: "terrace-sun", labelAr: "المدرجات والشمس", labelEn: "Terrace Sun" },
  { id: "royal-seal", labelAr: "الختم المؤسسي", labelEn: "Enterprise Seal" },
  { id: "corporate-hex", labelAr: "السداسي الحديث", labelEn: "Corporate Hex" },
];

const SIZE_MAP = {
  sm: { box: "w-8 h-8 rounded-lg", svg: "w-5 h-5", text: "text-[11px]", gap: "gap-1.5" },
  md: { box: "w-10 h-10 rounded-xl", svg: "w-6 h-6", text: "text-xs", gap: "gap-2" },
  lg: { box: "w-14 h-14 rounded-2xl", svg: "w-8 h-8", text: "text-lg", gap: "gap-2.5" },
} as const;

export function renderUasPresetSvg(styleId: string, svgClass: string, logoText: string) {
  switch (styleId) {
    case "geometric":
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <rect x="4" y="4" width="10" height="10" rx="2.5" fill="currentColor" opacity="0.95" />
          <rect x="18" y="4" width="10" height="10" rx="2.5" stroke="currentColor" strokeWidth="2.4" />
          <rect x="4" y="18" width="10" height="10" rx="2.5" stroke="currentColor" strokeWidth="2.4" />
          <path d="M18 23h10M23 18v10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    case "ledger-cube":
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M16 3.5L27 9.8v12.4L16 28.5 5 22.2V9.8L16 3.5Z"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path d="M5 10l11 6.2L27 10M16 16.2V28.5" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      );
    case "gold-crest":
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="2.2" />
          <circle cx="16" cy="16" r="7.5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2" />
          <path d="M11.5 16.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "minimal-monogram":
      return (
        <span className="font-black tracking-tight leading-none select-none">
          {(logoText || "UAS").slice(0, 4)}
        </span>
      );
    case "emerald-shield":
    default:
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M16 3.5L26.5 7.5v8c0 6.5-4.3 11.1-10.5 13-6.2-1.9-10.5-6.5-10.5-13v-8L16 3.5Z"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path d="M11 16h10M16 11v10" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        </svg>
      );
  }
}

export function renderEnterprisePresetSvg(styleId: string, svgClass: string) {
  switch (styleId) {
    case "emblem":
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M6 25h20M8 21h16M10 10l6-5 6 5v11H10V10Z"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="14" r="2.2" fill="currentColor" />
        </svg>
      );
    case "terrace-sun":
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <circle cx="22" cy="9" r="3.5" fill="currentColor" />
          <path
            d="M4 20c5-3 9-3 14 0s7 2 10 0M4 25c5-2.5 10-2.5 15 0s6 1.5 9 0M7 15c3.5-2 7-2 10.5 0"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
        </svg>
      );
    case "royal-seal":
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M6 23l2-11 5 4 3-7 3 7 5-4 2 11H6Z"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M7 26.5h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    case "corporate-hex":
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M16 4l10.4 6v12L16 28 5.6 22V10L16 4Z"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinejoin="round"
          />
          <path d="M11 19l5-8 5 8H11Z" fill="currentColor" opacity="0.9" />
        </svg>
      );
    case "agri-leaf":
    default:
      return (
        <svg viewBox="0 0 32 32" fill="none" className={svgClass} aria-hidden="true">
          <path
            d="M25.5 6.5C14 6.5 7 12.2 7 21.5c0 1.4.2 2.7.5 3.8 1.1.3 2.4.5 3.8.5 9.3 0 14.2-6.8 14.2-19.3Z"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M7.5 24.5c4.5-4.5 9-8.5 15-12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
  }
}

export interface DualLogoBadgeProps {
  profile?: UasEnterpriseProfile | null;
  logoText?: string;
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
  onDark?: boolean;
  className?: string;
}

export function DualLogoBadge({
  profile,
  logoText = "UAS",
  size = "md",
  iconOnly = false,
  onDark = false,
  className = "",
}: DualLogoBadgeProps) {
  const s = SIZE_MAP[size];
  const brandColor = profile?.brandColor || "#059669";

  const showUas = profile?.showUasLogo ?? true;
  const showEnterprise = profile?.showEnterpriseLogo ?? false;

  const uasStyle = profile?.uasLogoStyle || "emerald-shield";
  const uasUrl = profile?.uasLogoCustomUrl?.trim() || "";
  const useCustomUas = Boolean(uasUrl && (uasStyle === "custom" || !UAS_LOGO_PRESETS.some((p) => p.id === uasStyle)));

  const entStyle = profile?.enterpriseLogoStyle || "agri-leaf";
  const entUrl = profile?.enterpriseLogoCustomUrl?.trim() || profile?.logoUrl?.trim() || "";
  const useCustomEnt = Boolean(
    entUrl && (entStyle === "custom" || !ENTERPRISE_LOGO_PRESETS.some((p) => p.id === entStyle))
  );

  const uasBadge = (
    <div
      className={`${s.box} ${s.text} flex items-center justify-center font-black shadow-sm shrink-0 overflow-hidden transition-transform ${
        onDark
          ? "bg-white text-emerald-800 shadow-lg"
          : "text-white shadow-sm"
      }`}
      style={
        onDark
          ? undefined
          : {
              background: `linear-gradient(135deg, ${brandColor}, #047857)`,
            }
      }
      title="Unified Accounting System (UAS)"
    >
      {useCustomUas ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={uasUrl}
          alt="UAS System Logo"
          className="w-full h-full object-contain p-1 bg-white"
        />
      ) : (
        renderUasPresetSvg(uasStyle, s.svg, logoText)
      )}
    </div>
  );

  const enterpriseBadge = (
    <div
      className={`${s.box} ${s.text} flex items-center justify-center font-black shrink-0 overflow-hidden border transition-transform ${
        onDark
          ? "bg-white/15 border-white/30 text-white backdrop-blur-md"
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 shadow-sm"
      }`}
      style={
        onDark || useCustomEnt
          ? undefined
          : {
              color: brandColor,
              borderColor: `${brandColor}44`,
            }
      }
      title={profile?.legalNameEn || profile?.legalNameAr || "Enterprise Logo"}
    >
      {useCustomEnt ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entUrl}
          alt={profile?.legalNameEn || "Enterprise Logo"}
          className="w-full h-full object-contain p-1"
        />
      ) : (
        renderEnterprisePresetSvg(entStyle, s.svg)
      )}
    </div>
  );

  if (!showUas && !showEnterprise) {
    return (
      <div className={`inline-flex items-center ${s.gap} ${className}`}>
        <div
          className={`${s.box} ${s.text} accent-bg flex items-center justify-center font-black shadow-sm shrink-0`}
        >
          {(logoText || "UAS").slice(0, 4)}
        </div>
      </div>
    );
  }

  if (iconOnly) {
    return (
      <div className={`relative inline-flex items-center justify-center ${className}`}>
        {showEnterprise ? enterpriseBadge : uasBadge}
        {showUas && showEnterprise && (
          <span
            className="absolute -bottom-0.5 -end-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900"
            style={{ backgroundColor: brandColor }}
            title="Dual Identity Active"
          />
        )}
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center ${s.gap} shrink-0 ${className}`}>
      {showUas && uasBadge}
      {showEnterprise && enterpriseBadge}
    </div>
  );
}

import type { ThemeName } from "@/types/uas";

export type ResolvedThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "uas_theme_preset_v1";
export const PORTAL_THEME_STORAGE_KEY = "uas_portal_theme_preset_v1";
export const TENANT_BRAND_CACHE_KEY = "uas_tenant_brand_color_v1";

export interface ThemePresetMeta {
  id: ThemeName;
  labelAr: string;
  labelEn: string;
  mode: ResolvedThemeMode | "auto";
  swatch: string;
}

export const THEME_PRESETS: ThemePresetMeta[] = [
  { id: "light", labelAr: "نهاري (فاتح)", labelEn: "Daylight (Light)", mode: "light", swatch: "#059669" },
  { id: "emerald", labelAr: "زمردي مؤسسي", labelEn: "Emerald Enterprise", mode: "light", swatch: "#059669" },
  { id: "royal", labelAr: "ملكي (أزرق)", labelEn: "Royal Indigo", mode: "light", swatch: "#4f46e5" },
  { id: "dark", labelAr: "داكن (ليلي)", labelEn: "Enterprise Dark", mode: "dark", swatch: "#10b981" },
  { id: "system", labelAr: "تلقائي (حسب النظام)", labelEn: "System Auto", mode: "auto", swatch: "#64748b" },
];

export function normalizeThemePreset(raw?: string | null): ThemeName {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "light" || s === "dark" || s === "royal" || s === "emerald" || s === "system") {
    return s;
  }
  return "emerald";
}

export function resolveThemeMode(
  preset: ThemeName,
  systemPrefersDark: boolean
): ResolvedThemeMode {
  if (preset === "dark") return "dark";
  if (preset === "system") return systemPrefersDark ? "dark" : "light";
  return "light";
}

export function parseHexColor(raw?: string | null): { r: number; g: number; b: number; hex: string } | null {
  const clean = String(raw || "").trim();
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(clean);
  if (m3) {
    const [r, g, b] = m3[1].split("").map((ch) => parseInt(ch + ch, 16));
    const hex = `#${m3[1]
      .split("")
      .map((ch) => ch + ch)
      .join("")
      .toLowerCase()}`;
    return { r, g, b, hex };
  }
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(clean);
  if (!m6) return null;
  const val = m6[1].toLowerCase();
  return {
    r: parseInt(val.slice(0, 2), 16),
    g: parseInt(val.slice(2, 4), 16),
    b: parseInt(val.slice(4, 6), 16),
    hex: `#${val}`,
  };
}

function darkenRgb(r: number, g: number, b: number, factor = 0.84): string {
  const dr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const dg = Math.max(0, Math.min(255, Math.round(g * factor)));
  const db = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db
    .toString(16)
    .padStart(2, "0")}`;
}

function computeContrastColor(r: number, g: number, b: number): string {
  // WCAG relative luminance check for accessible button contrast
  const toLinear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return lum > 0.45 ? "#0f172a" : "#ffffff";
}

export interface TenantAccentVars {
  "--tenant-accent"?: string;
  "--tenant-accent-hover"?: string;
  "--tenant-accent-soft"?: string;
  "--tenant-accent-ring"?: string;
  "--accent"?: string;
  "--accent-hover"?: string;
  "--accent-soft"?: string;
  "--accent-contrast"?: string;
}

/**
 * Generates semantic CSS custom properties for a tenant's custom brandColor
 * without overriding base light/dark contrast or breaking financial figure legibility.
 */
export function buildTenantAccentVars(
  brandColor?: string | null,
  resolvedMode: ResolvedThemeMode = "light"
): TenantAccentVars {
  const parsed = parseHexColor(brandColor);
  if (!parsed) return {};
  const softAlpha = resolvedMode === "dark" ? 0.2 : 0.12;
  const hoverHex = darkenRgb(parsed.r, parsed.g, parsed.b, resolvedMode === "dark" ? 1.08 : 0.85);
  const contrast = computeContrastColor(parsed.r, parsed.g, parsed.b);
  return {
    "--tenant-accent": parsed.hex,
    "--tenant-accent-hover": hoverHex,
    "--tenant-accent-soft": `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${softAlpha})`,
    "--tenant-accent-ring": `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, 0.28)`,
    "--accent": parsed.hex,
    "--accent-hover": hoverHex,
    "--accent-soft": `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${softAlpha})`,
    "--accent-contrast": contrast,
  };
}

export function readStoredThemePreset(
  storageKey: string = THEME_STORAGE_KEY,
  fallback?: ThemeName
): ThemeName {
  if (typeof window === "undefined") return normalizeThemePreset(fallback);
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) return normalizeThemePreset(saved);
  } catch {
    // ignore storage restriction
  }
  return normalizeThemePreset(fallback);
}

export function persistThemePreset(
  preset: ThemeName,
  storageKey: string = THEME_STORAGE_KEY
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, normalizeThemePreset(preset));
  } catch {
    // ignore storage restriction
  }
}

export function applyThemeToDocument(
  preset: ThemeName,
  brandColor?: string | null,
  storageKey?: string
): ResolvedThemeMode {
  const normalized = normalizeThemePreset(preset);
  if (storageKey) {
    persistThemePreset(normalized, storageKey);
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    return normalized === "dark" ? "dark" : "light";
  }

  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveThemeMode(normalized, prefersDark);

  const root = document.documentElement;
  const body = document.body;
  const classes = ["theme-dark", "theme-light", "theme-royal", "theme-emerald"];

  root.classList.remove(...classes);
  body?.classList.remove(...classes);

  const effectiveClass =
    resolved === "dark"
      ? "theme-dark"
      : normalized === "royal"
      ? "theme-royal"
      : normalized === "light"
      ? "theme-light"
      : "theme-emerald";

  root.classList.add(effectiveClass);
  body?.classList.add(effectiveClass);
  root.setAttribute("data-theme-preset", normalized);
  root.setAttribute("data-theme-mode", resolved);

  const accentVars = buildTenantAccentVars(brandColor, resolved);
  const accentKeys: Array<keyof TenantAccentVars> = [
    "--tenant-accent",
    "--tenant-accent-hover",
    "--tenant-accent-soft",
    "--tenant-accent-ring",
    "--accent",
    "--accent-hover",
    "--accent-soft",
    "--accent-contrast",
  ];
  for (const key of accentKeys) {
    const val = accentVars[key];
    if (val) {
      root.style.setProperty(key, val);
    } else {
      root.style.removeProperty(key);
    }
  }
  if (brandColor && parseHexColor(brandColor)) {
    try {
      window.localStorage.setItem(TENANT_BRAND_CACHE_KEY, brandColor.trim());
    } catch {
      // ignore
    }
  }

  return resolved;
}

/**
 * Generates an inline pre-hydration script to prevent any light/dark flash on initial load
 * across qat.world, <slug>.qat.world, and /portal.
 */
export function buildThemeBootInlineScript(): string {
  return `(function(){try{var p=window.location.pathname||'';var k=(p.indexOf('/portal')===0||p.indexOf('/client/portal')===0)?'${PORTAL_THEME_STORAGE_KEY}':'${THEME_STORAGE_KEY}';var s=window.localStorage.getItem(k)||window.localStorage.getItem('${THEME_STORAGE_KEY}')||'emerald';var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var m=(s==='dark'||(s==='system'&&d))?'dark':'light';var c=m==='dark'?'theme-dark':(s==='royal'?'theme-royal':(s==='light'?'theme-light':'theme-emerald'));var r=document.documentElement;r.classList.remove('theme-dark','theme-light','theme-royal','theme-emerald');r.classList.add(c);r.setAttribute('data-theme-preset',s);r.setAttribute('data-theme-mode',m);}catch(e){}})();`;
}

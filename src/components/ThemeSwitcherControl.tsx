"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_PRESETS } from "@/lib/themeEngine";
import type { LanguageCode, ThemeName } from "@/types/uas";

interface ThemeSwitcherControlProps {
  theme: ThemeName;
  lang?: LanguageCode;
  onChangeTheme: (next: ThemeName) => void;
  compact?: boolean;
  testId?: string;
}

export function ThemeSwitcherControl({
  theme,
  lang = "ar",
  onChangeTheme,
  compact = false,
  testId = "theme-switcher-select",
}: ThemeSwitcherControlProps) {
  const isAr = lang === "ar";
  const Icon = theme === "dark" ? Moon : theme === "system" ? Monitor : Sun;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-xs uas-light-btn">
      <Icon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
      <select
        data-testid={testId}
        aria-label={isAr ? "اختيار المظهر" : "Theme Preset"}
        value={theme}
        onChange={(e) => onChangeTheme(e.target.value as ThemeName)}
        className={`bg-transparent focus:outline-none font-bold cursor-pointer ${
          compact ? "text-[11px] max-w-[105px]" : "text-xs"
        }`}
      >
        {THEME_PRESETS.map((p) => (
          <option key={p.id} value={p.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
            {isAr ? p.labelAr : p.labelEn}
          </option>
        ))}
      </select>
    </div>
  );
}

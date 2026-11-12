"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import type { LanguageCode } from "@/types/uas";

interface SlideOverDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  lang?: LanguageCode;
  size?: "md" | "lg" | "xl";
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const SIZE_CLASSES: Record<"md" | "lg" | "xl", string> = {
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
};

export function SlideOverDrawer({
  open,
  onClose,
  title,
  subtitle,
  size = "lg",
  children,
  footer,
}: SlideOverDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs no-print"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`relative w-full ${SIZE_CLASSES[size]} h-full card-surface shadow-2xl flex flex-col border-s border-slate-200 dark:border-slate-700 animate-in duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Drawer Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold leading-tight truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {/* Optional Footer */}
        {footer && (
          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}


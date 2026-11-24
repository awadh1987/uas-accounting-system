"use client";

import { useRef, useState } from "react";
import { Calendar, X } from "lucide-react";
import { formatIsoToDmy, parseDmyOrIsoToIso } from "@/lib/uiFormatters";

interface UasDateInputProps {
  value: string;
  onChange: (nextIsoDate: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
  allowClear?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  min?: string;
  max?: string;
  testId?: string;
}

/**
 * Standardized Yemeni/Arabic date input showing `dd / mm / yyyy` format consistently
 * regardless of OS/browser US locale while keeping values canonical `YYYY-MM-DD`.
 */
export function UasDateInput({
  value,
  onChange,
  placeholder = "يوم / شهر / سنة",
  ariaLabel,
  className = "",
  inputClassName = "",
  allowClear = true,
  disabled = false,
  required = false,
  id,
  name,
  min,
  max,
  testId,
}: UasDateInputProps) {
  const [draft, setDraft] = useState(() => formatIsoToDmy(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const nativePickerRef = useRef<HTMLInputElement>(null);

  const commitDraft = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setInvalid(false);
      if (value) onChange("");
      return;
    }
    const parsedIso = parseDmyOrIsoToIso(trimmed);
    if (parsedIso) {
      setInvalid(false);
      setDraft(formatIsoToDmy(parsedIso));
      if (parsedIso !== value) {
        onChange(parsedIso);
      }
    } else {
      setInvalid(true);
    }
  };

  const openNativePicker = () => {
    const el = nativePickerRef.current;
    if (!el || disabled) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // Fallback below
      }
    }
    el.focus();
    el.click();
  };

  return (
    <div
      className={`relative flex items-center rounded-xl border bg-white dark:bg-slate-900 ${
        invalid
          ? "border-rose-400 focus-within:ring-2 focus-within:ring-rose-500/30"
          : "border-slate-300 dark:border-slate-700 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20"
      } ${className}`}
    >
      <input
        id={id}
        name={name}
        data-testid={testId}
        type="text"
        inputMode="numeric"
        dir="ltr"
        disabled={disabled}
        required={required}
        aria-label={ariaLabel || placeholder}
        aria-invalid={invalid}
        title={invalid ? "يرجى إدخال التاريخ بصيغة dd / mm / yyyy" : "صيغة التاريخ: يوم / شهر / سنة (dd / mm / yyyy)"}
        value={focused ? draft : formatIsoToDmy(value)}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true);
          setDraft(formatIsoToDmy(value));
        }}
        onChange={(e) => {
          const nextText = e.target.value;
          setDraft(nextText);
          const trimmed = nextText.trim();
          if (!trimmed) {
            setInvalid(false);
            onChange("");
            return;
          }
          const parsed = parseDmyOrIsoToIso(trimmed);
          if (parsed) {
            setInvalid(false);
            onChange(parsed);
          }
        }}
        onBlur={() => {
          setFocused(false);
          commitDraft(draft);
        }}
        className={`w-full bg-transparent px-3 py-2 text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 placeholder:font-sans focus:outline-none text-center ${
          allowClear && value ? "pe-14" : "pe-9"
        } ${inputClassName}`}
      />

      {allowClear && value && !disabled && (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            setInvalid(false);
            onChange("");
          }}
          title="مسح التاريخ"
          aria-label="مسح التاريخ"
          className="absolute end-8 p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={openNativePicker}
        title="اختيار من التقويم"
        aria-label="اختيار من التقويم"
        className="absolute end-1.5 p-1 rounded text-slate-500 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
      >
        <Calendar className="w-3.5 h-3.5" />
      </button>

      {/* Hidden synchronized native date picker for quick calendar popup */}
      <input
        ref={nativePickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        min={min}
        max={max}
        value={/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ""}
        onChange={(e) => {
          const picked = e.target.value;
          setInvalid(false);
          setDraft(formatIsoToDmy(picked));
          onChange(picked);
        }}
        className="sr-only"
      />
    </div>
  );
}

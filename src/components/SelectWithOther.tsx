"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { PenLine } from "lucide-react";

export interface SelectWithOtherOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectWithOtherProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
  options: Array<string | SelectWithOtherOption>;
  otherOptionLabel?: string;
  customPlaceholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  wrapperClassName?: string;
  customInputClassName?: string;
}

export const OTHER_VALUE_TOKEN = "__other__";

export function SelectWithOther({
  value,
  onChange,
  options,
  otherOptionLabel = "أخرى (تحديد يدوي) / Other...",
  customPlaceholder = "أدخل القيمة المخصصة / Enter custom value...",
  allowEmpty = false,
  emptyLabel = "— اختر من القائمة —",
  wrapperClassName = "",
  customInputClassName = "",
  className = "",
  id,
  required,
  disabled,
  ...selectProps
}: SelectWithOtherProps) {
  const autoId = useId();
  const selectId = id || `select-with-other-${autoId}`;
  const customInputRef = useRef<HTMLInputElement>(null);

  // Normalize options
  const normalizedOptions: SelectWithOtherOption[] = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === "string") {
        return { value: opt, label: opt };
      }
      return opt;
    });
  }, [options]);

  // Determine if the current value matches a known standard option
  const isStandardValue = useMemo(() => {
    if (value === "") return allowEmpty;
    return normalizedOptions.some((opt) => opt.value === value);
  }, [value, normalizedOptions, allowEmpty]);

  // If value is not a standard value and not empty, it is already a custom value
  const isCustomFromProps = !isStandardValue && value !== "" && value !== OTHER_VALUE_TOKEN;

  // Local state to track whether the user explicitly selected "__other__"
  const [explicitOther, setExplicitOther] = useState(isCustomFromProps || value === OTHER_VALUE_TOKEN);
  const [customText, setCustomText] = useState(isCustomFromProps ? value : "");

  // Synchronize when value changes externally
  useEffect(() => {
    if (isCustomFromProps) {
      setExplicitOther(true);
      setCustomText(value);
    } else if (isStandardValue) {
      setExplicitOther(false);
    } else if (value === OTHER_VALUE_TOKEN) {
      setExplicitOther(true);
    }
  }, [value, isStandardValue, isCustomFromProps]);

  const showCustomInput = explicitOther || isCustomFromProps;

  // Handle select change
  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedVal = e.target.value;
    if (selectedVal === OTHER_VALUE_TOKEN) {
      setExplicitOther(true);
      // If there was previous custom text, keep it, else send empty or previous
      const nextVal = customText.trim();
      onChange(nextVal || OTHER_VALUE_TOKEN);
      setTimeout(() => {
        customInputRef.current?.focus();
      }, 50);
    } else {
      setExplicitOther(false);
      onChange(selectedVal);
    }
  };

  // Handle custom input change
  const handleCustomInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setCustomText(raw);
    onChange(raw);
  };

  const handleCustomInputBlur = () => {
    const trimmed = customText.trim();
    if (trimmed !== customText) {
      setCustomText(trimmed);
      onChange(trimmed);
    }
  };

  // The displayed value in <select>
  const selectDisplayValue = showCustomInput
    ? OTHER_VALUE_TOKEN
    : isStandardValue
    ? value
    : allowEmpty
    ? ""
    : normalizedOptions[0]?.value || "";

  return (
    <div className={`space-y-1.5 w-full ${wrapperClassName}`}>
      <select
        id={selectId}
        value={selectDisplayValue}
        onChange={handleSelectChange}
        disabled={disabled}
        required={required && !showCustomInput}
        className={className}
        {...selectProps}
      >
        {allowEmpty && (
          <option value="">{emptyLabel}</option>
        )}
        {normalizedOptions.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
        <option value={OTHER_VALUE_TOKEN} className="font-bold text-emerald-600">
          + {otherOptionLabel}
        </option>
      </select>

      {/* Smoothly revealed custom text input */}
      {showCustomInput && (
        <div className="relative animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="relative flex items-center">
            <input
              ref={customInputRef}
              type="text"
              required={required}
              disabled={disabled}
              value={customText}
              onChange={handleCustomInputChange}
              onBlur={handleCustomInputBlur}
              placeholder={customPlaceholder}
              className={`w-full rounded-xl border border-emerald-400 dark:border-emerald-600/70 bg-emerald-50/30 dark:bg-emerald-950/20 px-3 py-2 pr-9 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition ${customInputClassName}`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-600 dark:text-emerald-400">
              <PenLine className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5 px-1 font-medium">
            سيتم حفظ هذه القيمة المخصصة واستخدامها في السجلات والتقارير
          </div>
        </div>
      )}
    </div>
  );
}

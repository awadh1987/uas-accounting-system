"use client";

import { useMemo, useState } from "react";
import { BookUser, Phone, Search, X } from "lucide-react";
import {
  normalizePickedPhoneNumber,
  pickPhoneFromDeviceContacts,
  type FallbackContactItem,
  type PickedContact,
} from "@/lib/contactsBridge";

export interface PhoneContactInputProps {
  value: string;
  onChange: (value: string) => void;
  onContactSelected?: (contact: PickedContact) => void;
  fallbackContacts?: FallbackContactItem[];
  format?: "local_or_e164" | "whatsapp_digits";
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  dir?: "ltr" | "rtl";
  className?: string;
  inputClassName?: string;
  buttonLabelAr?: string;
  buttonLabelEn?: string;
  isAr?: boolean;
  testId?: string;
  inputMode?: "tel" | "text" | "numeric";
  id?: string;
  name?: string;
  autoComplete?: string;
}

export function PhoneContactInput({
  value,
  onChange,
  onContactSelected,
  fallbackContacts = [],
  format = "local_or_e164",
  placeholder,
  required,
  disabled,
  readOnly,
  dir = "ltr",
  className = "",
  inputClassName = "",
  buttonLabelAr = "اختيار من جهات الاتصال",
  buttonLabelEn = "Contacts",
  isAr = true,
  testId,
  inputMode = "tel",
  id,
  name,
  autoComplete = "tel",
}: PhoneContactInputProps) {
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"fallback" | "multi_number">("fallback");
  const [multiChoices, setMultiChoices] = useState<PickedContact[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const uniqueFallbackContacts = useMemo(() => {
    const seen = new Set<string>();
    const clean: FallbackContactItem[] = [];
    for (const item of fallbackContacts) {
      const normalized = normalizePickedPhoneNumber(item.phone, format);
      if (!normalized) continue;
      const key = `${item.name.trim().toLowerCase()}::${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push({
        ...item,
        phone: normalized,
      });
    }
    return clean;
  }, [fallbackContacts, format]);

  const filteredFallback = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return uniqueFallbackContacts;
    return uniqueFallbackContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.subtitle || "").toLowerCase().includes(q)
    );
  }, [uniqueFallbackContacts, searchQuery]);

  async function handlePickClick() {
    if (disabled || readOnly || busy) return;
    setBusy(true);
    setStatusMessage(null);
    try {
      const outcome = await pickPhoneFromDeviceContacts({ format });
      if (outcome.status === "picked" && outcome.contact) {
        if ((outcome.choices?.length || 0) > 1 && outcome.choices) {
          setMultiChoices(outcome.choices);
          setPickerMode("multi_number");
          setPickerOpen(true);
          return;
        }
        onChange(outcome.contact.phone);
        onContactSelected?.(outcome.contact);
        setStatusMessage(
          isAr
            ? `تم اختيار: ${outcome.contact.name || outcome.contact.phone}`
            : `Selected: ${outcome.contact.name || outcome.contact.phone}`
        );
        return;
      }

      if (outcome.status === "cancelled") {
        return;
      }

      if (outcome.message) {
        setStatusMessage(outcome.message);
      }

      setSearchQuery("");
      setPickerMode("fallback");
      setPickerOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const handleSelectFallback = (item: FallbackContactItem) => {
    const normalized = normalizePickedPhoneNumber(item.phone, format);
    if (!normalized) return;
    const picked: PickedContact = {
      name: item.name,
      phone: normalized,
      rawPhone: item.phone,
      source: "fallback",
    };
    onChange(normalized);
    onContactSelected?.(picked);
    setPickerOpen(false);
    setStatusMessage(isAr ? `تم اختيار: ${item.name}` : `Selected: ${item.name}`);
  };

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex items-stretch gap-1.5">
        <input
          id={id}
          name={name}
          data-testid={testId}
          type="tel"
          inputMode={inputMode}
          autoComplete={autoComplete}
          dir={dir}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          value={value}
          onChange={(e) => {
            if (statusMessage) setStatusMessage(null);
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          className={
            inputClassName ||
            "flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 font-mono text-right"
          }
        />
        {!disabled && !readOnly && (
          <button
            type="button"
            data-testid={testId ? `${testId}-pick-contact` : undefined}
            onClick={() => void handlePickClick()}
            disabled={busy}
            title={isAr ? buttonLabelAr : buttonLabelEn}
            aria-label={isAr ? buttonLabelAr : buttonLabelEn}
            className="shrink-0 px-2.5 py-2 rounded-xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-extrabold inline-flex items-center gap-1 transition disabled:opacity-50"
          >
            <BookUser className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{isAr ? buttonLabelAr : buttonLabelEn}</span>
          </button>
        )}
      </div>

      {statusMessage && (
        <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 leading-snug">
          {statusMessage}
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
              <div className="font-black text-sm flex items-center gap-1.5">
                <BookUser className="w-4 h-4 text-emerald-600" />
                <span>
                  {pickerMode === "multi_number"
                    ? isAr
                      ? "اختر رقم الهاتف المطلوب"
                      : "Select Phone Number"
                    : isAr
                      ? "اختيار رقم من جهات الاتصال"
                      : "Pick from Contacts"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pickerMode === "multi_number" ? (
              <div className="space-y-1.5">
                {multiChoices.map((choice) => (
                  <button
                    key={choice.phone}
                    type="button"
                    onClick={() => {
                      onChange(choice.phone);
                      onContactSelected?.(choice);
                      setPickerOpen(false);
                    }}
                    className="w-full text-right p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30 flex items-center justify-between gap-2"
                  >
                    <span className="font-bold">{choice.name || (isAr ? "رقم هاتف" : "Phone")}</span>
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300" dir="ltr">
                      {choice.phone}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
                  {isAr
                    ? "هذا المتصفح لا يتيح الوصول المباشر لدفتر الهاتف. يمكنك الاختيار من جهات اتصال مساحة العمل أدناه أو كتابة الرقم يدوياً (يدعم الأرقام اليمنية والدولية)، بينما يعمل دفتر الهاتف مباشرة على تطبيق الأندرويد (APK) ومتصفح Chrome على الجوال."
                    : "Your current browser does not expose native device contacts. Select from saved workspace contacts below or enter the number manually."}
                </div>

                {uniqueFallbackContacts.length > 0 ? (
                  <>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={isAr ? "ابحث بالاسم أو رقم الجوال..." : "Search name or phone..."}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent pr-8 pl-3 py-2"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
                      {filteredFallback.length === 0 ? (
                        <div className="py-6 text-center text-slate-400">
                          {isAr ? "لا توجد نتائج مطابقة" : "No matching contacts"}
                        </div>
                      ) : (
                        filteredFallback.map((c, idx) => (
                          <button
                            key={`${c.id || c.phone}-${idx}`}
                            type="button"
                            onClick={() => handleSelectFallback(c)}
                            className="w-full text-right p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 flex items-center justify-between gap-2 transition"
                          >
                            <div className="min-w-0">
                              <div className="font-extrabold truncate">{c.name}</div>
                              {c.subtitle && (
                                <div className="text-[10px] text-slate-500 truncate">{c.subtitle}</div>
                              )}
                            </div>
                            <span
                              className="inline-flex items-center gap-1 font-mono font-bold text-emerald-700 dark:text-emerald-300 shrink-0"
                              dir="ltr"
                            >
                              <Phone className="w-3 h-3" />
                              {c.phone}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div className="py-4 text-center text-slate-500">
                    {isAr
                      ? "لا توجد جهات اتصال محفوظة في هذه القائمة بعد — اكتب الرقم يدوياً في الحقل."
                      : "No saved workspace contacts available yet — type the phone number manually."}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

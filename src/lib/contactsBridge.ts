"use client";

import { isCapacitorNative, normalizeWhatsAppPhone } from "@/lib/nativeBridge";

export type ContactPickerCapability = "capacitor" | "web_contacts" | "fallback";

export interface FallbackContactItem {
  id?: string;
  name: string;
  phone: string;
  subtitle?: string;
}

export interface PickedContact {
  name: string;
  phone: string;
  rawPhone: string;
  source: ContactPickerCapability;
}

export interface PickContactOutcome {
  status: "picked" | "cancelled" | "unsupported" | "permission_denied" | "no_phone" | "error";
  contact?: PickedContact;
  choices?: PickedContact[];
  source: ContactPickerCapability;
  message?: string;
}

interface NavigatorContactsSelect {
  select: (
    properties: Array<"name" | "tel" | "email">,
    options?: { multiple?: boolean }
  ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
}

interface CapacitorContactsPluginLike {
  checkPermissions?: () => Promise<{ contacts?: string }>;
  requestPermissions?: () => Promise<{ contacts?: string }>;
  pickContact?: (options: {
    projection: { name?: boolean; phones?: boolean };
  }) => Promise<{
    contact?: {
      name?: { display?: string | null; given?: string | null; family?: string | null } | null;
      phones?: Array<{ number?: string | null; isPrimary?: boolean; type?: string }>;
    };
  }>;
}

const YEMEN_MOBILE_RE = /^7[01378]\d{7}$/;

/**
 * Converts Arabic/Persian digits to ASCII and normalizes Yemeni (`77/78/73/71/70` 9-digit)
 * or international E.164 phone numbers picked from device contacts.
 */
export function normalizePickedPhoneNumber(
  raw: string,
  format: "local_or_e164" | "whatsapp_digits" = "local_or_e164"
): string {
  const input = String(raw || "").trim();
  if (!input) return "";

  const ascii = input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  const compact = ascii.replace(/[\s\-().\u200e\u200f\u202a-\u202e]+/g, "");
  if (!compact) return "";

  if (format === "whatsapp_digits") {
    return normalizeWhatsAppPhone(compact);
  }

  let localOrIntl = compact;
  if (compact.startsWith("00967")) {
    const rest = compact.slice(5);
    localOrIntl = YEMEN_MOBILE_RE.test(rest) ? rest : `+967${rest}`;
  } else if (compact.startsWith("+967")) {
    const rest = compact.slice(4);
    localOrIntl = YEMEN_MOBILE_RE.test(rest) ? rest : compact;
  } else if (compact.startsWith("967") && YEMEN_MOBILE_RE.test(compact.slice(3))) {
    localOrIntl = compact.slice(3);
  } else if (compact.startsWith("0") && YEMEN_MOBILE_RE.test(compact.slice(1))) {
    localOrIntl = compact.slice(1);
  } else if (compact.startsWith("00") && /^\d{8,17}$/.test(compact.slice(2))) {
    localOrIntl = `+${compact.slice(2)}`;
  }

  return localOrIntl.replace(/[^\d+]/g, "");
}

export function getContactPickerCapability(): ContactPickerCapability {
  if (typeof window === "undefined") return "fallback";
  const win = window as unknown as {
    Capacitor?: { Plugins?: { Contacts?: CapacitorContactsPluginLike } };
  };
  if (isCapacitorNative() || Boolean(win.Capacitor?.Plugins?.Contacts)) {
    return "capacitor";
  }
  if (typeof navigator !== "undefined" && "contacts" in navigator) {
    const navContacts = (navigator as unknown as { contacts?: NavigatorContactsSelect }).contacts;
    if (navContacts && typeof navContacts.select === "function") {
      return "web_contacts";
    }
  }
  return "fallback";
}

function buildDeduplicatedChoices(
  name: string,
  rawNumbers: Array<{ raw: string; preferred?: boolean }>,
  source: ContactPickerCapability,
  format: "local_or_e164" | "whatsapp_digits"
): PickedContact[] {
  const seen = new Set<string>();
  const sorted = [...rawNumbers].sort((a, b) => Number(Boolean(b.preferred)) - Number(a.preferred));
  const out: PickedContact[] = [];
  for (const item of sorted) {
    const normalized = normalizePickedPhoneNumber(item.raw, format);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({
      name: name.trim(),
      phone: normalized,
      rawPhone: item.raw,
      source,
    });
  }
  return out;
}

async function resolveCapacitorContactsPlugin(): Promise<CapacitorContactsPluginLike | null> {
  if (typeof window !== "undefined") {
    const winPlugin = (
      window as unknown as { Capacitor?: { Plugins?: { Contacts?: CapacitorContactsPluginLike } } }
    ).Capacitor?.Plugins?.Contacts;
    if (winPlugin?.pickContact) return winPlugin;
  }
  try {
    const mod = (await import("@capacitor-community/contacts")) as unknown as {
      Contacts?: CapacitorContactsPluginLike;
    };
    return mod?.Contacts || null;
  } catch {
    return null;
  }
}

function isUserCancelledError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || "")).toLowerCase();
  return (
    msg.includes("cancel") ||
    msg.includes("abort") ||
    msg.includes("dismiss") ||
    msg.includes("user did not")
  );
}

/**
 * Picks a phone number from native Capacitor Contacts (Android/iOS) or Web Contact Picker API.
 * Returns `unsupported` on desktop/non-Contact-Picker browsers so callers can display the
 * scoped workspace contacts fallback selector cleanly.
 */
export async function pickPhoneFromDeviceContacts(options?: {
  format?: "local_or_e164" | "whatsapp_digits";
}): Promise<PickContactOutcome> {
  const format = options?.format ?? "local_or_e164";
  const capability = getContactPickerCapability();

  if (capability === "capacitor") {
    try {
      const plugin = await resolveCapacitorContactsPlugin();
      if (!plugin || typeof plugin.pickContact !== "function") {
        return {
          status: "unsupported",
          source: "fallback",
          message: "إضافة جهات الاتصال غير مهيأة في هذا البناء",
        };
      }

      if (typeof plugin.checkPermissions === "function" && typeof plugin.requestPermissions === "function") {
        const perm = await plugin.checkPermissions();
        if (perm?.contacts !== "granted" && perm?.contacts !== "limited") {
          const req = await plugin.requestPermissions();
          if (req?.contacts !== "granted" && req?.contacts !== "limited") {
            return {
              status: "permission_denied",
              source: "capacitor",
              message: "لم يتم منح إذن قراءة جهات الاتصال، يمكنك التمكين من إعدادات التطبيق أو الاختيار من القائمة أدناه",
            };
          }
        }
      }

      const result = await plugin.pickContact({
        projection: { name: true, phones: true },
      });
      const contact = result?.contact;
      if (!contact) {
        return { status: "cancelled", source: "capacitor" };
      }

      const displayName =
        contact.name?.display?.trim() ||
        [contact.name?.given, contact.name?.family].filter(Boolean).join(" ").trim();
      const rawNumbers = (contact.phones || [])
        .map((p) => ({
          raw: String(p.number || "").trim(),
          preferred: Boolean(p.isPrimary) || p.type === "mobile" || p.type === "work_mobile",
        }))
        .filter((p) => Boolean(p.raw));

      const choices = buildDeduplicatedChoices(displayName, rawNumbers, "capacitor", format);
      if (choices.length === 0) {
        return {
          status: "no_phone",
          source: "capacitor",
          message: "جهة الاتصال المختارة لا تحتوي على رقم هاتف صالح",
        };
      }

      return {
        status: "picked",
        source: "capacitor",
        contact: choices[0],
        choices,
      };
    } catch (err: unknown) {
      if (isUserCancelledError(err)) {
        return { status: "cancelled", source: "capacitor" };
      }
      return {
        status: "error",
        source: "capacitor",
        message: "تعذر فتح جهات اتصال الهاتف؛ يمكنك التعديل يدوياً أو الاختيار من جهات المنشأة",
      };
    }
  }

  if (capability === "web_contacts") {
    try {
      const navContacts = (navigator as unknown as { contacts: NavigatorContactsSelect }).contacts;
      const selected = await navContacts.select(["name", "tel"], { multiple: false });
      if (!selected || selected.length === 0) {
        return { status: "cancelled", source: "web_contacts" };
      }
      const first = selected[0];
      const displayName = Array.isArray(first.name) ? String(first.name[0] || "").trim() : "";
      const rawNumbers = (first.tel || [])
        .map((raw, idx) => ({ raw: String(raw || "").trim(), preferred: idx === 0 }))
        .filter((p) => Boolean(p.raw));
      const choices = buildDeduplicatedChoices(displayName, rawNumbers, "web_contacts", format);
      if (choices.length === 0) {
        return {
          status: "no_phone",
          source: "web_contacts",
          message: "جهة الاتصال المختارة لا تحتوي على رقم هاتف",
        };
      }
      return {
        status: "picked",
        source: "web_contacts",
        contact: choices[0],
        choices,
      };
    } catch (err: unknown) {
      if (isUserCancelledError(err)) {
        return { status: "cancelled", source: "web_contacts" };
      }
      return {
        status: "unsupported",
        source: "fallback",
      };
    }
  }

  return {
    status: "unsupported",
    source: "fallback",
  };
}

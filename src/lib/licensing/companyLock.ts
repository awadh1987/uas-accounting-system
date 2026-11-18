/**
 * Company-name lock: ties the installation's EnterpriseProfile (legalNameAr / legalNameEn)
 * to the signed `company_name` of a v2 license.
 *
 * Pure decision logic (browser-safe) lives here; the Prisma-backed profile repository and the
 * "active license" loader live in companyLockServer.ts.
 */
import { companyNamesMatch } from "./licenseSchema";

export interface ProfileNames {
  legalNameAr: string;
  legalNameEn: string;
  isConfigured: boolean;
}

export interface ProfileRepo {
  get(): Promise<ProfileNames | null>;
  adopt(patch: { legalNameAr: string; legalNameEn: string; isConfigured: true }): Promise<void>;
}

export type LockedField = "legalNameAr" | "legalNameEn";

export const PLACEHOLDER_NAME_AR = "اسم المنشأة";
export const PLACEHOLDER_NAME_EN = "Enterprise Name";

export function companyMismatchMessage(licenseCompany: string): string {
  return `اسم المنشأة لا يطابق الترخيص المعتمد / Company name mismatch: License belongs to '${licenseCompany}'.`;
}

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

export function hasArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text);
}

function isPlaceholder(value: string | null | undefined, placeholder: string): boolean {
  const v = String(value ?? "").trim();
  return v.length === 0 || v === placeholder;
}

/** Fresh install (never configured) or both names still empty / default placeholders. */
export function isProfileUnconfigured(profile: ProfileNames | null | undefined): boolean {
  if (!profile) return true;
  if (!profile.isConfigured) return true;
  return isPlaceholder(profile.legalNameAr, PLACEHOLDER_NAME_AR) && isPlaceholder(profile.legalNameEn, PLACEHOLDER_NAME_EN);
}

/** The profile field that currently carries the licensed company name (null when neither matches). */
export function resolveLockedField(licenseCompany: string, profile: Pick<ProfileNames, "legalNameAr" | "legalNameEn">): LockedField | null {
  const arMatch = companyNamesMatch(licenseCompany, profile.legalNameAr);
  const enMatch = companyNamesMatch(licenseCompany, profile.legalNameEn);
  if (hasArabicScript(licenseCompany)) {
    if (arMatch) return "legalNameAr";
    if (enMatch) return "legalNameEn";
  } else {
    if (enMatch) return "legalNameEn";
    if (arMatch) return "legalNameAr";
  }
  return null;
}

export type CompanyLockEvaluation =
  | { outcome: "ADOPT"; patch: { legalNameAr: string; legalNameEn: string; isConfigured: true } }
  | { outcome: "MATCH"; lockedField: LockedField }
  | { outcome: "MISMATCH"; error: string };

/** Decide what activation must do with the EnterpriseProfile (read-only). */
export function evaluateCompanyLock(licenseCompany: string, profile: ProfileNames | null | undefined): CompanyLockEvaluation {
  const name = licenseCompany.trim();
  if (isProfileUnconfigured(profile)) {
    return {
      outcome: "ADOPT",
      patch: { legalNameAr: name, legalNameEn: name, isConfigured: true },
    };
  }
  const locked = resolveLockedField(name, profile as ProfileNames);
  if (locked) return { outcome: "MATCH", lockedField: locked };
  return { outcome: "MISMATCH", error: companyMismatchMessage(name) };
}

export type ProfileUpdateCheck = { ok: true } | { ok: false; error: string };

/**
 * Validates an Enterprise-Settings save against the active license lock.
 * Only the locked name field is frozen; the other-language name may still be edited.
 */
export function checkProfileUpdateAgainstLock(
  licenseCompany: string,
  existing: ProfileNames | null | undefined,
  patch: { legalNameAr?: string | null; legalNameEn?: string | null }
): ProfileUpdateCheck {
  const name = licenseCompany.trim();
  const newAr = typeof patch.legalNameAr === "string" && patch.legalNameAr.trim() ? patch.legalNameAr.trim() : undefined;
  const newEn = typeof patch.legalNameEn === "string" && patch.legalNameEn.trim() ? patch.legalNameEn.trim() : undefined;
  if (newAr === undefined && newEn === undefined) return { ok: true };

  const current = {
    legalNameAr: existing?.legalNameAr ?? "",
    legalNameEn: existing?.legalNameEn ?? "",
  };
  const fail: ProfileUpdateCheck = { ok: false, error: companyMismatchMessage(name) };

  const lockedField = isProfileUnconfigured(existing) ? null : resolveLockedField(name, current);
  if (lockedField) {
    const incoming = lockedField === "legalNameAr" ? newAr : newEn;
    if (incoming !== undefined && !companyNamesMatch(name, incoming)) return fail;
    return { ok: true };
  }

  // No field currently carries the licensed name (fresh / drifted profile): the result must match.
  const merged = { legalNameAr: newAr ?? current.legalNameAr, legalNameEn: newEn ?? current.legalNameEn };
  return resolveLockedField(name, merged) ? { ok: true } : fail;
}

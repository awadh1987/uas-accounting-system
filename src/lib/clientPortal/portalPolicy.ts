/**
 * Pure (DB-free) portal policy helpers:
 *  - Sector access modes (BOTH / HARVEST_ONLY / COMMERCIAL_ONLY) per tenant default and per client.
 *  - Client account lifecycle (ACTIVE / SUSPENDED / ARCHIVED) rules.
 *  - Granular return-to-client edit permissions + server-side locked-field validation.
 *
 * Kept free of Prisma imports so it is unit-testable and shared by API routes and UI.
 */

export type SectorType = "HARVEST" | "COMMERCIAL";
export type SectorMode = "BOTH" | "HARVEST_ONLY" | "COMMERCIAL_ONLY";

export const SECTOR_LABEL_AR: Record<SectorType, string> = {
  HARVEST: "القطاع الزراعي",
  COMMERCIAL: "القطاع التجاري",
};

export const SECTOR_MODE_LABEL_AR: Record<SectorMode, string> = {
  BOTH: "القطاع الزراعي + القطاع التجاري",
  HARVEST_ONLY: "القطاع الزراعي فقط",
  COMMERCIAL_ONLY: "القطاع التجاري فقط",
};

export const FORBIDDEN_PREFIX = "FORBIDDEN:";

export function forbiddenMessage(message: string): string {
  return `${FORBIDDEN_PREFIX} ${message}`;
}

/** Maps a thrown service error to an HTTP status (403 for policy violations). */
export function portalErrorStatus(err: unknown, fallback = 400): number {
  const msg = err instanceof Error ? err.message : String(err || "");
  if (msg.startsWith(FORBIDDEN_PREFIX)) return 403;
  if (msg.startsWith("NOT_FOUND")) return 404;
  return fallback;
}

export function stripPolicyPrefix(message: string): string {
  return message.startsWith(FORBIDDEN_PREFIX) ? message.slice(FORBIDDEN_PREFIX.length).trim() : message;
}

export function normalizeSectorMode(raw: unknown, fallback: SectorMode = "BOTH"): SectorMode {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "BOTH" || v === "HARVEST_ONLY" || v === "COMMERCIAL_ONLY") return v;
  return fallback;
}

/** Client-level mode: `INHERIT` (or empty) means "use tenant default". */
export function resolveEffectiveSectorMode(
  clientMode: unknown,
  tenantDefault: unknown
): SectorMode {
  const raw = String(clientMode ?? "").trim().toUpperCase();
  const base = normalizeSectorMode(tenantDefault, "BOTH");
  if (!raw || raw === "INHERIT") return base;
  return normalizeSectorMode(raw, base);
}

export function allowedSectorsForMode(mode: SectorMode): SectorType[] {
  if (mode === "HARVEST_ONLY") return ["HARVEST"];
  if (mode === "COMMERCIAL_ONLY") return ["COMMERCIAL"];
  return ["HARVEST", "COMMERCIAL"];
}

export function isSectorAllowed(mode: SectorMode, sector: unknown): boolean {
  const s = String(sector ?? "HARVEST").trim().toUpperCase() === "COMMERCIAL" ? "COMMERCIAL" : "HARVEST";
  return allowedSectorsForMode(mode).includes(s);
}

/** Throws a FORBIDDEN (HTTP 403) error when the sector is not available to the client. */
export function assertSectorAllowed(mode: SectorMode, sector: unknown): SectorType {
  const s: SectorType =
    String(sector ?? "HARVEST").trim().toUpperCase() === "COMMERCIAL" ? "COMMERCIAL" : "HARVEST";
  if (!isSectorAllowed(mode, s)) {
    throw new Error(
      forbiddenMessage(`⛔ ${SECTOR_LABEL_AR[s]} غير متاح لحسابك. الأقسام المتاحة: ${SECTOR_MODE_LABEL_AR[mode]}`)
    );
  }
  return s;
}

/** Resolves the sector a client is locked into (null when both are available → show switcher). */
export function lockedSectorForMode(mode: SectorMode): SectorType | null {
  const list = allowedSectorsForMode(mode);
  return list.length === 1 ? list[0] : null;
}

// ---------------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------------

export type ClientAccountAction =
  | "SUSPEND"
  | "ARCHIVE"
  | "REACTIVATE"
  | "REVOKE_SESSIONS"
  | "SET_SECTORS"
  | "SET_CREDIT_LIMIT";

export function canClientLogin(status: string): { ok: boolean; message?: string } {
  const s = String(status || "").toUpperCase();
  if (s === "SUSPENDED") return { ok: false, message: "تم إيقاف الحساب مؤقتاً، يرجى التواصل مع إدارة المنشأة" };
  if (s === "ARCHIVED") return { ok: false, message: "تمت أرشفة هذا الحساب، يرجى التواصل مع إدارة المنشأة لإعادة التفعيل" };
  if (s === "REJECTED") return { ok: false, message: "تم رفض هذا الحساب من قبل المنشأة" };
  return { ok: true };
}

export function canClientCreateOrders(status: string): boolean {
  return String(status || "").toUpperCase() === "ACTIVE";
}

/** Returns the next status for a lifecycle action or throws when the transition is invalid. */
export function nextAccountStatus(current: string, action: ClientAccountAction): string {
  const cur = String(current || "").toUpperCase();
  switch (action) {
    case "SUSPEND":
      if (cur !== "ACTIVE") throw new Error("لا يمكن الإيقاف المؤقت إلا لحساب نشط");
      return "SUSPENDED";
    case "ARCHIVE":
      if (cur === "ARCHIVED") throw new Error("الحساب مؤرشف بالفعل");
      return "ARCHIVED";
    case "REACTIVATE":
      if (cur !== "SUSPENDED" && cur !== "ARCHIVED") {
        throw new Error("إعادة التفعيل متاحة للحسابات الموقوفة أو المؤرشفة فقط");
      }
      return "ACTIVE";
    default:
      return cur;
  }
}

// ---------------------------------------------------------------------------
// Return-to-client edit permissions
// ---------------------------------------------------------------------------

export interface ReturnEditPermissions {
  price: boolean; // تعديل السعر
  quantity: boolean; // تعديل الكمية
  unit: boolean; // تعديل الوحدة / النوع
  pickupLocation: boolean; // تعديل الاستلام من:
  pickupNotes: boolean; // تعديل ملاحظات الاستلام
  lines: boolean; // إضافة/حذف أصناف
}

export const RETURN_EDIT_PERMISSION_LABELS_AR: Record<keyof ReturnEditPermissions, string> = {
  price: "تعديل السعر",
  quantity: "تعديل الكمية",
  unit: "تعديل الوحدة / النوع",
  pickupLocation: "تعديل الاستلام من:",
  pickupNotes: "تعديل ملاحظات الاستلام",
  lines: "إضافة/حذف أصناف",
};

/** Backward compatible default: every field editable (legacy returned requests keep working). */
export const DEFAULT_RETURN_EDIT_PERMISSIONS: ReturnEditPermissions = {
  price: true,
  quantity: true,
  unit: true,
  pickupLocation: true,
  pickupNotes: true,
  lines: true,
};

export function normalizeReturnEditPermissions(raw: unknown): ReturnEditPermissions {
  let src: unknown = raw;
  if (typeof raw === "string") {
    try {
      src = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      src = {};
    }
  }
  const obj = src && typeof src === "object" ? (src as Record<string, unknown>) : {};
  const out = { ...DEFAULT_RETURN_EDIT_PERMISSIONS };
  (Object.keys(out) as Array<keyof ReturnEditPermissions>).forEach((k) => {
    if (obj[k] !== undefined) out[k] = Boolean(obj[k]);
  });
  return out;
}

export interface PolicyLine {
  id?: string | null;
  itemTitle?: string | null;
  qty: number;
  unitCode?: string | null;
  unitLabel?: string | null;
  customUnitLabel?: string | null;
  unitPrice: number;
}

export interface PolicyRequestShape {
  pickupLocation?: string | null;
  pickupNotes?: string | null;
  lines: PolicyLine[];
}

const EPS = 1e-9;

/**
 * Compares the original (returned) request with the client's resubmission and lists the
 * locked fields the client attempted to modify. An empty list means the edit is allowed.
 */
export function findLockedFieldViolations(
  before: PolicyRequestShape,
  after: PolicyRequestShape,
  perms: ReturnEditPermissions
): Array<keyof ReturnEditPermissions> {
  const violations = new Set<keyof ReturnEditPermissions>();

  if (!perms.pickupLocation) {
    if (String(before.pickupLocation || "").trim() !== String(after.pickupLocation || "").trim()) {
      violations.add("pickupLocation");
    }
  }
  if (!perms.pickupNotes) {
    if (String(before.pickupNotes || "").trim() !== String(after.pickupNotes || "").trim()) {
      violations.add("pickupNotes");
    }
  }

  const beforeById = new Map(before.lines.filter((l) => l.id).map((l) => [String(l.id), l]));
  const keptIds = new Set<string>();
  for (const line of after.lines) {
    const orig = line.id ? beforeById.get(String(line.id)) : undefined;
    if (!orig) {
      // New line (or an id not belonging to this request) → adding lines
      if (!perms.lines) violations.add("lines");
      continue;
    }
    keptIds.add(String(orig.id));
    if (!perms.lines) {
      const origTitle = String(orig.itemTitle || "").trim();
      const nextTitle = String(line.itemTitle || "").trim();
      if (origTitle && nextTitle && origTitle !== nextTitle) {
        violations.add("lines");
      }
    }
    if (!perms.price && Math.abs(Number(line.unitPrice || 0) - Number(orig.unitPrice || 0)) > EPS) {
      violations.add("price");
    }
    if (!perms.quantity && Math.abs(Number(line.qty || 0) - Number(orig.qty || 0)) > EPS) {
      violations.add("quantity");
    }
    if (!perms.unit) {
      const unitChanged =
        String(line.unitCode || "") !== String(orig.unitCode || "") ||
        String(line.unitLabel || "") !== String(orig.unitLabel || "") ||
        String(line.customUnitLabel || "") !== String(orig.customUnitLabel || "");
      if (unitChanged) violations.add("unit");
    }
  }
  if (!perms.lines) {
    for (const id of beforeById.keys()) {
      if (!keptIds.has(id)) violations.add("lines");
    }
  }
  return [...violations];
}

export function describeViolationsAr(violations: Array<keyof ReturnEditPermissions>): string {
  return violations.map((v) => RETURN_EDIT_PERMISSION_LABELS_AR[v]).join("، ");
}

/** Throws a FORBIDDEN (HTTP 403) error when locked fields were modified. */
export function assertReturnEditAllowed(
  before: PolicyRequestShape,
  after: PolicyRequestShape,
  perms: ReturnEditPermissions
): void {
  const violations = findLockedFieldViolations(before, after, perms);
  if (violations.length > 0) {
    throw new Error(
      forbiddenMessage(`⛔ لا يسمح بتعديل الحقول التالية على هذا الطلب المُعاد: ${describeViolationsAr(violations)}`)
    );
  }
}

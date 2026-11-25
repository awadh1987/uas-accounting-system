import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  extractTenantResolutionFromRequest,
  getActiveTenantId,
  normalizeTenantId,
} from "@/lib/tenant/tenantContext";
import { findTenantBySlug } from "@/lib/tenant/tenantRegistry";

export const CLIENT_PORTAL_COOKIE_NAME = "uas_client_session";
export const CLIENT_PORTAL_TOKEN_HEADER = "x-uas-client-token";
export const CLIENT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface ClientPortalSessionPayload {
  kind: "client_portal";
  cid: string;
  custId?: string | null;
  tid: string;
  slug: string;
  phone: string;
  disp: string;
  sv: number;
  iat: number;
  exp: number;
}

const YEMEN_MOBILE_RE = /^7[01378]\d{7}$/;
const GENERIC_E164_RE = /^\+[1-9]\d{7,14}$/;
const RFC_EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

/**
 * Validates and normalizes Yemeni mobile phones (`77/78/73/71/70` 9-digit local,
 * `07x`, `9677x`, `+9677x`, `009677x`) or standard international E.164 (`+...`).
 */
export function normalizeClientPhone(raw: unknown): {
  valid: boolean;
  normalized: string;
  e164: string;
  error?: string;
} {
  const input = String(raw ?? "").trim();
  if (!input) {
    return { valid: false, normalized: "", e164: "", error: "يرجى إدخال رقم الجوال" };
  }

  // Convert Arabic-Indic digits if typed in Arabic keyboard
  const ascii = input.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660)
  );
  const compact = ascii.replace(/[\s\-().]+/g, "");

  if (compact.startsWith("00967")) {
    const rest = compact.slice(5);
    if (YEMEN_MOBILE_RE.test(rest)) {
      return { valid: true, normalized: rest, e164: `+967${rest}` };
    }
  } else if (compact.startsWith("+967")) {
    const rest = compact.slice(4);
    if (YEMEN_MOBILE_RE.test(rest)) {
      return { valid: true, normalized: rest, e164: `+967${rest}` };
    }
  } else if (compact.startsWith("967") && compact.length === 12) {
    const rest = compact.slice(3);
    if (YEMEN_MOBILE_RE.test(rest)) {
      return { valid: true, normalized: rest, e164: `+967${rest}` };
    }
  } else if (compact.startsWith("07") && compact.length === 10) {
    const rest = compact.slice(1);
    if (YEMEN_MOBILE_RE.test(rest)) {
      return { valid: true, normalized: rest, e164: `+967${rest}` };
    }
  } else if (YEMEN_MOBILE_RE.test(compact)) {
    return { valid: true, normalized: compact, e164: `+967${compact}` };
  }

  // Fallback: non-Yemen international E.164 (only if explicitly starts with + and not +967 invalid prefix)
  if (compact.startsWith("+") && !compact.startsWith("+967")) {
    if (GENERIC_E164_RE.test(compact)) {
      return { valid: true, normalized: compact, e164: compact };
    }
  }

  return {
    valid: false,
    normalized: "",
    e164: "",
    error:
      "رقم الجوال غير صحيح: أدخل رقماً يمنياً من 9 أرقام يبدأ بـ (77 / 78 / 73 / 71 / 70) أو صيغة دولية +...",
  };
}

export function normalizeClientEmail(raw: unknown): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) {
    return { valid: false, normalized: "", error: "يرجى إدخال البريد الإلكتروني" };
  }
  if (email.length > 254 || email.includes("..") || !RFC_EMAIL_RE.test(email)) {
    return { valid: false, normalized: "", error: "صيغة البريد الإلكتروني غير صحيحة" };
  }
  return { valid: true, normalized: email };
}

function getClientPortalSecret(): string {
  const configured =
    process.env.UAS_CLIENT_PORTAL_SECRET ||
    process.env.UAS_SESSION_SECRET ||
    process.env.UAS_VENDOR_ADMIN_TOKEN ||
    "";
  const base =
    configured.trim().length >= 16
      ? configured.trim()
      : "uas-enterprise-hmac-session-secret-2026";
  // Domain separation ensures client tokens cannot forge staff tokens and vice versa
  return crypto.createHash("sha256").update(`CLIENT_PORTAL_KEY_V1|${base}`).digest("hex");
}

function signClientPayloadB64(payloadB64: string): string {
  return crypto
    .createHmac("sha256", getClientPortalSecret())
    .update(payloadB64, "utf8")
    .digest("base64url");
}

export function issueClientPortalToken(input: {
  clientAccountId: string;
  customerId?: string | null;
  tenantId: string;
  tenantSlug?: string | null;
  phone: string;
  displayName: string;
  sessionVersion?: number;
  ttlMs?: number;
}): string {
  const now = Date.now();
  const ttl =
    Number.isFinite(input.ttlMs) && (input.ttlMs ?? 0) > 0
      ? Number(input.ttlMs)
      : CLIENT_SESSION_TTL_MS;

  const payload: ClientPortalSessionPayload = {
    kind: "client_portal",
    cid: String(input.clientAccountId).trim(),
    custId: input.customerId ?? null,
    tid: normalizeTenantId(input.tenantId),
    slug: String(input.tenantSlug || input.tenantId || "default").trim().toLowerCase(),
    phone: String(input.phone).trim(),
    disp: String(input.displayName).trim(),
    sv: Number.isFinite(input.sessionVersion) && Number(input.sessionVersion) > 0 ? Number(input.sessionVersion) : 1,
    iat: now,
    exp: now + ttl,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signClientPayloadB64(encoded)}`;
}

export function verifyClientPortalToken(token: string | null | undefined): ClientPortalSessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const trimmed = token.trim();
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx <= 0) return null;

  const payloadB64 = trimmed.slice(0, dotIdx);
  const sig = trimmed.slice(dotIdx + 1);
  if (!payloadB64 || !sig) return null;

  const expectedSig = signClientPayloadB64(payloadB64);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8")
    ) as Partial<ClientPortalSessionPayload>;

    if (
      parsed.kind !== "client_portal" ||
      typeof parsed.cid !== "string" ||
      !parsed.cid.trim() ||
      typeof parsed.tid !== "string" ||
      !parsed.tid.trim() ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }

    if (Date.now() > parsed.exp) {
      return null;
    }

    return {
      kind: "client_portal",
      cid: parsed.cid.trim(),
      custId: parsed.custId ?? null,
      tid: normalizeTenantId(parsed.tid),
      slug: String(parsed.slug || parsed.tid).trim().toLowerCase(),
      phone: String(parsed.phone || "").trim(),
      disp: String(parsed.disp || "").trim(),
      sv: typeof parsed.sv === "number" && parsed.sv > 0 ? parsed.sv : 1,
      iat: Number(parsed.iat) || Date.now(),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function hashClientResetCode(clientAccountId: string, rawCode: string): string {
  return crypto
    .createHmac("sha256", getClientPortalSecret())
    .update(`RESET_CODE_V1|${clientAccountId}|${rawCode.trim()}`, "utf8")
    .digest("hex");
}

export function verifyClientResetCode(
  clientAccountId: string,
  candidateCode: string,
  storedHash: string
): boolean {
  const candidate = String(candidateCode || "").trim();
  if (!candidate || !storedHash) return false;
  const computed = hashClientResetCode(clientAccountId, candidate);
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const RESET_RATE_BUCKETS = new Map<string, number[]>();

/**
 * Sliding-window in-memory rate limit guard for client portal password recovery.
 */
export function consumeClientResetRateLimit(
  bucketKey: string,
  maxAttempts = 6,
  windowMs = 15 * 60 * 1000
): boolean {
  const now = Date.now();
  const prev = (RESET_RATE_BUCKETS.get(bucketKey) || []).filter((ts) => now - ts < windowMs);
  if (prev.length >= maxAttempts) {
    RESET_RATE_BUCKETS.set(bucketKey, prev);
    return false;
  }
  prev.push(now);
  RESET_RATE_BUCKETS.set(bucketKey, prev);
  if (RESET_RATE_BUCKETS.size > 5000) {
    for (const [k, list] of RESET_RATE_BUCKETS.entries()) {
      if (list.every((ts) => now - ts >= windowMs)) {
        RESET_RATE_BUCKETS.delete(k);
      }
    }
  }
  return true;
}

export function extractClientTokenFromRequest(req?: Request | NextRequest | null): string | null {
  if (!req) return null;
  const headerToken = req.headers.get(CLIENT_PORTAL_TOKEN_HEADER);
  if (headerToken?.trim()) return headerToken.trim();

  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("clientbearer ")) {
    return authHeader.slice("clientbearer ".length).trim();
  }

  if ("cookies" in req && typeof req.cookies?.get === "function") {
    const c = req.cookies.get(CLIENT_PORTAL_COOKIE_NAME)?.value;
    if (c?.trim()) return c.trim();
  }

  const cookieHdr = req.headers.get("cookie") || "";
  for (const part of cookieHdr.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === CLIENT_PORTAL_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export function attachClientSessionCookie(
  res: NextResponse,
  token: string,
  req?: Request | NextRequest
): NextResponse {
  const host = req?.headers.get("host") || "";
  const isHttps =
    (req?.headers.get("x-forwarded-proto") || "").includes("https") ||
    process.env.NODE_ENV === "production";

  res.cookies.set(CLIENT_PORTAL_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(CLIENT_SESSION_TTL_MS / 1000),
    secure: isHttps && !host.startsWith("localhost") && !host.startsWith("127.0.0.1"),
  });
  return res;
}

export function clearClientSessionCookie(
  res: NextResponse,
  req?: Request | NextRequest
): NextResponse {
  const host = req?.headers.get("host") || "";
  const isHttps =
    (req?.headers.get("x-forwarded-proto") || "").includes("https") ||
    process.env.NODE_ENV === "production";

  res.cookies.set(CLIENT_PORTAL_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: isHttps && !host.startsWith("localhost") && !host.startsWith("127.0.0.1"),
  });
  return res;
}

export function resolveRequestTenantScope(req?: Request | NextRequest): {
  tenantId: string;
  tenantSlug: string;
} {
  const activeTid = getActiveTenantId();
  if (!req) {
    const meta = findTenantBySlug(activeTid);
    return {
      tenantId: activeTid,
      tenantSlug: meta?.slug || activeTid,
    };
  }
  const resolved = extractTenantResolutionFromRequest(req);
  const tid = activeTid !== "default" ? activeTid : resolved.tenantId;
  const meta = findTenantBySlug(resolved.slug || tid);
  return {
    tenantId: normalizeTenantId(tid),
    tenantSlug: (meta?.slug || resolved.slug || tid || "default").toLowerCase(),
  };
}

export async function resolveAuthenticatedClient(req?: Request | NextRequest) {
  const token = extractClientTokenFromRequest(req);
  if (!token) {
    return { ok: false as const, status: 401, error: "يرجى تسجيل الدخول إلى بوابة العميل أولاً" };
  }

  const payload = verifyClientPortalToken(token);
  if (!payload) {
    return { ok: false as const, status: 401, error: "انتهت صلاحية جلسة العميل أو أنها غير صالحة" };
  }

  const scope = resolveRequestTenantScope(req);
  if (normalizeTenantId(payload.tid) !== normalizeTenantId(scope.tenantId)) {
    return {
      ok: false as const,
      status: 403,
      error: "⛔ الجلسة تابعة لمساحة منشأة أخرى (Cross-tenant access blocked)",
    };
  }

  const account = await prisma.clientPortalAccount.findUnique({
    where: { id: payload.cid },
  });

  if (!account) {
    return { ok: false as const, status: 401, error: "حساب العميل غير موجود في هذه المنشأة" };
  }

  if (account.status === "REJECTED") {
    return {
      ok: false as const,
      status: 403,
      error: account.rejectedReason
        ? `تم رفض طلب التسجيل: ${account.rejectedReason}`
        : "تم رفض طلب تسجيل هذا الحساب من قبل إدارة المنشأة",
    };
  }

  if (account.status === "SUSPENDED") {
    return { ok: false as const, status: 403, error: "تم تعليق هذا الحساب، يرجى التواصل مع الإدارة" };
  }

  if ((account.sessionVersion ?? 1) !== (payload.sv ?? 1)) {
    return {
      ok: false as const,
      status: 401,
      error: "تم إنهاء الجلسة بعد تحديث كلمة المرور، يرجى تسجيل الدخول مجدداً",
    };
  }

  return {
    ok: true as const,
    payload,
    account,
    scope,
  };
}

import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { normalizeRole } from "@/lib/permissions";
import type { UserRole } from "@/types/uas";

export const SESSION_COOKIE_NAME = "uas_session";
export const AUTH_COOKIE_NAMES = ["uas_session", "uas_token", "uas_auth", "uas_user"] as const;
export const SESSION_TOKEN_STORAGE_KEY = "uas_session_token";
export const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  uid: string;
  role: UserRole;
  tid: string;
  disp: string;
  iat: number;
  exp: number;
}

function getSessionSecret(): string {
  const configured =
    process.env.UAS_SESSION_SECRET ||
    process.env.UAS_VENDOR_ADMIN_TOKEN ||
    "";
  if (configured.trim().length >= 16) {
    return configured.trim();
  }
  return "uas-enterprise-hmac-session-secret-2026";
}

function signPayloadB64(payloadB64: string): string {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(payloadB64, "utf8")
    .digest("base64url");
}

export function issueSessionToken(input: {
  userId: string;
  userRole: UserRole | string;
  tenantId?: string;
  userDisplay?: string;
  ttlMs?: number;
}): string {
  const now = Date.now();
  const ttl = Number.isFinite(input.ttlMs) && (input.ttlMs ?? 0) > 0
    ? Number(input.ttlMs)
    : DEFAULT_SESSION_TTL_MS;

  const payload: SessionPayload = {
    uid: String(input.userId).trim(),
    role: normalizeRole(input.userRole),
    tid: String(input.tenantId || "default").trim() || "default",
    disp: String(input.userDisplay || "").trim(),
    iat: now,
    exp: now + ttl,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signPayloadB64(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const trimmed = token.trim();
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) return null;

  const payloadB64 = trimmed.slice(0, dotIdx);
  const sig = trimmed.slice(dotIdx + 1);
  if (!payloadB64 || !sig || sig.includes(".")) return null;

  try {
    const expectedSig = signPayloadB64(payloadB64);
    const sigBuf = Buffer.from(sig, "utf8");
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      !decoded ||
      typeof decoded.uid !== "string" ||
      !decoded.uid.trim() ||
      typeof decoded.exp !== "number" ||
      decoded.exp <= Date.now()
    ) {
      return null;
    }

    return {
      uid: decoded.uid.trim(),
      role: normalizeRole(decoded.role),
      tid: typeof decoded.tid === "string" && decoded.tid.trim() ? decoded.tid.trim() : "default",
      disp: typeof decoded.disp === "string" ? decoded.disp : "",
      iat: typeof decoded.iat === "number" ? decoded.iat : 0,
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}

function parseCookieHeaderValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const k = part.slice(0, eqIdx).trim();
    if (k === name) {
      const v = part.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

export function extractSessionTokenFromRequest(
  req?: NextRequest | Request | null
): {
  token: string | null;
  payload: SessionPayload | null;
  hadInvalidToken: boolean;
} {
  if (!req) {
    return { token: null, payload: null, hadInvalidToken: false };
  }

  let cookieToken: string | null = null;
  if ("cookies" in req && typeof req.cookies?.get === "function") {
    cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value || null;
  }
  if (!cookieToken) {
    cookieToken = parseCookieHeaderValue(req.headers.get("cookie"), SESSION_COOKIE_NAME);
  }

  const headerToken = req.headers.get("x-uas-session-token")?.trim() || null;
  const authHeader = req.headers.get("authorization")?.trim() || "";
  const bearerToken = /^Bearer\s+/i.test(authHeader)
    ? authHeader.replace(/^Bearer\s+/i, "").trim()
    : null;

  const candidate = headerToken || bearerToken || cookieToken;
  if (!candidate) {
    return { token: null, payload: null, hadInvalidToken: false };
  }

  const verified = verifySessionToken(candidate);
  if (!verified) {
    return { token: candidate, payload: null, hadInvalidToken: true };
  }

  return { token: candidate, payload: verified, hadInvalidToken: false };
}

export function attachSessionCookie(
  res: NextResponse,
  token: string,
  maxAgeSec = Math.floor(DEFAULT_SESSION_TTL_MS / 1000)
): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearSessionCookies(res: NextResponse): void {
  for (const cookieName of AUTH_COOKIE_NAMES) {
    res.cookies.set(cookieName, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
}

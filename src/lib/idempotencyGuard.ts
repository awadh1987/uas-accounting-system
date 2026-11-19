import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const IDEMPOTENCY_HEADER = "x-idempotency-key";
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface InFlightEntry {
  status: number;
  bodyText: string;
  headers: Record<string, string>;
}

// In-process deduplication tracker for rapid concurrent double-clicks/taps
const inFlightMap = new Map<string, Promise<InFlightEntry>>();

/**
 * Extracts the idempotency key from request headers (case-insensitive).
 */
export function extractIdempotencyKey(req: NextRequest | Request): string | null {
  const key =
    req.headers.get("x-idempotency-key") ||
    req.headers.get("X-Idempotency-Key") ||
    req.headers.get("X-IDEMPOTENCY-KEY");
  const trimmed = key ? key.trim() : null;
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Executes a Next.js route handler guarded by the `X-Idempotency-Key` header.
 * If an active cached response exists for the key, it is returned immediately
 * without re-executing the handler (preventing duplicate GL entries, stock deductions,
 * drafts promotions, or approval decisions).
 */
export async function withIdempotency(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>,
  opts?: {
    userId?: string | null;
  }
): Promise<NextResponse> {
  const method = req.method.toUpperCase();
  // Idempotency applies to mutating operations
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return handler(req);
  }

  const key = extractIdempotencyKey(req);
  if (!key) {
    // If no key provided, execute normally
    return handler(req);
  }

  const endpoint = req.nextUrl?.pathname || new URL(req.url, "http://localhost").pathname;

  // 1. Concurrency Lock: Check if identical request is currently in-flight synchronously
  const executionPromise = inFlightMap.get(key);
  if (executionPromise) {
    try {
      const cached = await executionPromise;
      return new NextResponse(cached.bodyText, {
        status: cached.status,
        headers: {
          ...cached.headers,
          "Content-Type": "application/json",
          "X-Idempotency-Hit": "true",
          "X-Idempotency-Key": key,
        },
      });
    } catch {
      // In-flight execution failed; fall through to run fresh
    }
  }

  // 2. Register in inFlightMap synchronously BEFORE any async yields
  const inFlight = (async (): Promise<InFlightEntry> => {
    // Check persistent SQLite/PostgreSQL store first
    try {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { idempotencyKey: key },
      });

      if (existing && existing.expiresAt > new Date()) {
        return {
          status: existing.statusCode,
          bodyText: existing.responseJson,
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Hit": "true",
            "X-Idempotency-Key": key,
          },
        };
      }
    } catch (err) {
      console.warn("[idempotencyGuard] DB lookup failed, falling back to handler:", err);
    }

    const res = await handler(req);
    const status = res.status;
    let bodyText = "";
    try {
      bodyText = await res.clone().text();
    } catch {
      bodyText = JSON.stringify({ success: res.ok });
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((val, k) => {
      headers[k] = val;
    });

    // Only cache successful or client-error responses (not 5xx server crashes)
    if (status < 500) {
      try {
        const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
        await prisma.idempotencyRecord.upsert({
          where: { idempotencyKey: key },
          create: {
            idempotencyKey: key,
            endpoint,
            method,
            userId: opts?.userId ?? null,
            statusCode: status,
            responseJson: bodyText,
            expiresAt,
          },
          update: {
            statusCode: status,
            responseJson: bodyText,
            expiresAt,
          },
        });
      } catch (dbErr) {
        console.warn("[idempotencyGuard] Failed to persist idempotency record:", dbErr);
      }
    }

    return { status, bodyText, headers };
  })();

  inFlightMap.set(key, inFlight);

  try {
    const entry = await inFlight;
    return new NextResponse(entry.bodyText, {
      status: entry.status,
      headers: {
        ...entry.headers,
        "X-Idempotency-Hit": "false",
        "X-Idempotency-Key": key,
      },
    });
  } finally {
    inFlightMap.delete(key);
  }
}

const inFlightFnMap = new Map<string, Promise<{ statusCode: number; data: unknown; cached: boolean }>>();

/**
 * Functional wrapper for programmatic operations (e.g. within services/actions).
 */
export async function executeWithIdempotency<T>(
  key: string | null | undefined,
  meta: {
    endpoint: string;
    method: string;
    userId?: string | null;
  },
  fn: () => Promise<{ statusCode: number; data: T }>
): Promise<{ statusCode: number; data: T; cached: boolean }> {
  if (!key || !key.trim()) {
    const fresh = await fn();
    return { ...fresh, cached: false };
  }

  const cleanKey = key.trim();

  // 1. Check in-flight promise synchronously
  const existingInFlight = inFlightFnMap.get(cleanKey);
  if (existingInFlight) {
    try {
      const res = await existingInFlight;
      return { statusCode: res.statusCode, data: res.data as T, cached: true };
    } catch {
      // failed; fall through
    }
  }

  // 2. Register in inFlightFnMap synchronously BEFORE any async await
  const promise = (async () => {
    // Check DB first
    try {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { idempotencyKey: cleanKey },
      });
      if (existing && existing.expiresAt > new Date()) {
        return {
          statusCode: existing.statusCode,
          data: JSON.parse(existing.responseJson) as T,
          cached: true,
        };
      }
    } catch (err) {
      console.warn("[executeWithIdempotency] DB lookup error:", err);
    }

    const result = await fn();

    if (result.statusCode < 500) {
      try {
        const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
        await prisma.idempotencyRecord.upsert({
          where: { idempotencyKey: cleanKey },
          create: {
            idempotencyKey: cleanKey,
            endpoint: meta.endpoint,
            method: meta.method,
            userId: meta.userId ?? null,
            statusCode: result.statusCode,
            responseJson: JSON.stringify(result.data),
            expiresAt,
          },
          update: {
            statusCode: result.statusCode,
            responseJson: JSON.stringify(result.data),
            expiresAt,
          },
        });
      } catch (err) {
        console.warn("[executeWithIdempotency] DB persist error:", err);
      }
    }

    return { ...result, cached: false };
  })();

  inFlightFnMap.set(cleanKey, promise);
  try {
    return (await promise) as { statusCode: number; data: T; cached: boolean };
  } finally {
    inFlightFnMap.delete(cleanKey);
  }
}

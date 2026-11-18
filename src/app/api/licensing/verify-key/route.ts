import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureSqliteDatabaseReady } from "@/lib/sqliteBootstrap";
import { createPrismaSeatStore } from "@/lib/licensing/prismaSeatStore";
import { releaseKeySeat, verifyKeyRequest } from "@/lib/licensing/licenseAuthority";

export const dynamic = "force-dynamic";

/**
 * Cloud license authority — https://qat.world/api/licensing/verify-key
 *
 * POST { key, company_name, user_email, platform, hwid, device_name? }
 *   → verifies the Ed25519-signed UASKEY, the company name and the seat quota
 *     (7 users × 1 Windows + 1 Android) in the shared LicenseDeviceBinding table.
 *
 * POST { action: "release", key, user_email, platform? }  + `Authorization: Bearer $UAS_VENDOR_ADMIN_TOKEN`
 *   → vendor-side seat release (disabled unless UAS_VENDOR_ADMIN_TOKEN is configured).
 *
 * CORS is applied globally by src/proxy.ts (the Android/Capacitor app calls this cross-origin).
 */

// Small per-IP rate limiter (best effort, in-memory)
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return recent.length > MAX_PER_WINDOW;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function POST(req: NextRequest) {
  try {
    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "local").split(",")[0].trim();
    if (rateLimited(ip)) {
      return NextResponse.json(
        { success: false, code: "RATE_LIMITED", error: "محاولات كثيرة، حاول لاحقاً. / Too many requests, try again later." },
        { status: 429 }
      );
    }

    await ensureSqliteDatabaseReady();
    const body = (await req.json()) as Record<string, unknown>;
    const store = createPrismaSeatStore();

    if (body.action === "release") {
      const adminToken = (process.env.UAS_VENDOR_ADMIN_TOKEN || "").trim();
      const auth = req.headers.get("authorization") || "";
      const presented = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      if (!adminToken || !presented || !timingSafeEqual(adminToken, presented)) {
        return NextResponse.json(
          { success: false, code: "FORBIDDEN", error: "غير مصرح / Vendor admin authorization required." },
          { status: 403 }
        );
      }
      const out = await releaseKeySeat(body, { store });
      return NextResponse.json(out.body, { status: out.status });
    }

    const out = await verifyKeyRequest(body, { store });
    return NextResponse.json(out.body, { status: out.status });
  } catch (err) {
    console.error("[Licensing verify-key Error]:", err);
    return NextResponse.json(
      { success: false, code: "SERVER_ERROR", error: "تعذر التحقق من المفتاح. / Unable to verify key." },
      { status: 500 }
    );
  }
}

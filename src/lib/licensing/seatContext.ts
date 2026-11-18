import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/lib/permissions";
import { getMachineHwid } from "./hwid";

/** True when the HTTP request comes from the machine that runs the server (desktop app). */
export function isLoopbackRequest(req: NextRequest): boolean {
  const host = (req.headers.get("host") || req.nextUrl?.hostname || "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Device identity used for a seat:
 *   - Windows desktop app talking to its own local server → this machine's hardware HWID
 *   - any other client (LAN browser, Android app) → persistent client-generated device id
 */
export function resolveSeatHwid(req: NextRequest, platform: string, deviceId: unknown): string | null {
  if (platform === "windows" && isLoopbackRequest(req)) return getMachineHwid();
  const id = typeof deviceId === "string" ? deviceId.trim() : "";
  return id.length >= 8 ? id : null;
}

export interface SuperAdminActor {
  userId: string;
  userDisplay: string;
  userRole: string;
}

/**
 * Requires an EXPLICITLY identified, active SUPER_ADMIN (x-uas-user-id header or body.actor.userId).
 * Unlike the legacy default-actor fallback, anonymous callers never resolve to an admin here.
 */
export async function requireSuperAdmin(
  req: NextRequest,
  body: Record<string, unknown> = {}
): Promise<{ ok: true; actor: SuperAdminActor } | { ok: false }> {
  const bodyActor = (body.actor as { userId?: unknown } | undefined) || {};
  const userId = String(req.headers.get("x-uas-user-id") || bodyActor.userId || "").trim();
  if (!userId) return { ok: false };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, displayName: true, role: true, active: true, isActive: true },
  });
  if (!user || user.active === false || user.isActive === false) return { ok: false };
  const role = normalizeRole(user.role);
  if (role !== "SUPER_ADMIN") return { ok: false };

  return {
    ok: true,
    actor: {
      userId: user.id,
      userDisplay: `${user.displayName || user.name} (${role})`,
      userRole: role,
    },
  };
}

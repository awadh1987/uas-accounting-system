import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { normalizeRole } from "@/lib/permissions";
import { clearSessionCookies } from "@/lib/authSession";
import { resolveVerifiedActor } from "@/lib/apiHelpers";

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }

  try {
    const actor = await resolveVerifiedActor(body, req);
    const targetUserId =
      actor.authenticated && actor.userId
        ? actor.userId
        : String(body.actorId || body.userId || "").trim();

    if (targetUserId) {
      const ipAddress =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null;

      const user = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, name: true, displayName: true, role: true },
      });

      if (user) {
        const resolvedRole = normalizeRole(user.role);
        const display = user.displayName || user.name;
        await prisma.$transaction(async (tx) => {
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: "USER_LOGOUT",
              entity: "User",
              entityId: user.id,
              details: {
                actorId: user.id,
                actorRole: resolvedRole,
                event: "USER_LOGOUT",
              },
              ipAddress,
            },
          });

          await appendAuditLogTx(tx, {
            userId: user.id,
            userDisplay: `${display} (${resolvedRole})`,
            userRole: resolvedRole,
            actionType: "USER_LOGOUT",
            entityReference: user.id,
            details: `تم تسجيل الخروج بنجاح لحساب ${display}`,
          });
        });
      }
    }
  } catch (err) {
    console.warn("POST /api/auth/logout audit log skipped:", err);
  }

  const res = NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      },
    }
  );
  clearSessionCookies(res);
  return res;
});


import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appendAuditLogTx } from "@/lib/serverBootstrap";
import { normalizeRole } from "@/lib/permissions";

const AUTH_COOKIE_NAMES = ["uas_session", "uas_token", "uas_auth", "uas_user"];

export async function POST(req: NextRequest) {
  let actorId = "";
  let actorRole = "";

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    actorId = String(body.actorId || body.userId || "").trim();
    actorRole = String(body.actorRole || body.role || "").trim();
  } catch {
    // Ignore malformed or empty request body; logout must always succeed.
  }

  if (actorId || actorRole) {
    try {
      const ipAddress =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null;

      if (actorId) {
        const user = await prisma.user.findUnique({
          where: { id: actorId },
          select: { id: true, name: true, displayName: true, role: true },
        });

        if (user) {
          const resolvedRole = actorRole || user.role;
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
              userDisplay: `${display} (${normalizeRole(resolvedRole)})`,
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
  }

  const res = NextResponse.json({ ok: true });
  for (const cookieName of AUTH_COOKIE_NAMES) {
    res.cookies.set(cookieName, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    });
  }

  return res;
}


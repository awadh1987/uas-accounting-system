import { NextRequest, NextResponse } from "next/server";
import { defaultPrisma, prisma } from "@/lib/prisma";
import { getActiveTenantId, normalizeTenantId } from "@/lib/tenant/tenantContext";
import {
  canApprove,
  canCreate,
  canDeleteVoid,
  canEdit,
  canEditDate,
  canManageLandingCms,
  canManageTreasury,
  canPostLedger,
  isReadOnly,
  normalizeRole,
  type ModuleIdentifier,
} from "@/lib/permissions";
import { parseAssignedProjects } from "@/lib/serverBootstrap";
import { checkLicenseAndClock } from "@/lib/licensing/guard";
import { getRuntimeConfig } from "@/lib/runtimeMode";
import { extractSessionTokenFromRequest } from "@/lib/authSession";
import { buildCorsHeaders, corsOptionsResponse } from "@/lib/cors";
import type { UasUser, UserRole } from "@/types/uas";

export { buildCorsHeaders, corsOptionsResponse };

export interface ActorPayload {
  userId?: string | null;
  userDisplay?: string;
  userRole?: string;
  role?: string;
}

export interface ResolvedActor {
  userId: string | null;
  userDisplay: string;
  userRole: UserRole;
  user?: UasUser | null;
  claimedRole?: UserRole;
  sessionTenantId?: string;
  sessionVerified?: boolean;
  authenticated?: boolean;
  invalidToken?: boolean;
  tenantMismatch?: boolean;
  inactive?: boolean;
  spoofAttempt?: boolean;
}

const USER_AUTH_SELECT = {
  id: true,
  username: true,
  email: true,
  name: true,
  fullName: true,
  displayName: true,
  role: true,
  active: true,
  isActive: true,
  archivedAt: true,
  department: true,
  avatarChar: true,
  avatarColor: true,
  useCustomPermissions: true,
  customAllowedGroups: true,
  customPermissionsJson: true,
  assignedProjects: true,
} as const;

export function extractActor(
  body: Record<string, unknown>,
  req?: NextRequest
): ResolvedActor {
  const session = extractSessionTokenFromRequest(req);
  if (session.payload) {
    const role = normalizeRole(session.payload.role);
    return {
      userId: session.payload.uid,
      userDisplay: session.payload.disp || `مستخدم النظام (${role})`,
      userRole: role,
      sessionTenantId: normalizeTenantId(session.payload.tid),
      sessionVerified: true,
      authenticated: true,
    };
  }
  if (session.hadInvalidToken) {
    return {
      userId: null,
      userDisplay: "غير مصرح",
      userRole: "EXTERNAL_AUDITOR",
      sessionVerified: false,
      authenticated: false,
      invalidToken: true,
    };
  }

  const actor = (body?.actor as ActorPayload | undefined) || {};
  const headerUserId = req?.headers.get("x-uas-user-id")?.trim() || undefined;
  const headerRole = req?.headers.get("x-uas-role")?.trim() || undefined;
  const headerDisplay = req?.headers.get("x-uas-user-display")?.trim() || undefined;

  const rawBodyUserId =
    typeof actor.userId === "string"
      ? actor.userId.trim()
      : typeof body?.userId === "string"
        ? body.userId.trim()
        : undefined;

  const userId = rawBodyUserId || headerUserId || null;
  const rawClaimedRole =
    actor.userRole ||
    actor.role ||
    (typeof body?.userRole === "string" ? body.userRole : undefined) ||
    headerRole ||
    undefined;

  const claimedRole = rawClaimedRole ? normalizeRole(rawClaimedRole) : undefined;
  const userRole: UserRole = userId && claimedRole ? claimedRole : "EXTERNAL_AUDITOR";

  return {
    userId,
    userDisplay:
      actor.userDisplay ||
      headerDisplay ||
      (userId ? `مستخدم (${userId})` : "غير مصرح"),
    userRole,
    claimedRole,
    sessionVerified: false,
    authenticated: false,
  };
}

export async function resolveVerifiedActor(
  body: Record<string, unknown>,
  req?: NextRequest
): Promise<ResolvedActor> {
  const actor = extractActor(body, req);
  if (actor.invalidToken || !actor.userId) {
    return {
      userId: null,
      userDisplay: actor.userDisplay || "غير مصرح",
      userRole: "EXTERNAL_AUDITOR",
      user: null,
      sessionVerified: false,
      authenticated: false,
      invalidToken: actor.invalidToken,
    };
  }

  const activeTenantId = normalizeTenantId(getActiveTenantId());
  const tokenTenantId = actor.sessionVerified
    ? normalizeTenantId(actor.sessionTenantId)
    : activeTenantId;

  let dbUser = null;

  if (actor.sessionVerified && tokenTenantId !== activeTenantId) {
    // Only a live, active root ("default") SUPER_ADMIN may operate across provisioned tenants.
    // Tenant-scoped tokens (even tenant SUPER_ADMINs) are strictly confined to their own `tid`.
    if (tokenTenantId !== "default") {
      return {
        userId: null,
        userDisplay: "غير مصرح",
        userRole: "EXTERNAL_AUDITOR",
        user: null,
        sessionVerified: false,
        authenticated: false,
        tenantMismatch: true,
      };
    }

    const rootUser = await defaultPrisma.user.findFirst({
      where: {
        OR: [{ id: actor.userId }, { username: actor.userId }],
      },
      select: USER_AUTH_SELECT,
    });

    if (!rootUser) {
      return {
        userId: null,
        userDisplay: "غير مصرح",
        userRole: "EXTERNAL_AUDITOR",
        user: null,
        sessionVerified: false,
        authenticated: false,
      };
    }

    if (rootUser.active === false || rootUser.isActive === false || Boolean(rootUser.archivedAt)) {
      return {
        userId: rootUser.id,
        userDisplay: `${rootUser.displayName || rootUser.name} (${normalizeRole(rootUser.role)})`,
        userRole: normalizeRole(rootUser.role),
        user: null,
        sessionVerified: true,
        authenticated: false,
        inactive: true,
      };
    }

    if (normalizeRole(rootUser.role) !== "SUPER_ADMIN") {
      return {
        userId: rootUser.id,
        userDisplay: `${rootUser.displayName || rootUser.name} (${normalizeRole(rootUser.role)})`,
        userRole: normalizeRole(rootUser.role),
        user: null,
        sessionVerified: true,
        authenticated: false,
        tenantMismatch: true,
      };
    }

    dbUser = rootUser;
  } else {
    dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ id: actor.userId }, { username: actor.userId }],
      },
      select: USER_AUTH_SELECT,
    });
  }

  if (!dbUser) {
    return {
      userId: null,
      userDisplay: "غير مصرح",
      userRole: "EXTERNAL_AUDITOR",
      user: null,
      sessionVerified: false,
      authenticated: false,
    };
  }

  const role = normalizeRole(dbUser.role);
  const displayLabel = `${dbUser.displayName || dbUser.name} (${role})`;

  if (dbUser.active === false || dbUser.isActive === false || Boolean(dbUser.archivedAt)) {
    return {
      userId: dbUser.id,
      userDisplay: displayLabel,
      userRole: role,
      user: null,
      sessionVerified: actor.sessionVerified,
      authenticated: false,
      inactive: true,
    };
  }

  // Reject unverified role escalation / spoofing when no signed session token was presented
  if (!actor.sessionVerified && actor.claimedRole && actor.claimedRole !== role) {
    return {
      userId: dbUser.id,
      userDisplay: displayLabel,
      userRole: role,
      user: null,
      sessionVerified: false,
      authenticated: false,
      spoofAttempt: true,
    };
  }

  let customAllowedGroups: string[] = [];
  try {
    if (dbUser.customAllowedGroups) {
      const parsed = JSON.parse(dbUser.customAllowedGroups);
      if (Array.isArray(parsed)) customAllowedGroups = parsed.map(String);
    }
  } catch {
    customAllowedGroups = [];
  }

  let customPermissionsJson: Record<string, boolean> = {};
  try {
    if (dbUser.customPermissionsJson) {
      const parsed = JSON.parse(dbUser.customPermissionsJson);
      if (parsed && typeof parsed === "object") customPermissionsJson = parsed;
    }
  } catch {
    customPermissionsJson = {};
  }

  const uasUser: UasUser = {
    id: dbUser.id,
    username: dbUser.username,
    name: dbUser.name,
    fullName: dbUser.fullName,
    displayName: dbUser.displayName ?? "",
    phone: "",
    email: dbUser.email ?? "",
    role,
    department: dbUser.department,
    active: dbUser.active && (dbUser.isActive ?? true),
    isActive: dbUser.isActive ?? dbUser.active,
    avatarChar: dbUser.avatarChar,
    avatarColor: dbUser.avatarColor ?? "#059669",
    useCustomPermissions: Boolean(dbUser.useCustomPermissions),
    customAllowedGroups,
    customPermissionsJson,
    assignedProjects: parseAssignedProjects(dbUser.assignedProjects),
  };

  return {
    userId: dbUser.id,
    userDisplay: displayLabel,
    userRole: role,
    user: uasUser,
    sessionVerified: actor.sessionVerified,
    authenticated: true,
  };
}

export interface ApiAuthCheck {
  moduleId?: ModuleIdentifier;
  action?: "create" | "edit" | "delete" | "approve" | "post" | "treasury" | "cms";
  dateChanged?: boolean;
}

export async function authorizeApiAction(
  body: Record<string, unknown>,
  req: NextRequest | undefined,
  check: ApiAuthCheck
): Promise<
  | { ok: true; actor: ResolvedActor }
  | { ok: false; response: NextResponse }
> {
  const actor = await resolveVerifiedActor(body, req);

  if (actor.spoofAttempt) {
    return {
      ok: false,
      response: forbiddenError(
        "⛔ رفض أمني: عدم تطابق الصلاحية المرسلة مع الصلاحية المسجلة / Role spoofing detected"
      ),
    };
  }

  if (actor.tenantMismatch) {
    return {
      ok: false,
      response: forbiddenError(
        "⛔ رفض أمني: الرمز غير مصرح للوصول إلى بيانات هذه المنشأة / Cross-tenant session denied"
      ),
    };
  }

  if (actor.inactive) {
    return {
      ok: false,
      response: forbiddenError("🔒 الحساب موقوف أو مؤرشف — لا يمكن تنفيذ الإجراء المطلوب"),
    };
  }

  if (!actor.authenticated || !actor.userId || !actor.user) {
    return {
      ok: false,
      response: unauthorizedError(),
    };
  }

  // Licensing & Monotonic Clock & LAN Seat check on mutations (Fail Closed)
  if (req && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) {
    try {
      const runtimeConfig = getRuntimeConfig();
      const seatToken = req.headers.get("x-uas-seat-token") || undefined;
      const clientIp =
        req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
      const deviceName = req.headers.get("x-uas-device-name") || undefined;
      const guard = await checkLicenseAndClock(runtimeConfig.mode, seatToken, clientIp, deviceName);
      if (!guard.allowed) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: guard.error,
              code: guard.code || `LICENSE_${guard.status}`,
              status: guard.status,
            },
            { status: 402 } // Payment Required / License Tamper Lock
          ),
        };
      }
    } catch (e) {
      console.error("[Licensing Check in authorizeApiAction Error]:", e);
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: "تعذر التحقق من صلاحية الترخيص وساعة النظام / License verification failed",
            code: "LICENSE_VERIFICATION_FAILED",
          },
          { status: 403 }
        ),
      };
    }
  }

  const target = actor.user;

  if (check.action && isReadOnly(target)) {
    return {
      ok: false,
      response: forbiddenError("🔒 حساب المدقق المالي للقراءة فقط — لا يمكن إجراء تعديلات أو إضافات"),
    };
  }
  if (check.dateChanged && !canEditDate(target)) {
    return {
      ok: false,
      response: forbiddenError("⛔ صلاحية تعديل تواريخ المعاملات محصورة بمدير النظام، مدير المشاريع، ورئيس الحسابات"),
    };
  }
  if (check.action === "create" && !canCreate(target, check.moduleId)) {
    return {
      ok: false,
      response: forbiddenError("⛔ ليس لديك صلاحية الإضافة في هذا القسم"),
    };
  }
  if (check.action === "edit" && !canEdit(target, check.moduleId)) {
    return {
      ok: false,
      response: forbiddenError("⛔ ليس لديك صلاحية التعديل في هذا القسم"),
    };
  }
  if (check.action === "delete" && !canDeleteVoid(target)) {
    return {
      ok: false,
      response: forbiddenError("⛔ صلاحية الحذف أو العكس محصورة بالإدارة العليا ورئيس الحسابات"),
    };
  }
  if (check.action === "approve" && !canApprove(target)) {
    return {
      ok: false,
      response: forbiddenError("⛔ ليس لديك صلاحية الاعتماد المالي"),
    };
  }
  if (check.action === "post" && !canPostLedger(target)) {
    return {
      ok: false,
      response: forbiddenError("⛔ ترحيل وتعديل القيود المحاسبية محصور بمدير النظام ورئيس الحسابات"),
    };
  }
  if (check.action === "treasury" && !canManageTreasury(target)) {
    return {
      ok: false,
      response: forbiddenError("⛔ إدارة الخزائن والبنوك والمحافظ والتحويلات محصورة بالإدارة المالية"),
    };
  }
  if (check.action === "cms" && !canManageLandingCms(target)) {
    return {
      ok: false,
      response: forbiddenError("⛔ تعديل الهوية البصرية وبوابة CMS محصور بمدير النظام العام"),
    };
  }

  return { ok: true, actor };
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function unauthorizedError(
  message = "غير مصرح: يرجى تسجيل الدخول أولاً / Unauthorized: authentication required"
) {
  return NextResponse.json({ error: message, code: "UNAUTHORIZED" }, { status: 401 });
}

export function forbiddenError(message = "⛔ غير مصرح لك بهذا الإجراء") {
  return NextResponse.json({ error: message, code: "FORBIDDEN" }, { status: 403 });
}

export function lockedError() {
  return NextResponse.json(
    {
      error: "🔒 هذه القطفة مغلقة محاسبياً! لا يمكن التعديل أو الحذف إلا بعد فتح القطفة أو عبر قيد تسوية",
      code: "HARVEST_LOCKED",
    },
    { status: 423 }
  );
}


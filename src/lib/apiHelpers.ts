import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
import type { UasUser, UserRole } from "@/types/uas";

export interface ActorPayload {
  userId?: string | null;
  userDisplay?: string;
  userRole?: string;
}

export interface ResolvedActor {
  userId: string | null;
  userDisplay: string;
  userRole: UserRole;
  user?: UasUser | null;
}

export function extractActor(
  body: Record<string, unknown>,
  req?: NextRequest
): ResolvedActor {
  const actor = (body.actor as ActorPayload | undefined) || {};
  const headerUserId = req?.headers.get("x-uas-user-id") || undefined;
  const headerRole = req?.headers.get("x-uas-role") || undefined;
  const headerDisplay = req?.headers.get("x-uas-user-display") || undefined;

  const userId = actor.userId ?? headerUserId ?? "u1";
  const rawRole = actor.userRole || headerRole || "SUPER_ADMIN";
  const userRole = normalizeRole(rawRole);

  return {
    userId,
    userDisplay: actor.userDisplay || headerDisplay || `مدير النظام العام (${userRole})`,
    userRole,
  };
}

export async function resolveVerifiedActor(
  body: Record<string, unknown>,
  req?: NextRequest
): Promise<ResolvedActor> {
  const actor = extractActor(body, req);
  if (actor.userId) {
    const dbUser = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        username: true,
        name: true,
        fullName: true,
        displayName: true,
        role: true,
        active: true,
        isActive: true,
        department: true,
        avatarChar: true,
        avatarColor: true,
        useCustomPermissions: true,
        customAllowedGroups: true,
        customPermissionsJson: true,
        assignedProjects: true,
      },
    });
    if (dbUser) {
      const role = normalizeRole(dbUser.role);
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
        email: "",
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
        userDisplay: actor.userDisplay || `${dbUser.displayName || dbUser.name} (${role})`,
        userRole: role,
        user: uasUser,
      };
    }
  }
  return actor;
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
  const target = actor.user || actor.userRole;

  if (actor.user && (actor.user.active === false || actor.user.isActive === false)) {
    return {
      ok: false,
      response: forbiddenError("🔒 الحساب موقوف — لا يمكن تنفيذ الإجراء المطلوب"),
    };
  }

  if (isReadOnly(target)) {
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


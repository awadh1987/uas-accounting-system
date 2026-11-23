import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import {
  forbiddenError,
  jsonError,
  resolveVerifiedActor,
  unauthorizedError,
} from "@/lib/apiHelpers";
import { appendAuditLogTx, getBootstrapState, parseAssignedProjects } from "@/lib/serverBootstrap";
import { normalizeRole } from "@/lib/permissions";
import { getActiveTenantId } from "@/lib/tenant/tenantContext";
import {
  decodeAvatarDataUrl,
  deleteUserAvatarFiles,
  saveUserAvatarFile,
  validateAvatarUpload,
} from "@/lib/avatarAssets";
import type { UasUser } from "@/types/uas";

export const dynamic = "force-dynamic";

function mapDbUserToUas(user: {
  id: string;
  username: string;
  name: string;
  fullName: string;
  displayName: string | null;
  phone: string | null;
  email: string;
  role: string;
  department: string;
  active: boolean;
  isActive: boolean;
  avatarChar: string;
  avatarUrl: string | null;
  avatarColor: string;
  preferredLang: string;
  preferredCurrency: string;
  preferredTheme: string;
  defaultModule: string | null;
  lastLoginAt: Date | null;
  useCustomPermissions: boolean;
  customAllowedGroups: string;
  customPermissionsJson: string;
  mustChangePassword: boolean;
  passwordUpdatedAt: Date | null;
  assignedProjects: string;
}): UasUser {
  let customAllowedGroups: string[] = [];
  try {
    if (user.customAllowedGroups) {
      const parsed = JSON.parse(user.customAllowedGroups);
      if (Array.isArray(parsed)) customAllowedGroups = parsed.map(String);
    }
  } catch {
    customAllowedGroups = [];
  }

  let customPermissionsJson: Record<string, boolean> = {};
  try {
    if (user.customPermissionsJson) {
      const parsed = JSON.parse(user.customPermissionsJson);
      if (parsed && typeof parsed === "object") customPermissionsJson = parsed;
    }
  } catch {
    customPermissionsJson = {};
  }

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    fullName: user.fullName,
    displayName: user.displayName ?? "",
    phone: user.phone ?? "",
    email: user.email,
    role: user.role,
    department: user.department,
    active: user.active && (user.isActive ?? true),
    isActive: user.isActive ?? user.active,
    avatarChar: user.avatarChar,
    avatarUrl: user.avatarUrl ?? "",
    avatarColor: user.avatarColor ?? "#059669",
    preferredLang: user.preferredLang ?? "ar",
    preferredCurrency: user.preferredCurrency ?? "YER",
    preferredTheme: user.preferredTheme ?? "emerald",
    defaultModule: user.defaultModule ?? "",
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    useCustomPermissions: Boolean(user.useCustomPermissions),
    customAllowedGroups,
    customPermissionsJson,
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordUpdatedAt: user.passwordUpdatedAt ? user.passwordUpdatedAt.toISOString() : null,
    assignedProjects: parseAssignedProjects(user.assignedProjects),
  };
}

export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    let actorBody: Record<string, unknown> = {};
    let fileBuffer: Buffer | null = null;
    let ext = "png";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const rawActor = form.get("actor");
      if (typeof rawActor === "string" && rawActor.trim()) {
        try {
          actorBody = { actor: JSON.parse(rawActor) };
        } catch {
          actorBody = {};
        }
      }
      const actor = await resolveVerifiedActor(actorBody, req);
      if (actor.spoofAttempt) {
        return forbiddenError("⛔ رفض أمني: عدم تطابق الصلاحية المرسلة");
      }
      if (actor.inactive) {
        return forbiddenError("الحساب موقوف. يرجى التواصل مع الإدارة");
      }
      if (!actor.authenticated || !actor.userId) {
        return unauthorizedError("غير مصرح: يرجى تسجيل الدخول أولاً");
      }

      const fileField = form.get("file");
      if (!fileField || typeof fileField === "string") {
        return jsonError("يرجى اختيار ملف صورة صالح / Please select an image file.", 400);
      }
      const arrBuf = await fileField.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      const check = validateAvatarUpload({
        buffer: buf,
        mimeType: fileField.type,
        filename: fileField.name,
      });
      if (!check.ok) {
        return jsonError(check.error, 400);
      }
      fileBuffer = buf;
      ext = check.ext;

      const tenantKey = getActiveTenantId() || "default";
      const saved = saveUserAvatarFile({
        tenantKey,
        userId: actor.userId,
        buffer: fileBuffer,
        ext,
      });

      const updated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: actor.userId! },
          data: { avatarUrl: saved.publicUrl },
        });
        await appendAuditLogTx(tx, {
          userId: actor.userId!,
          userDisplay: `${user.displayName || user.name} (${normalizeRole(user.role)})`,
          userRole: user.role,
          actionType: "تحديث الصورة الشخصية",
          entityReference: `User:${actor.userId}`,
          details: `تم رفع صورة شخصية جديدة (${saved.filename})`,
        });
        return user;
      });

      const state = await getBootstrapState();
      return NextResponse.json({
        success: true,
        avatarUrl: saved.publicUrl,
        user: mapDbUserToUas(updated),
        state,
      });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = await resolveVerifiedActor(body, req);
    if (actor.spoofAttempt) {
      return forbiddenError("⛔ رفض أمني: عدم تطابق الصلاحية المرسلة");
    }
    if (actor.inactive) {
      return forbiddenError("الحساب موقوف. يرجى التواصل مع الإدارة");
    }
    if (!actor.authenticated || !actor.userId) {
      return unauthorizedError("غير مصرح: يرجى تسجيل الدخول أولاً");
    }

    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
    const decoded = dataUrl ? decodeAvatarDataUrl(dataUrl) : null;
    if (!decoded) {
      return jsonError(
        "صيغة أو حجم الصورة غير مدعوم (PNG/JPG/WEBP/GIF بحد أقصى 2MB) / Invalid or oversized image payload.",
        400
      );
    }

    const tenantKey = getActiveTenantId() || "default";
    const saved = saveUserAvatarFile({
      tenantKey,
      userId: actor.userId,
      buffer: decoded.buffer,
      ext: decoded.ext,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: actor.userId! },
        data: { avatarUrl: saved.publicUrl },
      });
      await appendAuditLogTx(tx, {
        userId: actor.userId!,
        userDisplay: `${user.displayName || user.name} (${normalizeRole(user.role)})`,
        userRole: user.role,
        actionType: "تحديث الصورة الشخصية",
        entityReference: `User:${actor.userId}`,
        details: `تم رفع صورة شخصية جديدة (${saved.filename})`,
      });
      return user;
    });

    const state = await getBootstrapState();
    return NextResponse.json({
      success: true,
      avatarUrl: saved.publicUrl,
      user: mapDbUserToUas(updated),
      state,
    });
  } catch (error) {
    console.error("POST /api/users/me/avatar error:", error);
    return jsonError("تعذر رفع الصورة الشخصية", 500);
  }
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    const actor = await resolveVerifiedActor({}, req);
    if (actor.spoofAttempt) {
      return forbiddenError("⛔ رفض أمني: عدم تطابق الصلاحية المرسلة");
    }
    if (actor.inactive) {
      return forbiddenError("الحساب موقوف. يرجى التواصل مع الإدارة");
    }
    if (!actor.authenticated || !actor.userId) {
      return unauthorizedError("غير مصرح: يرجى تسجيل الدخول أولاً");
    }

    const tenantKey = getActiveTenantId() || "default";
    deleteUserAvatarFiles(tenantKey, actor.userId);

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: actor.userId! },
        data: { avatarUrl: "" },
      });
      await appendAuditLogTx(tx, {
        userId: actor.userId!,
        userDisplay: `${user.displayName || user.name} (${normalizeRole(user.role)})`,
        userRole: user.role,
        actionType: "إزالة الصورة الشخصية",
        entityReference: `User:${actor.userId}`,
        details: "تمت إزالة الصورة الشخصية والعودة للأحرف الافتراضية",
      });
      return user;
    });

    const state = await getBootstrapState();
    return NextResponse.json({
      success: true,
      avatarUrl: "",
      user: mapDbUserToUas(updated),
      state,
    });
  } catch (error) {
    console.error("DELETE /api/users/me/avatar error:", error);
    return jsonError("تعذر إزالة الصورة الشخصية", 500);
  }
});

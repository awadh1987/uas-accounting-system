import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenantRoute } from "@/lib/prisma";
import { corsOptionsResponse, jsonError } from "@/lib/apiHelpers";
import { ensurePortalSchemaReady } from "@/lib/clientPortal/ensurePortalSchema";
import { resolveAuthenticatedClient } from "@/lib/clientPortal/clientAuth";
import { sanitizeClientAccount } from "@/lib/clientPortal/portalService";
import {
  decodeAvatarDataUrl,
  deleteUserAvatarFiles,
  saveUserAvatarFile,
  validateAvatarUpload,
} from "@/lib/avatarAssets";
import { appendAuditLogTx } from "@/lib/serverBootstrap";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req);
}

/**
 * POST /api/client-portal/me/avatar
 * Uploads or updates the authenticated client's profile photo scoped strictly to active tenantId.
 */
export const POST = withTenantRoute(async function POST(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    let fileBuffer: Buffer | null = null;
    let ext = "png";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const fileField = form.get("file");
      if (!fileField || typeof fileField === "string") {
        return jsonError("يرجى اختيار ملف صورة صالح", 400);
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
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
      const decoded = dataUrl ? decodeAvatarDataUrl(dataUrl) : null;
      if (!decoded) {
        return jsonError(
          "صيغة أو حجم الصورة غير مدعوم (PNG/JPG/WEBP/GIF بحد أقصى 2MB)",
          400
        );
      }
      fileBuffer = decoded.buffer;
      ext = decoded.ext;
    }

    const saved = saveUserAvatarFile({
      tenantKey: auth.scope.tenantId || "default",
      userId: `client-${auth.account.id}`,
      buffer: fileBuffer,
      ext,
    });

    const { updated, creditLimit } = await prisma.$transaction(async (tx) => {
      const acc = await tx.clientPortalAccount.update({
        where: { id: auth.account.id },
        data: { avatarUrl: saved.publicUrl },
      });
      let limit = 0;
      if (acc.customerId) {
        const cust = await tx.customer.findUnique({
          where: { id: acc.customerId },
          select: { creditLimit: true },
        });
        limit = Number(cust?.creditLimit || 0);
      }
      await appendAuditLogTx(tx, {
        userId: null,
        userDisplay: acc.fullName,
        userRole: "CLIENT_PORTAL",
        actionType: "CLIENT_AVATAR_UPDATED",
        entityReference: acc.id,
        details: `[tenant:${auth.scope.tenantSlug}] تحديث صورة الملف الشخصي للعميل (${saved.filename})`,
      });
      return { updated: acc, creditLimit: limit };
    });

    return NextResponse.json({
      success: true,
      avatarUrl: saved.publicUrl,
      account: sanitizeClientAccount(updated, creditLimit),
      message: "✅ تم تحديث صورة الملف الشخصي بنجاح",
    });
  } catch (err) {
    console.error("POST /api/client-portal/me/avatar error:", err);
    return jsonError("تعذر رفع صورة الملف الشخصي", 500);
  }
});

export const DELETE = withTenantRoute(async function DELETE(req: NextRequest) {
  try {
    await ensurePortalSchemaReady();
    const auth = await resolveAuthenticatedClient(req);
    if (!auth.ok) return jsonError(auth.error, auth.status);

    deleteUserAvatarFiles(auth.scope.tenantId || "default", `client-${auth.account.id}`);

    const { updated, creditLimit } = await prisma.$transaction(async (tx) => {
      const acc = await tx.clientPortalAccount.update({
        where: { id: auth.account.id },
        data: { avatarUrl: "" },
      });
      let limit = 0;
      if (acc.customerId) {
        const cust = await tx.customer.findUnique({
          where: { id: acc.customerId },
          select: { creditLimit: true },
        });
        limit = Number(cust?.creditLimit || 0);
      }
      await appendAuditLogTx(tx, {
        userId: null,
        userDisplay: acc.fullName,
        userRole: "CLIENT_PORTAL",
        actionType: "CLIENT_AVATAR_REMOVED",
        entityReference: acc.id,
        details: `[tenant:${auth.scope.tenantSlug}] إزالة صورة الملف الشخصي والعودة للأحرف الافتراضية`,
      });
      return { updated: acc, creditLimit: limit };
    });

    return NextResponse.json({
      success: true,
      avatarUrl: "",
      account: sanitizeClientAccount(updated, creditLimit),
      message: "✅ تمت إزالة الصورة الشخصية والعودة للأحرف الافتراضية",
    });
  } catch (err) {
    console.error("DELETE /api/client-portal/me/avatar error:", err);
    return jsonError("تعذر إزالة صورة الملف الشخصي", 500);
  }
});

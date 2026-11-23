import fs from "node:fs";
import path from "node:path";
import { sanitizeTenantAssetKey } from "@/lib/brandingAssets";
import { getDynamicDataDirectory } from "@/lib/tenant/tenantRegistry";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_AVATAR_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_AVATAR_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function resolveProjectRoot(): string {
  const baseDir = getDynamicDataDirectory();
  const normalized = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/.next/standalone")) {
    return path.resolve(/*turbopackIgnore: true*/ baseDir, "..", "..");
  }
  return baseDir;
}

export function sanitizeUserAssetKey(rawUserId: string): string {
  const clean = String(rawUserId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  return clean || "user";
}

export function resolvePublicAvatarsDir(tenantKey: string): string {
  const safeTenant = sanitizeTenantAssetKey(tenantKey);
  return path.join(/*turbopackIgnore: true*/ resolveProjectRoot(), "public", "uploads", "avatars", safeTenant);
}

function resolveStandalonePublicAvatarsDir(tenantKey: string): string | null {
  const safeTenant = sanitizeTenantAssetKey(tenantKey);
  const root = resolveProjectRoot();
  const standaloneRoot = path.join(/*turbopackIgnore: true*/ root, ".next", "standalone");
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ standaloneRoot)) {
      const target = path.join(/*turbopackIgnore: true*/ standaloneRoot, "public", "uploads", "avatars", safeTenant);
      if (path.resolve(target) !== path.resolve(resolvePublicAvatarsDir(safeTenant))) {
        return target;
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

/**
 * Validates raw image magic bytes so disguised HTML/SVG/executables cannot be uploaded as avatars.
 */
export function detectImageTypeFromBuffer(
  buffer: Buffer
): { ext: string; contentType: string } | null {
  if (buffer.length < 12 || buffer.length > MAX_AVATAR_BYTES) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: "png", contentType: "image/png" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }

  // GIF87a / GIF89a
  const gifHdr = buffer.subarray(0, 6).toString("ascii");
  if (gifHdr === "GIF87a" || gifHdr === "GIF89a") {
    return { ext: "gif", contentType: "image/gif" };
  }

  // WEBP: RIFF....WEBP
  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  if (riff === "RIFF" && webp === "WEBP") {
    return { ext: "webp", contentType: "image/webp" };
  }

  return null;
}

export function validateAvatarUpload(params: {
  buffer: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}): { ok: true; ext: string; contentType: string } | { ok: false; error: string } {
  if (params.buffer.length === 0) {
    return { ok: false, error: "ملف الصورة فارغ / Image file is empty." };
  }
  if (params.buffer.length > MAX_AVATAR_BYTES) {
    return {
      ok: false,
      error: "حجم الصورة الشخصية يجب أن لا يتجاوز 2 ميجابايت / Profile image must be <= 2 MB.",
    };
  }

  const cleanMime = String(params.mimeType || "").trim().toLowerCase().split(";")[0];
  if (cleanMime && !ALLOWED_AVATAR_MIME[cleanMime]) {
    return {
      ok: false,
      error: "صيغة الصورة غير مدعومة (المسموح: PNG, JPG, WEBP, GIF) / Unsupported image format (PNG, JPG, WEBP, GIF only).",
    };
  }

  const detected = detectImageTypeFromBuffer(params.buffer);
  if (!detected) {
    return {
      ok: false,
      error: "محتوى الملف ليس صورة صالحة (PNG/JPG/WEBP/GIF) / Invalid or corrupted image content.",
    };
  }

  return { ok: true, ext: detected.ext, contentType: detected.contentType };
}

export function decodeAvatarDataUrl(
  dataUrl: string
): { buffer: Buffer; ext: string; contentType: string } | null {
  const match = dataUrl.trim().match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  const check = validateAvatarUpload({ buffer, mimeType: match[1] });
  if (!check.ok) return null;
  return { buffer, ext: check.ext, contentType: check.contentType };
}

function removePriorUserAvatarFilesInDir(dir: string, safeUserId: string): void {
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return;
    const prefix = `${safeUserId}-`;
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ dir)) {
      if (entry.startsWith(prefix)) {
        try {
          fs.unlinkSync(/*turbopackIgnore: true*/ path.join(dir, entry));
        } catch {
          // Non-fatal
        }
      }
    }
  } catch {
    // Non-fatal
  }
}

export function saveUserAvatarFile(params: {
  tenantKey: string;
  userId: string;
  buffer: Buffer;
  ext: string;
}): { filename: string; publicUrl: string; primaryPath: string } {
  const safeTenant = sanitizeTenantAssetKey(params.tenantKey);
  const safeUserId = sanitizeUserAssetKey(params.userId);
  const filename = `${safeUserId}-${Date.now()}.${params.ext}`;

  const primaryDir = resolvePublicAvatarsDir(safeTenant);
  fs.mkdirSync(/*turbopackIgnore: true*/ primaryDir, { recursive: true });
  removePriorUserAvatarFilesInDir(primaryDir, safeUserId);
  const primaryPath = path.join(/*turbopackIgnore: true*/ primaryDir, filename);
  fs.writeFileSync(/*turbopackIgnore: true*/ primaryPath, params.buffer);

  const standaloneDir = resolveStandalonePublicAvatarsDir(safeTenant);
  if (standaloneDir) {
    try {
      fs.mkdirSync(/*turbopackIgnore: true*/ standaloneDir, { recursive: true });
      removePriorUserAvatarFilesInDir(standaloneDir, safeUserId);
      fs.writeFileSync(/*turbopackIgnore: true*/ path.join(standaloneDir, filename), params.buffer);
    } catch {
      // Non-fatal mirror
    }
  }

  return {
    filename,
    publicUrl: `/api/public/avatar/${encodeURIComponent(safeTenant)}/${encodeURIComponent(filename)}`,
    primaryPath,
  };
}

export function deleteUserAvatarFiles(tenantKey: string, userId: string): void {
  const safeTenant = sanitizeTenantAssetKey(tenantKey);
  const safeUserId = sanitizeUserAssetKey(userId);
  removePriorUserAvatarFilesInDir(resolvePublicAvatarsDir(safeTenant), safeUserId);
  const standaloneDir = resolveStandalonePublicAvatarsDir(safeTenant);
  if (standaloneDir) {
    removePriorUserAvatarFilesInDir(standaloneDir, safeUserId);
  }
}

export function readUserAvatarFile(
  rawTenantKey: string,
  rawFilename: string
): { buffer: Buffer; contentType: string } | null {
  if (
    !rawTenantKey ||
    !rawFilename ||
    !/^[a-zA-Z0-9_-]+$/.test(rawTenantKey) ||
    !/^[a-zA-Z0-9._-]+$/.test(rawFilename) ||
    rawFilename.includes("..")
  ) {
    return null;
  }

  const safeTenant = sanitizeTenantAssetKey(rawTenantKey);
  const ext = path.extname(rawFilename).replace(/^\./, "").toLowerCase();
  const contentType = EXT_TO_AVATAR_MIME[ext];
  if (!contentType) return null;

  const candidates = [
    path.join(/*turbopackIgnore: true*/ resolvePublicAvatarsDir(safeTenant), rawFilename),
    ...(resolveStandalonePublicAvatarsDir(safeTenant)
      ? [path.join(/*turbopackIgnore: true*/ resolveStandalonePublicAvatarsDir(safeTenant)!, rawFilename)]
      : []),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        const buffer = fs.readFileSync(/*turbopackIgnore: true*/ candidate);
        if (buffer.length > 0) {
          return { buffer, contentType };
        }
      }
    } catch {
      // Try next candidate
    }
  }
  return null;
}

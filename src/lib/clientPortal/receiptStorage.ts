import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeTenantAssetKey } from "@/lib/brandingAssets";
import { getDynamicDataDirectory } from "@/lib/tenant/tenantRegistry";

export const MAX_RECEIPT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_RECEIPT_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const EXT_TO_RECEIPT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

function resolveDataRootDir(): string {
  const baseDir = getDynamicDataDirectory();
  const normalized = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/.next/standalone")) {
    return path.resolve(/*turbopackIgnore: true*/ baseDir, "..", "..");
  }
  return baseDir;
}

export function resolveTenantReceiptsDir(tenantSlug: string): string {
  const safeTenant = sanitizeTenantAssetKey(tenantSlug);
  return path.join(/*turbopackIgnore: true*/ resolveDataRootDir(), "data", "uploads", safeTenant, "receipts");
}

/**
 * Validates raw file magic bytes so spoofed HTML/SVG/scripts cannot be uploaded as payment receipts.
 * Supports JPG, PNG, WEBP, and PDF up to 10 MB.
 */
export function detectReceiptFileType(
  buffer: Buffer
): { ext: "jpg" | "png" | "webp" | "pdf"; contentType: string } | null {
  if (buffer.length < 5 || buffer.length > MAX_RECEIPT_FILE_BYTES) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
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

  // WEBP: RIFF....WEBP
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return { ext: "webp", contentType: "image/webp" };
    }
  }

  // PDF: %PDF-
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { ext: "pdf", contentType: "application/pdf" };
  }

  return null;
}

export function validateReceiptUpload(params: {
  buffer: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}): { ok: true; ext: "jpg" | "png" | "webp" | "pdf"; contentType: string } | { ok: false; error: string } {
  if (!params.buffer || params.buffer.length === 0) {
    return { ok: false, error: "ملف الإيصال فارغ / Receipt file is empty." };
  }
  if (params.buffer.length > MAX_RECEIPT_FILE_BYTES) {
    return {
      ok: false,
      error: "حجم ملف الإيصال يجب أن لا يتجاوز 10 ميجابايت / Receipt file must be <= 10 MB.",
    };
  }

  const cleanMime = String(params.mimeType || "").trim().toLowerCase().split(";")[0];
  if (cleanMime && !ALLOWED_RECEIPT_MIME[cleanMime]) {
    return {
      ok: false,
      error: "صيغة الإيصال غير مدعومة (المسموح: JPG, PNG, WEBP, PDF) / Unsupported receipt format.",
    };
  }

  const detected = detectReceiptFileType(params.buffer);
  if (!detected) {
    return {
      ok: false,
      error: "محتوى الملف غير صالح — يرجى رفع صورة (JPG/PNG/WEBP) أو ملف PDF حقيقي.",
    };
  }

  return { ok: true, ext: detected.ext, contentType: detected.contentType };
}

export function decodeReceiptDataUrl(
  dataUrl: string
): { buffer: Buffer; ext: "jpg" | "png" | "webp" | "pdf"; contentType: string } | null {
  const match = dataUrl
    .trim()
    .match(/^data:(image\/(?:png|jpeg|jpg|webp)|application\/pdf);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  const check = validateReceiptUpload({ buffer, mimeType: match[1] });
  if (!check.ok) return null;
  return { buffer, ext: check.ext, contentType: check.contentType };
}

export function saveClientPaymentReceiptFile(params: {
  tenantSlug: string;
  submissionNumber: string;
  buffer: Buffer;
  ext: "jpg" | "png" | "webp" | "pdf";
}): {
  fileName: string;
  relativePath: string;
  absolutePath: string;
  fileSize: number;
} {
  const safeTenant = sanitizeTenantAssetKey(params.tenantSlug);
  const safeSub = String(params.submissionNumber || "rcp")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  const rand = crypto.randomBytes(4).toString("hex");
  const fileName = `${safeSub}-${rand}.${params.ext}`;
  const dir = resolveTenantReceiptsDir(safeTenant);
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const absolutePath = path.join(/*turbopackIgnore: true*/ dir, fileName);
  fs.writeFileSync(/*turbopackIgnore: true*/ absolutePath, params.buffer);

  return {
    fileName,
    relativePath: `${safeTenant}/receipts/${fileName}`,
    absolutePath,
    fileSize: params.buffer.length,
  };
}

export function readClientPaymentReceiptFile(
  tenantSlug: string,
  relativePath: string | null | undefined
): { buffer: Buffer; contentType: string; fileName: string } | null {
  if (!relativePath) return null;
  const safeTenant = sanitizeTenantAssetKey(tenantSlug);
  const cleanRel = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleanRel || cleanRel.includes("..")) return null;
  const expectedPrefix = `${safeTenant}/receipts/`;
  if (!cleanRel.startsWith(expectedPrefix)) return null;

  const fileName = path.basename(cleanRel);
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) return null;

  const ext = path.extname(fileName).replace(/^\./, "").toLowerCase();
  const contentType = EXT_TO_RECEIPT_MIME[ext];
  if (!contentType) return null;

  const fullPath = path.join(/*turbopackIgnore: true*/ resolveTenantReceiptsDir(safeTenant), fileName);
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ fullPath)) return null;
    const buffer = fs.readFileSync(/*turbopackIgnore: true*/ fullPath);
    if (buffer.length === 0) return null;
    return { buffer, contentType, fileName };
  } catch {
    return null;
  }
}

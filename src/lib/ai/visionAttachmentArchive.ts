/**
 * UAS Enterprise — Tenant-Scoped Vision Attachment Archive & Record Linking Store
 *
 * Persists uploaded receipts, invoices, sales slips, and handwritten harvest tally
 * sheet images cleanly under `$UAS_DATA_DIR/uploads/<tenantSlug>/` (or
 * `<projectRoot>/data/uploads/<tenantSlug>/` mirrored into `.next/standalone/data/uploads/<tenantSlug>/`),
 * with strict magic-byte validation, SHA-256 checksums, tenant-isolated index.json,
 * and post-confirmation linking to vouchers, sales, expenses, and harvest batches.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeTenantAssetKey } from "@/lib/brandingAssets";
import { getDynamicDataDirectory } from "@/lib/tenant/tenantRegistry";
import { normalizeMemoryTenantSlug } from "./copilotMemoryTypes";
import {
  filterVisionArchiveAttachments,
  MAX_VISION_IMAGE_BYTES,
  validateVisionImagePayload,
  type SupportedVisionMimeType,
  type VisionArchiveFilter,
  type VisionDocumentType,
  type VisionLinkedRecord,
  type VisionSourceAttachment,
} from "./copilotVisionTypes";

const MIME_TO_EXT: Record<SupportedVisionMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXT_TO_MIME: Record<string, SupportedVisionMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function resolveArchiveRootDir(): string {
  const explicitDataDir = (process.env.UAS_DATA_DIR || "").trim();
  if (explicitDataDir) {
    return path.join(/*turbopackIgnore: true*/ explicitDataDir, "uploads");
  }
  const baseDir = getDynamicDataDirectory();
  const normalized = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = normalized.endsWith("/.next/standalone")
    ? path.resolve(/*turbopackIgnore: true*/ baseDir, "..", "..")
    : baseDir;
  return path.join(/*turbopackIgnore: true*/ root, "data", "uploads");
}

function resolveTenantUploadsDir(tenantSlug: string): string {
  const safeTenant = sanitizeTenantAssetKey(normalizeMemoryTenantSlug(tenantSlug));
  return path.join(/*turbopackIgnore: true*/ resolveArchiveRootDir(), safeTenant);
}

function resolveStandaloneTenantUploadsDir(tenantSlug: string): string | null {
  if ((process.env.UAS_DATA_DIR || "").trim()) return null;
  const safeTenant = sanitizeTenantAssetKey(normalizeMemoryTenantSlug(tenantSlug));
  const baseDir = getDynamicDataDirectory();
  const normalized = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = normalized.endsWith("/.next/standalone")
    ? path.resolve(/*turbopackIgnore: true*/ baseDir, "..", "..")
    : baseDir;
  const standaloneRoot = path.join(/*turbopackIgnore: true*/ root, ".next", "standalone");
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ standaloneRoot)) {
      const target = path.join(/*turbopackIgnore: true*/ standaloneRoot, "data", "uploads", safeTenant);
      if (path.resolve(target) !== path.resolve(resolveTenantUploadsDir(safeTenant))) {
        return target;
      }
    }
  } catch {
    // non-fatal
  }
  return null;
}

function detectImageMagic(buf: Buffer): SupportedVisionMimeType | null {
  if (buf.length < 12 || buf.length > MAX_VISION_IMAGE_BYTES) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WEBP
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function resolveArchiveJsonDir(): string {
  const explicitDataDir = (process.env.UAS_DATA_DIR || "").trim();
  if (explicitDataDir) {
    return path.join(/*turbopackIgnore: true*/ explicitDataDir, "vision-archive");
  }
  const baseDir = getDynamicDataDirectory();
  const normalized = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = normalized.endsWith("/.next/standalone")
    ? path.resolve(/*turbopackIgnore: true*/ baseDir, "..", "..")
    : baseDir;
  return path.join(/*turbopackIgnore: true*/ root, "data", "vision-archive");
}

function resolveTenantArchiveJsonPath(tenantSlug: string): string {
  const safeSlug = sanitizeTenantAssetKey(normalizeMemoryTenantSlug(tenantSlug));
  return path.join(/*turbopackIgnore: true*/ resolveArchiveJsonDir(), `${safeSlug}.json`);
}

function readTenantIndex(tenantSlug: string): VisionSourceAttachment[] {
  const safeSlug = normalizeMemoryTenantSlug(tenantSlug);
  const candidates = [
    resolveTenantArchiveJsonPath(safeSlug),
    path.join(/*turbopackIgnore: true*/ resolveTenantUploadsDir(safeSlug), "index.json"),
  ];
  for (const indexPath of candidates) {
    try {
      if (!fs.existsSync(/*turbopackIgnore: true*/ indexPath)) continue;
      const raw = fs.readFileSync(/*turbopackIgnore: true*/ indexPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      return parsed.filter(
        (item): item is VisionSourceAttachment =>
          Boolean(
            item &&
              typeof item.attachmentId === "string" &&
              normalizeMemoryTenantSlug(item.tenantSlug) === safeSlug
          )
      );
    } catch {
      // try next candidate
    }
  }
  return [];
}

function writeTenantIndex(tenantSlug: string, entries: VisionSourceAttachment[]): void {
  const safeSlug = normalizeMemoryTenantSlug(tenantSlug);
  const isolated = entries.filter(
    (e) => normalizeMemoryTenantSlug(e.tenantSlug) === safeSlug
  );
  const dir = resolveTenantUploadsDir(safeSlug);
  const archiveJsonPath = resolveTenantArchiveJsonPath(safeSlug);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }
  if (!fs.existsSync(/*turbopackIgnore: true*/ path.dirname(archiveJsonPath))) {
    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(archiveJsonPath), {
      recursive: true,
    });
  }
  const serialized = JSON.stringify(isolated, null, 2);
  fs.writeFileSync(/*turbopackIgnore: true*/ path.join(dir, "index.json"), serialized, "utf8");
  fs.writeFileSync(/*turbopackIgnore: true*/ archiveJsonPath, serialized, "utf8");

  const mirrorDir = resolveStandaloneTenantUploadsDir(safeSlug);
  if (mirrorDir) {
    try {
      fs.mkdirSync(/*turbopackIgnore: true*/ mirrorDir, { recursive: true });
      fs.writeFileSync(
        /*turbopackIgnore: true*/ path.join(mirrorDir, "index.json"),
        serialized,
        "utf8"
      );
      const standaloneArchiveJson = path.resolve(
        /*turbopackIgnore: true*/ mirrorDir,
        "..",
        "..",
        "vision-archive",
        `${sanitizeTenantAssetKey(safeSlug)}.json`
      );
      fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(standaloneArchiveJson), {
        recursive: true,
      });
      fs.writeFileSync(/*turbopackIgnore: true*/ standaloneArchiveJson, serialized, "utf8");
    } catch {
      // non-fatal mirror
    }
  }
}

export function archiveVisionAttachment(input: {
  tenantSlug: string;
  imageBase64: string;
  mimeType: string;
  fileName?: string;
  documentType?: VisionDocumentType;
  documentDate?: string;
  partyName?: string;
  projectName?: string;
  totalAmount?: number;
  totalBundles?: number;
  currency?: string;
  notes?: string;
}): VisionSourceAttachment {
  const safeSlug = normalizeMemoryTenantSlug(input.tenantSlug);
  const validated = validateVisionImagePayload({
    imageBase64: input.imageBase64,
    mimeType: input.mimeType,
  });
  if (!validated.ok) {
    throw new Error(validated.errorEn);
  }

  const buffer = Buffer.from(validated.cleanBase64, "base64");
  const detectedMime = detectImageMagic(buffer) || validated.mimeType;
  const ext = MIME_TO_EXT[detectedMime] || "jpg";
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const attachmentId = `att-${Date.now().toString(36)}-${checksum.slice(0, 10)}`;
  const storedFileName = `${attachmentId}.${ext}`;

  const dir = resolveTenantUploadsDir(safeSlug);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }
  fs.writeFileSync(/*turbopackIgnore: true*/ path.join(dir, storedFileName), buffer);

  const mirrorDir = resolveStandaloneTenantUploadsDir(safeSlug);
  if (mirrorDir) {
    try {
      fs.mkdirSync(/*turbopackIgnore: true*/ mirrorDir, { recursive: true });
      fs.writeFileSync(
        /*turbopackIgnore: true*/ path.join(mirrorDir, storedFileName),
        buffer
      );
    } catch {
      // non-fatal mirror
    }
  }

  const safeTenantPath = sanitizeTenantAssetKey(safeSlug);
  const attachment: VisionSourceAttachment = {
    attachmentId,
    attachmentUrl: `/api/public/vision-attachment/${safeTenantPath}/${storedFileName}`,
    tenantSlug: safeSlug,
    mimeType: detectedMime,
    fileName: (input.fileName || storedFileName).replace(/[^\w.\-\u0600-\u06FF ]+/g, "_").slice(0, 80),
    documentType: input.documentType,
    documentDate: input.documentDate ? input.documentDate.slice(0, 10) : undefined,
    partyName: input.partyName,
    projectName: input.projectName,
    totalAmount: input.totalAmount,
    totalBundles: input.totalBundles,
    currency: input.currency,
    notes: input.notes,
    checksum,
    byteLength: buffer.length,
    extractedAt: new Date().toISOString(),
  };

  const current = readTenantIndex(safeSlug);
  current.unshift(attachment);
  writeTenantIndex(safeSlug, current.slice(0, 500));
  return attachment;
}

export function readVisionAttachmentFile(
  tenantKey: string,
  rawFileName: string
): { buffer: Buffer; contentType: SupportedVisionMimeType } | null {
  const safeTenant = sanitizeTenantAssetKey(normalizeMemoryTenantSlug(tenantKey));
  const safeFile = path.basename(String(rawFileName || "")).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeFile || safeFile === "index.json") return null;
  const ext = safeFile.split(".").pop()?.toLowerCase() || "";
  const contentType = EXT_TO_MIME[ext];
  if (!contentType) return null;

  const candidates = [
    path.join(/*turbopackIgnore: true*/ resolveTenantUploadsDir(safeTenant), safeFile),
  ];
  const mirrorDir = resolveStandaloneTenantUploadsDir(safeTenant);
  if (mirrorDir) {
    candidates.push(path.join(/*turbopackIgnore: true*/ mirrorDir, safeFile));
  }

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
        const buffer = fs.readFileSync(/*turbopackIgnore: true*/ filePath);
        return { buffer, contentType };
      }
    } catch {
      // try next
    }
  }
  return null;
}

function mapRecordKind(recordType: string): VisionLinkedRecord["kind"] {
  const t = recordType.toUpperCase();
  if (t.includes("HARVEST")) return "harvest_batch";
  if (t.includes("EXPENSE")) return "expense";
  if (t.includes("SALE")) return "sale";
  if (t.includes("JOURNAL")) return "journal";
  return "voucher";
}

export function linkArchivedAttachmentToRecord(params: {
  tenantSlug: string;
  attachmentId: string;
  recordType: string;
  recordId: string;
  entryNumber?: string;
  label?: string;
}): VisionSourceAttachment | null {
  const safeSlug = normalizeMemoryTenantSlug(params.tenantSlug);
  const list = readTenantIndex(safeSlug);
  const idx = list.findIndex((a) => a.attachmentId === params.attachmentId);
  if (idx < 0) return null;

  const updated: VisionSourceAttachment = {
    ...list[idx],
    linkedRecordType: params.recordType,
    linkedRecordId: params.recordId,
    linkedEntryNumber: params.entryNumber,
    linkedRecord: {
      kind: mapRecordKind(params.recordType),
      id: params.recordId,
      code: params.entryNumber || params.recordId,
      label: params.label,
    },
    linkedAt: new Date().toISOString(),
  };
  list[idx] = updated;
  writeTenantIndex(safeSlug, list);
  return updated;
}

export function listTenantVisionAttachments(params: {
  tenantSlug: string;
  recordId?: string;
}): VisionSourceAttachment[] {
  const list = readTenantIndex(params.tenantSlug);
  if (params.recordId) {
    return list.filter(
      (a) =>
        a.linkedRecordId === params.recordId ||
        a.linkedEntryNumber === params.recordId ||
        a.linkedRecord?.id === params.recordId ||
        a.linkedRecord?.code === params.recordId
    );
  }
  return list;
}

export function searchTenantVisionArchive(
  params: { tenantSlug: string } & VisionArchiveFilter
): VisionSourceAttachment[] {
  const list = readTenantIndex(params.tenantSlug);
  return filterVisionArchiveAttachments(list, params);
}

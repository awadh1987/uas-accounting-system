import fs from "node:fs";
import path from "node:path";
import { getDynamicDataDirectory } from "@/lib/tenant/tenantRegistry";

export type TenantBrandAssetKind = "logo" | "favicon";

const MAX_BRAND_ASSET_BYTES = 1024 * 1024; // 1 MB

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/gif": "gif",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  gif: "image/gif",
};

export function sanitizeTenantAssetKey(rawTenantKey?: string | null): string {
  const clean = String(rawTenantKey || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "default";
}

function resolveProjectRoot(): string {
  const baseDir = getDynamicDataDirectory();
  const normalized = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/.next/standalone")) {
    return path.resolve(/*turbopackIgnore: true*/ baseDir, "..", "..");
  }
  return baseDir;
}

export function resolveDataRootDirectory(): string {
  const envDir = (process.env.UAS_DATA_DIR || process.env.DATA_DIR || "").trim();
  if (envDir) {
    return path.resolve(/*turbopackIgnore: true*/ envDir);
  }
  return path.join(/*turbopackIgnore: true*/ resolveProjectRoot(), "data");
}

export function resolveTenantBrandingDir(tenantKey?: string | null): string {
  const safeKey = sanitizeTenantAssetKey(tenantKey);
  return path.join(/*turbopackIgnore: true*/ resolveDataRootDirectory(), "branding", safeKey);
}

function resolveStandaloneBrandingDir(tenantKey?: string | null): string | null {
  const safeKey = sanitizeTenantAssetKey(tenantKey);
  const projectRoot = resolveProjectRoot();
  const standaloneRoot = path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone");
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ standaloneRoot)) {
      const target = path.join(/*turbopackIgnore: true*/ standaloneRoot, "data", "branding", safeKey);
      if (path.resolve(target) !== path.resolve(resolveTenantBrandingDir(safeKey))) {
        return target;
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

export function resolvePublicFilePath(relativePublicPath: string): string | null {
  const cleanRel = relativePublicPath.replace(/^\/+/, "");
  const projectRoot = resolveProjectRoot();
  const candidates = [
    path.join(/*turbopackIgnore: true*/ projectRoot, "public", cleanRel),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "public", cleanRel),
    path.join(/*turbopackIgnore: true*/ projectRoot, ".next", "standalone", "public", cleanRel),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        return candidate;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

export function decodeDataUrlAsset(
  dataUrl: string
): { buffer: Buffer; contentType: string; ext: string } | null {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:(image\/[a-z0-9.+-]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/is);
  if (!match) return null;

  const contentType = match[1].toLowerCase();
  const ext = MIME_TO_EXT[contentType];
  if (!ext) return null;

  const isBase64 = Boolean(match[2]);
  const rawPayload = match[3] || "";

  let buffer: Buffer;
  if (isBase64) {
    buffer = Buffer.from(rawPayload, "base64");
  } else {
    try {
      buffer = Buffer.from(decodeURIComponent(rawPayload), "utf8");
    } catch {
      buffer = Buffer.from(rawPayload, "utf8");
    }
  }

  if (buffer.length === 0 || buffer.length > MAX_BRAND_ASSET_BYTES) {
    return null;
  }

  return { buffer, contentType, ext };
}

export function normalizeAssetMimeType(
  mimeType?: string | null,
  filename?: string | null
): { contentType: string; ext: string } | null {
  const cleanMime = String(mimeType || "").trim().toLowerCase().split(";")[0];
  if (cleanMime && MIME_TO_EXT[cleanMime]) {
    return { contentType: cleanMime, ext: MIME_TO_EXT[cleanMime] };
  }
  const extFromName = path.extname(String(filename || "")).replace(/^\./, "").toLowerCase();
  if (extFromName && EXT_TO_MIME[extFromName]) {
    return { contentType: EXT_TO_MIME[extFromName], ext: extFromName === "jpeg" ? "jpg" : extFromName };
  }
  return null;
}

function removeKindFilesInDir(dir: string, kind: TenantBrandAssetKind): void {
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return;
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ dir);
    for (const entry of entries) {
      if (entry.startsWith(`${kind}.`)) {
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

export function saveTenantBrandAssetFile(params: {
  tenantKey: string;
  kind: TenantBrandAssetKind;
  buffer: Buffer;
  contentType: string;
  ext: string;
}): { filePath: string; publicUrl: string; version: number } {
  const safeKey = sanitizeTenantAssetKey(params.tenantKey);
  if (params.buffer.length === 0 || params.buffer.length > MAX_BRAND_ASSET_BYTES) {
    throw new Error("Brand asset file must be between 1 byte and 1 MB.");
  }

  const primaryDir = resolveTenantBrandingDir(safeKey);
  fs.mkdirSync(/*turbopackIgnore: true*/ primaryDir, { recursive: true });
  removeKindFilesInDir(primaryDir, params.kind);

  const fileName = `${params.kind}.${params.ext}`;
  const filePath = path.join(/*turbopackIgnore: true*/ primaryDir, fileName);
  fs.writeFileSync(/*turbopackIgnore: true*/ filePath, params.buffer);

  const standaloneDir = resolveStandaloneBrandingDir(safeKey);
  if (standaloneDir) {
    try {
      fs.mkdirSync(/*turbopackIgnore: true*/ standaloneDir, { recursive: true });
      removeKindFilesInDir(standaloneDir, params.kind);
      fs.writeFileSync(/*turbopackIgnore: true*/ path.join(standaloneDir, fileName), params.buffer);
    } catch {
      // Non-fatal standalone mirror
    }
  }

  const version = Date.now();
  const slugPart = safeKey !== "default" ? `slug=${encodeURIComponent(safeKey)}&` : "";
  const publicUrl = `/api/public/tenant/${params.kind}?${slugPart}v=${version}`;
  return { filePath, publicUrl, version };
}

export function deleteTenantBrandAssetFile(
  tenantKey: string,
  kind: TenantBrandAssetKind | "all"
): void {
  const safeKey = sanitizeTenantAssetKey(tenantKey);
  const dirs = [resolveTenantBrandingDir(safeKey), resolveStandaloneBrandingDir(safeKey)].filter(
    (d): d is string => Boolean(d)
  );
  const kinds: TenantBrandAssetKind[] = kind === "all" ? ["logo", "favicon"] : [kind];
  for (const dir of dirs) {
    for (const k of kinds) {
      removeKindFilesInDir(dir, k);
    }
  }
}

export function readTenantBrandAssetFile(
  tenantKey: string,
  kind: TenantBrandAssetKind
): { buffer: Buffer; contentType: string; ext: string } | null {
  const safeKey = sanitizeTenantAssetKey(tenantKey);
  const dirs = [resolveTenantBrandingDir(safeKey), resolveStandaloneBrandingDir(safeKey)].filter(
    (d): d is string => Boolean(d)
  );
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) continue;
      const entries = fs.readdirSync(/*turbopackIgnore: true*/ dir);
      const match = entries.find((e) => e.startsWith(`${kind}.`));
      if (!match) continue;
      const ext = path.extname(match).replace(/^\./, "").toLowerCase();
      const contentType = EXT_TO_MIME[ext];
      if (!contentType) continue;
      const buffer = fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, match));
      if (buffer.length > 0) {
        return { buffer, contentType, ext };
      }
    } catch {
      // Try next dir
    }
  }
  return null;
}

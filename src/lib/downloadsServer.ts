import fs from "node:fs";
import path from "node:path";
import {
  FALLBACK_DOWNLOAD_PACKAGES,
  formatDownloadBytes,
  type DownloadPackageInfo,
  type PublicDownloadsResponse,
} from "./downloadsTypes";

interface VersionManifest {
  version?: string;
  updatedAt?: string;
  fileName?: string;
}

function resolveDownloadsDir(): string {
  const candidates = [
    path.join(process.cwd(), "public", "downloads"),
    path.join(process.cwd(), ".next", "standalone", "public", "downloads"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      return dir;
    }
  }
  return candidates[0];
}

export function getPublicDownloadsInventory(
  customDownloadsDir?: string
): PublicDownloadsResponse {
  const downloadsDir = customDownloadsDir || resolveDownloadsDir();
  let manifest: VersionManifest = {};
  const manifestPath = path.join(downloadsDir, "version.json");

  if (fs.existsSync(/*turbopackIgnore: true*/ manifestPath)) {
    try {
      manifest = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ manifestPath, "utf8")
      ) as VersionManifest;
    } catch {
      manifest = {};
    }
  }

  const version = String(manifest.version || "1.0.0");
  let latestTimestamp: string | null = manifest.updatedAt || null;

  const packages: DownloadPackageInfo[] = FALLBACK_DOWNLOAD_PACKAGES.map((pkg) => {
    const primaryPath = path.join(downloadsDir, pkg.fileName);
    const mirrorPath = pkg.mirrorFileName
      ? path.join(downloadsDir, pkg.mirrorFileName)
      : "";

    let chosenPath = "";
    let resolvedFileName = pkg.fileName;
    let resolvedUrl = pkg.downloadUrl;

    if (fs.existsSync(/*turbopackIgnore: true*/ primaryPath)) {
      chosenPath = primaryPath;
    } else if (mirrorPath && fs.existsSync(/*turbopackIgnore: true*/ mirrorPath)) {
      chosenPath = mirrorPath;
      resolvedFileName = pkg.mirrorFileName!;
      resolvedUrl = pkg.mirrorDownloadUrl!;
    }

    if (!chosenPath) {
      return {
        ...pkg,
        version,
        exists: false,
        sizeBytes: 0,
        sizeFormatted: "—",
        updatedAt: null,
      };
    }

    const stat = fs.statSync(/*turbopackIgnore: true*/ chosenPath);
    const updatedIso = stat.mtime.toISOString();
    if (!latestTimestamp || updatedIso > latestTimestamp) {
      latestTimestamp = updatedIso;
    }

    const mirrorExists =
      Boolean(mirrorPath) && fs.existsSync(/*turbopackIgnore: true*/ mirrorPath);

    return {
      ...pkg,
      fileName: resolvedFileName,
      downloadUrl: resolvedUrl,
      mirrorFileName: mirrorExists ? pkg.mirrorFileName : undefined,
      mirrorDownloadUrl: mirrorExists ? pkg.mirrorDownloadUrl : undefined,
      version,
      exists: stat.size > 0,
      sizeBytes: stat.size,
      sizeFormatted: formatDownloadBytes(stat.size),
      updatedAt: updatedIso,
    };
  });

  return {
    ok: true,
    version,
    updatedAt: latestTimestamp,
    packages,
  };
}

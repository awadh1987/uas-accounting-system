import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant";
import { resolvePublicTenantFromRequest } from "@/lib/publicTenantResolver";
import { resolveCustomFaviconUrl, resolveCustomLogoUrl } from "@/lib/branding";
import {
  decodeDataUrlAsset,
  readTenantBrandAssetFile,
  resolvePublicFilePath,
} from "@/lib/brandingAssets";

export const dynamic = "force-dynamic";

function serveFallbackUasFavicon(headers: Record<string, string>) {
  const candidates = ["favicon-32x32.png", "favicon.ico", "uas-logo.png"];
  for (const rel of candidates) {
    const filePath = resolvePublicFilePath(rel);
    if (filePath) {
      const buf = fs.readFileSync(filePath);
      const contentType = rel.endsWith(".ico") ? "image/x-icon" : "image/png";
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=60, must-revalidate",
          ...headers,
        },
      });
    }
  }
  return new NextResponse(null, { status: 404, headers });
}

function tryServeUrlOrFile(
  urlValue: string | null,
  tenantKey: string,
  diskKind: "favicon" | "logo",
  headers: Record<string, string>
): NextResponse | null {
  if (!urlValue) return null;

  if (urlValue.startsWith("data:")) {
    const decoded = decodeDataUrlAsset(urlValue);
    if (decoded) {
      return new NextResponse(new Uint8Array(decoded.buffer), {
        status: 200,
        headers: {
          "Content-Type": decoded.contentType,
          "Cache-Control": "public, max-age=60, must-revalidate",
          ...headers,
        },
      });
    }
  }

  if (urlValue.startsWith("/api/public/tenant/")) {
    const file = readTenantBrandAssetFile(tenantKey, diskKind);
    if (file) {
      return new NextResponse(new Uint8Array(file.buffer), {
        status: 200,
        headers: {
          "Content-Type": file.contentType,
          "Cache-Control": "public, max-age=60, must-revalidate",
          ...headers,
        },
      });
    }
  }

  if (/^https?:\/\//i.test(urlValue)) {
    return NextResponse.redirect(urlValue, 302);
  }

  if (urlValue.startsWith("/")) {
    const pubPath = resolvePublicFilePath(urlValue);
    if (pubPath) {
      const buf = fs.readFileSync(pubPath);
      const ext = pubPath.split(".").pop()?.toLowerCase() || "";
      const contentType =
        ext === "svg"
          ? "image/svg+xml"
          : ext === "ico"
          ? "image/x-icon"
          : ext === "webp"
          ? "image/webp"
          : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : "image/png";
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=60, must-revalidate",
          ...headers,
        },
      });
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const lookup = await resolvePublicTenantFromRequest(req);
    const tenantId = lookup.found ? lookup.tenantId : "default";
    const tenantKey = lookup.resolvedSlug || tenantId;
    const tenantHeaders: Record<string, string> = {
      "x-uas-tenant-id": tenantId,
      ...(lookup.resolvedSlug ? { "x-uas-tenant-slug": lookup.resolvedSlug } : {}),
    };

    const profile = await runWithTenant(tenantId, async () =>
      prisma.enterpriseProfile.findUnique({ where: { id: "default" } })
    );

    const customFavicon = resolveCustomFaviconUrl(profile);
    if (customFavicon) {
      const direct = tryServeUrlOrFile(customFavicon, tenantKey, "favicon", tenantHeaders);
      if (direct) return direct;
    }

    // Derive favicon from tenant's custom logo if no separate favicon was uploaded
    const customLogo = resolveCustomLogoUrl(profile);
    if (customLogo) {
      const fromDisk = readTenantBrandAssetFile(tenantKey, "favicon") || readTenantBrandAssetFile(tenantKey, "logo");
      if (fromDisk) {
        return new NextResponse(new Uint8Array(fromDisk.buffer), {
          status: 200,
          headers: {
            "Content-Type": fromDisk.contentType,
            "Cache-Control": "public, max-age=60, must-revalidate",
            ...tenantHeaders,
          },
        });
      }
      const derived = tryServeUrlOrFile(customLogo, tenantKey, "logo", tenantHeaders);
      if (derived) return derived;
    }

    return serveFallbackUasFavicon(tenantHeaders);
  } catch (err) {
    console.error("GET /api/public/tenant/favicon error:", err);
    return serveFallbackUasFavicon({});
  }
}

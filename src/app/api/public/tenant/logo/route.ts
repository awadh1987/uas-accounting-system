import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant";
import { resolvePublicTenantFromRequest } from "@/lib/publicTenantResolver";
import { resolveCustomLogoUrl } from "@/lib/branding";
import {
  decodeDataUrlAsset,
  readTenantBrandAssetFile,
  resolvePublicFilePath,
} from "@/lib/brandingAssets";

export const dynamic = "force-dynamic";

function serveFallbackUasLogo(headers: Record<string, string>) {
  const filePath = resolvePublicFilePath("uas-logo.png");
  if (filePath) {
    const buf = fs.readFileSync(filePath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60, must-revalidate",
        ...headers,
      },
    });
  }
  return new NextResponse(null, { status: 404, headers });
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

    const customLogo = resolveCustomLogoUrl(profile);
    if (customLogo) {
      if (customLogo.startsWith("data:")) {
        const decoded = decodeDataUrlAsset(customLogo);
        if (decoded) {
          return new NextResponse(new Uint8Array(decoded.buffer), {
            status: 200,
            headers: {
              "Content-Type": decoded.contentType,
              "Cache-Control": "public, max-age=60, must-revalidate",
              ...tenantHeaders,
            },
          });
        }
      }

      if (customLogo.startsWith("/api/public/tenant/")) {
        const file = readTenantBrandAssetFile(tenantKey, "logo");
        if (file) {
          return new NextResponse(new Uint8Array(file.buffer), {
            status: 200,
            headers: {
              "Content-Type": file.contentType,
              "Cache-Control": "public, max-age=60, must-revalidate",
              ...tenantHeaders,
            },
          });
        }
      }

      if (/^https?:\/\//i.test(customLogo)) {
        return NextResponse.redirect(customLogo, 302);
      }

      if (customLogo.startsWith("/")) {
        const pubPath = resolvePublicFilePath(customLogo);
        if (pubPath) {
          const buf = fs.readFileSync(pubPath);
          const ext = pubPath.split(".").pop()?.toLowerCase() || "";
          const contentType =
            ext === "svg"
              ? "image/svg+xml"
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
              ...tenantHeaders,
            },
          });
        }
      }
    }

    return serveFallbackUasLogo(tenantHeaders);
  } catch (err) {
    console.error("GET /api/public/tenant/logo error:", err);
    return serveFallbackUasLogo({});
  }
}

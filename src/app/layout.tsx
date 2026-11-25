import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Cairo, Inter } from "next/font/google";
import "./globals.css";
import { PointerLightController } from "@/components/PointerLightController";
import { buildThemeBootInlineScript } from "@/lib/themeEngine";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TAB_TITLE,
  resolveEffectiveBrandInfo,
} from "@/lib/branding";
import {
  extractSubdomainSlugFromHost,
  findTenantBySlug,
  normalizeTenantId,
  runWithTenant,
} from "@/lib/tenant";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-cairo",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

const DEFAULT_UAS_ICONS: Metadata["icons"] = {
  icon: [
    { url: "/favicon.ico", sizes: "any" },
    { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { url: "/uas-logo.png", sizes: "512x512", type: "image/png" },
  ],
  apple: [
    { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  let title = DEFAULT_TAB_TITLE;
  let icons: Metadata["icons"] = DEFAULT_UAS_ICONS;

  if (process.env.CAPACITOR_EXPORT !== "1") {
    try {
      const reqHeaders = await headers();
      const host = reqHeaders.get("x-forwarded-host") || reqHeaders.get("host") || "";
      const hostSlug = extractSubdomainSlugFromHost(host);
      const matched = hostSlug ? findTenantBySlug(hostSlug) : null;
      const targetTenantId =
        matched && matched.status === "ACTIVE"
          ? matched.tenantId
          : hostSlug
          ? normalizeTenantId(hostSlug)
          : "default";

      const profile = await runWithTenant(targetTenantId, async () =>
        prisma.enterpriseProfile.findUnique({ where: { id: "default" } })
      );

      const effectiveSlug = hostSlug || profile?.tenantSlug || null;
      const brand = resolveEffectiveBrandInfo(profile, effectiveSlug);
      title = brand.tabTitleEn;

      if (brand.hasCustomBrand) {
        icons = {
          icon: [{ url: brand.effectiveFaviconUrl }],
          shortcut: [{ url: brand.effectiveFaviconUrl }],
          apple: [{ url: brand.effectiveFaviconUrl }],
        };
      }
    } catch {
      title = DEFAULT_TAB_TITLE;
      icons = DEFAULT_UAS_ICONS;
    }
  }

  return {
    title,
    description:
      "Unified Accounting System (UAS) — Enterprise Resource Planning, General Ledger, Treasury & Inventory",
    manifest: "/manifest.webmanifest",
    icons,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${cairo.variable} ${inter.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: buildThemeBootInlineScript() }}
        />
      </head>
      <body className="min-h-screen flex flex-col antialiased">
        <PointerLightController />
        {children}
      </body>
    </html>
  );
}

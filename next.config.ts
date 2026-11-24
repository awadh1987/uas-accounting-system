import type { NextConfig } from "next";

const isCapacitorExport = process.env.CAPACITOR_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isCapacitorExport ? { output: "export" } : { output: "standalone" }),
  outputFileTracingExcludes: {
    "*": [
      "./android/**",
      "./ios/**",
      "./release/**",
      "./tests/**",
      "./docs/**",
      "./out/**",
    ],
  },
  productionBrowserSourceMaps: false,
  images: {
    unoptimized: true,
  },
  ...(!isCapacitorExport
    ? {
        async headers() {
          return [
            {
              source: "/api/:path*",
              headers: [
                {
                  key: "Access-Control-Allow-Origin",
                  value: "*",
                },
                {
                  key: "Access-Control-Allow-Methods",
                  value: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                },
                {
                  key: "Access-Control-Allow-Headers",
                  value:
                    "Content-Type, Authorization, X-Requested-With, x-uas-seat-token, x-uas-device-name, x-uas-device-id, x-uas-platform, x-uas-app-version, x-uas-os-version, x-uas-user-id, x-uas-role, x-uas-user-display, x-uas-tenant-id, x-tenant-id, x-uas-company-id, x-uas-session-tenant, x-uas-client-token, x-idempotency-key",
                },
              ],
            },
            {
              source: "/downloads/:path*.apk",
              headers: [
                {
                  key: "Content-Type",
                  value: "application/vnd.android.package-archive",
                },
                {
                  key: "Content-Disposition",
                  value: 'attachment; filename="UAS-Accounting.apk"',
                },
                {
                  key: "Cache-Control",
                  value: "no-cache, no-store, must-revalidate",
                },
              ],
            },
            {
              source: "/downloads/:path*.exe",
              headers: [
                {
                  key: "Content-Type",
                  value: "application/vnd.microsoft.portable-executable",
                },
                {
                  key: "Content-Disposition",
                  value: 'attachment; filename="UAS-Setup-Win64.exe"',
                },
                {
                  key: "Cache-Control",
                  value: "no-cache, no-store, must-revalidate",
                },
              ],
            },
            {
              source: "/downloads/version.json",
              headers: [
                {
                  key: "Content-Type",
                  value: "application/json",
                },
                {
                  key: "Cache-Control",
                  value: "no-cache, no-store, must-revalidate",
                },
              ],
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;

import type { NextConfig } from "next";

const isCapacitorExport = process.env.CAPACITOR_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isCapacitorExport ? { output: "export" } : {}),
  images: {
    unoptimized: true,
  },
  ...(!isCapacitorExport
    ? {
        async headers() {
          return [
            {
              source: "/downloads/:path*.apk",
              headers: [
                {
                  key: "Content-Type",
                  value: "application/vnd.android.package-archive",
                },
                {
                  key: "Content-Disposition",
                  value: 'attachment; filename="UAS-Mobile-Release.apk"',
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


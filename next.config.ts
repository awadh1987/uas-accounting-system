import type { NextConfig } from "next";

const isCapacitorExport = process.env.CAPACITOR_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isCapacitorExport ? { output: "export" } : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;


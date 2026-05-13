import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Bundle static curl binary into the /api/clipping/scrape Vercel function.
  // Vercel's Amazon Linux 2 runtime does not have curl in PATH; we ship our own.
  outputFileTracingIncludes: {
    "/api/clipping/scrape": ["./vendor/curl-static-amd64"],
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Bundle curl-impersonate binaries into the /api/clipping/scrape Vercel function.
  // Vercel's Amazon Linux 2 runtime does not have curl in PATH; we ship our own.
  // curl_chrome131 is the bash wrapper; curl-impersonate is the actual ELF binary it calls.
  outputFileTracingIncludes: {
    "/api/clipping/scrape": [
      "./vendor/curl-impersonate",
      "./vendor/curl_chrome131",
    ],
  },
};

export default nextConfig;

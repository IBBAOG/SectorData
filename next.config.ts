import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Prevent the bundler from inlining native/binary modules — they must be
  // required at runtime by the Node.js process, not bundled into a webpack chunk.
  serverExternalPackages: [
    "@sparticuz/chromium",
    "playwright-core",
    "playwright-extra",
    "puppeteer-extra",
    "puppeteer-extra-plugin-stealth",
  ],
  // Bundle curl-impersonate binaries + Chromium into the /api/clipping/scrape
  // Vercel function. Vercel's Amazon Linux 2 runtime does not have curl in PATH;
  // we ship our own. curl_chrome131 is the bash wrapper; curl-impersonate is the
  // actual ELF binary it calls. @sparticuz/chromium/bin contains the serverless
  // Chromium binary used by playwright-core.
  outputFileTracingIncludes: {
    "/api/clipping/scrape": [
      "./vendor/curl-static-amd64",
      "./vendor/curl-impersonate",
      "./vendor/curl_chrome131",
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/playwright-core/**/*",
      "./node_modules/playwright-extra/**/*",
      "./node_modules/puppeteer-extra/**/*",
      "./node_modules/puppeteer-extra-plugin-stealth/**/*",
      "./node_modules/puppeteer-extra-plugin-stealth/evasions/**/package.json",
      "./node_modules/puppeteer-extra-plugin-stealth/evasions/**/index.js",
      "./node_modules/puppeteer-extra-plugin/**/*",
      "./node_modules/puppeteer-extra-plugin-user-preferences/**/*",
      "./node_modules/puppeteer-extra-plugin-user-data-dir/**/*",
      "./node_modules/deepmerge/**/*",
      // Transitive deps required by puppeteer-extra-plugin-stealth at runtime
      "./node_modules/merge-deep/**/*",
      "./node_modules/clone-deep/**/*",
      "./node_modules/shallow-clone/**/*",
      "./node_modules/kind-of/**/*",
      "./node_modules/for-own/**/*",
      "./node_modules/for-in/**/*",
      "./node_modules/is-plain-object/**/*",
      "./node_modules/isobject/**/*",
      "./node_modules/is-buffer/**/*",
      "./node_modules/arr-union/**/*",
      "./node_modules/mixin-object/**/*",
      "./node_modules/debug/**/*",
      "./node_modules/ms/**/*",
    ],
  },
};

export default nextConfig;

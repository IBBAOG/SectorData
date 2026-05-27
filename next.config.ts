import type { NextConfig } from "next";
import path from "path";

/**
 * Security headers applied globally to every response (`source: '/(.*)'`).
 *
 * CSP notes:
 * - `script-src` includes `'unsafe-inline'` and `'unsafe-eval'` because Plotly.js
 *   (and react-plotly.js) injects inline scripts and uses Function() internally
 *   for chart compilation. Removing these breaks every Plotly-based dashboard.
 * - TODO (future hardening): migrate to nonce-based CSP. Requires either SSR
 *   wrappers for Plotly or replacing it with a CSP-friendly library.
 * - `https://cdn.plot.ly` is required by Plotly scattergeo/choropleth at runtime
 *   to fetch the topojson basemap (world_110m.json). plotly.js-dist-min ships the
 *   plotting engine but NOT the geo assets — these must be fetched on demand.
 *   Allowed in both `script-src` (for any future CDN script loading) and
 *   `connect-src` (for the basemap fetch).
 * - `connect-src` lists Supabase (REST + Realtime WS) and the Yahoo Finance
 *   endpoints proxied via `/api/stocks/*`.
 * - `img-src` allows `data:` and `blob:` for ExcelJS/JSZip exports and
 *   `https://*.supabase.co` for Storage-served card previews and avatars.
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY` makes clickjacking
 *   impossible. The clipping modal renders inside a sandboxed iframe of the
 *   same origin, which is not affected.
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.plot.ly",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://query1.finance.yahoo.com https://query2.finance.yahoo.com https://cdn.plot.ly",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  async redirects() {
    // Route migrations — keep external links / bookmarks working.
    //   2026-05-28: /production → /well-by-well (Round 4 rename — dashboard
    //               kept the same data, the URL became more descriptive).
    return [
      {
        source: "/production",
        destination: "/well-by-well",
        permanent: true,
      },
    ];
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

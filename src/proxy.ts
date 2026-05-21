// ─────────────────────────────────────────────────────────────────────────────
// Next.js proxy — visitor cookie issuance for anonymous analytics.
//
// In Next.js 16, the historical `middleware` file convention was renamed to
// `proxy` (see https://nextjs.org/docs/messages/middleware-to-proxy). The file
// must live at `src/proxy.ts` and export a function named `proxy` (or a default
// export). The runtime semantics are identical to the legacy `middleware`.
//
// Sets an HttpOnly, Secure, SameSite=Lax cookie `sd_visitor_id` carrying a
// random UUID v4. Echoes the value into the `x-sd-visitor-id` response header
// so Server Components and API routes can read it without re-parsing cookies.
//
// Bot mitigation: requests whose `user-agent` matches a common crawler regex
// do NOT receive a cookie. This avoids polluting `unique_visitors` analytics
// with crawlers, monitoring probes and link-preview fetchers.
//
// Cookie namespace: we deliberately use `sd_` (SectorData) — `sb-*` is reserved
// by Supabase Auth (`sb-access-token`, `sb-refresh-token`) and any prefix
// collision could be misread by other parts of the stack.
//
// Matcher: this proxy runs only for dashboard routes. /api, /_next, /favicon,
// /icon, and /.well-known are explicitly excluded — the cookie is useless on
// those paths and skipping them shaves edge-function invocations.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

const VISITOR_COOKIE_NAME = "sd_visitor_id";
const VISITOR_HEADER_NAME = "x-sd-visitor-id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const BOT_UA_REGEX = /bot|crawler|spider|crawling|slurp/i;

export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  const userAgent = request.headers.get("user-agent") ?? "";

  // Bots get a pass-through with no cookie and no echo header.
  if (BOT_UA_REGEX.test(userAgent)) {
    return response;
  }

  const existing = request.cookies.get(VISITOR_COOKIE_NAME)?.value;

  if (existing) {
    // Echo existing cookie so SSR/Server Components/API routes can read it
    // without re-parsing the cookie header.
    response.headers.set(VISITOR_HEADER_NAME, existing);
    return response;
  }

  // Issue a new visitor id. crypto.randomUUID is available in the Edge runtime.
  const visitorId = crypto.randomUUID();

  response.cookies.set({
    name: VISITOR_COOKIE_NAME,
    value: visitorId,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
  });
  response.headers.set(VISITOR_HEADER_NAME, visitorId);

  return response;
}

// Matcher excludes API routes (no cookie needed for JSON endpoints called
// from the client), Next.js internals, favicons, and well-known URLs.
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon|icon|\\.well-known).*)",
  ],
};

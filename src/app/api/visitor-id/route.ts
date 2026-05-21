// ─────────────────────────────────────────────────────────────────────────────
// GET /api/visitor-id
//
// Reads the `sd_visitor_id` cookie that the middleware sets and returns it as
// JSON. Used by UserProfileContext on the client side because the cookie is
// HttpOnly — `document.cookie` cannot see it directly.
//
// Returns null when the cookie is absent (e.g. middleware skipped the request
// because of the bot user-agent filter, or this is the very first navigation
// and the cookie has not been written yet — though in practice the matcher
// guarantees the cookie is set on the same response).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

// Force dynamic — this handler reads request-time cookies and must not be
// cached at the framework level.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const visitorId = request.cookies.get("sd_visitor_id")?.value ?? null;
  return NextResponse.json(
    { visitorId },
    { headers: { "Cache-Control": "no-store" } },
  );
}

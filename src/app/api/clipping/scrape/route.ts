// POST /api/clipping/scrape
// Admin-only route. Accepts up to 30 URLs, scrapes each one, returns ScrapeResult[].
// Admin auth — verifies Bearer token via Supabase, then checks profiles.role='Admin'.
// No curl_cffi TLS impersonation — 403 sites surface as fetch_failed.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scrape } from "@/lib/clipping/scrape";
import { parseNetscapeCookies, buildCookieHeader, canonicalDomain } from "@/lib/clipping/cookies";
import { scrapeLimiter, enforceLimit, rateLimitResponse, getClientIp } from "@/lib/rateLimit";
import type { ScrapeResult } from "@/lib/clipping/types";

export const runtime = "nodejs";
export const maxDuration = 300; // raised from 180 (3 min) to 300 (5 min) to support 30-URL batches

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const BATCH_LIMIT = 30; // raised from 15 — 30 URLs × 30s timeout = 900s worst-case, but Promise.allSettled runs concurrently so real wall-clock is ~30s per slowest URL
const PER_URL_TIMEOUT_MS = 30_000;

interface ScrapeRequestBody {
  urls: string[];
  manualBodies?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. Admin auth — Bearer token → Supabase getUser → profiles.role='Admin' ─
    const authHeader = req.headers.get("authorization") ?? "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!userToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const {
      data: { user },
      error: userErr,
    } = await admin.auth.getUser(userToken);
    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profileRow, error: profileErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileErr || !profileRow || profileRow.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });
    }

    // ── 1b. Rate limit (10/min/user; IP fallback handled by auth gate above) ────
    if (scrapeLimiter) {
      const identifier = user.id || getClientIp(req);
      const rl = await enforceLimit(scrapeLimiter, identifier);
      if (!rl.success) {
        return rateLimitResponse(rl.limit, rl.remaining, rl.reset);
      }
    }

    // ── 2. Parse body ────────────────────────────────────────────────────────────
    let body: ScrapeRequestBody;
    try {
      body = (await req.json()) as ScrapeRequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { urls, manualBodies = {} } = body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: "urls must be a non-empty array" }, { status: 400 });
    }

    // ── 3. Enforce 30-URL batch cap ──────────────────────────────────────────────
    const toProcess = urls.slice(0, BATCH_LIMIT);
    const skipped: ScrapeResult[] = urls.slice(BATCH_LIMIT).map((url) => ({
      url,
      status: "skipped" as const,
      error: "Batch limit exceeded (max 30 URLs per request).",
    }));

    // ── 4. Resolve cookies for all unique domains in the batch ───────────────────
    const domains = [...new Set(toProcess.map(canonicalDomain).filter(Boolean))];
    const cookieHeaderByDomain: Record<string, string> = {};

    if (domains.length > 0) {
      const { data: cookieRows } = await admin
        .from("clipping_cookies")
        .select("domain, cookies_netscape")
        .in("domain", domains);

      if (cookieRows) {
        for (const row of cookieRows as Array<{ domain: string; cookies_netscape: string }>) {
          const parsed = parseNetscapeCookies(row.cookies_netscape);
          if (parsed.length > 0) {
            cookieHeaderByDomain[row.domain] = buildCookieHeader(parsed);
          }
        }
      }
    }

    // ── 5. Resolve debug flag (?debug=1 — Admin-only gate already enforced above) ──
    const debugMode = new URL(req.url).searchParams.get("debug") === "1";

    // ── 6. Scrape concurrently with per-URL timeout ──────────────────────────────
    const settled = await Promise.allSettled(
      toProcess.map(async (url): Promise<ScrapeResult> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_URL_TIMEOUT_MS);
        try {
          const domain = canonicalDomain(url);
          const cookieHeader = cookieHeaderByDomain[domain];
          return await scrape(url, controller.signal, manualBodies[url], cookieHeader, debugMode);
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    const results: ScrapeResult[] = settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value;
      // Promise rejection (unexpected — scrape() should not throw).
      return {
        url: toProcess[i],
        status: "error" as const,
        error: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    });

    return NextResponse.json({ results: [...results, ...skipped] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[clipping/scrape]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

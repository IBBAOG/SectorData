/**
 * Rate limiting infrastructure for own API routes.
 *
 * Strategy:
 * - Backed by Upstash Redis (serverless, free tier sufficient for B2B traffic).
 * - Three independent limiters: stocks (60/min/IP), scrape (10/min/user),
 *   upload (20/hour/user). Sliding window algorithm.
 * - Graceful fallback: if `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
 *   are NOT set (typical for local development), the limiters export as `null`
 *   and routes treat that as "rate limit disabled".
 * - In production (Vercel), the CTO creates both env vars in project settings.
 *
 * Usage in a route handler:
 *
 *   import { stocksLimiter, enforceLimit } from "@/lib/rateLimit";
 *
 *   const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
 *   if (stocksLimiter) {
 *     const { success, limit, remaining, reset } = await enforceLimit(stocksLimiter, ip);
 *     if (!success) return rateLimitResponse(limit, remaining, reset);
 *   }
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_AVAILABLE = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

const redis: Redis | null = REDIS_AVAILABLE
  ? new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })
  : null;

function makeLimiter(window: `${number} ${"s" | "m" | "h" | "d"}`, max: number, prefix: string): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, window),
    analytics: true,
    prefix,
  });
}

/** 60 requests / minute per IP — Yahoo Finance proxy endpoints. */
export const stocksLimiter: Ratelimit | null = makeLimiter("1 m", 60, "rl:stocks");

/** 10 requests / minute per authenticated user — Admin scraping endpoint. */
export const scrapeLimiter: Ratelimit | null = makeLimiter("1 m", 10, "rl:scrape");

/** 20 requests / hour per authenticated user — Admin upload endpoint. */
export const uploadLimiter: Ratelimit | null = makeLimiter("1 h", 20, "rl:upload");

/** Result returned by `enforceLimit`. */
export interface LimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Apply a limiter against a stable identifier (IP or user.id).
 * If `limiter` is null (Redis unavailable / dev mode), allows the request.
 */
export async function enforceLimit(limiter: Ratelimit, identifier: string): Promise<LimitResult> {
  const { success, limit, remaining, reset } = await limiter.limit(identifier);
  return { success, limit, remaining, reset };
}

/**
 * Build a standard 429 response with Retry-After + X-RateLimit-* headers.
 */
export function rateLimitResponse(limit: number, remaining: number, reset: number): NextResponse {
  const retryAfter = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Rate limit exceeded. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset": String(Math.ceil(reset / 1000)),
      },
    },
  );
}

/**
 * Extract caller IP from common proxy headers.
 * Falls back to "unknown" if no signal is available — limiter will then
 * group all unknown-IP requests under the same bucket, which is acceptable
 * for our threat model (defense-in-depth, not perfect attribution).
 */
export function getClientIp(req: { headers: Headers }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

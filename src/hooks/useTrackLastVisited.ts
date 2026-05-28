"use client";

// useTrackLastVisited — persists the FIFO history of the last-visited
// dashboard slugs in localStorage. Consumed by the mobile /home View to render
// the "Last visited" horizontal pill row (plan § 4.1).
//
// The hook is fire-and-forget: it observes `usePathname()` and pushes the
// current slug into the stack on every route change. There is no read API —
// callers that need to display the list import `readLastVisited()` directly.
//
// Storage key: `sd_last_visited`. Namespace `sd_` matches the cookie scheme
// (see src/proxy.ts and the Supabase cookie collision note in CLAUDE.md
// Pegadinha #14).
//
// Cap: 4 entries. Newest first. Duplicates are de-duped (the latest visit of
// a slug bubbles to the front instead of creating a new entry).
//
// Excluded routes: any pathname that does not map cleanly to a dashboard
// (login, profile, admin-*, terms, privacy, mfa) is skipped. We also skip
// `/home` itself — visiting home is the implicit baseline.
//
// SSR / Hydration:
//   - The Next.js router renders this on the client only; the wrapping layout
//     is `"use client"`. Reading from window.localStorage inside useEffect is
//     safe (no SSR mismatch).
//   - The hook returns nothing; it's purely a side effect.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "sd_last_visited";
const MAX_ENTRIES = 4;

// Routes that should NEVER appear in the last-visited list.
const EXCLUDED_PREFIXES = [
  "/login",
  "/profile",
  "/admin-panel",
  "/admin-analytics",
  "/terms",
  "/privacy",
  "/home",
  "/mobile-preview",
];

function isTrackable(pathname: string | null): boolean {
  if (!pathname) return false;
  if (!pathname.startsWith("/")) return false;
  return !EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Extract the top-level slug from a pathname (e.g. /well-by-well/x → well-by-well). */
function slugFromPathname(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

/**
 * Read the current last-visited stack (newest first).
 *
 * Returns an empty array on SSR or when localStorage is unavailable
 * (private mode, security errors). Safe to call from any client component.
 */
export function readLastVisited(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Write a slug to the stack (newest first, dedup, cap MAX_ENTRIES).
 *
 * Exported for tests and for any caller that needs to manually pin/unpin a
 * visit (not used by the mobile View itself).
 */
export function writeLastVisited(slug: string): void {
  if (typeof window === "undefined") return;
  if (!slug) return;
  try {
    const current = readLastVisited();
    const without = current.filter((s) => s !== slug);
    const next = [slug, ...without].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / SecurityError — fail silently. The feature is non-critical.
  }
}

/**
 * Side-effect hook. Pushes the current pathname into the last-visited stack
 * whenever the route changes (and the route is trackable).
 *
 * Mount this once at the top of the mobile layout; do NOT mount it from
 * inside individual dashboards (would cause duplicate writes on every
 * dashboard-internal navigation).
 */
export function useTrackLastVisited(): void {
  const pathname = usePathname();

  useEffect(() => {
    if (!isTrackable(pathname)) return;
    const slug = slugFromPathname(pathname);
    if (!slug) return;
    writeLastVisited(slug);
  }, [pathname]);
}

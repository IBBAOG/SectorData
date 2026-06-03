// pillDock.ts — single source of truth for the floating pill dock layout.
//
// The mobile chrome renders a horizontal row of floating "pill" shortcuts at
// the bottom of the viewport (Home, News Hunter, Stock Guide as of 2026-06-02).
// Each pill auto-hides on its own route (the shortcut would be a no-op there),
// so the number of *visible* pills varies between 2 and 3 depending on where
// the user is. This module owns the geometry so the pills never disagree about
// where they sit.
//
// Why a shared helper (history):
//   The original 2-pill implementation (Home + News, Onda 8, 2026-05-28)
//   hard-coded a ±39px offset table inside each pill and special-cased a "solo"
//   mode for when one sibling hid. That math does not generalise to 3+ pills.
//   Adding the Stock Guide pill (2026-06-02) replaced it with the formula below
//   so any future pill count is correct by construction.
//
// Geometry:
//   All pills anchor at `left: 50%` and translate by
//   `translateX(calc(-50% + var(--pill-offset)))`. `--pill-offset` is the px
//   value returned by `pillOffset()`. For the set of *visible* pills (every
//   pill except the one hidden on the current route), ordered left→right with
//   index `i` among `N` visible pills:
//
//     offset_i = (i - (N - 1) / 2) * (PILL_W + GAP)
//
//   This centres the visible group on the viewport's vertical centerline with
//   GAP px between adjacent pills' edges. `PILL_W + GAP = 78`.
//
//   Cross-checked cases (registry order: home, news, stock-guide):
//     ┌──────────────────┬─────────────────────┬───────────────────────────┐
//     │ Route            │ Visible pills (N)   │ Offsets (home / news / sg) │
//     ├──────────────────┼─────────────────────┼───────────────────────────┤
//     │ other (e.g. /wbw)│ home, news, sg  (3) │  −78 /   0 / +78           │
//     │ /home            │ news, sg        (2) │   —  / −39 / +39           │
//     │ /news-hunter     │ home, sg        (2) │  −39 /  —  / +39           │
//     │ /stock-guide     │ home, news      (2) │  −39 / +39 /  —            │
//     └──────────────────┴─────────────────────┴───────────────────────────┘
//
//   The /stock-guide row (home −39 / news +39) is byte-identical to the legacy
//   2-pill paired layout, so adding the third pill is a proven non-regression
//   for the original pair. A "solo" (single centered pill) mode can no longer
//   occur: every route hides at most one of the three pills, so 2 or 3 always
//   remain visible. That is expected.

/** Visible pill width in px (the Liquid Glass capsule). Shared by every pill. */
export const PILL_W = 64;
/** Visible pill height in px. Shared by every pill. */
export const PILL_H = 56;
/** Horizontal gap between adjacent pills in px. */
export const GAP = 14;

/** Pitch between adjacent pill centers (width + gap). */
const PITCH = PILL_W + GAP;

/** Identifier for each pill in the dock. */
export type PillId = "home" | "news" | "stock-guide";

interface PillDef {
  id: PillId;
  /** The route this pill targets — and the route on which it auto-hides. */
  route: string;
}

// Ordered registry, left → right. The order here IS the on-screen order.
// To add a pill: append it (or insert at the desired horizontal position) and
// the offset formula recomputes the whole dock automatically.
const PILL_REGISTRY: readonly PillDef[] = [
  { id: "home", route: "/home" },
  { id: "news", route: "/news-hunter" },
  { id: "stock-guide", route: "/stock-guide" },
];

/**
 * True when `pathname` is on `route` (exact match, trailing slash, or a nested
 * child such as `/stock-guide/abc`). Mirrors the gate every pill already used.
 */
function isOnRoute(pathname: string | null | undefined, route: string): boolean {
  if (!pathname) return false;
  return pathname === route || pathname.startsWith(route + "/");
}

/**
 * Computes the horizontal offset (in px, relative to the viewport center) for
 * the pill `id` given the active `pathname`.
 *
 * Returns `null` when the pill must hide (we are on its own route) — the caller
 * should render nothing in that case. Otherwise returns the signed px offset to
 * write into `--pill-offset`.
 *
 * @param pathname  The active pathname (from `usePathname()`).
 * @param id        Which pill to position.
 * @param forceVisible  When true, the pill never hides on its own route; it is
 *                  treated as visible and positioned among the other visible
 *                  pills. Used by previews. Defaults to false.
 */
export function pillOffset(
  pathname: string | null | undefined,
  id: PillId,
  forceVisible = false,
): number | null {
  const self = PILL_REGISTRY.find((p) => p.id === id);
  // Unknown id — defensively hide rather than throw.
  if (!self) return null;

  const onOwnRoute = isOnRoute(pathname, self.route);
  if (onOwnRoute && !forceVisible) return null;

  // The set of pills that are visible right now: every pill except the ones
  // sitting on their own route. When `forceVisible` is set for THIS pill, it is
  // also counted as visible even on its own route, so the preview matches the
  // real multi-pill layout.
  const visible = PILL_REGISTRY.filter((p) => {
    if (p.id === id) return true; // self is visible (we returned null above otherwise)
    return !isOnRoute(pathname, p.route);
  });

  const index = visible.findIndex((p) => p.id === id);
  const n = visible.length;

  // Center the visible group on the viewport centerline.
  return (index - (n - 1) / 2) * PITCH;
}

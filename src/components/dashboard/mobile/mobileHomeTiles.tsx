// Tile palette + icon mapping for the /home mobile gallery.
//
// Onda 5 of the mobile reform (2026-05-28). The /home mobile grid renders
// each dashboard as a Liquid Glass tile (`MobileHomeIconTile`) with a tinted
// squircle icon badge.
//
// Onda 5.2 (2026-05-28, [mobile-only]): tint scheme switched from a per-slug
// saturated background + white glyph to a per-CATEGORY soft tint background
// + saturated category-text glyph — mirroring exactly the desktop /home
// `ModuleGallery` `iconTile` treatment (see `ModuleGallery.module.css`:232
// `.iconTile { background: var(--mg-accent-tile); color: var(--mg-accent-text); }`).
// The previous per-slug palette caused a visual mismatch (white glyph on
// solid colored badge in mobile vs. saturated glyph on soft tinted badge on
// desktop) — Eduardo flagged "as cores estão diferentes". Now the icon's
// fingerprint is identical across views.
//
// Category → tint mapping mirrors `ACCENTS` in
// `src/components/home/ModuleGallery/index.tsx`:
//
//   markets → brand orange   tile rgba(255,80,0,0.10)  text #cc3d00
//   oilgas  → blue-600       tile rgba(37,99,235,0.10) text #1d4ed8
//   fuel    → emerald-600    tile rgba(5,150,105,0.10) text #047857
//
// The glyph itself comes from the shared `@/data/moduleIcons` registry —
// the SAME source the desktop NavBar / Home ModuleGallery consume — so a
// given dashboard's icon is visually identical in both views.

import type { ReactNode } from "react";
import { getModuleIcon } from "@/data/moduleIcons";

export type TileCategory = "markets" | "oilgas" | "fuel";

export interface TileMeta {
  /** Pre-rendered SVG glyph at the canonical 24×24 size. */
  icon: ReactNode;
  /** Compact-variant glyph rendered at 20×20 (used by Last-visited row). */
  compactIcon: ReactNode;
  /** Icon-badge background colour (CSS color) — category soft tint. */
  tintBg: string;
  /** Icon foreground colour — saturated category-text colour. */
  tintFg: string;
  /**
   * Mobile-only label override. When present, the /home mobile tile should
   * render this string instead of the desktop `card.title`. Desktop labels
   * are intentionally untouched — this only abbreviates long titles for the
   * narrow horizontal tile (~150–190px wide at 360–426px viewport). Onda 7.2
   * (2026-05-28).
   */
  mobileLabel?: string;
}

// ── Mobile label overrides ──────────────────────────────────────────────────
//
// Slugs not listed here fall back to the desktop title (already short enough
// to fit two lines in the horizontal tile at 360px).

const MOBILE_LABEL_OVERRIDES: Record<string, string> = {
  "well-by-well": "Brazil Production",
  "diesel-gasoline-margins": "D&G Margins",
  "navios-diesel": "Diesel Line-Up",
};

// ── Category accents (mirror desktop ModuleGallery ACCENTS) ─────────────────

interface CategoryTint {
  tile: string;       // soft background (rgba 10%)
  accentText: string; // saturated foreground (AA on white)
}

const CATEGORY_TINTS: Record<TileCategory, CategoryTint> = {
  markets: { tile: "rgba(255, 80, 0, 0.10)", accentText: "#cc3d00" },
  oilgas: { tile: "rgba(37, 99, 235, 0.10)", accentText: "#1d4ed8" },
  fuel:   { tile: "rgba(5, 150, 105, 0.10)", accentText: "#047857" },
};

/** Slug → category fallback used when caller doesn't pass `category`. */
const SLUG_CATEGORY: Record<string, TileCategory> = {
  // Markets
  "stocks": "markets",
  "news-hunter": "markets",
  // Oil & Gas
  "well-by-well": "oilgas",
  "anp-cdp": "oilgas",
  "anp-cdp-bsw": "oilgas",
  "anp-cdp-depletion": "oilgas",
  "anp-cdp-diaria": "oilgas",
  // Fuel Distribution
  "market-share": "fuel",
  "price-bands": "fuel",
  "subsidy-tracker": "fuel",
  "diesel-gasoline-margins": "fuel",
  "anp-prices": "fuel",
  "anp-glp": "fuel",
  "imports-exports": "fuel",
  "navios-diesel": "fuel",
};

// ── Glyph dispatcher ─────────────────────────────────────────────────────────

/**
 * Returns the SVG glyph for a given dashboard slug at the requested size.
 *
 * Delegates to the shared `getModuleIcon` registry in `@/data/moduleIcons`
 * so mobile and desktop render the SAME glyph for each dashboard. Stroke
 * width is tuned to 2 (matching desktop ModuleGallery's call site) to keep
 * the visual weight identical.
 */
export function getTileIcon(slug: string, size: number): ReactNode {
  return getModuleIcon(slug, size, 2);
}

/**
 * Returns the full tile-meta payload for a given dashboard slug.
 *
 * @param slug      Dashboard slug (matches `HomeCardDef.slug`).
 * @param variant   "default" → 26px glyph (tile is 88px tall); "compact" →
 *                  20px glyph (tile is 56px tall, used by Last-visited row).
 * @param category  Optional category override. If omitted, falls back to
 *                  `SLUG_CATEGORY` lookup; if that also misses, defaults to
 *                  "fuel" so the gallery never crashes.
 *
 * The returned `tintBg` / `tintFg` mirror the desktop `iconTile` treatment
 * exactly: soft 10% tint of the category accent as background, saturated
 * AA-on-white category text colour as the glyph foreground.
 */
export function getTileMeta(
  slug: string,
  variant: "default" | "compact" = "default",
  category?: TileCategory,
): TileMeta {
  const cat: TileCategory = category ?? SLUG_CATEGORY[slug] ?? "fuel";
  const tint = CATEGORY_TINTS[cat];
  return {
    icon: getTileIcon(slug, variant === "compact" ? 20 : 26),
    compactIcon: getTileIcon(slug, 20),
    tintBg: tint.tile,
    tintFg: tint.accentText,
    mobileLabel: MOBILE_LABEL_OVERRIDES[slug],
  };
}

/**
 * @deprecated Kept for reference; not consumed anymore. The per-slug palette
 * was replaced by per-category tints in Onda 5.2 to match desktop parity.
 * If you need the old saturated-square look, read from this map directly.
 */
export const TILE_PALETTE_LEGACY: Record<string, { tintBg: string; tintFg?: string }> = {
  "well-by-well": { tintBg: "#0c4a6e" },
  "anp-cdp": { tintBg: "#475569" },
  "anp-cdp-bsw": { tintBg: "#0891b2" },
  "anp-cdp-depletion": { tintBg: "#7c3aed" },
  "anp-cdp-diaria": { tintBg: "#4f46e5" },
  "market-share": { tintBg: "#059669" },
  "price-bands": { tintBg: "#0284c7" },
  "subsidy-tracker": { tintBg: "#d97706" },
  "diesel-gasoline-margins": { tintBg: "#ff5000" },
  "anp-prices": { tintBg: "#e11d48" },
  "anp-glp": { tintBg: "#0e7490" },
  "imports-exports": { tintBg: "#9333ea" },
  "navios-diesel": { tintBg: "#1e3a8a" },
};

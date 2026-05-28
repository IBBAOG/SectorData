// Tile palette + icon mapping for the /home mobile gallery.
//
// Onda 5 of the mobile reform (2026-05-28). The /home mobile grid renders
// each dashboard as a Liquid Glass tile (`MobileHomeIconTile`) with a tinted
// squircle icon badge. To keep the palette consistent and avoid view-level
// hex hard-coding, this module is the single source of truth for:
//
//   • which background tint the icon badge uses (`tintBg`);
//   • which foreground colour the glyph itself uses (`tintFg`, default white).
//
// The glyph itself (the SVG inside the badge) comes from the shared
// `@/data/moduleIcons` registry — the SAME source the desktop NavBar / Home
// ModuleGallery consume — so a given dashboard's icon is visually identical
// in both views. Only the tinted squircle frame is mobile-specific.
//
// The /home mobile view imports `getTileMeta(slug)` and renders the resulting
// `{ icon, tintBg, tintFg }` triplet into `MobileHomeIconTile`. No tile-level
// styling lives in the view; if you need to tweak a colour or swap a glyph,
// edit this file.
//
// Palette taxonomy:
//   • Oil & Gas tiles lean petroleum/earth tones (slate, teal, indigo, navy,
//     purple) to evoke geology/exploration depth.
//   • Fuel Distribution tiles lean commercial tones (emerald, sky, amber,
//     orange, rose, cyan, violet, navy) to evoke trade/markets.
//   • Brand orange (#ff5000) is reserved for /diesel-gasoline-margins —
//     the fuel-pump dashboard that most directly evokes our brand metaphor.
//
// Why not CSS variables for these tints:
//   Each tile background is unique and one-off; introducing 13 new CSS
//   variables (--tile-bg-anp-cdp, etc.) for values that aren't reused
//   elsewhere is more drift surface than help. The single Record<> below
//   is the contract.

import type { ReactNode } from "react";
import { getModuleIcon } from "@/data/moduleIcons";

export interface TileMeta {
  /** Pre-rendered SVG glyph at the canonical 24×24 size. */
  icon: ReactNode;
  /** Compact-variant glyph rendered at 20×20 (used by Last-visited row). */
  compactIcon: ReactNode;
  /** Icon-badge background colour (CSS color). */
  tintBg: string;
  /** Icon foreground colour. Defaults to white. */
  tintFg: string;
}

// ── Palette: slug → { tintBg, tintFg } ──────────────────────────────────────
//
// Onda 5.1 (2026-05-28): the glyph itself is no longer a custom mobile-only
// SVG — it now comes from `@/data/moduleIcons` (`getModuleIcon`), the same
// registry used by the desktop NavBar/Home ModuleGallery, so that a given
// dashboard's icon is visually identical across views. Only the tinted
// squircle frame (background + foreground colour) remains mobile-specific.

interface TilePaletteEntry {
  tintBg: string;
  tintFg?: string;
}

export const TILE_PALETTE: Record<string, TilePaletteEntry> = {
  // Oil & Gas
  "well-by-well": { tintBg: "#0c4a6e" }, // deep petroleum blue
  "anp-cdp": { tintBg: "#475569" }, // slate
  "anp-cdp-bsw": { tintBg: "#0891b2" }, // teal
  "anp-cdp-depletion": { tintBg: "#7c3aed" }, // purple
  "anp-cdp-diaria": { tintBg: "#4f46e5" }, // indigo
  // Fuel Distribution
  "market-share": { tintBg: "#059669" }, // emerald
  "price-bands": { tintBg: "#0284c7" }, // sky
  "subsidy-tracker": { tintBg: "#d97706" }, // amber
  "diesel-gasoline-margins": { tintBg: "#ff5000" }, // brand orange (fuel)
  "anp-prices": { tintBg: "#e11d48" }, // rose
  "anp-glp": { tintBg: "#0e7490" }, // cyan
  "imports-exports": { tintBg: "#9333ea" }, // violet
  "navios-diesel": { tintBg: "#1e3a8a" }, // navy
};

// ── Glyph dispatcher ─────────────────────────────────────────────────────────

/**
 * Returns the SVG glyph for a given dashboard slug at the requested size.
 *
 * Onda 5.1 (2026-05-28): delegates to the shared `getModuleIcon` registry in
 * `@/data/moduleIcons` so mobile and desktop render the SAME glyph for each
 * dashboard. Stroke width is tuned to 1.75 to read well at the 22-26px sizes
 * used inside the tinted squircle badge.
 */
export function getTileIcon(slug: string, size: number): ReactNode {
  return getModuleIcon(slug, size, 1.75);
}

/**
 * Returns the full tile-meta payload for a given dashboard slug.
 *
 * @param slug      Dashboard slug (matches `HomeCardDef.slug`).
 * @param variant   "default" → 26px glyph (tile is 88px tall); "compact" →
 *                  20px glyph (tile is 56px tall, used by Last-visited row).
 *
 * Unknown slugs fall back to a neutral grey background + the generic
 * apps-grid fallback glyph from `getModuleIcon` so the gallery never crashes.
 */
export function getTileMeta(
  slug: string,
  variant: "default" | "compact" = "default",
): TileMeta {
  const entry = TILE_PALETTE[slug];
  const tintBg = entry?.tintBg ?? "#64748b";
  const tintFg = entry?.tintFg ?? "#ffffff";
  return {
    icon: getTileIcon(slug, variant === "compact" ? 20 : 26),
    compactIcon: getTileIcon(slug, 20),
    tintBg,
    tintFg,
  };
}

// Tile palette + icon mapping for the /home mobile gallery.
//
// Onda 5 of the mobile reform (2026-05-28). The /home mobile grid renders
// each dashboard as a Liquid Glass tile (`MobileHomeIconTile`) with a tinted
// squircle icon badge. To keep the palette consistent and avoid view-level
// hex hard-coding, this module is the single source of truth for:
//
//   • which icon glyph maps to which dashboard slug (`iconKey`);
//   • which background tint the icon badge uses (`tintBg`);
//   • which foreground colour the glyph itself uses (`tintFg`, default white).
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
import {
  CalendarDayIcon,
  ChartBandsIcon,
  GasCylinderIcon,
  GaugeIcon,
  GlobeArrowsIcon,
  GranularDataIcon,
  HourglassIcon,
  PieChartIcon,
  PriceTagIcon,
  PumpJackIcon,
  ReceiptIcon,
  ShipIcon,
  WaterDropIcon,
} from "./icons";

export interface TileMeta {
  /** Identity key — used internally to swap glyphs. */
  iconKey: string;
  /** Pre-rendered SVG glyph at the canonical 24×24 size. */
  icon: ReactNode;
  /** Compact-variant glyph rendered at 20×20 (used by Last-visited row). */
  compactIcon: ReactNode;
  /** Icon-badge background colour (CSS color). */
  tintBg: string;
  /** Icon foreground colour. Defaults to white. */
  tintFg: string;
}

// ── Palette: slug → { iconKey, tintBg, tintFg } ─────────────────────────────

interface TilePaletteEntry {
  iconKey: string;
  tintBg: string;
  tintFg?: string;
}

export const TILE_PALETTE: Record<string, TilePaletteEntry> = {
  // Oil & Gas
  "well-by-well": { iconKey: "pump-jack", tintBg: "#0c4a6e" }, // deep petroleum blue
  "anp-cdp": { iconKey: "granular-data", tintBg: "#475569" }, // slate
  "anp-cdp-bsw": { iconKey: "water-drop", tintBg: "#0891b2" }, // teal
  "anp-cdp-depletion": { iconKey: "hourglass", tintBg: "#7c3aed" }, // purple
  "anp-cdp-diaria": { iconKey: "calendar-day", tintBg: "#4f46e5" }, // indigo
  // Fuel Distribution
  "market-share": { iconKey: "pie-chart", tintBg: "#059669" }, // emerald
  "price-bands": { iconKey: "chart-bands", tintBg: "#0284c7" }, // sky
  "subsidy-tracker": { iconKey: "receipt", tintBg: "#d97706" }, // amber
  "diesel-gasoline-margins": { iconKey: "gauge", tintBg: "#ff5000" }, // brand orange (fuel)
  "anp-prices": { iconKey: "price-tag", tintBg: "#e11d48" }, // rose
  "anp-glp": { iconKey: "gas-cylinder", tintBg: "#0e7490" }, // cyan
  "imports-exports": { iconKey: "globe-arrows", tintBg: "#9333ea" }, // violet
  "navios-diesel": { iconKey: "ship", tintBg: "#1e3a8a" }, // navy
};

// ── Glyph dispatcher ─────────────────────────────────────────────────────────

/**
 * Returns the SVG glyph component for a given iconKey at the requested size.
 * Falls back to the granular-data icon for unknown keys (defence in depth —
 * this should never happen because all 13 slugs in the /home grid are mapped
 * above, but keeps the View from crashing on a typo).
 */
export function getTileIcon(iconKey: string, size: number): ReactNode {
  const strokeWidth = 1.75;
  switch (iconKey) {
    case "pump-jack":
      return <PumpJackIcon size={size} strokeWidth={strokeWidth} />;
    case "granular-data":
      return <GranularDataIcon size={size} strokeWidth={strokeWidth} />;
    case "water-drop":
      return <WaterDropIcon size={size} strokeWidth={strokeWidth} />;
    case "hourglass":
      return <HourglassIcon size={size} strokeWidth={strokeWidth} />;
    case "calendar-day":
      return <CalendarDayIcon size={size} strokeWidth={strokeWidth} />;
    case "pie-chart":
      return <PieChartIcon size={size} strokeWidth={strokeWidth} />;
    case "chart-bands":
      return <ChartBandsIcon size={size} strokeWidth={strokeWidth} />;
    case "receipt":
      return <ReceiptIcon size={size} strokeWidth={strokeWidth} />;
    case "gauge":
      return <GaugeIcon size={size} strokeWidth={strokeWidth} />;
    case "price-tag":
      return <PriceTagIcon size={size} strokeWidth={strokeWidth} />;
    case "gas-cylinder":
      return <GasCylinderIcon size={size} strokeWidth={strokeWidth} />;
    case "globe-arrows":
      return <GlobeArrowsIcon size={size} strokeWidth={strokeWidth} />;
    case "ship":
      return <ShipIcon size={size} strokeWidth={strokeWidth} />;
    default:
      // Unknown slug — fall back to the generic "data" glyph so the tile
      // still renders rather than crashing.
      return <GranularDataIcon size={size} strokeWidth={strokeWidth} />;
  }
}

/**
 * Returns the full tile-meta payload for a given dashboard slug.
 *
 * @param slug      Dashboard slug (matches `HomeCardDef.slug`).
 * @param variant   "default" → 24px glyph (tile is 88px tall); "compact" →
 *                  20px glyph (tile is 56px tall, used by Last-visited row).
 *
 * Unknown slugs fall back to a neutral grey + the generic granular-data
 * glyph so the gallery never crashes — but in practice every slug in the
 * /home grid is in TILE_PALETTE.
 */
export function getTileMeta(
  slug: string,
  variant: "default" | "compact" = "default",
): TileMeta {
  const entry = TILE_PALETTE[slug];
  const iconKey = entry?.iconKey ?? "granular-data";
  const tintBg = entry?.tintBg ?? "#64748b";
  const tintFg = entry?.tintFg ?? "#ffffff";
  return {
    iconKey,
    icon: getTileIcon(iconKey, variant === "compact" ? 20 : 26),
    compactIcon: getTileIcon(iconKey, 20),
    tintBg,
    tintFg,
  };
}

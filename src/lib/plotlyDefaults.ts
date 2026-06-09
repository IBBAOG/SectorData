// Shared Plotly defaults for dashboard charts.
//
// Keeps visual identity consistent across pages: white canvas, Arial font,
// hover label style, axis line color/width, brand orange.
//
// Usage:
//   import {
//     COMMON_LAYOUT, AXIS_LINE, emptyPlot, BRAND_ORANGE, PALETTE,
//     PRODUCT_COLORS, COUNTRY_COLORS, REGION_COLORS, SEGMENT_COLORS,
//     COMPANY_COLORS,
//   } from "@/lib/plotlyDefaults";
//
// For chart series assignment, prefer the central assigner in
// src/lib/charts/colors.ts (assignSeriesColors / applyStackedLegendOrder),
// which guarantees no two series share a color and that the legend order
// matches the stack order. The runtime lock src/lib/charts/validateTraces.ts
// enforces both invariants (dev: throw; prod: auto-correct + console.error).
//
// Color policy (2026-05-28 audit — CTO directive "no white in any chart"):
//   - No chart series uses #ffffff / #fff / 'white' as a trace, marker, line,
//     or fillcolor. White is only allowed as paper/plot background (Plotly
//     standard) and as in-bar TEXT against dark fills where dark text would
//     be illegible.
//   - BRAND_ORANGE (#ff5000) is reserved for HIGHLIGHTS — active pills,
//     button bg, leader-trace pattern (first selected field in BSW /
//     anp-cdp-diaria). It is NOT a "product color" or "country color".
//     The PALETTE keeps it at position 1 because PALETTE rotation assigns
//     pos 1 to the FIRST entity (leader of the chart), which is by
//     definition the highlight.
//   - For stable per-entity coloring (same product / country / region in
//     all dashboards) use the canonical maps below — never the PALETTE
//     rotation, never inline hex.

import type { Layout, PlotData } from "plotly.js";

export const BRAND_ORANGE = "#ff5000";

// 14-color palette used by multi-series dashboards (anp-cdp-bsw,
// anp-cdp-depletion, imports-exports panels without canonical mapping).
// 3 highlight colors at positions 1-3 (consumed first), 11 fallback colors.
// Consumers index positionally via `PALETTE[i % PALETTE.length]`.
//
// 2026-05-28 audit: all white / near-white / near-yellow positions removed.
//   - Pos  4: '#FFFFFF' → '#0EA5E9' (sky blue) so 4-series charts stay visible.
//   - Pos  9: '#D2FF00' → '#0F766E' (teal) — near-yellow was unreadable on white.
//   - Pos 11: '#FFFF99' → '#D97706' (amber) — pale yellow blends with white.
//   - Pos 12: '#F2F2F2' → '#52525B' (slate) — near-white grey blends with bg.
//   - Pos 13: '#D8D8D8' → '#BE185D' (magenta) — light grey blends with bg.
export const PALETTE = [
  // Highlight tier — first 3 positions, consumed first
  "#FF5000",  // 1. Primary highlight (brand orange — leader of the chart)
  "#FFAE66",  // 2. Secondary highlight (light peach)
  "#000512",  // 3. Tertiary highlight (near-black with nuance navy)
  // Fallback tier — only when highlight tier exhausted
  "#0EA5E9",  // 4. Sky blue   (replaces previous #FFFFFF white — 2026-05-28)
  "#000000",  // 5. Black
  "#1D4080",  // 6. Navy
  "#73C6A1",  // 7. Mint
  "#8258A0",  // 8. Purple
  "#0F766E",  // 9. Teal       (replaces previous #D2FF00 lime — 2026-05-28)
  "#7030A0",  // 10. Deep purple
  "#D97706",  // 11. Amber     (replaces previous #FFFF99 pale yellow — 2026-05-28)
  "#52525B",  // 12. Slate     (replaces previous #F2F2F2 near-white — 2026-05-28)
  "#BE185D",  // 13. Magenta   (replaces previous #D8D8D8 light grey — 2026-05-28)
  "#7F7F7F",  // 14. Mid grey
] as const;

// ─── Canonical entity-color maps ──────────────────────────────────────────────
//
// These pin specific business entities to a fixed color so the same product /
// country / region looks the same across every dashboard that renders it.
// Each map should be consulted BEFORE falling back to PALETTE rotation.
//
// Rule: an entity that appears in a chart must use its canonical color when
// one exists. Inline hex literals for products / countries / regions are
// banned in chart code (the audit will catch them).

/** Per-product canonical color. Used by /imports-exports (filter implicit),
 *  /diesel-gasoline-margins (Diesel / Gasoline line traces), /market-share
 *  (Big-3 vs Others mode), and any future product-level dashboard. */
export const PRODUCT_COLORS: Record<string, string> = {
  Diesel:        "#1D4080",  // navy — like diesel oil
  "Diesel B":    "#1D4080",
  "Diesel S10":  "#1D4080",
  Gasoline:      "#0F766E",  // teal — green tinge for gasoline
  "Gasoline C":  "#0F766E",
  "Gasolina C":  "#0F766E",
  "Crude Oil":   "#1f2937",  // dark slate — like crude
  Ethanol:       "#73C6A1",  // mint — clean biofuel
  "Etanol Hidratado": "#73C6A1",
  "Hydrous Ethanol":   "#73C6A1",
  "An. Ethanol": "#73C6A1",
  Biodiesel:     "#0EA5E9",  // sky blue — bio-clean
  LPG:           "#8258A0",  // purple — distinct gas
  GLP:           "#8258A0",
  "Otto-Cycle":  "#A16207",  // bronze — composite product
};

/** Per-origin/destination canonical color. Used by /imports-exports
 *  (Panel A pinned imports + exports stacked when in pin set). Country
 *  names use the English label as rendered in the chart legend. */
export const COUNTRY_COLORS: Record<string, string> = {
  Russia:          "#000000",  // near-black slate
  "United States": "#1D4080",  // navy — Old Glory blue (was brand-orange; orange reserved for highlight)
  UAE:             "#73C6A1",  // mint — Emirati green tone
  Netherlands:     "#FFAE66",  // peach — close to Dutch orange without colliding with brand
  India:           "#8258A0",  // purple
  "Saudi Arabia":  "#0F766E",  // saudi green — saturated (was near-yellow lime)
  Norway:          "#0EA5E9",  // sky blue
  Argentina:       "#A16207",  // bronze
  Others:          "#7F7F7F",  // neutral mid grey
};

/** Per-region (Brazilian macroregions) canonical color. Used in any chart
 *  that breaks down by region (anp-glp, subsidy-tracker regional tooltips,
 *  anp-prices when granularity = regiao). */
export const REGION_COLORS: Record<string, string> = {
  N:             "#0F766E",  // teal
  Norte:         "#0F766E",
  NORTE:         "#0F766E",
  NE:            "#FFAE66",  // peach
  Nordeste:      "#FFAE66",
  NORDESTE:      "#FFAE66",
  CO:            "#A16207",  // bronze
  "Centro-Oeste": "#A16207",
  "CENTRO-OESTE": "#A16207",
  SE:            "#1D4080",  // navy
  Sudeste:       "#1D4080",
  SUDESTE:       "#1D4080",
  S:             "#8258A0",  // purple
  Sul:           "#8258A0",
  SUL:           "#8258A0",
};

/** Per-company canonical color — same fuel-distributor / oil company always
 *  gets the same color across EVERY dashboard that renders it (the By Importer
 *  panel of /imports-exports, market-share, future company-level charts).
 *
 *  Contract:
 *   - Every hex here MUST already exist in PALETTE (no inventing colors).
 *   - BRAND_ORANGE (#FF5000) is NEVER used to pin a recurring company — it is
 *     reserved for highlight/leader patterns only (see the color policy at the
 *     top of this file). That is why the leader of a chart is colored via the
 *     `leader` flag of assignSeriesColors, not via this map.
 *   - "Others" is grey (#7F7F7F, PALETTE pos 14) and is always rendered LAST by
 *     the central color assigner (src/lib/charts/colors.ts).
 *   - All companies must have DISTINCT colors so two series in the same chart
 *     can never collide (the runtime lock in src/lib/charts/validateTraces.ts
 *     enforces this; this map is the first line of defense).
 *
 *  Aliases (e.g. "Atem's", "Raizen") map to the same color as their canonical
 *  spelling so source-data label drift never breaks the pinning. */
export const COMPANY_COLORS: Record<string, string> = {
  Petrobras:   "#000000",  // black   (PALETTE pos 5)
  Vibra:       "#0F766E",  // teal    (PALETTE pos 9)
  Ipiranga:    "#1D4080",  // navy    (PALETTE pos 6)
  Raízen:      "#73C6A1",  // mint    (PALETTE pos 7)
  Raizen:      "#73C6A1",  // alias (no-tilde spelling sometimes in source data)
  Atem:        "#8258A0",  // purple  (PALETTE pos 8)
  "Atem's":    "#8258A0",  // alias (source data renders "Atem's")
  "Royal FIC": "#D97706",  // amber   (PALETTE pos 11) — replaces the old #D2FF00
                           //          lime that collided + was removed in the
                           //          2026-05-28 "no near-yellow" audit.
  "Royal Fic": "#D97706",  // alias (casing variant)
  Others:      "#7F7F7F",  // mid grey (PALETTE pos 14) — always last
};

/** Per-segment (sales-volumes / market-share segmentation) canonical color.
 *  Distribution stage of /anp-prices uses this; market-share's segment
 *  toggle picks from here. */
export const SEGMENT_COLORS: Record<string, string> = {
  Producer:      "#1D4080",  // navy — wholesale source
  Refinery:      "#1D4080",
  Distribution:  "#0F766E",  // teal — B2B
  Distributor:   "#0F766E",
  Retail:        "#73C6A1",  // mint — pump
  TRR:           "#A16207",  // bronze — Transporte Revendedor Retalhista
  Importer:      "#8258A0",  // purple
  Importador:    "#8258A0",
  Total:         "#000512",  // near-black — aggregate
};

export const COMMON_LAYOUT: Partial<Layout> = {
  paper_bgcolor: "white",
  plot_bgcolor:  "white",
  font: { family: "Arial", size: 12, color: "#000000" },
  hoverlabel: {
    bgcolor:     "rgba(255,255,255,0.95)",
    bordercolor: "rgba(180,180,180,0.5)",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    namelength: -1,
  },
};

export const AXIS_LINE = {
  showgrid: false,
  zeroline: false,
  showline: true,
  linecolor: "#000000",
  linewidth: 1,
};

// Empty-state placeholder used when a series has no data for the current filters.
export function emptyPlot(
  height = 300,
  message = "No data for the selected period.",
): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      ...COMMON_LAYOUT,
      height,
      margin: { t: 20, b: 30, l: 10, r: 10 },
      annotations: [{
        text: message,
        xref: "paper", yref: "paper",
        showarrow: false,
        font: { size: 13, family: "Arial", color: "#888" },
      }],
    },
  };
}

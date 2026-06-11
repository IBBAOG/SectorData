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
// Official brand palette (2026-06-10 — CTO/brand directive). CLOSED palette:
// no data-series color may exist outside the 15 official colors. The 12 series
// colors live in PALETTE below; the 3 pale tints live in BACKGROUND_TINTS.
//   - Leader doctrine: the positional leader (1st series) is #000512 Very Dark
//     Blue; #FF5000 Standard Orange is the legitimate 2nd series AND the opt-in
//     `leader: true` highlight color. Orange is NEVER pinned to a named entity.
//   - Others rule: the "Others" bucket is always #808080 Dark Grey and always
//     rendered LAST (in the stack AND the legend).
//   - Background tints (#E2F3EC / #CCDAFF / #E6DDEC) are for backgrounds, row
//     highlights, badges and area fills ONLY — never a chart trace.
//   - White is still banned as a trace/marker/line/fillcolor (only paper/plot
//     background + in-bar text against dark fills).
//   - #D2FF00 Yellow RETURNED to the series rotation by this directive,
//     superseding the 2026-05-28 "no near-yellow" ban (fine for bars; avoid as
//     thin lines for legibility).
//   - Canonical entity maps (PRODUCT/COUNTRY/REGION/SEGMENT/COMPANY_COLORS) pin
//     hex by NAME from the official palette — consult them BEFORE the PALETTE
//     rotation and never use inline hex in chart code.
//   - The explicit highlight pattern is distinct from the leader order: a chart
//     that lets the user pick one series to "pop" calls
//     assignSeriesColors(..., { leader: true }) to force that series to orange.
// Full reform history lives in git; this block is intentionally condensed.

import type { Layout, PlotData } from "plotly.js";

export const BRAND_ORANGE = "#ff5000";

// 12-color official series rotation. Consumers index positionally via
// `PALETTE[i % PALETTE.length]`; the central assigner (src/lib/charts/colors.ts)
// resolves canonical pins first, then walks this rotation collision-skipping.
// Order follows the brand's importance ranking, with #808080 reserved LAST as
// the canonical "Others" grey (never leaks into an ordinary series early).
export const PALETTE = [
  "#000512",  // 1.  Very Dark Blue — positional leader (1st series).
  "#FF5000",  // 2.  Standard Orange — legitimate 2nd series + opt-in highlight.
  "#FFAE66",  // 3.  Light Orange — 3rd series.
  "#FF800D",  // 4.  Orange — 4th series.
  "#73C6A1",  // 5.  Green — 5th series.
  "#7030A0",  // 6.  Purple — 6th series.
  "#094DFF",  // 7.  Blue — 7th series.
  "#D2FF00",  // 8.  Yellow — 8th series (legible on bars; avoid as thin lines).
  "#BF3F00",  // 9.  Brown — 9th series.
  "#BFBFBF",  // 10. Light Grey — 10th series.
  "#A6A6A6",  // 11. Grey — 11th series.
  "#808080",  // 12. Dark Grey — 12th series + canonical "Others"; always LAST.
] as const;

// Pale tints — backgrounds / row highlights / badges / area fills ONLY.
// NEVER a chart series (the closed palette forbids them as traces).
export const BACKGROUND_TINTS = ["#E2F3EC", "#CCDAFF", "#E6DDEC"] as const;

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
  Diesel:        "#094DFF",  // Blue
  "Diesel B":    "#094DFF",
  "Diesel S10":  "#094DFF",
  Gasoline:      "#FF800D",  // Orange
  "Gasoline C":  "#FF800D",
  "Gasolina C":  "#FF800D",
  "Crude Oil":   "#000512",  // Very Dark Blue — like crude
  Ethanol:       "#73C6A1",  // Green — clean biofuel
  "Etanol Hidratado": "#73C6A1",
  "Hydrous Ethanol":   "#73C6A1",
  "An. Ethanol": "#73C6A1",
  Biodiesel:     "#D2FF00",  // Yellow
  LPG:           "#7030A0",  // Purple — distinct gas
  GLP:           "#7030A0",
  "Otto-Cycle":  "#BF3F00",  // Brown — composite product
};

/** Per-origin/destination canonical color. Used by /imports-exports
 *  (Panel A pinned imports + exports stacked when in pin set). Country
 *  names use the English label as rendered in the chart legend. */
export const COUNTRY_COLORS: Record<string, string> = {
  Russia:          "#000512",  // Very Dark Blue
  "United States": "#094DFF",  // Blue — Old Glory blue (orange left unpinned for leader-order / highlight)
  UAE:             "#73C6A1",  // Green — Emirati green tone
  Netherlands:     "#FFAE66",  // Light Orange — close to Dutch orange without colliding with brand
  India:           "#7030A0",  // Purple
  "Saudi Arabia":  "#BF3F00",  // Brown
  Norway:          "#D2FF00",  // Yellow
  Argentina:       "#FF800D",  // Orange
  Others:          "#808080",  // Dark Grey — canonical Others
};

/** Per-region (Brazilian macroregions) canonical color. Used in any chart
 *  that breaks down by region (anp-glp, subsidy-tracker regional tooltips,
 *  anp-prices when granularity = regiao). */
export const REGION_COLORS: Record<string, string> = {
  N:             "#73C6A1",  // Green
  Norte:         "#73C6A1",
  NORTE:         "#73C6A1",
  NE:            "#FFAE66",  // Light Orange
  Nordeste:      "#FFAE66",
  NORDESTE:      "#FFAE66",
  CO:            "#BF3F00",  // Brown
  "Centro-Oeste": "#BF3F00",
  "CENTRO-OESTE": "#BF3F00",
  SE:            "#094DFF",  // Blue
  Sudeste:       "#094DFF",
  SUDESTE:       "#094DFF",
  S:             "#7030A0",  // Purple
  Sul:           "#7030A0",
  SUL:           "#7030A0",
};

/** Per-company canonical color — same fuel-distributor / oil company always
 *  gets the same color across EVERY dashboard that renders it (the By Importer
 *  panel of /imports-exports, market-share, future company-level charts).
 *
 *  Contract:
 *   - Every hex here MUST already exist in PALETTE (no inventing colors).
 *   - BRAND_ORANGE (#FF5000) is not used to pin a recurring company here — a
 *     fixed company would then steal the orange from any chart's leader-order
 *     2nd slot or from the `leader: true` highlight pattern. Keep company pins
 *     on the non-orange PALETTE members so orange stays available for those
 *     two roles (see the leader-order doctrine at the top of this file).
 *   - "Others" is grey (#808080, PALETTE pos 12) and is always rendered LAST by
 *     the central color assigner (src/lib/charts/colors.ts).
 *   - All companies must have DISTINCT colors so two series in the same chart
 *     can never collide (the runtime lock in src/lib/charts/validateTraces.ts
 *     enforces this; this map is the first line of defense).
 *
 *  Aliases (e.g. "Atem's", "Raizen") map to the same color as their canonical
 *  spelling so source-data label drift never breaks the pinning. */
export const COMPANY_COLORS: Record<string, string> = {
  Petrobras:   "#000512",  // Very Dark Blue
  Vibra:       "#73C6A1",  // Green
  Ipiranga:    "#094DFF",  // Blue
  Raízen:      "#BF3F00",  // Brown
  Raizen:      "#BF3F00",  // alias (no-tilde spelling sometimes in source data)
  Atem:        "#7030A0",  // Purple
  "Atem's":    "#7030A0",  // alias (source data renders "Atem's")
  "Royal FIC": "#FF800D",  // Orange — NOT #D2FF00 Yellow (a live vitest
                           //          assertion forbids Royal FIC/Atem == Yellow).
  "Royal Fic": "#FF800D",  // alias (casing variant)
  Others:      "#808080",  // Dark Grey — canonical Others, always last
};

/** Per-segment (sales-volumes / market-share segmentation) canonical color.
 *  Distribution stage of /anp-prices uses this; market-share's segment
 *  toggle picks from here. */
export const SEGMENT_COLORS: Record<string, string> = {
  Producer:      "#094DFF",  // Blue — wholesale source
  Refinery:      "#094DFF",
  Distribution:  "#73C6A1",  // Green — B2B
  Distributor:   "#73C6A1",
  Retail:        "#FFAE66",  // Light Orange — pump
  TRR:           "#BF3F00",  // Brown — Transporte Revendedor Retalhista
  Importer:      "#7030A0",  // Purple
  Importador:    "#7030A0",
  Total:         "#000512",  // Very Dark Blue — aggregate. Total now coincides
                             // with the positional leader; acceptable because
                             // Total never co-renders with a positional 1st series.
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

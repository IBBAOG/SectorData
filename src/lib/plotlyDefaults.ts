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
//   - For stable per-entity coloring (same product / country / region in
//     all dashboards) use the canonical maps below — never the PALETTE
//     rotation, never inline hex.
//
// Leader-order doctrine (2026-06-09 — CTO directive, supersedes the
// "orange = highlight only" rule):
//   - The PALETTE leads with navy → orange → mint (positions 1-2-3), the
//     stacked-bar palette of the Itaú BBA "Brazil — Oil Production" PDF
//     report (/well-by-well). Positional consumers (PALETTE[i % len]) now
//     lead with #1f2937 navy/slate, then #FF5000 orange, then #9bd9a9 mint.
//   - BRAND_ORANGE (#FF5000) is now a LEGITIMATE SERIES color: it is the
//     SECOND entry of the leader order and MAY fill the 2nd series of a
//     stacked/positional chart. It is no longer "highlight-only".
//   - The explicit highlight pattern still exists and is DISTINCT: a chart
//     that lets the user pick one series to "pop" calls
//     assignSeriesColors(..., { leader: true }), which forces the SELECTED
//     series to BRAND_ORANGE (BSW, anp-cdp-diaria). That is an additional,
//     opt-in use of orange — not the default. Default positional leader is
//     navy (#1f2937); `leader: true` highlight is orange. Both coexist.

import type { Layout, PlotData } from "plotly.js";

export const BRAND_ORANGE = "#ff5000";

// 14-color palette used by multi-series dashboards (anp-cdp-bsw,
// anp-cdp-depletion, imports-exports panels without canonical mapping).
// Positions 1-3 are the LEADER ORDER (navy → orange → mint), consumed first;
// positions 4-14 are the fallback tier. Consumers index positionally via
// `PALETTE[i % PALETTE.length]`. The 14 colors are mutually distinct and
// legible on a white canvas (no white / no near-white / no near-yellow).
//
// 2026-05-28 audit: all white / near-white / near-yellow positions removed.
//   - '#FFFFFF' white → '#0EA5E9' (sky blue) so 4-series charts stay visible.
//   - '#D2FF00' lime  → '#0F766E' (teal) — near-yellow was unreadable on white.
//   - '#FFFF99' pale  → '#D97706' (amber) — pale yellow blends with white.
//   - '#F2F2F2' near-white → '#52525B' (slate) — blended with bg.
//   - '#D8D8D8' light grey → '#BE185D' (magenta) — blended with bg.
//
// 2026-06-09 leader-order reorder (CTO directive — adopt the /well-by-well
// "Brazil — Oil Production" PDF palette as the global stacked/positional
// leader order):
//   - Pos 1: '#FF5000' orange  → '#1f2937' navy/slate. The navy is now the
//     leader; it is the EXACT hex used for Pre-Salt (dominant stack base) in
//     wellByWellColors.ts, so positional charts match the PDF report.
//   - Pos 2: '#FFAE66' peach   → '#FF5000' orange. Brand orange becomes a
//     legitimate 2nd series color (the report's Post-Salt fill).
//   - Pos 3: '#000512' near-black → '#9bd9a9' light mint. The mint is the
//     EXACT hex used for Onshore/Terra in wellByWellColors.ts.
//   - DROP '#000512' (former pos 3 near-black) — redundant against '#000000'
//     (pos 5) AND the new '#1f2937' leader; three near-blacks were
//     indistinguishable on a chart. SEGMENT_COLORS.Total keeps the '#000512'
//     literal (a non-PALETTE pin is allowed for a fixed entity).
//   - DROP '#7030A0' (former pos 10 deep purple) — near-duplicate of '#8258A0'
//     purple (pos 8); two adjacent purples were the weakest distinct pair, and
//     '#7030A0' is referenced by no canonical map.
//   - '#FFAE66' peach relocates to the fallback tier (pos 10); '#73C6A1'
//     medium mint stays at pos 7 (kept distinct from the lighter pastel
//     '#9bd9a9' at pos 3, and still pins Ethanol/UAE/Retail/Raízen).
//
// 2026-06-10 distinguishability reorder of the fallback tier (CTO directive —
// positions 1-3 leader order LOCKED, only positions 4-14 reordered):
//   - Motivation: positional consumers that filter orange (e.g.
//     /anp-cdp-diaria company view → COMPANY_FIELD_COLORS = PALETTE minus
//     orange) were taking positions 0,3,4 = #1f2937 slate, #000000 black,
//     #1D4080 navy on a ≤5-series chart — THREE near-identical darks in the
//     same chart (PRIO fields PEREGRINO / TUBARÃO MARTELO / POLVO were
//     indistinguishable). This is the same "two series, one color" class of
//     bug that triggered the whole color reform.
//   - Fix: front-load maximally distinct hues into positions 4-8 (sky blue →
//     purple → amber → magenta → teal) and push the redundant darks
//     (#000000 black, #1D4080 royal navy), the slate-grey #52525B and the 2nd
//     mint #73C6A1 (near the #9bd9a9 light mint of pos 3) to the tail (pos
//     10-13). Result: any chart with ≤7 series never picks two darks nor two
//     near-greens. #7F7F7F mid grey stays LAST (pos 14) — it is the canonical
//     "Others" color and must not leak into ordinary series early.
//   - All 14 colors stay DISTINCT (none dropped) — this is a pure reorder of
//     positions 4-13; positions 1-3 (leader order) and 14 (Others grey) fixed.
//   - Canonical maps (PRODUCT/COUNTRY/REGION/SEGMENT/COMPANY_COLORS) reference
//     hex by NAME, not by index — this reorder does not affect them.
export const PALETTE = [
  // Leader order — first 3 positions, consumed first (navy → orange → mint). LOCKED.
  "#1f2937",  // 1. Navy/slate — leader (Pre-Salt of the /well-by-well PDF).
  "#FF5000",  // 2. Brand orange — legitimate 2nd series (Post-Salt of the PDF).
  "#9bd9a9",  // 3. Light mint — 3rd series (Onshore/Terra of the PDF).
  // Fallback tier — only when the leader order is exhausted (≥4 series).
  // Reordered 2026-06-10 for max distinguishability: distinct hues first,
  // redundant darks/greys/2nd-mint pushed to the tail.
  "#0EA5E9",  // 4. Sky blue   (replaces previous #FFFFFF white — 2026-05-28)
  "#8258A0",  // 5. Purple     (front-loaded 2026-06-10 — distinct from leaders)
  "#D97706",  // 6. Amber      (replaces previous #FFFF99 pale yellow — 2026-05-28)
  "#BE185D",  // 7. Magenta    (replaces previous #D8D8D8 light grey — 2026-05-28)
  "#0F766E",  // 8. Teal       (replaces previous #D2FF00 lime — 2026-05-28)
  "#FFAE66",  // 9. Peach      (warm, near brand orange — kept off the front)
  "#000000",  // 10. Black     (pushed to tail 2026-06-10 — avoid clustered darks)
  "#1D4080",  // 11. Royal navy (pushed to tail 2026-06-10 — distinct from #1f2937 slate)
  "#52525B",  // 12. Slate-grey (replaces previous #F2F2F2 near-white — 2026-05-28)
  "#73C6A1",  // 13. Medium mint (pushed to tail 2026-06-10 — near the #9bd9a9 light mint of pos 3)
  "#7F7F7F",  // 14. Mid grey — canonical "Others"; always LAST, never leaks into series early.
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
  "United States": "#1D4080",  // navy — Old Glory blue (was brand-orange; orange left unpinned for leader-order / highlight)
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
 *   - BRAND_ORANGE (#FF5000) is not used to pin a recurring company here — a
 *     fixed company would then steal the orange from any chart's leader-order
 *     2nd slot or from the `leader: true` highlight pattern. Keep company pins
 *     on the non-orange PALETTE members so orange stays available for those
 *     two roles (see the leader-order doctrine at the top of this file).
 *   - "Others" is grey (#7F7F7F, PALETTE pos 14) and is always rendered LAST by
 *     the central color assigner (src/lib/charts/colors.ts).
 *   - All companies must have DISTINCT colors so two series in the same chart
 *     can never collide (the runtime lock in src/lib/charts/validateTraces.ts
 *     enforces this; this map is the first line of defense).
 *
 *  Aliases (e.g. "Atem's", "Raizen") map to the same color as their canonical
 *  spelling so source-data label drift never breaks the pinning. */
export const COMPANY_COLORS: Record<string, string> = {
  Petrobras:   "#000000",  // black   (PALETTE pos 10)
  Vibra:       "#0F766E",  // teal    (PALETTE pos 8)
  Ipiranga:    "#1D4080",  // royal navy (PALETTE pos 11)
  Raízen:      "#73C6A1",  // medium mint (PALETTE pos 13)
  Raizen:      "#73C6A1",  // alias (no-tilde spelling sometimes in source data)
  Atem:        "#8258A0",  // purple  (PALETTE pos 5)
  "Atem's":    "#8258A0",  // alias (source data renders "Atem's")
  "Royal FIC": "#D97706",  // amber   (PALETTE pos 6) — replaces the old #D2FF00
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

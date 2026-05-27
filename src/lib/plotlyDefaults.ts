// Shared Plotly defaults for dashboard charts.
//
// Keeps visual identity consistent across pages: white canvas, Arial font,
// hover label style, axis line color/width, brand orange.
//
// Usage:
//   import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, BRAND_ORANGE, PALETTE } from "@/lib/plotlyDefaults";

import type { Layout, PlotData } from "plotly.js";

export const BRAND_ORANGE = "#ff5000";

// 14-color palette used by multi-series dashboards (imports-exports, anp-cdp-bsw, market-share, etc.).
// CTO-specified spec (2026-05-27): 3 highlight colors consumed first, 11 fallback colors thereafter.
// Consumers index positionally via `PALETTE[i % PALETTE.length]`.
export const PALETTE = [
  // Highlight tier — first 3 positions, consumed first
  "#FF5000",  // 1. Primary highlight (brand orange)
  "#FFAE66",  // 2. Secondary highlight
  "#000512",  // 3. Tertiary highlight
  // Fallback tier — only when highlight tier exhausted
  "#FFFFFF",  // 4
  "#000000",  // 5
  "#1D4080",  // 6
  "#73C6A1",  // 7
  "#8258A0",  // 8
  "#D2FF00",  // 9
  "#7030A0",  // 10
  "#FFFF99",  // 11
  "#F2F2F2",  // 12
  "#D8D8D8",  // 13
  "#7F7F7F",  // 14
] as const;

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

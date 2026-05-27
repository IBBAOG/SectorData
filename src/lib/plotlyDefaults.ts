// Shared Plotly defaults for dashboard charts.
//
// Keeps visual identity consistent across pages: white canvas, Arial font,
// hover label style, axis line color/width, brand orange.
//
// Usage:
//   import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, BRAND_ORANGE, PALETTE } from "@/lib/plotlyDefaults";

import type { Layout, PlotData } from "plotly.js";

export const BRAND_ORANGE = "#ff5000";

// 16-color narrative palette used by multi-series dashboards (imports-exports, anp-cdp-bsw, market-share, etc.)
// Positions 1-6 mirror the executive-presentation reference (black, brand orange, mint, beige, purple, yellow).
// Positions 7-16 are coordinated desaturated extensions for dashboards needing >7 series.
export const PALETTE = [
  "#1a1a1a",  // 1. Black
  "#ff5000",  // 2. Brand Orange (unchanged)
  "#a8d5a3",  // 3. Mint Green
  "#d9c79a",  // 4. Beige / Cream
  "#7d4ea3",  // 5. Purple
  "#f5d05e",  // 6. Yellow
  "#5b7fa0",  // 7. Steel Blue
  "#b85c3a",  // 8. Rust / Brick
  "#6e8f6c",  // 9. Sage Green
  "#b89968",  // 10. Camel / Tan
  "#5d3a6e",  // 11. Plum
  "#c9a644",  // 12. Mustard
  "#3d4a5c",  // 13. Slate
  "#8a8c4a",  // 14. Olive
  "#a85c3a",  // 15. Burnt Sienna
  "#9a7a8a",  // 16. Dusty Mauve
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

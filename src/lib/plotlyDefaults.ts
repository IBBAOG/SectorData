// Shared Plotly defaults for dashboard charts.
//
// Keeps visual identity consistent across pages: white canvas, Arial font,
// hover label style, axis line color/width, brand orange.
//
// Usage:
//   import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, BRAND_ORANGE, PALETTE } from "@/lib/plotlyDefaults";

import type { Layout, PlotData } from "plotly.js";

export const BRAND_ORANGE = "#ff5000";

// 16-color palette used by sindicom, anp-painel-importacoes, etc.
export const PALETTE = [
  "#1E88E5", "#FF5000", "#43A047", "#FB8C00", "#8E24AA",
  "#00ACC1", "#D81B60", "#6D4C41", "#F4511E", "#039BE5",
  "#7CB342", "#FFB300", "#546E7A", "#AB47BC", "#26A69A",
  "#EC407A",
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
  message = "Sem dados para o período selecionado.",
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

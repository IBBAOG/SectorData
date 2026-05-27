// Shared Plotly chart builders for BSW (water cut) dashboards.
//
// Consumed by:
//   • src/app/(dashboard)/anp-cdp-bsw/useAnpCdpBswData.ts
//   • (future) /well-by-well drill-down popup — BSW tab
//
// Exports:
//   buildPerWellChart        — one trace per well, X = months since first production
//   buildFieldAverageChart   — one trace per field (volume-weighted), X = % VOIP recovered
//   plotlyMode               — maps LineStyle toggle value to Plotly mode string
//   AnpCdpBswPoint           — re-export from rpc.ts (consumers import from here)
//   AnpCdpBswFieldPoint      — re-export from rpc.ts (consumers import from here)

import type { Layout, PlotData } from "plotly.js";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "@/lib/plotlyDefaults";
import { bblDiaToKbpd } from "@/lib/units";
import type { AnpCdpBswPoint, AnpCdpBswFieldPoint } from "@/lib/rpc";

// Re-export types so consumers can import everything from one place.
export type { AnpCdpBswPoint, AnpCdpBswFieldPoint } from "@/lib/rpc";

export type LineStyle = "markers" | "markers+lines";

// Maps the Plot-style toggle value to Plotly's `mode` string.
export const plotlyMode = (style: LineStyle): "markers" | "lines+markers" =>
  style === "markers" ? "markers" : "lines+markers";

/**
 * Build the per-well BSW scatter chart.
 *
 * X axis: months since first production for that well (linear, tozero).
 * Y axis: BSW water cut (0..1, formatted as %).
 * One trace per unique well, colored by position in the PALETTE.
 * Renderer: scattergl (WebGL) for large point counts (~500k cap server-side).
 */
export function buildPerWellChart(
  wellPoints: AnpCdpBswPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select a field to plot BSW evolution.");
  }
  if (!wellPoints.length) {
    return emptyPlot(460, "No data for the selected field.");
  }

  // Per-well mode: one trace per unique poco (first-appearance order so colors
  // stay stable between renders).
  const seen: string[] = [];
  for (const p of wellPoints) {
    if (!seen.includes(p.poco)) seen.push(p.poco);
  }
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = seen.map((poco, i) => {
    const subset = wellPoints.filter((p) => p.poco === poco);
    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scattergl",
      mode,
      name: poco,
      x: subset.map((p) => p.mes_desde_t0),
      y: subset.map((p) => p.bsw),
      customdata: subset.map((p) => [p.poco, p.ano, p.mes] as [string, number, number]),
      marker: { size: 4, opacity: 0.7, color },
      line: { color, width: 1 },
      hovertemplate:
        "<b>%{customdata[0]}</b><br>" +
        "Reference month: %{customdata[1]}-%{customdata[2]:02d}<br>" +
        "BSW: %{y:.1%}<br>" +
        "Months since start: %{x}" +
        "<extra></extra>",
    } as unknown as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 70, r: 30 },
      xaxis: {
        ...AXIS_LINE,
        title: { text: "Months since first production" },
        rangemode: "tozero",
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "BSW (water cut)" },
        rangemode: "tozero",
        tickformat: ",.0%",
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
        itemsizing: "constant",
      },
      hovermode: "closest",
    },
  };
}

/**
 * Build the field-average BSW chart.
 *
 * X axis: % of VOIP recovered (cumulative oil / VOIP), formatted as %.
 * Y axis: BSW water cut (volume-weighted, 0..1, formatted as %).
 * One trace per selected campo. Renderer: scatter (SVG — low volume, crisp lines).
 */
export function buildFieldAverageChart(
  fieldPoints: AnpCdpBswFieldPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select one or more fields to plot BSW evolution.");
  }
  if (!fieldPoints.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  // One trace per campo (volume-weighted average across wells at each calendar
  // month). X axis is % of VOIP recovered (cumulative oil / VOIP). One trace
  // per selected campo (even empty subsets) so the legend matches sidebar
  // chips 1:1.
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    const subset = fieldPoints
      .filter((p) => p.campo === campo)
      .sort((a, b) => a.pct_voip - b.pct_voip);
    const color = PALETTE[i % PALETTE.length];
    if (typeof window !== "undefined" && fieldPoints.length > 0 && subset.length === 0) {
      // Only warn when we actually received points but none for this campo.
      // eslint-disable-next-line no-console
      console.warn(
        `[anp-cdp-bsw] field "${campo}" is selected but has no points in the RPC result; rendering empty trace.`,
      );
    }
    return {
      type: "scatter",
      mode,
      name: campo,
      x: subset.map((p) => p.pct_voip),
      y: subset.map((p) => p.bsw),
      customdata: subset.map(
        (p) =>
          [p.n_pocos, bblDiaToKbpd(p.volume_total), p.ref_ano, p.ref_mes, p.cumulative_oil_bbl] as [
            number,
            number,
            number,
            number,
            number,
          ],
      ),
      line: { color, width: 2 },
      marker: { size: 6, color },
      hovertemplate:
        "<b>" + campo + "</b><br>" +
        "Reference month: %{customdata[2]}-%{customdata[3]:02d}<br>" +
        "VOIP recovered: %{x:.1%}<br>" +
        "BSW: %{y:.1%}<br>" +
        "Cumulative oil: %{customdata[4]:,.0f} bbl<br>" +
        "Wells active: %{customdata[0]}<br>" +
        "Daily volume: %{customdata[1]:,.1f} kbpd" +
        "<extra></extra>",
    } as unknown as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 70, r: 30 },
      xaxis: {
        ...AXIS_LINE,
        title: { text: "% of VOIP recovered" },
        tickformat: ",.1%",
        rangemode: "tozero",
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "BSW (water cut, volume-weighted)" },
        rangemode: "tozero",
        tickformat: ",.0%",
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
      },
      hovermode: "closest",
    },
  };
}

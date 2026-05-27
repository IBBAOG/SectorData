/**
 * Shared Plotly chart builders for the ANP CDP Depletion analysis.
 *
 * Extracted from src/app/(dashboard)/anp-cdp-depletion/desktop/View.tsx so
 * the same builders can be consumed by /well-by-well drill-down popups without
 * duplicating ~150 lines of trace + layout logic.
 *
 * Consumers:
 *   - src/app/(dashboard)/anp-cdp-depletion/desktop/View.tsx  (primary)
 *   - src/app/(dashboard)/well-by-well/ (upcoming drill-down popup)
 *
 * Color semantics (INVERSE of /anp-cdp-bsw):
 *   NP rising = good (green), NP falling = depletion (red).
 *   BSW is the opposite — falling water-cut is good.
 */

import type { Layout, PlotData } from "plotly.js";

import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "@/lib/plotlyDefaults";
import type { AnpCdpDepletionPoint, AnpCdpDepletionFieldPoint } from "@/lib/rpc";
import { rollingDepletion, ymSort } from "@/app/(dashboard)/anp-cdp-depletion/useAnpCdpDepletionData";

// Re-export the data types so callers don't need a third import path.
export type { AnpCdpDepletionPoint, AnpCdpDepletionFieldPoint } from "@/lib/rpc";

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Map the UI LineStyle toggle to Plotly's `mode` string. */
type LineStyle = "markers" | "markers+lines";
type XMode = "calendar" | "voip";

function plotlyMode(style: LineStyle): "markers" | "lines+markers" {
  return style === "markers" ? "markers" : "lines+markers";
}

// ── Per-well chart builder (uses scattergl / WebGL for large datasets) ─────────

/**
 * Build a rolling-depletion Plotly chart for the Per-well view.
 *
 * Returns `{ data: PlotData[]; layout: Partial<Layout> }` ready to pass to
 * `<PlotlyChart data={...} layout={...} />`.
 *
 * @param wellPoints   - Points returned by `get_anp_cdp_depletion_scatter`.
 * @param selectedCampos - Campos currently selected in the filter.
 * @param lineStyle    - "markers" | "markers+lines".
 * @param xMode        - "calendar" | "voip".
 * @param recentMonths - Size of the recent window (N, 1–60).
 * @param priorMonths  - Size of the prior window (M, 1–60).
 */
export function buildPerWellChart(
  wellPoints: AnpCdpDepletionPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select a field to plot rolling depletion.");
  }
  if (!wellPoints.length) {
    return emptyPlot(460, "No data for the selected field.");
  }

  // Collect unique wells in first-appearance order (preserves legend order).
  const seen: string[] = [];
  for (const p of wellPoints) {
    if (!seen.includes(p.poco)) seen.push(p.poco);
  }
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = seen.map((poco, i) => {
    const fullSeries = wellPoints
      .filter((p) => p.poco === poco)
      .sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));

    const depletionByYm = new Map<number, number>();
    for (const d of rollingDepletion(
      fullSeries.map((p) => ({ ano: p.ano, mes: p.mes, np: p.np_kbpd })),
      recentMonths,
      priorMonths,
    )) {
      depletionByYm.set(ymSort(d.ano, d.mes), d.depletion);
    }

    const renderedPoints = fullSeries
      .map((p) => {
        const dep = depletionByYm.get(ymSort(p.ano, p.mes));
        if (dep === undefined) return null;
        if (xMode === "voip" && (p.pct_voip_poco === null || !Number.isFinite(p.pct_voip_poco))) {
          return null;
        }
        return { p, dep };
      })
      .filter((x): x is { p: AnpCdpDepletionPoint; dep: number } => x !== null);

    const subset =
      xMode === "voip"
        ? renderedPoints.slice().sort(
            (a, b) => (a.p.pct_voip_poco ?? 0) - (b.p.pct_voip_poco ?? 0),
          )
        : renderedPoints;

    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scattergl",
      mode,
      name: poco,
      x:
        xMode === "voip"
          ? subset.map(({ p }) => p.pct_voip_poco ?? 0)
          : subset.map(({ p }) => `${p.ano}-${String(p.mes).padStart(2, "0")}-01`),
      y: subset.map(({ dep }) => dep),
      customdata: subset.map(
        ({ p }) =>
          [p.poco, p.ano, p.mes, p.pct_voip_poco ?? 0] as [
            string,
            number,
            number,
            number,
          ],
      ),
      marker: { size: 4, opacity: 0.7, color },
      line: { color, width: 1 },
      hovertemplate:
        xMode === "voip"
          ? "<b>%{customdata[0]}</b><br>" +
            "Reference month: %{customdata[1]}-%{customdata[2]:02d}<br>" +
            "VOIP recovered: %{customdata[3]:.1%}<br>" +
            "Depletion: %{y:.2%}" +
            "<extra></extra>"
          : "<b>%{customdata[0]}</b><br>" +
            "Reference month: %{customdata[1]}-%{customdata[2]:02d}<br>" +
            "Depletion: %{y:.2%}" +
            "<extra></extra>",
    } as unknown as PlotData;
  });

  const xaxis: Partial<Layout["xaxis"]> =
    xMode === "voip"
      ? {
          ...AXIS_LINE,
          type: "linear",
          title: { text: "% of VOIP recovered" },
          tickformat: ",.1%",
          rangemode: "tozero",
        }
      : {
          ...AXIS_LINE,
          type: "date",
          title: { text: "Date" },
        };

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 80, r: 30 },
      xaxis,
      yaxis: {
        ...AXIS_LINE,
        title: { text: `Depletion (rolling, ${recentMonths}m vs prior ${priorMonths}m)` },
        tickformat: ",.1%",
        zeroline: true,
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

// ── Field-average chart builder (uses scatter / SVG — low volume) ──────────────

/**
 * Build a rolling-depletion Plotly chart for the Field-average view.
 *
 * @param fieldPoints  - Points returned by `get_anp_cdp_depletion_field_aggregate`.
 * @param selectedCampos - Campos currently selected, in selection order (color maps to index).
 * @param lineStyle    - "markers" | "markers+lines".
 * @param xMode        - "calendar" | "voip".
 * @param recentMonths - Size of the recent window (N, 1–60).
 * @param priorMonths  - Size of the prior window (M, 1–60).
 */
export function buildFieldAverageChart(
  fieldPoints: AnpCdpDepletionFieldPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select one or more fields to plot rolling depletion.");
  }
  if (!fieldPoints.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    const fullSeries = fieldPoints
      .filter((p) => p.campo === campo)
      .sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));

    const color = PALETTE[i % PALETTE.length];
    if (typeof window !== "undefined" && fieldPoints.length > 0 && fullSeries.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[anp-cdp-depletion] field "${campo}" is selected but has no points in the RPC result; rendering empty trace.`,
      );
    }

    const depletionByYm = new Map<number, number>();
    for (const d of rollingDepletion(
      fullSeries.map((p) => ({ ano: p.ano, mes: p.mes, np: p.np_kbpd })),
      recentMonths,
      priorMonths,
    )) {
      depletionByYm.set(ymSort(d.ano, d.mes), d.depletion);
    }

    const renderedPoints = fullSeries
      .map((p) => {
        const dep = depletionByYm.get(ymSort(p.ano, p.mes));
        if (dep === undefined) return null;
        return { p, dep };
      })
      .filter((x): x is { p: AnpCdpDepletionFieldPoint; dep: number } => x !== null);

    const subset =
      xMode === "voip"
        ? renderedPoints.slice().sort((a, b) => a.p.pct_voip - b.p.pct_voip)
        : renderedPoints;

    return {
      type: "scatter",
      mode,
      name: campo,
      x:
        xMode === "voip"
          ? subset.map(({ p }) => p.pct_voip)
          : subset.map(({ p }) => `${p.ano}-${String(p.mes).padStart(2, "0")}-01`),
      y: subset.map(({ dep }) => dep),
      customdata: subset.map(
        ({ p }) =>
          [p.ano, p.mes, p.n_pocos, p.pct_voip, p.cumulative_oil_bbl] as [
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
        "Reference month: %{customdata[0]}-%{customdata[1]:02d}<br>" +
        "Depletion: %{y:.2%}<br>" +
        "Wells active: %{customdata[2]}<br>" +
        "VOIP recovered: %{customdata[3]:.1%}<br>" +
        "Cumulative oil: %{customdata[4]:,.0f} bbl" +
        "<extra></extra>",
    } as unknown as PlotData;
  });

  const xaxis: Partial<Layout["xaxis"]> =
    xMode === "voip"
      ? {
          ...AXIS_LINE,
          type: "linear",
          title: { text: "% of VOIP recovered" },
          tickformat: ",.1%",
          rangemode: "tozero",
        }
      : {
          ...AXIS_LINE,
          type: "date",
          title: { text: "Date" },
        };

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 80, r: 30 },
      xaxis,
      yaxis: {
        ...AXIS_LINE,
        title: { text: `Depletion (rolling, ${recentMonths}m vs prior ${priorMonths}m)` },
        tickformat: ",.1%",
        zeroline: true,
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

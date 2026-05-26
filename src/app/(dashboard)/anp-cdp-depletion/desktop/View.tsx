"use client";

/**
 * Desktop view — Depletion.
 *
 * Migrated verbatim from the original page.tsx (pre dual-view refactor).
 * All filter state, RPC fetching, derivations, and formatters live in the
 * shared hook `../useAnpCdpDepletionData`. This file is purely presentation.
 *
 * Binding sync rule: any meaningful change to the layout / analyses here
 * must also land in mobile/View.tsx in the same commit, OR the commit must
 * declare [desktop-only] with an explicit reason.
 */

import { useMemo } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../../lib/plotlyDefaults";

import {
  useAnpCdpDepletionData,
  rollingDepletion,
  computeRowMetrics,
  fmtNp,
  fmtDelta,
  plotlyMode,
  ymSort,
  VIEW_OPTIONS,
  X_MODE_OPTIONS,
  LINE_STYLE_OPTIONS,
  MAX_FIELDS_IN_FIELD_MODE,
  type AnpCdpDepletionPoint,
  type AnpCdpDepletionFieldPoint,
  type LineStyle,
  type XMode,
  type ViewMode,
} from "../useAnpCdpDepletionData";

// ── Chart builders ────────────────────────────────────────────────────────────

function buildPerWellChart(
  points: AnpCdpDepletionPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select a field to plot rolling depletion.");
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected field.");
  }

  const seen: string[] = [];
  for (const p of points) {
    if (!seen.includes(p.poco)) seen.push(p.poco);
  }
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = seen.map((poco, i) => {
    const fullSeries = points
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

function buildFieldAverageChart(
  points: AnpCdpDepletionFieldPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select one or more fields to plot rolling depletion.");
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    const fullSeries = points
      .filter((p) => p.campo === campo)
      .sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));
    const color = PALETTE[i % PALETTE.length];
    if (typeof window !== "undefined" && points.length > 0 && fullSeries.length === 0) {
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

// ── Desktop View ──────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement | null {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-depletion");

  const {
    campos,
    filtrosLoading,
    selectedCampos,
    viewMode,
    xMode,
    lineStyle,
    recentMonths,
    priorMonths,
    effectiveXMode,
    setSelectedCampos,
    setViewMode,
    setXMode,
    setLineStyle,
    setRecentMonths,
    setPriorMonths,
    wellPoints,
    fieldPoints,
    chartLoading,
    uniqueWellCount,
    tableModel,
    periodHelper,
    fieldColor,
    clampWindow,
  } = useAnpCdpDepletionData();

  const chart = useMemo(() => {
    return viewMode === "well"
      ? buildPerWellChart(wellPoints, selectedCampos, lineStyle, effectiveXMode, recentMonths, priorMonths)
      : buildFieldAverageChart(fieldPoints, selectedCampos, lineStyle, effectiveXMode, recentMonths, priorMonths);
  }, [viewMode, wellPoints, fieldPoints, selectedCampos, lineStyle, effectiveXMode, recentMonths, priorMonths]);

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ──────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              {/* ── View-mode toggle ────────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View</div>
                <SegmentedToggle<ViewMode>
                  options={VIEW_OPTIONS}
                  value={viewMode}
                  onChange={setViewMode}
                />
              </div>

              {/* ── X axis toggle ───────────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">X axis</div>
                <SegmentedToggle<XMode>
                  options={X_MODE_OPTIONS}
                  value={xMode}
                  onChange={setXMode}
                />
              </div>

              {/* ── Plot-style toggle ───────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Plot style</div>
                <SegmentedToggle<LineStyle>
                  options={LINE_STYLE_OPTIONS}
                  value={lineStyle}
                  onChange={setLineStyle}
                />
              </div>

              {/* ── Period comparison ───────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period comparison</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor="recent-window"
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "#666",
                        fontFamily: "Arial",
                        marginBottom: 2,
                      }}
                    >
                      Recent (m)
                    </label>
                    <input
                      id="recent-window"
                      type="number"
                      min={1}
                      max={60}
                      value={recentMonths}
                      onChange={(e) => setRecentMonths(clampWindow(Number(e.target.value)))}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        fontFamily: "Arial",
                        padding: "4px 6px",
                        border: "1px solid #d8d8d8",
                        borderRadius: 4,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: periodHelper === null ? "#999" : "#FF5500",
                        fontFamily: "Arial",
                        marginTop: 4,
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={periodHelper?.recentLabel ?? ""}
                    >
                      {periodHelper?.recentLabel ?? "—"}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor="prior-window"
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "#666",
                        fontFamily: "Arial",
                        marginBottom: 2,
                      }}
                    >
                      Prior (m)
                    </label>
                    <input
                      id="prior-window"
                      type="number"
                      min={1}
                      max={60}
                      value={priorMonths}
                      onChange={(e) => setPriorMonths(clampWindow(Number(e.target.value)))}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        fontFamily: "Arial",
                        padding: "4px 6px",
                        border: "1px solid #d8d8d8",
                        borderRadius: 4,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: periodHelper === null ? "#999" : "#FF5500",
                        fontFamily: "Arial",
                        marginTop: 4,
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={periodHelper?.priorLabel ?? ""}
                    >
                      {periodHelper?.priorLabel ?? "—"}
                    </div>
                  </div>
                </div>
                <div style={{
                  fontSize: 10,
                  color: "#888",
                  fontFamily: "Arial",
                  marginTop: 8,
                  lineHeight: 1.4,
                }}>
                  Recent vs prior windows for the chart Y axis and the table below (1–60 months).
                </div>
                {periodHelper?.warning && (
                  <div style={{
                    fontSize: 11,
                    color: "#b8860b",
                    fontFamily: "Arial",
                    marginTop: 6,
                    lineHeight: 1.4,
                    whiteSpace: "pre-line",
                  }}>
                    {periodHelper.warning}
                  </div>
                )}
              </div>

              <div className="sidebar-section-label">Filters</div>

              {/* Field — searchable multi-select */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Field{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? campos.length : selectedCampos.length}/{campos.length})
                  </span>
                </div>
                {!filtrosLoading && (
                  <SearchableMultiSelect
                    options={campos}
                    value={selectedCampos}
                    onChange={setSelectedCampos}
                  />
                )}
                <div style={{
                  fontSize: 10,
                  color: "#888",
                  fontFamily: "Arial",
                  marginTop: 8,
                  lineHeight: 1.4,
                }}>
                  {viewMode === "well"
                    ? "Single-select: each well gets its own color in the chart legend."
                    : `Each field gets a chart color in selection order (up to ${MAX_FIELDS_IN_FIELD_MODE}).`}
                </div>
                {viewMode === "well" && selectedCampos.length === 1 && uniqueWellCount > 0 && (
                  <div style={{
                    fontSize: 10,
                    color: "#888",
                    fontFamily: "Arial",
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}>
                    {uniqueWellCount} {uniqueWellCount === 1 ? "well" : "wells"} in this field
                  </div>
                )}
              </div>

              {/* Selected fields — colored chips */}
              {selectedCampos.length > 0 && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    {viewMode === "well" && selectedCampos.length === 1
                      ? "Selected field"
                      : "Selected fields"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedCampos.map((c) => (
                      <span
                        key={c}
                        title={c}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          backgroundColor: "#f7f7f7",
                          border: "1px solid #ececec",
                          borderRadius: 999,
                          padding: "3px 10px 3px 8px",
                          fontFamily: "Arial",
                          fontSize: 11,
                          color: "#333",
                          maxWidth: "100%",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            backgroundColor: fieldColor(c),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 160,
                        }}>
                          {c}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Main content ────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Depletion"
                sub="Rolling depletion (recent vs prior windows of uptime-normalized NP) with comparison table"
              />

              {filtrosLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  <ChartSection
                    title={
                      viewMode === "well"
                        ? selectedCampos.length === 1
                          ? effectiveXMode === "voip"
                            ? `Rolling depletion per well — ${selectedCampos[0]} (% of VOIP recovered)`
                            : `Rolling depletion per well — ${selectedCampos[0]}`
                          : effectiveXMode === "voip"
                            ? "Rolling depletion per well — % of VOIP recovered"
                            : "Rolling depletion per well"
                        : effectiveXMode === "voip"
                          ? "Rolling depletion — % of VOIP recovered"
                          : "Rolling depletion — calendar"
                    }
                    loading={chartLoading}
                    height={460}
                  >
                    <PlotlyChart
                      data={chart.data}
                      layout={chart.layout}
                      config={{ responsive: true, displayModeBar: false }}
                      style={{ width: "100%", height: 460 }}
                    />
                  </ChartSection>

                  {tableModel.rows.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <h3 className="section-title">Depletion comparison</h3>
                      <hr className="section-hr" />
                      <div
                        style={{
                          maxHeight: 400,
                          overflowY: "auto",
                          overflowX: "auto",
                          border: "1px solid #ececec",
                          borderRadius: 4,
                        }}
                      >
                        <table
                          className="table table-sm table-striped mb-0"
                          style={{ fontFamily: "Arial", fontSize: 12 }}
                        >
                          <thead
                            style={{
                              position: "sticky",
                              top: 0,
                              background: "#fff",
                              zIndex: 1,
                            }}
                          >
                            <tr>
                              <th
                                style={{
                                  textAlign: "left",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Item
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                NP last month (kbpd)
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Avg recent ({recentMonths}m, kbpd)
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Avg prior ({priorMonths}m, kbpd)
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Depletion %
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                YoY %
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableModel.rows.map((row) => {
                              const m = computeRowMetrics(row.series, recentMonths, priorMonths);
                              const dep = fmtDelta(m.depletion);
                              const yoy = fmtDelta(m.yoy);
                              return (
                                <tr key={row.item}>
                                  <td
                                    style={{
                                      whiteSpace: "nowrap",
                                      maxWidth: 220,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                    title={row.item}
                                  >
                                    <span
                                      aria-hidden
                                      style={{
                                        display: "inline-block",
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        backgroundColor: row.color,
                                        marginRight: 6,
                                        verticalAlign: "middle",
                                      }}
                                    />
                                    {row.item}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {fmtNp(m.last)}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {fmtNp(m.avgRecent)}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {fmtNp(m.avgPrior)}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: dep.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {dep.text}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: yoy.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {yoy.text}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

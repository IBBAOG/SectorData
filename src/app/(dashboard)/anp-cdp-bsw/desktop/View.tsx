"use client";

// Desktop View — /anp-cdp-bsw (≥769px).
//
// Verbatim move of the previous page.tsx body, with all data plumbing now
// sourced from `useAnpCdpBswData`. No Supabase / RPC calls happen here.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here
// must land in ../mobile/View.tsx in the SAME commit, OR the commit message
// must declare `[desktop-only]` with an explicit reason.

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";

import {
  useAnpCdpBswData,
  VIEW_OPTIONS,
  LINE_STYLE_OPTIONS,
  MAX_FIELDS_IN_FIELD_MODE,
  type ViewMode,
  type LineStyle,
} from "../useAnpCdpBswData";

export default function DesktopView(): React.ReactElement | null {
  const {
    visible,
    visLoading,
    filtrosLoading,
    chartLoading,
    campos,
    selectedCampos,
    viewMode,
    lineStyle,
    handleModeChange,
    handleCamposChange,
    setLineStyle,
    chart,
    tableModel,
    uniqueWellCount,
    fieldColor,
    fmtBsw,
    fmtDelta,
    computeDeltas,
  } = useAnpCdpBswData();

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

              {/* ── View-mode toggle (pill) ─────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View</div>
                <SegmentedToggle<ViewMode>
                  options={VIEW_OPTIONS}
                  value={viewMode}
                  onChange={handleModeChange}
                />
              </div>

              {/* ── Plot-style toggle (shared by both views) ────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Plot style</div>
                <SegmentedToggle<LineStyle>
                  options={LINE_STYLE_OPTIONS}
                  value={lineStyle}
                  onChange={setLineStyle}
                />
              </div>

              <div className="sidebar-section-label">Filters</div>

              {/* Field — searchable multi-select (offshore: Pre-Salt + Post-Salt) */}
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
                    onChange={handleCamposChange}
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
                title="BSW by Well"
                sub="Water cut (BSW) vs months since first production, by well"
              />

              {filtrosLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  <ChartSection
                    title={
                      viewMode === "well"
                        ? selectedCampos.length === 1
                          ? `BSW evolution per well — ${selectedCampos[0]}`
                          : "BSW evolution per well"
                        : "BSW evolution — % of VOIP recovered (volume-weighted)"
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
                      <h3 className="section-title">Recent BSW history (last 12 months)</h3>
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
                              {tableModel.months.map((m) => (
                                <th
                                  key={m}
                                  style={{
                                    textAlign: "right",
                                    whiteSpace: "nowrap",
                                    borderBottom: "2px solid #888",
                                  }}
                                >
                                  {m}
                                </th>
                              ))}
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                MoM%
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                YTD%
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableModel.rows.map((row) => {
                              const { mom, ytd } = computeDeltas(tableModel.months, row.values);
                              const momFmt = fmtDelta(mom);
                              const ytdFmt = fmtDelta(ytd);
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
                                  {tableModel.months.map((m) => (
                                    <td
                                      key={m}
                                      style={{
                                        textAlign: "right",
                                        whiteSpace: "nowrap",
                                        fontVariantNumeric: "tabular-nums",
                                      }}
                                    >
                                      {fmtBsw(row.values[m])}
                                    </td>
                                  ))}
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: momFmt.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {momFmt.text}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: ytdFmt.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {ytdFmt.text}
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

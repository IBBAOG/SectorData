"use client";

import { useMemo } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import ExportModal from "../../../../components/dashboard/ExportModal";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../../lib/plotlyDefaults";

import {
  useMdicComexData,
  NCM_INFO,
  ALL_NCMS,
  METRIC_CONFIG,
  METRIC_OPTIONS,
  VIEW_MODE_OPTIONS,
  INDIVIDUAL_WARN_THRESHOLD,
  MDIC_GRANULARITY_OPTIONS,
  formatPct,
  type Metric,
  type ViewMode,
} from "../useMdicComexData";

import type { MdicComexAggregatedRow } from "../../../../lib/rpc";

// ── Chart builders (desktop-only — full Plotly layouts) ───────────────────────

function buildConsolidatedLineChart(
  rows: MdicComexAggregatedRow[],
  flow: string,
  ncms: string[],
  metric: Metric,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.flow === flow && r.ncm_codigo && ncms.includes(r.ncm_codigo));
  if (!filtered.length) return emptyPlot(280);

  const cfg = METRIC_CONFIG[metric];
  const byNcm: Record<string, MdicComexAggregatedRow[]> = {};
  for (const r of filtered) {
    if (r.ncm_codigo) (byNcm[r.ncm_codigo] ??= []).push(r);
  }

  const traces: PlotData[] = ncms
    .filter(ncm => byNcm[ncm])
    .map(ncm => {
      const data = byNcm[ncm].sort((a, b) =>
        (a.ano ?? 0) !== (b.ano ?? 0) ? (a.ano ?? 0) - (b.ano ?? 0) : (a.mes ?? 0) - (b.mes ?? 0)
      );
      const info = NCM_INFO[ncm];
      const unit = cfg.hoverUnit();
      return {
        type: "scatter", mode: "lines",
        name: info?.label ?? ncm,
        x: data.map(r => `${r.ano}-${String(r.mes ?? 1).padStart(2, "0")}`),
        y: data.map(r => cfg.select(r)),
        line:  { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label ?? ncm}: %{y:.2f} ${unit}<extra></extra>`,
      } as PlotData;
    });

  const axisLabel = cfg.axisTitle();
  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${axisLabel} / month` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildIndividualLineChart(
  rows: MdicComexAggregatedRow[],
  flow: string,
  metric: Metric,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r.flow === flow && r.pais);
  if (!filtered.length) return emptyPlot(280);

  const cfg = METRIC_CONFIG[metric];
  const byPais: Record<string, MdicComexAggregatedRow[]> = {};
  for (const r of filtered) {
    if (r.pais) (byPais[r.pais] ??= []).push(r);
  }

  const countries = Object.keys(byPais).sort();
  const traces: PlotData[] = countries.map((pais, idx) => {
    const data = byPais[pais].sort((a, b) =>
      (a.ano ?? 0) !== (b.ano ?? 0) ? (a.ano ?? 0) - (b.ano ?? 0) : (a.mes ?? 0) - (b.mes ?? 0)
    );
    const color = PALETTE[idx % PALETTE.length];
    const unit = cfg.hoverUnit();
    return {
      type: "scatter", mode: "lines",
      name: pais,
      x: data.map(r => `${r.ano}-${String(r.mes ?? 1).padStart(2, "0")}`),
      y: data.map(r => cfg.select(r)),
      line:  { width: 2, color },
      hovertemplate: `${pais}: %{y:.2f} ${unit}<extra></extra>`,
    } as PlotData;
  });

  const axisLabel = cfg.axisTitle();
  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: `${axisLabel} / month` } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

// ── Desktop view ──────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const {
    loading, visLoading, visible,
    anos, allPaises, yearRange, setYearRange,
    selectedNCMs, toggleNcm, resetNcms,
    selectedPaises, setSelectedPaises,
    metric, setMetric,
    viewMode, setViewMode,
    showIndividualWarn, setShowIndividualWarn,
    hasYears, yMin, yMax,
    chartRows, tableRows, chartLoading, tableLoading, tableData,
    exportOpen, setExportOpen,
    excelLoading, csvLoading,
    exportFlow, setExportFlow,
    exportNcms, setExportNcms,
    exportRange, setExportRange,
    exportGranularity, setExportGranularity,
    exportRawCount,
    exportFilters,
    rawOverExcel, rawOverAbs,
    openExportModal, handleExportExcel, handleExportCsv,
    fetchExportCount,
  } = useMdicComexData();

  const cfg = METRIC_CONFIG[metric];

  const importTitle = viewMode === "individual"
    ? `Imports (${cfg.axisTitle()} / month) — by country`
    : `Imports (${cfg.axisTitle()} / month)`;
  const exportTitle = viewMode === "individual"
    ? `Exports (${cfg.axisTitle()} / month) — by country`
    : `Exports (${cfg.axisTitle()} / month)`;

  const importChart = useMemo(() => {
    if (viewMode === "consolidated") {
      return buildConsolidatedLineChart(chartRows, "import", selectedNCMs, metric);
    }
    return buildIndividualLineChart(chartRows, "import", metric);
  }, [chartRows, viewMode, selectedNCMs, metric]);

  const exportChart = useMemo(() => {
    if (viewMode === "consolidated") {
      return buildConsolidatedLineChart(chartRows, "export", selectedNCMs, metric);
    }
    return buildIndividualLineChart(chartRows, "export", metric);
  }, [chartRows, viewMode, selectedNCMs, metric]);

  if (visLoading || !visible) return <></>;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* Sidebar */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <MultiSelectFilter
                label="Product"
                items={ALL_NCMS}
                selected={selectedNCMs}
                onToggle={toggleNcm}
                onClear={selectedNCMs.length < ALL_NCMS.length ? resetNcms : undefined}
                swatch={(n) => NCM_INFO[n].color}
                itemLabel={(n) => NCM_INFO[n].label}
                idPrefix="ncm"
                counterTotal={ALL_NCMS.length}
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>
                    Countries
                    {allPaises.length > 0 && (
                      <span style={{ color: "#888", fontWeight: 400, marginLeft: 4 }}>
                        ({selectedPaises.length}/{allPaises.length})
                      </span>
                    )}
                  </span>
                  {allPaises.length > 0 && (
                    <span style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="filter-btn-link filter-btn-link--secondary"
                        onClick={() => setSelectedPaises(allPaises)}
                        title="Select all countries"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="filter-btn-link filter-btn-link--secondary"
                        onClick={() => setSelectedPaises([])}
                        title="Clear country selection"
                      >
                        Clear
                      </button>
                    </span>
                  )}
                </div>
                {allPaises.length > 0 && (
                  <SearchableMultiSelect
                    options={allPaises}
                    value={selectedPaises}
                    onChange={(next) => {
                      setSelectedPaises(next);
                      if (viewMode === "individual" && next.length > INDIVIDUAL_WARN_THRESHOLD) {
                        setShowIndividualWarn(true);
                      } else {
                        setShowIndividualWarn(false);
                      }
                    }}
                  />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View mode</div>
                <SegmentedToggle<ViewMode>
                  options={VIEW_MODE_OPTIONS}
                  value={viewMode}
                  onChange={(v) => {
                    setViewMode(v);
                    if (v === "individual" && selectedPaises.length > INDIVIDUAL_WARN_THRESHOLD) {
                      setShowIndividualWarn(true);
                    } else {
                      setShowIndividualWarn(false);
                    }
                  }}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasYears && (
                  <PeriodSlider years={anos} value={yearRange} onChange={setYearRange} />
                )}
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="MDIC Comex Stat — Imports and Exports"
                sub="Monthly import and export volumes of crude oil, gasoline, and diesel by NCM and origin/destination country"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "Excel",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                      {
                        kind: "csv",
                        label: "CSV",
                        disabled: loading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                    ]}
                  />
                }
              />

              {!loading && (
                <div style={{ maxWidth: 840, margin: "0 auto 16px auto" }}>
                  <SegmentedToggle<Metric>
                    options={METRIC_OPTIONS}
                    value={metric}
                    onChange={setMetric}
                  />
                </div>
              )}

              {!loading && showIndividualWarn && (
                <div
                  style={{
                    maxWidth: 840,
                    margin: "0 auto 12px auto",
                    fontSize: 12,
                    color: "#7a5200",
                    backgroundColor: "#fff8e1",
                    border: "1px solid #ffe082",
                    borderRadius: 4,
                    padding: "8px 12px",
                    lineHeight: 1.5,
                    fontFamily: "Arial",
                  }}
                >
                  Individual mode shows 1 series per country. Narrow your country filter to compare more clearly.
                  <button
                    type="button"
                    onClick={() => setShowIndividualWarn(false)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      float: "right", fontSize: 13, color: "#999", lineHeight: 1,
                    }}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              )}

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection title={importTitle} loading={chartLoading} height={280}>
                        <PlotlyChart
                          data={importChart.data}
                          layout={importChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection title={exportTitle} loading={chartLoading} height={280}>
                        <PlotlyChart
                          data={exportChart.data}
                          layout={exportChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 280 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-4">
                    <div className="col-12">
                      <div
                        className="chart-container"
                        style={{ position: "relative", opacity: tableLoading ? 0.5 : 1 }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "Arial", marginBottom: 10 }}>
                          Monthly Summary — Last 24 Months
                          <span style={{ fontSize: 11, fontWeight: 400, color: "#888", marginLeft: 8 }}>
                            ({cfg.tableHeader()} / month, active filters)
                          </span>
                        </div>
                        {tableData.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#888", fontFamily: "Arial" }}>
                            No data for the selected period.
                          </div>
                        ) : (
                          <div style={{ overflowX: "auto" }}>
                            <table
                              className="table table-sm table-hover"
                              style={{ fontFamily: "Arial", fontSize: 12, minWidth: 620 }}
                            >
                              <thead>
                                <tr style={{ backgroundColor: "#f8f8f8" }}>
                                  <th style={{ width: 90, fontWeight: 700 }}>Month</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>
                                    Imports ({cfg.tableHeader()})
                                  </th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>
                                    Exports ({cfg.tableHeader()})
                                  </th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>IMP MoM%</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>EXP MoM%</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>IMP YoY%</th>
                                  <th style={{ textAlign: "right", fontWeight: 700 }}>EXP YoY%</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tableData.map(row => {
                                  const impMoM = formatPct(row.impMoM);
                                  const expMoM = formatPct(row.expMoM);
                                  const impYoY = formatPct(row.impYoY);
                                  const expYoY = formatPct(row.expYoY);
                                  return (
                                    <tr key={row.label}>
                                      <td style={{ fontWeight: 600, color: "#1a1a1a" }}>{row.label}</td>
                                      <td style={{ textAlign: "right" }}>
                                        {row.imp != null ? row.imp.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"}
                                      </td>
                                      <td style={{ textAlign: "right" }}>
                                        {row.exp != null ? row.exp.toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"}
                                      </td>
                                      <td style={{ textAlign: "right", color: impMoM.color, fontWeight: impMoM.text !== "—" ? 600 : 400 }}>
                                        {impMoM.text}
                                      </td>
                                      <td style={{ textAlign: "right", color: expMoM.color, fontWeight: expMoM.text !== "—" ? 600 : 400 }}>
                                        {expMoM.text}
                                      </td>
                                      <td style={{ textAlign: "right", color: impYoY.color, fontWeight: impYoY.text !== "—" ? 600 : 400 }}>
                                        {impYoY.text}
                                      </td>
                                      <td style={{ textAlign: "right", color: expYoY.color, fontWeight: expYoY.text !== "—" ? 600 : 400 }}>
                                        {expYoY.text}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export — MDIC Comex"
        datasetKey="mdic_comex"
        currentFilters={{ ...exportFilters, _g: exportGranularity }}
        countFetcher={fetchExportCount}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={handleExportExcel}
        onExportCsv={handleExportCsv}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularity
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {MDIC_GRANULARITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="form-check" style={{ marginBottom: 0 }}>
                    <input
                      className="form-check-input"
                      type="radio"
                      id={`mdic-export-g-${opt.value}`}
                      name="mdic-export-granularity"
                      checked={exportGranularity === opt.value}
                      onChange={() => setExportGranularity(opt.value)}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`mdic-export-g-${opt.value}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}
                    >
                      <strong>{opt.label}</strong>
                      <span style={{ color: "#888", marginLeft: 6, fontSize: 11 }}>— {opt.hint}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {rawOverAbs && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#7a1a1a", backgroundColor: "#fdecea", border: "1px solid #f5c2bc", borderRadius: 4, padding: "8px 10px", lineHeight: 1.4 }}>
                Very high volume ({(exportRawCount ?? 0).toLocaleString("en-US")} rows). Choose an <strong>aggregated granularity</strong> or apply more filters.
              </div>
            )}
            {!rawOverAbs && rawOverExcel && (
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#7a4a00", backgroundColor: "#fff3cd", border: "1px solid #ffe69c", borderRadius: 4, padding: "8px 10px", lineHeight: 1.4 }}>
                High volume for Excel ({(exportRawCount ?? 0).toLocaleString("en-US")} rows). We recommend <strong>CSV</strong>.
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Period</div>
              {hasYears && <PeriodSlider years={anos} value={exportRange} onChange={setExportRange} />}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Flow</div>
              <select
                className="form-select form-select-sm"
                value={exportFlow}
                onChange={e => setExportFlow(e.target.value)}
                style={{ fontFamily: "Arial", fontSize: 12, maxWidth: 220 }}
              >
                <option value="ALL">Imports + Exports</option>
                <option value="import">Imports</option>
                <option value="export">Exports</option>
              </select>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>NCMs</div>
              <MultiSelectFilter
                label="NCMs"
                items={ALL_NCMS}
                selected={exportNcms}
                onToggle={(ncm) => {
                  const next = exportNcms.includes(ncm)
                    ? exportNcms.length > 1 ? exportNcms.filter((n: string) => n !== ncm) : exportNcms
                    : [...exportNcms, ncm];
                  setExportNcms(next);
                }}
                onClear={exportNcms.length < ALL_NCMS.length ? () => setExportNcms(ALL_NCMS) : undefined}
                swatch={(n) => NCM_INFO[n].color}
                itemLabel={(n) => NCM_INFO[n].label}
                idPrefix="ncm-export"
                counterTotal={ALL_NCMS.length}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}

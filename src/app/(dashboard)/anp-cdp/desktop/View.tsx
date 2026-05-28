"use client";

/**
 * Desktop view — /anp-cdp.
 *
 * Verbatim port of the previous monolithic page.tsx, refactored to consume
 * `useAnpCdpData` (single brain for the dual-view pattern). All RPC calls,
 * filter state, debounced refetch and export wiring now live in the hook —
 * this file is presentation only.
 *
 * Binding sync rule (CLAUDE.md § Dual-view policy): any meaningful change
 * here (new filter, chart, KPI, copy) must land in mobile/View.tsx in the
 * SAME commit, or the commit message must declare [desktop-only] with an
 * explicit reason.
 */

import { useMemo } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import ExportModal from "../../../../components/dashboard/ExportModal";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";

import {
  useAnpCdpData,
  METRICS,
  LOCAL_LABELS,
  MONTH_ABBR,
  ANP_CDP_GRANULARITY_OPTIONS,
  type AnpCdpMetric,
  type AnpCdpSeriePonto,
} from "../useAnpCdpData";
import { useState } from "react";

// ─── Chart builder ───────────────────────────────────────────────────────────

function buildChart(
  serie: AnpCdpSeriePonto[],
  xs: string[],
  ys: number[],
  customdata: number[][],
  metric: AnpCdpMetric,
  nPocos: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!serie.length) return emptyPlot(340, "No data.");

  const titleText = nPocos === 0
    ? "All wells"
    : `${nPocos.toLocaleString("en-US")} well${nPocos !== 1 ? "s" : ""} selected`;

  const unitSuffix = metric.shortUnit === "kbpd" ? " kbpd" : ` ${metric.shortUnit}`;
  const recordsPart = serie.some((r) => (r.records_count ?? 0) > 0)
    ? " · %{customdata[1]:,} records"
    : "";
  const hovertemplate =
    `<b>%{x|%b %Y}</b>: %{y:,.1f}${unitSuffix}<br>` +
    `%{customdata[0]:,} wells${recordsPart} · %{customdata[2]:,} fields<extra></extra>`;

  // Annotation on the most recent data point — coverage counts.
  const lastIdx = serie.length - 1;
  const lastPt  = serie[lastIdx];
  const lastW   = lastPt.wells_count   ?? 0;
  const lastR   = lastPt.records_count ?? 0;
  const lastF   = lastPt.fields_count  ?? 0;
  const annotations: Partial<Layout>["annotations"] = [];
  if (lastW > 0 || lastF > 0) {
    const mon = MONTH_ABBR[(lastPt.mes - 1) % 12];
    const annotText = lastR > 0
      ? `${lastW.toLocaleString("en-US")} wells · ${lastR.toLocaleString("en-US")} records · ${lastF.toLocaleString("en-US")} fields`
      : `${lastW.toLocaleString("en-US")} wells · ${lastF.toLocaleString("en-US")} fields`;
    const hoverText = lastR > 0
      ? `${mon} ${lastPt.ano}: ${lastW.toLocaleString("en-US")} wells, ${lastR.toLocaleString("en-US")} records, ${lastF.toLocaleString("en-US")} fields`
      : `${mon} ${lastPt.ano}: ${lastW.toLocaleString("en-US")} wells, ${lastF.toLocaleString("en-US")} fields`;
    annotations.push({
      x:           xs[lastIdx],
      y:           ys[lastIdx],
      xref:        "x" as const,
      yref:        "y" as const,
      text:        annotText,
      showarrow:   true,
      arrowhead:   0,
      arrowcolor:  "#ccc",
      arrowwidth:  1,
      ax:          0,
      ay:          -32,
      font:        { size: 10, color: "#aaa", family: "Arial" },
      bgcolor:     "rgba(255,255,255,0.85)",
      bordercolor: "#ddd",
      borderwidth: 1,
      borderpad:   3,
      hovertext:   hoverText,
    });
  }

  return {
    data: [{
      type:      "scatter",
      mode:      "lines",
      name:      metric.label,
      x:         xs,
      y:         ys,
      customdata,
      line:      { width: 2.5, color: "#FF5000" },
      hovertemplate,
      fill:      "tozeroy",
      fillcolor: "rgba(255,80,0,0.07)",
    } as PlotData],
    layout: {
      ...COMMON_LAYOUT,
      height: 340,
      margin: { t: 30, b: 50, l: 90, r: 30 },
      title: {
        text: titleText,
        font: { size: 12, color: "#888", family: "Arial" },
        x: 0.01,
        xanchor: "left",
      },
      yaxis: { ...AXIS_LINE, title: { text: metric.label } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      annotations,
    },
  };
}

// ─── Reusable inputs scoped to this view ─────────────────────────────────────

function InvertedCheckboxGroup({
  id, items, selected, onChange, labelMap,
}: {
  id: string;
  items: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  labelMap?: Record<string, string>;
}) {
  const toggle = (item: string) => {
    if (selected.length === 0) {
      onChange(items.filter((x) => x !== item));
    } else {
      const next = selected.includes(item)
        ? (selected.length > 1 ? selected.filter((x) => x !== item) : selected)
        : [...selected, item];
      onChange(next);
    }
  };
  return (
    <>
      {items.map((item) => (
        <div key={item} className="form-check" style={{ marginBottom: 4 }}>
          <input
            className="form-check-input"
            type="checkbox"
            id={`${id}-${item}`}
            checked={selected.length === 0 || selected.includes(item)}
            onChange={() => toggle(item)}
          />
          <label
            className="form-check-label"
            htmlFor={`${id}-${item}`}
            style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}
          >
            {labelMap?.[item] ?? item}
          </label>
        </div>
      ))}
      {selected.length > 0 && (
        <button
          className="filter-btn-link filter-btn-link--secondary"
          style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10 }}
          onClick={() => onChange([])}
        >
          Clear
        </button>
      )}
    </>
  );
}

function MultiFilter({
  label, options, value, onChange, loading,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  loading?: boolean;
}) {
  if (!options.length) return null;
  return (
    <div className="sidebar-filter-section">
      <div className="sidebar-filter-label">
        {label}{" "}
        <span style={{ color: "#888", fontWeight: 400 }}>
          ({value.length === 0 ? options.length : value.length}/{options.length})
        </span>
      </div>
      {!loading && (
        <SearchableMultiSelect options={options} value={value} onChange={onChange} />
      )}
    </div>
  );
}

// ─── View ────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement | null {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp");
  const data = useAnpCdpData();

  const {
    loading, serieLoading, pocosReady,
    filtros, serieData, allYears, yearRange, setYearRange,
    selectedBacoes,      setSelectedBacoes,
    selectedLocais,      setSelectedLocais,
    selectedEstados,     setSelectedEstados,
    selectedOperadores,  setSelectedOperadores,
    selectedInstalacoes, setSelectedInstalacoes,
    selectedTipos,       setSelectedTipos,
    selectedCampos,      setSelectedCampos,
    selectedPocos,       setSelectedPocos,
    metric, setMetric,
    pocoOptions, serieXY, serieCustomdata,
    exportFilters, exportRange, setExportRange,
    exportBacoes, setExportBacoes,
    exportOperadores, setExportOperadores,
    exportLocais, setExportLocais,
    exportTipos, setExportTipos,
    exportGranularity, setExportGranularity,
    exportRawCount, rawOverExcel, rawOverAbs,
    excelLoading, csvLoading,
    countFetcher, doExportExcel, doExportCsv,
    openExportFromCurrentFilters,
  } = data;

  const [exportOpen, setExportOpen] = useState(false);

  function openExportModal() {
    openExportFromCurrentFilters();
    setExportOpen(true);
  }

  const chart = useMemo(
    () => buildChart(
      serieData,
      serieXY.xs, serieXY.ys, serieCustomdata,
      metric,
      selectedPocos.length,
    ),
    [serieData, serieXY, serieCustomdata, metric, selectedPocos.length],
  );

  if (visLoading || !visible) return null;

  const yMin = allYears[yearRange[0]] ?? "—";
  const yMax = allYears[yearRange[1]] ?? "—";
  const allLocais = filtros.locais.length ? filtros.locais : ["PreSal", "PosSal", "Terra"];

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />
              <div className="sidebar-section-label">Filters</div>

              {/* Metric */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Metric</div>
                {METRICS.map((m) => (
                  <div key={m.key} className="form-check" style={{ marginBottom: 4 }}>
                    <input
                      className="form-check-input"
                      type="radio"
                      id={`cdp-m-${m.key}`}
                      checked={metric.key === m.key}
                      onChange={() => setMetric(m)}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`cdp-m-${m.key}`}
                      style={{ fontFamily: "Arial", fontSize: 11, cursor: "pointer" }}
                    >
                      {m.label}
                    </label>
                  </div>
                ))}
              </div>

              {/* Environment */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Environment</div>
                <InvertedCheckboxGroup
                  id="cdp-l"
                  items={allLocais}
                  selected={selectedLocais}
                  onChange={setSelectedLocais}
                  labelMap={LOCAL_LABELS}
                />
              </div>

              {/* Basin */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Basin</div>
                <InvertedCheckboxGroup
                  id="cdp-b"
                  items={filtros.bacoes}
                  selected={selectedBacoes}
                  onChange={setSelectedBacoes}
                />
              </div>

              <MultiFilter
                label="State"
                options={filtros.estados}
                value={selectedEstados}
                onChange={setSelectedEstados}
                loading={loading}
              />

              <MultiFilter
                label="Operator"
                options={filtros.operadores}
                value={selectedOperadores}
                onChange={setSelectedOperadores}
                loading={loading}
              />

              <MultiFilter
                label="Destination Facility"
                options={filtros.instalacoes}
                value={selectedInstalacoes}
                onChange={setSelectedInstalacoes}
                loading={loading}
              />

              <MultiFilter
                label="Facility Type"
                options={filtros.tipos_instalacao}
                value={selectedTipos}
                onChange={setSelectedTipos}
                loading={loading}
              />

              {/* Field */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Field{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? filtros.campos.length : selectedCampos.length}/{filtros.campos.length})
                  </span>
                </div>
                {!loading && (
                  <SearchableMultiSelect
                    options={filtros.campos}
                    value={selectedCampos}
                    onChange={setSelectedCampos}
                  />
                )}
              </div>

              {/* Well */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Well{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    {pocosReady
                      ? `(${selectedPocos.length === 0 ? pocoOptions.length : selectedPocos.length}/${pocoOptions.length})`
                      : "(loading…)"}
                  </span>
                </div>
                {!loading && pocosReady && (
                  <SearchableMultiSelect
                    options={pocoOptions}
                    value={selectedPocos}
                    onChange={setSelectedPocos}
                  />
                )}
                {!loading && !pocosReady && (
                  <div style={{ fontSize: 10, color: "#aaa", fontFamily: "Arial", paddingTop: 4 }}>
                    Loading well list…
                  </div>
                )}
              </div>

              {/* Period */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && allYears.length > 0 && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>
            </div>
          </div>

          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Monthly Production"
                sub="Monthly production reported to ANP by well, field, and operator"
                period={allYears.length > 0 ? [yMin, yMax] : null}
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

              {loading ? (
                <BarrelLoading />
              ) : (
                <div className="row mb-2">
                  <div className="col-12">
                    <ChartSection
                      title={`Total Selected Production — ${metric.label}`}
                      loading={serieLoading}
                      height={340}
                    >
                      <PlotlyChart
                        data={chart.data}
                        layout={chart.layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 340 }}
                      />
                    </ChartSection>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export — Production"
        datasetKey="anp_cdp_producao"
        currentFilters={{ ...exportFilters, _g: exportGranularity }}
        countFetcher={countFetcher}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={async () => {
          await doExportExcel();
          if (!excelLoading) setExportOpen(false);
        }}
        onExportCsv={async () => {
          await doExportCsv();
          if (!csvLoading) setExportOpen(false);
        }}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            {/* Granularity */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularity
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {ANP_CDP_GRANULARITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="form-check" style={{ marginBottom: 0 }}>
                    <input
                      className="form-check-input"
                      type="radio"
                      id={`cdp-export-g-${opt.value}`}
                      name="cdp-export-granularity"
                      checked={exportGranularity === opt.value}
                      onChange={() => setExportGranularity(opt.value)}
                    />
                    <label
                      className="form-check-label"
                      htmlFor={`cdp-export-g-${opt.value}`}
                      style={{ fontFamily: "Arial", fontSize: 12, cursor: "pointer" }}
                    >
                      <strong>{opt.label}</strong>
                      <span style={{ color: "#888", marginLeft: 6, fontSize: 11 }}>
                        — {opt.hint}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Hard-limit warnings */}
            {rawOverAbs && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#7a1a1a",
                  backgroundColor: "#fdecea",
                  border: "1px solid #f5c2bc",
                  borderRadius: 4,
                  padding: "8px 10px",
                  lineHeight: 1.4,
                }}
              >
                Very high volume ({(exportRawCount ?? 0).toLocaleString("en-US")} rows).
                Choose an <strong>aggregated granularity</strong> (field, basin, operator,
                environment, state, or year/month) or apply more filters (basin, operator, period).
              </div>
            )}
            {!rawOverAbs && rawOverExcel && (
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#7a4a00",
                  backgroundColor: "#fff3cd",
                  border: "1px solid #ffe69c",
                  borderRadius: 4,
                  padding: "8px 10px",
                  lineHeight: 1.4,
                }}
              >
                High volume for Excel ({(exportRawCount ?? 0).toLocaleString("en-US")} rows).
                We recommend downloading as <strong>CSV</strong> (lighter) — Excel may fail in
                the browser.
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Period</div>
              {allYears.length > 0 && (
                <PeriodSlider years={allYears} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Basins <span style={{ color: "#888", fontWeight: 400 }}>({exportBacoes.length === 0 ? filtros.bacoes.length : exportBacoes.length}/{filtros.bacoes.length})</span>
                </div>
                <SearchableMultiSelect
                  options={filtros.bacoes}
                  value={exportBacoes}
                  onChange={setExportBacoes}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Operators <span style={{ color: "#888", fontWeight: 400 }}>({exportOperadores.length === 0 ? filtros.operadores.length : exportOperadores.length}/{filtros.operadores.length})</span>
                </div>
                <SearchableMultiSelect
                  options={filtros.operadores}
                  value={exportOperadores}
                  onChange={setExportOperadores}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Environments (Locations)
                </div>
                <SearchableMultiSelect
                  options={allLocais}
                  value={exportLocais}
                  onChange={setExportLocais}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Facility Type <span style={{ color: "#888", fontWeight: 400 }}>({exportTipos.length === 0 ? filtros.tipos_instalacao.length : exportTipos.length}/{filtros.tipos_instalacao.length})</span>
                </div>
                <SearchableMultiSelect
                  options={filtros.tipos_instalacao}
                  value={exportTipos}
                  onChange={setExportTipos}
                />
              </div>
            </div>
          </div>
        }
      />
    </div>
  );
}

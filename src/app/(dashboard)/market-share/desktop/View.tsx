"use client";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import PlotlyChart from "../../../../components/PlotlyChart";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import ExportModal from "../../../../components/dashboard/ExportModal";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import CheckList from "../../../../components/CheckList";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import RegionStateFilter from "../../../../components/RegionStateFilter";
import {
  useMarketShareData,
  MODE_OPTIONS,
  type CompRow,
} from "../useMarketShareData";

// ─── ComparisonTable ──────────────────────────────────────────────────────────

function ComparisonTable({ rows }: { rows: CompRow[] }) {
  const fmt = (v: number | null) =>
    v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1);
  const cellStyle = (v: number | null): React.CSSProperties => ({
    backgroundColor:
      v === null ? "transparent" : v > 0 ? "#C6E8D9" : v < 0 ? "#FFDDCC" : "transparent",
    color: v === null ? "#bbb" : "#1a1a1a",
    textAlign: "center",
    padding: "2px 10px",
    fontSize: 11,
    fontFamily: "Arial",
    whiteSpace: "nowrap",
    fontWeight: 400,
    border: "none",
  });
  const thStyle: React.CSSProperties = {
    fontFamily: "Arial",
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff",
    backgroundColor: "#000512",
    textAlign: "center",
    padding: "4px 10px",
    border: "none",
  };
  return (
    <table
      style={{
        borderCollapse: "collapse",
        width: "100%",
        margin: "6px 0 0 0",
        tableLayout: "fixed",
      }}
    >
      <colgroup>
        <col style={{ width: "30%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left", paddingLeft: 8 }}>
            Market Share Var. (p.p.)
          </th>
          <th style={thStyle}>MoM</th>
          <th style={thStyle}>QTD</th>
          <th style={thStyle}>YoY</th>
          <th style={thStyle}>YTD</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={row.player}
            style={i === rows.length - 1 ? { borderBottom: "2px solid #d0d0d0" } : {}}
          >
            <td
              style={{
                fontFamily: "Arial",
                fontSize: 11,
                color: "#1a1a1a",
                fontWeight: 400,
                padding: "2px 12px 2px 8px",
                whiteSpace: "nowrap",
                border: "none",
              }}
            >
              {row.player}
            </td>
            <td style={cellStyle(row.mom)}>{fmt(row.mom)}</td>
            <td style={cellStyle(row.q3m)}>{fmt(row.q3m)}</td>
            <td style={cellStyle(row.yoy)}>{fmt(row.yoy)}</td>
            <td style={cellStyle(row.ytd)}>{fmt(row.ytd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Desktop View ─────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("market-share");

  const {
    seriesLoading,
    opcoes,
    datas,
    regioesAll,
    ufsAll,
    mercadosAll,
    mode,
    setMode,
    sliderRange,
    setSliderRange,
    regioesSelected,
    setRegioesSelected,
    ufsSelected,
    setUfsSelected,
    competidoresSelected,
    setCompetidoresSelected,
    playersOptions,
    applyFilters,
    clearFilters,
    showToast,
    chartColors: _chartColors,
    charts,
    compData,
    exportOpen,
    openExportModal,
    closeExportModal,
    exportRange,
    setExportRange,
    exportRegioes,
    setExportRegioes,
    exportUfs,
    setExportUfs,
    exportMercados,
    setExportMercados,
    exportFilters,
    fetchExportCount,
    excelLoading,
    csvLoading,
    onExportExcel,
    onExportCsv,
  } = useMarketShareData();

  if (!opcoes) return <></>;
  if (visLoading || !visible) return <></>;

  const fmtLabel = (d: string) => {
    try {
      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${MONTHS[parseInt(d.slice(5,7),10)-1]}, ${d.slice(0,4)}`;
    } catch { return d; }
  };

  return (
    <div>
      <NavBar />

      {showToast && (
        <div
          id="toast-filters"
          className="alert alert-success"
          role="alert"
          style={{
            fontFamily: "Arial",
            fontSize: 13,
            padding: "10px 14px",
            border: "none",
            boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          }}
        >
          Filters applied!
        </div>
      )}

      <div className="container-fluid g-0">
        <div className="row g-0">
          {/* Sidebar */}
          <div
            className="col-xxl-2 col-md-3 p-0"
            style={{ display: "flex", flexDirection: "column" }}
          >
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                <PeriodSlider
                  dates={datas}
                  value={sliderRange}
                  onChange={setSliderRange}
                  sliderId="ms-slider-period"
                  fmtLabel={fmtLabel}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View Mode</div>
                <SegmentedToggle
                  options={MODE_OPTIONS.map((m) => ({ value: m, label: m }))}
                  value={mode}
                  onChange={setMode}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Competitors</div>
                {mode === "Others" ? (
                  <SearchableMultiSelect
                    options={playersOptions}
                    value={competidoresSelected}
                    onChange={setCompetidoresSelected}
                  />
                ) : (
                  <CheckList
                    label="Competitors"
                    options={playersOptions}
                    value={competidoresSelected}
                    onChange={setCompetidoresSelected}
                    allLabel="All"
                    clearLabel="Clear"
                  />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Region / State</div>
                <RegionStateFilter
                  regioes={regioesAll}
                  ufs={ufsAll}
                  selectedRegioes={regioesSelected}
                  selectedUfs={ufsSelected}
                  onRegioesChange={setRegioesSelected}
                  onUfsChange={setUfsSelected}
                />
              </div>

              <div className="row g-1 mt-1">
                <div className="col-6">
                  <button type="button" className="btn btn-apply" onClick={applyFilters}>
                    Apply
                  </button>
                </div>
                <div className="col-6">
                  <button type="button" className="btn btn-clear" onClick={clearFilters}>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Brazil Fuel Distribution Market Share"
                sub="Temporal evolution of market share by distributor (%)"
                lang="en"
                hideDivider
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formated data .xl",
                        disabled: seriesLoading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                      {
                        kind: "csv",
                        label: "all data .csv",
                        disabled: seriesLoading || excelLoading || csvLoading,
                        onClick: openExportModal,
                      },
                    ]}
                  />
                }
              />

              {seriesLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  {/* ─ Diesel B ─ */}
                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Diesel B</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.dieselRetail.data ?? []}
                          layout={charts?.dieselRetail.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselRetail} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.dieselB2B.data ?? []}
                          layout={charts?.dieselB2B.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselB2B} />}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>TRR</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.dieselTrR.data ?? []}
                          layout={charts?.dieselTrR.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselTrR} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.dieselTotal.data ?? []}
                          layout={charts?.dieselTotal.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.dieselTotal} />}
                      </div>
                    </div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  {/* ─ Gasoline C ─ */}
                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Gasoline C</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.gasRetail.data ?? []}
                          layout={charts?.gasRetail.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.gasRetail} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.gasB2B.data ?? []}
                          layout={charts?.gasB2B.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.gasB2B} />}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.gasTotal.data ?? []}
                          layout={charts?.gasTotal.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.gasTotal} />}
                      </div>
                    </div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  {/* ─ Hydrous Ethanol ─ */}
                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Hydrous Ethanol</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.ethRetail.data ?? []}
                          layout={charts?.ethRetail.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ethRetail} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.ethB2B.data ?? []}
                          layout={charts?.ethB2B.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ethB2B} />}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.ethTotal.data ?? []}
                          layout={charts?.ethTotal.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ethTotal} />}
                      </div>
                    </div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  {/* ─ Otto-Cycle ─ */}
                  <div style={{ marginBottom: 10 }}>
                    <div className="section-title" style={{ color: "#1a1a1a" }}>Otto-Cycle</div>
                    <hr className="section-hr" />
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Retail</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.ottoRetail.data ?? []}
                          layout={charts?.ottoRetail.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ottoRetail} />}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>B2B</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.ottoB2B.data ?? []}
                          layout={charts?.ottoB2B.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ottoB2B} />}
                      </div>
                    </div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 15 }}>Total</div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={charts?.ottoTotal.data ?? []}
                          layout={charts?.ottoTotal.layout ?? {}}
                          config={{ displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                        {compData && <ComparisonTable rows={compData.ottoTotal} />}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─ Export Modal ─ */}
      <ExportModal
        open={exportOpen}
        onClose={closeExportModal}
        title="Export — Market Share"
        datasetKey="vendas"
        currentFilters={exportFilters}
        countFetcher={fetchExportCount}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={onExportExcel}
        onExportCsv={onExportCsv}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 6,
                  color: "#1a1a1a",
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                }}
              >
                Period
              </div>
              {datas.length > 0 && (
                <PeriodSlider
                  dates={datas}
                  value={exportRange}
                  onChange={setExportRange}
                  sliderId="ms-export-slider"
                  fmtLabel={fmtLabel}
                />
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: "#1a1a1a",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                  }}
                >
                  Regions
                </div>
                <CheckList
                  label="Regions"
                  options={regioesAll}
                  value={exportRegioes}
                  onChange={setExportRegioes}
                  allLabel="All"
                  clearLabel="Clear"
                />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: "#1a1a1a",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                  }}
                >
                  States
                </div>
                <SearchableMultiSelect
                  options={ufsAll}
                  value={exportUfs}
                  onChange={setExportUfs}
                />
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 6,
                  color: "#1a1a1a",
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                }}
              >
                Markets
              </div>
              <CheckList
                label="Markets"
                options={mercadosAll}
                value={exportMercados}
                onChange={setExportMercados}
                allLabel="All"
                clearLabel="Clear"
              />
            </div>
          </div>
        }
      />
    </div>
  );
}

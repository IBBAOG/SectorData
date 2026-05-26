"use client";

// Desktop View — ANP CDP Diaria (≥769px).
//
// Verbatim move of the previous page.tsx body, except all data state has been
// lifted into useAnpCdpDiariaData. The View now reads from the hook and only
// owns presentation concerns (layout, JSX composition, copy).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here
// must land in mobile/View.tsx in the SAME commit, OR the commit message must
// declare [desktop-only] with an explicit reason.

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
import { bblDiaToKbpd } from "../../../../lib/units";

import {
  useAnpCdpDiariaData,
  fmtNumber,
  TOP_N,
  type Granularity,
} from "../useAnpCdpDiariaData";

export default function DesktopView(): React.ReactElement | null {
  const {
    visible, visLoading,
    loading, serieLoading,
    granularity, setGranularity,
    campos, bacias, instalacoes, pocos,
    allDates, dateRange, setDateRange, hasDates, periodBadge,
    selectedCampos, setSelectedCampos,
    selectedBacias, setSelectedBacias, toggleBacia,
    selectedInstalacoes, setSelectedInstalacoes,
    selectedPocos, setSelectedPocos,
    serieRows, visibleRows,
    explicitDims,
    petroleoChart, gasChart,
    tableRows,
    dimLabel, datasetKey,
    headerTitle, headerSub,
    exportOpen, setExportOpen,
    excelLoading, csvLoading,
    exportCampos, setExportCampos,
    exportBacias, setExportBacias,
    exportInstalacoes, setExportInstalacoes,
    exportPocos, setExportPocos,
    exportRange, setExportRange,
    exportFilters,
    openExportModal,
    estimateExportRows, handleExportExcel, handleExportCsv,
  } = useAnpCdpDiariaData();

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              {/* Granularity toggle */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Granularity</div>
                <SegmentedToggle<Granularity>
                  value={granularity}
                  onChange={setGranularity}
                  options={[
                    { value: "field",        label: "Field" },
                    { value: "installation", label: "Installation" },
                    { value: "well",         label: "Well" },
                  ]}
                />
              </div>

              <div className="sidebar-section-label">Filters</div>

              {/* Basin (Field & Well only) */}
              {(granularity === "field" || granularity === "well") && (
                <MultiSelectFilter
                  label={`Basin (${selectedBacias.length || bacias.length}/${bacias.length})`}
                  items={bacias}
                  selected={selectedBacias}
                  onToggle={toggleBacia}
                  onClear={selectedBacias.length > 0 ? () => setSelectedBacias([]) : undefined}
                  idPrefix="cdpd-bacia"
                  emptyMeansAll
                  counterTotal={bacias.length}
                />
              )}

              {/* Field (all levels) */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Field{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length}/{campos.length})
                  </span>
                </div>
                <SearchableMultiSelect
                  options={campos}
                  value={selectedCampos}
                  onChange={setSelectedCampos}
                />
                {granularity === "field" && selectedCampos.length === 0 && (
                  <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
                    No selection: charts show Top {TOP_N} by average in the period.
                  </div>
                )}
              </div>

              {/* Installation (Installation only) */}
              {granularity === "installation" && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    Installation{" "}
                    <span style={{ color: "#888", fontWeight: 400 }}>
                      ({selectedInstalacoes.length}/{instalacoes.length})
                    </span>
                  </div>
                  <SearchableMultiSelect
                    options={instalacoes}
                    value={selectedInstalacoes}
                    onChange={setSelectedInstalacoes}
                  />
                  {selectedInstalacoes.length === 0 && (
                    <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
                      No selection: charts show Top {TOP_N} by average in the period.
                    </div>
                  )}
                </div>
              )}

              {/* Well (Well only) */}
              {granularity === "well" && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    Well{" "}
                    <span style={{ color: "#888", fontWeight: 400 }}>
                      ({selectedPocos.length}/{pocos.length})
                    </span>
                  </div>
                  <SearchableMultiSelect
                    options={pocos}
                    value={selectedPocos}
                    onChange={setSelectedPocos}
                  />
                  {selectedPocos.length === 0 && (
                    <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
                      No selection: charts show Top {TOP_N} by average in the period.
                    </div>
                  )}
                </div>
              )}

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasDates && (
                  <PeriodSlider dates={allDates} value={dateRange} onChange={setDateRange} />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title={headerTitle}
                sub={headerSub}
                period={periodBadge}
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
              ) : serieRows.length === 0 ? (
                <div style={{
                  padding: "40px 24px", textAlign: "center", color: "#888",
                  fontFamily: "Arial", fontSize: 14, border: "1px dashed #ddd",
                  borderRadius: 8, marginTop: 12,
                }}>
                  No {dimLabel.en.toLowerCase()} production data yet.
                  {granularity !== "field" && " This level's ETL runs 3×/day — wait for the first pull post-deploy."}
                </div>
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={
                          explicitDims.length > 0
                            ? `Oil (kbpd) — ${explicitDims.length} ${dimLabel.plural} selected`
                            : `Oil (kbpd) — Top ${TOP_N} ${dimLabel.singular.toLowerCase()}(s) by average in the period`
                        }
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={petroleoChart.data}
                          layout={petroleoChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={
                          explicitDims.length > 0
                            ? `Gas (Mm³/day) — ${explicitDims.length} ${dimLabel.plural} selected`
                            : `Gas (Mm³/day) — Top ${TOP_N} ${dimLabel.singular.toLowerCase()}(s) by average in the period`
                        }
                        loading={serieLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={gasChart.data}
                          layout={gasChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`Production by ${dimLabel.en} — most recent records (${tableRows.length.toLocaleString("pt-BR")} of ${visibleRows.length.toLocaleString("pt-BR")})`}
                        loading={serieLoading}
                      >
                        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto", border: "1px solid #eee", borderRadius: 6 }}>
                          <table className="table table-sm" style={{ fontFamily: "Arial", fontSize: 12, marginBottom: 0 }}>
                            <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 1, borderBottom: "2px solid #1a1a1a" }}>
                              <tr>
                                <th style={{ padding: "8px 12px", textAlign: "left" }}>Date</th>
                                {granularity === "field" && (
                                  <>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Basin</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
                                  </>
                                )}
                                {granularity === "installation" && (
                                  <>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Installation</th>
                                  </>
                                )}
                                {granularity === "well" && (
                                  <>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Basin</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
                                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Well</th>
                                  </>
                                )}
                                <th style={{ padding: "8px 12px", textAlign: "right" }}>Oil (kbpd)</th>
                                <th style={{ padding: "8px 12px", textAlign: "right" }}>Gas (Mm³/day)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tableRows.map((r, i) => (
                                <tr key={`${r.data}-${r.campo}-${r.dimension}-${i}`}>
                                  <td style={{ padding: "6px 12px" }}>{r.data}</td>
                                  {granularity === "field" && (
                                    <>
                                      <td style={{ padding: "6px 12px" }}>{r.bacia ?? "—"}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.campo}</td>
                                    </>
                                  )}
                                  {granularity === "installation" && (
                                    <>
                                      <td style={{ padding: "6px 12px" }}>{r.campo}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.dimension}</td>
                                    </>
                                  )}
                                  {granularity === "well" && (
                                    <>
                                      <td style={{ padding: "6px 12px" }}>{r.bacia ?? "—"}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.campo}</td>
                                      <td style={{ padding: "6px 12px" }}>{r.dimension}</td>
                                    </>
                                  )}
                                  <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(r.petroleo_bbl_dia == null ? null : bblDiaToKbpd(r.petroleo_bbl_dia), 1)}</td>
                                  <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(r.gas_mm3_dia, 3)}</td>
                                </tr>
                              ))}
                              {tableRows.length === 0 && (
                                <tr>
                                  <td colSpan={granularity === "well" ? 6 : 5} style={{ padding: "16px 12px", color: "#888", textAlign: "center" }}>
                                    No data for the current filters.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </ChartSection>
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
        title={`Export — Daily Production (${dimLabel.en})`}
        datasetKey={datasetKey}
        currentFilters={exportFilters}
        countFetcher={estimateExportRows}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={handleExportExcel}
        onExportCsv={handleExportCsv}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Period</div>
              {hasDates && (
                <PeriodSlider dates={allDates} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            {(granularity === "field" || granularity === "well") && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Basins <span style={{ color: "#888", fontWeight: 400 }}>({exportBacias.length === 0 ? bacias.length : exportBacias.length}/{bacias.length})</span>
                </div>
                <MultiSelectFilter
                  label="Basins"
                  items={bacias}
                  selected={exportBacias}
                  onToggle={(b) =>
                    setExportBacias(
                      exportBacias.includes(b)
                        ? exportBacias.filter(x => x !== b)
                        : [...exportBacias, b],
                    )
                  }
                  onClear={exportBacias.length > 0 ? () => setExportBacias([]) : undefined}
                  idPrefix="cdpd-export-bacia"
                />
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Fields <span style={{ color: "#888", fontWeight: 400 }}>({exportCampos.length === 0 ? campos.length : exportCampos.length}/{campos.length})</span>
              </div>
              <SearchableMultiSelect
                options={campos}
                value={exportCampos}
                onChange={setExportCampos}
              />
            </div>

            {granularity === "installation" && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Installations <span style={{ color: "#888", fontWeight: 400 }}>({exportInstalacoes.length === 0 ? instalacoes.length : exportInstalacoes.length}/{instalacoes.length})</span>
                </div>
                <SearchableMultiSelect
                  options={instalacoes}
                  value={exportInstalacoes}
                  onChange={setExportInstalacoes}
                />
              </div>
            )}

            {granularity === "well" && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Wells <span style={{ color: "#888", fontWeight: 400 }}>({exportPocos.length === 0 ? pocos.length : exportPocos.length}/{pocos.length})</span>
                </div>
                <SearchableMultiSelect
                  options={pocos}
                  value={exportPocos}
                  onChange={setExportPocos}
                />
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}

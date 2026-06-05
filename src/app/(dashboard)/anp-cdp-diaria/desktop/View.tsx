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
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import { bblDiaToKbpd } from "../../../../lib/units";

// Unified export library (worker_subgerente-app / worker_designer own the
// internals; this dashboard only consumes <ExportButton spec={...} />).
import { ExportButton } from "@/lib/export";
import { anpCdpDiariaExport } from "@/lib/export/dashboards/anpCdpDiaria";

import type { Layout, PlotData } from "plotly.js";
import {
  useAnpCdpDiariaData,
  fmtNumber,
  formatStakePct,
  TOP_N,
  BRAND_ORANGE,
  FEATURED_COMPANIES,
  type Granularity,
  type CompanyFieldAggregate,
  type CompanyFieldNoData,
  type AnpCdpDiariaEmpresa,
} from "../useAnpCdpDiariaData";

export default function DesktopView(): React.ReactElement | null {
  const {
    visible, visLoading,
    loading, serieLoading,
    granularity, setGranularity,
    campos, instalacoes, pocos,
    allDates, dateRange, setDateRange, hasDates, periodBadge,
    selectedCampos, setSelectedCampos,
    selectedInstalacoes, setSelectedInstalacoes,
    selectedPocos, setSelectedPocos,
    serieRows, visibleRows,
    explicitDims,
    petroleoChart, gasChart,
    tableRows,
    dimLabel,
    headerTitle, headerSub,
    // Company level
    empresas, selectedEmpresa, setSelectedEmpresa,
    companySerieRows,
    companyFieldAggregates, companyFieldsNoData,
    companyTotalOilNetAvg, companyTotalGasNetAvg,
    companyPetroleoChart, companyGasChart,
  } = useAnpCdpDiariaData();

  const isCompany = granularity === "company";

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
                    { value: "company",      label: "Company" },
                  ]}
                />
              </div>

              {/* Company selector (Company only) */}
              {isCompany && (
                <>
                  <div className="sidebar-section-label">Company</div>
                  <div className="sidebar-filter-section">
                    <CompanySelector
                      empresas={empresas}
                      selected={selectedEmpresa}
                      onSelect={setSelectedEmpresa}
                    />
                  </div>
                </>
              )}

              {!isCompany && <div className="sidebar-section-label">Filters</div>}

              {/* Field (Field / Installation / Well) */}
              {!isCompany && (
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
              )}

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
                rightSlot={<ExportButton spec={anpCdpDiariaExport} />}
              />

              {loading ? (
                <BarrelLoading />
              ) : isCompany ? (
                <CompanyContent
                  selectedEmpresa={selectedEmpresa}
                  serieLoading={serieLoading}
                  companySerieRows={companySerieRows}
                  companyFieldAggregates={companyFieldAggregates}
                  companyFieldsNoData={companyFieldsNoData}
                  companyTotalOilNetAvg={companyTotalOilNetAvg}
                  companyTotalGasNetAvg={companyTotalGasNetAvg}
                  companyPetroleoChart={companyPetroleoChart}
                  companyGasChart={companyGasChart}
                />
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
    </div>
  );
}

// ─── Company-level sub-components ───────────────────────────────────────────

/** Single-select company picker: PRIO / Petrobras pills + dropdown for the rest. */
function CompanySelector({
  empresas,
  selected,
  onSelect,
}: {
  empresas: AnpCdpDiariaEmpresa[];
  selected: string | null;
  onSelect: (e: string | null) => void;
}): React.ReactElement {
  const featured = FEATURED_COMPANIES.filter(f => empresas.some(e => e.empresa === f));
  const others = empresas.filter(e => !FEATURED_COMPANIES.includes(e.empresa));
  const coverage = (name: string) => {
    const e = empresas.find(x => x.empresa === name);
    return e ? `${e.n_campos_com_dado}/${e.n_campos_stake}` : null;
  };

  return (
    <div>
      {/* Featured pills */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {featured.map(name => {
          const active = selected === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(name)}
              style={{
                minHeight: 30,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: active ? BRAND_ORANGE : "#e0e0e0",
                background: active ? "rgba(255,80,0,0.10)" : "#fff",
                color: active ? BRAND_ORANGE : "#555",
                fontFamily: "Arial",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {name}
              {coverage(name) && (
                <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>
                  {coverage(name)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Other companies dropdown (single-select) */}
      <select
        value={selected && !FEATURED_COMPANIES.includes(selected) ? selected : ""}
        onChange={e => onSelect(e.target.value || null)}
        className="form-select form-select-sm"
        style={{ fontFamily: "Arial", fontSize: 12 }}
      >
        <option value="">More companies…</option>
        {others.map(e => (
          <option key={e.empresa} value={e.empresa}>
            {e.empresa} ({e.n_campos_com_dado}/{e.n_campos_stake})
          </option>
        ))}
      </select>

      <div style={{ fontSize: 11, color: "#888", marginTop: 8, paddingLeft: 2, lineHeight: 1.4 }}>
        Net = field daily production × the company&apos;s stake. Coverage shows
        fields with daily data / total stake-held fields.
      </div>
    </div>
  );
}

/** Main content for the Company level: net charts + per-field net table + coverage note. */
function CompanyContent({
  selectedEmpresa,
  serieLoading,
  companySerieRows,
  companyFieldAggregates,
  companyFieldsNoData,
  companyTotalOilNetAvg,
  companyTotalGasNetAvg,
  companyPetroleoChart,
  companyGasChart,
}: {
  selectedEmpresa: string | null;
  serieLoading: boolean;
  companySerieRows: unknown[];
  companyFieldAggregates: CompanyFieldAggregate[];
  companyFieldsNoData: CompanyFieldNoData[];
  companyTotalOilNetAvg: number;
  companyTotalGasNetAvg: number;
  companyPetroleoChart: { data: PlotData[]; layout: Partial<Layout> };
  companyGasChart: { data: PlotData[]; layout: Partial<Layout> };
}): React.ReactElement {
  if (!selectedEmpresa) {
    return (
      <div style={{
        padding: "40px 24px", textAlign: "center", color: "#888",
        fontFamily: "Arial", fontSize: 14, border: "1px dashed #ddd",
        borderRadius: 8, marginTop: 12,
      }}>
        Select a company to see its stake-weighted daily net production.
      </div>
    );
  }

  if (companySerieRows.length === 0 && !serieLoading) {
    return (
      <div style={{
        padding: "40px 24px", textAlign: "center", color: "#888",
        fontFamily: "Arial", fontSize: 14, border: "1px dashed #ddd",
        borderRadius: 8, marginTop: 12,
      }}>
        No daily data for {selectedEmpresa} in the selected period.
      </div>
    );
  }

  return (
    <>
      {/* KPI strip: net averages over the period */}
      <div className="row mb-2 g-2">
        <div className="col-6 col-lg-3">
          <KpiCard label="Net Oil (avg)" value={`${fmtNumber(companyTotalOilNetAvg / 1000, 1)} kbpd`} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiCard label="Net Gas (avg)" value={`${fmtNumber(companyTotalGasNetAvg, 3)} Mm³/d`} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiCard label="Fields w/ daily data" value={`${companyFieldAggregates.length}`} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiCard label="Fields awaiting data" value={`${companyFieldsNoData.length}`} />
        </div>
      </div>

      {/* Oil net chart */}
      <div className="row mb-2">
        <div className="col-12">
          <ChartSection title={`Net Oil (kbpd) — ${selectedEmpresa} total + by field`} loading={serieLoading} height={320}>
            <PlotlyChart
              data={companyPetroleoChart.data}
              layout={companyPetroleoChart.layout}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: 320 }}
            />
          </ChartSection>
        </div>
      </div>

      {/* Gas net chart */}
      <div className="row mb-2">
        <div className="col-12">
          <ChartSection title={`Net Gas (Mm³/day) — ${selectedEmpresa} total + by field`} loading={serieLoading} height={320}>
            <PlotlyChart
              data={companyGasChart.data}
              layout={companyGasChart.layout}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: 320 }}
            />
          </ChartSection>
        </div>
      </div>

      {/* Per-field net table */}
      <div className="row mb-2">
        <div className="col-12">
          <ChartSection title={`Net production by field — ${selectedEmpresa}`} loading={serieLoading}>
            <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 6 }}>
              <table className="table table-sm" style={{ fontFamily: "Arial", fontSize: 12, marginBottom: 0 }}>
                <thead style={{ background: "#fff", borderBottom: "2px solid #1a1a1a" }}>
                  <tr>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Field</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Basin</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Stake %</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Net Oil avg (kbpd)</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Net Gas avg (Mm³/d)</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Latest Net Oil</th>
                    <th style={{ padding: "8px 12px", textAlign: "right" }}>Latest Net Gas</th>
                    <th style={{ padding: "8px 12px", textAlign: "left" }}>Latest date</th>
                  </tr>
                </thead>
                <tbody>
                  {companyFieldAggregates.map(f => (
                    <tr key={f.campo}>
                      <td style={{ padding: "6px 12px" }}>{f.campo}</td>
                      <td style={{ padding: "6px 12px" }}>{f.bacia ?? "—"}</td>
                      <td style={{ padding: "6px 12px", textAlign: "right" }}>{formatStakePct(f.stakePct)}</td>
                      <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(f.avgOilNet / 1000, 1)}</td>
                      <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(f.avgGasNet, 3)}</td>
                      <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(f.latestOilNet == null ? null : f.latestOilNet / 1000, 1)}</td>
                      <td style={{ padding: "6px 12px", textAlign: "right" }}>{fmtNumber(f.latestGasNet, 3)}</td>
                      <td style={{ padding: "6px 12px" }}>{f.latestDate ?? "—"}</td>
                    </tr>
                  ))}
                  {companyFieldAggregates.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: "16px 12px", color: "#888", textAlign: "center" }}>
                        No data for the current period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Coverage note: stake-held fields without daily data */}
            {companyFieldsNoData.length > 0 && (
              <div style={{ fontSize: 12, color: "#888", marginTop: 10, paddingLeft: 2, lineHeight: 1.5 }}>
                Not yet in the daily feed:{" "}
                {companyFieldsNoData
                  .map(f => `${f.campo} (${formatStakePct(f.stakePct)})`)
                  .join(", ")}
                .
              </div>
            )}
          </ChartSection>
        </div>
      </div>
    </>
  );
}

/** Compact KPI tile for the Company level. */
function KpiCard({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{
      border: "1px solid #eee", borderRadius: 8, padding: "12px 14px",
      background: "#fff", height: "100%",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: "#1a1a1a", fontFamily: "Arial" }}>
        {value}
      </div>
    </div>
  );
}

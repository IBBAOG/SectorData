"use client";

// Desktop View — ANP CDP Daily Production (≥769px).
//
// Two-Tier Tabs IA (2026-06-05) — redesign per CTO/user brief:
//   A primary tab bar at the top of the content column:
//     [ PRIO ]  [ Petrobras ]  [ Explore raw data ]
//   • PRIO / Petrobras  → company net production view (CompanyContent, verbatim
//     from the previous build). PRIO is the landing default (zero clicks).
//   • Explore raw data  → granular surface with sub-tabs [ Field | Installation ]
//     plus a discreet "Well-level (advanced) >" affordance that reveals the
//     Well level (3 clicks deep, desktop-only).
//
// The active primary tab derives from hook state:
//   granularity === "company"  → active tab = selectedEmpresa (PRIO/Petrobras)
//   granularity ∈ {field,installation,well} → active tab = "Explore raw data"
//
// Lazy-mount discipline: clicking a company tab sets granularity="company";
// clicking "Explore raw data" sets granularity="field". The heavy level RPCs
// (especially the ~180k-row Well one) only fire once Explore is opened.
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
  OTHERS_COLOR,
  FIXED_COMPANIES,
  type Granularity,
  type CompanyDailyOilMatrix,
  type CompanyFieldNoData,
} from "../useAnpCdpDiariaData";

// Sub-tabs inside "Explore raw data" that map directly to a granularity.
type ExploreLevel = "field" | "installation";

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
    selectedEmpresa, setSelectedEmpresa,
    companySerieRows,
    companyDailyOilMatrix, companyFieldsNoData,
    companyPetroleoChart, companyMonthlyOilChart,
  } = useAnpCdpDiariaData();

  const isCompany = granularity === "company";

  // Primary-tab dispatch. PRIO / Petrobras select the company; Explore opens
  // the granular surface at the Field sub-tab (lazy-mount of the level RPCs).
  function selectCompanyTab(name: string) {
    setSelectedEmpresa(name);
    if (granularity !== "company") setGranularity("company");
  }
  function selectExploreTab() {
    if (granularity === "company") setGranularity("field");
  }

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar (logo + period only) ──────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasDates && (
                  <PeriodSlider dates={allDates} value={dateRange} onChange={setDateRange} />
                )}
              </div>

              <div style={{ fontSize: 11, color: "#888", marginTop: 10, paddingLeft: 2, lineHeight: 1.5 }}>
                Net = field daily production × the company&apos;s stake.
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

              {/* Primary tab bar: [PRIO] [Petrobras] [Explore raw data] */}
              <PrimaryTabBar
                companies={FIXED_COMPANIES as readonly string[]}
                activeCompany={isCompany ? selectedEmpresa : null}
                exploreActive={!isCompany}
                onSelectCompany={selectCompanyTab}
                onSelectExplore={selectExploreTab}
              />

              {loading ? (
                <BarrelLoading />
              ) : isCompany ? (
                <CompanyContent
                  selectedEmpresa={selectedEmpresa}
                  serieLoading={serieLoading}
                  companySerieRows={companySerieRows}
                  companyDailyOilMatrix={companyDailyOilMatrix}
                  companyFieldsNoData={companyFieldsNoData}
                  companyPetroleoChart={companyPetroleoChart}
                  companyMonthlyOilChart={companyMonthlyOilChart}
                />
              ) : (
                <ExploreSurface
                  granularity={granularity}
                  setGranularity={setGranularity}
                  serieLoading={serieLoading}
                  campos={campos}
                  instalacoes={instalacoes}
                  pocos={pocos}
                  selectedCampos={selectedCampos}
                  setSelectedCampos={setSelectedCampos}
                  selectedInstalacoes={selectedInstalacoes}
                  setSelectedInstalacoes={setSelectedInstalacoes}
                  selectedPocos={selectedPocos}
                  setSelectedPocos={setSelectedPocos}
                  serieRows={serieRows}
                  visibleRows={visibleRows}
                  explicitDims={explicitDims}
                  petroleoChart={petroleoChart}
                  gasChart={gasChart}
                  tableRows={tableRows}
                  dimLabel={dimLabel}
                />
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Primary tab bar ────────────────────────────────────────────────────────

/**
 * Top-of-content tab bar. PRIO / Petrobras are company tabs; "Explore raw data"
 * opens the granular surface. The active tab is brand orange (underline + text)
 * — true tabs, not the sliding-pill SegmentedToggle.
 */
function PrimaryTabBar({
  companies,
  activeCompany,
  exploreActive,
  onSelectCompany,
  onSelectExplore,
}: {
  companies: readonly string[];
  activeCompany: string | null;
  exploreActive: boolean;
  onSelectCompany: (name: string) => void;
  onSelectExplore: () => void;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 4,
        borderBottom: "1px solid #e0e0e0",
        marginBottom: 16,
      }}
    >
      {companies.map(name => (
        <PrimaryTab
          key={name}
          label={name}
          active={activeCompany === name}
          onClick={() => onSelectCompany(name)}
        />
      ))}
      {/* Visual separator before the secondary "Explore" entry. */}
      <div style={{ flex: 1 }} />
      <PrimaryTab
        label="Explore raw data"
        active={exploreActive}
        onClick={onSelectExplore}
        secondary
      />
    </div>
  );
}

function PrimaryTab({
  label,
  active,
  onClick,
  secondary = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  secondary?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        position: "relative",
        background: "transparent",
        border: "none",
        borderBottom: active ? `3px solid ${BRAND_ORANGE}` : "3px solid transparent",
        marginBottom: -1,
        padding: secondary ? "10px 14px" : "10px 18px",
        fontFamily: "Arial",
        fontSize: secondary ? 13 : 15,
        fontWeight: active ? 700 : secondary ? 500 : 600,
        color: active ? BRAND_ORANGE : secondary ? "#888" : "#555",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "color 0.15s",
      }}
    >
      {label}
    </button>
  );
}

// ─── Explore raw data surface ───────────────────────────────────────────────

/**
 * Granular exploration surface: sub-tabs [Field | Installation] + a discreet
 * "Well-level (advanced) >" affordance. Reuses the relocated level filters,
 * the Oil/Gas line charts and the recent-records table — same brain, demoted
 * placement. Caption flags the data as unweighted (gross, all operators).
 */
function ExploreSurface({
  granularity,
  setGranularity,
  serieLoading,
  campos,
  instalacoes,
  pocos,
  selectedCampos,
  setSelectedCampos,
  selectedInstalacoes,
  setSelectedInstalacoes,
  selectedPocos,
  setSelectedPocos,
  serieRows,
  visibleRows,
  explicitDims,
  petroleoChart,
  gasChart,
  tableRows,
  dimLabel,
}: {
  granularity: Granularity;
  setGranularity: (g: Granularity) => void;
  serieLoading: boolean;
  campos: string[];
  instalacoes: string[];
  pocos: string[];
  selectedCampos: string[];
  setSelectedCampos: (v: string[]) => void;
  selectedInstalacoes: string[];
  setSelectedInstalacoes: (v: string[]) => void;
  selectedPocos: string[];
  setSelectedPocos: (v: string[]) => void;
  serieRows: ReturnType<typeof useAnpCdpDiariaData>["serieRows"];
  visibleRows: ReturnType<typeof useAnpCdpDiariaData>["visibleRows"];
  explicitDims: string[];
  petroleoChart: { data: PlotData[]; layout: Partial<Layout> };
  gasChart: { data: PlotData[]; layout: Partial<Layout> };
  tableRows: ReturnType<typeof useAnpCdpDiariaData>["tableRows"];
  dimLabel: { singular: string; plural: string; en: string };
}): React.ReactElement {
  const isWell = granularity === "well";
  // The sub-tab control only toggles Field ↔ Installation. Well is reached via
  // the advanced affordance (and stays out of the SegmentedToggle).
  const subTabValue: ExploreLevel = granularity === "installation" ? "installation" : "field";

  return (
    <div>
      {/* Caption — signals gross vs net */}
      <div style={{ fontSize: 12, color: "#888", marginBottom: 10, fontFamily: "Arial" }}>
        Unweighted ANP daily feed — all operators.
      </div>

      {/* Sub-tabs [Field | Installation] + advanced Well affordance */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 220, maxWidth: 320, flex: "0 1 280px" }}>
          <SegmentedToggle<ExploreLevel>
            value={subTabValue}
            onChange={(v) => setGranularity(v)}
            options={[
              { value: "field",        label: "Field" },
              { value: "installation", label: "Installation" },
            ]}
          />
        </div>

        {/* Well-level (advanced) — the most hidden entry (hardcore only). */}
        <button
          type="button"
          onClick={() => setGranularity(isWell ? "field" : "well")}
          style={{
            background: "transparent",
            border: "none",
            padding: "4px 2px",
            fontFamily: "Arial",
            fontSize: 12,
            fontWeight: isWell ? 700 : 400,
            color: isWell ? BRAND_ORANGE : "#888",
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationStyle: "dashed",
            textUnderlineOffset: 3,
            whiteSpace: "nowrap",
          }}
          title="Well-level production (advanced)"
        >
          {isWell ? "← Back to Field / Installation" : "Well-level (advanced) ›"}
        </button>
      </div>

      {/* Level filter (relocated from the sidebar) */}
      <div className="row mb-2">
        <div className="col-12 col-lg-6 col-xl-4">
          {granularity === "field" && (
            <ExploreFilter
              label="Field"
              count={selectedCampos.length}
              total={campos.length}
              options={campos}
              value={selectedCampos}
              onChange={setSelectedCampos}
            />
          )}
          {granularity === "installation" && (
            <ExploreFilter
              label="Installation"
              count={selectedInstalacoes.length}
              total={instalacoes.length}
              options={instalacoes}
              value={selectedInstalacoes}
              onChange={setSelectedInstalacoes}
            />
          )}
          {granularity === "well" && (
            <ExploreFilter
              label="Well"
              count={selectedPocos.length}
              total={pocos.length}
              options={pocos}
              value={selectedPocos}
              onChange={setSelectedPocos}
            />
          )}
        </div>
      </div>

      {serieRows.length === 0 ? (
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
  );
}

/** A single relocated level filter (Field / Installation / Well). */
function ExploreFilter({
  label,
  count,
  total,
  options,
  value,
  onChange,
}: {
  label: string;
  count: number;
  total: number;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}): React.ReactElement {
  return (
    <div className="sidebar-filter-section">
      <div className="sidebar-filter-label">
        {label}{" "}
        <span style={{ color: "#888", fontWeight: 400 }}>
          ({count}/{total})
        </span>
      </div>
      <SearchableMultiSelect options={options} value={value} onChange={onChange} />
      {count === 0 && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 6, paddingLeft: 2 }}>
          No selection: charts show Top {TOP_N} by average in the period.
        </div>
      )}
    </div>
  );
}

// ─── Company-level content (verbatim from the previous build) ───────────────

/** Main content for the Company level: net charts + daily net-oil matrix + coverage note. */
function CompanyContent({
  selectedEmpresa,
  serieLoading,
  companySerieRows,
  companyDailyOilMatrix,
  companyFieldsNoData,
  companyPetroleoChart,
  companyMonthlyOilChart,
}: {
  selectedEmpresa: string | null;
  serieLoading: boolean;
  companySerieRows: unknown[];
  companyDailyOilMatrix: CompanyDailyOilMatrix;
  companyFieldsNoData: CompanyFieldNoData[];
  companyPetroleoChart: { data: PlotData[]; layout: Partial<Layout> };
  companyMonthlyOilChart: { data: PlotData[]; layout: Partial<Layout> };
}): React.ReactElement {
  // PRIO is always selected on landing — the only empty state worth handling is
  // "no daily data in the selected period".
  if (companySerieRows.length === 0 && !serieLoading) {
    return (
      <div style={{
        padding: "40px 24px", textAlign: "center", color: "#888",
        fontFamily: "Arial", fontSize: 14, border: "1px dashed #ddd",
        borderRadius: 8, marginTop: 12,
      }}>
        No daily data for {selectedEmpresa ?? "this company"} in the selected period.
      </div>
    );
  }

  return (
    <>
      {/* Monthly average net oil by field (stacked bar, MtD-aware) — the
          per-bar total label (stack height) replaces the old KPI strip. */}
      <div className="row mb-2">
        <div className="col-12">
          <ChartSection
            title={
              <span>
                Net Oil — Monthly Average by Field (kbpd)
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "#888" }}>
                  Stake-weighted · current month is month-to-date
                </span>
              </span>
            }
            loading={serieLoading}
            height={320}
          >
            <PlotlyChart
              data={companyMonthlyOilChart.data}
              layout={companyMonthlyOilChart.layout}
              config={{ responsive: true, displayModeBar: false }}
              style={{ width: "100%", height: 320 }}
            />
          </ChartSection>
        </div>
      </div>

      {/* Oil net line chart (daily total + per-field) */}
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

      {/* Daily net-oil matrix: columns = CAMPO (stake%), rows = one per day desc */}
      <div className="row mb-2">
        <div className="col-12">
          <ChartSection
            title={
              <span>
                Daily net oil by field — {selectedEmpresa}
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "#888" }}>
                  Net oil (kbpd), stake-weighted · one row per day
                  {companyDailyOilMatrix.fields.some(f => f.isOthers) &&
                    " · top 6 fields; rest grouped as Others (full breakdown in Explore raw data)"}
                </span>
              </span>
            }
            loading={serieLoading}
          >
            <CompanyDailyOilMatrixTable matrix={companyDailyOilMatrix} />

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

// ─── Daily net-oil matrix table (fields × days) ─────────────────────────────

/**
 * Wide daily matrix: a sticky-left "Date" column + one column per field
 * ("CAMPO (stake%)"), one row per day (latest first). Cells are net oil in
 * kbpd (1 decimal, pt-BR); a field with no datum that day renders "—". The
 * container scrolls in BOTH axes (Petrobras has ~37 field columns × ~204 days);
 * the header row is sticky-top and the Date column sticky-left so neither is
 * lost while scrolling. Desktop-only — too wide for a phone.
 */
function CompanyDailyOilMatrixTable({
  matrix,
}: {
  matrix: CompanyDailyOilMatrix;
}): React.ReactElement {
  const { fields, rows } = matrix;
  const dateColWidth = 110;

  if (fields.length === 0 || rows.length === 0) {
    return (
      <div style={{
        padding: "24px 16px", color: "#888", textAlign: "center",
        fontFamily: "Arial", fontSize: 13, border: "1px dashed #ddd", borderRadius: 6,
      }}>
        No daily oil data for the current period.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 480, border: "1px solid #eee", borderRadius: 6 }}>
      <table
        className="table table-sm"
        style={{ fontFamily: "Arial", fontSize: 12, marginBottom: 0, borderCollapse: "separate", borderSpacing: 0 }}
      >
        <thead>
          <tr>
            <th
              style={{
                position: "sticky", top: 0, left: 0, zIndex: 3,
                background: "#fff", borderBottom: "2px solid #1a1a1a",
                padding: "8px 12px", textAlign: "left", whiteSpace: "nowrap",
                minWidth: dateColWidth,
              }}
            >
              Date
            </th>
            {fields.map(f => (
              <th
                key={f.campo}
                title={f.isOthers && f.othersFieldNames ? f.othersFieldNames.join(", ") : undefined}
                style={{
                  position: "sticky", top: 0, zIndex: 2,
                  background: "#fff", borderBottom: "2px solid #1a1a1a",
                  padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap",
                  // Others column reads in the neutral grey it uses in the charts.
                  color: f.isOthers ? OTHERS_COLOR : undefined,
                  cursor: f.isOthers ? "help" : undefined,
                }}
              >
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.data}>
              <th
                scope="row"
                style={{
                  position: "sticky", left: 0, zIndex: 1,
                  background: "#fff", borderRight: "1px solid #eee",
                  padding: "6px 12px", textAlign: "left", whiteSpace: "nowrap",
                  fontWeight: 400, minWidth: dateColWidth,
                }}
              >
                {r.data}
              </th>
              {fields.map(f => (
                <td key={f.campo} style={{ padding: "6px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {fmtNumber(r.values[f.campo], 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


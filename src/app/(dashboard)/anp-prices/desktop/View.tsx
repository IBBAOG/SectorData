"use client";

// Desktop View — /anp-prices (≥769px).
//
// Sidebar (Product / Granularity / Locations / Period) + a single supply-chain
// comparison chart. Producer, Distribution and Retail share the same chart so
// the markup (or compression) between supply links is visible at a glance.
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
import { emptyPlot } from "../../../../lib/plotlyDefaults";

import {
  useAnpPricesData,
  PRODUCTS,
  FONTE_COLORS,
  FONTE_LABEL,
  GRANULARITY_LABEL,
  type Product,
  type Granularity,
  type Fonte,
} from "../useAnpPricesData";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "brasil",    label: "Brazil" },
  { value: "regiao",    label: "Region" },
  { value: "uf",        label: "State" },
  { value: "municipio", label: "City" },
];

/**
 * Noun used in the "Select at least one ..." empty state. Mirrors the
 * granularity toggle copy but in lowercase singular for the sentence frame.
 */
const SELECTION_NOUN: Record<Granularity, string> = {
  brasil:    "location",
  regiao:    "region",
  uf:        "state",
  municipio: "city",
};

export default function DesktopView(): React.ReactElement | null {
  const {
    visible, visLoading,
    loading, serieLoading,
    filtros,
    product, setProduct,
    granularity, setGranularity,
    locais, toggleLocal, setLocais,
    allYears, yearRange, setYearRange, hasYears, periodBadge,
    availableLocais,
    needsSelection,
    fontesVisiveis, faltandoElos,
    chart, unit,
    exportOpen, setExportOpen,
    excelLoading, csvLoading,
    exportProdutos, setExportProdutos,
    exportGranularidades, setExportGranularidades,
    exportLocais, setExportLocais,
    exportRange, setExportRange,
    exportFilters, exportAvailableLocais,
    openExportModal, estimateExportRows,
    handleExportExcel, handleExportCsv,
  } = useAnpPricesData();

  if (visLoading || !visible) return null;

  const chartLoading = loading || serieLoading;
  const yMin = periodBadge ? periodBadge[0] : null;
  const yMax = periodBadge ? periodBadge[1] : null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          {/* min-width + overflow-hidden on the Bootstrap column lock the
              sidebar's horizontal footprint; without this, long state names or
              a tall MultiSelectFilter list pushed the main chart sideways when
              a UF was selected. */}
          <div
            className="col-xxl-2 col-md-3 p-0"
            style={{ minWidth: 0, overflow: "hidden" }}
          >
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              {/* Product */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Product</div>
                <select
                  className="form-select form-select-sm"
                  value={product}
                  onChange={(e) => setProduct(e.target.value as Product)}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                  disabled={loading}
                  aria-busy={loading}
                >
                  {PRODUCTS.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* Granularity */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Granularity</div>
                <SegmentedToggle<Granularity>
                  value={granularity}
                  onChange={setGranularity}
                  options={[...GRANULARITY_OPTIONS]}
                  variant="full"
                />
              </div>

              {/* Locations (only when granularity !== brasil).
                  Region: 5 fixed items, checkbox list (best UX).
                  State / City: searchable compact dropdown (27 states or
                  hundreds of cities — checkbox list is unscrollable). */}
              {granularity === "regiao" && (
                <MultiSelectFilter
                  label={GRANULARITY_LABEL[granularity]}
                  items={availableLocais}
                  selected={locais}
                  onToggle={toggleLocal}
                  onClear={locais.length > 0 ? () => setLocais([]) : undefined}
                  counterTotal={availableLocais.length}
                  idPrefix={`anp-prices-${granularity}`}
                  emptyMeansAll
                />
              )}

              {(granularity === "uf" || granularity === "municipio") && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    {GRANULARITY_LABEL[granularity]}{" "}
                    <span style={{ color: "#888", fontWeight: 400 }}>
                      ({locais.length}/{availableLocais.length})
                    </span>
                  </div>
                  <SearchableMultiSelect
                    options={availableLocais}
                    value={locais}
                    onChange={setLocais}
                  />
                </div>
              )}

              {/* Period */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasYears && (
                  <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
                )}
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP Prices"
                sub="Producer, distribution and retail prices for fuels in Brazil — ANP data"
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

              {loading ? (
                <BarrelLoading />
              ) : (
                <div className="row mb-2">
                  <div className="col-12">
                    <ChartSection
                      title={`${product} prices — ${GRANULARITY_LABEL[granularity]}${unit ? ` (${unit})` : ""}`}
                      loading={chartLoading && !needsSelection}
                      height={360}
                    >
                      {/* Trace legend (3 fixed dots) — sits above the chart so
                          users always see the supply-chain colour key, even when
                          a trace is missing for the current product/granularity. */}
                      <TraceLegend visibleFontes={fontesVisiveis} />

                      {needsSelection ? (
                        <NeedsSelectionEmptyState granularity={granularity} />
                      ) : (
                        <>
                          <PlotlyChart
                            data={(chart.data && chart.data.length > 0) ? chart.data : emptyPlot(360).data}
                            layout={(chart.data && chart.data.length > 0) ? chart.layout : emptyPlot(360).layout}
                            config={{ responsive: true, displayModeBar: false }}
                            style={{ width: "100%", height: 360 }}
                          />

                          {/* Missing-link banner — discreet, never silent. */}
                          {faltandoElos.length > 0 && !chartLoading && (
                            <MissingLinksBanner missing={faltandoElos} />
                          )}
                        </>
                      )}
                    </ChartSection>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tier 2 export modal */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export — ANP Prices"
        datasetKey="anp_prices"
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
              {hasYears && (
                <PeriodSlider years={allYears} value={exportRange} onChange={setExportRange} />
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Products <span style={{ color: "#888", fontWeight: 400 }}>({exportProdutos.length}/{PRODUCTS.length})</span>
              </div>
              <MultiSelectFilter
                label="Products"
                items={[...PRODUCTS]}
                selected={exportProdutos}
                onToggle={(p) =>
                  setExportProdutos(
                    exportProdutos.includes(p)
                      ? exportProdutos.filter(x => x !== p)
                      : [...exportProdutos, p]
                  )
                }
                onClear={exportProdutos.length > 0 ? () => setExportProdutos([]) : undefined}
                idPrefix="anp-prices-export-product"
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Granularities <span style={{ color: "#888", fontWeight: 400 }}>({exportGranularidades.length}/{filtros.granularidades.length})</span>
              </div>
              <MultiSelectFilter
                label="Granularities"
                items={filtros.granularidades}
                selected={exportGranularidades}
                onToggle={(g) =>
                  setExportGranularidades(
                    exportGranularidades.includes(g)
                      ? exportGranularidades.filter(x => x !== g)
                      : [...exportGranularidades, g]
                  )
                }
                onClear={exportGranularidades.length > 0 ? () => setExportGranularidades([]) : undefined}
                idPrefix="anp-prices-export-gran"
              />
            </div>

            {exportAvailableLocais.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  Locations <span style={{ color: "#888", fontWeight: 400 }}>({exportLocais.length === 0 ? "all" : `${exportLocais.length}/${exportAvailableLocais.length}`})</span>
                </div>
                <SearchableMultiSelect
                  options={exportAvailableLocais}
                  value={exportLocais}
                  onChange={setExportLocais}
                />
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}

// ─── Inner — Empty state when granularity requires a selection ────────────────

function NeedsSelectionEmptyState({ granularity }: { granularity: Granularity }) {
  const noun = SELECTION_NOUN[granularity];
  return (
    <div
      role="status"
      style={{
        height: 360,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 32,
        textAlign: "center",
        fontFamily: "Arial",
        color: "#777",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1.5px dashed #cccccc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#bbb",
          fontSize: 18,
          fontWeight: 700,
        }}
      >
        +
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>
        Select at least one {noun} to load the chart.
      </div>
      <div style={{ fontSize: 11.5, color: "#999", maxWidth: 320, lineHeight: 1.5 }}>
        Use the {GRANULARITY_LABEL[granularity]} filter on the left to pick one or more {noun}s.
      </div>
    </div>
  );
}

// ─── Inner — Trace legend (always renders 3 dots; missing ones get muted) ─────

function TraceLegend({ visibleFontes }: { visibleFontes: Fonte[] }) {
  const allFontes: Fonte[] = ["producer", "distribution", "retail"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "6px 4px 10px",
        fontFamily: "Arial",
        fontSize: 12,
      }}
    >
      {allFontes.map((f) => {
        const active = visibleFontes.includes(f);
        return (
          <span
            key={f}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: active ? "#1a1a1a" : "#bbb",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              fontSize: 11,
            }}
            title={active ? `${FONTE_LABEL[f]} — available` : `${FONTE_LABEL[f]} — not available for current filters`}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: active ? FONTE_COLORS[f] : "#e0e0e0",
              }}
            />
            {FONTE_LABEL[f]}
          </span>
        );
      })}
    </div>
  );
}

// ─── Inner — Missing-links banner (discreet, explains the trace gap) ──────────

function MissingLinksBanner({ missing }: { missing: { fonte: Fonte; reason: string }[] }) {
  if (missing.length === 0) return null;
  return (
    <div
      role="note"
      style={{
        marginTop: 10,
        padding: "8px 12px",
        background: "#fafafa",
        border: "1px dashed #e0e0e0",
        borderRadius: 6,
        fontFamily: "Arial",
        fontSize: 11.5,
        color: "#666",
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
        Missing links ({missing.length})
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {missing.map(m => (
          <li key={m.fonte}>
            <span style={{ color: FONTE_COLORS[m.fonte], fontWeight: 700 }}>
              {FONTE_LABEL[m.fonte]}
            </span>
            : {m.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

// Mobile View — /anp-prices (≤768px).
//
// Same analysis as the desktop View — Producer / Distribution / Retail price
// surveyor for 5 fuels, with a granularity drill (Brazil → Region → State →
// City) and a fixed colour for each supply-chain link.
//
// Layout (top → bottom):
//   MobileTopBar              — wordmark
//   Title + subtitle + period — sticky-ish header
//   MobileTabBar              — 5 product tabs (Gasoline / Diesel / Ethanol /
//                                Biodiesel / LPG)
//   Sticky filter chip row    — granularity SegmentedToggle + Filters button
//                                + active filter chips
//   MobileChart               — 3 colour-coded supply-chain traces (or fewer
//                                when missing-link banner explains)
//   MobileDataCard per link   — latest price + weekly delta per visible link
//   ExportFAB                 — Tier 2 modal (same as desktop)
//   FilterDrawer              — Locations + Period
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here
// must land in desktop/View.tsx in the SAME commit, OR the commit message
// must declare [mobile-only] with an explicit reason.

import { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import {
  MobileTopBar,
  MobileTabBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  FilterIcon,
  CloseIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportModal from "../../../../components/dashboard/ExportModal";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";

import {
  useAnpPricesData,
  PRODUCTS,
  FONTE_COLORS,
  FONTE_LABEL,
  GRANULARITY_LABEL,
  fmtNumber,
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

const BRAND_ORANGE = "#FF5000";

// ─── Mobile chart builder (3 traces, fixed colours, step for monthly) ─────────

function buildMobileTraces(
  rows: import("../../../../lib/rpc").AnpPricesSerieRow[],
  granularity: Granularity,
): PlotData[] {
  if (!rows.length) return [];
  const byKey: Record<string, typeof rows> = {};
  for (const r of rows) {
    const k = `${r.fonte}|||${r.local}`;
    (byKey[k] ??= []).push(r);
  }

  const fonteOrder: Fonte[] = ["producer", "distribution", "retail"];
  const locaisPerFonte: Record<Fonte, string[]> = { producer: [], distribution: [], retail: [] };
  for (const r of rows) {
    if (!locaisPerFonte[r.fonte].includes(r.local)) locaisPerFonte[r.fonte].push(r.local);
  }

  const traces: PlotData[] = [];
  for (const fonte of fonteOrder) {
    const locais = locaisPerFonte[fonte];
    for (const local of locais) {
      const k = `${fonte}|||${local}`;
      const series = (byKey[k] ?? []).slice().sort((a, b) => a.data.localeCompare(b.data));
      if (!series.length) continue;
      const showLocal = locais.length > 1;
      const stepShape = fonte === "distribution" && granularity !== "brasil" ? "hv" : "linear";
      traces.push({
        type: "scatter",
        mode: "lines",
        name: showLocal ? `${FONTE_LABEL[fonte]} — ${local}` : FONTE_LABEL[fonte],
        x: series.map(d => d.data),
        y: series.map(d => d.preco),
        line: { width: 1.8, color: FONTE_COLORS[fonte], shape: stepShape },
        legendgroup: fonte,
      } as PlotData);
    }
  }
  return traces;
}

// ─── Per-link summary card (latest price + weekly delta) ──────────────────────

interface LinkSummary {
  fonte: Fonte;
  latest: number | null;
  prev: number | null;
  delta: number | null;
  date: string | null;
  unit: string;
}

function buildLinkSummaries(
  rows: import("../../../../lib/rpc").AnpPricesSerieRow[],
  visibleFontes: Fonte[],
): LinkSummary[] {
  const summaries: LinkSummary[] = [];
  for (const fonte of visibleFontes) {
    const series = rows
      .filter(r => r.fonte === fonte && r.preco != null)
      .sort((a, b) => a.data.localeCompare(b.data));
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    if (!last) continue;
    const delta = (prev?.preco != null && last.preco != null)
      ? (last.preco - prev.preco) / prev.preco
      : null;
    summaries.push({
      fonte,
      latest: last.preco,
      prev: prev?.preco ?? null,
      delta,
      date: last.data,
      unit: last.unidade,
    });
  }
  return summaries;
}

// ─── Mobile View ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const {
    visible, visLoading,
    loading, serieLoading,
    filtros,
    product, setProduct,
    granularity, setGranularity,
    locais, toggleLocal, setLocais,
    allYears, yearRange, setYearRange, hasYears, periodBadge,
    availableLocais,
    serieRows,
    fontesVisiveis, faltandoElos,
    unit,
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

  const [filterOpen, setFilterOpen] = useState(false);

  const chartTraces = useMemo(
    () => buildMobileTraces(serieRows, granularity),
    [serieRows, granularity],
  );

  const linkSummaries = useMemo(
    () => buildLinkSummaries(serieRows, fontesVisiveis),
    [serieRows, fontesVisiveis],
  );

  function handleReset() {
    setLocais([]);
    if (allYears.length > 0) {
      setYearRange([0, allYears.length - 1]);
    }
  }

  const activeFilterCount =
    (locais.length > 0 ? 1 : 0) +
    (granularity !== "brasil" ? 1 : 0) +
    (allYears.length > 0 && (yearRange[0] !== 0 || yearRange[1] !== allYears.length - 1) ? 1 : 0);

  if (visLoading || !visible) return null;

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight: "100dvh",
        paddingBottom: "calc(72px + var(--mobile-safe-bottom, 0px) + 80px)",
      }}
    >
      {/* Sticky top bar */}
      <MobileTopBar title="ANP Prices" />

      {/* Page heading */}
      <section style={{ padding: "16px 16px 8px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text, #1a1a1a)",
            lineHeight: 1.15,
            letterSpacing: "-0.005em",
          }}
        >
          ANP Prices
        </h1>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "var(--mobile-text-muted, #6b6b73)",
          }}
        >
          Producer, distribution and retail prices — Brazilian supply chain
        </div>
        {periodBadge && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(255, 80, 0, 0.10)",
              color: BRAND_ORANGE,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND_ORANGE }}
            />
            {periodBadge[0]} → {periodBadge[1]}
          </span>
        )}
      </section>

      {/* Product tabs */}
      <div style={{ padding: "8px 0 0" }}>
        <MobileTabBar
          tabs={PRODUCTS.map(p => ({ key: p, label: p }))}
          activeKey={product}
          onChange={(k) => setProduct(k as Product)}
          ariaLabel="Product"
        />
      </div>

      {/* Granularity + filter chip row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px 4px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          whiteSpace: "nowrap",
          scrollbarWidth: "none",
        }}
      >
        <div style={{ flex: "0 0 auto" }}>
          <SegmentedToggle<Granularity>
            value={granularity}
            onChange={setGranularity}
            options={[...GRANULARITY_OPTIONS]}
            variant="compact"
          />
        </div>

        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-label="Open filters"
          style={{
            flex: "0 0 auto",
            minHeight: 32,
            padding: "0 12px",
            borderRadius: 999,
            border: "1px dashed var(--mobile-border, #e0e0e0)",
            background: "var(--mobile-surface, #fff)",
            color: "var(--mobile-text, #1a1a1a)",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <FilterIcon size={14} strokeWidth={2.4} />
          Filters
          {activeFilterCount > 0 && (
            <span
              style={{
                minWidth: 18, height: 18,
                borderRadius: 999,
                background: BRAND_ORANGE,
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 5px",
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        {locais.length > 0 && (
          <span
            style={{
              flex: "0 0 auto",
              minHeight: 32,
              padding: "0 12px",
              borderRadius: 999,
              background: "rgba(255, 80, 0, 0.10)",
              color: BRAND_ORANGE,
              fontSize: 12,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: `1px solid ${BRAND_ORANGE}`,
            }}
          >
            {GRANULARITY_LABEL[granularity]}: {locais.length}
            <button
              type="button"
              onClick={() => setLocais([])}
              aria-label="Clear location filter"
              style={{
                width: 18, height: 18,
                border: 0,
                background: "transparent",
                color: BRAND_ORANGE,
                cursor: "pointer",
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CloseIcon size={10} strokeWidth={2.5} />
            </button>
          </span>
        )}
      </div>

      {/* Main content */}
      {loading ? (
        <div style={{ padding: "32px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* Chart card */}
          <section
            style={{
              margin: "12px 16px 16px",
              padding: "14px 14px 12px",
              background: "var(--mobile-surface, #fff)",
              borderRadius: 14,
              border: "1px solid var(--mobile-border-soft, #f0f0f5)",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 4,
                opacity: serieLoading ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--mobile-text, #1a1a1a)",
                  letterSpacing: "0.02em",
                }}
              >
                {product} — {GRANULARITY_LABEL[granularity]}
                {serieLoading && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      fontWeight: 400,
                      color: "var(--mobile-text-muted, #6b6b73)",
                    }}
                  >
                    updating...
                  </span>
                )}
              </div>
              {unit && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--mobile-text-muted, #6b6b73)",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {unit}
                </div>
              )}
            </div>

            {/* Trace legend — fixed 3 dots, dimmed for missing fontes */}
            <TraceLegend visibleFontes={fontesVisiveis} />

            {chartTraces.length === 0 ? (
              <div
                style={{
                  padding: "32px 12px",
                  textAlign: "center",
                  color: "var(--mobile-text-muted, #6b6b73)",
                  fontSize: 12,
                }}
              >
                No price data for this combination.
              </div>
            ) : (
              <MobileChart
                data={chartTraces}
                height={240}
                layout={{
                  xaxis: { type: "date" as const, nticks: 4 },
                  yaxis: { nticks: 4 },
                  showlegend: false,
                }}
              />
            )}

            {/* Missing-link banner */}
            {faltandoElos.length > 0 && !serieLoading && (
              <MissingLinksBanner missing={faltandoElos} />
            )}
          </section>

          {/* Per-link summary cards */}
          {linkSummaries.length > 0 && (
            <>
              <div
                style={{
                  padding: "8px 16px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--mobile-bg, #f5f5f7)",
                }}
              >
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--mobile-text, #1a1a1a)",
                  }}
                >
                  Latest by supply link
                </div>
              </div>
              <div
                style={{
                  background: "var(--mobile-surface, #fff)",
                  borderTop: "1px solid var(--mobile-border-soft, #f0f0f5)",
                  borderBottom: "1px solid var(--mobile-border-soft, #f0f0f5)",
                }}
              >
                {linkSummaries.map(s => (
                  <MobileDataCard
                    key={s.fonte}
                    variant="default"
                    title={
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: FONTE_COLORS[s.fonte],
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontWeight: 700, color: "var(--mobile-text, #1a1a1a)" }}>
                          {FONTE_LABEL[s.fonte]}
                        </span>
                      </span>
                    }
                    subtitle={
                      <span style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)" }}>
                        {s.date ?? "—"}
                      </span>
                    }
                    rightSlot={
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "var(--mobile-text, #1a1a1a)",
                            fontVariantNumeric: "tabular-nums",
                            lineHeight: 1.1,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtNumber(s.latest, 4)} {s.unit}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: s.delta == null
                              ? "var(--mobile-text-muted, #6b6b73)"
                              : s.delta >= 0 ? "#c0392b" : "#1e7a3a",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {s.delta == null
                            ? "—"
                            : `${s.delta >= 0 ? "+" : ""}${(s.delta * 100).toFixed(2)}% w/w`}
                        </span>
                      </div>
                    }
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Export FAB */}
      <ExportFAB
        icon="download"
        label="Export"
        onClick={openExportModal}
        disabled={loading || excelLoading || csvLoading}
        ariaLabel="Export data"
      />

      {/* Filter drawer */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={handleReset}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
      >
        {/* Period */}
        {hasYears && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 8,
                color: "var(--mobile-text, #1a1a1a)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Period
            </div>
            <PeriodSlider years={allYears} value={yearRange} onChange={setYearRange} />
          </div>
        )}

        {/* Locations (only when granularity !== brasil) */}
        {granularity !== "brasil" && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginBottom: 8,
                color: "var(--mobile-text, #1a1a1a)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>
                {GRANULARITY_LABEL[granularity]}
                <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--mobile-text-muted, #6b6b73)" }}>
                  ({locais.length}/{availableLocais.length})
                </span>
              </span>
              {locais.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLocais([])}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: BRAND_ORANGE,
                    fontFamily: "inherit",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            <div
              style={{
                maxHeight: 240,
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: 2,
              }}
            >
              {availableLocais.map(l => {
                const active = locais.includes(l);
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => toggleLocal(l)}
                    style={{
                      minHeight: 30,
                      padding: "0 10px",
                      borderRadius: 999,
                      border: "1px solid",
                      borderColor: active ? BRAND_ORANGE : "var(--mobile-border, #e0e0e0)",
                      background: active ? "rgba(255,80,0,0.08)" : "transparent",
                      color: active ? BRAND_ORANGE : "var(--mobile-text-muted, #6b6b73)",
                      fontFamily: "inherit",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
            {locais.length === 0 && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--mobile-text-muted, #6b6b73)",
                  lineHeight: 1.4,
                }}
              >
                No selection: chart shows all {GRANULARITY_LABEL[granularity].toLowerCase()}s.
              </div>
            )}
          </div>
        )}
      </FilterDrawer>

      {/* Tier 2 Export modal — same RPCs as desktop */}
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
                idPrefix="anp-prices-export-product-mobile"
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
                idPrefix="anp-prices-export-gran-mobile"
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

// ─── Helpers (mobile-internal) ────────────────────────────────────────────────

function TraceLegend({ visibleFontes }: { visibleFontes: Fonte[] }) {
  const allFontes: Fonte[] = ["producer", "distribution", "retail"];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "2px 0 8px",
        fontSize: 11,
        flexWrap: "wrap",
      }}
    >
      {allFontes.map(f => {
        const active = visibleFontes.includes(f);
        return (
          <span
            key={f}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: active ? "var(--mobile-text, #1a1a1a)" : "#bbb",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
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
        fontSize: 11,
        color: "#666",
        lineHeight: 1.45,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: "#1a1a1a",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
          fontSize: 10,
        }}
      >
        Missing links ({missing.length})
      </div>
      <ul style={{ margin: 0, paddingLeft: 16 }}>
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

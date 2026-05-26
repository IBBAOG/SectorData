"use client";

// Mobile View — ANP CDP Daily (≤768px).
//
// Archetype: hybrid of anp-cdp-mobile.html (hierarchical context, product tabs)
// and market-share-mobile.html (chart + filter chips + leader card list).
//
// Layout (top → bottom):
//   MobileTopBar              — wordmark + filter chip count
//   Product MobileTabBar      — Oil / Gas (switches chart + ranking metric)
//   Filter chip row           — sticky, opens FilterDrawer
//   MobileChart               — daily series, top 5 dimensions with brand
//                               orange leader (rest in palette)
//   Ranking card list         — MobileDataCard per dimension (top 25),
//                               sparkline + latest production
//   Production summary card   — total / avg / leader (mini-stats)
//   ExportFAB                 — opens ExportModal (Tier 2, same as desktop)
//   FilterDrawer              — basin multi-select + date range + field search
//
// Mobile pins granularity to "field" — the granularity toggle is desktop-only
// UX. Both views still share the same hook; the mobile View just doesn't
// expose the toggle. If someone wants installation/well drill-down on phone,
// they can rotate to landscape and use desktop View, or we can add it later
// (mobile must stay focused).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here
// must land in desktop/View.tsx in the SAME commit, OR the commit message
// must declare [mobile-only] with an explicit reason.

import { useEffect, useMemo, useState } from "react";
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

import {
  useAnpCdpDiariaData,
  metricForProduct,
  metricDisplay,
  fmtNumber,
  productUnitLabel,
  BRAND_ORANGE,
  PALETTE,
  type Product,
  type UnifiedRow,
  type DimensionAggregate,
} from "../useAnpCdpDiariaData";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOP_CHART_TRACES = 5;     // mobile chart legibility
const TOP_CARDS = 25;            // card list cap
const SPARKLINE_POINTS = 14;     // ~2 weeks of daily values

// ─── Chart builder (mobile-tuned) ─────────────────────────────────────────────

function buildMobileChart(
  rows: UnifiedRow[],
  product: Product,
  dims: string[],
): PlotData[] {
  const metric = metricForProduct(product);
  const filtered = rows.filter(r => dims.includes(r.dimension) && r[metric] != null);
  if (!filtered.length) return [];

  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    if (!agg[r.dimension]) agg[r.dimension] = {};
    const v = r[metric] ?? 0;
    agg[r.dimension][r.data] = (agg[r.dimension][r.data] ?? 0) + v;
  }

  const unit = productUnitLabel(product);

  return dims
    .filter(c => agg[c])
    .map((c, i) => {
      const entries = Object.entries(agg[c]).sort(([a], [b]) => a.localeCompare(b));
      return {
        type: "scatter", mode: "lines",
        name: c,
        x: entries.map(([d]) => d),
        y: entries.map(([, v]) => metricDisplay(v, metric) ?? 0),
        // Leader (index 0) gets brand orange + slightly heavier stroke.
        line: {
          width: i === 0 ? 2.4 : 1.4,
          color: i === 0 ? BRAND_ORANGE : PALETTE[(i + 1) % PALETTE.length],
        },
        hovertemplate: `${c}: %{y:,.1f} ${unit}<extra></extra>`,
      } as PlotData;
    });
}

// ─── Sparkline data (last N daily values for a dimension, scaled) ─────────────

function dimensionSparkline(
  rows: UnifiedRow[],
  dimension: string,
  product: Product,
  n: number,
): number[] {
  const metric = metricForProduct(product);
  const series = rows
    .filter(r => r.dimension === dimension && r[metric] != null)
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(-n)
    .map(r => metricDisplay(r[metric], metric) ?? 0);
  return series;
}

// ─── Mobile view ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const {
    visible, visLoading,
    loading, serieLoading,
    granularity, setGranularity,
    campos, bacias,
    allDates, dateRange, setDateRange, hasDates, periodBadge,
    selectedCampos, setSelectedCampos,
    selectedBacias, setSelectedBacias, toggleBacia,
    visibleRows,
    explicitDims,
    defaultPetroleoDims, defaultGasDims,
    ranking,
    product, setProduct,
    exportOpen, setExportOpen,
    excelLoading, csvLoading,
    exportCampos, setExportCampos,
    exportBacias, setExportBacias,
    exportRange, setExportRange,
    exportFilters, datasetKey,
    openExportModal, estimateExportRows, handleExportExcel, handleExportCsv,
  } = useAnpCdpDiariaData();

  // Mobile pins granularity to Field — the toggle stays desktop-only UX. The
  // hook still exposes setGranularity for desktop; we just make sure the
  // mobile path starts and stays at "field".
  useEffect(() => {
    if (granularity !== "field") setGranularity("field");
  }, [granularity, setGranularity]);

  const [filterOpen, setFilterOpen] = useState(false);

  // Chart traces — leader (brand orange) + up to 4 followers from default Top-N
  // or, when the user has an explicit selection, their picks (capped at 5).
  const chartDims = useMemo(() => {
    const base = explicitDims.length > 0
      ? explicitDims
      : (product === "oil" ? defaultPetroleoDims : defaultGasDims);
    return base.slice(0, TOP_CHART_TRACES);
  }, [explicitDims, defaultPetroleoDims, defaultGasDims, product]);

  const chartTraces = useMemo(
    () => buildMobileChart(visibleRows, product, chartDims),
    [visibleRows, product, chartDims],
  );

  const unit = productUnitLabel(product);

  // Total / average / leader (mini-stats card)
  const stats = useMemo(() => {
    if (ranking.length === 0) return null;
    const leader = ranking[0];
    const isOil = product === "oil";
    const avgKey = isOil ? "avgOil" as const : "avgGas" as const;
    const totalAvg = ranking.reduce((s, r) => s + r[avgKey], 0);
    return {
      leader: {
        name: leader.dimension,
        bacia: leader.bacia,
        value: metricDisplay(leader[avgKey], metricForProduct(product)) ?? 0,
      },
      totalAvg: metricDisplay(totalAvg, metricForProduct(product)) ?? 0,
      avgPerDim: ranking.length > 0
        ? (metricDisplay(totalAvg / ranking.length, metricForProduct(product)) ?? 0)
        : 0,
      count: ranking.length,
    };
  }, [ranking, product]);

  // Filter drawer reset — restore full universes + full date range.
  function handleReset() {
    setSelectedCampos([]);
    setSelectedBacias([]);
    if (allDates.length > 0) {
      setDateRange([0, allDates.length - 1]);
    }
  }

  const activeFilterCount =
    (selectedBacias.length > 0 && selectedBacias.length < bacias.length ? 1 : 0) +
    (selectedCampos.length > 0 ? 1 : 0) +
    (allDates.length > 0 && (dateRange[0] !== 0 || dateRange[1] !== allDates.length - 1) ? 1 : 0);

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
      <MobileTopBar title="Daily Production" />

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
          Daily Production
        </h1>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "var(--mobile-text-muted, #6b6b73)",
          }}
        >
          Petroleum and gas by field — refreshed 3×/day
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
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: BRAND_ORANGE,
              }}
            />
            {periodBadge[0]} → {periodBadge[1]}
          </span>
        )}
      </section>

      {/* Product tabs */}
      <div style={{ padding: "8px 0 0" }}>
        <MobileTabBar
          tabs={[
            { key: "oil", label: "Oil" },
            { key: "gas", label: "Gas" },
          ]}
          activeKey={product}
          onChange={(k) => setProduct(k as Product)}
          ariaLabel="Product"
        />
      </div>

      {/* Filter chips (open drawer) */}
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

        {selectedBacias.length > 0 && selectedBacias.length < bacias.length && (
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
            Basins: {selectedBacias.length}
            <button
              type="button"
              onClick={() => setSelectedBacias([])}
              aria-label="Clear basin filter"
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

        {selectedCampos.length > 0 && (
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
            Fields: {selectedCampos.length}
            <button
              type="button"
              onClick={() => setSelectedCampos([])}
              aria-label="Clear field filter"
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
      ) : visibleRows.length === 0 ? (
        <div
          style={{
            margin: "16px",
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--mobile-text-muted, #6b6b73)",
            background: "var(--mobile-surface, #fff)",
            border: "1px dashed var(--mobile-border, #e0e0e0)",
            borderRadius: 12,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          No production data for the current filters.
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
                {explicitDims.length > 0
                  ? `${explicitDims.length} field${explicitDims.length === 1 ? "" : "s"} selected`
                  : `Top ${chartDims.length} fields`}
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
            </div>
            <MobileChart
              data={chartTraces}
              height={220}
              layout={{
                xaxis: { type: "date" as const, nticks: 4 },
                yaxis: { nticks: 4 },
                showlegend: chartDims.length > 1,
                legend: {
                  orientation: "h",
                  yanchor: "bottom",
                  y: 1.01,
                  xanchor: "left",
                  x: 0,
                  font: { size: 10 },
                },
              }}
            />

            {/* Mini-stats */}
            {stats && (
              <div
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 1,
                  background: "var(--mobile-border-soft, #f0f0f5)",
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid var(--mobile-border-soft, #f0f0f5)",
                }}
              >
                <div style={{ background: "var(--mobile-surface, #fff)", padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--mobile-text-muted, #6b6b73)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Leader</div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      fontWeight: 700,
                      color: BRAND_ORANGE,
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1.1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={stats.leader.name}
                  >
                    {stats.leader.name}
                  </div>
                </div>
                <div style={{ background: "var(--mobile-surface, #fff)", padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--mobile-text-muted, #6b6b73)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Avg / Field</div>
                  <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                    {fmtNumber(stats.avgPerDim, product === "oil" ? 1 : 3)}
                  </div>
                </div>
                <div style={{ background: "var(--mobile-surface, #fff)", padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--mobile-text-muted, #6b6b73)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Fields</div>
                  <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                    {stats.count.toLocaleString("pt-BR")}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Drill section header */}
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
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                fontSize: 16,
                fontWeight: 700,
                color: "var(--mobile-text, #1a1a1a)",
              }}
            >
              Ranking
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--mobile-text-muted, #6b6b73)",
                  letterSpacing: "0.02em",
                }}
              >
                ({Math.min(ranking.length, TOP_CARDS)}/{ranking.length.toLocaleString("pt-BR")})
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--mobile-text-muted, #6b6b73)",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              By avg {product === "oil" ? "Oil" : "Gas"}
            </div>
          </div>

          {/* Production ranking card list */}
          <div
            style={{
              background: "var(--mobile-surface, #fff)",
              borderTop: "1px solid var(--mobile-border-soft, #f0f0f5)",
              borderBottom: "1px solid var(--mobile-border-soft, #f0f0f5)",
            }}
          >
            {ranking.slice(0, TOP_CARDS).map((r: DimensionAggregate, idx: number) => {
              const isLeader = idx === 0;
              const metric = metricForProduct(product);
              const latestRaw = product === "oil" ? r.latestOil : r.latestGas;
              const avgRaw    = product === "oil" ? r.avgOil    : r.avgGas;
              const latestDisp = metricDisplay(latestRaw, metric);
              const avgDisp    = metricDisplay(avgRaw,    metric);
              const sparkValues = dimensionSparkline(visibleRows, r.dimension, product, SPARKLINE_POINTS);

              return (
                <MobileDataCard
                  key={r.dimension}
                  variant="default"
                  title={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          minWidth: 22,
                          height: 22,
                          padding: "0 6px",
                          borderRadius: 999,
                          background: isLeader ? BRAND_ORANGE : "var(--mobile-divider, #f0f0f0)",
                          color: isLeader ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
                          fontSize: 11,
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          letterSpacing: "0.02em",
                          flexShrink: 0,
                        }}
                      >
                        #{idx + 1}
                      </span>
                      <span
                        style={{
                          fontWeight: 700,
                          color: "var(--mobile-text, #1a1a1a)",
                        }}
                      >
                        {r.dimension}
                      </span>
                    </span>
                  }
                  subtitle={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {r.bacia && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: "var(--mobile-surface-2, #fafafc)",
                            border: "1px solid var(--mobile-border, #e0e0e0)",
                            color: "var(--mobile-text-muted, #6b6b73)",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {r.bacia}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)" }}>
                        Avg {fmtNumber(avgDisp, product === "oil" ? 1 : 3)} {unit}
                      </span>
                    </span>
                  }
                  sparkline={sparkValues.length >= 2 ? sparkValues : undefined}
                  sparklineColor={isLeader ? BRAND_ORANGE : PALETTE[(idx + 1) % PALETTE.length]}
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
                        {fmtNumber(latestDisp, product === "oil" ? 1 : 3)}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--mobile-text-muted, #6b6b73)",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.latestDate ?? "—"}
                      </span>
                    </div>
                  }
                />
              );
            })}
          </div>
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
        {/* Basin filter */}
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
            Basin
            <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--mobile-text-muted, #6b6b73)" }}>
              ({selectedBacias.length || bacias.length}/{bacias.length})
            </span>
          </div>
          <MultiSelectFilter
            label="Basin"
            items={bacias}
            selected={selectedBacias}
            onToggle={toggleBacia}
            onClear={selectedBacias.length > 0 ? () => setSelectedBacias([]) : undefined}
            idPrefix="cdpd-mobile-bacia"
            emptyMeansAll
            counterTotal={bacias.length}
          />
        </div>

        {/* Period filter */}
        {hasDates && (
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
            <PeriodSlider dates={allDates} value={dateRange} onChange={setDateRange} />
          </div>
        )}

        {/* Field filter — chip cloud (touch-friendly toggle) */}
        <div style={{ marginBottom: 8 }}>
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
              Field
              <span style={{ fontWeight: 400, marginLeft: 4, color: "var(--mobile-text-muted, #6b6b73)" }}>
                ({selectedCampos.length}/{campos.length})
              </span>
            </span>
            {selectedCampos.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCampos([])}
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
            {campos.map(campo => {
              const active = selectedCampos.includes(campo);
              return (
                <button
                  key={campo}
                  type="button"
                  onClick={() => {
                    setSelectedCampos(
                      active
                        ? selectedCampos.filter(c => c !== campo)
                        : [...selectedCampos, campo],
                    );
                  }}
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
                  {campo}
                </button>
              );
            })}
          </div>
          {selectedCampos.length === 0 && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--mobile-text-muted, #6b6b73)",
                lineHeight: 1.4,
              }}
            >
              No selection: charts show Top {TOP_CHART_TRACES} fields by average in the period.
            </div>
          )}
        </div>
      </FilterDrawer>

      {/* Export modal (Tier 2 — same RPCs as desktop) */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export — Daily Production (Field)"
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
              {hasDates && <PeriodSlider dates={allDates} value={exportRange} onChange={setExportRange} />}
            </div>

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
                idPrefix="cdpd-mobile-export-bacia"
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                Fields <span style={{ color: "#888", fontWeight: 400 }}>({exportCampos.length === 0 ? campos.length : exportCampos.length}/{campos.length})</span>
              </div>
              <div
                style={{
                  maxHeight: 180,
                  overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: 2,
                }}
              >
                {campos.map(campo => {
                  const active = exportCampos.includes(campo);
                  return (
                    <button
                      key={campo}
                      type="button"
                      onClick={() => {
                        setExportCampos(
                          active
                            ? exportCampos.filter(c => c !== campo)
                            : [...exportCampos, campo],
                        );
                      }}
                      style={{
                        minHeight: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border: "1px solid",
                        borderColor: active ? BRAND_ORANGE : "#e0e0e0",
                        background: active ? "rgba(255,80,0,0.08)" : "transparent",
                        color: active ? BRAND_ORANGE : "#6b6b73",
                        fontFamily: "Arial",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {campo}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        }
      />
    </div>
  );
}

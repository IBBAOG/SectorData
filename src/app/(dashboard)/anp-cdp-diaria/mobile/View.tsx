"use client";

// Mobile View — ANP CDP Daily Production (≤768px).
//
// Flagship #2 — v2 reform (Onda 3, 2026-05-27).
//
// Layout (top → bottom):
//   Sticky filter chip row  — Period preset + Field search trigger
//   Section 1 — Oil chart   — daily series, top 5 fields, brand orange leader, ~260px
//   Section 2 — Gas chart   — same treatment stacked vertically (desktop parity, CTO decision)
//   Section 3 — Top 10 ranking  — MobileDataCard pills + "See all N fields" BottomSheet
//   Production summary card — Total / Avg / Leader mini-stats
//
// Intentionally NOT rendered on mobile:
//   • ExportFAB / ExportModal (plan § 3.4 — export is desktop-only)
//   • MobileTabBar for Oil/Gas (both charts shown stacked, not tabbed)
//   • Granularity toggle (Field / Installation / Well) — pinned to Field
//   • Recent-records HTML table (wrong shape for phones)
//   • MobileTopBar (provided by MobileShell in layout.tsx since Onda 2)
//   • NavBar import
//   • useIsMobile() (this IS the mobile view)
//   • Dark mode CSS (light-only per plan § 3.2)
//
// Binding sync rule (CLAUDE.md § Dual-view policy):
//   This view pins granularity=field and removes ExportFAB — both are
//   intentional mobile-only decisions. All other meaningful analysis changes
//   must land in desktop/View.tsx in the SAME commit, or the commit must
//   declare [mobile-only] with explicit reason.

import { useEffect, useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import {
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  BottomSheet,
  FilterIcon,
  CloseIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
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

// ─── Constants ─────────────────────────────────────────────────────────────────

const TOP_CHART_TRACES  = 5;   // chart legibility on 375px screens
const TOP_RANKING_CARDS = 10;  // cards shown before "See all" sheet
const SPARKLINE_POINTS  = 14;  // ~2 weeks of daily values

// ─── Period preset helpers ─────────────────────────────────────────────────────

type PeriodPreset = "1M" | "3M" | "6M" | "1Y" | "All";

const PERIOD_PRESETS: PeriodPreset[] = ["1M", "3M", "6M", "1Y", "All"];

function presetDays(preset: PeriodPreset): number | null {
  switch (preset) {
    case "1M": return 30;
    case "3M": return 90;
    case "6M": return 180;
    case "1Y": return 365;
    case "All": return null;
  }
}

/** Returns [startIdx, endIdx] for a preset given the full date list. */
function presetToRange(preset: PeriodPreset, allDates: string[]): [number, number] {
  const last = allDates.length - 1;
  if (last < 0) return [0, 0];
  const days = presetDays(preset);
  if (days === null) return [0, last];
  // Walk backward from the most recent date.
  const endDate  = new Date(allDates[last] + "T00:00:00Z");
  const startMs  = endDate.getTime() - days * 86_400_000;
  let startIdx   = 0;
  for (let i = last; i >= 0; i--) {
    if (new Date(allDates[i] + "T00:00:00Z").getTime() <= startMs) {
      startIdx = Math.min(i + 1, last);
      break;
    }
  }
  return [startIdx, last];
}

// ─── Chart builder (mobile-tuned) ─────────────────────────────────────────────

function buildMobileChart(
  rows: UnifiedRow[],
  product: Product,
  dims: string[],
): PlotData[] {
  const metric   = metricForProduct(product);
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
    .filter(d => agg[d])
    .map((d, i) => {
      const entries = Object.entries(agg[d]).sort(([a], [b]) => a.localeCompare(b));
      return {
        type: "scatter",
        mode: "lines",
        name: d,
        x: entries.map(([date]) => date),
        y: entries.map(([, v]) => metricDisplay(v, metric) ?? 0),
        line: {
          width: i === 0 ? 2.4 : 1.4,
          color: i === 0 ? BRAND_ORANGE : PALETTE[(i + 1) % PALETTE.length],
        },
        hovertemplate: `${d}: %{y:,.1f} ${unit}<extra></extra>`,
      } as PlotData;
    });
}

// ─── Sparkline data helper ─────────────────────────────────────────────────────

function dimensionSparkline(
  rows: UnifiedRow[],
  dimension: string,
  product: Product,
  n: number,
): number[] {
  const metric = metricForProduct(product);
  return rows
    .filter(r => r.dimension === dimension && r[metric] != null)
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(-n)
    .map(r => metricDisplay(r[metric], metric) ?? 0);
}

// ─── Shared chip styles ────────────────────────────────────────────────────────

const chipBase: React.CSSProperties = {
  flex:           "0 0 auto",
  minHeight:      32,
  padding:        "0 12px",
  borderRadius:   999,
  fontFamily:     "Arial, Helvetica, sans-serif",
  fontSize:       12,
  fontWeight:     700,
  cursor:         "pointer",
  display:        "inline-flex",
  alignItems:     "center",
  gap:            6,
  whiteSpace:     "nowrap",
  border:         "1px solid var(--mobile-border, #e0e0e0)",
  background:     "var(--mobile-surface, #fff)",
  color:          "var(--mobile-text, #1a1a1a)",
};

const chipActive: React.CSSProperties = {
  ...chipBase,
  background:     "rgba(255, 80, 0, 0.10)",
  borderColor:    BRAND_ORANGE,
  color:          BRAND_ORANGE,
};

// ─── Mobile view ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const {
    visible, visLoading,
    loading, serieLoading,
    granularity, setGranularity,
    campos,
    allDates, dateRange, setDateRange, hasDates,
    selectedCampos, setSelectedCampos,
    visibleRows,
    explicitDims,
    defaultPetroleoDims, defaultGasDims,
    ranking,
    product,
  } = useAnpCdpDiariaData();

  // Pin granularity to "field" — desktop-only UX choice.
  useEffect(() => {
    if (granularity !== "field") setGranularity("field");
  }, [granularity, setGranularity]);

  // ── Period preset state (mobile-local) ─────────────────────────────────────
  const [activePreset, setActivePreset] = useState<PeriodPreset>("All");

  // Sync activePreset → dateRange. On first mount allDates may be [], so guard.
  useEffect(() => {
    if (!allDates.length) return;
    const next = presetToRange(activePreset, allDates);
    setDateRange(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePreset, allDates.length]);

  // If the user drags the slider manually, clear the preset highlight.
  function handleSliderChange(range: [number, number]) {
    setDateRange(range);
    setActivePreset("All");
  }

  // ── UI state ───────────────────────────────────────────────────────────────
  const [filterOpen,   setFilterOpen]   = useState(false);
  const [allFieldsOpen, setAllFieldsOpen] = useState(false);
  const [fieldSearch,   setFieldSearch]   = useState("");

  // ── Chart dimensions ───────────────────────────────────────────────────────
  const oilChartDims = useMemo(() => {
    const base = explicitDims.length > 0 ? explicitDims : defaultPetroleoDims;
    return base.slice(0, TOP_CHART_TRACES);
  }, [explicitDims, defaultPetroleoDims]);

  const gasChartDims = useMemo(() => {
    const base = explicitDims.length > 0 ? explicitDims : defaultGasDims;
    return base.slice(0, TOP_CHART_TRACES);
  }, [explicitDims, defaultGasDims]);

  const oilTraces = useMemo(
    () => buildMobileChart(visibleRows, "oil", oilChartDims),
    [visibleRows, oilChartDims],
  );
  const gasTraces = useMemo(
    () => buildMobileChart(visibleRows, "gas", gasChartDims),
    [visibleRows, gasChartDims],
  );

  // ── Active filter count (for chip badge) ──────────────────────────────────
  const activeFilterCount =
    (selectedCampos.length > 0 ? 1 : 0) +
    (allDates.length > 0 && (dateRange[0] !== 0 || dateRange[1] !== allDates.length - 1) ? 1 : 0);

  // ── Production summary stats ───────────────────────────────────────────────
  const summaryStats = useMemo(() => {
    if (ranking.length === 0) return null;
    const leader = ranking[0];
    const oilLeaderAvg = metricDisplay(leader.avgOil, "petroleo_bbl_dia") ?? 0;
    const gasLeaderAvg = metricDisplay(leader.avgGas, "gas_mm3_dia")      ?? 0;
    const totalOilAvg  = ranking.reduce((s, r) => s + (metricDisplay(r.avgOil, "petroleo_bbl_dia") ?? 0), 0);
    const totalGasAvg  = ranking.reduce((s, r) => s + (metricDisplay(r.avgGas, "gas_mm3_dia") ?? 0), 0);
    return {
      leaderName:       leader.dimension,
      leaderBacia:      leader.bacia,
      leaderOilAvg:     oilLeaderAvg,
      leaderGasAvg:     gasLeaderAvg,
      totalOilAvg,
      totalGasAvg,
      fieldCount:       ranking.length,
    };
  }, [ranking]);

  // ── Filtered field list in "See all" sheet ─────────────────────────────────
  const filteredSheetRanking = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return ranking;
    return ranking.filter(r => r.dimension.toLowerCase().includes(q));
  }, [ranking, fieldSearch]);

  // ── Filter drawer reset ────────────────────────────────────────────────────
  function handleReset() {
    setSelectedCampos([]);
    if (allDates.length > 0) {
      setDateRange([0, allDates.length - 1]);
    }
    setActivePreset("All");
  }

  // ─────────────────────────────────────────────────────────────────────────
  if (visLoading || !visible) return null;

  const periodBadge: [string, string] | null =
    hasDates && allDates[dateRange[0]] && allDates[dateRange[1]]
      ? [allDates[dateRange[0]], allDates[dateRange[1]]]
      : null;

  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight:  "100dvh",
        // Bottom padding: Home pill (80px) + safe area.
        paddingBottom: "calc(80px + var(--mobile-safe-bottom, 0px))",
      }}
    >
      {/* ── Page heading ───────────────────────────────────────────────────── */}
      <section style={{ padding: "16px 16px 0" }}>
        <h1
          style={{
            margin:        0,
            fontSize:      22,
            fontWeight:    700,
            color:         "var(--mobile-text, #1a1a1a)",
            lineHeight:    1.15,
            letterSpacing: "-0.005em",
          }}
        >
          Daily Production
        </h1>
        <div
          style={{
            marginTop: 4,
            fontSize:  13,
            color:     "var(--mobile-text-muted, #6b6b73)",
            lineHeight: 1.4,
          }}
        >
          Petroleum and gas by field — refreshed 3×/day
        </div>
        {periodBadge && (
          <span
            style={{
              display:        "inline-flex",
              alignItems:     "center",
              gap:            6,
              marginTop:      10,
              padding:        "4px 10px",
              borderRadius:   999,
              background:     "rgba(255, 80, 0, 0.10)",
              color:          BRAND_ORANGE,
              fontSize:       11,
              fontWeight:     700,
              letterSpacing:  "0.04em",
              textTransform:  "uppercase",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width:        6,
                height:       6,
                borderRadius: "50%",
                background:   BRAND_ORANGE,
              }}
            />
            {periodBadge[0]} → {periodBadge[1]}
          </span>
        )}
      </section>

      {/* ── Sticky filter chip row ─────────────────────────────────────────── */}
      <div
        style={{
          position:    "sticky",
          top:         56, // MobileTopBar is 56px
          zIndex:      30,
          background:  "var(--mobile-bg, #f5f5f7)",
          borderBottom: "1px solid var(--mobile-border-soft, #f0f0f5)",
          padding:     "8px 0",
        }}
      >
        {/* Period preset pills */}
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            gap:            6,
            padding:        "0 16px 6px",
            overflowX:      "auto",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
          }}
        >
          {PERIOD_PRESETS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setActivePreset(p)}
              style={{
                ...(activePreset === p ? chipActive : chipBase),
                minHeight:  28,
                padding:    "0 10px",
                fontSize:   12,
              }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Basin + Field + Filters trigger */}
        <div
          style={{
            display:        "flex",
            alignItems:     "center",
            gap:            6,
            padding:        "0 16px",
            overflowX:      "auto",
            WebkitOverflowScrolling: "touch",
            scrollbarWidth: "none",
          }}
        >
          {/* Filters button */}
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            aria-label="Open filters"
            style={{
              ...chipBase,
              borderStyle: "dashed",
            }}
          >
            <FilterIcon size={13} strokeWidth={2.4} />
            Filters
            {activeFilterCount > 0 && (
              <span
                style={{
                  minWidth:   18,
                  height:     18,
                  borderRadius: 999,
                  background: BRAND_ORANGE,
                  color:      "#fff",
                  fontSize:   10,
                  fontWeight: 700,
                  display:    "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding:    "0 5px",
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Active field chip */}
          {selectedCampos.length > 0 && (
            <span style={chipActive}>
              {selectedCampos.length === 1
                ? selectedCampos[0].length > 16
                  ? selectedCampos[0].slice(0, 14) + "…"
                  : selectedCampos[0]
                : `Fields: ${selectedCampos.length}`}
              <button
                type="button"
                onClick={() => setSelectedCampos([])}
                aria-label="Clear field filter"
                style={{
                  width:   18,
                  height:  18,
                  border:  0,
                  background: "transparent",
                  color:   BRAND_ORANGE,
                  cursor:  "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CloseIcon size={9} strokeWidth={2.5} />
              </button>
            </span>
          )}
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: "48px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : visibleRows.length === 0 ? (
        <div
          style={{
            margin:      "16px",
            padding:     "32px 16px",
            textAlign:   "center",
            color:       "var(--mobile-text-muted, #6b6b73)",
            background:  "var(--mobile-surface, #fff)",
            border:      "1px dashed var(--mobile-border, #e0e0e0)",
            borderRadius: 12,
            fontSize:    13,
            lineHeight:  1.4,
          }}
        >
          No production data for the current filters.
        </div>
      ) : (
        <>
          {/* ── Section 1: Oil chart ──────────────────────────────────────── */}
          <ChartSection
            title="Oil Production"
            unit="kbpd"
            topN={oilChartDims.length}
            isExplicit={explicitDims.length > 0}
            explicitCount={explicitDims.length}
            updating={serieLoading}
          >
            <MobileChart
              data={oilTraces}
              height={260}
              layout={{
                xaxis: { type: "date" as const, nticks: 4 },
                yaxis: { nticks: 4 },
                showlegend: oilChartDims.length > 1,
                legend: {
                  orientation:  "h",
                  yanchor:      "bottom",
                  y:            1.01,
                  xanchor:      "left",
                  x:            0,
                  font:         { size: 10 },
                },
              }}
            />
          </ChartSection>

          {/* ── Section 2: Gas chart ──────────────────────────────────────── */}
          <ChartSection
            title="Gas Production"
            unit="Mm³/d"
            topN={gasChartDims.length}
            isExplicit={explicitDims.length > 0}
            explicitCount={explicitDims.length}
            updating={serieLoading}
          >
            <MobileChart
              data={gasTraces}
              height={260}
              layout={{
                xaxis: { type: "date" as const, nticks: 4 },
                yaxis: { nticks: 4 },
                showlegend: gasChartDims.length > 1,
                legend: {
                  orientation:  "h",
                  yanchor:      "bottom",
                  y:            1.01,
                  xanchor:      "left",
                  x:            0,
                  font:         { size: 10 },
                },
              }}
            />
          </ChartSection>

          {/* ── Section 3: Top 10 ranking ─────────────────────────────────── */}
          <section style={{ marginTop: 4 }}>
            {/* Section header */}
            <div
              style={{
                padding:         "10px 16px 8px",
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "space-between",
              }}
            >
              <div
                style={{
                  fontSize:   16,
                  fontWeight: 700,
                  color:      "var(--mobile-text, #1a1a1a)",
                  display:    "flex",
                  alignItems: "baseline",
                  gap:        8,
                }}
              >
                Top {Math.min(ranking.length, TOP_RANKING_CARDS)} Fields
                <span
                  style={{
                    fontSize:  12,
                    fontWeight: 600,
                    color:     "var(--mobile-text-muted, #6b6b73)",
                  }}
                >
                  by avg {product === "oil" ? "Oil" : "Gas"}
                </span>
              </div>
              {ranking.length > TOP_RANKING_CARDS && (
                <button
                  type="button"
                  onClick={() => { setFieldSearch(""); setAllFieldsOpen(true); }}
                  style={{
                    border:     0,
                    background: "transparent",
                    color:      BRAND_ORANGE,
                    fontFamily: "inherit",
                    fontSize:   13,
                    fontWeight: 700,
                    cursor:     "pointer",
                    padding:    0,
                  }}
                >
                  See all {ranking.length} →
                </button>
              )}
            </div>

            {/* Top-10 card list */}
            <div
              style={{
                background:   "var(--mobile-surface, #fff)",
                borderTop:    "1px solid var(--mobile-border-soft, #f0f0f5)",
                borderBottom: "1px solid var(--mobile-border-soft, #f0f0f5)",
              }}
            >
              {ranking.slice(0, TOP_RANKING_CARDS).map((r, idx) =>
                <RankingCard
                  key={r.dimension}
                  rank={idx + 1}
                  item={r}
                  product={product}
                  rows={visibleRows}
                />
              )}
            </div>

            {/* "See all" trigger (also at bottom of list) */}
            {ranking.length > TOP_RANKING_CARDS && (
              <div style={{ padding: "12px 16px" }}>
                <button
                  type="button"
                  onClick={() => { setFieldSearch(""); setAllFieldsOpen(true); }}
                  style={{
                    width:        "100%",
                    minHeight:    44,
                    borderRadius: 12,
                    border:       `1.5px solid ${BRAND_ORANGE}`,
                    background:   "rgba(255, 80, 0, 0.06)",
                    color:        BRAND_ORANGE,
                    fontFamily:   "inherit",
                    fontSize:     14,
                    fontWeight:   700,
                    cursor:       "pointer",
                    display:      "flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    gap:          6,
                  }}
                >
                  See all {ranking.length} fields
                </button>
              </div>
            )}
          </section>

          {/* ── Production summary card ───────────────────────────────────── */}
          {summaryStats && (
            <section style={{ margin: "4px 16px 0" }}>
              <div
                style={{
                  padding:      "14px 16px",
                  background:   "var(--mobile-surface, #fff)",
                  borderRadius: 14,
                  border:       "1px solid var(--mobile-border-soft, #f0f0f5)",
                  boxShadow:    "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div
                  style={{
                    fontSize:      12,
                    fontWeight:    700,
                    color:         "var(--mobile-text-muted, #6b6b73)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom:  12,
                  }}
                >
                  Production Summary
                </div>
                <div
                  style={{
                    display:             "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap:                 1,
                    background:          "var(--mobile-border-soft, #f0f0f5)",
                    borderRadius:        10,
                    overflow:            "hidden",
                  }}
                >
                  <SummaryCell label="Leader" value={summaryStats.leaderName} accent />
                  <SummaryCell
                    label="Total Oil (avg)"
                    value={fmtNumber(summaryStats.totalOilAvg, 1) + " kbpd"}
                  />
                  <SummaryCell
                    label="Total Gas (avg)"
                    value={fmtNumber(summaryStats.totalGasAvg, 3) + " Mm³/d"}
                  />
                  <SummaryCell
                    label="Leader Oil"
                    value={fmtNumber(summaryStats.leaderOilAvg, 1) + " kbpd"}
                  />
                  <SummaryCell
                    label="Leader Gas"
                    value={fmtNumber(summaryStats.leaderGasAvg, 3) + " Mm³/d"}
                  />
                  <SummaryCell
                    label="Fields"
                    value={summaryStats.fieldCount.toLocaleString("pt-BR")}
                  />
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* ── Filter drawer ────────────────────────────────────────────────────── */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        onReset={handleReset}
        onApply={() => setFilterOpen(false)}
        applyLabel="Apply"
      >
        {/* Period filter */}
        {hasDates && (
          <div style={{ marginBottom: 18 }}>
            <div style={drawerSectionLabel}>
              Period
            </div>
            <PeriodSlider
              dates={allDates}
              value={dateRange}
              onChange={handleSliderChange}
            />
          </div>
        )}

        {/* Field chip cloud */}
        <div>
          <div
            style={{
              ...drawerSectionLabel,
              display:        "flex",
              alignItems:     "center",
              justifyContent: "space-between",
              gap:            8,
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
                  border:         0,
                  background:     "transparent",
                  color:          BRAND_ORANGE,
                  fontFamily:     "inherit",
                  fontSize:       11,
                  fontWeight:     700,
                  textTransform:  "uppercase",
                  letterSpacing:  "0.04em",
                  cursor:         "pointer",
                  padding:        0,
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div
            style={{
              maxHeight:             240,
              overflowY:             "auto",
              WebkitOverflowScrolling: "touch",
              display:               "flex",
              flexWrap:              "wrap",
              gap:                   6,
              padding:               2,
              marginTop:             4,
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
                    minHeight:  30,
                    padding:    "0 10px",
                    borderRadius: 999,
                    border:     "1px solid",
                    borderColor: active ? BRAND_ORANGE : "var(--mobile-border, #e0e0e0)",
                    background:  active ? "rgba(255,80,0,0.08)" : "transparent",
                    color:       active ? BRAND_ORANGE : "var(--mobile-text-muted, #6b6b73)",
                    fontFamily:  "inherit",
                    fontSize:    11,
                    fontWeight:  600,
                    cursor:      "pointer",
                    whiteSpace:  "nowrap",
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
                fontSize:  11,
                color:     "var(--mobile-text-muted, #6b6b73)",
                lineHeight: 1.4,
              }}
            >
              No selection: charts show Top {TOP_CHART_TRACES} fields by average.
            </div>
          )}
        </div>
      </FilterDrawer>

      {/* ── "See all fields" BottomSheet ────────────────────────────────────── */}
      <BottomSheet
        open={allFieldsOpen}
        onClose={() => setAllFieldsOpen(false)}
        title={`All Fields (${ranking.length})`}
        height="90vh"
      >
        {/* Search input */}
        <div style={{ marginBottom: 12 }}>
          <input
            type="search"
            placeholder="Search fields..."
            value={fieldSearch}
            onChange={e => setFieldSearch(e.target.value)}
            style={{
              width:        "100%",
              boxSizing:    "border-box",
              height:       38,
              padding:      "0 12px",
              borderRadius: 10,
              border:       "1px solid var(--mobile-border, #e0e0e0)",
              background:   "var(--mobile-surface, #fff)",
              color:        "var(--mobile-text, #1a1a1a)",
              fontFamily:   "inherit",
              fontSize:     14,
              outline:      "none",
            }}
          />
          {filteredSheetRanking.length === 0 && fieldSearch && (
            <div
              style={{
                marginTop: 8,
                fontSize:  12,
                color:     "var(--mobile-text-muted, #6b6b73)",
              }}
            >
              No fields matching "{fieldSearch}"
            </div>
          )}
        </div>

        {/* Full ranking list */}
        <div style={{ margin: "0 -16px" }}>
          {filteredSheetRanking.map((r) => (
            <RankingCard
              key={r.dimension}
              rank={ranking.indexOf(r) + 1}
              item={r}
              product={product}
              rows={visibleRows}
            />
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Shared section label style for the filter drawer. */
const drawerSectionLabel: React.CSSProperties = {
  fontSize:      11,
  fontWeight:    700,
  marginBottom:  6,
  color:         "var(--mobile-text, #1a1a1a)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

/** Chart card wrapper — title + updating indicator + chart slot. */
function ChartSection({
  title,
  unit,
  topN,
  isExplicit,
  explicitCount,
  updating,
  children,
}: {
  title: string;
  unit: string;
  topN: number;
  isExplicit: boolean;
  explicitCount: number;
  updating: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      style={{
        margin:       "12px 16px 0",
        padding:      "14px 14px 12px",
        background:   "var(--mobile-surface, #fff)",
        borderRadius: 14,
        border:       "1px solid var(--mobile-border-soft, #f0f0f5)",
        boxShadow:    "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div
        style={{
          display:         "flex",
          alignItems:      "baseline",
          justifyContent:  "space-between",
          marginBottom:    4,
          opacity:         updating ? 0.6 : 1,
          transition:      "opacity 0.2s",
        }}
      >
        <div
          style={{
            fontSize:   13,
            fontWeight: 700,
            color:      "var(--mobile-text, #1a1a1a)",
            letterSpacing: "0.01em",
          }}
        >
          {title}
          {" "}
          <span
            style={{
              fontSize:   12,
              fontWeight: 400,
              color:      "var(--mobile-text-muted, #6b6b73)",
            }}
          >
            {isExplicit
              ? `(${explicitCount} selected)`
              : `Top ${topN} fields`}
          </span>
          {updating && (
            <span
              style={{
                marginLeft: 6,
                fontSize:   11,
                fontWeight: 400,
                color:      "var(--mobile-text-muted, #6b6b73)",
              }}
            >
              updating...
            </span>
          )}
        </div>
        <div
          style={{
            fontSize:      11,
            color:         "var(--mobile-text-muted, #6b6b73)",
            fontWeight:    600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {unit}
        </div>
      </div>
      {children}
    </section>
  );
}

/** One row in the ranking list / sheet. */
function RankingCard({
  rank,
  item,
  product,
  rows,
}: {
  rank: number;
  item: DimensionAggregate;
  product: Product;
  rows: UnifiedRow[];
}): React.ReactElement {
  const isLeader = rank === 1;
  const metric   = metricForProduct(product);
  const unit     = productUnitLabel(product);
  const latestRaw = product === "oil" ? item.latestOil : item.latestGas;
  const avgRaw    = product === "oil" ? item.avgOil    : item.avgGas;
  const latestDisp = metricDisplay(latestRaw, metric);
  const avgDisp    = metricDisplay(avgRaw,    metric);
  const digits     = product === "oil" ? 1 : 3;
  const sparkValues = dimensionSparkline(rows, item.dimension, product, SPARKLINE_POINTS);

  return (
    <MobileDataCard
      key={item.dimension}
      variant="default"
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              minWidth:   22,
              height:     22,
              padding:    "0 6px",
              borderRadius: 999,
              background:  isLeader ? BRAND_ORANGE : "var(--mobile-divider, #f0f0f0)",
              color:       isLeader ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
              fontSize:    11,
              fontWeight:  700,
              display:     "inline-flex",
              alignItems:  "center",
              justifyContent: "center",
              letterSpacing: "0.02em",
              flexShrink:  0,
            }}
          >
            #{rank}
          </span>
          <span style={{ fontWeight: 700, color: "var(--mobile-text, #1a1a1a)" }}>
            {item.dimension}
          </span>
        </span>
      }
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {item.bacia && (
            <span
              style={{
                display:     "inline-flex",
                alignItems:  "center",
                padding:     "2px 8px",
                borderRadius: 6,
                background:  "var(--mobile-surface-2, #fafafc)",
                border:      "1px solid var(--mobile-border, #e0e0e0)",
                color:       "var(--mobile-text-muted, #6b6b73)",
                fontSize:    11,
                fontWeight:  700,
              }}
            >
              {item.bacia}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)" }}>
            Avg {fmtNumber(avgDisp, digits)} {unit}
          </span>
        </span>
      }
      sparkline={sparkValues.length >= 2 ? sparkValues : undefined}
      sparklineColor={isLeader ? BRAND_ORANGE : PALETTE[(rank) % PALETTE.length]}
      rightSlot={
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span
            style={{
              fontSize:            15,
              fontWeight:          700,
              color:               "var(--mobile-text, #1a1a1a)",
              fontVariantNumeric:  "tabular-nums",
              lineHeight:          1.1,
              whiteSpace:          "nowrap",
            }}
          >
            {fmtNumber(latestDisp, digits)}
          </span>
          <span
            style={{
              fontSize:   11,
              color:      "var(--mobile-text-muted, #6b6b73)",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {item.latestDate ?? "—"}
          </span>
        </div>
      }
    />
  );
}

/** One cell inside the production summary grid. */
function SummaryCell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        background:  "var(--mobile-surface, #fff)",
        padding:     "10px 8px",
        textAlign:   "center",
      }}
    >
      <div
        style={{
          fontSize:      10,
          fontWeight:    700,
          color:         "var(--mobile-text-muted, #6b6b73)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop:           4,
          fontSize:            accent ? 13 : 14,
          fontWeight:          700,
          color:               accent ? BRAND_ORANGE : "var(--mobile-text, #1a1a1a)",
          fontVariantNumeric:  "tabular-nums",
          lineHeight:          1.1,
          whiteSpace:          "nowrap",
          overflow:            "hidden",
          textOverflow:        "ellipsis",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

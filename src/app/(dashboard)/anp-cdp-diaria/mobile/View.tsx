"use client";

// Mobile View — ANP CDP Daily Production (≤768px).
//
// Two-Tier Tabs IA (2026-06-05) — mobile adaptation of the desktop redesign.
//
// Landing = company net production (PRIO by default, zero clicks). A hero
// [ PRIO | Petrobras ] toggle sits at the top; below it the CompanyMobileContent
// renders the selected company's stake-weighted net production. Underneath, a
// discreet full-width dashed button "Explore raw data (Field, Installation) >"
// opens a 90vh BottomSheet with sub-tabs [Field | Installation] + the existing
// Fields-mode body (period presets + Field chip filter + Oil/Gas charts +
// ranking cards + "See all").
//
// Intentionally NOT on mobile ([mobile-only] decisions):
//   • Well level — NOT reachable on mobile (desktop-only; hardcore surface)
//   • Installation lives ONLY inside the Explore sheet (desktop also has it but
//     as a primary sub-tab; on mobile it is sheet-gated)
//   • ExportFAB / ExportModal — export is desktop-only (plan § 3.4)
//   • Recent-records HTML table — wrong shape for phones
//   • MobileTopBar / NavBar / useIsMobile() / dark-mode CSS
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful analysis changes
// must land in desktop/View.tsx in the SAME commit, or the commit must declare
// [mobile-only] with explicit reason.

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import {
  MobileChart,
  MobileDataCard,
  BottomSheet,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";

import {
  useAnpCdpDiariaData,
  metricForProduct,
  metricDisplay,
  fmtNumber,
  formatStakePct,
  productUnitLabel,
  BRAND_ORANGE,
  COMPANY_FIELD_COLORS,
  COMPANY_TOTAL_LABEL,
  FIXED_COMPANIES,
  PETROBRAS,
  type Product,
  type UnifiedRow,
  type DimensionAggregate,
  type CompanyFieldAggregate,
  type AnpCdpDiariaEmpresaSeriePonto,
} from "../useAnpCdpDiariaData";
import { bblDiaToKbpd } from "../../../../lib/units";

// TEMPORARY — P-78 daily-panel coverage banner, Petrobras tab ONLY (user
// decision 2026-06-10). Remove when ANP registers FPSO P-78 in the daily
// panel (the cdp_roster_canary ops email is the trigger; the ETL
// auto-backfills the history). See P78CoverageNotice.tsx.
import P78CoverageNotice from "../P78CoverageNotice";

// ─── Constants ─────────────────────────────────────────────────────────────────

const TOP_CHART_TRACES  = 5;   // chart legibility on 375px screens
const TOP_RANKING_CARDS = 10;  // cards shown before "See all" sheet
const SPARKLINE_POINTS  = 14;  // ~2 weeks of daily values

// Sub-tabs inside the Explore sheet (Well is desktop-only — not here).
type ExploreLevel = "field" | "installation";

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
          // Leader pops orange; followers walk COMPANY_FIELD_COLORS (PALETTE
          // minus orange) so no follower can re-issue orange and collide with
          // the leader, even past the 12-color wrap.
          color:
            i === 0
              ? BRAND_ORANGE
              : COMPANY_FIELD_COLORS[(i - 1) % COMPANY_FIELD_COLORS.length],
        },
        hovertemplate: `${d}: %{y:,.1f} ${unit}<extra></extra>`,
      } as PlotData;
    });
}

/**
 * Company-mode net total line (single bold orange trace). Sums the NET column
 * across all fields per day. Oil is converted to kbpd, gas stays in Mm³/d.
 */
function buildCompanyTotalTrace(
  rows: AnpCdpDiariaEmpresaSeriePonto[],
  product: Product,
): PlotData[] {
  const isOil = product === "oil";
  const byDay: Record<string, number> = {};
  for (const r of rows) {
    const v = isOil ? r.petroleo_bbl_dia_net : r.gas_mm3_dia_net;
    if (v == null) continue;
    byDay[r.data] = (byDay[r.data] ?? 0) + v;
  }
  const entries = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return [];
  const unit = productUnitLabel(product);
  return [{
    type: "scatter",
    mode: "lines",
    name: COMPANY_TOTAL_LABEL,
    x: entries.map(([d]) => d),
    y: entries.map(([, v]) => (isOil ? bblDiaToKbpd(v) : v)),
    line: { width: 2.6, color: BRAND_ORANGE },
    hovertemplate: `${COMPANY_TOTAL_LABEL}: %{y:,.1f} ${unit}<extra></extra>`,
  } as PlotData];
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
    // Company level
    selectedEmpresa, setSelectedEmpresa,
    companySerieRows,
    companyFieldAggregates, companyFieldCount, companyFieldsNoData,
    companyMonthlyOilChart,
  } = useAnpCdpDiariaData();

  // ── Explore sheet state (Field / Installation; Well is desktop-only) ───────
  const [exploreOpen, setExploreOpen] = useState(false);
  const exploreLevel: ExploreLevel = granularity === "installation" ? "installation" : "field";

  // Hero tab dispatch: pick a company AND ensure the company landing is active.
  function selectCompany(name: string) {
    setSelectedEmpresa(name);
    if (granularity !== "company") setGranularity("company");
  }

  // Open the Explore sheet → lazy-mount the granular RPCs at Field level.
  function openExplore() {
    if (granularity === "company") setGranularity("field");
    setExploreOpen(true);
  }
  // Close the Explore sheet → return to the company landing (PRIO/Petrobras).
  // Default back to the first fixed company if one wasn't preserved.
  function closeExplore() {
    setExploreOpen(false);
    setSelectedEmpresa(selectedEmpresa ?? FIXED_COMPANIES[0]);
    setGranularity("company");
  }

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
  const [allFieldsOpen, setAllFieldsOpen] = useState(false);
  const [fieldSearch,   setFieldSearch]   = useState("");

  // ── Company-mode chart trace (net total OIL line; gas chart removed) ────────
  const companyOilTrace = useMemo(
    () => buildCompanyTotalTrace(companySerieRows, "oil"),
    [companySerieRows],
  );

  // ── Chart dimensions (Explore sheet) ───────────────────────────────────────
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

  // ── Filtered field list in "See all" sheet ─────────────────────────────────
  const filteredSheetRanking = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return ranking;
    return ranking.filter(r => r.dimension.toLowerCase().includes(q));
  }, [ranking, fieldSearch]);

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
          Net production by field, weighted by the company&apos;s effective stake
        </div>

        {/* Hero PRIO | Petrobras toggle (company landing) */}
        <div style={{ marginTop: 12 }}>
          <SegmentedToggle<string>
            value={selectedEmpresa ?? FIXED_COMPANIES[0]}
            onChange={selectCompany}
            options={FIXED_COMPANIES.map(c => ({ value: c, label: c }))}
          />
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

      {/* ── TEMPORARY P-78 coverage banner — Petrobras tab ONLY (user decision
             2026-06-10): P-78 is a Petrobras/Búzios asset, so the
             understatement only affects this tab. Not repeated in the Explore
             sheet (Petrobras isn't the selected company there). ── */}
      {selectedEmpresa === PETROBRAS && (
        <section style={{ padding: "12px 16px 0", marginBottom: 4 }}>
          <P78CoverageNotice variant="mobile" />
        </section>
      )}

      {/* ── Sticky period preset row ───────────────────────────────────────── */}
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
      </div>

      {/* ── Main content: company landing ──────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: "48px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <CompanyMobileContent
          selectedEmpresa={selectedEmpresa}
          serieLoading={serieLoading}
          companySerieRows={companySerieRows}
          companyFieldAggregates={companyFieldAggregates}
          companyFieldCount={companyFieldCount}
          companyFieldsNoData={companyFieldsNoData}
          companyOilTrace={companyOilTrace}
          companyMonthlyOilChart={companyMonthlyOilChart}
        />
      )}

      {/* ── Explore raw data trigger (discreet, full-width dashed) ──────────── */}
      {!loading && (
        <section style={{ margin: "16px 16px 0" }}>
          <button
            type="button"
            onClick={openExplore}
            style={{
              width:        "100%",
              minHeight:    48,
              borderRadius: 12,
              border:       "1.5px dashed var(--mobile-border, #c8c8d0)",
              background:   "transparent",
              color:        "var(--mobile-text-muted, #6b6b73)",
              fontFamily:   "inherit",
              fontSize:     13,
              fontWeight:   600,
              cursor:       "pointer",
              display:      "flex",
              alignItems:   "center",
              justifyContent: "center",
              gap:          6,
            }}
          >
            Explore raw data (Field, Installation) ›
          </button>
        </section>
      )}

      {/* ── Explore raw data BottomSheet (Field / Installation) ────────────── */}
      <BottomSheet
        open={exploreOpen}
        onClose={closeExplore}
        title="Explore raw data"
        height="90vh"
      >
        {/* Caption — signals gross vs net */}
        <div style={{ fontSize: 12, color: "var(--mobile-text-muted, #6b6b73)", marginBottom: 10 }}>
          Unweighted ANP daily feed — all operators.
        </div>

        {/* Sub-tabs [Field | Installation] */}
        <div style={{ marginBottom: 12 }}>
          <SegmentedToggle<ExploreLevel>
            value={exploreLevel}
            onChange={(v) => setGranularity(v)}
            options={[
              { value: "field",        label: "Field" },
              { value: "installation", label: "Installation" },
            ]}
          />
        </div>

        {/* Period slider (granular surface shares the dateRange) */}
        {hasDates && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...drawerSectionLabel }}>Period</div>
            <PeriodSlider dates={allDates} value={dateRange} onChange={handleSliderChange} />
          </div>
        )}

        {/* Field chip filter (Field level only) */}
        {granularity === "field" && (
          <div style={{ marginBottom: 14 }}>
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
                maxHeight:             200,
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
          </div>
        )}

        {/* Charts + ranking body */}
        {visibleRows.length === 0 ? (
          <div
            style={{
              margin:      "8px 0",
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
            {/* Oil chart */}
            <ChartCard
              title="Oil Production"
              unit="kbpd"
              topN={oilChartDims.length}
              isExplicit={explicitDims.length > 0}
              explicitCount={explicitDims.length}
              updating={serieLoading}
            >
              <MobileChart
                data={oilTraces}
                height={240}
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
            </ChartCard>

            {/* Gas chart */}
            <ChartCard
              title="Gas Production"
              unit="Mm³/d"
              topN={gasChartDims.length}
              isExplicit={explicitDims.length > 0}
              explicitCount={explicitDims.length}
              updating={serieLoading}
            >
              <MobileChart
                data={gasTraces}
                height={240}
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
            </ChartCard>

            {/* Top 10 ranking */}
            <section style={{ marginTop: 8 }}>
              <div
                style={{
                  padding:         "4px 0 8px",
                  display:         "flex",
                  alignItems:      "center",
                  justifyContent:  "space-between",
                }}
              >
                <div
                  style={{
                    fontSize:   15,
                    fontWeight: 700,
                    color:      "var(--mobile-text, #1a1a1a)",
                    display:    "flex",
                    alignItems: "baseline",
                    gap:        8,
                  }}
                >
                  Top {Math.min(ranking.length, TOP_RANKING_CARDS)}
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

              <div
                style={{
                  margin:       "0 -16px",
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
            </section>
          </>
        )}
      </BottomSheet>

      {/* ── "See all fields" BottomSheet (nested over Explore) ──────────────── */}
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
              No fields matching &quot;{fieldSearch}&quot;
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

/** Shared section label style. */
const drawerSectionLabel: React.CSSProperties = {
  fontSize:      11,
  fontWeight:    700,
  marginBottom:  6,
  color:         "var(--mobile-text, #1a1a1a)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

/** Chart card wrapper — title + updating indicator + chart slot. */
function ChartCard({
  title,
  unit,
  topN,
  isExplicit,
  explicitCount,
  updating,
  companyTotal = false,
  children,
}: {
  title: string;
  unit: string;
  topN: number;
  isExplicit: boolean;
  explicitCount: number;
  updating: boolean;
  /** Company mode: label reads "total + N fields" instead of "(N selected)". */
  companyTotal?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      style={{
        margin:       "12px 0 0",
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
            {companyTotal
              ? `total · ${explicitCount} field${explicitCount === 1 ? "" : "s"}`
              : isExplicit
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
      sparklineColor={
        isLeader
          ? BRAND_ORANGE
          : COMPANY_FIELD_COLORS[(rank - 2) % COMPANY_FIELD_COLORS.length]
      }
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


// ─── Company-mode content (landing) ───────────────────────────────────────────

/**
 * Company landing on mobile: net-oil monthly stacked bar by field (each bar
 * carries its monthly total as an on-bar label) + net-oil total line, per-field
 * net ranking cards (stake % + net values), and the coverage note listing
 * stake-held fields without daily data yet. Gas is oil-only here too — the gas
 * chart was removed (2026-06-05). The net-average summary cells were dropped
 * (2026-06-05); the monthly total now lives as a label on top of each stacked
 * bar. PRIO is selected on landing.
 */
function CompanyMobileContent({
  selectedEmpresa,
  serieLoading,
  companySerieRows,
  companyFieldAggregates,
  companyFieldCount,
  companyFieldsNoData,
  companyOilTrace,
  companyMonthlyOilChart,
}: {
  selectedEmpresa: string | null;
  serieLoading: boolean;
  companySerieRows: AnpCdpDiariaEmpresaSeriePonto[];
  companyFieldAggregates: CompanyFieldAggregate[];
  /** Honest distinct-field-with-daily-data count (not the capped top-6+Others). */
  companyFieldCount: number;
  companyFieldsNoData: { campo: string; stakePct: number }[];
  companyOilTrace: PlotData[];
  companyMonthlyOilChart: { data: PlotData[]; layout: Partial<Layout> };
}): React.ReactElement {
  if (companySerieRows.length === 0 && !serieLoading) {
    return (
      <div style={emptyBoxStyle}>
        No daily data for {selectedEmpresa ?? "this company"} in the selected period.
      </div>
    );
  }

  return (
    <>
      {/* Monthly average net oil by field (stacked bar, MtD-aware) — each bar
          carries its monthly total on top (replaces the old summary cells). */}
      <section style={{ margin: "12px 16px 0" }}>
        <ChartCard
          title="Net Oil — Monthly Avg by Field"
          unit="kbpd"
          topN={0}
          isExplicit
          explicitCount={companyFieldCount}
          updating={serieLoading}
          companyTotal
        >
          <MobileChart
            data={companyMonthlyOilChart.data}
            height={260}
            layout={{
              barmode: "stack",
              // Carry the on-bar monthly total labels through from the hook,
              // shrunk to ~10px so 7 of them fit a ~260px chart. Top margin
              // widened so the topmost label is not clipped.
              annotations: (companyMonthlyOilChart.layout.annotations ?? []).map(a => ({
                ...a,
                font: { ...(a.font ?? {}), size: 10 },
              })),
              margin: { l: 32, r: 8, t: 22, b: 28 },
              xaxis: companyMonthlyOilChart.layout.xaxis,
              yaxis: { nticks: 4 },
              showlegend: companyMonthlyOilChart.data.length > 1,
              legend: {
                orientation: "h",
                yanchor: "bottom",
                y: 1.02,
                xanchor: "left",
                x: 0,
                font: { size: 9 },
              },
            }}
          />
        </ChartCard>
      </section>

      {/* Oil net total line chart */}
      <section style={{ margin: "12px 16px 0" }}>
        <ChartCard
          title="Net Oil"
          unit="kbpd"
          topN={0}
          isExplicit
          explicitCount={companyFieldCount}
          updating={serieLoading}
          companyTotal
        >
          <MobileChart
            data={companyOilTrace}
            height={240}
            layout={{
              xaxis: { type: "date" as const, nticks: 4 },
              yaxis: { nticks: 4 },
              showlegend: false,
            }}
          />
        </ChartCard>
      </section>

      {/* Per-field net ranking */}
      <section style={{ marginTop: 4 }}>
        <div style={{ padding: "10px 16px 8px" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)" }}>
            By Field — Net
          </div>
        </div>
        <div
          style={{
            background:   "var(--mobile-surface, #fff)",
            borderTop:    "1px solid var(--mobile-border-soft, #f0f0f5)",
            borderBottom: "1px solid var(--mobile-border-soft, #f0f0f5)",
          }}
        >
          {companyFieldAggregates.map((f, idx) => (
            <CompanyFieldCard key={f.campo} rank={idx + 1} item={f} />
          ))}
          {companyFieldAggregates.length === 0 && (
            <div style={{ padding: "16px", color: "var(--mobile-text-muted, #6b6b73)", fontSize: 13 }}>
              No data for the current period.
            </div>
          )}
        </div>
      </section>

      {/* Coverage note */}
      {companyFieldsNoData.length > 0 && (
        <section style={{ margin: "12px 16px 0" }}>
          <div
            style={{
              padding:      "12px 14px",
              background:   "var(--mobile-surface, #fff)",
              borderRadius: 12,
              border:       "1px dashed var(--mobile-border, #e0e0e0)",
              fontSize:     12,
              color:        "var(--mobile-text-muted, #6b6b73)",
              lineHeight:   1.5,
            }}
          >
            <strong style={{ color: "var(--mobile-text, #1a1a1a)" }}>Not yet in the daily feed:</strong>{" "}
            {companyFieldsNoData
              .map(f => `${f.campo} (${formatStakePct(f.stakePct)})`)
              .join(", ")}
            .
          </div>
        </section>
      )}

      {/* Stake methodology note — mobile counterpart of the desktop sidebar note. */}
      <section style={{ margin: "12px 16px 0" }}>
        <div
          style={{
            fontSize:   11,
            color:      "var(--mobile-text-muted, #6b6b73)",
            lineHeight: 1.5,
            paddingLeft: 2,
          }}
        >
          Net = field daily production × the company&apos;s effective stake
          (contract-tranche blend, monthly). Field labels show the latest
          month&apos;s stake.
        </div>
      </section>
    </>
  );
}

/** One per-field net card (Company level). Shows stake % + net oil/gas latest + avg. */
function CompanyFieldCard({
  rank,
  item,
}: {
  rank: number;
  item: CompanyFieldAggregate;
}): React.ReactElement {
  const isLeader = rank === 1;
  return (
    <MobileDataCard
      variant="default"
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              minWidth: 22, height: 22, padding: "0 6px", borderRadius: 999,
              background: isLeader ? BRAND_ORANGE : "var(--mobile-divider, #f0f0f0)",
              color: isLeader ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
              fontSize: 11, fontWeight: 700, display: "inline-flex",
              alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            #{rank}
          </span>
          <span style={{ fontWeight: 700, color: "var(--mobile-text, #1a1a1a)" }}>
            {item.campo}
          </span>
        </span>
      }
      subtitle={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {/* Others is a mixed-stake aggregate → no stake badge. */}
          {Number.isFinite(item.stakePct) && (
            <span
              style={{
                display: "inline-flex", alignItems: "center", padding: "2px 8px",
                borderRadius: 6, background: "var(--mobile-surface-2, #fafafc)",
                border: "1px solid var(--mobile-border, #e0e0e0)",
                color: "var(--mobile-text-muted, #6b6b73)", fontSize: 11, fontWeight: 700,
              }}
            >
              {formatStakePct(item.stakePct)}
            </span>
          )}
          {item.bacia && (
            <span style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)" }}>
              {item.bacia}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)" }}>
            Avg {fmtNumber(item.avgOilNet / 1000, 1)} kbpd
          </span>
        </span>
      }
      rightSlot={
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span
            style={{
              fontSize: 15, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)",
              fontVariantNumeric: "tabular-nums", lineHeight: 1.1, whiteSpace: "nowrap",
            }}
          >
            {fmtNumber(item.latestOilNet == null ? null : item.latestOilNet / 1000, 1)} kbpd
          </span>
          <span style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)", fontWeight: 600, whiteSpace: "nowrap" }}>
            {item.latestDate ?? "—"}
          </span>
        </div>
      }
    />
  );
}

/** Shared empty-state box style for the company content. */
const emptyBoxStyle: React.CSSProperties = {
  margin:      "16px",
  padding:     "32px 16px",
  textAlign:   "center",
  color:       "var(--mobile-text-muted, #6b6b73)",
  background:  "var(--mobile-surface, #fff)",
  border:      "1px dashed var(--mobile-border, #e0e0e0)",
  borderRadius: 12,
  fontSize:    13,
  lineHeight:  1.4,
};

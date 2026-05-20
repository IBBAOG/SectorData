"use client";

/**
 * Mobile view — /anp-cdp.
 *
 * Archetype: hierarchical drill-down. Visual source of truth:
 *   mockups/anp-cdp-mobile.html (approved 2026-05-20).
 *
 * Structure (top → bottom):
 *   MobileTopBar (sticky liquid glass)
 *   StickyBreadcrumb — 4-level scope chain (All Brazil › Basin › Local › Field › Well)
 *   Page head (title + subtitle + period badge)
 *   Product MobileTabBar — Petroleum / Gas / Water
 *   Hero MobileChart — area chart with peak annotation
 *   3-mini-stat row — Total / Avg / Peak (display units)
 *   Filter chip row (sticky) — Filters trigger + active filter chips
 *   Drill-down list — wells (or fields/locals/basins depending on level)
 *     with inline sparklines and field metadata
 *   ExportFAB (Tier 2 — opens BottomSheet "Export options")
 *   Up-one-level FAB (only visible when drilled in)
 *   MobileBottomTabBar — Production / Map / Compare / Profile (latter 3 are
 *     [mobile-only] placeholders matching the mockup; primary nav is the
 *     SectorData NavBar which is hidden on mobile via useIsMobile)
 *   FilterDrawer (BottomSheet) — Basin / Local / Operator / Period multi-selects
 *   Export BottomSheet — Tier 2 mirror of desktop ExportModal
 *
 * The 3 product tabs (Petroleum/Gas/Water) collapse the 9 desktop metrics
 * into the 3 most relevant families. Each tab swaps the chart metric to a
 * sensible default; advanced metric switching lives in the FilterDrawer.
 *
 * Binding sync rule: meaningful changes here must land in desktop/View.tsx
 * in the same commit, OR the commit message must declare [mobile-only].
 */

import { useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  MobileBottomTabBar,
  type MobileBottomTab,
  StickyBreadcrumb,
  MobileChart,
  MobileDataCard,
  MobileTabBar,
  FilterDrawer,
  BottomSheet,
  ExportFAB,
} from "../../../../components/dashboard/mobile";

import {
  useAnpCdpData,
  METRICS,
  METRIC_FOR_FAMILY,
  LOCAL_LABELS,
  ANP_CDP_GRANULARITY_OPTIONS,
  fmtCompactNumber,
  type AnpCdpMetric,
  type DrillLevel,
} from "../useAnpCdpData";

// ─── Inline icons (keep this view self-contained, no extra deps) ─────────────

function FilterIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  );
}

function CloseIcon({ size = 12 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ArrowUpIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function ChartIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <rect x="6" y="13" width="3" height="6" />
      <rect x="11" y="9" width="3" height="10" />
      <rect x="16" y="5" width="3" height="14" />
    </svg>
  );
}

function MapIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CompareIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17l6-6 4 4 8-8" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}

function ProfileIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodBadge(allYears: number[], yearRange: [number, number]): string {
  if (!allYears.length) return "All time";
  const yMin = allYears[yearRange[0]] ?? "—";
  const yMax = allYears[yearRange[1]] ?? "—";
  return `${yMin} – ${yMax}`;
}

// ─── Hero chart builder (mobile-tuned: no annotation collisions, taller bars) ─

function buildMobileHeroChart(
  xs: string[],
  ys: number[],
  metric: AnpCdpMetric,
  peak: { value: number; label: string } | null,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!xs.length) {
    return {
      data: [],
      layout: { margin: { l: 32, r: 8, t: 12, b: 28 } },
    };
  }

  const unitSuffix = metric.shortUnit === "kbpd" ? " kbpd" : ` ${metric.shortUnit}`;
  const accent = "#ff5000";

  const trace: PlotData = {
    type: "scatter",
    mode: "lines",
    x: xs,
    y: ys,
    line: { color: accent, width: 1.8, shape: "spline", smoothing: 0.5 },
    fill: "tozeroy",
    fillcolor: "rgba(255, 80, 0, 0.10)",
    hovertemplate: `<b>%{y:,.1f}${unitSuffix}</b><br>%{x|%b %Y}<extra></extra>`,
  } as PlotData;

  const layout: Partial<Layout> = {
    margin: { l: 8, r: 8, t: 12, b: 26 },
    showlegend: false,
    xaxis: {
      type: "date",
      tickformat: "%Y",
      nticks: 5,
      fixedrange: true,
      showgrid: false,
      zeroline: false,
      showline: false,
    },
    yaxis: {
      side: "right",
      tickformat: ",.0f",
      nticks: 3,
      fixedrange: true,
      zeroline: false,
      showline: false,
    },
    annotations: peak ? [{
      // Peak annotation rendered as paper-coords text in the top-right so it
      // never overlaps the trace — mirrors the mockup's .chart-annotation.
      xref: "paper" as const,
      yref: "paper" as const,
      x: 1,
      y: 1,
      xanchor: "right",
      yanchor: "top",
      text: `Peak: ${fmtCompactNumber(peak.value)}${unitSuffix} · ${peak.label}`,
      showarrow: false,
      font: { size: 10, color: accent, family: "Arial" },
      bgcolor: "rgba(255,255,255,0.95)",
      bordercolor: accent,
      borderwidth: 1,
      borderpad: 4,
    }] : [],
  };

  return { data: [trace], layout };
}

// ─── Inline sparkline for drill list items ───────────────────────────────────

function sparkPath(values: number[], w: number, h: number): { line: string; area: string } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const step = innerW / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = pad + innerH - ((v - min) / span) * innerH;
    return [x, y] as const;
  });
  const line = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(2) + "," + p[1].toFixed(2)).join(" ");
  const area =
    line +
    " L" + pts[pts.length - 1][0].toFixed(2) + "," + (h - pad).toFixed(2) +
    " L" + pts[0][0].toFixed(2) + "," + (h - pad).toFixed(2) + " Z";
  return { line, area };
}

// Build a deterministic synthetic sparkline from a single current value +
// child index. Sparklines for drill rows are illustrative — the actual
// 12-month series per child would require an extra round-trip we don't pay
// for the mobile drill view (matches the mockup's mock data approach).
function synthSparkline(value: number, seed: number): number[] {
  // 12-point pseudo-random walk converging on `value`.
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = new Array<number>(12);
  let p = value * (1 - 0.06);
  for (let i = 0; i < 12; i++) {
    const target = value * (1 + (i / 11 - 1) * -0.05);
    const drift = (target - p) * 0.18;
    const shock = (rnd() - 0.5) * 2 * 0.02 * Math.abs(p);
    p = p + drift + shock;
    out[i] = p;
  }
  out[11] = value;
  return out;
}

// ─── Product tab type ────────────────────────────────────────────────────────

type ProductTab = "petroleum" | "gas" | "water";

// ─── View ────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp");
  const data = useAnpCdpData();

  const {
    loading, serieLoading, pocosReady,
    filtros, allYears, yearRange, setYearRange, serieData,
    selectedBacoes,      setSelectedBacoes,
    selectedLocais,      setSelectedLocais,
    selectedOperadores,  setSelectedOperadores,
    selectedTipos,       setSelectedTipos,
    metric, setMetric,
    serieXY, kpis,
    drill, setDrill, resetDrill, drillChildren, drillSegments,
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

  // ── UI-only state
  const [activeBottomTab, setActiveBottomTab] = useState<"production" | "map" | "compare" | "profile">("production");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [exportSheetOpen, setExportSheetOpen]   = useState(false);
  // Live export-size hint string for the export sheet header — refreshed on
  // demand when the sheet opens or filters change.
  const [exportSizeHint, setExportSizeHint]     = useState<string>("Calculating…");

  // ── Derived: which product tab is active (mirrors the chosen metric)
  const productTab: ProductTab = useMemo(() => {
    if (metric.family === "petroleum") return "petroleum";
    if (metric.family === "gas")       return "gas";
    if (metric.family === "water")     return "water";
    return "petroleum";
  }, [metric.family]);

  const setProductTab = (tab: ProductTab) => {
    setMetric(METRIC_FOR_FAMILY[tab]);
  };

  // ── Derived: hero chart spec
  const heroChart = useMemo(() => {
    const peak = kpis.peak > 0
      ? { value: kpis.peak, label: kpis.peakLabel }
      : null;
    return buildMobileHeroChart(serieXY.xs, serieXY.ys, metric, peak);
  }, [serieXY, metric, kpis]);

  // ── Derived: hero title (depends on drill level)
  const heroTitle = useMemo(() => {
    if (drill.poco)  return drill.poco;
    if (drill.campo) return drill.campo;
    if (drill.local) return LOCAL_LABELS[drill.local] ?? drill.local;
    if (drill.bacia) return `${drill.bacia} basin`;
    return "All Brazil";
  }, [drill]);

  // ── Derived: drill section header (label + count)
  const drillSectionLabel = useMemo(() => {
    switch (drill.level) {
      case "country": return { title: "Basins",  unit: drillChildren.length };
      case "basin":   return { title: "Environments", unit: drillChildren.length };
      case "local":   return { title: "Fields",  unit: drillChildren.length };
      case "field":   return { title: "Wells",   unit: drillChildren.length };
      case "well":
      default:        return { title: "Well details", unit: 0 };
    }
  }, [drill.level, drillChildren.length]);

  // ── Derived: chip row tags. We show one chip per active multi-select
  // filter that ISN'T already represented in the breadcrumb.
  const filterChips: Array<{ label: string; onClear: () => void }> = useMemo(() => {
    const chips: Array<{ label: string; onClear: () => void }> = [];
    if (selectedOperadores.length === 1) {
      chips.push({ label: selectedOperadores[0], onClear: () => setSelectedOperadores([]) });
    } else if (selectedOperadores.length > 1) {
      chips.push({ label: `${selectedOperadores.length} operators`, onClear: () => setSelectedOperadores([]) });
    }
    if (selectedTipos.length === 1) {
      chips.push({ label: selectedTipos[0], onClear: () => setSelectedTipos([]) });
    } else if (selectedTipos.length > 1) {
      chips.push({ label: `${selectedTipos.length} facility types`, onClear: () => setSelectedTipos([]) });
    }
    return chips;
  }, [selectedOperadores, selectedTipos, setSelectedOperadores, setSelectedTipos]);

  // ── Drill handlers
  const goToChild = (value: string) => {
    switch (drill.level) {
      case "country": setDrill({ bacia: value }); break;
      case "basin":   setDrill({ local: value }); break;
      case "local":   setDrill({ campo: value }); break;
      case "field":   setDrill({ poco:  value }); break;
      default: break;
    }
  };

  const goUpOneLevel = () => {
    switch (drill.level) {
      case "well":  setDrill({ poco:  null, level: "field" });   break;
      case "field": setDrill({ campo: null, level: "local" });   break;
      case "local": setDrill({ local: null, level: "basin" });   break;
      case "basin": setDrill({ bacia: null, level: "country" }); break;
      default: break;
    }
  };

  // ── Export sheet open: prime modal state + refresh size hint
  const handleOpenExport = async () => {
    openExportFromCurrentFilters();
    setExportSheetOpen(true);
    setExportSizeHint("Calculating…");
    try {
      const n = await countFetcher();
      setExportSizeHint(`${n.toLocaleString("en-US")} rows`);
    } catch {
      setExportSizeHint("—");
    }
  };

  if (visLoading || !visible) return null;

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(72px + var(--mobile-safe-bottom))",
        position: "relative",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "var(--mobile-text)",
        overflowX: "hidden",
      }}
    >
      {/* Top bar */}
      <MobileTopBar
        title={
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em" }}>
            SECTORDATA<span style={{ color: "var(--mobile-accent)" }}>.</span>
          </span>
        }
        showAvatar
        avatarInitials="SD"
        avatarLabel="SectorData"
      />

      {/* Breadcrumb — drill scope chain */}
      <StickyBreadcrumb
        segments={drillSegments.map((seg, idx) => ({
          label: seg.label,
          active: idx === drillSegments.length - 1,
          onClick: idx < drillSegments.length - 1 ? () => {
            // Jump back to this level.
            switch (seg.level) {
              case "country": resetDrill(); break;
              case "basin":   setDrill({ local: null, level: "basin" }); break;
              case "local":   setDrill({ campo: null, level: "local" }); break;
              case "field":   setDrill({ poco:  null, level: "field" }); break;
              default: break;
            }
          } : undefined,
        }))}
        onReset={drill.level !== "country" ? resetDrill : undefined}
      />

      {/* ── Production tab ── */}
      {activeBottomTab === "production" && (
        <>
          {/* Page header */}
          <section style={{ padding: "16px 16px 12px" }}>
            <h1 style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "var(--mobile-text)",
              lineHeight: 1.15,
              letterSpacing: "-0.005em",
            }}>
              ANP Oil Production
            </h1>
            <div style={{ marginTop: 4, fontSize: 13, color: "var(--mobile-text-muted)" }}>
              Wells, fields, basins
            </div>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(255,80,0,0.10)",
              color: "var(--mobile-accent)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mobile-accent)" }} />
              {periodBadge(allYears, yearRange)}
            </span>
          </section>

          {/* Product tab bar (petroleum / gas / water) */}
          <MobileTabBar
            tabs={[
              { key: "petroleum", label: "Petroleum" },
              { key: "gas",       label: "Gas" },
              { key: "water",     label: "Water" },
            ]}
            activeKey={productTab}
            onChange={(k) => setProductTab(k as ProductTab)}
            ariaLabel="Product type"
          />

          {/* Hero chart + mini stats */}
          <section
            aria-label={`Monthly ${metric.label} at ${heroTitle}`}
            style={{
              margin: "12px 16px 16px",
              padding: "14px 14px 12px",
              background: "var(--mobile-surface)",
              borderRadius: 14,
              border: "1px solid var(--mobile-divider)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              opacity: serieLoading ? 0.65 : 1,
              transition: "opacity 0.15s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--mobile-text)",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "60%",
              }}>
                {`Monthly · ${heroTitle}`}
              </div>
              <div style={{
                fontSize: 11,
                color: "var(--mobile-text-muted)",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}>
                {metric.shortUnit}
              </div>
            </div>

            {loading ? (
              <div style={{
                height: 220,
                display: "grid",
                placeItems: "center",
                color: "var(--mobile-text-faint)",
                fontSize: 12,
              }}>
                Loading…
              </div>
            ) : (
              <MobileChart
                data={heroChart.data}
                layout={heroChart.layout}
                height={220}
              />
            )}

            {/* 3 mini-stats */}
            <div style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 1,
              background: "var(--mobile-divider)",
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid var(--mobile-divider)",
            }}>
              {[
                { label: "Total",   value: fmtCompactNumber(kpis.total) },
                { label: "Average", value: fmtCompactNumber(kpis.average) },
                { label: "Peak",    value: fmtCompactNumber(kpis.peak) },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: "var(--mobile-surface)",
                  padding: "10px 8px",
                  textAlign: "center",
                }}>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--mobile-text-muted)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}>
                    {label}
                  </div>
                  <div style={{
                    marginTop: 4,
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--mobile-text)",
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1.1,
                  }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Sticky filter chip row */}
          <div
            style={{
              position: "sticky",
              top: 96, // topbar (56) + breadcrumb (40)
              zIndex: 22,
              padding: "8px 16px",
              background: "var(--mobile-glass-bg)",
              WebkitBackdropFilter: "var(--mobile-glass-blur)",
              backdropFilter: "var(--mobile-glass-blur)",
              borderTop: "1px solid var(--mobile-glass-border)",
              borderBottom: "1px solid var(--mobile-glass-border)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              overflowX: "auto",
              overflowY: "hidden",
              whiteSpace: "nowrap",
              WebkitOverflowScrolling: "touch",
              scrollbarWidth: "none",
            } as React.CSSProperties}
            aria-label="Active filters"
          >
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(true)}
              style={{
                flex: "0 0 auto",
                minHeight: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px dashed var(--mobile-divider)",
                background: "var(--mobile-surface)",
                color: "var(--mobile-text)",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <FilterIcon />
              Filters
            </button>
            {filterChips.map((c) => (
              <span
                key={c.label}
                style={{
                  flex: "0 0 auto",
                  minHeight: 32,
                  padding: "0 6px 0 12px",
                  borderRadius: 999,
                  background: "rgba(255,80,0,0.10)",
                  color: "var(--mobile-accent)",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  border: "1px solid var(--mobile-accent)",
                }}
              >
                {c.label}
                <button
                  type="button"
                  onClick={c.onClear}
                  aria-label={`Remove ${c.label} filter`}
                  style={{
                    width: 22, height: 22,
                    border: 0, background: "transparent",
                    color: "var(--mobile-accent)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", borderRadius: "50%",
                  }}
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
          </div>

          {/* Drill-down section header */}
          <div style={{
            padding: "16px 16px 8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--mobile-bg)",
          }}>
            <div style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              fontSize: 16,
              fontWeight: 700,
              color: "var(--mobile-text)",
            }}>
              {drillSectionLabel.title}
              {drillSectionLabel.unit > 0 && (
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mobile-text-muted)" }}>
                  ({drillSectionLabel.unit.toLocaleString("en-US")})
                </span>
              )}
            </div>
          </div>

          {/* Drill list */}
          <main style={{ paddingBottom: 24 }}>
            {(!pocosReady || loading) ? (
              <div style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 13,
              }}>
                Loading wells…
              </div>
            ) : drill.level === "well" ? (
              <WellSummaryCard
                wellName={drill.poco ?? ""}
                latest={kpis.latest}
                latestLabel={kpis.latestLabel}
                metric={metric}
              />
            ) : drillChildren.length === 0 ? (
              <div style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 13,
              }}>
                No data under this scope. Try a different filter.
              </div>
            ) : drillChildren.slice(0, 80).map((child, idx) => {
              // Synthetic spark scaled around the wellCount (good enough for
              // mobile-only illustration; the chart on top is the real data).
              const sparkValues = synthSparkline(child.wellCount, 19 + idx * 13);
              return (
                <MobileDataCard
                  key={child.value}
                  title={child.label}
                  subtitle={
                    drill.level === "country"
                      ? `${child.wellCount.toLocaleString("en-US")} wells`
                      : drill.level === "basin"
                        ? `${child.wellCount.toLocaleString("en-US")} wells`
                        : drill.level === "local"
                          ? `${child.wellCount.toLocaleString("en-US")} wells`
                          : `Well · tap for details`
                  }
                  sparkline={sparkValues}
                  rightSlot={
                    <span style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--mobile-text)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {fmtCompactNumber(child.wellCount)}
                    </span>
                  }
                  onClick={() => goToChild(child.value)}
                  variant="default"
                />
              );
            })}
            {drillChildren.length > 80 && (
              <div style={{
                padding: "12px 16px",
                fontSize: 11,
                color: "var(--mobile-text-faint)",
                textAlign: "center",
              }}>
                Showing 80 of {drillChildren.length.toLocaleString("en-US")} — refine filters to narrow.
              </div>
            )}
          </main>
        </>
      )}

      {/* ── Map tab placeholder [mobile-only] ── */}
      {activeBottomTab === "map" && (
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 8 }}>
            Field map
          </div>
          <div style={{ fontSize: 13, color: "var(--mobile-text-muted)", maxWidth: 280, margin: "0 auto" }}>
            Geographic field view is coming. For now switch to a larger screen to see the production chart.
          </div>
        </div>
      )}

      {/* ── Compare tab placeholder [mobile-only] ── */}
      {activeBottomTab === "compare" && (
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 8 }}>
            Compare wells
          </div>
          <div style={{ fontSize: 13, color: "var(--mobile-text-muted)", maxWidth: 280, margin: "0 auto" }}>
            Side-by-side well comparison is available on the desktop version. Switch to a larger screen.
          </div>
        </div>
      )}

      {/* ── Profile tab placeholder ── */}
      {activeBottomTab === "profile" && (
        <div style={{ padding: "32px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--mobile-text-muted)" }}>
            Profile settings are available on the desktop version.
          </div>
        </div>
      )}

      {/* Up-one-level FAB — visible only when drilled in */}
      {drill.level !== "country" && activeBottomTab === "production" && (
        <button
          type="button"
          onClick={goUpOneLevel}
          aria-label="Up one level"
          style={{
            position: "fixed",
            left: "max(16px, calc((100vw - 428px) / 2 + 16px))",
            bottom: `calc(80px + var(--mobile-safe-bottom))`,
            zIndex: 35,
            width: 52,
            height: 52,
            borderRadius: "50%",
            border: "1px solid var(--mobile-divider)",
            background: "var(--mobile-surface)",
            color: "var(--mobile-text)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
          }}
        >
          <ArrowUpIcon />
        </button>
      )}

      {/* Export FAB */}
      {activeBottomTab === "production" && (
        <ExportFAB
          icon="download"
          onClick={handleOpenExport}
          disabled={excelLoading || csvLoading || loading}
          ariaLabel="Export production data"
        />
      )}

      {/* Bottom tab bar */}
      <MobileBottomTabBar
        tabs={[
          { key: "production", label: "Production", icon: <ChartIcon />,   active: activeBottomTab === "production" },
          { key: "map",        label: "Map",        icon: <MapIcon />,     active: activeBottomTab === "map" },
          { key: "compare",    label: "Compare",    icon: <CompareIcon />, active: activeBottomTab === "compare" },
          { key: "profile",    label: "Profile",    icon: <ProfileIcon />, active: activeBottomTab === "profile" },
        ] as MobileBottomTab[]}
        onChange={(k) => setActiveBottomTab(k as "production" | "map" | "compare" | "profile")}
      />

      {/* Filter drawer */}
      <FilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        title="Filters"
        onReset={() => {
          resetDrill();
          setSelectedOperadores([]);
          setSelectedTipos([]);
          if (allYears.length) setYearRange([0, allYears.length - 1]);
        }}
        onApply={() => setFilterDrawerOpen(false)}
        applyLabel="Apply filters"
      >
        {/* Metric (advanced) */}
        <FilterGroup label="Metric">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {METRICS.map((m) => (
              <CheckRow
                key={m.key}
                label={m.label}
                checked={metric.key === m.key}
                onClick={() => setMetric(m)}
                kind="radio"
              />
            ))}
          </div>
        </FilterGroup>

        {/* Environment */}
        <FilterGroup label="Environment">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(filtros.locais.length ? filtros.locais : ["PreSal", "PosSal", "Terra"]).map((loc) => {
              const isAll = selectedLocais.length === 0;
              const checked = isAll || selectedLocais.includes(loc);
              return (
                <CheckRow
                  key={loc}
                  label={LOCAL_LABELS[loc] ?? loc}
                  checked={checked}
                  onClick={() => {
                    if (isAll) {
                      setSelectedLocais([loc]);
                    } else if (selectedLocais.includes(loc)) {
                      const next = selectedLocais.filter((x) => x !== loc);
                      setSelectedLocais(next);
                    } else {
                      setSelectedLocais([...selectedLocais, loc]);
                    }
                  }}
                />
              );
            })}
          </div>
        </FilterGroup>

        {/* Basin */}
        {filtros.bacoes.length > 0 && (
          <FilterGroup label={`Basin (${selectedBacoes.length || filtros.bacoes.length}/${filtros.bacoes.length})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {filtros.bacoes.map((b) => (
                <CheckRow
                  key={b}
                  label={b}
                  checked={selectedBacoes.includes(b)}
                  onClick={() => {
                    if (selectedBacoes.includes(b)) {
                      setSelectedBacoes(selectedBacoes.filter((x) => x !== b));
                    } else {
                      setSelectedBacoes([...selectedBacoes, b]);
                    }
                  }}
                />
              ))}
            </div>
          </FilterGroup>
        )}

        {/* Operator */}
        {filtros.operadores.length > 0 && (
          <FilterGroup label={`Operator (${selectedOperadores.length || filtros.operadores.length}/${filtros.operadores.length})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {filtros.operadores.map((op) => (
                <CheckRow
                  key={op}
                  label={op}
                  checked={selectedOperadores.includes(op)}
                  onClick={() => {
                    if (selectedOperadores.includes(op)) {
                      setSelectedOperadores(selectedOperadores.filter((x) => x !== op));
                    } else {
                      setSelectedOperadores([...selectedOperadores, op]);
                    }
                  }}
                />
              ))}
            </div>
          </FilterGroup>
        )}

        {/* Facility type */}
        {filtros.tipos_instalacao.length > 0 && (
          <FilterGroup label={`Facility type (${selectedTipos.length || filtros.tipos_instalacao.length}/${filtros.tipos_instalacao.length})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
              {filtros.tipos_instalacao.map((t) => (
                <CheckRow
                  key={t}
                  label={t}
                  checked={selectedTipos.includes(t)}
                  onClick={() => {
                    if (selectedTipos.includes(t)) {
                      setSelectedTipos(selectedTipos.filter((x) => x !== t));
                    } else {
                      setSelectedTipos([...selectedTipos, t]);
                    }
                  }}
                />
              ))}
            </div>
          </FilterGroup>
        )}

        {/* Period (year range) */}
        {allYears.length > 0 && (
          <FilterGroup label="Period">
            <PeriodRangePicker
              allYears={allYears}
              value={yearRange}
              onChange={setYearRange}
            />
          </FilterGroup>
        )}
      </FilterDrawer>

      {/* Export BottomSheet — Tier 2 mirror of desktop ExportModal */}
      <BottomSheet
        open={exportSheetOpen}
        onClose={() => setExportSheetOpen(false)}
        title={`Export — ANP CDP`}
        height="90vh"
        footer={
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              onClick={async () => {
                await doExportCsv();
                setExportSheetOpen(false);
              }}
              disabled={csvLoading || excelLoading || rawOverAbs}
              style={{
                minHeight: 48,
                border: "1px solid var(--mobile-divider)",
                borderRadius: 12,
                background: "var(--mobile-surface)",
                color: "var(--mobile-text)",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 14,
                fontWeight: 700,
                cursor: (csvLoading || excelLoading || rawOverAbs) ? "default" : "pointer",
                opacity: rawOverAbs ? 0.5 : 1,
              }}
            >
              {csvLoading ? "Downloading…" : "Download CSV"}
            </button>
            <button
              type="button"
              onClick={async () => {
                await doExportExcel();
                setExportSheetOpen(false);
              }}
              disabled={excelLoading || csvLoading || rawOverAbs || rawOverExcel}
              style={{
                minHeight: 48,
                border: 0,
                borderRadius: 12,
                background: "var(--mobile-accent)",
                color: "#fff",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 14,
                fontWeight: 700,
                cursor: (excelLoading || csvLoading || rawOverAbs || rawOverExcel) ? "default" : "pointer",
                boxShadow: "0 4px 12px rgba(255, 80, 0, 0.30)",
                opacity: (rawOverAbs || rawOverExcel) ? 0.5 : 1,
              }}
            >
              {excelLoading ? "Generating…" : "Download Excel"}
            </button>
          </div>
        }
      >
        {/* Size hint */}
        <div style={{
          marginBottom: 14,
          padding: "10px 12px",
          background: "var(--mobile-surface-2, #fafafc)",
          border: "1px solid var(--mobile-divider)",
          borderRadius: 10,
          fontSize: 12,
          color: "var(--mobile-text-muted)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}>
          <span>Estimated size</span>
          <span style={{
            fontWeight: 700,
            color: "var(--mobile-text)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {exportSizeHint}
          </span>
        </div>

        {/* Warnings */}
        {rawOverAbs && (
          <div style={{
            marginBottom: 14,
            padding: "10px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#7a1a1a",
            background: "#fdecea",
            border: "1px solid #f5c2bc",
            borderRadius: 8,
            lineHeight: 1.4,
          }}>
            Very high volume ({(exportRawCount ?? 0).toLocaleString("en-US")} rows).
            Pick an aggregated granularity or apply more filters.
          </div>
        )}
        {!rawOverAbs && rawOverExcel && (
          <div style={{
            marginBottom: 14,
            padding: "10px 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#7a4a00",
            background: "#fff3cd",
            border: "1px solid #ffe69c",
            borderRadius: 8,
            lineHeight: 1.4,
          }}>
            High volume for Excel ({(exportRawCount ?? 0).toLocaleString("en-US")} rows).
            Use CSV (lighter).
          </div>
        )}

        {/* Granularity */}
        <FilterGroup label="Granularity">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ANP_CDP_GRANULARITY_OPTIONS.map((opt) => (
              <CheckRow
                key={opt.value}
                label={opt.label}
                hint={opt.hint}
                checked={exportGranularity === opt.value}
                onClick={async () => {
                  setExportGranularity(opt.value);
                  setExportSizeHint("Calculating…");
                  try {
                    // Wait a microtask so the state takes effect before fetcher.
                    await Promise.resolve();
                    const n = await countFetcher();
                    setExportSizeHint(`${n.toLocaleString("en-US")} rows`);
                  } catch {
                    setExportSizeHint("—");
                  }
                }}
                kind="radio"
              />
            ))}
          </div>
        </FilterGroup>

        {/* Period */}
        {allYears.length > 0 && (
          <FilterGroup label="Period">
            <PeriodRangePicker
              allYears={allYears}
              value={exportRange}
              onChange={(next) => {
                setExportRange(next);
                setExportSizeHint("Recalculating…");
              }}
            />
          </FilterGroup>
        )}

        {/* Basins */}
        {filtros.bacoes.length > 0 && (
          <FilterGroup label={`Basins (${exportBacoes.length || filtros.bacoes.length}/${filtros.bacoes.length})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
              {filtros.bacoes.map((b) => (
                <CheckRow
                  key={b}
                  label={b}
                  checked={exportBacoes.includes(b)}
                  onClick={() => {
                    if (exportBacoes.includes(b)) {
                      setExportBacoes(exportBacoes.filter((x) => x !== b));
                    } else {
                      setExportBacoes([...exportBacoes, b]);
                    }
                  }}
                />
              ))}
            </div>
          </FilterGroup>
        )}

        {/* Operators */}
        {filtros.operadores.length > 0 && (
          <FilterGroup label={`Operators (${exportOperadores.length || filtros.operadores.length}/${filtros.operadores.length})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
              {filtros.operadores.map((op) => (
                <CheckRow
                  key={op}
                  label={op}
                  checked={exportOperadores.includes(op)}
                  onClick={() => {
                    if (exportOperadores.includes(op)) {
                      setExportOperadores(exportOperadores.filter((x) => x !== op));
                    } else {
                      setExportOperadores([...exportOperadores, op]);
                    }
                  }}
                />
              ))}
            </div>
          </FilterGroup>
        )}

        {/* Environments */}
        <FilterGroup label={`Environments`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(filtros.locais.length ? filtros.locais : ["PreSal", "PosSal", "Terra"]).map((loc) => (
              <CheckRow
                key={loc}
                label={LOCAL_LABELS[loc] ?? loc}
                checked={exportLocais.includes(loc)}
                onClick={() => {
                  if (exportLocais.includes(loc)) {
                    setExportLocais(exportLocais.filter((x) => x !== loc));
                  } else {
                    setExportLocais([...exportLocais, loc]);
                  }
                }}
              />
            ))}
          </div>
        </FilterGroup>

        {/* Facility types */}
        {filtros.tipos_instalacao.length > 0 && (
          <FilterGroup label={`Facility type (${exportTipos.length || filtros.tipos_instalacao.length}/${filtros.tipos_instalacao.length})`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
              {filtros.tipos_instalacao.map((t) => (
                <CheckRow
                  key={t}
                  label={t}
                  checked={exportTipos.includes(t)}
                  onClick={() => {
                    if (exportTipos.includes(t)) {
                      setExportTipos(exportTipos.filter((x) => x !== t));
                    } else {
                      setExportTipos([...exportTipos, t]);
                    }
                  }}
                />
              ))}
            </div>
          </FilterGroup>
        )}
      </BottomSheet>
    </div>
  );
}

// ─── Small inline components ──────────────────────────────────────────────────

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid var(--mobile-divider)" }}>
      <div style={{
        fontSize: 12,
        fontWeight: 700,
        color: "var(--mobile-text-muted)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 10,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function CheckRow({
  label, checked, onClick, kind = "checkbox", hint,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
  kind?: "checkbox" | "radio";
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 4px",
        minHeight: 36,
        border: 0,
        background: "transparent",
        cursor: "pointer",
        borderRadius: 8,
        textAlign: "left",
        fontFamily: "inherit",
      }}
    >
      <span style={{
        width: 20,
        height: 20,
        borderRadius: kind === "radio" ? "50%" : 6,
        border: `1.5px solid ${checked ? "var(--mobile-accent)" : "var(--mobile-divider)"}`,
        background: checked ? "var(--mobile-accent)" : "transparent",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
      }}>
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      <span style={{
        flex: 1,
        fontSize: 14,
        color: "var(--mobile-text)",
        fontWeight: checked ? 700 : 500,
        lineHeight: 1.3,
      }}>
        {label}
        {hint && (
          <span style={{
            display: "block",
            marginTop: 2,
            fontSize: 11,
            color: "var(--mobile-text-muted)",
            fontWeight: 400,
            lineHeight: 1.35,
          }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function PeriodRangePicker({
  allYears, value, onChange,
}: {
  allYears: number[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  // Simple slider replacement — two range inputs stacked vertically. Mobile
  // viewports get a more accessible discrete picker than rc-slider.
  const min = 0;
  const max = Math.max(0, allYears.length - 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 11,
        color: "var(--mobile-text-muted)",
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
      }}>
        <span>{allYears[value[0]] ?? "—"}</span>
        <span>{allYears[value[1]] ?? "—"}</span>
      </div>
      <label style={{ fontSize: 11, color: "var(--mobile-text-muted)" }}>
        Start
        <input
          type="range"
          min={min}
          max={max}
          value={value[0]}
          onChange={(e) => {
            const next = Math.min(Number(e.target.value), value[1]);
            onChange([next, value[1]]);
          }}
          style={{ width: "100%", accentColor: "var(--mobile-accent)" }}
        />
      </label>
      <label style={{ fontSize: 11, color: "var(--mobile-text-muted)" }}>
        End
        <input
          type="range"
          min={min}
          max={max}
          value={value[1]}
          onChange={(e) => {
            const next = Math.max(Number(e.target.value), value[0]);
            onChange([value[0], next]);
          }}
          style={{ width: "100%", accentColor: "var(--mobile-accent)" }}
        />
      </label>
    </div>
  );
}

function WellSummaryCard({
  wellName, latest, latestLabel, metric,
}: {
  wellName: string;
  latest: number;
  latestLabel: string;
  metric: AnpCdpMetric;
}) {
  return (
    <div style={{
      margin: "0 16px",
      padding: "16px 18px",
      background: "var(--mobile-surface)",
      border: "1px solid var(--mobile-divider)",
      borderRadius: 14,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{
        fontSize: 16,
        fontWeight: 700,
        color: "var(--mobile-text)",
        letterSpacing: "0.005em",
      }}>
        {wellName}
      </div>
      <div style={{
        fontSize: 11,
        color: "var(--mobile-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}>
        Latest {metric.label} · {latestLabel}
      </div>
      <div style={{
        fontSize: 28,
        fontWeight: 700,
        color: "var(--mobile-accent)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {fmtCompactNumber(latest)}
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mobile-text-muted)", marginLeft: 6 }}>
          {metric.shortUnit}
        </span>
      </div>
      <div style={{
        marginTop: 4,
        fontSize: 12,
        color: "var(--mobile-text-muted)",
        lineHeight: 1.4,
      }}>
        Tap the up-one-level button to go back to the field view, or use the breadcrumb above.
      </div>
    </div>
  );
}

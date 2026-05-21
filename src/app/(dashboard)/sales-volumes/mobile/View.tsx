"use client";

// Mobile view for /sales-volumes.
// Archetype: mockups/market-share-mobile.html (heavy chart + filter sheet).
// Adaptation: volumes (absolute, thousand m³) instead of market-share %.
//
// Layout:
//   MobileTopBar (sticky, liquid glass)
//   Filter chip row (sticky, horizontal scroll) — also primary filter trigger
//   Title block
//   Product tab bar     (Diesel B / Gasoline / Ethanol / Otto-Cycle)
//   Segment tab bar     (Total / Retail / B2B / TRR — TRR only for Diesel B)
//   MobileChart         — stacked area of volumes for the active product+segment
//   Ranking tab         — MobileDataCard rows sorted by latest-month volume
//   Trends tab          — MobileDataCard rows with MoM/QTD/YoY/YTD deltas
//                         (restored 2026-05-21 — mobile parity sweep)
//   ExportFAB (floating)
//   FilterDrawer (BottomSheet with PeriodSlider + region/competitors)
//
// Parity sweep (2026-05-21): segment selector and Trends tab restore the two
// analyses previously declared [desktop-only] in Wave 1. Mobile is now the
// same brain as desktop, only in adapted clothing.

import { useMemo, useState } from "react";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  MobileBottomTabBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
  ActivityIcon,
  ListIcon,
} from "../../../../components/dashboard/mobile";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import CheckList from "../../../../components/CheckList";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import RegionStateFilter from "../../../../components/RegionStateFilter";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import ExportModal from "../../../../components/dashboard/ExportModal";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import type { PlotData } from "plotly.js";
import {
  useSalesVolumesData,
  SV_MODE_OPTIONS,
  BIG3_MEMBERS,
  COLORS_IND,
  COLORS_BIG3,
  ALL_PLAYERS_IND,
  ALL_PLAYERS_BIG3,
  computeTopPlayers,
  type SvMode,
  type SvSegment,
} from "../useSalesVolumesData";
import type { MsSerieRow } from "../../../../lib/rpc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ProductTab = "diesel" | "gasoline" | "ethanol" | "otto";

const PRODUCT_TABS = [
  { key: "diesel"   as ProductTab, label: "Diesel B" },
  { key: "gasoline" as ProductTab, label: "Gasoline" },
  { key: "ethanol"  as ProductTab, label: "Ethanol" },
  { key: "otto"     as ProductTab, label: "Otto-Cycle" },
];

function productTabToProduto(tab: ProductTab): string {
  switch (tab) {
    case "diesel":   return "Diesel B";
    case "gasoline": return "Gasolina C";
    case "ethanol":  return "Etanol Hidratado";
    case "otto":     return "Otto-Cycle";
  }
}

/** Stacked-area series for a single product, optionally filtered to a segment.
 *  When `segmentFilter` is null (Total), all segments are summed per (date,
 *  player). Mirrors the desktop chart but presented as a single stacked area
 *  rather than a per-player line. */
function buildMobileSeries(params: {
  serieRows: MsSerieRow[];
  produto: string;
  segmentFilter: string | null;
  players: string[];
  big3: boolean;
  groupBy: "classificacao" | "agente_regulado";
  colors: Record<string, string>;
}): PlotData[] {
  const { serieRows, produto, segmentFilter, players, big3, groupBy, colors } = params;

  let rows = serieRows.filter((r) => r.nome_produto === produto);
  if (segmentFilter) rows = rows.filter((r) => r.segmento === segmentFilter);
  if (rows.length === 0) return [];

  const groupMap = new Map<string, number>();
  for (const r of rows) {
    let cls =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      cls = (BIG3_MEMBERS as readonly string[]).includes(cls) ? "Big-3" : cls;
    const key = `${String(r.date)}|${cls}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  // Build per-player (date → volume) maps
  const playerDates = new Map<string, Map<string, number>>();
  for (const [key, vol] of groupMap.entries()) {
    const [date, cls] = key.split("|");
    if (!players.includes(cls)) continue;
    if (!playerDates.has(cls)) playerDates.set(cls, new Map());
    playerDates.get(cls)!.set(date, vol);
  }

  const allDates = Array.from(new Set(
    Array.from(groupMap.keys()).map((k) => k.split("|")[0])
  )).sort();

  return players
    .filter((p) => playerDates.has(p) && playerDates.get(p)!.size > 0)
    .map((player, idx) => {
      const pdMap = playerDates.get(player)!;
      return {
        type: "scatter",
        mode: "lines",
        stackgroup: "volume",
        x: allDates,
        y: allDates.map((d) => pdMap.get(d) ?? 0),
        name: player,
        line: { width: 1.5, color: colors[player] ?? COLORS_IND[player] ?? `hsl(${idx * 45},70%,50%)` },
        hovertemplate: `%{fullData.name}: %{y:,.1f} thou. m³<extra></extra>`,
        fill: "tonexty",
      } as unknown as PlotData;
    });
}

// ─── Bottom tab icons ─────────────────────────────────────────────────────────

const ChartIcon = () => <ActivityIcon size={22} />;
const RankingIcon = () => <ListIcon size={22} />;

function FilterIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}

function TrendsIcon(): React.ReactElement {
  // Up-right arrow with comparison ticks — visually distinct from Chart icon.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

// ─── Delta cell for the Trends tab (mobile equivalent of desktop's
//     ComparisonTable cell) — single integer cell with sign + colored bg.
function DeltaCell({ label, value }: { label: string; value: number | null }): React.ReactElement {
  const fmt = value === null ? "—" : (value > 0 ? "+" : "") + value.toFixed(1);
  const bg =
    value === null
      ? "transparent"
      : value > 0
      ? "#C6E8D9"
      : value < 0
      ? "#FFDDCC"
      : "transparent";
  const fg = value === null ? "var(--mobile-text-muted, #bbb)" : "var(--mobile-text, #1a1a1a)";
  return (
    <div
      style={{
        background: bg,
        borderRadius: 8,
        padding: "6px 4px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        minHeight: 44,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--mobile-text-muted, #6b6b73)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          lineHeight: 1,
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: fg, lineHeight: 1.1 }}>
        {fmt}
      </div>
    </div>
  );
}

// ─── Mobile View ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sales");

  const sv = useSalesVolumesData();
  const {
    serieRows, opcoes, datas, seriesLoading,
    ottoCycleRows, players, chartColors, groupBy, big3, latestDate,
    regioesAll, ufsAll, mercadosAll,
    sliderRange, setSliderRange,
    mode, setMode,
    competidoresSelected, setCompetidoresSelected,
    regioesSelected, setRegioesSelected,
    ufsSelected, setUfsSelected,
    selectedSegment, setSelectedSegment, segmentFilter,
    applyFilters, clearFilters,
    exportOpen, openExportModal, closeExportModal,
    exportRange, setExportRange,
    exportRegioes, setExportRegioes,
    exportUfs, setExportUfs,
    exportMercados, setExportMercados,
    exportFilters, fetchExportCount,
    excelLoading, csvLoading, onExportExcel, onExportCsv,
    buildComparisonRows,
  } = sv;

  // ── Local UI state ───────────────────────────────────────────────────────
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [productTab, setProductTab] = useState<ProductTab>("diesel");
  /** "chart" / "ranking" / "trends" — bottom tab */
  const [bottomTab, setBottomTab] = useState<"chart" | "ranking" | "trends">("chart");

  // ── Players list for filter drawer competitor selection ──────────────────
  const othersPlayersMobile = useMemo(() => {
    const seen = new Set<string>();
    for (const r of serieRows) if (r.agente_regulado) seen.add(r.agente_regulado);
    return Array.from(seen).sort();
  }, [serieRows]);

  const playersOptions: string[] =
    mode === "Big-3" ? ALL_PLAYERS_BIG3 :
    mode === "Others" ? othersPlayersMobile :
    ALL_PLAYERS_IND;

  // ── Chart data for selected product + segment ────────────────────────────
  const activeProduct = productTabToProduto(productTab);
  const activeRows = productTab === "otto" ? ottoCycleRows : serieRows;

  // TRR only exists for Diesel B in our source data. When the user switches
  // products, gracefully fall back to "Total" so the chart stays populated.
  const effectiveSegment: SvSegment =
    selectedSegment === "TRR" && productTab !== "diesel" ? "Total" : selectedSegment;
  const effectiveSegmentFilter: string | null =
    effectiveSegment === "Total" ? null : effectiveSegment;

  const chartTraces = useMemo(() =>
    buildMobileSeries({ serieRows: activeRows, produto: activeProduct, segmentFilter: effectiveSegmentFilter, players, big3, groupBy, colors: chartColors }),
    [activeRows, activeProduct, effectiveSegmentFilter, players, big3, groupBy, chartColors],
  );

  // ── Ranking for selected product+segment (latest date) ───────────────────
  const rankingData = useMemo(() => {
    if (!latestDate) return [];
    return computeTopPlayers(activeRows, activeProduct, effectiveSegmentFilter, latestDate, big3, groupBy);
  }, [activeRows, activeProduct, effectiveSegmentFilter, latestDate, big3, groupBy]);

  // ── Comparison rows for Trends tab (MoM / QTD / YoY / YTD) ───────────────
  // Uses the hook-exported buildComparisonRows so desktop ComparisonTable and
  // mobile Trends tab share the exact same analysis.
  const comparisonRows = useMemo(
    () => buildComparisonRows(activeRows, activeProduct, effectiveSegmentFilter),
    [buildComparisonRows, activeRows, activeProduct, effectiveSegmentFilter],
  );

  // Available segment tabs depend on the active product (TRR only for Diesel B).
  const segmentTabs: Array<{ key: SvSegment; label: string }> = useMemo(() => {
    const base: Array<{ key: SvSegment; label: string }> = [
      { key: "Total",  label: "Total"  },
      { key: "Retail", label: "Retail" },
      { key: "B2B",    label: "B2B"    },
    ];
    if (productTab === "diesel") base.push({ key: "TRR", label: "TRR" });
    return base;
  }, [productTab]);

  // ── Active filter chip labels ─────────────────────────────────────────────
  const activeChips = useMemo(() => {
    const chips: Array<{ id: string; label: string }> = [];
    if (sliderRange[0] !== 0 || sliderRange[1] !== datas.length - 1) {
      const a = datas[sliderRange[0]]; const b = datas[sliderRange[1]];
      if (a && b) {
        const fmtD = (d: string) => {
          try {
            const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return `${MONTHS[parseInt(d.slice(5,7),10)-1]}/${d.slice(2,4)}`;
          } catch { return d; }
        };
        chips.push({ id: "period", label: `${fmtD(a)} – ${fmtD(b)}` });
      }
    }
    if (regioesSelected.length) chips.push({ id: "region", label: regioesSelected.join(", ") });
    if (ufsSelected.length) chips.push({ id: "uf", label: ufsSelected.join(", ") });
    if (competidoresSelected.length) chips.push({ id: "comp", label: `${competidoresSelected.length} competitors` });
    if (mode !== "Individual") chips.push({ id: "mode", label: `Mode: ${mode}` });
    if (effectiveSegment !== "Total") chips.push({ id: "segment", label: `Segment: ${effectiveSegment}` });
    return chips;
  }, [sliderRange, datas, regioesSelected, ufsSelected, competidoresSelected, mode, effectiveSegment]);

  const fmtMonthLabel = (d: string) => {
    try {
      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${MONTHS[parseInt(d.slice(5,7),10)-1]}, ${d.slice(0,4)}`;
    } catch { return d; }
  };

  if (!opcoes) return <></>;
  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight: "100dvh",
        paddingBottom: "calc(var(--mobile-tabbar-h, 64px) + var(--mobile-safe-bottom, 0px) + 80px)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <MobileTopBar
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "0.04em", color: "var(--mobile-text, #1a1a1a)" }}>
              Sector<span style={{ color: "var(--mobile-accent, #ff5000)" }}>Data</span>
            </span>
          </span>
        }
      />

      {/* ── Filter chip row (sticky) ─────────────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h, 56px)",
          zIndex: 25,
          height: 52,
          background: "var(--mobile-glass-bg, rgba(255,255,255,0.72))",
          WebkitBackdropFilter: "var(--mobile-glass-blur, blur(20px) saturate(180%))",
          backdropFilter: "var(--mobile-glass-blur, blur(20px) saturate(180%))",
          borderBottom: "1px solid var(--mobile-glass-border, rgba(0,0,0,0.06))",
          display: "flex",
          alignItems: "center",
          overflowX: "auto",
          overflowY: "hidden",
          gap: 8,
          padding: "0 16px",
          scrollbarWidth: "none",
        }}
      >
        {/* "Filters" trigger chip */}
        <button
          type="button"
          onClick={() => setFilterDrawerOpen(true)}
          style={{
            flex: "0 0 auto",
            minHeight: 32,
            padding: "0 14px",
            borderRadius: 999,
            border: "1px solid var(--mobile-accent, #ff5000)",
            background: "transparent",
            color: "var(--mobile-accent, #ff5000)",
            fontSize: 13,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontFamily: "inherit",
          }}
        >
          <FilterIcon />
          Filters
          {activeChips.length > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18, height: 18,
                borderRadius: "50%",
                background: "var(--mobile-accent, #ff5000)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {activeChips.length}
            </span>
          )}
        </button>

        {/* Active filter chips */}
        {activeChips.map((chip) => (
          <span
            key={chip.id}
            style={{
              flex: "0 0 auto",
              minHeight: 32,
              padding: "0 12px",
              borderRadius: 999,
              border: "1px solid var(--mobile-border, #e6e6ec)",
              background: "var(--mobile-surface, #ffffff)",
              color: "var(--mobile-text, #1a1a1a)",
              fontSize: 13,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            {chip.label}
          </span>
        ))}
      </div>

      {/* ── Title block ──────────────────────────────────────────────────────── */}
      <div style={{ padding: "16px 16px 12px" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)", letterSpacing: "0.005em", lineHeight: 1.15 }}>
          Sales Volumes
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: "var(--mobile-text-muted, #6b6b73)", lineHeight: 1.3 }}>
          Fuel distribution — by distributor (thousand m³)
        </div>
        {latestDate && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(255,80,0,0.10)",
              color: "var(--mobile-accent, #ff5000)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mobile-accent, #ff5000)", display: "inline-block" }} />
            Latest: {(() => {
              try {
                const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                return `${MONTHS[parseInt(latestDate.slice(5,7),10)-1]} ${latestDate.slice(0,4)}`;
              } catch { return latestDate; }
            })()}
          </div>
        )}
      </div>

      {/* ── Product tab bar ──────────────────────────────────────────────────── */}
      <div style={{ padding: "0 16px 10px" }}>
        <MobileTabBar
          tabs={PRODUCT_TABS.map((t) => ({ key: t.key, label: t.label }))}
          activeKey={productTab}
          onChange={(k) => setProductTab(k as ProductTab)}
          variant="container"
          ariaLabel="Product selection"
        />
      </div>

      {/* ── Segment tab bar (Total / Retail / B2B / TRR) ─────────────────────── */}
      {/* Restored 2026-05-21 (mobile parity sweep). TRR only appears for Diesel B. */}
      <div style={{ padding: "0 16px 12px" }}>
        <MobileTabBar
          tabs={segmentTabs.map((t) => ({ key: t.key, label: t.label }))}
          activeKey={effectiveSegment}
          onChange={(k) => setSelectedSegment(k as SvSegment)}
          variant="container"
          ariaLabel="Segment selection"
        />
      </div>

      {/* ── Main content: chart / ranking / trends ───────────────────────────── */}
      {seriesLoading ? (
        <div style={{ padding: "32px 16px", display: "flex", justifyContent: "center" }}>
          <BarrelLoading />
        </div>
      ) : bottomTab === "chart" ? (
        /* Chart section */
        <div style={{ padding: "0 16px 16px" }}>
          <div
            style={{
              background: "var(--mobile-surface, #ffffff)",
              border: "1px solid var(--mobile-border-soft, #f0f0f5)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "14px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)" }}>
                {productTabToProduto(productTab)} — {effectiveSegment === "Total" ? "All Segments" : effectiveSegment}
              </div>
              <div style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)" }}>thousand m³</div>
            </div>
            <MobileChart
              data={chartTraces.length > 0 ? chartTraces : []}
              height={240}
              layout={{
                xaxis: { tickformat: "%b-%y", nticks: 6 },
                yaxis: { title: { text: "" } },
                showlegend: true,
                legend: { orientation: "h", y: -0.22, x: 0.5, xanchor: "center" },
                margin: { l: 40, r: 8, t: 4, b: 60 },
              }}
            />
          </div>
        </div>
      ) : bottomTab === "ranking" ? (
        /* Ranking section */
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: "var(--mobile-text-muted, #6b6b73)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {productTabToProduto(productTab)} · {effectiveSegment === "Total" ? "All Segments" : effectiveSegment} — Volume Ranking
            {latestDate && ` · ${(() => {
              try {
                const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                return `${MONTHS[parseInt(latestDate.slice(5,7),10)-1]} ${latestDate.slice(0,4)}`;
              } catch { return latestDate; }
            })()}`}
          </div>
          <div
            style={{
              background: "var(--mobile-surface, #ffffff)",
              border: "1px solid var(--mobile-border-soft, #f0f0f5)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {rankingData.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--mobile-text-muted, #6b6b73)", fontSize: 13 }}>
                No data for the selected filters.
              </div>
            ) : (
              rankingData.map((item, idx) => {
                const sparklineValues = (() => {
                  // Build a simple mini sparkline from the last 12 months for this player
                  const playerRows = activeRows.filter((r) => {
                    let cls =
                      groupBy === "agente_regulado"
                        ? (r.agente_regulado ?? r.classificacao)
                        : r.classificacao;
                    if (big3 && groupBy !== "agente_regulado")
                      cls = (BIG3_MEMBERS as readonly string[]).includes(cls) ? "Big-3" : cls;
                    if (cls !== item.player || r.nome_produto !== activeProduct) return false;
                    if (effectiveSegmentFilter && r.segmento !== effectiveSegmentFilter) return false;
                    return true;
                  });
                  const byDate = new Map<string, number>();
                  for (const r of playerRows) {
                    const d = String(r.date);
                    byDate.set(d, (byDate.get(d) ?? 0) + Number(r.quantidade ?? 0));
                  }
                  return Array.from(byDate.entries())
                    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                    .slice(-12)
                    .map(([, v]) => v);
                })();

                const isLeader = idx === 0;
                const color = chartColors[item.player] ?? (isLeader ? "#ff5000" : "#888");
                const totalFormatted =
                  item.volume >= 1000
                    ? `${(item.volume / 1000).toFixed(1)}k`
                    : item.volume.toFixed(1);

                return (
                  <MobileDataCard
                    key={item.player}
                    title={item.player}
                    subtitle={`${totalFormatted} thou. m³`}
                    sparkline={sparklineValues}
                    sparklineColor={color}
                    leftIcon={
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: color + "22",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 700,
                          color,
                        }}
                      >
                        {idx + 1}
                      </div>
                    }
                    rightSlot={
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)" }}>
                          {totalFormatted}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--mobile-text-muted, #6b6b73)" }}>thou. m³</div>
                      </div>
                    }
                  />
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* Trends section — MoM / QTD / YoY / YTD deltas per player */
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: "var(--mobile-text-muted, #6b6b73)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {productTabToProduto(productTab)} · {effectiveSegment === "Total" ? "All Segments" : effectiveSegment} — Volume Var. (thousand m³)
          </div>
          <div
            style={{
              background: "var(--mobile-surface, #ffffff)",
              border: "1px solid var(--mobile-border-soft, #f0f0f5)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {comparisonRows.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--mobile-text-muted, #6b6b73)", fontSize: 13 }}>
                No data for the selected filters.
              </div>
            ) : (
              comparisonRows.map((row) => {
                const color = chartColors[row.player] ?? "#888";
                return (
                  <div
                    key={row.player}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--mobile-divider, #f0f0f5)",
                      background: "var(--mobile-surface, #ffffff)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    {/* Player name row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--mobile-text, #1a1a1a)" }}>
                        {row.player}
                      </span>
                    </div>

                    {/* Delta grid: MoM / QTD / YoY / YTD */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, 1fr)",
                        gap: 6,
                      }}
                    >
                      <DeltaCell label="MoM" value={row.mom} />
                      <DeltaCell label="QTD" value={row.q3m} />
                      <DeltaCell label="YoY" value={row.yoy} />
                      <DeltaCell label="YTD" value={row.ytd} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Bottom tab bar (Chart / Ranking / Trends) ────────────────────────── */}
      <MobileBottomTabBar
        tabs={[
          { key: "chart",   label: "Chart",   icon: <ChartIcon />,   active: bottomTab === "chart" },
          { key: "ranking", label: "Ranking", icon: <RankingIcon />, active: bottomTab === "ranking" },
          { key: "trends",  label: "Trends",  icon: <TrendsIcon />,  active: bottomTab === "trends" },
        ]}
        onChange={(k) => setBottomTab(k as "chart" | "ranking" | "trends")}
      />

      {/* ── Export FAB ───────────────────────────────────────────────────────── */}
      <ExportFAB
        label="Export"
        onClick={openExportModal}
        disabled={seriesLoading || excelLoading || csvLoading}
        bottom="calc(72px + var(--mobile-safe-bottom, 0px) + 16px)"
      />

      {/* ── Filter Drawer ────────────────────────────────────────────────────── */}
      <FilterDrawer
        open={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        title="Filters"
        resetLabel="Reset"
        applyLabel="Apply"
        onReset={() => {
          clearFilters();
          setFilterDrawerOpen(false);
        }}
        onApply={() => {
          applyFilters();
          setFilterDrawerOpen(false);
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Period */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--mobile-text-muted, #6b6b73)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Period
            </div>
            {datas.length > 0 && (
              <PeriodSlider
                dates={datas}
                value={sliderRange}
                onChange={setSliderRange}
                sliderId="sv-mobile-slider"
                fmtLabel={fmtMonthLabel}
              />
            )}
          </div>

          {/* View Mode */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--mobile-text-muted, #6b6b73)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              View Mode
            </div>
            <SegmentedToggle
              options={SV_MODE_OPTIONS.map((m) => ({ value: m, label: m }))}
              value={mode}
              onChange={(v) => setMode(v as SvMode)}
            />
          </div>

          {/* Competitors */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--mobile-text-muted, #6b6b73)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Competitors
            </div>
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

          {/* Region / State */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "var(--mobile-text-muted, #6b6b73)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Region / State
            </div>
            <RegionStateFilter
              regioes={regioesAll}
              ufs={ufsAll}
              selectedRegioes={regioesSelected}
              selectedUfs={ufsSelected}
              onRegioesChange={setRegioesSelected}
              onUfsChange={setUfsSelected}
            />
          </div>
        </div>
      </FilterDrawer>

      {/* ── Export Modal (Tier 2) ─────────────────────────────────────────────── */}
      <ExportModal
        open={exportOpen}
        onClose={closeExportModal}
        title="Export — Sales Volumes"
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
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Period</div>
              {datas.length > 0 && (
                <PeriodSlider dates={datas} value={exportRange} onChange={setExportRange} sliderId="sv-mobile-export-slider" fmtLabel={fmtMonthLabel} />
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Regions</div>
              <CheckList label="Regions" options={regioesAll} value={exportRegioes} onChange={setExportRegioes} allLabel="All" clearLabel="Clear" />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>States</div>
              <SearchableMultiSelect options={ufsAll} value={exportUfs} onChange={setExportUfs} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Markets</div>
              <CheckList label="Markets" options={mercadosAll} value={exportMercados} onChange={setExportMercados} allLabel="All" clearLabel="Clear" />
            </div>
          </div>
        }
      />
    </div>
  );
}

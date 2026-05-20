"use client";

// Mobile view for /sales-volumes.
// Archetype: mockups/market-share-mobile.html (heavy chart + filter sheet).
// Adaptation: volumes (absolute, thousand m³) instead of market-share %.
//
// Layout:
//   MobileTopBar (sticky, liquid glass)
//   Filter chip row (sticky, horizontal scroll)
//   Title block
//   Product tab bar (Diesel B / Gasoline C / Ethanol / Otto-Cycle)
//   MobileChart — stacked area of volumes for the selected product
//   Ranking section — MobileDataCard rows sorted by total volume
//   ExportFAB (floating)
//   FilterDrawer (BottomSheet with PeriodSlider + region/competitors)

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

/** Build a stacked area chart for a single product (all segments combined). */
function buildMobileAreaChart(params: {
  serieRows: MsSerieRow[];
  produto: string;
  players: string[];
  big3: boolean;
  groupBy: "classificacao" | "agente_regulado";
  colors: Record<string, string>;
}): PlotData[] {
  const { serieRows, produto, players, big3, groupBy, colors } = params;

  let rows = serieRows.filter((r) => r.nome_produto === produto);
  if (rows.length === 0) return [];

  // Aggregate by (date, player-key)
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

  // Pivot to date → player → volume
  const datePlayerMap = new Map<string, Map<string, number>>();
  for (const [key, vol] of groupMap.entries()) {
    const [date, cls] = key.split("|");
    if (!players.includes(cls)) continue;
    if (!datePlayerMap.has(date)) datePlayerMap.set(date, new Map());
    datePlayerMap.get(date)!.set(cls, vol);
  }

  const dates = Array.from(datePlayerMap.keys()).sort();

  return players
    .filter((p) => dates.some((d) => (datePlayerMap.get(d)?.get(p) ?? 0) > 0))
    .map((player) => ({
      type: "scatter",
      mode: "lines",
      stackgroup: "volume",
      fillcolor: colors[player] ? colors[player] + "33" : undefined,
      x: dates,
      y: dates.map((d) => datePlayerMap.get(d)?.get(player) ?? 0),
      name: player,
      line: { width: 1.5, color: colors[player] ?? "#888" },
      hovertemplate: "%{fullData.name}: %{y:,.1f} thou. m³<extra></extra>",
    } as unknown as PlotData));
}

/** Simplified non-stacked version that maps correctly. */
function buildMobileSeries(params: {
  serieRows: MsSerieRow[];
  produto: string;
  players: string[];
  big3: boolean;
  groupBy: "classificacao" | "agente_regulado";
  colors: Record<string, string>;
}): PlotData[] {
  const { serieRows, produto, players, big3, groupBy, colors } = params;

  const rows = serieRows.filter((r) => r.nome_produto === produto);
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

function ChartIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function RankingIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function FilterIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
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
    applyFilters, clearFilters,
    exportOpen, openExportModal, closeExportModal,
    exportRange, setExportRange,
    exportRegioes, setExportRegioes,
    exportUfs, setExportUfs,
    exportMercados, setExportMercados,
    exportFilters, fetchExportCount,
    excelLoading, csvLoading, onExportExcel, onExportCsv,
  } = sv;

  // ── Local UI state ───────────────────────────────────────────────────────
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [productTab, setProductTab] = useState<ProductTab>("diesel");
  /** "chart" or "ranking" — bottom tab */
  const [bottomTab, setBottomTab] = useState<"chart" | "ranking">("chart");

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

  // ── Chart data for selected product ──────────────────────────────────────
  const activeProduct = productTabToProduto(productTab);
  const activeRows = productTab === "otto" ? ottoCycleRows : serieRows;

  const chartTraces = useMemo(() =>
    buildMobileSeries({ serieRows: activeRows, produto: activeProduct, players, big3, groupBy, colors: chartColors }),
    [activeRows, activeProduct, players, big3, groupBy, chartColors],
  );

  // ── Ranking for selected product (latest date, all segments combined) ────
  const rankingData = useMemo(() => {
    if (!latestDate) return [];
    return computeTopPlayers(activeRows, activeProduct, null, latestDate, big3, groupBy);
  }, [activeRows, activeProduct, latestDate, big3, groupBy]);

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
    return chips;
  }, [sliderRange, datas, regioesSelected, ufsSelected, competidoresSelected, mode]);

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
      <div style={{ padding: "0 16px 12px" }}>
        <MobileTabBar
          tabs={PRODUCT_TABS.map((t) => ({ key: t.key, label: t.label }))}
          activeKey={productTab}
          onChange={(k) => setProductTab(k as ProductTab)}
          variant="container"
          ariaLabel="Product selection"
        />
      </div>

      {/* ── Main content: chart or ranking ───────────────────────────────────── */}
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
                {productTabToProduto(productTab)} — All Segments
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
      ) : (
        /* Ranking section */
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 700, color: "var(--mobile-text-muted, #6b6b73)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {productTabToProduto(productTab)} — Volume Ranking
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
                    return cls === item.player && r.nome_produto === activeProduct;
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
      )}

      {/* ── Bottom tab bar (Chart / Ranking) ─────────────────────────────────── */}
      <MobileBottomTabBar
        tabs={[
          { key: "chart",   label: "Chart",   icon: <ChartIcon />,   active: bottomTab === "chart" },
          { key: "ranking", label: "Ranking", icon: <RankingIcon />, active: bottomTab === "ranking" },
          { key: "filters", label: "Filters", icon: <FilterIcon />,  active: false },
        ]}
        onChange={(k) => {
          if (k === "filters") { setFilterDrawerOpen(true); return; }
          setBottomTab(k as "chart" | "ranking");
        }}
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

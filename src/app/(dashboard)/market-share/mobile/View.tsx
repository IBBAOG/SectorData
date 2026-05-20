"use client";

// Mobile view — /market-share
//
// Layout (per mockups/market-share-mobile.html):
//   MobileTopBar  (sticky, liquid glass)
//   Title block   (h1 + subtitle + period badge)
//   Filter chip row  (sticky, horizontal scroll — active chips + "+ Filters" button)
//   Hero chart card  (MobileChart — stacked area, 12-month, top 5)
//   2-column legend below chart
//   Top Distributors ranking  (MobileDataCard rows with rank badge + progress bar + delta)
//   "View all" CTA
//   ExportFAB   (floating, above tab bar)
//   MobileBottomTabBar  (Overview / Compare / Filters / Profile)
//   FilterDrawer  (bottom sheet — Product / Period / Region / UF / Segment + Reset/Apply)
//
// Analyses preserved from desktop:
//   - All 13 charts (Diesel B, Gasoline C, Hydrous Ethanol, Otto-Cycle × Retail/B2B/TRR/Total)
//     → overview tab shows hero Diesel B Total; Compare tab will surface the rest (stub for now)
//   - Comparison table (MoM/QTD/YoY/YTD) → shown in Compare tab (stub)
//   - Export (Tier 2, ExportModal) → FAB triggers same modal as desktop
//   - All 4 filter dimensions (period, region, UF, mode/competitors)

import { useState, useMemo } from "react";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  MobileBottomTabBar,
  FilterDrawer,
  MobileChart,
  ExportFAB,
} from "../../../../components/dashboard/mobile";
import ExportModal from "../../../../components/dashboard/ExportModal";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import {
  useMarketShareData,
  buildMobileStackedArea,
  MOBILE_PALETTE,
  ALL_PLAYERS_IND,
  ALL_PLAYERS_BIG3,
  type TopPlayerRow,
} from "../useMarketShareData";
import { downloadMarketShareExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import { fetchVendasFiltered, getMsExportCount } from "../../../../lib/rpc";
import type { PlotData } from "plotly.js";

// ─── Constants ────────────────────────────────────────────────────────────────

type MobileTab = "overview" | "compare" | "filters" | "profile";

const TABS = [
  {
    key: "overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true">
        <rect x="3" y="12" width="4" height="9" rx="1" />
        <rect x="10" y="6" width="4" height="15" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
  },
  {
    key: "compare",
    label: "Compare",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true">
        <path d="M3 17l6-6 4 4 8-8" />
        <polyline points="14 7 21 7 21 14" />
      </svg>
    ),
  },
  {
    key: "filters",
    label: "Filters",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
    ),
  },
  {
    key: "profile",
    label: "Profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
] as const;

// Products available in the filter drawer
const PRODUCTS = ["Diesel B", "Gasolina C", "Etanol Hidratado", "Otto-Cycle"];

// ─── PlayerCard ───────────────────────────────────────────────────────────────

function PlayerCard({ row }: { row: TopPlayerRow }) {
  const deltaSign = row.deltaMoM !== null ? (row.deltaMoM > 0 ? "+" : "") : "";
  const deltaColor =
    row.deltaMoM === null ? "var(--mobile-text-faint)"
    : row.deltaMoM > 0 ? "var(--mobile-up)"
    : "var(--mobile-down)";

  return (
    <div
      style={{
        minHeight: 72,
        padding: "12px 14px",
        display: "grid",
        gridTemplateColumns: "32px 1fr auto",
        gridTemplateRows: "auto auto",
        columnGap: 12,
        rowGap: 4,
        alignItems: "center",
        borderBottom: "1px solid var(--mobile-divider)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* Rank badge */}
      <div
        style={{
          gridRow: "1 / 3",
          width: 28,
          height: 28,
          borderRadius: 8,
          background: row.isLeader ? "var(--mobile-accent)" : "var(--mobile-divider)",
          color: row.isLeader ? "#fff" : "var(--mobile-text-muted)",
          fontSize: 13,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: row.isLeader ? "0 2px 6px rgba(255,80,0,0.30)" : "none",
          flexShrink: 0,
        }}
      >
        {row.rank}
      </div>

      {/* Name */}
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--mobile-text)",
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {row.player}
      </div>

      {/* Percent */}
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--mobile-text)",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        }}
      >
        {row.pct.toFixed(1)}%
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "var(--mobile-divider)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            width: `${row.barWidth}%`,
            background: row.isLeader ? "var(--mobile-accent)" : "var(--mobile-text-faint)",
            borderRadius: 2,
            opacity: row.isLeader ? 1 : 0.55,
          }}
        />
      </div>

      {/* Delta */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
          color: deltaColor,
        }}
      >
        {row.deltaMoM === null
          ? "—"
          : `${deltaSign}${row.deltaMoM.toFixed(1)} pp`}
      </div>
    </div>
  );
}

// ─── FilterDrawer contents ────────────────────────────────────────────────────

interface DrawerFilterState {
  product: string;
  regioes: string[];
  mode: string;
  ufs: string[];
}

function CheckPills({
  options,
  value,
  onChange,
  radio = false,
}: {
  options: string[];
  value: string | string[];
  onChange: (v: string | string[]) => void;
  radio?: boolean;
}) {
  const isOn = (opt: string) =>
    radio ? value === opt : (value as string[]).includes(opt);

  const toggle = (opt: string) => {
    if (radio) {
      onChange(opt);
      return;
    }
    const arr = value as string[];
    if (arr.includes(opt)) onChange(arr.filter((v) => v !== opt));
    else onChange([...arr, opt]);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          style={{
            minHeight: 36,
            padding: "0 14px",
            borderRadius: 999,
            border: `1px solid ${isOn(opt) ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
            background: isOn(opt) ? "var(--mobile-accent)" : "var(--mobile-surface)",
            color: isOn(opt) ? "#fff" : "var(--mobile-text)",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: isOn(opt) ? "0 2px 6px rgba(255,80,0,0.25)" : "none",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  loading,
  heroTraces,
  topPlayers,
  latestDate,
  chartColors,
  onViewAll,
}: {
  loading: boolean;
  heroTraces: PlotData[];
  topPlayers: TopPlayerRow[];
  latestDate: string | null;
  chartColors: Record<string, string>;
  onViewAll: () => void;
}) {
  if (loading) {
    return (
      <div style={{ padding: "24px 16px" }}>
        <BarrelLoading bare />
      </div>
    );
  }

  const latestLabel = latestDate
    ? (() => {
        const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const m = parseInt(latestDate.slice(5, 7), 10) - 1;
        const y = latestDate.slice(0, 4);
        return `${MONTHS[m]} ${y}`;
      })()
    : null;

  // 2-column legend entries
  const legendEntries = topPlayers.map((p, i) => ({
    name: p.player,
    color: p.color ?? chartColors[p.player] ?? MOBILE_PALETTE[i % MOBILE_PALETTE.length],
    isLeader: p.isLeader,
  }));

  return (
    <div style={{ paddingBottom: 16 }}>
      {/* Hero chart card */}
      <div style={{ padding: "16px 16px 0" }}>
        <div
          style={{
            background: "var(--mobile-surface)",
            border: "1px solid var(--mobile-divider)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 14px 6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--mobile-text)",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              Share over time
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--mobile-text-muted)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              12M Rolling
            </div>
          </div>

          {heroTraces.length > 0 ? (
            <MobileChart
              data={heroTraces}
              height={320}
              layout={{
                yaxis: { ticksuffix: "%", range: [0, 100] },
                xaxis: { type: "date" as const, tickformat: "%b %y", nticks: 6 },
                hovermode: "x unified",
              }}
            />
          ) : (
            <div
              style={{
                height: 320,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 13,
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              No data for the selected filters.
            </div>
          )}

          {/* 2-column legend */}
          {legendEntries.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "4px 12px",
                padding: "8px 14px 14px",
              }}
            >
              {legendEntries.map((e) => (
                <div
                  key={e.name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: e.isLeader ? "var(--mobile-text)" : "var(--mobile-text-muted)",
                    fontWeight: e.isLeader ? 700 : 400,
                    minHeight: 22,
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: e.color,
                      flexShrink: 0,
                    }}
                  />
                  {e.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top players ranking */}
      <div style={{ padding: "16px 16px 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            paddingBottom: 10,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 700,
              color: "var(--mobile-text)",
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            Top Distributors
          </h2>
          {latestLabel && (
            <span
              style={{
                fontSize: 12,
                color: "var(--mobile-text-muted)",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              {latestLabel}
            </span>
          )}
        </div>

        {topPlayers.length > 0 ? (
          <div
            style={{
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {topPlayers.map((row) => (
              <PlayerCard key={row.player} row={row} />
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              color: "var(--mobile-text-muted)",
              fontSize: 13,
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            No data available.
          </div>
        )}

        {topPlayers.length > 0 && (
          <button
            type="button"
            onClick={onViewAll}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              width: "100%",
              minHeight: 48,
              marginTop: 12,
              background: "transparent",
              border: 0,
              color: "var(--mobile-accent)",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              borderRadius: 12,
            }}
          >
            View all distributors
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Compare tab (stub) ───────────────────────────────────────────────────────

function CompareTab({ loading }: { loading: boolean }) {
  if (loading) return <div style={{ padding: "24px 16px" }}><BarrelLoading bare /></div>;
  return (
    <div
      style={{
        padding: "24px 16px",
        textAlign: "center",
        color: "var(--mobile-text-muted)",
        fontSize: 14,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      Detailed comparisons (MoM / QTD / YoY) — coming soon.
      <br />
      Use the desktop view for the full comparison table.
    </div>
  );
}

// ─── Active chips ─────────────────────────────────────────────────────────────

function ActiveChips({
  product,
  regioes,
  ufs,
  latestDate,
  onOpenFilters,
  onRemoveProduct,
  onRemoveRegiao,
  onRemoveUf,
}: {
  product: string;
  regioes: string[];
  ufs: string[];
  latestDate: string | null;
  onOpenFilters: () => void;
  onRemoveProduct: () => void;
  onRemoveRegiao: (r: string) => void;
  onRemoveUf: (u: string) => void;
}) {
  const X = (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );

  const chipStyle = (remove: () => void): React.CSSProperties => ({
    flexShrink: 0,
    minHeight: 32,
    padding: "0 8px 0 12px",
    borderRadius: 999,
    border: "1px solid var(--mobile-border)",
    background: "var(--mobile-surface)",
    color: "var(--mobile-text)",
    fontSize: 13,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
    cursor: "pointer",
    fontFamily: "Arial, Helvetica, sans-serif",
  });

  const removeBtn = (onRemove: () => void) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRemove(); }}
      style={{
        width: 18,
        height: 18,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        background: "var(--mobile-row-press)",
        color: "var(--mobile-text-muted)",
        border: 0,
        cursor: "pointer",
        flexShrink: 0,
        padding: 0,
      }}
    >
      {X}
    </button>
  );

  const periodLabel = latestDate
    ? (() => {
        const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const y = latestDate.slice(0, 4);
        const m = parseInt(latestDate.slice(5, 7), 10) - 1;
        return `to ${MONTHS[m]} ${y}`;
      })()
    : null;

  return (
    <nav
      aria-label="Active filters"
      style={{
        position: "sticky",
        top: "var(--mobile-topbar-h)",
        zIndex: 25,
        height: 52,
        background: "var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        borderBottom: "1px solid var(--mobile-glass-border)",
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        overflowY: "hidden",
        gap: 8,
        padding: "0 16px",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
      }}
    >
      {/* Product chip */}
      <div style={chipStyle(onRemoveProduct)}>
        {product}
        {removeBtn(onRemoveProduct)}
      </div>

      {/* Period chip */}
      {periodLabel && (
        <div
          style={{
            ...chipStyle(() => {}),
            color: "var(--mobile-text-muted)",
            cursor: "default",
            paddingRight: 12,
          }}
        >
          {periodLabel}
        </div>
      )}

      {/* Region chips */}
      {regioes.map((r) => (
        <div key={r} style={chipStyle(() => onRemoveRegiao(r))}>
          {r}
          {removeBtn(() => onRemoveRegiao(r))}
        </div>
      ))}

      {/* UF chips */}
      {ufs.map((u) => (
        <div key={u} style={chipStyle(() => onRemoveUf(u))}>
          {u}
          {removeBtn(() => onRemoveUf(u))}
        </div>
      ))}

      {/* + Filters button */}
      <button
        type="button"
        onClick={onOpenFilters}
        style={{
          flexShrink: 0,
          minHeight: 32,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid var(--mobile-accent)",
          background: "transparent",
          color: "var(--mobile-accent)",
          fontSize: 13,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Filters
      </button>
    </nav>
  );
}

// ─── Mobile View ──────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("market-share");

  const ms = useMarketShareData();

  // Local mobile state
  const [activeTab, setActiveTab] = useState<MobileTab>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Drawer-local filter state (committed to hook on Apply)
  const [drawerProduct, setDrawerProduct] = useState<string>("Diesel B");
  const [drawerRegioes, setDrawerRegioes] = useState<string[]>([]);
  const [drawerMode, setDrawerMode] = useState<string>("Individual");
  const [drawerUfs, setDrawerUfs] = useState<string[]>([]);

  // Active chip state (reflects last apply)
  const [chipProduct, setChipProduct] = useState<string>("Diesel B");
  const [chipRegioes, setChipRegioes] = useState<string[]>([]);
  const [chipUfs, setChipUfs] = useState<string[]>([]);

  const openDrawer = () => {
    setDrawerProduct(chipProduct);
    setDrawerRegioes([...chipRegioes]);
    setDrawerMode(ms.mode);
    setDrawerUfs([...chipUfs]);
    setDrawerOpen(true);
  };

  const handleDrawerApply = () => {
    setChipProduct(drawerProduct);
    setChipRegioes([...drawerRegioes]);
    setChipUfs([...drawerUfs]);
    ms.setMode(drawerMode as typeof ms.mode);
    ms.setRegioesSelected(drawerRegioes);
    ms.setUfsSelected(drawerUfs);
    ms.applyFilters();
    setDrawerOpen(false);
  };

  const handleDrawerReset = () => {
    setDrawerProduct("Diesel B");
    setDrawerRegioes([]);
    setDrawerMode("Individual");
    setDrawerUfs([]);
  };

  // Hero chart traces (stacked area, Diesel B Total → or selected product, 12M)
  const heroTraces = useMemo<PlotData[]>(() => {
    if (ms.seriesLoading || ms.serieRows.length === 0) return [];
    const productRows =
      chipProduct === "Otto-Cycle" ? ms.ottoCycleRows : ms.serieRows;
    const players =
      ms.big3 ? ALL_PLAYERS_BIG3 : ALL_PLAYERS_IND;
    return buildMobileStackedArea({
      serieRows: productRows,
      produto: chipProduct,
      segmento: null,
      players,
      nMonths: 12,
      colorsOverride: ms.chartColors,
    });
  }, [ms.seriesLoading, ms.serieRows, ms.ottoCycleRows, chipProduct, ms.big3, ms.chartColors]);

  const tabItems = TABS.map((t) => ({
    key: t.key,
    label: t.label,
    icon: t.icon,
    active: activeTab === t.key,
  }));

  const onTabChange = (key: string) => {
    if (key === "filters") {
      openDrawer();
      return;
    }
    setActiveTab(key as MobileTab);
  };

  const fmtLabel = (d: string) => {
    try {
      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${MONTHS[parseInt(d.slice(5,7),10)-1]}, ${d.slice(0,4)}`;
    } catch { return d; }
  };

  if (visLoading || !visible) return <></>;

  // Period badge text
  const periodBadge = (() => {
    if (ms.datas.length === 0) return null;
    const [a, b] = ms.sliderRange;
    const start = ms.datas[a];
    const end = ms.datas[b];
    if (!start || !end) return null;
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const fmt = (d: string) => {
      const m = parseInt(d.slice(5, 7), 10) - 1;
      return `${MONTHS[m]} ${d.slice(0, 4)}`;
    };
    return `${fmt(start)} – ${fmt(end)}`;
  })();

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(72px + var(--mobile-safe-bottom))",
        position: "relative",
      }}
    >
      {/* Top bar */}
      <MobileTopBar
        title={
          <span style={{ fontWeight: 700, letterSpacing: "0.04em" }}>
            SECTORDATA
            <span style={{ color: "var(--mobile-accent)" }}>.</span>
          </span>
        }
        showAvatar
        avatarInitials="SB"
        avatarLabel="SectorData user"
      />

      {/* Title block */}
      <section style={{ padding: "16px 16px 12px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: "var(--mobile-text)",
            letterSpacing: "0.005em",
            lineHeight: 1.15,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          Market Share
        </h1>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.3,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          Brazilian fuel distribution
        </p>
        {periodBadge && (
          <span
            aria-label="Period"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--mobile-accent-soft)",
              color: "var(--mobile-accent)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--mobile-accent)",
                display: "inline-block",
              }}
            />
            {periodBadge}
          </span>
        )}
      </section>

      {/* Filter chip row */}
      <ActiveChips
        product={chipProduct}
        regioes={chipRegioes}
        ufs={chipUfs}
        latestDate={ms.latestDate}
        onOpenFilters={openDrawer}
        onRemoveProduct={() => { setChipProduct("Diesel B"); }}
        onRemoveRegiao={(r) => {
          const next = chipRegioes.filter((x) => x !== r);
          setChipRegioes(next);
          ms.setRegioesSelected(next);
          ms.applyFilters();
        }}
        onRemoveUf={(u) => {
          const next = chipUfs.filter((x) => x !== u);
          setChipUfs(next);
          ms.setUfsSelected(next);
          ms.applyFilters();
        }}
      />

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab
          loading={ms.seriesLoading}
          heroTraces={heroTraces}
          topPlayers={ms.topPlayers}
          latestDate={ms.latestDate}
          chartColors={ms.chartColors}
          onViewAll={openDrawer}
        />
      )}
      {activeTab === "compare" && (
        <CompareTab loading={ms.seriesLoading} />
      )}

      {/* Export FAB */}
      <ExportFAB
        icon="download"
        onClick={ms.openExportModal}
        disabled={ms.seriesLoading || ms.excelLoading || ms.csvLoading}
        ariaLabel="Export data"
      />

      {/* Bottom tab bar */}
      <MobileBottomTabBar
        tabs={tabItems}
        onChange={onTabChange}
      />

      {/* Filter drawer */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={handleDrawerReset}
        onApply={handleDrawerApply}
        applyLabel="Apply filters"
        resetLabel="Reset"
      >
        {/* Product */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            Product
          </div>
          <CheckPills
            options={PRODUCTS}
            value={drawerProduct}
            onChange={(v) => setDrawerProduct(v as string)}
            radio
          />
        </div>

        {/* Period */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Period</span>
            {periodBadge && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-faint)",
                  letterSpacing: 0,
                  textTransform: "none",
                }}
              >
                {periodBadge}
              </span>
            )}
          </div>
          {ms.datas.length > 0 && (
            <PeriodSlider
              dates={ms.datas}
              value={ms.sliderRange}
              onChange={ms.setSliderRange}
              sliderId="ms-mobile-slider"
              fmtLabel={fmtLabel}
            />
          )}
        </div>

        {/* Region */}
        {ms.regioesAll.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--mobile-text-muted)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
                fontFamily: "Arial, Helvetica, sans-serif",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Region</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mobile-text-faint)", textTransform: "none", letterSpacing: 0 }}>
                {drawerRegioes.length > 0 ? `${drawerRegioes.length} of ${ms.regioesAll.length}` : "All"}
              </span>
            </div>
            <CheckPills
              options={ms.regioesAll}
              value={drawerRegioes}
              onChange={(v) => setDrawerRegioes(v as string[])}
            />
          </div>
        )}

        {/* UF */}
        {ms.ufsAll.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--mobile-text-muted)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
                fontFamily: "Arial, Helvetica, sans-serif",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>UF</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mobile-text-faint)", textTransform: "none", letterSpacing: 0 }}>
                {drawerUfs.length > 0 ? `${drawerUfs.length} selected` : "All"}
              </span>
            </div>
            <CheckPills
              options={ms.ufsAll}
              value={drawerUfs}
              onChange={(v) => setDrawerUfs(v as string[])}
            />
          </div>
        )}

        {/* Segment / Mode */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            View Mode
          </div>
          <CheckPills
            options={["Individual", "Big-3", "Others"]}
            value={drawerMode}
            onChange={(v) => setDrawerMode(v as string)}
            radio
          />
        </div>
      </FilterDrawer>

      {/* Export Modal (same Tier 2 as desktop) */}
      <ExportModal
        open={ms.exportOpen}
        onClose={ms.closeExportModal}
        title="Export — Market Share"
        datasetKey="vendas"
        currentFilters={ms.exportFilters}
        countFetcher={async () => {
          if (!ms.supabase) return 0;
          return getMsExportCount(ms.supabase, ms.exportFilters);
        }}
        excelBusy={ms.excelLoading}
        csvBusy={ms.csvLoading}
        loadingLabel={ms.excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={async () => {
          ms.setExcelLoading(true);
          try {
            await downloadMarketShareExcel(ms.serieRows, ms.players, ms.big3);
            ms.closeExportModal();
          } catch (e) {
            console.error("Excel export failed", e);
          } finally {
            ms.setExcelLoading(false);
          }
        }}
        onExportCsv={async () => {
          if (!ms.supabase) return;
          ms.setCsvLoading(true);
          try {
            const rows = await fetchVendasFiltered(ms.supabase, ms.exportFilters);
            downloadCsv({ rows, filename: "market_share_vendas" });
            ms.closeExportModal();
          } catch (e) {
            console.error("CSV export failed", e);
          } finally {
            ms.setCsvLoading(false);
          }
        }}
        filters={
          <div style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 13, color: "var(--mobile-text-muted)" }}>
            Period and region filters from main view apply to this export.
          </div>
        }
      />
    </div>
  );
}

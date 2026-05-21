"use client";

// Mobile view — /market-share
//
// Layout (per mockups/market-share-mobile.html):
//   MobileTopBar  (sticky, liquid glass)
//   Title block   (h1 + subtitle + period badge)
//   Filter chip row  (sticky, horizontal scroll — active chips + "+ Filters" button)
//   Product + segment MobileTabBars (container variant)  — navigates the 13 charts
//   Hero chart card  (MobileChart — stacked area for the SELECTED product/segment)
//   2-column legend below chart
//   Top Distributors ranking  (MobileDataCard rows with rank badge + progress bar + delta)
//   "View all" CTA
//   ExportFAB   (floating, above tab bar)
//   MobileBottomTabBar  (Overview / Compare / Filters / Profile)
//   FilterDrawer  (bottom sheet — Product / Period / Region / UF / Segment + Reset/Apply)
//
// Analyses preserved from desktop:
//   - All 13 charts (Diesel B Retail/B2B/TRR/Total, Gasoline C Retail/B2B/Total,
//     Hydrous Ethanol Retail/B2B/Total, Otto-Cycle Retail/B2B/Total)
//     → Overview tab: product + segment selector lets the user navigate
//        through all 13 chart variants, one at a time. Default: Diesel B / Total.
//   - Comparison table (MoM/QTD/YoY/YTD) → Compare tab: pick up to 3 players,
//     see side-by-side MoM/QTD/YoY/YTD cards for the selected chart variant.
//   - Export (Tier 2, ExportModal) → FAB triggers same modal as desktop.
//   - All 4 filter dimensions (period, region, UF, mode/competitors).

import { useState, useMemo } from "react";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  MobileBottomTabBar,
  FilterDrawer,
  MobileChart,
  ExportFAB,
  MobileTabBar,
  BarChartTallIcon,
  TrendingUpIcon,
  FunnelIcon,
  UserIcon,
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
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
  PRODUCT_KEYS,
  PRODUCT_LABEL,
  SEGMENTS_BY_PRODUCT,
  type TopPlayerRow,
  type CompRow,
  type ProductKey,
  type SegmentKey,
} from "../useMarketShareData";
import type { PlotData } from "plotly.js";

// ─── Constants ────────────────────────────────────────────────────────────────

type MobileTab = "overview" | "compare" | "filters" | "profile";

const TABS = [
  {
    key: "overview",
    label: "Overview",
    icon: <BarChartTallIcon size={22} />,
  },
  {
    key: "compare",
    label: "Compare",
    icon: <TrendingUpIcon size={22} />,
  },
  {
    key: "filters",
    label: "Filters",
    icon: <FunnelIcon size={22} />,
  },
  {
    key: "profile",
    label: "Profile",
    icon: <UserIcon size={22} />,
  },
] as const;

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
  selectedProduct,
  selectedSegment,
  onSelectProduct,
  onSelectSegment,
}: {
  loading: boolean;
  heroTraces: PlotData[];
  topPlayers: TopPlayerRow[];
  latestDate: string | null;
  chartColors: Record<string, string>;
  onViewAll: () => void;
  selectedProduct: ProductKey;
  selectedSegment: SegmentKey;
  onSelectProduct: (p: ProductKey) => void;
  onSelectSegment: (s: SegmentKey) => void;
}) {
  const productTabs = PRODUCT_KEYS.map((p) => ({
    key: p,
    label: PRODUCT_LABEL[p],
  }));
  const segmentOptions = SEGMENTS_BY_PRODUCT[selectedProduct];
  const segmentTabs = segmentOptions.map((s) => ({ key: s, label: s }));

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

  const chartHeading = `${PRODUCT_LABEL[selectedProduct]} — ${selectedSegment}`;

  return (
    <div style={{ paddingBottom: 16 }}>
      {/* Product selector (4 products) */}
      <div style={{ padding: "12px 0 8px" }}>
        <MobileTabBar
          tabs={productTabs}
          activeKey={selectedProduct}
          onChange={(k) => onSelectProduct(k as ProductKey)}
          variant="container"
          ariaLabel="Product"
        />
      </div>

      {/* Segment selector (Total / Retail / B2B / TRR — TRR only for Diesel B) */}
      <div style={{ padding: "0 0 4px" }}>
        <MobileTabBar
          tabs={segmentTabs}
          activeKey={selectedSegment}
          onChange={(k) => onSelectSegment(k as SegmentKey)}
          variant="underline"
          ariaLabel="Segment"
        />
      </div>

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
              {chartHeading}
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
            <ChevronRightIcon size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Compare tab (full implementation) ────────────────────────────────────────
//
// Mobile equivalent of desktop's ComparisonTable. The user picks up to 3
// players from the chart's player set, and we surface MoM / QTD / YoY / YTD
// side-by-side as cards. Reuses the hook's `activeCompRows` so the analysis
// matches whatever (product, segment) is currently selected on the Overview
// tab — keeping a single source of truth across both tabs.

function CompareMetric({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const fmt = (v: number | null) =>
    v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  const bg =
    value === null
      ? "transparent"
      : value > 0
        ? "rgba(34, 197, 94, 0.12)"
        : value < 0
          ? "rgba(239, 68, 68, 0.12)"
          : "transparent";
  const color =
    value === null
      ? "var(--mobile-text-faint)"
      : value > 0
        ? "var(--mobile-up)"
        : value < 0
          ? "var(--mobile-down)"
          : "var(--mobile-text-muted)";
  return (
    <div
      style={{
        background: bg,
        borderRadius: 8,
        padding: "8px 6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--mobile-text-muted)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {fmt(value)}
      </span>
    </div>
  );
}

function CompareRowCard({
  row,
  color,
}: {
  row: CompRow;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid var(--mobile-divider)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--mobile-text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.player}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
        }}
      >
        <CompareMetric label="MoM" value={row.mom} />
        <CompareMetric label="QTD" value={row.q3m} />
        <CompareMetric label="YoY" value={row.yoy} />
        <CompareMetric label="YTD" value={row.ytd} />
      </div>
    </div>
  );
}

function CompareTab({
  loading,
  compRows,
  compareSet,
  toggleCompareMember,
  selectedProduct,
  selectedSegment,
  chartColors,
}: {
  loading: boolean;
  compRows: CompRow[];
  compareSet: string[];
  toggleCompareMember: (player: string) => void;
  selectedProduct: ProductKey;
  selectedSegment: SegmentKey;
  chartColors: Record<string, string>;
}) {
  if (loading) {
    return (
      <div style={{ padding: "24px 16px" }}>
        <BarrelLoading bare />
      </div>
    );
  }

  // Pool of players available in the current chart context.
  const availablePlayers = compRows.map((r) => r.player);
  const visibleRows = compRows.filter((r) => compareSet.includes(r.player));

  const headerLabel = `${PRODUCT_LABEL[selectedProduct]} — ${selectedSegment}`;

  return (
    <div style={{ paddingBottom: 16 }}>
      {/* Context banner */}
      <div style={{ padding: "12px 16px 0" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--mobile-text-muted)",
            fontFamily: "Arial, Helvetica, sans-serif",
            marginBottom: 4,
          }}
        >
          Compare market-share variation
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "var(--mobile-text)",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          {headerLabel}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--mobile-text-muted)",
            marginTop: 2,
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          Percentage-point delta vs MoM, QTD, YoY, YTD. Pick up to 3 distributors.
        </div>
      </div>

      {/* Player picker pills */}
      <div style={{ padding: "14px 16px 0" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          {availablePlayers.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: "var(--mobile-text-muted)",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              No players available for this chart.
            </div>
          ) : (
            availablePlayers.map((p) => {
              const on = compareSet.includes(p);
              const disabled = !on && compareSet.length >= 3;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggleCompareMember(p)}
                  disabled={disabled}
                  style={{
                    minHeight: 32,
                    padding: "0 12px",
                    borderRadius: 999,
                    border: `1px solid ${on ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
                    background: on ? "var(--mobile-accent)" : "var(--mobile-surface)",
                    color: on ? "#fff" : "var(--mobile-text)",
                    opacity: disabled ? 0.4 : 1,
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: disabled ? "not-allowed" : "pointer",
                    boxShadow: on ? "0 2px 6px rgba(255,80,0,0.25)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  {p}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Comparison cards */}
      <div style={{ padding: "16px 16px 0" }}>
        {visibleRows.length === 0 ? (
          <div
            style={{
              padding: 18,
              textAlign: "center",
              color: "var(--mobile-text-muted)",
              fontSize: 13,
              fontFamily: "Arial, Helvetica, sans-serif",
              border: "1px dashed var(--mobile-border)",
              borderRadius: 12,
            }}
          >
            Select up to 3 distributors above to compare their share variation.
          </div>
        ) : (
          <div
            style={{
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {visibleRows.map((row, idx) => (
              <CompareRowCard
                key={row.player}
                row={row}
                color={
                  chartColors[row.player] ??
                  MOBILE_PALETTE[idx % MOBILE_PALETTE.length]
                }
              />
            ))}
          </div>
        )}
      </div>
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
  const X = <CloseIcon size={10} strokeWidth={2.5} />;

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
        <PlusIcon size={14} strokeWidth={2.5} />
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

  // Drawer-local filter state (committed to hook on Apply). `drawerProduct`
  // mirrors `ms.selectedProduct` — the picker UI inside the drawer is a
  // legacy shortcut; the canonical selector now lives in OverviewTab.
  const [drawerProduct, setDrawerProduct] = useState<ProductKey>("Diesel B");
  const [drawerRegioes, setDrawerRegioes] = useState<string[]>([]);
  const [drawerMode, setDrawerMode] = useState<string>("Individual");
  const [drawerUfs, setDrawerUfs] = useState<string[]>([]);

  // Active chip state (reflects last apply) for region/UF only.
  // The product chip mirrors `ms.selectedProduct` so the chart selector
  // and the chip stay in sync.
  const [chipRegioes, setChipRegioes] = useState<string[]>([]);
  const [chipUfs, setChipUfs] = useState<string[]>([]);

  const openDrawer = () => {
    setDrawerProduct(ms.selectedProduct);
    setDrawerRegioes([...chipRegioes]);
    setDrawerMode(ms.mode);
    setDrawerUfs([...chipUfs]);
    setDrawerOpen(true);
  };

  const handleDrawerApply = () => {
    ms.setSelectedProduct(drawerProduct);
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

  // Hero chart traces — reflects the currently selected (product, segment)
  // from the OverviewTab MobileTabBar selectors.
  const heroTraces = useMemo<PlotData[]>(() => {
    if (ms.seriesLoading || ms.serieRows.length === 0) return [];
    const productRows =
      ms.selectedProduct === "Otto-Cycle" ? ms.ottoCycleRows : ms.serieRows;
    const players = ms.big3 ? ALL_PLAYERS_BIG3 : ALL_PLAYERS_IND;
    // SegmentKey "Total" maps to no segment filter (whole product).
    const segmentArg: string | null =
      ms.selectedSegment === "Total" ? null : ms.selectedSegment;
    return buildMobileStackedArea({
      serieRows: productRows,
      produto: ms.selectedProduct,
      segmento: segmentArg,
      players,
      nMonths: 12,
      colorsOverride: ms.chartColors,
    });
  }, [
    ms.seriesLoading,
    ms.serieRows,
    ms.ottoCycleRows,
    ms.selectedProduct,
    ms.selectedSegment,
    ms.big3,
    ms.chartColors,
  ]);

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
        product={PRODUCT_LABEL[ms.selectedProduct]}
        regioes={chipRegioes}
        ufs={chipUfs}
        latestDate={ms.latestDate}
        onOpenFilters={openDrawer}
        onRemoveProduct={() => { ms.setSelectedProduct("Diesel B"); }}
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
          topPlayers={ms.topPlayersForSelected}
          latestDate={ms.latestDate}
          chartColors={ms.chartColors}
          onViewAll={openDrawer}
          selectedProduct={ms.selectedProduct}
          selectedSegment={ms.selectedSegment}
          onSelectProduct={ms.setSelectedProduct}
          onSelectSegment={ms.setSelectedSegment}
        />
      )}
      {activeTab === "compare" && (
        <CompareTab
          loading={ms.seriesLoading}
          compRows={ms.activeCompRows}
          compareSet={ms.compareSet}
          toggleCompareMember={ms.toggleCompareMember}
          selectedProduct={ms.selectedProduct}
          selectedSegment={ms.selectedSegment}
          chartColors={ms.chartColors}
        />
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
            options={PRODUCT_KEYS.map((p) => PRODUCT_LABEL[p])}
            value={PRODUCT_LABEL[drawerProduct]}
            onChange={(v) => {
              const label = v as string;
              const found = PRODUCT_KEYS.find((p) => PRODUCT_LABEL[p] === label);
              if (found) setDrawerProduct(found);
            }}
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
        countFetcher={ms.fetchExportCount}
        excelBusy={ms.excelLoading}
        csvBusy={ms.csvLoading}
        loadingLabel={ms.excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={ms.onExportExcel}
        onExportCsv={ms.onExportCsv}
        filters={
          <div style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 13, color: "var(--mobile-text-muted)" }}>
            Period and region filters from main view apply to this export.
          </div>
        }
      />
    </div>
  );
}

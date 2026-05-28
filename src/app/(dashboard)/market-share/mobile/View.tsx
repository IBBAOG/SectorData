"use client";

// Mobile view — /market-share (v2, mobile reform 2026-05-27)
//
// Layout (top → bottom) per plan § 4.9:
//   1. MobileTopBar  (sticky, liquid glass) with kebab menu
//   2. Title block   (h1 + subtitle + period badge)
//   3. SegmentedToggle sticky  (% Share / Volume)
//   4. Product MobileTabBar  (Diesel B / Gasoline C / Hydrous Ethanol / Otto-Cycle)
//   5. Segment MobileTabBar  (Total / Retail / B2B / TRR — TRR only for Diesel B)
//   6. Hero chart card  (MobileChart — stacked area for active product × segment)
//   7. 2-column legend below chart
//   8. Top Distributors  (PlayerCard rows — rank + value + MoM delta)
//   9. Comparison table  (CompRow cards — MoM / QTD / YoY / YTD, horizontal scroll)
//  10. Filter chip row  (Period, Region, UF, View Mode + "+ Filters" trigger)
//   FilterDrawer  (bottom sheet — Period / Region / UF / View Mode + Reset/Apply)
//   MobileHomePill  (floating, above safe area)
//
// Removed vs v1:
//   - MobileBottomTabBar (Overview / Compare / Filters / Profile) — replaced by
//     the global single Home pill (MobileHomePill) + the filter chip row.
//   - ExportFAB — policy § 3.4: no export on mobile.
//   - ExportModal — same.
//   - Placeholder tabs (Map / Compare as tabs) — comparison table is now always
//     rendered inline, below the Top Distributors section.
//
// All 13 product × segment chart variants are still reachable via the two
// stacked MobileTabBars (Product + Segment). Nothing is removed from the
// analysis — only the navigation structure changed.

import { useState, useMemo } from "react";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  FilterDrawer,
  MobileChart,
  MobileTabBar,
  CloseIcon,
  PlusIcon,
} from "../../../../components/dashboard/mobile";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
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
  type UnitMode,
} from "../useMarketShareData";
import type { PlotData } from "plotly.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

const UNIT_OPTIONS: { value: UnitMode; label: string }[] = [
  { value: "share", label: "% Share" },
  { value: "volume", label: "thousand m³" },
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(d: string): string {
  const m = parseInt(d.slice(5, 7), 10) - 1;
  const y = d.slice(0, 4);
  return `${MONTHS[m]} ${y}`;
}

// ─── PlayerCard ─────────────────────────────────────────────────────────────────

function PlayerCard({
  row,
  unitMode = "share",
}: {
  row: TopPlayerRow;
  unitMode?: UnitMode;
}) {
  const deltaSign = row.deltaMoM !== null ? (row.deltaMoM > 0 ? "+" : "") : "";
  const deltaColor =
    row.deltaMoM === null
      ? "var(--mobile-text-faint)"
      : row.deltaMoM > 0
        ? "var(--mobile-up)"
        : "var(--mobile-down)";
  const valueLabel =
    unitMode === "share" ? `${row.pct.toFixed(1)}%` : row.pct.toFixed(1);
  const deltaUnit = unitMode === "share" ? "pp" : "k m³";

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
          background: row.isLeader
            ? "var(--mobile-accent)"
            : "var(--mobile-divider)",
          color: row.isLeader ? "#fff" : "var(--mobile-text-muted)",
          fontSize: 13,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: row.isLeader
            ? "0 2px 6px rgba(255,80,0,0.30)"
            : "none",
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

      {/* Value */}
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
        {valueLabel}
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
            background: row.isLeader
              ? "var(--mobile-accent)"
              : "var(--mobile-text-faint)",
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
          : `${deltaSign}${row.deltaMoM.toFixed(1)} ${deltaUnit}`}
      </div>
    </div>
  );
}

// ─── CompareMetric (inline cell) ────────────────────────────────────────────────

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

// ─── CompareRowCard ──────────────────────────────────────────────────────────────

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

// ─── CheckPills (filter drawer) ──────────────────────────────────────────────────

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
            background: isOn(opt)
              ? "var(--mobile-accent)"
              : "var(--mobile-surface)",
            color: isOn(opt) ? "#fff" : "var(--mobile-text)",
            fontFamily: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: isOn(opt)
              ? "0 2px 6px rgba(255,80,0,0.25)"
              : "none",
            transition:
              "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── ActiveChipRow ───────────────────────────────────────────────────────────────
// Sticky chip row below title block: Period info chip + Region/UF active chips
// + "+ Filters" trigger. The SegmentedToggle (unit) is pinned ABOVE this row.

function ActiveChipRow({
  regioes,
  ufs,
  latestDate,
  onOpenFilters,
  onRemoveRegiao,
  onRemoveUf,
}: {
  regioes: string[];
  ufs: string[];
  latestDate: string | null;
  onOpenFilters: () => void;
  onRemoveRegiao: (r: string) => void;
  onRemoveUf: (u: string) => void;
}) {
  const X = <CloseIcon size={10} strokeWidth={2.5} />;

  const periodLabel = latestDate ? `to ${fmtDate(latestDate)}` : null;

  const chipStyle: React.CSSProperties = {
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
    whiteSpace: "nowrap" as const,
    cursor: "pointer",
    fontFamily: "Arial, Helvetica, sans-serif",
  };

  const removeBtn = (onRemove: () => void) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
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

  const hasDynamicChips = regioes.length > 0 || ufs.length > 0;

  return (
    <nav
      aria-label="Active filters"
      style={{
        height: 52,
        background: "var(--mobile-bg)",
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        overflowY: "hidden",
        gap: 8,
        padding: "0 16px",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        borderBottom: hasDynamicChips
          ? "1px solid var(--mobile-divider)"
          : "none",
      }}
    >
      {/* Period chip (info-only, no remove) */}
      {periodLabel && (
        <div
          style={{
            ...chipStyle,
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
        <div key={r} style={chipStyle}>
          {r}
          {removeBtn(() => onRemoveRegiao(r))}
        </div>
      ))}

      {/* UF chips */}
      {ufs.map((u) => (
        <div key={u} style={chipStyle}>
          {u}
          {removeBtn(() => onRemoveUf(u))}
        </div>
      ))}

      {/* + Filters trigger */}
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

// ─── Mobile View ──────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard(
    "market-share",
  );

  const ms = useMarketShareData();

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Drawer-local filter state (committed to hook on Apply)
  const [drawerRegioes, setDrawerRegioes] = useState<string[]>([]);
  const [drawerMode, setDrawerMode] = useState<string>("Individual");
  const [drawerUfs, setDrawerUfs] = useState<string[]>([]);

  // Active chip state (reflects last Apply) for Region / UF only
  const [chipRegioes, setChipRegioes] = useState<string[]>([]);
  const [chipUfs, setChipUfs] = useState<string[]>([]);

  const openDrawer = () => {
    setDrawerRegioes([...chipRegioes]);
    setDrawerMode(ms.mode);
    setDrawerUfs([...chipUfs]);
    setDrawerOpen(true);
  };

  const handleDrawerApply = () => {
    setChipRegioes([...drawerRegioes]);
    setChipUfs([...drawerUfs]);
    ms.setMode(drawerMode as typeof ms.mode);
    ms.setRegioesSelected(drawerRegioes);
    ms.setUfsSelected(drawerUfs);
    ms.applyFilters();
    setDrawerOpen(false);
  };

  const handleDrawerReset = () => {
    setDrawerRegioes([]);
    setDrawerMode("Individual");
    setDrawerUfs([]);
  };

  // Hero chart traces for the active (product × segment)
  const heroTraces = useMemo<PlotData[]>(() => {
    if (ms.seriesLoading || ms.serieRows.length === 0) return [];
    const productRows =
      ms.selectedProduct === "Otto-Cycle"
        ? ms.ottoCycleRows
        : ms.serieRows;
    const players = ms.big3 ? ALL_PLAYERS_BIG3 : ALL_PLAYERS_IND;
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

  const fmtLabel = (d: string) => {
    try {
      return `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]}, ${d.slice(0, 4)}`;
    } catch {
      return d;
    }
  };

  if (visLoading || !visible) return <></>;

  // Period badge text (based on slider range)
  const periodBadge = (() => {
    if (ms.datas.length === 0) return null;
    const [a, b] = ms.sliderRange;
    const start = ms.datas[a];
    const end = ms.datas[b];
    if (!start || !end) return null;
    return `${fmtDate(start)} – ${fmtDate(end)}`;
  })();

  // Chart heading label
  const chartHeading = `${PRODUCT_LABEL[ms.selectedProduct]} — ${ms.selectedSegment}`;

  // Legend entries for the hero chart
  const legendEntries = ms.topPlayersForSelected.map((p, i) => ({
    name: p.player,
    color:
      p.color ??
      ms.chartColors[p.player] ??
      MOBILE_PALETTE[i % MOBILE_PALETTE.length],
    isLeader: p.isLeader,
  }));

  // Comparison rows for the active chart variant
  const visibleCompRows = ms.activeCompRows.filter((r) =>
    ms.compareSet.includes(r.player),
  );

  // Product / segment tab definitions
  const productTabs = PRODUCT_KEYS.map((p) => ({
    key: p,
    label: PRODUCT_LABEL[p],
  }));
  const segmentTabs = SEGMENTS_BY_PRODUCT[ms.selectedProduct].map((s) => ({
    key: s,
    label: s,
  }));

  return (
    <div
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        // Bottom padding: Home pill (56px) + 24px gap + safe-area
        paddingBottom: "calc(80px + var(--mobile-safe-bottom))",
        position: "relative",
      }}
    >
      {/* ── Title block ─────────────────────────────────────────────────────── */}
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

      {/* ── 1. Sticky SegmentedToggle (% Share / Volume) ─────────────────────
            Sits above everything else as the top-level unit switch.
            Sticky top accounts for the MobileTopBar height (56px). */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 25,
          background: "var(--mobile-glass-bg)",
          WebkitBackdropFilter: "var(--mobile-glass-blur)",
          backdropFilter: "var(--mobile-glass-blur)",
          borderBottom: "1px solid var(--mobile-glass-border)",
          padding: "8px 16px",
        }}
      >
        <SegmentedToggle
          options={UNIT_OPTIONS}
          value={ms.unitMode}
          onChange={ms.setUnitMode}
          variant="full"
          fontSize={13}
        />
      </div>

      {/* ── 2. Product MobileTabBar ──────────────────────────────────────────── */}
      <div style={{ padding: "12px 0 4px" }}>
        <MobileTabBar
          tabs={productTabs}
          activeKey={ms.selectedProduct}
          onChange={(k) => ms.setSelectedProduct(k as ProductKey)}
          variant="container"
          ariaLabel="Product"
        />
      </div>

      {/* ── 3. Segment MobileTabBar ──────────────────────────────────────────── */}
      <div style={{ padding: "0 0 4px" }}>
        <MobileTabBar
          tabs={segmentTabs}
          activeKey={ms.selectedSegment}
          onChange={(k) => ms.setSelectedSegment(k as SegmentKey)}
          variant="underline"
          ariaLabel="Segment"
        />
      </div>

      {/* ── 4. Hero chart card ───────────────────────────────────────────────── */}
      {ms.seriesLoading ? (
        <div style={{ padding: "24px 16px" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <div style={{ padding: "16px 16px 0" }}>
          <div
            style={{
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {/* Chart header */}
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
                  yaxis:
                    ms.unitMode === "share"
                      ? { ticksuffix: "%", range: [0, 100] }
                      : { title: { text: "thousand m³" } },
                  xaxis: {
                    type: "date" as const,
                    tickformat: "%b %y",
                    nticks: 6,
                  },
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
                      color: e.isLeader
                        ? "var(--mobile-text)"
                        : "var(--mobile-text-muted)",
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
      )}

      {/* ── 5. Top Distributors list ─────────────────────────────────────────── */}
      <div style={{ padding: "20px 16px 0" }}>
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
          {ms.latestDate && (
            <span
              style={{
                fontSize: 12,
                color: "var(--mobile-text-muted)",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              {fmtDate(ms.latestDate)}
            </span>
          )}
        </div>

        {ms.topPlayersForSelected.length > 0 ? (
          <div
            style={{
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {ms.topPlayersForSelected.map((row) => (
              <PlayerCard key={row.player} row={row} unitMode={ms.unitMode} />
            ))}
          </div>
        ) : (
          !ms.seriesLoading && (
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
          )
        )}
      </div>

      {/* ── 6. Comparison table (inline, always visible) ─────────────────────
            Replaces the old Compare tab. Players from compareSet (seeded with
            top-3 on data load) are shown side-by-side.
            The player picker pills below let the user swap the comparison set. */}
      {ms.activeCompRows.length > 0 && (
        <div style={{ padding: "20px 16px 0" }}>
          {/* Section header */}
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
              Comparison
            </h2>
            <span
              style={{
                fontSize: 12,
                color: "var(--mobile-text-muted)",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              {ms.unitMode === "share"
                ? "p.p. variation"
                : "thousand m³ variation"}
            </span>
          </div>

          {/* Context label */}
          <div
            style={{
              fontSize: 13,
              color: "var(--mobile-text-muted)",
              fontFamily: "Arial, Helvetica, sans-serif",
              marginBottom: 10,
            }}
          >
            {PRODUCT_LABEL[ms.selectedProduct]} — {ms.selectedSegment}
          </div>

          {/* Player picker pills (pick up to 3 for side-by-side) */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 12,
            }}
          >
            {ms.activeCompRows.map((r) => {
              const on = ms.compareSet.includes(r.player);
              const disabled = !on && ms.compareSet.length >= 3;
              return (
                <button
                  key={r.player}
                  type="button"
                  onClick={() => ms.toggleCompareMember(r.player)}
                  disabled={disabled}
                  style={{
                    minHeight: 32,
                    padding: "0 12px",
                    borderRadius: 999,
                    border: `1px solid ${on ? "var(--mobile-accent)" : "var(--mobile-border)"}`,
                    background: on
                      ? "var(--mobile-accent)"
                      : "var(--mobile-surface)",
                    color: on ? "#fff" : "var(--mobile-text)",
                    opacity: disabled ? 0.4 : 1,
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: disabled ? "not-allowed" : "pointer",
                    boxShadow: on
                      ? "0 2px 6px rgba(255,80,0,0.25)"
                      : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  {r.player}
                </button>
              );
            })}
          </div>

          {/* Comparison cards */}
          {visibleCompRows.length === 0 ? (
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
              Select up to 3 distributors above to compare their variation.
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
              {visibleCompRows.map((row, idx) => (
                <CompareRowCard
                  key={row.player}
                  row={row}
                  color={
                    ms.chartColors[row.player] ??
                    MOBILE_PALETTE[idx % MOBILE_PALETTE.length]
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 7. Filter chip row (Period / Region / UF / "+ Filters") ─────────── */}
      <div style={{ paddingTop: 16 }}>
        <ActiveChipRow
          regioes={chipRegioes}
          ufs={chipUfs}
          latestDate={ms.latestDate}
          onOpenFilters={openDrawer}
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
      </div>

      {/* ── FilterDrawer ────────────────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={handleDrawerReset}
        onApply={handleDrawerApply}
        applyLabel="Apply filters"
        resetLabel="Reset"
      >
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
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-faint)",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                {drawerRegioes.length > 0
                  ? `${drawerRegioes.length} of ${ms.regioesAll.length}`
                  : "All"}
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
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--mobile-text-faint)",
                  textTransform: "none",
                  letterSpacing: 0,
                }}
              >
                {drawerUfs.length > 0
                  ? `${drawerUfs.length} selected`
                  : "All"}
              </span>
            </div>
            <CheckPills
              options={ms.ufsAll}
              value={drawerUfs}
              onChange={(v) => setDrawerUfs(v as string[])}
            />
          </div>
        )}

        {/* View Mode */}
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

    </div>
  );
}

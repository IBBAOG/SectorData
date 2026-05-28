"use client";

/**
 * Mobile view — Diesel & Gasoline Margins (v2, Wave 3 reform).
 *
 * Layout (top → bottom):
 *   Sticky header  — MobileTopBar (global shell renders this; nothing extra here)
 *   Sticky sub-bar — Tab: Diesel B / Gasoline C  +  FilterChip (Period)
 *   Latest week badge
 *   Stacked area chart hero (MobileChart, height 260)
 *   KPI delta block — current vs prior week, horizontal cards
 *   Comparison table — all components with WoW/−4W/QTD/YoY deltas, horizontal scroll
 *
 * Non-negotiables (§ 3.4 + task spec):
 *   - NO ExportFAB / ExportModal
 *   - NO MobileBottomTabBar
 *   - NO NavBar / own MobileTopBar (MobileLayout provides those)
 *   - NO useIsMobile() inside this View (already mobile)
 *   - Light-only
 *
 * Sync rule: changes here must land in desktop/View.tsx in the same commit,
 * or commit must declare [mobile-only].
 */

import React, { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  CalendarIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";

import {
  useDieselGasolineMarginsData,
  type DgMarginsRow,
  STACK_COLORS,
  STACK_COMPONENTS,
  TABLE_KEYS,
  parseWeek,
  weekLastDay,
  weekLastDayShort,
  compLabel,
} from "../useDieselGasolineMarginsData";

// rc-slider — only used inside the filter drawer
import Slider from "rc-slider";
import "rc-slider/assets/index.css";

// ── Chart builder ─────────────────────────────────────────────────────────────

function buildMobileStackedChart(
  rows: DgMarginsRow[],
  fuelType: string,
  orderedWeeks: string[],
): PlotData[] {
  const fuelRows = [...rows.filter((r) => r.fuel_type === fuelType)].sort(
    (a, b) => orderedWeeks.indexOf(a.week) - orderedWeeks.indexOf(b.week),
  );
  if (fuelRows.length === 0) return [];

  const xWeeks = fuelRows.map((r) => weekLastDayShort(r.week));

  return STACK_COMPONENTS.map((comp) => ({
    type: "scatter",
    mode: "lines",
    name: compLabel(comp.key as string, fuelType),
    x: xWeeks,
    y: fuelRows.map((r) => Number(r[comp.key] ?? 0)),
    stackgroup: "one",
    line:      { width: 0.5, color: STACK_COLORS[comp.key as string] },
    fillcolor: STACK_COLORS[comp.key as string],
    hovertemplate: `%{y:.2f} BRL/L<extra>${compLabel(comp.key as string, fuelType)}</extra>`,
  } as PlotData));
}

// ── KPI delta helpers ─────────────────────────────────────────────────────────

interface KpiCard {
  key: keyof DgMarginsRow;
  label: string;
  value: number;
  delta: number | null;
  deltaPct: number | null;
}

function buildKpiDelta(
  allRows: DgMarginsRow[],
  fuelType: string,
  latestWeek: string | null,
  allWeeks: string[],
): KpiCard[] {
  if (!latestWeek) return [];
  const byWeek = new Map(
    allRows.filter((r) => r.fuel_type === fuelType).map((r) => [r.week, r]),
  );
  const latest = byWeek.get(latestWeek);
  if (!latest) return [];
  const latestIdx = allWeeks.indexOf(latestWeek);
  const prev = byWeek.get(allWeeks[latestIdx - 1] ?? "") ?? null;

  return TABLE_KEYS.map((key) => {
    const value = Number(latest[key] ?? 0);
    let delta: number | null = null;
    let deltaPct: number | null = null;
    if (prev) {
      const vPrev = Number(prev[key] ?? 0);
      delta = value - vPrev;
      deltaPct = vPrev !== 0 ? (delta / Math.abs(vPrev)) * 100 : null;
    }
    return {
      key,
      label: key === "total" ? "Total" : compLabel(key as string, fuelType),
      value,
      delta,
      deltaPct,
    };
  });
}

// ── Comparison table ──────────────────────────────────────────────────────────

interface CompRow {
  key: keyof DgMarginsRow;
  label: string;
  current: number;
  wow: { abs: number | null; pct: number | null };
  prev4: { abs: number | null; pct: number | null };
  qtd: { abs: number | null; pct: number | null };
  yoy: { abs: number | null; pct: number | null };
}

function buildComparisonRows(
  allRows: DgMarginsRow[],
  fuelType: string,
  latestWeek: string | null,
  allWeeks: string[],
): CompRow[] {
  if (!latestWeek) return [];
  const byWeek = new Map(
    allRows.filter((r) => r.fuel_type === fuelType).map((r) => [r.week, r]),
  );
  const latest = byWeek.get(latestWeek);
  if (!latest) return [];

  const latestIdx = allWeeks.indexOf(latestWeek);
  const prev1     = byWeek.get(allWeeks[latestIdx - 1] ?? "") ?? null;
  const prev4     = byWeek.get(allWeeks[latestIdx - 4] ?? "") ?? null;

  // QTD: first week of current quarter
  let qtdRow: DgMarginsRow | null = null;
  const latestParsed = parseWeek(latestWeek);
  if (latestParsed) {
    const { weekNum, year } = latestParsed;
    const jan4 = new Date(year, 0, 4);
    const dow  = jan4.getDay() || 7;
    const w1Mon = new Date(year, 0, 4 - dow + 1);
    const wkStart = new Date(w1Mon);
    wkStart.setDate(w1Mon.getDate() + (weekNum - 1) * 7);
    const qStartMonth = Math.floor(wkStart.getMonth() / 3) * 3;
    const quarterStart = new Date(year, qStartMonth, 1);
    for (const w of allWeeks) {
      const p = parseWeek(w);
      if (!p || p.year !== year) continue;
      const j4 = new Date(p.year, 0, 4);
      const d  = j4.getDay() || 7;
      const wm = new Date(p.year, 0, 4 - d + 1);
      const ws = new Date(wm);
      ws.setDate(wm.getDate() + (p.weekNum - 1) * 7);
      if (ws >= quarterStart) {
        const row = byWeek.get(w);
        if (row) { qtdRow = row; break; }
      }
    }
  }

  // YoY: same week number, prior year
  let yoyRow: DgMarginsRow | null = null;
  if (latestParsed) {
    const { weekNum, year } = latestParsed;
    yoyRow = byWeek.get(`${weekNum}/${year - 1}`) ?? null;
  }

  const diff = (a: DgMarginsRow | null, b: DgMarginsRow | null, key: keyof DgMarginsRow) => {
    if (!a || !b) return { abs: null as number | null, pct: null as number | null };
    const va = Number(a[key]);
    const vb = Number(b[key]);
    if (isNaN(va) || isNaN(vb)) return { abs: null as number | null, pct: null as number | null };
    const abs = va - vb;
    const pct = vb !== 0 ? (abs / Math.abs(vb)) * 100 : null;
    return { abs, pct };
  };

  return TABLE_KEYS.map((key) => ({
    key,
    label: key === "total" ? "Total" : compLabel(key as string, fuelType),
    current: Number(latest[key] ?? 0),
    wow:  diff(latest, prev1,  key),
    prev4: diff(latest, prev4,  key),
    qtd:  diff(latest, qtdRow, key),
    yoy:  diff(latest, yoyRow, key),
  }));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterChip({
  weeks,
  weekRange,
  onOpen,
}: {
  weeks: string[];
  weekRange: [number, number];
  onOpen: () => void;
}) {
  const startW = weeks[weekRange[0]];
  const endW   = weeks[weekRange[1]];
  const label  = startW && endW
    ? startW === endW
      ? weekLastDayShort(startW)
      : `${weekLastDayShort(startW)} → ${weekLastDayShort(endW)}`
    : "All weeks";

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display:      "inline-flex",
        alignItems:   "center",
        gap:          6,
        height:       36,
        padding:      "0 14px",
        borderRadius: 999,
        border:       "1.5px solid var(--mobile-accent, #ff5000)",
        background:   "var(--mobile-accent-fill, rgba(255,80,0,0.08))",
        color:        "var(--mobile-accent, #ff5000)",
        fontFamily:   "Arial, Helvetica, sans-serif",
        fontSize:     13,
        fontWeight:   600,
        cursor:       "pointer",
        whiteSpace:   "nowrap",
        minHeight:    44,
      }}
    >
      <CalendarIcon size={14} strokeWidth={2.2} />
      {label}
    </button>
  );
}

function FuelTab({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (fuel: string) => void;
}) {
  const fuels = ["Diesel B", "Gasoline C"];
  return (
    <div
      role="tablist"
      aria-label="Fuel type"
      style={{
        display:      "flex",
        background:   "var(--mobile-surface-2, #fafafc)",
        border:       "1px solid var(--mobile-border, #e6e6ec)",
        borderRadius: 12,
        padding:      3,
        gap:          2,
      }}
    >
      {fuels.map((fuel) => {
        const active = selected === fuel;
        return (
          <button
            key={fuel}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(fuel)}
            style={{
              minHeight:    44,
              padding:      "0 18px",
              borderRadius: 9,
              border:       0,
              background:   active ? "var(--mobile-accent, #ff5000)" : "transparent",
              color:        active ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
              fontFamily:   "Arial, Helvetica, sans-serif",
              fontSize:     14,
              fontWeight:   active ? 700 : 500,
              cursor:       "pointer",
              transition:   "background 0.15s ease, color 0.15s ease",
              whiteSpace:   "nowrap",
            }}
          >
            {fuel}
          </button>
        );
      })}
    </div>
  );
}

function DrawerWeekSlider({
  weeks,
  value,
  onChange,
}: {
  weeks: string[];
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const marks = useMemo(() => {
    type Mark = { label: string; style: { fontSize: string; color: string } };
    const m: Record<number, Mark> = {};
    const seen = new Set<string>();
    weeks.forEach((w, i) => {
      const p = parseWeek(w);
      if (!p) return;
      const yr = String(p.year);
      if (!seen.has(yr)) {
        m[i] = { label: yr, style: { fontSize: "11px", color: "#888" } };
        seen.add(yr);
      }
    });
    return m;
  }, [weeks]);

  if (weeks.length === 0) return null;

  return (
    <div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 12, color: "var(--mobile-text-muted, #6b6b73)",
        fontFamily: "Arial", marginBottom: 4,
      }}>
        <span>{weeks[value[0]] ? weekLastDayShort(weeks[value[0]]) : ""}</span>
        <span>{weeks[value[1]] ? weekLastDayShort(weeks[value[1]]) : ""}</span>
      </div>
      <div style={{ padding: "0 8px", marginBottom: 20 }}>
        <Slider
          range
          min={0}
          max={weeks.length - 1}
          value={value}
          step={1}
          marks={marks}
          onChange={(v) => {
            const arr = Array.isArray(v) ? v : [value[0], value[1]];
            onChange([arr[0] as number, arr[1] as number]);
          }}
        />
      </div>
    </div>
  );
}

// ── KPI delta card ────────────────────────────────────────────────────────────

function KpiDeltaCard({ card }: { card: KpiCard }) {
  const isPos  = (card.delta ?? 0) > 0;
  const isNeg  = (card.delta ?? 0) < 0;
  const deltaColor = isPos ? "#15803d" : isNeg ? "#b91c1c" : "var(--mobile-text-muted, #6b6b73)";
  const deltaBg    = isPos ? "rgba(21,128,61,0.09)" : isNeg ? "rgba(185,28,28,0.09)" : "transparent";
  const isTotal    = card.key === "total";

  return (
    <div style={{
      flex:         "0 0 auto",
      minWidth:     120,
      background:   "var(--mobile-surface, #ffffff)",
      border:       "1px solid var(--mobile-border, #e6e6ec)",
      borderRadius: 12,
      padding:      "10px 14px",
      display:      "flex",
      flexDirection: "column",
      gap:           4,
      borderLeft:   isTotal ? "3px solid var(--mobile-accent, #ff5000)" : `3px solid ${STACK_COLORS[String(card.key)] ?? "#e6e6ec"}`,
    }}>
      <div style={{
        fontSize:    11,
        fontWeight:  600,
        color:       "var(--mobile-text-muted, #6b6b73)",
        fontFamily:  "Arial",
        whiteSpace:  "nowrap",
        overflow:    "hidden",
        textOverflow: "ellipsis",
      }}>
        {card.label}
      </div>
      <div style={{
        fontSize:           18,
        fontWeight:         700,
        color:              isTotal ? "var(--mobile-accent, #ff5000)" : "var(--mobile-text, #1a1a1a)",
        fontFamily:         "Arial",
        fontVariantNumeric: "tabular-nums",
      }}>
        {card.value.toFixed(2)}
        <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3 }}>BRL/L</span>
      </div>
      {card.delta !== null && (
        <div style={{
          display:      "inline-flex",
          alignItems:   "center",
          gap:           4,
          fontSize:      11,
          fontWeight:    600,
          color:         deltaColor,
          background:    deltaBg,
          borderRadius:  6,
          padding:       "2px 6px",
          alignSelf:    "flex-start",
          fontFamily:   "Arial",
          fontVariantNumeric: "tabular-nums",
        }}>
          {card.delta > 0 ? "▲" : card.delta < 0 ? "▼" : "●"}
          {" "}
          {(card.delta > 0 ? "+" : "") + card.delta.toFixed(2)}
          {card.deltaPct !== null && (
            <span style={{ fontWeight: 400, opacity: 0.8 }}>
              {" "}({card.deltaPct > 0 ? "+" : ""}{card.deltaPct.toFixed(1)}%)
            </span>
          )}
        </div>
      )}
      {card.delta === null && (
        <div style={{ fontSize: 11, color: "#bbb", fontFamily: "Arial" }}>WoW —</div>
      )}
    </div>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────

function ComparisonTable({
  rows,
  latestWeek,
  fuelType,
}: {
  rows: CompRow[];
  latestWeek: string | null;
  fuelType: string;
}) {
  if (rows.length === 0 || !latestWeek) return null;

  const fmtAbs = (v: number | null) =>
    v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(2);
  const fmtPct = (v: number | null) =>
    v === null ? "" : (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  const cellBg = (v: number | null) =>
    v === null ? "transparent" : v > 0 ? "rgba(21,128,61,0.10)" : v < 0 ? "rgba(185,28,28,0.10)" : "transparent";

  const thStyle: React.CSSProperties = {
    fontFamily:      "Arial",
    fontSize:        10,
    fontWeight:      700,
    color:           "#ffffff",
    backgroundColor: "#000512",
    textAlign:       "center",
    padding:         "5px 8px",
    border:          "none",
    whiteSpace:      "nowrap",
    position:        "sticky",
    top:             0,
  };
  const thLeft: React.CSSProperties = {
    ...thStyle,
    textAlign: "left",
    position:  "sticky",
    left:      0,
    zIndex:    2,
    minWidth:  130,
  };
  const tdStyle: React.CSSProperties = {
    textAlign:          "center",
    padding:            "4px 8px",
    fontSize:           10,
    fontFamily:         "Arial",
    color:              "#1a1a1a",
    whiteSpace:         "nowrap",
    border:             "none",
    lineHeight:         1.3,
    fontVariantNumeric: "tabular-nums",
  };
  const tdLeft: React.CSSProperties = {
    fontFamily:  "Arial",
    fontSize:    11,
    color:       "#1a1a1a",
    whiteSpace:  "nowrap",
    padding:     "4px 12px 4px 8px",
    border:      "none",
    position:    "sticky",
    left:        0,
    background:  "var(--mobile-surface, #ffffff)",
    zIndex:      1,
  };

  const COLS = [
    { label: "WoW",      getter: (r: CompRow) => r.wow  },
    { label: "−4 Wks",  getter: (r: CompRow) => r.prev4 },
    { label: "QTD",     getter: (r: CompRow) => r.qtd  },
    { label: "YoY",     getter: (r: CompRow) => r.yoy  },
  ];

  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{
        borderCollapse: "collapse",
        minWidth: "100%",
        tableLayout: "auto",
      }}>
        <thead>
          <tr>
            <th style={thLeft}>
              {fuelType} · {weekLastDay(latestWeek)}
            </th>
            <th style={thStyle}>BRL/L</th>
            {COLS.map((c) => (
              <th key={c.label} style={thStyle}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isTotal = row.key === "total";
            const rowStyle: React.CSSProperties = i === rows.length - 1
              ? { borderBottom: "2px solid #d0d0d0" }
              : {};
            return (
              <tr key={String(row.key)} style={rowStyle}>
                <td style={{
                  ...tdLeft,
                  fontWeight: isTotal ? 700 : 400,
                }}>
                  {row.label}
                </td>
                <td style={{ ...tdStyle, fontWeight: isTotal ? 700 : 400, fontSize: 11 }}>
                  {row.current.toFixed(2)}
                </td>
                {COLS.map(({ label, getter }) => {
                  const { abs, pct } = getter(row);
                  return (
                    <td key={label} style={{
                      ...tdStyle,
                      backgroundColor: cellBg(abs),
                      color: abs === null ? "#bbb" : "#1a1a1a",
                      fontWeight: isTotal ? 700 : 400,
                    }}>
                      {fmtAbs(abs)}
                      {abs !== null && pct !== null && (
                        <div style={{ fontSize: 8.5, color: "#666", lineHeight: 1.2 }}>
                          {fmtPct(pct)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding:         "12px 16px 6px",
      fontSize:        11,
      fontWeight:      700,
      color:           "var(--mobile-text-muted, #6b6b73)",
      textTransform:   "uppercase",
      letterSpacing:   "0.06em",
      fontFamily:      "Arial",
    }}>
      {children}
    </div>
  );
}

// ── Mobile View ───────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("diesel-gasoline-margins");

  const {
    allRows,
    filteredRows,
    weeks,
    weekRange,
    setWeekRange,
    visibleWeeks,
    latestVisibleWeek,
    loading,
  } = useDieselGasolineMarginsData();

  // Local state
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [draftRange, setDraftRange]     = useState<[number, number]>(weekRange);
  const [selectedFuel, setSelectedFuel] = useState<string>("Diesel B");

  const openDrawer = () => {
    setDraftRange(weekRange);
    setDrawerOpen(true);
  };
  const applyDrawer = () => {
    setWeekRange(draftRange);
    setDrawerOpen(false);
  };
  const resetDrawer = () => {
    setDraftRange([0, Math.max(0, weeks.length - 1)]);
  };

  // Chart
  const chartTraces = useMemo(
    () => buildMobileStackedChart(filteredRows, selectedFuel, visibleWeeks),
    [filteredRows, selectedFuel, visibleWeeks],
  );

  // KPI delta (current week vs prior)
  const kpiCards = useMemo(
    () => buildKpiDelta(allRows, selectedFuel, latestVisibleWeek, weeks),
    [allRows, selectedFuel, latestVisibleWeek, weeks],
  );

  // Comparison table rows
  const compRows = useMemo(
    () => buildComparisonRows(allRows, selectedFuel, latestVisibleWeek, weeks),
    [allRows, selectedFuel, latestVisibleWeek, weeks],
  );

  if (visLoading || !visible) return <></>;

  return (
    <div style={{
      minHeight:   "100dvh",
      background:  "var(--mobile-bg, #f5f5f7)",
      paddingBottom: 32,
      fontFamily:  "Arial, Helvetica, sans-serif",
    }}>
      {/* ── Top sticky bar: fuel tabs + period filter chip ── */}
      <div style={{
        position:   "sticky",
        top:        0,
        zIndex:     20,
        background: "var(--mobile-surface, #ffffff)",
        borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
        padding:    "8px 16px",
        display:    "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap:        12,
      }}>
        <FuelTab selected={selectedFuel} onChange={setSelectedFuel} />
        <FilterChip weeks={weeks} weekRange={weekRange} onOpen={openDrawer} />
      </div>

      {loading ? (
        <div style={{ padding: 32, display: "flex", justifyContent: "center" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* Latest week badge */}
          {latestVisibleWeek && (
            <div style={{
              padding:    "10px 16px 0",
              textAlign:  "center",
              fontSize:   12,
              color:      "var(--mobile-text-muted, #6b6b73)",
            }}>
              Latest:{" "}
              <strong style={{ color: "var(--mobile-accent, #ff5000)" }}>
                {weekLastDay(latestVisibleWeek)}
              </strong>
            </div>
          )}

          {/* ── Stacked area chart hero ── */}
          <div style={{
            margin:       "12px 0 0",
            background:   "var(--mobile-surface, #ffffff)",
            borderTop:    "1px solid var(--mobile-border, #e6e6ec)",
            borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
          }}>
            <div style={{
              padding:    "10px 16px 4px",
              fontSize:   13,
              fontWeight: 600,
              color:      "var(--mobile-text, #1a1a1a)",
            }}>
              {selectedFuel} — Price Composition
            </div>
            {chartTraces.length > 0 ? (
              <MobileChart
                data={chartTraces}
                height={260}
                layout={{
                  hovermode: "x unified",
                  showlegend: true,
                  legend: {
                    orientation: "h",
                    x: 0, y: -0.22,
                    font: { size: 9 },
                  },
                  xaxis: {
                    type: "category",
                    categoryorder: "array",
                    categoryarray: visibleWeeks.map(weekLastDayShort),
                    nticks: 6,
                    tickangle: -45,
                    tickfont: { size: 9 },
                    fixedrange: true,
                  },
                  yaxis: {
                    tickformat: ".2f",
                    tickfont: { size: 9 },
                    fixedrange: true,
                    nticks: 4,
                  },
                  margin: { l: 44, r: 12, t: 8, b: 52 },
                }}
                style={{ padding: "0 8px 16px" }}
              />
            ) : (
              <div style={{
                height: 160, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 13,
                color: "var(--mobile-text-muted, #6b6b73)",
              }}>
                No data for selected period
              </div>
            )}
          </div>

          {/* ── KPI delta block ── */}
          {kpiCards.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <SectionLabel>
                Current Week vs Prior Week
              </SectionLabel>
              <div style={{
                overflowX:              "auto",
                WebkitOverflowScrolling: "touch",
                display:                "flex",
                gap:                    10,
                padding:                "0 16px 4px",
              }}>
                {kpiCards.map((card) => (
                  <KpiDeltaCard key={String(card.key)} card={card} />
                ))}
              </div>
            </div>
          )}

          {/* ── Comparison table ── */}
          {compRows.length > 0 && (
            <div style={{
              marginTop:    16,
              background:   "var(--mobile-surface, #ffffff)",
              borderTop:    "1px solid var(--mobile-border, #e6e6ec)",
              borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
            }}>
              <SectionLabel>
                Variation Table — {latestVisibleWeek ? weekLastDay(latestVisibleWeek) : ""}
              </SectionLabel>
              <ComparisonTable
                rows={compRows}
                latestWeek={latestVisibleWeek}
                fuelType={selectedFuel}
              />
            </div>
          )}
        </>
      )}

      {/* ── Filter drawer ── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={resetDrawer}
        onApply={applyDrawer}
        applyLabel="Apply"
        resetLabel="Reset"
      >
        <div style={{ paddingBottom: 8 }}>
          <div style={{
            fontSize:    13,
            fontWeight:  700,
            color:       "var(--mobile-text, #1a1a1a)",
            marginBottom: 16,
            fontFamily:  "Arial",
          }}>
            Period
          </div>
          <DrawerWeekSlider
            weeks={weeks}
            value={draftRange}
            onChange={setDraftRange}
          />
          {weeks.length > 0 && (
            <div style={{
              marginTop:  4,
              padding:    "8px 12px",
              background: "var(--mobile-surface-2, #fafafc)",
              borderRadius: 10,
              fontSize:   12,
              color:      "var(--mobile-text-muted, #6b6b73)",
              fontFamily: "Arial",
              lineHeight: 1.5,
            }}>
              <strong style={{ color: "var(--mobile-accent, #ff5000)" }}>
                {weeks[draftRange[0]] ? weekLastDayShort(weeks[draftRange[0]]) : ""}
              </strong>
              {" → "}
              <strong style={{ color: "var(--mobile-accent, #ff5000)" }}>
                {weeks[draftRange[1]] ? weekLastDayShort(weeks[draftRange[1]]) : ""}
              </strong>
              <span style={{ marginLeft: 4 }}>
                ({draftRange[1] - draftRange[0] + 1} week
                {draftRange[1] - draftRange[0] !== 0 ? "s" : ""})
              </span>
            </div>
          )}
        </div>
      </FilterDrawer>

      {/* MobileTopBar is rendered by the global MobileLayout — not here */}
    </div>
  );
}

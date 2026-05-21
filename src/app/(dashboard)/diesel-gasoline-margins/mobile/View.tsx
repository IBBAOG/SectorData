"use client";

/**
 * Mobile view — Diesel & Gasoline Margins.
 *
 * Archetype: chart-heavy + filter sheet (mirrors market-share-mobile.html).
 *
 * Layout (top → bottom):
 *   MobileTopBar  — title + filter trigger button
 *   Fuel-type segmented toggle (Diesel B / Gasoline C)
 *   MobileChart   — stacked area showing margin composition for selected fuel
 *   Component breakdown cards (MobileDataCard — one per margin component)
 *   ExportFAB     — Tier 1 direct download (expanded pill with label)
 *   FilterDrawer  — week-range slider inside BottomSheet
 *
 * Binding sync rule: any new filter / chart / KPI added here must also land in
 * desktop/View.tsx in the same commit, OR the commit must declare [mobile-only].
 */

import React, { useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  CalendarIcon,
  FileLinesIcon,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";

import { downloadDgMarginsExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";

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

// ── Slider (inline — rc-slider only for filter drawer) ────────────────────────
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

// ── Component breakdown helper ────────────────────────────────────────────────

function getLatestComponentBreakdown(
  allRows: DgMarginsRow[],
  fuelType: string,
  latestWeek: string | null,
): { key: keyof DgMarginsRow; label: string; value: number; pct: number }[] {
  if (!latestWeek) return [];
  const row = allRows.find((r) => r.fuel_type === fuelType && r.week === latestWeek);
  if (!row) return [];
  const total = Number(row.total) || 1;
  return TABLE_KEYS.filter((k) => k !== "total").map((key) => ({
    key,
    label: compLabel(key as string, fuelType),
    value: Number(row[key] ?? 0),
    pct: (Number(row[key] ?? 0) / total) * 100,
  }));
}

// ── Filter trigger button ─────────────────────────────────────────────────────

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
        display:     "inline-flex",
        alignItems:  "center",
        gap:         6,
        height:      36,
        padding:     "0 14px",
        borderRadius: 999,
        border:      "1.5px solid var(--mobile-accent)",
        background:  "var(--mobile-accent-fill, rgba(255,80,0,0.08))",
        color:       "var(--mobile-accent)",
        fontFamily:  "Arial, Helvetica, sans-serif",
        fontSize:    13,
        fontWeight:  600,
        cursor:      "pointer",
        whiteSpace:  "nowrap",
        transition:  "background 0.12s ease",
        minHeight:   44,
      }}
    >
      {/* Calendar icon */}
      <CalendarIcon size={14} strokeWidth={2.2} />
      {label}
    </button>
  );
}

// ── Fuel segmented toggle ─────────────────────────────────────────────────────

function FuelToggle({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (fuel: string) => void;
}) {
  const fuels = ["Diesel B", "Gasoline C"];
  return (
    <div
      role="group"
      aria-label="Fuel type"
      style={{
        display:       "inline-flex",
        background:    "var(--mobile-surface-2, #fafafc)",
        border:        "1px solid var(--mobile-border, #e6e6ec)",
        borderRadius:  12,
        padding:       3,
        gap:           2,
      }}
    >
      {fuels.map((fuel) => {
        const active = selected === fuel;
        return (
          <button
            key={fuel}
            type="button"
            onClick={() => onChange(fuel)}
            aria-pressed={active}
            style={{
              minHeight:   44,
              padding:     "0 16px",
              borderRadius: 9,
              border:      0,
              background:  active ? "var(--mobile-accent)" : "transparent",
              color:       active ? "#fff" : "var(--mobile-text-muted, #6b6b73)",
              fontFamily:  "Arial, Helvetica, sans-serif",
              fontSize:    14,
              fontWeight:  active ? 700 : 500,
              cursor:      "pointer",
              transition:  "background 0.15s ease, color 0.15s ease",
              whiteSpace:  "nowrap",
            }}
          >
            {fuel}
          </button>
        );
      })}
    </div>
  );
}

// ── Week range slider (inside filter drawer) ──────────────────────────────────

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
    excelLoading,
    setExcelLoading,
  } = useDieselGasolineMarginsData();

  // Local mobile state
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [draftRange, setDraftRange]     = useState<[number, number]>(weekRange);
  const [selectedFuel, setSelectedFuel] = useState<string>("Diesel B");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Sync draft when drawer opens
  const openDrawer = () => {
    setDraftRange(weekRange);
    setDrawerOpen(true);
  };
  const applyDrawer = () => {
    setWeekRange(draftRange);
    setDrawerOpen(false);
  };
  const resetDrawer = () => {
    const full: [number, number] = [0, Math.max(0, weeks.length - 1)];
    setDraftRange(full);
  };

  // Chart data
  const chartTraces = useMemo(
    () => buildMobileStackedChart(filteredRows, selectedFuel, visibleWeeks),
    [filteredRows, selectedFuel, visibleWeeks],
  );

  // Component breakdown for selected fuel at latest visible week
  const breakdown = useMemo(
    () => getLatestComponentBreakdown(allRows, selectedFuel, latestVisibleWeek),
    [allRows, selectedFuel, latestVisibleWeek],
  );

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg, #f5f5f7)",
        paddingBottom: "calc(80px + var(--mobile-safe-bottom, 0px))",
        fontFamily: "Arial, Helvetica, sans-serif",
        position: "relative",
      }}
    >
      {/* Top bar */}
      <MobileTopBar
        title="D&G Margins"
        rightSlot={
          <FilterChip
            weeks={weeks}
            weekRange={weekRange}
            onOpen={openDrawer}
          />
        }
      />

      {loading ? (
        <div style={{ padding: 24 }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* Fuel type toggle */}
          <div style={{
            padding: "12px 16px 0",
            display: "flex",
            justifyContent: "center",
          }}>
            <FuelToggle selected={selectedFuel} onChange={setSelectedFuel} />
          </div>

          {/* Latest week badge */}
          {latestVisibleWeek && (
            <div style={{
              padding: "8px 16px 0",
              textAlign: "center",
              fontSize: 12,
              color: "var(--mobile-text-muted, #6b6b73)",
            }}>
              Latest data: <strong style={{ color: "var(--mobile-accent, #ff5000)" }}>
                {weekLastDay(latestVisibleWeek)}
              </strong>
            </div>
          )}

          {/* Stacked area chart */}
          <div style={{
            margin: "12px 0 0",
            background: "var(--mobile-surface, #ffffff)",
            borderTop:    "1px solid var(--mobile-border, #e6e6ec)",
            borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
          }}>
            <div style={{
              padding: "10px 16px 4px",
              fontSize: 13, fontWeight: 600,
              color: "var(--mobile-text, #1a1a1a)",
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
                    x: 0, y: -0.18,
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
                  margin: { l: 44, r: 12, t: 8, b: 48 },
                }}
                style={{ padding: "0 8px 12px" }}
              />
            ) : (
              <div style={{
                height: 160, display: "flex", alignItems: "center",
                justifyContent: "center",
                fontSize: 13, color: "var(--mobile-text-muted, #6b6b73)",
              }}>
                No data for selected period
              </div>
            )}
          </div>

          {/* Component breakdown cards */}
          {breakdown.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                padding: "4px 16px 8px",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--mobile-text-muted, #6b6b73)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}>
                Breakdown — {latestVisibleWeek ? weekLastDay(latestVisibleWeek) : ""}
              </div>
              <div style={{
                background: "var(--mobile-surface, #ffffff)",
                borderTop:    "1px solid var(--mobile-border, #e6e6ec)",
                borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
              }}>
                {breakdown.map(({ key, label, value, pct }) => (
                  <MobileDataCard
                    key={String(key)}
                    variant="compact"
                    leftIcon={
                      <div style={{
                        width:  10,
                        height: 10,
                        borderRadius: 3,
                        background: STACK_COLORS[String(key)] ?? "#888",
                        flexShrink: 0,
                      }} />
                    }
                    title={label}
                    rightSlot={
                      <div style={{ textAlign: "right" }}>
                        <div style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: "var(--mobile-text, #1a1a1a)",
                          fontVariantNumeric: "tabular-nums",
                        }}>
                          {value.toFixed(2)}
                          <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3 }}>BRL/L</span>
                        </div>
                        <div style={{
                          fontSize: 11,
                          color: "var(--mobile-text-muted, #6b6b73)",
                          fontVariantNumeric: "tabular-nums",
                        }}>
                          {pct.toFixed(1)}%
                        </div>
                      </div>
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Export FAB — expands to show format choice */}
      {!loading && filteredRows.length > 0 && (
        <>
          {exportMenuOpen && (
            /* Scrim to dismiss export menu */
            <div
              onClick={() => setExportMenuOpen(false)}
              style={{
                position: "fixed", inset: 0, zIndex: 34,
                background: "rgba(0,0,0,0.18)",
              }}
            />
          )}

          {/* Export options (visible when menu open) */}
          {exportMenuOpen && (
            <div
              style={{
                position: "fixed",
                right: "max(16px, calc((100vw - 428px) / 2 + 16px))",
                bottom: "calc(72px + var(--mobile-safe-bottom, 0px) + 76px)",
                zIndex: 36,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "flex-end",
              }}
            >
              {/* Excel option */}
              <button
                type="button"
                disabled={excelLoading}
                onClick={async () => {
                  setExportMenuOpen(false);
                  setExcelLoading(true);
                  try {
                    await downloadDgMarginsExcel(filteredRows);
                  } catch (e) {
                    console.error("Excel export failed", e);
                  } finally {
                    setExcelLoading(false);
                  }
                }}
                style={{
                  height: 44, padding: "0 20px",
                  borderRadius: 22,
                  border: 0,
                  background: "var(--mobile-surface, #fff)",
                  color: "var(--mobile-text, #1a1a1a)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                  fontFamily: "Arial", fontSize: 14, fontWeight: 600,
                  cursor: excelLoading ? "default" : "pointer",
                  opacity: excelLoading ? 0.6 : 1,
                  whiteSpace: "nowrap",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {excelLoading ? "Generating..." : "Excel (.xlsx)"}
              </button>

              {/* CSV option */}
              <button
                type="button"
                onClick={() => {
                  setExportMenuOpen(false);
                  downloadCsv({
                    rows: filteredRows as unknown as Record<string, unknown>[],
                    filename: "Diesel-Gasoline-Margins",
                  });
                }}
                style={{
                  height: 44, padding: "0 20px",
                  borderRadius: 22,
                  border: 0,
                  background: "var(--mobile-surface, #fff)",
                  color: "var(--mobile-text, #1a1a1a)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                  fontFamily: "Arial", fontSize: 14, fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}
              >
                <FileLinesIcon size={16} />
                CSV (.csv)
              </button>
            </div>
          )}

          <ExportFAB
            icon="download"
            label={exportMenuOpen ? "Close" : "Export"}
            ariaLabel="Export data"
            disabled={excelLoading}
            onClick={() => setExportMenuOpen((v) => !v)}
          />
        </>
      )}

      {/* Filter drawer */}
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
            fontSize: 13, fontWeight: 700,
            color: "var(--mobile-text, #1a1a1a)",
            marginBottom: 16,
            fontFamily: "Arial",
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
              marginTop: 4,
              padding: "8px 12px",
              background: "var(--mobile-surface-2, #fafafc)",
              borderRadius: 10,
              fontSize: 12,
              color: "var(--mobile-text-muted, #6b6b73)",
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
                ({draftRange[1] - draftRange[0] + 1} week{draftRange[1] - draftRange[0] !== 0 ? "s" : ""})
              </span>
            </div>
          )}
        </div>
      </FilterDrawer>
    </div>
  );
}

"use client";

// Mobile View — /price-bands (≤768px).
//
// Spec: /.claude/plans/o-modo-mobile-da-tranquil-giraffe.md § 4.4.
//
// Layout (top → bottom):
//   MobileTopBar       — sticky wordmark (no filter trigger — no drawer needed)
//   MobileTabBar       — Diesel | Gasoline (Diesel default)
//   Period preset pills — 1M / 3M / 6M / 1Y / All  (6M default)
//   Hero chart         — 3 lines (Import / Export / Petrobras)
//                        Diesel: subsidy shading on Import line by default
//   Legend chips below — 3 colored chips, tap-to-hide/show each series
//   Comparison table   — Latest + MoM% + YoY% per series; horizontal scroll,
//                        first column sticky
//   MobileHomePill     — fixed floating home button (global mobile nav v2)
//
// Non-negotiables per plan § 3.4 + § 5.4:
//   - No ExportFAB / ExportModal
//   - No MobileBottomTabBar
//   - No NavBar
//   - No useIsMobile() inside this file (it's already mobile)
//   - Light-only
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes here
// must land in desktop/View.tsx in the SAME commit, OR the commit message
// must declare [mobile-only] with an explicit reason.

import { useCallback, useMemo, useState } from "react";
import type { PlotData } from "plotly.js";

import {
  MobileTopBar,
  MobileTabBar,
  MobileChart,
  MobileHomePill,
} from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  usePriceBandsData,
  fmtDateLabel,
  COLOR_IMPORT,
  COLOR_EXPORT,
  COLOR_PETRO,
  SUBSIDY_CUTOFF,
  GAS_SERIES,
  DSL_SERIES,
  type PriceBandsProduct,
  type PriceBandsRow,
} from "../usePriceBandsData";

// ─── Period preset chips ──────────────────────────────────────────────────────

interface PeriodChip {
  label: string;
  months: number | null;
}

const PERIOD_CHIPS: PeriodChip[] = [
  { label: "1M",  months: 1   },
  { label: "3M",  months: 3   },
  { label: "6M",  months: 6   },
  { label: "1Y",  months: 12  },
  { label: "All", months: null },
];

/** Default period: 6 months back from today. */
const DEFAULT_MONTHS = 6;

function computeSliderRange(
  datas: string[],
  months: number | null,
): [number, number] {
  if (datas.length === 0) return [0, 0];
  const end = datas.length - 1;
  if (months === null) return [0, end];
  const latest = new Date(datas[end] + "T00:00:00Z");
  latest.setUTCMonth(latest.getUTCMonth() - months);
  const cutoff = latest.toISOString().slice(0, 10);
  const startIdx = Math.max(0, datas.findIndex((d) => d >= cutoff));
  return [startIdx, end];
}

/** Returns which chip is currently active, or null if none matches exactly. */
function activeChipMonths(
  datas: string[],
  sliderRange: [number, number],
): number | null | "all" {
  for (const chip of PERIOD_CHIPS) {
    const [s, e] = computeSliderRange(datas, chip.months);
    if (s === sliderRange[0] && e === sliderRange[1]) {
      return chip.months === null ? "all" : chip.months;
    }
  }
  return null;
}

// ─── Series keys for legend chips ────────────────────────────────────────────

// We expose exactly 3 legend chips per spec:
//   Import Parity | Export Parity | Petrobras Price
// Subsidy series are bundled under the Import chip (shading) or hidden
// behind the same import chip visibility when off.
type SeriesKey = "import" | "export" | "petrobras";

interface SeriesChipDef {
  key: SeriesKey;
  label: string;
  color: string;
}

const SERIES_CHIPS: SeriesChipDef[] = [
  { key: "import",    label: "Import",    color: COLOR_IMPORT },
  { key: "export",    label: "Export",    color: COLOR_EXPORT },
  { key: "petrobras", label: "Petrobras", color: COLOR_PETRO  },
];

/** Map field name → which chip key it belongs to. */
function chipForField(field: string): SeriesKey | null {
  if (field === "bba_import_parity" || field === "bba_import_parity_w_subsidy") return "import";
  if (field === "bba_export_parity") return "export";
  if (field === "petrobras_price" || field === "petrobras_price_w_subsidy") return "petrobras";
  return null;
}

// ─── MoM / YoY computation ───────────────────────────────────────────────────

interface CompRow {
  label: string;
  color: string;
  latest: number | null;
  mom: number | null;   // percentage
  yoy: number | null;   // percentage
}

function addMonths(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Closest non-null value in rows at or before the given date for the given field. */
function closestBefore(
  rows: PriceBandsRow[],
  targetDate: string,
  field: keyof PriceBandsRow,
): number | null {
  // rows must be sorted ascending by date
  let val: number | null = null;
  for (const r of rows) {
    if (r.date > targetDate) break;
    const v = r[field] as number | null;
    if (v != null) val = v;
  }
  return val;
}

function pctChange(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return ((current / prior) - 1) * 100;
}

function fmtPctCell(pct: number | null): { text: string; positive: boolean | null } {
  if (pct == null) return { text: "—", positive: null };
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  return { text, positive: pct >= 0 };
}

function buildCompTable(
  rows: PriceBandsRow[],
  product: PriceBandsProduct,
  visibleKeys: Set<SeriesKey>,
): CompRow[] {
  const productRows = rows
    .filter((r) => r.product === product)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (productRows.length === 0) return [];

  const latestDate = productRows[productRows.length - 1].date;
  const mom1Date   = addMonths(latestDate, -1);
  const yoy1Date   = addMonths(latestDate, -12);

  const seriesDefs = product === "Gasoline" ? GAS_SERIES : DSL_SERIES;
  const result: CompRow[] = [];

  for (const s of seriesDefs) {
    const chipKey = chipForField(s.field as string);
    if (!chipKey || !visibleKeys.has(chipKey)) continue;

    // Subsidy series (dashed): only show if after SUBSIDY_CUTOFF
    if ((s.field === "bba_import_parity_w_subsidy" || s.field === "petrobras_price_w_subsidy")
        && latestDate < SUBSIDY_CUTOFF) continue;

    const current = closestBefore(productRows, latestDate, s.field);
    const mom1    = closestBefore(productRows, mom1Date,   s.field);
    const yoy1    = closestBefore(productRows, yoy1Date,   s.field);

    result.push({
      label:     s.label,
      color:     s.color,
      latest:    current,
      mom:       pctChange(current, mom1),
      yoy:       pctChange(current, yoy1),
    });
  }

  return result;
}

// ─── Chart builder — mobile 3-line chart ────────────────────────────────────
//
// Builds filtered traces from the pre-built chart data returned by the hook,
// applying:
//   1. Period window (xMin / xMax from slider)
//   2. Series visibility (chipVisibility)
//   3. Subsidy shading: for Diesel the bba_import_parity_w_subsidy trace is
//      included as a dashed line (matching the "import" chip) when that chip
//      is visible. petrobras_price_w_subsidy is similarly grouped under the
//      "petrobras" chip.

function buildMobileTraces(
  rows: PriceBandsRow[],
  product: PriceBandsProduct,
  xMin: string | null,
  xMax: string | null,
  visibleKeys: Set<SeriesKey>,
): PlotData[] {
  const seriesDefs = product === "Gasoline" ? GAS_SERIES : DSL_SERIES;

  const filtered = rows
    .filter((r) => r.product === product)
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) return [];

  const dates = filtered.map((r) => r.date);

  const traces: PlotData[] = [];

  for (const s of seriesDefs) {
    const chipKey = chipForField(s.field as string);
    if (!chipKey || !visibleKeys.has(chipKey)) continue;

    traces.push({
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: dates,
      y: filtered.map((r) => r[s.field as keyof PriceBandsRow] as number | null),
      line: { color: s.color, dash: s.dash, shape: s.shape, width: s.width },
      hovertemplate: `%{fullData.name}: R$ %{y:.2f}<extra></extra>`,
    } as unknown as PlotData);
  }

  return traces;
}

// ─── Styled sub-components ───────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        padding: "10px 16px 4px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        color: "var(--mobile-text-muted)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function ColorSwatch({
  color,
  dash = "solid",
}: {
  color: string;
  dash?: "solid" | "dash";
}): React.ReactElement {
  if (dash === "dash") {
    // Dashed swatch — two short segments
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          flexShrink: 0,
          width: 20,
          height: 3,
          marginRight: 6,
        }}
      >
        <span style={{ flex: 1, height: 2, background: color, borderRadius: 1 }} />
        <span style={{ flex: 1, height: 2, background: color, borderRadius: 1 }} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 20,
        height: 3,
        background: color,
        borderRadius: 2,
        marginRight: 6,
        flexShrink: 0,
        verticalAlign: "middle",
      }}
    />
  );
}

// ─── Mobile View ─────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("price-bands");
  const {
    rows, loading,
    filters, setFilters,
    datas, xMin, xMax,
    currentValues,
  } = usePriceBandsData();

  // ── Period chip state ──────────────────────────────────────────────────────
  // We manage the active chip key locally; on mount (or after datas load) we
  // default to 6M. The hook's sliderRange is kept in sync.
  const [activeMonths, setActiveMonths] = useState<number | null | "all">(DEFAULT_MONTHS);

  // When datas populate, apply the default 6M window once.
  const [didInit, setDidInit] = useState(false);
  if (!didInit && datas.length > 0) {
    setDidInit(true);
    const range = computeSliderRange(datas, DEFAULT_MONTHS);
    // Only set if hook hasn't already applied it (avoid loop)
    if (filters.sliderRange[0] !== range[0] || filters.sliderRange[1] !== range[1]) {
      setFilters({ sliderRange: range });
    }
  }

  const handleChip = useCallback((months: number | null) => {
    setActiveMonths(months === null ? "all" : months);
    setFilters({ sliderRange: computeSliderRange(datas, months) });
  }, [datas, setFilters]);

  // Sync active chip if slider was changed externally (unlikely on mobile, but safe)
  const derivedActive = useMemo(
    () => activeChipMonths(datas, filters.sliderRange),
    [datas, filters.sliderRange],
  );
  const displayActive = derivedActive ?? activeMonths;

  // ── Series visibility chips ───────────────────────────────────────────────
  const [visibleKeys, setVisibleKeys] = useState<Set<SeriesKey>>(
    new Set(["import", "export", "petrobras"]),
  );

  const toggleSeries = useCallback((key: SeriesKey) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Require at least 1 visible series
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartTraces = useMemo(
    () => buildMobileTraces(rows, filters.product, xMin, xMax, visibleKeys),
    [rows, filters.product, xMin, xMax, visibleKeys],
  );

  const chartLayout = useMemo(() => ({
    height: 260,
    margin: { l: 44, r: 8, t: 12, b: 36 },
    xaxis: {
      type: "date" as const,
      tickformat: "%b-%y",
      nticks: 5,
      tickangle: -30,
    },
    yaxis: {
      tickformat: ".2f",
      nticks: 4,
      tickprefix: "R$ ",
    },
    showlegend: false,
    hovermode: "x unified" as const,
  }), []);

  // ── Comparison table ──────────────────────────────────────────────────────
  const compRows = useMemo(
    () => buildCompTable(rows, filters.product, visibleKeys),
    [rows, filters.product, visibleKeys],
  );

  // ── Current values (for legend chip subtitle) ─────────────────────────────
  const cv = currentValues[filters.product];

  if (visLoading || !visible) return <></>;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(96px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <MobileTopBar title="Price Bands" />

      {/* ── Product tab bar (sticky below topbar) ─────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: "var(--mobile-topbar-h)",
          zIndex: 20,
          background: "var(--mobile-bg)",
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        <MobileTabBar
          tabs={[
            { key: "Diesel",   label: "Diesel"   },
            { key: "Gasoline", label: "Gasoline" },
          ]}
          activeKey={filters.product}
          onChange={(k) => setFilters({ product: k as PriceBandsProduct })}
          ariaLabel="Product selection"
        />

        {/* ── Period preset pills ─────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "8px 16px 0",
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {PERIOD_CHIPS.map((chip) => {
            const chipKey = chip.months === null ? "all" : chip.months;
            const isActive = displayActive === chipKey;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => handleChip(chip.months)}
                style={{
                  flexShrink: 0,
                  padding: "5px 14px",
                  borderRadius: "var(--mobile-radius-full)",
                  border: "1px solid",
                  borderColor: isActive ? "var(--mobile-accent)" : "var(--mobile-divider)",
                  background: isActive ? "var(--mobile-accent)" : "var(--mobile-surface)",
                  color: isActive ? "#fff" : "var(--mobile-text-muted)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  minHeight: 36,
                  fontFamily: "inherit",
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "48px 0", display: "flex", justifyContent: "center" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* ── Hero chart ───────────────────────────────────────────────── */}
          <div style={{ padding: "12px 8px 0" }}>
            <MobileChart
              data={chartTraces}
              layout={chartLayout}
              height={260}
            />
          </div>

          {/* ── Legend chips — tap-to-toggle ─────────────────────────── */}
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "8px 16px 4px",
              flexWrap: "wrap",
            }}
          >
            {SERIES_CHIPS.map((chip) => {
              const active = visibleKeys.has(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => toggleSeries(chip.key)}
                  aria-pressed={active}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0,
                    padding: "5px 12px 5px 8px",
                    borderRadius: "var(--mobile-radius-full)",
                    border: "1px solid",
                    borderColor: active ? chip.color : "var(--mobile-divider)",
                    background: active
                      ? `color-mix(in srgb, ${chip.color} 12%, transparent)`
                      : "var(--mobile-surface)",
                    color: active ? chip.color : "var(--mobile-text-muted)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    minHeight: 34,
                    fontFamily: "inherit",
                    opacity: active ? 1 : 0.55,
                    transition: "opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease",
                    flexShrink: 0,
                  }}
                >
                  <ColorSwatch color={chip.color} />
                  {chip.label}
                </button>
              );
            })}
            {/* Date range subtitle */}
            {cv.lastDate && (
              <span
                style={{
                  alignSelf: "center",
                  marginLeft: "auto",
                  fontSize: 11,
                  color: "var(--mobile-text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {fmtDateLabel(cv.lastDate)}
              </span>
            )}
          </div>

          {/* Diesel subsidy note */}
          {filters.product === "Diesel" && (
            <div style={{ padding: "2px 16px 8px", fontSize: 11, color: "var(--mobile-text-muted)" }}>
              Dashed Import line = w/ subsidy (from Mar 2026)
            </div>
          )}

          {/* ── Comparison table ─────────────────────────────────────────── */}
          {compRows.length > 0 && (
            <>
              <SectionLabel>Comparison</SectionLabel>
              <div
                style={{
                  overflowX: "auto",
                  scrollbarWidth: "thin",
                  WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
                  margin: "0 0 8px",
                  background: "var(--mobile-surface)",
                  borderTop: "1px solid var(--mobile-divider)",
                  borderBottom: "1px solid var(--mobile-divider)",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    minWidth: 340,
                    borderCollapse: "collapse",
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--mobile-divider)" }}>
                      <th
                        style={{
                          position: "sticky",
                          left: 0,
                          background: "var(--mobile-surface)",
                          padding: "8px 12px",
                          textAlign: "left",
                          fontWeight: 700,
                          fontSize: 11,
                          color: "var(--mobile-text-muted)",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                          boxShadow: "2px 0 4px rgba(0,0,0,0.04)",
                          minWidth: 140,
                          zIndex: 2,
                        }}
                      >
                        Series
                      </th>
                      {["Latest", "MoM", "YoY"].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "8px 12px",
                            textAlign: "right",
                            fontWeight: 700,
                            fontSize: 11,
                            color: "var(--mobile-text-muted)",
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compRows.map((row, idx) => {
                      const mom = fmtPctCell(row.mom);
                      const yoy = fmtPctCell(row.yoy);
                      return (
                        <tr
                          key={row.label}
                          style={{
                            background: idx % 2 === 0 ? "var(--mobile-surface)" : "var(--mobile-bg)",
                            borderBottom: "1px solid var(--mobile-divider)",
                          }}
                        >
                          {/* Sticky series label */}
                          <td
                            style={{
                              position: "sticky",
                              left: 0,
                              background: idx % 2 === 0 ? "var(--mobile-surface)" : "var(--mobile-bg)",
                              padding: "10px 12px",
                              whiteSpace: "nowrap",
                              boxShadow: "2px 0 4px rgba(0,0,0,0.04)",
                              zIndex: 1,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  width: 20,
                                  height: 3,
                                  background: row.color,
                                  borderRadius: 2,
                                  marginRight: 8,
                                  flexShrink: 0,
                                  verticalAlign: "middle",
                                }}
                              />
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: "var(--mobile-text)",
                                  fontSize: 13,
                                }}
                              >
                                {row.label}
                              </span>
                            </div>
                          </td>
                          {/* Latest value */}
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontWeight: 700,
                              color: "var(--mobile-text)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.latest != null ? `R$ ${row.latest.toFixed(2)}` : "—"}
                          </td>
                          {/* MoM */}
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontWeight: 600,
                              color: mom.positive === null
                                ? "var(--mobile-text-muted)"
                                : mom.positive
                                ? "#2e7d32"
                                : "#c62828",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {mom.text}
                          </td>
                          {/* YoY */}
                          <td
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontWeight: 600,
                              color: yoy.positive === null
                                ? "var(--mobile-text-muted)"
                                : yoy.positive
                                ? "#2e7d32"
                                : "#c62828",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {yoy.text}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Unit footnote */}
              <div style={{ padding: "0 16px 8px", fontSize: 11, color: "var(--mobile-text-muted)" }}>
                Values in R$/litro. MoM = 1-month change · YoY = 12-month change.
              </div>
            </>
          )}

          {/* No-data state */}
          {compRows.length === 0 && !loading && (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--mobile-text-muted)",
                fontSize: 14,
              }}
            >
              No data available for the selected period.
            </div>
          )}
        </>
      )}

      {/* ── Global floating Home pill (mobile reform v2) ─────────────────── */}
      <MobileHomePill />
    </div>
  );
}

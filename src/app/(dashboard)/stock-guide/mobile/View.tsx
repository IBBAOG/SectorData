"use client";

// ─── Mobile view for /stock-guide ─────────────────────────────────────────────
//
// Same single brain (useStockGuideData), mobile-first presentation, NO export
// (§ mobile reform — export is desktop-only).
//
//   1. Subtitle + sector filter chip row (opens FilterDrawer) + a Y1/Y2 year
//      toggle for the forward-multiple columns.
//   2. Comps as a compact SUMMARY TABLE with ALL companies (mirrors the desktop
//      comps table): a sticky Company column on the left + horizontal scroll for
//      the rest. Columns: Ticker · TP · Recomm · Upside · Mkt cap · then the six
//      forward groups (EV/EBITDA, P/E, FCFE Yield, Div Yield, EBITDA, Volumes)
//      for the SELECTED forward year (toggle Y1/Y2).
//   3. Restricted + assumptions footnote card.
//   4. Consolidated SENSITIVITY rendered INLINE below the footnote (always
//      visible, selection-independent): the Brent block then the Margin block
//      stacked vertically, the generic fallback tables, then the scenario-grid
//      panel(s) whose ~194k-point mesh is fetched LAZILY on scroll-into-view.
//
// [mobile-only] divergences vs. desktop:
//   • The forward-multiple pairs show ONE year at a time via a Y1/Y2 toggle (the
//     desktop shows both years side-by-side; 12 numeric columns won't fit a
//     phone even with horizontal scroll). The toggle preserves every metric and
//     both years — it just trades width for a tap.
//   • The two consolidated blocks stack vertically (desktop lays them in a
//     two-column grid). The per-row marker highlights the NEARER scenario cell
//     instead of the desktop interpolation triangle.
//   • No ExportPanel / Refresh-quotes button in the header (quotes still fetch
//     once on load via the shared hook; manual refresh is a desktop affordance).
//
// Binding sync rule: any new filter / KPI / column added here must also land in
// desktop/View.tsx in the same commit, or declare [mobile-only] with reason.

import { useState, useEffect, Fragment, type CSSProperties } from "react";

import {
  FilterDrawer,
  FunnelIcon,
} from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  useStockGuideData,
  formatSensitivityCell,
  fmtNum,
  fmtPct,
  fmtSignedPct,
  fmtSignedPctWhole,
  fmtInt,
  fmtMn,
  recommendationColors,
  VOLUME_UNIT_NOTE,
} from "../useStockGuideData";
import type {
  UseStockGuideData,
  GridTableModel,
  SensitivityPanel,
  SensitivityDriverTable,
} from "../useStockGuideData";
import { useInViewOnce } from "../useInViewOnce";
import type {
  StockGuideComputedRow,
  StockGuideSector,
  StockGuideRecommendation,
  SensitivityTable,
  SensitivityAxis,
  SensitivityPanelKey,
} from "@/types/stockGuide";

const MOBILE_ACCENT = "#ff5000";

// Comps-table header band — solid near-black with white text, matching the
// desktop comps header (and the source Itaú BBA comps sheet).
const HEADER_BG = "#0a0a0a";
const HEADER_FG = "#f5f5f5";
const HEADER_FG_DIM = "rgba(245,245,245,0.62)";

// Sticky Company column width on mobile (narrower than desktop's 176px).
const STICKY_COL_WIDTH = 132;
// Fixed width for each scrolling numeric column → predictable horizontal scroll.
const NUM_COL_WIDTH = 72;
// Right-edge shadow so the sticky Company column reads as floating above the body.
const STICKY_SHADOW = "6px 0 8px -6px rgba(0,0,0,0.18)";

const SECTOR_LABEL: Record<StockGuideSector, string> = {
  oil_gas: "Oil & Gas",
  fuel_distribution: "Fuel Distribution",
};

// ─── Recommendation chip (mobile) ─────────────────────────────────────────────

function RecChip({ code }: { code: StockGuideRecommendation | null }): React.ReactElement {
  if (!code) return <span style={{ color: "var(--mobile-text-faint)" }}>—</span>;
  const { bg, fg } = recommendationColors(code);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.03em",
        background: bg,
        color: fg,
      }}
    >
      {code}
    </span>
  );
}

// ─── Comps summary table ───────────────────────────────────────────────────────
//
// Sticky Company column + horizontal scroll. The six forward groups render for
// the SELECTED year only (Y1/Y2 toggle), so the column count stays phone-sized
// while every metric/year remains reachable.

interface YearCol {
  /** Group label shown in the header. */
  label: string;
  /** Keys into the computed row for the [Y1, Y2] pair. */
  y1: keyof StockGuideComputedRow;
  y2: keyof StockGuideComputedRow;
  /** Renderer for a single value of this group. */
  fmt: (v: number | null) => string;
  /** True for the 4 live-derived multiples → render "—" while quotes load. */
  live?: boolean;
}

const YEAR_COLS: YearCol[] = [
  { label: "EV/EBITDA",  y1: "evEbitdaY1",  y2: "evEbitdaY2",  fmt: (v) => fmtNum(v, 1), live: true },
  { label: "P/E",        y1: "peY1",        y2: "peY2",        fmt: (v) => fmtNum(v, 1), live: true },
  { label: "FCFE Yld",   y1: "fcfeYieldY1", y2: "fcfeYieldY2", fmt: (v) => fmtPct(v, 1), live: true },
  { label: "Div Yld",    y1: "divYieldY1",  y2: "divYieldY2",  fmt: (v) => fmtPct(v, 1), live: true },
  { label: "Net Inc.",   y1: "net_income_y1", y2: "net_income_y2", fmt: (v) => fmtMn(v) },
  { label: "EBITDA",     y1: "ebitda_y1",   y2: "ebitda_y2",   fmt: (v) => fmtMn(v) },
  { label: "Volumes",    y1: "volumes_y1",  y2: "volumes_y2",  fmt: (v) => fmtMn(v) },
];

// Single (non-paired) numeric/text columns, after the sticky Company column.
// Order (Eduardo review 2026-06-05): Recommendation moved BEFORE TP & Current
// Price; a new "Current" price column sits right after TP.
type MobileSingleColId =
  | "ticker"
  | "recommendation"
  | "tp"
  | "current_price"
  | "upside"
  | "market_cap";

interface MobileSingleCol {
  id: MobileSingleColId;
  header: string;
  align: "left" | "right";
}

const SINGLE_COLS: MobileSingleCol[] = [
  { id: "ticker",         header: "Ticker",  align: "left"  },
  { id: "recommendation", header: "Rec.",    align: "right" },
  { id: "tp",             header: "TP",      align: "right" },
  { id: "current_price",  header: "Current", align: "right" },
  { id: "upside",         header: "Upside",  align: "right" },
  { id: "market_cap",     header: "Mkt cap", align: "right" },
];

const thBase: React.CSSProperties = {
  padding: "7px 9px",
  textAlign: "right",
  color: HEADER_FG,
  background: HEADER_BG,
  fontWeight: 700,
  fontSize: 10,
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255,255,255,0.18)",
};

function CompsTable({
  rows,
  yearLabel,
  yearKey,
  quotesLoading,
}: {
  rows: StockGuideComputedRow[];
  yearLabel: string;
  yearKey: "y1" | "y2";
  quotesLoading: boolean;
}): React.ReactElement {
  const totalCols = 1 + SINGLE_COLS.length + YEAR_COLS.length; // no chevron col
  return (
    <div
      className="sg-comps-scroll"
      style={{
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        borderTop: "1px solid var(--mobile-divider)",
        borderBottom: "1px solid var(--mobile-divider)",
        background: "var(--mobile-surface)",
      }}
    >
      <style>{`
        .sg-comps-scroll tbody tr:active td,
        .sg-comps-scroll tbody tr:active th { background: var(--mobile-row-press) !important; }
        /* Hide native number-input spinners on the driver stepper (custom −/+ buttons only) */
        .sg-axis-stepper-input {
          appearance: textfield;
          -moz-appearance: textfield;
        }
        .sg-axis-stepper-input::-webkit-outer-spin-button,
        .sg-axis-stepper-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
      `}</style>
      <table
        style={{
          borderCollapse: "collapse",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 11.5,
        }}
      >
        <thead>
          <tr>
            {/* Sticky Company header (corner) */}
            <th
              style={{
                ...thBase,
                position: "sticky",
                left: 0,
                zIndex: 3,
                textAlign: "left",
                width: STICKY_COL_WIDTH,
                minWidth: STICKY_COL_WIDTH,
                letterSpacing: "0.03em",
                textTransform: "uppercase",
                borderRight: "1px solid rgba(255,255,255,0.18)",
                boxShadow: STICKY_SHADOW,
              }}
            >
              Company
            </th>
            {SINGLE_COLS.map((c) => (
              <th
                key={c.id}
                style={{
                  ...thBase,
                  textAlign: c.align,
                  width: NUM_COL_WIDTH,
                  minWidth: NUM_COL_WIDTH,
                }}
              >
                {c.header}
              </th>
            ))}
            {YEAR_COLS.map((g) => (
              <th
                key={g.label}
                style={{
                  ...thBase,
                  width: NUM_COL_WIDTH,
                  minWidth: NUM_COL_WIDTH,
                  borderLeft: "1px solid rgba(255,255,255,0.14)",
                }}
              >
                <div>{g.label}</div>
                <div style={{ fontWeight: 600, fontSize: 9, color: HEADER_FG_DIM }}>
                  {yearLabel}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={totalCols}
                style={{
                  padding: "28px 12px",
                  textAlign: "center",
                  color: "var(--mobile-text-muted)",
                  fontSize: 12.5,
                }}
              >
                No companies to display.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const isExCredit = r.isExTaxCredit === true;
              const rowBg = isExCredit
                ? "var(--mobile-surface-elevated)"
                : i % 2 === 0
                  ? "var(--mobile-surface)"
                  : "var(--mobile-surface-elevated)";
              const upsideColor =
                r.upsidePct == null
                  ? "var(--mobile-text)"
                  : r.upsidePct > 0
                    ? "#15803d"
                    : r.upsidePct < 0
                      ? "#b91c1c"
                      : "var(--mobile-text-muted)";
              return (
                <tr
                  key={isExCredit ? `${r.ticker}__ex` : r.ticker}
                  style={{ borderBottom: "1px solid var(--mobile-divider)" }}
                >
                  {/* Sticky Company cell */}
                  <th
                    scope="row"
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      textAlign: "left",
                      width: STICKY_COL_WIDTH,
                      minWidth: STICKY_COL_WIDTH,
                      padding: isExCredit ? "8px 10px 8px 18px" : "8px 10px",
                      background: rowBg,
                      borderRight: "1px solid var(--mobile-border)",
                      boxShadow: STICKY_SHADOW,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: isExCredit ? 500 : 700,
                        fontStyle: isExCredit ? "italic" : "normal",
                        color: isExCredit
                          ? "var(--mobile-text-muted)"
                          : "var(--mobile-text)",
                        fontSize: 12,
                        lineHeight: 1.2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.displayName}
                    </div>
                  </th>
                  {SINGLE_COLS.map((c) => {
                    switch (c.id) {
                      case "ticker":
                        return (
                          <td
                            key={c.id}
                            style={{
                              ...tdBase(rowBg),
                              textAlign: "left",
                              color: "var(--mobile-text-muted)",
                              fontWeight: 600,
                            }}
                          >
                            {isExCredit ? "" : r.ticker}
                          </td>
                        );
                      case "recommendation":
                        // Ex-tax-credit companion row: leave Ticker/Rec./TP/Current
                        // price/Upside/Market cap BLANK — only the EV/EBITDA-onward
                        // multiples (computed off the adjusted basis) are shown.
                        return (
                          <td key={c.id} style={{ ...tdBase(rowBg), textAlign: "right" }}>
                            {isExCredit ? "" : <RecChip code={r.recommendation} />}
                          </td>
                        );
                      case "tp":
                        // Whole-number (Eduardo review): 64.00 → 64.
                        return <td key={c.id} style={tdBase(rowBg)}>{isExCredit ? "" : fmtInt(r.target_price)}</td>;
                      case "current_price":
                        // Live price from the same Yahoo quote (2 decimals).
                        return (
                          <td key={c.id} style={tdBase(rowBg)}>
                            {isExCredit ? "" : quotesLoading && r.livePrice == null ? "—" : fmtNum(r.livePrice, 2)}
                          </td>
                        );
                      case "upside":
                        // Whole-percent (Eduardo review): +27.5% → +28%.
                        return (
                          <td key={c.id} style={{ ...tdBase(rowBg), color: upsideColor, fontWeight: 700 }}>
                            {isExCredit ? "" : quotesLoading && r.upsidePct == null ? "—" : fmtSignedPctWhole(r.upsidePct)}
                          </td>
                        );
                      case "market_cap":
                        return (
                          <td key={c.id} style={tdBase(rowBg)}>
                            {isExCredit ? "" : quotesLoading && r.marketCapBrlMn == null ? "—" : fmtMn(r.marketCapBrlMn)}
                          </td>
                        );
                      default:
                        return null;
                    }
                  })}
                  {/* Forward groups for the selected year */}
                  {YEAR_COLS.map((g) => {
                    const v = r[yearKey === "y1" ? g.y1 : g.y2] as number | null;
                    const gate = g.live === true && quotesLoading;
                    return (
                      <td
                        key={g.label}
                        style={{ ...tdBase(rowBg), borderLeft: "1px solid var(--mobile-divider)" }}
                      >
                        {gate && v == null ? "—" : g.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function tdBase(bg: string): React.CSSProperties {
  return {
    padding: "8px 9px",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    color: "var(--mobile-text)",
    whiteSpace: "nowrap",
    background: bg,
  };
}

// ─── Axis resolution (mobile — mirrors desktop semantics) ─────────────────────
//
// Same analysis as desktop: labels per axis kind + a current-value marker.
// [mobile-only] simplification: the interpolated marker (current value strictly
// between two driver scenarios) is rendered as a highlight on the NEARER line
// rather than a thin orange triangle between cells (no room on a phone).

interface MobileAxisMarker {
  /** Index to highlight (exact scenario hit, selectedTicker, or nearer line). */
  highlightIdx: number | null;
  /** True when the highlight is an interpolated (between-scenarios) approximation. */
  interpolated: boolean;
}

interface MobileResolvedAxis {
  labels: string[];
  marker: MobileAxisMarker;
  caption: string | null;
}

const MOBILE_NO_MARKER: MobileAxisMarker = { highlightIdx: null, interpolated: false };

/** Driver marker for mobile: exact hit, else the nearer of the two bracketing scenarios. */
function mobileDriverMarker(
  scenarios: number[],
  current: number | null,
): MobileAxisMarker {
  if (current == null || scenarios.length === 0) return MOBILE_NO_MARKER;
  for (let i = 0; i < scenarios.length; i++) {
    if (scenarios[i] === current) return { highlightIdx: i, interpolated: false };
  }
  for (let i = 0; i < scenarios.length - 1; i++) {
    const a = scenarios[i];
    const b = scenarios[i + 1];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (current > lo && current < hi) {
      const frac = (current - a) / (b - a); // 0..1 from a→b
      const nearer = frac < 0.5 ? i : i + 1;
      return { highlightIdx: nearer, interpolated: true };
    }
  }
  return MOBILE_NO_MARKER;
}

function mobileFormatScenario(v: number): string {
  // Integers print as-is; non-integers (e.g. a live dynamic driver value) round
  // to 1 decimal so the caption stays tidy.
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function mobileResolveAxis(
  axis: SensitivityAxis,
  ctx: {
    selectedTicker: string | null;
    y1Label: string;
    y2Label: string;
    resolveDriverAxis: UseStockGuideData["resolveDriverAxis"];
  },
): MobileResolvedAxis {
  if (axis.kind === "company") {
    const labels = axis.companies ?? [];
    const idx = labels.findIndex((c) => c === ctx.selectedTicker);
    return {
      labels,
      marker: { highlightIdx: idx >= 0 ? idx : null, interpolated: false },
      caption: null,
    };
  }
  if (axis.kind === "year") {
    const labels = (axis.years ?? []).map((y) =>
      y === "y1" ? ctx.y1Label : y === "y2" ? ctx.y2Label : y,
    );
    return { labels, marker: MOBILE_NO_MARKER, caption: null };
  }
  // `currentValue` is the EFFECTIVE today value (live for a dynamic driver bound
  // to a market metric, else the static `current_value`).
  const { driver, scenarios, currentValue } = ctx.resolveDriverAxis(axis);
  const unit = driver?.unit ?? "";
  const labels = scenarios.map((s) =>
    unit ? `${mobileFormatScenario(s)} ${unit}` : mobileFormatScenario(s),
  );
  const marker = mobileDriverMarker(scenarios, currentValue);
  const caption =
    driver != null && currentValue != null
      ? `Current: ${driver.name} = ${mobileFormatScenario(currentValue)}${unit ? ` ${unit}` : ""}`
      : null;
  return { labels, marker, caption };
}

// ─── One sensitivity table (mobile card) ──────────────────────────────────────

function MobileSensitivityTable({
  table,
  selectedTicker,
  y1Label,
  y2Label,
  resolveDriverAxis,
  computeSensitivityCell,
  quotesLoading,
}: {
  table: SensitivityTable;
  selectedTicker: string | null;
  y1Label: string;
  y2Label: string;
  resolveDriverAxis: UseStockGuideData["resolveDriverAxis"];
  computeSensitivityCell: UseStockGuideData["computeSensitivityCell"];
  quotesLoading: boolean;
}): React.ReactElement {
  const ctx = { selectedTicker, y1Label, y2Label, resolveDriverAxis };
  const rowAxis = mobileResolveAxis(table.definition.row_axis, ctx);
  const colAxis = mobileResolveAxis(table.definition.col_axis, ctx);
  const isLive = table.value_mode !== "absolute";

  return (
    <div style={{ marginBottom: 22 }}>
      {/* Title */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)" }}>{table.title}</span>
      </div>

      {colAxis.labels.length === 0 || rowAxis.labels.length === 0 ? (
        <div style={{ padding: "16px 4px", color: "var(--mobile-text-muted)", fontSize: 12.5 }}>
          This table has no rows or columns to display.
        </div>
      ) : (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table
            style={{
              borderCollapse: "collapse",
              fontSize: 11.5,
              fontFamily: "Arial, Helvetica, sans-serif",
              border: "1px solid var(--mobile-border)",
              borderRadius: "var(--mobile-radius-md, 12px)",
              overflow: "hidden",
              minWidth: "100%",
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "7px 11px",
                    background: "var(--mobile-surface-elevated)",
                    color: "var(--mobile-text)",
                    fontWeight: 700,
                    fontSize: 10,
                    whiteSpace: "nowrap",
                    borderRight: "1px solid var(--mobile-border)",
                    borderBottom: "1px solid var(--mobile-border)",
                  }}
                >
                  {table.metric_label || "Value"}
                </th>
                {colAxis.labels.map((c, ci) => {
                  const hit = colAxis.marker.highlightIdx === ci;
                  return (
                    <th
                      key={ci}
                      style={{
                        textAlign: "right",
                        padding: "7px 11px",
                        color: hit ? MOBILE_ACCENT : "var(--mobile-text-muted)",
                        fontWeight: 700,
                        fontSize: 10,
                        whiteSpace: "nowrap",
                        background: hit ? "rgba(255,80,0,0.10)" : "var(--mobile-surface-elevated)",
                        borderRight: "1px solid var(--mobile-divider)",
                        borderBottom: "1px solid var(--mobile-border)",
                      }}
                    >
                      {c}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowAxis.labels.map((rl, ri) => {
                const rowHit = rowAxis.marker.highlightIdx === ri;
                return (
                  <tr key={ri}>
                    <th
                      scope="row"
                      style={{
                        textAlign: "right",
                        padding: "7px 11px",
                        fontWeight: 700,
                        color: rowHit ? MOBILE_ACCENT : "var(--mobile-text)",
                        whiteSpace: "nowrap",
                        background: rowHit ? "rgba(255,80,0,0.10)" : "var(--mobile-surface-elevated)",
                        borderRight: "1px solid var(--mobile-border)",
                        borderBottom: "1px solid var(--mobile-divider)",
                      }}
                    >
                      {rl}
                    </th>
                    {colAxis.labels.map((_, ci) => {
                      const colHit = colAxis.marker.highlightIdx === ci;
                      const inHighlightedLine = rowHit || colHit;
                      const { value, unit } = computeSensitivityCell(table, ri, ci);
                      const text =
                        isLive && quotesLoading ? "—" : formatSensitivityCell(value, unit);
                      return (
                        <td
                          key={ci}
                          style={{
                            textAlign: "right",
                            padding: "7px 11px",
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--mobile-text)",
                            fontWeight: inHighlightedLine ? 700 : 400,
                            background: inHighlightedLine
                              ? "rgba(255,80,0,0.06)"
                              : ri % 2 === 0
                                ? "var(--mobile-surface)"
                                : "var(--mobile-surface-elevated)",
                            borderRight: "1px solid var(--mobile-divider)",
                            borderBottom: "1px solid var(--mobile-divider)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(colAxis.caption || rowAxis.caption) && (
        <div
          style={{
            marginTop: 8,
            fontSize: 10.5,
            color: "var(--mobile-text-muted)",
            lineHeight: 1.5,
          }}
        >
          {colAxis.caption && <div>{colAxis.caption}</div>}
          {rowAxis.caption && <div>{rowAxis.caption}</div>}
        </div>
      )}
    </div>
  );
}

// ─── Consolidated sensitivity block (one table per driver, stacked) ────────────
//
// Same analysis as desktop: a "brent"/"margin" panel renders ONE TABLE PER DRIVER
// (stacked). Each driver table has a shared scenario header + a SINGLE column-axis
// marker (every row shares the same driver). Inside, each underlying tagged table
// is a gray band (its metric label) followed by one indented row per company.
// [mobile-only] simplification: the current-value marker highlights the NEARER
// bracketing scenario CELL (no interpolation triangle); 11 columns scroll
// horizontally as the other mobile tables do.

const MOBILE_PANEL_TITLE: Record<SensitivityPanelKey, string> = {
  brent: "Brent sensitivity",
  margin: "EBITDA margin sensitivity",
};

const MOBILE_PANEL_PLACEHOLDER =
  "No tables configured yet — tag a sensitivity table to this panel in the Admin Panel.";

function mobileFmtScenarioHeader(v: number, unit: string): string {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return unit ? `${n} ${unit}` : n;
}

/**
 * One driver table inside a consolidated panel (mobile): a shared scenario header
 * with the nearer-cell marker, and per band a gray subheader row + one indented
 * company row each.
 */
function MobileDriverSensitivityTable({
  driverTable,
  computeSensitivityCell,
  quotesLoading,
}: {
  driverTable: SensitivityDriverTable;
  computeSensitivityCell: UseStockGuideData["computeSensitivityCell"];
  quotesLoading: boolean;
}): React.ReactElement {
  const scenarios = driverTable.colScenarios;
  // SINGLE column-axis marker for the whole driver table (nearer cell on mobile).
  const marker = mobileDriverMarker(scenarios, driverTable.currentValue);
  const nCols = 1 + scenarios.length;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Driver title — "Avg. Brent 2026 (USD/bbl)" */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 6 }}>
        {driverTable.driverLabel}
        {driverTable.driverUnit ? ` (${driverTable.driverUnit})` : ""}
      </div>

      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: 11.5,
            fontFamily: "Arial, Helvetica, sans-serif",
            border: "1px solid var(--mobile-border)",
            borderRadius: "var(--mobile-radius-md, 12px)",
            overflow: "hidden",
            minWidth: "100%",
          }}
        >
          <thead>
            <tr>
              {/* No label on the first column. */}
              <th
                style={{
                  textAlign: "left",
                  padding: "7px 11px",
                  background: "var(--mobile-surface-elevated)",
                  color: "var(--mobile-text)",
                  fontWeight: 700,
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  borderRight: "1px solid var(--mobile-border)",
                  borderBottom: "1px solid var(--mobile-border)",
                  minWidth: 96,
                }}
              />
              {scenarios.map((s, ci) => {
                const hit = marker.highlightIdx === ci;
                return (
                  <th
                    key={ci}
                    style={{
                      textAlign: "right",
                      padding: "7px 11px",
                      color: hit ? MOBILE_ACCENT : "var(--mobile-text-muted)",
                      fontWeight: 700,
                      fontSize: 10,
                      whiteSpace: "nowrap",
                      background: hit ? "rgba(255,80,0,0.10)" : "var(--mobile-surface-elevated)",
                      borderRight: "1px solid var(--mobile-divider)",
                      borderBottom: "1px solid var(--mobile-border)",
                    }}
                  >
                    {mobileFmtScenarioHeader(s, driverTable.driverUnit)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {driverTable.bands.map((band) => (
              <Fragment key={`band-${band.table.id}`}>
                {/* Gray band subheader spanning all columns = the metric label. */}
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={nCols}
                    style={{
                      textAlign: "left",
                      padding: "6px 11px",
                      fontWeight: 700,
                      fontSize: 10.5,
                      color: "var(--mobile-text)",
                      whiteSpace: "nowrap",
                      background: "var(--mobile-surface-elevated)",
                      borderTop: "1px solid var(--mobile-border)",
                      borderBottom: "1px solid var(--mobile-border)",
                    }}
                  >
                    {band.bandLabel}
                  </th>
                </tr>
                {band.rows.map((r, ri) => {
                  const isLive = band.table.value_mode !== "absolute";
                  return (
                    <tr key={`${band.table.id}-${r.ticker}`}>
                      <th
                        scope="row"
                        style={{
                          textAlign: "left",
                          padding: "7px 11px 7px 20px",
                          fontWeight: 600,
                          fontSize: 11,
                          color: "var(--mobile-text)",
                          whiteSpace: "nowrap",
                          background:
                            ri % 2 === 0 ? "var(--mobile-surface)" : "var(--mobile-surface-elevated)",
                          borderRight: "1px solid var(--mobile-border)",
                          borderBottom: "1px solid var(--mobile-divider)",
                        }}
                      >
                        {r.companyName}
                      </th>
                      {scenarios.map((_, ci) => {
                        const hit = marker.highlightIdx === ci;
                        const { value, unit } = computeSensitivityCell(
                          band.table,
                          r.rowIdx,
                          ci,
                        );
                        // BLANK when there's no typed primary value (not-yet-filled
                        // rows); "—" only when a typed value can't compute (live
                        // mode while quotes load).
                        const primary =
                          band.table.definition.cells?.[r.rowIdx]?.[ci] ?? null;
                        const text =
                          primary == null
                            ? ""
                            : isLive && quotesLoading
                              ? "—"
                              : formatSensitivityCell(value, unit);
                        return (
                          <td
                            key={ci}
                            style={{
                              textAlign: "right",
                              padding: "7px 11px",
                              fontVariantNumeric: "tabular-nums",
                              color: hit ? MOBILE_ACCENT : "var(--mobile-text)",
                              fontWeight: hit ? 700 : 400,
                              background: hit
                                ? "rgba(255,80,0,0.08)"
                                : ri % 2 === 0
                                  ? "var(--mobile-surface)"
                                  : "var(--mobile-surface-elevated)",
                              borderRight: "1px solid var(--mobile-divider)",
                              borderBottom: "1px solid var(--mobile-divider)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-driver-table caption — live current value. */}
      {driverTable.currentValue != null && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--mobile-text-muted)", lineHeight: 1.5 }}>
          Current: {driverTable.driverLabel} ={" "}
          {Number.isInteger(driverTable.currentValue)
            ? String(driverTable.currentValue)
            : driverTable.currentValue.toFixed(1)}
          {driverTable.driverUnit ? ` ${driverTable.driverUnit}` : ""}
        </div>
      )}
    </div>
  );
}

/** A consolidated, always-visible panel ("brent"/"margin") or its placeholder. */
function MobileConsolidatedBlock({
  panelKey,
  panel,
  computeSensitivityCell,
  quotesLoading,
}: {
  panelKey: SensitivityPanelKey;
  panel: SensitivityPanel | undefined;
  computeSensitivityCell: UseStockGuideData["computeSensitivityCell"];
  quotesLoading: boolean;
}): React.ReactElement {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 10 }}>
        {MOBILE_PANEL_TITLE[panelKey]}
      </div>
      {panel == null ? (
        <div
          style={{
            padding: "16px 14px",
            color: "var(--mobile-text-muted)",
            fontSize: 12,
            border: "1px dashed var(--mobile-border)",
            borderRadius: "var(--mobile-radius-md, 12px)",
            background: "var(--mobile-surface-elevated)",
            lineHeight: 1.5,
          }}
        >
          {MOBILE_PANEL_PLACEHOLDER}
        </div>
      ) : (
        panel.driverTables.map((dt) => (
          <MobileDriverSensitivityTable
            key={dt.driverId}
            driverTable={dt}
            computeSensitivityCell={computeSensitivityCell}
            quotesLoading={quotesLoading}
          />
        ))
      )}
    </div>
  );
}

// ─── Scenario-grid (multi-axis Brent mesh) panel — mobile ─────────────────────
//
// Same analysis as desktop, adapted: 1..3 STACKED axis sliders (marker at each
// axis's live "today" value) + a stacked Target price / Upside list per company.
// Same shared brain (the axis values live in the hook), so dragging here mirrors
// desktop. Resets honor the ≥34px touch target.

function mobileFmtSlider(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Fixed ±5 step for the scenario-grid axis steppers (analyst request — NOT the
 * dynamic `axis.step`). Manual typing is still free-form, clamped on commit.
 */
const MOBILE_GRID_AXIS_STEP = 5;

/** Clamp `v` to [min,max], returning `fallback` for non-finite input. */
function mobileClampAxis(
  v: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(v)) return fallback;
  return v < min ? min : v > max ? max : v;
}

/**
 * Snap `v` to the next multiple of `step` in the given direction (the stepper
 * buttons anchor to a round grid instead of just adding `step`):
 *   dir > 0 → smallest multiple of `step` strictly greater than `v`
 *   dir < 0 → largest  multiple of `step` strictly less    than `v`
 * If `v` is already on the grid it behaves like `v ± step`. Float-tolerant.
 */
function mobileSnapToStep(v: number, step: number, dir: number): number {
  if (!Number.isFinite(v) || step <= 0) return v;
  const EPS = 1e-9;
  if (dir > 0) return (Math.floor(v / step + EPS) + 1) * step;
  return (Math.ceil(v / step - EPS) - 1) * step;
}

/** One axis numeric stepper row inside the mobile grid panel (big ±5 buttons). */
function MobileAxisStepper({
  tableId,
  axisIdx,
  axis,
  onSetAxis,
  onResetAxis,
}: {
  tableId: number;
  axisIdx: number;
  axis: GridTableModel["axes"][number];
  onSetAxis: (tableId: number, axisIdx: number, value: number) => void;
  onResetAxis: (tableId: number, axisIdx: number) => void;
}): React.ReactElement {
  // Local draft so manual typing isn't clamped mid-keystroke; commit on blur/Enter.
  const [draft, setDraft] = useState<string>(mobileFmtSlider(axis.value));
  useEffect(() => {
    setDraft(mobileFmtSlider(axis.value));
  }, [axis.value]);

  const commit = (raw: string) => {
    const next = mobileClampAxis(Number(raw), axis.min, axis.max, axis.value);
    onSetAxis(tableId, axisIdx, next);
    setDraft(mobileFmtSlider(next));
  };
  // Buttons snap to the next multiple of the step (round grid), not value+step.
  const bump = (dir: number) => {
    const snapped = mobileSnapToStep(axis.value, MOBILE_GRID_AXIS_STEP, dir);
    const next = mobileClampAxis(snapped, axis.min, axis.max, axis.value);
    onSetAxis(tableId, axisIdx, next);
  };

  const stepBtnStyle: CSSProperties = {
    width: 44,
    minHeight: 40,
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${MOBILE_ACCENT}`,
    background: "rgba(255,80,0,0.06)",
    color: MOBILE_ACCENT,
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--mobile-text)" }}>
          {axis.label} ({axis.unit})
        </span>
        <span
          style={{
            color: axis.liveValue != null ? MOBILE_ACCENT : "var(--mobile-text-faint)",
            fontWeight: 600,
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {axis.liveValue != null ? `live ${mobileFmtSlider(axis.liveValue)}` : "live —"}
        </span>
      </div>

      {axis.disabled ? (
        <span
          style={{
            display: "inline-block",
            marginTop: 6,
            fontSize: 12,
            fontWeight: 700,
            color: "var(--mobile-text-muted)",
            fontVariantNumeric: "tabular-nums",
            background: "var(--mobile-surface-elevated)",
            border: "1px solid var(--mobile-border)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          fixed {mobileFmtSlider(axis.value)} {axis.unit}
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginTop: 6 }}>
          <button
            type="button"
            onClick={() => bump(-1)}
            disabled={axis.value <= axis.min}
            aria-label={`Decrease ${axis.label} to previous multiple of ${MOBILE_GRID_AXIS_STEP}`}
            style={{
              ...stepBtnStyle,
              borderRadius: "10px 0 0 10px",
              opacity: axis.value <= axis.min ? 0.45 : 1,
            }}
          >
            −
          </button>
          <input
            className="sg-axis-stepper-input"
            type="number"
            inputMode="decimal"
            step={MOBILE_GRID_AXIS_STEP}
            min={axis.min}
            max={axis.max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label={`${axis.label} (${axis.unit})`}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "center",
              border: "1px solid var(--mobile-border)",
              borderLeft: "none",
              borderRight: "none",
              padding: "8px 4px",
              fontSize: 16,
              fontWeight: 700,
              color: MOBILE_ACCENT,
              background: "var(--mobile-surface)",
              fontFamily: "inherit",
              fontVariantNumeric: "tabular-nums",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => bump(1)}
            disabled={axis.value >= axis.max}
            aria-label={`Increase ${axis.label} to next multiple of ${MOBILE_GRID_AXIS_STEP}`}
            style={{
              ...stepBtnStyle,
              borderRadius: "0 10px 10px 0",
              opacity: axis.value >= axis.max ? 0.45 : 1,
            }}
          >
            +
          </button>
        </div>
      )}

      {!axis.disabled && (
        <div style={{ fontSize: 10, color: "var(--mobile-text-faint)", fontVariantNumeric: "tabular-nums", marginTop: 3 }}>
          range {mobileFmtSlider(axis.min)}–{mobileFmtSlider(axis.max)} {axis.unit}
        </div>
      )}

      {axis.overridden && (
        <button
          type="button"
          onClick={() => onResetAxis(tableId, axisIdx)}
          style={{
            marginTop: 8,
            padding: "6px 13px",
            borderRadius: 16,
            minHeight: 34,
            border: `1px solid ${MOBILE_ACCENT}`,
            background: "rgba(255,80,0,0.08)",
            color: MOBILE_ACCENT,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Reset to live
        </button>
      )}
    </div>
  );
}

function MobileGridPanel({
  table,
  model,
  onSetAxis,
  onResetAxis,
  onResetAll,
  quotesLoading,
}: {
  table: SensitivityTable;
  model: GridTableModel;
  onSetAxis: (tableId: number, axisIdx: number, value: number) => void;
  onResetAxis: (tableId: number, axisIdx: number) => void;
  onResetAll: (tableId: number) => void;
  quotesLoading: boolean;
}): React.ReactElement {
  return (
    <div style={{ marginBottom: 22 }}>
      {/* Title */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)" }}>{table.title}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--mobile-text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
        Adjust the assumptions to re-price live across our scenario mesh. Markers
        show today&rsquo;s values.
      </div>

      {/* Axis steppers (1..3, stacked) */}
      <div style={{ marginBottom: 12 }}>
        {model.axes.map((axis, i) => (
          <MobileAxisStepper
            key={`${axis.key}-${i}`}
            tableId={table.id}
            axisIdx={i}
            axis={axis}
            onSetAxis={onSetAxis}
            onResetAxis={onResetAxis}
          />
        ))}
        {model.anyOverridden && (
          <button
            type="button"
            onClick={() => onResetAll(table.id)}
            style={{
              marginTop: 2,
              padding: "6px 13px",
              borderRadius: 16,
              minHeight: 34,
              border: `1px solid ${MOBILE_ACCENT}`,
              background: MOBILE_ACCENT,
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reset all to live
          </button>
        )}
      </div>

      {/* Output list (one column per configured output, per company) */}
      <div
        style={{
          border: "1px solid var(--mobile-border)",
          borderRadius: "var(--mobile-radius-md, 12px)",
          overflowX: "auto",
          marginTop: 6,
        }}
      >
        <div style={{ minWidth: 220 }}>
          <div
            style={{
              display: "flex",
              padding: "7px 12px",
              background: "var(--mobile-surface-elevated)",
              borderBottom: "1px solid var(--mobile-border)",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--mobile-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}
          >
            <span style={{ flex: 1, minWidth: 96 }}>Company</span>
            {model.outputs.map((o) => {
              const cols = [
                <span key={o.key} style={{ width: 78, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {o.label}
                </span>,
              ];
              if (o.mode === "upside") {
                cols.push(
                  <span key={`${o.key}-up`} style={{ width: 60, textAlign: "right" }}>
                    Upside
                  </span>,
                );
              }
              return cols;
            })}
          </div>
          {model.rows.length === 0 ? (
            <div style={{ padding: "18px 12px", textAlign: "center", color: "var(--mobile-text-muted)", fontSize: 12.5 }}>
              No companies to re-price.
            </div>
          ) : (
            model.rows.map((r, i) => (
              <div
                key={r.ticker}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "9px 12px",
                  borderBottom: i < model.rows.length - 1 ? "1px solid var(--mobile-divider)" : "none",
                  fontSize: 12.5,
                }}
              >
                <span style={{ flex: 1, minWidth: 96, fontWeight: 700, color: "var(--mobile-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.companyName}
                </span>
                {model.outputs.map((o) => {
                  const cell = r.values[o.key];
                  if (o.mode === "upside") {
                    const upside =
                      cell?.raw != null && r.livePrice != null && r.livePrice > 0
                        ? cell.raw / r.livePrice - 1
                        : null;
                    const upsideColor =
                      upside == null
                        ? "var(--mobile-text)"
                        : upside > 0
                          ? "#15803d"
                          : upside < 0
                            ? "#b91c1c"
                            : "var(--mobile-text-muted)";
                    return [
                      <span key={o.key} style={{ width: 78, textAlign: "right", fontWeight: 700, color: "var(--mobile-text)", fontVariantNumeric: "tabular-nums" }}>
                        {cell?.raw == null ? "—" : mobileFmtSlider(cell.raw)}
                      </span>,
                      <span key={`${o.key}-up`} style={{ width: 60, textAlign: "right", fontWeight: 700, color: upsideColor, fontVariantNumeric: "tabular-nums" }}>
                        {quotesLoading && upside == null ? "—" : fmtSignedPct(upside)}
                      </span>,
                    ];
                  }
                  const showDash = quotesLoading && cell?.value == null;
                  return (
                    <span key={o.key} style={{ width: 78, textAlign: "right", fontWeight: 700, color: "var(--mobile-text)", fontVariantNumeric: "tabular-nums" }}>
                      {showDash ? "—" : formatSensitivityCell(cell?.value ?? null, o.unit)}
                    </span>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── One grid table, mesh fetched LAZILY when it scrolls into view (mobile) ───

function MobileGridInView({
  table,
  getGridModel,
  ensureGridLoaded,
  gridLoading,
  onSetGridAxis,
  onResetGridAxis,
  onResetGridAll,
  quotesLoading,
}: {
  table: SensitivityTable;
  getGridModel: UseStockGuideData["getGridModel"];
  ensureGridLoaded: UseStockGuideData["ensureGridLoaded"];
  gridLoading: boolean;
  onSetGridAxis: UseStockGuideData["setGridAxisValue"];
  onResetGridAxis: UseStockGuideData["resetGridAxis"];
  onResetGridAll: UseStockGuideData["resetGridAll"];
  quotesLoading: boolean;
}): React.ReactElement {
  const ref = useInViewOnce<HTMLDivElement>(() => ensureGridLoaded(table.id));
  const model = getGridModel(table);
  return (
    <div ref={ref}>
      {model ? (
        <MobileGridPanel
          table={table}
          model={model}
          onSetAxis={onSetGridAxis}
          onResetAxis={onResetGridAxis}
          onResetAll={onResetGridAll}
          quotesLoading={quotesLoading}
        />
      ) : (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--mobile-text)", marginBottom: 8 }}>
            {table.title}
          </div>
          {gridLoading ? (
            <div style={{ padding: "20px 0" }}>
              <BarrelLoading bare />
            </div>
          ) : (
            <div style={{ padding: "14px 4px", color: "var(--mobile-text-muted)", fontSize: 12.5 }}>
              No scenario-grid points uploaded for this table yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sensitivity section (consolidated, always-visible inline) ────────────────

function MobileSensitivity({
  panelByKey,
  unpanneledTables,
  gridTables,
  selectedTicker,
  y1Label,
  y2Label,
  resolveDriverAxis,
  computeSensitivityCell,
  getGridModel,
  ensureGridLoaded,
  gridLoading,
  onSetGridAxis,
  onResetGridAxis,
  onResetGridAll,
  quotesLoading,
}: {
  panelByKey: UseStockGuideData["panelByKey"];
  unpanneledTables: SensitivityTable[];
  gridTables: SensitivityTable[];
  selectedTicker: string | null;
  y1Label: string;
  y2Label: string;
  resolveDriverAxis: UseStockGuideData["resolveDriverAxis"];
  computeSensitivityCell: UseStockGuideData["computeSensitivityCell"];
  getGridModel: UseStockGuideData["getGridModel"];
  ensureGridLoaded: UseStockGuideData["ensureGridLoaded"];
  gridLoading: boolean;
  onSetGridAxis: UseStockGuideData["setGridAxisValue"];
  onResetGridAxis: UseStockGuideData["resetGridAxis"];
  onResetGridAll: UseStockGuideData["resetGridAll"];
  quotesLoading: boolean;
}): React.ReactElement {
  return (
    <div>
      {/* Two always-rendered blocks, stacked vertically (Brent then Margin). */}
      <MobileConsolidatedBlock
        panelKey="brent"
        panel={panelByKey.brent}
        computeSensitivityCell={computeSensitivityCell}
        quotesLoading={quotesLoading}
      />
      <MobileConsolidatedBlock
        panelKey="margin"
        panel={panelByKey.margin}
        computeSensitivityCell={computeSensitivityCell}
        quotesLoading={quotesLoading}
      />

      {/* Generic fallback: untagged static tables. */}
      {unpanneledTables.map((t) => (
        <MobileSensitivityTable
          key={t.id}
          table={t}
          selectedTicker={selectedTicker}
          y1Label={y1Label}
          y2Label={y2Label}
          resolveDriverAxis={resolveDriverAxis}
          computeSensitivityCell={computeSensitivityCell}
          quotesLoading={quotesLoading}
        />
      ))}

      {/* Scenario-grid tables, always visible, lazy mesh on scroll-in. */}
      {gridTables.map((t) => (
        <MobileGridInView
          key={t.id}
          table={t}
          getGridModel={getGridModel}
          ensureGridLoaded={ensureGridLoaded}
          gridLoading={gridLoading}
          onSetGridAxis={onSetGridAxis}
          onResetGridAxis={onResetGridAxis}
          onResetGridAll={onResetGridAll}
          quotesLoading={quotesLoading}
        />
      ))}
    </div>
  );
}

// ─── View ──────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("stock-guide");
  const {
    loading,
    config,
    computedRows,
    sectorsPresent,
    restrictedNames,
    unitMarginNote,
    filters,
    setFilters,
    quotesLoading,
    panelByKey,
    unpanneledTables,
    gridTables,
    resolveDriverAxis,
    computeSensitivityCell,
    getGridModel,
    ensureGridLoaded,
    gridLoading,
    setGridAxisValue,
    resetGridAxis,
    resetGridAll,
  } = useStockGuideData();

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Which forward year the comps table shows (the [mobile-only] Y1/Y2 toggle).
  const [yearKey, setYearKey] = useState<"y1" | "y2">("y1");

  if (visLoading || !visible) return <></>;

  const yearLabel = yearKey === "y1" ? config.y1_label : config.y2_label;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--mobile-bg)",
        paddingBottom: "calc(24px + var(--mobile-safe-bottom))",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {/* ── Subtitle ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 16px 0",
          fontSize: 12,
          color: "var(--mobile-text-muted)",
          lineHeight: 1.3,
        }}
      >
        Coverage comps and key-estimate sensitivity to Brent and distribution
        margins.
      </div>

      {/* ── Filter chip row: sector ──────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 16px 0",
          overflowX: "auto",
          scrollbarWidth: "none",
          alignItems: "center",
          flexWrap: "nowrap",
        }}
      >
        <button
          type="button"
          onClick={() => setFilters({ sectorFilter: null })}
          style={chipStyle(filters.sectorFilter == null)}
        >
          All
        </button>
        {sectorsPresent.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilters({ sectorFilter: s })}
            style={chipStyle(filters.sectorFilter === s)}
          >
            {SECTOR_LABEL[s]}
          </button>
        ))}

        <span
          aria-hidden="true"
          style={{ width: 1, height: 20, background: "var(--mobile-divider)", flexShrink: 0, margin: "0 2px" }}
        />

        <button
          type="button"
          aria-label="Open filters"
          onClick={() => setDrawerOpen(true)}
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 20,
            border: "1px solid var(--mobile-divider)",
            background: "var(--mobile-surface)",
            color: "var(--mobile-text-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <FunnelIcon size={18} />
        </button>
      </div>

      {/* ── Forward-year toggle ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px 0",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--mobile-text-muted)",
          }}
        >
          Forward year
        </span>
        <div
          role="group"
          aria-label="Forward year"
          style={{
            display: "inline-flex",
            border: "1px solid var(--mobile-border)",
            borderRadius: 20,
            overflow: "hidden",
            background: "var(--mobile-surface)",
          }}
        >
          {(["y1", "y2"] as const).map((k) => {
            const on = yearKey === k;
            const label = k === "y1" ? config.y1_label : config.y2_label;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setYearKey(k)}
                style={{
                  padding: "6px 16px",
                  minHeight: 34,
                  border: "none",
                  background: on ? "var(--mobile-accent)" : "transparent",
                  color: on ? "#fff" : "var(--mobile-text-muted)",
                  fontSize: 12.5,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "40px 0" }}>
          <BarrelLoading bare />
        </div>
      ) : (
        <>
          {/* ── Comps summary table ──────────────────────────────────────────── */}
          <div style={{ marginTop: 14 }}>
            <CompsTable
              rows={computedRows}
              yearLabel={yearLabel}
              yearKey={yearKey}
              quotesLoading={quotesLoading}
            />
          </div>

          {/* ── Footnote card ────────────────────────────────────────────────── */}
          <div
            style={{
              margin: "16px",
              padding: "14px 16px",
              background: "var(--mobile-surface)",
              border: "1px solid var(--mobile-divider)",
              borderRadius: "var(--mobile-radius-lg, 12px)",
              fontSize: 11.5,
              color: "var(--mobile-text-muted)",
              lineHeight: 1.6,
            }}
          >
            {config.assumptions_note && (
              <div style={{ marginBottom: 4 }}>
                <strong style={{ color: "var(--mobile-text)" }}>Assumptions:</strong>{" "}
                {config.assumptions_note}
              </div>
            )}
            <div>{VOLUME_UNIT_NOTE}</div>
            <div style={{ marginTop: 4 }}>
              Market cap, upside, EV/EBITDA, P/E, FCFE Yield and Div Yield are
              computed live from the latest available price (BRL) and our latest
              published estimates.
            </div>
            {unitMarginNote && (
              <div style={{ marginTop: 4 }}>{unitMarginNote}</div>
            )}
            {restrictedNames.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <strong style={{ color: "var(--mobile-text)" }}>Currently restricted:</strong>{" "}
                {restrictedNames.join(", ")}.
              </div>
            )}
          </div>

          {/* ── Sensitivity (consolidated, always-visible, inline) ───────────── */}
          <div style={{ padding: "8px 16px 0" }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--mobile-text)",
                marginBottom: 4,
              }}
            >
              Sensitivity
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--mobile-text-muted)",
                lineHeight: 1.4,
                marginBottom: 14,
              }}
            >
              Sensitivity of our key estimates to Brent and distribution margins.
              Orange marks today&rsquo;s value.
            </div>
            <MobileSensitivity
              panelByKey={panelByKey}
              unpanneledTables={unpanneledTables}
              gridTables={gridTables}
              selectedTicker={null}
              y1Label={config.y1_label}
              y2Label={config.y2_label}
              resolveDriverAxis={resolveDriverAxis}
              computeSensitivityCell={computeSensitivityCell}
              getGridModel={getGridModel}
              ensureGridLoaded={ensureGridLoaded}
              gridLoading={gridLoading}
              onSetGridAxis={setGridAxisValue}
              onResetGridAxis={resetGridAxis}
              onResetGridAll={resetGridAll}
              quotesLoading={quotesLoading}
            />
          </div>
        </>
      )}

      {/* ── Filter drawer (sector) ───────────────────────────────────────────── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filters"
        onReset={() => setFilters({ sectorFilter: null })}
        onApply={() => setDrawerOpen(false)}
        applyLabel="Apply"
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--mobile-text)",
            marginBottom: 12,
            fontFamily: "Arial",
          }}
        >
          Sector
        </div>
        {([null, ...sectorsPresent] as (StockGuideSector | null)[]).map((s) => {
          const on = filters.sectorFilter === s;
          const label = s == null ? "All sectors" : SECTOR_LABEL[s];
          return (
            <button
              key={s ?? "all"}
              type="button"
              onClick={() => setFilters({ sectorFilter: s })}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "12px 0",
                borderBottom: "1px solid var(--mobile-divider)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 600,
                color: on ? "var(--mobile-accent)" : "var(--mobile-text)",
                fontFamily: "Arial",
              }}
            >
              {label}
              {on && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </FilterDrawer>
    </div>
  );
}

// ─── Chip style helper ─────────────────────────────────────────────────────────

function chipStyle(active: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    padding: "6px 13px",
    borderRadius: 20,
    border: "1px solid",
    borderColor: active ? "var(--mobile-accent)" : "var(--mobile-divider)",
    background: active ? "var(--mobile-accent)" : "var(--mobile-surface)",
    color: active ? "#fff" : "var(--mobile-text-muted)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 36,
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    transition: "background 0.15s ease, color 0.15s ease",
  };
}

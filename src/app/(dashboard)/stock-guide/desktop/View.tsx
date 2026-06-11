"use client";

// ─── Desktop view for /stock-guide ────────────────────────────────────────────
//
// Equities-research comps table + per-company sensitivity drill-down.
//
//   1. DashboardHeader (brand orange, Arial — STANDARD dashboard identity, NOT
//      the Market Watch trading-terminal theme) + ExportPanel (Excel + CSV) in
//      rightSlot + a manual "Refresh quotes" control.
//   2. Wide comps table — STICKY Company column + sticky header, overflow-x:auto,
//      a 2-LEVEL grouped header (EV/EBITDA, P/E, FCFE Yield, Div Yield, EBITDA,
//      Volumes each spanning two sub-cols labelled config.y1_label/y2_label).
//      Recommendation chip (OP=green, MP=amber, UP=red); Upside coloured by sign.
//      Live cells render '—' while quotesLoading. Row click → selectTicker.
//   3. Footnotes: assumptions note + volume-unit note + "Currently restricted: …".
//   4. Sensitivity panel — labelled 2D matrix for the selected company.
//
// All data, derivations, live quotes and export live in useStockGuideData.
// This View only handles layout, NavBar, header, chrome and the matrix render.
//
// Binding sync rule: any new filter / column / KPI added here must also land in
// mobile/View.tsx in the same commit, or declare [desktop-only] with reason.

import { useState, useEffect, Fragment, type CSSProperties } from "react";
import NavBar from "../../../../components/NavBar";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import DataErrorBoundary from "../../../../components/dashboard/DataErrorBoundary";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import {
  useStockGuideData,
  formatSensitivityCell,
  fmtNum,
  fmtPct,
  fmtSignedPctWhole,
  fmtInt,
  fmtMn,
  recommendationLabel,
  recommendationColors,
  VOLUME_UNIT_NOTE,
} from "../useStockGuideData";
import type {
  UseStockGuideData,
  GridTableModel,
  SensitivityPanel,
  SensitivityDriverTable,
} from "../useStockGuideData";
import { fmtSignedPct } from "../useStockGuideData";
import { useInViewOnce } from "../useInViewOnce";
import type {
  StockGuideComputedRow,
  SensitivityTable,
  SensitivityAxis,
  SensitivityPanelKey,
  StockGuideRecommendation,
} from "@/types/stockGuide";

const BRAND_ORANGE = "#ff5000";

// ─── Recommendation chip ──────────────────────────────────────────────────────

function RecommendationChip({
  code,
}: {
  code: StockGuideRecommendation | null;
}): React.ReactElement {
  if (!code) return <span style={{ color: "#9ca3af" }}>—</span>;
  const { bg, fg } = recommendationColors(code);
  return (
    <span
      title={recommendationLabel(code)}
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        background: bg,
        color: fg,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {code}
    </span>
  );
}

// ─── Financial-model download link ─────────────────────────────────────────────

/**
 * Compact download affordance for a company's financial model. Renders a small
 * brand-orange icon link when `url` is set, else the table's `—` placeholder.
 * Opens the externally-hosted Excel in a new tab.
 */
function ModelLink({ url }: { url: string | null }): React.ReactElement {
  if (!url) return <span style={{ color: "#9ca3af" }}>—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Download financial model"
      aria-label="Download financial model"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 5,
        border: `1px solid ${BRAND_ORANGE}`,
        color: BRAND_ORANGE,
        textDecoration: "none",
        lineHeight: 0,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

// ─── Comps table ──────────────────────────────────────────────────────────────

// Comps table header is a solid near-black band with white text, matching the
// source Itaú BBA comps sheet. Applied across both header levels + the sticky
// Company corner cell.
const HEADER_BG = "#0a0a0a";
const HEADER_FG = "#f5f5f5";

const TH_BASE: React.CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 11,
  fontWeight: 700,
  color: HEADER_FG,
  background: HEADER_BG,
  padding: "7px 10px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255,255,255,0.18)",
};

const TD_BASE: React.CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 12.5,
  color: "#1a1a1a",
  padding: "8px 12px",
  whiteSpace: "nowrap",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
  borderBottom: "1px solid #efefef",
};

const STICKY_COL_WIDTH = 176;

// Vertical rule that separates each metric group (EV/EBITDA | P/E | …). Slightly
// stronger than the inner #efefef row rules so the eye reads the groups as units.
const GROUP_RULE = "1px solid #dcdcdc";
// Same group separator, but tuned to read on the black header band — a faint
// light rule instead of the dark #dcdcdc (which would vanish on black).
const GROUP_RULE_HEADER = "1px solid rgba(255,255,255,0.22)";

// Right-edge shadow on the sticky Company column — makes it read as floating
// above the horizontally-scrolled body. Kept subtle (matches dropdown depth).
const STICKY_SHADOW = "6px 0 8px -6px rgba(0,0,0,0.16)";

interface PairGroup {
  label: string;
  /** Keys into the computed row for the [Y1, Y2] pair. */
  y1: keyof StockGuideComputedRow;
  y2: keyof StockGuideComputedRow;
  /** Renderer for a single value of this group. */
  fmt: (v: number | null) => string;
  /**
   * True for the 4 price-sensitive multiples (EV/EBITDA, P/E, FCFE Yield,
   * Div Yield) — derived live from the Yahoo price, so they render "—" while
   * quotes load. EBITDA / Volumes are direct data → never gated on the quote.
   */
  live?: boolean;
}

const PAIR_GROUPS: PairGroup[] = [
  { label: "EV/EBITDA",  y1: "evEbitdaY1",  y2: "evEbitdaY2",  fmt: (v) => fmtNum(v, 1), live: true },
  { label: "P/E",        y1: "peY1",        y2: "peY2",        fmt: (v) => fmtNum(v, 1), live: true },
  { label: "FCFE Yield", y1: "fcfeYieldY1", y2: "fcfeYieldY2", fmt: (v) => fmtPct(v, 1), live: true },
  { label: "Div Yield",  y1: "divYieldY1",  y2: "divYieldY2",  fmt: (v) => fmtPct(v, 1), live: true },
  { label: "Net Income", y1: "net_income_y1", y2: "net_income_y2", fmt: (v) => fmtMn(v) },
  { label: "EBITDA",     y1: "ebitda_y1",   y2: "ebitda_y2",   fmt: (v) => fmtMn(v) },
  { label: "Volumes",    y1: "volumes_y1",  y2: "volumes_y2",  fmt: (v) => fmtMn(v) },
];

// Single (non-paired) leading columns, after the sticky Company column. Each is
// rendered with a bespoke cell (chip / centered TP / live current-price / live
// market cap), so the column model is a typed list rather than plain strings.
// Order (Eduardo review 2026-06-05): Recommendation moved BEFORE TP & Current
// Price; a new "Current Price" column sits right after TP.
type SingleColId =
  | "ticker"
  | "model"
  | "last_update"
  | "recommendation"
  | "tp"
  | "current_price"
  | "upside"
  | "market_cap";

interface SingleCol {
  id: SingleColId;
  /** Header label. Use \n for a forced two-line, centered header. */
  header: string;
  align: "left" | "right" | "center";
}

const SINGLE_COLS: SingleCol[] = [
  { id: "ticker",         header: "Ticker",            align: "left"   },
  { id: "model",          header: "Model",             align: "center" },
  { id: "last_update",    header: "Last update",       align: "right"  },
  { id: "recommendation", header: "Recomm.",           align: "right"  },
  { id: "tp",             header: "TP",                align: "center" },
  { id: "current_price",  header: "Current Price",     align: "center" },
  { id: "upside",         header: "Upside",            align: "right"  },
  { id: "market_cap",     header: "Market cap\n(BRL mn)", align: "center" },
];

function CompsTable({
  rows,
  y1Label,
  y2Label,
  quotesLoading,
}: {
  rows: StockGuideComputedRow[];
  y1Label: string;
  y2Label: string;
  quotesLoading: boolean;
}): React.ReactElement {
  return (
    <div
      className="sg-comps-wrap"
      style={{
        overflowX: "auto",
        border: "1px solid #e6e6e6",
        borderRadius: 10,
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      }}
    >
      {/* Hover affordance — overrides the inline zebra background. Scoped to this
          table via the .sg-comps-wrap wrapper. */}
      <style>{`
        .sg-comps-wrap tbody tr:not([data-ex="1"]):hover > td {
          background: #f3f6fb !important;
        }
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
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          {/* ── Level 1: group headers ─────────────────────────────────────── */}
          <tr>
            <th
              rowSpan={2}
              style={{
                ...TH_BASE,
                position: "sticky",
                left: 0,
                zIndex: 4,
                textAlign: "left",
                width: STICKY_COL_WIDTH,
                minWidth: STICKY_COL_WIDTH,
                borderRight: "1px solid rgba(255,255,255,0.18)",
                background: HEADER_BG,
                color: HEADER_FG,
                boxShadow: STICKY_SHADOW,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              Company
            </th>
            {SINGLE_COLS.map((c) => (
              <th
                key={c.id}
                rowSpan={2}
                style={{
                  ...TH_BASE,
                  textAlign: c.align,
                  verticalAlign: "bottom",
                  color: HEADER_FG,
                }}
              >
                {c.header.includes("\n")
                  ? c.header.split("\n").map((line, li) => <div key={li}>{line}</div>)
                  : c.header}
              </th>
            ))}
            {PAIR_GROUPS.map((g) => (
              <th
                key={g.label}
                colSpan={2}
                style={{
                  ...TH_BASE,
                  textAlign: "center",
                  borderLeft: GROUP_RULE_HEADER,
                  color: HEADER_FG,
                  letterSpacing: "0.02em",
                }}
              >
                {g.label}
              </th>
            ))}
          </tr>
          {/* ── Level 2: Y1 / Y2 sub-headers under each group ──────────────── */}
          <tr>
            {PAIR_GROUPS.map((g) => [
              <th
                key={`${g.label}-y1`}
                style={{
                  ...TH_BASE,
                  fontWeight: 600,
                  fontSize: 10,
                  color: "rgba(245,245,245,0.62)",
                  textAlign: "right",
                  borderLeft: GROUP_RULE_HEADER,
                }}
              >
                {y1Label}
              </th>,
              <th
                key={`${g.label}-y2`}
                style={{
                  ...TH_BASE,
                  fontWeight: 600,
                  fontSize: 10,
                  color: "rgba(245,245,245,0.62)",
                  textAlign: "right",
                }}
              >
                {y2Label}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={1 + SINGLE_COLS.length + PAIR_GROUPS.length * 2}
                style={{
                  ...TD_BASE,
                  textAlign: "center",
                  color: "#9ca3af",
                  padding: "28px 10px",
                }}
              >
                No companies to display.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const isExCredit = r.isExTaxCredit === true;
              const rowBg = isExCredit
                ? "#f5f5f5"
                : i % 2 === 0
                  ? "#fff"
                  : "#fbfbfb";
              const upsideColor =
                r.upsidePct == null
                  ? "#1a1a1a"
                  : r.upsidePct > 0
                    ? "#15803d"
                    : r.upsidePct < 0
                      ? "#b91c1c"
                      : "#6b7280";
              return (
                <tr
                  key={isExCredit ? `${r.ticker}__ex` : r.ticker}
                  data-ex={isExCredit ? "1" : "0"}
                  style={{ background: rowBg }}
                >
                  {/* Sticky Company cell */}
                  <td
                    style={{
                      ...TD_BASE,
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      textAlign: "left",
                      fontWeight: isExCredit ? 500 : 700,
                      fontStyle: isExCredit ? "italic" : "normal",
                      color: isExCredit ? "#6b7280" : "#111827",
                      ...(isExCredit ? { padding: "8px 12px 8px 24px" } : null),
                      width: STICKY_COL_WIDTH,
                      minWidth: STICKY_COL_WIDTH,
                      background: rowBg,
                      borderRight: "1px solid #e0e0e0",
                      boxShadow: STICKY_SHADOW,
                    }}
                  >
                    {r.displayName}
                  </td>
                  {SINGLE_COLS.map((c) => {
                    switch (c.id) {
                      case "ticker":
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>
                            {isExCredit ? "" : r.ticker}
                          </td>
                        );
                      case "model":
                        // Ex-tax-credit companion row leaves the Model cell BLANK
                        // (display parity with Ticker / Recomm. / TP / etc.).
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "center" }}>
                            {isExCredit ? "" : <ModelLink url={r.model_url} />}
                          </td>
                        );
                      case "last_update":
                        return (
                          <td key={c.id} style={{ ...TD_BASE, color: "#9ca3af" }}>
                            {isExCredit ? "" : (r.last_update ?? "—")}
                          </td>
                        );
                      case "recommendation":
                        // Ex-tax-credit companion row: leave Ticker/Last update/
                        // Recomm./TP/Current price/Upside/Market cap BLANK — only the
                        // EV/EBITDA-onward multiples (computed off the adjusted basis) show.
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "right" }}>
                            {isExCredit ? "" : <RecommendationChip code={r.recommendation} />}
                          </td>
                        );
                      case "tp":
                        // Centered + whole-number (Eduardo review): 64.00 → 64.
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "center" }}>
                            {isExCredit ? "" : fmtInt(r.target_price)}
                          </td>
                        );
                      case "current_price":
                        // Live price from the same Yahoo quote that feeds market
                        // cap / upside. Kept at 2 decimals (price precision).
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "center" }}>
                            {isExCredit ? "" : quotesLoading && r.livePrice == null ? "—" : fmtNum(r.livePrice, 2)}
                          </td>
                        );
                      case "upside":
                        // Whole-percent (Eduardo review): +27.5% → +28%.
                        return (
                          <td key={c.id} style={{ ...TD_BASE, color: upsideColor, fontWeight: 700 }}>
                            {isExCredit ? "" : quotesLoading && r.upsidePct == null ? "—" : fmtSignedPctWhole(r.upsidePct)}
                          </td>
                        );
                      case "market_cap":
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "center" }}>
                            {isExCredit ? "" : quotesLoading && r.marketCapBrlMn == null ? "—" : fmtMn(r.marketCapBrlMn)}
                          </td>
                        );
                      default:
                        return null;
                    }
                  })}
                  {PAIR_GROUPS.map((g) => {
                    // Live-derived multiples show "—" while quotes load (they
                    // depend on the live price); direct-data groups never gate.
                    const gate = g.live === true && quotesLoading;
                    const v1 = r[g.y1] as number | null;
                    const v2 = r[g.y2] as number | null;
                    return [
                      <td
                        key={`${g.label}-y1`}
                        style={{ ...TD_BASE, borderLeft: GROUP_RULE }}
                      >
                        {gate && v1 == null ? "—" : g.fmt(v1)}
                      </td>,
                      <td key={`${g.label}-y2`} style={TD_BASE}>
                        {gate && v2 == null ? "—" : g.fmt(v2)}
                      </td>,
                    ];
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

// ─── Sensitivity matrix ────────────────────────────────────────────────────────

// ── Axis model: resolve labels + the current-value highlight/interpolation ────
//
// For each axis we compute its display labels and a "current-value marker":
//   • company axis → labels = company names; highlightIdx = the selectedTicker.
//   • driver axis  → labels = scenario + unit; highlightIdx if current_value
//     equals a scenario, else interp = { afterIdx, frac } if it falls strictly
//     between two adjacent (display-order) scenarios.
//   • year axis    → labels = y1Label / y2Label.

interface AxisMarker {
  /** Exact-hit index (scenario === current_value, or selectedTicker column). */
  highlightIdx: number | null;
  /** Interpolated position: between display index `afterIdx` and `afterIdx+1`,
   *  `frac` ∈ (0,1) of the way from afterIdx → afterIdx+1. */
  interp: { afterIdx: number; frac: number } | null;
}

interface ResolvedAxis {
  labels: string[];
  marker: AxisMarker;
  /** Caption under the matrix (driver current-value note), or null. */
  caption: string | null;
}

const NO_MARKER: AxisMarker = { highlightIdx: null, interp: null };

/**
 * Compute the current-value marker for a driver axis: an exact hit if
 * current_value equals a scenario, else an interpolated position between the
 * two adjacent (display-order) scenarios it falls strictly between.
 */
function driverMarker(scenarios: number[], current: number | null): AxisMarker {
  if (current == null || scenarios.length === 0) return NO_MARKER;
  // exact hit
  for (let i = 0; i < scenarios.length; i++) {
    if (scenarios[i] === current) return { highlightIdx: i, interp: null };
  }
  // strictly between two adjacent (in display order) scenarios
  for (let i = 0; i < scenarios.length - 1; i++) {
    const a = scenarios[i];
    const b = scenarios[i + 1];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (current > lo && current < hi) {
      // fraction of the way from a → b (respects display direction)
      const frac = (current - a) / (b - a);
      if (frac > 0 && frac < 1) return { highlightIdx: null, interp: { afterIdx: i, frac } };
    }
  }
  return NO_MARKER;
}

function resolveAxis(
  axis: SensitivityAxis,
  ctx: {
    selectedTicker: string | null;
    y1Label: string;
    y2Label: string;
    resolveDriverAxis: UseStockGuideData["resolveDriverAxis"];
  },
): ResolvedAxis {
  if (axis.kind === "company") {
    const labels = axis.companies ?? [];
    const idx = labels.findIndex((c) => c === ctx.selectedTicker);
    return {
      labels,
      marker: { highlightIdx: idx >= 0 ? idx : null, interp: null },
      caption: null,
    };
  }
  if (axis.kind === "year") {
    const labels = (axis.years ?? []).map((y) =>
      y === "y1" ? ctx.y1Label : y === "y2" ? ctx.y2Label : y,
    );
    return { labels, marker: NO_MARKER, caption: null };
  }
  // driver — `currentValue` is the EFFECTIVE today value (live for a dynamic
  // driver bound to a market metric, else the static `current_value`).
  const { driver, scenarios, currentValue } = ctx.resolveDriverAxis(axis);
  const unit = driver?.unit ?? "";
  const labels = scenarios.map((s) =>
    unit ? `${formatScenario(s)} ${unit}` : formatScenario(s),
  );
  const marker = driverMarker(scenarios, currentValue);
  const caption =
    driver != null && currentValue != null
      ? `Current: ${driver.name} = ${formatScenario(currentValue)}${unit ? ` ${unit}` : ""}`
      : null;
  return { labels, marker, caption };
}

/**
 * Scenario / current-value formatter. Integers print as-is; non-integers (e.g. a
 * live-computed dynamic driver value like 81.34) round to 1 decimal so the
 * caption / interpolated marker stay tidy.
 */
function formatScenario(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ── The orange interpolation triangle drawn between two header cells ──────────

// Max pixel budget the marker can slide back from the cell boundary toward the
// previous scenario's cell, to convey the PROPORTIONAL position of the current
// value between the two bracketing scenarios.
const INTERP_GAP_PX = 34;

function InterpMarker({
  orientation,
  frac,
}: {
  orientation: "horizontal" | "vertical";
  /** Proportional position 0..1 from the previous scenario → this boundary. */
  frac: number;
}): React.ReactElement {
  // The marker is anchored at the boundary (left/top edge of cell afterIdx+1).
  // frac=1 → current value sits at the boundary; frac→0 → near the previous
  // scenario, so we slide the line back by (1−frac)·GAP into the previous cell.
  const slide = -(1 - Math.min(Math.max(frac, 0), 1)) * INTERP_GAP_PX;
  // A thin continuous orange line (no arrowhead).
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        ...(orientation === "horizontal"
          ? { left: 0, top: 0, bottom: 0, width: 2, transform: `translateX(${slide - 1}px)` }
          : { top: 0, left: 0, right: 0, height: 2, transform: `translateY(${slide - 1}px)` }),
        background: BRAND_ORANGE,
        zIndex: 1,
      }}
    />
  );
}

// ── One sensitivity table (matrix) ────────────────────────────────────────────

function SensitivityTableView({
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
  const rowAxis = resolveAxis(table.definition.row_axis, ctx);
  const colAxis = resolveAxis(table.definition.col_axis, ctx);
  const nCols = colAxis.labels.length;
  const nRows = rowAxis.labels.length;

  // Derived modes are "live": render "—" while quotes load.
  const isLive = table.value_mode !== "absolute";

  const cellBase: React.CSSProperties = {
    ...TD_BASE,
    padding: "8px 14px",
    borderRight: "1px solid #ededed",
    borderBottom: "1px solid #ededed",
    color: "#1f2937",
    minWidth: 72,
    position: "relative",
  };

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Table header: title */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            fontWeight: 700,
            color: "#1a1a1a",
          }}
        >
          {table.title}
        </span>
      </div>

      {nCols === 0 || nRows === 0 ? (
        <div
          style={{
            padding: "20px 16px",
            color: "#9ca3af",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 12.5,
            border: "1px dashed #e0e0e0",
            borderRadius: 10,
            background: "#fafafa",
          }}
        >
          This table has no rows or columns to display.
        </div>
      ) : (
        <div
          style={{
            overflowX: "auto",
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            background: "#fff",
            display: "inline-block",
            maxWidth: "100%",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <table style={{ borderCollapse: "collapse", fontFamily: "Arial, Helvetica, sans-serif" }}>
            <thead>
              <tr>
                {/* Top-left corner = the metric label. */}
                <th
                  style={{
                    ...TH_BASE,
                    textAlign: "left",
                    verticalAlign: "bottom",
                    background: HEADER_BG,
                    color: HEADER_FG,
                    borderRight: "1px solid rgba(255,255,255,0.18)",
                    borderBottom: "1px solid rgba(255,255,255,0.18)",
                    fontSize: 11,
                    letterSpacing: "0.02em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {table.metric_label || "Value"}
                </th>
                {colAxis.labels.map((c, ci) => {
                  const hit = colAxis.marker.highlightIdx === ci;
                  const interpLeft =
                    colAxis.marker.interp != null && colAxis.marker.interp.afterIdx + 1 === ci;
                  return (
                    <th
                      key={ci}
                      style={{
                        ...TH_BASE,
                        textAlign: "right",
                        background: hit ? "#2a1206" : HEADER_BG,
                        borderRight: "1px solid rgba(255,255,255,0.12)",
                        borderBottom: "1px solid rgba(255,255,255,0.18)",
                        color: hit ? BRAND_ORANGE : HEADER_FG,
                        position: "relative",
                      }}
                    >
                      {/* Interpolation marker continues from the header into the
                          body at the proportional position (single line). */}
                      {interpLeft && colAxis.marker.interp && (
                        <InterpMarker orientation="horizontal" frac={colAxis.marker.interp.frac} />
                      )}
                      {c}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rowAxis.labels.map((rl, ri) => {
                const rowHit = rowAxis.marker.highlightIdx === ri;
                const rowInterpTop =
                  rowAxis.marker.interp != null && rowAxis.marker.interp.afterIdx + 1 === ri;
                return (
                  <tr key={ri}>
                    <th
                      scope="row"
                      style={{
                        ...TD_BASE,
                        textAlign: "right",
                        fontWeight: 700,
                        color: rowHit ? BRAND_ORANGE : "#374151",
                        background: rowHit
                          ? "rgba(255,80,0,0.10)"
                          : ri % 2 === 0
                            ? "#f5f5f5"
                            : "#f1f1f1",
                        borderRight: "1px solid #d6d6d6",
                        borderBottom: "1px solid #ededed",
                        padding: "8px 14px",
                        whiteSpace: "nowrap",
                        position: "relative",
                      }}
                    >
                      {/* Row-axis interpolation marker continues from the row label
                          into the body at the proportional position (single line). */}
                      {rowInterpTop && rowAxis.marker.interp && (
                        <InterpMarker orientation="vertical" frac={rowAxis.marker.interp.frac} />
                      )}
                      {rl}
                    </th>
                    {colAxis.labels.map((_, ci) => {
                      const colHit = colAxis.marker.highlightIdx === ci;
                      const colInterpLeft =
                        colAxis.marker.interp != null &&
                        colAxis.marker.interp.afterIdx + 1 === ci;
                      const inHighlightedLine = rowHit || colHit;
                      const { value, unit } = computeSensitivityCell(table, ri, ci);
                      const text =
                        isLive && quotesLoading ? "—" : formatSensitivityCell(value, unit);
                      return (
                        <td
                          key={ci}
                          style={{
                            ...cellBase,
                            background: inHighlightedLine
                              ? "rgba(255,80,0,0.06)"
                              : ri % 2 === 0
                                ? "#fff"
                                : "#fbfbfb",
                            fontWeight: inHighlightedLine ? 700 : 400,
                          }}
                        >
                          {/* Interpolation markers anchored on the boundary cell,
                              slid back proportionally by the driver's frac. */}
                          {colInterpLeft && colAxis.marker.interp && (
                            <InterpMarker orientation="horizontal" frac={colAxis.marker.interp.frac} />
                          )}
                          {rowInterpTop && rowAxis.marker.interp && (
                            <InterpMarker orientation="vertical" frac={rowAxis.marker.interp.frac} />
                          )}
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

      {/* Current-value captions (driver axes) */}
      {(rowAxis.caption || colAxis.caption) && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 11,
            color: "#9095a0",
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
// A "brent" / "margin" panel renders ONE TABLE PER DRIVER, stacked. Each driver
// table shows a shared dark scenario header (no top-left label) + a SINGLE
// column-axis interpolation marker (every row in the table shares the same
// driver). Inside, each underlying tagged static table is a gray band row (its
// metric label) followed by ONE ROW PER COMPANY in that table's row_axis
// (indented). Cells via computeSensitivityCell(table, rowIdx, colIdx).

const PANEL_TITLE: Record<SensitivityPanelKey, string> = {
  brent: "Brent sensitivity",
  margin: "EBITDA margin sensitivity",
};

const PANEL_PLACEHOLDER =
  "No tables configured yet — tag a sensitivity table to this panel in the Admin Panel.";

/** Format a scenario header value (integers as-is, else 1 decimal). */
function fmtScenarioHeader(v: number, unit: string): string {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return unit ? `${n} ${unit}` : n;
}

/**
 * One driver table inside a consolidated panel: a shared scenario header (one
 * column-axis interpolation marker), and per band a gray subheader row + one
 * indented company row each.
 */
function DriverSensitivityTable({
  driverTable,
  computeSensitivityCell,
  quotesLoading,
}: {
  driverTable: SensitivityDriverTable;
  computeSensitivityCell: UseStockGuideData["computeSensitivityCell"];
  quotesLoading: boolean;
}): React.ReactElement {
  const scenarios = driverTable.colScenarios;
  // SINGLE column-axis marker for the whole driver table (all rows share it).
  const marker = driverMarker(scenarios, driverTable.currentValue);
  const nCols = 1 + scenarios.length;

  const cellBase: React.CSSProperties = {
    ...TD_BASE,
    padding: "8px 14px",
    borderRight: "1px solid #ededed",
    borderBottom: "1px solid #ededed",
    color: "#1f2937",
    minWidth: 72,
    position: "relative",
  };

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Driver title — "Avg. Brent 2026 (USD/bbl)" */}
      <div
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12.5,
          fontWeight: 700,
          color: "#1a1a1a",
          marginBottom: 6,
        }}
      >
        {driverTable.driverLabel}
        {driverTable.driverUnit ? ` (${driverTable.driverUnit})` : ""}
      </div>

      <div
        style={{
          overflowX: "auto",
          border: "1px solid #e0e0e0",
          borderRadius: 12,
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "Arial, Helvetica, sans-serif" }}>
          <thead>
            <tr>
              {/* No label on the first column — just the scenario header. */}
              <th
                style={{
                  ...TH_BASE,
                  textAlign: "left",
                  background: HEADER_BG,
                  color: HEADER_FG,
                  borderRight: "1px solid rgba(255,255,255,0.18)",
                  borderBottom: "1px solid rgba(255,255,255,0.18)",
                  whiteSpace: "nowrap",
                  minWidth: 150,
                }}
              />
              {scenarios.map((s, ci) => {
                const hit = marker.highlightIdx === ci;
                const interpLeft =
                  marker.interp != null && marker.interp.afterIdx + 1 === ci;
                return (
                  <th
                    key={ci}
                    style={{
                      ...TH_BASE,
                      textAlign: "right",
                      background: hit ? "#2a1206" : HEADER_BG,
                      color: hit ? BRAND_ORANGE : HEADER_FG,
                      borderRight: "1px solid rgba(255,255,255,0.12)",
                      borderBottom: "1px solid rgba(255,255,255,0.18)",
                      position: "relative",
                    }}
                  >
                    {interpLeft && marker.interp && (
                      <InterpMarker orientation="horizontal" frac={marker.interp.frac} />
                    )}
                    {/* Number only — the unit lives in the driver-table title. */}
                    {fmtScenarioHeader(s, "")}
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
                      ...TD_BASE,
                      textAlign: "left",
                      fontWeight: 700,
                      fontSize: 11.5,
                      color: "#374151",
                      background: "#eef0f2",
                      borderBottom: "1px solid #dcdcdc",
                      borderTop: "1px solid #dcdcdc",
                      padding: "6px 14px",
                      whiteSpace: "nowrap",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {band.bandLabel}
                  </th>
                </tr>
                {band.rows.map((r, ri) => {
                  const isLive = band.table.value_mode !== "absolute";
                  return (
                    <tr
                      key={`${band.table.id}-${r.ticker}`}
                      style={{ background: ri % 2 === 0 ? "#fff" : "#fbfbfb" }}
                    >
                      <th
                        scope="row"
                        style={{
                          ...TD_BASE,
                          textAlign: "left",
                          fontWeight: 600,
                          color: "#374151",
                          background: ri % 2 === 0 ? "#fafafa" : "#f5f5f5",
                          borderRight: "1px solid #e0e0e0",
                          borderBottom: "1px solid #ededed",
                          padding: "7px 14px 7px 26px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.companyName}
                      </th>
                      {scenarios.map((_, ci) => {
                        const hit = marker.highlightIdx === ci;
                        const interpLeft =
                          marker.interp != null && marker.interp.afterIdx + 1 === ci;
                        const highlighted = hit || interpLeft;
                        const { value, unit } = computeSensitivityCell(
                          band.table,
                          r.rowIdx,
                          ci,
                        );
                        // A cell with NO typed primary value renders BLANK (the
                        // not-yet-filled rows); a typed-but-uncomputable cell (live
                        // mode while quotes load) shows "—".
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
                              ...cellBase,
                              background: highlighted
                                ? "rgba(255,80,0,0.08)"
                                : ri % 2 === 0
                                  ? "#fff"
                                  : "#fbfbfb",
                              color: hit ? BRAND_ORANGE : "#1f2937",
                              fontWeight: highlighted ? 700 : 400,
                            }}
                          >
                            {interpLeft && marker.interp && (
                              <InterpMarker orientation="horizontal" frac={marker.interp.frac} />
                            )}
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
        <div
          style={{
            marginTop: 6,
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 11,
            color: "#9095a0",
            lineHeight: 1.5,
          }}
        >
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
function ConsolidatedSensitivityBlock({
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
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 13,
          fontWeight: 700,
          color: "#1a1a1a",
          marginBottom: 10,
        }}
      >
        {PANEL_TITLE[panelKey]}
      </div>
      {panel == null ? (
        <div
          style={{
            padding: "22px 16px",
            color: "#9ca3af",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 12.5,
            border: "1px dashed #d8d8d8",
            borderRadius: 12,
            background: "#fafafa",
            lineHeight: 1.5,
          }}
        >
          {PANEL_PLACEHOLDER}
        </div>
      ) : (
        panel.driverTables.map((dt) => (
          <DriverSensitivityTable
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

// ─── Scenario-grid (multi-axis Brent mesh) panel ───────────────────────────────
//
// Renders when a table has `definition.grid`: ONE slider per axis (1..3, domain =
// the union of the uploaded mesh's levels, marker at the live "today" value) + a
// Target price / Upside table that interpolates the per-company mesh MULTILINEARLY
// as the analyst drags. Replaces the static matrix for that table.

function fmtSlider(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Fixed ±5 step for the scenario-grid axis steppers (analyst request — NOT the
 * dynamic `axis.step`). Manual typing is still free-form, clamped on commit.
 */
const GRID_AXIS_STEP = 5;

/** Clamp `v` to [min,max], returning `fallback` for non-finite input. */
function clampAxis(v: number, min: number, max: number, fallback: number): number {
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
function snapToStep(v: number, step: number, dir: number): number {
  if (!Number.isFinite(v) || step <= 0) return v;
  const EPS = 1e-9;
  if (dir > 0) {
    const up = (Math.floor(v / step + EPS) + 1) * step;
    return up;
  }
  const down = (Math.ceil(v / step - EPS) - 1) * step;
  return down;
}

/** One axis numeric stepper row inside the GridPanel (±5 buttons + number input). */
function AxisStepper({
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
  const [draft, setDraft] = useState<string>(fmtSlider(axis.value));
  useEffect(() => {
    setDraft(fmtSlider(axis.value));
  }, [axis.value]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    const next = clampAxis(parsed, axis.min, axis.max, axis.value);
    onSetAxis(tableId, axisIdx, next);
    setDraft(fmtSlider(next));
  };
  // Buttons snap to the next multiple of the step (round grid), not value+step.
  const bump = (dir: number) => {
    const snapped = snapToStep(axis.value, GRID_AXIS_STEP, dir);
    const next = clampAxis(snapped, axis.min, axis.max, axis.value);
    onSetAxis(tableId, axisIdx, next);
  };

  const stepBtnStyle: CSSProperties = {
    width: 26,
    height: 28,
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #e6e6e6",
    background: "#fff",
    color: axis.disabled ? "#cbd5e1" : BRAND_ORANGE,
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1,
    cursor: axis.disabled ? "not-allowed" : "pointer",
    fontFamily: "Arial, Helvetica, sans-serif",
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 6,
          fontFamily: "Arial, Helvetica, sans-serif",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#1f2937", lineHeight: 1.25 }}>
          {axis.label} ({axis.unit})
        </span>
        {axis.overridden && !axis.disabled && (
          <button
            type="button"
            onClick={() => onResetAxis(tableId, axisIdx)}
            title="Reset to live"
            aria-label={`Reset ${axis.label} to live`}
            style={{
              flex: "0 0 auto",
              border: "none",
              background: "none",
              padding: 0,
              cursor: "pointer",
              color: BRAND_ORANGE,
              fontSize: 10.5,
              fontWeight: 700,
              fontFamily: "Arial, Helvetica, sans-serif",
              textDecoration: "underline",
            }}
          >
            ↺ live
          </button>
        )}
      </div>

      {axis.disabled ? (
        <span
          style={{
            display: "inline-block",
            fontSize: 11.5,
            fontWeight: 700,
            color: "#9ca3af",
            fontVariantNumeric: "tabular-nums",
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            borderRadius: 7,
            padding: "5px 10px",
          }}
        >
          fixed {fmtSlider(axis.value)} {axis.unit}
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0, flex: "0 0 auto" }}>
            <button
              type="button"
              onClick={() => bump(-1)}
              disabled={axis.value <= axis.min}
              aria-label={`Decrease ${axis.label} to previous multiple of ${GRID_AXIS_STEP}`}
              style={{
                ...stepBtnStyle,
                borderRadius: "7px 0 0 7px",
                opacity: axis.value <= axis.min ? 0.45 : 1,
              }}
            >
              −
            </button>
            <input
              className="sg-axis-stepper-input"
              type="number"
              inputMode="decimal"
              step={GRID_AXIS_STEP}
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
                width: 64,
                textAlign: "center",
                border: "1px solid #e6e6e6",
                borderLeft: "none",
                borderRight: "none",
                padding: "5px 2px",
                fontSize: 13,
                fontWeight: 700,
                color: BRAND_ORANGE,
                fontFamily: "Arial, Helvetica, sans-serif",
                fontVariantNumeric: "tabular-nums",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => bump(1)}
              disabled={axis.value >= axis.max}
              aria-label={`Increase ${axis.label} to next multiple of ${GRID_AXIS_STEP}`}
              style={{
                ...stepBtnStyle,
                borderRadius: "0 7px 7px 0",
                opacity: axis.value >= axis.max ? 0.45 : 1,
              }}
            >
              +
            </button>
          </div>
          <span
            style={{
              fontSize: 10.5,
              color: axis.liveValue != null ? BRAND_ORANGE : "#9ca3af",
              fontWeight: 600,
              fontFamily: "Arial, Helvetica, sans-serif",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.25,
            }}
          >
            {axis.liveValue != null ? `live ${fmtSlider(axis.liveValue)}` : "live —"}
          </span>
        </div>
      )}
    </div>
  );
}

function GridPanel({
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
    <div style={{ marginBottom: 28 }}>
      {/* Title */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
          {table.title}
        </span>
      </div>
      <div
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 11.5,
          color: "#9ca3af",
          marginBottom: 14,
        }}
      >
        Adjust the assumptions to re-price live across our scenario mesh. Markers
        show today&rsquo;s values.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 280px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ── Axis sliders (1..3, stacked) — narrow control rail ────────────── */}
        <div
          style={{
            border: "1px solid #e6e6e6",
            borderRadius: 10,
            background: "#fff",
            padding: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {model.axes.map((axis, i) => (
            <AxisStepper
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
                padding: "4px 10px",
                borderRadius: 12,
                cursor: "pointer",
                border: `1px solid ${BRAND_ORANGE}`,
                background: BRAND_ORANGE,
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              Reset all to live
            </button>
          )}
        </div>

        {/* ── Output table (one column per configured output) ───────────────── */}
        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            background: "#fff",
            overflowX: "auto",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "Arial, Helvetica, sans-serif" }}>
            <thead>
              <tr>
                <th style={{ ...TH_BASE, textAlign: "left" }}>Company</th>
                {model.outputs.map((o) => {
                  const cols = [
                    <th key={o.key} style={{ ...TH_BASE, textAlign: "right" }}>
                      {o.label}
                    </th>,
                  ];
                  // An 'upside' output shows the interpolated price column then a
                  // derived Upside column (vs the live share price).
                  if (o.mode === "upside") {
                    cols.push(
                      <th key={`${o.key}-up`} style={{ ...TH_BASE, textAlign: "right" }}>
                        Upside
                      </th>,
                    );
                  }
                  return cols;
                })}
              </tr>
            </thead>
            <tbody>
              {model.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      1 + model.outputs.length + model.outputs.filter((o) => o.mode === "upside").length
                    }
                    style={{ ...TD_BASE, textAlign: "center", color: "#9ca3af", padding: "24px 10px" }}
                  >
                    No companies to re-price.
                  </td>
                </tr>
              ) : (
                model.rows.map((r, i) => {
                  const bg = i % 2 === 0 ? "#fff" : "#fbfbfb";
                  return (
                    <tr key={r.ticker} style={{ background: bg }}>
                      <td style={{ ...TD_BASE, textAlign: "left", fontWeight: 700, color: "#111827" }}>
                        {r.companyName}
                      </td>
                      {model.outputs.map((o) => {
                        const cell = r.values[o.key];
                        if (o.mode === "upside") {
                          // Primary cell = the interpolated target PRICE (raw BRL);
                          // the derived Upside ratio comes from the live price.
                          const upside =
                            cell?.raw != null && r.livePrice != null && r.livePrice > 0
                              ? cell.raw / r.livePrice - 1
                              : null;
                          const upsideColor =
                            upside == null
                              ? "#1a1a1a"
                              : upside > 0
                                ? "#15803d"
                                : upside < 0
                                  ? "#b91c1c"
                                  : "#6b7280";
                          return [
                            <td key={o.key} style={{ ...TD_BASE }}>
                              {cell?.raw == null ? "—" : fmtSlider(cell.raw)}
                            </td>,
                            <td key={`${o.key}-up`} style={{ ...TD_BASE, color: upsideColor, fontWeight: 700 }}>
                              {quotesLoading && upside == null ? "—" : fmtSignedPct(upside)}
                            </td>,
                          ];
                        }
                        const showDash = quotesLoading && cell?.value == null;
                        return (
                          <td key={o.key} style={{ ...TD_BASE }}>
                            {showDash ? "—" : formatSensitivityCell(cell?.value ?? null, o.unit)}
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
      </div>
    </div>
  );
}

// ── One grid table, mesh fetched LAZILY when it scrolls into view ─────────────

function GridInView({
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
  // Fire the (idempotent) mesh fetch the first time this block scrolls in.
  const ref = useInViewOnce<HTMLDivElement>(() => ensureGridLoaded(table.id));
  const model = getGridModel(table);
  return (
    <div ref={ref}>
      {model ? (
        <GridPanel
          table={table}
          model={model}
          onSetAxis={onSetGridAxis}
          onResetAxis={onResetGridAxis}
          onResetAll={onResetGridAll}
          quotesLoading={quotesLoading}
        />
      ) : (
        // Mesh not fetched yet / empty → loading spinner or empty card.
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
            {table.title}
          </div>
          {gridLoading ? (
            <div style={{ padding: "24px 0" }}>
              <BarrelLoading />
            </div>
          ) : (
            <div
              style={{
                padding: "20px 16px",
                color: "#9ca3af",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 12.5,
                border: "1px dashed #e0e0e0",
                borderRadius: 10,
                background: "#fafafa",
              }}
            >
              No scenario-grid points uploaded for this table yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── The whole sensitivity section (consolidated, always-visible) ──────────────

function SensitivitySection({
  panelByKey,
  unpanneledTables,
  gridTables,
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
      {/* ── Two always-rendered block frames: Brent (left) · Margin (right) ──── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
          gap: 24,
          alignItems: "start",
        }}
      >
        <ConsolidatedSensitivityBlock
          panelKey="brent"
          panel={panelByKey.brent}
          computeSensitivityCell={computeSensitivityCell}
          quotesLoading={quotesLoading}
        />
        <ConsolidatedSensitivityBlock
          panelKey="margin"
          panel={panelByKey.margin}
          computeSensitivityCell={computeSensitivityCell}
          quotesLoading={quotesLoading}
        />
      </div>

      {/* ── Generic fallback: untagged static tables, full-width ─────────────── */}
      {unpanneledTables.length > 0 && (
        <div style={{ marginTop: 32 }}>
          {unpanneledTables.map((t) => (
            <SensitivityTableView
              key={t.id}
              table={t}
              selectedTicker={null}
              y1Label={y1Label}
              y2Label={y2Label}
              resolveDriverAxis={resolveDriverAxis}
              computeSensitivityCell={computeSensitivityCell}
              quotesLoading={quotesLoading}
            />
          ))}
        </div>
      )}

      {/* ── Scenario-grid tables, always visible, lazy mesh on scroll-in ─────── */}
      {gridTables.length > 0 && (
        <div style={{ marginTop: 32 }}>
          {gridTables.map((t) => (
            <GridInView
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
      )}
    </div>
  );
}

// ─── Refresh-quotes button ─────────────────────────────────────────────────────

function RefreshQuotesButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="btn btn-outline-secondary btn-sm"
      onClick={onClick}
      disabled={loading}
      style={{ fontFamily: "Arial", whiteSpace: "nowrap" }}
      title="Re-fetch live prices (one batched request)"
    >
      {loading ? "Refreshing…" : "↻ Refresh quotes"}
    </button>
  );
}

// ─── View ──────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("stock-guide");
  const {
    rows,
    loading: rpcLoading,
    error: rpcError,
    refetch,
    config,
    computedRows,
    restrictedNames,
    unitMarginNote,
    quotesLoading,
    refreshQuotes,
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
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  } = useStockGuideData();

  const initialLoading = rpcLoading && rows.length === 0 && rpcError == null;

  if (visLoading || !visible) return <></>;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0 p-4">
        <DashboardHeader
          title="Stock Guide"
          sub="Coverage comps table and key-estimate sensitivity"
          lang="en"
          rightSlot={
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <RefreshQuotesButton onClick={refreshQuotes} loading={quotesLoading} />
              <ExportPanel
                actions={[
                  {
                    kind: "excel",
                    label: "Excel",
                    onClick: exportExcel,
                    busy: excelLoading,
                    disabled: excelLoading || computedRows.length === 0,
                    loadingLabel: "Generating Excel…",
                  },
                  {
                    kind: "csv",
                    label: "CSV",
                    onClick: exportCsv,
                    busy: csvLoading,
                    disabled: csvLoading || computedRows.length === 0,
                    loadingLabel: "Generating CSV…",
                  },
                ]}
              />
            </div>
          }
        />

        <DataErrorBoundary error={rpcError} loading={rpcLoading} retry={refetch}>
          {initialLoading ? (
            <BarrelLoading />
          ) : (
            <>
              {/* ── Comps table ─────────────────────────────────────────────── */}
              <CompsTable
                rows={computedRows}
                y1Label={config.y1_label}
                y2Label={config.y2_label}
                quotesLoading={quotesLoading}
              />

              {/* ── Footnotes ───────────────────────────────────────────────── */}
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: "1px solid #f0f0f0",
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 11,
                  color: "#9095a0",
                  lineHeight: 1.65,
                }}
              >
                {config.assumptions_note && (
                  <div>
                    <strong style={{ color: "#6b7280" }}>Assumptions:</strong>{" "}
                    {config.assumptions_note}
                  </div>
                )}
                <div>{VOLUME_UNIT_NOTE}</div>
                <div>
                  Market cap, upside, EV/EBITDA, P/E, FCFE Yield and Div Yield are
                  computed live from the latest available price (BRL) and our latest
                  published estimates (net debt, EBITDA, net income, FCFE, dividends).
                </div>
                {unitMarginNote && <div>{unitMarginNote}</div>}
                {restrictedNames.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <strong style={{ color: "#6b7280" }}>Currently restricted:</strong>{" "}
                    {restrictedNames.join(", ")}.
                  </div>
                )}
              </div>

              {/* ── Sensitivity (consolidated, always-visible) ──────────────── */}
              <div style={{ marginTop: 32 }}>
                <div className="section-title">Sensitivity</div>
                <hr className="section-hr" style={{ borderTopColor: "#e0e0e0", margin: "4px 0 10px" }} />
                <div
                  style={{
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 11.5,
                    color: "#9ca3af",
                    marginBottom: 16,
                  }}
                >
                  Sensitivity of our key estimates to Brent and distribution
                  margins. Orange marks today&rsquo;s value.
                </div>
                <SensitivitySection
                  panelByKey={panelByKey}
                  unpanneledTables={unpanneledTables}
                  gridTables={gridTables}
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
        </DataErrorBoundary>
      </div>
    </div>
  );
}

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
  ElasticTableModel,
  ElasticSlider,
} from "../useStockGuideData";
import { fmtSignedPct } from "../useStockGuideData";
import type {
  StockGuideComputedRow,
  SensitivityTable,
  SensitivityAxis,
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
  selectedTicker,
  onSelect,
  quotesLoading,
}: {
  rows: StockGuideComputedRow[];
  y1Label: string;
  y2Label: string;
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
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
      {/* Hover affordance — overrides the inline zebra background on non-selected
          rows only. Scoped to this table via the .sg-comps-wrap wrapper. */}
      <style>{`
        .sg-comps-wrap tbody tr:not([data-sel="1"]):hover > td {
          background: #f3f6fb !important;
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
              const isSel = r.ticker === selectedTicker;
              const rowBg = isSel ? "rgba(255,80,0,0.06)" : i % 2 === 0 ? "#fff" : "#fbfbfb";
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
                  key={r.ticker}
                  data-sel={isSel ? "1" : "0"}
                  onClick={() => onSelect(r.ticker)}
                  style={{ cursor: "pointer", background: rowBg }}
                >
                  {/* Sticky Company cell */}
                  <td
                    style={{
                      ...TD_BASE,
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      textAlign: "left",
                      fontWeight: 700,
                      color: "#111827",
                      width: STICKY_COL_WIDTH,
                      minWidth: STICKY_COL_WIDTH,
                      background: rowBg,
                      borderRight: "1px solid #e0e0e0",
                      borderLeft: isSel ? `3px solid ${BRAND_ORANGE}` : "3px solid transparent",
                      boxShadow: STICKY_SHADOW,
                    }}
                  >
                    {r.company_name}
                  </td>
                  {SINGLE_COLS.map((c) => {
                    switch (c.id) {
                      case "ticker":
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>
                            {r.ticker}
                          </td>
                        );
                      case "last_update":
                        return (
                          <td key={c.id} style={{ ...TD_BASE, color: "#9ca3af" }}>
                            {r.last_update ?? "—"}
                          </td>
                        );
                      case "recommendation":
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "right" }}>
                            <RecommendationChip code={r.recommendation} />
                          </td>
                        );
                      case "tp":
                        // Centered + whole-number (Eduardo review): 64.00 → 64.
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "center" }}>
                            {fmtInt(r.target_price)}
                          </td>
                        );
                      case "current_price":
                        // Live price from the same Yahoo quote that feeds market
                        // cap / upside. Kept at 2 decimals (price precision).
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "center" }}>
                            {quotesLoading && r.livePrice == null ? "—" : fmtNum(r.livePrice, 2)}
                          </td>
                        );
                      case "upside":
                        // Whole-percent (Eduardo review): +27.5% → +28%.
                        return (
                          <td key={c.id} style={{ ...TD_BASE, color: upsideColor, fontWeight: 700 }}>
                            {quotesLoading && r.upsidePct == null ? "—" : fmtSignedPctWhole(r.upsidePct)}
                          </td>
                        );
                      case "market_cap":
                        return (
                          <td key={c.id} style={{ ...TD_BASE, textAlign: "center" }}>
                            {quotesLoading && r.marketCapBrlMn == null ? "—" : fmtMn(r.marketCapBrlMn)}
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

/** Small 3×3 grid glyph for the sensitivity empty-state. */
function GridGlyph(): React.ReactElement {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#cbcbcb"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={3} y={3} width={18} height={18} rx={2.5} />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </svg>
  );
}

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
  // A thin orange line + a small triangle pointing into the matrix.
  const tri =
    orientation === "horizontal"
      ? { borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `6px solid ${BRAND_ORANGE}` }
      : { borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: `6px solid ${BRAND_ORANGE}` };
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
    >
      <span
        style={{
          position: "absolute",
          ...(orientation === "horizontal" ? { top: -1, left: -4 } : { left: -1, top: -4 }),
          width: 0,
          height: 0,
          ...tri,
        }}
      />
    </span>
  );
}

// ── One sensitivity table (matrix) ────────────────────────────────────────────

const VALUE_MODE_BADGE: Record<SensitivityTable["value_mode"], string> = {
  absolute: "Absolute",
  yield: "Yield",
  pe: "P/E",
  ev_ebitda: "EV/EBITDA",
  upside: "Upside",
};

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

  // Badge text: "FCFE · BRL mn" or "EV/EBITDA · ×" or "FCFE Yield · %".
  const unitForBadge =
    table.value_mode === "absolute"
      ? table.unit
      : table.value_mode === "yield" || table.value_mode === "upside"
        ? "%"
        : "×";
  const badge = `${table.metric_label || VALUE_MODE_BADGE[table.value_mode]}${
    unitForBadge ? ` · ${unitForBadge}` : ""
  }`;

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
      {/* Table header: title + badge */}
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
        <span
          style={{
            display: "inline-block",
            padding: "2px 9px",
            borderRadius: 4,
            background: "rgba(255,80,0,0.10)",
            color: BRAND_ORANGE,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          {badge}
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

// ─── Elastic (coefficient) panel ──────────────────────────────────────────────
//
// Renders when a table has `definition.compose`: continuous sliders for Brent /
// FX by year (2026-2028) + a preset selector + a Target price / Upside table that
// re-prices live as the analyst drags. Replaces the static matrix for that table.

function fmtSlider(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** A single labelled slider (one driver_key / year). */
function ElasticSliderRow({
  slider,
  onChange,
}: {
  slider: ElasticSlider;
  onChange: (level: number) => void;
}): React.ReactElement {
  const atAnchor = slider.level === slider.anchor;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1f2937" }}>
          {slider.label}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: BRAND_ORANGE, fontVariantNumeric: "tabular-nums" }}>
          {fmtSlider(slider.level)}
          {slider.unit ? <span style={{ color: "#9ca3af", fontWeight: 600 }}> {slider.unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        min={slider.min}
        max={slider.max}
        step={slider.step}
        value={slider.level}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${slider.label} (${slider.unit})`}
        style={{ width: "100%", accentColor: BRAND_ORANGE, cursor: "pointer" }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 10,
          color: "#9ca3af",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{fmtSlider(slider.min)}</span>
        <span style={{ color: atAnchor ? BRAND_ORANGE : "#9ca3af" }}>
          anchor {fmtSlider(slider.anchor)}
          {slider.liveValue != null ? ` · live ${fmtSlider(slider.liveValue)}` : ""}
        </span>
        <span>{fmtSlider(slider.max)}</span>
      </div>
    </div>
  );
}

function ElasticPanel({
  table,
  model,
  onSetLevel,
  onSetPreset,
  quotesLoading,
}: {
  table: SensitivityTable;
  model: ElasticTableModel;
  onSetLevel: (tableId: number, key: string, level: number) => void;
  onSetPreset: (tableId: number, preset: string) => void;
  quotesLoading: boolean;
}): React.ReactElement {
  // Group sliders by family (Brent / FX / other) preserving the model's order.
  const groups: { type: ElasticSlider["type"]; label: string; sliders: ElasticSlider[] }[] = [];
  const groupLabel = (t: ElasticSlider["type"]) =>
    t === "brent" ? "Brent (USD/bbl)" : t === "fx" ? "FX (USD/BRL)" : "Drivers";
  for (const s of model.sliders) {
    let g = groups.find((x) => x.type === s.type);
    if (!g) {
      g = { type: s.type, label: groupLabel(s.type), sliders: [] };
      groups.push(g);
    }
    g.sliders.push(s);
  }

  const presetOptions = ["Live", ...model.presetNames];

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Title + elastic badge */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
          {table.title}
        </span>
        <span
          style={{
            display: "inline-block",
            padding: "2px 9px",
            borderRadius: 4,
            background: "rgba(255,80,0,0.10)",
            color: BRAND_ORANGE,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          Elastic · {model.outputLabel}
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
        Drag Brent / FX by year to re-price live. Pick a scenario or reset to Live
        market values.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1.1fr) minmax(280px, 1fr)",
          gap: 24,
          alignItems: "start",
        }}
      >
        {/* ── Sliders + presets ─────────────────────────────────────────────── */}
        <div
          style={{
            border: "1px solid #e6e6e6",
            borderRadius: 12,
            background: "#fff",
            padding: 18,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {/* Scenario selector */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              Scenario
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {presetOptions.map((p) => {
                const on = model.preset === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onSetPreset(table.id, p)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 14,
                      cursor: "pointer",
                      border: on ? `1px solid ${BRAND_ORANGE}` : "1px solid #e0e0e0",
                      background: on ? "rgba(255,80,0,0.10)" : "#fff",
                      color: on ? BRAND_ORANGE : "#666",
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    {p}
                  </button>
                );
              })}
              {model.preset === "Custom" && (
                <span
                  style={{
                    padding: "5px 12px",
                    borderRadius: 14,
                    border: `1px solid ${BRAND_ORANGE}`,
                    background: "rgba(255,80,0,0.10)",
                    color: BRAND_ORANGE,
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "Arial, Helvetica, sans-serif",
                  }}
                >
                  Custom
                </span>
              )}
            </div>
          </div>

          {/* Slider groups */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {groups.map((g) => (
              <div key={g.type}>
                <div
                  style={{
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#6b7280",
                    marginBottom: 10,
                  }}
                >
                  {g.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {g.sliders.map((s) => (
                    <ElasticSliderRow
                      key={s.key}
                      slider={s}
                      onChange={(level) => onSetLevel(table.id, s.key, level)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Output table (Target price / Upside) ──────────────────────────── */}
        <div
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            background: "#fff",
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "Arial, Helvetica, sans-serif" }}>
            <thead>
              <tr>
                <th style={{ ...TH_BASE, textAlign: "left" }}>Company</th>
                <th style={{ ...TH_BASE, textAlign: "right" }}>{model.outputLabel}</th>
                <th style={{ ...TH_BASE, textAlign: "right" }}>Upside</th>
                <th style={{ ...TH_BASE, textAlign: "right" }}>vs base</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ ...TD_BASE, textAlign: "center", color: "#9ca3af", padding: "24px 10px" }}>
                    No companies to re-price.
                  </td>
                </tr>
              ) : (
                model.rows.map((r, i) => {
                  const bg = i % 2 === 0 ? "#fff" : "#fbfbfb";
                  const upsideColor =
                    r.upside == null
                      ? "#1a1a1a"
                      : r.upside > 0
                        ? "#15803d"
                        : r.upside < 0
                          ? "#b91c1c"
                          : "#6b7280";
                  const delta =
                    r.targetPrice != null && r.basePrice != null
                      ? r.targetPrice - r.basePrice
                      : null;
                  const deltaTxt =
                    delta == null
                      ? "—"
                      : `${delta > 0 ? "+" : ""}${fmtSlider(delta)}`;
                  return (
                    <tr key={r.ticker} style={{ background: bg }}>
                      <td style={{ ...TD_BASE, textAlign: "left", fontWeight: 700, color: "#111827" }}>
                        {r.companyName}
                      </td>
                      <td style={{ ...TD_BASE }}>
                        {r.targetPrice == null ? "—" : fmtSlider(r.targetPrice)}
                      </td>
                      <td style={{ ...TD_BASE, color: upsideColor, fontWeight: 700 }}>
                        {quotesLoading && r.upside == null ? "—" : fmtSignedPct(r.upside)}
                      </td>
                      <td style={{ ...TD_BASE, color: "#9ca3af" }}>{deltaTxt}</td>
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

// ── The whole sensitivity section for the selected company ────────────────────

function SensitivitySection({
  tables,
  loading,
  companyName,
  selectedTicker,
  y1Label,
  y2Label,
  resolveDriverAxis,
  computeSensitivityCell,
  isElasticTable,
  getElasticModel,
  onSetElasticLevel,
  onSetElasticPreset,
  quotesLoading,
}: {
  tables: SensitivityTable[];
  loading: boolean;
  companyName: string | null;
  selectedTicker: string | null;
  y1Label: string;
  y2Label: string;
  resolveDriverAxis: UseStockGuideData["resolveDriverAxis"];
  computeSensitivityCell: UseStockGuideData["computeSensitivityCell"];
  isElasticTable: UseStockGuideData["isElasticTable"];
  getElasticModel: UseStockGuideData["getElasticModel"];
  onSetElasticLevel: UseStockGuideData["setElasticDriverLevel"];
  onSetElasticPreset: UseStockGuideData["setElasticPreset"];
  quotesLoading: boolean;
}): React.ReactElement {
  if (loading) {
    return (
      <div style={{ padding: "32px 0" }}>
        <BarrelLoading />
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "36px 16px",
          textAlign: "center",
          color: "#9ca3af",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 13,
          border: "1px dashed #d8d8d8",
          borderRadius: 12,
          background: "#fafafa",
        }}
      >
        <GridGlyph />
        <div>
          No sensitivity tables for{" "}
          <strong style={{ color: "#6b7280" }}>{companyName ?? "this company"}</strong> yet.
        </div>
      </div>
    );
  }

  return (
    <div>
      {tables.map((t) => {
        const model = isElasticTable(t) ? getElasticModel(t) : null;
        if (model) {
          return (
            <ElasticPanel
              key={t.id}
              table={t}
              model={model}
              onSetLevel={onSetElasticLevel}
              onSetPreset={onSetElasticPreset}
              quotesLoading={quotesLoading}
            />
          );
        }
        return (
          <SensitivityTableView
            key={t.id}
            table={t}
            selectedTicker={selectedTicker}
            y1Label={y1Label}
            y2Label={y2Label}
            resolveDriverAxis={resolveDriverAxis}
            computeSensitivityCell={computeSensitivityCell}
            quotesLoading={quotesLoading}
          />
        );
      })}
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
    adjustedEarningsNote,
    quotesLoading,
    refreshQuotes,
    selectedTicker,
    selectTicker,
    selectedTables,
    resolveDriverAxis,
    computeSensitivityCell,
    isElasticTable,
    getElasticModel,
    setElasticDriverLevel,
    setElasticPreset,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  } = useStockGuideData();

  const initialLoading = rpcLoading && rows.length === 0 && rpcError == null;

  const selectedCompanyName =
    computedRows.find((r) => r.ticker === selectedTicker)?.company_name ?? null;

  if (visLoading || !visible) return <></>;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0 p-4">
        <DashboardHeader
          title="Stock Guide"
          sub="Coverage comps table and per-company sensitivity"
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
                selectedTicker={selectedTicker}
                onSelect={selectTicker}
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
                {adjustedEarningsNote && <div>{adjustedEarningsNote}</div>}
                {restrictedNames.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <strong style={{ color: "#6b7280" }}>Currently restricted:</strong>{" "}
                    {restrictedNames.join(", ")}.
                  </div>
                )}
              </div>

              {/* ── Sensitivity tables ──────────────────────────────────────── */}
              <div style={{ marginTop: 32 }}>
                <div className="section-title">
                  Sensitivity
                  {selectedCompanyName && (
                    <span style={{ color: "#1a1a1a", fontWeight: 600 }}>
                      {" "}— {selectedCompanyName}
                    </span>
                  )}
                </div>
                <hr className="section-hr" style={{ borderTopColor: "#e0e0e0", margin: "4px 0 10px" }} />
                <div
                  style={{
                    fontFamily: "Arial, Helvetica, sans-serif",
                    fontSize: 11.5,
                    color: "#9ca3af",
                    marginBottom: 16,
                  }}
                >
                  Click a company row above to see the sensitivity tables it
                  appears in. Static tables highlight the row/column matching the
                  driver&rsquo;s current value (orange); elastic tables let you
                  drag Brent / FX by year to re-price the target price live.
                </div>
                <SensitivitySection
                  tables={selectedTables}
                  loading={rpcLoading && rows.length === 0}
                  companyName={selectedCompanyName}
                  selectedTicker={selectedTicker}
                  y1Label={config.y1_label}
                  y2Label={config.y2_label}
                  resolveDriverAxis={resolveDriverAxis}
                  computeSensitivityCell={computeSensitivityCell}
                  isElasticTable={isElasticTable}
                  getElasticModel={getElasticModel}
                  onSetElasticLevel={setElasticDriverLevel}
                  onSetElasticPreset={setElasticPreset}
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

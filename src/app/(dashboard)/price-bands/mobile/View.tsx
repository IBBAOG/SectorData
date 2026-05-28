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
//   Petrobras gap table — 3 rows showing Petrobras price vs IPP, EPP, IPP w/ sub
//                        (mirrors the badges above the desktop chart, since
//                        mobile has no horizontal room for the badge row)
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
import type { PlotData, Layout } from "plotly.js";

import {
  MobileTabBar,
  MobileChart,
} from "@/components/dashboard/mobile";
import BarrelLoading from "@/components/dashboard/BarrelLoading";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  usePriceBandsData,
  fmtDateLabel,
  COLOR_IMPORT,
  COLOR_EXPORT,
  COLOR_PETRO,
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

// ─── Petrobras gap table (mirrors desktop badges) ─────────────────────────────
//
// Mobile substitutes the legacy Latest/MoM/YoY columns with the same gap
// information the desktop view shows as colored badges directly above the
// chart (Petrobras vs IPP / EPP / IPP w/ subsidy). Mobile has no room for
// the badge row, so we render the values in a small table instead.

interface GapRow {
  label: string;      // e.g. "vs. IPP"
  numerator: string;  // e.g. "Petrobras" or "Petr. w/ sub"
  denominator: string; // e.g. "BBA Import Parity"
  pct: number | null; // % difference (Petrobras / reference - 1) * 100
  outlined: boolean;  // EPP uses outlined style on desktop
}

function buildGapRows(
  product: PriceBandsProduct,
  cv: {
    pctVsIpp: number | null;
    pctVsEpp: number | null;
    pctVsIppSubsidy: number | null;
  },
): GapRow[] {
  const rows: GapRow[] = [
    {
      label: "vs. IPP",
      numerator: "Petrobras",
      denominator: "BBA Import Parity",
      pct: cv.pctVsIpp,
      outlined: false,
    },
    {
      label: "vs. EPP",
      numerator: "Petrobras",
      denominator: "BBA Export Parity",
      pct: cv.pctVsEpp,
      outlined: true,
    },
  ];

  // Subsidy gap: Diesel only (Gasoline has no subsidy).
  if (product === "Diesel") {
    rows.push({
      label: "vs. IPP w/ sub",
      numerator: "Petrobras",
      denominator: "BBA Import Parity w/ subsidy",
      pct: cv.pctVsIppSubsidy,
      outlined: false,
    });
  }

  return rows;
}

function fmtPctCell(pct: number | null): { text: string; positive: boolean | null } {
  if (pct == null) return { text: "—", positive: null };
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  return { text, positive: pct >= 0 };
}

// ─── End-of-line data labels (Petrobras-on-the-tip values) ──────────────────
//
// For each visible trace in the chart, draw a small annotation anchored to the
// LAST non-null point showing the latest R$ value. The Plotly layer doesn't
// stack annotations automatically — when two final values are very close in
// price space, the labels overlap. We deconflict in two passes:
//
//   1. Compute one annotation per series (date + value + color).
//   2. Sort by y (asc) and walk the list: if two adjacent labels are within
//      MIN_LABEL_SPACING (in data-units), shift the upper one up just enough.
//
// We work in data-units instead of pixels because annotations with `xref:"x"`
// and `yref:"y"` use data coordinates; converting to pixels would require
// reading the rendered plot dimensions. Data-space deconfliction is good
// enough for the typical R$ 2.50–7.00 range in this chart.

interface EndLabel {
  trace: string;
  x: string;
  y: number;
  color: string;
  text: string;
}

/** Data-label format: bare number, no "R$" prefix.
 * Currency context already lives on the Y-axis (`tickprefix: "R$ "`). Repeating
 * the prefix on every label clutters the chart, especially when 5 labels stack
 * at the right edge. */
function fmtBrl(v: number): string {
  return v.toFixed(2);
}

function buildEndLabels(
  rows: PriceBandsRow[],
  product: PriceBandsProduct,
  xMin: string | null,
  xMax: string | null,
  visibleKeys: Set<SeriesKey>,
): EndLabel[] {
  const seriesDefs = product === "Gasoline" ? GAS_SERIES : DSL_SERIES;

  const filtered = rows
    .filter((r) => r.product === product)
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) return [];

  const labels: EndLabel[] = [];

  for (const s of seriesDefs) {
    const chipKey = chipForField(s.field as string);
    if (!chipKey || !visibleKeys.has(chipKey)) continue;

    // Find last non-null point for this series within the window.
    let lastIdx = -1;
    for (let i = filtered.length - 1; i >= 0; i--) {
      const v = filtered[i][s.field as keyof PriceBandsRow];
      if (typeof v === "number" && Number.isFinite(v)) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx < 0) continue;

    const last = filtered[lastIdx];
    const value = last[s.field as keyof PriceBandsRow] as number;
    labels.push({
      trace: s.label,
      x: last.date,
      y: value,
      color: s.color,
      text: fmtBrl(value),
    });
  }

  return labels;
}

/**
 * Deconflict label y-positions in data space. Returns annotations[] with a
 * `_yShift` field consumed downstream to convert to Plotly's `yshift` (pixels).
 *
 * Algorithm: sort labels by raw y ascending; walk the list; if neighbour i+1
 * is within minDelta of neighbour i, push i+1 upwards just enough to maintain
 * minDelta. We do not "balance" symmetrically — pushing only upward keeps
 * labels closer to their true y (the bottom-most stays anchored) which reads
 * more naturally than centering.
 */
function deconflictLabels(
  labels: EndLabel[],
  minDelta: number,
): Array<EndLabel & { displayY: number }> {
  if (labels.length === 0) return [];
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  const out: Array<EndLabel & { displayY: number }> = [];
  let prevDisplayY = -Infinity;
  for (const lab of sorted) {
    const displayY = Math.max(lab.y, prevDisplayY + minDelta);
    out.push({ ...lab, displayY });
    prevDisplayY = displayY;
  }
  return out;
}

/** Convert EndLabel[] to Plotly annotation objects.
 *
 * Returns an unstructured shape that we cast through `any` at the call site —
 * Plotly's Annotation type is exposed via `Layout["annotations"]` but
 * importing the concrete type is awkward (it's a non-exported union member).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelsToAnnotations(labels: Array<EndLabel & { displayY: number }>): any[] {
  return labels.map((lab) => ({
    xref: "x",
    yref: "y",
    x: lab.x,
    y: lab.displayY,
    xanchor: "left",
    yanchor: "middle",
    xshift: 6,
    text: `<b>${lab.text}</b>`,
    showarrow: false,
    font: {
      family: "Arial, Helvetica, sans-serif",
      size: 10,
      color: lab.color,
    },
    bgcolor: "rgba(255,255,255,0.85)",
    borderpad: 1,
  }));
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
      cliponaxis: false,
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

  // End-of-line data labels (preserves the "price-on-the-tip" info that used
  // to live in the comparison table — see Mobile vs Desktop divergence note
  // in docs/app/price-bands.md).
  const endLabels = useMemo(
    () => buildEndLabels(rows, filters.product, xMin, xMax, visibleKeys),
    [rows, filters.product, xMin, xMax, visibleKeys],
  );

  // Empirical chart geometry used to translate label font height (pixels) into
  // data-space (R$/L). Plot height is `height (260) − margin.t (12) − margin.b
  // (36) = 212px`. The annotation font is 10px Arial bold inside a bordered
  // pill (`borderpad: 1`), which renders at ~14–16px tall on real devices.
  // We budget 22px per label so adjacent labels never visually touch even at
  // 1Y / All zooms where the data range is wide and 1 R$ < 50 px on screen.
  const PLOT_HEIGHT_PX = 260 - 12 - 36;
  const LABEL_HEIGHT_PX = 22;

  // Compute the visible Y range from the actual data inside the period window
  // so the stacking threshold scales with the chart's current zoom (1M / 3M /
  // 6M / 1Y / All have wildly different Y spans).
  const yRange = useMemo<{ min: number; max: number } | null>(() => {
    const ys: number[] = [];
    const seriesDefs = filters.product === "Gasoline" ? GAS_SERIES : DSL_SERIES;
    for (const r of rows) {
      if (r.product !== filters.product) continue;
      if (xMin && r.date < xMin) continue;
      if (xMax && r.date > xMax) continue;
      for (const s of seriesDefs) {
        const v = r[s.field as keyof PriceBandsRow];
        if (typeof v === "number" && Number.isFinite(v)) ys.push(v);
      }
    }
    if (ys.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const y of ys) {
      if (y < min) min = y;
      if (y > max) max = y;
    }
    return { min, max };
  }, [rows, filters.product, xMin, xMax]);

  // Deconfliction threshold in data units, derived from label font height vs
  // plot height: `MIN_LABEL_DELTA = (yMax − yMin) × (LABEL_HEIGHT_PX /
  // PLOT_HEIGHT_PX)`. Plotly auto-pads the Y range by ~6% on each side, so we
  // inflate the visible span a touch to track the real screen geometry. Fall
  // back to a conservative absolute value if we have no data.
  const MIN_LABEL_DELTA = useMemo(() => {
    if (!yRange) return 0.18;
    const visibleSpan = (yRange.max - yRange.min) * 1.12; // ~6% pad each side
    if (visibleSpan <= 0) return 0.18;
    return visibleSpan * (LABEL_HEIGHT_PX / PLOT_HEIGHT_PX);
  }, [yRange]);

  const annotations = useMemo(() => {
    const resolved = deconflictLabels(endLabels, MIN_LABEL_DELTA);
    return labelsToAnnotations(resolved);
  }, [endLabels, MIN_LABEL_DELTA]);

  // Extend the x-axis range a fixed number of days past the last data point
  // so the end-of-line annotations (xref:"x", xanchor:"left") have room to
  // render without being clipped at the plot-area boundary.
  // We keep margin.r small (8px) so the plot area fills the card edge-to-edge.
  // 45 days is enough for 5 annotation characters (~28px of Arial-10 text +
  // xshift:6) across the range widths we see at 1M–All zoom levels.
  const xAxisRange = useMemo<[string, string] | undefined>(() => {
    // Determine the rightmost data point in the current window.
    const lastDate = xMax ?? rows
      .filter((r) => r.product === filters.product)
      .reduce<string | null>((acc, r) => (r.date > (acc ?? "") ? r.date : acc), null);
    if (!lastDate) return undefined;

    const end = new Date(lastDate + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() + 45);
    const endStr = end.toISOString().slice(0, 10);

    // Keep xMin as the left boundary (when set by the period chip).
    return xMin ? [xMin, endStr] : [lastDate, endStr];
  }, [xMax, xMin, rows, filters.product]);

  const chartLayout = useMemo<Partial<Layout>>(() => ({
    height: 260,
    // margin.r kept minimal (8px) so the plot area fills the full card width.
    // Room for end-of-line annotation text is created by extending xaxis.range
    // 45 days past the last data point (see xAxisRange above).
    margin: { l: 44, r: 8, t: 12, b: 36 },
    xaxis: {
      type: "date" as const,
      tickformat: "%b-%y",
      nticks: 5,
      tickangle: -30,
      automargin: true,
      ...(xAxisRange ? { range: xAxisRange } : {}),
    },
    yaxis: {
      tickformat: ".2f",
      nticks: 4,
      tickprefix: "R$ ",
    },
    showlegend: false,
    hovermode: "x unified" as const,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    annotations: annotations as any,
  }), [annotations, xAxisRange]);

  // ── Current values (for legend chip subtitle + Petrobras gap table) ──────
  const cv = currentValues[filters.product];

  // ── Petrobras gap rows (mirrors desktop badges above the chart) ──────────
  const gapRows = useMemo(
    () => buildGapRows(filters.product, cv),
    [filters.product, cv],
  );

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

          {/* ── Petrobras gap (mirrors desktop badges) ─────────────────── */}
          {gapRows.some((g) => g.pct != null) && (
            <>
              <SectionLabel>Petrobras Price Gap</SectionLabel>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "0 16px 8px",
                }}
              >
                {gapRows.map((row) => {
                  const cell = fmtPctCell(row.pct);
                  const pctColor =
                    cell.positive === null
                      ? "var(--mobile-text-muted)"
                      : cell.positive
                      ? "#c62828" // Petrobras priced ABOVE the reference → red
                      : "#2e7d32"; // Petrobras priced BELOW the reference → green
                  return (
                    <div
                      key={row.label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 14px",
                        background: "var(--mobile-surface)",
                        border: row.outlined
                          ? "1px solid var(--mobile-text)"
                          : "1px solid var(--mobile-divider)",
                        borderLeft: row.outlined
                          ? "1px solid var(--mobile-text)"
                          : `4px solid ${COLOR_IMPORT}`,
                        borderRadius: "var(--mobile-radius-md, 8px)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            color: "var(--mobile-text)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.numerator} {row.label}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--mobile-text-muted)",
                            marginTop: 2,
                          }}
                        >
                          vs. {row.denominator}
                        </span>
                      </div>
                      <span
                        style={{
                          fontWeight: 800,
                          fontSize: 20,
                          color: pctColor,
                          whiteSpace: "nowrap",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {cell.text}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Footnote */}
              <div style={{ padding: "0 16px 8px", fontSize: 11, color: "var(--mobile-text-muted)" }}>
                Gap = (Petrobras price ÷ reference − 1). Positive = priced above reference.
                {cv.lastDate && <> Last data: {fmtDateLabel(cv.lastDate)}.</>}
              </div>
            </>
          )}

          {/* No-data state */}
          {!gapRows.some((g) => g.pct != null) && !loading && (
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

    </div>
  );
}

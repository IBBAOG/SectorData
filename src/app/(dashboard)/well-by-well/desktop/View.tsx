"use client";

// Desktop View — /well-by-well (≥769px).
//
// Outer shell follows the project canonical pattern (matches /anp-cdp,
// /imports-exports, /market-share, and 7 other dashboards):
//   NavBar → container-fluid g-0 → row g-0
//     col-xxl-2 col-md-3 (#sidebar with BrandLogo + sidebar-* CSS classes)
//     col-xxl-10 col-md-9 (#page-content)
//
// Sidebar (left, ~280px): Period · Reference month · Environment
// Main content (right):
//   • Header — title + subtitle + period badge + Export panel (right)
//   • 5 view pills row (Round 9) — Brasil · Petrobras · PRIO · PetroReconcavo
//     · Brava Energia. Mutually exclusive; toggles the whole dashboard.
//   • HeaderTable — PDF-style page-2 replica (full width of main)
//   • 3 charts (Round 9 reduced from 4 → 3 by removing the dedicated
//     Brazil-vs-Company comparison row):
//       Chart 1: Oil Production stacked by ambiente (Brasil OR company), full width
//       Chart 2 + Chart 3: Top fields | Installations (side-by-side)
//
// Round 6 (2026-05-27): top KPI strip removed (broken Δ MoM/YoY against the
// partial reference month).
//
// Round 16 (2026-05-28): the field- and installation-drill modals lost their
// 4-card KPI strip (Current oil / Δ MoM / Δ YoY / YTD avg) and gained a
// 5-column summary table (Current month / Previous month / MoM % / Same
// month prev. year / YoY %) rendered below the chart. The new YoY column is
// always populated when the underlying datapoint exists: KPI data lives in
// its own `drillKpiSeries` / `drillInstalacaoKpiSeries` cache anchored to
// `latestMonth` over a fixed 14-month window, so picking "Last 12M" no longer
// blanks out the same-month-prev-year point (the bug the CTO flagged on the
// FRADE — PRIO screenshot).
//
// Round 8 (2026-05-27): added the PDF-style HeaderTable.
//
// Round 9 (2026-05-27): 5 view pills replace the empresa dropdown.
//
// Round 10 (2026-05-27): filters moved from the in-content horizontal block
// into a left-side sidebar matching the project's canonical pattern. The
// inline `wbw-top-split` 2-column grid is gone — HeaderTable now occupies the
// full width of the main content area below the pills row. Pills live at the
// TOP of main content (not the sidebar) because they are view-mode selectors,
// semantically distinct from the period/environment subsetters in the
// sidebar.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] with an explicit reason.

import { useEffect, useMemo } from "react";
import type { Layout, PlotData, PlotMouseEvent } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import { ExportButton } from "../../../../lib/export";
import { wellByWellExport } from "../../../../lib/export/dashboards/wellByWell";
import HeaderTable from "../HeaderTable";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";
import { bblDiaToKbpd } from "../../../../lib/units";
import {
  WELL_BY_WELL_VIEWS,
  type WellByWellView,
} from "../../../../data/wellByWellEmpresas";
import {
  buildPerWellChart as buildBswPerWellChart,
  buildFieldAverageChart as buildBswFieldAverageChart,
} from "../../../../lib/charts/bsw";
import {
  buildPerWellChart as buildDepletionPerWellChart,
  buildFieldAverageChart as buildDepletionFieldAverageChart,
} from "../../../../lib/charts/depletion";

import {
  useProductionData,
  fmtNumber,
  fmtPct,
  fmtMonthLabel,
  AMBIENTES,
  AMBIENTE_COLOR,
  labelAmbiente,
  BRAND_ORANGE,
  HOURS_RATE_COLOR,
  TOP_FIELDS_OIL_COLOR,
  TOP_FIELDS_WATER_COLOR,
  PERIOD_PRESETS,
  PERIOD_PRESET_LABEL,
  computePresetRange,
  detectPeriodPreset,
  DRILL_DEPLETION_RECENT_MONTHS,
  DRILL_DEPLETION_PRIOR_MONTHS,
  type PeriodPreset,
  type DrillTab,
  type DrillSubMode,
  type DrillKpiTableData,
} from "../useProductionData";
import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
  ProductionFieldTimeseriesRow,
  ProductionInstallationTimeseriesRow,
} from "../../../../types/production";
import type {
  AnpCdpBswPoint,
  AnpCdpBswFieldPoint,
  AnpCdpDepletionPoint,
  AnpCdpDepletionFieldPoint,
} from "../../../../lib/rpc";

// ─── Chart builders ───────────────────────────────────────────────────────────

/**
 * Build a stacked-bar trace per ambiente, x = month label, y = oil in kbpd.
 *
 * Round 6 (2026-05-27): each trace carries its rounded kbpd value as in-bar
 * text. Round 9: variant "brazil" applies the greyscale palette (used both
 * in Brasil view and the unused-but-still-imported brazilData case); variant
 * "company" applies the brand-orange accent to PreSal.
 */
const MIN_SEGMENT_KBPD_LABEL = 30; // hide labels for segments < 30 kbpd

function fmtIntPtBr(n: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function buildStackedOilBars(
  rows: (ProductionBrazilRow | ProductionCompanyRow)[],
  variant: "brazil" | "company",
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(320, "No data for the selected period.");

  // Distinct sorted months (YYYY-MM-01).
  const monthSet = new Set<string>();
  for (const r of rows) {
    monthSet.add(
      `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`,
    );
  }
  const months = Array.from(monthSet).sort();

  // Pivot: { ambiente -> { monthKey -> oil_bbl_dia } }
  const pivot: Record<string, Record<string, number>> = {};
  for (const a of AMBIENTES) pivot[a] = {};
  for (const r of rows) {
    const key = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
    if (!pivot[r.ambiente]) pivot[r.ambiente] = {};
    pivot[r.ambiente][key] = (pivot[r.ambiente][key] ?? 0) + r.oil_bbl_dia;
  }

  // Precompute per-month per-ambiente values in kbpd so they can be reused
  // for both the trace `y` arrays and the per-bar total annotations.
  const ambienteY: Record<string, number[]> = {};
  for (const amb of AMBIENTES) {
    ambienteY[amb] = months.map((m) => bblDiaToKbpd(pivot[amb]?.[m] ?? 0));
  }
  const totals = months.map((_, i) =>
    AMBIENTES.reduce((s, amb) => s + (ambienteY[amb]?.[i] ?? 0), 0),
  );

  // Build one trace per ambiente. Round 15 (2026-05-27): palette swapped to
  // the PDF report convention — PreSal dark navy, PosSal brand orange, Terra
  // mint green — so the legacy "variant === company" PreSal-orange override
  // is gone. Both Brasil and company views share the same PDF palette.
  // Underlying RPC data stays raw (`PreSal`/`PosSal`/`Terra`); display labels
  // translate to English (`Pre-Salt`/`Post-Salt`/`Onshore`) for legend +
  // hover via `labelAmbiente`. `variant` is retained as a parameter for
  // call-site signaling but no longer changes colors.
  void variant; // intentionally unused now
  const traces: PlotData[] = AMBIENTES.map((amb) => {
    const baseColor = AMBIENTE_COLOR[amb] ?? "#aaaaaa";
    const ys = ambienteY[amb];
    // Light segment (Terra: mint green) needs a dark label to remain readable;
    // dark segments (PreSal navy / PosSal brand orange) take a white label.
    const labelColor = amb === "Terra" ? "#1a1a1a" : "#ffffff";
    const displayName = labelAmbiente(amb);
    return {
      type: "bar",
      name: displayName,
      x: months,
      y: ys,
      text: ys.map((v) => (v >= MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "")),
      textposition: "inside",
      insidetextanchor: "middle",
      textfont: { color: labelColor, size: 11, family: "Arial" },
      cliponaxis: false,
      marker: { color: baseColor },
      hovertemplate: `${displayName}: %{y:,.1f} kbpd<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 30, b: 60, l: 60, r: 20 },
      barmode: "stack",
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "kbpd" } },
      xaxis: {
        ...AXIS_LINE,
        type: "date",
        // Force exactly one tick per data-month. Without tickmode:"array" Plotly
        // auto-generates ticks at its own time interval — with only 4 points
        // (YTD Jan–Apr) this produces a tick at each month boundary (start AND
        // end), which renders two labels per bar. Pinning tickvals to the exact
        // YYYY-MM-01 anchors we plotted ensures one label per bar regardless of
        // the date range length.
        tickmode: "array",
        tickvals: months,
        ticktext: months.map((m) => fmtMonthLabel(m)),
      },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
      annotations: months.map((m, i) => ({
        x: m,
        y: totals[i],
        text: `<b>${fmtIntPtBr(totals[i])}</b>`,
        showarrow: false,
        yshift: 12,
        font: { size: 11, color: "#1a1a1a", family: "Arial" },
        xanchor: "center",
      })),
    },
  };
}

/**
 * Build the drill-down chart: 13-month stacked vertical bars (oil dark + water
 * light blue) on the left y-axis (kbpd), plus a hours-rate line on the right
 * y-axis (% of month). Empty if the series is empty (e.g. stake != 100 case).
 */
function buildFieldDrillChart(
  rows: ProductionFieldTimeseriesRow[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(320, "No data for this field in the current period.");

  // Defensive consolidation: server RPC already GROUPs BY (ano, mes), but if
  // the canonical-expansion path ever returns duplicates we collapse them
  // here too — sum oil/water/gas, average hours_rate. Stops Plotly from
  // rendering two stacked bars on the same x-tick.
  const byMonth = new Map<string, {
    ano: number; mes: number;
    oil: number; water: number;
    hoursSum: number; hoursCount: number;
  }>();
  for (const r of rows) {
    const key = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}`;
    const cur = byMonth.get(key);
    if (cur) {
      cur.oil   += r.oil_bbl_dia;
      cur.water += r.water_bbl_dia;
      cur.hoursSum += r.hours_rate;
      cur.hoursCount += 1;
    } else {
      byMonth.set(key, {
        ano: r.ano, mes: r.mes,
        oil: r.oil_bbl_dia, water: r.water_bbl_dia,
        hoursSum: r.hours_rate, hoursCount: 1,
      });
    }
  }
  const sorted = Array.from(byMonth.values()).sort((a, b) => {
    if (a.ano !== b.ano) return a.ano - b.ano;
    return a.mes - b.mes;
  });
  const xs = sorted.map(
    (r) => `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`,
  );
  const oil = sorted.map((r) => bblDiaToKbpd(r.oil));
  const water = sorted.map((r) => bblDiaToKbpd(r.water));
  const hoursPct = sorted.map((r) => (r.hoursCount > 0 ? r.hoursSum / r.hoursCount : 0) * 100);

  return {
    data: [
      {
        type: "bar",
        name: "Oil",
        x: xs,
        y: oil,
        marker: { color: TOP_FIELDS_OIL_COLOR },
        hovertemplate: "Oil: %{y:,.1f} kbpd<extra></extra>",
        yaxis: "y",
      } as PlotData,
      {
        type: "bar",
        name: "Water",
        x: xs,
        y: water,
        marker: { color: TOP_FIELDS_WATER_COLOR },
        hovertemplate: "Water: %{y:,.1f} kbpd<extra></extra>",
        yaxis: "y",
      } as PlotData,
      {
        type: "scatter",
        mode: "lines+markers",
        name: "Hours rate",
        x: xs,
        y: hoursPct,
        line: { color: HOURS_RATE_COLOR, width: 2 },
        marker: { color: HOURS_RATE_COLOR, size: 6 },
        hovertemplate: "Hours: %{y:.1f}%<extra></extra>",
        yaxis: "y2",
      } as PlotData,
    ],
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 10, b: 50, l: 60, r: 60 },
      barmode: "stack",
      hovermode: "x unified",
      xaxis: {
        ...AXIS_LINE,
        type: "date",
        // Pin one tick per data-month with explicit tickvals so a short series
        // (e.g. a recently-onlined well like WAHOO with only 3–4 months of
        // history) doesn't trigger Plotly's auto-tick algorithm — which on a
        // sparse date axis picks ~4–5 evenly-spaced positions that round to
        // the same month label twice (visible bug 2026-05-28: "Feb 26 ·
        // Mar 26 · Mar 26 · Apr 26"). Same pattern as the hero chart above.
        tickmode: "array",
        tickvals: xs,
        ticktext: xs.map((m) => fmtMonthLabel(m)),
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "kbpd" },
      },
      yaxis2: {
        ...AXIS_LINE,
        overlaying: "y",
        side: "right",
        title: { text: "Hours rate (%)" },
        range: [0, 105],
        showgrid: false,
      },
      legend: {
        orientation: "h",
        yanchor: "bottom",
        y: 1.01,
        xanchor: "left",
        x: 0,
      },
    },
  };
}

/**
 * Build a horizontal stacked bar: top fields, oil + water in kbpd.
 */
function buildTopFieldsChart(
  fields: ProductionTopField[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!fields.length) return emptyPlot(360, "No field-level data for this month.");

  const sorted = [...fields].sort((a, b) => b.oil_bbl_dia - a.oil_bbl_dia);
  const names = sorted.map((f) => f.campo);
  const oil = sorted.map((f) => bblDiaToKbpd(f.oil_bbl_dia));
  const water = sorted.map((f) => bblDiaToKbpd(f.water_bbl_dia));
  const totals = oil.map((v, i) => v + water[i]);

  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        name: "Oil",
        x: oil,
        y: names,
        text: oil.map((v) => (v >= MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "")),
        textposition: "inside",
        insidetextanchor: "middle",
        textfont: { color: "#ffffff", size: 11, family: "Arial" },
        cliponaxis: false,
        marker: { color: TOP_FIELDS_OIL_COLOR },
        hovertemplate: "Oil: %{x:,.1f} kbpd<extra>%{y}</extra>",
      } as PlotData,
      {
        type: "bar",
        orientation: "h",
        name: "Water",
        x: water,
        y: names,
        text: water.map((v) => (v >= MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "")),
        textposition: "inside",
        insidetextanchor: "middle",
        // Round 15: water bar swapped from light blue to brand orange per the
        // PDF (p4 Petrobras Largest Oil Producing Fields). White label keeps
        // contrast on the now-orange fill.
        textfont: { color: "#ffffff", size: 11, family: "Arial" },
        cliponaxis: false,
        marker: { color: TOP_FIELDS_WATER_COLOR },
        hovertemplate: "Water: %{x:,.1f} kbpd<extra>%{y}</extra>",
      } as PlotData,
    ],
    layout: {
      ...COMMON_LAYOUT,
      height: 360,
      margin: { t: 10, b: 40, l: 140, r: 60 },
      barmode: "stack",
      yaxis: {
        ...AXIS_LINE,
        autorange: "reversed",
        automargin: true,
        tickfont: { size: 11 },
      },
      xaxis: { ...AXIS_LINE, title: { text: "kbpd" } },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
      annotations: names.map((n, i) => ({
        x: totals[i],
        y: n,
        text: `<b>${fmtIntPtBr(totals[i])}</b>`,
        showarrow: false,
        xshift: 6,
        xanchor: "left",
        yanchor: "middle",
        font: { size: 11, color: "#1a1a1a", family: "Arial" },
      })),
    },
  };
}

// ─── Drill KPI table (Round 16, 2026-05-28) ──────────────────────────────────
//
// Replaces the four KPI cards (Current oil / Δ MoM / Δ YoY / YTD avg) that
// used to live at the top of the Production tab. Surfaces the same data and a
// new useful column: the same month one year ago. Crucially, the YoY column
// is now always populated whenever the underlying data point exists — the KPI
// fetch in `useProductionData` is anchored to `latestMonth` independently of
// the dashboard's period filter, so picking "Last 12M" (which doesn't include
// the same-month-prev-year point in the chart) no longer blanks the YoY cell.
//
// Visual language matches the rest of the modal — Arial, neutral palette,
// brand-orange accent bar at the top of the modal already provides the visual
// anchor; the table itself stays understated.

const KPI_DELTA_POS_COLOR     = "#197a39"; // green for positive MoM/YoY
const KPI_DELTA_NEG_COLOR     = "#b3261e"; // red for negative MoM/YoY
const KPI_DELTA_NEUTRAL_COLOR = "#888888"; // gray for zero/null

/**
 * 5-column KPI summary table. Columns: Current month | Previous month |
 * MoM % | Same month prev. year | YoY %. Loading state dims to 0.6 opacity.
 * Em-dashes when a cell is null. Unit is kbpd for the well-by-well drill
 * variant (the only consumer right now); kept as a prop in case BSW/Depletion
 * tabs ever surface their own KPI table.
 */
function DrillKpiTable({
  data,
  loading = false,
  unit = "kbpd",
  compact = false,
}: {
  data: DrillKpiTableData;
  loading?: boolean;
  unit?: string;
  /** Mobile-tuned compact density (smaller padding + fonts). */
  compact?: boolean;
}): React.ReactElement {
  const fmtValue = (v: number | null): string => (v == null ? "—" : fmtNumber(v, 1));
  const fmtDelta = (p: number | null): string => (p == null ? "—" : fmtPct(p));
  const deltaColor = (p: number | null): string => {
    if (p == null) return KPI_DELTA_NEUTRAL_COLOR;
    if (p > 0) return KPI_DELTA_POS_COLOR;
    if (p < 0) return KPI_DELTA_NEG_COLOR;
    return KPI_DELTA_NEUTRAL_COLOR;
  };

  const cellPaddingY = compact ? 8 : 12;
  const cellPaddingX = compact ? 8 : 14;
  const headerFontSize = compact ? 9.5 : 10.5;
  const valueFontSize = compact ? 13 : 16;
  const subLabelFontSize = compact ? 9 : 10;
  const unitFontSize = compact ? 9 : 10;

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        overflow: "hidden",
        background: "#ffffff",
        opacity: loading ? 0.6 : 1,
        transition: "opacity 0.18s ease",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "Arial",
          tableLayout: "fixed",
        }}
      >
        <thead>
          <tr style={{ background: "#fafafa" }}>
            <th style={{ ...kpiThStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: headerFontSize }}>
              Current month
              <div style={{ fontWeight: 400, fontSize: subLabelFontSize, color: "#888", marginTop: 2, textTransform: "none", letterSpacing: 0 }}>
                {data.currentMonthLabel ?? "—"}
              </div>
            </th>
            <th style={{ ...kpiThStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: headerFontSize }}>
              Previous month
              <div style={{ fontWeight: 400, fontSize: subLabelFontSize, color: "#888", marginTop: 2, textTransform: "none", letterSpacing: 0 }}>
                {data.prevMonthLabel ?? "—"}
              </div>
            </th>
            <th style={{ ...kpiThStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: headerFontSize }}>
              MoM %
            </th>
            <th style={{ ...kpiThStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: headerFontSize }}>
              Same month prev. year
              <div style={{ fontWeight: 400, fontSize: subLabelFontSize, color: "#888", marginTop: 2, textTransform: "none", letterSpacing: 0 }}>
                {data.prevYearMonthLabel ?? "—"}
              </div>
            </th>
            <th style={{ ...kpiThStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: headerFontSize }}>
              YoY %
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...kpiTdStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: valueFontSize }}>
              {fmtValue(data.currentMonth)}
              <span style={{ fontSize: unitFontSize, color: "#888", marginLeft: 4, fontWeight: 500 }}>{unit}</span>
            </td>
            <td style={{ ...kpiTdStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: valueFontSize }}>
              {fmtValue(data.prevMonth)}
              <span style={{ fontSize: unitFontSize, color: "#888", marginLeft: 4, fontWeight: 500 }}>
                {data.prevMonth == null ? "" : unit}
              </span>
            </td>
            <td style={{ ...kpiTdStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: valueFontSize, color: deltaColor(data.momPct) }}>
              {fmtDelta(data.momPct)}
            </td>
            <td style={{ ...kpiTdStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: valueFontSize }}>
              {fmtValue(data.prevYear)}
              <span style={{ fontSize: unitFontSize, color: "#888", marginLeft: 4, fontWeight: 500 }}>
                {data.prevYear == null ? "" : unit}
              </span>
            </td>
            <td style={{ ...kpiTdStyle, padding: `${cellPaddingY}px ${cellPaddingX}px`, fontSize: valueFontSize, color: deltaColor(data.yoyPct) }}>
              {fmtDelta(data.yoyPct)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const kpiThStyle: React.CSSProperties = {
  borderBottom: "1px solid #e0e0e0",
  fontWeight: 700,
  textAlign: "center",
  color: "#1a1a1a",
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  verticalAlign: "top",
};

const kpiTdStyle: React.CSSProperties = {
  borderBottom: "none",
  textAlign: "center",
  color: "#1a1a1a",
  fontWeight: 700,
  fontFamily: "Arial",
};

// ─── Period preset buttons (Round 13, 2026-05-27) ─────────────────────────────
//
// 5 mutually-exclusive preset buttons that replace the rc-slider in the
// sidebar's Period section. Reuses the same brand-orange filled / white-
// outlined visual language as the view pills (Round 9) — consistency across
// the dashboard's two button rows.
//
// State lives in the hook's `dateRange` (unchanged). Clicks call the existing
// `setDateRange`. The active button is detected by `detectPeriodPreset()`
// comparing the current `dateRange` against each preset's computed range.

function PeriodPresetButtons({
  dateRange,
  latestMonth,
  firstAvailableMonth,
  onPick,
  disabled = false,
}: {
  dateRange: [string, string];
  latestMonth: string | null;
  firstAvailableMonth: string | null;
  onPick: (range: [string, string]) => void;
  disabled?: boolean;
}): React.ReactElement {
  const active: PeriodPreset | null = detectPeriodPreset(
    dateRange,
    latestMonth,
    firstAvailableMonth,
  );
  return (
    <div
      role="group"
      aria-label="Period preset"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 6,
      }}
    >
      {PERIOD_PRESETS.map((preset) => {
        const isActive = preset === active;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={isActive}
            disabled={disabled || !latestMonth}
            onClick={() => {
              const range = computePresetRange(preset, latestMonth);
              if (range) onPick(range);
            }}
            onMouseEnter={(e) => {
              if (!isActive && !disabled && latestMonth) {
                (e.currentTarget as HTMLButtonElement).style.background = "#fff5ef";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive && !disabled && latestMonth) {
                (e.currentTarget as HTMLButtonElement).style.background = "#ffffff";
              }
            }}
            style={{
              fontFamily: "Arial",
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              padding: "7px 6px",
              borderRadius: 6,
              border: isActive ? "1px solid transparent" : "1px solid #d0d0d0",
              background: isActive ? BRAND_ORANGE : "#ffffff",
              color: isActive ? "#ffffff" : "#1a1a1a",
              cursor: disabled || !latestMonth ? "not-allowed" : "pointer",
              transition: "background-color 0.18s, color 0.18s, border-color 0.18s",
              minHeight: 32,
              whiteSpace: "nowrap",
              userSelect: "none",
              opacity: disabled || !latestMonth ? 0.55 : 1,
            }}
          >
            {PERIOD_PRESET_LABEL[preset]}
          </button>
        );
      })}
    </div>
  );
}

// ─── View pills row (Round 9, 2026-05-27) ─────────────────────────────────────
//
// 5 mutually-exclusive pills. Reuses the brand-orange palette and rounded-
// full chrome used by the rest of the app (SegmentedToggle has too much
// auto-shrink logic that doesn't suit a 5-cell row that needs more breathing
// room; this thin component keeps the markup obvious).

function ViewPillsRow({
  value,
  onChange,
}: {
  value: WellByWellView;
  onChange: (v: WellByWellView) => void;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Production view"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "10px 0 14px",
      }}
    >
      {WELL_BY_WELL_VIEWS.map((opt) => {
        const isActive = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt)}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.background = "#fff5ef";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.background = "#ffffff";
              }
            }}
            style={{
              fontFamily: "Arial",
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              padding: "8px 18px",
              borderRadius: 999,
              border: isActive ? "1px solid transparent" : "1px solid #c5c5cb",
              background: isActive ? BRAND_ORANGE : "#ffffff",
              color: isActive ? "#ffffff" : "#1a1a1a",
              cursor: "pointer",
              transition: "background-color 0.18s, color 0.18s, border-color 0.18s",
              minHeight: 36,
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Drill tab skeleton (BSW / Depletion loading state) ──────────────────────
//
// Replaces the previous empty `<BarrelLoading />` block that occupied the
// BSW and Depletion tabs while their RPCs were in flight. Three jobs:
//
//   1. Tell the user something is happening (barrel spinner — kept for the
//      visual continuity with the rest of the dashboard).
//   2. Tell them WHAT is happening (descriptive title + sub-line that names
//      the campo and the metric). When the canonical-grouping backend (P1)
//      lands, the same skeleton accompanies a sub-3s render; before it does,
//      the same skeleton stays on screen for ~30s — either way the user is
//      no longer staring at an unbranded spinner without context.
//   3. Hint at the shape of the answer with 4 horizontal placeholder bars
//      that taper down (mimicking a typical BSW / depletion curve). Pulse
//      animation reuses `wbw-kpi-skeleton-pulse` from globals.css.
//
// Two textual modes — "bsw" and "depletion" — so the same component renders
// the right copy. `compact` enables the mobile-tuned size variant (smaller
// type + tighter spacing) but the desktop modal never sets it.
function DrillTabSkeleton({
  campo,
  metric,
  compact = false,
}: {
  campo: string;
  metric: "bsw" | "depletion";
  compact?: boolean;
}): React.ReactElement {
  const title =
    metric === "bsw"
      ? `Computing BSW for ${campo}…`
      : `Computing Depletion for ${campo}…`;
  const detail =
    metric === "bsw"
      ? "Aggregating water-cut across canonical variants. This may take a few seconds the first time."
      : "Calculating uptime-normalized cumulative NP across canonical variants. This may take a few seconds the first time.";
  return (
    <div
      className={`wbw-drill-skeleton${compact ? " is-compact" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="wbw-drill-skeleton-header">
        <BarrelLoading bare size={compact ? 64 : 96} />
        <div className="wbw-drill-skeleton-text">
          <strong>{title}</strong>
          <small>{detail}</small>
        </div>
      </div>
      <div className="wbw-drill-skeleton-chart" aria-hidden="true">
        <div className="wbw-drill-skeleton-bar" />
        <div className="wbw-drill-skeleton-bar" />
        <div className="wbw-drill-skeleton-bar" />
        <div className="wbw-drill-skeleton-bar" />
      </div>
    </div>
  );
}

// ─── Field drill-down modal ───────────────────────────────────────────────────
//
// Phase 2 (2026-05-30): the modal now hosts THREE tabs — Production (the
// original 4-KPI + Oil/Water/Hours stacked-bar view, unchanged), BSW (water-cut
// analysis reusing the /anp-cdp-bsw chart builders), and Depletion (rolling
// uptime-normalized NP from /anp-cdp-depletion). Tabs are mutually exclusive
// and DO NOT close the modal. The dashboard's period slider is intentionally
// ignored on BSW/Depletion tabs — those are lifecycle analyses, not period-
// windowed. Switching back to Production restores the original analysis.

function FieldDrillModal({
  campo,
  empresa,
  loading,
  error,
  series,
  kpiTable,
  onClose,
  // Tabs (Phase 2)
  drillTab,
  setDrillTab,
  drillBswMode,
  setDrillBswMode,
  drillBswWellPoints,
  drillBswFieldPoints,
  drillBswLoading,
  drillBswError,
  prefetchBswField,
  drillDepletionMode,
  setDrillDepletionMode,
  drillDepletionWellPoints,
  drillDepletionFieldPoints,
  drillDepletionLoading,
  drillDepletionError,
  prefetchDepletionField,
}: {
  campo: string;
  empresa: string;
  loading: boolean;
  error: string | null;
  series: ProductionFieldTimeseriesRow[];
  /**
   * KPI table data sourced from a period-independent 14-month window (see
   * `drillKpiSeries` in `useProductionData`). Renders below the chart in
   * place of the legacy 4 KPI cards.
   */
  kpiTable: DrillKpiTableData;
  onClose: () => void;
  drillTab: DrillTab;
  setDrillTab: (t: DrillTab) => void;
  drillBswMode: DrillSubMode;
  setDrillBswMode: (m: DrillSubMode) => void;
  drillBswWellPoints: AnpCdpBswPoint[] | null;
  drillBswFieldPoints: AnpCdpBswFieldPoint[] | null;
  drillBswLoading: boolean;
  drillBswError: string | null;
  prefetchBswField: () => void;
  drillDepletionMode: DrillSubMode;
  setDrillDepletionMode: (m: DrillSubMode) => void;
  drillDepletionWellPoints: AnpCdpDepletionPoint[] | null;
  drillDepletionFieldPoints: AnpCdpDepletionFieldPoint[] | null;
  drillDepletionLoading: boolean;
  drillDepletionError: string | null;
  prefetchDepletionField: () => void;
}): React.ReactElement {
  // Production tab chart (unchanged from the pre-Phase-2 modal).
  const productionChart = useMemo(() => buildFieldDrillChart(series), [series]);

  // BSW charts. Because the canonical-aware RPC expands variant names server-
  // side (e.g. canonical "TUPI" → {TUPI, SUL DE TUPI, AnC_TUPI}), the response
  // can contain multiple distinct `campo` values. We surface ALL of them as
  // separate traces by deriving the selected campos from the response itself
  // (preserves first-appearance order so colors stay stable across renders).
  // If the user clicked a canonical that maps to a single raw name the list
  // collapses to [campo] and we render exactly one trace.
  const bswFieldCampos = useMemo(() => {
    const seen: string[] = [];
    for (const p of drillBswFieldPoints ?? []) {
      if (!seen.includes(p.campo)) seen.push(p.campo);
    }
    return seen.length > 0 ? seen : [campo];
  }, [drillBswFieldPoints, campo]);
  const bswFieldChart = useMemo(
    () => buildBswFieldAverageChart(drillBswFieldPoints ?? [], bswFieldCampos, "markers+lines"),
    [drillBswFieldPoints, bswFieldCampos],
  );
  // Per-well: each well is its own trace already (the builder colors by poco).
  // We still pass a non-empty selectedCampos so the "Select a field" empty
  // state doesn't trigger when there's data — the value isn't used for trace
  // grouping in the per-well builder, only as a "anything selected?" gate.
  const bswWellChart = useMemo(
    () => buildBswPerWellChart(drillBswWellPoints ?? [], [campo], "markers+lines"),
    [drillBswWellPoints, campo],
  );

  // Depletion charts. xMode is fixed to "voip" (% VOIP recovered) per CTO spec
  // — no Calendar/VOIP toggle in the popup; the dedicated dashboard is where
  // analysts get to swap axis.
  const depletionFieldCampos = useMemo(() => {
    const seen: string[] = [];
    for (const p of drillDepletionFieldPoints ?? []) {
      if (!seen.includes(p.campo)) seen.push(p.campo);
    }
    return seen.length > 0 ? seen : [campo];
  }, [drillDepletionFieldPoints, campo]);
  const depletionFieldChart = useMemo(
    () =>
      buildDepletionFieldAverageChart(
        drillDepletionFieldPoints ?? [],
        depletionFieldCampos,
        "markers+lines",
        "voip",
        DRILL_DEPLETION_RECENT_MONTHS,
        DRILL_DEPLETION_PRIOR_MONTHS,
      ),
    [drillDepletionFieldPoints, depletionFieldCampos],
  );
  const depletionWellChart = useMemo(
    () =>
      buildDepletionPerWellChart(
        drillDepletionWellPoints ?? [],
        [campo],
        "markers+lines",
        "voip",
        DRILL_DEPLETION_RECENT_MONTHS,
        DRILL_DEPLETION_PRIOR_MONTHS,
      ),
    [drillDepletionWellPoints, campo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Per-tab loading and error pickers so the rendering block stays uncluttered.
  const tabLoading =
    drillTab === "production" ? loading
    : drillTab === "bsw" ? drillBswLoading
    : drillDepletionLoading;
  const tabError =
    drillTab === "production" ? error
    : drillTab === "bsw" ? drillBswError
    : drillDepletionError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${campo} drill-down`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
        fontFamily: "Arial",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(900px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          borderRadius: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e6e6e6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#fafafa",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#1a1a1a",
              letterSpacing: "0.4px",
              textTransform: "uppercase",
            }}
          >
            {campo} <span style={{ color: "#888", fontWeight: 500 }}>— {empresa}</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              lineHeight: 1,
              color: "#888",
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "16px 20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            flex: "1 1 auto",
            opacity: tabLoading ? 0.6 : 1,
          }}
        >
          {/* ── Tab bar (Production / BSW / Depletion) ─────────────────────
              `onMouseEnter` here fires the BSW + Depletion field-mode
              prefetches if they haven't landed yet. The hook-level background
              prefetch (triggered on drillCampo flip null → string) almost
              always wins this race — but if the user hovers the tab bar
              before that fetch resolves AND has not yet visited those tabs,
              this primes both caches a few hundred ms earlier. Both callbacks
              are idempotent (early-return when cached OR in-flight). */}
          <div onMouseEnter={() => { prefetchBswField(); prefetchDepletionField(); }}>
            <SegmentedToggle<DrillTab>
              options={[
                { value: "production", label: "Production" },
                { value: "bsw",        label: "BSW" },
                { value: "depletion",  label: "Depletion" },
              ]}
              value={drillTab}
              onChange={setDrillTab}
              variant="full"
            />
          </div>

          {tabError && (
            <div
              style={{
                padding: "10px 12px",
                background: "#fff3cd",
                border: "1px solid #ffe69c",
                borderRadius: 6,
                color: "#7d5800",
                fontSize: 12,
              }}
            >
              {tabError}
            </div>
          )}

          {drillTab === "production" && (
            <>
              <div style={{ position: "relative" }}>
                <PlotlyChart
                  data={productionChart.data}
                  layout={productionChart.layout}
                  style={{ width: "100%", height: 320 }}
                />
                {!loading && series.length === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#888",
                      fontSize: 12,
                      background: "rgba(255,255,255,0.6)",
                    }}
                  >
                    No data for this field in the current period.
                  </div>
                )}
              </div>

              {/* Round 16 (2026-05-28): the 4 KPI cards (Current oil / Δ MoM /
                  Δ YoY / YTD avg) at the top of this tab were replaced by a
                  5-column summary table below the chart. The YoY column is
                  now sourced from a period-independent 14-month series
                  anchored to `latestMonth`, so picking "Last 12M" no longer
                  blanks out same-month-prev-year (which is what the screenshot
                  bug report flagged on FRADE — PRIO). */}
              <DrillKpiTable data={kpiTable} />

              <div style={{ fontSize: 11, color: "#888" }}>
                Bars: oil (dark) + water (light blue) in kbpd ·
                Line: monthly uptime fraction · Period reflects the dashboard
                filters. KPI table reads its own 14-month window so MoM / YoY
                stay populated even when the chart&apos;s preset excludes them.
              </div>
            </>
          )}

          {drillTab === "bsw" && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <SegmentedToggle<DrillSubMode>
                  options={[
                    { value: "field", label: "Field average" },
                    { value: "well",  label: "Per well" },
                  ]}
                  value={drillBswMode}
                  onChange={setDrillBswMode}
                  variant="compact"
                />
              </div>
              {drillBswLoading &&
               ((drillBswMode === "field" && drillBswFieldPoints == null) ||
                (drillBswMode === "well"  && drillBswWellPoints  == null)) ? (
                <DrillTabSkeleton campo={campo} metric="bsw" />
              ) : (
                <div style={{ position: "relative" }}>
                  <PlotlyChart
                    data={drillBswMode === "field" ? bswFieldChart.data : bswWellChart.data}
                    layout={drillBswMode === "field" ? bswFieldChart.layout : bswWellChart.layout}
                    style={{ width: "100%", height: 420 }}
                  />
                  {!drillBswLoading &&
                   ((drillBswMode === "field" && (drillBswFieldPoints?.length ?? 0) === 0) ||
                    (drillBswMode === "well"  && (drillBswWellPoints?.length  ?? 0) === 0)) && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#888",
                        fontSize: 12,
                        background: "rgba(255,255,255,0.6)",
                        textAlign: "center",
                        padding: "0 24px",
                      }}
                    >
                      BSW data unavailable for this field — no VOIP reference published yet.
                    </div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 11, color: "#888" }}>
                Y axis: water / (water + oil). X axis: % VOIP recovered (field average) or months since first production (per well).
              </div>
            </>
          )}

          {drillTab === "depletion" && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <SegmentedToggle<DrillSubMode>
                  options={[
                    { value: "field", label: "Field average" },
                    { value: "well",  label: "Per well" },
                  ]}
                  value={drillDepletionMode}
                  onChange={setDrillDepletionMode}
                  variant="compact"
                />
              </div>
              {drillDepletionLoading &&
               ((drillDepletionMode === "field" && drillDepletionFieldPoints == null) ||
                (drillDepletionMode === "well"  && drillDepletionWellPoints  == null)) ? (
                <DrillTabSkeleton campo={campo} metric="depletion" />
              ) : (
                <div style={{ position: "relative" }}>
                  <PlotlyChart
                    data={drillDepletionMode === "field" ? depletionFieldChart.data : depletionWellChart.data}
                    layout={drillDepletionMode === "field" ? depletionFieldChart.layout : depletionWellChart.layout}
                    style={{ width: "100%", height: 420 }}
                  />
                  {!drillDepletionLoading &&
                   ((drillDepletionMode === "field" && (drillDepletionFieldPoints?.length ?? 0) === 0) ||
                    (drillDepletionMode === "well"  && (drillDepletionWellPoints?.length  ?? 0) === 0)) && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#888",
                        fontSize: 12,
                        background: "rgba(255,255,255,0.6)",
                        textAlign: "center",
                        padding: "0 24px",
                      }}
                    >
                      Depletion data unavailable for this field — VOIP reference may be missing.
                    </div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 11, color: "#888" }}>
                Y axis: rolling depletion ({DRILL_DEPLETION_RECENT_MONTHS}m vs prior {DRILL_DEPLETION_PRIOR_MONTHS}m).
                X axis: % VOIP recovered. NP rising = positive (good); NP falling = depletion.
              </div>
            </>
          )}
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #e6e6e6",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            backgroundColor: "#ffffff",
          }}
        >
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onClose}
            style={{ fontFamily: "Arial" }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            backgroundColor: BRAND_ORANGE,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

// ─── Installation drill-down modal ─────────────────────────────────────────────

function InstallationDrillModal({
  instalacao,
  empresa,
  loading,
  error,
  series,
  kpiTable,
  onClose,
}: {
  instalacao: string;
  empresa: string;
  loading: boolean;
  error: string | null;
  series: ProductionInstallationTimeseriesRow[];
  /**
   * KPI table data sourced from a period-independent 14-month window (see
   * `drillInstalacaoKpiSeries` in `useProductionData`). Same shape and
   * semantics as the field-drill variant.
   */
  kpiTable: DrillKpiTableData;
  onClose: () => void;
}): React.ReactElement {
  const chart = useMemo(() => buildFieldDrillChart(series), [series]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${instalacao} drill-down`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
        fontFamily: "Arial",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(820px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#ffffff",
          borderRadius: 10,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid #e6e6e6",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#fafafa",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#1a1a1a",
              letterSpacing: "0.4px",
              textTransform: "uppercase",
            }}
          >
            {instalacao} <span style={{ color: "#888", fontWeight: 500 }}>— {empresa}</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              lineHeight: 1,
              color: "#888",
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "16px 20px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            flex: "1 1 auto",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {error && (
            <div
              style={{
                padding: "10px 12px",
                background: "#fff3cd",
                border: "1px solid #ffe69c",
                borderRadius: 6,
                color: "#7d5800",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ position: "relative" }}>
            <PlotlyChart
              data={chart.data}
              layout={chart.layout}
              style={{ width: "100%", height: 320 }}
            />
            {!loading && series.length === 0 && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#888",
                  fontSize: 12,
                  background: "rgba(255,255,255,0.6)",
                }}
              >
                No data for this installation in the current period.
              </div>
            )}
          </div>

          {/* Round 16 (2026-05-28): 5-column KPI table replaces the legacy
              4 KPI cards. Same period-independent semantics as the field
              drill — MoM/YoY computed from the 14-month KPI series anchored
              to latestMonth, not from the dashboard's period filter. */}
          <DrillKpiTable data={kpiTable} />

          <div style={{ fontSize: 11, color: "#888" }}>
            Bars: oil (dark) + water (light blue) routed through this
            installation in kbpd · Line: monthly uptime fraction · Period
            reflects the dashboard filters. KPI table reads its own 14-month
            window so MoM / YoY stay populated independent of the chart&apos;s
            preset.
          </div>
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #e6e6e6",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            backgroundColor: "#ffffff",
          }}
        >
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onClose}
            style={{ fontFamily: "Arial" }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            backgroundColor: BRAND_ORANGE,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement | null {
  const {
    visible, visLoading,
    bootstrapping,
    latestMonth,
    view, setView, isCompanyView: viewIsCompany, viewEmpresa,
    empresa,
    allMonths, dateRange, monthIdxRange, setDateRange,
    referenceDate, setReferenceDate,
    brazilData, companyData, topFields, installations,
    headerData, headerLoading,
    brazilLoading, companyLoading, topFieldsLoading, installationsLoading,
    // excelLoading / csvLoading / handleExportExcel / handleExportCsv removed —
    // export now flows through <ExportButton spec={wellByWellExport} /> wired
    // to the unified library at src/lib/export. The legacy hook handlers remain
    // exported (cleanup deferred to the per-dashboard migration sweep).
    drillCampo, drillTimeseries, drillLoading, drillError, drillKpiTable,
    openFieldDrill, closeFieldDrill,
    drillInstalacao, drillInstalacaoTimeseries, drillInstalacaoLoading,
    drillInstalacaoError, drillInstalacaoKpiTable,
    openInstallationDrill, closeInstallationDrill,
    // Drill popup tabs (Phase 2)
    drillTab, setDrillTab,
    drillBswMode, setDrillBswMode,
    drillBswWellPoints, drillBswFieldPoints,
    drillBswLoading, drillBswError,
    prefetchBswField,
    drillDepletionMode, setDrillDepletionMode,
    drillDepletionWellPoints, drillDepletionFieldPoints,
    drillDepletionLoading, drillDepletionError,
    prefetchDepletionField,
  } = useProductionData();

  // ── Chart 1 data (Brasil OR company) ─────────────────────────────────────
  // The hook ensures only ONE of brazilData / companyData refreshes per view,
  // but the OTHER may still hold stale state from a previous toggle. We pick
  // the correct source based on the active view rather than rendering both.
  const chart1Rows: (ProductionBrazilRow | ProductionCompanyRow)[] = viewIsCompany
    ? companyData
    : brazilData;
  const chart1Loading = viewIsCompany ? companyLoading : brazilLoading;
  const chart1Variant: "brazil" | "company" = viewIsCompany ? "company" : "brazil";
  const chart1Title = `${view} — Oil Production (kbpd${viewIsCompany ? ", stake-weighted" : ""})`;

  const oilChart = useMemo(
    () => buildStackedOilBars(chart1Rows, chart1Variant),
    [chart1Rows, chart1Variant],
  );
  const topFieldsChart = useMemo(
    () => buildTopFieldsChart(topFields),
    [topFields],
  );

  // ── Period badge label ────────────────────────────────────────────────────
  const periodBadge: [string, string] | null =
    dateRange[0] && dateRange[1] ? [fmtMonthLabel(dateRange[0]), fmtMonthLabel(dateRange[1])] : null;

  // ── Reference month dropdown options (within current dateRange) ───────────
  const refMonthOptions = useMemo(() => {
    if (allMonths.length === 0) return [];
    const [i0, i1] = monthIdxRange;
    return allMonths.slice(i0, i1 + 1);
  }, [allMonths, monthIdxRange]);

  if (visLoading || !visible) return null;

  // Helper for chart 2/3 titles that need to differentiate "Brasil" from a
  // company name in the section labels (e.g. "Top Brasil Fields" vs "Top
  // PRIO Fields"). Brasil view drops the "stake-weighted" qualifier.
  const chart2Title = `Top ${view} Fields — ${fmtMonthLabel(referenceDate)} (kbpd)`;
  const chart3Title = `Installations (FPSO/UEP) — ${view} — ${fmtMonthLabel(referenceDate)}`;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar (left, ~280px) — canonical project pattern ─── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />
              <div className="sidebar-section-label">Filters</div>

              {/* Period — Round 13 (2026-05-27): 5 preset buttons replace
                  the rc-slider. State still lives in `dateRange`; clicks
                  call the existing `setDateRange`. */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                <PeriodPresetButtons
                  dateRange={dateRange}
                  latestMonth={latestMonth}
                  firstAvailableMonth={allMonths[0] ?? null}
                  onPick={setDateRange}
                  disabled={allMonths.length === 0}
                />
              </div>

              {/* Reference month (for top fields / FPSOs / Header table) */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Reference month</div>
                <select
                  value={referenceDate}
                  onChange={(e) => setReferenceDate(e.target.value)}
                  disabled={refMonthOptions.length === 0}
                  style={{
                    width: "100%",
                    fontFamily: "Arial",
                    fontSize: 13,
                    padding: "8px 10px",
                    border: "1px solid #c5c5cb",
                    borderRadius: 6,
                    background: "#ffffff",
                  }}
                >
                  {refMonthOptions.map((m) => (
                    <option key={m} value={m}>{fmtMonthLabel(m)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content (right) ─────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Brazil Production Summary"
                sub="Monthly oil & gas production from ANP CDP — company-attributable via field stakes"
                period={periodBadge}
                rightSlot={<ExportButton spec={wellByWellExport} />}
              />

              {/* ── 5 view pills — Brasil + 4 companies (Round 9, 2026-05-27) ─── */}
              <ViewPillsRow value={view} onChange={setView} />

              {bootstrapping ? (
                <div style={{ marginTop: 40 }}>
                  <BarrelLoading />
                  <div style={{ textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 13 }}>
                    Loading production data…
                  </div>
                </div>
              ) : (
                <>
                  {/* ── Header table (full width of main, Round 10) ───── */}
                  <div style={{ marginBottom: 24 }}>
                    <div
                      style={{
                        fontFamily: "Arial",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#1a1a1a",
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                        marginBottom: 6,
                      }}
                    >
                      Headline — {fmtMonthLabel(referenceDate)} — {(view === "Brasil" ? "Brazil" : view).toUpperCase()}
                    </div>
                    <HeaderTable
                      rows={headerData}
                      loading={headerLoading}
                      referenceDate={referenceDate}
                      viewMode={view}
                    />
                  </div>

                  {/* ── Chart 1: Oil Production (full width) ─────────────────── */}
                  <div style={{ marginBottom: 16 }}>
                    <ChartSection
                      title={chart1Title}
                      loading={chart1Loading}
                      height={320}
                    >
                      <PlotlyChart
                        data={oilChart.data}
                        layout={oilChart.layout}
                        style={{ width: "100%", height: 320 }}
                      />
                    </ChartSection>
                  </div>

                  {/* ── Charts 2 & 3 side-by-side ────────────────────────────── */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 16,
                      marginBottom: 16,
                    }}
                  >
                    <ChartSection
                      title={chart2Title}
                      loading={topFieldsLoading}
                      height={360}
                    >
                      <div style={{ position: "relative" }}>
                        <PlotlyChart
                          data={topFieldsChart.data}
                          layout={topFieldsChart.layout}
                          style={{ width: "100%", height: 360, cursor: topFields.length > 0 ? "pointer" : "default" }}
                          onClick={(e: PlotMouseEvent) => {
                            const point = e?.points?.[0];
                            if (!point) return;
                            const value = (point as { y?: unknown }).y;
                            if (typeof value === "string" && value.length > 0) {
                              openFieldDrill(value);
                            }
                          }}
                        />
                        {topFields.length > 0 && (
                          <div
                            style={{
                              marginTop: 4,
                              fontFamily: "Arial",
                              fontSize: 10.5,
                              color: "#888",
                              textAlign: "center",
                            }}
                          >
                            Click a bar to drill into a field&apos;s monthly history
                          </div>
                        )}
                      </div>
                    </ChartSection>
                    <ChartSection
                      title={chart3Title}
                      loading={installationsLoading}
                      height={360}
                    >
                      <div
                        style={{
                          maxHeight: 336,
                          overflowY: "auto",
                          fontFamily: "Arial",
                          fontSize: 12,
                        }}
                      >
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
                            <tr>
                              <th style={thStyle}>Installation</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>Oil (kbpd)</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>Gas (Mm³/d)</th>
                              <th style={{ ...thStyle, textAlign: "right" }}>Hours rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {installations.slice(0, 12).map((inst) => (
                              <tr
                                key={inst.instalacao}
                                onClick={() => openInstallationDrill(inst.instalacao)}
                                style={{
                                  cursor: "pointer",
                                  transition: "background-color 0.12s",
                                }}
                                onMouseEnter={(e) => {
                                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "#fff5ef";
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "transparent";
                                }}
                                title={`Drill into ${inst.instalacao} monthly history`}
                              >
                                <td style={tdStyle}>{inst.instalacao}</td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                  {fmtNumber(bblDiaToKbpd(inst.oil_bbl_dia), 1)}
                                </td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                  {fmtNumber(inst.gas_mm3_dia, 2)}
                                </td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                  {(inst.hours_rate * 100).toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                            {installations.length === 0 && (
                              <tr>
                                <td
                                  colSpan={4}
                                  style={{ ...tdStyle, textAlign: "center", color: "#888", padding: 20 }}
                                >
                                  No installations for this month.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {installations.length > 0 && (
                        <div
                          style={{
                            marginTop: 4,
                            fontFamily: "Arial",
                            fontSize: 10.5,
                            color: "#888",
                            textAlign: "center",
                          }}
                        >
                          Click a row to drill into an installation&apos;s monthly history
                        </div>
                      )}
                    </ChartSection>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Drill modals ─────────────────────────────────────────────────── */}
      {drillCampo && (
        <FieldDrillModal
          campo={drillCampo}
          empresa={viewEmpresa ?? "Brasil"}
          loading={drillLoading}
          error={drillError}
          series={drillTimeseries}
          kpiTable={drillKpiTable}
          onClose={closeFieldDrill}
          drillTab={drillTab}
          setDrillTab={setDrillTab}
          drillBswMode={drillBswMode}
          setDrillBswMode={setDrillBswMode}
          drillBswWellPoints={drillBswWellPoints}
          drillBswFieldPoints={drillBswFieldPoints}
          drillBswLoading={drillBswLoading}
          drillBswError={drillBswError}
          prefetchBswField={prefetchBswField}
          drillDepletionMode={drillDepletionMode}
          setDrillDepletionMode={setDrillDepletionMode}
          drillDepletionWellPoints={drillDepletionWellPoints}
          drillDepletionFieldPoints={drillDepletionFieldPoints}
          drillDepletionLoading={drillDepletionLoading}
          drillDepletionError={drillDepletionError}
          prefetchDepletionField={prefetchDepletionField}
        />
      )}

      {drillInstalacao && (
        <InstallationDrillModal
          instalacao={drillInstalacao}
          empresa={viewEmpresa ?? "Brasil"}
          loading={drillInstalacaoLoading}
          error={drillInstalacaoError}
          series={drillInstalacaoTimeseries}
          kpiTable={drillInstalacaoKpiTable}
          onClose={closeInstallationDrill}
        />
      )}
    </div>
  );
}

// ─── Inline table styles ──────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #e0e0e0",
  fontWeight: 600,
  textAlign: "left",
  color: "#1a1a1a",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.4px",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderBottom: "1px solid #f0f0f0",
  color: "#1a1a1a",
};

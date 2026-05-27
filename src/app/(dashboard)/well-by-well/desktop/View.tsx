"use client";

// Desktop View — /well-by-well (≥769px).
//
// Layout (top → bottom):
//   • Header — title + subtitle + period badge + Export panel (right)
//   • Top split (Round 8, 2026-05-27):
//       LEFT  (~35%)  — Empresa · Period · Reference month · Ambientes
//       RIGHT (~65%)  — HeaderTable (PDF-style page-2 replica)
//     Falls back to single-column < 1100px so the table stays legible.
//   • Charts row 1 — P1 (Brazil oil, stacked) · P2 (Company oil, stacked)
//   • Charts row 2 — P3 (Top fields, horizontal bar) · P4 (Installations table)
//
// Round 6 (2026-05-27): top KPI strip removed (broken Δ MoM/YoY against the
// partial reference month). All three production charts now render in-bar
// segment labels + a total annotation above each bar (per the PDF reference).
// `KpiCard` is preserved because the field/installation drill modals still
// use it — those KPIs are valid (full-month series, no partial-period
// divisor).
//
// Round 8 (2026-05-27): added the PDF-style HeaderTable next to the filters
// (consumes `get_well_by_well_header` via the shared hook). Removed the bottom
// YoY/MoM/YTD table — it was a strict subset of the HeaderTable's company
// section. Mobile keeps its YoY collapsible drawer (different UX surface).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] with an explicit reason.

import { useEffect, useMemo } from "react";
import type { Layout, PlotData, PlotMouseEvent } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import HeaderTable from "../HeaderTable";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";
import { bblDiaToKbpd } from "../../../../lib/units";

import {
  useProductionData,
  fmtNumber,
  fmtPct,
  fmtMonthLabel,
  AMBIENTES,
  AMBIENTE_COLOR,
  BRAND_ORANGE,
  TOP_FIELDS_OIL_COLOR,
  TOP_FIELDS_WATER_COLOR,
} from "../useProductionData";
import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
  ProductionFieldTimeseriesRow,
  ProductionInstallationTimeseriesRow,
} from "../../../../types/production";

// ─── Chart builders ───────────────────────────────────────────────────────────

/**
 * Build a stacked-bar trace per ambiente, x = month label, y = oil in kbpd.
 *
 * Round 6 (2026-05-27): each trace carries its rounded kbpd value as in-bar
 * text (white, centered, hidden when the segment is too short to fit — i.e.
 * < `MIN_SEGMENT_KBPD_LABEL` kbpd). The layout adds one annotation per month
 * showing the per-month total above the bar so the reader sees both the mix
 * (segments) and the headline (total) at a glance — mirroring the PDF
 * Well-by-Well reference. Margin `t` bumped to 30 so totals don't clip into
 * the legend.
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

  // Build one trace per ambiente. Company uses brand orange for PreSal accent;
  // Brazil uses neutral greyscale.
  const traces: PlotData[] = AMBIENTES.map((amb) => {
    const baseColor = variant === "company" && amb === "PreSal"
      ? BRAND_ORANGE
      : AMBIENTE_COLOR[amb] ?? "#aaaaaa";
    const ys = ambienteY[amb];
    // Light segments (Terra: #c5c5cb) need a dark label to remain readable;
    // dark segments (PreSal/PosSal/brand orange) take a white label.
    const labelColor = amb === "Terra" ? "#1a1a1a" : "#ffffff";
    return {
      type: "bar",
      name: amb,
      x: months,
      y: ys,
      text: ys.map((v) => (v >= MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "")),
      textposition: "inside",
      insidetextanchor: "middle",
      textfont: { color: labelColor, size: 11, family: "Arial" },
      cliponaxis: false,
      marker: { color: baseColor },
      hovertemplate: `${amb}: %{y:,.1f} kbpd<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      // `t: 30` gives the per-bar total annotations room without clipping
      // against the legend strip at y = 1.01.
      margin: { t: 30, b: 60, l: 60, r: 20 },
      barmode: "stack",
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "kbpd" } },
      xaxis: {
        ...AXIS_LINE,
        type: "date",
        tickformat: "%b %Y",
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

  const sorted = [...rows].sort((a, b) => {
    if (a.ano !== b.ano) return a.ano - b.ano;
    return a.mes - b.mes;
  });
  const xs = sorted.map(
    (r) => `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`,
  );
  const oil = sorted.map((r) => bblDiaToKbpd(r.oil_bbl_dia));
  const water = sorted.map((r) => bblDiaToKbpd(r.water_bbl_dia));
  const hoursPct = sorted.map((r) => r.hours_rate * 100);

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
        line: { color: BRAND_ORANGE, width: 2 },
        marker: { color: BRAND_ORANGE, size: 6 },
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
        tickformat: "%b %Y",
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
 *
 * Round 6 (2026-05-27): oil and water segments now carry rounded kbpd values
 * inside the segment (hidden when < `MIN_SEGMENT_KBPD_LABEL` kbpd), and each
 * row gets a bold total annotation at the right end of the stacked bar so
 * the reader can rank fields at a glance. Right margin bumped to 60 to give
 * the rightmost totals room without clipping.
 */
function buildTopFieldsChart(
  fields: ProductionTopField[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!fields.length) return emptyPlot(360, "No field-level data for this month.");

  // Sort DESC by oil (server already does it, but be defensive).
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
        // Light blue (#7BB6DD) background — dark text reads better.
        textfont: { color: "#1a1a1a", size: 11, family: "Arial" },
        cliponaxis: false,
        marker: { color: TOP_FIELDS_WATER_COLOR },
        hovertemplate: "Water: %{x:,.1f} kbpd<extra>%{y}</extra>",
      } as PlotData,
    ],
    layout: {
      ...COMMON_LAYOUT,
      height: 360,
      // `r: 60` gives room for the per-bar total annotations at the right
      // end of each stacked bar.
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

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  accent,
  delta,
  loading = false,
  hasData = true,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
  delta?: { pct: number | null; label: string };
  /** Backing RPC is currently in-flight. Card dims subtly; value persists. */
  loading?: boolean;
  /** Whether any value has ever been received. When false + loading, show skeleton. */
  hasData?: boolean;
}): React.ReactElement {
  const deltaSign = delta?.pct == null ? null : delta.pct >= 0 ? "up" : "down";
  const deltaColor = deltaSign === "up" ? "#197a39" : deltaSign === "down" ? "#b3261e" : "#888";
  const deltaArrow = deltaSign === "up" ? "▲" : deltaSign === "down" ? "▼" : "";
  // Round 5: first-load skeleton (no prior data + currently fetching).
  const showSkeleton = loading && !hasData;
  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: "14px 18px",
        background: "#ffffff",
        flex: "1 1 0",
        minWidth: 0,
        borderLeft: accent ? `4px solid ${BRAND_ORANGE}` : "4px solid transparent",
        // Subtle dim while refreshing existing data, but keep value readable.
        opacity: loading && hasData ? 0.75 : 1,
        transition: "opacity 0.18s ease",
        position: "relative",
      }}
    >
      <div
        style={{
          fontFamily: "Arial",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          color: "#888",
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {showSkeleton ? (
        <div
          aria-busy="true"
          aria-label="Loading"
          className="wbw-kpi-skeleton"
          style={{
            height: 26,
            width: "70%",
            borderRadius: 4,
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: "Arial",
            fontSize: 24,
            fontWeight: 700,
            color: "#1a1a1a",
            lineHeight: 1.1,
          }}
        >
          {value}
          <span style={{ fontSize: 12, fontWeight: 500, color: "#888", marginLeft: 6 }}>
            {unit}
          </span>
        </div>
      )}
      {delta && delta.pct != null && !showSkeleton && (
        <div
          style={{
            marginTop: 6,
            fontFamily: "Arial",
            fontSize: 11,
            fontWeight: 600,
            color: deltaColor,
          }}
        >
          {deltaArrow} {fmtPct(delta.pct)} {delta.label}
        </div>
      )}
    </div>
  );
}

// ─── Field drill-down modal ───────────────────────────────────────────────────
//
// Bootstrap-styled modal (matches ExportModal chrome). Body: 4 KPI cards on top
// + 13mo timeseries chart (oil/water stacked + hours-rate line on right axis).
// Closes on Esc, scrim click, or × button.

function FieldDrillModal({
  campo,
  empresa,
  loading,
  error,
  series,
  kpis,
  onClose,
}: {
  campo: string;
  empresa: string;
  loading: boolean;
  error: string | null;
  series: ProductionFieldTimeseriesRow[];
  kpis: {
    currentOil: number;
    prevOil: number | null;
    momPct: number | null;
    yoyPct: number | null;
    ytdAvg: number | null;
  };
  onClose: () => void;
}): React.ReactElement {
  const chart = useMemo(() => buildFieldDrillChart(series), [series]);

  // Close on Escape.
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
        {/* Header */}
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

        {/* Body */}
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

          {/* KPI strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            <KpiCard
              label="Current oil"
              value={fmtNumber(kpis.currentOil, 1)}
              unit="kbpd"
              accent
            />
            <KpiCard
              label="Δ MoM"
              value={kpis.momPct == null ? "—" : fmtPct(kpis.momPct)}
              unit=""
            />
            <KpiCard
              label="Δ YoY"
              value={kpis.yoyPct == null ? "—" : fmtPct(kpis.yoyPct)}
              unit=""
            />
            <KpiCard
              label="YTD avg"
              value={kpis.ytdAvg == null ? "—" : fmtNumber(kpis.ytdAvg, 1)}
              unit="kbpd"
            />
          </div>

          {/* Chart */}
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
                No data for this field in the current period.
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, color: "#888" }}>
            Bars: stake-weighted oil (dark) + water (light blue) in kbpd ·
            Line: monthly uptime fraction · Period reflects the dashboard filters.
          </div>
        </div>

        {/* Footer */}
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

        {/* Brand accent bar */}
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

// ─── Installation drill-down modal (Round 3, 2026-05-27) ─────────────────────
//
// Mirrors FieldDrillModal exactly — same 820px chrome, brand-orange accent,
// Esc/scrim/× close, same 4-KPI strip + 13mo timeseries chart. Only differences
// are the header label ("Installation" semantic) and the source of timeseries
// (installation RPC instead of field RPC). The chart builder is reused since
// `ProductionInstallationTimeseriesRow` is a type alias of
// `ProductionFieldTimeseriesRow` — both carry the same row shape.
//
// Field and installation drills are mutually exclusive at the hook level, so
// only one of these modals is ever mounted at a time.

function InstallationDrillModal({
  instalacao,
  empresa,
  loading,
  error,
  series,
  kpis,
  onClose,
}: {
  instalacao: string;
  empresa: string;
  loading: boolean;
  error: string | null;
  series: ProductionInstallationTimeseriesRow[];
  kpis: {
    currentOil: number;
    prevOil: number | null;
    momPct: number | null;
    yoyPct: number | null;
    ytdAvg: number | null;
  };
  onClose: () => void;
}): React.ReactElement {
  // Reuse the field chart builder — the row shape is identical.
  const chart = useMemo(() => buildFieldDrillChart(series), [series]);

  // Close on Escape.
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
        {/* Header */}
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

        {/* Body */}
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

          {/* KPI strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            <KpiCard
              label="Current oil"
              value={fmtNumber(kpis.currentOil, 1)}
              unit="kbpd"
              accent
            />
            <KpiCard
              label="Δ MoM"
              value={kpis.momPct == null ? "—" : fmtPct(kpis.momPct)}
              unit=""
            />
            <KpiCard
              label="Δ YoY"
              value={kpis.yoyPct == null ? "—" : fmtPct(kpis.yoyPct)}
              unit=""
            />
            <KpiCard
              label="YTD avg"
              value={kpis.ytdAvg == null ? "—" : fmtNumber(kpis.ytdAvg, 1)}
              unit="kbpd"
            />
          </div>

          {/* Chart */}
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

          <div style={{ fontSize: 11, color: "#888" }}>
            Bars: stake-weighted oil (dark) + water (light blue) routed through
            this installation in kbpd · Line: monthly uptime fraction · Period
            reflects the dashboard filters.
          </div>
        </div>

        {/* Footer */}
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

        {/* Brand accent bar */}
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
    empresasList, empresa, setEmpresa,
    allMonths, dateRange, monthIdxRange, setMonthIdxRange,
    ambientes, toggleAmbiente, setAmbientes,
    referenceDate, setReferenceDate,
    brazilData, companyData, topFields, installations,
    headerData, headerLoading,
    brazilLoading, companyLoading, topFieldsLoading, installationsLoading,
    excelLoading, csvLoading,
    handleExportExcel, handleExportCsv,
    drillCampo, drillTimeseries, drillLoading, drillError, drillKpis,
    openFieldDrill, closeFieldDrill,
    drillInstalacao, drillInstalacaoTimeseries, drillInstalacaoLoading,
    drillInstalacaoError, drillInstalacaoKpis,
    openInstallationDrill, closeInstallationDrill,
  } = useProductionData();

  // ── Chart memoisation ─────────────────────────────────────────────────────
  const brazilChart = useMemo(
    () => buildStackedOilBars(brazilData, "brazil"),
    [brazilData],
  );
  const companyChart = useMemo(
    () => buildStackedOilBars(companyData, "company"),
    [companyData],
  );
  const topFieldsChart = useMemo(
    () => buildTopFieldsChart(topFields),
    [topFields],
  );

  // ── Empresa dropdown options ──────────────────────────────────────────────
  const dropdownOptions = useMemo(() => {
    const list = empresasList.length ? empresasList : [{ empresa, n_campos: 0 }];
    // Make sure the current empresa is selectable even if not in the list yet.
    if (!list.find((e) => e.empresa === empresa)) {
      return [{ empresa, n_campos: 0 }, ...list];
    }
    return list;
  }, [empresasList, empresa]);

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

  return (
    <div>
      <NavBar />
      <div className="container-fluid" style={{ padding: "20px 24px 80px" }}>
        <DashboardHeader
          title="Well by Well"
          sub="Monthly oil & gas production from ANP CDP — company-attributable via field stakes"
          period={periodBadge}
          rightSlot={
            <ExportPanel
              actions={[
                {
                  kind: "excel",
                  label: "Excel",
                  busy: excelLoading,
                  disabled: excelLoading || csvLoading || bootstrapping,
                  loadingLabel: "Building workbook…",
                  onClick: handleExportExcel,
                },
                {
                  kind: "csv",
                  label: "CSV (zip)",
                  busy: csvLoading,
                  disabled: excelLoading || csvLoading || bootstrapping,
                  loadingLabel: "Building zip…",
                  onClick: handleExportCsv,
                },
              ]}
            />
          }
        />

        {bootstrapping ? (
          <div style={{ marginTop: 40 }}>
            <BarrelLoading />
            <div style={{ textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 13 }}>
              Loading production data…
            </div>
          </div>
        ) : (
          <>
            {/* ── Top region: filters (left ~35%) + Header table (right ~65%) ─
                Round 8 (2026-05-27): the topbar was previously a single full-
                width row of filters above the charts. We now split it into a
                two-column grid so the PDF-style HeaderTable (which mirrors
                page 2 of the monthly report) sits next to the filter stack
                and gets first-fold real estate. On viewports < 1100px the
                grid collapses to a single column (filters on top, table
                below) so the table never gets squished. */}
            <div
              className="wbw-top-split"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(260px, 35%) 1fr",
                gap: 20,
                alignItems: "stretch",
                padding: "16px 0 20px",
                borderBottom: "1px solid #f0f0f0",
                marginBottom: 20,
              }}
            >
              {/* ── Filters column (left) ───────────────────────────────── */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  minWidth: 0,
                }}
              >
                {/* Empresa */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontFamily: "Arial",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#1a1a1a",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                      marginBottom: 6,
                    }}
                  >
                    Company
                  </label>
                  <select
                    value={empresa}
                    onChange={(e) => setEmpresa(e.target.value)}
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
                    {dropdownOptions.map((opt) => (
                      <option key={opt.empresa} value={opt.empresa}>
                        {opt.empresa}{opt.n_campos > 0 ? ` (${opt.n_campos} fields)` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Period */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontFamily: "Arial",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#1a1a1a",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                      marginBottom: 6,
                    }}
                  >
                    Period
                  </label>
                  {allMonths.length > 0 && (
                    <PeriodSlider
                      dates={allMonths}
                      value={monthIdxRange}
                      onChange={setMonthIdxRange}
                      fmtLabel={(d) => fmtMonthLabel(d)}
                    />
                  )}
                </div>

                {/* Reference month (for top fields / FPSOs / Header table) */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontFamily: "Arial",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#1a1a1a",
                      textTransform: "uppercase",
                      letterSpacing: "0.4px",
                      marginBottom: 6,
                    }}
                  >
                    Reference month
                  </label>
                  <select
                    value={referenceDate}
                    onChange={(e) => setReferenceDate(e.target.value)}
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

                {/* Ambiente */}
                <div>
                  <MultiSelectFilter
                    label="Environment"
                    items={AMBIENTES as unknown as string[]}
                    selected={ambientes}
                    onToggle={toggleAmbiente}
                    onClear={ambientes.length < AMBIENTES.length ? () => setAmbientes([...AMBIENTES]) : undefined}
                    idPrefix="prod-amb"
                    swatch={(item) => AMBIENTE_COLOR[item] ?? "#aaa"}
                  />
                </div>
              </div>

              {/* ── Header table column (right) ─────────────────────────── */}
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    fontFamily: "Arial",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                    marginBottom: 2,
                  }}
                >
                  Headline — {fmtMonthLabel(referenceDate)}
                </div>
                <HeaderTable
                  rows={headerData}
                  loading={headerLoading}
                  referenceDate={referenceDate}
                />
              </div>

              {/* Single-column fallback for narrow desktop / tablet widths.
                  Below 1100px the table needs the full row to remain legible
                  so the grid collapses to 1 column (filters then table). */}
              <style>{`
                @media (max-width: 1099px) {
                  .wbw-top-split { grid-template-columns: 1fr !important; }
                }
              `}</style>
            </div>

            {/* ── KPI strip removed in Round 6 (2026-05-27) ───────────────
                Δ MoM / Δ YoY computed against a partial reference month
                produced misleading multi-hundred-percent figures. The Round
                8 PDF-style HeaderTable above (server-derived against full
                historical months) is the canonical breakdown; the PDF
                Well-by-Well report doesn't use KPI cards either. `KpiCard`
                is still imported because the field/installation drill modals
                use it (those KPIs sum a full historical timeseries and are
                arithmetically sound). */}

            {/* ── Charts row 1 ────────────────────────────────────────────── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <ChartSection
                title="Brazil — Oil Production (kbpd)"
                loading={brazilLoading}
                height={320}
              >
                <PlotlyChart
                  data={brazilChart.data}
                  layout={brazilChart.layout}
                  style={{ width: "100%", height: 320 }}
                />
              </ChartSection>
              <ChartSection
                title={`${empresa} — Oil Production (kbpd, stake-weighted)`}
                loading={companyLoading}
                height={320}
              >
                <PlotlyChart
                  data={companyChart.data}
                  layout={companyChart.layout}
                  style={{ width: "100%", height: 320 }}
                />
              </ChartSection>
            </div>

            {/* ── Charts row 2 ────────────────────────────────────────────── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <ChartSection
                title={`Top ${empresa} Fields — ${fmtMonthLabel(referenceDate)} (kbpd)`}
                loading={topFieldsLoading}
                height={360}
              >
                <div style={{ position: "relative" }}>
                  <PlotlyChart
                    data={topFieldsChart.data}
                    layout={topFieldsChart.layout}
                    style={{ width: "100%", height: 360, cursor: topFields.length > 0 ? "pointer" : "default" }}
                    onClick={(e: PlotMouseEvent) => {
                      // Bar y-axis carries the campo name (one of `topFields[].campo`).
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
                title={`Installations (FPSO/UEP) — ${fmtMonthLabel(referenceDate)}`}
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

            {/* ── YoY table REMOVED in Round 8 (2026-05-27) ───────────────
                The existing YoY/MoM/YTD breakdown (TOTAL + per-ambiente rows
                for the selected company) is now a STRICT SUBSET of the
                PDF-style HeaderTable rendered at the top of the page next to
                the filters. The HeaderTable shows the same TOTAL + per-
                ambiente breakdown for the company AND Brazil-wide context
                AND gas (kboed) AND main fields, all derived against full
                historical months by the same server-side math
                (`get_well_by_well_header`). Keeping both tables would have
                duplicated the same numbers in two places. Mobile keeps the
                YoY collapsible drawer because the HeaderTable is at the top
                and horizontal-scroll discoverability is weaker on phones. */}
          </>
        )}
      </div>

      {/* ── Field drill-down modal (Round 2, 2026-05-27) ─────────────────── */}
      {drillCampo && (
        <FieldDrillModal
          campo={drillCampo}
          empresa={empresa}
          loading={drillLoading}
          error={drillError}
          series={drillTimeseries}
          kpis={drillKpis}
          onClose={closeFieldDrill}
        />
      )}

      {/* ── Installation drill-down modal (Round 3, 2026-05-27) ──────────── */}
      {drillInstalacao && (
        <InstallationDrillModal
          instalacao={drillInstalacao}
          empresa={empresa}
          loading={drillInstalacaoLoading}
          error={drillInstalacaoError}
          series={drillInstalacaoTimeseries}
          kpis={drillInstalacaoKpis}
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

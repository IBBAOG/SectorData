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
// partial reference month). `KpiCard` is preserved because the field/
// installation drill modals still use it.
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
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import HeaderTable from "../HeaderTable";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";
import { bblDiaToKbpd } from "../../../../lib/units";
import {
  WELL_BY_WELL_VIEWS,
  type WellByWellView,
} from "../../../../data/wellByWellEmpresas";

import {
  useProductionData,
  fmtNumber,
  fmtPct,
  fmtMonthLabel,
  AMBIENTES,
  AMBIENTE_COLOR,
  labelAmbiente,
  BRAND_ORANGE,
  TOP_FIELDS_OIL_COLOR,
  TOP_FIELDS_WATER_COLOR,
  PERIOD_PRESETS,
  PERIOD_PRESET_LABEL,
  computePresetRange,
  detectPeriodPreset,
  type PeriodPreset,
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

// ─── Field drill-down modal ───────────────────────────────────────────────────

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
            Bars: oil (dark) + water (light blue) in kbpd ·
            Line: monthly uptime fraction · Period reflects the dashboard filters.
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

// ─── Installation drill-down modal ─────────────────────────────────────────────

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
            Bars: oil (dark) + water (light blue) routed through
            this installation in kbpd · Line: monthly uptime fraction · Period
            reflects the dashboard filters.
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
    excelLoading, csvLoading,
    handleExportExcel, handleExportCsv,
    drillCampo, drillTimeseries, drillLoading, drillError, drillKpis,
    openFieldDrill, closeFieldDrill,
    drillInstalacao, drillInstalacaoTimeseries, drillInstalacaoLoading,
    drillInstalacaoError, drillInstalacaoKpis,
    openInstallationDrill, closeInstallationDrill,
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
          kpis={drillKpis}
          onClose={closeFieldDrill}
        />
      )}

      {drillInstalacao && (
        <InstallationDrillModal
          instalacao={drillInstalacao}
          empresa={viewEmpresa ?? "Brasil"}
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

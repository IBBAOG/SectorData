"use client";

// Mobile View — /well-by-well (≤768px).
//
// Layout (top → bottom):
//   MobileTopBar              — wordmark
//   StickyBreadcrumb          — "Well by Well › <View> › <Ref month>"
//   View pills row (Round 9)  — 5 pills, horizontally scrollable. Replaces
//                               the empresa <select> in the FilterDrawer.
//   HeaderTable               — PDF-style page-2 header, wrapped in a
//                               horizontally scrollable container. In Brasil
//                               mode the company section is hidden client-
//                               side.
//   MobileTabBar              — Aggregate · Top Fields · FPSOs (Round 9: was
//                               Brazil · {Empresa} · Fields · FPSOs; the
//                               first two tabs collapsed into "Aggregate"
//                               since the active view pill now decides
//                               whether the aggregate chart shows Brazil or
//                               company data).
//   Tab content               — one full-width chart per tab.
//   YoY expandable section    — bottom, hidden in Brasil mode (no per-
//                               ambiente YoY rows from the Brazil-wide RPC).
//   ExportFAB                 — opens an action sheet to pick Excel or CSV
//   FilterDrawer              — period + reference month only (no company
//                               selector — Round 9 pills replaced it; no
//                               environment multi-select — Round 14 removed it
//                               and all 3 ambientes are always shown).
//
// Mobile is "same analysis, adapted clothing" — same hook, same metrics,
// same view pill state machine, presented one panel at a time so it's
// legible on a phone.
//
// Round 6 (2026-05-27): top KPI tiles removed from the tabs. `MobileKpi` is
// preserved because the field and installation drill BottomSheets still use
// it.
//
// Round 9 (2026-05-27): pills row at the top + simplified 3-tab structure.
// Empresa <select> dropped from FilterDrawer.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [mobile-only] with an explicit reason.

import { useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import {
  MobileTopBar,
  FilterDrawer,
  MobileChart,
  MobileDataCard,
  ExportFAB,
  MobileTabBar,
  BottomSheet,
  FilterIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "../../../../components/dashboard/mobile";
import StickyBreadcrumb from "../../../../components/dashboard/mobile/StickyBreadcrumb";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import HeaderTable from "../HeaderTable";
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
} from "../useProductionData";
import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
  ProductionFieldTimeseriesRow,
  ProductionInstallationTimeseriesRow,
} from "../../../../types/production";

// Round 9: tabs reduced from 4 → 3. The "Brazil" and "{Empresa}" tabs were
// folded into a single "Aggregate" tab whose content branches on the active
// view pill (Brasil → Brazil chart; company → company chart). "Fields" is
// the same as the desktop chart 2; "FPSOs" is chart 3.
type Tab = "aggregate" | "fields" | "fpsos";

// ─── Mobile chart builders ───────────────────────────────────────────────────

/**
 * Round 6: mobile data-label threshold is higher than desktop (`80` vs `30`
 * kbpd) because narrow phone bars cannot fit a 4-digit label even when the
 * value is technically non-trivial. The total annotation above each bar
 * carries the headline number regardless.
 */
const MOBILE_MIN_SEGMENT_KBPD_LABEL = 80;

function fmtIntPtBr(n: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

function buildTotalAnnotations(
  months: string[],
  ambienteYs: Record<string, number[]>,
): Partial<Layout>["annotations"] {
  const totals = months.map((_, i) =>
    AMBIENTES.reduce((s, amb) => s + (ambienteYs[amb]?.[i] ?? 0), 0),
  );
  return months.map((m, i) => ({
    x: m,
    y: totals[i],
    text: `<b>${fmtIntPtBr(totals[i])}</b>`,
    showarrow: false,
    yshift: 10,
    xanchor: "center",
    font: { size: 10, color: "#1a1a1a", family: "Arial" },
  }));
}

interface StackedBuildResult {
  data: PlotData[];
  annotations: Partial<Layout>["annotations"];
}

function buildStackedSeries(
  rows: (ProductionBrazilRow | ProductionCompanyRow)[],
  variant: "brazil" | "company",
): StackedBuildResult {
  if (!rows.length) return { data: [], annotations: [] };
  const monthSet = new Set<string>();
  for (const r of rows) {
    monthSet.add(`${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`);
  }
  const months = Array.from(monthSet).sort();

  const pivot: Record<string, Record<string, number>> = {};
  for (const a of AMBIENTES) pivot[a] = {};
  for (const r of rows) {
    const key = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
    if (!pivot[r.ambiente]) pivot[r.ambiente] = {};
    pivot[r.ambiente][key] = (pivot[r.ambiente][key] ?? 0) + r.oil_bbl_dia;
  }

  const ambienteYs: Record<string, number[]> = {};
  for (const amb of AMBIENTES) {
    ambienteYs[amb] = months.map((m) => bblDiaToKbpd(pivot[amb]?.[m] ?? 0));
  }

  // Round 15 (2026-05-27): palette swapped to the PDF report convention —
  // PreSal dark navy, PosSal brand orange, Terra mint green — so the legacy
  // "variant === company" PreSal-orange override is gone. Both Brasil and
  // company views share the same PDF palette. Display labels translate the
  // raw DB value (`PreSal`/`PosSal`/`Terra`) to English
  // (`Pre-Salt`/`Post-Salt`/`Onshore`) via `labelAmbiente`. `variant` is
  // retained as a parameter for call-site signaling but no longer changes
  // colors.
  void variant; // intentionally unused now
  const data: PlotData[] = AMBIENTES.map((amb) => {
    const baseColor = AMBIENTE_COLOR[amb] ?? "#aaaaaa";
    const ys = ambienteYs[amb];
    const labelColor = amb === "Terra" ? "#1a1a1a" : "#ffffff";
    const displayName = labelAmbiente(amb);
    return {
      type: "bar",
      name: displayName,
      x: months,
      y: ys,
      text: ys.map((v) =>
        v >= MOBILE_MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "",
      ),
      textposition: "inside",
      insidetextanchor: "middle",
      textfont: { color: labelColor, size: 10, family: "Arial" },
      cliponaxis: false,
      marker: { color: baseColor },
      hovertemplate: `${displayName}: %{y:,.1f} kbpd<extra></extra>`,
    } as PlotData;
  });

  return { data, annotations: buildTotalAnnotations(months, ambienteYs) };
}

function buildFieldDrillSeries(rows: ProductionFieldTimeseriesRow[]): PlotData[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => {
    if (a.ano !== b.ano) return a.ano - b.ano;
    return a.mes - b.mes;
  });
  const xs = sorted.map(
    (r) => `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`,
  );
  return [
    {
      type: "bar",
      name: "Oil",
      x: xs,
      y: sorted.map((r) => bblDiaToKbpd(r.oil_bbl_dia)),
      marker: { color: TOP_FIELDS_OIL_COLOR },
      hovertemplate: "Oil: %{y:,.1f} kbpd<extra></extra>",
      yaxis: "y",
    } as PlotData,
    {
      type: "bar",
      name: "Water",
      x: xs,
      y: sorted.map((r) => bblDiaToKbpd(r.water_bbl_dia)),
      marker: { color: TOP_FIELDS_WATER_COLOR },
      hovertemplate: "Water: %{y:,.1f} kbpd<extra></extra>",
      yaxis: "y",
    } as PlotData,
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Hours",
      x: xs,
      y: sorted.map((r) => r.hours_rate * 100),
      line: { color: BRAND_ORANGE, width: 2 },
      marker: { color: BRAND_ORANGE, size: 5 },
      hovertemplate: "Hours: %{y:.0f}%<extra></extra>",
      yaxis: "y2",
    } as PlotData,
  ];
}

interface TopFieldsBuildResult {
  data: PlotData[];
  annotations: Partial<Layout>["annotations"];
}

function buildTopFieldsHBars(fields: ProductionTopField[]): TopFieldsBuildResult {
  if (!fields.length) return { data: [], annotations: [] };
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
        text: oil.map((v) =>
          v >= MOBILE_MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "",
        ),
        textposition: "inside",
        insidetextanchor: "middle",
        textfont: { color: "#ffffff", size: 10, family: "Arial" },
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
        text: water.map((v) =>
          v >= MOBILE_MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "",
        ),
        textposition: "inside",
        insidetextanchor: "middle",
        // Round 15: water bar swapped from light blue to brand orange per the
        // PDF (p4 Petrobras Largest Oil Producing Fields). White label keeps
        // contrast on the now-orange fill.
        textfont: { color: "#ffffff", size: 10, family: "Arial" },
        cliponaxis: false,
        marker: { color: TOP_FIELDS_WATER_COLOR },
        hovertemplate: "Water: %{x:,.1f} kbpd<extra>%{y}</extra>",
      } as PlotData,
    ],
    annotations: names.map((n, i) => ({
      x: totals[i],
      y: n,
      text: `<b>${fmtIntPtBr(totals[i])}</b>`,
      showarrow: false,
      xshift: 6,
      xanchor: "left",
      yanchor: "middle",
      font: { size: 10, color: "#1a1a1a", family: "Arial" },
    })),
  };
}

// ─── Small KPI tile (mobile) ──────────────────────────────────────────────────

function MobileKpi({
  label,
  value,
  unit,
  delta,
  loading = false,
  hasData = true,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: { pct: number | null; label: string };
  loading?: boolean;
  hasData?: boolean;
}): React.ReactElement {
  const deltaColor = delta?.pct == null ? "#888" : delta.pct >= 0 ? "#197a39" : "#b3261e";
  const deltaArrow = delta?.pct == null ? "" : delta.pct >= 0 ? "▲" : "▼";
  const showSkeleton = loading && !hasData;
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "var(--mobile-surface, #ffffff)",
        border: "1px solid var(--mobile-border, #e6e6ec)",
        flex: "1 1 0",
        minWidth: 130,
        opacity: loading && hasData ? 0.75 : 1,
        transition: "opacity 0.18s ease",
      }}
    >
      <div
        style={{
          fontFamily: "Arial",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          color: "var(--mobile-text-muted, #6b6b73)",
          letterSpacing: "0.4px",
          marginBottom: 4,
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
            height: 20,
            width: "70%",
            borderRadius: 4,
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: "Arial",
            fontSize: 18,
            fontWeight: 700,
            color: "var(--mobile-text, #1a1a1a)",
            lineHeight: 1.1,
          }}
        >
          {value}
          <span style={{ fontSize: 10, fontWeight: 500, color: "#888", marginLeft: 4 }}>{unit}</span>
        </div>
      )}
      {delta && delta.pct != null && !showSkeleton && (
        <div style={{ marginTop: 4, fontFamily: "Arial", fontSize: 10, fontWeight: 600, color: deltaColor }}>
          {deltaArrow} {fmtPct(delta.pct)} {delta.label}
        </div>
      )}
    </div>
  );
}

// ─── View pills row (Round 9, 2026-05-27) ─────────────────────────────────────
//
// Horizontally scrollable on phones — 5 pills won't fit on a ~360px viewport
// without scroll. The active pill auto-scrolls into view on selection (via
// scrollIntoView with `inline: "center"`).

function MobileViewPills({
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
      className="wbw-mobile-pills"
      style={{
        display: "flex",
        gap: 8,
        padding: "10px 12px",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        // Hide scrollbar visually but keep functionality.
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      {/* Webkit scrollbar hide */}
      <style>{`
        .wbw-mobile-pills::-webkit-scrollbar { display: none; }
      `}</style>
      {WELL_BY_WELL_VIEWS.map((opt) => {
        const isActive = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={(e) => {
              onChange(opt);
              // Scroll the tapped pill into view for clear visual feedback.
              try {
                (e.currentTarget as HTMLButtonElement).scrollIntoView({
                  behavior: "smooth",
                  inline: "center",
                  block: "nearest",
                });
              } catch {
                /* older browsers without scrollIntoView options */
              }
            }}
            style={{
              flex: "0 0 auto",
              fontFamily: "Arial",
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              padding: "8px 16px",
              borderRadius: 999,
              border: isActive ? "1px solid transparent" : "1px solid #c5c5cb",
              background: isActive ? BRAND_ORANGE : "#ffffff",
              color: isActive ? "#ffffff" : "#1a1a1a",
              cursor: "pointer",
              minHeight: 36,
              whiteSpace: "nowrap",
              userSelect: "none",
              transition: "background-color 0.18s, color 0.18s",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Period preset buttons (Round 13, 2026-05-27) ─────────────────────────────
//
// 5 mutually-exclusive preset buttons replacing the rc-slider inside the
// FilterDrawer's Period section. Same visual language as the view pills
// (brand-orange filled when active, white with 1px border otherwise).
// Mobile uses a 3+2 grid (3 columns × 2 rows) — empirically the best fit
// for ~360-420px viewports without horizontal scroll.

function MobilePeriodPresetButtons({
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
        gap: 8,
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
            style={{
              fontFamily: "Arial",
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              padding: "10px 8px",
              borderRadius: 8,
              border: isActive ? "1px solid transparent" : "1px solid #d0d0d0",
              background: isActive ? BRAND_ORANGE : "#ffffff",
              color: isActive ? "#ffffff" : "#1a1a1a",
              cursor: disabled || !latestMonth ? "not-allowed" : "pointer",
              minHeight: 44, // 44px touch target (iOS HIG)
              whiteSpace: "nowrap",
              userSelect: "none",
              transition: "background-color 0.18s, color 0.18s",
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

// ─── View ─────────────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const {
    visible, visLoading,
    bootstrapping,
    latestMonth,
    view, setView, isCompanyView: viewIsCompany, viewEmpresa,
    allMonths, dateRange, monthIdxRange, setDateRange,
    referenceDate, setReferenceDate,
    brazilData, companyData, topFields, installations, yoyTable,
    headerData, headerLoading,
    brazilLoading, companyLoading, topFieldsLoading, installationsLoading, yoyLoading,
    excelLoading, csvLoading,
    handleExportExcel, handleExportCsv,
    drillCampo, drillTimeseries, drillLoading, drillError, drillKpis,
    openFieldDrill, closeFieldDrill,
    drillInstalacao, drillInstalacaoTimeseries, drillInstalacaoLoading,
    drillInstalacaoError, drillInstalacaoKpis,
    openInstallationDrill, closeInstallationDrill,
    // Drill popup tabs (Phase 2)
    drillTab, setDrillTab,
    drillBswMode, setDrillBswMode,
    drillBswWellPoints, drillBswFieldPoints,
    drillBswLoading, drillBswError,
    drillDepletionMode, setDrillDepletionMode,
    drillDepletionWellPoints, drillDepletionFieldPoints,
    drillDepletionLoading, drillDepletionError,
  } = useProductionData();

  // Round 9: tab state defaults to "aggregate" (was "brazil").
  const [tab, setTab] = useState<Tab>("aggregate");
  const [filterOpen, setFilterOpen] = useState(false);
  const [yoyOpen, setYoyOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const refMonthOptions = useMemo(() => {
    if (allMonths.length === 0) return [];
    const [i0, i1] = monthIdxRange;
    return allMonths.slice(i0, i1 + 1);
  }, [allMonths, monthIdxRange]);

  // ── Aggregate chart data — branches on view ─────────────────────────────
  const aggregateRows: (ProductionBrazilRow | ProductionCompanyRow)[] = viewIsCompany
    ? companyData
    : brazilData;
  const aggregateLoading = viewIsCompany ? companyLoading : brazilLoading;
  const aggregateVariant: "brazil" | "company" = viewIsCompany ? "company" : "brazil";
  const aggregateSeries = useMemo(
    () => buildStackedSeries(aggregateRows, aggregateVariant),
    [aggregateRows, aggregateVariant],
  );

  const topFieldsSeries = useMemo(() => buildTopFieldsHBars(topFields), [topFields]);
  const drillSeries = useMemo(() => buildFieldDrillSeries(drillTimeseries), [drillTimeseries]);
  const drillInstalacaoSeries = useMemo(
    () => buildFieldDrillSeries(drillInstalacaoTimeseries as ProductionInstallationTimeseriesRow[]),
    [drillInstalacaoTimeseries],
  );

  // ── Drill popup BSW/Depletion charts (Phase 2) ──────────────────────────
  // Reuse the same chart builders the desktop View uses, then let the
  // MobileChart wrapper override the layout height for phone-sized canvases.
  // The field-aggregate charts derive selectedCampos from the response so
  // canonical variants (e.g. TUPI + SUL DE TUPI + AnC_TUPI) each render as
  // their own trace. See the desktop View for the rationale.
  const drillBswFieldCampos = useMemo(() => {
    const seen: string[] = [];
    for (const p of drillBswFieldPoints ?? []) {
      if (!seen.includes(p.campo)) seen.push(p.campo);
    }
    return seen.length > 0 ? seen : (drillCampo ? [drillCampo] : []);
  }, [drillBswFieldPoints, drillCampo]);
  const drillBswFieldChart = useMemo(
    () => buildBswFieldAverageChart(drillBswFieldPoints ?? [], drillBswFieldCampos, "markers+lines"),
    [drillBswFieldPoints, drillBswFieldCampos],
  );
  const drillBswWellChart = useMemo(
    () => buildBswPerWellChart(drillBswWellPoints ?? [], drillCampo ? [drillCampo] : [], "markers+lines"),
    [drillBswWellPoints, drillCampo],
  );
  const drillDepletionFieldCampos = useMemo(() => {
    const seen: string[] = [];
    for (const p of drillDepletionFieldPoints ?? []) {
      if (!seen.includes(p.campo)) seen.push(p.campo);
    }
    return seen.length > 0 ? seen : (drillCampo ? [drillCampo] : []);
  }, [drillDepletionFieldPoints, drillCampo]);
  const drillDepletionFieldChart = useMemo(
    () =>
      buildDepletionFieldAverageChart(
        drillDepletionFieldPoints ?? [],
        drillDepletionFieldCampos,
        "markers+lines",
        "voip",
        DRILL_DEPLETION_RECENT_MONTHS,
        DRILL_DEPLETION_PRIOR_MONTHS,
      ),
    [drillDepletionFieldPoints, drillDepletionFieldCampos],
  );
  const drillDepletionWellChart = useMemo(
    () =>
      buildDepletionPerWellChart(
        drillDepletionWellPoints ?? [],
        drillCampo ? [drillCampo] : [],
        "markers+lines",
        "voip",
        DRILL_DEPLETION_RECENT_MONTHS,
        DRILL_DEPLETION_PRIOR_MONTHS,
      ),
    [drillDepletionWellPoints, drillCampo],
  );

  if (visLoading || !visible) return null;

  if (bootstrapping) {
    return (
      <div style={{ paddingTop: 60 }}>
        <BarrelLoading />
        <div style={{ textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 13, marginTop: 12 }}>
          Loading production data…
        </div>
      </div>
    );
  }

  // ── Aggregate panel title — branches on view ───────────────────────────
  const aggregateTitle = viewIsCompany
    ? `${view} — Oil (kbpd, stake-weighted, stacked by environment)`
    : "Brazil — Oil (kbpd, stacked by environment)";

  // YoY drawer hidden in Brasil mode — the per-ambiente YoY rows are
  // company-only (sourced from get_production_yoy_table which requires a
  // company name). Brasil users get the HeaderTable's Brazil section
  // instead, which already shows MoM/YoY/YTD.
  const showYoyDrawer = viewIsCompany;

  return (
    <div style={{ paddingBottom: 120, background: "var(--mobile-surface-bg, #f5f5f7)", minHeight: "100vh" }}>
      <MobileTopBar
        title="Well by Well"
        rightSlot={
          <button
            type="button"
            aria-label="Open filters"
            onClick={() => setFilterOpen(true)}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--mobile-accent, #ff5000)",
              padding: 8,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "Arial",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <FilterIcon size={18} />
            Filters
          </button>
        }
      />

      <StickyBreadcrumb
        segments={[
          { label: "Well by Well", onClick: undefined },
          { label: view, onClick: undefined },
          { label: fmtMonthLabel(referenceDate), active: true },
        ]}
      />

      {/* ── 5 view pills (Round 9) — horizontally scrollable on phones ─── */}
      <MobileViewPills value={view} onChange={setView} />

      {/* ── HeaderTable at the top (horizontally scrollable) ───────────── */}
      <div style={{ padding: "4px 12px 6px" }}>
        <div
          style={{
            background: "var(--mobile-surface, #ffffff)",
            border: "1px solid var(--mobile-border, #e6e6ec)",
            borderRadius: 12,
            padding: "10px 10px 4px",
          }}
        >
          <div
            style={{
              fontFamily: "Arial",
              fontSize: 11,
              fontWeight: 700,
              color: "#1a1a1a",
              padding: "0 2px 6px",
              letterSpacing: "0.3px",
              textTransform: "uppercase",
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
          <div
            style={{
              fontFamily: "Arial",
              fontSize: 10,
              color: "#888",
              padding: "4px 2px 0",
              textAlign: "center",
            }}
          >
            Swipe left to see more columns ›
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 12px 8px" }}>
        <MobileTabBar
          activeKey={tab}
          onChange={(k) => setTab(k as Tab)}
          variant="container"
          ariaLabel="Production panels"
          tabs={[
            { key: "aggregate", label: "Aggregate" },
            { key: "fields",    label: "Top Fields" },
            { key: "fpsos",     label: "FPSOs" },
          ]}
        />
      </div>

      <div style={{ padding: "8px 12px" }}>
        {/* ── Aggregate tab — Brasil OR company stacked oil chart ────── */}
        {tab === "aggregate" && (
          <div
            style={{
              background: "var(--mobile-surface, #ffffff)",
              border: "1px solid var(--mobile-border, #e6e6ec)",
              borderRadius: 12,
              padding: "10px 8px 4px",
              opacity: aggregateLoading ? 0.6 : 1,
            }}
          >
            <div
              style={{
                fontFamily: "Arial",
                fontSize: 12,
                fontWeight: 700,
                color: "#1a1a1a",
                marginBottom: 6,
                padding: "0 6px",
              }}
            >
              {aggregateTitle}
            </div>
            {aggregateSeries.data.length > 0 ? (
              <MobileChart
                data={aggregateSeries.data}
                height={260}
                layout={{
                  barmode: "stack",
                  margin: { t: 28, b: 36, l: 36, r: 8 },
                  xaxis: { type: "date", tickformat: "%b %y" },
                  yaxis: { title: { text: "kbpd" } },
                  showlegend: true,
                  legend: { orientation: "h", y: -0.25, x: 0 },
                  annotations: aggregateSeries.annotations,
                }}
              />
            ) : (
              <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                No data for the selected period.
              </div>
            )}
          </div>
        )}

        {tab === "fields" && (
          <>
            <div style={{ marginBottom: 8, fontFamily: "Arial", fontSize: 12, color: "#888" }}>
              {view} · top fields · {fmtMonthLabel(referenceDate)} · tap to drill in
            </div>
            {topFieldsSeries.data.length > 0 && (
              <div
                style={{
                  background: "var(--mobile-surface, #ffffff)",
                  border: "1px solid var(--mobile-border, #e6e6ec)",
                  borderRadius: 12,
                  padding: "10px 8px",
                  marginBottom: 12,
                  opacity: topFieldsLoading ? 0.6 : 1,
                }}
              >
                <MobileChart
                  data={topFieldsSeries.data}
                  height={Math.max(180, topFields.length * 22)}
                  layout={{
                    barmode: "stack",
                    margin: { l: 110, r: 44, t: 8, b: 36 },
                    yaxis: { automargin: true, tickfont: { size: 10 } },
                    xaxis: { title: { text: "kbpd" } },
                    showlegend: true,
                    legend: { orientation: "h", y: -0.15, x: 0 },
                    annotations: topFieldsSeries.annotations,
                  }}
                />
              </div>
            )}
            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                overflow: "hidden",
                opacity: topFieldsLoading ? 0.6 : 1,
              }}
            >
              {topFields.map((f) => (
                <MobileDataCard
                  key={f.campo}
                  variant="compact"
                  title={f.campo}
                  subtitle={
                    viewIsCompany
                      ? `Stake ${f.stake_pct.toFixed(1)}% · Hours ${(f.hours_rate * 100).toFixed(0)}%`
                      : `Hours ${(f.hours_rate * 100).toFixed(0)}%`
                  }
                  onClick={() => openFieldDrill(f.campo)}
                  rightSlot={
                    <div style={{ textAlign: "right", fontFamily: "Arial" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
                        {fmtNumber(bblDiaToKbpd(f.oil_bbl_dia), 1)}
                        <span style={{ fontSize: 10, color: "#888", marginLeft: 4 }}>kbpd</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--mobile-accent, #ff5000)", fontWeight: 600 }}>
                        Tap to drill ›
                      </div>
                    </div>
                  }
                />
              ))}
              {topFields.length === 0 && (
                <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                  No field-level data for this month.
                </div>
              )}
            </div>
          </>
        )}

        {tab === "fpsos" && (
          <>
            <div style={{ marginBottom: 8, fontFamily: "Arial", fontSize: 12, color: "#888" }}>
              {view} · installations · {fmtMonthLabel(referenceDate)} · tap to drill in
            </div>
            <div
              style={{
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                overflow: "hidden",
                opacity: installationsLoading ? 0.6 : 1,
              }}
            >
              {installations.slice(0, 25).map((inst) => (
                <MobileDataCard
                  key={inst.instalacao}
                  variant="compact"
                  title={inst.instalacao}
                  subtitle={`Hours rate ${(inst.hours_rate * 100).toFixed(0)}%`}
                  onClick={() => openInstallationDrill(inst.instalacao)}
                  rightSlot={
                    <div style={{ textAlign: "right", fontFamily: "Arial" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
                        {fmtNumber(bblDiaToKbpd(inst.oil_bbl_dia), 1)}
                        <span style={{ fontSize: 10, color: "#888", marginLeft: 4 }}>kbpd</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#888" }}>
                        {fmtNumber(inst.gas_mm3_dia, 1)} Mm³/d
                      </div>
                      <div style={{ fontSize: 10, color: "var(--mobile-accent, #ff5000)", fontWeight: 600, marginTop: 2 }}>
                        Tap to drill ›
                      </div>
                    </div>
                  }
                />
              ))}
              {installations.length === 0 && (
                <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                  No installations for this month.
                </div>
              )}
            </div>
          </>
        )}

        {/* ── YoY expandable section — company view only ──────────────── */}
        {showYoyDrawer && (
          <>
            <button
              type="button"
              onClick={() => setYoyOpen((v) => !v)}
              style={{
                marginTop: 16,
                width: "100%",
                background: "var(--mobile-surface, #ffffff)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                padding: "12px 16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer",
                fontFamily: "Arial",
                fontSize: 13,
                fontWeight: 600,
                color: "#1a1a1a",
              }}
            >
              <span>YoY / MoM / YTD breakdown</span>
              {yoyOpen ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
            </button>
            {yoyOpen && (
              <div
                style={{
                  marginTop: 8,
                  background: "var(--mobile-surface, #ffffff)",
                  border: "1px solid var(--mobile-border, #e6e6ec)",
                  borderRadius: 12,
                  padding: "12px",
                  opacity: yoyLoading ? 0.6 : 1,
                }}
              >
                {yoyTable.map((row) => {
                  const isTotal = row.scope === "TOTAL";
                  return (
                    <div
                      key={row.scope}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        padding: "8px 0",
                        borderBottom: "1px solid #f0f0f0",
                        fontFamily: "Arial",
                        fontWeight: isTotal ? 700 : 400,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, color: "#1a1a1a" }}>{row.scope}</div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                          MoM <span style={{ color: row.mom_pct != null && row.mom_pct >= 0 ? "#197a39" : "#b3261e" }}>{fmtPct(row.mom_pct)}</span>
                          {"  ·  "}
                          YoY <span style={{ color: row.yoy_pct != null && row.yoy_pct >= 0 ? "#197a39" : "#b3261e" }}>{fmtPct(row.yoy_pct)}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtNumber(row.current_kbpd, 0)}</div>
                        <div style={{ fontSize: 10, color: "#888" }}>kbpd · YTD {fmtNumber(row.ytd_avg_kbpd, 0)}</div>
                      </div>
                    </div>
                  );
                })}
                {yoyTable.length === 0 && (
                  <div style={{ padding: 16, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                    No YoY data for this reference month.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Filter drawer (no empresa picker — Round 9 dropped it) ───── */}
      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        applyLabel="Done"
        onApply={() => setFilterOpen(false)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div className="sidebar-filter-label" style={{ fontFamily: "Arial", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              Period
            </div>
            {/* Round 13 (2026-05-27): 5 preset buttons replace the rc-slider.
                State still lives in `dateRange`; clicks call `setDateRange`. */}
            <MobilePeriodPresetButtons
              dateRange={dateRange}
              latestMonth={latestMonth}
              firstAvailableMonth={allMonths[0] ?? null}
              onPick={setDateRange}
              disabled={allMonths.length === 0}
            />
          </div>

          <div>
            <div className="sidebar-filter-label" style={{ fontFamily: "Arial", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              Reference month
            </div>
            <select
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              style={{
                width: "100%",
                fontFamily: "Arial",
                fontSize: 14,
                padding: "10px 12px",
                border: "1px solid #c5c5cb",
                borderRadius: 8,
                background: "#ffffff",
                minHeight: 44,
              }}
            >
              {refMonthOptions.map((m) => (
                <option key={m} value={m}>{fmtMonthLabel(m)}</option>
              ))}
            </select>
          </div>
        </div>
      </FilterDrawer>

      {/* ── Field drill-down BottomSheet (Phase 2: tabbed) ───────────── */}
      <BottomSheet
        open={drillCampo !== null}
        onClose={closeFieldDrill}
        height="90vh"
        title={drillCampo ? `${drillCampo} — ${viewEmpresa ?? "Brasil"}` : undefined}
        ariaLabel="Field drill-down"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Phase 2: tab bar (Production / BSW / Depletion) */}
          <MobileTabBar
            tabs={[
              { key: "production", label: "Production" },
              { key: "bsw",        label: "BSW" },
              { key: "depletion",  label: "Depletion" },
            ]}
            activeKey={drillTab}
            onChange={(key) => setDrillTab(key as DrillTab)}
            ariaLabel="Drill-down analysis"
          />

          {drillTab === "production" && (
            <div style={{ opacity: drillLoading ? 0.6 : 1, display: "flex", flexDirection: "column", gap: 12 }}>
              {drillError && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "#fff3cd",
                    border: "1px solid #ffe69c",
                    borderRadius: 8,
                    color: "#7d5800",
                    fontSize: 12,
                    fontFamily: "Arial",
                  }}
                >
                  {drillError}
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <MobileKpi
                  label="Current oil"
                  value={fmtNumber(drillKpis.currentOil, 1)}
                  unit="kbpd"
                />
                <MobileKpi
                  label="Δ MoM"
                  value={drillKpis.momPct == null ? "—" : fmtPct(drillKpis.momPct)}
                  unit=""
                />
                <MobileKpi
                  label="Δ YoY"
                  value={drillKpis.yoyPct == null ? "—" : fmtPct(drillKpis.yoyPct)}
                  unit=""
                />
                <MobileKpi
                  label="YTD avg"
                  value={drillKpis.ytdAvg == null ? "—" : fmtNumber(drillKpis.ytdAvg, 1)}
                  unit="kbpd"
                />
              </div>

              <div
                style={{
                  background: "var(--mobile-surface, #ffffff)",
                  border: "1px solid var(--mobile-border, #e6e6ec)",
                  borderRadius: 12,
                  padding: "10px 8px",
                }}
              >
                <div
                  style={{
                    fontFamily: "Arial",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1a1a1a",
                    marginBottom: 6,
                    padding: "0 6px",
                  }}
                >
                  Oil + Water (kbpd) · Hours rate (%)
                </div>
                {drillSeries.length > 0 ? (
                  <MobileChart
                    data={drillSeries}
                    height={280}
                    layout={{
                      barmode: "stack",
                      margin: { l: 36, r: 36, t: 8, b: 36 },
                      xaxis: { type: "date", tickformat: "%b %y" },
                      yaxis: { title: { text: "kbpd" } },
                      yaxis2: {
                        overlaying: "y",
                        side: "right",
                        range: [0, 105],
                        showgrid: false,
                        tickfont: { size: 10 },
                        fixedrange: true,
                      },
                      showlegend: true,
                      legend: { orientation: "h", y: -0.25, x: 0 },
                    }}
                  />
                ) : (
                  <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                    {drillLoading ? "Loading…" : "No data for this field in the current period."}
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: "#888", fontFamily: "Arial", padding: "0 4px" }}>
                Bars: oil (dark) + water (light blue) · Line: monthly uptime fraction.
              </div>
            </div>
          )}

          {drillTab === "bsw" && (
            <div style={{ opacity: drillBswLoading ? 0.6 : 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "flex-start", padding: "0 4px" }}>
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
              {drillBswError && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "#fff3cd",
                    border: "1px solid #ffe69c",
                    borderRadius: 8,
                    color: "#7d5800",
                    fontSize: 12,
                    fontFamily: "Arial",
                  }}
                >
                  {drillBswError}
                </div>
              )}

              <div
                style={{
                  background: "var(--mobile-surface, #ffffff)",
                  border: "1px solid var(--mobile-border, #e6e6ec)",
                  borderRadius: 12,
                  padding: "10px 8px",
                }}
              >
                {drillBswLoading &&
                 ((drillBswMode === "field" && drillBswFieldPoints == null) ||
                  (drillBswMode === "well"  && drillBswWellPoints  == null)) ? (
                  <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
                    <BarrelLoading bare />
                  </div>
                ) : (drillBswMode === "field" ? drillBswFieldPoints : drillBswWellPoints)?.length ? (
                  <MobileChart
                    data={(drillBswMode === "field" ? drillBswFieldChart.data : drillBswWellChart.data) as PlotData[]}
                    layout={drillBswMode === "field" ? drillBswFieldChart.layout : drillBswWellChart.layout}
                    height={320}
                  />
                ) : (
                  <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                    BSW data unavailable for this field — no VOIP reference published yet.
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: "#888", fontFamily: "Arial", padding: "0 4px" }}>
                Y: water / (water + oil). X: % VOIP recovered (field) or months since first production (per well).
              </div>
            </div>
          )}

          {drillTab === "depletion" && (
            <div style={{ opacity: drillDepletionLoading ? 0.6 : 1, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "flex-start", padding: "0 4px" }}>
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
              {drillDepletionError && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "#fff3cd",
                    border: "1px solid #ffe69c",
                    borderRadius: 8,
                    color: "#7d5800",
                    fontSize: 12,
                    fontFamily: "Arial",
                  }}
                >
                  {drillDepletionError}
                </div>
              )}

              <div
                style={{
                  background: "var(--mobile-surface, #ffffff)",
                  border: "1px solid var(--mobile-border, #e6e6ec)",
                  borderRadius: 12,
                  padding: "10px 8px",
                }}
              >
                {drillDepletionLoading &&
                 ((drillDepletionMode === "field" && drillDepletionFieldPoints == null) ||
                  (drillDepletionMode === "well"  && drillDepletionWellPoints  == null)) ? (
                  <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
                    <BarrelLoading bare />
                  </div>
                ) : (drillDepletionMode === "field" ? drillDepletionFieldPoints : drillDepletionWellPoints)?.length ? (
                  <MobileChart
                    data={(drillDepletionMode === "field" ? drillDepletionFieldChart.data : drillDepletionWellChart.data) as PlotData[]}
                    layout={drillDepletionMode === "field" ? drillDepletionFieldChart.layout : drillDepletionWellChart.layout}
                    height={320}
                  />
                ) : (
                  <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                    Depletion data unavailable for this field — VOIP reference may be missing.
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: "#888", fontFamily: "Arial", padding: "0 4px" }}>
                Y: rolling depletion ({DRILL_DEPLETION_RECENT_MONTHS}m vs prior {DRILL_DEPLETION_PRIOR_MONTHS}m). X: % VOIP recovered.
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* ── Installation drill-down BottomSheet ───────────────────────── */}
      <BottomSheet
        open={drillInstalacao !== null}
        onClose={closeInstallationDrill}
        height="90vh"
        title={drillInstalacao ? `${drillInstalacao} — ${viewEmpresa ?? "Brasil"}` : undefined}
        ariaLabel="Installation drill-down"
      >
        <div style={{ opacity: drillInstalacaoLoading ? 0.6 : 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {drillInstalacaoError && (
            <div
              style={{
                padding: "10px 12px",
                background: "#fff3cd",
                border: "1px solid #ffe69c",
                borderRadius: 8,
                color: "#7d5800",
                fontSize: 12,
                fontFamily: "Arial",
              }}
            >
              {drillInstalacaoError}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            <MobileKpi
              label="Current oil"
              value={fmtNumber(drillInstalacaoKpis.currentOil, 1)}
              unit="kbpd"
            />
            <MobileKpi
              label="Δ MoM"
              value={drillInstalacaoKpis.momPct == null ? "—" : fmtPct(drillInstalacaoKpis.momPct)}
              unit=""
            />
            <MobileKpi
              label="Δ YoY"
              value={drillInstalacaoKpis.yoyPct == null ? "—" : fmtPct(drillInstalacaoKpis.yoyPct)}
              unit=""
            />
            <MobileKpi
              label="YTD avg"
              value={drillInstalacaoKpis.ytdAvg == null ? "—" : fmtNumber(drillInstalacaoKpis.ytdAvg, 1)}
              unit="kbpd"
            />
          </div>

          <div
            style={{
              background: "var(--mobile-surface, #ffffff)",
              border: "1px solid var(--mobile-border, #e6e6ec)",
              borderRadius: 12,
              padding: "10px 8px",
            }}
          >
            <div
              style={{
                fontFamily: "Arial",
                fontSize: 12,
                fontWeight: 700,
                color: "#1a1a1a",
                marginBottom: 6,
                padding: "0 6px",
              }}
            >
              Oil + Water (kbpd) · Hours rate (%)
            </div>
            {drillInstalacaoSeries.length > 0 ? (
              <MobileChart
                data={drillInstalacaoSeries}
                height={280}
                layout={{
                  barmode: "stack",
                  margin: { l: 36, r: 36, t: 8, b: 36 },
                  xaxis: { type: "date", tickformat: "%b %y" },
                  yaxis: { title: { text: "kbpd" } },
                  yaxis2: {
                    overlaying: "y",
                    side: "right",
                    range: [0, 105],
                    showgrid: false,
                    tickfont: { size: 10 },
                    fixedrange: true,
                  },
                  showlegend: true,
                  legend: { orientation: "h", y: -0.25, x: 0 },
                }}
              />
            ) : (
              <div style={{ padding: 28, textAlign: "center", color: "#888", fontFamily: "Arial", fontSize: 12 }}>
                {drillInstalacaoLoading ? "Loading…" : "No data for this installation in the current period."}
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, color: "#888", fontFamily: "Arial", padding: "0 4px" }}>
            Bars: oil (dark) + water (light blue) routed through this installation · Line: monthly uptime fraction.
          </div>
        </div>
      </BottomSheet>

      {/* ── Export FAB + tiny action sheet ──────────────────────────────── */}
      <ExportFAB
        onClick={() => setExportMenuOpen((v) => !v)}
        disabled={excelLoading || csvLoading}
        ariaLabel="Export production data"
      />
      {exportMenuOpen && (
        <div
          style={{
            position: "fixed",
            zIndex: 36,
            right: "max(16px, calc((100vw - 428px) / 2 + 16px))",
            bottom: "calc(72px + var(--mobile-safe-bottom) + 80px)",
            background: "#ffffff",
            border: "1px solid #e6e6ec",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)",
            overflow: "hidden",
            minWidth: 200,
          }}
        >
          <button
            type="button"
            onClick={async () => {
              setExportMenuOpen(false);
              await handleExportExcel();
            }}
            disabled={excelLoading}
            style={menuBtnStyle}
          >
            {excelLoading ? "Building…" : "Excel (.xlsx)"}
          </button>
          <button
            type="button"
            onClick={async () => {
              setExportMenuOpen(false);
              await handleExportCsv();
            }}
            disabled={csvLoading}
            style={{ ...menuBtnStyle, borderTop: "1px solid #f0f0f0" }}
          >
            {csvLoading ? "Building…" : "CSV (.zip)"}
          </button>
        </div>
      )}
    </div>
  );
}

const menuBtnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "12px 16px",
  background: "transparent",
  border: 0,
  fontFamily: "Arial",
  fontSize: 14,
  color: "#1a1a1a",
  cursor: "pointer",
  minHeight: 44,
};

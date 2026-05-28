"use client";

// Mobile View — /well-by-well (≤768px).
//
// MOBILE REFORM v2 (Wave 3, 2026-05-28) — flagship #1.
//
// Spec source: `/.claude/plans/o-modo-mobile-da-tranquil-giraffe.md` § 4.2.
//
// Layout (top → bottom):
//   1. Sticky top bar (under the global MobileTopBar from MobileShell):
//      • Row A — Scope pills, horizontal scroll
//          [ Brazil ] [ Petrobras ] [ PRIO ] [ PetroReconcavo ] [ Brava ]
//      • Row B — Period pills, 5-column equal grid
//          [ 12M ]  [ 24M ]  [ 36M ]  [ YTD ]  [ All ]
//   2. Section 1 — Hero stacked bar by environment (Pre-Salt / Post-Salt /
//      Onshore). ~280px tall. One row per month in the active period window.
//   3. Section 2 — Top 10 fields list. One pill row per field. Tap → opens a
//      BottomSheet with the field's monthly oil/water/hours-rate chart plus
//      the 5-row KPI summary table (current/prev/MoM/prev-year/YoY).
//   4. Section 3 — FPSO/UEP horizontal stacked bar (oil kbpd by installation,
//      sorted desc, top 15 capped). Tap any row → BottomSheet with the
//      installation's monthly chart + KPI table.
//   5. Section 4 — Horizontal-scroll KPI table (MoM / YoY / YTD) with the
//      first column sticky. Sourced from `yoyTable` (company-view) or, in
//      Brasil view, derived from `headerData`'s BRAZIL rows so the table is
//      never empty.
//
// Things explicitly NOT here (spec § 4.2 + § 5.4 + task non-negotiables):
//   • ExportFAB / ExportModal — removed 100% on mobile.
//   • NavBar / MobileTopBar / MobileBottomTabBar — owned by MobileShell.
//   • useIsMobile() — already inside a mobile-only file.
//   • Dark-mode CSS — mobile is light-only.
//
// Implementation rules (CLAUDE.md § Dual-view policy + task contract):
//   • Does not touch `desktop/View.tsx` or `useProductionData.ts` — if either
//     needs to change, the commit must declare `[mobile-only]` with a reason.
//   • Consumes only the existing hook contract (no new RPC calls here).
//   • Single source of typography/colour: shared mobile tokens
//     (`--mobile-*`) + the dashboard's `BRAND_ORANGE` / `AMBIENTE_COLOR`
//     / `TOP_FIELDS_OIL_COLOR` palette (already used by the desktop View).
//
// LOC budget: ~750 (vs. 1574 pre-reform), cleared by dropping the
//   HeaderTable wrapper, the 3-tab drill (Production/BSW/Depletion), the
//   YoY drawer toggle and the Export action sheet.

import { useMemo } from "react";
import type { Layout, PlotData } from "plotly.js";

import {
  MobileChart,
  BottomSheet,
} from "../../../../components/dashboard/mobile";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
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
  HOURS_RATE_COLOR,
  TOP_FIELDS_OIL_COLOR,
  TOP_FIELDS_WATER_COLOR,
  PERIOD_PRESET_LABEL,
  computePresetRange,
  detectPeriodPreset,
  type PeriodPreset,
} from "../useProductionData";
import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
  ProductionInstallation,
  ProductionFieldTimeseriesRow,
  ProductionInstallationTimeseriesRow,
} from "../../../../types/production";

// ─── Visual constants ─────────────────────────────────────────────────────────

/** Pill row threshold below which a per-segment kbpd label is omitted. Phones
 *  cannot fit a 4-digit value inside a narrow stack segment; the headline
 *  total annotation above each bar carries the leader number anyway. */
const MIN_SEGMENT_KBPD_LABEL = 80;

/** Equivalent threshold in Mbpd (kbpd / 1000). Brazil/Petrobras top out around
 *  3.7 Mbpd so we use a small fraction (0.08 Mbpd = 80 kbpd) to keep the same
 *  visual heuristic. */
const MIN_SEGMENT_MBPD_LABEL = 0.08;

/** Scope pills whose absolute production warrants Mbpd (million bpd) units
 *  instead of kbpd: Brazil aggregate (~3.7 Mbpd) and Petrobras stake-weighted
 *  (~2.3 Mbpd). The smaller scopes (PRIO, PetroReconcavo, Brava) stay in kbpd
 *  because their totals are under 100 kbpd. */
const MBPD_VIEWS: ReadonlySet<WellByWellView> = new Set<WellByWellView>([
  "Brasil",
  "Petrobras",
]);

/** Mobile-only subset of period presets (task 2026-05-28 [mobile-only]).
 *  Desktop still exposes the full `PERIOD_PRESETS` (12M/24M/36M/All/YTD); on
 *  phones the 36M and All ranges produced visually cluttered hero charts, so
 *  we restrict the pill row to 3 options. The hook is untouched — desktop
 *  View continues to consume the full list. */
const MOBILE_PERIOD_PRESETS: readonly PeriodPreset[] = ["last12m", "last24m", "ytd"];

/** Cap the FPSO/UEP horizontal bar to 15 installations — beyond this, the
 *  list becomes unscanably long on a 6" phone. The full list is accessible
 *  via the section's "rows below the chart" cards (no cap there). */
const FPSO_CHART_CAP = 15;

/** Display map for the 5 scope pills. Underlying state values come from
 *  `WELL_BY_WELL_VIEWS` (the canonical normalized forms used in
 *  `field_stakes.empresa`). The display labels match spec § 4.2 verbatim —
 *  "Brazil" instead of "Brasil", "Brava" instead of "Brava Energia". */
const SCOPE_PILL_LABEL: Record<WellByWellView, string> = {
  Brasil:           "Brazil",
  Petrobras:        "Petrobras",
  PRIO:             "PRIO",
  PetroReconcavo:   "PetroReconcavo",
  "Brava Energia":  "Brava",
};

const KPI_POS_COLOR     = "#197a39";
const KPI_NEG_COLOR     = "#b3261e";
const KPI_NEUTRAL_COLOR = "#888888";

// ─── Small typography helpers (kept inline to avoid styled-system overhead) ──

function fmtIntPtBr(n: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n);
}

/** Short month label "May-25" used by the hero chart's rotated x-axis ticks.
 *  `fmtMonthLabel` (from the hook) returns "May 2025" — too wide for vertical
 *  ticks on a phone, hence this local variant. Input is an ISO date anchor
 *  ("YYYY-MM-DD"). */
function fmtMonthLabelShort(anchor: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(anchor.slice(5, 7), 10);
  const yy = anchor.slice(2, 4);
  return `${months[m - 1]}-${yy}`;
}

/** Mbpd values are small (0–4 range) so we render with 2 decimals to keep the
 *  precision a kbpd integer would otherwise convey. en-US locale matches the
 *  rest of the dashboard (period separator). */
function fmtMbpd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function deltaColor(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return KPI_NEUTRAL_COLOR;
  if (p > 0) return KPI_POS_COLOR;
  if (p < 0) return KPI_NEG_COLOR;
  return KPI_NEUTRAL_COLOR;
}

// ─── Hero chart (Section 1) ──────────────────────────────────────────────────

interface StackedBuildResult {
  data: PlotData[];
  annotations: Partial<Layout>["annotations"];
  months: string[];
}

function buildTotalAnnotations(
  months: string[],
  ambienteYs: Record<string, number[]>,
  unitIsMbpd: boolean,
): Partial<Layout>["annotations"] {
  const totals = months.map((_, i) =>
    AMBIENTES.reduce((s, amb) => s + (ambienteYs[amb]?.[i] ?? 0), 0),
  );
  return months.map((m, i) => ({
    x: m,
    y: totals[i],
    text: `<b>${unitIsMbpd ? fmtMbpd(totals[i]) : fmtIntPtBr(totals[i])}</b>`,
    showarrow: false,
    yshift: 10,
    xanchor: "center",
    font: { size: 10, color: "#1a1a1a", family: "Arial" },
  }));
}

function buildHeroStackedSeries(
  rows: (ProductionBrazilRow | ProductionCompanyRow)[],
  unitIsMbpd: boolean,
): StackedBuildResult {
  if (!rows.length) return { data: [], annotations: [], months: [] };

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

  // y values: always start from kbpd, then divide by 1000 when the active view
  // calls for Mbpd. Keeping the conversion centralised here means the totals
  // annotation and hovertemplate stay in sync with the bar heights.
  const ambienteYs: Record<string, number[]> = {};
  for (const amb of AMBIENTES) {
    ambienteYs[amb] = months.map((m) => {
      const kbpd = bblDiaToKbpd(pivot[amb]?.[m] ?? 0);
      return unitIsMbpd ? kbpd / 1000 : kbpd;
    });
  }

  const labelThreshold = unitIsMbpd ? MIN_SEGMENT_MBPD_LABEL : MIN_SEGMENT_KBPD_LABEL;
  const unitSuffix = unitIsMbpd ? "Mbpd" : "kbpd";
  const hoverFmt = unitIsMbpd ? ",.2f" : ",.1f";

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
        v >= labelThreshold ? (unitIsMbpd ? fmtMbpd(v) : fmtIntPtBr(v)) : "",
      ),
      textposition: "inside",
      insidetextanchor: "middle",
      textfont: { color: labelColor, size: 10, family: "Arial" },
      cliponaxis: false,
      marker: { color: baseColor },
      hovertemplate: `${displayName}: %{y:${hoverFmt}} ${unitSuffix}<extra></extra>`,
    } as PlotData;
  });

  return {
    data,
    annotations: buildTotalAnnotations(months, ambienteYs, unitIsMbpd),
    months,
  };
}

// ─── FPSO/UEP chart (Section 3) ──────────────────────────────────────────────

interface FpsoChartBuild {
  data: PlotData[];
  annotations: Partial<Layout>["annotations"];
  height: number;
}

/** Horizontal bar of oil kbpd by installation, capped to FPSO_CHART_CAP. The
 *  spec calls for "stacked bar" but the underlying data is a single oil value
 *  per installation (no environment split), so the practical visualisation is
 *  a single-series horizontal bar with the value annotated at the bar end. */
function buildFpsoChart(insts: ProductionInstallation[]): FpsoChartBuild {
  if (!insts.length) return { data: [], annotations: [], height: 180 };
  const sorted = [...insts].sort((a, b) => b.oil_bbl_dia - a.oil_bbl_dia).slice(0, FPSO_CHART_CAP);
  const names = sorted.map((i) => i.instalacao);
  const oil   = sorted.map((i) => bblDiaToKbpd(i.oil_bbl_dia));
  return {
    data: [
      {
        type: "bar",
        orientation: "h",
        name: "Oil",
        x: oil,
        y: names,
        text: oil.map((v) =>
          v >= MIN_SEGMENT_KBPD_LABEL ? fmtIntPtBr(v) : "",
        ),
        textposition: "inside",
        insidetextanchor: "middle",
        textfont: { color: "#ffffff", size: 10, family: "Arial" },
        cliponaxis: false,
        marker: { color: TOP_FIELDS_OIL_COLOR },
        hovertemplate: "Oil: %{x:,.1f} kbpd<extra>%{y}</extra>",
      } as PlotData,
    ],
    annotations: names.map((n, i) => ({
      x: oil[i],
      y: n,
      text: `<b>${fmtIntPtBr(oil[i])}</b>`,
      showarrow: false,
      xshift: 6,
      xanchor: "left",
      yanchor: "middle",
      font: { size: 10, color: "#1a1a1a", family: "Arial" },
    })),
    height: Math.max(220, names.length * 24),
  };
}

// ─── Drill (Section 2 + Section 3 sheet) — monthly timeseries chart ─────────

/** Reused for both field drill and installation drill — same row shape
 *  (`ProductionFieldTimeseriesRow` ≡ `ProductionInstallationTimeseriesRow`). */
function buildDrillSeries(
  rows: ProductionFieldTimeseriesRow[] | ProductionInstallationTimeseriesRow[],
): PlotData[] {
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
      line: { color: HOURS_RATE_COLOR, width: 2 },
      marker: { color: HOURS_RATE_COLOR, size: 5 },
      hovertemplate: "Hours: %{y:.0f}%<extra></extra>",
      yaxis: "y2",
    } as PlotData,
  ];
}

// ─── Sticky top bar — Scope pills (Row A) + Period pills (Row B) ─────────────

function ScopePillsRow({
  value,
  onChange,
}: {
  value: WellByWellView;
  onChange: (v: WellByWellView) => void;
}): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Production scope"
      className="wbw-mobile-pills"
      style={{
        display: "flex",
        gap: 8,
        padding: "8px 12px",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      <style>{`.wbw-mobile-pills::-webkit-scrollbar { display: none; }`}</style>
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
              try {
                (e.currentTarget as HTMLButtonElement).scrollIntoView({
                  behavior: "smooth",
                  inline: "center",
                  block: "nearest",
                });
              } catch {
                /* older browsers ignore options */
              }
            }}
            style={{
              flex: "0 0 auto",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 13,
              fontWeight: isActive ? 700 : 600,
              padding: "8px 16px",
              borderRadius: 999,
              border: isActive ? "1px solid transparent" : "1px solid var(--mobile-border, #e6e6ec)",
              background: isActive ? BRAND_ORANGE : "var(--mobile-surface, #ffffff)",
              color: isActive ? "#ffffff" : "var(--mobile-text, #1a1a1a)",
              cursor: "pointer",
              minHeight: 36,
              whiteSpace: "nowrap",
              userSelect: "none",
              transition: "background-color 0.18s, color 0.18s",
            }}
          >
            {SCOPE_PILL_LABEL[opt]}
          </button>
        );
      })}
    </div>
  );
}

function PeriodPillsRow({
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
        gridTemplateColumns: `repeat(${MOBILE_PERIOD_PRESETS.length}, 1fr)`,
        gap: 6,
        padding: "0 12px 10px",
      }}
    >
      {MOBILE_PERIOD_PRESETS.map((preset) => {
        const isActive = preset === active;
        const isDisabled = disabled || !latestMonth;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={isActive}
            disabled={isDisabled}
            onClick={() => {
              const range = computePresetRange(preset, latestMonth);
              if (range) onPick(range);
            }}
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 12,
              fontWeight: isActive ? 700 : 600,
              padding: "8px 4px",
              borderRadius: 8,
              border: isActive ? "1px solid transparent" : "1px solid var(--mobile-border, #d6d6dc)",
              background: isActive ? BRAND_ORANGE : "var(--mobile-surface, #ffffff)",
              color: isActive ? "#ffffff" : "var(--mobile-text, #1a1a1a)",
              cursor: isDisabled ? "not-allowed" : "pointer",
              minHeight: 38,
              whiteSpace: "nowrap",
              userSelect: "none",
              transition: "background-color 0.18s, color 0.18s",
              opacity: isDisabled ? 0.55 : 1,
            }}
          >
            {PERIOD_PRESET_LABEL[preset]}
          </button>
        );
      })}
    </div>
  );
}

// ─── Section card wrapper (consistent visual chrome across all 4 sections) ──

function SectionCard({
  title,
  subtitle,
  loading = false,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      style={{
        background: "var(--mobile-surface, #ffffff)",
        border: "1px solid var(--mobile-border, #e6e6ec)",
        borderRadius: 14,
        padding: "12px 10px 10px",
        opacity: loading ? 0.7 : 1,
        transition: "opacity 0.18s ease",
      }}
    >
      <header style={{ padding: "0 4px 8px" }}>
        <div
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--mobile-text, #1a1a1a)",
            letterSpacing: "0.4px",
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 11,
              color: "var(--mobile-text-muted, #6b6b73)",
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

// ─── Top fields list (Section 2) ─────────────────────────────────────────────

function TopFieldsList({
  fields,
  viewIsCompany,
  onPick,
}: {
  fields: ProductionTopField[];
  viewIsCompany: boolean;
  onPick: (campo: string) => void;
}): React.ReactElement {
  if (fields.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--mobile-text-muted, #888)",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12,
        }}
      >
        No field-level data for this month.
      </div>
    );
  }
  // Sort defensively — RPC returns sorted, but stake-weighted swap could
  // produce ties; client-side sort guarantees stable rank numbering.
  const sorted = [...fields].sort((a, b) => b.oil_bbl_dia - a.oil_bbl_dia);
  return (
    <ol
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {sorted.map((f, idx) => {
        const rank = idx + 1;
        const kbpd = bblDiaToKbpd(f.oil_bbl_dia);
        return (
          <li key={f.campo}>
            <button
              type="button"
              onClick={() => onPick(f.campo)}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr auto",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "10px 12px",
                background: "var(--mobile-surface-elevated, #fafafc)",
                border: "1px solid var(--mobile-border, #e6e6ec)",
                borderRadius: 12,
                cursor: "pointer",
                textAlign: "left",
                minHeight: 52,
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: rank === 1 ? BRAND_ORANGE : "var(--mobile-accent-soft, rgba(255,80,0,0.10))",
                  color: rank === 1 ? "#ffffff" : "var(--mobile-accent, #ff5000)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {rank}
              </span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--mobile-text, #1a1a1a)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.campo}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--mobile-text-muted, #888)",
                    marginTop: 2,
                  }}
                >
                  {viewIsCompany ? `Stake ${f.stake_pct.toFixed(1)}% · ` : ""}
                  Hours {(f.hours_rate * 100).toFixed(0)}%
                </span>
              </span>
              <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "var(--mobile-text, #1a1a1a)",
                  }}
                >
                  {fmtNumber(kbpd, 1)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--mobile-text-muted, #888)",
                    marginLeft: 3,
                  }}
                >
                  kbpd
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 10,
                    color: "var(--mobile-accent, #ff5000)",
                    fontWeight: 600,
                    marginTop: 2,
                  }}
                >
                  Tap to drill ›
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ─── KPI table (Section 4) ───────────────────────────────────────────────────
//
// Horizontal-scroll table with the first column sticky. In company view it
// renders `yoyTable` (TOTAL row + 3 ambiente rows). In Brasil view it derives
// an equivalent shape from `headerData`'s BRAZIL Oil rows so the table never
// shows "no data" when the dashboard is on Brazil scope (the YoY RPC is
// company-only). The two shapes are normalized into a single row contract.

interface KpiTableRow {
  scope: string;
  current_kbpd: number;
  prev_month_kbpd: number | null;
  prev_year_kbpd: number | null;
  ytd_avg_kbpd: number | null;
  mom_pct: number | null;    // unit: fraction (0.024 == +2.4%) OR percent? See note below.
  yoy_pct: number | null;
  /** Whether mom_pct / yoy_pct are stored as percent-units (e.g. 2.4 for +2.4%)
   *  or as fractions (e.g. 0.024). The yoyTable RPC returns fractions; the
   *  headerData RPC returns percent-units (already × 100). Stored per-row so
   *  the formatter can normalize at render time. */
  pct_is_already_percent: boolean;
}

function buildKpiRowsFromYoyTable(
  rows: Array<{
    scope: string;
    current_kbpd: number;
    prev_month_kbpd: number | null;
    prev_year_kbpd: number | null;
    ytd_avg_kbpd: number | null;
    mom_pct: number | null;
    yoy_pct: number | null;
  }>,
): KpiTableRow[] {
  return rows.map((r) => ({
    scope: r.scope === "TOTAL" ? "Total" : labelAmbiente(r.scope),
    current_kbpd: r.current_kbpd,
    prev_month_kbpd: r.prev_month_kbpd,
    prev_year_kbpd: r.prev_year_kbpd,
    ytd_avg_kbpd: r.ytd_avg_kbpd,
    mom_pct: r.mom_pct,
    yoy_pct: r.yoy_pct,
    pct_is_already_percent: false,
  }));
}

/** Pull the BRAZIL Oil rows out of `headerData`. Keeps the same row contract
 *  the company-view table uses, so the renderer doesn't branch. */
function buildKpiRowsFromHeaderBrazil(
  headerRows: Array<{
    section: string;
    category: string;
    subcategory: string | null;
    is_total: boolean;
    current_val: number | null;
    prev_month_val: number | null;
    prev_year_val: number | null;
    ytd_avg: number | null;
    mom_pct: number | null;
    yoy_pct: number | null;
  }>,
): KpiTableRow[] {
  const out: KpiTableRow[] = [];
  for (const r of headerRows) {
    if (r.section !== "BRAZIL") continue;
    if (r.category !== "Oil (kbpd)") continue;
    if (r.subcategory == null) continue;       // skip category header rows
    if (r.current_val == null) continue;       // skip empty cells
    out.push({
      scope: r.subcategory === "Total" ? "Total" : r.subcategory,
      current_kbpd: r.current_val,
      prev_month_kbpd: r.prev_month_val,
      prev_year_kbpd: r.prev_year_val,
      ytd_avg_kbpd: r.ytd_avg,
      mom_pct: r.mom_pct,
      yoy_pct: r.yoy_pct,
      pct_is_already_percent: true,
    });
  }
  // Bring the "Total" row to the top so the table reads top-down: Total →
  // Pre-Salt → Post-Salt → Onshore. headerData's display_order already does
  // this, but we sort defensively for guaranteed stability.
  return out.sort((a, b) => (a.scope === "Total" ? -1 : b.scope === "Total" ? 1 : 0));
}

function KpiTable({
  rows,
  loading,
}: {
  rows: KpiTableRow[];
  loading: boolean;
}): React.ReactElement {
  if (loading && rows.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--mobile-text-muted, #888)",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12,
        }}
      >
        Loading…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--mobile-text-muted, #888)",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 12,
        }}
      >
        No comparison rows for this reference month.
      </div>
    );
  }
  // pct comes either as a fraction (yoyTable.*_pct) or already as percent
  // (headerData.*_pct). Normalize to "percent units" for the existing fmtPct
  // helper. Note `fmtPct` expects fractions (it × 100 internally) so for
  // already-percent rows we divide by 100 first to cancel out the helper's
  // multiplication. Round-trip is exact for the values we render.
  const fmtPctRow = (p: number | null, alreadyPercent: boolean): string => {
    if (p == null || !Number.isFinite(p)) return "—";
    return fmtPct(alreadyPercent ? p / 100 : p);
  };
  const cellStyle: React.CSSProperties = {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 12,
    padding: "10px 12px",
    textAlign: "right",
    whiteSpace: "nowrap",
    color: "var(--mobile-text, #1a1a1a)",
    borderBottom: "1px solid var(--mobile-border, #f0f0f0)",
    background: "var(--mobile-surface, #ffffff)",
  };
  const headerCell: React.CSSProperties = {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 10,
    fontWeight: 700,
    padding: "8px 12px",
    color: "var(--mobile-text-muted, #6b6b73)",
    background: "var(--mobile-surface-elevated, #fafafc)",
    borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    textAlign: "right",
    whiteSpace: "nowrap",
  };
  const stickyFirst: React.CSSProperties = {
    position: "sticky",
    left: 0,
    textAlign: "left",
    boxShadow: "1px 0 0 var(--mobile-border, #e6e6ec)",
    zIndex: 1,
  };
  return (
    <div
      style={{
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        border: "1px solid var(--mobile-border, #e6e6ec)",
        borderRadius: 10,
      }}
    >
      <table
        style={{
          borderCollapse: "separate",
          borderSpacing: 0,
          width: "100%",
          minWidth: 540,
        }}
      >
        <thead>
          <tr>
            <th style={{ ...headerCell, ...stickyFirst, textAlign: "left" }}>Scope</th>
            <th style={headerCell}>Current</th>
            <th style={headerCell}>Prev. month</th>
            <th style={headerCell}>MoM %</th>
            <th style={headerCell}>Prev. year</th>
            <th style={headerCell}>YoY %</th>
            <th style={headerCell}>YTD avg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isTotal = r.scope === "Total";
            return (
              <tr key={r.scope}>
                <td
                  style={{
                    ...cellStyle,
                    ...stickyFirst,
                    fontWeight: isTotal ? 700 : 500,
                    color: isTotal ? "var(--mobile-text, #1a1a1a)" : "var(--mobile-text-muted, #4a4a52)",
                  }}
                >
                  {r.scope}
                </td>
                <td style={{ ...cellStyle, fontWeight: isTotal ? 700 : 500 }}>
                  {fmtNumber(r.current_kbpd, 1)}
                </td>
                <td style={cellStyle}>{fmtNumber(r.prev_month_kbpd, 1)}</td>
                <td style={{ ...cellStyle, color: deltaColor(r.mom_pct), fontWeight: 600 }}>
                  {fmtPctRow(r.mom_pct, r.pct_is_already_percent)}
                </td>
                <td style={cellStyle}>{fmtNumber(r.prev_year_kbpd, 1)}</td>
                <td style={{ ...cellStyle, color: deltaColor(r.yoy_pct), fontWeight: 600 }}>
                  {fmtPctRow(r.yoy_pct, r.pct_is_already_percent)}
                </td>
                <td style={cellStyle}>{fmtNumber(r.ytd_avg_kbpd, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Drill KPI summary table (used by both field and installation drills) ────
//
// 5-row stacked layout — same data shape as the desktop View's DrillKpiTable,
// rendered vertically because phones don't fit 5 legible columns. Identical
// to the pre-reform `MobileDrillKpiTable` but inlined here (no shared
// component yet — kept private to this file for clarity).

function DrillKpiSummary({
  data,
}: {
  data: ReturnType<typeof useProductionData>["drillKpiTable"];
}): React.ReactElement {
  const fmtValue = (v: number | null): string => (v == null ? "—" : fmtNumber(v, 1));
  const fmtDelta = (p: number | null): string => (p == null ? "—" : fmtPct(p));
  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    padding: "10px 12px",
    borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    color: "var(--mobile-text-muted, #6b6b73)",
    letterSpacing: "0.4px",
  };
  const subLabelStyle: React.CSSProperties = {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 10,
    color: "var(--mobile-text-muted, #888)",
    marginTop: 2,
  };
  const valueStyle: React.CSSProperties = {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--mobile-text, #1a1a1a)",
    lineHeight: 1.1,
  };
  return (
    <div
      style={{
        background: "var(--mobile-surface, #ffffff)",
        border: "1px solid var(--mobile-border, #e6e6ec)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div style={rowStyle}>
        <div>
          <div style={labelStyle}>Current month</div>
          <div style={subLabelStyle}>{data.currentMonthLabel ?? "—"}</div>
        </div>
        <div style={valueStyle}>
          {fmtValue(data.currentMonth)}
          <span style={{ fontSize: 10, color: "#888", marginLeft: 4, fontWeight: 500 }}>
            {data.currentMonth == null ? "" : "kbpd"}
          </span>
        </div>
      </div>
      <div style={rowStyle}>
        <div>
          <div style={labelStyle}>Previous month</div>
          <div style={subLabelStyle}>{data.prevMonthLabel ?? "—"}</div>
        </div>
        <div style={valueStyle}>
          {fmtValue(data.prevMonth)}
          <span style={{ fontSize: 10, color: "#888", marginLeft: 4, fontWeight: 500 }}>
            {data.prevMonth == null ? "" : "kbpd"}
          </span>
        </div>
      </div>
      <div style={rowStyle}>
        <div style={labelStyle}>MoM %</div>
        <div style={{ ...valueStyle, color: deltaColor(data.momPct) }}>{fmtDelta(data.momPct)}</div>
      </div>
      <div style={rowStyle}>
        <div>
          <div style={labelStyle}>Same month prev. year</div>
          <div style={subLabelStyle}>{data.prevYearMonthLabel ?? "—"}</div>
        </div>
        <div style={valueStyle}>
          {fmtValue(data.prevYear)}
          <span style={{ fontSize: 10, color: "#888", marginLeft: 4, fontWeight: 500 }}>
            {data.prevYear == null ? "" : "kbpd"}
          </span>
        </div>
      </div>
      <div style={{ ...rowStyle, borderBottom: "none" }}>
        <div style={labelStyle}>YoY %</div>
        <div style={{ ...valueStyle, color: deltaColor(data.yoyPct) }}>{fmtDelta(data.yoyPct)}</div>
      </div>
    </div>
  );
}

// ─── View root ───────────────────────────────────────────────────────────────

export default function MobileView(): React.ReactElement | null {
  const {
    visible, visLoading,
    bootstrapping,
    latestMonth,
    view, setView, isCompanyView: viewIsCompany, viewEmpresa,
    allMonths, dateRange, setDateRange,
    referenceDate,
    brazilData, companyData, topFields, installations, yoyTable,
    headerData,
    brazilLoading, companyLoading, topFieldsLoading, installationsLoading, yoyLoading,
    headerLoading,
    drillCampo, drillTimeseries, drillLoading, drillError, drillKpiTable,
    openFieldDrill, closeFieldDrill,
    drillInstalacao, drillInstalacaoTimeseries,
    drillInstalacaoLoading, drillInstalacaoError, drillInstalacaoKpiTable,
    openInstallationDrill, closeInstallationDrill,
  } = useProductionData();

  // ── Section 1 — aggregate stacked series (branches on view) ──────────────
  const aggregateRows: (ProductionBrazilRow | ProductionCompanyRow)[] = viewIsCompany
    ? companyData
    : brazilData;
  const aggregateLoading = viewIsCompany ? companyLoading : brazilLoading;
  const heroUnitIsMbpd = MBPD_VIEWS.has(view);
  const heroUnitLabel = heroUnitIsMbpd ? "Mbpd" : "kbpd";
  const aggregateSeries = useMemo(
    () => buildHeroStackedSeries(aggregateRows, heroUnitIsMbpd),
    [aggregateRows, heroUnitIsMbpd],
  );

  // ── Section 3 — FPSO/UEP horizontal bar ──────────────────────────────────
  const fpsoChart = useMemo(() => buildFpsoChart(installations), [installations]);

  // ── Drill chart series (reused by both field & installation BottomSheets)
  const drillFieldSeries = useMemo(
    () => buildDrillSeries(drillTimeseries),
    [drillTimeseries],
  );
  const drillInstSeries = useMemo(
    () => buildDrillSeries(drillInstalacaoTimeseries),
    [drillInstalacaoTimeseries],
  );

  // ── Section 4 — KPI table rows (normalize across yoyTable / headerData) ──
  const kpiRows: KpiTableRow[] = useMemo(() => {
    if (viewIsCompany) {
      return buildKpiRowsFromYoyTable(yoyTable);
    }
    return buildKpiRowsFromHeaderBrazil(headerData);
  }, [viewIsCompany, yoyTable, headerData]);
  const kpiLoading = viewIsCompany ? yoyLoading : headerLoading;

  if (visLoading || !visible) return null;
  if (bootstrapping) {
    return (
      <div style={{ paddingTop: 60 }}>
        <BarrelLoading />
        <div
          style={{
            textAlign: "center",
            color: "var(--mobile-text-muted, #888)",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 13,
            marginTop: 12,
          }}
        >
          Loading production data…
        </div>
      </div>
    );
  }

  // ── Titles + subtitles for each section ──────────────────────────────────
  const refLabel = fmtMonthLabel(referenceDate);
  const scopeLabel = SCOPE_PILL_LABEL[view] ?? view;
  const heroSubtitle = viewIsCompany
    ? `${scopeLabel} · stake-weighted · stacked by environment`
    : `Brazil · stacked by environment (100% WI)`;
  const fieldsSubtitle = viewIsCompany
    ? `${scopeLabel} · ${refLabel} · tap a field to drill in`
    : `Brazil · ${refLabel} · tap a field to drill in`;
  const fpsoSubtitle = viewIsCompany
    ? `${scopeLabel} · ${refLabel} · sorted by oil production`
    : `Brazil · ${refLabel} · sorted by oil production`;
  const kpiSubtitle = viewIsCompany
    ? `${scopeLabel} · vs previous month, vs same month one year ago, year-to-date`
    : `Brazil · vs previous month, vs same month one year ago, year-to-date`;

  return (
    <div
      style={{
        // 120px bottom padding clears the MobileHomePill (~64px) + safe area.
        paddingBottom: 120,
        background: "var(--mobile-bg, #f5f5f7)",
        minHeight: "100vh",
      }}
    >
      {/* ── Sticky filter bar (Scope + Period pills) ────────────────────── */}
      <div
        style={{
          position: "sticky",
          // MobileTopBar (from MobileShell) is sticky at top:0, height 56px.
          // Adding a translucent backing here means the pills stay legible
          // while scrolling — visual continuity with the top bar's glass.
          top: "var(--mobile-topbar-h, 56px)",
          zIndex: 30,
          background: "var(--mobile-glass-bg, rgba(255,255,255,0.94))",
          backdropFilter: "var(--mobile-glass-blur, blur(18px) saturate(180%))",
          WebkitBackdropFilter: "var(--mobile-glass-blur, blur(18px) saturate(180%))",
          borderBottom: "1px solid var(--mobile-border, #e6e6ec)",
        }}
      >
        <ScopePillsRow value={view} onChange={setView} />
        <PeriodPillsRow
          dateRange={dateRange}
          latestMonth={latestMonth}
          firstAvailableMonth={allMonths[0] ?? null}
          onPick={setDateRange}
          disabled={allMonths.length === 0}
        />
      </div>

      {/* ── Section stack ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "12px 12px 8px",
        }}
      >
        {/* ── SECTION 1 — Hero stacked bar ─────────────────────────── */}
        {/* Y-axis intentionally hidden: the per-bar total annotation and the
            in-segment labels already carry the magnitude, and the unit lives
            in the section title ("(Mbpd)" / "(kbpd)"). Removes redundant
            chrome on a narrow viewport. X-axis ticks are rotated -90° so the
            month labels (e.g. "May-25") read top-down without clipping. */}
        <SectionCard
          title={`Production by environment (${heroUnitLabel})`}
          subtitle={heroSubtitle}
          loading={aggregateLoading}
        >
          {aggregateSeries.data.length > 0 ? (
            <MobileChart
              data={aggregateSeries.data}
              height={280}
              layout={{
                barmode: "stack",
                margin: { t: 28, b: 56, l: 8, r: 8 },
                xaxis: {
                  type: "date",
                  tickmode: "array",
                  tickvals: aggregateSeries.months,
                  ticktext: aggregateSeries.months.map((m) => fmtMonthLabelShort(m)),
                  tickangle: -90,
                  tickfont: { size: 10 },
                },
                yaxis: {
                  visible: false,
                  showticklabels: false,
                  showgrid: false,
                  zeroline: false,
                },
                showlegend: true,
                legend: { orientation: "h", y: -0.34, x: 0 },
                annotations: aggregateSeries.annotations,
              }}
            />
          ) : (
            <div
              style={{
                padding: 28,
                textAlign: "center",
                color: "var(--mobile-text-muted, #888)",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 12,
              }}
            >
              No data for the selected period.
            </div>
          )}
        </SectionCard>

        {/* ── SECTION 2 — Top 10 fields (rank list, tap to drill) ──── */}
        <SectionCard
          title="Top 10 fields"
          subtitle={fieldsSubtitle}
          loading={topFieldsLoading}
        >
          <TopFieldsList
            fields={topFields}
            viewIsCompany={viewIsCompany}
            onPick={openFieldDrill}
          />
        </SectionCard>

        {/* ── SECTION 3 — FPSO/UEP horizontal bar + tap-to-drill rows ─ */}
        <SectionCard
          title="Production by FPSO / UEP"
          subtitle={fpsoSubtitle}
          loading={installationsLoading}
        >
          {fpsoChart.data.length > 0 ? (
            <>
              <MobileChart
                data={fpsoChart.data}
                height={fpsoChart.height}
                layout={{
                  margin: { l: 132, r: 44, t: 8, b: 36 },
                  yaxis: { automargin: true, tickfont: { size: 10 } },
                  xaxis: { title: { text: "kbpd" } },
                  showlegend: false,
                  annotations: fpsoChart.annotations,
                }}
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginTop: 10,
                }}
              >
                {installations.slice(0, FPSO_CHART_CAP).map((inst) => (
                  <button
                    key={inst.instalacao}
                    type="button"
                    onClick={() => openInstallationDrill(inst.instalacao)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      background: "var(--mobile-surface-elevated, #fafafc)",
                      border: "1px solid var(--mobile-border, #e6e6ec)",
                      borderRadius: 10,
                      cursor: "pointer",
                      textAlign: "left",
                      minHeight: 44,
                      fontFamily: "Arial, Helvetica, sans-serif",
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--mobile-text, #1a1a1a)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {inst.instalacao}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--mobile-text-muted, #888)",
                          marginTop: 1,
                        }}
                      >
                        Hours {(inst.hours_rate * 100).toFixed(0)}% ·{" "}
                        {fmtNumber(inst.gas_mm3_dia, 1)} Mm³/d gas
                      </span>
                    </span>
                    <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--mobile-text, #1a1a1a)",
                        }}
                      >
                        {fmtNumber(bblDiaToKbpd(inst.oil_bbl_dia), 1)}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--mobile-text-muted, #888)",
                          marginLeft: 3,
                        }}
                      >
                        kbpd
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 10,
                          color: "var(--mobile-accent, #ff5000)",
                          fontWeight: 600,
                          marginTop: 2,
                        }}
                      >
                        Tap to drill ›
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div
              style={{
                padding: 28,
                textAlign: "center",
                color: "var(--mobile-text-muted, #888)",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 12,
              }}
            >
              No installations for this month.
            </div>
          )}
        </SectionCard>

        {/* ── SECTION 4 — KPI table (horizontal scroll, sticky first col) */}
        <SectionCard
          title="MoM / YoY / YTD breakdown"
          subtitle={kpiSubtitle}
          loading={kpiLoading}
        >
          <KpiTable rows={kpiRows} loading={kpiLoading} />
          <div
            style={{
              fontSize: 10,
              color: "var(--mobile-text-muted, #888)",
              padding: "8px 4px 0",
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            Swipe left to see more columns ›
          </div>
        </SectionCard>
      </div>

      {/* ── Field drill BottomSheet ──────────────────────────────────── */}
      <BottomSheet
        open={drillCampo !== null}
        onClose={closeFieldDrill}
        height="90vh"
        title={drillCampo ? `${drillCampo} — ${viewEmpresa ?? "Brazil"}` : undefined}
        ariaLabel="Field drill-down"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            opacity: drillLoading ? 0.7 : 1,
            transition: "opacity 0.18s ease",
          }}
        >
          {drillError && (
            <div
              style={{
                padding: "10px 12px",
                background: "#fff3cd",
                border: "1px solid #ffe69c",
                borderRadius: 8,
                color: "#7d5800",
                fontSize: 12,
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              {drillError}
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
            <div
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--mobile-text, #1a1a1a)",
                marginBottom: 6,
                padding: "0 6px",
                letterSpacing: "0.4px",
                textTransform: "uppercase",
              }}
            >
              Monthly production — Oil + Water (kbpd) · Hours rate (%)
            </div>
            {drillFieldSeries.length > 0 ? (
              <MobileChart
                data={drillFieldSeries}
                height={280}
                layout={{
                  barmode: "stack",
                  margin: { l: 40, r: 40, t: 8, b: 36 },
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
                  legend: { orientation: "h", y: -0.28, x: 0 },
                }}
              />
            ) : (
              <div
                style={{
                  padding: 28,
                  textAlign: "center",
                  color: "var(--mobile-text-muted, #888)",
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 12,
                }}
              >
                {drillLoading ? "Loading…" : "No data for this field in the current period."}
              </div>
            )}
          </div>

          <DrillKpiSummary data={drillKpiTable} />

          <div
            style={{
              fontSize: 11,
              color: "var(--mobile-text-muted, #888)",
              fontFamily: "Arial, Helvetica, sans-serif",
              padding: "0 4px",
            }}
          >
            Bars: oil (navy) + water (orange) · Line: monthly uptime fraction.
            The KPI table reads its own 14-month window so MoM and YoY stay
            populated independent of the period preset above.
          </div>
        </div>
      </BottomSheet>

      {/* ── Installation drill BottomSheet ───────────────────────────── */}
      <BottomSheet
        open={drillInstalacao !== null}
        onClose={closeInstallationDrill}
        height="90vh"
        title={drillInstalacao ? `${drillInstalacao} — ${viewEmpresa ?? "Brazil"}` : undefined}
        ariaLabel="Installation drill-down"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            opacity: drillInstalacaoLoading ? 0.7 : 1,
            transition: "opacity 0.18s ease",
          }}
        >
          {drillInstalacaoError && (
            <div
              style={{
                padding: "10px 12px",
                background: "#fff3cd",
                border: "1px solid #ffe69c",
                borderRadius: 8,
                color: "#7d5800",
                fontSize: 12,
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              {drillInstalacaoError}
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
            <div
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--mobile-text, #1a1a1a)",
                marginBottom: 6,
                padding: "0 6px",
                letterSpacing: "0.4px",
                textTransform: "uppercase",
              }}
            >
              Monthly production — Oil + Water (kbpd) · Hours rate (%)
            </div>
            {drillInstSeries.length > 0 ? (
              <MobileChart
                data={drillInstSeries}
                height={280}
                layout={{
                  barmode: "stack",
                  margin: { l: 40, r: 40, t: 8, b: 36 },
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
                  legend: { orientation: "h", y: -0.28, x: 0 },
                }}
              />
            ) : (
              <div
                style={{
                  padding: 28,
                  textAlign: "center",
                  color: "var(--mobile-text-muted, #888)",
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 12,
                }}
              >
                {drillInstalacaoLoading
                  ? "Loading…"
                  : "No data for this installation in the current period."}
              </div>
            )}
          </div>

          <DrillKpiSummary data={drillInstalacaoKpiTable} />

          <div
            style={{
              fontSize: 11,
              color: "var(--mobile-text-muted, #888)",
              fontFamily: "Arial, Helvetica, sans-serif",
              padding: "0 4px",
            }}
          >
            Bars: oil (navy) + water (orange) routed through this installation ·
            Line: monthly uptime fraction.
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

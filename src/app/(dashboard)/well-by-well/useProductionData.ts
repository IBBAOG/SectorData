"use client";

// ─── Single "brain" hook for /well-by-well (dual-view pattern) ──────────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook. Neither View
// ever calls Supabase or derives metrics on its own. All filter state, fetch
// orchestration, stake-weighted aggregations (delegated to server-side RPCs),
// KPI math and export plumbing live here.
//
// Scope: executive monthly oil & gas production summary, replicating the
// Well-by-Well PDF structure.
//
// Round 9 (2026-05-27): the legacy "empresa dropdown" was replaced by FIVE
// mutually-exclusive VIEW PILLS — `Brasil` (default), `Petrobras`, `PRIO`,
// `PetroReconcavo`, `Brava Energia`. The hook exposes a `view` state machine
// that toggles between Brasil (100% WI, no stake math) and one of four
// stake-weighted company views. The chart count dropped from 4 to 3:
//   - Chart 1: Oil production stacked by ambiente (Brazil OR company)
//   - Chart 2: Top fields (Brazil OR stake-weighted)
//   - Chart 3: Installations (Brazil OR stake-weighted)
// The duplicated "P1 Brazil + P2 Company" desktop layout is gone — when the
// user wants Brazil context, they tap the Brasil pill; when they want a
// company, they tap that company pill. No side-by-side compare.
//
// Round 13 (2026-05-27): the period rc-slider was replaced by 5 PERIOD
// PRESET BUTTONS — Last 12M (default), Last 24M, Last 36M, All, YTD. The
// `dateRange` state shape is unchanged (still `[startMonth, endMonth]`
// anchored to day=1); clicks call the existing `setDateRange` setter. Active
// state is derived by `detectPeriodPreset()` (see helpers section) comparing
// the current dateRange against each preset's computed range. The bootstrap
// default lookback dropped from 13 → 12 months so "Last 12M" highlights
// on first paint.
//
// Round 14 (2026-05-27): the Environment (ambientes) filter was removed.
// `ambientes` state, setter, toggle and exports are gone; both aggregate
// RPCs are now always invoked with `p_ambientes = null`, which they treat
// as "all three buckets". Concurrently, display labels for the three
// environment buckets were translated to English: `PreSal → Pre-Salt`,
// `PosSal → Post-Salt`, `Terra → Onshore`. The translation lives in the
// `AMBIENTE_LABEL` map and the `labelAmbiente(raw)` helper exported below,
// applied by both Views to the Chart 1 stacked-bar trace `name` and
// `hovertemplate`. Underlying RPC payload values stay raw so exported rows
// remain comparable to the `anp_cdp_producao.local` column.
//
// Round 16 (2026-05-28): drill modal KPI strip refactor. The legacy 4 KPI
// cards (Current oil / Δ MoM / Δ YoY / YTD avg) were replaced by a
// 5-column summary table (Current month / Previous month / MoM % / Same
// month prev. year / YoY %) rendered BELOW the chart. The KPI data is now
// fetched on a separate, period-INDEPENDENT 14-month window anchored to
// `latestMonth` (see `drillKpiSeries` + `drillInstalacaoKpiSeries` states
// and their dedicated fetch effects), so picking "Last 12M" no longer
// blanks the YoY cell when the same-month-prev-year point sits outside
// the chart window. The same applies to both the field- and installation-
// drill modals/sheets; the desktop View renders a 5-column wide table and
// the mobile View renders a 5-row stacked variant — same data, same
// builder (`buildKpiTable`), different layout for the available width.
//
// Data sources (5 base + 4 Brazil RPCs, all SECURITY DEFINER):
//   • get_production_brazil_aggregate(date_start, date_end, ambientes[]?)
//       → Brazil-wide stacked bars (no stake weighting)
//   • get_production_company_aggregate(empresa, date_start, date_end, ambientes[]?)
//       → Stake-weighted stacked bars for the selected company
//   • get_production_top_fields(empresa, date, top_n=10)
//       → Horizontal bar: top fields stake-weighted (company view)
//   • get_production_by_installation(empresa, date)
//       → Table: FPSO/UEP-level production stake-weighted (company view)
//   • get_production_yoy_table(empresa, date)
//       → YoY/MoM/YTD breakdown at the reference month (mobile drawer only)
//   • get_production_brazil_top_fields(date, top_n=10)            ← Round 9
//   • get_production_brazil_installation(date)                    ← Round 9
//   • get_production_brazil_field_timeseries(campo, ...)          ← Round 9
//   • get_production_brazil_installation_timeseries(instalacao,…) ← Round 9
//
// View list comes from `WELL_BY_WELL_VIEWS` (`src/data/wellByWellEmpresas.ts`).
// The empresa list from `get_field_stakes_empresas()` is no longer surfaced in
// the dashboard, but the wrapper is still called to drive the admin panel
// integration warmup and to silently snap `view` to `Brasil` if a stale
// session points outside the 5-view whitelist.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] / [mobile-only] with an explicit reason.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WELL_BY_WELL_VIEWS,
  isCompanyView,
  type WellByWellView,
} from "../../../data/wellByWellEmpresas";
import { WBW_COLORS } from "../../../data/wellByWellColors";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { bblDiaToKbpd } from "../../../lib/units";
import {
  rpcGetFieldStakesEmpresas,
  rpcGetProductionBrazilAggregate,
  rpcGetProductionCompanyAggregate,
  rpcGetProductionTopFields,
  rpcGetProductionByInstallation,
  rpcGetProductionYoyTable,
  rpcGetProductionFieldTimeseries,
  rpcGetProductionInstallationTimeseries,
  rpcGetProductionBrazilTopFields,
  rpcGetProductionBrazilInstallation,
  rpcGetProductionBrazilFieldTimeseries,
  rpcGetProductionBrazilInstallationTimeseries,
  rpcGetWellByWellHeader,
  rpcGetProductionMonthStatus,
  rpcGetAnpCdpBswScatterCanonical,
  rpcGetAnpCdpBswFieldAggregateCanonical,
  rpcGetAnpCdpDepletionScatterCanonical,
  rpcGetAnpCdpDepletionFieldAggregateCanonical,
  type AnpCdpBswPoint,
  type AnpCdpBswFieldPoint,
  type AnpCdpDepletionPoint,
  type AnpCdpDepletionFieldPoint,
} from "../../../lib/rpc";
import type { FieldStakeEmpresa } from "../../../types/fieldStakes";
import type {
  ProductionBrazilRow,
  ProductionCompanyRow,
  ProductionTopField,
  ProductionInstallation,
  ProductionYoYRow,
  ProductionFieldTimeseriesRow,
  ProductionInstallationTimeseriesRow,
  WellByWellHeaderRow,
  ProductionMonthStatus,
} from "../../../types/production";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default pill on first paint. "Brasil" is the report-style opener: country-
 * wide totals first, drill into a company afterward. Replaces the previous
 * `DEFAULT_EMPRESA = "Petrobras"` default from Rounds 1-8.
 */
export const DEFAULT_VIEW: WellByWellView = "Brasil";

/**
 * Empresa default used by RPCs that REQUIRE a non-null empresa param even in
 * Brasil view (specifically `get_well_by_well_header` — the header table
 * always shows Brazil + a company section, so we still need a company name).
 * The HeaderTable component drops the company section when `view === "Brasil"`.
 */
export const HEADER_TABLE_FALLBACK_EMPRESA = "Petrobras";

/**
 * Back-compat default for callers that still want a company name (none on
 * mainline as of Round 9 — every Brasil-aware caller switches on `view`).
 */
export const DEFAULT_EMPRESA = "Petrobras";

/** All three ambiente buckets carried verbatim from `anp_cdp_producao.local`. */
export const AMBIENTES: readonly string[] = ["PreSal", "PosSal", "Terra"];

/**
 * Display labels for the raw `anp_cdp_producao.local` values. Keep the DB
 * values raw on the data side (RPC payloads, pivots, exports) — only the
 * USER-FACING string is translated. This way exported rows stay comparable to
 * the DB column and analyst diff tools keep working.
 */
export const AMBIENTE_LABEL: Record<string, string> = {
  PreSal: "Pre-Salt",
  PosSal: "Post-Salt",
  Terra:  "Onshore",
};

/** Lookup helper for the ambiente display label; falls back to the raw value
 *  if a future bucket appears that we haven't translated yet (defensive). */
export function labelAmbiente(raw: string): string {
  return AMBIENTE_LABEL[raw] ?? raw;
}

/** Default lookback window when initialising the period (12 months — Round 13
 *  preset migration; was 13 in slider mode). The "Last 12M" preset matches
 *  this exactly on first paint, so the preset button highlights as active
 *  without any extra wiring. */
export const DEFAULT_LOOKBACK_MONTHS = 12;

/**
 * Colour palette for the ambiente stack — sourced from the Itaú BBA
 * "Well-by-Well" PDF report (PDF p2 reference: dark navy PreSal → orange
 * PosSal → mint green Onshore, ascending). These exports are now thin
 * re-aliases of the canonical tokens in `src/data/wellByWellColors.ts` —
 * keep them so existing import sites (Views) compile unchanged.
 */
export const AMBIENTE_COLOR: Record<string, string> = {
  PreSal: WBW_COLORS.ambiente.PreSal,
  PosSal: WBW_COLORS.ambiente.PosSal,
  Terra:  WBW_COLORS.ambiente.Terra,
};

/** Brand orange (#ff5000) — active-pill highlight, modal accent bar. */
export const BRAND_ORANGE = WBW_COLORS.currentMonth;

/** Hours-rate line color (mint green #73C6A1) — distinct from brand orange so
 *  the line does not blend with the water bars which also use #ff5000. */
export const HOURS_RATE_COLOR = WBW_COLORS.hoursRate;

// ─── Drill-down popup tab state (Phase 2 of /well-by-well drill enrichment) ───
//
// The field drill modal/BottomSheet now hosts three sub-analyses (was just
// "Production"):
//   - Production : 4 KPIs + Oil/Water/Hours stacked-bar chart (unchanged)
//   - BSW        : water-cut analysis reusing /anp-cdp-bsw chart builders
//   - Depletion  : uptime-normalized NP rolling depletion reusing
//                  /anp-cdp-depletion chart builders
//
// Each non-Production tab has its own sub-mode toggle (Field average vs Per
// well) and lazy-fetches data via the canonical-aware RPC wrappers. Cached
// data sticks until `drillCampo` changes (auto-close on view-pill switch is
// preserved separately).

export type DrillTab = "production" | "bsw" | "depletion";
export type DrillSubMode = "well" | "field";

/**
 * Default rolling-depletion window sizes used by the Depletion tab of the
 * drill popup. The standalone /anp-cdp-depletion dashboard lets the user pick
 * these via two number inputs; the popup keeps things minimal and uses fixed
 * defaults (12 recent vs 12 prior months — matches the dashboard default).
 */
export const DRILL_DEPLETION_RECENT_MONTHS = 12;
export const DRILL_DEPLETION_PRIOR_MONTHS  = 12;

/**
 * Top fields chart: oil dark navy + water brand orange (PDF p4 — Petrobras
 * "Largest Oil Producing Fields" sample). Round 15 (2026-05-27) swapped the
 * legacy light-blue water bar for the PDF's orange.
 */
export const TOP_FIELDS_OIL_COLOR   = WBW_COLORS.oil;
export const TOP_FIELDS_WATER_COLOR = WBW_COLORS.water;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert "YYYY-MM" or "YYYY-MM-DD" to a normalised "YYYY-MM-01" anchor. */
export function monthAnchor(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

/** First-of-month ISO date `n` months before/after the given anchor. */
export function shiftMonth(anchor: string, deltaMonths: number): string {
  const y = parseInt(anchor.slice(0, 4), 10);
  const m = parseInt(anchor.slice(5, 7), 10) - 1; // JS Date months 0..11
  const total = y * 12 + m + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12;
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-01`;
}

/** Build the inclusive list of `YYYY-MM-01` anchors between two dates. */
export function buildMonthList(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = monthAnchor(start);
  const stop = monthAnchor(end);
  let guard = 0;
  while (cur <= stop && guard < 600) {
    out.push(cur);
    cur = shiftMonth(cur, 1);
    guard++;
  }
  return out;
}

/** Number formatter with thousand separators and configurable decimals. */
export function fmtNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Format a percentage with sign and one decimal. */
export function fmtPct(p: number | null | undefined, digits = 1): string {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = p * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

/** Format a month anchor as "Apr 2026". */
export function fmtMonthLabel(anchor: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(anchor.slice(5, 7), 10);
  const y = anchor.slice(0, 4);
  return `${months[m - 1]} ${y}`;
}

// ─── Partial-month indicator (2026-06-11) ─────────────────────────────────────
//
// The ANP publishes the monthly CDP incrementally, so the latest month is often
// still partial (e.g. May 2026: ~1,447 producing wells vs ~6,460 in April).
// `/well-by-well` keeps that month visible everywhere and only flags it with a
// "Partial data" banner. The hook fetches `get_production_month_status()` once
// during bootstrap, maps it to the UI shape below, and exposes a derived
// `latestMonthIsPartial` flag plus the shared `buildPartialMonthNotice` copy.

/**
 * UI-shaped view of `get_production_month_status()` (the wire shape is
 * `ProductionMonthStatus`). Month anchors are `YYYY-MM-01` strings so they
 * compare cleanly against `latestMonth` / `referenceDate` elsewhere in the hook.
 */
export interface WellByWellMonthStatus {
  /** Latest month in `anp_cdp_producao`, as a `YYYY-MM-01` anchor. */
  month: string;
  /** True when the latest month cleared the 70% completeness heuristic. */
  isComplete: boolean;
  /** Producing-well count (petroleo_bbl_dia > 0) in the latest month. */
  producingWells: number;
  /** Producing-well count in the immediately-preceding month. */
  prevProducingWells: number;
  /** producingWells / prevProducingWells; null when the prev month had 0. */
  ratio: number | null;
  /** Most recent month that cleared the heuristic, as a `YYYY-MM-01` anchor. */
  lastCompleteMonth: string;
}

/**
 * Build the single canonical "Partial data" notice sentence shared by both
 * Views (desktop banner + mobile card). Defined ONCE here so the copy can't
 * drift between the two surfaces.
 *
 * Example (ratio present):
 *   "May 2026 data is still partial — ANP has published 1,447 producing wells
 *    vs 6,460 in April 2026 (≈22%). Figures will be revised as more fields
 *    report."
 *
 * When `ratio` is null (the previous month had 0 producing wells, so a
 * percentage is meaningless) the "(≈NN%)" parenthetical is omitted.
 */
export function buildPartialMonthNotice(s: WellByWellMonthStatus): string {
  const latestLabel = fmtMonthLabel(s.month);
  const prevAnchor = shiftMonth(s.month, -1);
  const prevLabel = fmtMonthLabel(prevAnchor);
  const wells = s.producingWells.toLocaleString("en-US");
  const prevWells = s.prevProducingWells.toLocaleString("en-US");
  const pct =
    s.ratio != null && Number.isFinite(s.ratio)
      ? ` (≈${Math.round(s.ratio * 100)}%)`
      : "";
  return (
    `${latestLabel} data is still partial — ANP has published ${wells} ` +
    `producing wells vs ${prevWells} in ${prevLabel}${pct}. ` +
    `Figures will be revised as more fields report.`
  );
}

// ─── Drill KPI table builder (Round 16, 2026-05-28) ───────────────────────────
//
// Reduces a period-independent timeseries (anchored to `latestMonth` over a
// fixed 14-month window — see `drillKpiSeries` + `drillInstalacaoKpiSeries`
// in the hook) to the 5-column KPI summary the drill modals render below
// their charts.
//
// Hoisted to module scope so React doesn't re-create the reference on every
// render (the consumers wrap it in `useMemo`, so a stable identity is enough
// — no `useCallback` needed).
//
// Semantics:
//   • current month  — last (year, month) point in the series
//   • previous month — immediately preceding (year, month) point
//   • same month previous year — `current.ano - 1, current.mes` lookup
//   • MoM/YoY pct — null when the prior datapoint is missing OR equals zero
//   • month labels — pre-formatted "Apr 2026" strings; null when the
//     underlying point is unavailable (except prev-year, which derives its
//     label from `last.ano - 1, last.mes` even when the row itself is
//     missing — gives the column header something meaningful).
//
// If the series is empty (e.g. canonical drill with no `field_stakes`
// coverage), every numeric field is `null` and the table renders all
// em-dashes — no crash.
export interface DrillKpiTableData {
  currentMonth:       number | null;
  prevMonth:          number | null;
  momPct:             number | null;
  prevYear:           number | null;
  yoyPct:             number | null;
  currentMonthLabel:  string | null;
  prevMonthLabel:     string | null;
  prevYearMonthLabel: string | null;
}

export function buildKpiTable(
  rows: ReadonlyArray<{ ano: number; mes: number; oil_bbl_dia: number }>,
): DrillKpiTableData {
  if (rows.length === 0) {
    return {
      currentMonth: null, prevMonth: null, momPct: null,
      prevYear: null, yoyPct: null,
      currentMonthLabel: null, prevMonthLabel: null, prevYearMonthLabel: null,
    };
  }
  const sorted = [...rows].sort((a, b) => {
    if (a.ano !== b.ano) return a.ano - b.ano;
    return a.mes - b.mes;
  });
  const last = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const currentMonth = bblDiaToKbpd(last.oil_bbl_dia);
  const prevMonth = prev ? bblDiaToKbpd(prev.oil_bbl_dia) : null;
  const momPct = prevMonth != null && prevMonth !== 0
    ? (currentMonth - prevMonth) / prevMonth
    : null;

  const yoyMatch = sorted.find((r) => r.ano === last.ano - 1 && r.mes === last.mes);
  const prevYear = yoyMatch ? bblDiaToKbpd(yoyMatch.oil_bbl_dia) : null;
  const yoyPct = prevYear != null && prevYear !== 0
    ? (currentMonth - prevYear) / prevYear
    : null;

  const lastAnchor = `${String(last.ano).padStart(4, "0")}-${String(last.mes).padStart(2, "0")}-01`;
  const prevAnchor = prev
    ? `${String(prev.ano).padStart(4, "0")}-${String(prev.mes).padStart(2, "0")}-01`
    : null;
  // Same-month-prev-year label always derivable from `last` — gives the
  // table column a meaningful header even when the data point is missing.
  const prevYearAnchor = `${String(last.ano - 1).padStart(4, "0")}-${String(last.mes).padStart(2, "0")}-01`;

  return {
    currentMonth,
    prevMonth,
    momPct,
    prevYear,
    yoyPct,
    currentMonthLabel:  fmtMonthLabel(lastAnchor),
    prevMonthLabel:     prevAnchor ? fmtMonthLabel(prevAnchor) : null,
    prevYearMonthLabel: fmtMonthLabel(prevYearAnchor),
  };
}

// ─── Period presets (Round 13, 2026-05-27) ────────────────────────────────────
//
// Replaces the rc-slider `PeriodSlider` with 5 mutually-exclusive buttons.
// State lives in `dateRange` (unchanged) — clicks call the existing
// `setDateRange`. Active styling is driven by `detectPeriodPreset()`, which
// compares the current `dateRange` against each preset's computed range.

/**
 * Period preset identifiers. Default on first paint is `last12m` (matches
 * `DEFAULT_LOOKBACK_MONTHS`). Each preset is anchored to `latestMonth` (most
 * recent month present in `anp_cdp_producao`), exposed by the hook.
 */
export type PeriodPreset = "last12m" | "last24m" | "last36m" | "all" | "ytd";

/** Ordered list of presets — drives the button row order in both Views. */
export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  "last12m",
  "last24m",
  "last36m",
  "all",
  "ytd",
] as const;

/** Display label per preset (English, matches the task spec). */
export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  last12m: "Last 12M",
  last24m: "Last 24M",
  last36m: "Last 36M",
  all:     "All",
  ytd:     "YTD",
};

/**
 * Safe lower-bound anchor for the "All" preset. Older than any expected
 * `anp_cdp_producao` row; RPCs filter to existing rows anyway. Anchored to
 * day=1 to match the rest of the period state.
 */
export const ALL_PRESET_START = "2010-01-01";

/**
 * Compute the `[start, end]` dateRange anchors for a given preset, relative
 * to a `latestMonth` anchor (YYYY-MM-01). Returns `null` if `latestMonth` is
 * not set (bootstrap hasn't completed yet). All start/end values are
 * YYYY-MM-DD strings anchored to day=1.
 *
 * Semantics:
 *   • last12m → [latestMonth - 11mo, latestMonth] (12 months inclusive)
 *   • last24m → [latestMonth - 23mo, latestMonth]
 *   • last36m → [latestMonth - 35mo, latestMonth]
 *   • all     → [ALL_PRESET_START, latestMonth]
 *   • ytd     → [{latestMonth.year}-01-01, latestMonth]
 */
export function computePresetRange(
  preset: PeriodPreset,
  latestMonth: string | null,
): [string, string] | null {
  if (!latestMonth) return null;
  const end = monthAnchor(latestMonth);
  switch (preset) {
    case "last12m": return [shiftMonth(end, -11), end];
    case "last24m": return [shiftMonth(end, -23), end];
    case "last36m": return [shiftMonth(end, -35), end];
    case "all":     return [ALL_PRESET_START, end];
    case "ytd": {
      const year = end.slice(0, 4);
      return [`${year}-01-01`, end];
    }
  }
}

/**
 * Detect which preset (if any) matches the current `dateRange` exactly.
 * Used by the Views to drive `aria-pressed` / active styling on the preset
 * buttons. Returns `null` if no preset matches.
 *
 * Comparison rules:
 *   • End anchor must equal `latestMonth` (all presets end there).
 *   • For "all", we match when the start equals `firstAvailableMonth`
 *     (the first month present in `allMonths`, typically 2018-01-01) —
 *     because the hook's `setDateRange` snaps `'2010-01-01'` to the
 *     first available month via `indexOf` + `Math.max(0, …)`.
 *   • For other presets, the start must match exactly.
 */
export function detectPeriodPreset(
  dateRange: [string, string],
  latestMonth: string | null,
  firstAvailableMonth: string | null,
): PeriodPreset | null {
  if (!latestMonth || !dateRange[0] || !dateRange[1]) return null;
  const end = monthAnchor(dateRange[1]);
  const start = monthAnchor(dateRange[0]);
  if (end !== monthAnchor(latestMonth)) return null;

  // "All" — start equals the first available month (after snap-to-bounds).
  // Falls back to literal ALL_PRESET_START if firstAvailableMonth is unknown.
  const allStart = firstAvailableMonth ?? ALL_PRESET_START;
  if (start === monthAnchor(allStart)) return "all";

  // YTD — start is January of latestMonth's year.
  const year = end.slice(0, 4);
  if (start === `${year}-01-01`) return "ytd";

  // Last-N — exact arithmetic match.
  if (start === shiftMonth(end, -11)) return "last12m";
  if (start === shiftMonth(end, -23)) return "last24m";
  if (start === shiftMonth(end, -35)) return "last36m";

  return null;
}

// `sumOil` / `sumGas` helpers were removed in Round 6 alongside the top KPI
// strip. The remaining derived metrics (drill-down KPIs, YoY/MoM/YTD table)
// are computed either client-side from a sorted timeseries or server-side by
// `get_production_yoy_table`, neither of which needs an at-reference-month
// fold over `companyData`/`brazilData`.

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseProductionData {
  // Visibility
  visible: boolean;
  visLoading: boolean;

  // Initial bootstrap (filters universe + most-recent month discovery)
  bootstrapping: boolean;
  /** Most recent `YYYY-MM-01` available in `anp_cdp_producao`. */
  latestMonth: string | null;

  // Partial-month indicator (2026-06-11). `monthStatus` is null until the
  // bootstrap probe resolves, and STAYS null on RPC error / empty table
  // (fail open — render no banner). `latestMonthIsPartial` is the derived
  // boolean both Views gate the banner / "(partial)" suffixes on.
  /** Completeness status of the latest CDP month; null = assume complete. */
  monthStatus: WellByWellMonthStatus | null;
  /**
   * True only when the probe resolved, the latest month is incomplete, AND it
   * matches `latestMonth` (guards against lag between the MV used by the
   * bootstrap probe and the base table read by the status RPC).
   */
  latestMonthIsPartial: boolean;

  // View pill state machine (Round 9, 2026-05-27).
  // `view` is one of `WELL_BY_WELL_VIEWS` and drives which RPC family fires:
  //   - "Brasil"        → Brazil-wide RPCs (no stake weighting)
  //   - company name    → stake-weighted RPCs for that company
  // `viewEmpresa` is a convenience derived value: `null` for Brasil, else the
  // company name. Use it at the call site instead of branching on `view !==
  // "Brasil"` everywhere.
  view: WellByWellView;
  setView: (v: WellByWellView) => void;
  /** True when the active view is a company (everything except Brasil). */
  isCompanyView: boolean;
  /** Company name when `view !== "Brasil"`; null in Brasil view. */
  viewEmpresa: string | null;

  // Back-compat: existing call sites still read `empresa` (e.g. drill modal
  // header labels). It now mirrors `viewEmpresa ?? "Brasil"` so labels read
  // sensibly in both modes ("BÚZIOS — Brasil" / "BÚZIOS — Petrobras").
  empresasList: FieldStakeEmpresa[];
  empresa: string;
  /** @deprecated since Round 9. Use `setView` instead. Kept as a noop alias
   *  so legacy call sites compile during the transition. */
  setEmpresa: (e: string) => void;

  // Period (months, inclusive)
  allMonths: string[];                            // every month anchor between absolute min/max
  dateRange: [string, string];                    // [startMonth, endMonth]
  setDateRange: (range: [string, string]) => void;
  monthIdxRange: [number, number];                // indices into `allMonths` for the slider
  setMonthIdxRange: (idx: [number, number]) => void;

  // Reference month (used by top fields + installations + YoY + Header table)
  referenceDate: string;                          // YYYY-MM-01
  setReferenceDate: (d: string) => void;

  // Data states. In Brasil view, `companyData` is always [] (chart 1 reads
  // brazilData); in company view, brazilData stays populated but is not
  // rendered by chart 1 — only by the HeaderTable's Brazil section.
  brazilData: ProductionBrazilRow[];
  companyData: ProductionCompanyRow[];
  topFields: ProductionTopField[];
  installations: ProductionInstallation[];
  yoyTable: ProductionYoYRow[];
  /** PDF page-2 header table (Brazil + Empresa rollup). */
  headerData: WellByWellHeaderRow[];

  // Loading flags (per data state)
  brazilLoading: boolean;
  companyLoading: boolean;
  topFieldsLoading: boolean;
  installationsLoading: boolean;
  yoyLoading: boolean;
  headerLoading: boolean;
  /** Any of the data fetches is in-flight. Useful for "updating…" hints. */
  anyLoading: boolean;

  // Error (single bubble; per-RPC errors are logged at the wrapper level)
  error: Error | null;

  // Export (Tier 1 — direct download, multi-sheet Excel + zip CSV)
  excelLoading: boolean;
  csvLoading: boolean;
  handleExportExcel: () => Promise<void>;
  handleExportCsv: () => Promise<void>;

  // Field drill-down. In Brasil view the drill calls the Brazil-wide
  // timeseries RPC; in company view the stake-weighted one. UI is identical.
  drillCampo: string | null;
  drillTimeseries: ProductionFieldTimeseriesRow[];
  drillLoading: boolean;
  drillError: string | null;
  /**
   * KPI table data for the drill modal/sheet.
   *
   * Decoupled from the dashboard's period filter: always carries the current
   * month, the previous month, and the same month one year ago — even when
   * the dashboard's period preset (e.g. Last 12M) doesn't include the
   * same-month-prev-year point.
   *
   * Values are in kbpd. `*MonthLabel` are pre-formatted month labels (e.g.
   * "Apr 2026") for table headers; `null` when the underlying data point is
   * unavailable (e.g. brand-new field with no prev year).
   */
  drillKpiTable: DrillKpiTableData;
  openFieldDrill: (campo: string) => void;
  closeFieldDrill: () => void;

  // ── Drill popup tabs (Phase 2) ──────────────────────────────────────────
  // Tab selector lives inside the drill modal/BottomSheet. Switching tabs
  // does NOT close the drill — that only happens on view-pill change or
  // explicit close. Default tab on open: "production".
  drillTab: DrillTab;
  setDrillTab: (t: DrillTab) => void;

  // BSW tab sub-state. `drillBswMode` toggles between Field average (default)
  // and Per well; data is lazy-fetched per sub-mode and cached until
  // `drillCampo` changes.
  drillBswMode: DrillSubMode;
  setDrillBswMode: (m: DrillSubMode) => void;
  drillBswWellPoints: AnpCdpBswPoint[] | null;
  drillBswFieldPoints: AnpCdpBswFieldPoint[] | null;
  drillBswLoading: boolean;
  drillBswError: string | null;
  /**
   * Imperative prefetch for the BSW "Field average" dataset. Used by the
   * desktop View as an `onMouseEnter` handler on the BSW tab button — if the
   * user hovers the tab before clicking, the fetch starts a few hundred ms
   * earlier so by the time they click the chart is already rendered.
   *
   * Idempotent: skips if data is already cached OR a fetch is in flight, so
   * repeated hover events don't spam the RPC. Mobile Views never call it
   * (no hover on touch devices).
   */
  prefetchBswField: () => void;

  // Depletion tab sub-state — same shape as BSW.
  drillDepletionMode: DrillSubMode;
  setDrillDepletionMode: (m: DrillSubMode) => void;
  drillDepletionWellPoints: AnpCdpDepletionPoint[] | null;
  drillDepletionFieldPoints: AnpCdpDepletionFieldPoint[] | null;
  drillDepletionLoading: boolean;
  drillDepletionError: string | null;
  /** Symmetric hover-prefetch for the Depletion "Field average" dataset. */
  prefetchDepletionField: () => void;

  // Installation drill-down. Same Brasil-vs-company branching as the field
  // drill. Mutually exclusive with the field drill.
  drillInstalacao: string | null;
  drillInstalacaoTimeseries: ProductionInstallationTimeseriesRow[];
  drillInstalacaoLoading: boolean;
  drillInstalacaoError: string | null;
  /**
   * KPI table data for the installation drill-down. Same shape and semantics
   * as `drillKpiTable` (independent of the dashboard's period filter).
   */
  drillInstalacaoKpiTable: DrillKpiTableData;
  openInstallationDrill: (instalacao: string) => void;
  closeInstallationDrill: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProductionData(): UseProductionData {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("well-by-well");
  const supabase = getSupabaseClient();

  // ── State ──────────────────────────────────────────────────────────────────
  const [bootstrapping, setBootstrapping] = useState(true);
  const [latestMonth, setLatestMonth] = useState<string | null>(null);
  // Partial-month indicator. null = "assume complete, no banner" (fail open) —
  // set by the bootstrap probe; left null on RPC error / empty table.
  const [monthStatus, setMonthStatus] = useState<WellByWellMonthStatus | null>(null);
  const [empresasList, setEmpresasList] = useState<FieldStakeEmpresa[]>([]);

  // Round 9: view replaces empresa as the active toggle state. Default is
  // "Brasil" — first thing the user sees on page load.
  const [view, setViewState] = useState<WellByWellView>(DEFAULT_VIEW);

  const [allMonths, setAllMonths] = useState<string[]>([]);
  const [monthIdxRange, setMonthIdxRangeState] = useState<[number, number]>([0, 0]);

  const [referenceDate, setReferenceDateState] = useState<string>("");

  const [brazilData, setBrazilData] = useState<ProductionBrazilRow[]>([]);
  const [companyData, setCompanyData] = useState<ProductionCompanyRow[]>([]);
  const [topFields, setTopFields] = useState<ProductionTopField[]>([]);
  const [installations, setInstallations] = useState<ProductionInstallation[]>([]);
  const [yoyTable, setYoyTable] = useState<ProductionYoYRow[]>([]);
  // PDF page-2 header table backing state (Round 8, kept).
  const [headerData, setHeaderData] = useState<WellByWellHeaderRow[]>([]);

  const [error, setError] = useState<Error | null>(null);

  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  // Field drill-down state (Round 2; canonical-aware since Round 4;
  // Brasil-aware since Round 9). `drillCampo` doubles as the visibility flag
  // for the modal/sheet — null when closed, the canonical name when open.
  const [drillCampo, setDrillCampo] = useState<string | null>(null);
  const [drillTimeseries, setDrillTimeseries] = useState<ProductionFieldTimeseriesRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  // KPI-table series for the field drill (Round 16, 2026-05-28). Always
  // anchored to the dashboard's `latestMonth` over a fixed 14-month window so
  // the table can read current month, previous month and same-month-prev-year
  // without depending on the user's period preset (the chart still consumes
  // the period-filtered `drillTimeseries`).
  const [drillKpiSeries, setDrillKpiSeries] = useState<ProductionFieldTimeseriesRow[]>([]);

  // Installation drill-down state (Round 3; Brasil-aware since Round 9).
  const [drillInstalacao, setDrillInstalacao] = useState<string | null>(null);
  const [drillInstalacaoTimeseries, setDrillInstalacaoTimeseries] = useState<ProductionInstallationTimeseriesRow[]>([]);
  const [drillInstalacaoLoading, setDrillInstalacaoLoading] = useState(false);
  const [drillInstalacaoError, setDrillInstalacaoError] = useState<string | null>(null);
  // KPI-table series for the installation drill — same period-independent
  // 14-month window as the field counterpart.
  const [drillInstalacaoKpiSeries, setDrillInstalacaoKpiSeries] = useState<ProductionInstallationTimeseriesRow[]>([]);

  // ── Drill popup tab state (Phase 2) ──────────────────────────────────────
  const [drillTab, setDrillTabState] = useState<DrillTab>("production");
  const [drillBswMode, setDrillBswModeState] = useState<DrillSubMode>("field");
  const [drillDepletionMode, setDrillDepletionModeState] = useState<DrillSubMode>("field");

  // BSW data caches — `null` means "not yet fetched"; `[]` means "fetched but
  // empty result". Using `null` as the initial value lets the fetch effect
  // distinguish "needs fetch" from "no data available".
  const [drillBswWellPoints, setDrillBswWellPoints]   = useState<AnpCdpBswPoint[] | null>(null);
  const [drillBswFieldPoints, setDrillBswFieldPoints] = useState<AnpCdpBswFieldPoint[] | null>(null);
  const [drillBswLoading, setDrillBswLoading]         = useState(false);
  const [drillBswError, setDrillBswError]             = useState<string | null>(null);

  // Depletion data caches — same shape as BSW.
  const [drillDepletionWellPoints,  setDrillDepletionWellPoints]  = useState<AnpCdpDepletionPoint[] | null>(null);
  const [drillDepletionFieldPoints, setDrillDepletionFieldPoints] = useState<AnpCdpDepletionFieldPoint[] | null>(null);
  const [drillDepletionLoading, setDrillDepletionLoading]         = useState(false);
  const [drillDepletionError, setDrillDepletionError]             = useState<string | null>(null);

  const setDrillTab          = useCallback((t: DrillTab)    => setDrillTabState(t), []);
  const setDrillBswMode      = useCallback((m: DrillSubMode) => setDrillBswModeState(m), []);
  const setDrillDepletionMode = useCallback((m: DrillSubMode) => setDrillDepletionModeState(m), []);

  // ── Derived: view ↔ empresa convenience ───────────────────────────────────
  const viewIsCompany = isCompanyView(view);
  const viewEmpresa: string | null = viewIsCompany ? view : null;
  // Back-compat alias for legacy call sites that still read `empresa`.
  const empresa = viewEmpresa ?? "Brasil";

  // ── Derived: dateRange from monthIdxRange ─────────────────────────────────
  const dateRange = useMemo<[string, string]>(() => {
    if (allMonths.length === 0) return ["", ""];
    const a = allMonths[monthIdxRange[0]] ?? allMonths[0];
    const b = allMonths[monthIdxRange[1]] ?? allMonths[allMonths.length - 1];
    return [a, b];
  }, [allMonths, monthIdxRange]);

  // ── Setters ────────────────────────────────────────────────────────────────
  const setView = useCallback((v: WellByWellView) => setViewState(v), []);
  // `setEmpresa` kept as a back-compat alias — translates a company name back
  // into the corresponding view pill. Setting it to a non-whitelisted name is
  // a noop (defensive). Brand-new code should call `setView` directly.
  const setEmpresa = useCallback((name: string) => {
    if ((WELL_BY_WELL_VIEWS as readonly string[]).includes(name)) {
      setViewState(name as WellByWellView);
    }
  }, []);
  const setMonthIdxRange = useCallback((idx: [number, number]) => {
    setMonthIdxRangeState(idx);
  }, []);
  const setReferenceDate = useCallback((d: string) => {
    setReferenceDateState(monthAnchor(d));
  }, []);
  const setDateRange = useCallback((range: [string, string]) => {
    // Translate explicit anchors back to indices, snapping to bounds.
    setMonthIdxRangeState((prev) => {
      if (allMonths.length === 0) return prev;
      const i0 = Math.max(0, allMonths.indexOf(monthAnchor(range[0])));
      const i1 = Math.max(i0, allMonths.indexOf(monthAnchor(range[1])));
      return [i0, i1 < 0 ? allMonths.length - 1 : i1];
    });
  }, [allMonths]);

  // ── Bootstrap: empresa list + latest month discovery ──────────────────────
  //
  // Round 9: the bootstrap still calls `rpcGetFieldStakesEmpresas` because the
  // admin panel relies on the warm cache (and the snap-to-Brasil logic needs
  // to know whether `view` is in the 5-view whitelist). Brazil aggregate probe
  // still seeds `brazilData` for the default window — same Round 5 perf trick.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setBootstrapping(true);
    setError(null);

    (async () => {
      try {
        // Fire both bootstrap RPCs IN PARALLEL — empresa list is independent
        // of the Brazil probe, no reason to chain them.
        const [empresasRes, probeRes, statusRes] = await Promise.allSettled([
          rpcGetFieldStakesEmpresas(supabase),
          rpcGetProductionBrazilAggregate(supabase, "2018-01-01", "2099-12-31", null),
          rpcGetProductionMonthStatus(supabase),
        ]);
        if (cancelled) return;

        // Empresa list — graceful: if anon doesn't have GRANT, list is empty
        // and the dropdown shows the default. Once auth lands, it populates.
        let empresas: FieldStakeEmpresa[] = [];
        if (empresasRes.status === "fulfilled") {
          empresas = empresasRes.value;
        } else {
          console.warn(
            "rpcGetFieldStakesEmpresas failed (admin-only? continuing with default)",
            empresasRes.reason,
          );
        }
        // Restrict the dashboard's empresa list to the IR-relevant whitelist
        // (4 companies). The admin panel's Field Stakes editor still consumes
        // the full list via the same RPC wrapper — this filter only narrows
        // what the dashboard sees. Round 9: the list is no longer rendered
        // (pills replaced the dropdown), but we still expose it on
        // `empresasList` for back-compat with anything that may consume it.
        const companyViews = WELL_BY_WELL_VIEWS.filter(isCompanyView);
        const allowed = new Set<string>(companyViews);
        const orderIdx = new Map<string, number>(
          companyViews.map((name, i) => [name, i]),
        );
        empresas = empresas
          .filter((e) => allowed.has(e.empresa))
          .sort(
            (a, b) =>
              (orderIdx.get(a.empresa) ?? Number.MAX_SAFE_INTEGER) -
              (orderIdx.get(b.empresa) ?? Number.MAX_SAFE_INTEGER),
          );
        setEmpresasList(empresas);

        // Partial-month status — non-fatal. A rejection (or a null result from
        // an RPC error / empty table) leaves the banner off (fail open); it
        // must never block the bootstrap or surface an error in the UI.
        const status: ProductionMonthStatus | null =
          statusRes.status === "fulfilled" ? statusRes.value : null;
        if (status) {
          const statusAnchor =
            `${String(status.latest_ano).padStart(4, "0")}-` +
            `${String(status.latest_mes).padStart(2, "0")}-01`;
          const lastCompleteAnchor =
            `${String(status.last_complete_ano).padStart(4, "0")}-` +
            `${String(status.last_complete_mes).padStart(2, "0")}-01`;
          setMonthStatus({
            month: statusAnchor,
            isComplete: status.is_complete,
            producingWells: status.latest_producing_wells,
            prevProducingWells: status.prev_producing_wells,
            ratio: status.completeness_ratio,
            lastCompleteMonth: lastCompleteAnchor,
          });
        } else {
          setMonthStatus(null);
        }

        // Safety: snap `view` back to `Brasil` if a stale session points
        // outside the 5-view whitelist (e.g. URL param or restored state).
        setViewState((cur) =>
          (WELL_BY_WELL_VIEWS as readonly string[]).includes(cur) ? cur : DEFAULT_VIEW,
        );

        // Brazil probe — required to know latestMonth; if it failed, bubble up.
        if (probeRes.status === "rejected") {
          throw probeRes.reason instanceof Error
            ? probeRes.reason
            : new Error(String(probeRes.reason));
        }
        const probe = probeRes.value;

        let maxAnchor: string | null = null;
        for (const r of probe) {
          const a = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
          if (!maxAnchor || a > maxAnchor) maxAnchor = a;
        }
        if (!maxAnchor) {
          // No data at all — fall back to "today" so the UI doesn't crash.
          const now = new Date();
          maxAnchor = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        }

        const minAnchor = "2018-01-01";
        const months = buildMonthList(minAnchor, maxAnchor);
        setAllMonths(months);
        setLatestMonth(maxAnchor);

        // Default window: last DEFAULT_LOOKBACK_MONTHS months ending at
        // maxAnchor. Snap to bounds. Round 13 (2026-05-27): matches the
        // "Last 12M" preset, so the corresponding preset button highlights
        // as active on first paint without any extra wiring.
        const endIdx = months.length - 1;
        const startIdx = Math.max(0, endIdx - (DEFAULT_LOOKBACK_MONTHS - 1));
        setMonthIdxRangeState([startIdx, endIdx]);
        setReferenceDateState(maxAnchor);

        // Seed Brazil data from the probe (Round 5 perf win) — even though
        // chart 1 only renders Brazil when `view === "Brasil"`, the
        // HeaderTable in company view still needs Brazil values, and the
        // bootstrap probe is already in flight regardless.
        const startAnchor = months[startIdx];
        const endAnchor   = months[endIdx];
        const windowed = probe.filter((r) => {
          const a = `${String(r.ano).padStart(4, "0")}-${String(r.mes).padStart(2, "0")}-01`;
          return a >= startAnchor && a <= endAnchor;
        });
        if (windowed.length > 0) setBrazilData(windowed);
      } catch (e) {
        if (!cancelled) {
          console.error("/well-by-well bootstrap failed", e);
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive fetch: Brazil aggregate ──────────────────────────────────────
  //
  // Brazil aggregate is consumed by:
  //   - Chart 1 when `view === "Brasil"`
  // It's NOT needed by the HeaderTable (the table has its own server-side
  // header RPC). Therefore we can SKIP this fetch entirely when the view is
  // a company — chart 1 in company view reads companyData, not brazilData.
  //
  // Note: deps INTENTIONALLY include `view` so when the user toggles back to
  // Brasil from a company, we re-fetch to ensure freshness for the period/
  // ambientes that may have changed while the company tab was active.
  const { data: brazilFetched, loading: brazilLoading } = useDebouncedFetch<
    ProductionBrazilRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !dateRange[0] || !dateRange[1]) return null;
      if (view !== "Brasil") return null; // skip when company is active
      try {
        // Ambiente filter was removed (all three environments always shown).
        // Pass null so the RPC returns rows for every `local` bucket.
        return await rpcGetProductionBrazilAggregate(
          supabase,
          dateRange[0],
          dateRange[1],
          null,
        );
      } catch (e) {
        console.error("Brazil aggregate refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, dateRange[0], dateRange[1]],
    { ms: 150, skipInitial: true },
  );
  useEffect(() => {
    if (brazilFetched) setBrazilData(brazilFetched);
  }, [brazilFetched]);

  // ── Reactive fetch: Company aggregate ─────────────────────────────────────
  //
  // Only fires when a company pill is active. In Brasil view we clear the
  // companyData state on view-change so a stale company chart doesn't
  // flash if the user re-enters a company tab.
  const { data: companyFetched, loading: companyLoading } = useDebouncedFetch<
    ProductionCompanyRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !dateRange[0] || !dateRange[1]) return null;
      if (!viewIsCompany || !viewEmpresa) return null;
      try {
        // Ambiente filter was removed (all three environments always shown).
        // Pass null so the RPC returns rows for every `local` bucket.
        return await rpcGetProductionCompanyAggregate(
          supabase,
          viewEmpresa,
          dateRange[0],
          dateRange[1],
          null,
        );
      } catch (e) {
        console.error("Company aggregate refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, dateRange[0], dateRange[1]],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (companyFetched) setCompanyData(companyFetched);
  }, [companyFetched]);

  // Clear stale data when switching views so we don't render a flash of the
  // previous mode's data while the new fetch is in flight.
  useEffect(() => {
    if (view === "Brasil") {
      setCompanyData([]);
    }
  }, [view]);

  // ── Reactive fetch: Top fields ────────────────────────────────────────────
  //
  // Brasil view → get_production_brazil_top_fields(date, top_n)
  // Company view → get_production_top_fields(empresa, date, top_n) (existing)
  //
  // Deps deliberately exclude dateRange & ambientes — Top Fields is a single-
  // month snapshot anchored to referenceDate.
  const { data: topFetched, loading: topFieldsLoading } = useDebouncedFetch<
    ProductionTopField[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      try {
        if (view === "Brasil") {
          return await rpcGetProductionBrazilTopFields(supabase, referenceDate, 10);
        }
        if (!viewEmpresa) return null;
        return await rpcGetProductionTopFields(supabase, viewEmpresa, referenceDate, 10);
      } catch (e) {
        console.error("Top fields refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (topFetched) setTopFields(topFetched);
  }, [topFetched]);

  // ── Reactive fetch: Installations ─────────────────────────────────────────
  const { data: instFetched, loading: installationsLoading } = useDebouncedFetch<
    ProductionInstallation[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      try {
        if (view === "Brasil") {
          return await rpcGetProductionBrazilInstallation(supabase, referenceDate);
        }
        if (!viewEmpresa) return null;
        return await rpcGetProductionByInstallation(supabase, viewEmpresa, referenceDate);
      } catch (e) {
        console.error("Installations refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (instFetched) setInstallations(instFetched);
  }, [instFetched]);

  // ── Reactive fetch: YoY table (mobile drawer only, still company-only) ────
  //
  // The YoY/MoM/YTD table is consumed only by the mobile collapsible drawer
  // (desktop dropped it in Round 8). In Brasil view the drawer is hidden, so
  // we skip the fetch entirely.
  const { data: yoyFetched, loading: yoyLoading } = useDebouncedFetch<
    ProductionYoYRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      if (!viewIsCompany || !viewEmpresa) return null;
      try {
        return await rpcGetProductionYoyTable(supabase, viewEmpresa, referenceDate);
      } catch (e) {
        console.error("YoY table refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (yoyFetched) setYoyTable(yoyFetched);
  }, [yoyFetched]);

  // ── Reactive fetch: Header table ──────────────────────────────────────────
  //
  // `get_well_by_well_header(p_empresa, p_year, p_month)` always returns
  // Brazil + a company section together. In Brasil view we still call it but
  // pass the fallback empresa (Petrobras) — the HeaderTable component filters
  // to `section === 'BRAZIL'` when the view is Brasil, dropping the company
  // section client-side. This is intentionally one extra unused RPC slice in
  // exchange for not needing a separate Brazil-only header RPC.
  //
  // Empresa decision is derived from `view` INSIDE the closure (not from the
  // outer-scope `viewEmpresa`) so it's obvious-by-inspection that this fetch
  // reacts to view-pill clicks. Listed explicitly in the deps array too.
  // Switching Brasil ↔ Petrobras sends the same empresa string ("Petrobras")
  // — the user-visible change in that case is driven by HeaderTable's
  // `viewMode` prop filter, not by new data. Switching to PRIO /
  // PetroReconcavo / Brava Energia DOES change the empresa string and yields
  // a fresh RPC payload.
  const { data: headerFetched, loading: headerLoading } = useDebouncedFetch<
    WellByWellHeaderRow[] | null
  >(
    async () => {
      if (!supabase || bootstrapping || !referenceDate) return null;
      const year = parseInt(referenceDate.slice(0, 4), 10);
      const month = parseInt(referenceDate.slice(5, 7), 10);
      if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
      // Explicit branch on `view` (matches the deps array entry below). For
      // Brasil view we send the non-null fallback empresa because the RPC
      // requires a non-null `p_empresa` — the HeaderTable component then
      // hides the company-section rows client-side via its `viewMode` prop.
      const empresaForHeader: string =
        view === "Brasil" ? HEADER_TABLE_FALLBACK_EMPRESA : view;
      try {
        return await rpcGetWellByWellHeader(supabase, empresaForHeader, year, month);
      } catch (e) {
        console.error("Header table refetch failed", e);
        return [];
      }
    },
    [supabase, bootstrapping, view, referenceDate],
    { ms: 150, skipInitial: false },
  );
  useEffect(() => {
    if (headerFetched) setHeaderData(headerFetched);
  }, [headerFetched]);

  // Round 12 (2026-05-27): the Round 10 defensive clear effect that pruned
  // headerData to Brazil-only rows on view change has been REMOVED. The
  // HeaderTable component now filters by `section === UPPER(viewMode)`
  // client-side (Brasil → BRAZIL rows; empresa pill → that empresa's rows;
  // see HeaderTable.tsx), which handles stale-data flashes on view change for
  // free: when the user toggles Petrobras → PRIO, the previously fetched
  // PETROBRAS rows no longer match the new filter and disappear immediately,
  // even before the new RPC payload lands. The filter is a strict superset of
  // what the clear effect did, so keeping both was redundant.
  //
  // ── If the dateRange changes such that referenceDate falls outside it, ────
  //    snap referenceDate to dateRange[1] (most recent month in window).
  const lastSnapRef = useRef<string>("");
  useEffect(() => {
    if (!dateRange[1] || !referenceDate) return;
    if (referenceDate > dateRange[1] || referenceDate < dateRange[0]) {
      if (lastSnapRef.current !== dateRange[1]) {
        lastSnapRef.current = dateRange[1];
        setReferenceDateState(dateRange[1]);
      }
    }
  }, [dateRange, referenceDate]);

  // ── Field drill-down: open / close handlers + reactive fetch ──────────────
  //
  // Brasil view → get_production_brazil_field_timeseries(campo, dateStart, dateEnd)
  // Company view → get_production_field_timeseries(campo, empresa, dateStart, dateEnd)
  //
  // Open is intent-driven (user clicked a row) — no debounce. Fetch reuses
  // the dashboard's current dateRange so the drilled-in timeseries matches
  // the period the user is looking at. Closing clears the timeseries to
  // avoid stale flicker if a different field is reopened later.
  //
  // Mutual exclusivity: opening the field drill auto-closes any open
  // installation drill, and vice versa.
  //
  // Round 4 (canonical grouping): `campo` is a CANONICAL field name. Both
  // RPC variants interpret it as canonical and expand server-side.
  //
  // Round 9: drill is also Brasil-aware — the company-vs-Brasil branch is
  // decided inside the fetch effect using current `view` state.
  const openFieldDrill = useCallback((campo: string) => {
    // Close installation drill first (mutual exclusivity)
    setDrillInstalacao(null);
    setDrillInstalacaoTimeseries([]);
    setDrillInstalacaoKpiSeries([]);
    setDrillInstalacaoError(null);
    // Reset the drill-popup tab state so each fresh open lands on
    // "production" with both sub-toggles in their default position and no
    // stale BSW/Depletion caches from a previous field.
    setDrillTabState("production");
    setDrillBswModeState("field");
    setDrillDepletionModeState("field");
    setDrillBswWellPoints(null);
    setDrillBswFieldPoints(null);
    setDrillBswError(null);
    setDrillBswLoading(false);
    setDrillDepletionWellPoints(null);
    setDrillDepletionFieldPoints(null);
    setDrillDepletionError(null);
    setDrillDepletionLoading(false);
    // Round 16: clear the KPI series so re-opening a different field doesn't
    // flash the previous field's KPI numbers between the close and the next
    // fetch landing.
    setDrillKpiSeries([]);
    setDrillCampo(campo);
  }, []);
  const closeFieldDrill = useCallback(() => {
    setDrillCampo(null);
    setDrillTimeseries([]);
    setDrillKpiSeries([]);
    setDrillError(null);
    // Clear the tab caches too so re-opening doesn't briefly flash stale data.
    setDrillBswWellPoints(null);
    setDrillBswFieldPoints(null);
    setDrillBswError(null);
    setDrillDepletionWellPoints(null);
    setDrillDepletionFieldPoints(null);
    setDrillDepletionError(null);
  }, []);

  // ── Drill popup: background prefetch on open ──────────────────────────────
  //
  // When the user clicks a field row the modal opens on the Production tab
  // (which renders immediately from a cheap timeseries RPC). The BSW and
  // Depletion tabs, by contrast, used to wait until the user clicked them
  // before firing — meaning a hop to "BSW" would land on an empty BarrelLoading
  // for the full RPC duration (29s on cold canonical paths before P1's index
  // work, ~3s after).
  //
  // The prefetch effect below fires the two FIELD-mode RPCs in parallel as
  // soon as `drillCampo` flips from null → string. We REUSE the existing
  // loading flags so:
  //   • If the user switches to BSW/Depletion mid-prefetch, the tab's
  //     skeleton picks up the same `drillBswLoading=true` and renders the
  //     descriptive skeleton — they never see an empty `BarrelLoading`.
  //   • If the prefetch finishes BEFORE the user switches tabs, the data is
  //     cached and the tab paints instantly (loading stays false because the
  //     lazy-fetch effects below early-return when the cache is non-null).
  //
  // We deliberately DO NOT prefetch the per-well variants — those are heavy
  // (~7000 rows on big campos) and only matter when the user explicitly
  // toggles "Per well" inside the tab.
  //
  // Cancellation: a single AbortController-style flag survives until either
  // (a) the user closes the modal, (b) opens a different field, or (c) the
  // hook unmounts. The lazy-fetch effects below stay authoritative — they
  // only fire if the cache is still `null` when the user actually opens the
  // tab, so a cancelled prefetch followed by a tab click degrades to the
  // pre-prefetch behaviour (load on click) without any race condition.
  useEffect(() => {
    if (!supabase || !drillCampo) return;
    // If we somehow re-mount with caches already populated (StrictMode double
    // invoke in dev, or a future hot-reload path), skip — both effects below
    // are idempotent.
    if (drillBswFieldPoints !== null && drillDepletionFieldPoints !== null) return;

    let cancelled = false;
    // Pre-flip both loading flags so any race where the user clicks the tab
    // BEFORE this microtask's await lands also sees `loading=true` and
    // renders the skeleton (instead of briefly flashing an empty chart).
    if (drillBswFieldPoints === null) setDrillBswLoading(true);
    if (drillDepletionFieldPoints === null) setDrillDepletionLoading(true);

    (async () => {
      const bswPromise = drillBswFieldPoints === null
        ? rpcGetAnpCdpBswFieldAggregateCanonical(supabase, [drillCampo])
            .then((rows) => {
              if (cancelled) return;
              setDrillBswFieldPoints(rows);
            })
            .catch((e) => {
              if (cancelled) return;
              console.error("Drill BSW prefetch failed", e);
              setDrillBswError(e instanceof Error ? e.message : String(e));
              setDrillBswFieldPoints([]);
            })
            .finally(() => {
              if (cancelled) return;
              setDrillBswLoading(false);
            })
        : Promise.resolve();

      const depletionPromise = drillDepletionFieldPoints === null
        ? rpcGetAnpCdpDepletionFieldAggregateCanonical(supabase, [drillCampo])
            .then((rows) => {
              if (cancelled) return;
              setDrillDepletionFieldPoints(rows);
            })
            .catch((e) => {
              if (cancelled) return;
              console.error("Drill Depletion prefetch failed", e);
              setDrillDepletionError(e instanceof Error ? e.message : String(e));
              setDrillDepletionFieldPoints([]);
            })
            .finally(() => {
              if (cancelled) return;
              setDrillDepletionLoading(false);
            })
        : Promise.resolve();

      await Promise.allSettled([bswPromise, depletionPromise]);
    })();

    return () => {
      cancelled = true;
      // Important: we don't clear the loading flags on cleanup. If the user
      // closed the drill, the close handler already clears caches + we'll
      // get a fresh prefetch on the next open. If the user just hopped to
      // a different field, the new effect run flips the loading flags itself.
    };
    // We INTENTIONALLY exclude `drillBswFieldPoints` / `drillDepletionFieldPoints`
    // from the deps array — otherwise this effect would re-fire on its own
    // setState calls and cancel itself. The cache-null check above guards
    // against duplicate work; running once per `drillCampo` change is the
    // contract we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, drillCampo]);

  // Imperative hover-prefetch handlers (bonus). Cheap to call repeatedly —
  // they early-return when the cache is already populated (or pending). The
  // background prefetch effect above means most users never trigger these
  // (the data lands before they hover); they're a belt-and-suspenders for
  // (a) sessions where the prefetch is somehow cancelled before resolving
  // and (b) cases where the user lingers on the modal long enough that the
  // network slowed below 1 RTT — hovering primes the cache without making
  // them commit to a click.
  const prefetchBswField = useCallback(() => {
    if (!supabase || !drillCampo) return;
    if (drillBswFieldPoints !== null) return;
    if (drillBswLoading) return; // already in flight
    setDrillBswLoading(true);
    (async () => {
      try {
        const rows = await rpcGetAnpCdpBswFieldAggregateCanonical(supabase, [drillCampo]);
        setDrillBswFieldPoints(rows);
      } catch (e) {
        console.error("Drill BSW hover-prefetch failed", e);
        setDrillBswError(e instanceof Error ? e.message : String(e));
        setDrillBswFieldPoints([]);
      } finally {
        setDrillBswLoading(false);
      }
    })();
  }, [supabase, drillCampo, drillBswFieldPoints, drillBswLoading]);

  const prefetchDepletionField = useCallback(() => {
    if (!supabase || !drillCampo) return;
    if (drillDepletionFieldPoints !== null) return;
    if (drillDepletionLoading) return;
    setDrillDepletionLoading(true);
    (async () => {
      try {
        const rows = await rpcGetAnpCdpDepletionFieldAggregateCanonical(supabase, [drillCampo]);
        setDrillDepletionFieldPoints(rows);
      } catch (e) {
        console.error("Drill Depletion hover-prefetch failed", e);
        setDrillDepletionError(e instanceof Error ? e.message : String(e));
        setDrillDepletionFieldPoints([]);
      } finally {
        setDrillDepletionLoading(false);
      }
    })();
  }, [supabase, drillCampo, drillDepletionFieldPoints, drillDepletionLoading]);

  useEffect(() => {
    if (!supabase || !drillCampo || !dateRange[0] || !dateRange[1]) return;
    // Brazil drill needs only campo+dates; company drill also needs empresa.
    if (viewIsCompany && !viewEmpresa) return;

    let cancelled = false;
    setDrillLoading(true);
    setDrillError(null);
    (async () => {
      try {
        const rows = view === "Brasil"
          ? await rpcGetProductionBrazilFieldTimeseries(
              supabase,
              drillCampo,
              dateRange[0],
              dateRange[1],
            )
          : await rpcGetProductionFieldTimeseries(
              supabase,
              drillCampo,
              viewEmpresa as string,
              dateRange[0],
              dateRange[1],
            );
        if (!cancelled) setDrillTimeseries(rows);
      } catch (e) {
        if (!cancelled) {
          console.error("Field drill timeseries refetch failed", e);
          setDrillError(e instanceof Error ? e.message : String(e));
          setDrillTimeseries([]);
        }
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, drillCampo, view, viewIsCompany, viewEmpresa, dateRange]);

  // ── KPI-table series (Round 16, 2026-05-28) ──────────────────────────────
  //
  // The drill popup's KPI table needs three reference points (current month,
  // previous month, and same month one year ago) regardless of the dashboard's
  // active period preset. When the user selected "Last 12M" the same month a
  // year ago falls OUTSIDE the chart's window — but the table must still show
  // it.
  //
  // Solution: a second fetch anchored to `latestMonth` (most recent month in
  // `anp_cdp_producao`) with a fixed 14-month lookback. 14 months covers the
  // worst case (current month + 13 months back includes the same month one
  // year prior with one month of slack) and stays bounded in size — the RPC
  // returns one row per (year, month), so the response is ~14 rows max.
  //
  // The chart still reads `drillTimeseries` (period-filtered). The KPI table
  // reads from `drillKpiSeries` exclusively. Both share the same RPC; the
  // payloads cost ~the same on Brasil-wide drills and a small extra on
  // company drills where the JOIN dominates.
  //
  // Re-fetches when `drillCampo`, `view`, or `latestMonth` changes. Does NOT
  // depend on `dateRange` — that's the whole point.
  useEffect(() => {
    if (!supabase || !drillCampo || !latestMonth) return;
    if (viewIsCompany && !viewEmpresa) return;

    const kpiEnd = latestMonth;
    const kpiStart = shiftMonth(latestMonth, -13);

    let cancelled = false;
    (async () => {
      try {
        const rows = view === "Brasil"
          ? await rpcGetProductionBrazilFieldTimeseries(
              supabase,
              drillCampo,
              kpiStart,
              kpiEnd,
            )
          : await rpcGetProductionFieldTimeseries(
              supabase,
              drillCampo,
              viewEmpresa as string,
              kpiStart,
              kpiEnd,
            );
        if (!cancelled) setDrillKpiSeries(rows);
      } catch (e) {
        // Errors here are non-fatal — the table simply shows em-dashes. The
        // chart-driving `drillError` already surfaces RPC failures to the UI.
        if (!cancelled) {
          console.error("Field drill KPI series refetch failed", e);
          setDrillKpiSeries([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, drillCampo, view, viewIsCompany, viewEmpresa, latestMonth]);

  // ── Drill popup: BSW tab lazy-fetch ──────────────────────────────────────
  //
  // Phase 2 of /well-by-well drill enrichment. The BSW tab reuses the
  // `/anp-cdp-bsw` chart builders and the canonical-aware RPC variants added
  // in migration 20260530000000. Cached per (drillCampo × sub-mode); switching
  // sub-mode within the same tab fetches only the missing dataset.
  //
  // Key contract details (per CTO spec):
  //  • The dashboard's period slider is NOT applied — BSW/Depletion are
  //    lifecycle analyses, not period-windowed. The RPCs return the full
  //    history for the canonical-expanded campo group.
  //  • Fetch only fires when (a) the drill is open, (b) the active tab is BSW
  //    and (c) the cache for the current sub-mode is null. Switching tabs
  //    without changing campo does NOT clear caches — re-entry is free.
  //  • Errors and loading are shared across sub-modes for simplicity.
  // Avoid putting the loading flag in the deps array — toggling it inside the
  // effect would cancel the in-flight fetch via the cleanup function and the
  // resolved setState calls would no-op (`cancelled=true`), leaving the UI
  // stuck on BarrelLoading forever. Same reason React StrictMode's
  // double-render is harmless: the cleanup of the FIRST invocation cancels its
  // own fetch, but the SECOND invocation fires a fresh one whose `cancelled`
  // stays false through to completion.
  useEffect(() => {
    if (!supabase || !drillCampo) return;
    if (drillTab !== "bsw") return;
    // Skip if the data for the active sub-mode is already cached.
    if (drillBswMode === "well"  && drillBswWellPoints  !== null) return;
    if (drillBswMode === "field" && drillBswFieldPoints !== null) return;

    let cancelled = false;
    setDrillBswLoading(true);
    setDrillBswError(null);
    (async () => {
      try {
        if (drillBswMode === "well") {
          const rows = await rpcGetAnpCdpBswScatterCanonical(supabase, [drillCampo]);
          if (!cancelled) setDrillBswWellPoints(rows);
        } else {
          const rows = await rpcGetAnpCdpBswFieldAggregateCanonical(supabase, [drillCampo]);
          if (!cancelled) setDrillBswFieldPoints(rows);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Drill BSW fetch failed", e);
          setDrillBswError(e instanceof Error ? e.message : String(e));
          if (drillBswMode === "well") setDrillBswWellPoints([]);
          else setDrillBswFieldPoints([]);
        }
      } finally {
        if (!cancelled) setDrillBswLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, drillCampo, drillTab, drillBswMode, drillBswWellPoints, drillBswFieldPoints]);

  // ── Drill popup: Depletion tab lazy-fetch ────────────────────────────────
  // Mirrors the BSW effect exactly, swapping in the depletion RPCs.
  useEffect(() => {
    if (!supabase || !drillCampo) return;
    if (drillTab !== "depletion") return;
    if (drillDepletionMode === "well"  && drillDepletionWellPoints  !== null) return;
    if (drillDepletionMode === "field" && drillDepletionFieldPoints !== null) return;

    let cancelled = false;
    setDrillDepletionLoading(true);
    setDrillDepletionError(null);
    (async () => {
      try {
        if (drillDepletionMode === "well") {
          const rows = await rpcGetAnpCdpDepletionScatterCanonical(supabase, [drillCampo]);
          if (!cancelled) setDrillDepletionWellPoints(rows);
        } else {
          const rows = await rpcGetAnpCdpDepletionFieldAggregateCanonical(supabase, [drillCampo]);
          if (!cancelled) setDrillDepletionFieldPoints(rows);
        }
      } catch (e) {
        if (!cancelled) {
          console.error("Drill Depletion fetch failed", e);
          setDrillDepletionError(e instanceof Error ? e.message : String(e));
          if (drillDepletionMode === "well") setDrillDepletionWellPoints([]);
          else setDrillDepletionFieldPoints([]);
        }
      } finally {
        if (!cancelled) setDrillDepletionLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, drillCampo, drillTab, drillDepletionMode, drillDepletionWellPoints, drillDepletionFieldPoints]);

  // ── Installation drill-down: open / close handlers + reactive fetch ───────
  //
  // Brasil view → get_production_brazil_installation_timeseries(instalacao, ...)
  // Company view → get_production_installation_timeseries(instalacao, empresa, ...)
  //
  // Mirrors the field drill exactly.
  const openInstallationDrill = useCallback((instalacao: string) => {
    // Close field drill first (mutual exclusivity)
    setDrillCampo(null);
    setDrillTimeseries([]);
    setDrillKpiSeries([]);
    setDrillError(null);
    // Clear stale installation KPI rows from a previous drill.
    setDrillInstalacaoKpiSeries([]);
    setDrillInstalacao(instalacao);
  }, []);
  const closeInstallationDrill = useCallback(() => {
    setDrillInstalacao(null);
    setDrillInstalacaoTimeseries([]);
    setDrillInstalacaoKpiSeries([]);
    setDrillInstalacaoError(null);
  }, []);

  useEffect(() => {
    if (!supabase || !drillInstalacao || !dateRange[0] || !dateRange[1]) return;
    if (viewIsCompany && !viewEmpresa) return;

    let cancelled = false;
    setDrillInstalacaoLoading(true);
    setDrillInstalacaoError(null);
    (async () => {
      try {
        const rows = view === "Brasil"
          ? await rpcGetProductionBrazilInstallationTimeseries(
              supabase,
              drillInstalacao,
              dateRange[0],
              dateRange[1],
            )
          : await rpcGetProductionInstallationTimeseries(
              supabase,
              drillInstalacao,
              viewEmpresa as string,
              dateRange[0],
              dateRange[1],
            );
        if (!cancelled) setDrillInstalacaoTimeseries(rows);
      } catch (e) {
        if (!cancelled) {
          console.error("Installation drill timeseries refetch failed", e);
          setDrillInstalacaoError(e instanceof Error ? e.message : String(e));
          setDrillInstalacaoTimeseries([]);
        }
      } finally {
        if (!cancelled) setDrillInstalacaoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, drillInstalacao, view, viewIsCompany, viewEmpresa, dateRange]);

  // ── Installation KPI-table series (Round 16, 2026-05-28) ────────────────
  //
  // Mirror of the field KPI effect — fetches a 14-month window ending at
  // `latestMonth` (independent of the dashboard's period filter) so the
  // installation drill modal can render the same 5-column KPI table.
  useEffect(() => {
    if (!supabase || !drillInstalacao || !latestMonth) return;
    if (viewIsCompany && !viewEmpresa) return;

    const kpiEnd = latestMonth;
    const kpiStart = shiftMonth(latestMonth, -13);

    let cancelled = false;
    (async () => {
      try {
        const rows = view === "Brasil"
          ? await rpcGetProductionBrazilInstallationTimeseries(
              supabase,
              drillInstalacao,
              kpiStart,
              kpiEnd,
            )
          : await rpcGetProductionInstallationTimeseries(
              supabase,
              drillInstalacao,
              viewEmpresa as string,
              kpiStart,
              kpiEnd,
            );
        if (!cancelled) setDrillInstalacaoKpiSeries(rows);
      } catch (e) {
        if (!cancelled) {
          console.error("Installation drill KPI series refetch failed", e);
          setDrillInstalacaoKpiSeries([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, drillInstalacao, view, viewIsCompany, viewEmpresa, latestMonth]);

  // ── Drill close on view change (avoid mismatched header label) ────────────
  //
  // If a drill modal is open and the user switches the pill, the title
  // currently shown ("BÚZIOS — Petrobras") would not match the new fetched
  // data (Brasil-wide). Auto-close on view change to force re-entry.
  useEffect(() => {
    setDrillCampo(null);
    setDrillTimeseries([]);
    setDrillKpiSeries([]);
    setDrillError(null);
    setDrillInstalacao(null);
    setDrillInstalacaoTimeseries([]);
    setDrillInstalacaoKpiSeries([]);
    setDrillInstalacaoError(null);
    // Reset the popup tab state too (cleared caches force a fresh fetch when
    // the user re-opens a drill after switching pills).
    setDrillTabState("production");
    setDrillBswModeState("field");
    setDrillDepletionModeState("field");
    setDrillBswWellPoints(null);
    setDrillBswFieldPoints(null);
    setDrillBswError(null);
    setDrillBswLoading(false);
    setDrillDepletionWellPoints(null);
    setDrillDepletionFieldPoints(null);
    setDrillDepletionError(null);
    setDrillDepletionLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Field-drill KPI table (period-independent — see drillKpiSeries fetch).
  const drillKpiTable = useMemo(
    () => buildKpiTable(drillKpiSeries),
    [drillKpiSeries],
  );

  // Installation-drill KPI table — same builder, different source series.
  const drillInstalacaoKpiTable = useMemo(
    () => buildKpiTable(drillInstalacaoKpiSeries),
    [drillInstalacaoKpiSeries],
  );

  // ── Export (Tier 1, multi-sheet XLSX + zip-of-CSVs) ───────────────────────
  //
  // Excel: in Brasil view → 3 sheets (Brazil aggregate / Top Fields / FPSOs).
  //        In company view → 4 sheets (Brazil + Company aggregate + Top
  //        Fields + FPSOs) for context.
  //
  // CSV: same datasets, one CSV per dataset, bundled in a zip.

  const handleExportExcel = useCallback(async () => {
    setExcelLoading(true);
    try {
      // Defer ExcelJS to keep the initial bundle slim. Import as both runtime
      // value (default) and type-only namespace (for CellValue) — Next.js
      // bundler handles the split.
      const ExcelJSModule = await import("exceljs");
      type CellValue = import("exceljs").CellValue;
      const ExcelJS = ExcelJSModule.default;
      const wb = new ExcelJS.Workbook();

      const writeSheet = <T>(
        name: string,
        rows: T[],
        columns: { key: keyof T; header: string; format?: string }[],
      ) => {
        const ws = wb.addWorksheet(name);
        ws.views = [{ showGridLines: false }];

        // Header row
        const hRow = ws.getRow(1);
        columns.forEach((c, i) => {
          const cell = ws.getCell(1, i + 1);
          cell.value = c.header;
          cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF000512" },
          };
          cell.alignment = { horizontal: i === 0 ? "left" : "center" };
          ws.getColumn(i + 1).width = Math.max(c.header.length + 2, 14);
        });
        hRow.height = 16;

        // Data rows
        rows.forEach((r, ri) => {
          const dRow = ws.getRow(ri + 2);
          dRow.height = 14;
          columns.forEach((c, ci) => {
            const cell = ws.getCell(ri + 2, ci + 1);
            const v = r[c.key];
            cell.value = (v === undefined ? null : (v as unknown)) as CellValue;
            cell.font = { name: "Arial", size: 10, color: { argb: "FF1A1A1A" } };
            if (c.format) cell.numFmt = c.format;
            cell.alignment = { horizontal: ci === 0 ? "left" : "center" };
          });
        });
      };

      writeSheet("Brazil", brazilData, [
        { key: "ano",           header: "Year" },
        { key: "mes",           header: "Month" },
        { key: "ambiente",      header: "Environment" },
        { key: "oil_bbl_dia",   header: "Oil (bbl/day)",   format: "#,##0.0" },
        { key: "gas_mm3_dia",   header: "Gas (Mm³/day)",   format: "#,##0.000" },
        { key: "water_bbl_dia", header: "Water (bbl/day)", format: "#,##0.0" },
        { key: "hours_rate",    header: "Hours rate",      format: "0.000" },
      ]);

      if (viewIsCompany && viewEmpresa) {
        writeSheet(viewEmpresa.slice(0, 28), companyData, [
          { key: "ano",           header: "Year" },
          { key: "mes",           header: "Month" },
          { key: "ambiente",      header: "Environment" },
          { key: "oil_bbl_dia",   header: "Oil (bbl/day, stake-weighted)",   format: "#,##0.0" },
          { key: "gas_mm3_dia",   header: "Gas (Mm³/day, stake-weighted)",   format: "#,##0.000" },
          { key: "water_bbl_dia", header: "Water (bbl/day, stake-weighted)", format: "#,##0.0" },
        ]);
      }

      writeSheet("Top Fields", topFields, [
        { key: "campo",         header: "Field" },
        { key: "oil_bbl_dia",   header: "Oil (bbl/day)",   format: "#,##0.0" },
        { key: "water_bbl_dia", header: "Water (bbl/day)", format: "#,##0.0" },
        { key: "hours_rate",    header: "Hours rate",      format: "0.000" },
        { key: "stake_pct",     header: "Stake (%)",       format: "0.00" },
      ]);

      writeSheet("Installations", installations, [
        { key: "instalacao",  header: "Installation" },
        { key: "oil_bbl_dia", header: "Oil (bbl/day)",   format: "#,##0.0" },
        { key: "gas_mm3_dia", header: "Gas (Mm³/day)",   format: "#,##0.000" },
        { key: "hours_rate",  header: "Hours rate",      format: "0.000" },
      ]);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);
      a.href = url;
      a.download = `Production ${view} ${dd}-${mm}-${yy}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("/well-by-well Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [brazilData, companyData, topFields, installations, view, viewIsCompany, viewEmpresa]);

  const handleExportCsv = useCallback(async () => {
    setCsvLoading(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const rowsToCsv = <T>(
        rows: T[],
        columns: (keyof T)[],
      ): string => {
        const escape = (v: unknown): string => {
          const s = v == null ? "" : String(v);
          return `"${s.replaceAll('"', '""')}"`;
        };
        const lines = [columns.map((c) => escape(String(c))).join(",")];
        for (const r of rows) {
          lines.push(columns.map((c) => escape(r[c])).join(","));
        }
        return lines.join("\n");
      };

      zip.file(
        "brazil_aggregate.csv",
        rowsToCsv(brazilData, [
          "ano", "mes", "ambiente", "oil_bbl_dia", "gas_mm3_dia", "water_bbl_dia", "hours_rate",
        ]),
      );
      if (viewIsCompany && viewEmpresa) {
        zip.file(
          `${viewEmpresa.replace(/\s+/g, "_").toLowerCase()}_aggregate.csv`,
          rowsToCsv(companyData, [
            "ano", "mes", "ambiente", "oil_bbl_dia", "gas_mm3_dia", "water_bbl_dia",
          ]),
        );
      }
      zip.file(
        "top_fields.csv",
        rowsToCsv(topFields, ["campo", "oil_bbl_dia", "water_bbl_dia", "hours_rate", "stake_pct"]),
      );
      zip.file(
        "installations.csv",
        rowsToCsv(installations, ["instalacao", "oil_bbl_dia", "gas_mm3_dia", "hours_rate"]),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);
      a.href = url;
      a.download = `Production ${view} ${dd}-${mm}-${yy}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("/well-by-well CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [brazilData, companyData, topFields, installations, view, viewIsCompany, viewEmpresa]);

  // ── Anything loading? ─────────────────────────────────────────────────────
  const anyLoading =
    brazilLoading || companyLoading || topFieldsLoading || installationsLoading || yoyLoading || headerLoading;

  // ── Partial-month flag ────────────────────────────────────────────────────
  // True only when the probe resolved, the latest month is NOT complete, AND
  // the status month matches `latestMonth`. The `month === latestMonth` guard
  // covers the rare lag where the MV behind the bootstrap probe and the base
  // table read by the status RPC disagree on the most recent month — without
  // it the banner could describe a month the charts aren't even showing.
  const latestMonthIsPartial =
    monthStatus != null && !monthStatus.isComplete && monthStatus.month === latestMonth;

  return {
    visible,
    visLoading,

    bootstrapping,
    latestMonth,

    monthStatus,
    latestMonthIsPartial,

    view,
    setView,
    isCompanyView: viewIsCompany,
    viewEmpresa,

    empresasList,
    empresa,
    setEmpresa,

    allMonths,
    dateRange,
    setDateRange,
    monthIdxRange,
    setMonthIdxRange,

    referenceDate,
    setReferenceDate,

    brazilData,
    companyData,
    topFields,
    installations,
    yoyTable,
    headerData,

    brazilLoading,
    companyLoading,
    topFieldsLoading,
    installationsLoading,
    yoyLoading,
    headerLoading,
    anyLoading,

    error,

    excelLoading,
    csvLoading,
    handleExportExcel,
    handleExportCsv,

    drillCampo,
    drillTimeseries,
    drillLoading,
    drillError,
    drillKpiTable,
    openFieldDrill,
    closeFieldDrill,

    drillInstalacao,
    drillInstalacaoTimeseries,
    drillInstalacaoLoading,
    drillInstalacaoError,
    drillInstalacaoKpiTable,
    openInstallationDrill,
    closeInstallationDrill,

    // Drill popup tabs (Phase 2)
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
  };
}

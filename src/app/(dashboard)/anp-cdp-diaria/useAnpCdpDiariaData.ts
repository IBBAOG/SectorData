"use client";

// ─── Single "brain" hook for /anp-cdp-diaria (dual-view pattern) ──────────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook. Neither View
// ever calls Supabase or derives metrics on its own. All filter state, fetch
// orchestration, unit conversions, ranking and export plumbing live here.
//
// Scope: daily petroleum / gas production sourced from the ANP Power BI feed
// at three levels of granularity:
//   • Field        — anp_cdp_diaria          (campos × bacias × day)
//   • Installation — anp_cdp_diaria_instalacao (campos × instalacoes × day)
//   • Well         — anp_cdp_diaria_poco     (campos × bacias × pocos × day)
//
// The hook exposes a unified `UnifiedRow[]` so chart/table builders are
// level-agnostic. Desktop View uses the full granularity toggle; mobile View
// renders Field-level only (per the "same analysis, adapted clothing"
// guideline — mobile is a focused tool, not a poly-modal dashboard).
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] / [mobile-only] with an explicit reason.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  COMMON_LAYOUT,
  AXIS_LINE,
  emptyPlot,
  PALETTE,
  BRAND_ORANGE,
} from "../../../lib/plotlyDefaults";
import { bblDiaToKbpd } from "../../../lib/units";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import {
  rpcGetAnpCdpDiariaFiltros,
  rpcGetAnpCdpDiariaSerie,
  rpcGetAnpCdpDiariaInstalacaoFiltros,
  rpcGetAnpCdpDiariaInstalacaoSerie,
  rpcGetAnpCdpDiariaPocoFiltros,
  rpcGetAnpCdpDiariaPocoSerie,
  rpcGetAnpCdpDiariaEmpresaSerie,
  rpcGetAnpCdpDiariaEmpresaCampos,
  type AnpCdpDiariaPonto,
  type AnpCdpDiariaInstalacaoPonto,
  type AnpCdpDiariaPocoPonto,
  type AnpCdpDiariaEmpresaSeriePonto,
  type AnpCdpDiariaEmpresaCampo,
} from "../../../lib/rpc";

// Re-export the company RPC types so Views import everything from the hook
// (single source of truth) rather than reaching into rpc.ts directly. The
// dynamic company-list type (`AnpCdpDiariaEmpresa`) is no longer re-exported —
// the company universe is fixed to FIXED_COMPANIES (Two-Tier Tabs IA).
export type {
  AnpCdpDiariaEmpresaSeriePonto,
  AnpCdpDiariaEmpresaCampo,
} from "../../../lib/rpc";

// ─── Constants ────────────────────────────────────────────────────────────────

// Chart colors come from the canonical identity palette — never hard-coded hex
// (docs/design/identity.md). PALETTE position 0 is navy (#1f2937); BRAND_ORANGE
// (#FF5000) sits at position 1. The "Company total" headline line is always
// pinned to BRAND_ORANGE, so per-field colors EXCLUDE orange (see
// COMPANY_FIELD_COLORS / companyFieldColorMap) to avoid colliding with the total
// line in the same chart. Re-exported here so both Views import their chart
// colors from the shared hook (single source of truth) and never invent a hex.
export { PALETTE, BRAND_ORANGE } from "../../../lib/plotlyDefaults";

export const TOP_N = 10;

/**
 * Company view (PRIO / Petrobras) collapses everything past the N largest
 * fields into a single "Others" bucket. Top N = the N biggest fields by net oil
 * average over the period (the canonical `orderCompanyFieldDims` order). A
 * company with ≤ N fields that carry daily data shows them all — no "Others"
 * bucket (e.g. PRIO has exactly 6). Only a company with > N fields (e.g.
 * Petrobras, 37) produces the Others bucket holding the remainder. The full
 * per-field breakdown lives in the "Explore raw data" tab.
 */
export const TOP_N_COMPANY = 6;

/** Trace / column / legend label for the collapsed "Others" bucket. */
export const OTHERS_LABEL = "Others";

/**
 * Neutral mid-grey for the "Others" bucket — the project's canonical Others
 * color (`#7F7F7F`, mirrors `COUNTRY_COLORS.Others` and PALETTE position 14 in
 * plotlyDefaults). Others is an aggregate of mixed-stake fields, so it never
 * borrows a field's PALETTE slot nor the brand orange (reserved for the
 * "Company total" headline line).
 */
export const OTHERS_COLOR = "#7F7F7F";

/**
 * The two fixed, primary companies (Two-Tier Tabs IA, 2026-06-05). The dynamic
 * company list (`get_anp_cdp_diaria_empresas`) was retired — only PRIO and
 * Petrobras are reachable, as prominent primary tabs. The order here is the
 * tab order; index 0 (PRIO) is the landing default.
 */
export const FIXED_COMPANIES = ["PRIO", "Petrobras"] as const;

/** Trace name used for the company-wide net production headline line. */
export const COMPANY_TOTAL_LABEL = "Company total";

export type Metric = "petroleo_bbl_dia" | "gas_mm3_dia";
export type Product = "oil" | "gas";
export type Granularity = "field" | "installation" | "well" | "company";

/** Unified row shape used by chart/table builders — level-agnostic. */
export interface UnifiedRow {
  data: string;
  campo: string;
  bacia: string | null;          // installation level has no bacia
  dimension: string;             // grouping key (campo | instalacao | poco)
  petroleo_bbl_dia: number | null;
  gas_mm3_dia: number | null;
}

/** Aggregate of a single dimension across the visible period. */
export interface DimensionAggregate {
  dimension: string;
  bacia: string | null;
  avgOil: number;   // avg bbl/day across days where the dimension reported
  avgGas: number;   // avg Mm³/day
  latestOil: number | null;
  latestGas: number | null;
  latestDate: string | null;
}

/** Per-field net aggregate for the Company level ranking/table. */
export interface CompanyFieldAggregate {
  campo: string;
  bacia: string | null;
  stakePct: number;
  avgOilNet: number;   // avg net bbl/day across reporting days
  avgGasNet: number;   // avg net Mm³/day
  latestOilNet: number | null;
  latestGasNet: number | null;
  latestDate: string | null;
}

/** A stake-held field with NO daily data yet (e.g. Wahoo for PRIO). */
export interface CompanyFieldNoData {
  campo: string;
  stakePct: number;
}

/** One stake-labeled field column header in the daily net-oil matrix. */
export interface CompanyDailyOilField {
  campo: string;
  stakePct: number;
  /** "PEREGRINO (80%)" — what the column header renders. */
  label: string;
  /**
   * True for the synthetic "Others" column (collapsed remainder past the top N).
   * It carries no single stake, so the header renders no "(stake%)". When set,
   * `othersFieldNames` lists the campos folded into it (for a native tooltip).
   */
  isOthers?: boolean;
  othersFieldNames?: string[];
}

/** One day-row in the daily net-oil matrix. */
export interface CompanyDailyOilMatrixRow {
  data: string;
  /** Net oil in **kbpd** (÷1000) keyed by field name; null = the field had no data that day. */
  values: Record<string, number | null>;
}

/**
 * Daily net-oil matrix for the Company level: fields × days. Columns are the
 * company's fields (stake-decorated label), ordered by the SAME canonical order
 * as the company charts (`orderCompanyFieldDims`, avg net oil desc). Rows are
 * one per calendar day present in the serie, sorted **descending** (most recent
 * first). Cell = the field's net oil for that day, already converted to kbpd.
 */
export interface CompanyDailyOilMatrix {
  fields: CompanyDailyOilField[];
  rows: CompanyDailyOilMatrixRow[];
}

/**
 * Monthly average net-oil-by-field, bucketed for the stacked bar. The value of
 * (month, field) is the field's net oil DAILY average over the days it reported
 * within that month: `sum(net oil that month) / (#reporting days that month)` —
 * the SAME "average over reporting days" methodology as `companyFieldAggregates`
 * and the "Net Oil (avg)" KPI, only bucketed per month. Values are in bbl/day
 * (display divides by 1000 to kbpd). The most recent month is naturally
 * month-to-date (the average only sees the days that exist so far); `partialMonth`
 * flags the bucket that should render as MtD (incomplete vs the calendar month).
 */
export interface CompanyMonthlyOilByField {
  /** Sorted "YYYY-MM" month keys (ascending). */
  months: string[];
  /**
   * Stack/legend order (stake-decorated labels), ordered by overall net-oil
   * average desc, already collapsed to the top N + a trailing "Others (N)"
   * label when the company has more than `TOP_N_COMPANY` fields.
   */
  fieldOrder: string[];
  /** valueByMonth[monthKey][bucketLabel] = avg net oil bbl/day that month. */
  valueByMonth: Record<string, Record<string, number>>;
  /** The "YYYY-MM" of the partial (month-to-date) bucket, or null if all complete. */
  partialMonth: string | null;
  /**
   * The full canonical field order BEFORE bucketing (all fields, net oil avg
   * desc). Used to color the top fields identically to the line chart; the
   * trailing "Others" trace ignores this and renders grey.
   */
  fullFieldOrder: string[];
  /** The "Others (N)" label present in `fieldOrder`, or null when no bucket. */
  othersBucketLabel: string | null;
}

// ─── Helpers (exported so Views can format consistently) ──────────────────────

export function metricForProduct(product: Product): Metric {
  return product === "oil" ? "petroleo_bbl_dia" : "gas_mm3_dia";
}

export function productLabel(product: Product): string {
  return product === "oil" ? "Oil" : "Gas";
}

export function productUnitLabel(product: Product): string {
  return product === "oil" ? "kbpd" : "Mm³/d";
}

export function fmtNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Format a stake % cleanly: 100.000 → "100%", 90.000 → "90%", 12.5 → "12.5%". */
export function formatStakePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(pct);
  return `${formatted}%`;
}

/** Field label decorated with the company's stake, e.g. "PEREGRINO (80%)". */
export function fieldLabelWithStake(campo: string, stakePct: number | null | undefined): string {
  return `${campo} (${formatStakePct(stakePct)})`;
}

/** Display value for a metric (bbl/day → kbpd for oil; gas already in Mm³/d). */
export function metricDisplay(value: number | null | undefined, metric: Metric): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (metric === "petroleo_bbl_dia") return bblDiaToKbpd(value);
  return value;
}

export function pickTopDimensions(
  rows: UnifiedRow[],
  metric: Metric,
  n: number,
): string[] {
  const sums: Record<string, { sum: number; cnt: number }> = {};
  for (const r of rows) {
    const v = r[metric];
    if (v == null) continue;
    if (!sums[r.dimension]) sums[r.dimension] = { sum: 0, cnt: 0 };
    sums[r.dimension].sum += v;
    sums[r.dimension].cnt += 1;
  }
  return Object.entries(sums)
    .map(([k, v]) => [k, v.cnt > 0 ? v.sum / v.cnt : 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

export function buildSerieChart(
  rows: UnifiedRow[],
  metric: Metric,
  dims: string[],
  unitLabel: string,
  height: number,
  scale: (v: number) => number = (v) => v,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => dims.includes(r.dimension) && r[metric] != null);
  if (!filtered.length) return emptyPlot(height);

  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    if (!agg[r.dimension]) agg[r.dimension] = {};
    const v = r[metric] ?? 0;
    agg[r.dimension][r.data] = (agg[r.dimension][r.data] ?? 0) + v;
  }

  const traces: PlotData[] = dims
    .filter(c => agg[c])
    .map((c, i) => {
      const entries = Object.entries(agg[c]).sort(([a], [b]) => a.localeCompare(b));
      return {
        type: "scatter", mode: "lines",
        name: c,
        x: entries.map(([d]) => d),
        y: entries.map(([, v]) => scale(v)),
        line: { width: 1.5, color: PALETTE[i % PALETTE.length] },
        hovertemplate: `${c}: %{y:,.1f} ${unitLabel}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: unitLabel } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

/**
 * Order a company's field labels by their NET average (descending) for a given
 * metric — the canonical legend order used by BOTH the company line chart and
 * the monthly stacked bar. Sharing this guarantees a field keeps the SAME
 * PALETTE slot (hence the SAME color) across both charts.
 */
export function orderCompanyFieldDims(rows: UnifiedRow[], metric: Metric): string[] {
  const agg: Record<string, { sum: number; cnt: number }> = {};
  for (const r of rows) {
    const v = r[metric];
    if (v == null) continue;
    if (!agg[r.dimension]) agg[r.dimension] = { sum: 0, cnt: 0 };
    agg[r.dimension].sum += v;
    agg[r.dimension].cnt += 1;
  }
  return Object.entries(agg)
    .map(([dim, v]) => [dim, v.cnt > 0 ? v.sum / v.cnt : 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .map(([dim]) => dim);
}

/**
 * Field color sequence for the company charts: the PALETTE with BRAND_ORANGE
 * removed. The company line chart always pins its "Company total" headline line
 * to BRAND_ORANGE (#FF5000) and renders it in the SAME chart as the field
 * traces, so no field may receive orange or it would collide with the total
 * line. We filter orange out of the sequence (rather than offsetting the index)
 * so the guarantee survives any future PALETTE reorder — the position of orange
 * in the array no longer matters. PALETTE pos 0 is now navy (#1f2937), a
 * legitimate field color here since the company chart has no fixed navy series.
 */
const COMPANY_FIELD_COLORS: string[] = PALETTE.filter((c) => c.toLowerCase() !== BRAND_ORANGE.toLowerCase());

/**
 * Canonical field → color map for a company's charts. `orderedDims` must come
 * from `orderCompanyFieldDims` so the i-th field gets the i-th color of
 * `COMPANY_FIELD_COLORS` (PALETTE minus BRAND_ORANGE). BRAND_ORANGE is excluded
 * because the "Company total" headline line is always orange and coexists in the
 * same line chart — a field colored orange would be indistinguishable from it.
 * Returned map is reused by both the line chart and the stacked bar (keyed on the
 * full canonical order) to keep each field's color identical across both charts.
 */
export function companyFieldColorMap(orderedDims: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  orderedDims.forEach((dim, i) => {
    map[dim] = COMPANY_FIELD_COLORS[i % COMPANY_FIELD_COLORS.length];
  });
  return map;
}

/**
 * Single source of truth for the company-view "top N + Others" split. Given the
 * canonically-ordered field list (from `orderCompanyFieldDims`, net oil avg
 * desc), the first `TOP_N_COMPANY` are kept verbatim and the rest collapse into
 * the "Others" bucket. When the company has ≤ `TOP_N_COMPANY` fields, `showOthers`
 * is false and every field stays itself (PRIO: 6 fields → no Others). The three
 * company surfaces (line chart, monthly stacked bar, daily matrix) all consume
 * THIS helper so their top-N membership and Others composition are identical by
 * construction — never re-derive the split inside a builder.
 */
export interface CompanyDisplayBuckets {
  /** The top fields, in canonical order (≤ TOP_N_COMPANY entries). */
  topFields: string[];
  /** The collapsed remainder (empty when showOthers is false). */
  othersFields: string[];
  /** True only when there are MORE than TOP_N_COMPANY fields. */
  showOthers: boolean;
}

export function companyDisplayBuckets(orderedFields: string[]): CompanyDisplayBuckets {
  const topFields    = orderedFields.slice(0, TOP_N_COMPANY);
  const othersFields = orderedFields.slice(TOP_N_COMPANY);
  return { topFields, othersFields, showOthers: othersFields.length > 0 };
}

/**
 * The "Others" legend/column label, suffixed with the count of collapsed fields
 * for clarity (e.g. "Others (31)"). No "(stake%)" — Others mixes stakes.
 */
export function othersLabel(othersCount: number): string {
  return `${OTHERS_LABEL} (${othersCount})`;
}

/**
 * Map one canonical field key to its display bucket: the field itself when it is
 * in the top set, otherwise the "Others" label. `topSet` is a Set of the top
 * field keys; `othersDisplayLabel` is the count-suffixed Others label so every
 * caller renders the exact same legend/column string.
 */
export function bucketOf(
  field: string,
  topSet: Set<string>,
  othersDisplayLabel: string,
): string {
  return topSet.has(field) ? field : othersDisplayLabel;
}

/**
 * THE single source of truth for the company view's "which 6 + Others" decision.
 *
 * Every company surface (net oil line chart, monthly stacked bar, daily net-oil
 * matrix, and the mobile "By Field — Net" ranking cap) derives its top-N
 * membership, Others composition, canonical order and per-field color FROM THIS
 * object — never by re-running `orderCompanyFieldDims` / `companyDisplayBuckets`
 * on its own. Changing the ranking metric or the cut here propagates to all four
 * surfaces by construction.
 *
 * The ranking metric is net oil average over reporting days (the company view is
 * oil-only), computed once via `orderCompanyFieldDims(…, "petroleo_bbl_dia")`.
 * The split is exposed in BOTH spaces:
 *  • label space (stake-decorated dimension, e.g. "BÚZIOS (100%)") — what the
 *    line chart, the stacked bar and the matrix column headers key on;
 *  • campo space (raw field name, e.g. "BÚZIOS") — what the matrix cells and the
 *    per-field aggregates / mobile cap key on.
 */
export interface CompanyBuckets {
  /** Canonical order — stake-decorated labels, net-oil avg desc. */
  orderedDims: string[];
  /** Canonical order resolved back to raw campo names (same order). */
  orderedCampos: string[];
  /** Top N labels (canonical order). */
  topFields: string[];
  /** Collapsed remainder labels (empty when showOthers is false). */
  othersFields: string[];
  /** True only when there are MORE than TOP_N_COMPANY fields. */
  showOthers: boolean;
  /** Membership set of the top labels. */
  topSet: Set<string>;
  /** Membership set of the top campos. */
  topCamposSet: Set<string>;
  /** Count-suffixed "Others (N)" label — meaningful only when showOthers. */
  othersDisp: string;
  /** Field → color map (canonical order; brand orange reserved for the total). */
  colorMap: Record<string, string>;
  /** Stake-decorated label → raw campo. */
  labelToCampo: Record<string, string>;
  /** Raw campo → stake-decorated label. */
  campoToLabel: Record<string, string>;
  /** Honest count of distinct fields with daily data (= top + others). */
  totalFieldCount: number;
}

/**
 * Compute the canonical company buckets once from the raw company net serie.
 * All company surfaces consume this — see `CompanyBuckets`.
 */
export function buildCompanyBuckets(
  rows: AnpCdpDiariaEmpresaSeriePonto[],
): CompanyBuckets {
  const unified = projectCompany(rows);

  // Canonical order = net oil avg over reporting days, desc.
  const orderedDims = orderCompanyFieldDims(unified, "petroleo_bbl_dia");
  const colorMap    = companyFieldColorMap(orderedDims);

  // label ↔ campo maps (the serie carries a single stake per field).
  const labelToCampo: Record<string, string> = {};
  const campoToLabel: Record<string, string> = {};
  for (const r of unified) {
    if (campoToLabel[r.campo] == null) {
      campoToLabel[r.campo] = r.dimension;
      labelToCampo[r.dimension] = r.campo;
    }
  }
  const orderedCampos = orderedDims
    .map(dim => labelToCampo[dim])
    .filter((c): c is string => c != null);

  // The one top-N + Others split (shared helper).
  const { topFields, othersFields, showOthers } = companyDisplayBuckets(orderedDims);
  const topSet       = new Set(topFields);
  const topCamposSet = new Set(topFields.map(l => labelToCampo[l]).filter((c): c is string => c != null));
  const othersDisp   = othersLabel(othersFields.length);

  return {
    orderedDims,
    orderedCampos,
    topFields,
    othersFields,
    showOthers,
    topSet,
    topCamposSet,
    othersDisp,
    colorMap,
    labelToCampo,
    campoToLabel,
    totalFieldCount: topFields.length + othersFields.length,
  };
}

/**
 * Company-level chart: a bold "Company total" net headline line (brand orange)
 * plus one thin net line per field. `rows` carries NET values already; the
 * dimension is the stake-decorated field label. `scale` converts to display
 * units (kbpd for oil, identity for gas).
 */
export function buildCompanyChart(
  rows: UnifiedRow[],
  metric: Metric,
  unitLabel: string,
  height: number,
  buckets: CompanyBuckets,
  scale: (v: number) => number = (v) => v,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows.filter(r => r[metric] != null);
  if (!filtered.length) return emptyPlot(height);

  // Order / color / top-N split all come from the shared `CompanyBuckets` — the
  // single source of truth for "which 6 + Others" across every company surface.
  const { topFields, showOthers, topSet, othersDisp, colorMap } = buckets;

  // Per-BUCKET aggregation: each field's daily value is summed into its bucket
  // (itself if top, else Others) so the Others line = the daily sum of the
  // collapsed fields.
  const agg: Record<string, Record<string, number>> = {};
  for (const r of filtered) {
    const bucket = bucketOf(r.dimension, topSet, othersDisp);
    if (!agg[bucket]) agg[bucket] = {};
    const v = r[metric] ?? 0;
    agg[bucket][r.data] = (agg[bucket][r.data] ?? 0) + v;
  }

  // Trace order: top fields (canonical), then Others last.
  const traceOrder = showOthers ? [...topFields, othersDisp] : topFields;

  // Headline total line.
  const total = buildCompanyTotalSeries(rows, metric);
  const totalTrace: PlotData = {
    type: "scatter", mode: "lines",
    name: COMPANY_TOTAL_LABEL,
    x: total.map(([d]) => d),
    y: total.map(([, v]) => scale(v)),
    line: { width: 2.6, color: BRAND_ORANGE },
    hovertemplate: `${COMPANY_TOTAL_LABEL}: %{y:,.1f} ${unitLabel}<extra></extra>`,
  } as PlotData;

  const fieldTraces: PlotData[] = traceOrder
    .filter(dim => agg[dim])
    .map((dim) => {
      const entries = Object.entries(agg[dim]).sort(([a], [b]) => a.localeCompare(b));
      // Others = neutral grey; top fields keep their shared-map color (orange
      // reserved for the total line).
      const color = dim === othersDisp ? OTHERS_COLOR : colorMap[dim];
      return {
        type: "scatter", mode: "lines",
        name: dim,
        x: entries.map(([d]) => d),
        y: entries.map(([, v]) => scale(v)),
        line: { width: 1.3, color },
        hovertemplate: `${dim}: %{y:,.1f} ${unitLabel}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: [totalTrace, ...fieldTraces],
    layout: {
      ...COMMON_LAYOUT,
      height,
      margin: { t: 10, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: unitLabel } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

/** Build a daily-date list between data_min/data_max for the slider. */
export function buildDateRange(min: string, max: string): string[] {
  const out: string[] = [];
  const start = new Date(min + "T00:00:00Z");
  const end   = new Date(max + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Granularity-aware projectors → UnifiedRow.
function projectField(rows: AnpCdpDiariaPonto[]): UnifiedRow[] {
  return rows.map(r => ({
    data: r.data,
    campo: r.campo,
    bacia: r.bacia,
    dimension: r.campo,
    petroleo_bbl_dia: r.petroleo_bbl_dia,
    gas_mm3_dia: r.gas_mm3_dia,
  }));
}
function projectInstallation(rows: AnpCdpDiariaInstalacaoPonto[]): UnifiedRow[] {
  return rows.map(r => ({
    data: r.data,
    campo: r.campo,
    bacia: null,
    dimension: r.instalacao,
    petroleo_bbl_dia: r.petroleo_bbl_dia,
    gas_mm3_dia: r.gas_mm3_dia,
  }));
}
function projectWell(rows: AnpCdpDiariaPocoPonto[]): UnifiedRow[] {
  return rows.map(r => ({
    data: r.data,
    campo: r.campo,
    bacia: r.bacia,
    dimension: r.poco,
    petroleo_bbl_dia: r.petroleo_bbl_dia,
    gas_mm3_dia: r.gas_mm3_dia,
  }));
}

/**
 * Project the company serie into UnifiedRow[] carrying NET values so the
 * existing chart/table builders work unchanged. `dimension` = field label
 * with the company's stake (e.g. "PEREGRINO (80%)"), so legend/ranking labels
 * read naturally. Production is line-agnostic from here on.
 */
function projectCompany(rows: AnpCdpDiariaEmpresaSeriePonto[]): UnifiedRow[] {
  return rows.map(r => ({
    data: r.data,
    campo: r.campo,
    bacia: r.bacia,
    dimension: fieldLabelWithStake(r.campo, r.stake_pct),
    petroleo_bbl_dia: r.petroleo_bbl_dia_net,
    gas_mm3_dia: r.gas_mm3_dia_net,
  }));
}

/**
 * Daily company-wide net total per metric — summed across all fields. Returns
 * a sorted [date, value] list ready to plot as the headline line.
 */
export function buildCompanyTotalSeries(
  rows: UnifiedRow[],
  metric: Metric,
): Array<[string, number]> {
  const byDay: Record<string, number> = {};
  for (const r of rows) {
    const v = r[metric];
    if (v == null) continue;
    byDay[r.data] = (byDay[r.data] ?? 0) + v;
  }
  return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Per-field net ranking/table for the Company level: avg + latest net,
 * carrying the stake %. Sorted by avg of the active product descending.
 */
export function buildCompanyFieldAggregates(
  rows: AnpCdpDiariaEmpresaSeriePonto[],
  product: Product,
): CompanyFieldAggregate[] {
  const byCampo: Record<string, {
    bacia: string | null;
    stakePct: number;
    oilSum: number; oilCnt: number;
    gasSum: number; gasCnt: number;
    latestDate: string | null;
    latestOilNet: number | null;
    latestGasNet: number | null;
  }> = {};

  for (const r of rows) {
    if (!byCampo[r.campo]) {
      byCampo[r.campo] = {
        bacia: r.bacia, stakePct: r.stake_pct,
        oilSum: 0, oilCnt: 0, gasSum: 0, gasCnt: 0,
        latestDate: null, latestOilNet: null, latestGasNet: null,
      };
    }
    const slot = byCampo[r.campo];
    if (r.petroleo_bbl_dia_net != null) { slot.oilSum += r.petroleo_bbl_dia_net; slot.oilCnt += 1; }
    if (r.gas_mm3_dia_net != null)      { slot.gasSum += r.gas_mm3_dia_net;      slot.gasCnt += 1; }
    if (slot.latestDate == null || r.data > slot.latestDate) {
      slot.latestDate   = r.data;
      slot.latestOilNet = r.petroleo_bbl_dia_net;
      slot.latestGasNet = r.gas_mm3_dia_net;
    }
  }

  return Object.entries(byCampo)
    .map(([campo, v]) => ({
      campo,
      bacia:        v.bacia,
      stakePct:     v.stakePct,
      avgOilNet:    v.oilCnt > 0 ? v.oilSum / v.oilCnt : 0,
      avgGasNet:    v.gasCnt > 0 ? v.gasSum / v.gasCnt : 0,
      latestOilNet: v.latestOilNet,
      latestGasNet: v.latestGasNet,
      latestDate:   v.latestDate,
    }))
    .sort((a, b) =>
      product === "oil" ? b.avgOilNet - a.avgOilNet : b.avgGasNet - a.avgGasNet,
    );
}

/**
 * Cap the per-field net aggregates to the top `TOP_N_COMPANY` and fold the rest
 * into a single "Others (N)" card — mirrors the top-N+Others collapse the
 * company charts/matrix apply, so the mobile "By Field — Net" ranking stays a
 * summary (the full breakdown is in "Explore raw data"). When the company has
 * ≤ `TOP_N_COMPANY` fields (e.g. PRIO = 6) the list is returned unchanged (no
 * Others card). The Others card sums the collapsed fields' net averages and
 * their latest-day net (on the most recent date any of them reported); it has no
 * single stake (`stakePct = NaN`) and no basin.
 *
 * The "which 6 + Others" decision is NOT re-derived here — it reuses the shared
 * `CompanyBuckets` (canonical campo order + top set), so the mobile ranking's
 * membership is identical by construction to the charts and the matrix.
 */
export function capCompanyFieldAggregates(
  aggs: CompanyFieldAggregate[],
  buckets: CompanyBuckets,
): CompanyFieldAggregate[] {
  // Order the aggregates by the shared canonical campo order, then partition via
  // the shared top set — no independent re-sort by avgOilNet.
  const byCampo = new Map(aggs.map(a => [a.campo, a]));
  const ordered = buckets.orderedCampos
    .map(c => byCampo.get(c))
    .filter((a): a is CompanyFieldAggregate => a != null);
  if (!buckets.showOthers) return ordered;

  const top    = ordered.filter(a => bucketOf(a.campo, buckets.topCamposSet, buckets.othersDisp) !== buckets.othersDisp);
  const others = ordered.filter(a => bucketOf(a.campo, buckets.topCamposSet, buckets.othersDisp) === buckets.othersDisp);

  // Sum avgs; latest = sum over the most recent date present among the others.
  const avgOilNet = others.reduce((s, f) => s + f.avgOilNet, 0);
  const avgGasNet = others.reduce((s, f) => s + f.avgGasNet, 0);
  const latestDate = others.reduce<string | null>(
    (mx, f) => (f.latestDate && (mx == null || f.latestDate > mx) ? f.latestDate : mx),
    null,
  );
  let latestOilNet: number | null = null;
  let latestGasNet: number | null = null;
  if (latestDate) {
    for (const f of others) {
      if (f.latestDate !== latestDate) continue;
      if (f.latestOilNet != null) latestOilNet = (latestOilNet ?? 0) + f.latestOilNet;
      if (f.latestGasNet != null) latestGasNet = (latestGasNet ?? 0) + f.latestGasNet;
    }
  }

  const othersCard: CompanyFieldAggregate = {
    campo:    buckets.othersDisp,   // shared "Others (N)" label — same string everywhere
    bacia:    null,
    stakePct: NaN,
    avgOilNet,
    avgGasNet,
    latestOilNet,
    latestGasNet,
    latestDate,
  };
  return [...top, othersCard];
}

/**
 * Daily net-oil matrix (fields × days) for the Company level. Columns are the
 * company's fields, ordered by `orderCompanyFieldDims` (avg net oil desc) so the
 * left-to-right column order matches the company charts' legend/stack order.
 * Each column header carries the stake ("PEREGRINO (80%)"). Rows are one per day
 * present in the serie, sorted descending (latest first); each cell is the
 * field's net oil for that day converted to **kbpd** (÷1000), or null when the
 * field reported nothing that day. Oil only — gas is excluded by design.
 */
export function buildCompanyDailyOilMatrix(
  rows: AnpCdpDiariaEmpresaSeriePonto[],
  buckets: CompanyBuckets,
): CompanyDailyOilMatrix {
  // Map each field (campo) to its stake + decorated label. The serie carries a
  // single stake per field, so first sighting wins.
  const fieldMeta: Record<string, CompanyDailyOilField> = {};
  // Net oil (kbpd) keyed by [date][campo].
  const cells: Record<string, Record<string, number>> = {};

  for (const r of rows) {
    if (!fieldMeta[r.campo]) {
      fieldMeta[r.campo] = {
        campo:    r.campo,
        stakePct: r.stake_pct,
        label:    fieldLabelWithStake(r.campo, r.stake_pct),
      };
    }
    if (r.petroleo_bbl_dia_net == null) continue;
    if (!cells[r.data]) cells[r.data] = {};
    // Sum defensively (the serie is 1 row per (data, campo), but be safe).
    cells[r.data][r.campo] =
      (cells[r.data][r.campo] ?? 0) + bblDiaToKbpd(r.petroleo_bbl_dia_net);
  }

  // Canonical column order + top-N split + Others composition all come from the
  // shared `CompanyBuckets` (single source of truth) — keyed in campo space here.
  const { orderedCampos, topCamposSet, showOthers, othersDisp } = buckets;
  const topCampos    = orderedCampos.filter(c => topCamposSet.has(c));
  const othersCampos = orderedCampos.filter(c => !topCamposSet.has(c));
  // Sentinel key used for the Others column (cannot collide — real campos never
  // contain " (N)" with a count suffix; defensive anyway).
  const OTHERS_KEY = othersDisp;

  const topFieldCols: CompanyDailyOilField[] = topCampos
    .map(c => fieldMeta[c])
    .filter((f): f is CompanyDailyOilField => f != null);
  const fields: CompanyDailyOilField[] = showOthers
    ? [
        ...topFieldCols,
        { campo: OTHERS_KEY, stakePct: NaN, label: othersDisp, isOthers: true, othersFieldNames: othersCampos },
      ]
    : topFieldCols;

  // One row per day, descending (latest first). Each field's daily net oil is
  // routed through the shared `bucketOf` (campo space): a top campo lands on
  // itself, everything else folds into the Others column.
  const days = Object.keys(cells).sort((a, b) => b.localeCompare(a));
  const matrixRows: CompanyDailyOilMatrixRow[] = days.map(data => {
    const values: Record<string, number | null> = {};
    for (const f of topFieldCols) {
      const v = cells[data]?.[f.campo];
      values[f.campo] = v == null ? null : v;
    }
    if (showOthers) {
      let othersSum = 0;
      let othersSeen = false;
      const dayCells = cells[data] ?? {};
      for (const [campo, v] of Object.entries(dayCells)) {
        if (bucketOf(campo, topCamposSet, OTHERS_KEY) !== OTHERS_KEY) continue;
        othersSum += v;
        othersSeen = true;
      }
      values[OTHERS_KEY] = othersSeen ? othersSum : null;
    }
    return { data, values };
  });

  return { fields, rows: matrixRows };
}

/** Last calendar day (1-31) of the given 0-based month/year (UTC-safe). */
function lastDayOfMonth(year: number, monthIndex0: number): number {
  // Day 0 of the next month = last day of this month.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Bucket the company net serie into monthly average net-oil-by-field for the
 * stacked bar. Per (month, field) value = `sum(net oil that month) / (#days the
 * field reported that month)` — the same "average over reporting days" rule as
 * the KPI / `companyFieldAggregates`, just per month. Values stay in bbl/day.
 *
 * The most recent month is intrinsically month-to-date (the average only sees
 * the days present so far). `partialMonth` is set to that month's key ONLY when
 * the latest `data` predates the calendar end of its month — so a fully-loaded
 * month (e.g. data ending 2026-05-31) yields `partialMonth = null` (no MtD
 * marker), while the first partial day of the next month flips it on.
 *
 * `fieldOrder` mirrors `orderCompanyFieldDims` (avg net oil desc) so the bar's
 * stack order and per-field color match the company line chart exactly.
 */
export function buildCompanyMonthlyOilByField(
  rows: AnpCdpDiariaEmpresaSeriePonto[],
  buckets: CompanyBuckets,
): CompanyMonthlyOilByField {
  // Accumulate per (month, field): running sum + day count.
  const acc: Record<string, Record<string, { sum: number; cnt: number }>> = {};
  let maxDate: string | null = null;

  for (const r of rows) {
    if (r.petroleo_bbl_dia_net == null) continue;
    const monthKey = r.data.slice(0, 7); // "YYYY-MM"
    const label    = fieldLabelWithStake(r.campo, r.stake_pct);
    if (!acc[monthKey]) acc[monthKey] = {};
    if (!acc[monthKey][label]) acc[monthKey][label] = { sum: 0, cnt: 0 };
    acc[monthKey][label].sum += r.petroleo_bbl_dia_net;
    acc[monthKey][label].cnt += 1;
    if (maxDate == null || r.data > maxDate) maxDate = r.data;
  }

  const months = Object.keys(acc).sort((a, b) => a.localeCompare(b));

  // Order / top-N split / Others composition all come from the shared
  // `CompanyBuckets` (single source of truth) — same membership as the line
  // chart and the daily matrix. The per-(month, field) DAILY AVERAGE collapses
  // by SUM across the Others fields — i.e. Others' stack segment is the sum of
  // the collapsed fields' per-month daily averages (so top6 + Others = the full
  // monthly total, and the on-bar total label stays the company total).
  const { orderedDims: fullFieldOrder, topFields, showOthers, topSet } = buckets;
  const othersBucketLabel = showOthers ? buckets.othersDisp : null;
  const fieldOrder        = othersBucketLabel ? [...topFields, othersBucketLabel] : topFields;

  // Compute daily average per (month, field), then fold into buckets via the
  // shared `bucketOf` (label space).
  const valueByMonth: Record<string, Record<string, number>> = {};
  for (const m of months) {
    valueByMonth[m] = {};
    for (const [label, v] of Object.entries(acc[m])) {
      const avg = v.cnt > 0 ? v.sum / v.cnt : 0;
      const bucket = othersBucketLabel ? bucketOf(label, topSet, othersBucketLabel) : label;
      valueByMonth[m][bucket] = (valueByMonth[m][bucket] ?? 0) + avg;
    }
  }

  // Detect the partial (month-to-date) bucket: the month of the max date, IF
  // that max date is before the calendar end of its month.
  let partialMonth: string | null = null;
  if (maxDate) {
    const [yy, mm, dd] = maxDate.split("-").map(Number);
    const lastDay = lastDayOfMonth(yy, mm - 1);
    if (dd < lastDay) partialMonth = maxDate.slice(0, 7);
  }

  return { months, fieldOrder, valueByMonth, partialMonth, fullFieldOrder, othersBucketLabel };
}

/** Format a "YYYY-MM" key as "Mon YYYY" (English short month). */
function formatMonthLabel(monthKey: string): string {
  const [yy, mm] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(yy, mm - 1, 1));
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${mon} ${yy}`;
}

/**
 * Stacked-bar chart of monthly average net oil by field (kbpd). One trace per
 * field (same color as the company line chart via `companyFieldColorMap`); the
 * total bar height = the company's monthly net average. The partial (MtD) month
 * renders with reduced marker opacity and a "(MtD)" tick + hover suffix.
 *
 * Each bar carries a **total label** on top (a `layout.annotations` entry per
 * month) — the stack height (= sum of the fields that month) in display kbpd,
 * pt-BR formatted (e.g. "160,7"). Since the bar IS the total, we annotate the
 * top rather than adding a duplicate "total" trace. The MtD month is NOT
 * suffixed in the label (the tick already shows "(MtD)").
 *
 * `scale` converts bbl/day → display units (kbpd via `bblDiaToKbpd`).
 * `labelFontSize` lets mobile shrink the on-bar total labels when 7 of them
 * would crowd a ~260px chart (desktop default 11).
 */
export function buildCompanyMonthlyOilStacked(
  monthly: CompanyMonthlyOilByField,
  height: number,
  scale: (v: number) => number = (v) => v,
  labelFontSize = 11,
): { data: PlotData[]; layout: Partial<Layout> } {
  const { months, fieldOrder, valueByMonth, partialMonth, fullFieldOrder, othersBucketLabel } = monthly;
  if (!months.length || !fieldOrder.length) return emptyPlot(height);

  // Color the top fields exactly like the line chart (keyed on the FULL
  // canonical order so a field keeps its slot whether or not Others exists);
  // the Others segment renders the neutral grey, never a field/brand color.
  const colorMap = companyFieldColorMap(fullFieldOrder);
  const tickText = months.map(m => (m === partialMonth ? `${formatMonthLabel(m)} (MtD)` : formatMonthLabel(m)));

  const traces: PlotData[] = fieldOrder.map((label) => {
    const y = months.map(m => scale(valueByMonth[m]?.[label] ?? 0));
    // Per-bar marker opacity: fade the partial (MtD) position to signal it.
    const opacities = months.map(m => (m === partialMonth ? 0.55 : 1));
    const customdata = months.map(m => (m === partialMonth ? " (month-to-date)" : ""));
    const color = label === othersBucketLabel ? OTHERS_COLOR : colorMap[label];
    return {
      type: "bar",
      name: label,
      x: months,
      y,
      marker: { color, opacity: opacities },
      customdata,
      hovertemplate: `${label}: %{y:,.1f} kbpd%{customdata}<extra></extra>`,
    } as unknown as PlotData;
  });

  // Per-month total = the stack height (sum of every field that month), in
  // display units. Rendered as a discreet label just above each bar's top.
  const monthTotals = months.map(m => {
    const fields = valueByMonth[m] ?? {};
    const sum = Object.values(fields).reduce((s, v) => s + v, 0);
    return scale(sum);
  });
  const annotations = months.map((m, i) => ({
    x: m,
    y: monthTotals[i],
    yshift: 8,                       // small gap above the bar top
    text: fmtNumber(monthTotals[i], 1),
    showarrow: false,
    font: { family: "Arial", size: labelFontSize, color: "#1a1a1a" },
    xanchor: "center" as const,
    yanchor: "bottom" as const,
  }));

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height,
      barmode: "stack",
      // Extra top margin so the on-bar total labels are not clipped.
      margin: { t: 28, b: 50, l: 80, r: 30 },
      hovermode: "x unified",
      annotations,
      yaxis: { ...AXIS_LINE, title: { text: "kbpd" } },
      xaxis: {
        ...AXIS_LINE,
        type: "category" as const,
        tickmode: "array" as const,
        tickvals: months,
        ticktext: tickText,
      },
      // `traceorder: "normal"` lists the legend in trace order (base→top of the
      // stack: BÚZIOS … Others) instead of Plotly's default reversed order for
      // stacked bars. This only changes the legend listing, not the stacking.
      legend: { orientation: "h", traceorder: "normal", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

/** Build the production ranking for the mobile data card list. */
export function buildRanking(rows: UnifiedRow[], product: Product): DimensionAggregate[] {
  const metric = metricForProduct(product);
  const byDim: Record<string, {
    sum: number;
    cnt: number;
    bacia: string | null;
    latestDate: string | null;
    latestOil: number | null;
    latestGas: number | null;
  }> = {};

  for (const r of rows) {
    const v = r[metric];
    if (!byDim[r.dimension]) {
      byDim[r.dimension] = {
        sum: 0, cnt: 0, bacia: r.bacia,
        latestDate: null, latestOil: null, latestGas: null,
      };
    }
    const slot = byDim[r.dimension];
    if (v != null) {
      slot.sum += v;
      slot.cnt += 1;
    }
    if (slot.latestDate == null || r.data > slot.latestDate) {
      slot.latestDate = r.data;
      slot.latestOil  = r.petroleo_bbl_dia;
      slot.latestGas  = r.gas_mm3_dia;
    }
  }

  return Object.entries(byDim)
    .map(([dimension, v]) => ({
      dimension,
      bacia: v.bacia,
      avgOil: 0,
      avgGas: 0,
      latestOil: v.latestOil,
      latestGas: v.latestGas,
      latestDate: v.latestDate,
      _sortKey: v.cnt > 0 ? v.sum / v.cnt : 0,
    }))
    .sort((a, b) => b._sortKey - a._sortKey)
    .map((entry) => {
      // Re-compute avgs from byDim (cleaner than tracking both metrics in the
      // loop above).
      const dimRows = rows.filter(r => r.dimension === entry.dimension);
      const oilVals = dimRows.map(r => r.petroleo_bbl_dia).filter((v): v is number => v != null);
      const gasVals = dimRows.map(r => r.gas_mm3_dia).filter((v): v is number => v != null);
      const avgOil  = oilVals.length ? oilVals.reduce((s, x) => s + x, 0) / oilVals.length : 0;
      const avgGas  = gasVals.length ? gasVals.reduce((s, x) => s + x, 0) / gasVals.length : 0;
      return {
        dimension:  entry.dimension,
        bacia:      entry.bacia,
        avgOil,
        avgGas,
        latestOil:  entry.latestOil,
        latestGas:  entry.latestGas,
        latestDate: entry.latestDate,
      };
    });
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseAnpCdpDiariaData {
  // Visibility / loading
  visible: boolean;
  visLoading: boolean;
  loading: boolean;
  serieLoading: boolean;

  // Granularity (desktop toggle; mobile pins to "field")
  granularity: Granularity;
  setGranularity: (g: Granularity) => void;

  // Filter universes
  campos: string[];
  instalacoes: string[];
  pocos: string[];

  // Period
  allDates: string[];
  dateRange: [number, number];
  setDateRange: (range: [number, number]) => void;
  hasDates: boolean;
  periodBadge: [string, string] | null;

  // User filter selections
  selectedCampos: string[];
  setSelectedCampos: (v: string[]) => void;
  selectedInstalacoes: string[];
  setSelectedInstalacoes: (v: string[]) => void;
  selectedPocos: string[];
  setSelectedPocos: (v: string[]) => void;

  // Product (mobile-first toggle Oil/Gas; desktop also reads via metric below)
  product: Product;
  setProduct: (p: Product) => void;

  // Rows (post-filter, level-agnostic)
  serieRows: UnifiedRow[];
  visibleRows: UnifiedRow[];

  // Explicit dimensions (per granularity)
  explicitDims: string[];

  // Charts (precomputed for both metrics)
  petroleoChart: { data: PlotData[]; layout: Partial<Layout> };
  gasChart: { data: PlotData[]; layout: Partial<Layout> };
  defaultPetroleoDims: string[];
  defaultGasDims: string[];

  // Recent-rows table
  tableRows: UnifiedRow[];

  // Ranking (used by mobile MobileDataCard list)
  ranking: DimensionAggregate[];

  // ── Company level (stake-weighted net production) ─────────────────────────
  // The company universe is fixed (FIXED_COMPANIES) — there is no dynamic
  // `empresas` list any more (Two-Tier Tabs IA, 2026-06-05).
  selectedEmpresa: string | null;
  setSelectedEmpresa: (e: string | null) => void;
  empresaCampos: AnpCdpDiariaEmpresaCampo[];
  companySerieRows: AnpCdpDiariaEmpresaSeriePonto[];
  /** Per-field net aggregates (mobile ranking cards), sorted by active product. */
  companyFieldAggregates: CompanyFieldAggregate[];
  /**
   * Honest count of distinct fields with daily data for the selected company
   * (PRIO → 6, Petrobras → 37) — NOT the capped top-6+Others length. Used by the
   * company chart subtitle so it never reads "7 fields" when there are 37.
   */
  companyFieldCount: number;
  /** Daily net-oil matrix (fields × days) for the desktop table. */
  companyDailyOilMatrix: CompanyDailyOilMatrix;
  /** Stake-held fields not yet in the daily feed (e.g. Wahoo for PRIO). */
  companyFieldsNoData: CompanyFieldNoData[];
  /** Company net oil line chart (headline total + per-field lines, kbpd). */
  companyPetroleoChart: { data: PlotData[]; layout: Partial<Layout> };
  /** Monthly average net-oil-by-field stacked bar (kbpd, MtD-aware). */
  companyMonthlyOilChart: { data: PlotData[]; layout: Partial<Layout> };

  // Labels per level
  dimLabel: { singular: string; plural: string; en: string };
  datasetKey: string;
  headerTitle: string;
  headerSub: string;

  // Export modal (Tier 2)
  exportOpen: boolean;
  setExportOpen: (v: boolean) => void;
  excelLoading: boolean;
  csvLoading: boolean;
  exportCampos: string[];
  setExportCampos: (v: string[]) => void;
  exportInstalacoes: string[];
  setExportInstalacoes: (v: string[]) => void;
  exportPocos: string[];
  setExportPocos: (v: string[]) => void;
  exportRange: [number, number];
  setExportRange: (v: [number, number]) => void;
  exportFilters: {
    campos: string[] | null;
    instalacoes: string[] | null;
    pocos: string[] | null;
    dataInicio: string | null;
    dataFim: string | null;
  };
  openExportModal: () => void;
  estimateExportRows: () => Promise<number>;
  handleExportExcel: () => Promise<void>;
  handleExportCsv: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnpCdpDiariaData(): UseAnpCdpDiariaData {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-diaria");
  const supabase = getSupabaseClient();

  // ── Granularity (Two-Tier Tabs IA, 2026-06-05) ────────────────────────────
  // Landing state is the PRIO company view — granularity starts at "company"
  // and selectedEmpresa at "PRIO" so the net serie fetches on mount with zero
  // clicks. The granular levels (field/installation/well) are lazily entered
  // only when the user opens the "Explore raw data" tab, so the heavy level
  // RPCs (especially the ~180k-row Well one) never fire on the landing.
  const [granularity, setGranularityState] = useState<Granularity>("company");

  // ── Loading ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);

  // ── Filter universes ──────────────────────────────────────────────────────
  const [campos, setCampos]             = useState<string[]>([]);
  const [instalacoes, setInstalacoes]   = useState<string[]>([]);
  const [pocos, setPocos]               = useState<string[]>([]);

  // ── Rows (unified shape) ──────────────────────────────────────────────────
  const [serieRows, setSerieRows] = useState<UnifiedRow[]>([]);

  // ── Period slider ─────────────────────────────────────────────────────────
  const [allDates, setAllDates] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[number, number]>([0, 0]);

  // ── Selections ────────────────────────────────────────────────────────────
  const [selectedCampos, setSelectedCampos]           = useState<string[]>([]);
  const [selectedInstalacoes, setSelectedInstalacoes] = useState<string[]>([]);
  const [selectedPocos, setSelectedPocos]             = useState<string[]>([]);

  // ── Product (Oil / Gas) — both Views read this ────────────────────────────
  const [product, setProduct] = useState<Product>("oil");

  // ── Company level (stake-weighted net) ────────────────────────────────────
  // selectedEmpresa initialises to the first fixed company (PRIO) so the
  // landing renders its net serie immediately (Two-Tier Tabs IA). The dynamic
  // `empresas` list is gone — the universe is FIXED_COMPANIES.
  const [selectedEmpresa, setSelectedEmpresa]   = useState<string | null>(FIXED_COMPANIES[0]);
  const [empresaCampos, setEmpresaCampos]       = useState<AnpCdpDiariaEmpresaCampo[]>([]);
  const [companySerieRows, setCompanySerieRows] = useState<AnpCdpDiariaEmpresaSeriePonto[]>([]);

  // ── Export modal state (Tier 2) ───────────────────────────────────────────
  const [exportOpen, setExportOpen]               = useState(false);
  const [excelLoading, setExcelLoading]           = useState(false);
  const [csvLoading, setCsvLoading]               = useState(false);
  const [exportCampos, setExportCampos]           = useState<string[]>([]);
  const [exportInstalacoes, setExportInstalacoes] = useState<string[]>([]);
  const [exportPocos, setExportPocos]             = useState<string[]>([]);
  const [exportRange, setExportRange]             = useState<[number, number]>([0, 0]);

  // Tracks if the user mounted at least once already — guards against the
  // granularity toggle wiping selections on the very first run.
  const initialMountRef = useRef(true);

  // Wrapper around setGranularity that resets selections so vocabularies don't
  // bleed across levels.
  const setGranularity = useCallback((g: Granularity) => {
    setGranularityState(g);
  }, []);

  // ── Granularity-aware loaders (initial + on toggle) ───────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);

    // Reset selections when switching levels (vocabularies differ). The
    // granular dimension selections always reset. Company selection only
    // resets when LEAVING company (new granularity ≠ company) — when entering
    // company (e.g. clicking the PRIO/Petrobras tab from Explore) the View has
    // just called setSelectedEmpresa(...) and we must not clobber it. This
    // effect depends only on [supabase, granularity], NOT selectedEmpresa, so
    // switching PRIO↔Petrobras (both granularity==="company") never re-runs it.
    if (!initialMountRef.current) {
      setSelectedCampos([]);
      setSelectedInstalacoes([]);
      setSelectedPocos([]);
      setSerieRows([]);
      if (granularity !== "company") {
        setSelectedEmpresa(null);
        setEmpresaCampos([]);
        setCompanySerieRows([]);
      }
    }

    (async () => {
      try {
        if (granularity === "field") {
          const f = await rpcGetAnpCdpDiariaFiltros(supabase);
          if (cancelled) return;
          setCampos(f.campos);
          setInstalacoes([]);
          setPocos([]);
          const dates = (f.data_min && f.data_max) ? buildDateRange(f.data_min, f.data_max) : [];
          setAllDates(dates);
          const lastIdx = Math.max(0, dates.length - 1);
          setDateRange([0, lastIdx]);
          setExportRange([0, lastIdx]);
          const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
            dataInicio: f.data_min ?? null,
            dataFim:    f.data_max ?? null,
          });
          if (!cancelled) setSerieRows(projectField(rows));
        } else if (granularity === "installation") {
          const f = await rpcGetAnpCdpDiariaInstalacaoFiltros(supabase);
          if (cancelled) return;
          setCampos(f.campos);
          setInstalacoes(f.instalacoes);
          setPocos([]);
          const dates = (f.data_min && f.data_max) ? buildDateRange(f.data_min, f.data_max) : [];
          setAllDates(dates);
          const lastIdx = Math.max(0, dates.length - 1);
          setDateRange([0, lastIdx]);
          setExportRange([0, lastIdx]);
          const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
            dataInicio: f.data_min ?? null,
            dataFim:    f.data_max ?? null,
          });
          if (!cancelled) setSerieRows(projectInstallation(rows));
        } else if (granularity === "well") {
          const f = await rpcGetAnpCdpDiariaPocoFiltros(supabase);
          if (cancelled) return;
          setCampos(f.campos);
          setInstalacoes([]);
          setPocos(f.pocos);
          const dates = (f.data_min && f.data_max) ? buildDateRange(f.data_min, f.data_max) : [];
          setAllDates(dates);
          const lastIdx = Math.max(0, dates.length - 1);
          setDateRange([0, lastIdx]);
          setExportRange([0, lastIdx]);
          const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
            dataInicio: f.data_min ?? null,
            dataFim:    f.data_max ?? null,
          });
          if (!cancelled) setSerieRows(projectWell(rows));
        } else {
          // Company level — populate only the date universe. The company list
          // is fixed (FIXED_COMPANIES), so no dynamic empresas fetch. The
          // actual net serie is fetched once an empresa is selected (see the
          // company serie effect below; PRIO is selected by default on mount).
          // The daily feed shares the same date range as the Field level, so
          // reuse get_anp_cdp_diaria_filtros.
          const f = await rpcGetAnpCdpDiariaFiltros(supabase);
          if (cancelled) return;
          setCampos([]);
          setInstalacoes([]);
          setPocos([]);
          setSerieRows([]);
          const dates = (f.data_min && f.data_max) ? buildDateRange(f.data_min, f.data_max) : [];
          setAllDates(dates);
          const lastIdx = Math.max(0, dates.length - 1);
          setDateRange([0, lastIdx]);
          setExportRange([0, lastIdx]);
        }
      } catch (e) {
        console.error("ANP CDP Diária initial load failed", e);
      } finally {
        if (!cancelled) {
          setLoading(false);
          initialMountRef.current = false;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, granularity]);

  // ── Reactive serie fetch (debounced 400ms) ────────────────────────────────
  // Only period triggers refetch at Field/Well levels (Basin filter removed).
  // At Installation level, campo selection also triggers refetch. Dimension
  // filter (campo at Field, instalacao at Install, poco at Well) stays
  // client-side so Top-N defaults remain stable.
  const { data: refetched, loading: serieLoading } = useDebouncedFetch<UnifiedRow[] | null>(
    async (): Promise<UnifiedRow[] | null> => {
      if (!supabase || loading) return null;
      const dStart = allDates[dateRange[0]] ?? null;
      const dEnd   = allDates[dateRange[1]] ?? null;
      if (granularity === "field") {
        const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return projectField(rows);
      } else if (granularity === "installation") {
        const camposParam = selectedCampos.length > 0 && selectedCampos.length < campos.length
          ? selectedCampos
          : null;
        const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
          campos:     camposParam,
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return projectInstallation(rows);
      } else if (granularity === "well") {
        const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return projectWell(rows);
      } else {
        // Company level handled by its own effect (companySerieRows).
        return null;
      }
    },
    [
      supabase, loading, granularity,
      dateRange[0], dateRange[1], allDates,
      selectedCampos, campos.length,
    ],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // ── Company coverage fetch (on empresa select) ────────────────────────────
  // The stake coverage (`empresaCampos`) doesn't depend on the period — fetch
  // it once per selected company.
  useEffect(() => {
    if (!supabase || granularity !== "company" || !selectedEmpresa) {
      setEmpresaCampos([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const campos = await rpcGetAnpCdpDiariaEmpresaCampos(supabase, selectedEmpresa);
      if (!cancelled) setEmpresaCampos(campos);
    })();
    return () => { cancelled = true; };
  }, [supabase, granularity, selectedEmpresa]);

  // ── Company net serie fetch (debounced 400ms) ─────────────────────────────
  // Triggered by selecting an empresa OR changing the period slider. Mirrors
  // the field/well debounce pattern. Clears the serie when no empresa selected.
  const { data: companyRefetched, loading: companySerieLoading } =
    useDebouncedFetch<AnpCdpDiariaEmpresaSeriePonto[] | null>(
      async (): Promise<AnpCdpDiariaEmpresaSeriePonto[] | null> => {
        if (!supabase || loading || granularity !== "company") return null;
        if (!selectedEmpresa) return [];
        const dStart = allDates[dateRange[0]] ?? null;
        const dEnd   = allDates[dateRange[1]] ?? null;
        return rpcGetAnpCdpDiariaEmpresaSerie(supabase, selectedEmpresa, {
          dataInicio: dStart,
          dataFim:    dEnd,
        });
      },
      [
        supabase, loading, granularity, selectedEmpresa,
        dateRange[0], dateRange[1], allDates,
      ],
      { ms: 400, skipInitial: false },
    );

  useEffect(() => {
    if (companyRefetched != null) setCompanySerieRows(companyRefetched);
  }, [companyRefetched]);

  // ── Explicit dimensions per level ─────────────────────────────────────────
  const explicitDims = useMemo(() => {
    if (granularity === "field")        return selectedCampos;
    if (granularity === "installation") return selectedInstalacoes;
    return selectedPocos;
  }, [granularity, selectedCampos, selectedInstalacoes, selectedPocos]);

  // Default Top-N (by metric average) when no explicit selection.
  const defaultPetroleoDims = useMemo(
    () => pickTopDimensions(serieRows, "petroleo_bbl_dia", TOP_N),
    [serieRows],
  );
  const defaultGasDims = useMemo(
    () => pickTopDimensions(serieRows, "gas_mm3_dia", TOP_N),
    [serieRows],
  );

  const dimsPetroleoChart = explicitDims.length > 0 ? explicitDims : defaultPetroleoDims;
  const dimsGasChart      = explicitDims.length > 0 ? explicitDims : defaultGasDims;

  // Client-side filtering of dimensions not pushed to the RPC.
  const visibleRows = useMemo(() => {
    let rows = serieRows;
    if (granularity === "field") {
      if (selectedCampos.length > 0) {
        const set = new Set(selectedCampos);
        rows = rows.filter(r => set.has(r.campo));
      }
    } else if (granularity === "installation") {
      if (selectedInstalacoes.length > 0) {
        const set = new Set(selectedInstalacoes);
        rows = rows.filter(r => set.has(r.dimension));
      }
    } else {
      if (selectedCampos.length > 0) {
        const set = new Set(selectedCampos);
        rows = rows.filter(r => set.has(r.campo));
      }
      if (selectedPocos.length > 0) {
        const set = new Set(selectedPocos);
        rows = rows.filter(r => set.has(r.dimension));
      }
    }
    return rows;
  }, [serieRows, granularity, selectedCampos, selectedInstalacoes, selectedPocos]);

  // ── Charts ────────────────────────────────────────────────────────────────
  const petroleoChart = useMemo(
    () => buildSerieChart(visibleRows, "petroleo_bbl_dia", dimsPetroleoChart, "kbpd", 320, bblDiaToKbpd),
    [visibleRows, dimsPetroleoChart],
  );
  const gasChart = useMemo(
    () => buildSerieChart(visibleRows, "gas_mm3_dia", dimsGasChart, "Mm³/d", 320),
    [visibleRows, dimsGasChart],
  );

  // ── Recent rows table (sorted by date desc, capped at 500) ────────────────
  const tableRows = useMemo(() => {
    return [...visibleRows]
      .sort((a, b) => b.data.localeCompare(a.data) || b.dimension.localeCompare(a.dimension))
      .slice(0, 500);
  }, [visibleRows]);

  // ── Ranking (mobile data cards) ───────────────────────────────────────────
  const ranking = useMemo(() => buildRanking(visibleRows, product), [visibleRows, product]);

  // ── Company level derivations ─────────────────────────────────────────────
  // Project the company net serie into UnifiedRow[] (NET values, field labels
  // with stake) so the existing chart builders compose cleanly.
  const companyUnifiedRows = useMemo(
    () => projectCompany(companySerieRows),
    [companySerieRows],
  );

  // THE single "which 6 + Others" decision for the company view. Every surface
  // below (line chart, monthly stacked bar, daily matrix, mobile ranking cap)
  // derives its top-N membership, Others composition, canonical order and color
  // from THIS object — changing the metric/cut here propagates to all of them.
  const companyBuckets = useMemo(
    () => buildCompanyBuckets(companySerieRows),
    [companySerieRows],
  );

  // Honest count of distinct fields carrying daily data (NOT the capped top-6+1).
  // PRIO → 6, Petrobras → 37. Used for the company chart subtitle field count.
  const companyFieldCount = companyBuckets.totalFieldCount;

  // Net oil line chart: bold headline total + per-field net lines (kbpd). The
  // gas chart was removed (2026-06-05) — Net Gas (avg) survives only as a KPI.
  const companyPetroleoChart = useMemo(
    () => buildCompanyChart(companyUnifiedRows, "petroleo_bbl_dia", "kbpd", 320, companyBuckets, bblDiaToKbpd),
    [companyUnifiedRows, companyBuckets],
  );

  // Monthly average net-oil-by-field, bucketed for the stacked bar (MtD-aware).
  const companyMonthlyOil = useMemo(
    () => buildCompanyMonthlyOilByField(companySerieRows, companyBuckets),
    [companySerieRows, companyBuckets],
  );
  const companyMonthlyOilChart = useMemo(
    () => buildCompanyMonthlyOilStacked(companyMonthlyOil, 320, bblDiaToKbpd),
    [companyMonthlyOil],
  );

  // Per-field net aggregates (mobile ranking cards). Capped to the top
  // TOP_N_COMPANY fields + a single "Others (N)" card so the ranking mirrors the
  // top-N+Others collapse the charts/matrix use (full breakdown is in Explore) —
  // the cap reuses `companyBuckets` (no independent re-sort).
  const companyFieldAggregates = useMemo(
    () => capCompanyFieldAggregates(buildCompanyFieldAggregates(companySerieRows, product), companyBuckets),
    [companySerieRows, product, companyBuckets],
  );

  // Daily net-oil matrix (fields × days) — the desktop "Daily net oil by field"
  // table. Columns ordered like the charts; rows one per day, latest first.
  const companyDailyOilMatrix = useMemo(
    () => buildCompanyDailyOilMatrix(companySerieRows, companyBuckets),
    [companySerieRows, companyBuckets],
  );

  // Stake-held fields not yet in the daily feed (e.g. Wahoo for PRIO).
  const companyFieldsNoData = useMemo<CompanyFieldNoData[]>(
    () => empresaCampos
      .filter(c => !c.has_daily_data)
      .map(c => ({ campo: c.campo, stakePct: c.stake_pct })),
    [empresaCampos],
  );

  // ── Labels per level ──────────────────────────────────────────────────────
  const dimLabel = useMemo(() => {
    if (granularity === "field")        return { singular: "Campo",       plural: "campo(s)",       en: "Field" };
    if (granularity === "installation") return { singular: "Instalação",  plural: "instalação(ões)", en: "Installation" };
    if (granularity === "well")         return { singular: "Poço",        plural: "poço(s)",        en: "Well" };
    return                                       { singular: "Campo",       plural: "campo(s)",       en: "Field" };
  }, [granularity]);

  const datasetKey =
    granularity === "field"        ? "anp_cdp_diaria" :
    granularity === "installation" ? "anp_cdp_diaria_instalacao" :
    granularity === "well"         ? "anp_cdp_diaria_poco" :
                                     "anp_cdp_diaria";

  const headerTitle =
    granularity === "field"        ? "Daily Production by Field" :
    granularity === "installation" ? "Daily Production by Installation" :
    granularity === "well"         ? "Daily Production by Well" :
    selectedEmpresa                ? `Daily Net Production — ${selectedEmpresa}` :
                                     "Daily Net Production by Company";

  const headerSub =
    granularity === "field"        ? "Petroleum and natural gas by field, refreshed 3×/day (source: ANP Power BI)" :
    granularity === "installation" ? "Petroleum and natural gas by installation, refreshed 3×/day (source: ANP Power BI)" :
    granularity === "well"         ? "Petroleum and natural gas by well, refreshed 3×/day (source: ANP Power BI)" :
                                     "Stake-weighted daily production by field (source: ANP Power BI × Field Stakes)";

  // ── Period badge ──────────────────────────────────────────────────────────
  const hasDates = allDates.length > 0;
  const dStart   = hasDates ? allDates[dateRange[0]] : null;
  const dEnd     = hasDates ? allDates[dateRange[1]] : null;
  const periodBadge: [string, string] | null =
    hasDates && dStart && dEnd ? [dStart, dEnd] : null;

  // ── Export helpers ────────────────────────────────────────────────────────
  const openExportModal = useCallback(() => {
    setExportCampos([]);
    setExportInstalacoes([]);
    setExportPocos([]);
    setExportRange(dateRange);
    setExportOpen(true);
  }, [dateRange]);

  const exportFilters = useMemo(() => {
    const eStart = allDates[exportRange[0]] ?? null;
    const eEnd   = allDates[exportRange[1]] ?? null;
    return {
      campos:      exportCampos.length      > 0 ? exportCampos      : null,
      instalacoes: exportInstalacoes.length > 0 ? exportInstalacoes : null,
      pocos:       exportPocos.length       > 0 ? exportPocos       : null,
      dataInicio:  eStart,
      dataFim:     eEnd,
    };
  }, [exportCampos, exportInstalacoes, exportPocos, exportRange, allDates]);

  const estimateExportRows = useCallback(async (): Promise<number> => {
    if (!supabase) return 0;
    try {
      if (granularity === "field") {
        const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
          campos:     exportFilters.campos,
          dataInicio: exportFilters.dataInicio,
          dataFim:    exportFilters.dataFim,
        });
        return rows.length;
      } else if (granularity === "installation") {
        const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
          campos:      exportFilters.campos,
          instalacoes: exportFilters.instalacoes,
          dataInicio:  exportFilters.dataInicio,
          dataFim:     exportFilters.dataFim,
        });
        return rows.length;
      } else {
        const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
          campos:     exportFilters.campos,
          pocos:      exportFilters.pocos,
          dataInicio: exportFilters.dataInicio,
          dataFim:    exportFilters.dataFim,
        });
        return rows.length;
      }
    } catch (e) {
      console.error("anp-cdp-diaria export count failed", e);
      return 0;
    }
  }, [supabase, granularity, exportFilters]);

  const handleExportExcel = useCallback(async () => {
    if (!supabase) return;
    setExcelLoading(true);
    try {
      if (granularity === "field") {
        const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
          campos:     exportFilters.campos,
          dataInicio: exportFilters.dataInicio,
          dataFim:    exportFilters.dataFim,
        });
        await downloadGenericExcel<AnpCdpDiariaPonto>({
          rows,
          filename: "ANP-CDP-Diaria-Field",
          title:    "ANP — Daily Production by Field",
          sheetName: "Daily Production",
          columns: [
            { key: "data",             header: "Date" },
            { key: "bacia",            header: "Basin",            width: 24 },
            { key: "campo",            header: "Field",            width: 30 },
            { key: "petroleo_bbl_dia", header: "Oil (bbl/day)",    format: "#,##0.0",  align: "right" },
            { key: "gas_mm3_dia",      header: "Gas (Mm³/day)",    format: "#,##0.000", align: "right" },
          ],
        });
      } else if (granularity === "installation") {
        const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
          campos:      exportFilters.campos,
          instalacoes: exportFilters.instalacoes,
          dataInicio:  exportFilters.dataInicio,
          dataFim:     exportFilters.dataFim,
        });
        await downloadGenericExcel<AnpCdpDiariaInstalacaoPonto>({
          rows,
          filename: "ANP-CDP-Diaria-Installation",
          title:    "ANP — Daily Production by Installation",
          sheetName: "Daily Production",
          columns: [
            { key: "data",             header: "Date" },
            { key: "campo",            header: "Field",            width: 30 },
            { key: "instalacao",       header: "Installation",     width: 30 },
            { key: "petroleo_bbl_dia", header: "Oil (bbl/day)",    format: "#,##0.0",  align: "right" },
            { key: "gas_mm3_dia",      header: "Gas (Mm³/day)",    format: "#,##0.000", align: "right" },
          ],
        });
      } else {
        const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
          campos:     exportFilters.campos,
          pocos:      exportFilters.pocos,
          dataInicio: exportFilters.dataInicio,
          dataFim:    exportFilters.dataFim,
        });
        await downloadGenericExcel<AnpCdpDiariaPocoPonto>({
          rows,
          filename: "ANP-CDP-Diaria-Well",
          title:    "ANP — Daily Production by Well",
          sheetName: "Daily Production",
          columns: [
            { key: "data",             header: "Date" },
            { key: "bacia",            header: "Basin",            width: 24 },
            { key: "campo",            header: "Field",            width: 30 },
            { key: "poco",             header: "Well",             width: 30 },
            { key: "petroleo_bbl_dia", header: "Oil (bbl/day)",    format: "#,##0.0",  align: "right" },
            { key: "gas_mm3_dia",      header: "Gas (Mm³/day)",    format: "#,##0.000", align: "right" },
          ],
        });
      }
      setExportOpen(false);
    } catch (e) {
      console.error("ANP CDP Diária Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [supabase, granularity, exportFilters]);

  const handleExportCsv = useCallback(async () => {
    if (!supabase) return;
    setCsvLoading(true);
    try {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);
      const suffix = granularity === "field" ? "field" : granularity === "installation" ? "installation" : "well";
      if (granularity === "field") {
        const rows = await rpcGetAnpCdpDiariaSerie(supabase, {
          campos:     exportFilters.campos,
          dataInicio: exportFilters.dataInicio,
          dataFim:    exportFilters.dataFim,
        });
        downloadCsv({
          rows: rows as unknown as Record<string, unknown>[],
          filename: `anp_cdp_diaria_${suffix}_${dd}-${mm}-${yy}`,
        });
      } else if (granularity === "installation") {
        const rows = await rpcGetAnpCdpDiariaInstalacaoSerie(supabase, {
          campos:      exportFilters.campos,
          instalacoes: exportFilters.instalacoes,
          dataInicio:  exportFilters.dataInicio,
          dataFim:     exportFilters.dataFim,
        });
        downloadCsv({
          rows: rows as unknown as Record<string, unknown>[],
          filename: `anp_cdp_diaria_${suffix}_${dd}-${mm}-${yy}`,
        });
      } else {
        const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
          campos:     exportFilters.campos,
          pocos:      exportFilters.pocos,
          dataInicio: exportFilters.dataInicio,
          dataFim:    exportFilters.dataFim,
        });
        downloadCsv({
          rows: rows as unknown as Record<string, unknown>[],
          filename: `anp_cdp_diaria_${suffix}_${dd}-${mm}-${yy}`,
        });
      }
      setExportOpen(false);
    } catch (e) {
      console.error("ANP CDP Diária CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [supabase, granularity, exportFilters]);

  // Combine reactive-loading flags so Views show a single "updating" state
  // regardless of level.
  const combinedSerieLoading = granularity === "company" ? companySerieLoading : serieLoading;

  return {
    visible,
    visLoading,
    loading,
    serieLoading: combinedSerieLoading,

    granularity,
    setGranularity,

    campos,
    instalacoes,
    pocos,

    allDates,
    dateRange,
    setDateRange,
    hasDates,
    periodBadge,

    selectedCampos,
    setSelectedCampos,
    selectedInstalacoes,
    setSelectedInstalacoes,
    selectedPocos,
    setSelectedPocos,

    product,
    setProduct,

    serieRows,
    visibleRows,

    explicitDims,

    petroleoChart,
    gasChart,
    defaultPetroleoDims,
    defaultGasDims,

    tableRows,

    ranking,

    selectedEmpresa,
    setSelectedEmpresa,
    empresaCampos,
    companySerieRows,
    companyFieldAggregates,
    companyFieldCount,
    companyDailyOilMatrix,
    companyFieldsNoData,
    companyPetroleoChart,
    companyMonthlyOilChart,

    dimLabel,
    datasetKey,
    headerTitle,
    headerSub,

    exportOpen,
    setExportOpen,
    excelLoading,
    csvLoading,
    exportCampos,
    setExportCampos,
    exportInstalacoes,
    setExportInstalacoes,
    exportPocos,
    setExportPocos,
    exportRange,
    setExportRange,
    exportFilters,
    openExportModal,
    estimateExportRows,
    handleExportExcel,
    handleExportCsv,
  };
}

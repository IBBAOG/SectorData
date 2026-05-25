"use client";

/**
 * useAnpCdpData — single brain for the /anp-cdp dual-view dashboard.
 *
 * Both `desktop/View.tsx` and `mobile/View.tsx` consume THIS hook exclusively.
 * No View ever calls supabase.rpc() directly.
 *
 * Responsibilities:
 *  - Orchestrates 3 RPCs: get_anp_cdp_filtros, get_anp_cdp_poco_serie,
 *    get_anp_cdp_pocos_json. The wells JSON dump is a ONE-SHOT request on
 *    mount; later filter changes are answered purely client-side.
 *  - Owns all 9 filter buckets (bacoes, locais, estados, operadores,
 *    instalacoes, tipos_instalacao, campos, pocos, year range).
 *  - Owns chart metric selection (5 options — petroleum, oil, total gas,
 *    water, production time).
 *  - Debounces the serie refetch by 400 ms when any filter changes
 *    (rajada-de-slider proof) via useDebouncedFetch.
 *  - Exposes a "hierarchical navigator" model used by the mobile drill-down:
 *    All Brazil → Basin → Local (PreSal/PosSal/Terra) → Field → Well. Each
 *    level is computed from the cached `allPocos` array — so drilling is
 *    instant, no extra round-trip.
 *  - Exposes derived KPIs (peak, total, average) of the current serie for
 *    the mini-stat row.
 *  - Exposes the export-modal contract (filters + size hook + handlers) so
 *    both Views can show the Tier 2 modal without re-implementing the wiring.
 *
 * Hierarchical drill-down model (mobile-first, also useable by desktop):
 *  - level=country : segments=[All Brazil] ; children=basins (unique allPocos.bacia)
 *  - level=basin   : segments=[All Brazil, <basin>] ; children=locals available
 *                    in that basin (PosSal/PreSal/Terra subset)
 *  - level=local   : segments=[All Brazil, <basin>, <Local label>]; children=fields
 *  - level=field   : segments=[..., <Field>] ; children=wells (terminal level)
 *  - level=well    : segments=[..., <Well>] ; children=[] (leaf)
 *
 * The mobile FilterDrawer is a separate concern from the hierarchical
 * navigator — operator / facility / facility type / period live in the
 * drawer; basin / local / field / well live in the breadcrumb. Both write
 * into the same shared filter state.
 *
 * Binding sync rule: any added value/function here is automatically
 * available to BOTH views. Adding to the hook is the first step before
 * adding a feature to either view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseClient } from "../../../lib/supabaseClient";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { bblDiaToKbpd } from "../../../lib/units";
import {
  rpcGetAnpCdpFiltros,
  rpcGetAnpCdpPocoSerie,
  rpcGetAnpCdpPocosJson,
  getAnpCdpExportCount,
  fetchAnpCdpRawFiltered,
  rpcGetAnpCdpAggregated,
  type AnpCdpSeriePonto,
  type AnpCdpFiltros,
  type AnpCdpPocoSimples,
  type AnpCdpExportCountFilters,
  type AnpCdpGroupBy,
} from "../../../lib/rpc";

// Re-export key types so Views never import from rpc.ts directly.
export type {
  AnpCdpSeriePonto,
  AnpCdpFiltros,
  AnpCdpPocoSimples,
  AnpCdpExportCountFilters,
  AnpCdpGroupBy,
};

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────────────

// Liquid-flow metrics are stored in bbl/day server-side and rescaled to kbpd
// (thousand barrels per day) at render time so the Y axis stays legible.
// Gas metrics keep their native Mm³/day. The set below is the whitelist
// honoured by `applyMetricDisplayUnit`.
export const KBPD_METRIC_KEYS: ReadonlySet<string> = new Set<string>([
  "petroleo_bbl_dia",
  "oleo_bbl_dia",
  "agua_bbl_dia",
]);

export interface AnpCdpMetric {
  key: keyof AnpCdpSeriePonto & string;
  label: string;
  /** Short label used in mobile chart hero subtitle and mini-stat units. */
  shortUnit: string;
  /** Hi-level family used to bucket metrics into the 3 mobile product tabs. */
  family: "petroleum" | "gas" | "water" | "time";
}

export const METRICS: readonly AnpCdpMetric[] = [
  { key: "petroleo_bbl_dia",            label: "Petroleum (kbpd)",          shortUnit: "kbpd",     family: "petroleum" },
  { key: "oleo_bbl_dia",                label: "Oil (kbpd)",                shortUnit: "kbpd",     family: "petroleum" },
  { key: "gas_total_mm3_dia",           label: "Total Gas (Mm³/day)",       shortUnit: "Mm³/day",  family: "gas" },
  { key: "agua_bbl_dia",                label: "Water (kbpd)",              shortUnit: "kbpd",     family: "water" },
  { key: "tempo_prod_hs_mes",           label: "Production Time (hrs/month)", shortUnit: "hrs/mo",  family: "time" },
] as const;

// Default metric per product family — used by mobile's product tab bar.
export const METRIC_FOR_FAMILY: Record<"petroleum" | "gas" | "water", AnpCdpMetric> = {
  petroleum: METRICS[0],
  gas:       METRICS[2],
  water:     METRICS[3],
};

export const LOCAL_LABELS: Record<string, string> = {
  PreSal: "Pre-Salt",
  PosSal: "Post-Salt (Offshore)",
  Terra:  "Onshore",
};

// Tier 2 export — hard limits for raw (per-poço × per-mês) export.
// Numbers are conservative: anp_cdp_producao has ~1.8M raw rows, so an
// unfiltered raw download must always hit ABS_MAX and force the user to
// narrow filters first.
export const RAW_EXCEL_MAX_ROWS = 200_000;
export const RAW_ABS_MAX_ROWS   = 500_000;

// Aggregated granularities — mapped to the `groupBy` array consumed by
// `rpcGetAnpCdpAggregated`. Default is "raw" (1 row per well × month).
export type AnpCdpGranularity =
  | "raw"
  | "campo"
  | "bacia"
  | "operador"
  | "ambiente"
  | "ano_mes"
  | "estado";

export const ANP_CDP_GROUPBY_MAP: Record<Exclude<AnpCdpGranularity, "raw">, AnpCdpGroupBy[]> = {
  campo:    ["ano", "mes", "campo"],
  bacia:    ["ano", "mes", "bacia"],
  operador: ["ano", "mes", "operador"],
  ambiente: ["ano", "mes", "local"],
  estado:   ["ano", "mes", "estado"],
  ano_mes:  ["ano", "mes"],
};

export const ANP_CDP_GRANULARITY_OPTIONS: Array<{
  value: AnpCdpGranularity;
  label: string;
  hint: string;
}> = [
  { value: "raw",      label: "By well (raw — all dimensions)",                       hint: "1 row per well × month × other dimensions (recommended for analysis)" },
  { value: "campo",    label: "By field (aggregated by year/month/field)",            hint: "sum of metrics by (year, month, field)" },
  { value: "bacia",    label: "By basin (aggregated by year/month/basin)",            hint: "sum of metrics by (year, month, basin)" },
  { value: "operador", label: "By operator (aggregated by year/month/operator)",      hint: "sum of metrics by (year, month, operator)" },
  { value: "ambiente", label: "By environment (aggregated by year/month/environment)", hint: "sum of metrics by (year, month, environment)" },
  { value: "estado",   label: "By state (aggregated by year/month/state)",            hint: "sum of metrics by (year, month, state)" },
  { value: "ano_mes",  label: "By year/month (overall aggregate)",                    hint: "total sum of metrics per month (≤252 rows)" },
];

// Hardcoded estimate of aggregated row counts (no extra round-trip). The raw
// path uses `getAnpCdpExportCount`; aggregated paths return one of these
// constants from the modal's `countFetcher`.
export const ANP_CDP_AGG_ESTIMATE: Record<Exclude<AnpCdpGranularity, "raw">, number> = {
  ano_mes:  252,
  estado:   252 * 6,
  ambiente: 252 * 3,
  bacia:    252 * 12,
  operador: 252 * 30,
  campo:    252 * 50,
};

// Month abbreviations — used by both views for chart hover/annotation.
export const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// HELPERS (pure — re-exported for Views)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Apply the kbpd display unit transform if the metric is a liquid-flow
 * metric (bbl/day → kbpd). Gas / time metrics pass through untouched.
 */
export function applyMetricDisplayUnit(
  rawValue: number | null | undefined,
  metricKey: string,
): number {
  const v = Number(rawValue ?? 0);
  return KBPD_METRIC_KEYS.has(metricKey) ? bblDiaToKbpd(v) : v;
}

/**
 * Concise number formatter for mobile mini-stats — keeps the digit budget
 * tiny while staying meaningful: 1.2M / 945k / 612 / 12.4 / 0.05 etc.
 */
export function fmtCompactNumber(v: number): string {
  if (!isFinite(v) || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
  if (abs >= 10)        return v.toFixed(0);
  if (abs >= 1)         return v.toFixed(1);
  return v.toFixed(2);
}

// ────────────────────────────────────────────────────────────────────────────
// HIERARCHICAL NAVIGATOR (mobile drill-down model)
// ────────────────────────────────────────────────────────────────────────────

export type DrillLevel = "country" | "basin" | "local" | "field" | "well";

export interface DrillState {
  level: DrillLevel;
  bacia: string | null;
  local: string | null;
  campo: string | null;
  poco:  string | null;
}

export const DRILL_RESET: DrillState = {
  level: "country",
  bacia: null,
  local: null,
  campo: null,
  poco:  null,
};

export interface DrillChild {
  /** Display label (e.g. "Tupi" or "Pre-Salt"). */
  label: string;
  /** Raw value used by filters (e.g. "Tupi" or "PreSal"). */
  value: string;
  /** Number of wells under this branch in the *current* allPocos. */
  wellCount: number;
}

// ────────────────────────────────────────────────────────────────────────────
// HOOK INTERFACE
// ────────────────────────────────────────────────────────────────────────────

export interface UseAnpCdpData {
  // ── Loading + error
  loading: boolean;
  serieLoading: boolean;
  pocosReady: boolean;

  // ── Source data
  filtros: AnpCdpFiltros;
  /** Full wells list from get_anp_cdp_pocos_json — never refetched. */
  allPocos: AnpCdpPocoSimples[];
  /** Aggregated monthly serie under the current filters. */
  serieData: AnpCdpSeriePonto[];

  // ── Year range
  allYears: number[];
  yearRange: [number, number];
  setYearRange: (next: [number, number]) => void;

  // ── Filters (server-side)
  selectedBacoes: string[];        setSelectedBacoes: (v: string[]) => void;
  selectedLocais: string[];        setSelectedLocais: (v: string[]) => void;
  selectedEstados: string[];       setSelectedEstados: (v: string[]) => void;
  selectedOperadores: string[];    setSelectedOperadores: (v: string[]) => void;
  selectedInstalacoes: string[];   setSelectedInstalacoes: (v: string[]) => void;
  selectedTipos: string[];         setSelectedTipos: (v: string[]) => void;
  selectedCampos: string[];        setSelectedCampos: (v: string[]) => void;
  selectedPocos: string[];         setSelectedPocos: (v: string[]) => void;

  // ── Metric selection
  metric: AnpCdpMetric;
  setMetric: (m: AnpCdpMetric) => void;

  // ── Derived: wells visible under the cascading client-side filter
  visiblePocos: AnpCdpPocoSimples[];
  /** Just the well names for the SearchableMultiSelect on desktop. */
  pocoOptions: string[];

  // ── Derived: serie scaled to the metric's display unit (kbpd vs Mm³/day).
  /** {x,y} arrays ready for Plotly. Empty when serie empty. */
  serieXY: { xs: string[]; ys: number[] };
  /** Per-point hover data (wells_count, records_count, fields_count). */
  serieCustomdata: number[][];

  // ── Derived: KPIs for the mobile mini-stats / desktop badges
  kpis: {
    total: number;        // sum of metric across visible serie
    average: number;      // mean of metric
    peak: number;         // max of metric
    peakLabel: string;    // "Mar 2024" — month label of the peak
    latest: number;       // latest point value
    latestLabel: string;  // "Apr 2026"
    wellsLatest: number;  // wells_count of the latest point
    fieldsLatest: number; // fields_count of the latest point
  };

  // ── Hierarchical navigator (mobile)
  drill: DrillState;
  setDrill: (next: Partial<DrillState>) => void;
  resetDrill: () => void;
  /** Children visible at the current drill level (instant — client-side). */
  drillChildren: DrillChild[];
  /** "All Brazil › Santos › Pre-Salt › Tupi" segments for StickyBreadcrumb. */
  drillSegments: Array<{ label: string; level: DrillLevel }>;

  // ── Tier 2 export contract (shared by both Views)
  exportFilters: AnpCdpExportCountFilters;
  exportRange: [number, number];
  setExportRange: (next: [number, number]) => void;
  exportBacoes: string[];     setExportBacoes: (v: string[]) => void;
  exportOperadores: string[]; setExportOperadores: (v: string[]) => void;
  exportLocais: string[];     setExportLocais: (v: string[]) => void;
  exportTipos: string[];      setExportTipos: (v: string[]) => void;
  exportGranularity: AnpCdpGranularity;
  setExportGranularity: (g: AnpCdpGranularity) => void;
  exportRawCount: number | null;
  setExportRawCount: (n: number | null) => void;

  /** Returns either the real count (raw) or the hardcoded estimate (agg). */
  countFetcher: () => Promise<number>;

  /** Excel handler (paginates raw, calls aggregated RPC otherwise). */
  doExportExcel: () => Promise<void>;
  /** CSV handler (same data path, RFC4180 writer). */
  doExportCsv: () => Promise<void>;
  excelLoading: boolean;
  csvLoading: boolean;

  /** Raw-export hard-limit gating (no-op for aggregated). */
  rawOverExcel: boolean;
  rawOverAbs: boolean;

  /**
   * Reset modal state from the current dashboard filters (called by
   * "Open export" CTA on both Views).
   */
  openExportFromCurrentFilters: () => void;

  // ── Supabase handle (for views that occasionally need lib helpers).
  supabase: SupabaseClient | null;
}

// ────────────────────────────────────────────────────────────────────────────
// HOOK IMPLEMENTATION
// ────────────────────────────────────────────────────────────────────────────

export function useAnpCdpData(): UseAnpCdpData {
  const supabase = getSupabaseClient();

  // ── Source state
  const [loading, setLoading]     = useState(true);
  const [filtros, setFiltros]     = useState<AnpCdpFiltros>({
    bacoes: [], campos: [], locais: [], estados: [], operadores: [],
    instalacoes: [], tipos_instalacao: [], ano_min: null, ano_max: null,
  });
  const [allPocos, setAllPocos]   = useState<AnpCdpPocoSimples[]>([]);
  const [pocosReady, setPocosReady] = useState(false);
  const [serieData, setSerieData] = useState<AnpCdpSeriePonto[]>([]);
  const [allYears, setAllYears]   = useState<number[]>([]);
  const [yearRange, setYearRange] = useState<[number, number]>([0, 0]);

  // ── Filter state
  const [selectedPocos,       setSelectedPocos]       = useState<string[]>([]);
  const [selectedCampos,      setSelectedCamposState] = useState<string[]>([]);
  const [selectedBacoes,      setSelectedBacoes]      = useState<string[]>([]);
  const [selectedLocais,      setSelectedLocais]      = useState<string[]>([]);
  const [selectedEstados,     setSelectedEstados]     = useState<string[]>([]);
  const [selectedOperadores,  setSelectedOperadores]  = useState<string[]>([]);
  const [selectedInstalacoes, setSelectedInstalacoes] = useState<string[]>([]);
  const [selectedTipos,       setSelectedTipos]       = useState<string[]>([]);
  const [metric, setMetric]   = useState<AnpCdpMetric>(METRICS[0]);

  // Reset poço selection whenever Campo changes — Campo is more specific so
  // an existing poço might no longer be visible under the new field set.
  const setSelectedCampos = useCallback((next: string[]) => {
    setSelectedCamposState(next);
    setSelectedPocos([]);
  }, []);

  // ── Initial load
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      const [f, serie] = await Promise.all([
        rpcGetAnpCdpFiltros(supabase),
        rpcGetAnpCdpPocoSerie(supabase),
      ]);
      if (cancelled) return;

      setFiltros(f);
      setSerieData(serie);

      const yMin = f.ano_min ?? 2005;
      const yMax = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      setAllYears(years);

      // Default: last 10 years (or whole range if shorter).
      const startIdx = Math.max(0, years.findIndex((y) => y >= yMax - 9));
      setYearRange([startIdx, years.length - 1]);
      setLoading(false);

      // Wells dump — one-shot, ~1-2s gzipped, client-side cascade after.
      const pocos = await rpcGetAnpCdpPocosJson(supabase);
      if (!cancelled) {
        setAllPocos(pocos);
        setPocosReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [supabase]);

  // ── Debounced serie refetch (400 ms) — covers slider rajadas
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      return rpcGetAnpCdpPocoSerie(supabase, {
        pocos:           selectedPocos.length       ? selectedPocos       : null,
        campos:          selectedCampos.length      ? selectedCampos      : null,
        bacoes:          selectedBacoes.length      ? selectedBacoes      : null,
        locais:          selectedLocais.length      ? selectedLocais      : null,
        estados:         selectedEstados.length     ? selectedEstados     : null,
        operadores:      selectedOperadores.length  ? selectedOperadores  : null,
        instalacoes:     selectedInstalacoes.length ? selectedInstalacoes : null,
        tiposInstalacao: selectedTipos.length       ? selectedTipos       : null,
        anoInicio:       allYears[yearRange[0]]     ?? null,
        anoFim:          allYears[yearRange[1]]     ?? null,
      });
    },
    [
      supabase, loading,
      selectedPocos, selectedCampos, selectedBacoes, selectedLocais,
      selectedEstados, selectedOperadores, selectedInstalacoes, selectedTipos,
      yearRange, allYears,
    ],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieData(refetched);
  }, [refetched]);

  // ── Client-side poço cascade (instant, no refetch)
  const visiblePocos = useMemo(() => {
    let list = allPocos;
    if (selectedCampos.length)     list = list.filter((p) => selectedCampos.includes(p.campo));
    if (selectedBacoes.length)     list = list.filter((p) => selectedBacoes.includes(p.bacia));
    if (selectedLocais.length)     list = list.filter((p) => selectedLocais.includes(p.local));
    if (selectedEstados.length)    list = list.filter((p) => !!p.estado   && selectedEstados.includes(p.estado));
    if (selectedOperadores.length) list = list.filter((p) => !!p.operador && selectedOperadores.includes(p.operador));
    return list;
  }, [allPocos, selectedCampos, selectedBacoes, selectedLocais, selectedEstados, selectedOperadores]);

  const pocoOptions = useMemo(
    () => visiblePocos.map((p) => p.poco),
    [visiblePocos],
  );

  // ── Serie projected to display units + per-point custom data
  const serieXY = useMemo(() => {
    const xs = serieData.map((r) => `${r.ano}-${String(r.mes).padStart(2, "0")}-01`);
    const ys = serieData.map((r) => applyMetricDisplayUnit(r[metric.key] as number, metric.key));
    return { xs, ys };
  }, [serieData, metric]);

  const serieCustomdata = useMemo(
    () => serieData.map((r) => [
      r.wells_count   ?? 0,
      r.records_count ?? 0,
      r.fields_count  ?? 0,
    ]),
    [serieData],
  );

  // ── KPIs — total / average / peak / latest (display units)
  const kpis = useMemo(() => {
    if (!serieData.length) {
      return {
        total: 0, average: 0, peak: 0, peakLabel: "—",
        latest: 0, latestLabel: "—",
        wellsLatest: 0, fieldsLatest: 0,
      };
    }
    let total = 0;
    let peak = -Infinity;
    let peakIdx = 0;
    for (let i = 0; i < serieData.length; i++) {
      const y = serieXY.ys[i];
      total += y;
      if (y > peak) { peak = y; peakIdx = i; }
    }
    const average = total / serieData.length;
    const peakPt  = serieData[peakIdx];
    const lastIdx = serieData.length - 1;
    const lastPt  = serieData[lastIdx];
    return {
      total,
      average,
      peak,
      peakLabel: `${MONTH_ABBR[(peakPt.mes - 1) % 12]} ${peakPt.ano}`,
      latest: serieXY.ys[lastIdx],
      latestLabel: `${MONTH_ABBR[(lastPt.mes - 1) % 12]} ${lastPt.ano}`,
      wellsLatest:  lastPt.wells_count   ?? 0,
      fieldsLatest: lastPt.fields_count  ?? 0,
    };
  }, [serieData, serieXY]);

  // ── Hierarchical drill state — mobile-first, but also exposed to desktop
  const [drillState, setDrillState] = useState<DrillState>(DRILL_RESET);

  // Whenever the drill state changes, push the corresponding filter shape
  // into the main filter state so the chart re-fetches accordingly.
  const setDrill = useCallback((patch: Partial<DrillState>) => {
    setDrillState((prev) => {
      const next: DrillState = { ...prev, ...patch };

      // Derive `level` from which fields are populated, unless the caller
      // explicitly passed one.
      if (patch.level === undefined) {
        if (next.poco)       next.level = "well";
        else if (next.campo) next.level = "field";
        else if (next.local) next.level = "local";
        else if (next.bacia) next.level = "basin";
        else                 next.level = "country";
      }

      // Higher levels reset lower ones for consistency (selecting a new
      // basin clears the previously-selected field/well).
      if (patch.bacia !== undefined) {
        next.local = patch.local ?? null;
        next.campo = patch.campo ?? null;
        next.poco  = patch.poco  ?? null;
      } else if (patch.local !== undefined) {
        next.campo = patch.campo ?? null;
        next.poco  = patch.poco  ?? null;
      } else if (patch.campo !== undefined) {
        next.poco  = patch.poco  ?? null;
      }

      // Mirror into the actual filter setters so the chart refetches.
      setSelectedBacoes(next.bacia ? [next.bacia] : []);
      setSelectedLocais(next.local ? [next.local] : []);
      setSelectedCamposState(next.campo ? [next.campo] : []);
      setSelectedPocos(next.poco ? [next.poco] : []);

      return next;
    });
  }, []);

  const resetDrill = useCallback(() => {
    setDrillState(DRILL_RESET);
    setSelectedBacoes([]);
    setSelectedLocais([]);
    setSelectedCamposState([]);
    setSelectedPocos([]);
  }, []);

  // Compute the children visible at the current drill level (client-side
  // over allPocos — instant once the wells JSON has loaded).
  const drillChildren = useMemo<DrillChild[]>(() => {
    if (!pocosReady || !allPocos.length) return [];
    let pool = allPocos;
    if (drillState.bacia) pool = pool.filter((p) => p.bacia === drillState.bacia);
    if (drillState.local) pool = pool.filter((p) => p.local === drillState.local);
    if (drillState.campo) pool = pool.filter((p) => p.campo === drillState.campo);

    let keyOf: (p: AnpCdpPocoSimples) => string;
    let labelOf: (k: string) => string;
    switch (drillState.level) {
      case "country":
        keyOf = (p) => p.bacia;
        labelOf = (k) => k;
        break;
      case "basin":
        keyOf = (p) => p.local;
        labelOf = (k) => LOCAL_LABELS[k] ?? k;
        break;
      case "local":
        keyOf = (p) => p.campo;
        labelOf = (k) => k;
        break;
      case "field":
        keyOf = (p) => p.poco;
        labelOf = (k) => k;
        break;
      case "well":
      default:
        return [];
    }

    const counts = new Map<string, number>();
    for (const p of pool) {
      const k = keyOf(p);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, wellCount]) => ({ value, label: labelOf(value), wellCount }))
      .sort((a, b) => b.wellCount - a.wellCount);
  }, [pocosReady, allPocos, drillState]);

  const drillSegments = useMemo<Array<{ label: string; level: DrillLevel }>>(() => {
    const segments: Array<{ label: string; level: DrillLevel }> = [
      { label: "All Brazil", level: "country" },
    ];
    if (drillState.bacia) segments.push({ label: drillState.bacia, level: "basin" });
    if (drillState.local) segments.push({ label: LOCAL_LABELS[drillState.local] ?? drillState.local, level: "local" });
    if (drillState.campo) segments.push({ label: drillState.campo, level: "field" });
    if (drillState.poco)  segments.push({ label: drillState.poco,  level: "well" });
    return segments;
  }, [drillState]);

  // ────────────────────────────────────────────────────────────────────────
  // EXPORT MODAL state — Tier 2 (raw paginated SELECT + aggregated RPC)
  // ────────────────────────────────────────────────────────────────────────

  const [excelLoading, setExcelLoading]         = useState(false);
  const [csvLoading,   setCsvLoading]           = useState(false);
  const [exportBacoes, setExportBacoes]         = useState<string[]>([]);
  const [exportOperadores, setExportOperadores] = useState<string[]>([]);
  const [exportLocais, setExportLocais]         = useState<string[]>([]);
  const [exportTipos,  setExportTipos]          = useState<string[]>([]);
  const [exportRange,  setExportRange]          = useState<[number, number]>([0, 0]);
  const [exportGranularity, setExportGranularity] = useState<AnpCdpGranularity>("raw");
  const [exportRawCount, setExportRawCount]     = useState<number | null>(null);

  const exportFilters = useMemo<AnpCdpExportCountFilters>(() => {
    const yMin = allYears[exportRange[0]] ?? null;
    const yMax = allYears[exportRange[1]] ?? null;
    return {
      bacoes:          exportBacoes.length     ? exportBacoes     : null,
      operadores:      exportOperadores.length ? exportOperadores : null,
      locais:          exportLocais.length     ? exportLocais     : null,
      tiposInstalacao: exportTipos.length      ? exportTipos      : null,
      anoInicio:       yMin,
      anoFim:          yMax,
    };
  }, [exportBacoes, exportOperadores, exportLocais, exportTipos, exportRange, allYears]);

  const rawOverExcel =
    exportGranularity === "raw" &&
    exportRawCount !== null &&
    exportRawCount > RAW_EXCEL_MAX_ROWS;
  const rawOverAbs =
    exportGranularity === "raw" &&
    exportRawCount !== null &&
    exportRawCount > RAW_ABS_MAX_ROWS;

  const openExportFromCurrentFilters = useCallback(() => {
    setExportBacoes(selectedBacoes);
    setExportOperadores(selectedOperadores);
    setExportLocais(selectedLocais);
    setExportTipos(selectedTipos);
    setExportRange(yearRange);
    setExportGranularity("raw");
    setExportRawCount(null);
  }, [selectedBacoes, selectedOperadores, selectedLocais, selectedTipos, yearRange]);

  const countFetcher = useCallback(async (): Promise<number> => {
    if (!supabase) return 0;
    if (exportGranularity !== "raw") {
      setExportRawCount(null);
      return ANP_CDP_AGG_ESTIMATE[exportGranularity];
    }
    const c = await getAnpCdpExportCount(supabase, exportFilters);
    setExportRawCount(c);
    return c;
  }, [supabase, exportGranularity, exportFilters]);

  // Lazy-imported writers — kept in lib/exportExcel.ts so the page bundles
  // them only when the user actually opens the modal.
  const doExportExcel = useCallback(async (): Promise<void> => {
    if (!supabase) return;
    if (rawOverAbs) {
      console.warn("ANP CDP raw Excel blocked: rows exceed RAW_ABS_MAX_ROWS");
      return;
    }
    if (rawOverExcel) {
      console.warn("ANP CDP raw Excel blocked: rows exceed RAW_EXCEL_MAX_ROWS — use CSV");
      return;
    }
    setExcelLoading(true);
    try {
      const { downloadAnpCdpRawExcel, downloadAnpCdpAggregatedExcel } =
        await import("../../../lib/exportExcel");
      if (exportGranularity === "raw") {
        const rows = await fetchAnpCdpRawFiltered(supabase, exportFilters);
        await downloadAnpCdpRawExcel(rows);
      } else {
        const groupBy = ANP_CDP_GROUPBY_MAP[exportGranularity];
        const rows = await rpcGetAnpCdpAggregated(supabase, exportFilters, groupBy);
        await downloadAnpCdpAggregatedExcel(rows, groupBy);
      }
    } catch (e) {
      console.error("ANP CDP Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [supabase, rawOverAbs, rawOverExcel, exportGranularity, exportFilters]);

  const doExportCsv = useCallback(async (): Promise<void> => {
    if (!supabase) return;
    if (rawOverAbs) {
      console.warn("ANP CDP raw CSV blocked: rows exceed RAW_ABS_MAX_ROWS");
      return;
    }
    setCsvLoading(true);
    try {
      const { downloadCsv } = await import("../../../lib/exportCsv");
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yy = String(now.getFullYear()).slice(-2);

      if (exportGranularity === "raw") {
        const rows = await fetchAnpCdpRawFiltered(supabase, exportFilters);
        downloadCsv({
          rows: rows as unknown as Record<string, unknown>[],
          filename: `anp_cdp_raw_${dd}-${mm}-${yy}`,
        });
      } else {
        const groupBy = ANP_CDP_GROUPBY_MAP[exportGranularity];
        const rows = await rpcGetAnpCdpAggregated(supabase, exportFilters, groupBy);
        const metricKeys = [
          "petroleo_bbl_dia", "oleo_bbl_dia",
          "gas_total_mm3_dia",
          "agua_bbl_dia", "tempo_prod_hs_mes",
        ] as const;
        const wantedCols = [...groupBy, ...metricKeys] as readonly string[];
        const projected = rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of wantedCols) {
            out[k] = (r as unknown as Record<string, unknown>)[k];
          }
          return out;
        });
        downloadCsv({
          rows: projected,
          filename: `anp_cdp_${exportGranularity}_${dd}-${mm}-${yy}`,
        });
      }
    } catch (e) {
      console.error("ANP CDP CSV export failed", e);
    } finally {
      setCsvLoading(false);
    }
  }, [supabase, rawOverAbs, exportGranularity, exportFilters]);

  return {
    // Loading
    loading,
    serieLoading,
    pocosReady,

    // Source
    filtros,
    allPocos,
    serieData,

    // Year range
    allYears,
    yearRange,
    setYearRange,

    // Filters
    selectedBacoes,       setSelectedBacoes,
    selectedLocais,       setSelectedLocais,
    selectedEstados,      setSelectedEstados,
    selectedOperadores,   setSelectedOperadores,
    selectedInstalacoes,  setSelectedInstalacoes,
    selectedTipos,        setSelectedTipos,
    selectedCampos,       setSelectedCampos,
    selectedPocos,        setSelectedPocos,

    // Metric
    metric,
    setMetric,

    // Derived poços
    visiblePocos,
    pocoOptions,

    // Derived serie
    serieXY,
    serieCustomdata,
    kpis,

    // Drill-down
    drill: drillState,
    setDrill,
    resetDrill,
    drillChildren,
    drillSegments,

    // Export
    exportFilters,
    exportRange,        setExportRange,
    exportBacoes,       setExportBacoes,
    exportOperadores,   setExportOperadores,
    exportLocais,       setExportLocais,
    exportTipos,        setExportTipos,
    exportGranularity,  setExportGranularity,
    exportRawCount,     setExportRawCount,
    countFetcher,
    doExportExcel,
    doExportCsv,
    excelLoading,
    csvLoading,
    rawOverExcel,
    rawOverAbs,
    openExportFromCurrentFilters,

    supabase,
  };
}

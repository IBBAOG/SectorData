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
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";
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
  type AnpCdpDiariaPonto,
  type AnpCdpDiariaInstalacaoPonto,
  type AnpCdpDiariaPocoPonto,
} from "../../../lib/rpc";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
];

export const TOP_N = 10;

export const BRAND_ORANGE = "#FF5000";

export type Metric = "petroleo_bbl_dia" | "gas_mm3_dia";
export type Product = "oil" | "gas";
export type Granularity = "field" | "installation" | "well";

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

  // ── Granularity (desktop only changes; mobile View keeps "field") ─────────
  const [granularity, setGranularityState] = useState<Granularity>("field");

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

    // Reset selections when switching levels (vocabularies differ).
    if (!initialMountRef.current) {
      setSelectedCampos([]);
      setSelectedInstalacoes([]);
      setSelectedPocos([]);
      setSerieRows([]);
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
        } else {
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
      } else {
        const rows = await rpcGetAnpCdpDiariaPocoSerie(supabase, {
          dataInicio: dStart,
          dataFim:    dEnd,
        });
        return projectWell(rows);
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

  // ── Labels per level ──────────────────────────────────────────────────────
  const dimLabel = useMemo(() => {
    if (granularity === "field")        return { singular: "Campo",       plural: "campo(s)",       en: "Field" };
    if (granularity === "installation") return { singular: "Instalação",  plural: "instalação(ões)", en: "Installation" };
    return                                       { singular: "Poço",        plural: "poço(s)",        en: "Well" };
  }, [granularity]);

  const datasetKey =
    granularity === "field"        ? "anp_cdp_diaria" :
    granularity === "installation" ? "anp_cdp_diaria_instalacao" :
                                     "anp_cdp_diaria_poco";

  const headerTitle =
    granularity === "field"        ? "Daily Production by Field" :
    granularity === "installation" ? "Daily Production by Installation" :
                                     "Daily Production by Well";

  const headerSub =
    granularity === "field"        ? "Petroleum and natural gas by field, refreshed 3×/day (source: ANP Power BI)" :
    granularity === "installation" ? "Petroleum and natural gas by installation, refreshed 3×/day (source: ANP Power BI)" :
                                     "Petroleum and natural gas by well, refreshed 3×/day (source: ANP Power BI)";

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

  return {
    visible,
    visLoading,
    loading,
    serieLoading,

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
